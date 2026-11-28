import { captureTemplateFields, validInputTemplateFields, type InputTemplateFields } from './template-fields.ts';
import { WikiError, type SourceLevel } from './store.ts';
import { DraftStore, type DraftRecord, type DraftPage } from './drafts.ts';
import {
  assertHumanReviewed,
  assertReviewSources,
  assertReviewStructure,
  candidateContent,
  confirmHumanPage,
  moveHumanUnits,
  newHumanReview,
  type HumanReview,
  type ReviewUnit,
} from './human-review.ts';
import { type KnowledgeWorkflow, type WorkflowContext, sha } from './workflow-types.ts';
import { validateForConfirm, getRawSnapshot } from './workflow-evidence.ts';

export function workflowReview(record: KnowledgeWorkflow, inherited: ReviewUnit[] = []): HumanReview {
  const units: ReviewUnit[] = structuredClone(inherited);
  for (const section of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] as const)
    record.sections[section].forEach((text, i) => {
      const evidence = (record.evidence ?? []).filter((e) => e.section === section)[i];
      units.push({
        id: `proposal-${record.id}-${section}-${i + 1}`,
        kind: 'proposal',
        origin: 'model',
        text,
        memberIds: [],
        records: [],
        section,
        evidence: evidence ? [{ ...evidence, id: `proposal-evidence-${section}-${i + 1}`, chunkIndex: -1 }] : [],
        sourceLabel:
          section === 'inferences'
            ? '模型推断'
            : section === 'openQuestions'
              ? '待确认问题'
              : evidence
                ? '模型整理（有原文定位，须人工核对）'
                : '模型整理（无原文定位）',
      });
    });
  return newHumanReview(units, Object.fromEntries(units.map((u) => [u.id, record.id])));
}

export async function assertInput(ctx: WorkflowContext, record: KnowledgeWorkflow): Promise<void> {
  if (record.kind !== 'update') return;
  if (!record.inputDraft && record.reviewProtocolVersion === 1 && record.legacyStandaloneInput) {
    const legacy = record.legacyStandaloneInput;
    if (
      legacy.version !== 1 ||
      legacy.source !== 'stored_workflow' ||
      legacy.targetWikiId !== record.targetWikiId ||
      legacy.targetBaseRevision !== record.baseRevision ||
      JSON.stringify(legacy.rawSnapshots) !== JSON.stringify(record.rawSnapshots)
    )
      throw new WikiError('INPUT_REVIEW_CHANGED', '旧更新的来源快照或目标绑定已变化。', 409);
    const target = await ctx.wiki.get(record.targetWikiId!);
    if (
      !target ||
      JSON.stringify([...new Set([...target.sources, ...record.rawSnapshots.map((r) => r.id)])].sort()) !==
        JSON.stringify([...record.sources].sort())
    )
      throw new WikiError('INPUT_REVIEW_CHANGED', '旧更新来源集合与真实目标/Raw不一致。', 409);
    return;
  }
  if (!record.inputDraft?.reviewContentDigest)
    throw new WikiError('INPUT_REVIEW_REQUIRED', '旧更新预览需重新绑定已完成审查的输入草稿。请开始本预览审查。', 409);
  const store = new DraftStore(ctx.root),
    draft = await store.get(record.inputDraft.draftId);
  const raw = draft ? await ctx.raws.get(draft.rawId) : undefined;
  if (
    !draft ||
    !raw ||
    draft.revision !== record.inputDraft.revision ||
    (await store.assertReviewed(draft, raw.body)) !== record.inputDraft.reviewContentDigest ||
    !draft.pages.some((p) => p.pageId === record.inputDraft!.pageId)
  )
    throw new WikiError('INPUT_REVIEW_CHANGED', '更新输入的完整草稿已变化或撤销审查；请重新生成预览。', 409);
  const snapshot = templateSnapshot(
    draft,
    draft.pages.find((page) => page.pageId === record.inputDraft!.pageId)!,
  );
  if (JSON.stringify(snapshot) !== JSON.stringify(record.inputTemplateFields))
    throw new WikiError('INPUT_REVIEW_CHANGED', '更新字段快照与已审输入不一致，请重新生成预览。', 409);
}

export function templateSnapshot(draft: DraftRecord, page: DraftPage): InputTemplateFields | undefined {
  const snapshot = captureTemplateFields(page, draft.rawId, draft.humanReview!);
  if (!snapshot) return undefined;
  if (!validInputTemplateFields(snapshot))
    throw new WikiError('TEMPLATE_INPUT_INVALID', '字段快照引用不属于选中页的事实和证据，未生成更新。', 409);
  return snapshot;
}

