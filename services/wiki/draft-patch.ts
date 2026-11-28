import { randomUUID } from 'node:crypto';
import type { LlmError } from '../llm/provider.ts';
import { locateEvidenceInBody } from '../llm/evidence.ts';
import type { ExtractedPage } from '../llm/service.ts';
import { renderSourceBody } from './render.ts';
import { candidateContent } from './human-review.ts';
import {
  captureTemplateFields,
  hasTemplateFields,
  validTemplateFields,
  validMergedTemplateFields,
} from './template-fields.ts';
import {
  DraftError,
  derivedTakeaways,
  defaultKnowledgeStatus,
  omitKeys,
  type DraftRecord,
  type DraftPage,
  type DraftPagePatch,
  type DraftPatch,
  type DraftRules,
  type DraftEvidence,
} from './draft-types.ts';
import {
  normalizedTemplateFields,
  assertRoundtripSize,
  validateDraftPage,
  validateTemplateReferences,
} from './draft-digest.ts';
import { deriveReviewPages } from './draft-migration.ts';

export type DraftPatchHelpers = {
  applyPagePatch: (
    page: DraftPage,
    item: DraftPagePatch,
    context: { body: string; rules: DraftRules },
    rawId: string,
  ) => void;
  applyMerge: typeof applyDraftMerge;
  deriveReviewPages: typeof deriveReviewPages;
  validatePage: typeof validateDraftPage;
  validateTemplateReferences: typeof validateTemplateReferences;
  assertRoundtripSize: typeof assertRoundtripSize;
};

export function fromExtractedPage(page: ExtractedPage, rules: DraftRules): DraftPage {
  const draft: DraftPage = {
    ...(page.templateFields !== undefined ? { templateFields: structuredClone(page.templateFields) } : {}),
    pageId: randomUUID(),
    title: page.title,
    type: page.type,
    category: page.category,
    one_line_definition: page.one_line_definition,
    source_facts: page.source_facts.map((fact) => ({ text: fact.text, evidenceIds: [...fact.evidenceIds] })),
    ai_organized: [...page.ai_organized],
    ai_inferences: [...page.ai_inferences],
    related_pages: [...page.related_pages],
    open_questions: [...page.open_questions],
    source_evidence: page.source_evidence.map((item) => ({
      id: item.id,
      rawId: item.rawId,
      quote: item.quote,
      start: item.start,
      end: item.end,
      chunkIndex: item.chunkIndex,
      ...(item.media ? { media: item.media } : {}),
    })),
    knowledge_status: defaultKnowledgeStatus(page),
    confidence: 'medium',
    source_level: 'D',
    // F04-03: new knowledge pages start unselected; the user decides what becomes formal.
    selected: false,
    provenance: page.provenance.map((item) => ({ ...item })),
    ...(page.mergedFrom ? { mergedFrom: [...page.mergedFrom] } : {}),
    ...(page.notes ? { notes: [...page.notes] } : {}),
  };
  if (!rules.types.includes(draft.type))
    throw new DraftError('INVALID_TYPE', `建议类型 ${draft.type} 不在规则允许范围内。`, 502);
  if (!rules.categories.includes(draft.category))
    throw new DraftError('INVALID_CATEGORY', `建议分类 ${draft.category} 不在规则允许范围内。`, 502);
  return draft;
}

