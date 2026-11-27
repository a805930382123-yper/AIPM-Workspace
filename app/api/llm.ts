import type { InspectionDraftInput, InspectionFinding } from '../../services/wiki/inspection-input';
import type { KnowledgeAnswer } from '../../services/llm/knowledge-answers';
import type { ChatEndpoint, ChatTier, LlmAttemptLedger, LlmAvailability } from '../../services/llm/provider-router';
import type { AnswerCitation, QuestionDraftInput, QuestionPreview } from '../../services/wiki/question-input';
import type { KnowledgeChange, KnowledgeMaintenance } from '../../services/wiki/maintenance';
import type {
  StructuredNote,
  NoteReviewMetadata,
  NoteExclusion,
  NoteApproval,
} from '../../services/wiki/structured-note';
import type { DeepQualityReport } from '../../services/llm/knowledge-deep';
import type { DraftModelProvenance } from '../../services/llm/checkpoint-models';
import type { HumanReview } from '../../services/wiki/human-review.ts';
import type { TemplateFields, InputTemplateFields, MergedTemplateFields } from '../../services/wiki/template-fields';
import type { MediaEvidenceSource } from '../../services/raw/media-artifact';
import { api } from './client';
import type { PdfCleanupRange, SourceType } from './raw';
import type { Wiki } from './wiki';

export type LlmConfigSummary = {
  provider: string;
  baseUrlHost: string | null;
  baseUrl: string;
  model: string | null;
  keyConfigured: boolean;
  keyMask: string;
  configured: boolean;
  source: 'env' | 'local-file' | 'none';
  missing: string[];
  configFile: string;
  envNames: Record<string, string>;
  revision: string;
  writeToken: string;
  environmentLocked: boolean;
};

export type LlmRoutingStatus = Pick<Awaited<ReturnType<LlmAttemptLedger['read']>>, 'endpoints' | 'switches'> & {
  availability: LlmAvailability;
};

export type RawStatus = 'unprocessed' | 'processing' | 'pending_confirmation' | 'generated' | 'failed';

export type RawProcessingState = {
  recoveryJobId?: string;
  rawId: string;
  status: RawStatus;
  updatedAt: string;
  jobId?: string;
  draftId?: string;
  lastError?: { code: string; message: string; at: string; retryable: boolean };
  generatedWikiIds?: string[];
  confirmedOperationId?: string;
};

export type ExtractionJob = {
  mode?: 'standard' | 'deep';
  execution?: 'running' | 'settled';
  recovery?: {
    code: string;
    message: string;
    persisted: false;
    phase: string;
    action: 'reconcile-storage';
    details?: unknown;
  } | null;
  jobId: string;
  rawId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  stage: 'chunking' | 'extracting' | 'merging' | 'validating' | 'planning' | 'assembling' | 'done';
  progress: { chunksTotal: number; chunksDone: number; pagesFound: number };
  draftId: string | null;
  error: { code: string; message: string; retryable?: boolean } | null;
  provider: { name: string; model: string };
  callCount: number;
  startedAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
  reused?: boolean;
  pipelineVersion?: string;
  checkpoint?: {
    stage: 'extracting' | 'planning' | 'assembling' | 'done';
    validatedChunks: number;
    totalChunks: number;
    resumable: boolean;
    reason?: string;
    attempts: number;
    reusedChunks: number;
    deepStage?: string;
  };
};

export type DraftEvidence = {
  id: string;
  rawId: string;
  quote: string;
  start: number;
  end: number;
  chunkIndex: number;
  media?: MediaEvidenceSource;
};

export type PdfDraftEvidence = {
  unitId: string;
  page: number;
  resultSha256: string;
  kind: 'image' | 'text';
  text: string;
  start?: number;
  end?: number;
};

export type DraftFact = { text: string; evidenceIds: string[] };