export async function assertReviewed(ctx: WorkflowContext, record: KnowledgeWorkflow): Promise<string> {
  assertReviewStructure(record.humanReview, [record.id]);
  const raws = await Promise.all(record.rawSnapshots.map((s) => getRawSnapshot(ctx, s.id)));
  if (raws.some((r) => !r)) throw new WikiError('RAW_CHANGED', '来源缺失。', 409);
  assertReviewSources(record.humanReview, raws as NonNullable<(typeof raws)[number]>[]);
  for (const snapshot of record.rawSnapshots)
    if (!raws.some((r) => r?.id === snapshot.id && r.bodySha256 === snapshot.bodySha256))
      throw new WikiError('RAW_CHANGED', '来源版本已变化。', 409);
  await assertInput(ctx, record);
  const digest = ctx.contentDigest(record);
  assertHumanReviewed(record.humanReview, [record.id], digest);
  return digest;
}

export async function reviewOperation(
  ctx: WorkflowContext,
  id: string,
  input: {
    baseRevision: number;
    action: 'start' | 'move' | 'page';
    unitIds?: string[];
    pageId?: string | null;
    reviewContentDigest?: string;
    confirmed?: boolean;
  },
): Promise<KnowledgeWorkflow> {
  return ctx.queue.run(async () => {
    const record = await ctx.get(id);
    if (!record) throw new WikiError('WORKFLOW_NOT_FOUND', '知识预览不存在。', 404);
    if (record.status !== 'pending_confirmation' || record.revision !== input.baseRevision)
      throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识预览状态或版本已变化，请刷新。', 409);
    const before = JSON.stringify(record);
    if (input.action === 'start' && !record.humanReview) {
      let inherited: ReviewUnit[] = [];
      if (record.kind === 'update' && !record.inputDraft) {
        if (record.reviewProtocolVersion !== undefined)
          throw new WikiError('INPUT_REVIEW_REQUIRED', '新版更新输入绑定缺失，不得降级为旧工作流。', 409);
        await validateForConfirm(ctx, record);
        const target = await ctx.wiki.get(record.targetWikiId!);
        if (!target || target.revision !== record.baseRevision)
          throw new WikiError('REVISION_CONFLICT', '旧工作流的目标版本已变化，请重新生成预览。', 409);
        if (
          JSON.stringify([...new Set([...target.sources, ...record.rawSnapshots.map((r) => r.id)])].sort()) !==
          JSON.stringify([...record.sources].sort())
        )
          throw new WikiError('INPUT_REVIEW_CHANGED', '旧工作流的来源集合不匹配。', 409);
        record.legacyStandaloneInput = {
          version: 1,
          source: 'stored_workflow',
          rawSnapshots: structuredClone(record.rawSnapshots),
          targetWikiId: target.id,
          targetBaseRevision: target.revision,
          snapshotDigest: sha(JSON.stringify(candidateContent(record))),
        };
      }
      if (record.kind === 'update' && record.inputDraft) {
        const drafts = new DraftStore(ctx.root),
          draft = await drafts.get(record.inputDraft.draftId),
          raw = draft ? await ctx.raws.get(draft.rawId) : undefined;
        if (!draft || !raw) throw new WikiError('INPUT_REVIEW_REQUIRED', '输入草稿或来源缺失。', 409);
        const digest = await drafts.assertReviewed(draft, raw.body);
        const page = draft.pages.find((p) => p.pageId === record.inputDraft!.pageId);
        if (
          !page ||
          record.sections.newSource !== raw.body ||
          (record.evidence ?? []).some(
            (e) => !page.source_evidence.some((p) => p.rawId === e.rawId && p.start <= e.start && p.end >= e.end),
          )
        )
          throw new WikiError(
            'INPUT_REVIEW_CHANGED',
            '旧更新预览来源无法与当前输入页严格匹配；请从已审草稿重新生成预览。',
            409,
          );
        record.inputDraft = { ...record.inputDraft, revision: draft.revision, reviewContentDigest: digest };
        inherited = draft.humanReview!.units.filter((u) => draft.humanReview!.assignments[u.id] === page.pageId);
      }
      record.humanReview = workflowReview(record, inherited);
      record.reviewProtocolVersion = 1;
    }
    assertReviewStructure(record.humanReview, [record.id]);
    const raws = await Promise.all(record.rawSnapshots.map((s) => getRawSnapshot(ctx, s.id)));
    if (raws.some((r) => !r)) throw new WikiError('RAW_CHANGED', '来源缺失。', 409);
    assertReviewSources(record.humanReview, raws as NonNullable<(typeof raws)[number]>[]);
    if (input.action === 'move') moveHumanUnits(record.humanReview, [record.id], input.unitIds!, input.pageId!);
    if (input.action === 'page') {
      await assertInput(ctx, record);
      confirmHumanPage(
        record.humanReview,
        [record.id],
        { pageId: input.pageId!, reviewContentDigest: input.reviewContentDigest!, confirmed: input.confirmed! },
        ctx.contentDigest(record),
      );
    }
    if (JSON.stringify(record) === before) return record;
    record.revision++;
    record.updatedAt = new Date().toISOString();
    return ctx.save(record);
  });
}

