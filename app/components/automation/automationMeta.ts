import type {
  AutomationPlan,
  AutomationRunStatus,
  AutomationSchedule,
  CandidateFilter,
  CandidateView,
  PipelineSettings,
  ReminderSettings,
  WorkReminder,
} from '../../api';

export type AutomationTab = 'workflows' | 'inbox' | 'runs';
export type InboxSection = 'candidates' | 'reminders';
export type InboxCandidateFilter = CandidateFilter | 'drafts';
export type ReminderFilterKind = 'all' | WorkReminder['kind'];
export type RunStatusTone = 'ok' | 'danger' | 'warning' | 'accent' | 'muted';

export type ScheduleEditorState = {
  type: string;
  revision: number;
  enabled: boolean;
  catchUp: boolean;
  kind: AutomationPlan['kind'];
  minutes: string;
  time: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

export type PipelineSettingsEdit = Omit<PipelineSettings, 'topics'> & { topics: string };

export type ReminderEditor = Omit<ReminderSettings, 'staleDays' | 'maxToastsPerRun'> & {
  revision: number;
  staleDays: string;
  maxToastsPerRun: string;
};

export type WorkflowGroupId = 'news.daily' | 'wiki.health' | 'work.reminders' | 'review.weekly' | 'system.selfcheck';

export type WorkflowMeta = {
  title: string;
  description: string;
  boundary: string;
};

export const workflowMeta: Record<WorkflowGroupId, WorkflowMeta> = {
  'news.daily': {
    title: '每日资讯采集与整理',
    description: '定时抓取快消与 AI 资讯并预筛，经人工确认后保存 Raw 并整理为待审草稿。',
    boundary: '不自动写 Raw/Wiki',
  },
  'wiki.health': {
    title: '知识库定时巡检',
    description: '结合每日结构检查与每周主动检查，只读产出快照与待核发现供知识库处理。',
    boundary: '不改正式 Wiki',
  },
  'work.reminders': {
    title: '工作事项提醒',
    description: '定时扫描到期跟进、久未推进与新资料待分析事项，去重后按免打扰策略投递通知。',
    boundary: '不改事项状态',
  },
  'review.weekly': {
    title: '每周工作回顾草稿',
    description: '汇总上一自然周事实快照，并按设置开关起草 AI 周报供周期回顾使用。',
    boundary: '不覆盖人工编辑/已审阅归档',
  },
  'system.selfcheck': {
    title: '工作台系统自检',
    description: '执行 5 项本地健康检查并记录诊断结果，不产生业务写入。',
    boundary: '无业务写入',
  },
};

export const statusLabels: Record<AutomationRunStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  skipped: '已跳过',
};

export const triggerLabels = {
  schedule: '计划',
  manual: '手动',
  'catch-up': '启动后补跑',
} as const;

export const issueLabels = {
  read: '无法读取',
  parse: '格式损坏',
  directory: '无法读取目录',
  shape: '记录字段无效',
} as const;

export const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export const runError = (error: string) =>
  error === 'paused' ? '全局已暂停' : error === 'overlap' ? '同类任务正在运行' : error;

export const isActive = (status: AutomationRunStatus) => status === 'queued' || status === 'running';

export const describeError = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请稍后重试。');

export function describePlan(plan: AutomationPlan): string {
  if (plan.kind === 'interval') return `每 ${plan.minutes} 分钟`;
  if (plan.kind === 'daily') return `每天 ${plan.time}`;
  return `每${weekdays[plan.weekday - 1]} ${plan.time}`;
}

/** Compute the previous completed ISO week key (YYYY-Wxx) in Asia/Shanghai time, matching PeriodReview. */
export function lastCompletedIsoWeek(nowMs = Date.now()): string {
  const shanghai = new Date(nowMs + 8 * 3600_000);
  const day = shanghai.getUTCDay();
  const thisMonday = new Date(
    Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate() - ((day + 6) % 7)),
  );
  const lastThursday = new Date(thisMonday.getTime() - 4 * 86_400_000);
  const year = lastThursday.getUTCFullYear();
  const weekNumber = Math.floor((lastThursday.getTime() - Date.UTC(year, 0, 1)) / 604_800_000) + 1;
  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

export function createScheduleEditor(schedule: AutomationSchedule): ScheduleEditorState {
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

export function runStatusTone(status: AutomationRunStatus): RunStatusTone {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed') return 'danger';
  if (status === 'interrupted') return 'warning';
  if (status === 'running' || status === 'queued') return 'accent';
  return 'muted';
}

export const reminderKinds: Record<WorkReminder['kind'], string> = {
  due_follow_up: '到期跟进',
  stale_item: '久未推进',
  new_raw_ready: '新资料待分析',
};

export const reminderStatuses: Record<WorkReminder['status'], string> = {
  unread: '未读',
  acknowledged: '已读',
  snoozed: '已延后',
  resolved: '已消解',
};

export const reminderDeliveryLabels: Record<WorkReminder['deliveryStatus'], string> = {
  pending: '待投递',
  delivered: '已投递',
  suppressed_quiet_hours: '免打扰期间',
  suppressed_disabled: '已关闭',
  suppressed_non_windows: '当前环境不支持',
  failed: '投递失败',
};

export function reminderKindTone(kind: WorkReminder['kind']): 'danger' | 'warning' | 'accent' {
  if (kind === 'due_follow_up') return 'danger';
  if (kind === 'stale_item') return 'warning';
  return 'accent';
}

export const candidateStages = {
  queued_raw: '等待保存 Raw',
  saving_raw: '正在保存 Raw',
  raw_failed: 'Raw 保存失败',
  queued_organize: '等待整理',
  organizing: '整理中',
  organize_failed: '整理失败',
  interrupted: '整理已中断',
  saved: '已保存 Raw',
  draft_ready: '草稿已生成',
} as const;

export const candidateViews: Array<[InboxCandidateFilter, string]> = [
  ['all', '收件箱'],
  ['fetched', '已抓取'],
  ['pending', '待确认'],
  ['organizing', '整理中'],
  ['drafts', '待审草稿'],
  ['failed', '失败'],
  ['ignored', '已忽略'],
];

export const evidenceLabel = (row: CandidateView) =>
  row.item.evidenceKind === 'source_summary' ? '来源摘要（未核验原文）' : '来源正文摘录（非全文）';

export const candidateScore = (row: CandidateView) =>
  row.screening && 'score' in row.screening ? row.screening.score : undefined;

export const canConfirmCandidate = (row: CandidateView) =>
  (!row.confirmation || row.canReimport) && !row.savedRawId && !row.saveIssue && row.disposition !== 'ignored';

export const isOrganizingCandidate = (row: CandidateView) =>
  ['queued_raw', 'saving_raw', 'queued_organize', 'organizing'].some((phase) => phase === row.execution?.phase);

export const isFailedCandidate = (row: CandidateView) =>
  Boolean(row.saveIssue) ||
  (!row.draftPending &&
    ['raw_failed', 'organize_failed', 'interrupted'].some((phase) => phase === row.execution?.phase));
