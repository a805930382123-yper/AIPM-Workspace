import type {StructuredNote,NoteReviewMetadata,NoteExclusion,NoteApproval} from '../services/wiki/structured-note';
import type {DeepQualityReport} from '../services/llm/knowledge-deep';
import type { HumanReview } from '../services/wiki/human-review.ts';
import type { TemplateFields, InputTemplateFields, MergedTemplateFields } from '../services/wiki/template-fields';
export type SourceType = 'wechat' | 'article' | 'report' | 'company' | 'customer' | 'meeting' | 'note' | 'other';
export type Raw = {
  id: string; title: string; sourceType: SourceType; sourceName: string; author?: string; publishedAt?: string; url?: string;
  tags: string[]; body: string; importedAt: string; status: 'unprocessed'; bodySha256: string;
  /** B03: retained original file linkage. Absent for pasted text. */
  assetId?: string; assetFileName?: string; assetFormat?: string; assetByteSize?: number; assetSha256?: string;
  extractionParser?: string; extractionNote?: string;
  isDemo?: boolean;
  origin?: MeetingRawOrigin;
};
export type MeetingRawOrigin = { kind: 'meeting'; meeting_id: string; import_id: string; original_sha256: string; registered_confidentiality: MeetingConfidentiality; processing_policy: 'meeting_local_only' };
export type RawSummary = Omit<Raw, 'body' | 'bodySha256'>;
export type RawAssetStatus = 'stored' | 'parsed' | 'parse_failed' | 'detached';
export type RawAssetRecord = {
  id: string; fileName: string; format: string; declaredExtension: string; byteSize: number; sha256: string;
  storedFile: string; createdAt: string; status: RawAssetStatus; rawId?: string; parser?: string;
  extractionNote?: string; failure?: { code: string; message: string; at: string }; detachedAt?: string;
};
export type RawImportResult = {
  raw: Raw; asset: RawAssetRecord;
  extraction: { parser: string; note: string; bodyChars: number };
  warnings?: string[];
};
export type RawReference = { id: string; title: string; type?: WikiType };
export type Stats = { rawCount: number; wikiCount: number; thisWeekNewCount: number; pendingConfirmationCount: number; openAuditCount: number; promptCount: number; weekStartsOn: string; recentChanges?: Array<{time:string;action:string;id:string;title:string;type:string;revision:number;isDemo?:boolean}> };
export type MeetingConfidentiality = 'Public' | 'Internal' | 'Sensitive' | 'Restricted';
export type MeetingCatalogEntry = { id: string; name: string; active: boolean };
export type MeetingCatalog = { schema_version: 1; revision: number; types: MeetingCatalogEntry[]; tags: MeetingCatalogEntry[] };
export type MeetingCapabilities = { canImportMinutes: boolean; canRegisterRaw: boolean; canUseAi: false; importReason: string; rawReason: string; aiReason: string };
export type MeetingMinuteVersion = { import_id:string; imported_at:string; imported_minutes:string; editable_minutes:string; original_filename:string|null; original_sha256:string; file_sha256?:string };
export type MeetingRawLinkError = { code: string; at: string };
export type MeetingRawLink = { request_id: string; import_id: string; raw_id: string; original_sha256: string; created_at: string; status: 'pending' | 'linked' | 'failed' | 'unlinked' | 'raw_deleted'; request_fingerprint: string; raw_title: string; source_name: string; tags: string[]; registered_at?: string; error?: MeetingRawLinkError };
export type MeetingSummary = { schema_version: 1; meeting_id: string; revision: number; created_at: string; updated_at: string; title: string; meeting_date: string; meeting_time: string | null; meeting_type: string; tags: string[]; customer: string | null; project: string | null; description: string | null; recording_url: string | null; minutes_url: string | null; confidentiality: MeetingConfidentiality; storage_mode: 'cloud_index' | 'local_archive'; local_storage_authorized: boolean; external_ai_authorized: false; raw_transfer_authorized: boolean; policy_updated_at: string };
export type Meeting = MeetingSummary & { imports: MeetingMinuteVersion[]; active_import_id: string|null; raw_links: MeetingRawLink[]; raw_source_id: string | null; capabilities: MeetingCapabilities; reused?: boolean };
export type WikiType = 'source' | 'concept' | 'entity' | 'business_process' | 'metric' | 'synthesis';
export type Wiki = { id: string; title: string; type: WikiType; domain: 'fmcg'; category: string; created: string; updated: string; sources: string[]; tags: string[]; knowledge_status: string; confidence: string; source_level: string; review_status: string; aliases: string[]; revision: number; body: string; isDemo?: boolean; links?: Array<{target: string; status: 'resolved' | 'missing' | 'ambiguous'; candidates: Array<{id: string; title: string}>}> };
export type WikiInput = Pick<Wiki, 'title' | 'type' | 'category' | 'sources' | 'tags' | 'knowledge_status' | 'confidence' | 'source_level' | 'review_status' | 'aliases' | 'body'>;
export type Audit = { id:string; wikiId:string; scope:'page'|'paragraph'; severity:'error'|'warning'|'suggestion'|'supplement'; comment:string; anchor:{before:string;text:string;after:string}; pageBodySha256:string; createdRevision:number; revision:number; createdAt:string; status:'open'|'resolved'; location:{status:'located'|'uncertain'|'found'|'ambiguous'|'stale'|'missing';start:number;end:number;method:string;reason?:string}; pendingDraftId?:string; decisionHistory:Array<{decision:string;reason?:string;at:string}> };
export type AuditDraft = {id:string;auditId:string;revision:number;status:'pending'|'discarded'|'applied';baseWikiRevision:number;baseAuditRevision:number;replacement:string;rationale:string;evidence:Array<{rawId:string;quote:string}>;provider:{name:string;model:string}};
export type AuditConflict = {operationId:string;status:'conflict';decision:string;createdAt:string;conflictReason:string;expectedWikiRevision:number;observedWikiRevision:number|null;changedRawIds:string[]};
export type WikiLintResult = {generatedAt:string;findings:Array<{code:string;objectId:string|null;file:string;message:string;location:{line:number;text?:string}}>;summary:Record<string,number>};
export type WikiSchema = {
  domain: string;
  types: Array<{id: WikiType; label: string; description: string}>;
  categories: Array<{id: string; label: string}>;
  enums: Record<string, string[]>;
  pageTemplates: Record<WikiType, {sections: Array<{key: string; label: string; hint?: string}>}>;
  sourcePolicy: {levels: Array<{id: string; label: string; description: string}>; guidance: string};
};

