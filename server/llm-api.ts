// B04: HTTP surface for the LLM review flow. All routes are additive; the B01–B03 routes and
// their response shapes are untouched.
import { randomUUID } from 'node:crypto';
import type express from 'express';
import type { LLMService } from '../services/llm/service.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import type { ExtractionRunner, ExtractionJobStore } from '../services/llm/jobs.ts';
import type { DraftStore } from '../services/wiki/drafts.ts';
import type { WikiCommitService } from '../services/wiki/commits.ts';
import type { RawStateStore } from '../services/raw/state.ts';
import type { RawStore } from '../services/raw/store.ts';
import type { WikiStore } from '../services/wiki/store.ts';
import { InputError } from './validation.ts';
import { validateConfirm, validateDiscard, validateDraftPatch, validateHumanReview, validateDraftQuestionReview } from './llm-validation.ts';

export type B04Deps = {
  root: string;
  rulesDir: string;
  provider: () => LlmProvider | undefined;
  llm: LLMService;
  runner: ExtractionRunner;
  jobs: ExtractionJobStore;
  drafts: DraftStore;
  commits: WikiCommitService;
  rawStates: RawStateStore;
  rawStore: RawStore;
  wikiStore: WikiStore;
};

const jobView = (job: { id: string; rawId: string; status: string; stage: string; chunksTotal: number; chunksDone: number; pagesFound: number; draftId?: string; error?: unknown; provider: { name: string; model: string }; callCount: number; startedAt: string; finishedAt?: string; cancelRequested: boolean; pipelineVersion?: string; checkpoint?: unknown; mode?: string }) => ({
  jobId: job.id, mode:job.mode??'standard', rawId: job.rawId, status: job.status, stage: job.stage,
  progress: { chunksTotal: job.chunksTotal, chunksDone: job.chunksDone, pagesFound: job.pagesFound },
  draftId: job.draftId ?? null, error: job.error ?? null, provider: job.provider,
  callCount: job.callCount, startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, cancelRequested: job.cancelRequested, pipelineVersion: job.pipelineVersion, checkpoint: job.checkpoint,
});