export type DraftPage = {
  templateFields?: TemplateFields;
  mergedTemplateFields?: MergedTemplateFields[];
  pageId: string;
  title: string;
  type: string;
  category: string;
  one_line_definition: string;
  source_facts: DraftFact[];
  ai_organized: string[];
  ai_inferences: string[];
  related_pages: string[];
  open_questions: string[];
  source_evidence: DraftEvidence[];
  pdfEvidence?: PdfDraftEvidence[];
  knowledge_status: string;
  confidence: string;
  source_level: string;
  selected: boolean;
  provenance: Array<{ chunkIndex: number; start: number; end: number }>;
  reviewDecision?: 'update' | 'create' | 'defer';
  updateTargetWikiId?: string;
  mergedFrom?: string[];
  notes?: string[];
  editedFields?: string[];
  renderedBody?: string;
};

export type DuplicateResult = {
  draftId: string;
  pageId: string;
  draftRevision: number;
  decision: 'update' | 'create' | 'defer' | null;
  targetWikiId: string | null;
  semanticStatus?: 'checked' | 'unavailable';
  candidates: Array<{
    wiki: Wiki;
    score: number;
    matches: Array<{ dimension: string; score: number; reason: string }>;
  }>;
};

export type KnowledgeWorkflow = {
  inputTemplateFields?: InputTemplateFields;
  source_level?: string;
  humanReview?: HumanReview;
  reviewContentDigest?: string | null;
  humanEditedSections?: string[];
  id: string;
  kind: 'update' | 'synthesis';
  status: 'pending_confirmation' | 'confirmed' | 'discarded' | 'conflict';
  revision: number;
  title: string;
  category: string;
  provider: { name: string; model: string };
  rawSnapshots: Array<{ id: string; title: string; bodySha256: string }>;
  targetWikiId?: string;
  baseRevision?: number;
  lastCommitError?: string;
  commitOperationId?: string;
  sections: {
    existing?: string;
    newSource?: string;
    suggestedAdditions: string[];
    conflicts: string[];
    inferences: string[];
    openQuestions: string[];
    agreement: string[];
    sourceList: Array<{ id: string; title: string; source_level?: string; existingSourceId?: string }>;
  };
  evidence?: Array<{ section: string; text: string; rawId: string; quote: string; start: number; end: number }>;
  sources: string[];
};

export type KnowledgeWorkflowSummary = {
  id: string;
  kind: 'update' | 'synthesis';
  status: KnowledgeWorkflow['status'];
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  targetWikiId: string | null;
  lastCommitError: string | null;
  commitOperationId: string | null;
};

export type DraftSource = {
  title: string;
  category: string;
  summary: string;
  key_takeaways: string[];
  body: string;
  knowledge_status: string;
  confidence: string;
  source_level: string;
  reuseWikiId?: string;
  editedByUser?: boolean;
};

export type DraftPreview = {
  rawExists: boolean;
  rawSha256Matches: boolean;
  sourceReuse: { id: string; title: string } | null;
  sourceAmbiguous: Array<{ id: string; title: string }> | null;
  titleConflicts: Array<{ title: string; existingId: string; existingTitle: string; kind: 'strong' | 'alias' }>;
  batchDuplicateTitles: string[];
};

