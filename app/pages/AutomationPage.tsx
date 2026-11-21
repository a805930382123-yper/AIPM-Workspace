import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  AutomationList,
  AutomationPlan,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationStatus,
  CandidateFilter,
  CandidateList,
  CandidateView,
  ConfirmCandidates,
  KnowledgeHealth,
  KnowledgeInspection,
  PipelineSettings,
  ReminderSettings,
  ReminderView,
  WeeklyReviewList,
  WikiLintSnapshot,
  WorkReminder,
} from '../api';
import {
  ApiError,
  acknowledgeReminder,
  automationCandidates,
  automationKnowledgeHealth,
  automationLintSnapshot,
  automationReminders,
  automationRun,
  automationRuns,
  automationSchedules,
  automationStatus,
  automationTime,
  cancelAutomationRun,
  changeAutomationPause,
  changeCandidateDisposition,
  confirmCandidates,
  editAutomationSchedule,
  getInspection,
  readPipelineSettings,
  retryCandidate,
  runAutomationTask,
  savePipelineSettings,
  snoozeReminder,
  testReminderNotification,
  updateReminderSettings,
  updateWeeklyReviewSettings,
  weeklyReviews,
} from '../api';
import { WorkflowsTab } from '../components/automation/WorkflowsTab';
import {
  describeError,
  isActive,
  issueLabels,
  runError,
  statusLabels,
  triggerLabels,
  weekdays,
  type AutomationTab,
} from '../components/automation/automationMeta';
import { useDialogFocus } from '../components/useDialogFocus';
import '../automation.css';

function poll(load: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const read = async () => {
    await load(controller.signal);
    if (!controller.signal.aborted) timer = setTimeout(() => void read(), 3000);
  };
  void read();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}

function createEditor(schedule: AutomationSchedule) {
  return {
    type: schedule.type,
    revision: schedule.revision,
    enabled: schedule.enabled,
    catchUp: schedule.catchUp,
    kind: schedule.plan.kind,
    minutes: schedule.plan.kind === 'interval' ? String(schedule.plan.minutes) : '60',
    time: schedule.plan.kind === 'interval' ? '09:00' : schedule.plan.time,
    weekday: schedule.plan.kind === 'weekly' ? schedule.plan.weekday : (1 as const),
  };
}

const tabOrder: AutomationTab[] = ['workflows', 'inbox', 'runs'];

