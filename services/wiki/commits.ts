import {verifyEvidenceInput,markInspectionCommitted,type InspectionDraftInput} from './inspection-input.ts';
import {isQuestionDraft,type QuestionDraftRecord,type KnowledgeDraftRecord} from './drafts.ts';
import {markAnswerCommitted} from '../llm/knowledge-answers.ts';
import type {QuestionDraftInput} from './question-input.ts';
import {assertMaintenanceReviewed,maintenanceDigest,type KnowledgeChange} from './maintenance.ts';
import { assertWikiSourcesAllowed } from './source-lineage.ts';
// B04: confirmed-commit transactions. Nothing formal is written before the frozen manifest is
// persisted; a failure mid-way is reported honestly (operationId + which targets exist) and the
// same operation is resumed from the manifest instead of asking the user to confirm again.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {isCommitManifest} from '../storage/record-validators.ts';
import { SerialQueue, StorageError, scanJsonRecords, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { derivedTakeaways, type DraftRecord, type DraftStore } from './drafts.ts';
import { renderPageBody, renderSourceBody, renderConfirmedNote } from './render.ts';
import { WikiError, WikiStore, type WikiRecord } from './store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type {NoteApproval,StructuredNote,NoteReviewMetadata} from './structured-note.ts';
import {escapeNoteText} from './structured-note.ts';
import type {HumanReview} from './human-review.ts';
import type { RawStateStore } from '../raw/state.ts';
import { findDuplicateCandidates } from '../search/duplicates.ts';

export type CommitPhaseName = 'source' | 'pages' | 'index' | 'log' | 'state';
export type CommitPhase = { name: CommitPhaseName; status: 'pending' | 'done' | 'failed'; at?: string; error?: string };
export type CommitStatus = 'prepared' | 'committing' | 'completed' | 'failed';

export type CommitSnapshot = {
  outcomeReview?: { version: 1; digest: string; confirmedAt: string };
  maintenance?:{version:1;targets:WikiRecord[];before:Record<string,WikiRecord>;actions:Record<string,'create'|'update'|'link'>;changeIds:string[];resultWikiIds:string[];reviewDigest:string;noChanges?:true};
  deepNote?:{note:StructuredNote;metadata?:NoteReviewMetadata;approval:NoteApproval;humanReview:HumanReview;reviewDigest:string};
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
  questionInput?:never;inspectionInput?:never;
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

export type QuestionCommitManifest=Omit<CommitManifest,'rawId'|'rawSha256'|'rawTitle'|'questionInput'|'inspectionInput'> & {rawId?:never;rawSha256?:never;rawTitle?:never} & ({questionInput:QuestionDraftInput;inspectionInput?:never}|{inspectionInput:InspectionDraftInput;questionInput?:never});
export type KnowledgeCommitManifest=CommitManifest|QuestionCommitManifest;

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

  async get(operationId: string): Promise<KnowledgeCommitManifest | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return undefined;
    const m=await readJsonRecord<KnowledgeCommitManifest>(this.deps.root,this.fileFor(operationId),(v):v is KnowledgeCommitManifest=>isCommitManifest(v,operationId));if(m===undefined)return undefined;if(!isCommitManifest(m,operationId))throw new StorageError('STORAGE_CORRUPT','提交清单结构无效，原文件已保留；恢复执行已停止。',500,{category:'recovery',nextAction:'inspect_or_restore'});return m;
  }
  async list(): Promise<KnowledgeCommitManifest[]> {
    const records=await scanJsonRecords<KnowledgeCommitManifest>(this.directory(),(v,file):v is CommitManifest=>isCommitManifest(v,path.basename(file,'.json')),this.deps.root);
    return records.records.map(x=>x.value);
  }  async findByDraft(draftId: string): Promise<KnowledgeCommitManifest | undefined> {
    return (await this.list()).find(manifest => manifest.draftId === draftId && !manifest.supersededBy);
  }

  async status(operationId: string): Promise<KnowledgeCommitManifest | undefined> { return this.get(operationId); }

  /** F04-04: stable fingerprint of exactly what the user asked to write. */
  private payloadDigest(draft: DraftRecord, selectedPages: DraftRecord['pages'], effectiveSourceTitle: string, reuseSourceId: string | undefined): string {
    const projection = {
      ...(draft.maintenance?{maintenanceDigest:maintenanceDigest(this.reviewProjection(draft,selectedPages.map(p=>p.pageId)))}:{}),
      rawId: draft.rawId, rawSha256: draft.rawSha256, reuseSourceId: reuseSourceId ?? null,
      selectedPageIds: selectedPages.map(page => page.pageId),
      pages: selectedPages.map(page => ({
        title: page.title, type: page.type, category: page.category,
        knowledge_status: page.knowledge_status, confidence: page.confidence, source_level: page.source_level,
        facts: page.source_facts, evidence: page.source_evidence.map(item => [item.id, item.quote, item.start, item.end]),
        ...(page.templateFields ? { templateFields: page.templateFields } : {}),
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
  private sourceBodyFor(draft: DraftRecord, selectedPages: DraftRecord['pages'], outcomeReviewed = false, knownWikiTitles?: Set<string>): string {
    if(draft.structuredNote){
      const selectedIds=new Set(selectedPages.map(p=>p.pageId));
      let body=draft.source.bodyEditedByUser?draft.source.body:renderSourceBody({...draft.source,key_takeaways:draft.source.key_takeaways},draft.rawMeta,selectedPages,draft.pages.filter(p=>!selectedIds.has(p.pageId)));
      if(/^## 深度整理笔记\s*$/m.test(body))throw new CommitError('SOURCE_NOTE_SECTION_CONFLICT','Source摘要已含深度笔记标题，请先移除重复章节再审核。',409);
      const created=new Set(selectedPages.map(p=>p.title));body=body.replace(/\[\[([^\]]+)\]\]/g,(link,title:string)=>created.has(title.trim())||knownWikiTitles?.has(normalize(title))?link:escapeNoteText(link));
      return body.trimEnd()+'\n\n'+renderConfirmedNote(draft, outcomeReviewed);
    }
    if (draft.source.bodyEditedByUser) {
      if (!outcomeReviewed) return draft.source.body;
      const selectedIds = new Set(selectedPages.map(page => page.pageId));
      const selectedTitles = new Set(selectedPages.map(page => normalize(page.title)));
      const skippedTitles = new Set(draft.pages.filter(page => !selectedIds.has(page.pageId)).map(page => normalize(page.title)));
      return draft.source.body.replace(/\[\[([^\]]+)\]\]/gu, (link, title: string) => {
        const key = normalize(title);
        return skippedTitles.has(key) && !selectedTitles.has(key) && !knownWikiTitles?.has(key) ? escapeNoteText(link) : link;
      });
    }
    // F04-05: every derived section (links, takeaways, 「本次未创建的建议」) follows the confirmed
    // selection, which the public confirm API receives independently of the draft's flags.
    const confirmedIds = new Set(selectedPages.map(page => page.pageId));
    const skippedPages = draft.pages.filter(page => !confirmedIds.has(page.pageId));
    return renderSourceBody({ ...draft.source, key_takeaways: derivedTakeaways(selectedPages) }, draft.rawMeta, selectedPages, skippedPages);
  }

  /** Public entry: must be called inside `wikiStore.withLock`. */
  async confirm(input: { draftId: string; baseRevision: number; selectedPageIds: string[]; idempotencyKey: string; operationId: string; now: string; outcomeDigest?: string }): Promise<{ manifest: KnowledgeCommitManifest; reused: boolean; sourceReused: boolean }> {
    let draft = await this.deps.drafts.getKnowledge(input.draftId);
    if (!draft) throw new CommitError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);

    if (isQuestionDraft(draft)) {
      if (input.outcomeDigest !== undefined) throw new CommitError('RAW_OUTCOME_ONLY', '成果确认仅适用于 Raw 整理草稿。', 400);
      return this.confirmQuestion(draft, input);
    }
    const outcomeReview: CommitSnapshot['outcomeReview'] = input.outcomeDigest !== undefined
      ? { version: 1, digest: input.outcomeDigest, confirmedAt: input.now }
      : undefined;

    // F04-04: the same business rule applies to the first confirm and to a retry — every incoming
    // page id must exist before anything is compared. A different request is never silently
    // reduced to the stored one and then reported as a successful reuse.
    const requested = [...new Set(input.selectedPageIds)];
    if (!requested.length&&!draft.structuredNote) throw new CommitError('NO_SELECTION', '至少选择一条知识建议才能确认写入。', 400);
    for (const id of requested) {
      if (!draft.pages.some(page => page.pageId === id)) {
        throw new CommitError('UNKNOWN_PAGE', `选择中包含草稿里不存在的建议 ${id}。`, 400, { unknownPageId: id, knownPageIds: draft.pages.map(page => page.pageId) });
      }
    }
    const raw = await this.deps.rawStore.get(draft.rawId);
    assertRawNotMeeting(raw);
    const prior = (await this.list()).filter(manifest => manifest.draftId === draft!.id && !manifest.supersededBy);
    const priorKey = prior.find(manifest => manifest.idempotencyKey === input.idempotencyKey);
    prior.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let existing = priorKey ?? prior.find(manifest => manifest.status !== 'completed' || JSON.stringify([...manifest.snapshot.selectedPageIds].sort()) === JSON.stringify([...requested].sort()));
    if(!priorKey&&draft.maintenance&&existing?.status==='completed'&&requested.every(id=>draft!.maintenance!.changes.some(c=>!c.committedOperationId&&draft!.pages[c.pageIndex]?.pageId===id)))existing=undefined;
    if(existing&&existing.status!=='completed'&&!existing.humanReviewDigest&&!existing.snapshot.outcomeReview){
      const onDisk=await this.verifiedTargets(existing);
      if(!onDisk.length){
        if(draft.status==='committing')await this.deps.drafts.resetToPending(draft.id,'旧零写入事务等待逐页人工审查');
        const editable=(await this.deps.drafts.get(draft.id))!;
        if(input.baseRevision!==editable.revision)throw new CommitError('DRAFT_REVISION_CONFLICT','草稿已变化，请刷新。',409);
        if (outcomeReview) await this.deps.drafts.assertRawOutcome(editable, raw?.body ?? '', requested, outcomeReview.digest);
        else await this.deps.drafts.assertReviewed(editable, raw?.body ?? '');
        existing.supersededBy=input.operationId;existing.awaitingHumanReview=true;
        await writeJsonAtomic(this.fileFor(existing.operationId),existing);
        existing=undefined;
        draft=editable;
        // The old immutable snapshot remains on disk; a new reviewed operation supersedes it.
      }
    }
    if (existing) {
      // F04-04: the retry semantics are defined by the frozen payload, not by the key: the same
      // payload reuses the original operation (any key), a different payload is rejected.
      const candidatePages = draft.pages.filter(page => requested.includes(page.pageId));
      const candidateDigest = raw && !existing.snapshot.outcomeReview && !outcomeReview
        ? this.payloadDigest(draft, candidatePages, existing.snapshot.reuseSourceTitle ?? draft.source.title, existing.snapshot.reuseSourceId)
        : undefined;
      const savedOutcome = existing.snapshot.outcomeReview;
      const samePayload = savedOutcome
        ? outcomeReview?.digest === savedOutcome.digest && input.baseRevision === existing.snapshot.capturedRevision
          && existing.snapshot.selectedPageIds.length === requested.length && existing.snapshot.selectedPageIds.every(id => requested.includes(id))
        : !outcomeReview && Boolean(existing.payloadDigest) && candidateDigest === existing.payloadDigest
          && existing.snapshot.selectedPageIds.length === requested.length
          && (!existing.snapshot.deepNote||existing.snapshot.deepNote.reviewDigest===this.deps.drafts.contentDigest(draft));
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
      if (draft.status === 'confirmed' && !draft.maintenance?.changes.some(change => !change.committedOperationId)) {
        const completed = prior.find(manifest => manifest.status === 'completed' && manifest.payloadDigest);
        if (completed) {
          throw new CommitError('CONFIRM_PAYLOAD_CHANGED', '这份草稿已按另一份确认内容提交过；请刷新后查看既有提交状态，不要重复确认不同的选择或内容。', 409,
            { operationId: completed.operationId, status: completed.status, storedSelectedPageIds: completed.snapshot.selectedPageIds, requestedSelectedPageIds: requested });
        }
      }
      throw new CommitError('DRAFT_ALREADY_COMMITTED', '这份草稿已经进入提交状态，请刷新后查看提交状态。', 409, { status: draft.status, operationId: draft.commitOperationId });
    }
    if (draft.status !== 'pending_confirmation') throw new CommitError('DRAFT_NOT_CONFIRMABLE', `草稿状态为 ${draft.status}，不能确认写入。`, 409);
    if (input.baseRevision !== draft.revision) {
      throw new CommitError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅再确认。', 409, { currentRevision: draft.revision });
    }
    if (!raw) throw new CommitError('RAW_MISSING', '对应的原始资料不存在（可能已被删除），不能确认写入。', 409);
    if (raw.bodySha256 !== draft.rawSha256) throw new CommitError('RAW_CHANGED', '原始正文的校验值与整理时不一致，已停止写入以避免产生坏来源。', 409);
    if (outcomeReview) await this.deps.drafts.assertRawOutcome(draft, raw.body, requested, outcomeReview.digest);
    const humanReviewDigest = outcomeReview ? undefined : await this.deps.drafts.assertReviewed(draft, raw.body);
    if(!outcomeReview&&!draft.maintenance&&draft.structuredNote&&JSON.stringify(draft.pages.filter(p=>p.selected).map(p=>p.pageId).sort())!==JSON.stringify([...requested].sort()))throw new CommitError('REVIEW_SELECTION_CHANGED','请先保存当前选卡，再重新审核笔记。',409);

    const selectedIds = requested;
    const selectedPages = draft.pages.filter(page => selectedIds.includes(page.pageId));
    for (const page of selectedPages) if (!draft.maintenance&&(page.reviewDecision === 'update' || (!outcomeReview && page.reviewDecision === 'defer'))) {
      throw new CommitError('DECISION_MISMATCH', `「${page.title}」已保存为${page.reviewDecision === 'update' ? '更新已有页' : '暂不处理'}，不能作为新建页提交。`, 409, { pageId: page.pageId, decision: page.reviewDecision });
    }
    if (!outcomeReview) await this.deps.drafts.assertEvidenceStillValid(draft, raw.body);

    let outcomeChanges: KnowledgeChange[] | undefined;
    if (outcomeReview && draft.maintenance) {
      const changes = draft.maintenance.changes;
      outcomeChanges = changes.filter(change => !change.committedOperationId && requested.includes(draft!.pages[change.pageIndex]?.pageId));
      if (!outcomeChanges.length && (requested.length || !draft.structuredNote)) throw new CommitError('NO_SELECTION', '请至少选择一项未提交的知识变更。', 409);
      if (outcomeChanges.length !== requested.length || !requested.every(id => outcomeChanges!.some(change => draft!.pages[change.pageIndex].pageId === id))) {
        throw new CommitError('REVIEW_SELECTION_CHANGED', '选集中包含无对应变更或已经提交的成果，请刷新后重选。', 409);
      }
      if (outcomeChanges.some(change => change.dependsOn.some(id => !changes.some(other => other.changeId === id && (other.committedOperationId || outcomeChanges!.includes(other)))))) {
        throw new CommitError('CHANGE_DEPENDENCY_REQUIRED', '有选中成果依赖其他变更，请一并选择依赖项，或取消选中该成果。', 409);
      }
    }

    const warnings: string[] = [];
    const noChanges=!!outcomeChanges?.length&&outcomeChanges.every(c=>c.action==='noop');
    const conflict = noChanges?{}:draft.maintenance?await this.maintenanceSource(draft):await this.checkConflicts(draft, selectedPages);
    for (const page of draft.maintenance?[]:selectedPages) {
      const candidates = findDuplicateCandidates({ title: page.title, category: page.category, tags: raw.tags ?? [], content: [page.one_line_definition, ...page.source_facts.map(item => item.text), ...page.ai_organized].join('\n') }, await this.deps.wikiStore.allRecords());
      if (candidates.some(item => item.score >= 0.35) && page.reviewDecision !== 'create') {
        throw new CommitError('DUPLICATE_DECISION_REQUIRED', `「${page.title}」有可能重复的 Wiki 候选，请先查看候选并明确选择更新、新建或暂不处理。`, 409, { pageId: page.pageId, candidates: candidates.filter(item => item.score >= 0.35).map(item => ({ id: item.wiki.id, title: item.wiki.title, score: item.score })) });
      }
    }
    const reuseSourceTitle = conflict.reuseSourceTitle;
    const knownWikiTitles = outcomeReview && draft.source.bodyEditedByUser
      ? new Set((await this.deps.wikiStore.allRecords()).flatMap(page => [page.title, ...page.aliases].map(normalize)))
      : undefined;
    if (conflict.reuseSourceId && reuseSourceTitle) {
      const existingSource = await this.deps.wikiStore.get(conflict.reuseSourceId);
      if (existingSource) {
        const changed = normalize(existingSource.title) !== normalize(draft.source.title)
          || existingSource.body.trim() !== this.sourceBodyFor(draft, selectedPages, !!outcomeReview, knownWikiTitles).trim();
        if (changed) {
          warnings.push(`已复用既有 Source「${existingSource.title}」（${existingSource.id}）：本批不修改既有页面，你在草稿里对 Source 的修改不会写入。`);
        }
      }
    }
    // F04-05: an explicitly edited Source body may still point at pages that are not created now.
    if (draft.source.bodyEditedByUser) {
      const created = new Set([...selectedPages.map(page => page.title), reuseSourceTitle ?? draft.source.title]);
      const body = outcomeReview ? this.sourceBodyFor(draft, selectedPages, true, knownWikiTitles) : draft.source.body;
      const linked = [...body.matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1].trim());
      const dangling = [...new Set(linked.filter(title => !created.has(title) && !knownWikiTitles?.has(normalize(title))))];
      if (dangling.length) warnings.push(`人工编辑的 Source 正文包含本次不会创建的链接：${dangling.join('、')}；它们会成为未解析链接，请确认是否符合预期。`);
    }
    const effectivePages=draft.maintenance?selectedPages.flatMap(p=>{
      const c=draft.maintenance!.changes.find(c=>draft.pages[c.pageIndex].pageId===p.pageId)!;
      return outcomeReview&&c.action==='noop'?[]:[{...p,title:c.candidate.title}];
    }):selectedPages;
    const snapshot = this.freeze(draft, effectivePages, raw, conflict.reuseSourceId, reuseSourceTitle, warnings, input.now, outcomeReview, knownWikiTitles);
    if(outcomeReview&&draft.maintenance)snapshot.selectedPageIds=requested;
    if(noChanges)delete snapshot.sourceRecord;
    if(draft.maintenance)await this.freezeMaintenance(snapshot,draft,selectedPages,input.now,outcomeChanges);
    const manifest: KnowledgeCommitManifest = {
      ...(!outcomeReview ? { humanReviewDigest, humanReviewBasisDigest: draft.humanReview!.basisDigest } : {}),
      operationId: input.operationId, draftId: draft.id, idempotencyKey: input.idempotencyKey,
      rawId: draft.rawId, rawSha256: draft.rawSha256, rawTitle: draft.rawTitle,
      payloadDigest: outcomeReview
        ? sha256(JSON.stringify({ digest: outcomeReview.digest, revision: input.baseRevision, selectedPageIds: [...requested].sort() }))
        : this.payloadDigest(draft, selectedPages, reuseSourceTitle ?? draft.source.title, conflict.reuseSourceId),
      status: 'prepared', createdAt: input.now, updatedAt: input.now, provider: draft.provider,
      snapshot, phases: [
        { name: 'source', status: 'pending' }, { name: 'pages', status: 'pending' }, { name: 'index', status: 'pending' },
        { name: 'log', status: 'pending' }, { name: 'state', status: 'pending' },
      ],
      writtenWikiIds: [],
    };
    // The frozen manifest must be durable before any formal write happens.
    try {
      await this.deps.drafts.prepareReviewedCommit(draft.id,draft.revision,(outcomeReview?.digest ?? humanReviewDigest)!,raw.body,manifest.operationId,()=>writeJsonAtomic(this.fileFor(manifest.operationId),manifest),outcomeReview ? requested : undefined);
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

  private async confirmQuestion(draft:QuestionDraftRecord,input:{baseRevision:number;selectedPageIds:string[];idempotencyKey:string;operationId:string;now:string}):Promise<{manifest:KnowledgeCommitManifest;reused:boolean;sourceReused:boolean}>{
    const requested=[...new Set(input.selectedPageIds)];if(!requested.length||requested.some(id=>!draft.pages.some(p=>p.pageId===id)))throw new CommitError('UNKNOWN_PAGE','请选择真实的问答维护项。');
    const payloadDigest=sha256(JSON.stringify({input:draft.input,selection:requested.sort(),digest:maintenanceDigest(this.reviewProjection(draft,requested))}));
    const all=(await this.list()).filter(m=>m.draftId===draft.id&&!m.supersededBy),prior=all.find(m=>m.idempotencyKey===input.idempotencyKey)??all.find(m=>m.status!=='completed'||JSON.stringify([...m.snapshot.selectedPageIds].sort())===JSON.stringify([...requested].sort()));
    if(prior){await verifyEvidenceInput(draft.input,this.deps.wikiStore,this.deps.rawStore as import('../raw/store.ts').RawStore,prior.snapshot.pageRecords);if(prior.payloadDigest!==payloadDigest)throw new CommitError(prior.idempotencyKey===input.idempotencyKey?'IDEMPOTENCY_KEY_MISMATCH':'CONFIRM_PAYLOAD_CHANGED','此问答草稿已按另一内容提交。',409);return {manifest:prior.status==='completed'?prior:await this.execute(prior),reused:true,sourceReused:false};}
    await verifyEvidenceInput(draft.input,this.deps.wikiStore,this.deps.rawStore as import('../raw/store.ts').RawStore);
    if(draft.status!=='pending_confirmation'||draft.revision!==input.baseRevision)throw new CommitError('DRAFT_REVISION_CONFLICT','草稿已变化或已提交，请刷新。',409);
    const digest=await this.deps.drafts.assertReviewed(draft,''),snapshot:CommitSnapshot={capturedRevision:draft.revision,document:draft.document,selectedPageIds:requested,pageRecords:[],digests:{},warnings:[]};
    await this.freezeMaintenance(snapshot,draft,draft.pages.filter(p=>requested.includes(p.pageId)),input.now);
    const manifest:QuestionCommitManifest={...(draft.input.kind==='inspection'?{inspectionInput:structuredClone(draft.input)}:{questionInput:structuredClone(draft.input)}),operationId:input.operationId,draftId:draft.id,idempotencyKey:input.idempotencyKey,payloadDigest,humanReviewDigest:digest,humanReviewBasisDigest:draft.humanReview!.basisDigest,status:'prepared',createdAt:input.now,updatedAt:input.now,provider:draft.provider,snapshot,phases:['source','pages','index','log','state'].map(name=>({name:name as CommitPhaseName,status:'pending'})),writtenWikiIds:[]};
    await this.deps.drafts.prepareReviewedCommit(draft.id,draft.revision,digest,'',manifest.operationId,()=>writeJsonAtomic(this.fileFor(manifest.operationId),manifest));
    return {manifest:await this.execute(manifest),reused:false,sourceReused:false};
  }
  private reviewProjection<T extends KnowledgeDraftRecord>(draft:T,pageIds:string[]):T {
    const next=structuredClone(draft);for(const c of next.maintenance!.changes){if(pageIds.includes(next.pages[c.pageIndex].pageId)){delete c.committedOperationId;c.decision='accept';}else c.decision='defer';}return next;
  }
  private async maintenanceSource(draft:DraftRecord):Promise<{reuseSourceId?:string;reuseSourceTitle?:string}>{
    const sources=(await this.deps.wikiStore.allRecords()).filter(p=>p.type==='source'&&p.sources.length===1&&p.sources[0]===draft.rawId);
    if(sources.length>1)throw new CommitError('SOURCE_AMBIGUOUS','同Raw存在多个Source，请人工处理。',409);
    return sources[0]?{reuseSourceId:sources[0].id,reuseSourceTitle:sources[0].title}:{};
  }
  private async freezeMaintenance(snapshot:CommitSnapshot,draft:KnowledgeDraftRecord,selectedPages:DraftRecord['pages'],now:string,outcomeChanges?:KnowledgeChange[]){
    const question=isQuestionDraft(draft),incomingRawIds=question?draft.input.rawSnapshots.map(r=>r.id):[draft.rawId];
    const digest=snapshot.outcomeReview?.digest ?? assertMaintenanceReviewed(draft);
    const changes=outcomeChanges ?? draft.maintenance!.changes.filter(c=>c.decision==='accept'&&!c.committedOperationId);
    const selected=selectedPages.map(p=>p.pageId).sort();
    if(JSON.stringify(selected)!==JSON.stringify(changes.map(c=>draft.pages[c.pageIndex].pageId).sort()))throw new CommitError('REVIEW_SELECTION_CHANGED','提交选集与已接受的变更不一致。',409);
    const all=await this.deps.wikiStore.allRecords(),before:Record<string,WikiRecord>={},actions:Record<string,'create'|'update'|'link'>={},records:WikiRecord[]=[],resultWikiIds:string[]=[];
    const proposed=changes.map(c=>c.candidate.title);
    if(new Set(proposed.map(normalize)).size!==proposed.length)throw new CommitError('BATCH_TITLE_CONFLICT','本次变更包含重复标题。',409);
    for(const c of changes){const occupied=all.find(p=>p.id!==c.targetWikiId&&[p.title,...p.aliases].some(t=>[c.candidate.title,...c.candidate.aliases].some(v=>normalize(t)===normalize(v))));if(occupied)throw new CommitError('WIKI_TITLE_CONFLICT','候选标题或别名已被其他Wiki占用，请修改后重新审核。',409,{wikiId:occupied.id,title:occupied.title});}
    if(snapshot.sourceRecord&&all.some(p=>[p.title,...p.aliases].some(t=>normalize(t)===normalize(snapshot.sourceRecord!.title))))throw new CommitError('WIKI_TITLE_CONFLICT','来源笔记标题已被其他Wiki占用，请重新整理或修改来源标题。',409);
    const acceptedTitles=new Set([...all.flatMap(p=>[p.title,...p.aliases]),...changes.flatMap(c=>[c.candidate.title,...c.candidate.aliases]),...(question?[]:[snapshot.reuseSourceTitle??draft.source.title])]);
    const clean=(body:string)=>body.replace(/\[\[([^\]]+)\]\]/gu,(link,title:string)=>acceptedTitles.has(title.trim())?link:escapeNoteText(link));
    for(const c of changes){
      const old=c.targetWikiId?await this.deps.wikiStore.get(c.targetWikiId):undefined;
      if(c.targetWikiId&&(!old||old.revision!==c.baseRevision))throw new CommitError('WIKI_REVISION_CONFLICT','目标Wiki已变化，请重新整理和审阅；原文不会覆盖。',409,{wikiId:c.targetWikiId});
      if (snapshot.outcomeReview && old) await assertWikiSourcesAllowed(this.deps.wikiStore, this.deps.rawStore, old);
      for(const source of c.candidate.sources)assertRawNotMeeting(await this.deps.rawStore.get(source));
      const id=old?.id??randomUUID();resultWikiIds.push(id);
      if(c.action==='noop'){
        if(!old||incomingRawIds.some(id=>!old.sources.includes(id))||c.candidate.title!==old.title||c.candidate.body!==old.body)throw new CommitError('INVALID_NOOP','无变化项的正文或来源与目标不一致。',409);
        continue;
      }
      const exactBody=!!snapshot.outcomeReview&&!!c.pageIndexes;
      if(exactBody&&(c.action==='create'||c.action==='update')){
        const unresolved=[...c.candidate.body.matchAll(/\[\[([^\]]+)\]\]/gu)].find(([link,title])=>!acceptedTitles.has(title.trim())&&!old?.body.includes(link));
        if(unresolved)throw new CommitError('CHANGE_DEPENDENCY_REQUIRED',`候选正文的链接「${unresolved[1]}」尚无正式主题，请选择相关成果或编辑链接。`,409);
      }
      const record:WikiRecord=old&&c.action==='link'?{...old,sources:[...new Set([...old.sources,...incomingRawIds])],updated:now,revision:old.revision+1}:{...(old??{id,domain:'fmcg',created:now,review_status:'unreviewed'}),...c.candidate,id,body:exactBody?c.candidate.body:clean(c.candidate.body),updated:now,revision:(old?.revision??0)+1} as WikiRecord;
      if(old&&c.action==='link'&&JSON.stringify(record.sources)===JSON.stringify(old.sources))continue;
      if(question&&draft.input.kind==='inspection'){const input=draft.input,ids=input.changeFindingIds[c.changeId],findings=input.findings.filter(f=>ids.includes(f.id));record.inspectionDerivations=[...(old?.inspectionDerivations??[]),{inspectionId:input.inspectionId,findingIds:ids,wikiIds:[...new Set(findings.flatMap(f=>f.wikiIds))],rawIds:[...new Set(findings.flatMap(f=>f.evidence.flatMap(e=>e.rawIds)))],manualWikiIds:[...new Set(findings.flatMap(f=>f.evidence.flatMap(e=>e.manualWikiIds)))]}];}
      if(question&&draft.input.kind==='question_answer')record.answerDerivations=[...(old?.answerDerivations??[]),{answerId:draft.input.resultId,answerRevision:draft.input.resultRevision,wikiIds:draft.input.wikiSnapshots.map(p=>p.id),rawIds:draft.input.rawSnapshots.map(r=>r.id),manualWikiIds:[...new Set(draft.input.citations.flatMap(c=>c.manualWikiIds))],containsInference:draft.input.sections.some(s=>s.kind==='inference'||s.kind==='advice')}];
      if(old)before[id]=old;
      actions[id]=c.action as 'create'|'update'|'link';records.push(record);
    }
    snapshot.pageRecords=records;
    if(snapshot.reuseSourceId){
      const source=await this.deps.wikiStore.get(snapshot.reuseSourceId);
      if(!source||source.type!=='source'||source.sources.length!==1||(question||source.sources[0]!==draft.rawId))throw new CommitError('SOURCE_BINDING_CHANGED','已有Source与Raw绑定不一致。',409);
      const missing=changes.filter(c=>!snapshot.outcomeReview||c.action!=='noop').map(c=>c.candidate.title).filter(title=>!source.body.includes('[['+title+']]'));
      if(missing.length){snapshot.sourceRecord={...source,body:source.body.trimEnd()+'\n\n## 本次关联知识\n'+[...new Set(missing)].map(t=>'- [['+t+']]').join('\n')+'\n',revision:source.revision+1,updated:now};before[source.id]=source;actions[source.id]='link';}
    }
    if(snapshot.sourceRecord)snapshot.sourceRecord.body=clean(snapshot.sourceRecord.body);
    snapshot.digests=Object.fromEntries([...records,...(snapshot.sourceRecord?[snapshot.sourceRecord]:[])].map(r=>[r.id,sha256(this.deps.wikiStore.pageContent(r))]));
    snapshot.maintenance={version:1,targets:changes.flatMap(c=>c.targetWikiId?[all.find(p=>p.id===c.targetWikiId)!]:[]),before,actions,changeIds:changes.map(c=>c.changeId),resultWikiIds,reviewDigest:digest,...(snapshot.outcomeReview&&changes.length>0&&changes.every(c=>c.action==='noop')?{noChanges:true as const}:{})};
  }

  private async checkConflicts(draft: DraftRecord, selectedPages: DraftRecord['pages']): Promise<{ reuseSourceId?: string; reuseSourceTitle?: string }> {
    const existing = await this.deps.wikiStore.allRecords();
    const byTitle = new Map<string, WikiRecord>();
    for (const page of existing) {
      byTitle.set(normalize(page.title), page);
      for (const alias of page.aliases) if (!byTitle.has(normalize(alias))) byTitle.set(normalize(alias), page);
    }
    const boundSources = existing.filter(page => page.type === 'source' && page.sources.length === 1 && page.sources[0] === draft.rawId);
    if(draft.structuredNote&&boundSources.length)throw new CommitError('DEEP_SOURCE_EXISTS','同一Raw已有Source，本轮不能覆盖或丢弃新笔记，请保留草稿处理。',409);
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

  private freeze(draft: DraftRecord, selectedPages: DraftRecord['pages'], raw: { id: string; title: string; tags: string[] }, reuseSourceId: string | undefined, reuseSourceTitle: string | undefined, warnings: string[], now: string, outcomeReview?: CommitSnapshot['outcomeReview'], knownWikiTitles?: Set<string>): CommitSnapshot {
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
      body: this.sourceBodyFor(draft, selectedPages, !!outcomeReview, knownWikiTitles),
    };
    const digests: Record<string, string> = {};
    for (const record of [...pageRecords, ...(sourceRecord ? [sourceRecord] : [])]) {
      digests[record.id] = sha256(this.deps.wikiStore.pageContent(record));
    }
    return {
      ...(outcomeReview ? { outcomeReview } : !draft.maintenance&&draft.structuredNote?{deepNote:{note:structuredClone(draft.structuredNote),...(draft.noteReview?{metadata:structuredClone(draft.noteReview)}:{}),approval:structuredClone(draft.noteApproval!),humanReview:structuredClone(draft.humanReview!),reviewDigest:this.deps.drafts.contentDigest(draft)}}:{}),
      capturedRevision: draft.revision, document: draft.document, selectedPageIds: selectedPages.map(page => page.pageId),
      ...(sourceRecord ? { sourceRecord } : {}), ...(reuseSourceId ? { reuseSourceId } : {}),
      ...(reuseSourceTitle ? { reuseSourceTitle } : {}), pageRecords, digests, warnings,
    };
  }

  /** Runs/continues the frozen manifest; every phase is idempotent and recorded on disk. */
  private async execute(input: KnowledgeCommitManifest): Promise<KnowledgeCommitManifest> {
    return this.queue.run(async () => {
      let manifest = { ...input };
      const currentDraft=await this.deps.drafts.getKnowledge(input.draftId);
      const outcomeReview = input.snapshot.outcomeReview;
      if((currentDraft?.structuredNote||input.snapshot.sourceRecord?.body.includes('## 深度整理笔记\n'))&&!input.snapshot.deepNote&&!input.snapshot.maintenance&&!outcomeReview)throw new CommitError('NOTE_REVIEW_REQUIRED','旧事务没有冻结的笔记审批，不能恢复写入。',409);
      if(input.supersededBy)throw new CommitError('HUMAN_REVIEW_SUPERSEDED','旧事务已由重新审查事务替代。',409);
      const evidenceInput=input.inspectionInput??input.questionInput;const raw=evidenceInput?undefined:await this.deps.rawStore.get(input.rawId!);
      if(evidenceInput)await verifyEvidenceInput(evidenceInput,this.deps.wikiStore,this.deps.rawStore as import('../raw/store.ts').RawStore,input.snapshot.pageRecords);else assertRawNotMeeting(raw);
      if(!evidenceInput&&(!raw||raw.bodySha256!==input.rawSha256||sha256(raw.body)!==input.rawSha256))throw new CommitError('RAW_CHANGED','提交来源已变化。',409);
      if(input.snapshot.maintenance){for(const target of input.snapshot.maintenance.targets){
        for(const source of target.sources)assertRawNotMeeting(await this.deps.rawStore.get(source));
        if (outcomeReview) await assertWikiSourcesAllowed(this.deps.wikiStore, this.deps.rawStore, target);
        const current=await this.deps.wikiStore.readPageFile(target.id),expected=input.snapshot.digests[target.id];
        if(current===undefined||(sha256(current)!==sha256(this.deps.wikiStore.pageContent(target))&&(!expected||sha256(current)!==expected)))throw new CommitError('WIKI_REVISION_CONFLICT','冻结的目标Wiki已变化，停止恢复。',409,{wikiId:target.id});
      }}
      const actual=await this.verifiedTargets(input);
      if (outcomeReview) {
        if (!currentDraft || isQuestionDraft(currentDraft) || currentDraft.revision !== input.snapshot.capturedRevision) {
          throw new CommitError('REVIEW_CONTENT_CHANGED', '成果确认时的草稿版本已变化，已停止恢复。', 409);
        }
        await this.deps.drafts.assertRawOutcome(currentDraft, raw!.body, input.snapshot.selectedPageIds, outcomeReview.digest);
        for (const record of input.snapshot.pageRecords) for (const id of record.sources) assertRawNotMeeting(await this.deps.rawStore.get(id));
      } else if(input.snapshot.maintenance){
        if(!currentDraft||await this.deps.drafts.assertReviewed(this.reviewProjection(currentDraft,input.snapshot.selectedPageIds),raw?.body??'',evidenceInput?input.snapshot.pageRecords:[])!==input.snapshot.maintenance.reviewDigest)throw new CommitError('REVIEW_CONTENT_CHANGED','恢复审批与冻结内容不一致。',409);
        for(const record of input.snapshot.pageRecords)for(const id of record.sources)assertRawNotMeeting(await this.deps.rawStore.get(id));
      }else if(input.snapshot.deepNote){
        if(input.snapshot.deepNote.reviewDigest!==input.humanReviewDigest||input.snapshot.deepNote.approval.digest!==input.humanReviewDigest)throw new CommitError('NOTE_REVIEW_REQUIRED','冻结的笔记审批不匹配。',409);
        if(!actual.length&&(!currentDraft||await this.deps.drafts.assertReviewed(currentDraft,raw?.body??'')!==input.humanReviewDigest))throw new CommitError('REVIEW_CONTENT_CHANGED','零写入事务需当前有效的全部审核。',409);
      }else if(!input.humanReviewDigest){
        if(!actual.length){
          manifest.awaitingHumanReview=true;await writeJsonAtomic(this.fileFor(manifest.operationId),manifest);
          await this.deps.drafts.resetToPending(input.draftId,'旧零写入事务需逐页人工审查');
          throw new CommitError('HUMAN_REVIEW_REQUIRED','旧事务没有实际写入；请回到草稿逐页审查后重新明确确认。',409,{operationId:input.operationId,writtenWikiIds:[],committed:false});
        }
        manifest.legacyRecovery='verified_partial';await writeJsonAtomic(this.fileFor(manifest.operationId),manifest);
      }else{
        const draft=await this.deps.drafts.get(input.draftId);
        if(!draft||await this.deps.drafts.assertReviewed(draft,raw?.body??'')!==input.humanReviewDigest||draft.humanReview?.basisDigest!==input.humanReviewBasisDigest)throw new CommitError('REVIEW_CONTENT_CHANGED','提交审查快照与当前候选不一致。',409);
      }
      const save = async (patch: Partial<KnowledgeCommitManifest>) => {
        manifest = { ...manifest, ...patch, updatedAt: new Date().toISOString() } as KnowledgeCommitManifest;
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
            await this.ensurePage(manifest.snapshot.sourceRecord, manifest.snapshot.digests,manifest.snapshot.maintenance?.before[manifest.snapshot.sourceRecord.id]);
            writtenSoFar.push(manifest.snapshot.sourceRecord.id);
          }
          await markPhase('source', 'done');
        }
        currentPhase = 'pages';
        if (!done('pages')) {
          for (const record of manifest.snapshot.pageRecords) {
            await this.ensurePage(record, manifest.snapshot.digests,manifest.snapshot.maintenance?.before[record.id]);
            writtenSoFar.push(record.id);
          }
          await markPhase('pages', 'done');
        }
        const written = [...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []), ...manifest.snapshot.pageRecords];
        currentPhase = 'index';
        if (!done('index')) {
          if(!manifest.snapshot.maintenance?.noChanges)await this.deps.wikiStore.rebuildIndexLocked();
          await markPhase('index', 'done');
        }
        currentPhase = 'log';
        if (!done('log')) {
          if(!manifest.snapshot.maintenance?.noChanges)await this.deps.wikiStore.appendLogLocked(written.map(record => ({
            operationId: manifest.operationId, action: manifest.snapshot.maintenance?.before[record.id]?'update' as const:'create' as const, id: record.id, title: record.title,
            type: record.type, revision: record.revision,
          })));
          await markPhase('log', 'done');
        }
        currentPhase = 'state';
        if (!done('state')) {
          if(manifest.snapshot.maintenance)await this.deps.drafts.markMaintenanceCommitted(manifest.draftId,manifest.operationId,manifest.snapshot.maintenance.changeIds);
          else await this.deps.drafts.markConfirmed(manifest.draftId, manifest.operationId);
          if(manifest.inspectionInput)await markInspectionCommitted(this.deps.root,manifest.inspectionInput,manifest.operationId,manifest.snapshot.maintenance!.resultWikiIds,Object.fromEntries(manifest.snapshot.maintenance!.changeIds.map((id,i)=>[id,manifest.snapshot.maintenance!.resultWikiIds[i]])));else if(manifest.questionInput)await markAnswerCommitted(this.deps.root,manifest.questionInput,manifest.operationId,manifest.snapshot.maintenance!.resultWikiIds,manifest.draftId);else {
          const currentState=await this.deps.rawStates.get(manifest.rawId!),remaining=(await this.deps.drafts.get(manifest.draftId))?.status==='pending_confirmation';
          await this.deps.rawStates.set(manifest.rawId!, {
            status: remaining?'pending_confirmation':'generated', reason: manifest.snapshot.maintenance?.noChanges?'已检查，无需变更':'AI 提取结果已确认写入 Wiki', draftId: manifest.draftId,
            confirmedOperationId: manifest.operationId, generatedWikiIds: [...new Set([...(currentState.generatedWikiIds??[]),...(manifest.snapshot.outcomeReview?written.map(record=>record.id):manifest.snapshot.maintenance?.resultWikiIds??written.map(record => record.id))]) ],
          });
          }
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
  private async ensurePage(record: WikiRecord, digests: Record<string, string>,before?:WikiRecord): Promise<void> {
    const expected = digests[record.id];
    const current = await this.deps.wikiStore.readPageFile(record.id);
    if (current !== undefined) {
      if (sha256(current) === expected) return;
      if(before&&sha256(current)===sha256(this.deps.wikiStore.pageContent(before))){await this.deps.wikiStore.writePageLocked(record);return;}
      throw new WikiError('COMMIT_TARGET_CONFLICT', `目标页面 ${record.id}（${record.title}）已存在且内容与本次确认不一致，已停止写入以避免覆盖。`, 409, { wikiId: record.id, title: record.title });
    }
    await this.deps.wikiStore.writePageLocked(record);
    const written = await this.deps.wikiStore.readPageFile(record.id);
    if (written === undefined || sha256(written) !== expected) {
      throw new WikiError('COMMIT_WRITE_VERIFY_FAILED', `写入 ${record.id}（${record.title}）后校验失败，已停止后续写入。`, 500, { wikiId: record.id });
    }
  }

  private async existingTargets(manifest: KnowledgeCommitManifest): Promise<string[]> {
    const written: string[] = [];
    for (const record of [...(manifest.snapshot.sourceRecord ? [manifest.snapshot.sourceRecord] : []), ...manifest.snapshot.pageRecords]) {
      const current = await this.deps.wikiStore.readPageFile(record.id);
      if (current !== undefined && sha256(current) === manifest.snapshot.digests[record.id]) written.push(record.id);
    }
    return written;
  }
  private async verifiedTargets(manifest:KnowledgeCommitManifest):Promise<string[]> {
    const matched:string[]=[];
    for(const record of [...(manifest.snapshot.sourceRecord?[manifest.snapshot.sourceRecord]:[]),...manifest.snapshot.pageRecords]){
      const current=await this.deps.wikiStore.readPageFile(record.id);
      if(current===undefined)continue;
      if(manifest.snapshot.maintenance?.before[record.id]&&sha256(current)===sha256(this.deps.wikiStore.pageContent(manifest.snapshot.maintenance.before[record.id])))continue;
      if(sha256(current)!==manifest.snapshot.digests[record.id])throw new CommitError('COMMIT_TARGET_CONFLICT','已有事务目标与冻结快照冲突，停止恢复。',409,{wikiId:record.id});
      matched.push(record.id);
    }
    return matched;
  }

  /** Startup recovery: finish every manifest the user already confirmed. */
  async reconcile(): Promise<{ resumed: KnowledgeCommitManifest[]; conflicts: Array<{ operationId: string; code: string; message: string; committed: boolean; writtenWikiIds: string[]; failedPhase?: string }> }> {
    const resumed: KnowledgeCommitManifest[] = [];
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
