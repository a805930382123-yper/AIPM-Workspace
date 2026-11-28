import { changePageIndexes, maintenanceDigest, assertMaintenanceReviewed } from './maintenance.ts';
import { assertPdfEvidence } from './pdf-input.ts';
import { verifyEvidenceInput } from './inspection-input.ts';
import { WikiStore } from './store.ts';
import { RawStore } from '../raw/store.ts';
import { mediaForEvidence, mediaQuoteMatches } from '../raw/media-context.ts';
import { createHash } from 'node:crypto';
import { validStructuredNote, validNoteApproval, noteCoverage, noteFactIds } from './structured-note.ts';
import { renderPageBody, renderSourceBody } from './render.ts';
import {
  assertHumanReviewed,
  assertReviewSources,
  assertReviewStructure,
  candidateContent,
  reviewContentDigest,
  type HumanReview,
} from './human-review.ts';
import {
  validTemplateFields,
  validMergedTemplateFields,
  mergedFieldsMatchReview,
  type TemplateFields,
} from './template-fields.ts';
import type { WikiRecord } from './store.ts';
import {
  DraftError,
  isQuestionDraft,
  omitKeys,
  type DraftRecord,
  type KnowledgeDraftRecord,
  type DraftPage,
  type DraftSource,
  type DraftRules,
} from './draft-types.ts';

export type DraftDigestContext = {
  root: string;
  imageText: (rawId: string) => ReturnType<typeof loadDraftImageText>;
  assertCapturedReview: (review: HumanReview, id: string, body: string, bodySha256: string) => Promise<void>;
  assertEvidenceStillValid: (draft: DraftRecord, body: string, pages?: DraftPage[]) => Promise<void>;
  assertNoteReviewed: typeof assertNoteReviewed;
  contentDigest: typeof computeDraftContentDigest;
  outcomeDigest: typeof computeDraftOutcomeDigest;
  validateTemplateReferences: typeof validateTemplateReferences;
};

export function computeDraftContentDigest(record: KnowledgeDraftRecord): string {
  if (isQuestionDraft(record)) return maintenanceDigest(record);
  if (record.maintenance) return maintenanceDigest(record);
  if (!record.humanReview) throw new DraftError('HUMAN_REVIEW_REQUIRED', '请先开始逐页人工审查。', 409);
  return reviewContentDigest(
    { draftId: record.id, rawId: record.rawId, rawSha256: record.rawSha256 },
    candidateContent(record),
    record.humanReview,
  );
}

export function computeDraftOutcomeDigest(record: DraftRecord): string {
  const maintenance = record.maintenance && {
    ...record.maintenance,
    changes: record.maintenance.changes.map((change) => omitKeys(change, ['approval', 'committedOperationId'])),
  };
  const review = record.humanReview && {
    basisDigest: record.humanReview.basisDigest,
    assignments: record.humanReview.assignments,
  };
  return createHash('sha256')
    .update(JSON.stringify({ content: candidateContent({ ...record, maintenance }), review }))
    .digest('hex');
}

export async function loadDraftImageText(ctx: DraftDigestContext, rawId: string) {
  const raws = new RawStore(ctx.root);
  const raw = await raws.get(rawId);
  if (!raw) return [];
  return (await raws.getAnchoredMediaArtifacts(raw)).flatMap((artifact) => {
    const text = mediaForEvidence(artifact);
    return text ? [text] : [];
  });
}

export async function assertCapturedReview(
  ctx: DraftDigestContext,
  review: HumanReview,
  id: string,
  body: string,
  bodySha256: string,
) {
  const media = review.units.some((unit) => unit.media || unit.evidence.some((evidence) => evidence.media))
    ? await ctx.imageText(id)
    : undefined;
  assertReviewSources(review, [{ id, body, bodySha256, media }]);
}

