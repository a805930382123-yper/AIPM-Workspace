import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AutomationList,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationStatus,
  CandidateFilter,
  CandidateList,
  KnowledgeHealth,
  PipelineSettings,
  ReminderView,
  WeeklyReviewList,
} from '../api';
import {
  ApiError,
  automationCandidates,
  automationKnowledgeHealth,
  automationReminders,
  automationRun,
  automationRuns,
  automationSchedules,
  automationStatus,
  automationTime,
  cancelAutomationRun,
  changeAutomationPause,
  editAutomationSchedule,
  readPipelineSettings,
  runAutomationTask,
  savePipelineSettings,
  testReminderNotification,
  updateReminderSettings,
  updateWeeklyReviewSettings,
  weeklyReviews,
} from '../api';
import {
  PipelineSettingsDialog,
  ReminderSettingsDialog,
  ScheduleEditorDialog,
} from '../components/automation/AutomationDialogs';
import { InboxTab } from '../components/automation/InboxTab';
import { RunDetailContent, RunDetailDrawer } from '../components/automation/RunDetailView';
import { RunsTab } from '../components/automation/RunsTab';
import { WorkflowsTab } from '../components/automation/WorkflowsTab';
import {
  createScheduleEditor,
  describeError,
  reminderDeliveryLabels,
  type AutomationTab,
  type InboxCandidateFilter,
  type InboxSection,
  type PipelineSettingsEdit,
  type ReminderEditor,
  type ScheduleEditorState,
} from '../components/automation/automationMeta';
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

const tabOrder: AutomationTab[] = ['workflows', 'inbox', 'runs'];