/** Error carrying the server's machine-readable code and optional details. */
export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}
async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  if (text) { try { data = JSON.parse(text); } catch { data = undefined; } }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    const details=error?.details as {category?:unknown}|undefined;
    if(details?.category==='recovery'||['STORAGE_CORRUPT','STORAGE_READ_FAILED','RECOVERY_SECRET_BLOCKED'].includes(error?.code??''))if(typeof window!=='undefined')window.dispatchEvent(new Event('storage-recovery-discovered'));
    throw new ApiError(error?.message || '请求失败，请稍后重试。', error?.code || 'REQUEST_FAILED', response.status, error?.details);
  }
  if(data&&typeof data==='object'&&(data as {needsRecovery?:unknown}).needsRecovery===true)if(typeof window!=='undefined')window.dispatchEvent(new Event('storage-recovery-discovered'));
  return data as T;
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return readResponse<T>(await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }));
}
/** Multipart upload: the browser sets its own Content-Type with the boundary. */
export async function apiForm<T>(url: string, form: FormData): Promise<T> {
  return readResponse<T>(await fetch(url, { method: 'POST', body: form }));
}
export async function rawReferences(id: string): Promise<RawReference[]> {
  return (await api<{ items: RawReference[] }>(`/api/raw/${encodeURIComponent(id)}/references`)).items;
}
export async function deleteRaw(id: string): Promise<{ id: string; title: string; assetId: string | null; assetRetained: boolean; warnings: string[] }> {
  return api(`/api/raw/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) });
}
export const dateText = (value?: string) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '未填写';
export const bytesText = (value?: number) => typeof value === 'number'
  ? (value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(2)} MiB`) : '未记录';
export const sourceLabels: Record<SourceType, string> = { wechat: '微信公众号', article: '网页文章', report: '行业报告', company: '公司资料', customer: '客户资料', meeting: '会议纪要', note: '个人笔记', other: '其他' };
export const formatLabels: Record<string, string> = { markdown: 'Markdown', txt: 'TXT 文本', docx: 'DOCX 文档', pdf: 'PDF 文档', unknown: '未识别格式' };

// --- B04：AI 提取 → 人工审核 → 确认写入 -------------------------------------------------------

export type LlmConfigSummary = {
  provider: string; baseUrlHost: string | null; baseUrl: string; model: string | null; keyConfigured: boolean;
  keyMask: string; configured: boolean; source: 'env' | 'local-file' | 'none'; missing: string[];
  configFile: string; envNames: Record<string, string>; revision: string; writeToken: string; environmentLocked: boolean;
};
export type RawStatus = 'unprocessed' | 'processing' | 'pending_confirmation' | 'generated' | 'failed';
export type RawProcessingState = {
  recoveryJobId?: string;
  rawId: string; status: RawStatus; updatedAt: string; jobId?: string; draftId?: string;
  lastError?: { code: string; message: string; at: string; retryable: boolean };
  generatedWikiIds?: string[]; confirmedOperationId?: string;
};
export type ExtractionJob = {
  mode?: 'standard'|'deep';
  execution?: 'running' | 'settled';
  recovery?: { code: string; message: string; persisted: false; phase: string; action: 'reconcile-storage'; details?: unknown } | null;
  jobId: string; rawId: string; status: 'running' | 'completed' | 'failed' | 'cancelled';
  stage: 'chunking' | 'extracting' | 'merging' | 'validating' | 'planning' | 'assembling' | 'done';
  progress: { chunksTotal: number; chunksDone: number; pagesFound: number };
  draftId: string | null; error: { code: string; message: string; retryable?: boolean } | null;
  provider: { name: string; model: string }; callCount: number; startedAt: string; finishedAt: string | null;
  cancelRequested: boolean; reused?: boolean; pipelineVersion?: string; checkpoint?: { stage: 'extracting' | 'planning' | 'assembling' | 'done'; validatedChunks: number; totalChunks: number; resumable: boolean; reason?: string; attempts: number; reusedChunks: number; deepStage?:string };
};
export type DraftEvidence = { id: string; rawId: string; quote: string; start: number; end: number; chunkIndex: number };
export type DraftFact = { text: string; evidenceIds: string[] };
export type DraftPage = {
  templateFields?: TemplateFields;
  mergedTemplateFields?: MergedTemplateFields[];
  pageId: string; title: string; type: string; category: string; one_line_definition: string;
  source_facts: DraftFact[]; ai_organized: string[]; ai_inferences: string[]; related_pages: string[]; open_questions: string[];
  source_evidence: DraftEvidence[];
  knowledge_status: string; confidence: string; source_level: string;
  selected: boolean; provenance: Array<{ chunkIndex: number; start: number; end: number }>;
  reviewDecision?: 'update' | 'create' | 'defer'; updateTargetWikiId?: string;
  mergedFrom?: string[]; notes?: string[]; editedFields?: string[];
  renderedBody?: string;
};

export type DuplicateResult = { draftId: string; pageId: string; draftRevision: number; decision: 'update' | 'create' | 'defer' | null; targetWikiId: string | null; candidates: Array<{ wiki: Wiki; score: number; matches: Array<{ dimension: string; score: number; reason: string }> }> };
export type KnowledgeWorkflow = { inputTemplateFields?:InputTemplateFields; source_level?: string; humanReview?:HumanReview; reviewContentDigest?:string|null; humanEditedSections?:string[]; id: string; kind: 'update' | 'synthesis'; status: 'pending_confirmation' | 'confirmed' | 'discarded' | 'conflict'; revision: number; title: string; category: string; provider: { name: string; model: string }; rawSnapshots: Array<{ id: string; title: string; bodySha256: string }>; targetWikiId?: string; baseRevision?: number; lastCommitError?: string; commitOperationId?: string; sections: { existing?: string; newSource?: string; suggestedAdditions: string[]; conflicts: string[]; inferences: string[]; openQuestions: string[]; agreement: string[]; sourceList: Array<{id:string;title:string;source_level?:string;existingSourceId?:string}> }; evidence?: Array<{section:string;text:string;rawId:string;quote:string;start:number;end:number}>; sources: string[] };
export type KnowledgeWorkflowSummary = { id:string;kind:'update'|'synthesis';status:KnowledgeWorkflow['status'];title:string;revision:number;createdAt:string;updatedAt:string;targetWikiId:string|null;lastCommitError:string|null;commitOperationId:string|null };
export type DraftSource = {
  title: string; category: string; summary: string; key_takeaways: string[];
  body: string; knowledge_status: string; confidence: string; source_level: string;
  reuseWikiId?: string; editedByUser?: boolean;
};
export type DraftPreview = {
  rawExists: boolean; rawSha256Matches: boolean;
  sourceReuse: { id: string; title: string } | null;
  sourceAmbiguous: Array<{ id: string; title: string }> | null;
  titleConflicts: Array<{ title: string; existingId: string; existingTitle: string; kind: 'strong' | 'alias' }>;
  batchDuplicateTitles: string[];
};
export type DraftView = {
  noteApproval?:NoteApproval;
  structuredNote?:StructuredNote;noteReview?:NoteReviewMetadata;qualityReport?:DeepQualityReport;noteQualityStatus?:'historical'|'generated';noteWarnings?:string[];
  humanReview?:HumanReview; humanQuestionUnitIds?:string[]; reviewContentDigest?:string|null;
  id: string; rawId: string; rawTitle: string; status: 'pending_confirmation' | 'committing' | 'confirmed' | 'discarded';
  revision: number; createdAt: string; updatedAt: string; rulesVersion: string;
  provider: { name: string; model: string }; jobId: string;
  document: { title: string; main_topic: string; summary: string };
  pages: DraftPage[]; source: DraftSource; warnings: string[];
  extraction: { callCount: number; chunkCount: number; pagesFound: number };
  commitOperationId?: string; confirmedAt?: string; discardedAt?: string;
  preview: DraftPreview | null;
  raw: { id: string; title: string; sourceType: SourceType; sourceName: string; author: string | null; publishedAt: string | null; url: string | null; importedAt: string; bodySha256: string } | null;
};
export type DraftSummary = { id: string; rawId: string; rawTitle: string; status: string; revision: number; title: string; pageCount: number; selectedCount: number; updatedAt: string };
export type WikiCommitStatus = {
  operationId: string; draftId: string; rawId: string; status: 'prepared' | 'committing' | 'completed' | 'failed';
  createdAt: string; updatedAt: string; completedAt: string | null;
  phases: Array<{ name: string; status: 'pending' | 'done' | 'failed'; error?: string }>;
  writtenWikiIds: string[]; sourceId: string | null; wikiIds: string[]; selectedPageIds: string[];
  error: { code: string; message: string; phase?: string } | null; recoveryHint: string | null; warnings: string[];
};
export type DraftEvidencePatch = { id: string; rawId?: string; quote: string; start?: number; end?: number };
export type DraftPatch = {
  baseRevision: number;
  document?: Partial<DraftView['document']>;
  source?: Partial<DraftSource>;
  pages?: Array<Partial<Omit<DraftPage, 'pageId' | 'renderedBody' | 'source_evidence'>> & { pageId: string; source_evidence?: DraftEvidencePatch[] }>;
  deletePageIds?: string[];
  merge?: { pageIds: string[]; title?: string };
};

export const llmConfig = () => api<LlmConfigSummary>('/api/llm/config');
const configRequest = <T,>(url: string, config: LlmConfigSummary, method: string, body: unknown) => api<T>(url, {
  method, body: JSON.stringify(body), headers: { 'X-FMCG-Config-Token': config.writeToken },
});
export const saveLlmConfig = (config: LlmConfigSummary, input: { baseUrl: string; model: string; apiKey?: string }) =>
  configRequest<LlmConfigSummary>('/api/llm/config', config, 'PUT', { revision: config.revision, ...input });
export const clearLlmConfig = (config: LlmConfigSummary) => configRequest<LlmConfigSummary>('/api/llm/config', config, 'DELETE', { revision: config.revision, confirm: true });
export const testLlmConfig = (config: LlmConfigSummary) => configRequest<{ ok: boolean; message: string; elapsedMs: number }>('/api/llm/config/test', config, 'POST', { revision: config.revision, confirm: true });
export const rawProcessing = () => api<{ items: RawProcessingState[] }>('/api/raw-processing').then(value => value.items);
export const extractionJob = (jobId: string) => api<ExtractionJob>(`/api/extraction-jobs/${encodeURIComponent(jobId)}`);
export const startExtract = (rawId: string, options: { restart?: boolean; planningRetry?: boolean;mode?:'standard'|'deep' } = {}) => api<ExtractionJob>(`/api/raw/${encodeURIComponent(rawId)}/extract`, { method: 'POST', body: JSON.stringify(options) });
export const cancelExtract = (jobId: string) => api<ExtractionJob & { cancelled: boolean }>(`/api/extraction-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
export const reconcileExtractionStorage = (jobId: string) => api<ExtractionJob>(`/api/extraction-jobs/${encodeURIComponent(jobId)}/reconcile-storage`, { method: 'POST', body: JSON.stringify({}) });
export const drafts = (query: { rawId?: string; status?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.rawId) params.set('rawId', query.rawId);
  if (query.status) params.set('status', query.status);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return api<{ items: DraftSummary[] }>(`/api/drafts${suffix}`).then(value => value.items);
};
export const draftView = (draftId: string) => api<DraftView>(`/api/drafts/${encodeURIComponent(draftId)}`);
export const patchDraft = (draftId: string, patch: DraftPatch) => api<DraftView>(`/api/drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const discardDraft = (draftId: string, baseRevision?: number) => api<{ id: string; status: string; rawId: string }>(`/api/drafts/${encodeURIComponent(draftId)}/discard`, { method: 'POST', body: JSON.stringify(baseRevision === undefined ? {} : { baseRevision }) });
export const confirmDraft = (draftId: string, input: { baseRevision: number; selectedPageIds: string[]; idempotencyKey: string }) =>
  api<{ operationId: string; status: string; reused: boolean; sourceReused: boolean; sourceId: string | null; wikiIds: string[]; writtenWikiIds: string[]; warnings: string[]; phases: WikiCommitStatus['phases'] }>(`/api/drafts/${encodeURIComponent(draftId)}/confirm`, { method: 'POST', body: JSON.stringify(input) });
export const wikiCommit = (operationId: string) => api<WikiCommitStatus>(`/api/wiki-commits/${encodeURIComponent(operationId)}`);
export const startDraftReview=(id:string,baseRevision:number)=>api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/start`,{method:'POST',body:JSON.stringify({baseRevision})});
export const moveDraftUnits=(id:string,baseRevision:number,unitIds:string[],pageId:string|null)=>api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/move`,{method:'POST',body:JSON.stringify({baseRevision,unitIds,pageId})});
export const markDraftQuestions=(id:string,baseRevision:number,unitIds:string[],marked:boolean)=>api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/questions`,{method:'POST',body:JSON.stringify({baseRevision,unitIds,marked})});
export const reviewDraftPage=(id:string,pageId:string,baseRevision:number,reviewContentDigest:string,confirmed:boolean)=>api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/pages/${encodeURIComponent(pageId)}`,{method:'POST',body:JSON.stringify({baseRevision,reviewContentDigest,confirmed})});
export const duplicateCandidates = (draftId: string, pageId: string, edited?: {title:string;category:string;content:string}) => {
  const query = new URLSearchParams();
  if (edited) { query.set('title', edited.title); query.set('category', edited.category); query.set('content', edited.content); }
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : '';
  return api<DuplicateResult>(`/api/knowledge/drafts/${encodeURIComponent(draftId)}/pages/${encodeURIComponent(pageId)}/duplicates${suffix}`);
};
export const savePageDecision = (draftId: string, pageId: string, input: {baseRevision:number;decision:'update'|'create'|'defer';targetWikiId?:string}) => api<{draftId:string;revision:number;page:DraftPage}>(`/api/knowledge/drafts/${encodeURIComponent(draftId)}/pages/${encodeURIComponent(pageId)}/decision`, {method:'PATCH',body:JSON.stringify(input)});
export const startUpdateWorkflow = (input: {draftId:string;pageId:string;targetWikiId:string;baseRevision:number}) => api<KnowledgeWorkflow>('/api/knowledge/updates',{method:'POST',body:JSON.stringify(input)});
export const startSynthesisWorkflow = (input: {rawIds:string[];sourceIds?:string[]}) => api<KnowledgeWorkflow>('/api/knowledge/syntheses',{method:'POST',body:JSON.stringify(input)});
export const knowledgeWorkflow = (id:string) => api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}`);
export const knowledgeWorkflows = () => api<{items:KnowledgeWorkflowSummary[]}>('/api/knowledge/workflows').then(value => value.items);
export const patchKnowledgeWorkflow = (id:string,input:{baseRevision:number;sections:KnowledgeWorkflow['sections'];title?:string;source_level?:string}) => api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)});
export const discardKnowledgeWorkflow = (id:string,baseRevision:number) => api(`/api/knowledge/workflows/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({baseRevision})});
export const confirmKnowledgeWorkflow = (id:string,input:{baseRevision:number;idempotencyKey:string}) => api<{workflow:KnowledgeWorkflow;wikiId:string;reused:boolean;operationId:string}>(`/api/knowledge/workflows/${encodeURIComponent(id)}/confirm`,{method:'POST',body:JSON.stringify(input)});
export const startWorkflowReview=(id:string,baseRevision:number)=>api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}/review/start`,{method:'POST',body:JSON.stringify({baseRevision})});
export const moveWorkflowUnits=(id:string,baseRevision:number,unitIds:string[],pageId:string|null)=>api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}/review/move`,{method:'POST',body:JSON.stringify({baseRevision,unitIds,pageId})});
export const reviewWorkflowPage=(id:string,baseRevision:number,reviewContentDigest:string,confirmed:boolean)=>api<KnowledgeWorkflow>(`/api/knowledge/workflows/${encodeURIComponent(id)}/review/pages/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({baseRevision,reviewContentDigest,confirmed})});

// --- B07：Prompt Library ---------------------------------------------------------------------

export type PromptSource = 'manual' | 'ai_generated' | 'optimized';
export type Prompt = {
  id: string; name: string; category: string; scenario: string;
  body: string; variables: string[];
  inputRequirements: string; outputRequirements: string;
  relatedWikiIds: string[]; examples: string; tags: string[]; favorite: boolean;
  createdAt: string; updatedAt: string; version: number;
  source: PromptSource;
  isDemo?: boolean;
};
export type PromptVersion = { version: number; savedAt: string; changeSource: 'manual' | 'ai_generated' | 'ai_optimized'; snapshot: Prompt };
export type PromptCategory = { id: string; label: string; help?: string };
export type PromptSchema = { categories: PromptCategory[] };
export type PromptWikiLink = { id: string; title: string | null; status: 'resolved' | 'missing' };
export type PromptInput = Pick<Prompt,
  'name' | 'category' | 'scenario' | 'body' | 'inputRequirements' | 'outputRequirements'
  | 'relatedWikiIds' | 'examples' | 'tags' | 'favorite'>;
export type PromptCreateResult = { prompt: Prompt; reused: boolean };
export type PromptRenderResult = { id: string; version: number; body: string; missingVariables: string[] };

export const promptSourceLabels: Record<PromptSource, string> = {
  manual: '手动创建', ai_generated: 'AI 生成', optimized: 'AI 优化',
};
export const promptChangeSourceLabels: Record<PromptVersion['changeSource'], string> = {
  manual: '人工保存', ai_generated: 'AI 生成', ai_optimized: 'AI 优化保存',
};
/** Same Unicode normalization the server uses for search, kept in one place for the UI hints. */
export const PROMPT_VARIABLE_HINT = '正文中用 {{变量名}} 表示需要每次填写的部分，例如 {{客户名称}}、{{行业术语}}。';

function promptQueryString(query: { q?: string; category?: string; tag?: string; favorite?: boolean }) {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.category) params.set('category', query.category);
  if (query.tag?.trim()) params.set('tag', query.tag.trim());
  if (query.favorite) params.set('favorite', 'true');
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export const promptSchema = () => api<PromptSchema>('/api/prompts/schema');
export const promptList = (query: { q?: string; category?: string; tag?: string; favorite?: boolean } = {}) =>
  api<{ items: Prompt[]; categoryCounts: Record<string, number> }>(`/api/prompts${promptQueryString(query)}`);
export const promptDetail = (id: string) => api<{ prompt: Prompt; wikiLinks: PromptWikiLink[] }>(`/api/prompts/${encodeURIComponent(id)}`);
export const promptVersions = (id: string) => api<{ items: PromptVersion[] }>(`/api/prompts/${encodeURIComponent(id)}/versions`).then(value => value.items);
export const promptVersion = (id: string, version: number) => api<{ version: PromptVersion }>(`/api/prompts/${encodeURIComponent(id)}/versions/${version}`);
/** `requestId` is the stable id of one explicit "new prompt" session; retries reuse it. */
export const createPrompt = (requestId: string, input: PromptInput) =>
  api<PromptCreateResult>('/api/prompts', { method: 'POST', body: JSON.stringify({ requestId, ...input }) });
export const updatePrompt = (id: string, baseVersion: number, input: PromptInput) =>
  api<{ prompt: Prompt }>(`/api/prompts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ...input, baseVersion }) }).then(value => value.prompt);
