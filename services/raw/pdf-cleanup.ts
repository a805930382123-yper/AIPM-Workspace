import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readJsonRecord, SerialQueue, writeFileAtomic, writeJsonAtomic } from '../storage/files.ts';
import { pdfPageUnits } from '../wiki/pdf-input.ts';
import {
  VERSION,
  LONG_REVISION,
  DIRECTORY_REVISION,
  LONG_REPORT_UNITS,
  PROMPT_REVISION,
  FRAGMENT_REVISION,
  PRESENTATION_REVISION,
  type Range,
  type Job,
  completedBlocks,
  cleanupFingerprint,
  type CleanupInput,
  isObject,
  wireUnit,
  activeStatus,
  CleanupError,
  type PdfCleanupDeps,
  pdfCleanupFile,
  assertCleanupBasis,
} from './pdf-cleanup-types.ts';
import { validJob } from './pdf-cleanup-schemas.ts';
import { batchesFor, validateBatch, decisionsFor, displayFor } from './pdf-cleanup-planner.ts';
import { runPdfCleanupJob } from './pdf-cleanup-runner.ts';
import { createPdfCleanupDraft } from './pdf-cleanup-draft.ts';

export class PdfCleanupService {
  private readonly queue = new SerialQueue();

  private readonly active = new Map<string, AbortController>();

  constructor(private readonly deps: PdfCleanupDeps) {}

  private file(rawId: string, range?: Range) {
    return pdfCleanupFile(this.deps.root, rawId, range);
  }

  isRunning(rawId: string) {
    return this.active.has(rawId);
  }

  private selected(rawId: string) {
    return readJsonRecord(
      this.deps.root,
      this.file(rawId),
      (value): value is Range =>
        isObject(value) && Number.isSafeInteger(value.startPage) && Number.isSafeInteger(value.endPage),
    );
  }

  private job(rawId: string, range: Range) {
    return readJsonRecord(this.deps.root, this.file(rawId, range), validJob);
  }

  private save(rawId: string, job: Job) {
    return writeJsonAtomic(this.file(rawId, job.binding), job);
  }

  async get(rawId: string) {
    const pdf = await this.deps.pdf.get(rawId);
    const completedPages = pdf.pages.filter((page) => page.status === 'completed').map((page) => page.page);
    const range = await this.selected(rawId);
    let job = range && (await this.job(rawId, range));
    if (!range || !job) return { rawId, pageCount: pdf.pageCount, completedPages, job: null };
    const input = await this.deps.pdf.cleanupInput(rawId, range.startPage, range.endPage);
    const needsLatest = activeStatus(job.status) && !this.active.has(rawId);
    if (needsLatest) job = (await this.job(rawId, range)) ?? job;
    this.assertBasis(input, job);
    const sourceUnits = pdfPageUnits(input);
    const units = sourceUnits.map(wireUnit);
    const decisions = decisionsFor(job, units);
    const display = job.fragments === undefined ? undefined : displayFor(job, units);
    const textStarts = new Map(
      sourceUnits.flatMap((unit) => (unit.kind === 'text' ? [[unit.unitId, unit.start] as const] : [])),
    );
    const counts = { kept: 0, merged: 0, skipped: 0 };
    const topics = new Map<string, number>();
    for (const item of decisions) {
      if (item.decision === 'skip') counts.skipped++;
      else {
        if (item.decision === 'keep') counts.kept++;
        else counts.merged++;
        if (!display) topics.set(item.topic!, (topics.get(item.topic!) ?? 0) + 1);
      }
    }
    for (const item of display?.items ?? []) {
      if (item.decision !== 'skip') topics.set(item.topic!, (topics.get(item.topic!) ?? 0) + 1);
    }
    const interrupted = needsLatest && activeStatus(job.status) && !this.active.has(rawId);
    const draft = job.draftId ? await this.deps.drafts.get(job.draftId) : undefined;
    return {
      rawId,
      pageCount: pdf.pageCount,
      completedPages,
      job: {
        startPage: range.startPage,
        endPage: range.endPage,
        status: interrupted ? ('failed' as const) : job.status,
        stage: job.stage,
        promptRevision: job.promptRevision ?? 1,
        attempts: job.attempts,
        completedBatches: job.batches.length,
        totalBatches: job.totalBatches,
        reusedCleanupBatches: job.reusedCleanupBatches,
        reusedIndexEntries: job.reusedIndexEntries,
        error: interrupted
          ? { code: 'PDF_CLEANUP_INTERRUPTED', message: '上次整理中断。已保存的批次仍保留，请显式继续。' }
          : job.error,
        draftId: draft?.id,
        draftStatus: draft?.status,
        canRegenerate: !!draft?.discardedAt,
        counts,
        decisions,
        topics: [...topics].map(([title, unitCount]) => ({ title, unitCount })),
        presentation: job.presentation,
        writing: job.writing,
        fragments: display?.items.flatMap(({ id, unitId, start, end, topic, text, origin }) => {
          if (!unitId) return [];
          const offset = textStarts.get(unitId);
          return [
            {
              id,
              unitId,
              start,
              end,
              topic,
              text,
              origin,
              ...(offset === undefined ? {} : { rawStart: offset + start!, rawEnd: offset + end! }),
            },
          ];
        }),
      },
    };
  }

