import { useCallback, useEffect, useRef, useState } from 'react';
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

type Page = 'home' | 'wiki' | 'raw' | 'prompt' | 'settings' | 'meeting';
const emptyStats: Stats = { rawCount: 0, wikiCount: 0, thisWeekNewCount: 0, pendingConfirmationCount: 0, openAuditCount: 0, promptCount: 0, weekStartsOn: '' };

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [raws, setRaws] = useState<Raw[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [processing, setProcessing] = useState<RawProcessingState[]>([]);
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);
  const [pendingWikiId, setPendingWikiId] = useState<string | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const refreshGeneration = useRef(0);
  const rawSelectionGeneration = useRef(0);
  const rawSelectionRef = useRef<string | null>(null);
  const explicitRawTarget = useRef<string | null>(null);

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
  const observedJobId = activeJobId ?? processing.find(state => state.status === 'processing' && state.jobId)?.jobId ?? null;
  useEffect(() => {
    if (!observedJobId) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const next = await extractionJob(observedJobId);
        if (!active) return;
        setJob(next);
        if (next.status !== 'running') { setActiveJobId(null); await refresh(); }
      } catch { /* a transient read error must not stop the UI */ }
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [observedJobId]);

  const nav = (destination: Page, preferredRawId?: string) => {
    setPage(destination); setOpenImport(false); if (destination !== 'raw') setReviewDraftId(null);
    rawSelectionGeneration.current += 1;
    explicitRawTarget.current = destination === 'raw' && preferredRawId !== undefined ? preferredRawId : null;
    if (explicitRawTarget.current !== null) commitRawSelection(explicitRawTarget.current);
    if (destination === 'home' || destination === 'raw') void refresh(preferredRawId, preferredRawId !== undefined);
  };
  const clearPendingWikiId = useCallback(() => setPendingWikiId(null), []);
  const pageTitle = page === 'home' ? '首页' : page === 'raw' ? 'Raw 原始资料' : page === 'prompt' ? 'Prompt 工作台' : page === 'settings' ? '设置' : page === 'meeting' ? '会议档案' : '知识库';
  const processingById: Record<string, RawProcessingState> = Object.fromEntries(processing.map(state => [state.rawId, state]));
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">F</span><span>快消 AI 工作台<small>FMCG PM WORKSPACE</small></span></div>
      <div className="nav-caption">工作空间</div>
      <nav aria-label="主导航">
        <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={() => nav('home')}><span className="nav-icon">⌂</span>首页</button>
        <button className={`nav-item ${page === 'wiki' ? 'active' : ''}`} onClick={() => nav('wiki')}><span className="nav-icon">▤</span>知识库</button>
        <button className={`nav-item ${page === 'raw' ? 'active' : ''}`} onClick={() => nav('raw')}><span className="nav-icon">▧</span>Raw 原始资料</button>
        <button className={`nav-item ${page === 'meeting' ? 'active' : ''}`} onClick={() => nav('meeting')}><span className="nav-icon">▣</span>会议档案</button>
        <button className={`nav-item ${page === 'prompt' ? 'active' : ''}`} onClick={() => nav('prompt')}><span className="nav-icon">✳</span>Prompt 工作台</button>
      </nav>
      <div className="sidebar-bottom"><div className="nav-caption">偏好</div><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => nav('settings')}><span className="nav-icon">⚙</span>设置</button><div className="local-state"><i />数据保存在本机</div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">工作空间 <span>/</span> {reviewDraftId ? 'AI 知识整理预览' : pageTitle}</div><div className="local-badge"><i />本地工作区</div></header>
      {loadError && <div className="global-error" role="alert">{loadError}<button onClick={() => void refresh()}>重新连接</button></div>}
      {workflowId ? <KnowledgeWorkflowPage workflowId={workflowId} onBack={() => setWorkflowId(null)} onDone={async () => { setWorkflowId(null); await refresh(); }} /> : reviewDraftId
        ? <DraftReviewPage draftId={reviewDraftId} onBack={() => setReviewDraftId(null)} onCommitted={refresh} onOpenWorkflow={setWorkflowId} onOpenRaw={id => { setReviewDraftId(null); nav('raw', id); }} />
        : <>
          {page === 'home' && <HomePage stats={stats} items={raws} onOpenRaw={id => nav('raw', id)} onOpenWiki={id => { setPendingWikiId(id ?? null); nav('wiki'); }} onOpenPrompt={() => nav('prompt')} onImport={() => { nav('raw'); setOpenImport(true); }} onCreateWiki={() => { nav('wiki'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:new')), 0); }} onCreatePrompt={() => { nav('prompt'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:new')), 0); }} onGeneratePrompt={() => { nav('prompt'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:generator')), 0); }} onLint={() => { nav('wiki'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:lint')), 0); }} />}
          {page === 'raw' && <RawPage items={raws} selectedId={selectedRawId} onSelected={selectRaw} onOpenImport={() => setOpenImport(true)} onCommitted={async raw => { setRaws(previous => previous.some(item => item.id === raw.id) ? previous : [raw, ...previous]); await refresh(); }} openImport={openImport} onCloseImport={() => setOpenImport(false)} onDeleted={async id => { setRaws(previous => previous.filter(item => item.id !== id)); if (selectedRawId === id) selectRaw(null); await refresh(); }} processing={processingById} job={job} onJobStarted={started => { setJob(started); setActiveJobId(started.jobId); }} onOpenDraft={setReviewDraftId} onOpenWorkflow={setWorkflowId} onRefresh={refresh} />}
          {page === 'wiki' && <WikiPage onOpenRaw={id => nav('raw', id)} onChanged={refresh} initialOpenId={pendingWikiId} onInitialOpenHandled={clearPendingWikiId} />}
          {page === 'prompt' && <PromptLibraryPage onChanged={refresh} onOpenWiki={() => nav('wiki')} />}
          {page === 'meeting' && <MeetingPage onRawChanged={refresh} onOpenRaw={id => nav('raw', id)} />}
          {page === 'settings' && <SettingsPage onImported={refresh} onOpenExampleTask={task => { nav('prompt'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:generator', { detail: { task } })), 0); }} />}
        </>}
      {loading && page === 'home' && <span className="loading-note">正在读取本机资料…</span>}
    </main>
  </div>;
}