export async function patch(
  ctx: WorkflowContext,
  id: string,
  baseRevision: number,
  sections: KnowledgeWorkflow['sections'],
  title?: string,
  sourceLevel?: unknown,
) {
  return ctx.queue.run(() => patchLocked(ctx, id, baseRevision, sections, title, sourceLevel));
}

export async function patchLocked(
  ctx: WorkflowContext,
  id: string,
  baseRevision: number,
  sections: KnowledgeWorkflow['sections'],
  title?: string,
  sourceLevel?: unknown,
) {
  const workflow = await ctx.get(id);
  if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
  if (workflow.status !== 'pending_confirmation')
    throw new WikiError('WORKFLOW_NOT_EDITABLE', '知识草稿不在可编辑状态。', 409);
  if (workflow.revision !== baseRevision)
    throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识草稿已被修改，请刷新后再编辑。', 409, {
      currentRevision: workflow.revision,
    });
  if (
    sections.sourceList.length !== workflow.sections.sourceList.length ||
    sections.sourceList.some((source, index) => {
      const previous = workflow.sections.sourceList[index];
      return (
        source.id !== previous.id ||
        source.title !== previous.title ||
        source.existingSourceId !== previous.existingSourceId ||
        (previous.existingSourceId && source.source_level !== previous.source_level)
      );
    }) ||
    sections.existing !== workflow.sections.existing ||
    sections.newSource !== workflow.sections.newSource
  ) {
    throw new WikiError('WORKFLOW_SOURCE_IMMUTABLE', '来源清单、现有页快照和Raw正文不可在草稿编辑中更改。', 409);
  }
  const schema = await ctx.wiki.schema();
  if (
    sourceLevel !== undefined &&
    (typeof sourceLevel !== 'string' ||
      !schema.enums.source_level.includes(sourceLevel) ||
      workflow.kind !== 'synthesis')
  )
    throw new WikiError('INVALID_SOURCE_LEVEL', '综合页来源等级无效。');
  if (
    sections.sourceList.some(
      (source, index) =>
        (workflow.sections.sourceList[index].source_level !== undefined || source.source_level !== undefined) &&
        !schema.enums.source_level.includes(source.source_level!),
    )
  )
    throw new WikiError('INVALID_SOURCE_LEVEL', '来源等级无效。');
  const nextTitle = title === undefined ? workflow.title : title;
  if (typeof nextTitle !== 'string' || !nextTitle.trim() || nextTitle.trim().length > 300 || /[\r\n]/u.test(nextTitle))
    throw new WikiError('INVALID_TITLE', '标题不能为空、不能换行且最多300字符。');
  if (!schema.categories.some((item) => item.id === workflow.category))
    throw new WikiError('INVALID_CATEGORY', '草稿分类不符合 Wiki Schema。');
  for (const field of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] as const) {
    if (!Array.isArray(sections[field]) || sections[field].some((value) => typeof value !== 'string'))
      throw new WikiError('INVALID_WORKFLOW', `草稿字段 ${field} 必须为字符串列表。`);
  }
  if (
    JSON.stringify(workflow.sections) === JSON.stringify(sections) &&
    workflow.title === nextTitle.trim() &&
    (sourceLevel === undefined || sourceLevel === workflow.source_level)
  )
    return workflow;
  const fields = ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement'] as const;
  workflow.humanEditedSections = [
    ...new Set([
      ...(workflow.humanEditedSections ?? []),
      ...fields.filter((f) => JSON.stringify(workflow.sections[f]) !== JSON.stringify(sections[f])),
    ]),
  ];
  if (workflow.humanReview) workflow.humanReview.approvals = [];
  workflow.sections = sections;
  workflow.title = nextTitle.trim();
  if (sourceLevel !== undefined) workflow.source_level = sourceLevel as SourceLevel;
  workflow.revision++;
  workflow.updatedAt = new Date().toISOString();
  return ctx.save(workflow);
}

export async function discard(ctx: WorkflowContext, id: string, baseRevision: number) {
  const workflow = await ctx.get(id);
  if (!workflow) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
  if (workflow.revision !== baseRevision)
    throw new WikiError('WORKFLOW_REVISION_CONFLICT', '知识草稿已被修改，请刷新后再放弃。', 409, {
      currentRevision: workflow.revision,
    });
  workflow.status = 'discarded';
  workflow.revision++;
  workflow.updatedAt = new Date().toISOString();
  return ctx.save(workflow);
}