export type RawDraftView = {
  input?: undefined;
  modelProvenance?: DraftModelProvenance;
  pdfInput?: PdfCleanupRange & { pageCount: number; assetId: string; assetSha256: string; basisDigest: string };
  outcomeDigest?: string;
  sourceRenderedBody?: string;
  maintenance?: KnowledgeMaintenance;
  changeDigests?: Record<string, string>;
  noteApproval?: NoteApproval;
  structuredNote?: StructuredNote;
  noteReview?: NoteReviewMetadata;
  qualityReport?: DeepQualityReport;
  noteQualityStatus?: 'historical' | 'generated';
  noteWarnings?: string[];
  humanReview?: HumanReview;
  humanQuestionUnitIds?: string[];
  reviewContentDigest?: string | null;
  id: string;
  rawId: string;
  rawSha256?: string;
  rawTitle: string;
  status: 'pending_confirmation' | 'committing' | 'confirmed' | 'discarded';
  revision: number;
  createdAt: string;
  updatedAt: string;
  rulesVersion: string;
  provider: { name: string; model: string };
  jobId: string;
  document: { title: string; main_topic: string; summary: string };
  pages: DraftPage[];
  source: DraftSource;
  warnings: string[];
  extraction: { callCount: number; chunkCount: number; pagesFound: number };
  commitOperationId?: string;
  confirmedAt?: string;
  discardedAt?: string;
  deferredAt?: string;
  deferAvailable?: boolean;
  pendingCommitOperationId?: string;
  preview: DraftPreview | null;
  raw: {
    id: string;
    title: string;
    sourceType: SourceType;
    sourceName: string;
    author: string | null;
    publishedAt: string | null;
    url: string | null;
    importedAt: string;
    bodySha256: string;
  } | null;
};

export type QuestionDraftView = Omit<
  RawDraftView,
  | 'rawId'
  | 'rawSha256'
  | 'rawTitle'
  | 'jobId'
  | 'source'
  | 'input'
  | 'deferredAt'
  | 'deferAvailable'
  | 'pendingCommitOperationId'
> & { input: QuestionDraftInput; questionBasisChanged?: boolean };

export type InspectionDraftView = Omit<QuestionDraftView, 'input'> & { input: InspectionDraftInput };
export type DraftView = RawDraftView | QuestionDraftView | InspectionDraftView;

export type KnowledgeInspection = {
  sourceComparisonCount?: number;
  id: string;
  revision: number;
  includeRelated: boolean;
  status: 'queued' | 'checking' | 'completed' | 'partial' | 'failed';
  stage: string;
  attempts: number;
  scope: {
    selected: string[];
    candidates: string[];
    read: Array<{ id: string; title: string; revision: number }>;
    skipped: Array<{ id: string; reason: string }>;
    gaps: string[];
  };
  findings: InspectionFinding[];
  lint: Array<{ code: string; objectId: string | null; message: string }>;
  audits: Array<{ id: string; wikiId: string; status: string; comment: string }>;
  drafts: Array<{ key: string; selectedFindingIds: string[]; draftId?: string; status: string; reason?: string }>;
  error?: { code: string; message: string };
};

export type DraftSummary = {
  id: string;
  rawId: string;
  rawTitle: string;
  status: string;
  revision: number;
  title: string;
  pageCount: number;
  selectedCount: number;
  updatedAt: string;
};

export type WikiCommitStatus = {
  operationId: string;
  draftId: string;
  rawId: string;
  status: 'prepared' | 'committing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  phases: Array<{ name: string; status: 'pending' | 'done' | 'failed'; error?: string }>;
  writtenWikiIds: string[];
  sourceId: string | null;
  wikiIds: string[];
  selectedPageIds: string[];
  noChanges?: boolean;
  changeResults?: Record<string, string>;
  confirmation?: { baseRevision: number; outcomeDigest: string; idempotencyKey: string };
  error: { code: string; message: string; phase?: string } | null;
  recoveryHint: string | null;
  warnings: string[];
};

export type DraftEvidencePatch = { id: string; rawId?: string; quote: string; start?: number; end?: number };

export type DraftPatch = {
  baseRevision: number;
  document?: Partial<DraftView['document']>;
  source?: Partial<DraftSource>;
  pages?: Array<
    Partial<Omit<DraftPage, 'pageId' | 'renderedBody' | 'source_evidence'>> & {
      pageId: string;
      source_evidence?: DraftEvidencePatch[];
    }
  >;
  deletePageIds?: string[];
  merge?: { pageIds: string[]; title?: string };
};

const inspectionPath = (id: string) => '/api/knowledge/inspections/' + encodeURIComponent(id);

