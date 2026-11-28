import { validMaintenance, maintenanceDigest, assertMaintenanceReviewed, type KnowledgeChange } from './maintenance.ts';
import { verifyEvidenceInput } from './inspection-input.ts';
import { WikiStore } from './store.ts';
import { RawStore } from '../raw/store.ts';
import { createHash } from 'node:crypto';
import {
  validStructuredNote,
  validNoteReview,
  noteReviewContent,
  noteFactIds,
  type NoteApproval,
  type NoteExclusion,
} from './structured-note.ts';
import { SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { renderSourceBody } from './render.ts';
import {
  assertHumanReviewed,
  assertReviewStructure,
  candidateContent,
  confirmHumanPage,
  moveHumanUnits,
  type HumanReview,
} from './human-review.ts';
import type { WikiRecord } from './store.ts';
import {
  DraftError,
  isQuestionDraft,
  draftFilePath,
  type DraftRecord,
  type KnowledgeDraftRecord,
  type QuestionDraftRecord,
} from './draft-types.ts';
import { type DraftDigestContext, assertRoundtripSize } from './draft-digest.ts';
import { deriveReviewPages } from './draft-migration.ts';

export type DraftReviewContext = DraftDigestContext & {
  queue: SerialQueue;
  get: (id: string) => Promise<DraftRecord | undefined>;
  getKnowledge: (id: string) => Promise<KnowledgeDraftRecord | undefined>;
  migratedReview: (record: DraftRecord, body: string, rulesDir: string) => Promise<HumanReview>;
  deriveReviewPages: typeof deriveReviewPages;
  assertRoundtripSize: typeof assertRoundtripSize;
};

export async function reviewOperation(
  ctx: DraftReviewContext,
  id: string,
  input: {
    baseRevision: number;
    action: 'start' | 'move' | 'page' | 'questions';
    unitIds?: string[];
    pageId?: string | null;
    reviewContentDigest?: string;
    confirmed?: boolean;
    marked?: boolean;
  },
  context: { body: string; rulesDir: string },
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    const current = await ctx.get(id);
    if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
    if (current.status !== 'pending_confirmation')
      throw new DraftError('DRAFT_NOT_EDITABLE', '草稿不在待审查状态。', 409);
    if (input.baseRevision !== current.revision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已修改，请刷新后审查。', 409, {
        currentRevision: current.revision,
      });
    await ctx.assertEvidenceStillValid(current, context.body);
    const next = structuredClone(current);
    if (input.action === 'start' && !next.humanReview)
      next.humanReview = await ctx.migratedReview(next, context.body, context.rulesDir);
    assertReviewStructure(
      next.humanReview,
      next.pages.map((p) => p.pageId),
    );
    await ctx.assertCapturedReview(next.humanReview, next.rawId, context.body, next.rawSha256);
    if (input.action === 'questions') {
      const ids = input.unitIds;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !next.humanReview!.units.some((u) => u.id === id && u.kind === 'fact')) ||
        typeof input.marked !== 'boolean'
      )
        throw new DraftError('INVALID_QUESTION_MARK', '请明确标记已知且不重复的完整来源事实。', 400);
      const marked = new Set(next.humanQuestionUnitIds ?? []);
      for (const id of ids)
        if (input.marked) marked.add(id);
        else marked.delete(id);
      const ordered = next.humanReview.units.filter((u) => marked.has(u.id)).map((u) => u.id);
      if (JSON.stringify(ordered) === JSON.stringify(next.humanQuestionUnitIds ?? [])) return current;
      if (ordered.length) next.humanQuestionUnitIds = ordered;
      else delete next.humanQuestionUnitIds;
      next.humanReview.approvals = [];
      delete next.noteApproval;
      ctx.deriveReviewPages(next);
    }
    if (input.action === 'move') {
      moveHumanUnits(
        next.humanReview,
        next.pages.map((p) => p.pageId),
        input.unitIds!,
        input.pageId!,
      );
      ctx.deriveReviewPages(next);
    }
    for (const page of next.pages)
      ctx.validateTemplateReferences(
        page,
        next.rawId,
        current.pages.find((p) => p.pageId === page.pageId),
        next.humanReview,
      );
    if (
      (input.action === 'questions' || (input.action === 'move' && next.humanQuestionUnitIds?.length)) &&
      !next.source.bodyEditedByUser
    )
      next.source.body = renderSourceBody(
        next.source,
        next.rawMeta,
        next.pages.filter((p) => p.selected),
        next.pages.filter((p) => !p.selected),
      );
    if (input.action === 'page')
      confirmHumanPage(
        next.humanReview,
        next.pages.map((p) => p.pageId),
        { pageId: input.pageId!, reviewContentDigest: input.reviewContentDigest!, confirmed: input.confirmed! },
        ctx.contentDigest(next),
      );
    if (next.maintenance && maintenanceDigest(next) !== maintenanceDigest(current))
      for (const c of next.maintenance.changes) delete c.approval;
    if (next.structuredNote && ctx.contentDigest(next) !== ctx.contentDigest(current)) delete next.noteApproval;
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    next.revision++;
    next.updatedAt = new Date().toISOString();
    ctx.assertRoundtripSize(next);
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function reviewStructuredNote(
  ctx: DraftReviewContext,
  id: string,
  input: unknown,
  body: string,
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new DraftError('INVALID_NOTE_REVIEW', '笔记审核格式无效。');
    const value = input as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !==
        'baseRevision,historicalReportAcknowledged,reviewContentDigest,warningsAcknowledged' ||
      value.warningsAcknowledged !== true ||
      value.historicalReportAcknowledged !== true
    )
      throw new DraftError('INVALID_NOTE_REVIEW', '请明确确认已看到确定性警告和模型报告状态，不能伪造审批字段。');
    const record = await ctx.get(id);
    if (!record?.structuredNote) throw new DraftError('NOTE_NOT_FOUND', '没有结构化笔记。', 404);
    if (record.status !== 'pending_confirmation' || record.revision !== value.baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化，请刷新后重新核对。', 409);
    assertReviewStructure(
      record.humanReview,
      record.pages.map((p) => p.pageId),
    );
    await ctx.assertCapturedReview(record.humanReview, record.rawId, body, record.rawSha256);
    await ctx.assertEvidenceStillValid(record, body);
    const digest = ctx.contentDigest(record);
    if (value.reviewContentDigest !== digest)
      throw new DraftError('REVIEW_CONTENT_CHANGED', '笔记内容摘要已变化。', 409);
    if (record.maintenance) assertMaintenanceReviewed(record);
    else
      assertHumanReviewed(
        record.humanReview,
        record.pages.map((p) => p.pageId),
        digest,
      );
    const approval: NoteApproval = {
      version: 1,
      digest,
      at: new Date().toISOString(),
      warningsAcknowledged: true,
      historicalReportAcknowledged: true,
    };
    ctx.assertNoteReviewed({ ...record, noteApproval: approval }, digest);
    const next = {
      ...record,
      noteApproval: approval,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function editStructuredNote(
  ctx: DraftReviewContext,
  id: string,
  input: unknown,
  body: string,
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new DraftError('INVALID_NOTE_PATCH', '结构化笔记编辑格式无效。');
    const patch = input as Record<string, unknown>;
    if (
      Object.keys(patch).some(
        (k) => !['baseRevision', 'structuredNote', 'exclusions', 'questionIds', 'humanQuestions'].includes(k),
      )
    )
      throw new DraftError('INVALID_NOTE_PATCH', '不能写入审批、模型报告或原始来源字段。');
    const current = await ctx.get(id);
    if (!current?.structuredNote || !current.humanReview)
      throw new DraftError('NOTE_NOT_FOUND', '草稿没有结构化笔记。', 404);
    if (current.status !== 'pending_confirmation' || current.revision !== patch.baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化或不可编辑，请刷新后重试。', 409);
    await ctx.assertCapturedReview(current.humanReview, current.rawId, body, current.rawSha256);
    await ctx.assertEvidenceStillValid(current, body);
    const facts = new Set(
        current.humanReview.units.filter((u) => u.kind === 'fact').flatMap((u) => u.records.map((r) => r.id)),
      ),
      questions = new Set(
        current.humanReview.units.filter((u) => u.kind === 'question').flatMap((u) => u.records.map((r) => r.id)),
      );
    if (!validStructuredNote(patch.structuredNote, facts))
      throw new DraftError('STRUCTURED_NOTE_INVALID', '笔记结构、角色或事实引用无效。');
    const note = patch.structuredNote,
      generatedNoteDigest =
        current.noteReview?.generatedNoteDigest ??
        createHash('sha256').update(JSON.stringify(current.structuredNote)).digest('hex');
    const content = noteReviewContent(
      note,
      (patch.exclusions ?? current.noteReview?.exclusions ?? []) as NoteExclusion[],
      (patch.questionIds ?? current.noteReview?.questionIds ?? []) as string[],
      (patch.humanQuestions ?? current.noteReview?.humanQuestions ?? []) as string[],
    );
    const metadata = {
      version: 1 as const,
      generatedNoteDigest,
      generatedSections:
        current.noteReview?.generatedSections ??
        current.structuredNote.sections.map((s) => ({ id: s.id, blockCount: s.blocks.length })),
      contentDigest: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
      exclusions: content.exclusions,
      questionIds: content.questionIds,
      humanQuestions: content.humanQuestions,
    };
    if (
      !validNoteReview(metadata) ||
      metadata.questionIds.some((id) => !questions.has(id)) ||
      metadata.exclusions.some((e) => !(e.kind === 'fact' ? facts : questions).has(e.id))
    )
      throw new DraftError('NOTE_COVERAGE_INVALID', '排除需真实来源ID及非空理由；问题选择必须来自原目录。');
    const referenced = new Set(noteFactIds(note));
    if (
      metadata.exclusions.some((e) => (e.kind === 'fact' ? referenced.has(e.id) : metadata.questionIds.includes(e.id)))
    )
      throw new DraftError('NOTE_COVERAGE_INVALID', '已引用项不能同时排除。');
    const previous = noteReviewContent(
      current.structuredNote,
      current.noteReview?.exclusions ?? [],
      current.noteReview?.questionIds ?? [],
      current.noteReview?.humanQuestions ?? [],
    );
    if (JSON.stringify(previous) === JSON.stringify(content)) return current;
    const next = {
      ...current,
      noteApproval: undefined,
      structuredNote: structuredClone(note),
      noteReview: metadata,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      humanReview: { ...current.humanReview, approvals: [] },
    };
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function reviewQuestionOperation(
  ctx: DraftReviewContext,
  id: string,
  input: { baseRevision: number; action: string; unitIds?: string[]; pageId?: string | null },
): Promise<QuestionDraftRecord> {
  return ctx.queue.run(async () => {
    const current = await ctx.getKnowledge(id);
    if (!current || !isQuestionDraft(current)) throw new DraftError('QUESTION_DRAFT_MISSING', '问答草稿不存在。', 404);
    if (current.status !== 'pending_confirmation' || current.revision !== input.baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化，请刷新。', 409);
    if (input.action !== 'move' && input.action !== 'start')
      throw new DraftError('QUESTION_REVIEW_ACTION', '问答草稿请使用来源归属及逐项审核。');
    const raws = new RawStore(ctx.root);
    await verifyEvidenceInput(current.input, new WikiStore(ctx.root, raws), raws);
    const next = structuredClone(current);
    if (input.action === 'move')
      moveHumanUnits(
        next.humanReview!,
        next.pages.map((p) => p.pageId),
        input.unitIds!,
        input.pageId ?? null,
      );
    if (JSON.stringify(next.humanReview) === JSON.stringify(current.humanReview)) return current;
    for (const c of next.maintenance.changes) delete c.approval;
    next.revision++;
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function reviewKnowledgeChange(
  ctx: DraftReviewContext,
  id: string,
  input: unknown,
): Promise<KnowledgeDraftRecord> {
  return ctx.queue.run(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new DraftError('INVALID_CHANGE', '变更审核格式无效。');
    const value = input as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (k) => !['baseRevision', 'changeId', 'decision', 'body', 'title', 'confirmed', 'digest'].includes(k),
      ) ||
      !Number.isInteger(value.baseRevision) ||
      typeof value.changeId !== 'string' ||
      (value.decision !== undefined && !['accept', 'defer'].includes(String(value.decision))) ||
      (value.body !== undefined && typeof value.body !== 'string') ||
      (value.title !== undefined && typeof value.title !== 'string') ||
      (value.confirmed !== undefined && typeof value.confirmed !== 'boolean')
    )
      throw new DraftError('INVALID_CHANGE', '变更审核字段无效。');
    const current = await ctx.getKnowledge(id);
    if (!current?.maintenance) throw new DraftError('MAINTENANCE_MISSING', '没有知识维护草稿。', 404);
    if (isQuestionDraft(current)) {
      const raws = new RawStore(ctx.root);
      await verifyEvidenceInput(current.input, new WikiStore(ctx.root, raws), raws);
    }
    if (current.status !== 'pending_confirmation' || current.revision !== value.baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化，请刷新后审核。', 409);
    const next = structuredClone(current),
      change = next.maintenance!.changes.find((c) => c.changeId === value.changeId);
    if (!change) throw new DraftError('CHANGE_MISSING', '变更项不存在。', 404);
    if (value.body !== undefined || value.title !== undefined) {
      if (change.action === 'noop' || change.action === 'link')
        throw new DraftError('CHANGE_NOT_EDITABLE', '关联或无变化项不能重写正文。', 409);
      if (value.body !== undefined) change.candidate.body = value.body as string;
      if (value.title !== undefined) change.candidate.title = value.title as string;
    }
    if (value.decision !== undefined) change.decision = value.decision as 'accept' | 'defer';
    if (!validMaintenance(next.maintenance)) throw new DraftError('INVALID_CHANGE', '变更内容无效或超出上限。');
    if (change.committedOperationId) throw new DraftError('CHANGE_ALREADY_COMMITTED', '该项已正式提交。', 409);
    const digest = maintenanceDigest(next, change.changeId);
    if (digest !== maintenanceDigest(current, change.changeId)) delete change.approval;
    if (value.confirmed === true) {
      if (value.digest !== digest) throw new DraftError('REVIEW_CONTENT_CHANGED', '内容变化，请保存后重新核对。', 409);
      if (change.decision !== 'accept') throw new DraftError('CHANGE_NOT_ACCEPTED', '请先接受本项。', 409);
      change.approval = { digest, at: new Date().toISOString() };
    }
    if (value.confirmed === false) delete change.approval;
    next.revision++;
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function savePreparedChange(
  ctx: DraftReviewContext,
  id: string,
  baseRevision: number,
  change: KnowledgeChange,
  absorbedId: string | undefined,
  target: WikiRecord | undefined,
  callCount: number,
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    const next = await ctx.get(id);
    if (!next?.maintenance || next.status !== 'pending_confirmation' || next.revision !== baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化，原成果保留，请刷新后重试。', 409);
    const maintenance = next.maintenance;
    maintenance.changes = maintenance.changes
      .filter((c) => c.changeId !== absorbedId)
      .map((c) => {
        if (c.changeId === change.changeId) return change;
        if (absorbedId && c.dependsOn.includes(absorbedId))
          return {
            ...c,
            dependsOn: [...new Set(c.dependsOn.map((dep) => (dep === absorbedId ? change.changeId : dep)))],
          };
        return c;
      });
    // Keep snapshots referenced by other outcomes. A newly chosen target gets a fresh snapshot.
    const required = maintenance.context.filter(
      (p) => p.id !== target?.id && maintenance.changes.some((c) => c.targetWikiId === p.id),
    );
    maintenance.context = [
      ...required,
      ...(target ? [target] : []),
      ...maintenance.context.filter((p) => p.id !== target?.id && !required.includes(p)),
    ].slice(0, Math.max(8, required.length + Number(!!target)));
    if (!validMaintenance(maintenance)) throw new DraftError('INVALID_CHANGE', '重准备结果无效，原成果保留。');
    for (const c of maintenance.changes) delete c.approval;
    if (next.humanReview) next.humanReview.approvals = [];
    delete next.noteApproval;
    next.extraction.callCount = callCount;
    next.revision++;
    next.updatedAt = new Date().toISOString();
    ctx.assertRoundtripSize(next);
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function finishMaintenance(
  ctx: DraftReviewContext,
  id: string,
  baseRevision: number,
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    const draft = await ctx.get(id);
    if (!draft?.maintenance) throw new DraftError('MAINTENANCE_MISSING', '没有知识维护草稿。', 404);
    if (draft.discardedAt && draft.revision === baseRevision + 1) return draft;
    if (draft.status !== 'pending_confirmation' || draft.revision !== baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '请刷新草稿并处理未完成的提交。', 409);
    const now = new Date().toISOString();
    const next: DraftRecord = {
      ...draft,
      status:
        draft.maintenance.changes.some((c) => c.committedOperationId) || draft.commitOperationId
          ? 'confirmed'
          : 'discarded',
      revision: draft.revision + 1,
      discardedAt: now,
      updatedAt: now,
    };
    delete next.deferredAt;
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}

export async function setDeferred(
  ctx: DraftReviewContext,
  id: string,
  baseRevision: number,
  deferred: boolean,
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    const draft = await ctx.get(id);
    if (!draft?.maintenance) throw new DraftError('MAINTENANCE_MISSING', '没有可暂缓的 Raw 整理草稿。', 404);
    if (
      draft.status !== 'pending_confirmation' ||
      draft.revision !== baseRevision ||
      !draft.maintenance.changes.some((change) => !change.committedOperationId)
    ) {
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化或没有剩余成果，请刷新。', 409);
    }
    if (Boolean(draft.deferredAt) === deferred) return draft;
    const now = new Date().toISOString();
    if (deferred) draft.deferredAt = now;
    else delete draft.deferredAt;
    draft.revision++;
    draft.updatedAt = now;
    await writeJsonAtomic(draftFilePath(ctx.root, id), draft);
    return draft;
  });
}

export async function setDecision(
  ctx: DraftReviewContext,
  id: string,
  pageId: string,
  input: { baseRevision: number; decision: 'update' | 'create' | 'defer'; targetWikiId?: string },
): Promise<DraftRecord> {
  return ctx.queue.run(async () => {
    const current = await ctx.get(id);
    if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
    if (current.status !== 'pending_confirmation')
      throw new DraftError('DRAFT_NOT_EDITABLE', '草稿不在待审核状态。', 409);
    if (current.revision !== input.baseRevision)
      throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅。', 409, {
        currentRevision: current.revision,
      });
    const next: DraftRecord = JSON.parse(JSON.stringify(current)) as DraftRecord;
    const page = next.pages.find((item) => item.pageId === pageId);
    if (!page) throw new DraftError('NOT_FOUND', '没有找到这条知识建议。', 404);
    if (input.decision === 'update' && !input.targetWikiId)
      throw new DraftError('TARGET_REQUIRED', '选择更新已有 Wiki 时必须指定目标页面。');
    page.reviewDecision = input.decision;
    page.updateTargetWikiId = input.decision === 'update' ? input.targetWikiId : undefined;
    if (input.decision === 'defer' || input.decision === 'update') page.selected = false;
    if (input.decision === 'create') page.selected = true;
    if (JSON.stringify(candidateContent(next)) === JSON.stringify(candidateContent(current))) return current;
    if (next.humanReview) next.humanReview.approvals = [];
    delete next.noteApproval;
    next.revision++;
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(draftFilePath(ctx.root, id), next);
    return next;
  });
}