export const deletePrompt = (id: string, baseVersion: number) =>
  api<{ id: string; deleted: true }>(`/api/prompts/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ baseVersion }) });
export const renderPrompt = (id: string, baseVersion: number, values: Record<string, string>) =>
  api<PromptRenderResult>(`/api/prompts/${encodeURIComponent(id)}/render`, { method: 'POST', body: JSON.stringify({ baseVersion, values }) });
export const promptExportUrl = (id: string) => `/api/prompts/${encodeURIComponent(id)}/export`;

export const rawStatusLabels: Record<RawStatus, string> = {
  unprocessed: '未处理', processing: 'AI 处理中', pending_confirmation: '待人工确认', generated: '已生成知识', failed: '处理失败',
};
export const jobStageLabels: Record<ExtractionJob['stage'], string> = {
  chunking: '准备分块', extracting: '提取精简事实', merging: '汇总分块结果', validating: '校验与证据定位', planning: '规划整篇主题', assembling: '按模板组装草稿', done: '完成',
};



/** totalIssues counts known issues; partial scans only establish a lower bound. */
export type RecoveryScan = { scanned:boolean;partial?:boolean;overflow:boolean;truncated?:boolean;totalIssues?:number;hiddenIssues?:number;scannedFiles?:number;scannedBytes?:number;items:Array<{id:string;kind:string;reason:string}> };

export const editStructuredNote=(id:string,baseRevision:number,structuredNote:StructuredNote,exclusions:NoteExclusion[],questionIds:string[],humanQuestions:string[])=>api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/structured-note`,{method:'PATCH',body:JSON.stringify({baseRevision,structuredNote,exclusions,questionIds,humanQuestions})});
export const reviewStructuredNote=(id:string,baseRevision:number,reviewContentDigest:string,warningsAcknowledged:boolean,historicalReportAcknowledged:boolean)=>api<DraftView>(`/api/drafts/${encodeURIComponent(id)}/review/structured-note`,{method:'POST',body:JSON.stringify({baseRevision,reviewContentDigest,warningsAcknowledged,historicalReportAcknowledged})});
