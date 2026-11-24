import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

let connection;
const usage = `推进台 CLI · 所有操作结果为 JSON

node board.mjs config
node board.mjs task list [--project 项目] [--customer 客户] [--stage 状态] [--q 关键词] [--archive active|archived|all]
node board.mjs task show <编号>
node board.mjs task archive <编号> [--revision 版本]
node board.mjs task restore <编号> [--revision 版本]
node board.mjs task add --title 名称 --project 项目 [--stage 待推进] [--description 说明]
node board.mjs task update <编号> [--title 名称] [--stage 状态] [--revision 版本]
node board.mjs task history <编号>
node board.mjs task undo <编号> <操作ID> --revision 版本
node board.mjs comment add <编号> [--text 评论] [--ref 其他任务编号] [--image 图片路径] [--author 署名]
node board.mjs review list
node board.mjs review suggest <编号> --stage 状态 --cause 理由 --evidence 依据

task add / update 也支持 --topic、--description、--evidence、--project、--customer、--product。
私有化部署任务需要 --product。新建时省略 --customer，或将客户清空，归到“自己”。--ref 和 --image 可重复。可用 @任务编号 在评论中插入引用。
本机默认连接 http://127.0.0.1:4389。设置 BOARD_PROFILE 指向私有连接配置文件可连接线上看板。
BOARD_URL 支持 HTTPS 或本机 HTTP。鉴权配置仅通过 HTTPS 发送。`;

async function loadConnection() {
  const profile = process.env.BOARD_PROFILE ? JSON.parse((await readFile(process.env.BOARD_PROFILE, 'utf8')).replace(/^\uFEFF/, '')) : {};
  const address = process.env.BOARD_URL || profile.url || 'http://127.0.0.1:4389';
  const base = new URL(address);
  if (base.href !== base.origin + '/' || (base.protocol !== 'https:' && (base.protocol !== 'http:' || base.hostname !== '127.0.0.1'))) {
    throw new Error('看板地址必须是无路径的 HTTPS 地址或本机 HTTP 地址');
  }
  const username = profile.username;
  const password = profile.password;
  if (username !== undefined || password !== undefined) {
    if (base.protocol !== 'https:' || !profile.url || new URL(profile.url).origin !== base.origin ||
      typeof username !== 'string' || !username || username.includes(':') || typeof password !== 'string' || !password) {
      throw new Error('线上连接配置须包含 HTTPS 地址、用户名和密码，且地址须与请求目标一致');
    }
    return {base, authorization:'Basic ' + Buffer.from(username + ':' + password,'utf8').toString('base64')};
  }
  return {base};
}

async function request(path, method = 'GET', payload) {
  connection ??= await loadConnection();
  const {base,authorization} = connection;
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers: { 'X-Board-Source': 'cli', ...(authorization ? { Authorization:authorization } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
  } catch {
    throw new Error('无法连接推进台，请检查服务地址、网络和 TLS 证书');
  }
  if (response.status === 401 || response.status === 403) throw new Error('当前连接未获此操作授权，HTTP ' + response.status);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('看板返回非 JSON 响应，HTTP ' + response.status);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}

const taskOptions = ['title','project','stage','description','topic','evidence','customer','product'];
const commands = new Map([
  ['config', [0, []]],
  ['task list', [0, ['project','customer','stage','q','archive']]],
  ['task show', [1, []]],
  ['task archive', [1, ['revision']]],
  ['task restore', [1, ['revision']]],
  ['task add', [0, taskOptions]],
  ['task update', [1, [...taskOptions, 'revision']]],
  ['task history', [1, []]],
  ['task undo', [2, ['revision']]],
  ['comment add', [1, ['text','ref','image','author']]],
  ['review list', [0, []]],
  ['review suggest', [1, ['stage','cause','evidence']]],
]);

async function taskRevision(path, specified) {
  if (specified === undefined) return (await request(path)).task.revision;
  if (!/^\d+$/.test(specified) || !Number.isSafeInteger(Number(specified))) throw new Error('--revision 必须是有效的非负整数');
  return Number(specified);
}

async function main(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return;
  }
  const key = args[0] === 'config' ? 'config' : args.slice(0, 2).join(' ');
  const specification = commands.get(key);
  if (!specification) throw new Error('未知命令。使用 --help 查看用法');
  const [positionalCount, flags] = specification;
  const { values, positionals } = parseArgs({
    args: args.slice(key === 'config' ? 1 : 2),
    options: Object.fromEntries(flags.map(flag => [flag, { type: 'string', multiple: ['ref','image'].includes(flag) }])),
    allowPositionals: true,
  });
  if (positionals.length !== positionalCount) throw new Error('任务编号参数不正确。使用 --help 查看用法');
  const [id] = positionals;
  if (id && !/^[A-Z][A-Z0-9]*-\d+$/.test(id)) throw new Error('任务编号格式不正确');
  const path = '/api/tasks' + (id ? '/' + id : '');
  let result;
  switch (key) {
    case 'config': result = await request('/api/config'); break;
    case 'task list': result = await request(path + '?' + new URLSearchParams(values)); break;
    case 'task show': result = await request(path); break;
    case 'task archive':
    case 'task restore': {
      const revision = await taskRevision(path, values.revision);
      const {tasks} = await request('/api/tasks/archive', 'POST', {
        archived: key === 'task archive', tasks:[{id,revision}],
      });
      result = {task:tasks[0]};
      break;
    }
    case 'task history': {
      const { task, history } = await request(path);
      result = { taskId:id, revision:task.revision, history };
      break;
    }
    case 'task undo': {
      const eventId = positionals[1];
      if (!/^[a-f0-9-]{36}$/.test(eventId)) throw new Error('操作 ID 格式不正确');
      if (values.revision === undefined || !/^\d+$/.test(values.revision)) throw new Error('请从 task history 取得版本，使用 --revision 指定');
      result = await request(path + '/history/' + eventId + '/undo', 'POST', { revision: Number(values.revision) });
      break;
    }
    case 'task add': result = await request(path, 'POST', values); break;
    case 'task update': {
      const { revision: specified, ...updates } = values;
      if (!Object.keys(updates).length) throw new Error('请指定要更新的字段');
      const revision = await taskRevision(path, specified);
      result = await request(path, 'PATCH', { ...updates, revision });
      break;
    }
    case 'comment add': {
      const files = values.image || [];
      if (files.length > 4) throw new Error('每条评论最多 4 张图片');
      const images = await Promise.all(files.map(async file => {
        const buffer = await readFile(file);
        if (buffer.length > 4 * 1024 * 1024) throw new Error('每张图片最多 4 MB');
        return { name: basename(file), data: buffer.toString('base64') };
      }));
      result = await request(path + '/comments', 'POST', { text:values.text, author:values.author, references:values.ref, images });
      break;
    }
    case 'review list': result = await request('/api/reviews'); break;
    case 'review suggest':
      result = await request('/api/reviews', 'POST', { taskId:id, after:values.stage, cause:values.cause, evidence:values.evidence });
      break;
  }
  console.log(JSON.stringify(result, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
