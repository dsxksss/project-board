import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as HoverCard from '@radix-ui/react-hover-card';
import {
  Archive, ArchiveRestore, ArrowLeft, AtSign, Building2, Check, ChevronRight, ClipboardList, Copy,
  FileText, History, ImagePlus, Inbox, Link2,
  Pencil, Plus, Redo2, RefreshCw, Trash2, Undo2, X,
} from 'lucide-react';
import { Button } from './arc/button/button';
import { Badge } from './arc/badge/badge';
import SegmentedControl from './arc/segmented-control/segmented-control';
import { MentionInput, serializeMentions } from './arc/mention-input/mention-input';
import { Alert } from './arc/alert/alert';
import { Card } from './arc/card/card';
import { CommentThread } from './arc/comment-thread/comment-thread';
import { Dialog, DialogContent } from './arc/dialog/dialog';
import { EmptyState } from './arc/empty-state/empty-state';
import { FileDropzone } from './arc/file-dropzone/file-dropzone';
import { Input } from './arc/input/input';
import { ScrollArea } from './arc/scroll-area/scroll-area';
import { Select } from './arc/select/select';
import { SortableDataTable } from './arc/sortable-data-table/sortable-data-table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './arc/tabs/tabs';
import { Textarea } from './arc/textarea/textarea';
import { Timeline } from './arc/timeline/timeline';
import Toast from './arc/toast/toast';
import './arc/foundation.css';
import './style.css';

const LANES = [
  { name:'待推进', stages:['待推进'], color:'slate' },
  { name:'进行中', stages:['进行中'], color:'blue' },
  { name:'待发布 / 部署', stages:['待发布','待部署'], color:'violet' },
  { name:'待测试', stages:['待验收','待核对'], color:'testing' },
  { name:'已完成', stages:['已完成'], color:'green' },
];
const PROJECT_COLORS = ['teal','sky','violet','amber','sky','orchid'];
const MODES = [{value:'list', label:'列表'}, {value:'board', label:'看板'}, {value:'archive', label:'已归档'}, {value:'trash', label:'回收站'}];
const REFRESH_STORAGE = 'project-board:auto-refresh';
const REFRESH_OPTIONS = [
  {value:'15', label:'每 15 秒'}, {value:'30', label:'每 30 秒'},
  {value:'60', label:'每 1 分钟'}, {value:'300', label:'每 5 分钟'}, {value:'0', label:'关闭'},
];
const refreshTime = new Intl.DateTimeFormat('zh-CN', {timeStyle:'medium', hour12:false});

function loadRefreshInterval() {
  try {
    const value = localStorage.getItem(REFRESH_STORAGE);
    if (REFRESH_OPTIONS.some(option => option.value === value)) return value;
  } catch {}
  return '30';
}
const ACTIVITY = [{value:'comments', label:'讨论'}, {value:'history', label:'操作历史'}];
const PRIVATE = '私有化部署';
const PERSONAL_CUSTOMER = {value:'自己', label:'私人'};
const customerValue = label => label === PERSONAL_CUSTOMER.label ? PERSONAL_CUSTOMER.value : label;
const customerLabel = value => value === PERSONAL_CUSTOMER.value ? PERSONAL_CUSTOMER.label : value;
const EMPTY_COMMENT = { text:'', mentions:[] };
const ALL = '__all__';
const asOptions = values => values.map(value => ({value,label:value}));
const withAll = (label, values) => [{value:ALL,label}, ...asOptions(values)];
const stageLabel = stage => stage === '待验收' ? '待测试' : stage;
const stageOptions = stages => stages.map(value => ({value,label:stageLabel(value)}));
const dateFormat = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', dateStyle:'medium', timeStyle:'short'});
const date = value => dateFormat.format(new Date(value));
const archiveDateFormat = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', dateStyle:'medium', timeStyle:'medium'});
function archiveDate(value) {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? '时间未知' : archiveDateFormat.format(at);
}
const taskHref = id => '#/task/' + id;
const reviewHref = '#/reviews';
const titleOf = task => task.product && !task.title.startsWith('[' + task.product + ']')
  ? '[' + task.product + '] ' + task.title : task.title;

function taskRowText(task) {
  return [titleOf(task), task.description || '', stageLabel(task.stage)].map(value =>
    /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value).join('\t');
}

