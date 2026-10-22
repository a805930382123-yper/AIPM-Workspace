import fs from 'node:fs/promises';
const file='services/llm/jobs.ts';let s=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
s=s.replace("import type { DraftStore }", "import { storageFailure } from './storage-recovery.ts';\nimport type { DraftRecord, DraftStore }");
s=s.replace('export class ExtractionRunner {',`export type StorageRecovery = { code: string; message: string; persisted: false; phase: string; action: 'reconcile-storage'; details?: unknown };
type PendingSettlement = { rawId: string; checkpoint?: ExtractionCheckpoint; status: 'completed' | 'failed' | 'cancelled'; failure?: ExtractionJob['error']; issue?: StorageRecovery; expected?: { job: string; raw: string; checkpoint?: string; draft?: string }; draftId?: string };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Admission reserves one checkpoint slot for each running task as well as unresolved writes.
// Eight bounded 16MiB checkpoints are at most 128MiB; no pending issue is evicted.
export const EXTRACTION_RECOVERY_CAPACITY = 8;

export class ExtractionRunner {`);
s=s.replace('  private readonly controllers = new Map<string, AbortController>();',`  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, PendingSettlement>();

  async readJob(id: string) {
    return { job: await this.deps.jobs.get(id), execution: this.tasks.has(id) ? 'running' as const : 'settled' as const, recovery: this.pending.get(id)?.issue };
  }
  async waitForSettlement(id: string) { await this.tasks.get(id); return this.readJob(id); }

  private conflict(): never { throw new JobError('STORAGE_RECONCILE_CONFLICT', '任务、检查点、原文或草稿已变化，不能安全保存；原文件已保留。', 409); }

  private async snapshot(id: string, pending: PendingSettlement) {
    const cp = await new ExtractionCheckpointStore(this.deps.root).get(id);
    return { job: fingerprint(await this.deps.jobs.get(id)), raw: fingerprint(await this.deps.rawStates.get(pending.rawId)), checkpoint: cp?.integrity, draft: pending.draftId ? fingerprint(await this.deps.drafts.get(pending.draftId)) : undefined };
  }

  private async retain(id: string, pending: PendingSettlement, error: unknown, phase: string) {
    const safe = storageFailure(error);
    pending.issue = { code: safe?.code ?? 'STORAGE_SETTLEMENT_FAILED', message: safe?.message ?? '任务已停止，状态尚未保存；请检查本机记录后重试保存。', phase, persisted: false, action: 'reconcile-storage', ...(safe ? { details: safe.details } : {}) };
    this.pending.set(id, pending);
    try { pending.expected = await this.snapshot(id, pending); } catch { pending.expected = undefined; }
  }

  /** Verify persisted task identity, not the user's current Provider configuration. */
  private async validateSettlement(job: ExtractionJob, pending: PendingSettlement): Promise<DraftRecord | undefined> {
    const raw = await this.deps.rawStore.get(job.rawId);
    const state = await this.deps.rawStates.get(job.rawId);
    if (!raw || raw.id !== pending.rawId || (state.jobId && state.jobId !== job.id)) this.conflict();
    assertRawNotMeeting(raw);
    const cp = pending.checkpoint;
    if (cp && (cp.jobId !== job.id || cp.rawId !== job.rawId || cp.rawSha256 !== createHash('sha256').update(raw.body).digest('hex') || cp.attempts < job.callCount || cp.attempts > knowledgeCallLimit(cp.chunks.length) || cp.attempts < cp.completedChunks.length + (cp.plan ? 1 : 0) || (job.pipelineVersion && cp.pipelineVersion !== job.pipelineVersion))) this.conflict();
    const draft = pending.draftId ? await this.deps.drafts.get(pending.draftId) : undefined;
    if (pending.draftId) {
      if (!draft || draft.jobId !== job.id || draft.rawId !== job.rawId || draft.status === 'discarded' || draft.rawSha256 !== createHash('sha256').update(raw.body).digest('hex') || draft.provider.name !== job.provider.name || draft.provider.model !== job.provider.model || draft.extraction.callCount < job.callCount) this.conflict();
      if (cp && (!cp.plan || cp.completedChunks.length !== cp.chunks.length || draft.rulesVersion !== cp.rulesVersion + '-' + cp.pipelineVersion || draft.extraction.callCount !== cp.attempts || draft.extraction.chunkCount !== cp.chunks.length || (cp.draftId && cp.draftId !== draft.id))) this.conflict();
      await this.deps.drafts.assertEvidenceStillValid(draft, raw.body);
    }
    if (pending.status === 'completed' && !draft) this.conflict();
    return draft;
  }

  private async persistSettlement(id: string, pending: PendingSettlement) {
    const job = await this.deps.jobs.get(id);
    if (!job) this.conflict();
    const draft = await this.validateSettlement(job, pending);
    let phase = 'checkpoint';
    try {
      const store = new ExtractionCheckpointStore(this.deps.root);
      // Do not re-write already saved cp bytes during a partial recovery.
      if (pending.checkpoint && (await store.get(id))?.integrity !== pending.checkpoint.integrity) pending.checkpoint = await store.save(pending.checkpoint);
      if (pending.status === 'cancelled' && draft && draft.status !== 'discarded') { phase = 'cancelled-draft'; await this.deps.drafts.discard(draft.id, undefined); }
      const state = await this.deps.rawStates.get(job.rawId);
      phase = pending.status + '-raw-state';
      const target = pending.status === 'completed' ? 'pending_confirmation' : pending.status === 'cancelled' ? state.revertStatus ?? 'unprocessed' : 'failed';
      if (state.status !== target || state.jobId !== id || (pending.status === 'completed' && state.draftId !== draft?.id) || (pending.status === 'failed' && state.lastError?.code !== pending.failure?.code)) {
        await this.deps.rawStates.set(job.rawId, { status: target, reason: pending.status === 'completed' ? '提取完成，等待人工审核' : pending.status === 'cancelled' ? 'AI 整理已取消，晚到结果不会写入草稿' : '提取失败：' + pending.failure?.code, jobId: id, ...(pending.status === 'completed' ? { draftId: draft!.id } : {}), ...(pending.status === 'failed' ? { lastError: pending.failure } : {}) });
      }
      phase = pending.status + '-job';
      const cp = pending.checkpoint;
      await this.deps.jobs.update(id, { status: pending.status, stage: pending.status === 'cancelled' ? 'done' : cp?.stage ?? job.stage, ...(pending.status === 'completed' ? { draftId: draft!.id, pagesFound: draft!.pages.length } : {}), cancelRequested: pending.status === 'cancelled' || job.cancelRequested, callCount: Math.max(job.callCount, cp?.attempts ?? draft?.extraction.callCount ?? 0), chunksDone: cp?.completedChunks.length ?? job.chunksDone, ...(cp ? { checkpoint: { stage: cp.stage, validatedChunks: cp.completedChunks.length, totalChunks: cp.chunks.length, resumable: pending.status === 'failed', attempts: cp.attempts, reusedChunks: job.checkpoint?.reusedChunks ?? 0, reason: pending.failure?.message } } : {}), error: pending.status === 'failed' ? pending.failure : undefined, finishedAt: new Date().toISOString() });
      this.pending.delete(id);
    } catch (error) { await this.retain(id, pending, error, phase); throw storageFailure(error) ?? error; }
  }

  async reconcileStorage(id: string) {
    return this.startQueue.run(async () => {
      if (this.tasks.has(id)) throw new JobError('LLM_JOB_ALREADY_RUNNING', '任务仍在运行或收尾。', 409);
      const job = await this.deps.jobs.get(id);
      if (!job) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      const pending = this.pending.get(id);
      if (!pending) return this.readJob(id);
      if (!pending.expected || fingerprint(await this.snapshot(id, pending)) !== fingerprint(pending.expected)) this.conflict();
      await this.persistSettlement(id, pending);
      return this.readJob(id);
    });
  }`);
