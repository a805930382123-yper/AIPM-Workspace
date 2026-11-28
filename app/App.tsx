import type { RawCitationTarget } from './components/WikiQuestionPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeAction } from '../services/home/actions';
import type { CandidateFilter, ExtractionJob, Raw, RawProcessingState, Stats, WeeklyReviewTarget } from './api';
import { api, extractionJob, rawProcessing } from './api';
import { useLatestAsync } from './hooks/useLatestAsync';
import { type AppPage } from './router/routes';
import { useAppRoute } from './router/useAppRoute';
import { HomePage } from './pages/HomePage';
import { NewsPage } from './pages/NewsPage';
import { RawPage } from './pages/RawPage';
import { WikiPage, type WikiCheckEntry } from './pages/WikiPage';
import { SettingsPage } from './pages/SettingsPage';
import { DraftReviewPage } from './pages/DraftReviewPage';
import { KnowledgeWorkflowPage } from './pages/KnowledgeWorkflowPage';
import { PromptLibraryPage } from './pages/PromptLibraryPage';
import { MeetingPage } from './pages/MeetingPage';
import { WorkItemsPage } from './pages/WorkItemsPage';
import { AutomationPage } from './pages/AutomationPage';
import { ProductBlueprintPage } from './pages/ProductBlueprintPage';
import type { AutomationTab } from './components/automation/automationMeta';
import { Icon } from './components/Icon';
import { Brand } from './components/Brand';
import { RecoveryNotice } from './components/RecoveryNotice';
import { QuickCaptureDialog } from './components/QuickCaptureDialog';

const emptyStats: Stats = {
  rawCount: 0,
  wikiCount: 0,
  thisWeekNewCount: 0,
  pendingConfirmationCount: 0,
  openAuditCount: 0,
  promptCount: 0,
  weekStartsOn: '',
};

