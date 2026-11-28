import { randomUUID } from 'node:crypto';
import { summarizeCompletedModels } from '../llm/checkpoint-models.ts';
import { retrieveKnowledgeContextDetailed } from '../llm/knowledge-maintenance.ts';
import { assertWikiSourcesAllowed } from '../wiki/source-lineage.ts';
import { assertNoKnownSecret } from '../llm/provider.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { writeJsonAtomic } from '../storage/files.ts';
import type { DraftPage, DraftRecord } from '../wiki/drafts.ts';
import type { KnowledgeChange } from '../wiki/maintenance.ts';
import { pdfPageUnits, type PdfEvidence, type PdfUnit } from '../wiki/pdf-input.ts';
import { renderPdfTopic } from '../wiki/render.ts';
import type { RawStateStore } from './state.ts';
import {
  adjacentPdfTextLines,
  confirmedPdfPageLabels,
  pdfWritingLayout,
  readWriting,
  writtenBlocks,
} from './pdf-topic-writing.ts';
import {
  LONG_REVISION,
  DIRECTORY_REVISION,
  PROMPT_REVISION,
  FRAGMENT_REVISION,
  PRESENTATION_REVISION,
  type Range,
  completedBlocks,
  nameKey,
  wireUnit,
  CleanupError,
  type PdfCleanupContext,
  type PdfCleanupRunnerContext,
} from './pdf-cleanup-types.ts';
import {
  batchesFor,
  validateBatch,
  decisionsFor,
  writingPlan,
  displayFor,
  presentationBatches,
  verifyPresentation,
} from './pdf-cleanup-planner.ts';