export async function assertRawOutcome(
  ctx: DraftDigestContext,
  record: DraftRecord,
  body: string,
  selectedPageIds: string[],
  digest: string,
): Promise<void> {
  if (ctx.outcomeDigest(record) !== digest)
    throw new DraftError('REVIEW_CONTENT_CHANGED', '成果内容已变化，请刷新后确认当前成果。', 409);
  if (createHash('sha256').update(body).digest('hex') !== record.rawSha256)
    throw new DraftError('RAW_CHANGED', '原文实际内容与校验值不一致。', 409);
  const selectedTopics = new Set(selectedPageIds);
  for (const change of record.maintenance?.changes ?? []) {
    if (selectedPageIds.includes(record.pages[change.pageIndex]?.pageId)) {
      for (const index of changePageIndexes(change)) selectedTopics.add(record.pages[index].pageId);
    }
  }
  const selectedPages = record.pages.filter((page) => selectedTopics.has(page.pageId));
  if (record.pdfInput) await assertPdfEvidence(ctx.root, record, selectedPages);
  await ctx.assertEvidenceStillValid(record, body, selectedPages);
  for (const page of selectedPages) {
    const ids = new Set(page.source_evidence.map((evidence) => evidence.id));
    if (page.source_facts.some((fact) => fact.evidenceIds.some((id) => !ids.has(id)))) {
      throw new DraftError('EVIDENCE_UNKNOWN_ID', `「${page.title}」引用了无法定位的原文证据。`, 409);
    }
  }
  if (record.humanReview) {
    assertReviewStructure(
      record.humanReview,
      record.pages.map((page) => page.pageId),
    );
    const noteIds = new Set(
      record.structuredNote
        ? [
            ...noteFactIds(record.structuredNote),
            ...(record.noteReview?.questionIds ?? []),
            ...(record.noteReview?.exclusions.map((item) => item.id) ?? []),
          ]
        : [],
    );
    const units = record.humanReview.units.filter(
      (unit) =>
        selectedTopics.has(record.humanReview!.assignments[unit.id] ?? '') ||
        unit.records.some((item) => noteIds.has(item.id)),
    );
    await ctx.assertCapturedReview({ ...record.humanReview, units }, record.rawId, body, record.rawSha256);
  }
}

export async function assertDraftReviewed(
  ctx: DraftDigestContext,
  record: KnowledgeDraftRecord,
  body: string,
  appliedTargets: WikiRecord[] = [],
): Promise<string> {
  if (isQuestionDraft(record)) {
    const raws = new RawStore(ctx.root),
      wiki = new WikiStore(ctx.root, raws);
    await verifyEvidenceInput(record.input, wiki, raws, appliedTargets);
    assertReviewStructure(
      record.humanReview,
      record.pages.map((p) => p.pageId),
    );
    const facts = record.humanReview.units.filter((u) => u.kind === 'fact');
    if (
      facts.length !== record.input.citations.length ||
      record.input.citations.some(
        (c, i) =>
          !facts.some(
            (u) =>
              u.id === 'reference-' + i &&
              u.text === c.quote &&
              u.records.length === 1 &&
              u.records[0].text === c.quote,
          ),
      )
    )
      throw new DraftError('QUESTION_EVIDENCE_CHANGED', '问答原始依据目录已变化，不能写入。', 409);
    return assertMaintenanceReviewed(record);
  }

  if (record.maintenance) {
    assertReviewStructure(
      record.humanReview,
      record.pages.map((p) => p.pageId),
    );
    await ctx.assertCapturedReview(record.humanReview, record.rawId, body, record.rawSha256);
    await ctx.assertEvidenceStillValid(record, body);
    const digest = assertMaintenanceReviewed(record);
    if (record.structuredNote) ctx.assertNoteReviewed(record, digest);
    return digest;
  }
  assertReviewStructure(
    record.humanReview,
    record.pages.map((p) => p.pageId),
  );
  await ctx.assertCapturedReview(record.humanReview, record.rawId, body, record.rawSha256);
  await ctx.assertEvidenceStillValid(record, body);
  const digest = ctx.contentDigest(record);
  if (record.structuredNote) ctx.assertNoteReviewed(record, digest);
  assertHumanReviewed(
    record.humanReview,
    record.pages.map((p) => p.pageId),
    digest,
  );
  return digest;
}

