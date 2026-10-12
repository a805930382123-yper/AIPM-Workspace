// B04: extraction jobs. A job owns one provider run for one Raw; its state is persisted so an
// interrupted run is visible and retryable instead of leaving a permanent "processing" state.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { LLMService, ExtractProgress } from './service.ts';
import { LlmError, sanitizeDeep, sanitizeProviderText, type LlmProvider } from './provider.ts';
import { SerialQueue, listJsonRecords, readJsonFile, writeJsonAtomic } from '../storage/files.ts';
import type { DraftStore } from '../wiki/drafts.ts';
import type { RawStateStore } from '../raw/state.ts';
import type { RawStore } from '../raw/store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';

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
};

const NON_RETRYABLE = new Set(['LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED', 'LLM_RAW_TOO_LARGE', 'LLM_TOO_MANY_PAGES', 'LLM_OUTPUT_CONTAINS_SECRET']);

/** F04-10: reports where a secret appeared without ever returning the value itself. */
export function findSecretHits(value: unknown, secrets: readonly string[], at = '$', hits: string[] = []): string[] {
  const usable = secrets.filter(secret => typeof secret === 'string' && secret.length >= 6);
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
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) findSecretHits(item, usable, `${at}.${key}`, hits);
  }
  return hits;
}

export class JobError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}

export class ExtractionJobStore {
  private readonly queue = new SerialQueue();
  constructor(public readonly root: string) {}
  private directory() { return path.join(this.root, 'state', 'extraction-jobs'); }
  private fileFor(id: string) { return path.join(this.directory(), `${id}.json`); }
  async initialize() { await mkdir(this.directory(), { recursive: true }); }
  async get(id: string): Promise<ExtractionJob | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    return readJsonFile<ExtractionJob>(this.fileFor(id));
  }
  async list(): Promise<ExtractionJob[]> {
    const records = await listJsonRecords<ExtractionJob>(this.directory());
    return records.map(record => record.value).filter(value => value && JOB_STATUSES.includes(value.status));
  }
  async update(id: string, patch: Partial<ExtractionJob>): Promise<ExtractionJob> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      const next: ExtractionJob = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async insert(job: ExtractionJob): Promise<ExtractionJob> {
    await writeJsonAtomic(this.fileFor(job.id), job);
    return job;
  }
}

export class ExtractionRunner {
  private readonly controllers = new Map<string, AbortController>();
  /** F04-08: starts are serialized here too, so the service alone never creates two jobs. */
  private readonly startQueue = new SerialQueue();

  constructor(private readonly deps: {
    root: string; llm: LLMService; jobs: ExtractionJobStore; drafts: DraftStore;
    rawStates: RawStateStore; rawStore: RawStore; provider: () => LlmProvider | undefined;
    draftRules: () => Promise<{ types: string[]; categories: string[]; knowledge_status: string[]; confidence: string[]; source_level: string[]; review_status: string[] }>;
    rulesDir: string;
  }) {}

  /** Starts an extraction, or returns the existing active job/draft for the same Raw. */
  async start(rawId: string, options: { newJobId: string; now: string }): Promise<{ job: ExtractionJob; reused: boolean }> {
    return this.startQueue.run(() => this.startOnce(rawId, options));
  }

