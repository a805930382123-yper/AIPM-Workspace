import type {RawCitationTarget} from './components/WikiQuestionPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeAction } from '../services/home/actions';
import type { ExtractionJob, Raw, RawProcessingState, Stats } from './api';
import { api, extractionJob, rawProcessing } from './api';
import { HomePage } from './pages/HomePage';
import { RawPage } from './pages/RawPage';
import { WikiPage } from './pages/WikiPage';
import { SettingsPage } from './pages/SettingsPage';
import { DraftReviewPage } from './pages/DraftReviewPage';
import { KnowledgeWorkflowPage } from './pages/KnowledgeWorkflowPage';
import { PromptLibraryPage } from './pages/PromptLibraryPage';
import { MeetingPage } from './pages/MeetingPage';
import { WorkItemsPage } from './pages/WorkItemsPage';
import { Icon } from './components/Icon';
import { RecoveryNotice } from './components/RecoveryNotice';

type Page = 'home' | 'wiki' | 'raw' | 'prompt' | 'settings' | 'meeting' | 'work';
const emptyStats: Stats = { rawCount: 0, wikiCount: 0, thisWeekNewCount: 0, pendingConfirmationCount: 0, openAuditCount: 0, promptCount: 0, weekStartsOn: '' };

export function App() {
  const [rawCitation,setRawCitation]=useState<RawCitationTarget|null>(null);
  const [rawOriginal, setRawOriginal] = useState(false);
  const [page, setPage] = useState<Page>('home');
  const [raws, setRaws] = useState<Raw[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [processing, setProcessing] = useState<RawProcessingState[]>([]);
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);
  const [pendingAudit, setPendingAudit] = useState<{wikiId:string;auditId:string;revision:number;wikiRevision:number}|null>(null);
  const [pendingWikiId, setPendingWikiId] = useState<string | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [meetingCreate, setMeetingCreate] = useState(false);
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobPollGeneration, setJobPollGeneration] = useState(0);
  const [homeActionsRevision, setHomeActionsRevision] = useState(0);
  const [workItemsRevision, setWorkItemsRevision] = useState(0);
  const [workItemId, setWorkItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const refreshGeneration = useRef(0);
  const rawSelectionGeneration = useRef(0);
  const rawSelectionRef = useRef<string | null>(null);
  const explicitRawTarget = useRef<string | null>(null);
  const pageGeneration = useRef(0);
  const extractIntent = useRef<{jobId:string;rawId:string;pageGeneration:number;selectionGeneration?:number} | null>(null);

  const commitRawSelection = (id: string | null) => {
    rawSelectionRef.current = id;
    setSelectedRawId(id);
  };

  const selectRaw = (id: string | null) => {
    explicitRawTarget.current = null;
    rawSelectionGeneration.current += 1;
    commitRawSelection(id);
  };

  const refresh = async (preferredRawId?: string, preserveMissingTarget = false) => {
    const generation = ++refreshGeneration.current;
    const selectionGeneration = rawSelectionGeneration.current;
    const targetRawId = explicitRawTarget.current ?? (preferredRawId === undefined ? rawSelectionRef.current : preferredRawId);
    const preserveMissing = explicitRawTarget.current !== null || preserveMissingTarget;
    setLoadError('');
    try {
      const [raw, totals, states] = await Promise.all([api<{items: Raw[]}>('/api/raw'), api<Stats>('/api/stats'), rawProcessing()]);
      if (generation !== refreshGeneration.current) return;
      setRaws(raw.items); setStats(totals); setProcessing(states);
      if (selectionGeneration === rawSelectionGeneration.current) {
        if (targetRawId && raw.items.some(item => item.id === targetRawId)) commitRawSelection(targetRawId);
        else if (preserveMissing) commitRawSelection(targetRawId ?? null);
        else commitRawSelection(raw.items[0]?.id ?? null);
      }
    } catch (e) { if (generation === refreshGeneration.current) setLoadError(e instanceof Error ? e.message : '无法连接本地服务。'); }
    finally { if (generation === refreshGeneration.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  // B04: while any Raw is being processed, poll its job so the progress is real, and refresh
  // the lists as soon as it settles. Also picks up a job that was already running on reload.
  const observedJobId = activeJobId ?? processing.find(state => state.recoveryJobId)?.recoveryJobId ?? processing.find(state => state.status === 'processing' && state.jobId)?.jobId ?? null;
  useEffect(() => {
    if (!observedJobId) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const next = await extractionJob(observedJobId);
        if (!active) return;
        setJob(next);
        if (next.execution ? next.execution === 'settled' : next.status !== 'running') {
          clearInterval(timer);
          setActiveJobId(null);
          setHomeActionsRevision(value => value + 1);
          await refresh();
          const intent = extractIntent.current;
          if (!next.recovery && next.status === 'completed' && next.draftId && intent?.jobId === next.jobId && intent.pageGeneration === pageGeneration.current && (intent.selectionGeneration === undefined || intent.selectionGeneration === rawSelectionGeneration.current) && ['raw', 'wiki'].includes(page) && (page !== 'raw' || rawSelectionRef.current === next.rawId)) { setReviewDraftId(next.draftId); extractIntent.current = null; }
        }
      } catch { /* a transient read error must not stop the UI */ }
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [observedJobId, page, jobPollGeneration]);

  const nav = (destination: Page, preferredRawId?: string) => {
    setRawCitation(null);
    setRawOriginal(false);
    setWorkItemId(null);
    pageGeneration.current += 1;
    setPendingAudit(null);
    setPage(destination); setOpenImport(false); setMeetingCreate(false); setReviewDraftId(null); setWorkflowId(null);
    rawSelectionGeneration.current += 1;
    explicitRawTarget.current = destination === 'raw' && preferredRawId !== undefined ? preferredRawId : null;
    if (explicitRawTarget.current !== null) commitRawSelection(explicitRawTarget.current);
    if (destination === 'home' || destination === 'raw' || destination === 'work') void refresh(preferredRawId, preferredRawId !== undefined);
  };
  const handleJobStarted = (started: ExtractionJob, requestedPageGeneration = pageGeneration.current, requestedSelectionGeneration?: number) => {
    setJobPollGeneration(value => value + 1);
    setJob(started); setActiveJobId(started.jobId);
    if (requestedPageGeneration !== pageGeneration.current || (requestedSelectionGeneration !== undefined && requestedSelectionGeneration !== rawSelectionGeneration.current)) { extractIntent.current = null; return; }
    extractIntent.current = { jobId: started.jobId, rawId: started.rawId, pageGeneration: requestedPageGeneration, ...(requestedSelectionGeneration === undefined ? {} : { selectionGeneration: requestedSelectionGeneration }) };
    if (!started.recovery && started.status === 'completed' && started.draftId) { setReviewDraftId(started.draftId); extractIntent.current = null; }
  };
  const openHomeAction = (item:HomeAction) => {
    const target=item.target;
    if(item.kind==='raw-task' && target.rawId) nav('raw',target.rawId);
    else if(item.kind==='draft' && target.draftId) { nav('home'); setReviewDraftId(target.draftId); }
    else if(item.kind==='workflow' && target.workflowId) { nav('home'); setWorkflowId(target.workflowId); }
    else if(item.kind==='audit' && target.wikiId && target.auditId && target.revision && target.wikiRevision) { nav('wiki'); setPendingWikiId(target.wikiId); setPendingAudit({wikiId:target.wikiId,auditId:target.auditId,revision:target.revision,wikiRevision:target.wikiRevision}); }
  };
  const clearPendingWikiId = useCallback(() => setPendingWikiId(null), []);
  const pageTitle = page === 'home' ? '首页' : page === 'raw' ? 'Raw 原始资料' : page === 'prompt' ? 'Prompt 工作台' : page === 'settings' ? '设置' : page === 'meeting' ? '会议档案' : page === 'work' ? '工作事项' : '知识库';
  const processingById: Record<string, RawProcessingState> = Object.fromEntries(processing.map(state => [state.rawId, state]));
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">F</span><span>快消 AI 工作台<small>FMCG PM WORKSPACE</small></span></div>
      <div className="nav-caption">工作空间</div>
      <nav aria-label="主导航">
        <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={() => nav('home')}><Icon name="home" />首页</button>
        <button className={`nav-item ${page === 'work' ? 'active' : ''}`} onClick={() => nav('work')}><Icon name="file" />工作事项</button>
        <button className={`nav-item ${page === 'wiki' ? 'active' : ''}`} onClick={() => nav('wiki')}><Icon name="book" />知识库</button>
        <button className={`nav-item ${page === 'raw' ? 'active' : ''}`} onClick={() => nav('raw')}><Icon name="file" />Raw 原始资料</button>
        <button className={`nav-item ${page === 'meeting' ? 'active' : ''}`} onClick={() => nav('meeting')}><Icon name="calendar" />会议档案</button>
        <button className={`nav-item ${page === 'prompt' ? 'active' : ''}`} onClick={() => nav('prompt')}><Icon name="code" />Prompt 工作台</button>
      </nav>
      <div className="sidebar-bottom"><div className="nav-caption">偏好</div><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => nav('settings')}><Icon name="settings" />设置</button><div className="local-state"><i />数据保存在本机</div></div>
    </aside>
    <main className="main"><RecoveryNotice />
      <header className="topbar"><div className="breadcrumb">工作空间 <span>/</span> {reviewDraftId ? 'AI 知识整理预览' : pageTitle}</div><div className="local-badge"><i />本地工作区</div></header>
      {loadError && <div className="global-error" role="alert">{loadError}<button onClick={() => void refresh()}>重新连接</button></div>}
      {workflowId ? <KnowledgeWorkflowPage workflowId={workflowId} onBack={() => setWorkflowId(null)} onDone={async () => { setWorkflowId(null); await refresh(); }} /> : reviewDraftId
        ? <DraftReviewPage key={reviewDraftId} draftId={reviewDraftId} onBack={() => setReviewDraftId(null)} onCommitted={refresh} onOpenWorkflow={setWorkflowId} onOpenWiki={id=>{setPendingWikiId(id);nav('wiki');}} onOpenRaw={(id,target) => { setReviewDraftId(null); nav('raw', id);setRawCitation(target??null); }} />
        : <>
          {page === 'home' && <HomePage actionsRevision={homeActionsRevision} workItemsRevision={workItemsRevision} onOpenWorkItem={id => { nav('work'); setWorkItemId(id); }} onOpenAction={openHomeAction} onCreateMeeting={() => { nav('meeting'); setMeetingCreate(true); }} stats={stats} items={raws} onOpenRaw={id => nav('raw', id)} onOpenWiki={id => { setPendingWikiId(id ?? null); nav('wiki'); }} onOpenPrompt={() => nav('prompt')} onImport={() => { nav('raw'); setOpenImport(true); }} onCreateWiki={() => { nav('wiki'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:new')), 0); }} onCreatePrompt={() => { nav('prompt'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:new')), 0); }} onGeneratePrompt={() => { nav('prompt'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:generator')), 0); }} onLint={() => { nav('wiki'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:lint')), 0); }} onOpenWorkflow={setWorkflowId} onGenerateFromRaw={() => { nav('wiki'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:generate')), 0); }} />}
          {page === 'work' && <WorkItemsPage key={pageGeneration.current} initialId={workItemId} raws={raws} onOpenRaw={id => { nav('raw', id); setRawOriginal(true); }} onChanged={() => setWorkItemsRevision(value => value + 1)} />}
          {page === 'raw' && <RawPage initialOriginal={rawOriginal} initialCitation={rawCitation} items={raws} selectedId={selectedRawId} onSelected={id=>{setRawCitation(null);setRawOriginal(false);selectRaw(id);}} onOpenImport={() => setOpenImport(true)} onCommitted={async raw => { setRaws(previous => previous.some(item => item.id === raw.id) ? previous : [raw, ...previous]); await refresh(); }} openImport={openImport} onCloseImport={() => setOpenImport(false)} onDeleted={async id => { setRaws(previous => previous.filter(item => item.id !== id)); if (selectedRawId === id) selectRaw(null); await refresh(); }} processing={processingById} job={job} onJobStarted={handleJobStarted} navigationGeneration={pageGeneration.current} selectionGeneration={rawSelectionGeneration.current} onOpenDraft={setReviewDraftId} onOpenWorkflow={setWorkflowId} onRefresh={refresh} />}
          {page === 'wiki' && <WikiPage onInitialAuditHandled={()=>setPendingAudit(null)} initialAudit={pendingAudit} onOpenRaw={(id,target)=>{nav('raw',id);setRawCitation(target??null);}} onChanged={refresh} initialOpenId={pendingWikiId} onInitialOpenHandled={clearPendingWikiId} processing={processingById} onJobStarted={handleJobStarted} navigationGeneration={pageGeneration.current} onOpenDraft={setReviewDraftId} onOpenWorkflow={setWorkflowId} onImport={() => { nav('raw'); setOpenImport(true); }} />}
          {page === 'prompt' && <PromptLibraryPage onChanged={refresh} onOpenWiki={() => nav('wiki')} />}
          {page === 'meeting' && <MeetingPage initialCreate={meetingCreate} onRawChanged={refresh} onOpenRaw={id => nav('raw', id)} />}
          {page === 'settings' && <SettingsPage onImported={refresh} onOpenExampleTask={task => { nav('prompt'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:generator', { detail: { task } })), 0); }} />}
        </>}
      {loading && page === 'home' && <span className="loading-note">正在读取本机资料…</span>}
    </main>
  </div>;
}