// Guard before any Raw status based reuse branch.
s=s.replace('    const checkpoints = new ExtractionCheckpointStore(this.deps.root);',`    if ([...this.pending.values()].some(item => item.rawId === rawId && item.issue)) throw new JobError('STORAGE_RECONCILE_REQUIRED', '上次任务状态尚未保存，请先重试保存状态。', 409);
    const checkpoints = new ExtractionCheckpointStore(this.deps.root);`);
s=s.replace("      if (job && job.status === 'running') return { job, reused: true };", "      if (job && job.status === 'running' && this.tasks.has(job.id)) return { job, reused: true };\n      if (job && job.status === 'running') throw new JobError('STORAGE_RECONCILE_REQUIRED', '发现已停止的任务，请先恢复本机状态。', 409);");
const existingStart=s.indexOf('      let job = await this.deps.jobs.get(existingDraft.jobId);');const existingEnd=s.indexOf('\n    const prior =',existingStart);
s=s.slice(0,existingStart)+`      const job = await this.deps.jobs.get(existingDraft.jobId);
      if (!job) this.conflict();
      const cp = await checkpoints.get(job.id);
      const pending: PendingSettlement = { rawId, checkpoint: cp, status: 'completed', draftId: existingDraft.id };
      await this.validateSettlement(job, pending);
      if (job.status !== 'completed') {
        if (cp) pending.checkpoint = checkpoints.prepare({ ...cp, draftId: existingDraft.id, stage: 'done', lastError: undefined });
        this.pending.set(job.id, pending);
        await this.persistSettlement(job.id, pending);
      }
      return { job: (await this.deps.jobs.get(job.id))!, reused: true };
    }`+s.slice(existingEnd);
