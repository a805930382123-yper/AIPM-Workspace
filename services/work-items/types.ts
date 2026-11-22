export const workStatuses = ['triage', 'in_progress', 'waiting', 'retest', 'closed'] as const;
export type WorkStatus = (typeof workStatuses)[number];
export type WorkItemKind = 'customer_issue' | 'product_analysis';

export type WorkAnalysis = {
  goal: string;
  dataScope?: string;
  confirmedConclusions?: string;
  openQuestions?: string;
};

export type WorkAnalysisSource = { rawId: string; title: string; body: string };
export type WorkAnalysisOutput = {
  observations: Array<{ rawId: string; quote: string; observation: string }>;
  suggestions: string[];
  openQuestions: string[];
};

export type WorkAnalysisStageContext = {
  historyIndex: number;
  at: string;
  body: string;
  source: 'manual' | 'ai_assisted';
  analysisRunId?: string;
};

export type WorkAnalysisTheme = {
  title: string;
  conclusion: { kind: 'evidence_supported' | 'hypothesis'; text: string } | null;
  evidence: number[];
  counterEvidence: number[];
  openQuestions: string[];
  nextSteps: string[];
  confirmedConflict: { confirmedQuote: string; observationIndexes: number[]; suggestedRevision: string } | null;
};

export type WorkAnalysisOutputV2 = WorkAnalysisOutput & { roundSummary: string; themes: WorkAnalysisTheme[] };

export type WorkAnalysisRun = {
  id: string;
  itemId: string;
  baseRevision: number;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  provider: { name: string; model: string };
  outputVersion?: 2;
  input: WorkAnalysis & {
    sources: WorkAnalysisSource[];
    roundQuestion?: string;
    stageContext?: WorkAnalysisStageContext;
  };
  sourceRawIds?: string[];
  output?: WorkAnalysisOutput | WorkAnalysisOutputV2;
  error?: { code: string; message: string };
};

export type WorkBasisCheck = {
  target: string;
  decision: 'supported' | 'unsupported' | 'uncertain';
  reason: string;
  evidence: Array<{ rawId: string; quote: string }>;
};

export type WorkBasisReview = {
  version: 1;
  itemId: string;
  runId: string;
  reviewId: string;
  attempt: number;
  provider: WorkAnalysisRun['provider'];
  startedAt: string;
} & (
  | { status: 'running' }
  | { status: 'completed'; finishedAt: string; result: { checks: WorkBasisCheck[] } }
  | { status: 'failed'; finishedAt: string; error: { code: string; message: string } }
  | { status: 'interrupted'; error: { code: string; message: string } }
);

export type WorkAnalysisRunWithReview = WorkAnalysisRun & {
  basisReview?: WorkBasisReview | { status: 'unavailable'; error: { code: string; message: string } };
};

export type WorkAnalysisRunInput = { baseRevision: number; rawIds: string[] } & (
  | { outputVersion?: never; roundQuestion?: never; stageHistoryIndex?: never }
  | { outputVersion: 2; roundQuestion?: string; stageHistoryIndex?: number }
);
export type WorkItemCreate =
  | { kind?: 'customer_issue'; title: string; feedback: string }
  | { kind: 'product_analysis'; title: string; goal: string };

export type WorkHistoryInput =
  | { kind: 'feedback' | 'reproduction' | 'technical_reply' | 'customer_reply'; body: string }
  | { kind: 'sent'; body: string; sentAt: string }
  | { kind: 'retest'; body: string; outcome: 'passed' | 'failed' }
  | { kind: 'stage_result'; body: string; analysisRunId?: string };

export type WorkHistory = (WorkHistoryInput | { kind: 'closed' | 'reopened'; body: string }) & { at: string };

export type WorkScreenshot = { id: string; type: 'image/png' | 'image/jpeg'; note?: string; uploadedAt: string };

export type WorkItem = {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  title: string;
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
} & (
  | { kind?: 'customer_issue'; feedback: string; analysis?: never }
  | { kind: 'product_analysis'; analysis: WorkAnalysis; feedback?: never }
);

export type WorkItemSummary = Pick<WorkItem, 'id' | 'revision' | 'title' | 'status' | 'followUpOn' | 'updatedAt'> & {
  kind: WorkItemKind;
};

export type WorkContextInput = Pick<
  WorkItem,
  'customer' | 'project' | 'occurredAt' | 'waitingFor' | 'nextStep' | 'followUpOn'
>;
export type WorkItemUpdate = WorkContextInput & {
  baseRevision: number;
  status?: WorkStatus;
  closureReason?: string;
  reopen?: true;
  reportDraft?: string;
  analysis?: Partial<WorkAnalysis>;
  rawIds?: string[];
  history?: WorkHistoryInput;
};
