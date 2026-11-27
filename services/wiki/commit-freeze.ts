import { randomUUID } from 'node:crypto';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { derivedTakeaways, isQuestionDraft, type DraftRecord, type KnowledgeDraftRecord } from './drafts.ts';
import { assertMaintenanceReviewed, maintenanceDigest, type KnowledgeChange } from './maintenance.ts';
import { withPdfDerivation } from './pdf-input.ts';
import { pdfOriginalPageLink, renderConfirmedNote, renderPageBody, renderSourceBody } from './render.ts';
import { assertWikiSourcesAllowed } from './source-lineage.ts';
import type { WikiRecord } from './store.ts';
import { escapeNoteText } from './structured-note.ts';
import {
  CommitError,
  commitSha256,
  normalizeCommitTitle,
  reviewProjection,
  type CommitSnapshot,
  type WikiCommitDeps,
} from './commit-types.ts';

/** The Source body written on confirm: the user's own text, or the body re-rendered from the
 * actual selection (F04-05) using the real Raw metadata (F04-06). */
export function sourceBodyFor(
  draft: DraftRecord,
  selectedPages: DraftRecord['pages'],
  outcomeReviewed = false,
  knownWikiTitles?: Set<string>,
): string {
  if (draft.structuredNote) {
    const selectedIds = new Set(selectedPages.map((p) => p.pageId));
    let body = draft.source.bodyEditedByUser
      ? draft.source.body
      : renderSourceBody(
          { ...draft.source, key_takeaways: draft.source.key_takeaways },
          draft.rawMeta,
          selectedPages,
          draft.pages.filter((p) => !selectedIds.has(p.pageId)),
        );
    if (/^## 深度整理笔记\s*$/m.test(body))
      throw new CommitError(
        'SOURCE_NOTE_SECTION_CONFLICT',
        'Source摘要已含深度笔记标题，请先移除重复章节再审核。',
        409,
      );
    const created = new Set(selectedPages.map((p) => p.title));
    body = body.replace(/\[\[([^\]]+)\]\]/g, (link, title: string) =>
      created.has(title.trim()) || knownWikiTitles?.has(normalizeCommitTitle(title)) ? link : escapeNoteText(link),
    );
    return body.trimEnd() + '\n\n' + renderConfirmedNote(draft, outcomeReviewed);
  }
  if (draft.source.bodyEditedByUser) {
    if (!outcomeReviewed) return draft.source.body;
    const selectedIds = new Set(selectedPages.map((page) => page.pageId));
    const selectedTitles = new Set(selectedPages.map((page) => normalizeCommitTitle(page.title)));
    const skippedTitles = new Set(
      draft.pages.filter((page) => !selectedIds.has(page.pageId)).map((page) => normalizeCommitTitle(page.title)),
    );
    return draft.source.body.replace(/\[\[([^\]]+)\]\]/gu, (link, title: string) => {
      const key = normalizeCommitTitle(title);
      return skippedTitles.has(key) && !selectedTitles.has(key) && !knownWikiTitles?.has(key)
        ? escapeNoteText(link)
        : link;
    });
  }
  // F04-05: every derived section (links, takeaways, 「本次未创建的建议」) follows the confirmed
  // selection, which the public confirm API receives independently of the draft's flags.
  const confirmedIds = new Set(selectedPages.map((page) => page.pageId));
  const skippedPages = draft.pages.filter((page) => !confirmedIds.has(page.pageId));
  return renderSourceBody(
    { ...draft.source, key_takeaways: derivedTakeaways(selectedPages) },
    draft.rawMeta,
    selectedPages,
    skippedPages,
  );
}