s=s.replace("    const revertStatus =", "    if (this.pending.size >= EXTRACTION_RECOVERY_CAPACITY) throw new JobError('STORAGE_RECOVERY_CAPACITY', '本进程待保存及运行中任务已达上限，请先保存状态。', 503);\n    const revertStatus =");
const startWrites=s.indexOf('    if (resume) await this.deps.jobs.update');const runStart=s.indexOf('\n  private async runKnowledge',startWrites);
s=s.slice(0,startWrites)+`    const pending: PendingSettlement = { rawId, checkpoint, status: 'failed' };
    this.pending.set(jobId, pending);
    try {
      if (resume) await this.deps.jobs.update(jobId, { status: 'running', stage: checkpoint.stage, chunksTotal: chunks.length, chunksDone: checkpoint.completedChunks.length, callCount: checkpoint.attempts, error: undefined, finishedAt: undefined, cancelRequested: false });
      else await this.deps.jobs.insert(job);
      await this.deps.rawStates.set(rawId, { status: 'processing', reason: resume ? '已验证检查点恢复提取' : 'AI 整理已启动', jobId, revertStatus });
    } catch (error) {
      pending.failure = { code: 'LLM_START_INTERRUPTED', message: '任务启动时状态保存失败，未调用模型。', at: new Date().toISOString(), retryable: true };
      await this.retain(jobId, pending, error, 'start-state');
      throw storageFailure(error) ?? error;
    }
    const task = this.runKnowledge(job, raw, provider, checkpoint, options.planningRetry === true).catch(async error => {
      await this.retain(job.id, pending, error, 'settlement');
    }).finally(() => { this.tasks.delete(job.id); });
    this.tasks.set(job.id, task);
    return { job, reused: false };
  }
`+s.slice(runStart);
const tail=s.indexOf('  private async runKnowledge');
s=s.slice(0,tail)+`  private async runKnowledge(job: ExtractionJob, raw: { id: string; title: string; bodySha256: string; body: string; sourceType: string; sourceName: string; author?: string; publishedAt?: string; url?: string; tags: string[] }, provider: LlmProvider, initial: ExtractionCheckpoint, planningRetry = false): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const secrets = provider.secrets ?? [];
    const checkpoints = new ExtractionCheckpointStore(this.deps.root);
    const pending = this.pending.get(job.id)!;
    let checkpoint = initial;
    let phase = 'pipeline';
    const progressWrites: Promise<void>[] = [];
    const saveCheckpoint = async (value: Omit<ExtractionCheckpoint, 'integrity'>) => {
      assertNoKnownSecret(value, secrets);
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
    return this.startQueue.run(async () => {
      const job = await this.deps.jobs.get(jobId);
      if (!job) throw new JobError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
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
  async reconcile(): Promise<{ interrupted: string[]; statesFixed: string[] }> {
    return this.startQueue.run(async () => {
      const interrupted: string[] = [], statesFixed: string[] = [];
      for (const job of await this.deps.jobs.list()) {
        if (this.tasks.has(job.id) || (job.status !== 'running' && (await this.deps.rawStates.get(job.rawId)).status !== 'processing')) continue;
        if (this.pending.size >= EXTRACTION_RECOVERY_CAPACITY) throw new JobError('STORAGE_RECOVERY_CAPACITY', '中断任务超过恢复容量；请先处理已登记任务再重试启动。', 503);
        const pending: PendingSettlement = { rawId: job.rawId, status: job.cancelRequested ? 'cancelled' : 'failed' };
        try {
          const cp = await new ExtractionCheckpointStore(this.deps.root).get(job.id);
          const draft = cp?.draftId ? await this.deps.drafts.get(cp.draftId) : await this.deps.drafts.findActiveForRaw(job.rawId);
          pending.checkpoint = cp; pending.draftId = draft?.id;
          if (draft && !job.cancelRequested) {
            pending.status = 'completed';
            await this.validateSettlement(job, pending);
            if (cp) pending.checkpoint = new ExtractionCheckpointStore(this.deps.root).prepare({ ...cp, draftId: draft.id, stage: 'done', lastError: undefined });
          } else {
            await this.validateSettlement(job, pending);
            const prior = cp?.lastError;
            pending.failure = prior ? { code: prior.code, message: prior.message, at: prior.at, retryable: true, ...(prior.diagnostic ? { details: prior.diagnostic } : {}) } : { code: 'LLM_INTERRUPTED', message: '上一轮任务中断，未发现完整草稿；未保存的诊断无法恢复。继续操作前请检查状态。', at: new Date().toISOString(), retryable: true };
          }
          this.pending.set(job.id, pending);
          await this.persistSettlement(job.id, pending);
          interrupted.push(job.id); statesFixed.push(job.rawId + ':' + pending.status);
        } catch (error) { await this.retain(job.id, pending, error, 'restart-validation'); }
      }
      return { interrupted, statesFixed };
    });
  }
}
`;
await fs.writeFile(file,s);