export const startInspection = (input: {
  requestId: string;
  wikiIds: string[];
  includeRelated: boolean;
  retry?: boolean;
}) => api<KnowledgeInspection>('/api/knowledge/inspections', { method: 'POST', body: JSON.stringify(input) });

export const currentInspection = () => api<KnowledgeInspection | null>('/api/knowledge/inspections/current');

export const getInspection = (id: string, signal?: AbortSignal) =>
  api<KnowledgeInspection>(inspectionPath(id), { signal });

export const inspectionEvidence = (id: string, findingId: string, evidenceId: string) =>
  api<AnswerCitation>(
    inspectionPath(id) + '/findings/' + encodeURIComponent(findingId) + '/evidence/' + encodeURIComponent(evidenceId),
  );

export const decideInspection = (
  id: string,
  findingId: string,
  input: { baseRevision: number; status: 'viewed' | 'deferred'; reason: string },
) =>
  api<KnowledgeInspection>(inspectionPath(id) + '/findings/' + encodeURIComponent(findingId) + '/decision', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const draftInspection = (
  id: string,
  input: { baseRevision: number; selectedFindingIds: string[]; key: string },
) =>
  api<{ status: string; draftId?: string; reason?: string; inspection: KnowledgeInspection }>(
    inspectionPath(id) + '/draft',
    { method: 'POST', body: JSON.stringify(input) },
  );

export const askKnowledge = (input: { requestId: string; question: string; retry?: boolean }) =>
  api<KnowledgeAnswer>('/api/knowledge/answers', { method: 'POST', body: JSON.stringify(input) });

export const knowledgeAnswer = (id: string) => api<KnowledgeAnswer>('/api/knowledge/answers/' + encodeURIComponent(id));

export const currentKnowledgeAnswer = () => api<KnowledgeAnswer | null>('/api/knowledge/answers/current');

export const answerCitation = (id: string, citationId: string) =>
  api<import('./wiki').DisplayAnswerCitation>(
    '/api/knowledge/answers/' + encodeURIComponent(id) + '/citations/' + encodeURIComponent(citationId),
  );

export const saveKnowledgeAnswer = (
  id: string,
  input: { key: string; resultRevision: number; preview: QuestionPreview },
) =>
  api<{ status: string; draftId?: string; reason?: string; answer: KnowledgeAnswer }>(
    '/api/knowledge/answers/' + encodeURIComponent(id) + '/save',
    { method: 'POST', body: JSON.stringify(input) },
  );

export const llmConfig = () => api<LlmConfigSummary>('/api/llm/config');

const configRequest = <T>(url: string, config: LlmConfigSummary, method: string, body: unknown) =>
  api<T>(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'X-FMCG-Config-Token': config.writeToken },
  });

export const saveLlmConfig = (config: LlmConfigSummary, input: { baseUrl: string; model: string; apiKey?: string }) =>
  configRequest<LlmConfigSummary>('/api/llm/config', config, 'PUT', { revision: config.revision, ...input });

export const clearLlmConfig = (config: LlmConfigSummary) =>
  configRequest<LlmConfigSummary>('/api/llm/config', config, 'DELETE', { revision: config.revision, confirm: true });

export const testLlmConfig = (config: LlmConfigSummary, target?: { endpoint: ChatEndpoint; tier: ChatTier }) =>
  configRequest<{ ok: boolean; message: string; elapsedMs: number }>('/api/llm/config/test', config, 'POST', {
    revision: config.revision,
    confirm: true,
    ...target,
  });

export const rawProcessing = () =>
  api<{ items: RawProcessingState[] }>('/api/raw-processing').then((value) => value.items);

export const extractionJob = (jobId: string) => api<ExtractionJob>(`/api/extraction-jobs/${encodeURIComponent(jobId)}`);

export const startExtract = (
  rawId: string,
  options: { restart?: boolean; planningRetry?: boolean; mode?: 'standard' | 'deep' } = {},
) =>
  api<ExtractionJob>(`/api/raw/${encodeURIComponent(rawId)}/extract`, {
    method: 'POST',
    body: JSON.stringify(options),
  });

