import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { NewsHome } from './NewsPage';
import type { Wiki, WorkItemSummary } from '../api';
import { workKindLabel, workStatusLabel } from './WorkItemsPage';
import {PeriodReview} from '../components/PeriodReview';
import type { HomeAction } from '../../services/home/actions';
import type { AutomationStatus, CandidateFilter, CandidateList, Raw, Stats } from '../api';
import { api, automationCandidates, automationStatus, automationTime, dateText, sourceLabels, workItems } from '../api';
import '../home.css';

const actionKinds = {'raw-task':'整理任务',draft:'待审草稿',workflow:'更新与综合',audit:'Audit'};
const actionStatuses = {running:'整理中',failed:'整理失败',recovery:'待恢复',review:'待审核',partial:'部分已入库','commit-recovery':'提交待恢复',deferred:'稍后处理'};

export function HomePage({ onOpenAutomation, onOpenPipeline, onOpenNews, stats, items, onOpenRaw, onOpenWiki, onOpenPrompt, onImport, onCreateWiki, onCreatePrompt, onGeneratePrompt, onLint, onGenerateFromRaw, onOpenAction, onCreateMeeting, actionsRevision, onOpenWorkItem, workItemsRevision }: { onOpenAutomation?: () => void; onOpenPipeline?: (filter: CandidateFilter) => void; onOpenNews?: () => void; stats: Stats; items: Raw[]; onOpenRaw: (id?: string) => void; onOpenWiki: (id?: string) => void; onOpenPrompt: () => void; onImport: () => void; onCreateWiki: () => void; onCreatePrompt: () => void; onGeneratePrompt: () => void; onLint: () => void; onOpenWorkflow?: (id: string) => void; onGenerateFromRaw?: () => void; onOpenAction?: (item:HomeAction) => void; onCreateMeeting?: () => void; actionsRevision?: number; onOpenWorkItem?: (id: string) => void; workItemsRevision?: number }) {
  const [recentWiki,setRecentWiki]=useState<Wiki[]|null>(null);
  const [wikiError,setWikiError]=useState('');
  const [reviewFilter,setReviewFilter]=useState(false);
  const [dueItems, setDueItems] = useState<WorkItemSummary[] | null>(null);
  const [dueError, setDueError] = useState('');
  const [dueReload, setDueReload] = useState(0);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);
  const [automationError, setAutomationError] = useState(false);
  const [pipeline, setPipeline] = useState<CandidateList>();
  const [pipelineError, setPipelineError] = useState(false);
  const [pipelineReview, setPipelineReview] = useState(false);
  const showPipeline = Boolean(onOpenPipeline);
  useEffect(() => {
    if (!showPipeline) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await automationCandidates(undefined, controller.signal);
        if (!controller.signal.aborted) { setPipeline(result); setPipelineError(false); }
      } catch {
        if (!controller.signal.aborted) setPipelineError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 4000);
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [showPipeline]);
  const showAutomation = Boolean(onOpenAutomation);
  useEffect(() => {
    if (!showAutomation) return;
    const controller = new AbortController();
    void automationStatus(controller.signal)
      .then(value => { if (!controller.signal.aborted) setAutomation(value); })
      .catch(() => { if (!controller.signal.aborted) setAutomationError(true); });
    return () => controller.abort();
  }, [showAutomation]);
  const showDue = Boolean(onOpenWorkItem);
  useEffect(() => {
    if (!showDue) return;
    let active = true;
    setDueItems(null);
    setDueError('');
    void workItems(true).then(items => { if (active) setDueItems(items); })
      .catch(() => { if (active) setDueError('到期跟进读取失败，请刷新后重试。'); });
    return () => { active = false; };
  }, [showDue, dueReload, workItemsRevision]);
  useEffect(()=>{let active=true;api<{items:Wiki[]}>('/api/wiki').then(result=>{if(active)setRecentWiki([...result.items].sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,4));}).catch(()=>{if(active)setWikiError('最近知识读取失败，请稍后重试。');});return()=>{active=false;};},[]);
  const [reviewOpen,setReviewOpen]=useState(false);
  const [actions,setActions]=useState<{items:HomeAction[];sources:Record<string,{status:string;message?:string}>}|null>(null);
  const [actionError,setActionError]=useState(''); const generation=useRef(0);
  const loadActions=async()=>{const current=++generation.current;setActionError('');try{const result=await api<{items:HomeAction[];sources:Record<string,{status:string;message?:string}>}>('/api/home/actions');if(current===generation.current)setActions(result);}catch{if(current===generation.current)setActionError('行动事项读取失败，请刷新。');}};
  const pipelineDrafts = pipeline?.items.flatMap(row => row.draftPending && row.execution?.draftId ? [row.execution.draftId] : []).sort().join(',');
  useEffect(()=>{void loadActions();return ()=>{generation.current++;};},[actionsRevision, pipelineDrafts]);
  const openAction=async(item:HomeAction)=>{const current=++generation.current;setActionError('');try{const target=await api<HomeAction>(`/api/home/actions/${item.kind}/${encodeURIComponent(item.id)}?versionToken=${encodeURIComponent(item.versionToken)}`);if(current===generation.current)onOpenAction?.(target);}catch(error){if(current===generation.current)setActionError(error instanceof Error?error.message:'事项读取失败，请刷新。');}};
  const todaysDrafts = new Set(pipelineDrafts?.split(','));
  const currentActions = actions?.items.filter(item => item.status !== 'deferred' && (pipelineReview ? item.kind === 'draft' && todaysDrafts.has(item.id)
    : !reviewFilter || item.kind === 'draft' || item.kind === 'workflow')) ?? [];
  const deferredActions = actions?.items.filter(item => item.status === 'deferred' && (!pipelineReview || todaysDrafts.has(item.id))) ?? [];
  const renderAction = (item: HomeAction) => {
    const label = item.status ? actionStatuses[item.status] : item.kind === 'draft' ? '待审核' : item.kind === 'audit' ? '待纠错' : '待处理';
    const badge = item.priority === 0 ? 'action-warning' : item.kind === 'draft' && item.status !== 'deferred' ? 'action-review' : 'action-neutral';
    return <article className="home-action-row" key={`${item.kind}:${item.id}`} aria-label={item.title}>
      <div><b>{item.title}</b><p>{actionKinds[item.kind]} · {dateText(item.updatedAt)} · {item.problem}</p><small>{item.result}</small></div>
      <span className={`action-badge ${badge}`}>{label}</span>
      <button className="secondary-button" onClick={() => void openAction(item)}>{item.action}</button>
    </article>;
  };
  const cards = [
    { label: 'Raw 原始资料', value: stats.rawCount, detail: '持续积累的来源材料', action: onOpenRaw },
    { label: 'Wiki 知识', value: stats.wikiCount, detail: '当前知识页面', action: onOpenWiki },
    { label: '本周新增', value: stats.thisWeekNewCount, detail: 'Raw 与 Wiki 新建 · 周一开始', action: undefined },
    { label: '待审核', value: stats.pendingConfirmationCount, detail: 'AI 知识草稿等待你审核', action: () => document.getElementById('home-actions')?.scrollIntoView() },
    { label: 'Open Audit', value: stats.openAuditCount, detail: '尚未处理的知识纠错', action: () => { setPipelineReview(false); setReviewFilter(false); document.getElementById('home-actions')?.scrollIntoView(); } },
    { label: 'Prompt', value: stats.promptCount, detail: 'Library 中的有效模板', action: onOpenPrompt },
  ];
  return <div className="page home-page">
    <div className="page-heading"><div><h1>工作台</h1><p className="subheading">从一件待处理的事开始。</p></div><button className="secondary-button" onClick={()=>setReviewOpen(true)} disabled={reviewOpen}>周期回顾</button></div>
    <div className="home-entry-grid">{[
      {title:'导入资料',description:'保存原始资料',icon:'upload',action:onImport},
      {title:'审核草稿',description:'查看待审核事项',icon:'file',action:()=>{setPipelineReview(false);setReviewFilter(true);document.getElementById('home-actions')?.scrollIntoView();}},
      {title:'生成 Prompt',description:'打开生成工作台',icon:'code',action:onGeneratePrompt},
      {title:'新建会议',description:'记录和管理会议',icon:'calendar',action:onCreateMeeting},
    ].map(entry=><button className="home-entry" key={entry.title} onClick={entry.action}><span className="entry-icon"><Icon name={entry.icon}/></span><span><b>{entry.title}</b><small>{entry.description}</small></span><span aria-hidden="true">›</span></button>)}</div>
    {reviewOpen&&<PeriodReview onClose={()=>setReviewOpen(false)} onOpenWiki={id=>onOpenWiki(id)} onOpenAction={item=>onOpenAction?.(item)} />}
    <div className="home-workspace">
    <section className="panel home-actions" id="home-actions"><div className="panel-heading"><div><h2>需要你处理</h2><p>{pipelineReview ? '今日资讯待审草稿' : actions ? `已读取事项 ${actions.items.length} 项 · 稍后处理 ${deferredActions.length} 项` : actionError ? '事项暂不可用' : '正在读取事项…'}</p></div><div>{(reviewFilter || pipelineReview) && <button className="text-button" onClick={()=>{setReviewFilter(false);setPipelineReview(false);}}>显示全部事项</button>}<button className="text-button" onClick={()=>void loadActions()}>刷新</button></div></div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {actions && Object.entries(actions.sources).map(([source,state])=>state.status==='error' && <p className="form-error" role="alert" key={source}>{({ 'raw-task':'整理任务',draft:'草稿',workflow:'更新与综合',audit:'Audit' } as Record<string,string>)[source]}：{state.message}</p>)}
      {actions && currentActions.length === 0 && Object.values(actions.sources).every(x=>x.status==='ok') && <p>{pipelineReview ? '今日没有待审核的资讯草稿。' : reviewFilter ? '当前没有待审核草稿或工作流。' : '当前没有需要处理的事项。'}</p>}
      {actions && <div className="home-action-list">{currentActions.map(renderAction)}</div>}
      <section className="home-deferred" aria-labelledby="home-deferred-heading">
        <h3 id="home-deferred-heading">稍后处理</h3>
        {actions && deferredActions.length > 0 && <div className="home-action-list">{deferredActions.map(renderAction)}</div>}
        {actions?.sources.draft?.status === 'ok' && deferredActions.length === 0 && <p>暂时没有稍后处理的整理成果。</p>}
      </section>
    </section>
    <div className="home-workspace-side">
    {onOpenPipeline && <section className="panel home-automation" aria-labelledby="home-pipeline-heading">
      <div className="panel-heading"><h2 id="home-pipeline-heading">今日资讯流水线</h2><button className="text-button" onClick={() => onOpenPipeline('all')}>打开收件箱 ›</button></div>
      {pipelineError ? <p className="form-error" role="alert">无法读取今日资讯流水线。</p> : pipeline ? <dl className="automation-facts">
        <div><dt>已抓取</dt><dd><button className="text-button" aria-label={`已抓取 ${pipeline.counts.fetched} 条`} onClick={() => onOpenPipeline('fetched')}>{pipeline.counts.fetched}</button></dd></div>
        <div><dt>待确认</dt><dd><button className="text-button" aria-label={`待确认 ${pipeline.counts.pending} 条`} onClick={() => onOpenPipeline('pending')}>{pipeline.counts.pending}</button></dd></div>
        <div><dt>整理中</dt><dd><button className="text-button" aria-label={`整理中 ${pipeline.counts.organizing} 条`} onClick={() => onOpenPipeline('organizing')}>{pipeline.counts.organizing}</button></dd></div>
        <div><dt>待审草稿</dt><dd><button className="text-button" aria-label={`待审草稿 ${pipeline.counts.drafts} 份`}
          onClick={() => { setPipelineReview(true); document.getElementById('home-actions')?.scrollIntoView?.(); }}>{pipeline.counts.drafts}</button></dd></div>
        <div><dt>失败</dt><dd><button className="text-button" aria-label={`失败 ${pipeline.counts.failed} 条`} onClick={() => onOpenPipeline('failed')}>{pipeline.counts.failed}</button></dd></div>
      </dl> : <p role="status">正在读取今日资讯流水线…</p>}
    </section>}
    {onOpenAutomation && <section className="panel home-automation" aria-labelledby="home-automation-heading">
      <div className="panel-heading"><h2 id="home-automation-heading">自动化</h2><button className="text-button" onClick={onOpenAutomation}>查看自动化 ›</button></div>
      {automationError ? <p className="form-error" role="alert">无法读取自动化状态。</p> : automation ? <>
        <p>{automation.paused ? '全局暂停' : '任务可触发'} · {automation.scheduler.healthy ? '调度器正常' : '调度器异常'}</p>
        <dl className="automation-facts">
          <div><dt>最近 24 小时失败</dt><dd>{automation.failuresLast24Hours} 次</dd></div>
          <div><dt>下次运行（上海时间）</dt><dd>{automationTime(automation.nextRunAt)}</dd></div>
        </dl>
      </> : <p role="status">正在读取自动化状态…</p>}
    </section>}
    {onOpenWorkItem && <section className="panel home-actions work-due" aria-labelledby="work-due-heading">
      <div className="panel-heading"><div><h2 id="work-due-heading">到期跟进</h2><p>工作事项 · 按上海日期</p></div><button className="text-button" onClick={() => setDueReload(value => value + 1)}>刷新到期跟进</button></div>
      {dueError ? <p className="form-error" role="alert">{dueError}</p> : dueItems === null ? <p role="status">正在读取到期跟进…</p> : dueItems.length === 0 ? <p>暂无到期的工作事项。</p> : <div className="home-action-list">{dueItems.map(item => <article className="home-action-row" key={item.id} aria-label={item.title}><div><b>{item.title}</b><p>{workKindLabel(item.kind)} · {item.followUpOn && <time dateTime={item.followUpOn}>{item.followUpOn}</time>} · {workStatusLabel(item.kind, item.status)}</p></div><button className="secondary-button" onClick={() => onOpenWorkItem(item.id)}>查看事项</button></article>)}</div>}
    </section>}
    {onOpenNews && <NewsHome onOpen={onOpenNews} />}
    </div></div>
    <div className="home-columns">
      <section className="panel recent-panel"><div className="panel-heading"><div><h2>最近知识</h2><p>按更新时间排列</p></div><button className="text-button" onClick={()=>onOpenWiki()}>查看全部 ›</button></div>{wikiError ? <p className="form-error" role="alert">{wikiError}</p> : recentWiki === null ? <p>正在读取知识…</p> : recentWiki.length ? <div className="recent-list">{recentWiki.map(item=><button className="recent-row" key={item.id} onClick={()=>onOpenWiki(item.id)}><span className="entry-icon"><Icon name="book"/></span><span className="recent-copy"><b>{item.title}</b><small>{item.type} · {item.sources.length} 个来源</small></span><time>{dateText(item.updated)}</time></button>)}</div> : <div className="empty-recent"><b>暂无知识页面</b><span>创建或确认知识后会显示在这里。</span></div>}</section>
      <section className="panel recent-panel"><div className="panel-heading"><div><h2>最近更新</h2><p>从正式知识操作日志读取</p></div><button className="text-button" onClick={() => onOpenWiki()}>查看知识库 ›</button></div>{stats.recentChanges?.length ? <div className="recent-list">{stats.recentChanges.slice(0,4).map((change,index)=><button className="recent-row" key={`${change.id}-${change.action}-${index}`} onClick={() => onOpenWiki(change.id)}><span className="file-icon">知</span><span className="recent-copy"><b>{change.title}{change.isDemo && <span className="demo-badge">演示数据</span>}</b><small>{change.action==='audit'?'Audit纠错':change.action==='create'?'新建 Wiki':change.action==='delete'?'删除 Wiki':'更新 Wiki'} · 第 {change.revision} 版</small></span><time>{dateText(change.time)}</time></button>)}</div>:<div className="empty-recent"><b>暂无知识变更记录</b><span>创建或修订 Wiki 后，最近操作会显示在这里。</span></div>}</section>
    </div>
    <section className="stats-grid" aria-label="知识库统计">{cards.map(card=><button key={card.label} className="stat-card" onClick={()=>card.action?.()} disabled={!card.action}><span className="stat-label">{card.label}</span><strong>{card.value}</strong><span className="stat-detail">{card.detail}</span></button>)}</section>
    <section className="panel recent-import"><div className="panel-heading"><h2>最近导入</h2><button className="text-button" onClick={()=>onOpenRaw()}>查看全部 ›</button></div>{items.slice(0,3).map(item=><button className="recent-row" key={item.id} onClick={()=>onOpenRaw(item.id)}><span className="recent-copy"><b>{item.title}</b><small>{sourceLabels[item.sourceType]} · {item.sourceName}</small></span><time>{dateText(item.importedAt)}</time></button>)}</section>
    <section className="panel home-quick-actions"><div className="panel-heading"><div><h2>更多工具</h2><p>其他知识与 Prompt 操作</p></div></div><div className="quick-action-grid"><button className="secondary-button" onClick={onGenerateFromRaw}>从 Raw 生成 Wiki 草稿</button><button className="secondary-button" onClick={onCreateWiki}>手动创建 Wiki</button><button className="secondary-button" onClick={onCreatePrompt}>新建 Prompt</button><button className="secondary-button" onClick={onLint}>检查知识库</button></div></section>
  </div>;
}
