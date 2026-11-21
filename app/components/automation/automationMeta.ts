import type { AutomationPlan, AutomationRunStatus } from '../../api';

export type AutomationTab = 'workflows' | 'inbox' | 'runs';

export type WorkflowGroupId =
  | 'news.daily'
  | 'wiki.health'
  | 'work.reminders'
  | 'review.weekly'
  | 'system.selfcheck';

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

export const describeError = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请稍后重试。';

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