export function assertNoteReviewed(record: DraftRecord, digest: string): void {
  if (!validNoteApproval(record.noteApproval) || record.noteApproval.digest !== digest)
    throw new DraftError('STRUCTURED_NOTE_CONFIRM_UNAVAILABLE', '请先明确核对深度笔记、引用、覆盖与待确认问题。', 409);
  const review = record.humanReview!;
  const facts = review.units.filter((u) => u.kind === 'fact').flatMap((u) => u.records.map((r) => r.id)),
    questions = review.units.filter((u) => u.kind === 'question').flatMap((u) => u.records.map((r) => r.id));
  if (
    !validStructuredNote(record.structuredNote, new Set(facts)) ||
    noteCoverage(
      record.structuredNote,
      facts,
      questions,
      record.noteReview?.exclusions,
      record.noteReview?.questionIds,
    ).some((c) => c.status === 'uncovered')
  )
    throw new DraftError('NOTE_COVERAGE_INCOMPLETE', '笔记引用或覆盖未完成，请处理全部来源事实和问题。', 409);
}

export function normalizedTemplateFields(fields: TemplateFields, previous?: TemplateFields): TemplateFields {
  const normalized: TemplateFields = {};
  for (const [key, field] of Object.entries(fields)) {
    const humanText = field.humanText?.trim(),
      oldAi = previous?.[key as keyof TemplateFields]?.aiContent,
      ai = field.aiContent;
    if (
      ai &&
      (!oldAi ||
        JSON.stringify(ai.factIds) !== JSON.stringify(oldAi.factIds) ||
        JSON.stringify(ai.evidenceIds) !== JSON.stringify(oldAi.evidenceIds))
    )
      throw new DraftError(
        'TEMPLATE_AI_REFERENCES_IMMUTABLE',
        'AI字段的原事实引用只读；可修改AI草稿文字或删除该AI项。',
        409,
      );
    const aiContent =
      ai && oldAi
        ? {
            text: ai.text.trim(),
            factIds: [...oldAi.factIds],
            evidenceIds: [...oldAi.evidenceIds],
            ...(oldAi.humanEdited || ai.text.trim() !== oldAi.text ? { humanEdited: true as const } : {}),
          }
        : undefined;
    if (field.evidenceIds.length || humanText || aiContent)
      normalized[key as keyof TemplateFields] = {
        evidenceIds: [...field.evidenceIds],
        ...(humanText ? { humanText } : {}),
        ...(aiContent ? { aiContent } : {}),
      };
  }
  return normalized;
}

export function assertRoundtripSize(record: DraftRecord): void {
  if (!record.pages.some((page) => page.mergedTemplateFields?.length)) return;
  // Exactly the editable snapshot sent by DraftReviewPage, including repeated evidence and Source text.
  const payload = {
    baseRevision: record.revision,
    document: {
      title: record.document.title,
      main_topic: record.document.main_topic,
      summary: record.document.summary,
    },
    source: Object.fromEntries(
      ['title', 'summary', 'body', 'category', 'knowledge_status', 'confidence', 'source_level', 'key_takeaways'].map(
        (key) => [key, record.source[key as keyof DraftSource]],
      ),
    ),
    pages: record.pages.map((page) => ({
      ...Object.fromEntries(
        [
          'pageId',
          'selected',
          'title',
          'type',
          'category',
          'one_line_definition',
          'source_facts',
          'ai_organized',
          'ai_inferences',
          'related_pages',
          'open_questions',
          'templateFields',
          'mergedTemplateFields',
          'knowledge_status',
          'confidence',
          'source_level',
        ].map((key) => [key, page[key as keyof DraftPage]]),
      ),
      source_evidence: page.source_evidence.map(({ id, rawId, quote, start, end }) => ({
        id,
        rawId,
        quote,
        start,
        end,
      })),
    })),
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 3 * 1024 * 1024)
    throw new DraftError('DRAFT_PATCH_TOO_LARGE', '合并后的完整保存内容超过现有3MiB请求上限；原草稿及审批保持。', 413);
}

