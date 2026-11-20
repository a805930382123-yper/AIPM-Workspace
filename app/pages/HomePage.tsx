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

export function HomePage({ onQuickCapture, onOpenAutomation, onOpenPipeline, onOpenNews, stats, items, onOpenRaw, onOpenWiki, onOpenPrompt, onImport, onCreateWiki, onCreatePrompt, onGeneratePrompt, onLint, onGenerateFromRaw, onOpenAction, onCreateMeeting, actionsRevision, onOpenWorkItem, workItemsRevision }: { onQuickCapture?: () => void; onOpenAutomation?: () => void; onOpenPipeline?: (filter: CandidateFilter) => void; onOpenNews?: () => void; stats: Stats; items: Raw[]; onOpenRaw: (id?: string) => void; onOpenWiki: (id?: string) => void; onOpenPrompt: () => void; onImport: () => void; onCreateWiki: () => void; onCreatePrompt: () => void; onGeneratePrompt: () => void; onLint: () => void; onOpenWorkflow?: (id: string) => void; onGenerateFromRaw?: () => void; onOpenAction?: (item:HomeAction) => void; onCreateMeeting?: () => void; actionsRevision?: number; onOpenWorkItem?: (id: string) => void; workItemsRevision?: number }) {
  const [recentWiki,setRecentWiki]=useState<Wiki[]|null>(null);
  const [wikiError,setWikiError]=useState('');
  const [deferred, setDeferred] = useState(false);
  const [activity, setActivity] = useState<'最近知识' | '操作日志' | '最近导入'>('最近知识');
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
    return <article className="home-action-row" data-status={item.status?.includes("recovery") ? "blocked" : item.status} data-tone={item.status === 'failed' ? 'danger' : item.status?.includes('recovery') ? 'warning' : label === '待审核' ? 'accent' : 'neutral'} key={`${item.kind}:${item.id}`} aria-label={item.title}>
      <div><b title={item.title}>{item.title}</b><p>{actionKinds[item.kind]} · {dateText(item.updatedAt)}</p>{item.problem && <p className={item.status === "failed" ? "home-a-problem form-error" : "home-a-problem"}>{item.problem}</p>}<small>{item.result}</small></div>
      <span className={`action-badge ${badge}`}>{label}</span>
      <button className="secondary-button" onClick={() => void openAction(item)}>{item.action}</button>
    </article>;
  };
  const cards = [
    { label: 'Raw 原始资料', value: stats.rawCount, detail: '持续积累的来源材料', action: onOpenRaw },
    { label: 'Wiki 知识', value: stats.wikiCount, detail: '当前知识页面', action: onOpenWiki },
    { label: '本周新增', value: stats.thisWeekNewCount, detail: 'Raw 与 Wiki 新建 · 周一开始', action: undefined },
    { label: '待审核', value: stats.pendingConfirmationCount, detail: 'AI 知识草稿等待你审核', action: () => { setDeferred(false);setPipelineReview(false); setReviewFilter(true); document.getElementById('home-actions')?.scrollIntoView?.(); } },
    { label: 'Open Audit', value: stats.openAuditCount, detail: '尚未处理的知识纠错', action: () => { setDeferred(false);setPipelineReview(false); setReviewFilter(false); document.getElementById('home-actions')?.scrollIntoView(); } },
    { label: 'Prompt', value: stats.promptCount, detail: 'Library 中的有效模板', action: onOpenPrompt },
  ];
  return <div className="page home-page">
    <div className="page-heading">
      <div><h1>工作台</h1><p className="subheading">从一件待处理的事开始。</p></div>
      <div className="home-heading-actions">
        {onQuickCapture && <button type="button" className="primary-button" onClick={onQuickCapture}>快速记一条</button>}
        <button type="button" className="secondary-button" onClick={()=>setReviewOpen(true)} disabled={reviewOpen}>周期回顾</button>
      </div>
    </div>
    <div className="home-entry-grid">{[
      {title:'导入资料',description:'保存原始资料',icon:'upload',action:onImport},
      {title:'审核草稿',description:'查看待审核事项',icon:'file',action:()=>{setDeferred(false);setPipelineReview(false);setReviewFilter(true);document.getElementById('home-actions')?.scrollIntoView();}},
      {title:'生成 Prompt',description:'打开生成工作台',icon:'code',action:onGeneratePrompt},
      {title:'新建会议',description:'记录和管理会议',icon:'calendar',action:onCreateMeeting},
    ].map(entry=><button className="home-entry" key={entry.title} onClick={entry.action}><span className="entry-icon"><Icon name={entry.icon}/></span><span><b>{entry.title}</b><small>{entry.description}</small></span><span aria-hidden="true">›</span></button>)}</div>
    {reviewOpen&&<PeriodReview onClose={()=>setReviewOpen(false)} onOpenWiki={id=>onOpenWiki(id)} onOpenAction={item=>onOpenAction?.(item)} />}
    {(showPipeline || showAutomation) && <div className="panel home-status-banner home-a-banner">
      {onOpenPipeline && <section aria-labelledby="home-pipeline-heading">
        <div className="panel-heading"><h2 id="home-pipeline-heading">今日资讯流水线</h2><button className="text-button" onClick={() => onOpenPipeline('all')}>打开收件箱 ›</button></div>
        {pipelineError ? <p className="form-error" role="alert">无法读取今日资讯流水线。</p> : pipeline ? <div className="home-pipeline-stages home-a-stages">
          {([['fetched','已抓取'],['pending','待确认'],['organizing','整理中'],['drafts','待审草稿'],['failed','失败']] as const).map(([stage,label]) => {
            const count = pipeline.counts[stage];
            return <button key={stage} className="home-a-stage" data-tone={!count ? 'muted' : stage === 'failed' ? 'danger' : stage === 'pending' || stage === 'drafts' ? 'review' : 'neutral'}
              aria-label={`${label} ${count} ${stage === 'drafts' ? '份' : '条'}`} onClick={() => {
                if (stage !== 'drafts') return onOpenPipeline(stage);
                setDeferred(false); setPipelineReview(true); document.getElementById('home-actions')?.scrollIntoView?.();
              }}>{label} <strong>{count}</strong></button>;
          })}
        </div> : <p role="status">正在读取今日资讯流水线…</p>}
      </section>}
      {onOpenAutomation && <section aria-labelledby="home-automation-heading" className="home-a-automation" data-tone={automationError || (automation && (!automation.scheduler.healthy || automation.failuresLast24Hours > 0)) ? 'danger' : automation?.paused ? 'warning' : 'neutral'}>
        <div className="panel-heading"><h2 id="home-automation-heading">自动化</h2><button className="text-button" onClick={onOpenAutomation}>查看自动化 ›</button></div>
        {automationError ? <p className="form-error" role="alert">无法读取自动化状态。</p> : automation ? <>
          <p><span className="home-a-dot" aria-hidden="true">● </span>{automation.scheduler.healthy ? '调度器正常' : '调度器异常'} · {automation.paused ? '全局暂停' : '任务可触发'} · 24h 失败 {automation.failuresLast24Hours} 次</p>
          <small>下次运行：{automationTime(automation.nextRunAt)}（上海）</small>
        </> : <p role="status">正在读取自动化状态…</p>}
      </section>}
    </div>}
    <div className="home-workspace">
    <section className="panel home-actions" id="home-actions"><div className="panel-heading"><div><h2>需要你处理</h2><p style={actions && !pipelineReview && !reviewFilter ? {position:'absolute',width:1,height:1,overflow:'hidden',clipPath:'inset(50%)'} : undefined}>{pipelineReview ? '今日资讯待审草稿' : actions ? `${reviewFilter ? `当前筛选待审草稿与工作流 ${currentActions.length} 项（共 ${actions.items.length} 项）` : `当前待处理 ${currentActions.length} 项`} · 稍后处理 ${deferredActions.length} 项` : actionError ? '事项暂不可用' : '正在读取事项…'}</p></div>
      <div className="home-a-tabs" role="tablist" aria-label="事项分类">{([false,true] as const).map(later => {
        const count = later ? deferredActions.length : currentActions.length;
        return <button key={String(later)} id={`home-tab-${later ? "later" : "pending"}`} aria-controls={`home-panel-${later ? "later" : "pending"}`} role="tab" aria-selected={deferred === later} onClick={() => setDeferred(later)}>{later ? '稍后处理' : '待处理'} <span data-active={count > 0}>{actions ? count : '—'}</span></button>;
      })}</div><button className="text-button" onClick={()=>void loadActions()}>刷新</button></div>
      {(reviewFilter || pipelineReview) && <button className="text-button" onClick={()=>{setReviewFilter(false);setPipelineReview(false);}}>显示全部事项</button>}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {actions && Object.entries(actions.sources).map(([source,state])=>state.status==='error' && <p className="form-error" role="alert" key={source}>{({ 'raw-task':'整理任务',draft:'草稿',workflow:'更新与综合',audit:'Audit' } as Record<string,string>)[source]}：{state.message}</p>)}
      <div role="tabpanel" id="home-panel-pending" aria-labelledby="home-tab-pending" hidden={deferred}>
      {actions && !currentActions.length && Object.values(actions.sources).every(source=>source.status==='ok') && <p className="empty-recent">{pipelineReview ? '今日没有待审核的资讯草稿。' : reviewFilter ? '当前没有待审核草稿或工作流。' : '当前没有需要处理的事项。'}</p>}
        <div className="home-action-list">{currentActions.map(renderAction)}</div>
      </div>
      <div role="tabpanel" id="home-panel-later" aria-labelledby="home-tab-later" hidden={!deferred}>
      {actions?.sources.draft?.status === 'ok' && !deferredActions.length && <p className="empty-recent">暂时没有稍后处理的整理成果。</p>}
      <div className="home-action-list">{deferredActions.map(renderAction)}</div>
      </div>
    </section>
    <div className="home-workspace-side">
    {onOpenWorkItem && <section className="panel home-actions work-due" aria-labelledby="work-due-heading">
      <div className="panel-heading"><div><h2 id="work-due-heading">到期跟进</h2><p>工作事项 · 上海日期</p></div><button className="text-button" title="刷新到期跟进" aria-label="刷新到期跟进" onClick={() => setDueReload(value => value + 1)}>刷新</button></div>
      {dueError ? <p className="form-error" role="alert">{dueError}</p> : dueItems === null ? <p role="status">正在读取到期跟进…</p> : dueItems.length === 0 ? <p><span aria-hidden="true">✓ </span>暂无到期的工作事项。</p> : <div className="home-action-list">{dueItems.map(item => <article className="home-action-row" key={item.id} aria-label={item.title}><div><b>{item.title}</b><p>{workKindLabel(item.kind)} · {item.followUpOn && <time dateTime={item.followUpOn}>{item.followUpOn}</time>} · {workStatusLabel(item.kind, item.status)}</p></div><button className="secondary-button" onClick={() => onOpenWorkItem(item.id)}>查看事项</button></article>)}</div>}
    </section>}
    {onOpenNews && <NewsHome onOpen={onOpenNews} />}
    </div></div>
    <div className="home-workspace home-a-secondary"><section className="panel recent-panel"><div className="panel-heading"><h2>知识动态</h2><button className="text-button" onClick={()=>activity === '最近导入' ? onOpenRaw() : onOpenWiki()}>{activity === '操作日志' ? '查看知识库 ›' : '查看全部 ›'}</button></div>
      <div className="home-a-tabs" role="tablist" aria-label="知识动态分类">{(['最近知识','操作日志','最近导入'] as const).map(tab=><button key={tab} id={`home-tab-${tab}`} aria-controls={`home-panel-${tab}`} role="tab" aria-selected={activity === tab} onClick={()=>setActivity(tab)}>{tab}</button>)}</div>
      <div role="tabpanel" id="home-panel-最近知识" aria-labelledby="home-tab-最近知识" hidden={activity !== '最近知识'}>{wikiError ? <p className="form-error" role="alert">{wikiError}</p> : recentWiki === null ? <p>正在读取知识…</p> : recentWiki.length ? <div className="recent-list">{recentWiki.map(item=><button className="recent-row" key={item.id} onClick={()=>onOpenWiki(item.id)}><span className="entry-icon"><Icon name="book"/></span><span className="recent-copy"><b>{item.title}</b><small>{item.type} · {item.sources.length} 个来源</small></span><time>{dateText(item.updated)}</time></button>)}</div> : <div className="empty-recent"><b>暂无知识页面</b><span>创建或确认知识后会显示在这里。</span></div>}</div>
      <div role="tabpanel" id="home-panel-操作日志" aria-labelledby="home-tab-操作日志" hidden={activity !== '操作日志'}>{stats.recentChanges?.length ? <div className="recent-list">{stats.recentChanges.slice(0,4).map((change,index)=><button className="recent-row" key={`${change.id}-${change.action}-${index}`} disabled={change.action === 'delete'} onClick={() => { if (change.action !== 'delete') onOpenWiki(change.id); }}><span className="file-icon">知</span><span className="recent-copy"><b>{change.title}{change.isDemo && <span className="demo-badge">演示数据</span>}</b><small>{change.action==='audit'?'Audit纠错':change.action==='create'?'新建 Wiki':change.action==='delete'?'删除 Wiki（已移至回收区）':'更新 Wiki'} · 第 {change.revision} 版</small></span><time>{dateText(change.time)}</time></button>)}</div>:<div className="empty-recent"><b>暂无知识变更记录</b><span>创建或修订 Wiki 后，最近操作会显示在这里。</span></div>}</div>
      <div role="tabpanel" id="home-panel-最近导入" aria-labelledby="home-tab-最近导入" hidden={activity !== '最近导入'}><div className="recent-list">{items.slice(0,3).map(item=><button className="recent-row" key={item.id} onClick={()=>onOpenRaw(item.id)}><span className="entry-icon"><Icon name="file"/></span><span className="recent-copy"><b>{item.title}</b><small>{sourceLabels[item.sourceType]} · {item.sourceName}</small></span><time>{dateText(item.importedAt)}</time></button>)}{!items.length && <p>暂无导入资料。</p>}</div></div>
    </section><div className="home-workspace-side">
      <section className="panel home-a-overview"><div className="panel-heading"><h2>工作区概览</h2></div><div className="stats-grid home-a-metrics" aria-label="知识库统计">{cards.map(card=><button key={card.label} className="stat-card" title={card.detail} data-tone={card.value > 0 && card.label === '待审核' ? 'accent' : card.value > 0 && card.label === 'Open Audit' ? 'warning' : 'neutral'} onClick={()=>card.action?.()} disabled={!card.action}><span className="stat-label">{card.label}</span><strong>{card.value}</strong></button>)}</div></section>
    <section className="panel home-quick-actions"><div className="panel-heading"><div><h2>更多工具</h2><p>其他知识与 Prompt 操作</p></div></div><div className="quick-action-grid"><button className="secondary-button" onClick={onGenerateFromRaw}>从 Raw 生成 Wiki 草稿</button><button className="secondary-button" onClick={onCreateWiki}>手动创建 Wiki</button><button className="secondary-button" onClick={onCreatePrompt}>新建 Prompt</button><button className="secondary-button" onClick={onLint}>检查知识库</button></div></section>
    </div></div>
  </div>;
}
