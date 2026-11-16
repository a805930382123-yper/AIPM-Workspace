export type AutomationPlan =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string; timezone: 'Asia/Shanghai' };

export const automationRunStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'skipped'] as const;
export type AutomationRunStatus = typeof automationRunStatuses[number];
export type AutomationTrigger = 'schedule' | 'manual' | 'catch-up';

export type AutomationRunSummary = {
  id: string;
  type: string;
  trigger: AutomationTrigger;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  status: AutomationRunStatus;
  error?: string;
};

export type AutomationStep = {
  name: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  summary: string;
  error?: string;
};

export type AutomationUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  unknownUsageCount: number;
};

export type AutomationRun = AutomationRunSummary & {
  steps: AutomationStep[];
  usage: AutomationUsage;
  sourceRequests?: number;
  candidateId?: string;
  artifacts: { rawIds: string[]; jobIds: string[]; draftIds: string[] };
  budget: null;
};

export type AutomationSchedule = {
  type: string;
  name: string;
  enabled: boolean;
  plan: AutomationPlan;
  catchUp: boolean;
  revision: number;
  budget: null;
  nextRunAt: string | null;
  lastRun: AutomationRunSummary | null;
  mayCallModel: boolean;
  allowsCatchUp: boolean;
};

export type AutomationSchedulePatch = { revision: number; enabled?: boolean; plan?: AutomationPlan; catchUp?: boolean };

export type AutomationInstance = {
  pid: number;
  port: number;
  mode: 'development' | 'production';
  startedAt: string;
  hostname: string;
};

export type AutomationStatus = {
  paused: boolean;
  scheduler: { healthy: boolean; lastTickAt: string | null; error?: string };
  instance: AutomationInstance;
  nextRunAt: string | null;
  failuresLast24Hours: number;
  writeToken: string;
};

export type AutomationIssue = { file: string; reason: 'read' | 'parse' | 'directory' | 'shape' };
export type AutomationList<T> = { items: T[]; issues?: AutomationIssue[] };