async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {
    method, ...(body ? { headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function readRoute(hash, background = '#/') {
  const match = hash.match(/^#\/task\/([A-Z][A-Z0-9]*-\d+)(?:\/comment\/([a-f0-9-]+))?$/);
  const base = match ? background : hash;
  return { hash, taskId:match?.[1], commentId:match?.[2], base, reviews:base === reviewHref };
}

function useRoute() {
  const [route, setRoute] = useState(() => readRoute(location.hash));
  useEffect(() => {
    const update = () => {
      const hash = location.hash;
      setRoute(previous => readRoute(hash, previous.base));
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

function ProjectBadge({project, projects, label = project}) {
  const index = projects.findIndex(([name]) => name === project);
  return <Badge className="project-chip" color={PROJECT_COLORS[index]} dot size="sm">{label}</Badge>;
}

function StageBadge({stage}) {
  const label = stageLabel(stage);
  return <Badge className="task-stage-badge" data-stage={label} size="sm">{label}</Badge>;
}

function IconButton({className = '', ...props}) {
  return <Button type="button" size="sm" variant="ghost" className={'icon-button ' + className} {...props}/>;
}

function TaskPreview({task, projects}) {
  return <HoverCard.Portal>
    <HoverCard.Content className="task-hover-card" side="bottom" align="start" sideOffset={6} collisionPadding={12} hideWhenDetached>
      <div className="task-hover-heading">
        <span className="task-key">{task.id}</span>
        <StageBadge stage={task.stage}/>
      </div>
      <h3 className="task-hover-title">{titleOf(task)}</h3>
      <div className="task-hover-meta">
        <ProjectBadge project={task.project} projects={projects}/>
        {task.customer && <span>{customerLabel(task.customer)}</span>}
        {task.topic && <Badge size="sm">{task.topic}</Badge>}
        {task.archivedAt && <span>归档于 <time dateTime={task.archivedAt}>{archiveDate(task.archivedAt)}</time></span>}
      </div>
      <p className="task-hover-description">{task.description?.trim() || '暂无任务说明'}</p>
      {task.evidence?.trim() && <p className="task-hover-evidence"><strong>依据 </strong>{task.evidence.trim()}</p>}
    </HoverCard.Content>
  </HoverCard.Portal>;
}

function TaskInteractions({task, config, previewEnabled, onMove, onCopy, onCopyRow, onDeletion, onPurge, children}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const blockPreview = useRef(false);
  const fromStatus = event => event.target instanceof Element && Boolean(event.target.closest('.list-stage-select'));
  function enterTask(event) {
    blockPreview.current = fromStatus(event);
    if (blockPreview.current) event.preventDefault();
  }
  function closePreview() {
    blockPreview.current = true;
    setPreviewOpen(false);
  }
  return <HoverCard.Root open={previewEnabled && previewOpen && !menuOpen} openDelay={280} closeDelay={155}
    onOpenChange={open => setPreviewOpen(open && previewEnabled && !menuOpen && !blockPreview.current)}>
    <ContextMenu.Root onOpenChange={open => { setMenuOpen(open); if (open) closePreview(); }}>
      <ContextMenu.Trigger asChild>
        <HoverCard.Trigger asChild onPointerEnter={enterTask} onFocus={enterTask}
          onPointerOver={event => { if (fromStatus(event)) closePreview(); }}
          onPointerDown={closePreview} onDragStart={closePreview}>{children}</HoverCard.Trigger>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="task-context-menu" aria-label="任务操作" collisionPadding={8}>
          <ContextMenu.Item className="task-context-item" onSelect={() => { location.hash = taskHref(task.id); }}>
            <FileText aria-hidden="true"/>打开详情
          </ContextMenu.Item>
          {!task.archivedAt && !task.deletedAt && <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="task-context-item">
              <History aria-hidden="true"/>调整状态<ChevronRight className="task-context-chevron" aria-hidden="true"/>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="task-context-menu" aria-label="调整状态" sideOffset={4} collisionPadding={8}>
                <ContextMenu.RadioGroup value={task.stage} onValueChange={stage => onMove(task, stage)}>
                  {config.stages.map(stage => <ContextMenu.RadioItem className="task-context-item" key={stage} value={stage}>
                    <span className="task-context-check"><ContextMenu.ItemIndicator><Check aria-hidden="true"/></ContextMenu.ItemIndicator></span>
                    {stageLabel(stage)}
                  </ContextMenu.RadioItem>)}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>}
          <ContextMenu.Item className="task-context-item" onSelect={() => onCopyRow(task)}>
            <Copy aria-hidden="true"/>复制整行
          </ContextMenu.Item>
          <ContextMenu.Item className="task-context-item" onSelect={() => onCopy(task)}>
            <Link2 aria-hidden="true"/>复制任务链接
          </ContextMenu.Item>
          <ContextMenu.Separator className="task-context-separator"/>
          <ContextMenu.Item className="task-context-item" onSelect={() => onDeletion(task)}>
            {task.deletedAt ? <><ArchiveRestore aria-hidden="true"/>恢复任务</> : <><Trash2 aria-hidden="true"/>删除任务</>}
          </ContextMenu.Item>
          {task.deletedAt && <ContextMenu.Item className="task-context-item" onSelect={() => onPurge(task)}>
            <Trash2 aria-hidden="true"/>彻底删除
          </ContextMenu.Item>}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    <TaskPreview task={task} projects={config.projects}/>
  </HoverCard.Root>;
}

function TaskCard({task, config, lane, dragStart, dragEnd, wrapTask}) {
  return wrapTask(task, <a href={taskHref(task.id)} className="task-card" draggable
    onDragStart={event => dragStart(event, task)} onDragEnd={dragEnd}>
    <Card className="task-card-surface" title={titleOf(task)} leading={<>
      <div className="card-labels"><ProjectBadge project={task.project} projects={config.projects}/>
        {lane.stages.length > 1 && <StageBadge stage={task.stage}/>}</div>
    </>}>
      {task.customer && <div className="card-customer"><Building2/>{customerLabel(task.customer)}</div>}
      <div className="card-foot"><span className="task-key">{task.id}</span>{task.topic && <Badge size="sm">{task.topic}</Badge>}</div>
    </Card>
  </a>);
}

function Board({tasks, config, onNew, onMove, wrapTask}) {
  const [over, setOver] = useState('');
  const drag = useRef(null);
  return <ScrollArea label="任务看板" orientation="horizontal" viewportClassName="lane-scroll" wheelToHorizontal={false} fade={0}><div className="lanes">
    {LANES.map(lane => {
      const cards = tasks.filter(task => lane.stages.includes(task.stage));
      return <section key={lane.name} aria-label={lane.name} className={'lane' + (over === lane.name ? ' drop-target' : '')}
        onDragOver={event => { if (drag.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(lane.name); } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(''); }}
        onDrop={event => {
          event.preventDefault();
          const task = drag.current;
          drag.current = null;
          setOver('');
          if (task && !lane.stages.includes(task.stage)) onMove(task, lane.stages[0]);
        }}>
        <div className="lane-head"><span className={'stage-mark ' + lane.color}/><h2>{lane.name}</h2><span className="lane-count">{cards.length}</span></div>
        <div className="lane-cards">{cards.map(task =>
          <TaskCard key={task.id} task={task} config={config} lane={lane} wrapTask={wrapTask} dragStart={(event, item) => {
            drag.current = item;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
          }} dragEnd={() => { drag.current = null; setOver(''); }}/>)}
          <Button type="button" size="sm" variant="ghost" className="lane-add" onClick={() => onNew(lane.stages[0])}><Plus/>添加任务</Button>
        </div>
      </section>;
    })}
  </div></ScrollArea>;
}

function ListStageSelect({task, options, onMove}) {
  const [saving, setSaving] = useState(false);
  return <div className="compact-select list-stage-select">
    <Select className="list-stage-trigger" label={'调整状态：' + titleOf(task)} value={task.stage}
      options={options} disabled={saving} renderValue={stage => <StageBadge stage={stage}/>}
      onValueChange={async stage => {
        setSaving(true);
        try { await onMove(task,stage); }
        finally { setSaving(false); }
      }}/>
  </div>;
}

const LIST_COLUMNS = [
  {key:'rowNumber',label:'序号',width:52,sortable:false,render:(_, _task,index)=><span className="task-list-number">{index+1}</span>},
  {key:'title',label:'任务名称',width:'40%',render:(_,task)=><a className="table-task-link" href={taskHref(task.id)}>{titleOf(task)}</a>},
  {key:'description',label:'任务说明',width:'auto',sortable:false,render:description=>{
    const preview = description?.replace(/\s+/g,' ').trim();
    return preview ? <span className="task-list-description">{preview}</span> : <span className="task-list-number">—</span>;
  }},
  {key:'stage',label:'状态',width:108,render:stage=><StageBadge stage={stage}/>},
];

const LIST_SIZES = [
  {value:'compact', label:'紧凑显示'}, {value:'standard', label:'标准显示'}, {value:'large', label:'大字显示'},
];
const LIST_STORAGE = 'project-board:list-display';
const LIST_DEFAULTS = {size:'standard', titleWidth:40};
const MIN_TITLE_WIDTH = 18;
const MAX_TITLE_WIDTH = 59;

function titleWidth(value) {
  return Math.round(Math.min(MAX_TITLE_WIDTH, Math.max(MIN_TITLE_WIDTH, value)) * 10) / 10;
}

function loadListDisplay() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_STORAGE));
    return {
      size:LIST_SIZES.some(option => option.value === saved?.size) ? saved.size : LIST_DEFAULTS.size,
      titleWidth:Number.isFinite(saved?.titleWidth) ? titleWidth(saved.titleWidth) : LIST_DEFAULTS.titleWidth,
    };
  } catch { return LIST_DEFAULTS; }
}

function ColumnWidthHandle({value, onChange}) {
  const start = useRef(null);
  return <div role="separator" className="task-column-resize" tabIndex={0} aria-orientation="vertical"
    aria-label="调整任务名称与说明列宽" aria-valuemin={MIN_TITLE_WIDTH} aria-valuemax={MAX_TITLE_WIDTH}
    aria-valuenow={value} aria-valuetext={value + '%'} title="拖动调整列宽，双击恢复默认"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      const width = event.currentTarget.closest('table')?.getBoundingClientRect().width;
      if (!width) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({preventScroll:true});
      start.current = {pointer:event.pointerId, x:event.clientX, width, value};
      event.preventDefault();
    }}
    onPointerMove={event => {
      const drag = start.current;
      if (drag?.pointer === event.pointerId) onChange(titleWidth(drag.value + (event.clientX - drag.x) * 100 / drag.width));
    }}
    onLostPointerCapture={() => { start.current = null; }}
    onDoubleClick={() => onChange(LIST_DEFAULTS.titleWidth)}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      onChange(titleWidth(value + (event.key === 'ArrowRight' ? 2 : -2)));
    }}/>;
}

function ListGroup({name, items, config, collapsed, onToggle, columns, renderColumnControl, wrapTask, nested}) {
  const titleId = useId();
  const tableId = useId();
  const {project} = items[0];
  const projectColor = PROJECT_COLORS[config.projects.findIndex(([value])=>value===project)];
  const Heading = nested ? 'h3' : 'h2';
  function rowStyle(task) {
    if (!projectColor) return undefined;
    const shade = Array.from(task.topic || '').reduce((sum, character)=>(sum+character.codePointAt(0))%4,0);
    return {'--task-row-fill':`color-mix(in oklab, var(--tone-${projectColor}) ${19+shade*7}%, var(--surface))`};
  }
  return <section className="surface task-group" aria-labelledby={titleId}>
    <Heading id={titleId} className="task-group-heading">
      <Button variant="ghost" size="sm" type="button" className="task-group-toggle" aria-expanded={!collapsed}
        aria-controls={tableId} aria-label={name + '，' + items.length + ' 项任务'} onClick={onToggle}>
        <ChevronRight aria-hidden="true"/><ProjectBadge project={project} projects={config.projects} label={name}/>
      </Button>
      <span className="task-group-count" aria-hidden="true">{items.length} 项任务</span>
    </Heading>
    <div id={tableId} hidden={collapsed}>
      <SortableDataTable className="task-list-table" rows={items} columns={columns} rowKey="id" primaryColumn="title"
        renderColumnControl={renderColumnControl} getRowStyle={rowStyle} wrapRow={wrapTask} caption={name + '任务'} emptyMessage="暂无任务"/>
    </div>
  </section>;
}

