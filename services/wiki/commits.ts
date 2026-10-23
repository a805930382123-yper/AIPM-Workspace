// B04: confirmed-commit transactions. Nothing formal is written before the frozen manifest is
// persisted; a failure mid-way is reported honestly (operationId + which targets exist) and the
// same operation is resumed from the manifest instead of asking the user to confirm again.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {isCommitManifest} from '../storage/record-validators.ts';
import { SerialQueue, StorageError, scanJsonRecords, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { derivedTakeaways, type DraftRecord, type DraftStore } from './drafts.ts';
import { renderPageBody, renderSourceBody } from './render.ts';
import { WikiError, WikiStore, type WikiRecord } from './store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type { RawStateStore } from '../raw/state.ts';
import { findDuplicateCandidates } from '../search/duplicates.ts';

export type CommitPhaseName = 'source' | 'pages' | 'index' | 'log' | 'state';
export type CommitPhase = { name: CommitPhaseName; status: 'pending' | 'done' | 'failed'; at?: string; error?: string };
export type CommitStatus = 'prepared' | 'committing' | 'completed' | 'failed';

export type CommitSnapshot = {
  capturedRevision: number;
  document: { title: string; main_topic: string; summary: string };
  selectedPageIds: string[];
  sourceRecord?: WikiRecord;
  reuseSourceId?: string;
  /** F04-05: the real title of the reused Source, used for the new pages' Wikilinks. */
  reuseSourceTitle?: string;
  pageRecords: WikiRecord[];
  digests: Record<string, string>;
  warnings: string[];
};
export type CommitManifest = {
  humanReviewDigest?: string; humanReviewBasisDigest?: string;
  legacyRecovery?: 'verified_partial'; awaitingHumanReview?: boolean; supersededBy?: string;
  operationId: string; draftId: string; idempotencyKey: string;
  rawId: string; rawSha256: string; rawTitle: string;
  /** F04-04: digest of the frozen payload; a retry compares payloads, not idempotency keys. */
  payloadDigest?: string;
  status: CommitStatus; createdAt: string; updatedAt: string; completedAt?: string;
  provider: { name: string; model: string };
  snapshot: CommitSnapshot;
  phases: CommitPhase[];
  writtenWikiIds: string[];
  error?: { code: string; message: string; at: string; phase?: string; cause?: { code: string; message: string } };
  recoveryHint?: string;
  responseLost?: boolean;
};

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim().replace(/\s+/gu, ' ');

export class CommitError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}

export class WikiCommitService {
  private readonly queue = new SerialQueue();
  constructor(private readonly deps: {
    root: string; wikiStore: WikiStore; drafts: DraftStore; rawStates: RawStateStore;
    rawStore: { get(id: string): Promise<{ id: string; title: string; body: string; bodySha256: string; tags: string[] } | undefined> };
  }) {}
  private directory() { return path.join(this.deps.root, 'state', 'wiki-commits'); }
  private fileFor(operationId: string) { return path.join(this.directory(), `${operationId}.json`); }

  async initialize() { await mkdir(this.directory(), { recursive: true }); }

