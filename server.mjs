import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import demo from './demo.js';

const { PROJECTS, STAGES, PRODUCTS, DEMO_TASKS, DEMO_REVIEWS } = demo;
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.BOARD_DATA_DIR || join(root, 'data'));
const dataFile = join(dataDir, 'board.json');
const imageDir = join(dataDir, 'images');
const port = Number(process.env.BOARD_PORT || 4389);
const origin = `http://127.0.0.1:${port}`;
const publicOrigin = process.env.BOARD_PUBLIC_ORIGIN ? new URL(process.env.BOARD_PUBLIC_ORIGIN) : null;
if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.href !== publicOrigin.origin + '/')) {
  throw new Error('BOARD_PUBLIC_ORIGIN 必须是无路径的 HTTPS 地址');
}
const maxImage = 4 * 1024 * 1024;
const imageTypes = {png:'image/png', jpg:'image/jpeg', gif:'image/gif', webp:'image/webp'};
const dist = join(root, 'dist');

mkdirSync(imageDir, { recursive: true });
let board = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : {
  tasks: process.env.BOARD_EMPTY === '1' ? [] : DEMO_TASKS,
  reviews: process.env.BOARD_EMPTY === '1' ? [] : DEMO_REVIEWS,
  comments: [],
  history: [],
  nextTask: 1,
};
board.history ??= [];
if (!existsSync(dataFile)) persist(board);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function persist(next) {
  writeFileSync(dataFile + '.tmp', JSON.stringify(next, null, 2) + '\n', 'utf8');
  renameSync(dataFile + '.tmp', dataFile);
}

function change(edit) {
  const next = structuredClone(board);
  const result = edit(next);
  persist(next);
  board = next;
  return result;
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    fail(415, '请求必须使用 application/json');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 24 * 1024 * 1024) fail(413, '请求体过大');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, '无效的 JSON'); }
  if (!input || Array.isArray(input) || typeof input !== 'object') fail(400, '请求必须是 JSON 对象');
  return input;
}

function field(value, name, max, required = false) {
  if (typeof value !== 'string') fail(400, `${name}必须是文本`);
  const trimmed = value.trim();
  if (required && trimmed.length === 0) fail(400, `${name}不能为空`);
  if (trimmed.length > max) fail(400, `${name}最多 ${max} 字`);
  return trimmed;
}

function taskIn(data, id) {
  const found = data.tasks.find(task => task.id === id);
  if (!found) fail(404, '找不到任务 ' + id);
  return found;
}

function taskFields(input, existing = {}) {
  const value = (name, defaultValue = '') => Object.hasOwn(input, name) ? input[name] : (existing[name] ?? defaultValue);
  const title = field(value('title'), '任务名称', 160, true);
  const project = value('project');
  const stage = value('stage', '待推进');
  if (!PROJECTS.some(([name]) => project === name)) fail(400, '请选择已有项目');
  if (!STAGES.includes(stage)) fail(400, '请选择有效状态');
  const deployment = project === '私有化部署';
  const customer = deployment ? (field(value('customer'), '客户', 60) || '自己') : '';
  const product = deployment ? value('product') : '';
  if (deployment && !PRODUCTS.includes(product)) fail(400, '请选择部署产品');
  return {
    title, project, stage, customer, product,
    topic: field(value('topic'), '标签', 32),
    description: field(value('description'), '任务说明', 12000),
    evidence: field(value('evidence'), '依据', 6000),
  };
}

function taskDisplay(task) {
  return task.product && !task.title.startsWith('[' + task.product + ']')
    ? '[' + task.product + '] ' + task.title : task.title;
}

function sourceOf(req) {
  return req.headers['x-board-source'] === 'cli' ? 'cli' : 'web';
}

function recordHistory(data, task, source, type, details = {}) {
  const entry = { id: randomUUID(), taskId: task.id, at: new Date().toISOString(), source, type, ...details };
  data.history.push(entry);
  return entry;
}

function invalidArchivedStage(task, fields) {
  return Boolean(fields.archivedAt ?? task.archivedAt) && (fields.stage ?? task.stage) !== '已完成';
}

function applyTaskFields(task, fields) {
  if (invalidArchivedStage(task, fields)) fail(409, '归档只适用于已完成任务，修改状态前请先恢复');
  const changes = Object.entries(fields).filter(([key, value]) => task[key] !== value).map(([key, after]) => ({
    field: key, before: task[key] ?? '', after,
  }));
  if (changes.length) {
    Object.assign(task, fields, { revision: task.revision + 1, updated: new Date().toISOString() });
  }
  return changes;
}