function ArchiveBatch({timestamp, count, collapsed, onToggle, children}) {
  const headingId = useId();
  const bodyId = useId();
  const known = Number.isFinite(timestamp);
  return <section className="surface archive-batch" aria-labelledby={headingId}>
    <h2 id={headingId} className="task-group-heading archive-batch-heading">
      <Button variant="ghost" size="sm" type="button" className="task-group-toggle" aria-expanded={!collapsed}
        aria-controls={bodyId} onClick={onToggle}>
        <ChevronRight className="archive-batch-chevron" aria-hidden="true"/>
        <span>{known ? <>归档于 <time dateTime={new Date(timestamp).toISOString()}>{archiveDate(timestamp)}</time></> : '归档时间未知'}</span>
      </Button>
      <span className="task-group-count">{count} 项任务</span>
    </h2>
    <div id={bodyId} className="archive-batch-groups" hidden={collapsed}>{children}</div>
  </section>;
}

function List({tasks, config, collapsedGroups, toggleGroup, archived, trash, display, changeTitleWidth, onMove, wrapTask}) {
  const stages = useMemo(() => stageOptions(config.stages), [config.stages]);
  const columns = useMemo(() => LIST_COLUMNS.map(column => {
    if (column.key === 'title') return {...column,width:display.titleWidth + '%'};
    if (column.key === 'stage' && !archived && !trash) {
      return {...column,render:(_, task) => <ListStageSelect task={task} options={stages} onMove={onMove}/>};
    }
    return column;
  }), [display.titleWidth, archived, trash, stages, onMove]);
  function renderColumnControl(column) {
    return column.key === 'title' ? <ColumnWidthHandle value={display.titleWidth} onChange={changeTitleWidth}/> : null;
  }
  if (!tasks.length) return <Empty icon={trash ? Trash2 : archived ? Archive : ClipboardList}
    title={trash ? '没有符合条件的已删除任务' : archived ? '没有符合条件的归档任务' : '没有符合条件的任务'}/>;
  const order = new Map(config.projects.map(([name], index) => [name, index]));
  function renderProjects(items, batchKey = '') {
    const groups = Map.groupBy(items, task => task.customer ? PRIVATE + ' · ' + customerLabel(task.customer) : task.project);
    return [...groups].sort(([a,left],[b,right]) =>
      order.get(left[0].project) - order.get(right[0].project) || a.localeCompare(b, 'zh-CN', {numeric:true}))
      .map(([name, groupTasks]) => {
        const key = batchKey ? batchKey + '/' + name : name;
        return <ListGroup key={key} name={name} items={groupTasks} config={config} columns={columns} renderColumnControl={renderColumnControl}
          collapsed={collapsedGroups.has(key)} onToggle={() => toggleGroup(key)} wrapTask={wrapTask} nested={Boolean(batchKey)}/>;
      });
  }
  const batches = archived ? [...Map.groupBy(tasks, task => Date.parse(task.archivedAt))] : [];
  const sortTime = timestamp => Number.isFinite(timestamp) ? timestamp : -Infinity;
  batches.sort(([a], [b]) => sortTime(b) - sortTime(a));
  return <div className="task-list" data-list-size={display.size}>{archived
    ? batches.map(([timestamp, items]) => {
      const key = 'archive:' + timestamp;
      return <ArchiveBatch key={key} timestamp={timestamp} count={items.length}
        collapsed={collapsedGroups.has(key)} onToggle={() => toggleGroup(key)}>{renderProjects(items, key)}</ArchiveBatch>;
    })
    : renderProjects(tasks)}</div>;
}

function Empty({icon:Icon, title, children}) {
  return <EmptyState icon={<Icon/>} title={title} description={typeof children === 'string' ? children : ''}
    action={typeof children !== 'string' ? children : undefined}/>;
}

function Modal({children, label, titleContent, onClose, className = '', overlayClassName, fallbackFocus, onOpenAutoFocus}) {
  const trigger = useRef(document.activeElement);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent title={label} titleContent={titleContent} aria-describedby={undefined} className={'app-dialog ' + className} overlayClassName={overlayClassName}
      onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={event => {
        const opener = trigger.current;
        const target = opener instanceof HTMLElement && opener !== document.body && opener.isConnected ? opener : fallbackFocus?.();
        if (target) { event.preventDefault(); target.focus({preventScroll:true}); }
      }}>{children}</DialogContent>
  </Dialog>;
}

function taskFormFields(form) {
  const fields = Object.fromEntries(new FormData(form));
  if (fields.customer) fields.customer = customerValue(fields.customer.trim());
  return fields;
}

function CustomerInput({customer, customers, ...inputProps}) {
  const list = useId();
  return <div>
    <Input {...inputProps} label="客户" name="customer" list={list} placeholder="留空则归到私人" maxLength={60} defaultValue={customerLabel(customer)}/>
    <datalist id={list}>{customers.map(value => <option key={value} value={customerLabel(value)}/>)}</datalist>
  </div>;
}

