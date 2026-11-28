import { useEffect, useState } from 'react';
import type {
  AutomationList,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationStatus,
  CandidateList,
  KnowledgeHealth,
  PipelineSettings,
  ReminderView,
  WeeklyReviewList,
} from '../../api';
import {
  automationCandidates,
  automationKnowledgeHealth,
  automationReminders,
  automationRun,
  automationRuns,
  automationSchedules,
  automationStatus,
  readPipelineSettings,
  weeklyReviews,
} from '../../api';
import { describeError } from '../../components/automation/automationMeta';

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

export function useAutomationPolling({
  showHealth,
  showReminders,
  refresh,
  remindersRevision,
  pipelineRevision,
  pipelineSettingsRevision,
  weeklyRevision,
  candidateDate,
  typeFilter,
  statusFilter,
  limit,
  selectedRunId,
}: {
  showHealth: boolean;
  showReminders: boolean;
  refresh: number;
  remindersRevision: number;
  pipelineRevision: number;
  pipelineSettingsRevision: number;
  weeklyRevision: number;
  candidateDate?: string;
  typeFilter: string;
  statusFilter: AutomationRunStatus | '';
  limit: number;
  selectedRunId: string | null;
}) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [schedules, setSchedules] = useState<AutomationList<AutomationSchedule> | null>(null);
  const [history, setHistory] = useState<AutomationList<AutomationRun> | null>(null);
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [remindersView, setRemindersView] = useState<ReminderView | null>(null);
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
  const [detail, setDetail] = useState<AutomationRun | null>(null);
  const tasks = schedules?.items ?? [];
  const hasPipeline = tasks.some((task) => task.type === 'news.daily');
  const hasWeeklyReview = tasks.some((task) => task.type === 'review.weekly');

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

  return {
    status,
    setStatus,
    schedules,
    history,
    setHistory,
    health,
    remindersView,
    setRemindersView,
    candidates,
    setCandidates,
    pipelineSettings,
    setPipelineSettings,
    weeklyList,
    setWeeklyList,
    readErrors,
    setReadErrors,
    detail,
    setDetail,
    tasks,
    hasPipeline,
    hasWeeklyReview,
  };
}