export function applyDraftPagePatch(
  normalizedFields: typeof normalizedTemplateFields,
  page: DraftPage,
  item: DraftPagePatch,
  context: { body: string; rules: DraftRules },
  rawId: string,
): void {
  const edited = new Set(page.editedFields ?? []);
  const candidateBasis = new Set([
    'title',
    'type',
    'category',
    'one_line_definition',
    'source_facts',
    'ai_organized',
    'templateFields',
    'mergedTemplateFields',
  ]);
  const setField = (key: keyof DraftPage, value: unknown) => {
    const name = key as string;
    if (JSON.stringify((page as Record<string, unknown>)[name]) === JSON.stringify(value)) return;
    if (candidateBasis.has(name) && JSON.stringify((page as Record<string, unknown>)[name]) !== JSON.stringify(value)) {
      page.reviewDecision = undefined;
      page.updateTargetWikiId = undefined;
    }
    edited.add(name);
    (page as Record<string, unknown>)[name] = value;
  };
  if (item.selected !== undefined) page.selected = Boolean(item.selected);
  if (item.reviewDecision !== undefined) {
    if (!['update', 'create', 'defer'].includes(item.reviewDecision))
      throw new DraftError('INVALID_DECISION', '知识建议处理决策无效。', 400);
    page.reviewDecision = item.reviewDecision;
    page.updateTargetWikiId = item.reviewDecision === 'update' ? item.updateTargetWikiId : undefined;
    if (item.reviewDecision === 'update' && !item.updateTargetWikiId)
      throw new DraftError('TARGET_REQUIRED', '选择更新已有 Wiki 时必须指定目标页面。', 400);
    if (item.reviewDecision === 'defer') page.selected = false;
  }
  if (item.title !== undefined) {
    if (!item.title.trim()) throw new DraftError('INVALID_FIELD', '标题不能为空。', 400);
    setField('title', item.title.trim());
  }
  if (item.type !== undefined) {
    if (!context.rules.types.includes(item.type)) throw new DraftError('INVALID_TYPE', '知识类型无效。', 400);
    if (item.type !== page.type && (hasTemplateFields(page.templateFields) || page.mergedTemplateFields?.length))
      throw new DraftError('TEMPLATE_TYPE_CHANGE_UNSUPPORTED', '本批不支持带字段归位的类型切换，原内容已保留。', 409);
    setField('type', item.type);
  }
  if (item.templateFields !== undefined) {
    if (!validTemplateFields(item.templateFields, page.type))
      throw new DraftError('INVALID_TEMPLATE_FIELDS', '字段归位格式或字段名称无效。', 400);
    const normalized = normalizedFields(item.templateFields, page.templateFields);
    setField('templateFields', hasTemplateFields(normalized) ? normalized : undefined);
    if (page.templateFields === undefined) delete page.templateFields;
  }
  if (item.mergedTemplateFields !== undefined) {
    if (
      !validMergedTemplateFields(item.mergedTemplateFields) ||
      item.mergedTemplateFields.length !== page.mergedTemplateFields?.length
    )
      throw new DraftError('MERGED_FIELDS_IMMUTABLE', '合并字段组身份与原目录只读；只能编辑组内字段。', 409);
    const groups = item.mergedTemplateFields.map((group, i) => {
      const old = page.mergedTemplateFields![i],
        identity = omitKeys(old, ['fields']),
        { fields, ...incoming } = group;
      if (JSON.stringify(identity) !== JSON.stringify(incoming))
        throw new DraftError('MERGED_FIELDS_IMMUTABLE', '合并字段组身份、顺序与原事实/证据目录只读。', 409);
      return { ...old, fields: normalizedFields(fields, old.fields) };
    });
    setField('mergedTemplateFields', groups);
  }
  if (item.category !== undefined) {
    if (!context.rules.categories.includes(item.category)) throw new DraftError('INVALID_CATEGORY', '分类无效。', 400);
    setField('category', item.category);
  }
  if (item.one_line_definition !== undefined) {
    if (!item.one_line_definition.trim()) throw new DraftError('INVALID_FIELD', '一句话定义不能为空。', 400);
    setField('one_line_definition', item.one_line_definition.trim());
  }
  if (item.ai_organized !== undefined)
    setField('ai_organized', item.ai_organized.map((value) => value.trim()).filter(Boolean));
  if (item.ai_inferences !== undefined)
    setField('ai_inferences', item.ai_inferences.map((value) => value.trim()).filter(Boolean));
  if (item.related_pages !== undefined)
    setField('related_pages', item.related_pages.map((value) => value.trim()).filter(Boolean));
  // Original questions are immutable, including whitespace and duplicate occurrences.
  if (item.source_evidence !== undefined) {
    const located: DraftEvidence[] = item.source_evidence.map((evidence) => {
      if (evidence.rawId !== undefined && evidence.rawId !== rawId) {
        throw new DraftError('EVIDENCE_INVALID_SOURCE', '证据的 rawId 不能改成本条 Raw 之外的值。', 422);
      }
      if (!evidence.id?.trim()) throw new DraftError('EVIDENCE_ID_REQUIRED', '证据必须有 id。', 400);
      const existing = page.source_evidence.find((current) => current.id === evidence.id);
      if (existing?.media) {
        if (evidence.quote !== existing.quote || evidence.start !== existing.start || evidence.end !== existing.end)
          throw new DraftError('EVIDENCE_INVALID_SOURCE', '图片解析证据不能改写或换用原文位置。', 422);
        return existing;
      }
      try {
        const result = locateEvidenceInBody(
          { id: evidence.id, rawId, quote: evidence.quote, start: evidence.start, end: evidence.end },
          context.body,
          rawId,
        );
        return {
          id: result.id,
          rawId,
          quote: result.quote,
          start: result.start,
          end: result.end,
          chunkIndex: page.source_evidence.find((current) => current.id === result.id)?.chunkIndex ?? -1,
        };
      } catch (error) {
        const llmError = error as LlmError;
        throw new DraftError(llmError.code ?? 'EVIDENCE_INVALID', llmError.message, 422, llmError.details);
      }
    });
    const ids = new Set<string>();
    for (const evidence of located) {
      if (ids.has(evidence.id)) throw new DraftError('EVIDENCE_DUPLICATE_ID', `证据 id ${evidence.id} 重复。`, 422);
      ids.add(evidence.id);
    }
    setField('source_evidence', located);
  }
  if (item.source_facts !== undefined && JSON.stringify(item.source_facts) !== JSON.stringify(page.source_facts)) {
    const facts = item.source_facts.map((fact) => ({
      text: String(fact.text ?? '').trim(),
      evidenceIds: [...(fact.evidenceIds ?? [])],
    }));
    if (!facts.length)
      throw new DraftError('INVALID_FIELD', '来源事实不能全部删除；没有事实的条目请改为推断或删除该建议。', 400);
    for (const fact of facts) {
      if (!fact.text) throw new DraftError('INVALID_FIELD', '来源事实内容不能为空。', 400);
      if (!fact.evidenceIds.length)
        throw new DraftError('FACT_WITHOUT_EVIDENCE', `来源事实「${fact.text.slice(0, 20)}…」缺少证据引用。`, 422);
    }
    setField('source_facts', facts);
  }
  if (item.knowledge_status !== undefined) {
    if (!context.rules.knowledge_status.includes(item.knowledge_status))
      throw new DraftError('INVALID_FIELD', '知识状态无效。', 400);
    setField('knowledge_status', item.knowledge_status);
  }
  if (item.confidence !== undefined) {
    if (!context.rules.confidence.includes(item.confidence)) throw new DraftError('INVALID_FIELD', '可信度无效。', 400);
    setField('confidence', item.confidence);
  }
  if (item.source_level !== undefined) {
    if (!context.rules.source_level.includes(item.source_level))
      throw new DraftError('INVALID_FIELD', '来源等级无效。', 400);
    setField('source_level', item.source_level);
  }
  if (edited.size) page.editedFields = [...edited];
}