  async get(operationId: string): Promise<CommitManifest | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return undefined;
    const m=await readJsonRecord<CommitManifest>(this.deps.root,this.fileFor(operationId),(v):v is CommitManifest=>isCommitManifest(v,operationId));if(m===undefined)return undefined;if(!isCommitManifest(m,operationId))throw new StorageError('STORAGE_CORRUPT','提交清单结构无效，原文件已保留；恢复执行已停止。',500,{category:'recovery',nextAction:'inspect_or_restore'});return m;
  }
  async list(): Promise<CommitManifest[]> {
    const records=await scanJsonRecords<CommitManifest>(this.directory(),(v,file):v is CommitManifest=>isCommitManifest(v,path.basename(file,'.json')),this.deps.root);
    return records.records.map(x=>x.value);
  }  async findByDraft(draftId: string): Promise<CommitManifest | undefined> {
    return (await this.list()).find(manifest => manifest.draftId === draftId && !manifest.supersededBy);
  }

  async status(operationId: string): Promise<CommitManifest | undefined> { return this.get(operationId); }

  /** F04-04: stable fingerprint of exactly what the user asked to write. */
  private payloadDigest(draft: DraftRecord, selectedPages: DraftRecord['pages'], effectiveSourceTitle: string, reuseSourceId: string | undefined): string {
    const projection = {
      rawId: draft.rawId, rawSha256: draft.rawSha256, reuseSourceId: reuseSourceId ?? null,
      selectedPageIds: selectedPages.map(page => page.pageId),
      pages: selectedPages.map(page => ({
        title: page.title, type: page.type, category: page.category,
        knowledge_status: page.knowledge_status, confidence: page.confidence, source_level: page.source_level,
        facts: page.source_facts, evidence: page.source_evidence.map(item => [item.id, item.quote, item.start, item.end]),
      })),
      source: reuseSourceId ? { reused: true, title: effectiveSourceTitle } : {
        title: draft.source.title, category: draft.source.category, body: this.sourceBodyFor(draft, selectedPages),
        knowledge_status: draft.source.knowledge_status, confidence: draft.source.confidence, source_level: draft.source.source_level,
      },
    };
    return sha256(JSON.stringify(projection));
  }

  /** The Source body written on confirm: the user's own text, or the body re-rendered from the
   * actual selection (F04-05) using the real Raw metadata (F04-06). */
  private sourceBodyFor(draft: DraftRecord, selectedPages: DraftRecord['pages']): string {
    if (draft.source.bodyEditedByUser) return draft.source.body;
    // F04-05: every derived section (links, takeaways, 「本次未创建的建议」) follows the confirmed
    // selection, which the public confirm API receives independently of the draft's flags.
    const confirmedIds = new Set(selectedPages.map(page => page.pageId));
    const skippedPages = draft.pages.filter(page => !confirmedIds.has(page.pageId));
    return renderSourceBody({ ...draft.source, key_takeaways: derivedTakeaways(selectedPages) }, draft.rawMeta, selectedPages, skippedPages);
  }

  /** Public entry: must be called inside `wikiStore.withLock`. */
  async confirm(input: { draftId: string; baseRevision: number; selectedPageIds: string[]; idempotencyKey: string; operationId: string; now: string }): Promise<{ manifest: CommitManifest; reused: boolean; sourceReused: boolean }> {
    let draft = await this.deps.drafts.get(input.draftId);
    if (!draft) throw new CommitError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
    // F04-04: the same business rule applies to the first confirm and to a retry — every incoming
    // page id must exist before anything is compared. A different request is never silently
    // reduced to the stored one and then reported as a successful reuse.
    const requested = [...new Set(input.selectedPageIds)];
    if (!requested.length) throw new CommitError('NO_SELECTION', '至少选择一条知识建议才能确认写入。', 400);
    for (const id of requested) {
      if (!draft.pages.some(page => page.pageId === id)) {
        throw new CommitError('UNKNOWN_PAGE', `选择中包含草稿里不存在的建议 ${id}。`, 400, { unknownPageId: id, knownPageIds: draft.pages.map(page => page.pageId) });
      }
    }
    const raw = await this.deps.rawStore.get(draft.rawId);
    assertRawNotMeeting(raw);
    let existing = await this.findByDraft(draft.id);
    if(existing&&existing.status!=='completed'&&!existing.humanReviewDigest){
      const onDisk=await this.verifiedTargets(existing);
      if(!onDisk.length){
        if(draft.status==='committing')await this.deps.drafts.resetToPending(draft.id,'旧零写入事务等待逐页人工审查');
        const editable=(await this.deps.drafts.get(draft.id))!;
        const digest=await this.deps.drafts.assertReviewed(editable,raw?.body??'');
        if(input.baseRevision!==editable.revision)throw new CommitError('DRAFT_REVISION_CONFLICT','草稿已变化，请刷新。',409);
        existing.supersededBy=input.operationId;existing.awaitingHumanReview=true;
        await writeJsonAtomic(this.fileFor(existing.operationId),existing);
        existing=undefined;
        draft=editable;
        // The old immutable snapshot remains on disk; a new reviewed operation supersedes it.
        void digest;
      }
    }
    if (existing) {
      // F04-04: the retry semantics are defined by the frozen payload, not by the key: the same
      // payload reuses the original operation (any key), a different payload is rejected.
      const candidatePages = draft.pages.filter(page => requested.includes(page.pageId));
      const candidateDigest = raw
        ? this.payloadDigest(draft, candidatePages, existing.snapshot.reuseSourceTitle ?? draft.source.title, existing.snapshot.reuseSourceId)
        : undefined;
      const samePayload = Boolean(existing.payloadDigest) && candidateDigest === existing.payloadDigest
        && existing.snapshot.selectedPageIds.length === requested.length;
      if (!samePayload) {
        throw new CommitError(
          existing.idempotencyKey === input.idempotencyKey ? 'IDEMPOTENCY_KEY_MISMATCH' : 'CONFIRM_PAYLOAD_CHANGED',
          '这份草稿已按另一份确认内容提交过；请刷新后查看既有提交状态，不要重复确认不同的选择或内容。',
          409,
          { operationId: existing.operationId, status: existing.status, storedSelectedPageIds: existing.snapshot.selectedPageIds, requestedSelectedPageIds: requested },
        );
      }
      if (existing.status === 'completed') return { manifest: existing, reused: true, sourceReused: Boolean(existing.snapshot.reuseSourceId) };
      const resumed = await this.execute(existing);
      return { manifest: resumed, reused: true, sourceReused: Boolean(resumed.snapshot.reuseSourceId) };
    }
    if (draft.status === 'committing' || draft.status === 'confirmed') {
      throw new CommitError('DRAFT_ALREADY_COMMITTED', '这份草稿已经进入提交状态，请刷新后查看提交状态。', 409, { status: draft.status, operationId: draft.commitOperationId });
    }
    if (draft.status !== 'pending_confirmation') throw new CommitError('DRAFT_NOT_CONFIRMABLE', `草稿状态为 ${draft.status}，不能确认写入。`, 409);
    if (input.baseRevision !== draft.revision) {
      throw new CommitError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅再确认。', 409, { currentRevision: draft.revision });
    }
    if (!raw) throw new CommitError('RAW_MISSING', '对应的原始资料不存在（可能已被删除），不能确认写入。', 409);
    if (raw.bodySha256 !== draft.rawSha256) throw new CommitError('RAW_CHANGED', '原始正文的校验值与整理时不一致，已停止写入以避免产生坏来源。', 409);
    const humanReviewDigest=await this.deps.drafts.assertReviewed(draft,raw.body);

    const selectedIds = requested;
    const selectedPages = draft.pages.filter(page => selectedIds.includes(page.pageId));
    for (const page of selectedPages) if (page.reviewDecision === 'update' || page.reviewDecision === 'defer') {
      throw new CommitError('DECISION_MISMATCH', `「${page.title}」已保存为${page.reviewDecision === 'update' ? '更新已有页' : '暂不处理'}，不能作为新建页提交。`, 409, { pageId: page.pageId, decision: page.reviewDecision });
    }
    await this.deps.drafts.assertEvidenceStillValid(draft, raw.body);

    const warnings: string[] = [];
    const conflict = await this.checkConflicts(draft, selectedPages);
    for (const page of selectedPages) {
      const candidates = findDuplicateCandidates({ title: page.title, category: page.category, tags: raw.tags ?? [], content: [page.one_line_definition, ...page.source_facts.map(item => item.text), ...page.ai_organized].join('\n') }, await this.deps.wikiStore.allRecords());
      if (candidates.some(item => item.score >= 0.35) && page.reviewDecision !== 'create') {
        throw new CommitError('DUPLICATE_DECISION_REQUIRED', `「${page.title}」有可能重复的 Wiki 候选，请先查看候选并明确选择更新、新建或暂不处理。`, 409, { pageId: page.pageId, candidates: candidates.filter(item => item.score >= 0.35).map(item => ({ id: item.wiki.id, title: item.wiki.title, score: item.score })) });
      }
    }
    const reuseSourceTitle = conflict.reuseSourceTitle;
    if (conflict.reuseSourceId && reuseSourceTitle) {
      const existingSource = await this.deps.wikiStore.get(conflict.reuseSourceId);
      if (existingSource) {
        const changed = normalize(existingSource.title) !== normalize(draft.source.title)
          || existingSource.body.trim() !== this.sourceBodyFor(draft, selectedPages).trim();
        if (changed) {
          warnings.push(`已复用既有 Source「${existingSource.title}」（${existingSource.id}）：本批不修改既有页面，你在草稿里对 Source 的修改不会写入。`);
        }
      }
    }
    // F04-05: an explicitly edited Source body may still point at pages that are not created now.
    if (draft.source.bodyEditedByUser) {
      const created = new Set([...selectedPages.map(page => page.title), reuseSourceTitle ?? draft.source.title]);
      const linked = [...draft.source.body.matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1].trim());
      const dangling = [...new Set(linked.filter(title => !created.has(title)))];
      if (dangling.length) warnings.push(`人工编辑的 Source 正文包含本次不会创建的链接：${dangling.join('、')}；它们会成为未解析链接，请确认是否符合预期。`);
    }
    const snapshot = this.freeze(draft, selectedPages, raw, conflict.reuseSourceId, reuseSourceTitle, warnings, input.now);
    const manifest: CommitManifest = {
      humanReviewDigest,humanReviewBasisDigest:draft.humanReview!.basisDigest,
      operationId: input.operationId, draftId: draft.id, idempotencyKey: input.idempotencyKey,
      rawId: draft.rawId, rawSha256: draft.rawSha256, rawTitle: draft.rawTitle,
      payloadDigest: this.payloadDigest(draft, selectedPages, reuseSourceTitle ?? draft.source.title, conflict.reuseSourceId),
      status: 'prepared', createdAt: input.now, updatedAt: input.now, provider: draft.provider,
      snapshot, phases: [
        { name: 'source', status: 'pending' }, { name: 'pages', status: 'pending' }, { name: 'index', status: 'pending' },
        { name: 'log', status: 'pending' }, { name: 'state', status: 'pending' },
      ],
      writtenWikiIds: [],
    };
    // The frozen manifest must be durable before any formal write happens.
    try {
      await this.deps.drafts.prepareReviewedCommit(draft.id,draft.revision,humanReviewDigest,raw.body,manifest.operationId,()=>writeJsonAtomic(this.fileFor(manifest.operationId),manifest));
    } catch (error) {
      if((error as {status?:number}).status===409)throw error;
      // Nothing formal was written yet; report the real cause and the (empty) commit facts so the
      // user can retry instead of guessing whether anything happened.
      const fsCode = (error as { code?: unknown }).code;
      throw new CommitError('COMMIT_MANIFEST_WRITE_FAILED', `提交清单无法写入（${String(fsCode ?? '未知错误')}）：${error instanceof Error ? error.message : '未知错误'}`, 500, {
        operationId: manifest.operationId, committed: false, recoverable: false, writtenWikiIds: [],
        phases: manifest.phases, cause: typeof fsCode === 'string' ? fsCode : null,
      });
    }
    const executed = await this.execute(manifest);
    return { manifest: executed, reused: false, sourceReused: Boolean(executed.snapshot.reuseSourceId) };
  }

  private async checkConflicts(draft: DraftRecord, selectedPages: DraftRecord['pages']): Promise<{ reuseSourceId?: string; reuseSourceTitle?: string }> {
    const existing = await this.deps.wikiStore.allRecords();
    const byTitle = new Map<string, WikiRecord>();
    for (const page of existing) {
      byTitle.set(normalize(page.title), page);
      for (const alias of page.aliases) if (!byTitle.has(normalize(alias))) byTitle.set(normalize(alias), page);
    }
    const boundSources = existing.filter(page => page.type === 'source' && page.sources.length === 1 && page.sources[0] === draft.rawId);
    if (boundSources.length > 1) {
      throw new CommitError('SOURCE_AMBIGUOUS', `这条 Raw 已有 ${boundSources.length} 个 Source 页面，归属不明；本批不自动合并或更新旧 Source，请人工处理后再确认。`, 409, { sources: boundSources.map(page => ({ id: page.id, title: page.title })) });
    }
    const reuseSourceId = boundSources.length === 1 ? boundSources[0].id : undefined;
    const reuseSourceTitle = boundSources.length === 1 ? boundSources[0].title : undefined;
    const effectiveSourceTitle = reuseSourceTitle ?? draft.source.title;
    const titles = [...selectedPages.map(page => page.title), effectiveSourceTitle];
    const seen = new Map<string, string>();
    for (const title of titles) {
      const key = normalize(title);
      const duplicated = seen.get(key);
      if (duplicated) throw new CommitError('BATCH_TITLE_CONFLICT', `本次确认里有重复标题「${title}」与「${duplicated}」，请先改名或合并建议。`, 409, { titles });
      seen.set(key, title);
    }
    for (const title of titles) {
      const owner = byTitle.get(normalize(title));
      if (!owner) continue;
      const explicitCreate = selectedPages.some(page => page.title === title && page.reviewDecision === 'create');
      // B05: an explicit persisted create decision permits a distinct stable ID even when a
      // title/alias match exists. Legacy B04 drafts still follow the conflict gate below.
      if (explicitCreate) continue;
      if (reuseSourceId && owner.id === reuseSourceId && normalize(title) === normalize(effectiveSourceTitle)) continue;
      throw new CommitError('WIKI_TITLE_CONFLICT', `标题或别名「${title}」已被现有 Wiki「${owner.title}」（${owner.id}）占用；请改名，或返回审核页选择“更新已有页”“仍创建新页”或“暂不处理”。显式新建会生成独立页面，关联链接可能产生歧义。`, 409, { title, existingId: owner.id, existingTitle: owner.title, batch: 'B05' });
    }
    return { reuseSourceId, reuseSourceTitle };
  }

  private freeze(draft: DraftRecord, selectedPages: DraftRecord['pages'], raw: { id: string; title: string; tags: string[] }, reuseSourceId: string | undefined, reuseSourceTitle: string | undefined, warnings: string[], now: string): CommitSnapshot {
    // F04-05: pages must link the Source they will actually have — the reused page's real title.
    const effectiveSourceTitle = reuseSourceTitle ?? draft.source.title;
    const createdTitles = new Set([...selectedPages.map(page => page.title), effectiveSourceTitle]);
    const base = { domain: 'fmcg' as const, created: now, updated: now, revision: 1, aliases: [] as string[], tags: [...(raw.tags ?? [])] };
    const pageRecords: WikiRecord[] = selectedPages.map(page => ({
      ...base,
      id: randomUUID(),
      title: page.title, type: page.type as WikiRecord['type'], category: page.category,
      sources: [draft.rawId],
      knowledge_status: page.knowledge_status as WikiRecord['knowledge_status'],
      confidence: page.confidence as WikiRecord['confidence'],
      source_level: page.source_level as WikiRecord['source_level'],
      review_status: 'unreviewed',
      body: renderPageBody(page, { sourceTitle: effectiveSourceTitle, rawId: draft.rawId, createdTitles }),
    }));
    const sourceRecord: WikiRecord | undefined = reuseSourceId ? undefined : {
      ...base,
      id: randomUUID(),
      title: draft.source.title, type: 'source', category: draft.source.category,
      sources: [draft.rawId],
      knowledge_status: draft.source.knowledge_status as WikiRecord['knowledge_status'],
      confidence: draft.source.confidence as WikiRecord['confidence'],
      source_level: draft.source.source_level as WikiRecord['source_level'],
      review_status: 'unreviewed',
      // F04-05/F04-06: rendered from the created pages and the real Raw metadata.
      body: this.sourceBodyFor(draft, selectedPages),
    };
    const digests: Record<string, string> = {};
    for (const record of [...pageRecords, ...(sourceRecord ? [sourceRecord] : [])]) {
      digests[record.id] = sha256(this.deps.wikiStore.pageContent(record));
    }
    return {
      capturedRevision: draft.revision, document: draft.document, selectedPageIds: selectedPages.map(page => page.pageId),
      ...(sourceRecord ? { sourceRecord } : {}), ...(reuseSourceId ? { reuseSourceId } : {}),
      ...(reuseSourceTitle ? { reuseSourceTitle } : {}), pageRecords, digests, warnings,
    };
  }

  /** Runs/continues the frozen manifest; every phase is idempotent and recorded on disk. */
  private async execute(input: CommitManifest): Promise<CommitManifest> {
    return this.queue.run(async () => {
      let manifest = { ...input };
      if(input.supersededBy)throw new CommitError('HUMAN_REVIEW_SUPERSEDED','旧事务已由重新审查事务替代。',409);
      const raw=await this.deps.rawStore.get(input.rawId);assertRawNotMeeting(raw);
      if(!raw||raw.bodySha256!==input.rawSha256||sha256(raw.body)!==input.rawSha256)throw new CommitError('RAW_CHANGED','提交来源已变化。',409);
      const actual=await this.verifiedTargets(input);
      if(!input.humanReviewDigest){
        if(!actual.length){
          manifest.awaitingHumanReview=true;await writeJsonAtomic(this.fileFor(manifest.operationId),manifest);
          await this.deps.drafts.resetToPending(input.draftId,'旧零写入事务需逐页人工审查');
          throw new CommitError('HUMAN_REVIEW_REQUIRED','旧事务没有实际写入；请回到草稿逐页审查后重新明确确认。',409,{operationId:input.operationId,writtenWikiIds:[],committed:false});
        }
        manifest.legacyRecovery='verified_partial';await writeJsonAtomic(this.fileFor(manifest.operationId),manifest);
      }else{
        const draft=await this.deps.drafts.get(input.draftId);
        if(!draft||await this.deps.drafts.assertReviewed(draft,raw.body)!==input.humanReviewDigest||draft.humanReview?.basisDigest!==input.humanReviewBasisDigest)throw new CommitError('REVIEW_CONTENT_CHANGED','提交审查快照与当前候选不一致。',409);
      }
      const save = async (patch: Partial<CommitManifest>) => {
        manifest = { ...manifest, ...patch, updatedAt: new Date().toISOString() };
        await writeJsonAtomic(this.fileFor(manifest.operationId), manifest);
        return manifest;
      };
      const markPhase = async (name: CommitPhaseName, status: CommitPhase['status'], error?: string) => {
        const phases = manifest.phases.map(phase => phase.name === name
          ? { ...phase, status, at: new Date().toISOString(), ...(error ? { error } : {}) } : phase);
        await save({ phases });
      };
      const done = (name: CommitPhaseName) => manifest.phases.find(phase => phase.name === name)?.status === 'done';
      let currentPhase: CommitPhaseName = 'source';
      // Tracks the files this run proved to be on disk, so an un-writable manifest can never
      // hide what was already committed (F04-09).
      const writtenSoFar: string[] = [];
      try {
        await save({ status: 'committing' });
        currentPhase = 'source';
        if (!done('source')) {
          if (manifest.snapshot.sourceRecord) {
            await this.ensurePage(manifest.snapshot.sourceRecord, manifest.snapshot.digests);
            writtenSoFar.push(manifest.snapshot.sourceRecord.id);
          }
          await markPhase('source', 'done');
        }
        currentPhase = 'pages';
        if (!done('pages')) {
          for (const record of manifest.snapshot.pageRecords) {
            await this.ensurePage(record, manifest.snapshot.digests);
            writtenSoFar.push(record.id);
          }
          await markPhase('pages', 'done');
        }
        const written = [...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []), ...manifest.snapshot.pageRecords];
        currentPhase = 'index';
        if (!done('index')) {
          await this.deps.wikiStore.rebuildIndexLocked();
          await markPhase('index', 'done');
        }
        currentPhase = 'log';
        if (!done('log')) {
          await this.deps.wikiStore.appendLogLocked(written.map(record => ({
            operationId: manifest.operationId, action: 'create' as const, id: record.id, title: record.title,
            type: record.type, revision: record.revision,
          })));
          await markPhase('log', 'done');
        }
        currentPhase = 'state';
        if (!done('state')) {
          await this.deps.drafts.markConfirmed(manifest.draftId, manifest.operationId);
          await this.deps.rawStates.set(manifest.rawId, {
            status: 'generated', reason: 'AI 提取结果已确认写入 Wiki', draftId: manifest.draftId,
            confirmedOperationId: manifest.operationId, generatedWikiIds: written.map(record => record.id),
          });
          await markPhase('state', 'done');
        }
        return await save({ status: 'completed', completedAt: new Date().toISOString(), writtenWikiIds: written.map(record => record.id) });
      } catch (error) {
        const fsCode = (error as { code?: unknown }).code;
        const isFsError = typeof fsCode === 'string' && typeof (error as { syscall?: unknown }).syscall === 'string';
        const code = error instanceof WikiError || error instanceof CommitError
          ? (error as { code: string }).code
          : isFsError ? 'COMMIT_STATE_WRITE_FAILED' : 'COMMIT_FAILED';
        const message = error instanceof Error ? error.message : '未知错误';
        // F04-09: the partial-commit facts must survive even when the manifest itself cannot be
        // updated any more — nothing here may throw before the honest error is returned.
        const onDisk = await this.existingTargets(manifest).catch(() => [] as string[]);
        const writtenWikiIds = [...new Set([...writtenSoFar, ...(manifest.writtenWikiIds ?? []), ...onDisk])];
        // Record which phase failed so the recovery state is readable, not just "failed".
        try { await markPhase(currentPhase, 'failed', `${code}: ${message}`); } catch { /* in-memory phases below still describe it */ }
        try {
          await save({
            status: 'failed',
            error: {
              code, message, at: new Date().toISOString(), phase: currentPhase,
              ...(isFsError ? { cause: { code: String(fsCode), message } } : {}),
            } as CommitManifest['error'],
            writtenWikiIds,
            recoveryHint: '已写入的正式文件保留；解除磁盘故障后重启工作台会自动继续这个 operationId，不需要重新确认。',
          });
        } catch { /* the response still carries the recovery facts below */ }
        throw new WikiError(code, message, (error as { status?: number }).status ?? 500, {
          committed: writtenWikiIds.length > 0, recoverable: code !== 'COMMIT_TARGET_CONFLICT',
          operationId: manifest.operationId, failedPhase: currentPhase,
          phases: manifest.phases, writtenWikiIds, status: manifest.status,
        });
      }
    });
  }

  /** Writes one page unless an identical file already exists; never overwrites different content. */
  private async ensurePage(record: WikiRecord, digests: Record<string, string>): Promise<void> {
    const expected = digests[record.id];
    const current = await this.deps.wikiStore.readPageFile(record.id);
    if (current !== undefined) {
      if (sha256(current) === expected) return;
      throw new WikiError('COMMIT_TARGET_CONFLICT', `目标页面 ${record.id}（${record.title}）已存在且内容与本次确认不一致，已停止写入以避免覆盖。`, 409, { wikiId: record.id, title: record.title });
    }
    await this.deps.wikiStore.writePageLocked(record);
    const written = await this.deps.wikiStore.readPageFile(record.id);
    if (written === undefined || sha256(written) !== expected) {
      throw new WikiError('COMMIT_WRITE_VERIFY_FAILED', `写入 ${record.id}（${record.title}）后校验失败，已停止后续写入。`, 500, { wikiId: record.id });
    }
  }

  private async existingTargets(manifest: CommitManifest): Promise<string[]> {
    const written: string[] = [];
    for (const record of [...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []), ...manifest.snapshot.pageRecords]) {
      const current = await this.deps.wikiStore.readPageFile(record.id);
      if (current !== undefined && sha256(current) === manifest.snapshot.digests[record.id]) written.push(record.id);
    }
    return written;
  }
  private async verifiedTargets(manifest:CommitManifest):Promise<string[]> {
    const matched:string[]=[];
    for(const record of [...(manifest.snapshot.sourceRecord?[manifest.snapshot.sourceRecord]:[]),...manifest.snapshot.pageRecords]){
      const current=await this.deps.wikiStore.readPageFile(record.id);
      if(current===undefined)continue;
      if(sha256(current)!==manifest.snapshot.digests[record.id])throw new CommitError('COMMIT_TARGET_CONFLICT','已有事务目标与冻结快照冲突，停止恢复。',409,{wikiId:record.id});
      matched.push(record.id);
    }
    return matched;
  }

  /** Startup recovery: finish every manifest the user already confirmed. */
  async reconcile(): Promise<{ resumed: CommitManifest[]; conflicts: Array<{ operationId: string; code: string; message: string; committed: boolean; writtenWikiIds: string[]; failedPhase?: string }> }> {
    const resumed: CommitManifest[] = [];
    const conflicts: Array<{ operationId: string; code: string; message: string; committed: boolean; writtenWikiIds: string[]; failedPhase?: string }> = [];
    for (const manifest of await this.list()) {
      if (manifest.status === 'completed'||manifest.supersededBy) continue;
      try {
        const finished = await this.deps.wikiStore.withLock(() => this.execute(manifest));
        resumed.push(finished);
      } catch (error) {
        // F04-09: recovery failures keep the same honest facts as the HTTP path.
        const details = (error as { details?: { committed?: boolean; writtenWikiIds?: string[]; failedPhase?: string } }).details;
        conflicts.push({
          operationId: manifest.operationId,
          code: (error as { code?: string }).code ?? 'COMMIT_FAILED',
          message: error instanceof Error ? error.message : '未知错误',
          committed: details?.committed ?? false,
          writtenWikiIds: details?.writtenWikiIds ?? manifest.writtenWikiIds ?? [],
          ...(details?.failedPhase ? { failedPhase: details.failedPhase } : {}),
        });
      }
    }
    return { resumed, conflicts };
  }
}