export async function createPdfCleanupDraft<Result>(ctx: PdfCleanupContext<Result>, rawId: string, range: Range) {
  const readBasis = async () => {
    const input = await ctx.deps.pdf.cleanupInput(rawId, range.startPage, range.endPage);
    const job = await ctx.job(rawId, range);
    if (job?.status !== 'completed') throw new CleanupError('PDF_CLEANUP_NOT_COMPLETE', '请先完成此页范围的内容整理。');
    ctx.assertBasis(input, job);
    const selected = await ctx.selected(rawId);
    if (selected?.startPage !== range.startPage || selected.endPage !== range.endPage) {
      throw new CleanupError('PDF_RANGE_NOT_SELECTED', '请先在 PDF 面板选择要生成草稿的已整理范围。');
    }
    const existing = job.draftId && (await ctx.deps.drafts.get(job.draftId));
    const state = await ctx.deps.rawStates.get(rawId);
    if (existing && !existing.discardedAt) {
      if (existing.status === 'pending_confirmation' && state.draftId !== existing.id) {
        if (state.status === 'processing' || state.status === 'pending_confirmation')
          throw new CleanupError('PDF_DRAFT_ACTIVE', '请先完成本资料的其他整理。');
        await bindPdfDraft(ctx, rawId, existing, state);
      }
      return;
    }
    if (ctx.active.has(rawId) || state.status === 'processing' || (await ctx.deps.drafts.findActiveForRaw(rawId))) {
      throw new CleanupError('PDF_DRAFT_ACTIVE', '请先完成本资料正在进行的整理或待审核草稿。');
    }
    return { input, job, existing, state };
  };
  const prepared = await ctx.deps.wiki.withLock(() =>
    ctx.queue.run(async () => {
      const basis = await readBasis();
      if (!basis) return;
      const { input, job } = basis;
      const units = pdfPageUnits(input);
      const batches = batchesFor(units.map(wireUnit));
      if (batches.length !== job.batches.length)
        throw new CleanupError('PDF_CLEANUP_COVERAGE', '清理记录未覆盖当前页单元。');
      for (const [index, batch] of job.batches.entries()) validateBatch(batches[index], batch);
      const revision = job.promptRevision ?? 1;
      const topicEvidence = revision === DIRECTORY_REVISION;
      const decisions =
        revision >= FRAGMENT_REVISION && revision < LONG_REVISION
          ? displayFor(job, units.map(wireUnit)).items
          : decisionsFor(job, units.map(wireUnit));
      let written: ReturnType<typeof writtenBlocks> | undefined;
      if (revision >= PROMPT_REVISION) {
        const { requests, members } = writingPlan(job, decisions);
        if (job.writing?.length !== requests.length)
          throw new CleanupError('PDF_CLEANUP_NOT_COMPLETE', '请先完成此页范围的主题写作。');
        const pageLabels = confirmedPdfPageLabels(decisions);
        const layout = revision >= LONG_REVISION ? pdfWritingLayout(decisions) : undefined;
        const nextTextLine = adjacentPdfTextLines(units, input.raw.body);
        const results = job.writing.map((result, index) =>
          readWriting(requests[index], result, undefined, pageLabels, nextTextLine, members, layout, topicEvidence),
        );
        written = writtenBlocks(requests, results, members, topicEvidence);
      } else if (revision >= PRESENTATION_REVISION) verifyPresentation(job, presentationBatches(decisions), true);
      const catalog = new Map(units.map((unit) => [unit.unitId, unit]));
      const grouped = new Map<string, typeof decisions>();
      for (const decision of decisions) {
        if (decision.decision === 'skip') continue;
        const group = grouped.get(decision.topic!) ?? [];
        group.push(decision);
        grouped.set(decision.topic!, group);
      }
      if (written)
        for (const [title, group] of grouped) {
          if (
            !topicEvidence &&
            !written.get(title)?.length &&
            !group.some((item) => item.table || item.kind === 'inference' || item.kind === 'question')
          )
            grouped.delete(title);
        }
      if (!grouped.size) throw new CleanupError('PDF_CLEANUP_NO_CONTENT', '此范围没有可写入知识草稿的实质内容。', 422);
      return { job, catalog, grouped, written, topicEvidence };
    }),
  );
  if (!prepared) return ctx.get(rawId);
  const { job: snapshot, catalog, grouped, written, topicEvidence } = prepared;
  const queries = [...grouped.keys()].map((title) => ({ title, content: '', tags: [] }));
  const { records: context } = await retrieveKnowledgeContextDetailed(ctx.deps.wiki, ctx.deps.raws, queries, {
    authorizeQuery: async () => {
      assertRawNotMeeting(await ctx.deps.raws.get(rawId));
      ctx.assertBasis(await ctx.deps.pdf.cleanupInput(rawId, range.startPage, range.endPage), snapshot);
      assertNoKnownSecret(queries, (await ctx.deps.provider())?.secrets);
    },
  });
  await ctx.deps.wiki.withLock(() =>
    ctx.queue.run(async () => {
      const basis = await readBasis();
      if (!basis) return;
      const { input, job, existing, state } = basis;
      if (JSON.stringify(job) !== JSON.stringify(snapshot))
        throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '整理记录已变化，请重新生成草稿。', 409);
      for (const page of context) {
        const current = await ctx.deps.wiki.get(page.id);
        if (!current || JSON.stringify(current) !== JSON.stringify(page))
          throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '关联 Wiki 已变化，请重新生成草稿。', 409);
        await assertWikiSourcesAllowed(ctx.deps.wiki, ctx.deps.raws, current);
      }
      const pages: Array<Omit<DraftPage, 'pageId' | 'selected'>> = [];
      const changes: KnowledgeChange[] = [];
      for (const [title, group] of grouped) {
        const old = context.find((page) => nameKey(page.title) === nameKey(title));
        const material = [...new Set(group.map((item) => item.unitId ?? item.id))].map((id) => catalog.get(id)!);
        const kept = group.filter((item) => item.decision === 'keep');
        const blocks = written && (written.get(title) ?? []);
        const included = !topicEvidence && blocks && new Set(blocks.flatMap((block) => block.sourceIds));
        const topicBody = renderPdfTopic(
          rawId,
          group,
          job.presentation?.groups,
          topicEvidence && !blocks?.length ? undefined : blocks,
          topicEvidence,
        );
        const body = old ? old.body.trimEnd() + '\n\n## 本次 PDF 整理\n\n' + topicBody : topicBody;
        if (body.length > 100000)
          throw new CleanupError(
            'PDF_CLEANUP_TOPIC_TOO_LARGE',
            '单主题证据超出现有候选正文容量，请选择较小页范围。',
            422,
          );
        const evidence = material.map(
          (unit) => Object.fromEntries(Object.entries(unit).filter(([key]) => key !== 'section')) as PdfEvidence,
        );
        const textItems = material.filter((unit): unit is PdfUnit & { kind: 'text' } => unit.kind === 'text');
        const category = old?.category ?? 'other';
        const type = old?.type ?? 'concept';
        pages.push({
          title,
          type,
          category,
          one_line_definition: title,
          source_facts: kept
            .filter((item) => item.origin === 'text' && (!included || item.table || included.has(item.id)))
            .map((item) => ({ text: item.text, evidenceIds: [item.unitId ?? item.id] })),
          source_evidence: textItems.map((item) => ({
            id: item.unitId,
            rawId,
            quote: item.text,
            start: item.start,
            end: item.end,
            chunkIndex: item.page - 1,
          })),
          pdfEvidence: evidence,
          ai_organized: [],
          ai_inferences: [],
          related_pages: [],
          open_questions: [],
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'D',
          provenance: [],
        });
        const index = pages.length - 1;
        changes.push({
          changeId: 'change-' + index,
          pageIndex: index,
          pageIndexes: [index],
          action: old ? 'update' : 'create',
          ...(old ? { targetWikiId: old.id, baseRevision: old.revision } : {}),
          candidate: {
            title: old?.title ?? title,
            type,
            category,
            body,
            aliases: old?.aliases ?? [],
            tags: old?.tags ?? [],
            sources: [...new Set([...(old?.sources ?? []), rawId])],
            knowledge_status: old?.knowledge_status ?? 'ai_organized',
            confidence: old?.confidence ?? 'medium',
            source_level: old?.source_level ?? 'D',
          },
          reason: old ? '保留现有主题正文，并补充本次 PDF 的依据。' : '根据本次 PDF 页范围的保留材料新增主题。',
          summary: ['合计 ' + material.length + ' 条页证据。'],
          questions: [],
          dependsOn: [],
          decision: 'defer',
        });
      }
      job.draftId = !existing && job.draftId ? job.draftId : randomUUID();
      await ctx.save(rawId, job);
      await writeJsonAtomic(ctx.file(rawId), range);
      const draft = await ctx.deps.drafts.createPdf({
        id: job.draftId,
        raw: input.raw,
        binding: input.binding,
        pages,
        maintenance: { version: 1, context, changes },
        provider: job.provider,
        modelProvenance: summarizeCompletedModels([
          { models: input.completedModels, blocks: input.pages.map(({ page }) => `page-${page}`) },
          { models: job.completedModels, blocks: completedBlocks(job) },
        ]),
        callCount: job.attempts,
        batchCount: job.totalBatches,
      });
      await bindPdfDraft(ctx, rawId, draft, state);
    }),
  );
  return ctx.get(rawId);
}

export function bindPdfDraft(
  ctx: PdfCleanupRunnerContext,
  rawId: string,
  draft: DraftRecord,
  state: Awaited<ReturnType<RawStateStore['get']>>,
) {
  return ctx.deps.rawStates.set(rawId, {
    status: 'pending_confirmation',
    reason: 'PDF 页整理已生成待审核草稿。',
    draftId: draft.id,
    jobId: draft.jobId,
    revertStatus: state.status === 'generated' ? 'generated' : 'unprocessed',
  });
}