export async function assertEvidenceStillValid(
  ctx: DraftDigestContext,
  draft: DraftRecord,
  body: string,
  pages = draft.pages,
): Promise<void> {
  const imageText = pages.some((page) => page.source_evidence.some((evidence) => evidence.media))
    ? await ctx.imageText(draft.rawId)
    : [];
  for (const page of pages) {
    ctx.validateTemplateReferences(page, draft.rawId, undefined, draft.humanReview);
    for (const evidence of page.source_evidence) {
      if (
        evidence.media
          ? !mediaQuoteMatches(evidence.media, evidence.start, evidence.end, evidence.quote, imageText)
          : body.slice(evidence.start, evidence.end) !== evidence.quote
      ) {
        throw new DraftError(
          'EVIDENCE_STALE',
          `草稿「${page.title}」的证据 ${evidence.id} 与当前原文不一致（原文可能已变化），请重新整理这条资料。`,
          409,
        );
      }
    }
  }
}

export function validateTemplateReferences(
  page: DraftPage,
  rawId: string,
  previous?: DraftPage,
  review?: HumanReview,
): void {
  if (
    page.mergedTemplateFields !== undefined &&
    (!validMergedTemplateFields(page.mergedTemplateFields) ||
      !mergedFieldsMatchReview(page.mergedTemplateFields, page.pageId, rawId, review))
  )
    throw new DraftError('MERGED_FIELDS_INVALID', '合并字段组的事实或原文引用不属于当前归属目录。', 422);
  if (page.templateFields === undefined) return;
  if (!validTemplateFields(page.templateFields, page.type))
    throw new DraftError('INVALID_TEMPLATE_FIELDS', '字段归位格式或字段名称无效。', 422);
  const previousIds = new Set(Object.values(previous?.templateFields ?? {}).flatMap((field) => field.evidenceIds));
  for (const field of Object.values(page.templateFields))
    for (const id of field.evidenceIds) {
      const evidence = page.source_evidence.find((item) => item.id === id);
      if (!evidence || evidence.rawId !== rawId)
        throw new DraftError(
          'TEMPLATE_EVIDENCE_UNKNOWN',
          `字段引用 ${id} 不属于当前页面；请撤销对应引用后再移动来源。`,
          422,
        );
      const old = previousIds.has(id) ? previous?.source_evidence.find((item) => item.id === id) : undefined;
      if (
        old &&
        (old.rawId !== evidence.rawId ||
          old.quote !== evidence.quote ||
          old.start !== evidence.start ||
          old.end !== evidence.end)
      ) {
        throw new DraftError(
          'TEMPLATE_EVIDENCE_CHANGED',
          `来源移动会改变字段引用 ${id} 的原文，操作已停止，原字段已保留。`,
          409,
        );
      }
    }
  for (const field of Object.values(page.templateFields)) {
    const ai = field.aiContent;
    if (!ai) continue;
    const units =
      review?.units.filter((unit) => unit.kind === 'fact' && review.assignments[unit.id] === page.pageId) ?? [];
    const expected: string[] = [];
    for (const id of ai.factIds) {
      const unit = units.find((item) => item.records.some((record) => record.id === id));
      const fact = unit?.records.find((record) => record.id === id);
      if (!unit || !fact || unit.records.some((record) => !ai.factIds.includes(record.id)))
        throw new DraftError(
          'TEMPLATE_AI_FACT_UNKNOWN',
          `AI字段引用的完整原事实 ${id} 不属于当前页面；请先删除对应AI项再移动来源。`,
          422,
        );
      for (const ref of fact.evidenceIds) {
        const original = unit.evidence.find((evidence) => evidence.id === ref);
        const evidence =
          original &&
          page.source_evidence.find(
            (item) =>
              item.rawId === rawId &&
              item.rawId === original.rawId &&
              item.start === original.start &&
              item.end === original.end &&
              item.quote === original.quote,
          );
        if (!evidence)
          throw new DraftError(
            'TEMPLATE_AI_EVIDENCE_UNKNOWN',
            'AI字段的原事实证据无法对应当前页面，原草稿已保留。',
            422,
          );
        expected.push(evidence.id);
      }
    }
    const ids = [...new Set(expected)];
    if (ids.length !== ai.evidenceIds.length || ai.evidenceIds.some((id) => !ids.includes(id)))
      throw new DraftError('TEMPLATE_AI_EVIDENCE_UNKNOWN', 'AI字段未保留原事实的完整来源引用，原草稿已保留。', 422);
  }
}

