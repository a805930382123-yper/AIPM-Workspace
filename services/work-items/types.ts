export const workStatuses = ['triage', 'in_progress', 'waiting', 'retest', 'closed'] as const;
export type WorkStatus = typeof workStatuses[number];

export type WorkHistoryInput =
  | { kind: 'feedback' | 'reproduction' | 'technical_reply'; body: string }
  | { kind: 'sent'; body: string; sentAt: string }
  | { kind: 'retest'; body: string; outcome: 'passed' | 'failed' };

export type WorkHistory = (WorkHistoryInput | { kind: 'closed' | 'reopened'; body: string }) & { at: string };

export type WorkScreenshot = { id: string; type: 'image/png' | 'image/jpeg'; note?: string; uploadedAt: string };

export type WorkItem = {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  feedback: string;
  status: WorkStatus;
  customer?: string;
  project?: string;
  occurredAt?: string;
  waitingFor?: string;
  nextStep?: string;
  followUpOn?: string;
  reportDraft?: string;
  rawIds: string[];
  history: WorkHistory[];
  screenshots: WorkScreenshot[];
};

export type WorkItemSummary = Pick<WorkItem, 'id' | 'revision' | 'title' | 'status' | 'followUpOn' | 'updatedAt'>;

export type WorkContextInput = Pick<WorkItem, 'customer' | 'project' | 'occurredAt' | 'waitingFor' | 'nextStep' | 'followUpOn'>;
export type WorkItemUpdate = WorkContextInput & {
  baseRevision: number;
  status?: WorkStatus;
  closureReason?: string;
  reopen?: true;
  reportDraft?: string;
  rawIds?: string[];
  history?: WorkHistoryInput;
};