function setArchivedTasks(input, source) {
  const { tasks:selection, archived } = input;
  if (typeof archived !== 'boolean' || !Array.isArray(selection) || !selection.length ||
      selection.some(item => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.revision)) ||
      new Set(selection.map(item => item.id)).size !== selection.length) {
    fail(400, '请提供需要归档或恢复的任务及其版本');
  }
  return change(next => {
    const at = new Date().toISOString();
    const history = [];
    const tasks = selection.map(({ id, revision }) => {
      const task = taskIn(next, id);
      if (task.revision !== revision) fail(409, '有任务已更新，请刷新后重试');
      if (Boolean(task.archivedAt) === archived) return task;
      const changes = applyTaskFields(task, { archivedAt: archived ? at : '' });
      history.push(recordHistory(next, task, source, archived ? 'archived' : 'restored', { changes }));
      return task;
    });
    return { tasks, history };
  });
}

function previousFields(entry) {
  return Object.fromEntries((entry.changes ?? []).map(item => [item.field, item.before]));
}

function effectState(data, effect) {
  if (effect?.type === 'comment') {
    const comment = data.comments.find(item => item.id === effect.id);
    return comment && !comment.withdrawn;
  }
  if (effect?.type === 'review') return data.reviews.find(item => item.id === effect.id)?.decision;
}

function undoStatus(data, task, entry, undoneIds) {
  if (!entry.changes?.length && !entry.effect) return 'view-only';
  if (undoneIds.has(entry.id)) return 'undone';
  if (invalidArchivedStage(task, previousFields(entry)) ||
      entry.changes?.some(change => task[change.field] !== change.after)
    || (entry.effect && effectState(data, entry.effect) !== entry.effect.after)) return 'conflict';
  return 'available';
}

function taskHistory(data, task) {
  const entries = data.history.filter(item => item.taskId === task.id);
  const undone = new Set(entries.map(item => item.undoOf).filter(Boolean));
  return entries.reverse().map(entry => ({ ...entry, undoStatus: undoStatus(data, task, entry, undone) }));
}

function applyHistoryReversal(next, id, entryId, revision, source) {
  const task = taskIn(next, id);
  if (task.revision !== revision) fail(409, '任务有更新，请刷新后重试');
  const entry = next.history.find(item => item.id === entryId && item.taskId === id);
  if (!entry) fail(404, '找不到操作记录');
  const undone = new Set(next.history.map(item => item.undoOf).filter(Boolean));
  const status = undoStatus(next, task, entry, undone);
  if (status === 'undone') fail(409, '这条操作已有撤销或重做记录');
  if (status === 'conflict') fail(409, '相关字段或记录已变化，无法撤销或重做');
  if (status !== 'available') fail(400, '这条记录仅供查看');

  const fields = previousFields(entry);
  const changes = applyTaskFields(task, fields);
  const effect = entry.effect && { ...entry.effect, before: entry.effect.after, after: entry.effect.before };
  if (effect?.type === 'comment') {
    next.comments.find(item => item.id === effect.id).withdrawn = !effect.after;
  } else if (effect?.type === 'review') {
    next.reviews.find(item => item.id === effect.id).decision = effect.after;
  }
  const history = recordHistory(next, task, source, 'undo', {
    changes, ...(effect ? {effect} : {}), undoOf: entry.id,
    reversal: entry.type === 'undo' && entry.reversal !== 'redo' ? 'redo' : 'undo',
  });
  return { task, history };
}

function reverseTaskAction(input, source) {
  const { entries } = input;
  if (!Array.isArray(entries) || !entries.length ||
      entries.some(item => !item || typeof item.taskId !== 'string' ||
        typeof item.entryId !== 'string' || !Number.isSafeInteger(item.revision)) ||
      new Set(entries.map(item => item.taskId)).size !== entries.length) {
    fail(400, '请提供任务、操作记录及任务版本');
  }
  return change(next => {
    const results = entries.map(({taskId, entryId, revision}) =>
      applyHistoryReversal(next, taskId, entryId, revision, source));
    return { tasks:results.map(item => item.task), history:results.map(item => item.history) };
  });
}

function extractRefs(text) {
  return [...text.matchAll(/@([A-Z][A-Z0-9]*-\d+)(?![A-Za-z0-9_-])/g)].map(match => match[1]);
}

