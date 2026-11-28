import type { WorkHistory, WorkItemKind, WorkStatus } from '../../api';

export const customerStatusLabels: Record<WorkStatus, string> = {
  triage: '待整理',
  in_progress: '处理中',
  waiting: '等待处理',
  retest: '待复测',
  closed: '已解决',
};
export const analysisStatusLabels: Partial<Record<WorkStatus, string>> = {
  triage: '待开始',
  in_progress: '进行中',
  waiting: '等待补充',
  closed: '已完成',
};
export const workKindLabel = (kind?: WorkItemKind) => (kind === 'product_analysis' ? '产品分析' : '客户问题');
export const workStatusLabel = (kind: WorkItemKind | undefined, status: WorkStatus) =>
  (kind === 'product_analysis' ? analysisStatusLabels[status] : undefined) ?? customerStatusLabels[status];
export const historyLabels: Record<WorkHistory['kind'], string> = {
  feedback: '补充客户反馈',
  reproduction: '复现记录',
  technical_reply: '技术回复',
  customer_reply: '回复客户',
  sent: '已发送技术反馈',
  retest: '复测记录',
  stage_result: '阶段成果',
  closed: '关闭事项',
  reopened: '重开事项',
};
export const eventTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const formatTime = (value: string) => eventTime.format(new Date(value));
export const inputTime = (value?: string) =>
  value ? new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 19) : '';
export const timestamp = (value: string) => (value ? `${value.length === 16 ? `${value}:00` : value}+08:00` : '');
export const errorText = (error: unknown) => (error instanceof Error ? error.message : '本机记录操作失败，请重试。');

export function Status({ kind, value }: { kind?: WorkItemKind; value: WorkStatus }) {
  return (
    <span
      className={`work-status ${value === 'waiting' ? 'action-warning' : value === 'closed' ? 'action-neutral' : 'action-review'}`}
    >
      {workStatusLabel(kind, value)}
    </span>
  );
}