/** F04-04: stable fingerprint of exactly what the user asked to write. */
export function payloadDigest(
  draft: DraftRecord,
  selectedPages: DraftRecord['pages'],
  effectiveSourceTitle: string,
  reuseSourceId: string | undefined,
): string {
  const projection = {
    ...(draft.maintenance
      ? {
          maintenanceDigest: maintenanceDigest(
            reviewProjection(
              draft,
              selectedPages.map((p) => p.pageId),
            ),
          ),
        }
      : {}),
    rawId: draft.rawId,
    rawSha256: draft.rawSha256,
    reuseSourceId: reuseSourceId ?? null,
    selectedPageIds: selectedPages.map((page) => page.pageId),
    pages: selectedPages.map((page) => ({
      title: page.title,
      type: page.type,
      category: page.category,
      knowledge_status: page.knowledge_status,
      confidence: page.confidence,
      source_level: page.source_level,
      facts: page.source_facts,
      evidence: page.source_evidence.map((item) => [
        item.id,
        item.quote,
        item.start,
        item.end,
        ...(item.media ? [item.media] : []),
      ]),
      ...(page.templateFields ? { templateFields: page.templateFields } : {}),
    })),
    source: reuseSourceId
      ? { reused: true, title: effectiveSourceTitle }
      : {
          title: draft.source.title,
          category: draft.source.category,
          body: sourceBodyFor(draft, selectedPages),
          knowledge_status: draft.source.knowledge_status,
          confidence: draft.source.confidence,
          source_level: draft.source.source_level,
        },
  };
  return commitSha256(JSON.stringify(projection));
}

export async function maintenanceSource(
  deps: WikiCommitDeps,
  draft: DraftRecord,
): Promise<{ reuseSourceId?: string; reuseSourceTitle?: string }> {
  const sources = (await deps.wikiStore.allRecords()).filter(
    (p) => p.type === 'source' && p.sources.length === 1 && p.sources[0] === draft.rawId,
  );
  if (sources.length > 1) throw new CommitError('SOURCE_AMBIGUOUS', '同Raw存在多个Source，请人工处理。', 409);
  return sources[0] ? { reuseSourceId: sources[0].id, reuseSourceTitle: sources[0].title } : {};
}

export async function checkConflicts(
  deps: WikiCommitDeps,
  draft: DraftRecord,
  selectedPages: DraftRecord['pages'],
): Promise<{ reuseSourceId?: string; reuseSourceTitle?: string }> {
  const existing = await deps.wikiStore.allRecords();
  const byTitle = new Map<string, WikiRecord>();
  for (const page of existing) {
    byTitle.set(normalizeCommitTitle(page.title), page);
    for (const alias of page.aliases)
      if (!byTitle.has(normalizeCommitTitle(alias))) byTitle.set(normalizeCommitTitle(alias), page);
  }
  const boundSources = existing.filter(
    (page) => page.type === 'source' && page.sources.length === 1 && page.sources[0] === draft.rawId,
  );
  if (draft.structuredNote && boundSources.length)
    throw new CommitError('DEEP_SOURCE_EXISTS', '同一Raw已有Source，本轮不能覆盖或丢弃新笔记，请保留草稿处理。', 409);
  if (boundSources.length > 1) {
    throw new CommitError(
      'SOURCE_AMBIGUOUS',
      `这条 Raw 已有 ${boundSources.length} 个 Source 页面，归属不明；本批不自动合并或更新旧 Source，请人工处理后再确认。`,
      409,
      { sources: boundSources.map((page) => ({ id: page.id, title: page.title })) },
    );
  }
  const reuseSourceId = boundSources.length === 1 ? boundSources[0].id : undefined;
  const reuseSourceTitle = boundSources.length === 1 ? boundSources[0].title : undefined;
  const effectiveSourceTitle = reuseSourceTitle ?? draft.source.title;
  const titles = [...selectedPages.map((page) => page.title), effectiveSourceTitle];
  const seen = new Map<string, string>();
  for (const title of titles) {
    const key = normalizeCommitTitle(title);
    const duplicated = seen.get(key);
    if (duplicated)
      throw new CommitError(
        'BATCH_TITLE_CONFLICT',
        `本次确认里有重复标题「${title}」与「${duplicated}」，请先改名或合并建议。`,
        409,
        { titles },
      );
    seen.set(key, title);
  }
  for (const title of titles) {
    const owner = byTitle.get(normalizeCommitTitle(title));
    if (!owner) continue;
    const explicitCreate = selectedPages.some((page) => page.title === title && page.reviewDecision === 'create');
    // B05: an explicit persisted create decision permits a distinct stable ID even when a
    // title/alias match exists. Legacy B04 drafts still follow the conflict gate below.
    if (explicitCreate) continue;
    if (
      reuseSourceId &&
      owner.id === reuseSourceId &&
      normalizeCommitTitle(title) === normalizeCommitTitle(effectiveSourceTitle)
    )
      continue;
    throw new CommitError(
      'WIKI_TITLE_CONFLICT',
      `标题或别名「${title}」已被现有 Wiki「${owner.title}」（${owner.id}）占用；请改名，或返回审核页选择“更新已有页”“仍创建新页”或“暂不处理”。显式新建会生成独立页面，关联链接可能产生歧义。`,
      409,
      { title, existingId: owner.id, existingTitle: owner.title, batch: 'B05' },
    );
  }
  return { reuseSourceId, reuseSourceTitle };
}

