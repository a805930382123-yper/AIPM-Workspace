// B04: extraction jobs. A job owns one provider run for one Raw; its state is persisted so an
// interrupted run is visible and retryable instead of leaving a permanent "processing" state.
import path from 'node:path';
import {isJob} from '../storage/record-validators.ts';
import { mkdir } from 'node:fs/promises';
import type { LLMService, ExtractProgress } from './service.ts';
import { assertNoKnownSecret, LlmError, sanitizeDeep, sanitizeProviderText, type LlmProvider } from './provider.ts';
import { SerialQueue, StorageError, scanJsonRecords, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { storageFailure } from './storage-recovery.ts';
import { withJobMutation } from '../storage/job-file-access.ts';
import type { DraftRecord, DraftStore } from '../wiki/drafts.ts';
import type { RawStateStore } from '../raw/state.ts';
import type { RawStore } from '../raw/store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { createHash } from 'node:crypto';
import { chunkText } from './chunk.ts';
import { loadExtractionRules } from './rules.ts';
import { knowledgePlanCallMinimum, runKnowledgePipeline, validateKnowledgeCheckpoint } from './knowledge-extraction.ts';
import { ExtractionCheckpointStore, KB02_PIPELINE_VERSION, knowledgeCallLimit, type ExtractionCheckpoint } from './checkpoints.ts';

export const JOB_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export type JobStage = ExtractProgress['stage'] | 'done';
export type ExtractionJob = {
  id: string; rawId: string; status: JobStatus; stage: JobStage;
  chunksTotal: number; chunksDone: number; pagesFound: number;
  provider: { name: string; model: string };
  error?: { code: string; message: string; at: string; retryable: boolean; details?: unknown };
  draftId?: string; cancelRequested: boolean; callCount: number;
  startedAt: string; finishedAt?: string; updatedAt: string;
  /** Persisted before binding the Raw, so an interrupted new-job start is verifiable after restart. */
  startStateHash?: string;
  pipelineVersion?: string; checkpoint?: { stage: 'extracting' | 'planning' | 'assembling' | 'done'; validatedChunks: number; totalChunks: number; resumable: boolean; reason?: string; attempts: number; reusedChunks: number };
};

const NON_RETRYABLE = new Set(['LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED', 'LLM_RAW_TOO_LARGE', 'LLM_TOO_MANY_PAGES', 'LLM_OUTPUT_CONTAINS_SECRET']);

function validStoredJob(value: unknown, id?: string): value is ExtractionJob {
  if (!isJob(value, id)) return false;
  const job = value as ExtractionJob;
  return job.startStateHash === undefined || (typeof job.startStateHash === 'string' && /^[0-9a-f]{64}$/u.test(job.startStateHash));
}

/** F04-10: reports where a secret appeared without ever returning the value itself. */
export function findSecretHits(value: unknown, secrets: readonly string[], at = '$', hits: string[] = []): string[] {
  const usable = secrets.filter(secret => typeof secret === 'string' && secret.length > 0);
  if (!usable.length) return hits;
  if (typeof value === 'string') {
    if (usable.some(secret => value.includes(secret))) hits.push(at);
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSecretHits(item, usable, `${at}[${index}]`, hits));
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (usable.some(secret => key.includes(secret))) hits.push(at);
      findSecretHits(item, usable, `${at}.[redacted-key]`, hits);
    }
  }
  return hits;
}

export class JobError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}