export function AutomationPage({
  onOpenRaw,
  onOpenDraft,
  onOpenLint,
  onOpenInspection,
  onOpenWorkItem,
  onOpenWeeklyReview,
  initialTab,
  initialRunId,
  focusReminders,
  candidateFilter,
}: {
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string, returnTab?: AutomationTab) => void;
  onOpenLint?: () => void;
  onOpenInspection?: (id?: string) => void;
  onOpenWorkItem?: (id: string, focusMaterials?: boolean) => void;
  onOpenWeeklyReview?: (weekKey: string) => void;
  initialTab?: AutomationTab;
  initialRunId?: string;
  focusReminders?: boolean;
  candidateFilter?: CandidateFilter;
}) {
  const resolvedInitialTab: AutomationTab =
    initialTab ?? (initialRunId ? 'runs' : candidateFilter || focusReminders ? 'inbox' : 'workflows');

  const [tab, setTab] = useState<AutomationTab>(resolvedInitialTab);
  const handleOpenDraft = (id: string) => onOpenDraft(id, tab);
  const [inboxSection, setInboxSection] = useState<InboxSection>(() => (focusReminders ? 'reminders' : 'candidates'));
  const [inboxFilter, setInboxFilter] = useState<InboxCandidateFilter>(candidateFilter ?? 'all');
  const [inboxFocus, setInboxFocus] = useState<InboxSection | null>(() =>
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
  const [pipelineSettings, setPipelineSettings] = useState<PipelineSettings>();
  const [weeklyList, setWeeklyList] = useState<WeeklyReviewList | null>(null);

  const [readErrors, setReadErrors] = useState({
    status: '',
    schedules: '',
    history: '',
    detail: '',
    health: '',
    reminders: '',
    candidates: '',
    pipelineSettings: '',
    weekly: '',
  });
  const [refresh, setRefresh] = useState(0);
  const [remindersRevision, setRemindersRevision] = useState(0);
  const [pipelineRevision, setPipelineRevision] = useState(0);
  const [pipelineSettingsRevision, setPipelineSettingsRevision] = useState(0);
  const [weeklyRevision, setWeeklyRevision] = useState(0);

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationRunStatus | ''>('');
  const [limit, setLimit] = useState(50);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId ?? null);
  const [detail, setDetail] = useState<AutomationRun | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const runTriggerRef = useRef<HTMLElement | null>(null);

  const [editor, setEditor] = useState<ScheduleEditorState | null>(null);
  const [pipelineSettingsEdit, setPipelineSettingsEdit] = useState<PipelineSettingsEdit | null>(null);
  const [pipelineSettingsPending, setPipelineSettingsPending] = useState(false);
  const [pipelineSettingsWriteError, setPipelineSettingsWriteError] = useState('');
  const [reminderEditor, setReminderEditor] = useState<ReminderEditor | null>(null);
  const [reminderSettingsPending, setReminderSettingsPending] = useState(false);
  const [reminderSettingsFeedback, setReminderSettingsFeedback] = useState<{
    area: 'settings' | 'test';
    text: string;
    error?: boolean;
  } | null>(null);

  const [pauseConfirmation, setPauseConfirmation] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<{ area: string; message: string } | null>(null);

  const [weeklyPending, setWeeklyPending] = useState(false);
  const [weeklyError, setWeeklyError] = useState('');
  const [weeklyConflict, setWeeklyConflict] = useState(false);

  const showHealth = Boolean(onOpenLint || onOpenInspection);
  const showReminders = Boolean(onOpenWorkItem);
  const tasks = schedules?.items ?? [];
  const hasPipeline = tasks.some((task) => task.type === 'news.daily');
  const hasWeeklyReview = tasks.some((task) => task.type === 'review.weekly');

  const prevDeepLink = useRef({ candidateFilter, focusReminders, initialRunId });
  useEffect(() => {
    const prev = prevDeepLink.current;
    prevDeepLink.current = { candidateFilter, focusReminders, initialRunId };
    if (initialRunId && initialRunId !== prev.initialRunId) {
      setSelectedRunId(initialRunId);
      setTab('runs');
    } else if (focusReminders && !prev.focusReminders) {
      setTab('inbox');
      setInboxSection('reminders');
      setInboxFocus('reminders');
      setInboxFocusTick((value) => value + 1);
    } else if (candidateFilter && candidateFilter !== prev.candidateFilter) {
      setInboxFilter(candidateFilter);
      setTab('inbox');
      setInboxSection('candidates');
      setInboxFocus('candidates');
      setInboxFocusTick((value) => value + 1);
    }
  }, [candidateFilter, focusReminders, initialRunId]);

  useEffect(
    () =>
      poll(async (signal) => {
        const [service, taskList] = await Promise.allSettled([automationStatus(signal), automationSchedules(signal)]);
        if (signal.aborted) return;
        if (service.status === 'fulfilled') setStatus(service.value);
        if (taskList.status === 'fulfilled') setSchedules(taskList.value);
        setReadErrors((current) => ({
          ...current,
          status: service.status === 'rejected' ? describeError(service.reason) : '',
          schedules: taskList.status === 'rejected' ? describeError(taskList.reason) : '',
        }));
      }),
    [refresh],
  );

  useEffect(() => {
    if (!showHealth) return;
    return poll(async (signal) => {
      try {
        const result = await automationKnowledgeHealth(signal);
        if (!signal.aborted) {
          setHealth(result);
          setReadErrors((current) => ({ ...current, health: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors((current) => ({ ...current, health: describeError(error) }));
      }
    });
  }, [showHealth, refresh]);

  useEffect(() => {
    if (!showReminders) return;
    return poll(async (signal) => {
      try {
        const result = await automationReminders(signal);
        if (!signal.aborted) {
          setRemindersView(result);
          setReadErrors((current) => ({ ...current, reminders: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors((current) => ({ ...current, reminders: describeError(error) }));
      }
    });
  }, [showReminders, refresh, remindersRevision]);

  useEffect(() => {
    if (!hasPipeline) return;
    return poll(async (signal) => {
      try {
        const result = await automationCandidates(candidateDate, signal);
        if (!signal.aborted) {
          setCandidates(result);
          setReadErrors((current) => ({ ...current, candidates: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors((current) => ({ ...current, candidates: describeError(error) }));
      }
    });
  }, [hasPipeline, candidateDate, refresh, pipelineRevision]);

  useEffect(() => {
    if (!hasPipeline) return;
    const controller = new AbortController();
    void readPipelineSettings(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setPipelineSettings(value);
          setReadErrors((current) => ({ ...current, pipelineSettings: '' }));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setReadErrors((current) => ({ ...current, pipelineSettings: describeError(error) }));
        }
      });
    return () => controller.abort();
  }, [hasPipeline, refresh, pipelineSettingsRevision]);

  useEffect(() => {
    if (!hasWeeklyReview) return;
    return poll(async (signal) => {
      try {
        const result = await weeklyReviews(signal);
        if (!signal.aborted) {
          setWeeklyList(result);
          setReadErrors((current) => ({ ...current, weekly: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors((current) => ({ ...current, weekly: describeError(error) }));
      }
    });
  }, [hasWeeklyReview, refresh, weeklyRevision]);

  useEffect(
    () =>
      poll(async (signal) => {
        try {
          const runs = await automationRuns({ type: typeFilter, status: statusFilter, limit }, signal);
          if (!signal.aborted) {
            setHistory(runs);
            setReadErrors((current) => ({ ...current, history: '' }));
          }
        } catch (error) {
          if (!signal.aborted) setReadErrors((current) => ({ ...current, history: describeError(error) }));
        }
      }),
    [typeFilter, statusFilter, limit, refresh],
  );

  useEffect(() => {
    if (!selectedRunId) return;
    return poll(async (signal) => {
      try {
        const run = await automationRun(selectedRunId, signal);
        if (!signal.aborted) {
          setDetail(run);
          setReadErrors((current) => ({ ...current, detail: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors((current) => ({ ...current, detail: describeError(error) }));
      }
    });
  }, [selectedRunId, refresh]);

  useEffect(() => {
    if (!selectedRunId) return;
    detailHeading.current?.scrollIntoView?.({ block: 'nearest' });
    detailHeading.current?.focus();
  }, [selectedRunId, tab]);

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
      setRefresh((value) => value + 1);
      setPending(false);
    }
  };

  const chooseRun = (id: string, run: AutomationRun | null = null, trigger?: HTMLElement | null) => {
    const active = document.activeElement;
    runTriggerRef.current = trigger ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    if (id !== selectedRunId) setDetail(run);
    setSelectedRunId(id);
    setReadErrors((current) => ({ ...current, detail: '' }));
  };

  const closeRunDetail = () => {
    const trigger = runTriggerRef.current;
    runTriggerRef.current = null;
    setSelectedRunId(null);
    setDetail(null);
    if (trigger?.isConnected) trigger.focus();
  };

  const viewInRuns = () => {
    runTriggerRef.current = null;
    setTab('runs');
    setInboxFocus(null);
  };

  const selectTab = (next: AutomationTab) => {
    if (next !== tab) {
      runTriggerRef.current = null;
      setSelectedRunId(null);
      setDetail(null);
    }
    setTab(next);
    setInboxFocus(null);
  };

  const openInbox = (target: InboxSection, filter?: InboxCandidateFilter) => {
    if (filter) setInboxFilter(filter);
    setInboxSection(target);
    setTab('inbox');
    setInboxFocus(target);
    setInboxFocusTick((value) => value + 1);
  };

  const openPipelineSettings = () => {
    if (!pipelineSettings) return;
    setPipelineSettingsWriteError('');
    setPipelineSettingsEdit({ ...pipelineSettings, topics: pipelineSettings.topics.join('\n') });
  };

  const submitPipelineSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!pipelineSettingsEdit || !status?.writeToken || pipelineSettingsPending) return;
    setPipelineSettingsPending(true);
    setPipelineSettingsWriteError('');
    try {
      const saved = await savePipelineSettings(
        {
          ...pipelineSettingsEdit,
          topics: pipelineSettingsEdit.topics
            .split(/\r?\n/u)
            .map((topic) => topic.trim())
            .filter(Boolean),
        },
        status.writeToken,
      );
      setPipelineSettings(saved);
      setPipelineSettingsEdit(null);
      setPipelineRevision((value) => value + 1);
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      setPipelineSettingsWriteError(
        conflict
          ? '流水线设置已被其他操作修改（409 版本冲突）。你的输入已保留，可加载最新设置。'
          : describeError(error),
      );
    } finally {
      setPipelineSettingsPending(false);
      setPipelineSettingsRevision((value) => value + 1);
    }
  };

  const openReminderSettings = () => {
    if (!remindersView) return;
    setReminderSettingsFeedback(null);
    setReminderEditor({
      ...remindersView.settings,
      revision: remindersView.revision,
      staleDays: String(remindersView.settings.staleDays),
      maxToastsPerRun: String(remindersView.settings.maxToastsPerRun),
    });
  };

  const submitReminderSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!reminderEditor || !status?.writeToken || reminderSettingsPending) return;
    setReminderSettingsPending(true);
    setReminderSettingsFeedback(null);
    try {
      const next = await updateReminderSettings(
        {
          ...reminderEditor,
          staleDays: Number(reminderEditor.staleDays),
          maxToastsPerRun: Number(reminderEditor.maxToastsPerRun),
        },
        status.writeToken,
      );
      setRemindersView(next);
      setReminderEditor(null);
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      setReminderSettingsFeedback({
        area: 'settings',
        error: true,
        text: conflict ? '设置已更新。请核对最新设置后再保存。' : describeError(error),
      });
    } finally {
      setRemindersRevision((value) => value + 1);
      setReminderSettingsPending(false);
    }
  };

  const sendTestReminder = async () => {
    if (!status?.writeToken || reminderSettingsPending) return;
    setReminderSettingsPending(true);
    setReminderSettingsFeedback(null);
    try {
      const delivery = await testReminderNotification(status.writeToken);
      setReminderSettingsFeedback({
        area: 'test',
        error: delivery.deliveryStatus === 'failed',
        text: `测试通知 · ${reminderDeliveryLabels[delivery.deliveryStatus]}${delivery.deliveryError ? `。${delivery.deliveryError}` : ''}`,
      });
    } catch (error) {
      setReminderSettingsFeedback({ area: 'test', error: true, text: describeError(error) });
    } finally {
      setRemindersRevision((value) => value + 1);
      setReminderSettingsPending(false);
    }
  };

  const toggleWeeklyAi = async (enabled: boolean, revision: number) => {
    if (!status?.writeToken || weeklyPending) return;
    setWeeklyPending(true);
    setWeeklyError('');
    setWeeklyConflict(false);
    try {
      const settings = await updateWeeklyReviewSettings({ revision, aiSummaryEnabled: enabled }, status.writeToken);
      setWeeklyList((current) => (current ? { ...current, settings } : current));
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
    setWeeklyRevision((value) => value + 1);
  };

  const closeEditor = () => {
    setEditor(null);
    setActionError(null);
  };

  const submitSchedule = (event: FormEvent, schedule: AutomationSchedule) => {
    event.preventDefault();
    if (!editor) return;
    void write('editor', async (token) => {
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
    type === 'pipeline.organize' ? '资讯入库与整理' : (tasks.find((task) => task.type === type)?.name ?? type);
  const showError = (area: string) =>
    actionError?.area === area && (
      <p className="form-error" role="alert">
        {actionError.message}
      </p>
    );
  const currentDetail = detail?.id === selectedRunId ? detail : null;
  const editorTask = editor ? (tasks.find((task) => task.type === editor.type) ?? null) : null;

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
          <p className="subheading">
            仅在工作台进程运行时执行。关机或休眠期间错过的任务，启动后按计划设置最多补跑一次。
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>
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
                  void write('pause', async (token) => {
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
        onKeyDown={(event) => {
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
            hasPipelineSettings={Boolean(pipelineSettings)}
            remindersView={remindersView}
            showReminders={showReminders}
            weeklyList={weeklyList}
            weeklyError={weeklyError}
            weeklyReadError={readErrors.weekly}
            weeklyPending={weeklyPending}
            weeklyConflict={weeklyConflict}
            onEditSchedule={(schedule) => {
              setEditor(createScheduleEditor(schedule));
              setActionError(null);
            }}
            onRunTask={(type, trigger) => {
              void write('run', async (token) => {
                const run = await runAutomationTask(type, token);
                chooseRun(run.id, run, trigger);
              });
            }}
            onOpenRun={(id, trigger) => chooseRun(id, null, trigger)}
            onOpenInbox={openInbox}
            onOpenPipelineSettings={openPipelineSettings}
            onOpenReminderSettings={openReminderSettings}
            onOpenLint={onOpenLint}
            onOpenInspection={onOpenInspection}
            onOpenWeeklyReview={onOpenWeeklyReview}
            onToggleWeeklyAi={(enabled, revision) => void toggleWeeklyAi(enabled, revision)}
            onReloadWeekly={reloadWeekly}
          />
        )}
      </div>

      <div role="tabpanel" id="automation-panel-inbox" aria-labelledby="automation-tab-inbox" hidden={tab !== 'inbox'}>
        {tab === 'inbox' && (
          <InboxTab
            showReminders={showReminders}
            hasPipeline={hasPipeline}
            section={inboxSection}
            onSectionChange={setInboxSection}
            focusTarget={inboxFocus}
            focusTick={inboxFocusTick}
            token={status?.writeToken}
            paused={status?.paused}
            candidates={candidates}
            candidatesReadError={readErrors.candidates}
            candidateDate={candidateDate}
            onCandidateDateChange={(nextDate) => {
              setCandidateDate(nextDate);
              setCandidates(undefined);
            }}
            candidateFilter={inboxFilter}
            onCandidateFilterChange={setInboxFilter}
            pipelineSettings={pipelineSettings}
            pipelineSettingsError={readErrors.pipelineSettings}
            onOpenPipelineSettings={openPipelineSettings}
            onPipelineChanged={() => setPipelineRevision((value) => value + 1)}
            remindersView={remindersView}
            remindersReadError={readErrors.reminders}
            onRemindersViewChange={setRemindersView}
            onRemindersChanged={() => setRemindersRevision((value) => value + 1)}
            onOpenReminderSettings={openReminderSettings}
            onOpenWorkItem={onOpenWorkItem}
            onOpenRaw={onOpenRaw}
            onOpenDraft={handleOpenDraft}
            onOpenRun={(id, trigger) => chooseRun(id, null, trigger)}
          />
        )}
      </div>

      <div role="tabpanel" id="automation-panel-runs" aria-labelledby="automation-tab-runs" hidden={tab !== 'runs'}>
        {tab === 'runs' && (
          <RunsTab
            tasks={tasks}
            hasPipeline={hasPipeline}
            typeFilter={typeFilter}
            statusFilter={statusFilter}
            limit={limit}
            history={history}
            historyError={readErrors.history}
            selectedRunId={selectedRunId}
            detail={currentDetail}
            detailError={readErrors.detail}
            cancelError={actionError?.area === 'cancel' ? actionError.message : ''}
            pending={pending}
            hasStatus={Boolean(status)}
            detailHeading={detailHeading}
            taskName={taskName}
            onTypeFilterChange={(next) => {
              setHistory(null);
              setTypeFilter(next);
            }}
            onStatusFilterChange={(next) => {
              setHistory(null);
              setStatusFilter(next);
            }}
            onLimitChange={(next) => {
              setHistory(null);
              setLimit(next);
            }}
            onSelectRun={(id, run, trigger) => chooseRun(id, run, trigger)}
            onCancelRun={(id) =>
              void write('cancel', async (token) => {
                setDetail(await cancelAutomationRun(id, token));
              })
            }
            onCloseDetail={closeRunDetail}
            onOpenRaw={onOpenRaw}
            onOpenDraft={handleOpenDraft}
            onOpenLint={onOpenLint}
            onOpenInspection={onOpenInspection}
            onOpenWeeklyReview={onOpenWeeklyReview}
          />
        )}
      </div>

      {tab !== 'runs' && selectedRunId && (
        <RunDetailDrawer pending={pending} onClose={closeRunDetail}>
          <RunDetailContent
            detail={currentDetail}
            readError={readErrors.detail}
            cancelError={actionError?.area === 'cancel' ? actionError.message : ''}
            pending={pending}
            hasStatus={Boolean(status)}
            detailHeading={detailHeading}
            taskName={taskName}
            onCancel={(id) =>
              void write('cancel', async (token) => {
                setDetail(await cancelAutomationRun(id, token));
              })
            }
            onClose={closeRunDetail}
            onViewInRuns={viewInRuns}
            onOpenRaw={onOpenRaw}
            onOpenDraft={handleOpenDraft}
            onOpenLint={onOpenLint}
            onOpenInspection={onOpenInspection}
            onOpenWeeklyReview={onOpenWeeklyReview}
          />
        </RunDetailDrawer>
      )}

      {editor && editorTask && (
        <ScheduleEditorDialog
          task={editorTask}
          editor={editor}
          pending={pending}
          canWrite={Boolean(status)}
          errorMessage={actionError?.area === 'editor' ? actionError.message : ''}
          onChange={setEditor}
          onReloadLatest={() => {
            setEditor(createScheduleEditor(editorTask));
            setActionError(null);
          }}
          onSubmit={(event) => submitSchedule(event, editorTask)}
          onClose={closeEditor}
        />
      )}

      {pipelineSettingsEdit && (
        <PipelineSettingsDialog
          latest={pipelineSettings}
          edit={pipelineSettingsEdit}
          pending={pipelineSettingsPending}
          canWrite={Boolean(status?.writeToken)}
          readError={readErrors.pipelineSettings}
          writeError={pipelineSettingsWriteError}
          onChange={setPipelineSettingsEdit}
          onReload={() => {
            if (!pipelineSettings) return;
            setPipelineSettingsWriteError('');
            setPipelineSettingsEdit({ ...pipelineSettings, topics: pipelineSettings.topics.join('\n') });
          }}
          onSubmit={(event) => void submitPipelineSettings(event)}
          onClose={() => {
            setPipelineSettingsEdit(null);
            setPipelineSettingsWriteError('');
          }}
        />
      )}

      {reminderEditor && (
        <ReminderSettingsDialog
          latest={remindersView}
          editor={reminderEditor}
          pending={reminderSettingsPending}
          canWrite={Boolean(status?.writeToken)}
          feedback={reminderSettingsFeedback}
          onChange={(patch) => {
            setReminderEditor((current) => (current ? { ...current, ...patch } : current));
            setReminderSettingsFeedback(null);
          }}
          onReload={() => {
            if (!remindersView) return;
            setReminderSettingsFeedback(null);
            setReminderEditor({
              ...remindersView.settings,
              revision: remindersView.revision,
              staleDays: String(remindersView.settings.staleDays),
              maxToastsPerRun: String(remindersView.settings.maxToastsPerRun),
            });
          }}
          onSubmit={(event) => void submitReminderSettings(event)}
          onSendTest={() => void sendTestReminder()}
          onClose={() => {
            setReminderEditor(null);
            setReminderSettingsFeedback(null);
          }}
        />
      )}
    </div>
  );
}