export function AutomationPage({
  onOpenRaw,
  onOpenDraft,
  onOpenLint,
  onOpenInspection,
  onOpenWorkItem,
  onOpenWeeklyReview,
  initialRunId,
  focusReminders,
  candidateFilter,
}: {
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenLint?: () => void;
  onOpenInspection?: (id?: string) => void;
  onOpenWorkItem?: (id: string, focusMaterials?: boolean) => void;
  onOpenWeeklyReview?: (weekKey: string) => void;
  initialRunId?: string;
  focusReminders?: boolean;
  candidateFilter?: CandidateFilter;
}) {
  const initialTab: AutomationTab = initialRunId
    ? 'runs'
    : candidateFilter || focusReminders
      ? 'inbox'
      : 'workflows';

  const [tab, setTab] = useState<AutomationTab>(initialTab);
  const [inboxFilter, setInboxFilter] = useState<CandidateFilter>(candidateFilter ?? 'all');
  const [inboxFocus, setInboxFocus] = useState<'reminders' | 'candidates' | null>(() =>
    focusReminders ? 'reminders' : candidateFilter ? 'candidates' : null,
  );
  const [inboxFocusTick, setInboxFocusTick] = useState(() => (focusReminders || candidateFilter ? 1 : 0));

  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [schedules, setSchedules] = useState<AutomationList<AutomationSchedule> | null>(null);
  const [history, setHistory] = useState<AutomationList<AutomationRun> | null>(null);
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [remindersView, setRemindersView] = useState<ReminderView | null>(null);
  const [candidateDate, setCandidateDate] = useState<string>();
  const [candidates, setCandidates] = useState<CandidateList>();
  const [weeklyList, setWeeklyList] = useState<WeeklyReviewList | null>(null);

  const [readErrors, setReadErrors] = useState({
    status: '',
    schedules: '',
    history: '',
    detail: '',
    health: '',
    reminders: '',
    candidates: '',
    weekly: '',
  });
  const [refresh, setRefresh] = useState(0);
  const [remindersRevision, setRemindersRevision] = useState(0);
  const [pipelineRevision, setPipelineRevision] = useState(0);
  const [weeklyRevision, setWeeklyRevision] = useState(0);

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationRunStatus | ''>('');
  const [limit, setLimit] = useState(50);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId ?? null);
  const [detail, setDetail] = useState<AutomationRun | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const runTriggerRef = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<ReturnType<typeof createEditor> | null>(null);
  const [pauseConfirmation, setPauseConfirmation] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<{ area: string; message: string } | null>(null);

  const [weeklyPending, setWeeklyPending] = useState(false);
  const [weeklyError, setWeeklyError] = useState('');
  const [weeklyConflict, setWeeklyConflict] = useState(false);

  const showHealth = Boolean(onOpenLint || onOpenInspection);
  const showReminders = Boolean(onOpenWorkItem);
  const tasks = schedules?.items ?? [];
  const hasPipeline = tasks.some(task => task.type === 'news.daily');
  const hasWeeklyReview = tasks.some(task => task.type === 'review.weekly');

  const prevDeepLink = useRef({ candidateFilter, focusReminders, initialRunId });
  useEffect(() => {
    const prev = prevDeepLink.current;
    prevDeepLink.current = { candidateFilter, focusReminders, initialRunId };
    if (initialRunId && initialRunId !== prev.initialRunId) {
      setSelectedRunId(initialRunId);
      setTab('runs');
    } else if (focusReminders && !prev.focusReminders) {
      setTab('inbox');
      setInboxFocus('reminders');
      setInboxFocusTick(value => value + 1);
    } else if (candidateFilter && candidateFilter !== prev.candidateFilter) {
      setInboxFilter(candidateFilter);
      setTab('inbox');
      setInboxFocus('candidates');
      setInboxFocusTick(value => value + 1);
    }
  }, [candidateFilter, focusReminders, initialRunId]);

  useEffect(
    () =>
      poll(async signal => {
        const [service, taskList] = await Promise.allSettled([automationStatus(signal), automationSchedules(signal)]);
        if (signal.aborted) return;
        if (service.status === 'fulfilled') setStatus(service.value);
        if (taskList.status === 'fulfilled') setSchedules(taskList.value);
        setReadErrors(current => ({
          ...current,
          status: service.status === 'rejected' ? describeError(service.reason) : '',
          schedules: taskList.status === 'rejected' ? describeError(taskList.reason) : '',
        }));
      }),
    [refresh],
  );

  useEffect(() => {
    if (!showHealth) return;
    return poll(async signal => {
      try {
        const result = await automationKnowledgeHealth(signal);
        if (!signal.aborted) {
          setHealth(result);
          setReadErrors(current => ({ ...current, health: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors(current => ({ ...current, health: describeError(error) }));
      }
    });
  }, [showHealth, refresh]);

  useEffect(() => {
    if (!showReminders) return;
    return poll(async signal => {
      try {
        const result = await automationReminders(signal);
        if (!signal.aborted) {
          setRemindersView(result);
          setReadErrors(current => ({ ...current, reminders: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors(current => ({ ...current, reminders: describeError(error) }));
      }
    });
  }, [showReminders, refresh, remindersRevision]);

  useEffect(() => {
    if (!hasPipeline) return;
    return poll(async signal => {
      try {
        const result = await automationCandidates(candidateDate, signal);
        if (!signal.aborted) {
          setCandidates(result);
          setReadErrors(current => ({ ...current, candidates: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors(current => ({ ...current, candidates: describeError(error) }));
      }
    });
  }, [hasPipeline, candidateDate, refresh, pipelineRevision]);

  useEffect(() => {
    if (!hasWeeklyReview) return;
    return poll(async signal => {
      try {
        const result = await weeklyReviews(signal);
        if (!signal.aborted) {
          setWeeklyList(result);
          setReadErrors(current => ({ ...current, weekly: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors(current => ({ ...current, weekly: describeError(error) }));
      }
    });
  }, [hasWeeklyReview, refresh, weeklyRevision]);

  useEffect(
    () =>
      poll(async signal => {
        try {
          const runs = await automationRuns({ type: typeFilter, status: statusFilter, limit }, signal);
          if (!signal.aborted) {
            setHistory(runs);
            setReadErrors(current => ({ ...current, history: '' }));
          }
        } catch (error) {
          if (!signal.aborted) setReadErrors(current => ({ ...current, history: describeError(error) }));
        }
      }),
    [typeFilter, statusFilter, limit, refresh],
  );

  useEffect(() => {
    if (!selectedRunId) return;
    return poll(async signal => {
      try {
        const run = await automationRun(selectedRunId, signal);
        if (!signal.aborted) {
          setDetail(run);
          setReadErrors(current => ({ ...current, detail: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors(current => ({ ...current, detail: describeError(error) }));
      }
    });
  }, [selectedRunId, refresh]);

  useEffect(() => {
    if (!selectedRunId) return;
    detailHeading.current?.scrollIntoView?.({ block: 'nearest' });
    detailHeading.current?.focus();
  }, [selectedRunId]);

  const write = async (area: string, operation: (token: string) => Promise<void>) => {
    if (!status || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await operation(status.writeToken);
    } catch (error) {
      const conflict = area === 'editor' && error instanceof ApiError && error.status === 409;
      setActionError({
        area,
        message: conflict ? '计划已被其他操作修改。你的输入已保留，可先核对最新计划。' : describeError(error),
      });
    } finally {
      setRefresh(value => value + 1);
      setPending(false);
    }
  };

  const chooseRun = (id: string, run: AutomationRun | null = null, trigger?: HTMLElement | null) => {
    const active = document.activeElement;
    runTriggerRef.current = trigger ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    if (id !== selectedRunId) setDetail(run);
    setSelectedRunId(id);
    setReadErrors(current => ({ ...current, detail: '' }));
  };

  const selectTab = (next: AutomationTab) => {
    setTab(next);
    setInboxFocus(null);
  };

  const openInbox = (target: 'candidates' | 'reminders', filter?: CandidateFilter) => {
    if (filter) setInboxFilter(filter);
    setTab('inbox');
    setInboxFocus(target);
    setInboxFocusTick(value => value + 1);
  };

  const toggleWeeklyAi = async (enabled: boolean, revision: number) => {
    if (!status?.writeToken || weeklyPending) return;
    setWeeklyPending(true);
    setWeeklyError('');
    setWeeklyConflict(false);
    try {
      const settings = await updateWeeklyReviewSettings(
        { revision, aiSummaryEnabled: enabled },
        status.writeToken,
      );
      setWeeklyList(current => (current ? { ...current, settings } : current));
    } catch (error) {
      const conflict =
        error instanceof ApiError && (error.status === 409 || error.code === 'WEEKLY_REVIEW_REVISION_CONFLICT');
      if (conflict) setWeeklyConflict(true);
      setWeeklyError(
        conflict ? '周报设置已被其他操作修改（409 版本冲突），请重新读取设置后再试。' : describeError(error),
      );
    } finally {
      setWeeklyPending(false);
    }
  };

  const reloadWeekly = () => {
    setWeeklyConflict(false);
    setWeeklyError('');
    setWeeklyRevision(value => value + 1);
  };

  const closeEditor = () => {
    setEditor(null);
    setActionError(null);
  };

  const submitSchedule = (event: FormEvent, schedule: AutomationSchedule) => {
    event.preventDefault();
    if (!editor) return;
    void write('editor', async token => {
      await editAutomationSchedule(
        schedule.type,
        {
          revision: editor.revision,
          enabled: editor.enabled,
          catchUp: editor.catchUp,
          plan:
            editor.kind === 'interval'
              ? { kind: 'interval', minutes: Number(editor.minutes) }
              : editor.kind === 'weekly'
                ? { kind: 'weekly', weekday: editor.weekday, time: editor.time, timezone: 'Asia/Shanghai' }
                : { kind: 'daily', time: editor.time, timezone: 'Asia/Shanghai' },
        },
        token,
      );
      setEditor(null);
    });
  };

  const taskName = (type: string) =>
    type === 'pipeline.organize' ? '资讯入库与整理' : tasks.find(task => task.type === type)?.name ?? type;
  const showError = (area: string) =>
    actionError?.area === area && (
      <p className="form-error" role="alert">
        {actionError.message}
      </p>
    );
  const currentDetail = detail?.id === selectedRunId ? detail : null;
  const weeklyReviewWeekKey = currentDetail?.artifacts.weeklyReviewWeekKey;
  const editorTask = editor ? tasks.find(task => task.type === editor.type) ?? null : null;

  const bannerTone = !status
    ? 'muted'
    : !status.scheduler.healthy || status.failuresLast24Hours > 0
      ? 'danger'
      : status.paused
        ? 'warning'
        : 'ok';
  const pendingCandidates = hasPipeline ? (candidates?.counts.pending ?? 0) : 0;
  const unreadReminders = showReminders ? (remindersView?.unreadCount ?? 0) : 0;
  const pendingTotal = pendingCandidates + unreadReminders;

  return (
    <div className="page automation-page">
      <div className="page-heading">
        <div>
          <h1>自动化</h1>
          <p className="subheading">仅在工作台进程运行时执行。关机或休眠期间错过的任务，启动后按计划设置最多补跑一次。</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setRefresh(value => value + 1)}>
          刷新
        </button>
      </div>

      <section className="panel automation-banner" aria-labelledby="automation-status" data-tone={bannerTone}>
        <div className="automation-banner-main">
          <div className="automation-banner-summary">
            <div className="automation-banner-title">
              <span className="automation-dot" aria-hidden="true" />
              <h2 id="automation-status">调度状态</h2>
              {status && (
                <span className="automation-banner-state">
                  {status.paused ? '全局暂停' : '任务可触发'} · {status.scheduler.healthy ? '调度器正常' : '调度器异常'}
                </span>
              )}
            </div>
            {readErrors.status && (
              <p className="form-error" role="alert">
                调度状态读取失败：{readErrors.status}
              </p>
            )}
            {!status && !readErrors.status && <p role="status">正在读取调度状态…</p>}
            {status && (
              <>
                <dl className="automation-facts">
                  <div>
                    <dt>下次运行（上海时间）</dt>
                    <dd>{automationTime(status.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt>最近 24 小时失败</dt>
                    <dd>{status.failuresLast24Hours} 次</dd>
                  </div>
                  <div>
                    <dt>当前待处理</dt>
                    <dd>{pendingTotal} 项</dd>
                  </div>
                </dl>
                {status.scheduler.error && (
                  <p className="form-error" role="alert">
                    {status.scheduler.error}
                  </p>
                )}
              </>
            )}
          </div>
          {status && pauseConfirmation === null && (
            <div className="automation-banner-controls">
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => setPauseConfirmation(!status.paused)}
              >
                {status.paused ? '恢复全部自动化' : '暂停全部自动化'}
              </button>
            </div>
          )}
        </div>
        {pauseConfirmation !== null && (
          <div className="automation-confirm" role="group" aria-label="确认更改全局暂停设置">
            <p>
              {pauseConfirmation
                ? '暂停后，新触发会记录为跳过。正在运行的任务会继续。'
                : '恢复后按当前计划触发，暂停期间跳过的记录会保留。'}
            </p>
            <div className="automation-actions">
              <button
                type="button"
                className="primary-button"
                disabled={pending}
                onClick={() =>
                  void write('pause', async token => {
                    setStatus(await changeAutomationPause(pauseConfirmation, token));
                    setPauseConfirmation(null);
                  })
                }
              >
                {pauseConfirmation ? '确认暂停' : '确认恢复'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => {
                  setPauseConfirmation(null);
                  setActionError(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
        {showError('pause')}
        {status && (
          <details className="automation-process-info">
            <summary>进程信息</summary>
            <p>
              {status.instance.mode === 'production' ? '生产' : '开发'} · PID {status.instance.pid} · 端口{' '}
              {status.instance.port}
            </p>
          </details>
        )}
      </section>

      <div
        className="automation-tabs"
        role="tablist"
        aria-label="自动化视图"
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const idx = tabOrder.indexOf(tab);
          const next =
            event.key === 'Home'
              ? 'workflows'
              : event.key === 'End'
                ? 'runs'
                : tabOrder[(idx + (event.key === 'ArrowRight' ? 1 : tabOrder.length - 1)) % tabOrder.length]!;
          selectTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#automation-tab-${next}`)?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id="automation-tab-workflows"
          aria-controls="automation-panel-workflows"
          aria-selected={tab === 'workflows'}
          tabIndex={tab === 'workflows' ? 0 : -1}
          onClick={() => selectTab('workflows')}
        >
          流程与计划
        </button>
        <button
          type="button"
          role="tab"
          id="automation-tab-inbox"
          aria-controls="automation-panel-inbox"
          aria-selected={tab === 'inbox'}
          tabIndex={tab === 'inbox' ? 0 : -1}
          onClick={() => selectTab('inbox')}
        >
          待处理收件箱
          {pendingTotal > 0 && <span className="automation-tab-badge">{pendingTotal}</span>}
        </button>
        <button
          type="button"
          role="tab"
          id="automation-tab-runs"
          aria-controls="automation-panel-runs"
          aria-selected={tab === 'runs'}
          tabIndex={tab === 'runs' ? 0 : -1}
          onClick={() => selectTab('runs')}
        >
          运行记录
        </button>
      </div>

      <div
        role="tabpanel"
        id="automation-panel-workflows"
        aria-labelledby="automation-tab-workflows"
        hidden={tab !== 'workflows'}
      >
        {tab === 'workflows' && (
          <WorkflowsTab
            schedules={schedules}
            schedulesError={readErrors.schedules}
            runErrorText={actionError?.area === 'run' ? actionError.message : ''}
            pending={pending}
            hasStatus={Boolean(status)}
            writeToken={status?.writeToken}
            health={health}
            healthError={readErrors.health}
            showHealth={showHealth}
            candidates={candidates}
            remindersView={remindersView}
            showReminders={showReminders}
            weeklyList={weeklyList}
            weeklyError={weeklyError}
            weeklyReadError={readErrors.weekly}
            weeklyPending={weeklyPending}
            weeklyConflict={weeklyConflict}
            onEditSchedule={schedule => {
              setEditor(createEditor(schedule));
              setActionError(null);
            }}
            onRunTask={(type, trigger) => {
              void write('run', async token => {
                const run = await runAutomationTask(type, token);
                chooseRun(run.id, run, trigger);
              });
            }}
            onOpenRun={(id, trigger) => chooseRun(id, null, trigger)}
            onOpenInbox={openInbox}
            onOpenLint={onOpenLint}
            onOpenInspection={onOpenInspection}
            onOpenWeeklyReview={onOpenWeeklyReview}
            onToggleWeeklyAi={(enabled, revision) => void toggleWeeklyAi(enabled, revision)}
            onReloadWeekly={reloadWeekly}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="automation-panel-inbox"
        aria-labelledby="automation-tab-inbox"
        hidden={tab !== 'inbox'}
      >
        {tab === 'inbox' && (
          <>
            {showReminders && onOpenWorkItem && (
              <WorkRemindersPanel
                token={status?.writeToken}
                view={remindersView}
                readError={readErrors.reminders}
                focusTick={inboxFocus === 'reminders' ? inboxFocusTick : 0}
                onViewChange={setRemindersView}
                onChanged={() => setRemindersRevision(value => value + 1)}
                onOpenWorkItem={onOpenWorkItem}
              />
            )}
            {hasPipeline && (
              <NewsInbox
                candidates={candidates}
                readError={readErrors.candidates}
                date={candidateDate}
                onDateChange={nextDate => {
                  setCandidateDate(nextDate);
                  setCandidates(undefined);
                }}
                filter={inboxFilter}
                onFilterChange={setInboxFilter}
                focusTick={inboxFocus === 'candidates' ? inboxFocusTick : 0}
                token={status?.writeToken}
                paused={status?.paused}
                refresh={refresh}
                onChanged={() => setPipelineRevision(value => value + 1)}
                onOpenRaw={onOpenRaw}
                onOpenDraft={onOpenDraft}
                onOpenRun={(id, trigger) => chooseRun(id, null, trigger)}
              />
            )}
            {!showReminders && !hasPipeline && (
              <section className="panel automation-panel">
                <p>当前未启用收件箱或事项提醒来源。</p>
              </section>
            )}
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="automation-panel-runs"
        aria-labelledby="automation-tab-runs"
        hidden={tab !== 'runs'}
      >
        {tab === 'runs' && (
          <section className="panel automation-panel" aria-labelledby="automation-history">
            <div className="automation-heading">
              <h2 id="automation-history">运行历史</h2>
            </div>
            <div className="automation-filters">
              <label>
                任务
                <select
                  value={typeFilter}
                  onChange={event => {
                    setHistory(null);
                    setTypeFilter(event.target.value);
                  }}
                >
                  <option value="">全部任务</option>
                  {tasks.map(task => (
                    <option key={task.type} value={task.type}>
                      {task.name}
                    </option>
                  ))}
                  {hasPipeline && <option value="pipeline.organize">资讯入库与整理</option>}
                </select>
              </label>
              <label>
                运行状态
                <select
                  value={statusFilter}
                  onChange={event => {
                    setHistory(null);
                    setStatusFilter(event.target.value as AutomationRunStatus | '');
                  }}
                >
                  <option value="">全部状态</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                显示条数
                <select
                  value={limit}
                  onChange={event => {
                    setHistory(null);
                    setLimit(Number(event.target.value));
                  }}
                >
                  {[20, 50, 100].map(count => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {readErrors.history && (
              <p className="form-error" role="alert">
                运行历史读取失败：{readErrors.history}
              </p>
            )}
            {!history && !readErrors.history && <p role="status">正在读取运行历史…</p>}
            {history?.issues?.map(issue => (
              <p key={issue.file} className="form-error" role="alert">
                {issueLabels[issue.reason]}：{issue.file}
              </p>
            ))}
            {history && !history.items.length && !history.issues?.length && <p>暂无符合筛选条件的运行记录。</p>}
            <ul className="automation-list">
              {history?.items.map(run => (
                <li key={run.id}>
                  <div>
                    <strong>{taskName(run.type)}</strong>
                    <p>
                      {automationTime(run.scheduledAt)} · {triggerLabels[run.trigger]} · {statusLabels[run.status]}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pending}
                    aria-pressed={selectedRunId === run.id}
                    onClick={event => chooseRun(run.id, run, event.currentTarget)}
                  >
                    查看详情
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {selectedRunId && (
        <section className="panel automation-panel" aria-labelledby="automation-run-detail">
          <div className="automation-heading">
            <div>
              <h2 id="automation-run-detail" tabIndex={-1} ref={detailHeading}>
                运行详情
              </h2>
              {currentDetail && (
                <p>
                  {taskName(currentDetail.type)} · {statusLabels[currentDetail.status]}
                </p>
              )}
            </div>
            <div className="automation-actions">
              {currentDetail && !currentDetail.candidateId && isActive(currentDetail.status) && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending || !status}
                  onClick={() =>
                    void write('cancel', async token => {
                      setDetail(await cancelAutomationRun(currentDetail.id, token));
                    })
                  }
                >
                  取消运行
                </button>
              )}
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => {
                  const trigger = runTriggerRef.current;
                  runTriggerRef.current = null;
                  setSelectedRunId(null);
                  setDetail(null);
                  if (trigger?.isConnected) trigger.focus();
                }}
              >
                关闭详情
              </button>
            </div>
          </div>
          {readErrors.detail && (
            <p className="form-error" role="alert">
              运行详情读取失败：{readErrors.detail}
            </p>
          )}
          {!currentDetail && !readErrors.detail && <p role="status">正在读取运行详情…</p>}
          {showError('cancel')}
          {currentDetail && (
            <>
              {currentDetail.error && <p className="form-error">{runError(currentDetail.error)}</p>}
              <dl className="automation-facts">
                <div>
                  <dt>触发</dt>
                  <dd>
                    {triggerLabels[currentDetail.trigger]} · {automationTime(currentDetail.scheduledAt)}
                  </dd>
                </div>
                <div>
                  <dt>开始</dt>
                  <dd>{automationTime(currentDetail.startedAt)}</dd>
                </div>
                <div>
                  <dt>结束</dt>
                  <dd>{automationTime(currentDetail.endedAt)}</dd>
                </div>
              </dl>
              <h3>步骤</h3>
              {!currentDetail.steps.length && <p>暂无步骤记录。</p>}
              <ol className="automation-list automation-steps">
                {currentDetail.steps.map((step, index) => (
                  <li key={index}>
                    <div>
                      <strong>{step.name}</strong>
                      <p>
                        {statusLabels[step.status]}
                        {step.durationMs === null ? '' : ` · ${step.durationMs} 毫秒`}
                      </p>
                      {step.summary && <p>{step.summary}</p>}
                      {step.error && <p className="form-error">{step.error}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              <h3>用量</h3>
              <dl className="automation-facts">
                {currentDetail.sourceRequests !== undefined && (
                  <div>
                    <dt>来源 HTTP 请求</dt>
                    <dd>{currentDetail.sourceRequests}</dd>
                  </div>
                )}
                <div>
                  <dt>模型请求次数</dt>
                  <dd>{currentDetail.usage.requests}</dd>
                </div>
                <div>
                  <dt>输入 Token</dt>
                  <dd>{currentDetail.usage.inputTokens}</dd>
                </div>
                <div>
                  <dt>输出 Token</dt>
                  <dd>{currentDetail.usage.outputTokens}</dd>
                </div>
                <div>
                  <dt>用量未知的请求</dt>
                  <dd>{currentDetail.usage.unknownUsageCount}</dd>
                </div>
              </dl>
              <h3>产物</h3>
              {currentDetail.candidateId && <p>候选 {currentDetail.candidateId}</p>}
              <div className="automation-actions">
                {currentDetail.artifacts.rawIds.map(id => (
                  <button type="button" key={id} className="text-button" onClick={() => onOpenRaw(id)}>
                    Raw {id}
                  </button>
                ))}
                {currentDetail.artifacts.draftIds.map(id => (
                  <button type="button" key={id} className="text-button" onClick={() => onOpenDraft(id)}>
                    草稿 {id}
                  </button>
                ))}
                {currentDetail.artifacts.jobIds.map(id => (
                  <a key={id} href={`/api/extraction-jobs/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
                    任务 {id}
                  </a>
                ))}
                {weeklyReviewWeekKey &&
                  (onOpenWeeklyReview ? (
                    <button type="button" className="text-button" onClick={() => onOpenWeeklyReview(weeklyReviewWeekKey)}>
                      打开周报 {weeklyReviewWeekKey}
                    </button>
                  ) : (
                    <p>周报 {weeklyReviewWeekKey}</p>
                  ))}
                {!weeklyReviewWeekKey &&
                  !currentDetail.artifacts.lintSnapshotId &&
                  !Object.values(currentDetail.artifacts).some(value => Array.isArray(value) && value.length) && (
                    <p>无产物。</p>
                  )}
              </div>
              {currentDetail.artifacts.lintSnapshotId && (
                <LintRunDetails
                  key={currentDetail.artifacts.lintSnapshotId}
                  id={currentDetail.artifacts.lintSnapshotId}
                  onOpenLint={onOpenLint}
                />
              )}
              {currentDetail.artifacts.inspectionIds?.map(id => (
                <InspectionRunDetails key={id} id={id} onOpenInspection={onOpenInspection} />
              ))}
            </>
          )}
        </section>
      )}

      {editor && editorTask && (
        <ScheduleEditorDialog name={editorTask.name} pending={pending} onClose={closeEditor}>
          <form className="automation-editor" aria-label="编辑计划" onSubmit={event => submitSchedule(event, editorTask)}>
            <div className="automation-actions">
              <label className="automation-check">
                <input
                  type="checkbox"
                  checked={editor.enabled}
                  disabled={pending}
                  onChange={event => setEditor({ ...editor, enabled: event.target.checked })}
                />
                启用计划
              </label>
              <label className="automation-check">
                <input
                  type="checkbox"
                  checked={editor.catchUp}
                  disabled={pending || !editorTask.allowsCatchUp}
                  onChange={event => setEditor({ ...editor, catchUp: event.target.checked })}
                />
                启动时补跑一次
              </label>
            </div>
            <label>
              调度方式
              <select
                data-autofocus
                value={editor.kind}
                disabled={pending}
                onChange={event => setEditor({ ...editor, kind: event.target.value as AutomationPlan['kind'] })}
              >
                <option value="interval">固定间隔</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
              </select>
            </label>
            {editor.kind === 'weekly' && (
              <label>
                周几
                <select
                  value={editor.weekday}
                  disabled={pending}
                  onChange={event => setEditor({ ...editor, weekday: Number(event.target.value) as typeof editor.weekday })}
                >
                  {weekdays.map((day, index) => (
                    <option key={day} value={index + 1}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {editor.kind === 'interval' ? (
              <label>
                间隔分钟
                <input
                  type="number"
                  min="1"
                  max="525600"
                  step="1"
                  required
                  value={editor.minutes}
                  disabled={pending}
                  onChange={event => setEditor({ ...editor, minutes: event.target.value })}
                />
              </label>
            ) : (
              <label>
                {editor.kind === 'weekly' ? '每周运行时间（上海时间）' : '每天运行时间（上海时间）'}
                <input
                  type="time"
                  required
                  value={editor.time}
                  disabled={pending}
                  onChange={event => setEditor({ ...editor, time: event.target.value })}
                />
              </label>
            )}
            {showError('editor')}
            {editor.revision !== editorTask.revision && (
              <div className="automation-conflict">
                <p>当前计划已更新。重新读取会替换表单中的输入。</p>
                <button
                  type="button"
                  className="text-button"
                  disabled={pending}
                  onClick={() => {
                    setEditor(createEditor(editorTask));
                    setActionError(null);
                  }}
                >
                  读取最新版本
                </button>
              </div>
            )}
            <div className="automation-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={pending || !status || editor.revision !== editorTask.revision}
              >
                {pending ? '正在保存…' : '保存计划'}
              </button>
              <button type="button" className="secondary-button" disabled={pending} onClick={closeEditor}>
                取消编辑
              </button>
            </div>
          </form>
        </ScheduleEditorDialog>
      )}
    </div>
  );
}

const reminderKinds: Record<WorkReminder['kind'], string> = {
  due_follow_up: '到期跟进',
  stale_item: '久未推进',
  new_raw_ready: '新资料待分析',
};
const reminderStatuses: Record<WorkReminder['status'], string> = {
  unread: '未读',
  acknowledged: '已读',
  snoozed: '已延后',
  resolved: '已消解',
};
const reminderDeliveryLabels: Record<WorkReminder['deliveryStatus'], string> = {
  pending: '待投递',
  delivered: '已投递',
  suppressed_quiet_hours: '免打扰期间',
  suppressed_disabled: '已关闭',
  suppressed_non_windows: '当前环境不支持',
  failed: '投递失败',
};
type ReminderEditor = Omit<ReminderSettings, 'staleDays' | 'maxToastsPerRun'> & {
  revision: number;
  staleDays: string;
  maxToastsPerRun: string;
};

function WorkRemindersPanel({
  token,
  view,
  readError,
  focusTick,
  onViewChange,
  onChanged,
  onOpenWorkItem,
}: {
  token?: string;
  view: ReminderView | null;
  readError: string;
  focusTick: number;
  onViewChange: (next: ReminderView) => void;
  onChanged: () => void;
  onOpenWorkItem: (id: string, focusMaterials?: boolean) => void;
}) {
  const [editor, setEditor] = useState<ReminderEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ area: string; text: string; error?: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusTick) return;
    heading.current?.scrollIntoView?.({ block: 'nearest' });
    heading.current?.focus();
  }, [focusTick]);

  const write = async (area: string, operation: (writeToken: string) => Promise<{ text: string; error?: boolean }>) => {
    if (!token || pending) return;
    setPending(true);
    setFeedback(null);
    try {
      setFeedback({ area, ...(await operation(token)) });
    } catch (error) {
      const conflict = area === 'settings' && error instanceof ApiError && error.status === 409;
      setFeedback({ area, error: true, text: conflict ? '设置已更新。请核对最新设置后再保存。' : describeError(error) });
    } finally {
      onChanged();
      setPending(false);
    }
  };
  const edit = (patch: Partial<ReminderEditor>) => {
    if (!view) return;
    setEditor(current => ({
      ...(current ?? {
        ...view.settings,
        revision: view.revision,
        staleDays: String(view.settings.staleDays),
        maxToastsPerRun: String(view.settings.maxToastsPerRun),
      }),
      ...patch,
    }));
    setFeedback(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    void write('settings', async writeToken => {
      const next = await updateReminderSettings(
        { ...editor, staleDays: Number(editor.staleDays), maxToastsPerRun: Number(editor.maxToastsPerRun) },
        writeToken,
      );
      onViewChange(next);
      setEditor(null);
      return { text: '提醒设置已保存。' };
    });
  };
  const showFeedback = (area: string) =>
    feedback?.area === area && (
      <p className={feedback.error ? 'form-error' : undefined} role={feedback.error ? 'alert' : 'status'}>
        {feedback.text}
      </p>
    );
  const settings = editor ?? view?.settings;
  const conflict = Boolean(editor && view && editor.revision !== view.revision);
  const canWrite = Boolean(token && !pending);

  return (
    <section className="panel automation-panel" aria-labelledby="automation-reminders">
      <div className="automation-heading">
        <h2 id="automation-reminders" ref={heading} tabIndex={-1}>
          事项提醒
        </h2>
        {view && <p>{view.unreadCount} 条未读</p>}
      </div>
      {readError && (
        <p className="form-error" role="alert">
          事项提醒读取失败。{readError}
        </p>
      )}
      {!view && !readError && <p role="status">正在读取事项提醒…</p>}
      {view?.issues.map(issue => (
        <p key={issue.file} className="form-error" role="alert">
          {issueLabels[issue.reason]} · {issue.file}
        </p>
      ))}
      {view && view.items.length === 0 && <p>暂无活动提醒。</p>}
      {Boolean(view?.items.length) && (
        <ul className="automation-list automation-reminder-list">
          {view?.items.map(item => {
            const newMaterials = item.kind === 'new_raw_ready';
            return (
              <li key={item.id} aria-label={item.itemTitle}>
                <div>
                  <span className="action-badge action-neutral">{reminderKinds[item.kind]}</span>
                  <h3>{item.itemTitle}</h3>
                  <p>{item.summary}</p>
                  <p className="automation-reminder-meta">
                    {reminderStatuses[item.status]}
                    {item.snoozedUntil && (
                      <>
                        至 <time dateTime={item.snoozedUntil}>{item.snoozedUntil}</time>
                      </>
                    )}
                    {' · 桌面通知 '}
                    {reminderDeliveryLabels[item.deliveryStatus]}
                  </p>
                  {item.deliveryStatus === 'failed' && item.deliveryError && (
                    <p className="form-error">{item.deliveryError}</p>
                  )}
                  {showFeedback(item.id)}
                </div>
                <div className="automation-actions">
                  {item.status === 'unread' && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canWrite}
                      onClick={() =>
                        void write(item.id, async writeToken => {
                          onViewChange(await acknowledgeReminder(item.id, writeToken));
                          return { text: '提醒已标为已读。' };
                        })
                      }
                    >
                      已读
                    </button>
                  )}
                  {(item.status === 'unread' || item.status === 'acknowledged') && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canWrite}
                      onClick={() =>
                        void write(item.id, async writeToken => {
                          onViewChange(await snoozeReminder(item.id, writeToken));
                          return { text: '提醒已延后一天。' };
                        })
                      }
                    >
                      延后一天
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onOpenWorkItem(item.itemId, newMaterials)}
                  >
                    {newMaterials ? '前往分析' : '打开事项'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {settings && (
        <details className="automation-reminder-settings">
          <summary>提醒与通知设置</summary>
          <form className="automation-editor" aria-label="提醒与通知设置" onSubmit={submit}>
            <div className="automation-actions">
              <label className="automation-check">
                <input
                  type="checkbox"
                  checked={settings.desktopNotificationsEnabled}
                  disabled={pending}
                  onChange={event => edit({ desktopNotificationsEnabled: event.target.checked })}
                />
                启用桌面通知
              </label>
            </div>
            <label>
              免打扰开始（上海时间）
              <input
                type="time"
                required
                value={settings.quietHoursStart}
                disabled={pending}
                onChange={event => edit({ quietHoursStart: event.target.value })}
              />
            </label>
            <label>
              免打扰结束（上海时间）
              <input
                type="time"
                required
                value={settings.quietHoursEnd}
                disabled={pending}
                onChange={event => edit({ quietHoursEnd: event.target.value })}
              />
            </label>
            <label>
              久未推进天数
              <input
                type="number"
                min="0"
                max="90"
                step="1"
                required
                value={settings.staleDays}
                disabled={pending}
                onChange={event => edit({ staleDays: event.target.value })}
              />
            </label>
            <label>
              单次通知上限
              <input
                type="number"
                min="1"
                max="10"
                step="1"
                required
                value={settings.maxToastsPerRun}
                disabled={pending}
                onChange={event => edit({ maxToastsPerRun: event.target.value })}
              />
            </label>
            {conflict && (
              <div className="automation-conflict">
                <p>读取最新设置会替换当前输入。</p>
                <button
                  className="text-button"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setEditor(null);
                    setFeedback(null);
                  }}
                >
                  读取最新设置
                </button>
              </div>
            )}
            <div className="automation-actions">
              <button className="primary-button" type="submit" disabled={!canWrite || !editor || conflict}>
                保存提醒设置
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!canWrite}
                onClick={() =>
                  void write('test', async writeToken => {
                    const delivery = await testReminderNotification(writeToken);
                    return {
                      error: delivery.deliveryStatus === 'failed',
                      text: `测试通知 · ${reminderDeliveryLabels[delivery.deliveryStatus]}${delivery.deliveryError ? `。${delivery.deliveryError}` : ''}`,
                    };
                  })
                }
              >
                发送测试通知
              </button>
            </div>
            {showFeedback('settings')}
            {showFeedback('test')}
          </form>
          <p>免打扰起止时间相同时关闭免打扰。久未推进天数设为 0 时停用该提醒。</p>
        </details>
      )}
    </section>
  );
}

function ScheduleEditorDialog({
  name,
  pending,
  onClose,
  children,
}: {
  name: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useDialogFocus<HTMLDivElement>();
  return (
    <div className="schedule-modal">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-editor-title"
        className="panel schedule-dialog"
        onKeyDown={event => {
          if (event.key === 'Escape' && !pending) onClose();
        }}
      >
        <h2 id="automation-editor-title">编辑计划 · {name}</h2>
        {children}
      </div>
    </div>
  );
}

function LintRunDetails({ id, onOpenLint }: { id: string; onOpenLint?: () => void }) {
  const [snapshot, setSnapshot] = useState<WikiLintSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void automationLintSnapshot(id, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(describeError(reason));
      });
    return () => controller.abort();
  }, [id]);
  return (
    <div className="automation-artifact">
      <div className="automation-heading">
        <h4>结构检查快照</h4>
        {onOpenLint && (
          <button type="button" className="text-button" onClick={onOpenLint}>
            查看结构检查
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          快照读取失败。{error}
        </p>
      )}
      {!snapshot && !error && <p role="status">正在读取结构检查快照…</p>}
      {snapshot && (
        <>
          <p>
            总问题 {snapshot.total} 项 ·{' '}
            {snapshot.diff.isBaseline
              ? '首次检查基线'
              : `新增 ${snapshot.diff.addedCount} 项 · 消除 ${snapshot.diff.resolvedCount} 项 · 未变化 ${snapshot.diff.unchangedCount} 项`}
          </p>
          {!snapshot.diff.isBaseline &&
            ([
              ['新增问题', snapshot.diff.added],
              ['已消除问题', snapshot.diff.resolved],
            ] as const).map(([label, findings]) => (
              <details key={label}>
                <summary>
                  {label}（{findings.length} 项）
                </summary>
                {findings.length === 0 ? (
                  <p>无{label}。</p>
                ) : (
                  <ul className="automation-list">
                    {findings.map(finding => (
                      <li key={finding.fingerprint}>
                        <div>
                          <strong>
                            {finding.pageTitle ?? finding.file}
                            {finding.location.scope === 'line' && ` · 第 ${finding.location.line} 行`}
                          </strong>
                          <p>{finding.message}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            ))}
        </>
      )}
    </div>
  );
}

function InspectionRunDetails({ id, onOpenInspection }: { id: string; onOpenInspection?: (id: string) => void }) {
  const [record, setRecord] = useState<KnowledgeInspection | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void getInspection(id, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setRecord(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(describeError(reason));
      });
    return () => controller.abort();
  }, [id]);
  const pendingCount = record?.findings.filter(finding => finding.status === 'pending').length ?? 0;
  return (
    <div className="automation-artifact">
      <div className="automation-heading">
        <h4>主动检查发现</h4>
        {onOpenInspection && record && (
          <button type="button" className="text-button" onClick={() => onOpenInspection(id)}>
            查看本次检查记录
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          检查记录读取失败。{error}
        </p>
      )}
      {!record && !error && <p role="status">正在读取主动检查记录…</p>}
      {record && (
        <>
          <p>
            实读 {record.scope.read.length} 页 · 共发现 {record.findings.length} 项 · 待核 {pendingCount} 项
          </p>
          {record.findings.length > 0 && (
            <details>
              <summary>查看发现摘要</summary>
              <ul className="automation-list">
                {record.findings.map(finding => (
                  <li key={finding.id}>
                    <div>{finding.summary}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const candidateStages = {
  queued_raw: '等待保存 Raw',
  saving_raw: '正在保存 Raw',
  raw_failed: 'Raw 保存失败',
  queued_organize: '等待整理',
  organizing: '整理中',
  organize_failed: '整理失败',
  interrupted: '整理已中断',
  saved: '已入库',
  draft_ready: '草稿已生成',
};
const candidateViews: Array<[CandidateFilter, string]> = [
  ['all', '收件箱'],
  ['fetched', '已抓取'],
  ['pending', '待确认'],
  ['organizing', '整理中'],
  ['failed', '失败'],
  ['ignored', '已忽略'],
];
const evidenceLabel = (row: CandidateView) =>
  row.item.evidenceKind === 'source_summary' ? '来源摘要（未核验原文）' : '来源正文摘录（非全文）';
const candidateScore = (row: CandidateView) =>
  row.screening && 'score' in row.screening ? row.screening.score : undefined;
const canConfirm = (row: CandidateView) => !row.confirmation && !row.savedRawId && row.disposition !== 'ignored';
const isOrganizing = (row: CandidateView) =>
  ['queued_raw', 'saving_raw', 'queued_organize', 'organizing'].some(phase => phase === row.execution?.phase);
const isFailed = (row: CandidateView) =>
  row.saveIssue ||
  (!row.draftPending && ['raw_failed', 'organize_failed', 'interrupted'].some(phase => phase === row.execution?.phase));

function NewsInbox({
  candidates,
  readError,
  date,
  onDateChange,
  filter,
  onFilterChange,
  focusTick,
  token,
  paused,
  refresh,
  onChanged,
  onOpenRaw,
  onOpenDraft,
  onOpenRun,
}: {
  candidates?: CandidateList;
  readError: string;
  date?: string;
  onDateChange: (nextDate?: string) => void;
  filter: CandidateFilter;
  onFilterChange: (nextFilter: CandidateFilter) => void;
  focusTick: number;
  token?: string;
  paused?: boolean;
  refresh: number;
  onChanged: () => void;
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
}) {
  const [settings, setSettings] = useState<PipelineSettings>();
  const [settingsEdit, setSettingsEdit] = useState<Omit<PipelineSettings, 'topics'> & { topics: string }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{ request: ConfirmCandidates; items: CandidateView[] }>();
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [settingsError, setSettingsError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [expandedLow, setExpandedLow] = useState(false);
  const inboxHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusTick) return;
    inboxHeading.current?.focus();
    inboxHeading.current?.scrollIntoView?.();
  }, [focusTick]);

  useEffect(() => {
    const controller = new AbortController();
    void readPipelineSettings(controller.signal)
      .then(value => {
        if (!controller.signal.aborted) {
          setSettings(value);
          setSettingsError('');
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setSettingsError(describeError(error));
      });
    return () => controller.abort();
  }, [refresh, revision]);

  const write = async (operation: (writeToken: string) => Promise<void>) => {
    if (!token || pending) return;
    setPending(true);
    setWriteError('');
    setAccepted(false);
    try {
      await operation(token);
    } catch (error) {
      setWriteError(describeError(error));
    } finally {
      setPending(false);
      setRevision(value => value + 1);
      onChanged();
    }
  };
  const begin = (items: CandidateView[]) => {
    setWriteError('');
    setAccepted(false);
    setConfirmation({
      items,
      request: {
        requestId: crypto.randomUUID(),
        candidateIds: items.map(row => row.id),
        organize: true,
        mode: 'standard',
      },
    });
  };
  const changeEditor = (value: PipelineSettings) => {
    setWriteError('');
    setSettingsEdit({ ...value, topics: value.topics.join('\n') });
  };
  const applySettings = (event: FormEvent) => {
    event.preventDefault();
    if (!settingsEdit) return;
    void write(async writeToken => {
      const saved = await savePipelineSettings(
        {
          ...settingsEdit,
          topics: settingsEdit.topics
            .split(/\r?\n/u)
            .map(topic => topic.trim())
            .filter(Boolean),
        },
        writeToken,
      );
      setSettings(saved);
      setSettingsEdit(undefined);
    });
  };

  const items = (candidates?.items ?? [])
    .filter(row => {
      if (filter === 'fetched') return true;
      if (filter === 'ignored') return row.disposition === 'ignored';
      if (filter === 'pending') return canConfirm(row);
      if (filter === 'organizing') return isOrganizing(row);
      if (filter === 'failed') return isFailed(row);
      return row.disposition !== 'ignored';
    })
    .sort((a, b) => (candidateScore(b)?.relevance ?? -1) - (candidateScore(a)?.relevance ?? -1));
  const low = items.filter(row => candidateScore(row)?.relevance === 0);
  const visible = items.filter(row => candidateScore(row)?.relevance !== 0);
  const confirmableVisible = [...visible, ...(expandedLow ? low : [])].filter(canConfirm);
  const allConfirmableSelected =
    confirmableVisible.length > 0 && confirmableVisible.every(row => selected.includes(row.id));
  const batch = items.filter(
    row => selected.includes(row.id) && canConfirm(row) && (expandedLow || candidateScore(row)?.relevance !== 0),
  );

  const renderCandidate = (row: CandidateView) => {
    const score = candidateScore(row);
    const phase = row.execution?.phase;
    const available = canConfirm(row);
    const screenError = row.screening && 'error' in row.screening ? row.screening.error : undefined;
    return (
      <article className="news-candidate" key={row.id} aria-label={row.item.title}>
        <div className="automation-heading">
          <div>
            <h3>{row.item.title}</h3>
            <p>
              {row.section === 'fmcg' ? '快消研报' : 'AI 前沿'} · {row.item.sourceName} ·{' '}
              {row.item.publishedAt ? row.item.publishedAt.slice(0, 10) : '未提供发布日期'} · {evidenceLabel(row)}
            </p>
          </div>
          {available && (
            <label className="candidate-check">
              <input
                type="checkbox"
                aria-label={`选择 ${row.item.title}`}
                checked={selected.includes(row.id)}
                onChange={event =>
                  setSelected(current =>
                    event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id),
                  )
                }
              />
              选择
            </label>
          )}
        </div>
        <details>
          <summary>展开摘录</summary>
          <p className="candidate-excerpt">{row.item.excerpt}</p>
        </details>
        {score ? (
          <p>
            <strong>AI 预筛，仅供参考 · 相关性 {score.relevance}/3</strong>
            <br />
            {score.categories.join('、')} · 建议{score.suggestedMode === 'deep' ? '深度整理' : '标准整理'}
            <br />
            {score.reason}
          </p>
        ) : (
          <p>未预筛{screenError && ` · ${screenError}`}</p>
        )}
        {(row.disposition === 'later' || row.disposition === 'ignored') && (
          <p>{row.disposition === 'later' ? '稍后处理' : '已忽略'}</p>
        )}
        {phase && phase !== 'saved' && <p>{row.draftPending ? '草稿待审核' : candidateStages[phase]}</p>}
        {row.confirmation && !row.savedRawId && (phase === 'saved' || phase === 'draft_ready') && (
          <p>原入库资料已缺失。</p>
        )}
        {row.saveIssue && <p className="form-error">入库收据读取失败。</p>}
        {!row.draftPending && row.execution?.error && <p className="form-error">{row.execution.error}</p>}
        <div className="automation-actions">
          {available && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={pending || !token}
                onClick={() => begin([row])}
              >
                确认入库
              </button>
              {row.disposition !== 'later' && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending || !token}
                  onClick={() =>
                    void write(value => changeCandidateDisposition(row.id, 'later', value).then(() => undefined))
                  }
                >
                  稍后
                </button>
              )}
              <button
                type="button"
                className="text-button"
                disabled={pending || !token}
                onClick={() =>
                  void write(value => changeCandidateDisposition(row.id, 'ignore', value).then(() => undefined))
                }
              >
                忽略
              </button>
            </>
          )}
          {!row.confirmation && !row.savedRawId && row.disposition !== 'inbox' && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !token}
              onClick={() =>
                void write(value => changeCandidateDisposition(row.id, 'restore', value).then(() => undefined))
              }
            >
              恢复到收件箱
            </button>
          )}
          {row.savedRawId && (
            <button type="button" className="text-button" onClick={() => onOpenRaw(row.savedRawId!)}>
              已入库 · 打开 Raw
            </button>
          )}
          {row.draftPending && row.execution?.draftId && (
            <button type="button" className="secondary-button" onClick={() => onOpenDraft(row.execution!.draftId!)}>
              审核草稿
            </button>
          )}
          {!row.draftPending && (phase === 'raw_failed' || phase === 'organize_failed' || phase === 'interrupted') && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !token}
              onClick={() =>
                void write(value =>
                  retryCandidate(row.id, phase === 'raw_failed' ? 'save' : 'organize', value).then(() => undefined),
                )
              }
            >
              {phase === 'raw_failed' ? '重试保存 Raw' : phase === 'interrupted' ? '继续整理' : '重试整理'}
            </button>
          )}
          {row.execution && phase !== 'queued_raw' && phase !== 'queued_organize' && (
            <button
              type="button"
              className="text-button"
              onClick={event => onOpenRun(row.execution!.runId, event.currentTarget)}
            >
              查看运行
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section id="news-candidates" className="panel automation-panel" aria-labelledby="news-candidate-title">
      <div className="automation-heading">
        <div>
          <h2 id="news-candidate-title" ref={inboxHeading} tabIndex={-1}>
            资讯候选收件箱
          </h2>
          <p>{paused ? '全局暂停。已确认条目将在恢复后继续排队执行。' : '确认后才保存 Raw。AI 草稿需要人工审核。'}</p>
        </div>
        {settings && !settingsEdit && (
          <button type="button" className="secondary-button" onClick={() => changeEditor(settings)}>
            流水线设置
          </button>
        )}
      </div>
      {settingsError && (
        <p className="form-error" role="alert">
          {settingsError}
        </p>
      )}
      {settingsEdit && (
        <form className="automation-editor" aria-label="流水线设置" onSubmit={applySettings}>
          <label className="automation-check">
            <input
              type="checkbox"
              checked={settingsEdit.preScreenEnabled}
              disabled={pending}
              onChange={event => setSettingsEdit({ ...settingsEdit, preScreenEnabled: event.target.checked })}
            />
            启用 AI 预筛
          </label>
          <label>
            整理并发数
            <select
              value={settingsEdit.concurrency}
              disabled={pending}
              onChange={event => setSettingsEdit({ ...settingsEdit, concurrency: Number(event.target.value) })}
            >
              {[1, 2, 3, 4].map(count => (
                <option key={count}>{count}</option>
              ))}
            </select>
          </label>
          <label className="candidate-topics">
            关注主题（每行一条，最多 20 条，每条最多 80 字）
            <textarea
              rows={4}
              value={settingsEdit.topics}
              disabled={pending}
              onChange={event => setSettingsEdit({ ...settingsEdit, topics: event.target.value })}
            />
          </label>
          {settings && settingsEdit.revision !== settings.revision && (
            <div className="automation-conflict">
              <p>已有更新的设置。当前输入保留。</p>
              <button type="button" className="text-button" onClick={() => changeEditor(settings)}>
                加载最新设置
              </button>
            </div>
          )}
          <div className="automation-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={pending || !token || settings?.revision !== settingsEdit.revision}
            >
              保存流水线设置
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={pending}
              onClick={() => {
                setSettingsEdit(undefined);
                setWriteError('');
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <div className="automation-filters">
        <label>
          资讯日期
          <select
            value={date ?? ''}
            onChange={event => {
              onDateChange(event.target.value || undefined);
              setSelected([]);
              setExpandedLow(false);
            }}
          >
            <option value="">今日</option>
            {candidates?.dates.map(day => (
              <option key={day}>{day}</option>
            ))}
            {date && !candidates?.dates.includes(date) && <option>{date}</option>}
          </select>
        </label>
        <label>
          候选状态
          <select
            value={filter}
            onChange={event => {
              onFilterChange(event.target.value as CandidateFilter);
              setSelected([]);
              setExpandedLow(false);
            }}
          >
            {candidateViews.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {confirmableVisible.length > 0 && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending || !token}
            onClick={() =>
              setSelected(current =>
                allConfirmableSelected
                  ? current.filter(id => !confirmableVisible.some(row => row.id === id))
                  : [...new Set([...current, ...confirmableVisible.map(row => row.id)])],
              )
            }
          >
            {allConfirmableSelected ? '取消全选' : `全选可确认项（${confirmableVisible.length} 条）`}
          </button>
        )}
        {batch.length > 0 && (
          <button type="button" className="primary-button" disabled={pending || !token} onClick={() => begin(batch)}>
            批量确认入库（{batch.length} 条）
          </button>
        )}
      </div>
      {readError && (
        <p className="form-error" role="alert">
          收件箱读取失败 · {readError}
        </p>
      )}
      {!candidates && !readError && <p role="status">正在读取资讯候选…</p>}
      {writeError && !confirmation && (
        <p className="form-error" role="alert">
          {writeError}
        </p>
      )}
      {accepted && <p role="status">入库已排队。可在收件箱查看每条进度。</p>}
      {candidates && (
        <p>
          {candidates.date} · {items.length} 条
        </p>
      )}
      {candidates && !items.length && <p>此日期暂无符合条件的资讯候选。</p>}
      {visible.map(renderCandidate)}
      {low.length > 0 && (
        <details
          className="candidate-low"
          open={expandedLow}
          onToggle={event => setExpandedLow(event.currentTarget.open)}
        >
          <summary>低相关性（{low.length} 条）</summary>
          {low.map(renderCandidate)}
        </details>
      )}
      {confirmation && (
        <CandidateConfirmation
          value={confirmation}
          pending={pending}
          error={writeError}
          onChange={request => setConfirmation({ ...confirmation, request })}
          onClose={() => {
            setConfirmation(undefined);
            setWriteError('');
          }}
          onConfirm={() =>
            void write(async writeToken => {
              await confirmCandidates(confirmation.request, writeToken);
              setConfirmation(undefined);
              setSelected([]);
              setAccepted(true);
            })
          }
        />
      )}
    </section>
  );
}

function CandidateConfirmation({
  value,
  pending,
  error,
  onChange,
  onClose,
  onConfirm,
}: {
  value: { request: ConfirmCandidates; items: CandidateView[] };
  pending: boolean;
  error: string;
  onChange: (request: ConfirmCandidates) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useDialogFocus<HTMLDivElement>();
  const { request, items } = value;
  return (
    <div className="candidate-modal">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-confirm-title"
        className="panel candidate-dialog"
        onKeyDown={event => {
          if (event.key === 'Escape' && !pending) onClose();
        }}
      >
        <h2 id="candidate-confirm-title">确认入库（{items.length} 条）</h2>
        <ul>
          {items.map(row => (
            <li key={row.id}>
              <strong>{row.item.title}</strong>
              <br />
              {evidenceLabel(row)}
            </li>
          ))}
        </ul>
        <label className="candidate-check">
          <input
            type="checkbox"
            disabled={pending}
            checked={request.organize}
            onChange={event => onChange({ ...request, organize: event.target.checked })}
          />
          确认后自动整理
        </label>
        {request.organize && (
          <label className="candidate-mode">
            整理模式
            <select
              value={request.mode}
              disabled={pending}
              onChange={event => onChange({ ...request, mode: event.target.value as ConfirmCandidates['mode'] })}
            >
              <option value="standard">标准整理</option>
              <option value="deep">深度整理</option>
            </select>
          </label>
        )}
        <p>
          {request.organize
            ? '确认即授权保存所列来源材料并发起一次 AI 整理，产生的草稿等待人工审核。'
            : '确认后仅保存所列来源材料到 Raw。'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="automation-actions">
          <button type="button" className="primary-button" disabled={pending} onClick={onConfirm}>
            {pending ? '正在提交…' : '确认并入库'}
          </button>
          <button type="button" className="secondary-button" data-autofocus disabled={pending} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