export const cancelExtract = (jobId: string) =>
  api<ExtractionJob & { cancelled: boolean }>(`/api/extraction-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const reconcileExtractionStorage = (jobId: string) =>
  api<ExtractionJob>(`/api/extraction-jobs/${encodeURIComponent(jobId)}/reconcile-storage`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const drafts = (query: { rawId?: string; status?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.rawId) params.set('rawId', query.rawId);
  if (query.status) params.set('status', query.status);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return api<{ items: DraftSummary[] }>(`/api/drafts${suffix}`).then((value) => value.items);
};

export const draftView = (draftId: string) => api<DraftView>(`/api/drafts/${encodeURIComponent(draftId)}`);

export const prepareDraftChange = (
  draftId: string,
  input: {
    baseRevision: number;
    changeId: string;
    action: KnowledgeChange['action'];
    targetWikiId?: string;
    preparationId: string;
  },
) =>
  api<RawDraftView>(`/api/drafts/${encodeURIComponent(draftId)}/changes/prepare`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const cancelDraftPreparation = (draftId: string, preparationId: string) =>
  api<{ cancelled: boolean }>(
    `/api/drafts/${encodeURIComponent(draftId)}/changes/prepare/${encodeURIComponent(preparationId)}/cancel`,
    { method: 'POST' },
  );

export const finishDraftReview = (draftId: string, baseRevision: number) =>
  api<RawDraftView>(`/api/drafts/${encodeURIComponent(draftId)}/finish`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision }),
  });

export const setDraftDeferred = (draftId: string, baseRevision: number, deferred: boolean) =>
  api<RawDraftView>(`/api/drafts/${encodeURIComponent(draftId)}/defer`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, deferred }),
  });

export const patchDraft = (draftId: string, patch: DraftPatch) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const discardDraft = (draftId: string, baseRevision?: number) =>
  api<{ id: string; status: string; rawId: string }>(`/api/drafts/${encodeURIComponent(draftId)}/discard`, {
    method: 'POST',
    body: JSON.stringify(baseRevision === undefined ? {} : { baseRevision }),
  });

export const confirmDraft = (
  draftId: string,
  input: { baseRevision: number; selectedPageIds: string[]; idempotencyKey: string; outcomeDigest?: string },
) =>
  api<{
    operationId: string;
    status: string;
    reused: boolean;
    sourceReused: boolean;
    sourceId: string | null;
    wikiIds: string[];
    writtenWikiIds: string[];
    warnings: string[];
    phases: WikiCommitStatus['phases'];
  }>(`/api/drafts/${encodeURIComponent(draftId)}/confirm`, { method: 'POST', body: JSON.stringify(input) });

export const wikiCommit = (operationId: string) =>
  api<WikiCommitStatus>(`/api/wiki-commits/${encodeURIComponent(operationId)}`);

export const startDraftReview = (id: string, baseRevision: number) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/start`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision }),
  });

export const moveDraftUnits = (id: string, baseRevision: number, unitIds: string[], pageId: string | null) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/move`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, unitIds, pageId }),
  });

export const markDraftQuestions = (id: string, baseRevision: number, unitIds: string[], marked: boolean) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/questions`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, unitIds, marked }),
  });