function TaskForm({task, config, customers, onClose, onSaved}) {
  const [project, setProject] = useState(task.project || config.projects[0][0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const {task:created} = await api('/tasks', 'POST', taskFormFields(event.currentTarget));
      onSaved(created);
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal label="新建任务" onClose={() => { if (!busy) onClose(); }}>
    <form className="task-form" onSubmit={save}>
      <Input label="任务名称" autoFocus required name="title" maxLength={160} defaultValue={task.title}/>
      <div className="form-columns">
        <Select label="项目" name="project" value={project} options={asOptions(config.projects.map(([name])=>name))} onValueChange={setProject}/>
        <Select label="状态" name="stage" defaultValue={task.stage || '待推进'} options={stageOptions(config.stages)}/>
      </div>
      {project === PRIVATE && <div className="form-columns">
        <CustomerInput customer={task.customer} customers={customers}/>
        <Select label="产品" name="product" defaultValue={task.product || config.products[0]} options={asOptions(config.products)}/>
      </div>}
      <Input label="标签" name="topic" maxLength={32} defaultValue={task.topic}/>
      <Textarea label="任务说明" name="description" rows={4} maxLength={12000} defaultValue={task.description}/>
      <Textarea label="依据" name="evidence" rows={2} maxLength={6000} defaultValue={task.evidence}/>
      {error && <Alert tone="danger" title={error}/>}
      <div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" loading={busy}>创建任务</Button></div>
    </form>
  </Modal>;
}

function Reviews({reviews, tasks, onDecision}) {
  const [busy, setBusy] = useState('');
  return <>
    <a href="#/" className="back-link"><ArrowLeft/>返回任务总览</a>
    <div className="review-page-head"><h1>审阅收件箱</h1></div>
    {!reviews.length && <Empty icon={Inbox} title="暂无审阅建议"/>}
    <div className="review-list">{reviews.map(review => {
      const task = tasks.find(item => item.id === review.taskId);
      const stale = task?.revision !== review.revision || task?.stage !== review.before;
      return <article className="surface review" key={review.id}>
        <div className="review-head"><div className="review-icon"><Inbox/></div><div><span className="task-key">{review.id} · {review.taskId}</span><h2><a href={taskHref(review.taskId)}>{task ? titleOf(task) : review.taskId}</a></h2></div>
          <Badge tone={review.decision === 'accepted' ? 'success' : 'neutral'}>{({pending:stale ? '建议已过时' : '待审阅', accepted:'已采纳', dismissed:'已忽略', reverted:'已撤销采纳'})[review.decision]}</Badge>
        </div>
        <div className="review-stages"><StageBadge stage={review.before}/><ChevronRight/><StageBadge stage={review.after}/></div>
        <p className="prose">{review.cause}</p><div className="evidence"><FileText/><span>{review.evidence}</span></div>
        {review.decision === 'pending' && <div className="review-actions">
          <Button variant="secondary" type="button" disabled={!!busy} onClick={async () => { setBusy(review.id); await onDecision(review.id,'dismissed'); setBusy(''); }}>忽略</Button>
          <Button type="button" disabled={stale || !!busy} onClick={async () => { setBusy(review.id); await onDecision(review.id,'accepted'); setBusy(''); }}>采纳建议</Button>
        </div>}
      </article>;
    })}</div>
  </>;
}

function App() {
  const route = useRoute();
  const [config, setConfig] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState({project:'', customer:''});
  const [stage, setStage] = useState('');
  const [mode, setMode] = useState('list');
  const [listDisplay, setListDisplay] = useState(loadListDisplay);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [form, setForm] = useState(null);
  const [copyFallback, setCopyFallback] = useState(null);
  const copyInput = useRef(null);
  const [boardHistory, setBoardHistory] = useState({undo:[], redo:[]});
  const historyActivity = useRef({writes:0, reversing:false});
  const [historyBusy, setHistoryBusy] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const editFormId = useId();
  const [archiveSelection, setArchiveSelection] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(loadRefreshInterval);
  const [sync, setSync] = useState({at:0, failed:false});
  const refreshVersion = useRef(0);
  const refreshRequests = useRef(0);
  const detailRequest = useRef(0);
  const [toast, setToast] = useState('');
  const toastTimer = useRef();
  function notify(message) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    refreshRequests.current++;
    try {
      const [list, audit] = await Promise.all([api('/tasks?archive=all&deleted=all'), api('/reviews')]);
      if (version !== refreshVersion.current) return;
      setTasks(list.tasks);
      setReviews(audit.reviews);
      setSync({at:Date.now(), failed:false});
    } catch (failure) {
      if (version !== refreshVersion.current) return;
      setSync(previous => ({...previous, failed:true}));
      throw failure;
    } finally {
      refreshRequests.current--;
    }
  }, []);
  async function refreshDetail(id) {
    const request = location.hash.split('/')[2] === id ? ++detailRequest.current : null;
    const current = await api('/tasks/' + id);
    if (request === detailRequest.current && location.hash.split('/')[2] === id) setDetail(current);
    return current;
  }
  async function start() {
    setError('');
    try { const choices = await api('/config'); await refresh(); setConfig(choices); }
    catch (failure) { setError(failure.message || '连接失败'); }
  }
  useEffect(() => { start(); }, []);
  useEffect(() => {
    try { localStorage.setItem(REFRESH_STORAGE, refreshInterval); } catch {}
  }, [refreshInterval]);
  const refreshPaused = Boolean(route.taskId || form || archiveSelection || deleteTarget || copyFallback);
  useEffect(() => {
    if (!config || refreshPaused || refreshInterval === '0') return;
    const tick = () => {
      if (!document.hidden && !historyActivity.current.writes && !refreshRequests.current) refresh().catch(() => {});
    };
    const interval = setInterval(tick, Number(refreshInterval) * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [config, refreshInterval, refreshPaused, refresh]);
  useEffect(() => {
    try { localStorage.setItem(LIST_STORAGE, JSON.stringify(listDisplay)); } catch {}
  }, [listDisplay]);
  useEffect(() => {
    if (!config || route.taskId) return;
    refresh().catch(failure => notify(failure.message));
  }, [route.hash]);
  useEffect(() => {
    setEditSession(current => current?.task.id === route.taskId ? current : null);
    if (!route.taskId) return;
    let current = true;
    const request = ++detailRequest.current;
    setDetailError(null);
    api('/tasks/' + route.taskId).then(result => {
      if (current && request === detailRequest.current) setDetail(result);
    }).catch(failure => {
      if (current && request === detailRequest.current) setDetailError({id:route.taskId,message:failure.message});
    });
    return () => { current = false; };
  }, [route.taskId]);
  const customers = useMemo(() => {
    const names = new Set(tasks.map(task => customerValue(task.customer)).filter(Boolean));
    names.delete(PERSONAL_CUSTOMER.value);
    return [PERSONAL_CUSTOMER.value, ...[...names].sort()];
  }, [tasks]);
  const archiveView = mode === 'archive';
  const trashView = mode === 'trash';
  const inactiveView = archiveView || trashView;
  const visible = tasks.filter(task => (trashView ? Boolean(task.deletedAt) : !task.deletedAt && Boolean(task.archivedAt) === archiveView)
    && (!scope.project || task.project === scope.project) && (!scope.customer || customerValue(task.customer) === scope.customer)
    && (inactiveView || !stage || task.stage === stage));
  const completed = inactiveView ? [] : visible.filter(task => task.stage === '已完成');

  async function withHistoryWrite(operation, reversing = false) {
    const activity = historyActivity.current;
    if (activity.reversing || (reversing && activity.writes)) throw new Error('正在保存，请稍后重试');
    refreshVersion.current++;
    activity.writes++;
    activity.reversing = reversing;
    setHistoryBusy(true);
    try { return await operation(); }
    finally {
      refreshVersion.current++;
      activity.writes--;
      activity.reversing = false;
      setHistoryBusy(activity.writes > 0);
    }
  }

  async function recordBoardWrite(path, method, body) {
    return withHistoryWrite(async () => {
      const result = await api(path, method, body);
      if (result.history.length) setBoardHistory(previous => ({undo:[...previous.undo, result.history], redo:[]}));
      return result;
    });
  }

  async function reverseBoardAction(direction) {
    const action = boardHistory[direction].at(-1);
    if (!action) return;
    const other = direction === 'undo' ? 'redo' : 'undo';
    const label = direction === 'undo' ? '撤销' : '重做';
    try {
      await withHistoryWrite(async () => {
        const revisions = new Map(tasks.map(task => [task.id, task.revision]));
        const entries = action.map(entry => ({taskId:entry.taskId, entryId:entry.id, revision:revisions.get(entry.taskId)}));
        const {tasks:updated, history} = await api('/tasks/history/reverse', 'POST', {entries});
        const byId = new Map(updated.map(task => [task.id, task]));
        setTasks(previous => previous.map(task => byId.get(task.id) || task));
        setBoardHistory(previous => ({
          [direction]:previous[direction].slice(0, -1),
          [other]:[...previous[other], history],
        }));
        notify('已' + label);
      }, true);
    } catch (failure) {
      notify(failure.message);
      refresh().catch(() => {});
    }
  }

  async function reverseTaskHistory(entry, revision) {
    return withHistoryWrite(async () => {
      const id = entry.taskId;
      const label = canRedo(entry) ? '重做' : '撤销';
      let updated;
      try {
        const result = await api('/tasks/' + id + '/history/' + entry.id + '/undo', 'POST', {revision});
        updated = result.task;
      } catch (failure) {
        refreshDetail(id).catch(() => {});
        throw failure;
      }
      setTasks(previous => previous.map(task => task.id === id ? updated : task));
      const unrelated = action => action.every(item => item.taskId !== id);
      setBoardHistory(previous => ({undo:previous.undo.filter(unrelated), redo:previous.redo.filter(unrelated)}));
      try { await Promise.all([refresh(), refreshDetail(id)]); }
      catch (failure) { notify(label + '已保存，回读失败：' + failure.message); return; }
      notify('已' + label);
    }, true);
  }

  async function removeComment(taskId, commentId) {
    await withHistoryWrite(async () => {
      await api('/tasks/' + taskId + '/comments/' + commentId, 'DELETE');
      setDetail(previous => previous?.task.id === taskId ? {
        ...previous, comments:previous.comments.filter(item => item.id !== commentId),
      } : previous);
      try { await refreshDetail(taskId); }
      catch (failure) { notify('评论已删除，历史刷新失败：' + failure.message); return; }
      notify('评论已删除');
    }, true);
  }

  async function changeArchive(selection, archived) {
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      const {tasks:updated} = await recordBoardWrite('/tasks/archive', 'POST', {
        archived, tasks:selection.map(({id,revision}) => ({id,revision})),
      });
      const byId = new Map(updated.map(task => [task.id,task]));
      setTasks(previous => previous.map(task => byId.get(task.id) || task));
      setDetail(previous => {
        const task = byId.get(previous?.task?.id);
        return task ? {...previous, task} : previous;
      });
      if (route.taskId) await refreshDetail(route.taskId);
      notify((archived ? '已归档 ' : '已恢复 ') + updated.length + ' 条任务');
    } catch (failure) {
      notify(failure.message);
      refresh().catch(() => {});
      if (route.taskId) refreshDetail(route.taskId).catch(() => {});
    } finally {
      setArchiveBusy(false);
      setArchiveSelection(null);
    }
  }
  async function changeDeletion(task) {
    if (deletionBusy) return;
    const deleted = !task.deletedAt;
    setDeletionBusy(true);
    try {
      await withHistoryWrite(async () => {
        const {task:updated, history} = await api('/tasks/' + task.id + '/deletion', 'POST', {
          deleted, revision:task.revision,
        });
        if (history.length) setBoardHistory(previous => ({undo:[...previous.undo, history], redo:[]}));
        setTasks(previous => previous.map(item => item.id === updated.id ? updated : item));
        setDetail(previous => previous?.task?.id === updated.id ? {...previous, task:updated} : previous);
      }, true);
      setDeleteTarget(null);
      notify(deleted ? '任务已移入回收站' : '任务已恢复');
      if (route.taskId === task.id) refreshDetail(task.id).catch(failure => notify(failure.message));
      refresh().catch(() => {});
    } catch (failure) {
      setDeleteTarget(null);
      notify(failure.message);
      refresh().catch(() => {});
      if (route.taskId === task.id) refreshDetail(task.id).catch(() => {});
    } finally {
      setDeletionBusy(false);
    }
  }

  async function purgeTask(task) {
    if (deletionBusy) return;
    setDeletionBusy(true);
    try {
      const {imageCleanupPending} = await withHistoryWrite(async () => {
        const result = await api('/tasks/' + task.id, 'DELETE', {revision:task.revision});
        setTasks(previous => previous.filter(item => item.id !== task.id));
        setDetail(previous => previous?.task?.id === task.id ? null : previous);
        const removeEntries = actions => actions.map(action => action.filter(entry => entry.taskId !== task.id)).filter(action => action.length);
        setBoardHistory(previous => ({undo:removeEntries(previous.undo),redo:removeEntries(previous.redo)}));
        return result;
      }, true);
      if (location.hash.split('/')[2] === task.id) closeDetail();
      notify(imageCleanupPending ? '任务已彻底删除，部分图片文件需要清理' : '任务已彻底删除');
      refresh().catch(() => {});
    } catch (failure) {
      notify(failure.message);
      refresh().catch(() => {});
      if (route.taskId === task.id) refreshDetail(task.id).catch(() => {});
    } finally {
      setDeleteTarget(null);
      setDeletionBusy(false);
    }
  }

  function requestDeletion(task) {
    if (historyActivity.current.writes) return;
    if (task.deletedAt) changeDeletion(task);
    else setDeleteTarget(task);
  }

  async function moveTask(task, nextStage) {
    if (task.stage === nextStage) return;
    try {
      const { task:updated } = await recordBoardWrite('/tasks/' + task.id, 'PATCH', { stage:nextStage, revision:task.revision });
      setTasks(previous => previous.map(item => item.id === updated.id ? updated : item));
      setDetail(previous => previous?.task?.id === updated.id ? {...previous,task:updated} : previous);
      if (route.taskId === updated.id) await refreshDetail(updated.id);
      notify('已更新为' + stageLabel(nextStage));
    } catch (failure) {
      notify(failure.message);
      refresh().catch(() => {});
      if (route.taskId === task.id) refreshDetail(task.id).catch(() => {});
    }
  }
  async function copyTaskText(value, label, multiline = false) {
    try {
      await navigator.clipboard.writeText(value);
      notify(label + '已复制');
    } catch {
      setCopyFallback({value,label,multiline});
    }
  }
  function wrapTask(task, trigger) {
    return <TaskInteractions key={task.id} task={task} config={config} onMove={moveTask} onDeletion={requestDeletion} onPurge={setDeleteTarget}
      previewEnabled={!refreshPaused}
      onCopy={item => copyTaskText(new URL(taskHref(item.id), location.href).href, '任务链接')}
      onCopyRow={item => copyTaskText(taskRowText(item), '整行内容', true)}>
      {trigger}
    </TaskInteractions>;
  }
  function newTask(defaultStage = '待推进') {
    setForm({ project:scope.project, customer:scope.customer, stage:defaultStage });
  }
  const activeDetail = route.taskId && detail?.task?.id === route.taskId ? detail : null;
  const editing = editSession?.task.id === route.taskId ? editSession : null;

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing || editing.busy) return;
    const {task} = editing;
    const fields = taskFormFields(event.currentTarget);
    setEditSession({...editing, busy:true, error:''});
    try {
      const {task:updated} = await recordBoardWrite('/tasks/' + task.id, 'PATCH', {...fields, revision:task.revision});
      setTasks(previous => previous.map(item => item.id === task.id ? updated : item));
      setDetail(previous => previous?.task?.id === task.id ? {...previous,task:updated} : previous);
      setEditSession(current => current?.task === task ? null : current);
      notify('修改已保存');
      refreshDetail(task.id).catch(failure => notify('修改已保存，回读失败：' + failure.message));
    } catch (failure) {
      setEditSession(current => current?.task === task ? {...current,busy:false,error:failure.message} : current);
      refreshDetail(task.id).catch(() => {});
    }
  }

  function closeDetail() {
    if (editing) {
      if (!editing.busy) setEditSession(null);
      return;
    }
    location.replace(route.base || '#/');
  }

  const taskError = detailError?.id === route.taskId ? detailError?.message : '';
  return <>
    <main className="content" aria-label="任务工作区">
        {!config ? (error ? <Empty icon={Inbox} title="工作区加载失败">{error}<br/><Button onClick={start}>重试</Button></Empty> : <p className="loading">正在加载工作区…</p>)
        : route.reviews ? <Reviews reviews={reviews} tasks={tasks} onDecision={async (id, decision) => {
          try {
            await withHistoryWrite(() => api('/reviews/' + id, 'PATCH', {decision}));
            await refresh();
            notify(decision === 'accepted' ? '已采纳建议' : '已忽略建议');
          }
          catch (failure) { notify(failure.message); }
        }}/>
        : <>
          <div className="board-toolbar" role="group" aria-label="任务筛选与视图">
            <SegmentedControl label="展示方式" value={mode} options={MODES} onValueChange={setMode}/>
            <div className="toolbar-divider"/>
            <div className="board-history-controls" role="group" aria-label="本页任务修改">
              <Button variant="secondary" size="sm" type="button" disabled={historyBusy || !boardHistory.undo.length}
                title="撤销本页上一次任务修改" onClick={() => reverseBoardAction('undo')}><Undo2/>撤销</Button>
              <Button variant="secondary" size="sm" type="button" disabled={historyBusy || !boardHistory.redo.length}
                title="重做本页刚撤销的修改" onClick={() => reverseBoardAction('redo')}><Redo2/>重做</Button>
            </div>
            <div className="compact-select"><Select label="项目筛选" value={scope.project || ALL} options={withAll('全部项目',config.projects.map(([name])=>name))}
              onValueChange={value => setScope({project:value === ALL ? '' : value, customer:''})}/></div>
            <div className="compact-select"><Select label="客户筛选" value={scope.customer || ALL} options={[{value:ALL,label:'全部客户'}, ...customers.map(value => ({value,label:customerLabel(value)}))]}
              onValueChange={value => setScope({project:value === ALL ? scope.project : PRIVATE, customer:value === ALL ? '' : value})}/></div>
            {!inactiveView && <div className="compact-select stage-filter"><Select label="状态筛选" value={stage || ALL} options={[{value:ALL,label:'全部状态'}, ...stageOptions(config.stages)]}
              onValueChange={value => setStage(value === ALL ? '' : value)}/></div>}
            {completed.length > 0 && <Button variant="secondary" size="sm" type="button" className="archive-action"
              onClick={() => setArchiveSelection(completed)} disabled={archiveBusy}><Archive/>归档已完成</Button>}
            {mode !== 'board' && <>
              <div className={'compact-select' + (inactiveView ? ' stage-filter' : '')}>
                <Select label="列表显示大小" value={listDisplay.size} options={LIST_SIZES}
                  onValueChange={size => setListDisplay(previous => ({...previous,size}))}/>
              </div>
              {(listDisplay.size !== LIST_DEFAULTS.size || listDisplay.titleWidth !== LIST_DEFAULTS.titleWidth) &&
                <Button variant="ghost" size="sm" className="list-display-reset" type="button" onClick={() => setListDisplay(LIST_DEFAULTS)}>重置显示</Button>}
            </>}
            <div className="refresh-controls" role="group" aria-label="数据刷新">
              <Button variant="secondary" size="sm" type="button" disabled={historyBusy}
                onClick={() => refresh().catch(failure => notify(failure.message))}><RefreshCw/>刷新</Button>
              <div className="compact-select">
                <Select label="自动刷新" value={refreshInterval} options={REFRESH_OPTIONS}
                  renderValue={label => '自动刷新 · ' + label} onValueChange={setRefreshInterval}/>
              </div>
              <span className="refresh-status">{sync.failed ? '刷新失败' : sync.at > 0 ? '更新于 ' + refreshTime.format(sync.at) : ''}</span>
            </div>
            <span className="result-count">{visible.length} 项任务{trashView && ' · 不自动清理'}</span>
          </div>
          {mode === 'board' ? <Board tasks={visible} config={config} onNew={newTask} onMove={moveTask} wrapTask={wrapTask}/> :
            <List tasks={visible} config={config} archived={archiveView} trash={trashView} display={listDisplay} onMove={moveTask} wrapTask={wrapTask}
              changeTitleWidth={titleWidth => setListDisplay(previous => previous.titleWidth === titleWidth ? previous : {...previous,titleWidth})}
              collapsedGroups={collapsedGroups} toggleGroup={name=>setCollapsedGroups(previous=>{
              const next = new Set(previous);
              if (next.has(name)) next.delete(name); else next.add(name);
              return next;
            })}/>}
        </>}
    </main>
    {route.taskId && <Modal label={activeDetail ? titleOf(activeDetail.task) : '任务详情'}
      titleContent={editing && <Input form={editFormId} label="任务名称" name="title" autoFocus required maxLength={160}
        disabled={editing.busy} defaultValue={editing.task.title}/>}
      className="task-detail-dialog" overlayClassName="task-detail-overlay"
      fallbackFocus={() => document.querySelector('main .board-toolbar [role="radio"][aria-checked="true"], main .back-link')}
      onClose={closeDetail}>
      {taskError || error ? <Alert tone="danger" title={taskError || error}/>
        : activeDetail && config ? <TaskDetail key={route.taskId} detail={activeDetail} route={route} tasks={tasks} config={config}
          edit={() => setEditSession({task:activeDetail.task,project:activeDetail.task.project,busy:false,error:''})}
          editor={editing && {...editing, form:editFormId, submit:saveEdit, cancel:closeDetail,
            changeProject:project => setEditSession(current => ({...current,project}))}}
          customers={customers} move={moveTask} notify={notify}
          onArchive={archived => changeArchive([activeDetail.task], archived)} archiveBusy={archiveBusy}
          onDeletion={() => requestDeletion(activeDetail.task)} onPurge={() => setDeleteTarget(activeDetail.task)}
          deletionBusy={deletionBusy} onComment={comment => {
            setDetail(previous => previous?.task?.id === comment.taskId ? {...previous,comments:[...previous.comments,comment]} : previous);
            refreshDetail(comment.taskId).catch(failure => notify(failure.message));
          }} onRemoveComment={removeComment} onUndo={reverseTaskHistory} historyBusy={historyBusy}/> : <p className="loading" role="status">正在加载任务…</p>}
    </Modal>}
    {form && config && <TaskForm task={form} config={config} customers={customers} onClose={() => setForm(null)} onSaved={item => {
      refreshVersion.current++;
      setForm(null);
      setTasks(previous => [...previous,item]);
      setDetail({task:item,history:[],comments:[],mentions:[]});
      location.hash = taskHref(item.id);
      notify('任务已创建');
    }}/>}
    {copyFallback && <Modal label={'复制' + copyFallback.label} onClose={() => setCopyFallback(null)}
      onOpenAutoFocus={event => {
        event.preventDefault();
        copyInput.current?.focus();
        copyInput.current?.select();
      }}>
      {copyFallback.multiline
        ? <Textarea ref={copyInput} label={copyFallback.label} value={copyFallback.value} readOnly rows={5}/>
        : <Input ref={copyInput} label={copyFallback.label} value={copyFallback.value} readOnly/>}
    </Modal>}
    {archiveSelection && <Modal label="归档已完成任务" onClose={() => { if (!archiveBusy) setArchiveSelection(null); }}>
      <p className="history-confirm-text">将归档当前筛选中的 {archiveSelection.length} 条已完成任务。可在「已归档」中查看和恢复。</p>
      <div className="modal-actions">
        <Button type="button" variant="secondary" disabled={archiveBusy} onClick={() => setArchiveSelection(null)}>取消</Button>
        <Button type="button" loading={archiveBusy} onClick={() => changeArchive(archiveSelection,true)}>确认归档</Button>
      </div>
    </Modal>}
    {deleteTarget && <Modal label={deleteTarget.deletedAt ? '彻底删除任务' : '删除任务'}
      onClose={() => { if (!deletionBusy) setDeleteTarget(null); }}>
      <p className="history-confirm-text">{deleteTarget.deletedAt
        ? '将永久删除「' + titleOf(deleteTarget) + '」及其评论和操作历史。此操作无法撤销。'
        : '将「' + titleOf(deleteTarget) + '」移入回收站。任务及其评论和操作记录可恢复。'}</p>
      <div className="modal-actions">
        <Button type="button" variant="secondary" disabled={deletionBusy} onClick={() => setDeleteTarget(null)}>取消</Button>
        <Button type="button" variant="danger" loading={deletionBusy}
          onClick={() => deleteTarget.deletedAt ? purgeTask(deleteTarget) : changeDeletion(deleteTarget)}>
          {deleteTarget.deletedAt ? '确认彻底删除' : '确认删除'}
        </Button>
      </div>
    </Modal>}
    <div className="toast-region">{toast && <Toast title={toast} duration={0}/>}</div>
  </>;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.onload = () => resolve({ name:file.name || '粘贴图片.png', preview:String(reader.result), data:String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}

function CommentComposer({task, tasks, onComment, notify}) {
  const [draft, setDraft] = useState(EMPTY_COMMENT);
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null);
  const mention = useRef(null);
  const people = useMemo(() => tasks.filter(item => item.id !== task.id).map(item => ({
    id:item.id, name:titleOf(item), role:item.id + ' · ' + item.project,
  })), [tasks,task.id]);
  const allowed = ['image/png','image/jpeg','image/gif','image/webp'];
  async function insertFiles(files) {
    if (busy || reading) return;
    setError('');
    if (files.length + images.length > 4) { setError('每条评论最多 4 张图片'); return; }
    if (files.some(input => !allowed.includes(input.type) || input.size > 4 * 1024 * 1024)) {
      setError('请选择 4 MB 以内的 PNG、JPEG、GIF 或 WebP 图片'); return;
    }
    setReading(true);
    try { const next = await Promise.all(files.map(readImage)); setImages(previous => [...previous,...next]); }
    catch (failure) { setError(failure.message); }
    finally { setReading(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || reading || (!draft.text.trim() && !images.length)) return;
    setError('');
    setBusy(true);
    try {
      const text = serializeMentions(draft, item => '@' + item.id);
      const { comment } = await api('/tasks/' + task.id + '/comments', 'POST', {
        text, images:images.map(({name,data}) => ({name,data})),
      });
      setDraft(EMPTY_COMMENT); setImages([]); onComment(comment); notify('评论已发送');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="composer" onSubmit={submit} onPaste={event => {
      const pasted = [...event.clipboardData.files].filter(item => item.type.startsWith('image/'));
      if (pasted.length) { event.preventDefault(); insertFiles(pasted); }
    }}>
    <MentionInput ref={mention} value={draft} onChange={setDraft} people={people} placement="auto" minRows={3} maxRows={9}
      className="mention-input" aria-label="写评论" placeholder="写评论，输入 @ 引用任务，也可以粘贴图片…"
      disabled={busy}/>
    {!!images.length && <div className="draft-images">{images.map((image, index) => <div key={image.name + index}>
      <img src={image.preview} alt={image.name}/><IconButton className="remove-photo" aria-label={'移除 ' + image.name}
        onClick={() => setImages(previous => previous.filter((_, i) => i !== index))} disabled={busy}><X/></IconButton>
    </div>)}</div>}
    {error && <Alert tone="danger" title={error}/>}
    <div className="composer-tools">
      <IconButton aria-label="引用任务" title="引用任务" disabled={busy || !people.length}
        onClick={() => mention.current?.openSuggestions('person')}><AtSign/></IconButton>
      <IconButton aria-label="添加图片" title="添加图片" disabled={busy || reading || images.length >= 4}
        onClick={() => setPicker([])}><ImagePlus/></IconButton>
      <Button className="send" type="submit" size="sm" loading={busy}
        disabled={reading || (!draft.text.trim() && !images.length)}>发送评论</Button>
    </div>
    {picker && <Modal label="添加图片" onClose={() => setPicker(null)}>
      <FileDropzone accept={allowed.join(',')} maxFiles={4-images.length} maxSize={4*1024*1024}
        label="选择图片" description="拖入图片，或从本机选择" note="PNG、JPEG、GIF 或 WebP，每张最多 4 MB"
        dropLabel="松开添加图片" onFilesChange={setPicker}/>
      <div className="modal-actions picker-actions">
        <Button type="button" variant="secondary" onClick={() => setPicker(null)}>取消</Button>
        <Button type="button" disabled={!picker.length} onClick={() => {
          setPicker(null); insertFiles(picker);
        }}>添加到评论</Button>
      </div>
    </Modal>}
  </form>;
}

function TaskReference({id, tasks}) {
  const linked = tasks.find(item => item.id === id);
  return <a className="task-ref" href={taskHref(id)} title={linked ? id + ' · ' + titleOf(linked) : id}>
    <Link2/>{linked ? titleOf(linked) : id}</a>;
}

function CommentBody({comment, tasks, preview}) {
  const references = new Set(comment.references);
  const inline = new Set();
  const rich = comment.text.split(/(@[A-Z][A-Z0-9]*-\d+)(?![A-Za-z0-9_-])/g).map((piece, index) => {
    const id = piece.slice(1);
    if (index % 2 && references.has(id)) {
      inline.add(id);
      return <TaskReference key={index} id={id} tasks={tasks}/>;
    }
    return piece;
  });
  return <div className="comment-body">
      {comment.text && <div className="prose">{rich}</div>}
      <div className="references">{comment.references.filter(id => !inline.has(id)).map(id => <TaskReference key={id} id={id} tasks={tasks}/>)}</div>
      {!!comment.images.length && <div className="comment-images">{comment.images.map((image,index) =>
        <Button type="button" variant="secondary" key={image.url + index} title={image.name} aria-label={'查看图片 ' + image.name} onClick={() => preview(image)}>
          <img src={image.url} alt={image.name} loading="lazy"/>
        </Button>)}</div>}
    </div>;
}

const FIELD_NAMES = {title:'任务名称', project:'项目', stage:'状态', customer:'客户', product:'产品', topic:'标签', description:'任务说明', evidence:'依据', archivedAt:'归档时间', deletedAt:'删除时间'};
const HISTORY_NAMES = {created:'创建任务', updated:'修改任务', comment:'发表评论', comment_deleted:'删除评论', review_suggested:'提交审阅建议',
  review_accepted:'采纳审阅建议', review_dismissed:'忽略审阅建议', archived:'归档任务', restored:'恢复归档任务', deleted:'删除任务', undeleted:'从回收站恢复', undo:'撤销操作'};
const canRedo = entry => entry?.type === 'undo' && entry.reversal !== 'redo';

function historyTitle(entry) {
  if (entry.type === 'updated' && entry.changes?.length === 1 && entry.changes[0].field === 'stage') return '更新状态';
  if (entry.type === 'undo' && entry.effect?.type === 'comment') return entry.effect.after ? '恢复评论' : '撤回评论';
  if (entry.type === 'undo' && entry.effect?.type === 'review') return entry.effect.after === 'accepted' ? '恢复采纳' : '撤销采纳';
  if (entry.reversal === 'redo') return '重做操作';
  return HISTORY_NAMES[entry.type] || '记录操作';
}

function changeLabel(field, value) {
  if (field === 'archivedAt') return value ? archiveDate(value) : '未归档';
  if (field === 'deletedAt') return value ? archiveDate(value) : '未删除';
  return (field === 'stage' ? stageLabel(value) : value) || '（空）';
}

function Differences({changes, reverse = false}) {
  if (!changes?.length) return null;
  return <dl className="history-diff">{changes.map(change => <div key={change.field}>
    <dt>{FIELD_NAMES[change.field] || change.field}</dt>
    <dd><span className="diff-before">{changeLabel(change.field, reverse ? change.after : change.before)}</span>
      <ChevronRight aria-hidden="true"/><span className="diff-after">{changeLabel(change.field, reverse ? change.before : change.after)}</span></dd>
  </div>)}</dl>;
}

function TaskHistory({entries, comments, ask, openComment, disabled}) {
  const visible = new Set(comments.map(comment => comment.id));
  const events = entries.map(entry => ({
    id:entry.id, at:entry.at, title:historyTitle(entry),
    actor:entry.author || (entry.source === 'cli' ? 'CLI' : '网页'),
    meta:[entry.reviewId, entry.changes?.map(change => FIELD_NAMES[change.field] || change.field).join('、'),
      ({undone:'已撤销',conflict:'有后续修改'})[entry.undoStatus]].filter(Boolean).join(' · '),
    icon:entry.reversal === 'redo' ? <Redo2/> : entry.type === 'undo' ? <Undo2/> : <History/>,
    detail:<div className="history-entry">
      <Differences changes={entry.changes}/>
      {entry.type === 'comment' && visible.has(entry.commentId) && <div className="history-comment">
        {entry.excerpt && <p>{entry.excerpt}</p>}
        {(!!entry.imageCount || !!entry.referenceCount) && <span>{entry.imageCount} 张图片 · {entry.referenceCount} 项引用</span>}
      </div>}
      <div className="history-actions">
        {entry.type === 'comment' && visible.has(entry.commentId) && <Button variant="ghost" size="sm" type="button"
          onClick={() => openComment(entry.commentId)}>查看评论</Button>}
        {entry.undoStatus === 'available' ? <Button type="button" size="sm" variant="secondary"
          disabled={disabled} onClick={() => ask(entry)}>{canRedo(entry) ? <><Redo2/>重做</> : <><Undo2/>撤销</>}</Button>
        : <Badge size="sm" tone={entry.undoStatus === 'conflict' ? 'warning' : 'neutral'}>
          {({undone:'已撤销',conflict:'有后续修改','view-only':'仅供查看'})[entry.undoStatus]}</Badge>}
      </div>
    </div>,
  }));
  return <section className="surface task-history">
    <h2><History/>操作历史 <span>{entries.length}</span></h2>
    {!entries.length && <Empty icon={History} title="暂无操作历史">历史从此功能启用后的操作开始记录。</Empty>}
    {!!events.length && <Timeline events={events} now={Date.now()} label="任务时间线" timeZone="Asia/Shanghai" locale="zh-CN"
      defaultExpanded={[events[0].id]} scrollToNew={false}/>}
  </section>;
}

function HistoryConfirmation({entry, revision, onUndo, onClose}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = canRedo(entry) ? '重做' : '撤销';
  const effect = entry.effect;
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onUndo(entry, revision); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal label={label + '操作'} onClose={() => { if (!busy) onClose(); }}>
    <p className="history-confirm-text">{effect?.type === 'comment'
      ? effect.before ? '评论、图片和任务引用将重新显示在讨论中。' : '评论将从讨论中撤回，可以在历史中重做。'
      : effect?.type === 'review' ? '这条审阅建议的处理结果将变更。' : '以下字段将变更为所示值。'}</p>
    <Differences changes={entry.changes} reverse/>
    {error && <Alert tone="danger" title={error}/>}
    <div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
      <Button type="button" loading={busy} onClick={confirm}>{'确认' + label}</Button></div>
  </Modal>;
}

function CommentDeletion({onConfirm, onClose}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onConfirm(); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal label="删除评论" onClose={() => { if (!busy) onClose(); }}>
    <p className="history-confirm-text">删除后，可在任务的「操作历史」中撤销，恢复评论、图片和任务引用。</p>
    {error && <Alert tone="danger" title={error}/>}
    <div className="modal-actions">
      <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
      <Button type="button" variant="danger" loading={busy} onClick={confirm}>确认删除</Button>
    </div>
  </Modal>;
}

function TaskDetail({detail, route, tasks, config, edit, editor, customers, move, notify, onComment, onRemoveComment, onUndo, onArchive, archiveBusy, onDeletion, onPurge, deletionBusy, historyBusy}) {
  const { task, history = [], comments, mentions } = detail;
  const content = useRef(null);
  const [image, setImage] = useState(null);
  const [moving, setMoving] = useState(false);
  const [activity, setActivity] = useState('comments');
  const [historyTarget, setHistoryTarget] = useState(null);
  const [commentTarget, setCommentTarget] = useState('');
  const undoEntry = history.find(entry => entry.undoStatus === 'available' && !canRedo(entry));
  const redoEntry = history.find(entry => entry.undoStatus === 'available' && canRedo(entry));
  const askHistory = entry => setHistoryTarget({entry, revision:task.revision});
  const editButton = useRef(null);
  const wasEditing = useRef(false);
  const editing = Boolean(editor);
  const fieldProps = editor && {form:editor.form, disabled:editor.busy};
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus({preventScroll:true});
    wasEditing.current = editing;
  }, [editing]);
  const threadComments = useMemo(() => comments.map(comment => ({
    id:comment.id, author:{id:comment.author,name:comment.author}, body:comment.text, createdAt:date(comment.created),
    original:comment,
  })), [comments]);
  useEffect(() => {
    if (route.commentId) setActivity('comments');
    else content.current.closest('[data-dialog-body]')?.scrollTo(0, 0);
  }, [route.commentId]);
  useEffect(() => {
    if (activity !== 'comments' || !route.commentId) return;
    const scroller = content.current.closest('[data-dialog-body]');
    const comment = document.getElementById('comment-' + route.commentId);
    if (!comment || !scroller?.contains(comment)) return;
    const offset = comment.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += offset - (scroller.clientHeight - comment.offsetHeight) / 2;
  }, [route.commentId, activity]);
  return <div className="detail" ref={content}>
    {editor && <form id={editor.form} onSubmit={editor.submit}/>}
    <div className="detail-head">
      <div className="detail-kicker"><ProjectBadge project={task.project} projects={config.projects}/><span className="task-key">{task.id}</span>{task.deletedAt ? <Badge size="sm">已删除</Badge> : task.archivedAt && <Badge size="sm">已归档</Badge>}</div>
      <div className="detail-actions">
        {editor ? <>
          <Button key="cancel" type="button" variant="secondary" disabled={editor.busy} onClick={editor.cancel}>取消</Button>
          <Button key="save" type="submit" form={editor.form} loading={editor.busy}>保存修改</Button>
        </> : <>
          <Button size="sm" variant="secondary" type="button" disabled={historyBusy || !undoEntry}
            title="撤销此任务的最近操作" onClick={() => askHistory(undoEntry)}><Undo2/>撤销</Button>
          <Button size="sm" variant="secondary" type="button" disabled={historyBusy || !redoEntry}
            title="重做此任务刚撤销的操作" onClick={() => askHistory(redoEntry)}><Redo2/>重做</Button>
          {task.deletedAt ? <>
            <Button type="button" variant="secondary" disabled={historyBusy || deletionBusy} onClick={onDeletion}><ArchiveRestore/>恢复任务</Button>
            <Button type="button" variant="danger" disabled={historyBusy || deletionBusy} onClick={onPurge}><Trash2/>彻底删除</Button>
          </> : <>
            {task.archivedAt ? <Button type="button" variant="secondary" loading={archiveBusy} onClick={() => onArchive(false)}><ArchiveRestore/>恢复归档</Button>
              : task.stage === '已完成' && <Button type="button" variant="secondary" loading={archiveBusy} onClick={() => onArchive(true)}><Archive/>归档任务</Button>}
            <Button type="button" variant="ghost" disabled={historyBusy || moving || archiveBusy} onClick={onDeletion}><Trash2/>删除任务</Button>
            <Button key="edit" ref={editButton} type="button" variant="secondary" disabled={moving || archiveBusy} onClick={edit}><Pencil/>编辑任务</Button>
          </>}
        </>}
      </div>
    </div>
    {historyTarget && <HistoryConfirmation {...historyTarget} onUndo={onUndo} onClose={() => setHistoryTarget(null)}/>}
    {commentTarget && <CommentDeletion onClose={() => setCommentTarget('')} onConfirm={() => onRemoveComment(task.id, commentTarget)}/>}
    {editor?.error && <div className="detail-edit-error"><Alert tone="danger" title={editor.error}/></div>}
    <div className="detail-grid">
      <div className="detail-main">
        <section className="surface description">
          {editor ? <div className="detail-field-stack">
            <Textarea {...fieldProps} label="任务说明" name="description" rows={8} maxLength={12000} defaultValue={editor.task.description}/>
            <Textarea {...fieldProps} label="依据" name="evidence" rows={3} maxLength={6000} defaultValue={editor.task.evidence}/>
          </div> : <>
            <h2><FileText/>任务说明</h2><div className="prose">{task.description || '暂无说明'}</div>
            {task.evidence && <><h3>依据</h3><div className="prose evidence">{task.evidence}</div></>}
          </>}
        </section>
        <Tabs value={activity} onValueChange={setActivity} className="task-activity">
          <TabsList aria-label="任务活动">{ACTIVITY.map(tab=><TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}</TabsList>
          <TabsContent value="comments" forceMount hidden={activity !== 'comments'}>
            <CommentThread title="讨论" readOnly comments={threadComments} currentUser={{id:'我',name:'我'}} highlightedId={route.commentId}
              labels={{thread:'讨论',commentCount:count=>count + ' 条评论',empty:'暂无评论'}}
              renderBody={item => <CommentBody comment={item.original} tasks={tasks} preview={setImage}/>}
              renderActions={task.deletedAt ? undefined : item => <IconButton aria-label="删除评论"
                className="comment-delete-action" disabled={historyBusy || editing} onClick={() => setCommentTarget(item.id)}>
                <Trash2 aria-hidden="true"/>
              </IconButton>}/>
            {!task.deletedAt && <div className="surface composer-card"><CommentComposer task={task} tasks={tasks} onComment={onComment} notify={notify}/></div>}
          </TabsContent>
          <TabsContent value="history" forceMount hidden={activity !== 'history'}>
            <TaskHistory entries={history} comments={comments} ask={askHistory} disabled={historyBusy || editing} openComment={commentId => {
              setActivity('comments'); location.hash = taskHref(task.id) + '/comment/' + commentId;
            }}/>
          </TabsContent>
        </Tabs>
      </div>
      <div className="detail-side">
        <section className="surface properties"><h2>任务属性</h2>
          {editor ? <div className="detail-field-stack">
            <Select {...fieldProps} label="项目" name="project" value={editor.project}
              options={asOptions(config.projects.map(([name]) => name))} onValueChange={editor.changeProject}/>
            <Select {...fieldProps} label="状态" name="stage" defaultValue={editor.task.stage}
              disabled={editor.busy || Boolean(editor.task.archivedAt)} options={stageOptions(config.stages)}/>
            {editor.project === PRIVATE && <>
              <CustomerInput {...fieldProps} customer={editor.task.customer} customers={customers}/>
              <Select {...fieldProps} label="产品" name="product" defaultValue={editor.task.product || config.products[0]}
                options={asOptions(config.products)}/>
            </>}
            <Input {...fieldProps} label="标签" name="topic" maxLength={32} defaultValue={editor.task.topic}/>
          </div> : <dl><div><dt>状态</dt><dd className="compact-select"><Select label="更新任务状态" value={task.stage} disabled={moving || Boolean(task.archivedAt || task.deletedAt)}
            options={stageOptions(config.stages)} onValueChange={async value => {
              setMoving(true); await move(task,value); setMoving(false);
            }}/></dd></div>
            <div><dt>项目</dt><dd>{task.project}</dd></div>
            {task.customer && <div><dt>客户</dt><dd>{customerLabel(task.customer)}</dd></div>}
            {task.product && <div><dt>产品</dt><dd>{task.product}</dd></div>}
            {task.topic && <div><dt>标签</dt><dd><Badge size="sm">{task.topic}</Badge></dd></div>}
            {task.archivedAt && <div><dt>归档时间</dt><dd><time dateTime={task.archivedAt}>{archiveDate(task.archivedAt)}</time></dd></div>}
            {task.deletedAt && <div><dt>删除时间</dt><dd><time dateTime={task.deletedAt}>{archiveDate(task.deletedAt)}</time></dd></div>}
            <div><dt>最近更新</dt><dd><time dateTime={task.updated}>{date(task.updated)}</time></dd></div>
          </dl>}
        </section>
        <section className="surface backlinks"><h2><Link2/>被引用 <span>{mentions.length}</span></h2>
          {mentions.length ? mentions.map(ref =>
            <a key={ref.commentId} href={taskHref(ref.taskId) + '/comment/' + ref.commentId}>
              <span>{ref.taskTitle}</span><ChevronRight/>
            </a>) : <p>暂无来自其他任务的引用</p>}
        </section>
      </div>
    </div>
    {image && <Modal label={image.name} className="image-modal" onClose={() => setImage(null)}>
      <img className="preview-image" src={image.url} alt={image.name}/>
    </Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
