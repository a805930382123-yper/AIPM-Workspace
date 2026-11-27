import type { WikiFreshnessSummary } from '../../services/audit/lint';
import type { AnswerCitation } from '../../services/wiki/question-input';
import type { readWikiFreshness, wikiReviewQueue } from '../../services/wiki/review-service';
import type { ReviewQueueView } from '../../services/wiki/freshness';
import { api } from './client';

export type WikiReviewFreshness = NonNullable<Awaited<ReturnType<typeof readWikiFreshness>>>[string];
export type DisplayAnswerCitation = AnswerCitation & { freshness?: WikiReviewFreshness; reviewRevision?: number };
export type WikiReviewQueue = Awaited<ReturnType<typeof wikiReviewQueue>>;
export type WikiReviewIndex = {
  engine: 'legacy_scan' | 'sqlite_fts' | 'hybrid';
  sqlite: 'disabled' | 'stale' | 'unavailable' | 'ready';
  vectorState?: 'error' | 'building' | 'disabled' | 'ready' | 'empty';
};
export type WikiReviewAction = { kind: 'confirm' | 'snooze' } | { kind: 'cycle'; days: number };

export const getWikiReviewQueue = (view: ReviewQueueView) =>
  api<WikiReviewQueue>(`/api/wiki/review-queue?view=${view}`);
export const getWikiReviewIndex = () => api<WikiReviewIndex>('/api/wiki/review-index');
export const reviewWiki = (id: string, baseRevision: number, action: WikiReviewAction) =>
  api<Wiki>(`/api/wiki/${encodeURIComponent(id)}/review/${action.kind}`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, ...(action.kind === 'cycle' ? { reviewCycleDays: action.days } : {}) }),
  });
export const confirmWikiAnswerCitation = (answerId: string, citationId: string, baseRevision: number) =>
  api<Wiki>(
    `/api/knowledge/answers/${encodeURIComponent(answerId)}/citations/${encodeURIComponent(citationId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ baseRevision }),
    },
  );

export type WikiType = 'source' | 'concept' | 'entity' | 'business_process' | 'metric' | 'synthesis';

export type Wiki = {
  id: string;
  title: string;
  type: WikiType;
  domain: 'fmcg';
  category: string;
  created: string;
  updated: string;
  sources: string[];
  tags: string[];
  knowledge_status: string;
  confidence: string;
  source_level: string;
  review_status: string;
  aliases: string[];
  revision: number;
  body: string;
  isDemo?: boolean;
  freshness?: WikiReviewFreshness;
  backlinks?: Array<{ id: string; title: string }>;
  links?: Array<{
    target: string;
    status: 'resolved' | 'missing' | 'ambiguous';
    candidates: Array<{ id: string; title: string }>;
  }>;
};

export type WikiInput = Pick<
  Wiki,
  | 'title'
  | 'type'
  | 'category'
  | 'sources'
  | 'tags'
  | 'knowledge_status'
  | 'confidence'
  | 'source_level'
  | 'review_status'
  | 'aliases'
  | 'body'
>;

export type Audit = {
  id: string;
  wikiId: string;
  scope: 'page' | 'paragraph';
  severity: 'error' | 'warning' | 'suggestion' | 'supplement';
  comment: string;
  anchor: { before: string; text: string; after: string };
  pageBodySha256: string;
  createdRevision: number;
  revision: number;
  createdAt: string;
  status: 'open' | 'resolved';
  location: {
    status: 'located' | 'uncertain' | 'found' | 'ambiguous' | 'stale' | 'missing';
    start: number;
    end: number;
    method: string;
    reason?: string;
  };
  pendingDraftId?: string;
  decisionHistory: Array<{ decision: string; reason?: string; at: string }>;
};

export type AuditDraft = {
  id: string;
  auditId: string;
  revision: number;
  status: 'pending' | 'discarded' | 'applied';
  baseWikiRevision: number;
  baseAuditRevision: number;
  replacement: string;
  rationale: string;
  evidence: Array<{ rawId: string; quote: string }>;
  provider: { name: string; model: string };
};

export type AuditConflict = {
  operationId: string;
  status: 'conflict';
  decision: string;
  createdAt: string;
  conflictReason: string;
  expectedWikiRevision: number;
  observedWikiRevision: number | null;
  changedRawIds: string[];
};

export type WikiLintResult = {
  generatedAt: string;
  wikiFilesSha256: string;
  findings: Array<{
    code: string;
    objectId: string | null;
    pageTitle: string | null;
    file: string;
    message: string;
    location: { scope: 'page' | 'line'; line: number; text?: string };
  }>;
  summary: Record<string, number>;
  freshness?: WikiFreshnessSummary;
};

export type WikiSchema = {
  freshnessEnabled?: boolean;
  domain: string;
  types: Array<{ id: WikiType; label: string; description: string }>;
  categories: Array<{ id: string; label: string }>;
  enums: Record<string, string[]>;
  pageTemplates: Record<WikiType, { sections: Array<{ key: string; label: string; hint?: string }> }>;
  sourcePolicy: { levels: Array<{ id: string; label: string; description: string }>; guidance: string };
};