  private async startOnce(rawId: string, options: { newJobId: string; now: string }): Promise<{ job: ExtractionJob; reused: boolean }> {
    const raw = await this.deps.rawStore.get(rawId);
    assertRawNotMeeting(raw);
    if (!raw) throw new JobError('NOT_FOUND', '没有找到这条原始资料。', 404);
    const existingDraft = await this.deps.drafts.findActiveForRaw(rawId);
    const state = await this.deps.rawStates.get(rawId);
    if (state.status === 'processing' && state.jobId) {
      const job = await this.deps.jobs.get(state.jobId);
      if (job && job.status === 'running') return { job, reused: true };
    }
    if (existingDraft) {
      const job = await this.deps.jobs.get(existingDraft.jobId);
      if (job) return { job, reused: true };
      const view: ExtractionJob = {
        id: existingDraft.jobId, rawId, status: existingDraft.status === 'confirmed' ? 'completed' : 'completed',
        stage: 'done', chunksTotal: existingDraft.extraction.chunkCount, chunksDone: existingDraft.extraction.chunkCount,
        pagesFound: existingDraft.pages.length, provider: existingDraft.provider, draftId: existingDraft.id,
        cancelRequested: false, callCount: existingDraft.extraction.callCount,
        startedAt: existingDraft.createdAt, finishedAt: existingDraft.updatedAt, updatedAt: existingDraft.updatedAt,
      };
      return { job: view, reused: true };
    }
    const provider = this.deps.provider();
    if (!provider) throw new LlmError('LLM_NOT_CONFIGURED', '尚未配置产品 LLM Provider（FMCG_LLM_BASE_URL / FMCG_LLM_MODEL / FMCG_LLM_API_KEY），无法执行 AI 整理。', 400);

    const revertStatus = state.status === 'unprocessed' || state.status === 'generated' ? state.status : (state.revertStatus ?? 'unprocessed');
    const job: ExtractionJob = {
      id: options.newJobId, rawId, status: 'running', stage: 'chunking', chunksTotal: 0, chunksDone: 0, pagesFound: 0,
      provider: { name: provider.name, model: provider.model }, cancelRequested: false, callCount: 0,
      startedAt: options.now, updatedAt: options.now,
    };
    await this.deps.jobs.insert(job);
    await this.deps.rawStates.set(rawId, { status: 'processing', reason: 'AI 整理已启动', jobId: job.id, revertStatus });
    void this.run(job, raw, provider).catch(() => undefined);
    return { job, reused: false };
  }