export function freezeCommitSnapshot(
  deps: WikiCommitDeps,
  draft: DraftRecord,
  selectedPages: DraftRecord['pages'],
  raw: { id: string; title: string; tags: string[] },
  reuseSourceId: string | undefined,
  reuseSourceTitle: string | undefined,
  warnings: string[],
  now: string,
  outcomeReview?: CommitSnapshot['outcomeReview'],
  knownWikiTitles?: Set<string>,
): CommitSnapshot {
  // F04-05: pages must link the Source they will actually have — the reused page's real title.
  const effectiveSourceTitle = reuseSourceTitle ?? draft.source.title;
  const createdTitles = new Set([...selectedPages.map((page) => page.title), effectiveSourceTitle]);
  const base = {
    domain: 'fmcg' as const,
    created: now,
    updated: now,
    revision: 1,
    aliases: [] as string[],
    tags: [...(raw.tags ?? [])],
  };
  const pageRecords: WikiRecord[] = selectedPages.map((page) => ({
    ...base,
    id: randomUUID(),
    title: page.title,
    type: page.type as WikiRecord['type'],
    category: page.category,
    sources: [draft.rawId],
    knowledge_status: page.knowledge_status as WikiRecord['knowledge_status'],
    confidence: page.confidence as WikiRecord['confidence'],
    source_level: page.source_level as WikiRecord['source_level'],
    review_status: 'unreviewed',
    body: renderPageBody(page, { sourceTitle: effectiveSourceTitle, rawId: draft.rawId, createdTitles }),
  }));
  const sourceRecord: WikiRecord | undefined = reuseSourceId
    ? undefined
    : {
        ...base,
        id: randomUUID(),
        title: draft.source.title,
        type: 'source',
        category: draft.source.category,
        sources: [draft.rawId],
        knowledge_status: draft.source.knowledge_status as WikiRecord['knowledge_status'],
        confidence: draft.source.confidence as WikiRecord['confidence'],
        source_level: draft.source.source_level as WikiRecord['source_level'],
        review_status: 'unreviewed',
        // F04-05/F04-06: rendered from the created pages and the real Raw metadata.
        body: sourceBodyFor(draft, selectedPages, !!outcomeReview, knownWikiTitles),
      };
  const digests: Record<string, string> = {};
  for (const record of [...pageRecords, ...(sourceRecord ? [sourceRecord] : [])]) {
    digests[record.id] = commitSha256(deps.wikiStore.pageContent(record));
  }
  return {
    ...(outcomeReview
      ? { outcomeReview }
      : !draft.maintenance && draft.structuredNote
        ? {
            deepNote: {
              note: structuredClone(draft.structuredNote),
              ...(draft.noteReview ? { metadata: structuredClone(draft.noteReview) } : {}),
              approval: structuredClone(draft.noteApproval!),
              humanReview: structuredClone(draft.humanReview!),
              reviewDigest: deps.drafts.contentDigest(draft),
            },
          }
        : {}),
    capturedRevision: draft.revision,
    document: draft.document,
    selectedPageIds: selectedPages.map((page) => page.pageId),
    ...(sourceRecord ? { sourceRecord } : {}),
    ...(reuseSourceId ? { reuseSourceId } : {}),
    ...(reuseSourceTitle ? { reuseSourceTitle } : {}),
    pageRecords,
    digests,
    warnings,
  };
}

