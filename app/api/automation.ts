import { api, apiText } from './client';
import type {
  AutomationList,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationSchedulePatch,
  AutomationStatus,
} from '../../services/automation/types';
import type { KnowledgeHealth } from '../../services/automation/wiki-health';
import type { WikiLintSnapshot } from '../../services/automation/tasks/wiki-lint';
import type { ReminderSettings, ReminderView, WorkReminder } from '../../services/automation/reminders';
import type { ReviewSection } from '../../services/automation/weekly-review-snapshot';
import type {
  WeeklyReview,
  WeeklyReviewList,
  WeeklyReviewSettings,
} from '../../services/automation/weekly-review-store';
import type { CandidateList, ConfirmCandidates, PipelineSettings } from '../../services/automation/pipeline/service';

export type {
  AutomationList,
  AutomationPlan,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationStatus,
} from '../../services/automation/types';
export type { KnowledgeHealth } from '../../services/automation/wiki-health';
export type { WikiLintSnapshot } from '../../services/automation/tasks/wiki-lint';
export type { ReminderSettings, ReminderView, WorkReminder } from '../../services/automation/reminders';
export type { ReviewSection } from '../../services/automation/weekly-review-snapshot';
export type {
  WeeklyReview,
  WeeklyReviewList,
  WeeklyReviewSettings,
  WeeklyReviewSummary,
} from '../../services/automation/weekly-review-store';
export type {
  CandidateFilter,
  CandidateList,
  CandidateView,
  ConfirmCandidates,
  PipelineSettings,
} from '../../services/automation/pipeline/service';

export type WeeklyReviewTarget = NonNullable<ReviewSection['entries'][number]['target']>;

const automationUrl = '/api/automation';
const automationRunUrl = (id: string) => `${automationUrl}/runs/${encodeURIComponent(id)}`;
const automationWrite = (method: 'POST' | 'PATCH', token: string, input: object): RequestInit => ({
  method,
  headers: { 'X-FMCG-Automation-Token': token },
  body: JSON.stringify(input),
});

export const automationStatus = (signal?: AbortSignal) => api<AutomationStatus>(`${automationUrl}/status`, { signal });

export const automationSchedules = (signal?: AbortSignal) =>
  api<AutomationList<AutomationSchedule>>(`${automationUrl}/schedules`, { signal });

export const automationKnowledgeHealth = (signal?: AbortSignal) =>
  api<KnowledgeHealth>(`${automationUrl}/knowledge-health`, { signal });

export const automationLintSnapshot = (id: string, signal?: AbortSignal) =>
  api<WikiLintSnapshot>(`${automationUrl}/wiki-lint/${encodeURIComponent(id)}`, { signal });

export const editAutomationSchedule = (type: string, input: AutomationSchedulePatch, token: string) =>
  api<AutomationSchedule>(
    `${automationUrl}/schedules/${encodeURIComponent(type)}`,
    automationWrite('PATCH', token, input),
  );

export const changeAutomationPause = (paused: boolean, token: string) =>
  api<AutomationStatus>(
    `${automationUrl}/${paused ? 'pause' : 'resume'}`,
    automationWrite('POST', token, { confirm: true }),
  );

export const runAutomationTask = (type: string, token: string) =>
  api<AutomationRun>(`${automationUrl}/tasks/${encodeURIComponent(type)}/run`, automationWrite('POST', token, {}));

export const automationRuns = (
  { type, status, limit }: { type: string; status: AutomationRunStatus | ''; limit: number },
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (type) query.set('type', type);
  if (status) query.set('status', status);
  return api<AutomationList<AutomationRun>>(`${automationUrl}/runs?${query}`, { signal });
};

export const automationRun = (id: string, signal?: AbortSignal) => api<AutomationRun>(automationRunUrl(id), { signal });

export const cancelAutomationRun = (id: string, token: string) =>
  api<AutomationRun>(`${automationRunUrl(id)}/cancel`, automationWrite('POST', token, {}));

const remindersUrl = `${automationUrl}/reminders`;

