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
};

export type WikiSchema = {
  domain: string;
  types: Array<{ id: WikiType; label: string; description: string }>;
  categories: Array<{ id: string; label: string }>;
  enums: Record<string, string[]>;
  pageTemplates: Record<WikiType, { sections: Array<{ key: string; label: string; hint?: string }> }>;
  sourcePolicy: { levels: Array<{ id: string; label: string; description: string }>; guidance: string };
};