export function App() {
  const { page, pageTitle, navigationGeneration, getNavigationGeneration, navigate: navigateRoute } = useAppRoute();
  const [rawCitation, setRawCitation] = useState<RawCitationTarget | null>(null);
  const [rawOriginal, setRawOriginal] = useState(false);
  const blueprintDirty = useRef(false);
  const blueprintBusy = useRef(false);
  const setBlueprintBusy = useCallback((busy: boolean) => {
    blueprintBusy.current = busy;
  }, []);
  const blueprintUrl = useRef('');
  const setBlueprintDirty = useCallback((dirty: boolean) => {
    blueprintDirty.current = dirty;
    if (dirty) blueprintUrl.current = window.location.pathname + window.location.search + window.location.hash;
  }, []);
  useEffect(() => {
    const guard = (event: PopStateEvent) => {
      if (page === 'blueprint' && blueprintBusy.current) {
        event.stopImmediatePropagation();
        window.history.pushState(
          { ...window.history.state, appPage: 'blueprint' },
          '',
          blueprintUrl.current || window.location.pathname,
        );
        return;
      }
      if (page !== 'blueprint' || !blueprintDirty.current) return;
      if (window.confirm('存在未保存的修改，确定离开产品构想吗？')) {
        blueprintDirty.current = false;
      } else {
        event.stopImmediatePropagation();
        window.history.pushState({ ...window.history.state, appPage: 'blueprint' }, '', blueprintUrl.current);
      }
    };
    window.addEventListener('popstate', guard, true);
    return () => window.removeEventListener('popstate', guard, true);
  }, [page]);
  const [pipelineEntry, setPipelineEntry] = useState<CandidateFilter>();
  const [raws, setRaws] = useState<Raw[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [processing, setProcessing] = useState<RawProcessingState[]>([]);
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);
  const [pendingAudit, setPendingAudit] = useState<{
    wikiId: string;
    auditId: string;
    revision: number;
    wikiRevision: number;
  } | null>(null);
  const [pendingWikiId, setPendingWikiId] = useState<string | null>(null);
  const [wikiCheckEntry, setWikiCheckEntry] = useState<WikiCheckEntry | null>(null);
  const [openImport, setOpenImport] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [meetingCreate, setMeetingCreate] = useState(false);
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobPollGeneration, setJobPollGeneration] = useState(0);
  const [homeActionsRevision, setHomeActionsRevision] = useState(0);
  const [workItemsRevision, setWorkItemsRevision] = useState(0);
  const [workItemTarget, setWorkItemTarget] = useState<{ id: string; focusMaterials: boolean } | null>(null);
  const [focusReminders, setFocusReminders] = useState(false);
  const [weeklyReviewWeekKey, setWeeklyReviewWeekKey] = useState<string>();
  const [automationRunEntry, setAutomationRunEntry] = useState<string>();
  const [automationTabEntry, setAutomationTabEntry] = useState<AutomationTab>();
  const [initialLoading, setInitialLoading] = useState(true);
  const [rawSelectionGeneration, setRawSelectionGeneration] = useState(0);
  const rawSelectionGenerationRef = useRef(0);
  const rawSelectionRef = useRef<string | null>(null);
  const explicitRawTarget = useRef<string | null>(null);
  const extractIntent = useRef<{
    jobId: string;
    rawId: string;
    pageGeneration: number;
    selectionGeneration?: number;
  } | null>(null);

  const { error: loadError, run: runRefresh } = useLatestAsync<void>({
    formatError: (e) => (e instanceof Error ? e.message : '无法连接本地服务。'),
  });

  const bumpRawSelectionGeneration = useCallback(() => {
    rawSelectionGenerationRef.current += 1;
    setRawSelectionGeneration(rawSelectionGenerationRef.current);
    return rawSelectionGenerationRef.current;
  }, []);

  const commitRawSelection = useCallback((id: string | null) => {
    rawSelectionRef.current = id;
    setSelectedRawId(id);
  }, []);

  const selectRaw = useCallback(
    (id: string | null) => {
      explicitRawTarget.current = null;
      bumpRawSelectionGeneration();
      commitRawSelection(id);
    },
    [bumpRawSelectionGeneration, commitRawSelection],
  );

  const refresh = useCallback(
    async (preferredRawId?: string, preserveMissingTarget = false) => {
      const selectionGeneration = rawSelectionGenerationRef.current;
      const targetRawId =
        explicitRawTarget.current ?? (preferredRawId === undefined ? rawSelectionRef.current : preferredRawId);
      const preserveMissing = explicitRawTarget.current !== null || preserveMissingTarget;
      let settled = false;
      await runRefresh(async ({ signal, isCurrent }) => {
        try {
          const [raw, totals, states] = await Promise.all([
            api<{ items: Raw[] }>('/api/raw', { signal }),
            api<Stats>('/api/stats', { signal }),
            rawProcessing(),
          ]);
          if (!isCurrent()) return;
          setRaws(raw.items);
          setStats(totals);
          setProcessing(states);
          if (selectionGeneration === rawSelectionGenerationRef.current) {
            if (targetRawId && raw.items.some((item) => item.id === targetRawId)) commitRawSelection(targetRawId);
            else if (preserveMissing) commitRawSelection(targetRawId ?? null);
            else commitRawSelection(raw.items[0]?.id ?? null);
          }
          settled = true;
        } catch (error) {
          if (isCurrent()) settled = true;
          throw error;
        }
      });
      if (settled) setInitialLoading(false);
    },
    [commitRawSelection, runRefresh],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== 'n') return;
      const active = document.activeElement;
      if (active?.matches('input, textarea, select') || (active instanceof HTMLElement && active.isContentEditable))
        return;
      if (quickCaptureOpen || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setQuickCaptureOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickCaptureOpen]);

  const onRawCaptured = async (raw: Raw) => {
    setRaws((previous) => (previous.some((item) => item.id === raw.id) ? previous : [raw, ...previous]));
    await refresh();
  };

  // B04: while any Raw is being processed, poll its job so the progress is real, and refresh
  // the lists as soon as it settles. Also picks up a job that was already running on reload.
  const observedJobId =
    activeJobId ??
    processing.find((state) => state.recoveryJobId)?.recoveryJobId ??
    processing.find((state) => state.status === 'processing' && state.jobId)?.jobId ??
    null;
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
          setHomeActionsRevision((value) => value + 1);
          await refresh();
          const intent = extractIntent.current;
          if (
            !next.recovery &&
            next.status === 'completed' &&
            next.draftId &&
            intent?.jobId === next.jobId &&
            intent.pageGeneration === getNavigationGeneration() &&
            (intent.selectionGeneration === undefined ||
              intent.selectionGeneration === rawSelectionGenerationRef.current) &&
            ['raw', 'wiki'].includes(page) &&
            (page !== 'raw' || rawSelectionRef.current === next.rawId)
          ) {
            setReviewDraftId(next.draftId);
            extractIntent.current = null;
          }
        }
      } catch {
        /* a transient read error must not stop the UI */
      }
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [observedJobId, page, jobPollGeneration, refresh, getNavigationGeneration]);

  const nav = (destination: AppPage, preferredRawId?: string) => {
    if (page === 'blueprint' && destination !== 'blueprint' && blueprintBusy.current) return;
    if (
      page === 'blueprint' &&
      destination !== 'blueprint' &&
      blueprintDirty.current &&
      !window.confirm('存在未保存的修改，确定离开产品构想吗？')
    )
      return;
    if (destination !== 'blueprint') blueprintDirty.current = false;
    navigateRoute(destination);
    setPipelineEntry(undefined);
    setRawCitation(null);
    setRawOriginal(false);
    setWorkItemTarget(null);
    setFocusReminders(false);
    setWeeklyReviewWeekKey(undefined);
    setAutomationRunEntry(undefined);
    setAutomationTabEntry(undefined);
    setPendingAudit(null);
    setWikiCheckEntry(null);
    setOpenImport(false);
    setMeetingCreate(false);
    setReviewDraftId(null);
    setWorkflowId(null);
    bumpRawSelectionGeneration();
    explicitRawTarget.current = destination === 'raw' && preferredRawId !== undefined ? preferredRawId : null;
    if (explicitRawTarget.current !== null) commitRawSelection(explicitRawTarget.current);
    if (destination === 'home' || destination === 'raw' || destination === 'work')
      void refresh(preferredRawId, preferredRawId !== undefined);
  };
  const openWikiCheck = (entry: WikiCheckEntry) => {
    nav('wiki');
    setPendingWikiId(null);
    setWikiCheckEntry(entry);
  };
  const openWikiLint = () => openWikiCheck({ view: 'lint' });
  const openWikiInspection = (inspectionId?: string) => openWikiCheck({ view: 'active-check', inspectionId });
  const openWorkItem = (id: string, focusMaterials = false) => {
    nav('work');
    setWorkItemTarget({ id, focusMaterials });
  };
  const openReminders = () => {
    nav('automation');
    setFocusReminders(true);
  };
  const openWeeklyReview = (weekKey: string) => {
    nav('home');
    setWeeklyReviewWeekKey(weekKey);
  };
  const openReviewReference = ({ kind, id }: WeeklyReviewTarget) => {
    if (kind === 'wiki') {
      nav('wiki');
      setPendingWikiId(id);
    } else if (kind === 'work') openWorkItem(id);
    else if (kind === 'raw') nav('raw', id);
    else if (kind === 'inspection') openWikiInspection(id);
    else if (kind === 'run' || kind === 'lint') {
      nav('automation');
      setAutomationRunEntry(id);
    }
  };
  const handleJobStarted = (
    started: ExtractionJob,
    requestedPageGeneration = getNavigationGeneration(),
    requestedSelectionGeneration?: number,
  ) => {
    setJobPollGeneration((value) => value + 1);
    setJob(started);
    setActiveJobId(started.jobId);
    if (
      requestedPageGeneration !== getNavigationGeneration() ||
      (requestedSelectionGeneration !== undefined && requestedSelectionGeneration !== rawSelectionGenerationRef.current)
    ) {
      extractIntent.current = null;
      return;
    }
    extractIntent.current = {
      jobId: started.jobId,
      rawId: started.rawId,
      pageGeneration: requestedPageGeneration,
      ...(requestedSelectionGeneration === undefined ? {} : { selectionGeneration: requestedSelectionGeneration }),
    };
    if (!started.recovery && started.status === 'completed' && started.draftId) {
      setReviewDraftId(started.draftId);
      extractIntent.current = null;
    }
  };
  const openHomeAction = (item: HomeAction) => {
    const target = item.target;
    if (item.kind === 'raw-task' && target.rawId) nav('raw', target.rawId);
    else if (item.kind === 'draft' && target.draftId) {
      nav('home');
      setReviewDraftId(target.draftId);
    } else if (item.kind === 'workflow' && target.workflowId) {
      nav('home');
      setWorkflowId(target.workflowId);
    } else if (item.kind === 'audit' && target.wikiId && target.auditId && target.revision && target.wikiRevision) {
      nav('wiki');
      setPendingWikiId(target.wikiId);
      setPendingAudit({
        wikiId: target.wikiId,
        auditId: target.auditId,
        revision: target.revision,
        wikiRevision: target.wikiRevision,
      });
    }
  };
  const clearPendingWikiId = useCallback(() => setPendingWikiId(null), []);
  const currentBreadcrumb = workflowId ? '更新与综合审阅' : reviewDraftId ? 'AI 知识整理预览' : pageTitle;
  const canBreadcrumbBack = Boolean(workflowId || reviewDraftId || page === 'news');
  const handleBreadcrumbBack = () => {
    if (workflowId) setWorkflowId(null);
    else if (reviewDraftId) setReviewDraftId(null);
    else if (page === 'news') nav('home');
  };
  const draftBackLabel =
    page === 'home' ? '返回工作台' : page === 'automation' ? '返回自动化' : page === 'wiki' ? '返回知识库' : '返回 Raw';
  const processingById: Record<string, RawProcessingState> = Object.fromEntries(
    processing.map((state) => [state.rawId, state]),
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-caption">工作空间</div>
        <nav aria-label="主导航">
          <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={() => nav('home')}>
            <Icon name="home" />
            首页
          </button>
          <button className={`nav-item ${page === 'work' ? 'active' : ''}`} onClick={() => nav('work')}>
            <Icon name="work" />
            工作事项
          </button>
          <button className={`nav-item ${page === 'blueprint' ? 'active' : ''}`} onClick={() => nav('blueprint')}>
            <Icon name="blueprint" />
            产品构想
          </button>
          <button className={`nav-item ${page === 'automation' ? 'active' : ''}`} onClick={() => nav('automation')}>
            <Icon name="automation" />
            自动化
          </button>
          <button className={`nav-item ${page === 'wiki' ? 'active' : ''}`} onClick={() => nav('wiki')}>
            <Icon name="book" />
            知识库
          </button>
          <button className={`nav-item ${page === 'raw' ? 'active' : ''}`} onClick={() => nav('raw')}>
            <Icon name="file" />
            Raw 原始资料
          </button>
          <button className={`nav-item ${page === 'meeting' ? 'active' : ''}`} onClick={() => nav('meeting')}>
            <Icon name="calendar" />
            会议档案
          </button>
          <button className={`nav-item ${page === 'prompt' ? 'active' : ''}`} onClick={() => nav('prompt')}>
            <Icon name="code" />
            Prompt 工作台
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-caption">偏好</div>
          <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => nav('settings')}>
            <Icon name="settings" />
            设置
          </button>
          <div className="local-state">
            <i />
            数据保存在本机
          </div>
        </div>
      </aside>
      <main className="main">
        <RecoveryNotice />
        <header className="topbar">
          <div className="breadcrumb">
            {canBreadcrumbBack ? (
              <button type="button" className="text-button breadcrumb-back" onClick={handleBreadcrumbBack}>
                工作空间
              </button>
            ) : (
              '工作空间'
            )}{' '}
            <span>/</span> {currentBreadcrumb}
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="secondary-button topbar-capture-btn"
              title="快速捕获到 Raw（Alt+N）"
              onClick={() => setQuickCaptureOpen(true)}
            >
              快速记一条
            </button>
            <div className="local-badge">
              <i />
              本地工作区
            </div>
          </div>
        </header>
        {loadError && (
          <div className="global-error" role="alert">
            {loadError}
            <button onClick={() => void refresh()}>重新连接</button>
          </div>
        )}
        {workflowId ? (
          <KnowledgeWorkflowPage
            workflowId={workflowId}
            onBack={() => setWorkflowId(null)}
            onDone={async () => {
              setWorkflowId(null);
              await refresh();
            }}
          />
        ) : reviewDraftId ? (
          <DraftReviewPage
            key={reviewDraftId}
            draftId={reviewDraftId}
            backLabel={draftBackLabel}
            onBack={() => setReviewDraftId(null)}
            onCommitted={refresh}
            onOpenWorkflow={setWorkflowId}
            onOpenWiki={(id) => {
              setPendingWikiId(id);
              nav('wiki');
            }}
            onOpenRaw={(id, target) => {
              setReviewDraftId(null);
              nav('raw', id);
              setRawCitation(target ?? null);
            }}
          />
        ) : (
          <>
            {page === 'home' && (
              <HomePage
                initialWeekKey={weeklyReviewWeekKey}
                onOpenReviewReference={openReviewReference}
                onQuickCapture={() => setQuickCaptureOpen(true)}
                onOpenAutomation={() => nav('automation')}
                onOpenReminders={openReminders}
                onOpenPipeline={(filter) => {
                  nav('automation');
                  setPipelineEntry(filter);
                }}
                onOpenNews={() => nav('news')}
                actionsRevision={homeActionsRevision}
                workItemsRevision={workItemsRevision}
                onOpenWorkItem={openWorkItem}
                onOpenAction={openHomeAction}
                onCreateMeeting={() => {
                  nav('meeting');
                  setMeetingCreate(true);
                }}
                stats={stats}
                items={raws}
                onOpenRaw={(id) => nav('raw', id)}
                onOpenWiki={(id) => {
                  setPendingWikiId(id ?? null);
                  nav('wiki');
                }}
                onOpenPrompt={() => nav('prompt')}
                onImport={() => {
                  nav('raw');
                  setOpenImport(true);
                }}
                onCreateWiki={() => {
                  nav('wiki');
                  window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:new')), 0);
                }}
                onCreatePrompt={() => {
                  nav('prompt');
                  window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:new')), 0);
                }}
                onGeneratePrompt={() => {
                  nav('prompt');
                  window.setTimeout(() => window.dispatchEvent(new CustomEvent('prompt:generator')), 0);
                }}
                onLint={openWikiLint}
                onOpenInspection={openWikiInspection}
                onOpenWorkflow={setWorkflowId}
                onGenerateFromRaw={() => {
                  nav('wiki');
                  window.setTimeout(() => window.dispatchEvent(new CustomEvent('wiki:generate')), 0);
                }}
              />
            )}
            {page === 'automation' && (
              <AutomationPage
                initialTab={automationTabEntry}
                initialRunId={automationRunEntry}
                onOpenWeeklyReview={openWeeklyReview}
                candidateFilter={pipelineEntry}
                onOpenRaw={(id) => nav('raw', id)}
                onOpenDraft={(id, returnTab) => {
                  setAutomationTabEntry(returnTab);
                  setReviewDraftId(id);
                }}
                onOpenWiki={(id) => openReviewReference({ kind: 'wiki', id })}
                onOpenLint={openWikiLint}
                onOpenInspection={openWikiInspection}
                onOpenWorkItem={openWorkItem}
                focusReminders={focusReminders}
              />
            )}
            {page === 'news' && (
              <NewsPage
                onBack={() => nav('home')}
                onRawChanged={refresh}
                onOpenDraft={setReviewDraftId}
                onOpenWiki={(id) => openReviewReference({ kind: 'wiki', id })}
                onOpenRaw={(id) => {
                  nav('raw', id);
                  setRawOriginal(true);
                }}
              />
            )}
            {page === 'work' && (
              <WorkItemsPage
                key={navigationGeneration}
                initialId={workItemTarget?.id ?? null}
                initialFocusMaterials={workItemTarget?.focusMaterials}
                raws={raws}
                onOpenRaw={(id) => {
                  nav('raw', id);
                  setRawOriginal(true);
                }}
                onChanged={() => setWorkItemsRevision((value) => value + 1)}
              />
            )}
            {page === 'blueprint' && (
              <ProductBlueprintPage
                onDirtyChange={setBlueprintDirty}
                onBusyChange={setBlueprintBusy}
                onOpenRaw={(id) => {
                  nav('raw', id);
                  setRawOriginal(true);
                }}
              />
            )}
            {page === 'raw' && (
              <RawPage
                initialOriginal={rawOriginal}
                initialCitation={rawCitation}
                items={raws}
                selectedId={selectedRawId}
                onSelected={(id) => {
                  setRawCitation(null);
                  setRawOriginal(false);
                  selectRaw(id);
                }}
                onOpenImport={() => setOpenImport(true)}
                onCommitted={onRawCaptured}
                onBodySaved={(raw) => {
                  setRaws((previous) => previous.map((item) => (item.id === raw.id ? raw : item)));
                  void refresh();
                }}
                openImport={openImport}
                onCloseImport={() => setOpenImport(false)}
                onDeleted={async (id) => {
                  setRaws((previous) => previous.filter((item) => item.id !== id));
                  if (selectedRawId === id) selectRaw(null);
                  await refresh();
                }}
                processing={processingById}
                job={job}
                onJobStarted={handleJobStarted}
                navigationGeneration={navigationGeneration}
                selectionGeneration={rawSelectionGeneration}
                onOpenDraft={setReviewDraftId}
                onOpenWorkflow={setWorkflowId}
                onRefresh={refresh}
              />
            )}
            {page === 'wiki' && (
              <WikiPage
                onInitialAuditHandled={() => setPendingAudit(null)}
                initialAudit={pendingAudit}
                initialCheck={wikiCheckEntry}
                onOpenRaw={(id, target) => {
                  nav('raw', id);
                  setRawCitation(target ?? null);
                }}
                onChanged={refresh}
                initialOpenId={pendingWikiId}
                onInitialOpenHandled={clearPendingWikiId}
                processing={processingById}
                onJobStarted={handleJobStarted}
                navigationGeneration={navigationGeneration}
                onOpenDraft={setReviewDraftId}
                onOpenWorkflow={setWorkflowId}
                onImport={() => {
                  nav('raw');
                  setOpenImport(true);
                }}
              />
            )}
            {page === 'prompt' && <PromptLibraryPage onChanged={refresh} onOpenWiki={() => nav('wiki')} />}
            {page === 'meeting' && (
              <MeetingPage initialCreate={meetingCreate} onRawChanged={refresh} onOpenRaw={(id) => nav('raw', id)} />
            )}
            {page === 'settings' && (
              <SettingsPage
                onImported={refresh}
                onOpenExampleTask={(task) => {
                  nav('prompt');
                  window.setTimeout(
                    () => window.dispatchEvent(new CustomEvent('prompt:generator', { detail: { task } })),
                    0,
                  );
                }}
              />
            )}
          </>
        )}
        {initialLoading && page === 'home' && <span className="loading-note">正在读取本机资料…</span>}
        {quickCaptureOpen && (
          <QuickCaptureDialog
            onClose={() => setQuickCaptureOpen(false)}
            onCaptured={onRawCaptured}
            onOpenRaw={(id) => nav('raw', id)}
          />
        )}
      </main>
    </div>
  );
}