export const automationReminders = (signal?: AbortSignal) =>
  api<ReminderView>(`${remindersUrl}?status=active`, { signal });

export const updateReminderSettings = (input: ReminderSettings & { revision: number }, token: string) =>
  api<ReminderView>(`${remindersUrl}/settings`, automationWrite('PATCH', token, input));

export const acknowledgeReminder = (id: string, token: string) =>
  api<ReminderView>(`${remindersUrl}/${encodeURIComponent(id)}/ack`, automationWrite('POST', token, {}));

export const snoozeReminder = (id: string, token: string) =>
  api<ReminderView>(`${remindersUrl}/${encodeURIComponent(id)}/snooze`, automationWrite('POST', token, {}));

export const testReminderNotification = (token: string) =>
  api<Pick<WorkReminder, 'deliveryStatus' | 'deliveryError'>>(
    `${remindersUrl}/test-notification`,
    automationWrite('POST', token, {}),
  );

const weeklyReviewsUrl = `${automationUrl}/weekly-reviews`;
const weeklyReviewUrl = (weekKey: string) => `${weeklyReviewsUrl}/${encodeURIComponent(weekKey)}`;

export const weeklyReviews = (signal?: AbortSignal) => api<WeeklyReviewList>(weeklyReviewsUrl, { signal });

export const getWeeklyReview = (weekKey: string, signal?: AbortSignal) =>
  api<WeeklyReview>(weeklyReviewUrl(weekKey), { signal });

export const saveWeeklyReview = (
  weekKey: string,
  input: { baseRevision: number; userMarkdown?: string; status?: WeeklyReview['status'] },
  token: string,
) => api<WeeklyReview>(weeklyReviewUrl(weekKey), automationWrite('PATCH', token, input));

export const regenerateWeeklyReview = (
  weekKey: string,
  input: { baseRevision: number; overwriteEdited: boolean },
  token: string,
) => api<AutomationRun>(`${weeklyReviewUrl(weekKey)}/regenerate`, automationWrite('POST', token, input));

export const updateWeeklyReviewSettings = (input: WeeklyReviewSettings, token: string) =>
  api<WeeklyReviewSettings>(`${weeklyReviewsUrl}/settings`, automationWrite('PATCH', token, input));

export const weeklyReviewExportUrl = (weekKey: string) => `${weeklyReviewUrl(weekKey)}/export`;

export const weeklyReviewMarkdown = (weekKey: string) => apiText(weeklyReviewExportUrl(weekKey));

const candidatesUrl = `${automationUrl}/candidates`;

export const automationCandidates = (date?: string, signal?: AbortSignal) =>
  api<CandidateList>(date ? `${candidatesUrl}?date=${encodeURIComponent(date)}` : candidatesUrl, { signal });

export const readPipelineSettings = (signal?: AbortSignal) =>
  api<PipelineSettings>(`${automationUrl}/pipeline/settings`, { signal });

export const savePipelineSettings = (settings: PipelineSettings, token: string) =>
  api<PipelineSettings>(`${automationUrl}/pipeline/settings`, automationWrite('PATCH', token, settings));

export const confirmCandidates = (input: ConfirmCandidates, token: string) =>
  api(`${candidatesUrl}/confirm`, automationWrite('POST', token, input));

export const changeCandidateDisposition = (id: string, action: 'ignore' | 'later' | 'restore', token: string) =>
  api(`${candidatesUrl}/${encodeURIComponent(id)}/disposition`, automationWrite('POST', token, { action }));

export const retryCandidate = (id: string, stage: 'save' | 'organize', token: string, keepPartial = false) =>
  api(
    `${candidatesUrl}/${encodeURIComponent(id)}/retry-${stage}`,
    automationWrite('POST', token, keepPartial ? { keepPartial } : {}),
  );

export const supplementCandidate = (id: string, token: string) =>
  api(`${candidatesUrl}/${encodeURIComponent(id)}/supplement`, automationWrite('POST', token, {}));

const shanghaiTime = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
});

export const automationTime = (time: string | null) => (time ? shanghaiTime.format(new Date(time)) : '—');