function detectImage(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'jpg';
  if (['GIF87a','GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  fail(400, '图片必须是 PNG、JPEG、GIF 或 WebP');
}

function prepareImage(entry) {
  if (!entry || typeof entry.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.data)) {
    fail(400, '图片数据无效');
  }
  const buffer = Buffer.from(entry.data, 'base64');
  if (!buffer.length || buffer.length > maxImage) fail(413, '每张图片最多 4 MB');
  const name = field(entry.name || '图片', '文件名', 180);
  const extension = detectImage(buffer);
  const asset = createHash('sha256').update(buffer).digest('hex') + '.' + extension;
  return { buffer, file: join(imageDir, asset), attachment: { name, url: '/images/' + asset } };
}

function addComment(id, input, source) {
  taskIn(board, id);
  const text = field(input.text ?? '', '评论', 8000);
  const author = field(input.author ?? '我', '署名', 60, true);
  const references = input.references ?? [];
  const images = input.images ?? [];
  if (!Array.isArray(references) || references.length > 30) fail(400, '最多引用 30 条任务');
  if (!Array.isArray(images) || images.length > 4) fail(400, '每条评论最多 4 张图片');
  const refs = [...new Set([...extractRefs(text), ...references])];
  if (refs.length > 30) fail(400, '最多引用 30 条任务');
  for (const ref of refs) taskIn(board, ref);
  if (!text && !images.length && !refs.length) fail(400, '请填写评论、引用任务或添加图片');
  const prepared = images.map(prepareImage);
  const comment = {
    id: randomUUID(), taskId: id, text, author, references: refs,
    images: prepared.map(image => image.attachment), created: new Date().toISOString(),
  };
  for (const image of prepared) {
    if (!existsSync(image.file)) writeFileSync(image.file, image.buffer, { flag: 'wx' });
  }
  return change(next => {
    next.comments.push(comment);
    recordHistory(next, taskIn(next, id), source, 'comment', {
      commentId: comment.id, author, excerpt: text.slice(0, 160),
      imageCount: comment.images.length, referenceCount: refs.length,
      effect: { type:'comment', id:comment.id, before:false, after:true },
    });
    return comment;
  });
}

function reviewDecision(reviewId, decision, source) {
  if (!['accepted', 'dismissed'].includes(decision)) fail(400, '无效的审阅操作');
  return change(next => {
    const review = next.reviews.find(item => item.id === reviewId);
    if (!review) fail(404, '找不到审阅建议');
    if (review.decision !== 'pending') fail(409, '该建议已处理');
    const task = taskIn(next, review.taskId);
    if (decision === 'accepted') {
      if (task.revision !== review.revision || task.stage !== review.before) {
        fail(409, '建议生成后任务已有改动，请核对当前任务');
      }
      const changes = applyTaskFields(task, {
        stage: review.after,
        evidence: [task.evidence, review.evidence].filter(Boolean).join('\n'),
      });
      recordHistory(next, task, source, 'review_accepted', { changes, reviewId,
        effect: { type:'review', id:reviewId, before:'reverted', after:'accepted' } });
    } else {
      recordHistory(next, task, source, 'review_dismissed', { reviewId });
    }
    review.decision = decision;
    return review;
  });
}

async function handle(req, res) {
  if (req.headers.host !== `127.0.0.1:${port}`) fail(403, '请使用本机地址 ' + origin);
  if (req.headers.origin && req.headers.origin !== origin && req.headers.origin !== publicOrigin?.origin) fail(403, '来源地址不匹配');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, origin);
  const path = url.pathname;
  const method = req.method;
  const asset = path.match(/^\/assets\/[a-zA-Z0-9_-]+\.(js|css|webp)$/);
  if (method === 'GET' && (path === '/' || asset)) {
    const file = path === '/' ? join(dist, 'index.html') : join(dist, path.slice(1));
    if (!existsSync(file)) fail(path === '/' ? 503 : 404, '请先运行 npm run build');
    const contentType = path === '/' ? 'text/html; charset=utf-8'
      : {css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',webp:'image/webp'}[asset[1]];
    if (path !== '/') res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(readFileSync(file));
    return;
  }
  const image = path.match(/^\/images\/([a-f0-9]{64}\.(png|jpg|gif|webp))$/);
  if (method === 'GET' && image) {
    const file = join(imageDir, image[1]);
    if (!existsSync(file)) fail(404, '图片不存在');
    res.writeHead(200, { 'Content-Type': imageTypes[image[2]] });
    res.end(readFileSync(file));
    return;
  }
  if (method === 'GET' && path === '/api/config') return json(res, { projects: PROJECTS, stages: STAGES, products: PRODUCTS });
  if (method === 'GET' && path === '/api/tasks') {
    const project = url.searchParams.get('project');
    const stage = url.searchParams.get('stage');
    const customer = url.searchParams.get('customer');
    const query = url.searchParams.get('q')?.toLowerCase();
    const archive = url.searchParams.get('archive') ?? 'active';
    if (!['active','archived','all'].includes(archive)) fail(400, '归档筛选必须为 active、archived 或 all');
    const tasks = board.tasks.filter(task => (archive === 'all' || Boolean(task.archivedAt) === (archive === 'archived'))
      && (!project || task.project === project)
      && (!stage || task.stage === stage) && (!customer || task.customer === customer)
      && (!query || [task.id, taskDisplay(task), task.project, task.customer, task.topic, task.description].join(' ').toLowerCase().includes(query)));
    return json(res, { tasks });
  }
  if (method === 'POST' && path === '/api/tasks/archive') {
    return json(res, setArchivedTasks(await readBody(req), sourceOf(req)));
  }
  if (method === 'POST' && path === '/api/tasks') {
    const fields = taskFields(await readBody(req));
    const task = change(next => {
      const id = 'TASK-' + String(next.nextTask++).padStart(3, '0');
      const item = { id, ...fields, updated: new Date().toISOString(), revision: 0 };
      next.tasks.push(item);
      recordHistory(next, item, sourceOf(req), 'created');
      return item;
    });
    return json(res, { task }, 201);
  }
  if (method === 'POST' && path === '/api/tasks/history/reverse') {
    return json(res, reverseTaskAction(await readBody(req), sourceOf(req)));
  }
  const undo = path.match(/^\/api\/tasks\/([A-Z][A-Z0-9]*-\d+)\/history\/([a-f0-9-]{36})\/undo$/);
  if (undo && method === 'POST') {
    const { revision } = await readBody(req);
    return json(res, change(next => applyHistoryReversal(next, undo[1], undo[2], revision, sourceOf(req))));
  }
  const target = path.match(/^\/api\/tasks\/([A-Z][A-Z0-9]*-\d+)(\/comments)?$/);
  if (target) {
    const [, id, comments] = target;
    if (!comments && method === 'GET') {
      const task = taskIn(board, id);
      const visibleComments = board.comments.filter(comment => !comment.withdrawn);
      return json(res, { task, history: taskHistory(board, task), comments: visibleComments.filter(comment => comment.taskId === id),
        mentions: visibleComments.filter(comment => comment.taskId !== id && comment.references.includes(id)).map(comment => ({
          taskId: comment.taskId, taskTitle: taskDisplay(taskIn(board, comment.taskId)), commentId: comment.id, created: comment.created,
        })) });
    }
    if (!comments && method === 'PATCH') {
      const input = await readBody(req);
      const result = change(next => {
        const task = taskIn(next, id);
        if (input.revision !== task.revision) fail(409, '任务有更新，请刷新后再修改');
        const changes = applyTaskFields(task, taskFields(input, task));
        const history = changes.length ? [recordHistory(next, task, sourceOf(req), 'updated', { changes })] : [];
        return { task, history };
      });
      return json(res, result);
    }
    if (comments && method === 'POST') return json(res, { comment: addComment(id, await readBody(req), sourceOf(req)) }, 201);
  }
  if (method === 'GET' && path === '/api/reviews') return json(res, { reviews: board.reviews });
  if (method === 'POST' && path === '/api/reviews') {
    const input = await readBody(req);
    const task = taskIn(board, input.taskId);
    const cause = field(input.cause, '建议说明', 3000, true);
    const evidence = field(input.evidence, '依据', 3000, true);
    if (!STAGES.includes(input.after) || input.after === task.stage) fail(400, '请选择不同的有效目标状态');
    const review = change(next => {
      const lastNumber = Math.max(0, ...next.reviews.map(item => Number(item.id.slice(3))));
      const item = { id: 'RV-' + String(lastNumber + 1).padStart(2, '0'), taskId: task.id,
        before: task.stage, after: input.after, cause, evidence, decision: 'pending', revision: task.revision };
      next.reviews.push(item);
      recordHistory(next, task, sourceOf(req), 'review_suggested', { reviewId: item.id });
      return item;
    });
    return json(res, { review }, 201);
  }
  if (method === 'PATCH' && /^\/api\/reviews\/RV-\d+$/.test(path)) {
    const { decision } = await readBody(req);
    return json(res, { review: reviewDecision(path.split('/').at(-1), decision, sourceOf(req)) });
  }
  fail(404, '找不到此地址');
}

createServer((req, res) => handle(req, res).catch(error => {
  if (!res.headersSent && !res.destroyed) json(res, { error: error.status ? error.message : '服务发生错误' }, error.status || 500);
  if (!error.status) console.error(error);
})).listen(port, '127.0.0.1', () => console.log('推进台 ' + origin));