  private assertBasis(input: CleanupInput, job: Job) {
    assertCleanupBasis(input, job);
  }

  async start(rawId: string, range: Range) {
    await this.queue.run(async () => {
      const input = await this.deps.pdf.cleanupInput(rawId, range.startPage, range.endPage);
      const current = await this.selected(rawId);
      const sameRange = current?.startPage === range.startPage && current.endPage === range.endPage;
      if (this.active.has(rawId)) {
        if (!sameRange) throw new CleanupError('PDF_CLEANUP_BUSY', '请先完成或取消正在整理的页范围。');
        return;
      }
      const prior = await this.job(rawId, range);
      const activeDraft = await this.deps.drafts.findActiveForRaw(rawId);
      const units = pdfPageUnits(input);
      const longReport = units.length >= LONG_REPORT_UNITS;
      const upgradeLong =
        longReport &&
        !activeDraft &&
        prior?.promptRevision === PROMPT_REVISION &&
        prior.stage === 'cleaning' &&
        !prior.index.length &&
        !prior.writing &&
        !prior.fragments &&
        !prior.draftId
          ? prior
          : undefined;
      const upgradeDirectory =
        !activeDraft &&
        prior?.promptRevision === LONG_REVISION &&
        prior.status !== 'completed' &&
        prior.batches.length === prior.totalBatches &&
        !prior.writing &&
        !prior.draftId
          ? prior
          : undefined;
      const upgrade = upgradeDirectory ?? upgradeLong;
      const existing =
        !upgrade &&
        (prior?.promptRevision === DIRECTORY_REVISION ||
          prior?.promptRevision === LONG_REVISION ||
          prior?.promptRevision === PROMPT_REVISION ||
          (prior?.promptRevision === FRAGMENT_REVISION && prior.status !== 'completed'))
          ? prior
          : undefined;
      if (activeDraft && (!sameRange || !activeDraft.pdfInput || !existing)) {
        throw new CleanupError('PDF_DRAFT_ACTIVE', '请先完成或结束本资料的待审核草稿。');
      }
      if (prior) this.assertBasis(input, prior);
      if (existing) {
        if (existing.status === 'completed') {
          if (!sameRange) await writeJsonAtomic(this.file(rawId), range);
          return;
        }
      }
      const provider = await this.deps.provider();
      if (!provider) throw new CleanupError('LLM_NOT_CONFIGURED', '尚未配置用于 PDF 内容整理的模型。', 400);
      const identity = createHash('sha256')
        .update(JSON.stringify([provider.name, provider.model, provider.cacheIdentity]))
        .digest('hex');
      const previous = existing ?? upgrade;
      const batches = batchesFor(units.map(wireUnit));
      if (previous && previous.totalBatches !== batches.length)
        throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '批次划分已变化，不能继续旧检查点。');
      const reusable =
        upgrade?.batches ??
        ((prior?.promptRevision === PRESENTATION_REVISION || prior?.promptRevision === FRAGMENT_REVISION) &&
        prior.status === 'completed' &&
        prior.batches.length === batches.length
          ? prior.batches
          : undefined);
      const reuseIndex = reusable && !upgrade && prior?.promptRevision === FRAGMENT_REVISION ? prior : undefined;
      const job: Job = existing ?? {
        version: VERSION,
        promptRevision:
          upgradeDirectory || (!prior && longReport)
            ? DIRECTORY_REVISION
            : upgradeLong
              ? LONG_REVISION
              : PROMPT_REVISION,
        binding: input.binding,
        provider: { name: provider.name, model: provider.model },
        identity,
        status: 'queued',
        stage: 'cleaning',
        attempts: upgrade?.attempts ?? 0,
        totalBatches: batches.length,
        batches: reusable ?? [],
        index: [],
        ...(reusable ? { reusedCleanupBatches: reusable.length } : {}),
        ...(reuseIndex
          ? { index: reuseIndex.index, fragments: reuseIndex.fragments, reusedIndexEntries: reuseIndex.index.length }
          : {}),
      };
      job.taskFingerprint ??= cleanupFingerprint(job);
      if (!existing && reusable && prior?.completedModels)
        job.completedModels = Object.fromEntries(
          completedBlocks(job).flatMap((block) => {
            const models = prior.completedModels?.[block];
            return models ? [[block, models]] : [];
          }),
        );
      for (const [index, batch] of job.batches.entries()) validateBatch(batches[index], batch);
      if (prior && !existing) {
        const currentFile = this.file(rawId, range);
        const archiveFile = currentFile.replace(/\.json$/u, '-prompt-v' + (prior.promptRevision ?? 1) + '.json');
        const bytes = await readFile(currentFile);
        const archived = await readFile(archiveFile).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
        if (archived && !archived.equals(bytes)) {
          throw new CleanupError('PDF_CLEANUP_HISTORY_CONFLICT', '旧整理检查点与归档不一致，已保留两份记录。');
        }
        if (!archived) await writeFileAtomic(archiveFile, bytes);
      }
      job.status = 'queued';
      delete job.error;
      await this.save(rawId, job);
      if (!sameRange) await writeJsonAtomic(this.file(rawId), range);
      const controller = new AbortController();
      this.active.set(rawId, controller);
      void runPdfCleanupJob(
        {
          deps: this.deps,
          queue: this.queue,
          save: (id, value) => this.save(id, value),
          assertBasis: (input, value) => this.assertBasis(input, value),
        },
        input,
        job,
        batches,
        provider,
        controller,
      )
        .finally(() => {
          if (this.active.get(rawId) === controller) this.active.delete(rawId);
        })
        .catch(() => {
          /* the persisted job remains recoverable as interrupted */
        });
    });
    return this.get(rawId);
  }

  async cancel(rawId: string) {
    if (!/^[a-f0-9-]{36}$/iu.test(rawId)) throw new CleanupError('RAW_NOT_FOUND', '没有找到这条原始资料。', 404);
    await this.queue.run(async () => {
      const range = await this.selected(rawId);
      const job = range && (await this.job(rawId, range));
      if (!job || !activeStatus(job.status)) return;
      this.active.get(rawId)?.abort();
      job.status = 'cancelled';
      job.error = { code: 'PDF_CLEANUP_CANCELLED', message: '整理已取消，已完成批次仍保留。' };
      await this.save(rawId, job);
    });
    return this.get(rawId);
  }

  async draft(rawId: string, range: Range) {
    return createPdfCleanupDraft(
      {
        deps: this.deps,
        queue: this.queue,
        active: this.active,
        file: (id, selectedRange) => this.file(id, selectedRange),
        selected: (id) => this.selected(id),
        job: (id, selectedRange) => this.job(id, selectedRange),
        save: (id, value) => this.save(id, value),
        assertBasis: (input, value) => this.assertBasis(input, value),
        get: (id) => this.get(id),
      },
      rawId,
      range,
    );
  }
}