export const reviewDraftPage = (
  id: string,
  pageId: string,
  baseRevision: number,
  reviewContentDigest: string,
  confirmed: boolean,
) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/pages/${encodeURIComponent(pageId)}`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, reviewContentDigest, confirmed }),
  });

export const duplicateCandidates = (
  draftId: string,
  pageId: string,
  edited?: { title: string; category: string; content: string },
  semanticRevision?: number,
) => {
  const path = `/api/knowledge/drafts/${encodeURIComponent(draftId)}/pages/${encodeURIComponent(pageId)}/duplicates`;
  if (semanticRevision !== undefined)
    return api<DuplicateResult>(path, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: semanticRevision, allowEmbedding: true }),
    });
  const query = new URLSearchParams();
  if (edited) {
    query.set('title', edited.title);
    query.set('category', edited.category);
    query.set('content', edited.content);
  }
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : '';
  return api<DuplicateResult>(`${path}${suffix}`);
};

export const savePageDecision = (
  draftId: string,
  pageId: string,
  input: { baseRevision: number; decision: 'update' | 'create' | 'defer'; targetWikiId?: string },
) =>
  api<{ draftId: string; revision: number; page: DraftPage }>(
    `/api/knowledge/drafts/${encodeURIComponent(draftId)}/pages/${encodeURIComponent(pageId)}/decision`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );

export const startUpdateWorkflow = (input: {
  draftId: string;
  pageId: string;
  targetWikiId: string;
  baseRevision: number;
}) => api<KnowledgeWorkflow>('/api/knowledge/updates', { method: 'POST', body: JSON.stringify(input) });

export const startSynthesisWorkflow = (input: { rawIds: string[]; sourceIds?: string[] }) =>
  api<KnowledgeWorkflow>('/api/knowledge/syntheses', { method: 'POST', body: JSON.stringify(input) });

export const knowledgeWorkflow = (id: string) =>
  api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}`);

export const knowledgeWorkflows = () =>
  api<{ items: KnowledgeWorkflowSummary[] }>('/api/knowledge/workflows').then((value) => value.items);

export const patchKnowledgeWorkflow = (
  id: string,
  input: { baseRevision: number; sections: KnowledgeWorkflow['sections']; title?: string; source_level?: string },
) =>
  api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const discardKnowledgeWorkflow = (id: string, baseRevision: number) =>
  api(`/api/knowledge/workflows/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ baseRevision }),
  });

export const confirmKnowledgeWorkflow = (id: string, input: { baseRevision: number; idempotencyKey: string }) =>
  api<{ workflow: KnowledgeWorkflow; wikiId: string; reused: boolean; operationId: string }>(
    `/api/knowledge/workflows/${encodeURIComponent(id)}/confirm`,
    { method: 'POST', body: JSON.stringify(input) },
  );

export const startWorkflowReview = (id: string, baseRevision: number) =>
  api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}/review/start`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision }),
  });

export const moveWorkflowUnits = (id: string, baseRevision: number, unitIds: string[], pageId: string | null) =>
  api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}/review/move`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, unitIds, pageId }),
  });

export const reviewWorkflowPage = (id: string, baseRevision: number, reviewContentDigest: string, confirmed: boolean) =>
  api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}/review/pages/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, reviewContentDigest, confirmed }),
  });

export const rawStatusLabels: Record<RawStatus, string> = {
  unprocessed: '未处理',
  processing: 'AI 处理中',
  pending_confirmation: '待人工确认',
  generated: '已生成知识',
  failed: '处理失败',
};

export const jobStageLabels: Record<ExtractionJob['stage'], string> = {
  chunking: '准备分块',
  extracting: '提取精简事实',
  merging: '汇总分块结果',
  validating: '校验与证据定位',
  planning: '规划整篇主题',
  assembling: '按模板组装草稿',
  done: '完成',
};

export const editStructuredNote = (
  id: string,
  baseRevision: number,
  structuredNote: StructuredNote,
  exclusions: NoteExclusion[],
  questionIds: string[],
  humanQuestions: string[],
) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/structured-note`, {
    method: 'PATCH',
    body: JSON.stringify({ baseRevision, structuredNote, exclusions, questionIds, humanQuestions }),
  });

export const reviewStructuredNote = (
  id: string,
  baseRevision: number,
  reviewContentDigest: string,
  warningsAcknowledged: boolean,
  historicalReportAcknowledged: boolean,
) =>
  api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/structured-note`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, reviewContentDigest, warningsAcknowledged, historicalReportAcknowledged }),
  });