export class ExtractionJobStore {
  constructor(public readonly root: string) {}
  private directory() { return path.join(this.root, 'state', 'extraction-jobs'); }
  private fileFor(id: string) { return path.join(this.directory(), `${id}.json`); }
  async initialize() { await mkdir(this.directory(), { recursive: true }); }
  async get(id: string): Promise<ExtractionJob | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const job=await readJsonRecord<ExtractionJob>(this.root,this.fileFor(id),(v):v is ExtractionJob=>validStoredJob(v,id));if(job===undefined)return undefined;if(!validStoredJob(job,id))throw new StorageError('STORAGE_CORRUPT','提取任务记录结构无效，原文件已保留。',500,{category:'recovery',nextAction:'inspect_or_restore'});return job;
  }
  async list(): Promise<ExtractionJob[]> {
    const records=await scanJsonRecords<ExtractionJob>(this.directory(),(v,file):v is ExtractionJob=>validStoredJob(v,path.basename(file,'.json')),this.root);
    return records.records.map(x=>x.value);
  }  async update(id: string, patch: Partial<ExtractionJob>): Promise<ExtractionJob> {
    return withJobMutation(this.fileFor(id), async () => {
      const current = await this.get(id);
      if (!current) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      const next: ExtractionJob = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async insert(job: ExtractionJob): Promise<ExtractionJob> {
    return withJobMutation(this.fileFor(job.id), async () => {
      await writeJsonAtomic(this.fileFor(job.id), job);
      return job;
    });
  }
}

export type StorageRecovery = { code: string; message: string; persisted: false; phase: string; action: 'reconcile-storage'; details?: unknown };
type PendingSettlement = { rawId: string; checkpoint?: ExtractionCheckpoint; status: 'completed' | 'failed' | 'cancelled'; failure?: ExtractionJob['error']; issue?: StorageRecovery; expected?: { job: string; raw: string; checkpoint?: string; draft?: string }; draftId?: string };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Admission reserves one checkpoint slot for each running task as well as unresolved writes.
// Eight bounded 16MiB checkpoints are at most 128MiB; no pending issue is evicted.
export const EXTRACTION_RECOVERY_CAPACITY = 8;

export class ExtractionRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, PendingSettlement>();

  async readJob(id: string) {
    const job = await this.deps.jobs.get(id);
    const execution = this.tasks.has(id) ? 'running' as const : 'settled' as const;
    const recovery = this.pending.get(id)?.issue ?? (job?.status === 'running' && execution === 'settled' ? { code: 'STORAGE_RECONCILE_REQUIRED', message: '发现已停止的任务；请重试保存状态以核验本机检查点和草稿。', persisted: false as const, phase: 'restart-disk', action: 'reconcile-storage' as const } : undefined);
    return { job, execution, recovery };
  }
  recoveryJobs() { return [...this.pending].filter(([, value]) => value.issue).map(([jobId, value]) => ({ jobId, rawId: value.rawId })); }
  async waitForSettlement(id: string) { await this.tasks.get(id); return this.readJob(id); }

  private conflict(): never { throw new JobError('STORAGE_RECONCILE_CONFLICT', '任务、检查点、原文或草稿已变化，不能安全保存；原文件已保留。', 409); }

  private async snapshot(id: string, pending: PendingSettlement) {
    const cp = await new ExtractionCheckpointStore(this.deps.root).get(id);
    return { job: fingerprint(await this.deps.jobs.get(id)), raw: fingerprint(await this.deps.rawStates.get(pending.rawId)), checkpoint: cp?.integrity, draft: pending.draftId ? fingerprint(await this.deps.drafts.get(pending.draftId)) : undefined };
  }

  private async retain(id: string, pending: PendingSettlement, error: unknown, phase: string) {
    const safe = storageFailure(error);
    if (pending.status === 'failed' && !pending.failure) pending.failure = { code: 'STORAGE_WRITE_FAILED', message: '任务因状态保存失败而停止；本次操作不会重新调用模型。', at: new Date().toISOString(), retryable: true };
    pending.issue = { code: safe?.code ?? 'STORAGE_SETTLEMENT_FAILED', message: safe?.message ?? '任务已停止，状态尚未保存；请检查本机记录后重试保存。', phase, persisted: false, action: 'reconcile-storage', ...(safe ? { details: safe.details } : {}) };
    this.pending.set(id, pending);
    try { pending.expected = await this.snapshot(id, pending); } catch { pending.expected = undefined; }
  }

  /** Verify persisted task identity, not the user's current Provider configuration. */
  private async validateSettlement(job: ExtractionJob, pending: PendingSettlement): Promise<DraftRecord | undefined> {
    const raw = await this.deps.rawStore.get(job.rawId);
    const state = await this.deps.rawStates.get(job.rawId);
    if (!raw || raw.id !== pending.rawId) this.conflict();
    assertRawNotMeeting(raw);
    const cp = pending.checkpoint;
    // kb02-2 always saves its checkpoint before the job. Absence is damage, not a
    // legacy job without a checkpoint, and must not produce a fresh attempt ledger.
    if (job.pipelineVersion === KB02_PIPELINE_VERSION && !cp) this.conflict();
    if (state.jobId !== job.id && job.startStateHash !== undefined) {
      // Only an untouched, zero-call new start can still own its exact prior Raw
      // state. A changed binding/history or an already-executed task fails closed.
      if (job.status !== 'running' || job.callCount !== 0 || !cp || cp.attempts !== 0 || cp.stage !== 'extracting' || cp.completedChunks.length || cp.plan || cp.draftId || pending.draftId || fingerprint(state) !== job.startStateHash) this.conflict();
    } else if (state.jobId && state.jobId !== job.id) this.conflict();
    if (cp && (cp.jobId !== job.id || cp.rawId !== job.rawId || cp.rawSha256 !== createHash('sha256').update(raw.body).digest('hex') || cp.attempts < job.callCount || cp.attempts > knowledgeCallLimit(cp.chunks.length) || cp.attempts < knowledgePlanCallMinimum(cp) || (job.pipelineVersion && cp.pipelineVersion !== job.pipelineVersion))) this.conflict();
    const draft = pending.draftId ? await this.deps.drafts.get(pending.draftId) : undefined;
    if (cp?.pipelineVersion === KB02_PIPELINE_VERSION) {
      const bundle = await loadExtractionRules(this.deps.rulesDir);
      const currentProvider = this.deps.provider();
      if (!draft && (cp.rulesVersion !== bundle.rulesVersion || (currentProvider && cp.providerIdentity !== `${currentProvider.cacheIdentity ?? currentProvider.name}|${currentProvider.model}`))) this.conflict();
      // Prompt revisions do not invalidate completed drafts. Validate the saved atoms, plan
      // and evidence using the unchanged strict schema, without a Provider call.
      await validateKnowledgeCheckpoint({ raw, body: raw.body, bodySha256: cp.rawSha256, rulesDir: this.deps.rulesDir, checkpoint: draft ? { ...cp, rulesVersion: bundle.rulesVersion } : cp, provider: { ...job.provider, secrets: currentProvider?.secrets, complete: async () => { throw new Error('Storage reconciliation cannot call Provider'); } } }, draft ? { rulesVersion: cp.rulesVersion, callCount: draft.extraction.callCount } : undefined);
    }
    if (pending.draftId) {
      if (!draft || draft.jobId !== job.id || draft.rawId !== job.rawId || (draft.status === 'discarded' && pending.status !== 'cancelled') || draft.rawSha256 !== createHash('sha256').update(raw.body).digest('hex') || draft.provider.name !== job.provider.name || draft.provider.model !== job.provider.model || draft.extraction.callCount < job.callCount) this.conflict();
      if (cp && (!cp.plan || cp.completedChunks.length !== cp.chunks.length || (job.status !== 'completed' && draft.rulesVersion !== cp.rulesVersion + '-' + cp.pipelineVersion) || draft.extraction.callCount !== cp.attempts || draft.extraction.chunkCount !== cp.chunks.length || (cp.draftId && cp.draftId !== draft.id))) this.conflict();
      await this.deps.drafts.assertEvidenceStillValid(draft, raw.body);
    }
    if (pending.status === 'completed' && !draft) this.conflict();
    return draft;
  }

  private async persistSettlement(id: string, pending: PendingSettlement): Promise<void> {
    const statusAtEntry = pending.status;
    const job = await this.deps.jobs.get(id);
    if (!job) this.conflict();
    const draft = await this.validateSettlement(job, pending);
    let phase = 'checkpoint';
    try {
      const store = new ExtractionCheckpointStore(this.deps.root);
      // Do not re-write already saved cp bytes during a partial recovery.
      if (pending.checkpoint && (await store.get(id))?.integrity !== pending.checkpoint.integrity) pending.checkpoint = await store.save(pending.checkpoint);
      if (pending.status !== statusAtEntry) return this.persistSettlement(id, pending);
      if (pending.status === 'cancelled' && draft && draft.status !== 'discarded') { phase = 'cancelled-draft'; await this.deps.drafts.discard(draft.id, undefined); }
      const state = await this.deps.rawStates.get(job.rawId);
      phase = pending.status + '-raw-state';
      const target = pending.status === 'completed' ? 'pending_confirmation' : pending.status === 'cancelled' ? state.revertStatus ?? 'unprocessed' : 'failed';
      if (state.status !== target || state.jobId !== id || (pending.status === 'completed' && state.draftId !== draft?.id) || (pending.status === 'failed' && state.lastError?.code !== pending.failure?.code)) {
        await this.deps.rawStates.set(job.rawId, { status: target, reason: pending.status === 'completed' ? '提取完成，等待人工审核' : pending.status === 'cancelled' ? 'AI 整理已取消，晚到结果不会写入草稿' : '提取失败：' + pending.failure?.code, jobId: id, ...(pending.status === 'completed' ? { draftId: draft!.id } : {}), ...(pending.status === 'failed' ? { lastError: pending.failure } : {}) });
      }
      if (pending.status !== statusAtEntry) return this.persistSettlement(id, pending);
      phase = pending.status + '-job';
      const cp = pending.checkpoint;
      await this.deps.jobs.update(id, { status: pending.status, stage: pending.status === 'cancelled' ? 'done' : cp?.stage ?? job.stage, ...(pending.status === 'completed' ? { draftId: draft!.id, pagesFound: draft!.pages.length } : {}), cancelRequested: pending.status === 'cancelled' || job.cancelRequested, callCount: Math.max(job.callCount, cp?.attempts ?? draft?.extraction.callCount ?? 0), chunksDone: cp?.completedChunks.length ?? job.chunksDone, ...(cp ? { checkpoint: { stage: cp.stage, validatedChunks: cp.completedChunks.length, totalChunks: cp.chunks.length, resumable: pending.status === 'failed', attempts: cp.attempts, reusedChunks: job.checkpoint?.reusedChunks ?? 0, reason: pending.failure?.message } } : {}), error: pending.status === 'failed' ? pending.failure : undefined, finishedAt: new Date().toISOString() });
      if (pending.status !== statusAtEntry) return this.persistSettlement(id, pending);
      this.pending.delete(id);
    } catch (error) { await this.retain(id, pending, error, phase); throw storageFailure(error) ?? error; }
  }

  async reconcileStorage(id: string) {
    return this.startQueue.run(async () => {
      if (this.tasks.has(id)) throw new JobError('LLM_JOB_ALREADY_RUNNING', '任务仍在运行或收尾。', 409);
      const job = await this.deps.jobs.get(id);
      if (!job) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      if (job.pipelineVersion === KB02_PIPELINE_VERSION && !await new ExtractionCheckpointStore(this.deps.root).get(id)) this.conflict();
      let pending = this.pending.get(id);
      if (!pending && job.status === 'running') {
        if (this.pending.size >= EXTRACTION_RECOVERY_CAPACITY) throw new JobError('STORAGE_RECOVERY_CAPACITY', '待保存任务已达容量，请先保存已登记的任务。', 503);
        pending = await this.restartIntent(job);
        this.pending.set(id, pending);
        await this.retain(id, pending, new StorageError('STORAGE_RECONCILE_REQUIRED', '核验中断任务后保存本机状态。', 409), 'restart-disk');
      }
      if (pending?.issue?.phase === 'restart-validation') {
        pending = await this.restartIntent(job);
        this.pending.set(id, pending);
        pending.expected = await this.snapshot(id, pending);
      }
      if (!pending) return this.readJob(id);
      if (!pending.expected || fingerprint(await this.snapshot(id, pending)) !== fingerprint(pending.expected)) this.conflict();
      await this.persistSettlement(id, pending);
      return this.readJob(id);
    });
  }
  /** F04-08: starts are serialized here too, so the service alone never creates two jobs. */
  private readonly startQueue = new SerialQueue();

  constructor(private readonly deps: {
    root: string; llm: LLMService; jobs: ExtractionJobStore; drafts: DraftStore;
    rawStates: RawStateStore; rawStore: RawStore; provider: () => LlmProvider | undefined;
    draftRules: () => Promise<{ types: string[]; categories: string[]; knowledge_status: string[]; confidence: string[]; source_level: string[]; review_status: string[] }>;
    rulesDir: string;
  }) {}

  /** Starts an extraction, or returns the existing active job/draft for the same Raw. */
  async start(rawId: string, options: { newJobId: string; now: string; restart?: boolean; planningRetry?: boolean }): Promise<{ job: ExtractionJob; reused: boolean }> {
    return this.startQueue.run(async () => { try { return await this.startOnce(rawId, options); } catch (error) { throw storageFailure(error) ?? error; } });
  }

  private async startOnce(rawId: string, options: { newJobId: string; now: string; restart?: boolean; planningRetry?: boolean }): Promise<{ job: ExtractionJob; reused: boolean }> {
    const raw = await this.deps.rawStore.get(rawId);
    assertRawNotMeeting(raw);
    if (!raw) throw new JobError('NOT_FOUND', '没有找到这条原始资料。', 404);
    const state = await this.deps.rawStates.get(rawId);
    if ([...this.pending.values()].some(item => item.rawId === rawId && item.issue)) throw new JobError('STORAGE_RECONCILE_REQUIRED', '上次任务状态尚未保存，请先重试保存状态。', 409);
    // A partially inserted start can have a different disk Raw jobId. Do not
    // bypass it when this runner has not yet registered restart recovery.
    const stoppedStart = (await this.deps.jobs.list()).find(job => job.rawId === rawId && job.status === 'running' && job.startStateHash && !this.tasks.has(job.id));
    if (stoppedStart) throw new JobError('STORAGE_RECONCILE_REQUIRED', '发现已停止的任务，请先恢复本机状态。', 409, { jobId: stoppedStart.id });
    const checkpoints = new ExtractionCheckpointStore(this.deps.root);
    const existingDraft = await this.deps.drafts.findActiveForRaw(rawId);
    if (state.status === 'processing' && state.jobId) {
      const job = await this.deps.jobs.get(state.jobId);
      if (job && job.status === 'running' && this.tasks.has(job.id)) return { job, reused: true };
      if (job && job.status === 'running' && !existingDraft) throw new JobError('STORAGE_RECONCILE_REQUIRED', '发现已停止的任务，请先恢复本机状态。', 409);
    }
    if (existingDraft) {
      if (options.planningRetry) throw new JobError('LLM_PLANNING_RETRY_UNAVAILABLE', '已有完整草稿，不可仅重新规划。', 409);
      const job = await this.deps.jobs.get(existingDraft.jobId);
      if (!job) this.conflict();
      const cp = await checkpoints.get(job.id);
      const pending: PendingSettlement = { rawId, checkpoint: cp, status: 'completed', draftId: existingDraft.id };
      await this.validateSettlement(job, pending);
      if (job.status !== 'completed') {
        if (this.pending.size >= EXTRACTION_RECOVERY_CAPACITY) throw new JobError('STORAGE_RECOVERY_CAPACITY', '待保存任务已达容量，请先保存已登记的任务。', 503);
        if (cp) pending.checkpoint = checkpoints.prepare({ ...cp, draftId: existingDraft.id, stage: 'done', lastError: undefined });
        this.pending.set(job.id, pending);
        await this.persistSettlement(job.id, pending);
      }
      return { job: (await this.deps.jobs.get(job.id))!, reused: true };
    }
    const prior = !options.restart && state.jobId ? await this.deps.jobs.get(state.jobId) : undefined;
    const savedCheckpoint = prior && prior.status !== 'completed' ? await checkpoints.get(prior.id) : undefined;
    if (prior?.pipelineVersion === KB02_PIPELINE_VERSION && prior.status !== 'completed' && !savedCheckpoint) throw new JobError('LLM_CHECKPOINT_MISSING', '此任务的检查点缺失，不能继续或重置累计次数；请恢复原检查点，或显式重新生成。', 409);
    const provider = this.deps.provider();
    if (!provider) throw new LlmError('LLM_NOT_CONFIGURED', '尚未配置产品 LLM Provider，无法执行 AI 整理。', 400);
    const providerIdentity = `${provider.cacheIdentity ?? provider.name}|${provider.model}`;
    let resume: ExtractionCheckpoint | undefined;
    let jobId = options.newJobId;
    if (!options.restart && state.jobId) {
      const priorCheckpoint = savedCheckpoint;
      if (priorCheckpoint) {
        if (prior?.status === 'running') throw new JobError('LLM_JOB_ALREADY_RUNNING', '此 Raw 已有运行中的提取任务。', 409);
        if (priorCheckpoint.stage !== 'done') {
          if (prior && (priorCheckpoint.attempts < prior.callCount || priorCheckpoint.attempts < knowledgePlanCallMinimum(priorCheckpoint))) throw new JobError('LLM_CHECKPOINT_CORRUPT', '检查点累计调用次数低于已持久化作业记录，已拒绝恢复。', 409);
          const bundle = await loadExtractionRules(this.deps.rulesDir);
          const chunks = chunkText(raw.body, { maxChunkChars: bundle.rules.budgets.maxChunkChars, overlap: bundle.rules.budgets.chunkOverlap, maxRawChars: bundle.rules.budgets.maxRawChars }).map(({ index, start, end }) => ({ index, start, end }));
          const actualSha = createHash('sha256').update(raw.body).digest('hex');
          if (priorCheckpoint.rawId !== raw.id || priorCheckpoint.rawSha256 !== actualSha || priorCheckpoint.rulesVersion !== bundle.rulesVersion || priorCheckpoint.pipelineVersion !== KB02_PIPELINE_VERSION || priorCheckpoint.providerIdentity !== providerIdentity || JSON.stringify(priorCheckpoint.chunks) !== JSON.stringify(chunks)) throw new JobError('LLM_CHECKPOINT_INCOMPATIBLE', '原文、规则、Provider或pipeline已变化；检查点保留，请显式重新生成。', 409);
          await validateKnowledgeCheckpoint({ raw: { id: raw.id, title: raw.title, sourceType: raw.sourceType, sourceName: raw.sourceName, author: raw.author, publishedAt: raw.publishedAt, url: raw.url, tags: raw.tags ?? [] }, body: raw.body, bodySha256: actualSha, provider, rulesDir: this.deps.rulesDir, checkpoint: priorCheckpoint });
          resume = priorCheckpoint;
          jobId = state.jobId;
        }
      }
    }
    if (options.planningRetry && (options.restart || !resume || resume.plan || resume.completedChunks.length !== resume.chunks.length || resume.lastError?.code !== 'LLM_PLAN_COVERAGE_INVALID' || !resume.lastError.diagnostic)) throw new JobError('LLM_PLANNING_RETRY_UNAVAILABLE', '仅重新规划需要兼容的完整提取检查点及覆盖失败诊断。', 409);
    if (resume && !resume.plan && resume.completedChunks.length === resume.chunks.length && knowledgeCallLimit(resume.chunks.length) - resume.attempts < 2) throw new JobError('LLM_ATTEMPT_LIMIT', `剩余预算不足以完成规划和语义审核（累计 ${knowledgeCallLimit(resume.chunks.length)} 次调用上限）；请检查资料后显式重新生成。`, 409);
    if (this.pending.size >= EXTRACTION_RECOVERY_CAPACITY) throw new JobError('STORAGE_RECOVERY_CAPACITY', '本进程待保存及运行中任务已达上限，请先保存状态。', 503);
    const revertStatus = state.status === 'unprocessed' || state.status === 'generated' ? state.status : (state.revertStatus ?? 'unprocessed');
    const bundle = await loadExtractionRules(this.deps.rulesDir);
    const chunks = chunkText(raw.body, { maxChunkChars: bundle.rules.budgets.maxChunkChars, overlap: bundle.rules.budgets.chunkOverlap, maxRawChars: bundle.rules.budgets.maxRawChars }).map(({ index, start, end }) => ({ index, start, end }));
    const actualSha = createHash('sha256').update(raw.body).digest('hex');
    const checkpoint = resume ?? await checkpoints.save({ version: 1, jobId, rawId, rawSha256: actualSha, pipelineVersion: KB02_PIPELINE_VERSION, rulesVersion: bundle.rulesVersion, providerIdentity, chunks, completedChunks: [], attempts: 0, stage: 'extracting', updatedAt: options.now });
    const job: ExtractionJob = { id: jobId, rawId, status: 'running', stage: checkpoint.stage, chunksTotal: chunks.length, chunksDone: checkpoint.completedChunks.length, pagesFound: checkpoint.completedChunks.reduce((sum, item) => sum + item.facts.length, 0), provider: { name: provider.name, model: provider.model }, cancelRequested: false, callCount: checkpoint.attempts, pipelineVersion: KB02_PIPELINE_VERSION, checkpoint: { stage: checkpoint.stage, validatedChunks: checkpoint.completedChunks.length, totalChunks: chunks.length, resumable: !!resume, reason: checkpoint.lastError?.message, attempts: checkpoint.attempts, reusedChunks: resume?.completedChunks.length ?? 0 }, startedAt: resume ? (await this.deps.jobs.get(jobId))?.startedAt ?? options.now : options.now, updatedAt: options.now };
    if (!resume) job.startStateHash = fingerprint(state);
    const pending: PendingSettlement = { rawId, checkpoint, status: 'failed' };
    this.pending.set(jobId, pending);
    try {
      if (resume) await this.deps.jobs.update(jobId, { status: 'running', stage: checkpoint.stage, chunksTotal: chunks.length, chunksDone: checkpoint.completedChunks.length, callCount: checkpoint.attempts, error: undefined, finishedAt: undefined, cancelRequested: false });
      else await this.deps.jobs.insert(job);
      await this.deps.rawStates.set(rawId, { status: 'processing', reason: resume ? '已验证检查点恢复提取' : 'AI 整理已启动', jobId, revertStatus });
    } catch (error) {
      pending.failure = { code: 'LLM_START_INTERRUPTED', message: '任务启动时状态保存失败，未调用模型。', at: new Date().toISOString(), retryable: true };
      if (!await this.deps.jobs.get(jobId)) { this.pending.delete(jobId); throw storageFailure(error) ?? error; }
      await this.retain(jobId, pending, error, 'start-state');
      const safe = storageFailure(error);
      if (safe) throw new StorageError(safe.code, safe.message, safe.status, { ...(safe.details as object), jobId });
      throw error;
    }
    const task = this.runKnowledge(job, raw, provider, checkpoint, options.planningRetry === true).catch(async error => {
      await this.retain(job.id, pending, error, 'settlement');
    }).finally(() => { if (this.tasks.get(job.id) === task) this.tasks.delete(job.id); });
    this.tasks.set(job.id, task);
    return { job, reused: false };
  }

  private async runKnowledge(job: ExtractionJob, raw: { id: string; title: string; bodySha256: string; body: string; sourceType: string; sourceName: string; author?: string; publishedAt?: string; url?: string; tags: string[] }, provider: LlmProvider, initial: ExtractionCheckpoint, planningRetry = false): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const secrets = provider.secrets ?? [];
    const checkpoints = new ExtractionCheckpointStore(this.deps.root);
    const pending = this.pending.get(job.id)!;
    let checkpoint = initial;
    let phase = 'pipeline';
    const progressWrites: Promise<void>[] = [];
    const saveCheckpoint = async (value: Omit<ExtractionCheckpoint, 'integrity'>) => {
      assertNoKnownSecret([...value.completedChunks, ...(value.plan ? [value.plan] : []), ...(value.lastError ? [value.lastError] : [])], secrets);
      pending.checkpoint = checkpoints.prepare(value);
      phase = value.stage === 'done' ? 'done-checkpoint' : value.lastError?.diagnostic ? 'coverage-checkpoint' : 'checkpoint';
      try { checkpoint = await checkpoints.save(value); pending.checkpoint = checkpoint; return checkpoint; }
      catch (error) { throw storageFailure(error) ?? error; }
    };
    try {
      const { outcome } = await runKnowledgePipeline({
        raw: { id: raw.id, title: raw.title, sourceType: raw.sourceType, sourceName: raw.sourceName, author: raw.author, publishedAt: raw.publishedAt, url: raw.url, tags: raw.tags ?? [] },
        body: raw.body, bodySha256: createHash('sha256').update(raw.body).digest('hex'), provider, rulesDir: this.deps.rulesDir, checkpoint, signal: controller.signal, saveCheckpoint, planningRetry,
        beforeCall: async stage => {
          if (controller.signal.aborted) throw new LlmError('LLM_CANCELLED', '提取已被取消。', 409);
          const maxCalls = knowledgeCallLimit(checkpoint.chunks.length);
          if (checkpoint.attempts >= maxCalls) throw new LlmError('LLM_ATTEMPT_LIMIT', '已达到此任务累计 ' + maxCalls + ' 次调用上限，请检查资料后显式重新生成。', 429);
          checkpoint = await saveCheckpoint({ ...checkpoint, attempts: checkpoint.attempts + 1, stage, lastError: undefined });
          phase = 'call-count-job';
          try { await this.deps.jobs.update(job.id, { callCount: checkpoint.attempts, stage, chunksDone: checkpoint.completedChunks.length, pipelineVersion: KB02_PIPELINE_VERSION, checkpoint: { stage: checkpoint.stage, validatedChunks: checkpoint.completedChunks.length, totalChunks: checkpoint.chunks.length, resumable: true, attempts: checkpoint.attempts, reusedChunks: initial.completedChunks.length } }); }
          catch (error) { throw storageFailure(error) ?? error; }
          return checkpoint;
        },
        onProgress: progress => {
          const write = this.deps.jobs.update(job.id, { stage: progress.stage, chunksTotal: progress.chunksTotal, chunksDone: progress.chunksDone, pagesFound: progress.pagesFound }).then(() => undefined);
          progressWrites.push(write); void write.catch(() => undefined);
        },
      });
      await Promise.all(progressWrites);
      assertNoKnownSecret(outcome, secrets);
      // Cancellation aborts synchronously; terminal work also uses the start/recovery queue.
      await this.startQueue.run(async () => {
        if (controller.signal.aborted) { await this.finishCancelled(job, pending); return; }
        phase = 'draft';
        const rules = await this.deps.draftRules();
        if (controller.signal.aborted) { await this.finishCancelled(job, pending); return; }
        const draft = await this.deps.drafts.create({ raw: { id: raw.id, title: raw.title, bodySha256: raw.bodySha256, sourceType: raw.sourceType, sourceName: raw.sourceName, author: raw.author, publishedAt: raw.publishedAt, url: raw.url }, outcome, jobId: job.id, body: raw.body, rules });
        pending.draftId = draft.id;
        pending.status = controller.signal.aborted ? 'cancelled' : 'completed';
        checkpoint = await saveCheckpoint({ ...checkpoint, draftId: draft.id, stage: 'done', lastError: undefined });
        if (controller.signal.aborted) pending.status = 'cancelled';
        await this.persistSettlement(job.id, pending);
      });
    } catch (error) {
      await Promise.allSettled(progressWrites);
      if (controller.signal.aborted) {
        await this.startQueue.run(() => this.finishCancelled(job, pending));
        return;
      }
      const storage = storageFailure(error);
      if (storage) {
        if (pending.checkpoint?.lastError) pending.failure = { ...pending.checkpoint.lastError, retryable: true, details: pending.checkpoint.lastError.diagnostic };
        await this.retain(job.id, pending, storage, pending.issue?.phase ?? phase);
        return;
      }
      const code = sanitizeProviderText(error instanceof LlmError || error instanceof JobError ? error.code : 'LLM_INTERNAL_ERROR', secrets) || 'LLM_PROVIDER_ERROR';
      const message = sanitizeProviderText(error instanceof Error ? error.message : '未知错误', secrets);
      pending.status = 'failed';
      pending.failure = { code, message, at: new Date().toISOString(), retryable: !NON_RETRYABLE.has(code), ...(error instanceof LlmError && error.details !== undefined ? { details: sanitizeDeep(error.details, secrets) } : {}) };
      try {
        await saveCheckpoint({ ...checkpoint, lastError: { code, message, at: pending.failure.at, ...(code === 'LLM_PLAN_COVERAGE_INVALID' && checkpoint.lastError?.diagnostic ? { diagnostic: checkpoint.lastError.diagnostic } : {}) } });
        await this.startQueue.run(() => this.persistSettlement(job.id, pending));
      } catch (failure) { await this.retain(job.id, pending, failure, pending.issue?.phase ?? phase); }
    } finally { this.controllers.delete(job.id); }
  }

  private async finishCancelled(job: ExtractionJob, pending: PendingSettlement): Promise<void> {
    pending.status = 'cancelled'; pending.failure = undefined;
    try { await this.persistSettlement(job.id, pending); }
    catch (error) { await this.retain(job.id, pending, error, pending.issue?.phase ?? 'cancelled-job'); }
  }

  async cancel(jobId: string): Promise<ExtractionJob> {
    this.controllers.get(jobId)?.abort();
    const running = this.pending.get(jobId);
    if (running && this.controllers.has(jobId)) running.status = 'cancelled';
    return this.startQueue.run(async () => {
      const job = await this.deps.jobs.get(jobId);
      if (!job) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      if (job.status === 'running' && !this.tasks.has(jobId)) throw new JobError('STORAGE_RECONCILE_REQUIRED', '任务已停止，请先重试保存状态。', 409);
      if (this.pending.get(jobId)?.issue && !this.tasks.has(jobId)) throw new JobError('STORAGE_RECONCILE_REQUIRED', '任务已停止，请重试保存状态。', 409);
      if (job.status !== 'running') return job;
      try { return await this.deps.jobs.update(jobId, { cancelRequested: true }); }
      catch (error) {
        const pending = this.pending.get(jobId) ?? { rawId: job.rawId, status: 'cancelled' as const };
        pending.status = 'cancelled';
        await this.retain(jobId, pending, error, 'cancel-request');
        throw storageFailure(error) ?? error;
      }
    });
  }

  /** Restart recovery uses disk evidence only. Lost in-memory diagnostics are never invented. */
  private async restartIntent(job: ExtractionJob): Promise<PendingSettlement> {
    const cp = await new ExtractionCheckpointStore(this.deps.root).get(job.id);
    const draft = cp?.draftId ? await this.deps.drafts.get(cp.draftId) : await this.deps.drafts.findActiveForRaw(job.rawId);
    if (cp?.draftId && !draft) this.conflict();
    const pending: PendingSettlement = { rawId: job.rawId, checkpoint: cp, draftId: draft?.id, status: job.cancelRequested ? 'cancelled' : draft ? 'completed' : 'failed' };
    await this.validateSettlement(job, pending);
    if (draft && !job.cancelRequested && cp) pending.checkpoint = new ExtractionCheckpointStore(this.deps.root).prepare({ ...cp, draftId: draft.id, stage: 'done', lastError: undefined });
    const prior = cp?.lastError;
    if (!draft) pending.failure = prior ? { code: prior.code, message: prior.message, at: prior.at, retryable: true, ...(prior.diagnostic ? { details: prior.diagnostic } : {}) } : { code: 'LLM_INTERRUPTED', message: '上一轮任务中断，未发现完整草稿；未保存的诊断无法恢复。继续操作前请检查状态。', at: new Date().toISOString(), retryable: true };
    return pending;
  }

  async reconcile(): Promise<{ interrupted: string[]; statesFixed: string[] }> {
    return this.startQueue.run(async () => {
      const interrupted: string[] = [], statesFixed: string[] = [];
      for (const job of await this.deps.jobs.list()) {
        const state = await this.deps.rawStates.get(job.rawId);
        if (this.tasks.has(job.id) || (state.jobId && state.jobId !== job.id && !(job.status === 'running' && job.startStateHash)) || (job.status !== 'running' && state.status !== 'processing')) continue;
        if (this.pending.size >= EXTRACTION_RECOVERY_CAPACITY) continue; // Remaining jobs expose lazy disk recovery through readJob.
        let pending: PendingSettlement = { rawId: job.rawId, status: job.cancelRequested ? 'cancelled' : 'failed' };
        try {
          pending = await this.restartIntent(job);
          this.pending.set(job.id, pending);
          await this.persistSettlement(job.id, pending);
          if (job.status === 'running') interrupted.push(job.id);
          statesFixed.push(job.rawId + ':' + (pending.status === 'completed' ? 'pending_confirmation' : pending.status === 'cancelled' ? (await this.deps.rawStates.get(job.rawId)).status : 'failed'));
        } catch (error) { await this.retain(job.id, pending, error, 'restart-validation'); }
      }
      return { interrupted, statesFixed };
    });
  }
}