export function validateDraftPage(page: DraftPage, rules: DraftRules): void {
  if (!page.title.trim()) throw new DraftError('INVALID_FIELD', '每条建议都必须有标题。', 400);
  if (!rules.types.includes(page.type)) throw new DraftError('INVALID_TYPE', `类型 ${page.type} 无效。`, 400);
  if (!rules.categories.includes(page.category))
    throw new DraftError('INVALID_CATEGORY', `分类 ${page.category} 无效。`, 400);
  if (!page.one_line_definition.trim())
    throw new DraftError('INVALID_FIELD', `建议「${page.title}」缺少一句话说明。`, 400);
  if (!rules.knowledge_status.includes(page.knowledge_status))
    throw new DraftError('INVALID_FIELD', '知识状态无效。', 400);
  if (!rules.confidence.includes(page.confidence)) throw new DraftError('INVALID_FIELD', '可信度无效。', 400);
  if (!rules.source_level.includes(page.source_level)) throw new DraftError('INVALID_FIELD', '来源等级无效。', 400);
  const ids = new Set(page.source_evidence.map((evidence) => evidence.id));
  for (const fact of page.source_facts) {
    for (const id of fact.evidenceIds) {
      if (!ids.has(id))
        throw new DraftError('EVIDENCE_UNKNOWN_ID', `建议「${page.title}」引用了不存在的证据 ${id}。`, 422);
    }
  }
}

export function buildDraftView(
  ctx: DraftDigestContext,
  record: KnowledgeDraftRecord,
  options: { sourceTitle?: string } = {},
): KnowledgeDraftRecord & {
  pages: Array<DraftPage & { renderedBody: string }>;
  sourceRenderedBody: string;
  outcomeDigest?: string;
  changeDigests?: Record<string, string>;
} {
  if (isQuestionDraft(record))
    return {
      ...record,
      changeDigests: Object.fromEntries(
        record.maintenance.changes.map((c) => [c.changeId, maintenanceDigest(record, c.changeId)]),
      ),
      sourceRenderedBody:
        record.input.kind === 'inspection'
          ? record.input.findings.map((f) => f.summary).join('\n')
          : record.input.preview.conclusion + '\n' + record.input.preview.inferences,
      pages: record.pages.map((p, i) => ({
        ...p,
        renderedBody: record.maintenance.changes[i]?.candidate.body ?? '',
      })),
    };
  // F04-05: when an existing Source is reused, the pages must link its real title.
  const sourceTitle = options.sourceTitle ?? record.source.title;
  const selectedPages = record.pages.filter((page) => page.selected);
  const createdTitles = new Set([...selectedPages.map((page) => page.title), sourceTitle]);
  const sourceBody = record.source.bodyEditedByUser
    ? record.source.body
    : renderSourceBody(
        record.source,
        record.rawMeta,
        selectedPages,
        record.pages.filter((page) => !page.selected),
      );
  return {
    ...record,
    outcomeDigest: ctx.outcomeDigest(record),
    ...(record.maintenance
      ? {
          changeDigests: Object.fromEntries(
            record.maintenance.changes.map((c) => [c.changeId, maintenanceDigest(record, c.changeId)]),
          ),
        }
      : {}),
    sourceRenderedBody: sourceBody,
    pages: record.pages.map((page) => ({
      ...page,
      renderedBody: renderPageBody(page, { sourceTitle, rawId: record.rawId, createdTitles }),
    })),
  };
}