export function applyDraftMerge(next: DraftRecord, merge: { pageIds: string[]; title?: string }): void {
  const ids = [...new Set(merge.pageIds)];
  if (ids.length < 2) throw new DraftError('INVALID_MERGE', '合并至少需要选择两条建议。', 400);
  const targets = ids.map((id) => next.pages.find((page) => page.pageId === id));
  if (targets.some((page) => !page)) throw new DraftError('NOT_FOUND', '合并目标里有不存在的建议。', 404);
  const pages = targets as DraftPage[];
  const [first, ...rest] = pages;
  const merged: DraftPage = JSON.parse(JSON.stringify(first)) as DraftPage;
  const groups = [...(first.mergedTemplateFields ?? [])];
  for (const page of rest) {
    if (hasTemplateFields(page.templateFields)) {
      const snapshot = omitKeys(captureTemplateFields(page, next.rawId, next.humanReview!)!, ['mergedTemplateFields']);
      groups.push({ ...snapshot, title: page.title });
    }
    groups.push(...(page.mergedTemplateFields ?? []));
  }
  if (groups.length)
    merged.mergedTemplateFields = structuredClone([...new Map(groups.map((group) => [group.pageId, group])).values()]);
  merged.selected = pages.some((page) => page.selected);
  merged.title = merge.title?.trim() || first.title;
  merged.mergedFrom = [
    ...new Set([
      ...(first.mergedFrom ?? [first.title]),
      ...pages.slice(1).flatMap((page) => page.mergedFrom ?? [page.title]),
    ]),
  ];
  merged.provenance = [];
  for (const page of pages)
    for (const entry of page.provenance) {
      if (
        !merged.provenance.some((current) => current.chunkIndex === entry.chunkIndex && current.start === entry.start)
      )
        merged.provenance.push({ ...entry });
    }
  const evidenceSeen = new Map<string, DraftEvidence>();
  const firstEvidence = structuredClone(first.source_evidence);
  merged.source_evidence = [];
  // F04-07: rebuild the fact list from every merged page. Facts keep their identity as facts
  // (never moved into inferences); equal facts are deduplicated and their evidence combined.
  merged.source_facts = [];
  for (const page of pages) {
    const rename = new Map<string, string>();
    for (const evidence of page.source_evidence) {
      const taken = evidenceSeen.get(evidence.id);
      if (!taken) {
        evidenceSeen.set(evidence.id, evidence);
        merged.source_evidence.push({ ...evidence });
        rename.set(evidence.id, evidence.id);
        continue;
      }
      if (taken.quote === evidence.quote && taken.start === evidence.start) {
        rename.set(evidence.id, taken.id);
        continue;
      }
      let candidate = `${evidence.id}-m${merged.source_evidence.length + 1}`;
      while (evidenceSeen.has(candidate)) candidate = `${candidate}x`;
      evidenceSeen.set(candidate, evidence);
      merged.source_evidence.push({ ...evidence, id: candidate });
      rename.set(evidence.id, candidate);
    }
    for (const fact of page.source_facts) {
      const idsForFact = fact.evidenceIds.map((id) => rename.get(id) ?? id);
      const duplicate = merged.source_facts.find((item) => item.text === fact.text);
      if (duplicate) {
        for (const id of idsForFact) {
          if (!duplicate.evidenceIds.includes(id)) duplicate.evidenceIds.push(id);
        }
      } else {
        merged.source_facts.push({ text: fact.text, evidenceIds: idsForFact });
      }
    }
  }
  merged.ai_organized = [...new Set(pages.flatMap((page) => page.ai_organized))];
  merged.ai_inferences = [...new Set(pages.flatMap((page) => page.ai_inferences))];
  merged.open_questions = [...new Set(pages.flatMap((page) => page.open_questions))];
  merged.related_pages = [
    ...new Set(pages.flatMap((page) => page.related_pages).filter((title) => title !== merged.title)),
  ];
  merged.notes = [
    ...new Set([
      ...(merged.notes ?? []),
      ...rest.flatMap((page) => page.notes ?? []),
      `由用户合并 ${pages.length} 条建议（${pages.map((page) => page.title).join('、')}）。`,
    ]),
  ];
  merged.editedFields = [...new Set([...(merged.editedFields ?? []), 'merge'])];
  merged.knowledge_status = pages.some((page) => page.knowledge_status === 'ai_organized')
    ? 'ai_organized'
    : first.knowledge_status;
  merged.confidence = pages.some((page) => page.confidence === 'low') ? 'low' : first.confidence;
  // Human review below rebuilds canonical aliases; preserve the first page's old namespace for its fields.
  merged.source_evidence = firstEvidence;
  next.pages = [...next.pages.filter((page) => !ids.includes(page.pageId)), merged];
  if (next.humanReview) {
    next.humanReview.approvals = [];
    delete next.noteApproval;
    for (const unit of next.humanReview.units)
      if (ids.includes(next.humanReview.assignments[unit.id] ?? ''))
        next.humanReview.assignments[unit.id] = merged.pageId;
  }
}