  private async run(job: ExtractionJob, raw: { id: string; title: string; bodySha256: string; body: string; sourceType: string; sourceName: string; author?: string; publishedAt?: string; url?: string; tags: string[] }, provider: LlmProvider): Promise<void> {
    const controller = new AbortController();
    const secrets = provider.secrets ?? [];
    this.controllers.set(job.id, controller);
    try {
      const outcome = await this.deps.llm.wikiExtract({
        raw: {
          id: raw.id, title: raw.title, sourceType: raw.sourceType, sourceName: raw.sourceName,
          author: raw.author, publishedAt: raw.publishedAt, url: raw.url, tags: raw.tags ?? [],
        },
        body: raw.body,
        provider,
        signal: controller.signal,
        rulesDir: this.deps.rulesDir,
        onProgress: progress => {
          void this.deps.jobs.update(job.id, {
            stage: progress.stage, chunksTotal: progress.chunksTotal, chunksDone: progress.chunksDone, pagesFound: progress.pagesFound,
          }).catch(() => undefined);
        },
      });
      if (controller.signal.aborted) { await this.finishCancelled(job); return; }
      // F04-10: a provider must never be able to write the server credential into a draft (R41).
      const leaked = findSecretHits(outcome, secrets);
      if (leaked.length) {
        throw new LlmError('LLM_OUTPUT_CONTAINS_SECRET', `Provider 输出包含服务端凭证片段，已拒绝该结果（命中 ${leaked.length} 处：${leaked.join('、')}）。请检查 Provider/中转配置后重试。`, 502, { hitCount: leaked.length, locations: leaked.slice(0, 10) });
      }
      const draft = await this.deps.drafts.create({
        raw: { id: raw.id, title: raw.title, bodySha256: raw.bodySha256, sourceType: raw.sourceType, sourceName: raw.sourceName, author: raw.author, publishedAt: raw.publishedAt, url: raw.url },
        outcome, jobId: job.id, body: raw.body, rules: await this.deps.draftRules(),
      });
      if (controller.signal.aborted) {
        // F04-08: a cancel that lands while the draft is being written must not leave it pending.
        await this.deps.drafts.discard(draft.id, undefined).catch(() => undefined);
        await this.finishCancelled(job);
        return;
      }
      // Raw state first, job status last: a terminal job always implies a settled Raw state.
      await this.deps.rawStates.set(raw.id, { status: 'pending_confirmation', reason: '提取完成，等待人工审核', jobId: job.id, draftId: draft.id });
      await this.deps.jobs.update(job.id, {
        status: 'completed', stage: 'done', draftId: draft.id, callCount: outcome.callCount,
        chunksTotal: outcome.chunkCount, chunksDone: outcome.chunkCount, pagesFound: draft.pages.length,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (controller.signal.aborted) { await this.finishCancelled(job); return; }
      const rawCode = error instanceof LlmError || error instanceof JobError ? (error as { code: string }).code : 'LLM_INTERNAL_ERROR';
      const rawMessage = error instanceof Error ? error.message : '未知错误';
      const rawDetails = error instanceof LlmError || error instanceof JobError ? (error as { details?: unknown }).details : undefined;
      // F04-10: sanitize before the message/details reach a response, a persisted job file or a log.
      const code = rawCode;
      const message = sanitizeProviderText(rawMessage, secrets);
      const details = rawDetails === undefined ? undefined : sanitizeDeep(rawDetails, secrets);
      const retryable = !NON_RETRYABLE.has(code);
      await this.deps.rawStates.set(raw.id, {
        status: 'failed', reason: `提取失败：${code}`,
        lastError: { code, message, at: new Date().toISOString(), retryable },
      }).catch(() => undefined);
      await this.deps.jobs.update(job.id, {
        status: 'failed', stage: 'done', finishedAt: new Date().toISOString(),
        error: { code, message, at: new Date().toISOString(), retryable, ...(details === undefined ? {} : { details }) },
      }).catch(() => undefined);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async finishCancelled(job: ExtractionJob): Promise<void> {
    const state = await this.deps.rawStates.get(job.rawId);
    await this.deps.rawStates.set(job.rawId, {
      status: state.revertStatus ?? 'unprocessed', reason: 'AI 整理已取消，晚到的结果不会写入草稿',
    }).catch(() => undefined);
    await this.deps.jobs.update(job.id, { status: 'cancelled', stage: 'done', finishedAt: new Date().toISOString() }).catch(() => undefined);
  }

  /** Explicit cancel: the late provider answer must not create a draft. */
  async cancel(jobId: string): Promise<ExtractionJob> {
    const job = await this.deps.jobs.get(jobId);
    if (!job) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
    if (job.status !== 'running') return job;
    await this.deps.jobs.update(jobId, { cancelRequested: true }).catch(() => undefined);
    this.controllers.get(jobId)?.abort();
    const current = await this.deps.jobs.get(jobId);
    return current ?? job;
  }

  /** Startup reconciliation: a job that was running when the process stopped is an interruption. */
  async reconcile(): Promise<{ interrupted: string[]; statesFixed: string[] }> {
    const interrupted: string[] = [];
    const jobs = await this.deps.jobs.list();
    for (const job of jobs) {
      if (job.status !== 'running') continue;
      const at = new Date().toISOString();
      await this.deps.jobs.update(job.id, {
        status: 'failed', stage: 'done', finishedAt: at,
        error: { code: 'LLM_INTERRUPTED', message: '上一轮提取在工作台停止时中断，未生成草稿；可以直接重试。', at, retryable: true },
      }).catch(() => undefined);
      interrupted.push(job.id);
    }
    const statesFixed: string[] = [];
    for (const state of await this.deps.rawStates.list()) {
      if (state.status !== 'processing') continue;
      const job = state.jobId ? await this.deps.jobs.get(state.jobId) : undefined;
      if (job?.status === 'completed' && job.draftId) {
        const draft = await this.deps.drafts.get(job.draftId);
        if (draft && draft.status !== 'discarded') {
          await this.deps.rawStates.set(state.rawId, { status: 'pending_confirmation', reason: '重启后恢复待审核草稿', jobId: job.id, draftId: draft.id });
          statesFixed.push(`${state.rawId}:pending_confirmation`);
          continue;
        }
      }
      await this.deps.rawStates.set(state.rawId, {
        status: 'failed', reason: '重启后确认这是一个中断的提取任务',
        lastError: { code: 'LLM_INTERRUPTED', message: '上一轮提取在工作台停止时中断，未生成草稿；可以直接重试。', at: new Date().toISOString(), retryable: true },
      });
      statesFixed.push(`${state.rawId}:failed`);
    }
    return { interrupted, statesFixed };
  }
}