export async function freezeMaintenanceSnapshot(
  deps: WikiCommitDeps,
  snapshot: CommitSnapshot,
  draft: KnowledgeDraftRecord,
  selectedPages: DraftRecord['pages'],
  now: string,
  outcomeChanges?: KnowledgeChange[],
) {
  const question = isQuestionDraft(draft),
    incomingRawIds = question ? draft.input.rawSnapshots.map((r) => r.id) : [draft.rawId];
  const digest = snapshot.outcomeReview?.digest ?? assertMaintenanceReviewed(draft);
  const changes =
    outcomeChanges ?? draft.maintenance!.changes.filter((c) => c.decision === 'accept' && !c.committedOperationId);
  const selected = selectedPages.map((p) => p.pageId).sort();
  if (JSON.stringify(selected) !== JSON.stringify(changes.map((c) => draft.pages[c.pageIndex].pageId).sort()))
    throw new CommitError('REVIEW_SELECTION_CHANGED', '提交选集与已接受的变更不一致。', 409);
  const all = await deps.wikiStore.allRecords(),
    before: Record<string, WikiRecord> = {},
    actions: Record<string, 'create' | 'update' | 'link'> = {},
    records: WikiRecord[] = [],
    resultWikiIds: string[] = [];
  const proposed = changes.map((c) => c.candidate.title);
  if (new Set(proposed.map(normalizeCommitTitle)).size !== proposed.length)
    throw new CommitError('BATCH_TITLE_CONFLICT', '本次变更包含重复标题。', 409);
  for (const c of changes) {
    const occupied = all.find(
      (p) =>
        p.id !== c.targetWikiId &&
        [p.title, ...p.aliases].some((t) =>
          [c.candidate.title, ...c.candidate.aliases].some((v) => normalizeCommitTitle(t) === normalizeCommitTitle(v)),
        ),
    );
    if (occupied)
      throw new CommitError('WIKI_TITLE_CONFLICT', '候选标题或别名已被其他Wiki占用，请修改后重新审核。', 409, {
        wikiId: occupied.id,
        title: occupied.title,
      });
  }
  if (
    snapshot.sourceRecord &&
    all.some((p) =>
      [p.title, ...p.aliases].some(
        (t) => normalizeCommitTitle(t) === normalizeCommitTitle(snapshot.sourceRecord!.title),
      ),
    )
  )
    throw new CommitError('WIKI_TITLE_CONFLICT', '来源笔记标题已被其他Wiki占用，请重新整理或修改来源标题。', 409);
  const acceptedTitles = new Set([
    ...all.flatMap((p) => [p.title, ...p.aliases]),
    ...changes.flatMap((c) => [c.candidate.title, ...c.candidate.aliases]),
    ...(question ? [] : [snapshot.reuseSourceTitle ?? draft.source.title]),
  ]);
  const clean = (body: string) =>
    body.replace(/\[\[([^\]]+)\]\]/gu, (link, title: string) =>
      acceptedTitles.has(title.trim()) ? link : escapeNoteText(link),
    );
  for (const c of changes) {
    const old = c.targetWikiId ? await deps.wikiStore.get(c.targetWikiId) : undefined;
    if (c.targetWikiId && (!old || old.revision !== c.baseRevision))
      throw new CommitError('WIKI_REVISION_CONFLICT', '目标Wiki已变化，请重新整理和审阅；原文不会覆盖。', 409, {
        wikiId: c.targetWikiId,
      });
    if (snapshot.outcomeReview && old) await assertWikiSourcesAllowed(deps.wikiStore, deps.rawStore, old);
    for (const source of c.candidate.sources) assertRawNotMeeting(await deps.rawStore.get(source));
    const id = old?.id ?? randomUUID();
    resultWikiIds.push(id);
    if (c.action === 'noop') {
      if (
        !old ||
        incomingRawIds.some((id) => !old.sources.includes(id)) ||
        c.candidate.title !== old.title ||
        c.candidate.body !== old.body
      )
        throw new CommitError('INVALID_NOOP', '无变化项的正文或来源与目标不一致。', 409);
      continue;
    }
    const exactBody = !!snapshot.outcomeReview && !!c.pageIndexes;
    if (
      !question &&
      draft.pdfInput &&
      old &&
      c.action === 'update' &&
      !c.candidate.body.startsWith(old.body.trimEnd() + '\n\n')
    ) {
      throw new CommitError(
        'PDF_EXISTING_CONTENT_REQUIRED',
        '请保留目标 Wiki 的现有正文，在补充章节中编辑本次 PDF 内容。',
        409,
      );
    }
    if (exactBody && (c.action === 'create' || c.action === 'update')) {
      const unresolved = [...c.candidate.body.matchAll(/\[\[([^\]]+)\]\]/gu)].find(
        ([link, title]) => !acceptedTitles.has(title.trim()) && !old?.body.includes(link),
      );
      if (unresolved)
        throw new CommitError(
          'CHANGE_DEPENDENCY_REQUIRED',
          `候选正文的链接「${unresolved[1]}」尚无正式主题，请选择相关成果或编辑链接。`,
          409,
        );
    }
    const record: WikiRecord =
      old && c.action === 'link'
        ? {
            ...old,
            sources: [...new Set([...old.sources, ...incomingRawIds])],
            updated: now,
            revision: old.revision + 1,
          }
        : ({
            ...(old ?? { id, domain: 'fmcg', created: now, review_status: 'unreviewed' }),
            ...c.candidate,
            id,
            body: exactBody ? c.candidate.body : clean(c.candidate.body),
            updated: now,
            revision: (old?.revision ?? 0) + 1,
          } as WikiRecord);
    if (old && c.action === 'link' && JSON.stringify(record.sources) === JSON.stringify(old.sources)) continue;
    if (!question && draft.pdfInput) {
      const page = draft.pages[c.pageIndex];
      record.pdfDerivations = withPdfDerivation(old?.pdfDerivations, draft, [page]);
      const missingLinks = [...new Set(page.pdfEvidence!.map((item) => item.page))]
        .map((number) => pdfOriginalPageLink(draft.rawId, number))
        .filter((link) => !record.body.includes(link));
      if (missingLinks.length) record.body += '\n\n### PDF 页级依据\n\n' + missingLinks.join('、') + '\n';
    }
    if (question && draft.input.kind === 'inspection') {
      const input = draft.input,
        ids = input.changeFindingIds[c.changeId],
        findings = input.findings.filter((f) => ids.includes(f.id));
      record.inspectionDerivations = [
        ...(old?.inspectionDerivations ?? []),
        {
          inspectionId: input.inspectionId,
          findingIds: ids,
          wikiIds: [...new Set(findings.flatMap((f) => f.wikiIds))],
          rawIds: [...new Set(findings.flatMap((f) => f.evidence.flatMap((e) => e.rawIds)))],
          manualWikiIds: [...new Set(findings.flatMap((f) => f.evidence.flatMap((e) => e.manualWikiIds)))],
        },
      ];
    }
    if (question && draft.input.kind === 'question_answer')
      record.answerDerivations = [
        ...(old?.answerDerivations ?? []),
        {
          answerId: draft.input.resultId,
          answerRevision: draft.input.resultRevision,
          wikiIds: draft.input.wikiSnapshots.map((p) => p.id),
          rawIds: draft.input.rawSnapshots.map((r) => r.id),
          manualWikiIds: [...new Set(draft.input.citations.flatMap((c) => c.manualWikiIds))],
          containsInference: draft.input.sections.some((s) => s.kind === 'inference' || s.kind === 'advice'),
        },
      ];
    if (old) before[id] = old;
    actions[id] = c.action as 'create' | 'update' | 'link';
    records.push(record);
  }
  snapshot.pageRecords = records;
  if (snapshot.reuseSourceId) {
    const source = await deps.wikiStore.get(snapshot.reuseSourceId);
    if (
      !source ||
      source.type !== 'source' ||
      source.sources.length !== 1 ||
      question ||
      source.sources[0] !== draft.rawId
    )
      throw new CommitError('SOURCE_BINDING_CHANGED', '已有Source与Raw绑定不一致。', 409);
    const missing = changes
      .filter((c) => !snapshot.outcomeReview || c.action !== 'noop')
      .map((c) => c.candidate.title)
      .filter((title) => !source.body.includes('[[' + title + ']]'));
    if (missing.length) {
      snapshot.sourceRecord = {
        ...source,
        body:
          source.body.trimEnd() +
          '\n\n## 本次关联知识\n' +
          [...new Set(missing)].map((t) => '- [[' + t + ']]').join('\n') +
          '\n',
        revision: source.revision + 1,
        updated: now,
      };
      before[source.id] = source;
      actions[source.id] = 'link';
    }
    if (!question && draft.pdfInput && !snapshot.sourceRecord) {
      snapshot.sourceRecord = { ...source, revision: source.revision + 1, updated: now };
      before[source.id] = source;
      actions[source.id] = 'link';
    }
  }
  if (!question && draft.pdfInput && snapshot.sourceRecord) {
    const source = snapshot.sourceRecord;
    source.pdfDerivations = withPdfDerivation(source.pdfDerivations, draft, selectedPages);
    const { startPage, endPage, pageCount } = draft.pdfInput;
    const href = '/api/raw/' + draft.rawId + '/pdf/original#page=';
    const range = startPage === endPage ? '第 ' + startPage + ' 页' : '第 ' + startPage + '–' + endPage + ' 页';
    const note =
      'PDF 整理范围：[' +
      range +
      '](' +
      href +
      startPage +
      ')（原件共 ' +
      pageCount +
      ' 页）。页图内容为 AI 解读，可在成果中回看原页。';
    if (!source.body.includes(note)) source.body = source.body.trimEnd() + '\n\n' + note + '\n';
  }
  if (snapshot.sourceRecord && (question || !draft.pdfInput || !snapshot.reuseSourceId))
    snapshot.sourceRecord.body = clean(snapshot.sourceRecord.body);
  snapshot.digests = Object.fromEntries(
    [...records, ...(snapshot.sourceRecord ? [snapshot.sourceRecord] : [])].map((r) => [
      r.id,
      commitSha256(deps.wikiStore.pageContent(r)),
    ]),
  );
  snapshot.maintenance = {
    version: 1,
    targets: changes.flatMap((c) => (c.targetWikiId ? [all.find((p) => p.id === c.targetWikiId)!] : [])),
    before,
    actions,
    changeIds: changes.map((c) => c.changeId),
    resultWikiIds,
    reviewDigest: digest,
    ...(snapshot.outcomeReview && changes.length > 0 && changes.every((c) => c.action === 'noop')
      ? { noChanges: true as const }
      : {}),
  };
}