export function applyDraftPatchRecord(
  helpers: DraftPatchHelpers,
  current: DraftRecord | undefined,
  patch: DraftPatch,
  context: { body: string; rules: DraftRules },
): DraftRecord {
  if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
  if (current.status === 'committing')
    throw new DraftError('DRAFT_COMMITTING', '这份草稿正在提交，暂不能编辑；请先查看提交状态。', 409);
  if (current.status !== 'pending_confirmation')
    throw new DraftError('DRAFT_NOT_EDITABLE', `草稿状态为 ${current.status}，不能再编辑。`, 409);
  if (patch.baseRevision !== current.revision) {
    throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅。', 409, {
      currentRevision: current.revision,
    });
  }
  if (current.maintenance && (patch.merge || patch.deletePageIds?.length))
    throw new DraftError('INVALID_PATCH', '请在成果页调整动作和目标来归并知识维护成果。', 409);
  const next: DraftRecord = JSON.parse(JSON.stringify(current)) as DraftRecord;
  if (!next.humanReview && (patch.merge || patch.deletePageIds?.length))
    throw new DraftError('HUMAN_REVIEW_REQUIRED', '请先开始审查以保存不可变来源目录，再合并或删除页面。', 409);
  // Source records are read-only even for an old draft before migration.
  for (const item of patch.pages ?? []) {
    if (Object.keys(item).some((k) => ['humanReview', 'reviewBasis', 'reviewContentDigest', 'reviewView'].includes(k)))
      throw new DraftError('INVALID_PATCH', '不能通过页面编辑写入审查字段。');
    const original = current.pages.find((p) => p.pageId === item.pageId);
    if (original)
      for (const key of ['source_facts', 'source_evidence', 'open_questions'] as const) {
        const normalized = (value: unknown) =>
          key === 'source_evidence'
            ? (value as DraftEvidence[]).map(({ id, rawId, quote, start, end }) => ({
                id,
                rawId: rawId ?? current.rawId,
                quote,
                start,
                end,
              }))
            : value;
        if (
          item[key] !== undefined &&
          JSON.stringify(normalized(item[key])) !== JSON.stringify(normalized(original[key]))
        )
          throw new DraftError(
            'SOURCE_RECORD_IMMUTABLE',
            '原事实、原问题和来源证据只读；请移动完整 unit 或添加人工说明。',
            409,
          );
      }
  }
  if (patch.document) {
    next.document = { ...next.document, ...patch.document };
    for (const key of ['title', 'main_topic', 'summary'] as const) {
      const value = next.document[key];
      if (typeof value !== 'string' || !value.trim())
        throw new DraftError('INVALID_FIELD', `摘要字段 ${key} 不能为空。`, 400);
    }
  }
  const incomingTakeaways = patch.source?.key_takeaways;
  const incomingSource = patch.source;
  if (patch.source && incomingSource) {
    const incoming = incomingSource;
    // F04-01: distinguish "the user edited the Source content" from "the body must be
    // re-rendered for a new selection". Only a real body edit freezes the body text.
    const sourceFields = [
      'title',
      'summary',
      'category',
      'knowledge_status',
      'confidence',
      'source_level',
      'key_takeaways',
    ] as const;
    const contentChanged = sourceFields.some(
      (key) => incoming[key] !== undefined && JSON.stringify(incoming[key]) !== JSON.stringify(current.source[key]),
    );
    const bodyChanged = incoming.body !== undefined && incoming.body !== current.source.body;
    next.source = {
      ...next.source,
      ...incoming,
      reuseWikiId: current.source.reuseWikiId,
      ...(current.source.editedByUser || contentChanged || bodyChanged ? { editedByUser: true } : {}),
      ...(current.source.bodyEditedByUser || bodyChanged ? { bodyEditedByUser: true } : {}),
    };
    if (!next.source.title.trim()) throw new DraftError('INVALID_FIELD', 'Source 标题不能为空。', 400);
    if (typeof next.source.body !== 'string' || !next.source.body.trim())
      throw new DraftError('INVALID_FIELD', 'Source 正文不能为空。', 400);
    for (const key of ['category', 'knowledge_status', 'confidence', 'source_level'] as const) {
      const allowed =
        key === 'category'
          ? context.rules.categories
          : key === 'confidence'
            ? context.rules.confidence
            : key === 'source_level'
              ? context.rules.source_level
              : context.rules.knowledge_status;
      if (!allowed.includes(next.source[key]))
        throw new DraftError('INVALID_FIELD', `Source 的 ${key} 取值无效。`, 400);
    }
  }
  if (patch.deletePageIds?.length) {
    const removing = new Set(patch.deletePageIds);
    const kept = next.pages.filter((page) => !removing.has(page.pageId));
    if (!kept.length) throw new DraftError('NO_PAGES_LEFT', '至少要保留一条知识建议。', 400);
    if (patch.pages?.some((item) => removing.has(item.pageId)))
      throw new DraftError('INVALID_PATCH', '同一次请求里既删除又修改了同一条建议。', 400);
    next.pages = kept;
  }
  for (const item of patch.pages ?? []) {
    const page = next.pages.find((candidate) => candidate.pageId === item.pageId);
    if (!page) throw new DraftError('NOT_FOUND', `草稿里没有页面 ${item.pageId}。`, 404);
    helpers.applyPagePatch(page, item, context, next.rawId);
  }
  if (patch.merge) helpers.applyMerge(next, patch.merge);
  if (next.humanReview) {
    for (const unit of next.humanReview.units)
      if (
        next.humanReview.assignments[unit.id] !== null &&
        !next.pages.some((p) => p.pageId === next.humanReview!.assignments[unit.id])
      )
        next.humanReview.assignments[unit.id] = null;
    helpers.deriveReviewPages(next, !!patch.merge);
  }
  for (const page of next.pages) helpers.validatePage(page, context.rules);
  for (const page of next.pages)
    helpers.validateTemplateReferences(
      page,
      next.rawId,
      current.pages.find((p) => p.pageId === page.pageId),
      next.humanReview,
    );
  // F04-05: the Source body and its Key Takeaways list exactly the pages that would be
  // created, unless the user has written their own body text.
  const takeawaysUnchanged =
    incomingTakeaways === undefined ||
    JSON.stringify(incomingTakeaways) === JSON.stringify(current.source.key_takeaways);
  if (takeawaysUnchanged) next.source.key_takeaways = derivedTakeaways(next.pages.filter((page) => page.selected));
  if (!next.source.bodyEditedByUser) {
    next.source.body = renderSourceBody(
      next.source,
      next.rawMeta,
      next.pages.filter((page) => page.selected),
      next.pages.filter((page) => !page.selected),
    );
  }
  if (JSON.stringify(candidateContent(next)) === JSON.stringify(candidateContent(current))) return current;
  if (next.maintenance) for (const c of next.maintenance.changes) delete c.approval;
  if (next.humanReview) next.humanReview.approvals = [];
  delete next.noteApproval;
  next.revision = current.revision + 1;
  next.updatedAt = new Date().toISOString();
  helpers.assertRoundtripSize(next);

  return next;
}