export function registerB04Routes(app: express.Express, deps: B04Deps): void {
  const draftRules = async () => {
    const bundle = await loadExtractionRules(deps.rulesDir);
    return {
      types: (bundle.schema.properties?.suggested_pages?.items?.properties?.type?.enum ?? []) as string[],
      categories: (bundle.schema.properties?.suggested_pages?.items?.properties?.category?.enum ?? []) as string[],
      knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [],
      confidence: bundle.fmcg.enums?.confidence ?? [],
      source_level: bundle.fmcg.enums?.source_level ?? [],
      review_status: bundle.fmcg.enums?.review_status ?? [],
    };
  };

  app.get('/api/raw-processing', async (_req, res, next) => {
    try {
      const items = await deps.rawStates.list();
      const recoveries = deps.runner.recoveryJobs();
      for (const recovery of recoveries) if (!items.some(item => item.rawId === recovery.rawId)) items.push(await deps.rawStates.get(recovery.rawId));
      res.json({ items: items.map(item => ({ ...item, recoveryJobId: recoveries.find(value => value.rawId === item.rawId)?.jobId })) });
    } catch (error) { next(error); }
  });

  app.post('/api/raw/:id/extract', async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !['restart','planningRetry','mode'].includes(key)) || (['restart','planningRetry'].some(key => key in req.body && typeof req.body[key] !== 'boolean')) || (req.body.restart === true && req.body.planningRetry === true) || (req.body.mode!==undefined&&!['standard','deep'].includes(req.body.mode)) || (req.body.mode==='deep'&&req.body.planningRetry===true)) throw new InputError('EXTRACT_REQUEST_INVALID', '提取请求只接受mode standard/deep及boolean restart/planningRetry；deep不接受planningRetry。', 400);
      // F04-08: starting an extraction takes the same resource lock as deleting the Raw, so the
      // two can never interleave into a draft for a deleted Raw.
      const result = await deps.wikiStore.withLock(() => deps.runner.start(req.params.id, { newJobId: randomUUID(), now: new Date().toISOString(), restart: req.body?.restart === true, planningRetry: req.body?.planningRetry === true, mode:req.body?.mode }));
      const runtime = await deps.runner.readJob(result.job.id);
      res.status(result.reused ? 200 : 202).json({ ...jobView(result.job), execution: runtime.execution, recovery: runtime.recovery ?? null, reused: result.reused });
    } catch (error) { next(error); }
  });

  app.get('/api/extraction-jobs/:jobId', async (req, res, next) => {
    try {
      const { job, execution, recovery } = await deps.runner.readJob(req.params.jobId);
      if (!job) throw new InputError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      res.json({ ...jobView(job), execution, recovery: recovery ?? null });
    } catch (error) { next(error); }
  });

  app.post('/api/extraction-jobs/:jobId/reconcile-storage', async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new InputError('STORAGE_RECONCILE_REQUEST_INVALID', '保存状态请求只接受空对象。', 400);
      const result = await deps.wikiStore.withLock(() => deps.runner.reconcileStorage(req.params.jobId));
      if (!result.job) throw new InputError('JOB_NOT_FOUND', '没有找到这个提取任务。', 404);
      res.json({ ...jobView(result.job), execution: result.execution, recovery: result.recovery ?? null });
    } catch (error) { next(error); }
  });

  app.post('/api/extraction-jobs/:jobId/cancel', async (req, res, next) => {
    try {
      const job = await deps.runner.cancel(req.params.jobId);
      res.json({ ...jobView(job), cancelled: job.status === 'cancelled' });
    } catch (error) { next(error); }
  });

  app.get('/api/drafts', async (req, res, next) => {
    try {
      const rawId = typeof req.query.rawId === 'string' ? req.query.rawId : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const items = (await deps.drafts.list())
        .filter(draft => (!rawId || draft.rawId === rawId) && (!status || draft.status === status))
        .map(draft => ({
          id: draft.id, rawId: draft.rawId, rawTitle: draft.rawTitle, status: draft.status, revision: draft.revision,
          createdAt: draft.createdAt, updatedAt: draft.updatedAt, jobId: draft.jobId,
          title: draft.document.title, pageCount: draft.pages.length,
          selectedCount: draft.pages.filter(page => page.selected).length,
          commitOperationId: draft.commitOperationId ?? null,
        }));
      res.json({ items });
    } catch (error) { next(error); }
  });

  /** Read-only preview of what the confirmation would do (the real check runs inside the lock). */
  const preview = async (draft: Awaited<ReturnType<DraftStore['get']>>) => {
    if (!draft) return undefined;
    const raw = await deps.rawStore.get(draft.rawId);
    const existing = await deps.wikiStore.allRecords();
    const binding = existing.filter(page => page.type === 'source' && page.sources.length === 1 && page.sources[0] === draft.rawId);
    const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim();
    const byTitle = new Map<string, { id: string; title: string }>();
    for (const page of existing) {
      byTitle.set(normalize(page.title), { id: page.id, title: page.title });
      for (const alias of page.aliases) if (!byTitle.has(normalize(alias))) byTitle.set(normalize(alias), { id: page.id, title: page.title });
    }
    const reuseSource = binding.length === 1 ? { id: binding[0].id, title: binding[0].title } : undefined;
    const conflicts: Array<{ title: string; existingId: string; existingTitle: string; kind: 'strong' | 'alias' }> = [];
    for (const title of [...draft.pages.map(page => page.title), draft.source.title]) {
      const owner = byTitle.get(normalize(title));
      if (!owner) continue;
      if (reuseSource && owner.id === reuseSource.id && normalize(title) === normalize(reuseSource.title)) continue;
      conflicts.push({ title, existingId: owner.id, existingTitle: owner.title, kind: normalize(owner.title) === normalize(title) ? 'strong' : 'alias' });
    }
    const counts = new Map<string, number>();
    for (const title of [...draft.pages.map(page => page.title), draft.source.title]) {
      const key = normalize(title);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      rawExists: Boolean(raw),
      rawSha256Matches: Boolean(raw && raw.bodySha256 === draft.rawSha256),
      sourceReuse: reuseSource ?? null,
      sourceAmbiguous: binding.length > 1 ? binding.map(page => ({ id: page.id, title: page.title })) : null,
      titleConflicts: conflicts,
      batchDuplicateTitles: [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
    };
  };

  /** F04-01: the review payload always carries the full draft, the preview and the Raw metadata. */
  const draftPayload = async (draft: NonNullable<Awaited<ReturnType<DraftStore['get']>>>) => {
    const raw = await deps.rawStore.get(draft.rawId);
    const previewValue = await preview(draft);
    const reuseTitle = previewValue?.sourceReuse?.title;
    return {
      ...deps.drafts.view(draft, { sourceTitle: reuseTitle ?? draft.source.title }),
      reviewContentDigest: draft.humanReview ? deps.drafts.contentDigest(draft) : null,
      preview: previewValue,
      raw: raw ? { id: raw.id, title: raw.title, sourceType: raw.sourceType, sourceName: raw.sourceName, author: raw.author ?? null, publishedAt: raw.publishedAt ?? null, url: raw.url ?? null, importedAt: raw.importedAt, bodySha256: raw.bodySha256 } : null,
    };
  };

  app.get('/api/drafts/:draftId', async (req, res, next) => {
    try {
      const draft = await deps.drafts.get(req.params.draftId);
      if (!draft) throw new InputError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
      res.json(await draftPayload(draft));
    } catch (error) { next(error); }
  });

  app.patch('/api/drafts/:draftId', async (req, res, next) => {
    try {
      const patch = validateDraftPatch(req.body);
      const draft = await deps.drafts.get(req.params.draftId);
      if (!draft) throw new InputError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
      const raw = await deps.rawStore.get(draft.rawId);
      if (!raw) throw new InputError('RAW_MISSING', '对应的原始资料不存在，不能编辑这份草稿。', 409);
      const updated = await deps.drafts.patch(draft.id, patch, { body: raw.body, rules: await draftRules() });
      res.json(await draftPayload(updated));
    } catch (error) { next(error); }
  });

  app.post('/api/drafts/:draftId/review/questions',async(req,res,next)=>{try{
    const input=validateDraftQuestionReview(req.body);
    const draft=await deps.drafts.get(String(req.params.draftId));if(!draft)throw new InputError('DRAFT_NOT_FOUND','草稿不存在。',404);
    const raw=await deps.rawStore.get(draft.rawId);if(!raw)throw new InputError('RAW_MISSING','原文不存在。',409);
    res.json(await draftPayload(await deps.drafts.reviewOperation(draft.id,input,{body:raw.body,rulesDir:deps.rulesDir})));
  }catch(error){next(error);}});

  for(const action of ['start','move','page'] as const) {
    const route=action==='page'?'/api/drafts/:draftId/review/pages/:pageId':`/api/drafts/:draftId/review/${action}`;
    app.post(route,async(req,res,next)=>{try{
      const input=validateHumanReview(req.body,action,String(req.params.pageId));
      const draft=await deps.drafts.get(String(req.params.draftId));if(!draft)throw new InputError('DRAFT_NOT_FOUND','草稿不存在。',404);
      const raw=await deps.rawStore.get(draft.rawId);if(!raw)throw new InputError('RAW_MISSING','原文不存在。',409);
      res.json(await draftPayload(await deps.drafts.reviewOperation(draft.id,input,{body:raw.body,rulesDir:deps.rulesDir})));
    }catch(error){next(error);}});
  }

  app.post('/api/drafts/:draftId/discard', async (req, res, next) => {
    try {
      const { baseRevision } = validateDiscard(req.body);
      const draft = await deps.drafts.get(req.params.draftId);
      if (!draft) throw new InputError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
      const discarded = await deps.drafts.discard(draft.id, baseRevision);
      const state = await deps.rawStates.get(discarded.rawId);
      await deps.rawStates.set(discarded.rawId, { status: state.revertStatus ?? 'unprocessed', reason: '用户放弃了待审核草稿', draftId: discarded.id });
      res.json({ id: discarded.id, status: discarded.status, rawId: discarded.rawId });
    } catch (error) { next(error); }
  });

  app.post('/api/drafts/:draftId/confirm', async (req, res, next) => {
    try {
      const input = validateConfirm(req.body);
      // Confirmation never calls the model: it only writes the frozen, user-confirmed snapshot.
      const result = await deps.wikiStore.withLock(() => deps.commits.confirm({
        draftId: req.params.draftId, baseRevision: input.baseRevision, selectedPageIds: input.selectedPageIds,
        idempotencyKey: input.idempotencyKey, operationId: randomUUID(), now: new Date().toISOString(),
      }));
      const manifest = result.manifest;
      res.status(manifest.status === 'completed' ? 201 : 202).json({
        operationId: manifest.operationId, status: manifest.status, reused: result.reused, sourceReused: result.sourceReused,
        sourceId: manifest.snapshot.sourceRecord?.id ?? manifest.snapshot.reuseSourceId ?? null,
        wikiIds: manifest.snapshot.pageRecords.map(record => record.id),
        sourceReuseId: manifest.snapshot.reuseSourceId ?? null,
        writtenWikiIds: manifest.writtenWikiIds, phases: manifest.phases, warnings: manifest.snapshot.warnings,
      });
    } catch (error) { next(error); }
  });

  app.get('/api/wiki-commits/:operationId', async (req, res, next) => {
    try {
      const manifest = await deps.commits.status(req.params.operationId);
      if (!manifest) throw new InputError('COMMIT_NOT_FOUND', '没有找到这个提交操作。', 404);
      res.json({
        operationId: manifest.operationId, draftId: manifest.draftId, rawId: manifest.rawId, status: manifest.status,
        createdAt: manifest.createdAt, updatedAt: manifest.updatedAt, completedAt: manifest.completedAt ?? null,
        phases: manifest.phases, writtenWikiIds: manifest.writtenWikiIds,
        sourceId: manifest.snapshot.sourceRecord?.id ?? manifest.snapshot.reuseSourceId ?? null,
        wikiIds: manifest.snapshot.pageRecords.map(record => record.id),
        selectedPageIds: manifest.snapshot.selectedPageIds,
        error: manifest.error ?? null, recoveryHint: manifest.recoveryHint ?? null, warnings: manifest.snapshot.warnings,
      });
    } catch (error) { next(error); }
  });
}


