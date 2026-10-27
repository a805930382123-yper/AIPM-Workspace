// B04: recoverable, versioned extraction drafts. A draft is the only place AI output lives
// until the user explicitly confirms; it is stored under drafts/<UUID>.json and never inside
// the formal Wiki directory.
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LlmError } from '../llm/provider.ts';
import { locateEvidenceInBody } from '../llm/evidence.ts';
import type { ExtractOutcome, ExtractedPage } from '../llm/service.ts';
import { mkdir } from 'node:fs/promises';
import { SerialQueue, scanJsonRecords, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { isExtractionDraft } from '../storage/record-validators.ts';
import { renderPageBody, renderSourceBody } from './render.ts';
import { assertHumanReviewed, assertReviewSources, assertReviewStructure, candidateContent, confirmHumanPage, moveHumanUnits, newHumanReview, reviewContentDigest, type HumanReview, type ReviewBasis, type ReviewUnit } from './human-review.ts';
import { ExtractionCheckpointStore } from '../llm/checkpoints.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../llm/rules.ts';
import { hasTemplateFields, validTemplateFields, type TemplateFields } from './template-fields.ts';

export const DRAFT_STATUSES = ['pending_confirmation', 'committing', 'confirmed', 'discarded'] as const;
export type DraftStatus = typeof DRAFT_STATUSES[number];

export type DraftEvidence = { id: string; rawId: string; quote: string; start: number; end: number; chunkIndex: number };
export type DraftFact = { text: string; evidenceIds: string[] };
export type DraftPage = {
  templateFields?: TemplateFields;
  pageId: string; title: string; type: string; category: string; one_line_definition: string;
  source_facts: DraftFact[]; ai_organized: string[]; ai_inferences: string[]; related_pages: string[]; open_questions: string[];
  source_evidence: DraftEvidence[];
  knowledge_status: string; confidence: string; source_level: string;
  selected: boolean;
  /** B05: persisted user choice for duplicate candidates; never inferred from selection. */
  reviewDecision?: 'update' | 'create' | 'defer';
  updateTargetWikiId?: string;
  provenance: Array<{ chunkIndex: number; start: number; end: number }>;
  mergedFrom?: string[];
  notes?: string[];
  editedFields?: string[];
};
export type DraftRawMeta = {
  rawId: string; title: string; sourceType: string; sourceName: string;
  author?: string; publishedAt?: string; url?: string; importedAt?: string;
};
export type DraftSource = {
  title: string; category: string; summary: string; key_takeaways: string[];
  body: string; knowledge_status: string; confidence: string; source_level: string;
  reuseWikiId?: string; editedByUser?: boolean; bodyEditedByUser?: boolean;
};
export type DraftRecord = {
  humanReview?: HumanReview;
  /** Explicit user references; original source units and classifications stay immutable. */
  humanQuestionUnitIds?: string[];
  id: string; rawId: string; rawSha256: string; rawTitle: string; rawMeta: DraftRawMeta;
  status: DraftStatus; revision: number; createdAt: string; updatedAt: string;
  rulesVersion: string; provider: { name: string; model: string }; jobId: string;
  document: { title: string; main_topic: string; summary: string };
  pages: DraftPage[]; source: DraftSource; warnings: string[];
  commitOperationId?: string; confirmedAt?: string; discardedAt?: string;
  extraction: { callCount: number; chunkCount: number; pagesFound: number };
};

export class DraftError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}

export type DraftPagePatch = {
  templateFields?: TemplateFields;
  pageId: string; selected?: boolean; reviewDecision?: 'update' | 'create' | 'defer'; updateTargetWikiId?: string; title?: string; type?: string; category?: string; one_line_definition?: string;
  source_facts?: DraftFact[]; ai_organized?: string[]; ai_inferences?: string[]; related_pages?: string[]; open_questions?: string[];
  source_evidence?: Array<{ id: string; rawId?: string; quote: string; start?: number; end?: number }>;
  knowledge_status?: string; confidence?: string; source_level?: string;
};
export type DraftPatch = {
  baseRevision: number; document?: Partial<DraftRecord['document']>; source?: Partial<DraftSource>;
  pages?: DraftPagePatch[]; deletePageIds?: string[]; merge?: { pageIds: string[]; title?: string };
};

type DraftRules = { types: string[]; categories: string[]; knowledge_status: string[]; confidence: string[]; source_level: string[]; review_status: string[] };

function defaultKnowledgeStatus(page: { source_facts: DraftFact[]; ai_inferences: string[]; ai_organized: string[] }): string {
  if (page.ai_inferences.length) return page.source_facts.length || page.ai_organized.length ? 'ai_organized' : 'inferred';
  return page.source_facts.length ? 'source_supported' : 'needs_verification';
}

/**
 * F04-05: Key Takeaways are derived from the pages that will actually be created. Callers pass the
 * effective selection, so the derived Source sections can never disagree with the confirmed set
 * (the draft's own `selected` flags are only a review convenience).
 */
export function derivedTakeaways(pages: Array<Pick<DraftPage, 'one_line_definition'>>): string[] {
  return pages.slice(0, 8).map(page => page.one_line_definition).filter(Boolean);
}

const draftQueues=new Map<string,SerialQueue>();
export class DraftStore {
  private readonly queue:SerialQueue;
  constructor(public readonly root: string) {const key=path.resolve(root);this.queue=draftQueues.get(key)??new SerialQueue();draftQueues.set(key,this.queue);}
  withReviewLock<T>(work:()=>Promise<T>):Promise<T>{return this.queue.run(work);}
  private directory() { return path.join(this.root, 'drafts'); }
  private fileFor(id: string) { return path.join(this.directory(), `${id}.json`); }

  async initialize() { await mkdir(this.directory(), { recursive: true }); }

  contentDigest(record: DraftRecord): string {
    if(!record.humanReview)throw new DraftError('HUMAN_REVIEW_REQUIRED','请先开始逐页人工审查。',409);
    return reviewContentDigest({draftId:record.id,rawId:record.rawId,rawSha256:record.rawSha256},candidateContent(record),record.humanReview);
  }
  async assertReviewed(record: DraftRecord, body: string): Promise<string> {
    assertReviewStructure(record.humanReview,record.pages.map(p=>p.pageId));
    assertReviewSources(record.humanReview,[{id:record.rawId,body,bodySha256:record.rawSha256}]);
    await this.assertEvidenceStillValid(record,body);
    const digest=this.contentDigest(record);assertHumanReviewed(record.humanReview,record.pages.map(p=>p.pageId),digest);return digest;
  }
  async prepareReviewedCommit(id:string,revision:number,digest:string,body:string,operationId:string,prepare:()=>Promise<void>):Promise<void> {
    await this.queue.run(async()=>{
      const current=await this.get(id);if(!current||current.status!=='pending_confirmation'||current.revision!==revision)throw new DraftError('DRAFT_REVISION_CONFLICT','草稿在提交准备期间变化，请刷新并重新审查。',409);
      if(await this.assertReviewed(current,body)!==digest)throw new DraftError('REVIEW_CONTENT_CHANGED','草稿内容已变化。',409);
      await prepare();await writeJsonAtomic(this.fileFor(id),{...current,status:'committing',commitOperationId:operationId,updatedAt:new Date().toISOString()});
    });
  }
  private reviewFromBasis(record: DraftRecord,basis: ReviewBasis): HumanReview {
    if(basis.pageUnitIds.length!==record.pages.length)throw new DraftError('REVIEW_BASIS_INVALID','审查页与来源目录不一致。',409);
    const refs=basis.pageUnitIds.flat();
    if(refs.length!==basis.units.length||new Set(refs).size!==refs.length||basis.units.some(u=>!refs.includes(u.id)))throw new DraftError('REVIEW_BASIS_INVALID','审查 unit 必须完整且唯一归属。',409);
    return newHumanReview(basis.units,Object.fromEntries(basis.pageUnitIds.flatMap((ids,i)=>ids.map(id=>[id,record.pages[i].pageId]))));
  }
  private legacyReview(record: DraftRecord): HumanReview {
    const units:ReviewUnit[]=[],owners:Record<string,string>={};
    for(const page of record.pages)for(const kind of ['fact','question'] as const){
      const entries=kind==='fact'?page.source_facts.map(f=>({text:f.text,evidenceIds:f.evidenceIds})):page.open_questions.map(text=>({text,evidenceIds:[] as string[]}));
      entries.forEach((entry,i)=>{const id=`legacy-${page.pageId}-${kind}-${i+1}`;units.push({id,kind,origin:'legacy',text:entry.text,memberIds:[],records:[{id,text:entry.text,evidenceIds:[...entry.evidenceIds]}],evidence:page.source_evidence.filter(e=>entry.evidenceIds.includes(e.id)).map(e=>({...e})),sourceLabel:kind==='question'?'旧记录无原文定位':'旧草稿原有事实，非原模型 fact ID'});owners[id]=page.pageId;});
    }
    return newHumanReview(units,owners);
  }
  private async migratedReview(record:DraftRecord,body:string,rulesDir:string):Promise<HumanReview> {
    const cp=await new ExtractionCheckpointStore(this.root).get(record.jobId);
    if(cp&&cp.rawId===record.rawId&&cp.rawSha256===record.rawSha256&&cp.jobId===record.jobId&&cp.draftId===record.id&&cp.plan&&cp.stage==='done'&&cp.attempts===record.extraction.callCount){
      const bundle=await loadExtractionRules(rulesDir);
      const provider={...record.provider,complete:async()=>{throw new DraftError('MIGRATION_OUTBOUND_FORBIDDEN','旧草稿迁移不得调用模型。',500);}};
      const args={raw:{...record.rawMeta,id:record.rawId,tags:[]},body,bodySha256:record.rawSha256,provider,rulesDir,checkpoint:{...cp,rulesVersion:bundle.rulesVersion}};
      await validateKnowledgeCheckpoint(args,{rulesVersion:record.rulesVersion,callCount:record.extraction.callCount});
      const result=await runKnowledgePipeline({...args,beforeCall:async()=>{throw new DraftError('MIGRATION_OUTBOUND_FORBIDDEN','旧草稿迁移不得调用模型。',500);},saveCheckpoint:async value=>({...value,integrity:cp.integrity})});
      const projection=(p:Pick<DraftPage,'title'|'type'|'category'|'source_facts'|'open_questions'|'source_evidence'>)=>({title:p.title,type:p.type,category:p.category,source_facts:p.source_facts,open_questions:p.open_questions,source_evidence:p.source_evidence.map(({id,rawId,quote,start,end,chunkIndex})=>({id,rawId,quote,start,end,chunkIndex}))});
      if(JSON.stringify(result.outcome.pages.map(projection))===JSON.stringify(record.pages.map(projection))&&result.outcome.reviewBasis)return this.reviewFromBasis(record,result.outcome.reviewBasis);
    }
    return this.legacyReview(record);
  }
  private deriveReviewPages(record:DraftRecord) {
    if(!record.humanReview)return;
    assertReviewStructure(record.humanReview,record.pages.map(p=>p.pageId));
    for(const page of record.pages){
      const units=record.humanReview.units.filter(u=>record.humanReview!.assignments[u.id]===page.pageId);
      const facts=units.filter(u=>u.kind==='fact'),questions=units.filter(u=>u.kind==='question');
      const evidence:DraftEvidence[]=[],aliases=new Map<string,Map<string,string>>();
      for(const unit of units){const map=new Map<string,string>();for(const item of unit.evidence){
        let id=item.id;const old=evidence.find(e=>e.id===id);
        if(old&&(old.rawId!==item.rawId||old.start!==item.start||old.end!==item.end||old.quote!==item.quote))id+=`-review-${createHash('sha256').update(JSON.stringify([item.rawId,item.start,item.end,item.quote])).digest('hex').slice(0,12)}`;
        map.set(item.id,id);if(!evidence.some(e=>e.id===id))evidence.push({...item,id});
      }aliases.set(unit.id,map);}
      page.source_facts=facts.flatMap(u=>u.records.map(r=>({text:r.text,evidenceIds:r.evidenceIds.map(id=>aliases.get(u.id)?.get(id)??id)})));
      page.open_questions=[...questions.flatMap(u=>u.records.map(r=>r.text)),...facts.filter(u=>u.factKind==='ambiguous').flatMap(u=>u.records.map(r=>'原文口径或边界待确认：'+r.text)),...facts.filter(u=>record.humanQuestionUnitIds?.includes(u.id)).map(u=>'人工标记待确认：'+u.text)];
      page.source_evidence=evidence;
      for (const field of Object.values(page.templateFields ?? {})) {
        const ai = field.aiContent;
        if (!ai) continue;
        const references = ai.factIds.map(id => {
          const unit = facts.find(u => u.records.some(r => r.id === id));
          return unit ? unit.records.find(r => r.id === id)!.evidenceIds.map(ref => aliases.get(unit.id)?.get(ref) ?? ref) : undefined;
        });
        if (references.every((ids): ids is string[] => ids !== undefined)) ai.evidenceIds = [...new Set(references.flat())];
      }
    }
  }
  async reviewOperation(id:string,input:{baseRevision:number;action:'start'|'move'|'page'|'questions';unitIds?:string[];pageId?:string|null;reviewContentDigest?:string;confirmed?:boolean;marked?:boolean},context:{body:string;rulesDir:string}):Promise<DraftRecord> {
    return this.queue.run(async()=>{
      const current=await this.get(id);if(!current)throw new DraftError('NOT_FOUND','没有找到这份草稿。',404);
      if(current.status!=='pending_confirmation')throw new DraftError('DRAFT_NOT_EDITABLE','草稿不在待审查状态。',409);
      if(input.baseRevision!==current.revision)throw new DraftError('DRAFT_REVISION_CONFLICT','草稿已修改，请刷新后审查。',409,{currentRevision:current.revision});
      await this.assertEvidenceStillValid(current,context.body);
      const next=structuredClone(current);
      if(input.action==='start'&&!next.humanReview)next.humanReview=await this.migratedReview(next,context.body,context.rulesDir);
      assertReviewStructure(next.humanReview,next.pages.map(p=>p.pageId));
      assertReviewSources(next.humanReview,[{id:next.rawId,body:context.body,bodySha256:next.rawSha256}]);
      if(input.action==='questions'){
        const ids=input.unitIds;
        if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!next.humanReview!.units.some(u=>u.id===id&&u.kind==='fact'))||typeof input.marked!=='boolean')throw new DraftError('INVALID_QUESTION_MARK','请明确标记已知且不重复的完整来源事实。',400);
        const marked=new Set(next.humanQuestionUnitIds??[]);
        for(const id of ids)if(input.marked)marked.add(id);else marked.delete(id);
        const ordered=next.humanReview.units.filter(u=>marked.has(u.id)).map(u=>u.id);
        if(JSON.stringify(ordered)===JSON.stringify(next.humanQuestionUnitIds??[]))return current;
        if(ordered.length)next.humanQuestionUnitIds=ordered;else delete next.humanQuestionUnitIds;
        next.humanReview.approvals=[];
        this.deriveReviewPages(next);
      }
      if(input.action==='move'){moveHumanUnits(next.humanReview,next.pages.map(p=>p.pageId),input.unitIds!,input.pageId!);this.deriveReviewPages(next);}
      for (const page of next.pages) this.validateTemplateReferences(page, next.rawId, current.pages.find(p => p.pageId === page.pageId), next.humanReview);
      if((input.action==='questions'||(input.action==='move'&&next.humanQuestionUnitIds?.length))&&!next.source.bodyEditedByUser)next.source.body=renderSourceBody(next.source,next.rawMeta,next.pages.filter(p=>p.selected),next.pages.filter(p=>!p.selected));
      if(input.action==='page')confirmHumanPage(next.humanReview,next.pages.map(p=>p.pageId),{pageId:input.pageId!,reviewContentDigest:input.reviewContentDigest!,confirmed:input.confirmed!},this.contentDigest(next));
      if(JSON.stringify(next)===JSON.stringify(current))return current;
      next.revision++;next.updatedAt=new Date().toISOString();await writeJsonAtomic(this.fileFor(id),next);return next;
    });
  }

  /** Defensive load-time check: a draft whose evidence no longer matches its Raw is reported. */
  async assertEvidenceStillValid(draft: DraftRecord, body: string): Promise<void> {
    for (const page of draft.pages) {
      this.validateTemplateReferences(page, draft.rawId, undefined, draft.humanReview);
      for (const evidence of page.source_evidence) {
        if (body.slice(evidence.start, evidence.end) !== evidence.quote) {
          throw new DraftError(
            'EVIDENCE_STALE',
            `草稿「${page.title}」的证据 ${evidence.id} 与当前原文不一致（原文可能已变化），请重新整理这条资料。`,
            409,
          );
        }
      }
    }
  }

  async get(id: string): Promise<DraftRecord | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    return readJsonRecord<DraftRecord>(this.root,this.fileFor(id),(value):value is DraftRecord=>isExtractionDraft(value,id));
  }

  async list(): Promise<DraftRecord[]> {
    const scan = await scanJsonRecords<DraftRecord>(this.directory(),(value,file):value is DraftRecord=>isExtractionDraft(value,path.basename(file,'.json')),this.root);
    return scan.records.map(record => record.value)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async findActiveForRaw(rawId: string): Promise<DraftRecord | undefined> {
    return (await this.list()).find(draft => draft.rawId === rawId && (draft.status === 'pending_confirmation' || draft.status === 'committing'));
  }

  async findByOperation(operationId: string): Promise<DraftRecord | undefined> {
    return (await this.list()).find(draft => draft.commitOperationId === operationId);
  }

  /** Creates the reviewable draft from a validated extraction outcome. */
  async create(input: {
    raw: { id: string; title: string; bodySha256: string; sourceType?: string; sourceName?: string; author?: string; publishedAt?: string; url?: string; importedAt?: string };
    outcome: ExtractOutcome; jobId: string; body: string; rules: DraftRules;
  }): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const now = new Date().toISOString();
      const pages: DraftPage[] = input.outcome.pages.map(page => this.fromExtracted(page, input.rules));
      const sourceTitle = input.outcome.document.title.trim().slice(0, 300) || input.raw.title;
      const rawMeta: DraftRawMeta = {
        rawId: input.raw.id, title: input.raw.title,
        sourceType: input.raw.sourceType ?? 'other', sourceName: input.raw.sourceName ?? input.raw.title,
        author: input.raw.author, publishedAt: input.raw.publishedAt, url: input.raw.url, importedAt: input.raw.importedAt,
      };
      const source: DraftSource = {
        title: sourceTitle, category: 'other',
        summary: input.outcome.document.summary,
        key_takeaways: derivedTakeaways(pages.filter(page => page.selected)),
        body: '', knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C',
      };
      const record: DraftRecord = {
        id: randomUUID(), rawId: input.raw.id, rawSha256: input.raw.bodySha256, rawTitle: input.raw.title, rawMeta,
        status: 'pending_confirmation', revision: 1, createdAt: now, updatedAt: now,
        rulesVersion: input.outcome.rulesVersion, provider: input.outcome.provider, jobId: input.jobId,
        document: input.outcome.document, pages, source, warnings: [...input.outcome.warnings],
        extraction: { callCount: input.outcome.callCount, chunkCount: input.outcome.chunkCount, pagesFound: input.outcome.pages.length },
      };
      if (input.outcome.reviewBasis) {
        record.humanReview=this.reviewFromBasis(record,input.outcome.reviewBasis);
        assertReviewSources(record.humanReview,[{id:input.raw.id,body:input.body,bodySha256:input.raw.bodySha256}]);
        this.deriveReviewPages(record);
      }
      for (const page of record.pages) this.validateTemplateReferences(page, record.rawId, undefined, record.humanReview);
      if (!pages.length) record.warnings.push('Provider 未给出任何知识建议，请放弃该草稿并检查来源。');
      // F04-03: nothing is selected by default — the user must explicitly choose what to write.
      record.warnings.push('默认未选择任何知识建议；只有勾选的条目会在确认后写入正式 Wiki。');
      // Default preview only: it is re-rendered from the actual selection on every save/confirm
      // while the user has not edited the body themselves (F04-05).
      record.source.body = renderSourceBody(record.source, record.rawMeta, record.pages.filter(page => page.selected), record.pages.filter(page => !page.selected));
      await writeJsonAtomic(this.fileFor(record.id), record);
      return record;
    });
  }

  private fromExtracted(page: ExtractedPage, rules: DraftRules): DraftPage {
    const draft: DraftPage = {
      ...(page.templateFields !== undefined ? {templateFields: structuredClone(page.templateFields)} : {}),
      pageId: randomUUID(), title: page.title, type: page.type, category: page.category,
      one_line_definition: page.one_line_definition,
      source_facts: page.source_facts.map(fact => ({ text: fact.text, evidenceIds: [...fact.evidenceIds] })),
      ai_organized: [...page.ai_organized], ai_inferences: [...page.ai_inferences],
      related_pages: [...page.related_pages], open_questions: [...page.open_questions],
      source_evidence: page.source_evidence.map(item => ({ id: item.id, rawId: item.rawId, quote: item.quote, start: item.start, end: item.end, chunkIndex: item.chunkIndex })),
      knowledge_status: defaultKnowledgeStatus(page),
      confidence: 'medium',
      // A conservative default the user can raise: B04 never invents an A/B level for unknown material.
      source_level: 'C',
      // F04-03: new knowledge pages start unselected; the user decides what becomes formal.
      selected: false,
      provenance: page.provenance.map(item => ({ ...item })),
      ...(page.mergedFrom ? { mergedFrom: [...page.mergedFrom] } : {}),
      ...(page.notes ? { notes: [...page.notes] } : {}),
    };
    if (!rules.types.includes(draft.type)) throw new DraftError('INVALID_TYPE', `建议类型 ${draft.type} 不在规则允许范围内。`, 502);
    if (!rules.categories.includes(draft.category)) throw new DraftError('INVALID_CATEGORY', `建议分类 ${draft.category} 不在规则允许范围内。`, 502);
    return draft;
  }

  /** Applies a user review patch: whole-record validation, server-anchored evidence and ids. */
  async patch(id: string, patch: DraftPatch, context: { body: string; rules: DraftRules }): Promise<DraftRecord> {
    return this.queue.run(async () => {
      if (Object.keys(patch).some(k=>!['baseRevision','document','source','pages','deletePageIds','merge'].includes(k))) throw new DraftError('INVALID_PATCH','不能通过普通编辑修改审查目录或确认记录。');
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      if (current.status === 'committing') throw new DraftError('DRAFT_COMMITTING', '这份草稿正在提交，暂不能编辑；请先查看提交状态。', 409);
      if (current.status !== 'pending_confirmation') throw new DraftError('DRAFT_NOT_EDITABLE', `草稿状态为 ${current.status}，不能再编辑。`, 409);
      if (patch.baseRevision !== current.revision) {
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅。', 409, { currentRevision: current.revision });
      }
      const next: DraftRecord = JSON.parse(JSON.stringify(current)) as DraftRecord;
      if(!next.humanReview&&(patch.merge||patch.deletePageIds?.length))throw new DraftError('HUMAN_REVIEW_REQUIRED','请先开始审查以保存不可变来源目录，再合并或删除页面。',409);
      if (patch.merge && current.pages.some(page => patch.merge!.pageIds.includes(page.pageId) && hasTemplateFields(page.templateFields))) throw new DraftError('TEMPLATE_MERGE_UNSUPPORTED', '本批不支持带字段归位的合并，原字段及人工说明已保留。', 409);
      // Source records are read-only even for an old draft before migration.
      for(const item of patch.pages??[]) {
        if(Object.keys(item).some(k=>['humanReview','reviewBasis','reviewContentDigest','reviewView'].includes(k)))throw new DraftError('INVALID_PATCH','不能通过页面编辑写入审查字段。');
        const original=current.pages.find(p=>p.pageId===item.pageId);
        if(original)for(const key of ['source_facts','source_evidence','open_questions'] as const){
          const normalized=(value:unknown)=>key==='source_evidence'?(value as DraftEvidence[]).map(({id,rawId,quote,start,end})=>({id,rawId:rawId??current.rawId,quote,start,end})):value;
          if(item[key]!==undefined&&JSON.stringify(normalized(item[key]))!==JSON.stringify(normalized(original[key])))throw new DraftError('SOURCE_RECORD_IMMUTABLE','原事实、原问题和来源证据只读；请移动完整 unit 或添加人工说明。',409);
        }
      }
      if (patch.document) {
        next.document = { ...next.document, ...patch.document };
        for (const key of ['title', 'main_topic', 'summary'] as const) {
          const value = next.document[key];
          if (typeof value !== 'string' || !value.trim()) throw new DraftError('INVALID_FIELD', `摘要字段 ${key} 不能为空。`, 400);
        }
      }
      const incomingTakeaways = patch.source?.key_takeaways;
      const incomingSource = patch.source;
      if (patch.source && incomingSource) {
        const incoming = incomingSource;
        // F04-01: distinguish "the user edited the Source content" from "the body must be
        // re-rendered for a new selection". Only a real body edit freezes the body text.
        const sourceFields = ['title', 'summary', 'category', 'knowledge_status', 'confidence', 'source_level', 'key_takeaways'] as const;
        const contentChanged = sourceFields.some(key => incoming[key] !== undefined
          && JSON.stringify(incoming[key]) !== JSON.stringify(current.source[key]));
        const bodyChanged = incoming.body !== undefined && incoming.body !== current.source.body;
        next.source = {
          ...next.source, ...incoming,
          reuseWikiId: current.source.reuseWikiId,
          ...(current.source.editedByUser||contentChanged||bodyChanged?{editedByUser:true}:{}),
          ...(current.source.bodyEditedByUser||bodyChanged?{bodyEditedByUser:true}:{}),
        };
        if (!next.source.title.trim()) throw new DraftError('INVALID_FIELD', 'Source 标题不能为空。', 400);
        if (typeof next.source.body !== 'string' || !next.source.body.trim()) throw new DraftError('INVALID_FIELD', 'Source 正文不能为空。', 400);
        for (const key of ['category', 'knowledge_status', 'confidence', 'source_level'] as const) {
          const allowed = key === 'category' ? context.rules.categories
            : key === 'confidence' ? context.rules.confidence
              : key === 'source_level' ? context.rules.source_level : context.rules.knowledge_status;
          if (!allowed.includes(next.source[key])) throw new DraftError('INVALID_FIELD', `Source 的 ${key} 取值无效。`, 400);
        }
      }
      if (patch.deletePageIds?.length) {
        const removing = new Set(patch.deletePageIds);
        const kept = next.pages.filter(page => !removing.has(page.pageId));
        if (!kept.length) throw new DraftError('NO_PAGES_LEFT', '至少要保留一条知识建议。', 400);
        if (patch.pages?.some(item => removing.has(item.pageId))) throw new DraftError('INVALID_PATCH', '同一次请求里既删除又修改了同一条建议。', 400);
        next.pages = kept;
      }
      for (const item of patch.pages ?? []) {
        const page = next.pages.find(candidate => candidate.pageId === item.pageId);
        if (!page) throw new DraftError('NOT_FOUND', `草稿里没有页面 ${item.pageId}。`, 404);
        this.applyPagePatch(page, item, context, next.rawId);
      }
      if(patch.merge)this.applyMerge(next,patch.merge);
      for (const page of next.pages) this.validatePage(page, context.rules);
      if(next.humanReview) {
        for(const unit of next.humanReview.units)if(next.humanReview.assignments[unit.id]!==null&&!next.pages.some(p=>p.pageId===next.humanReview!.assignments[unit.id]))next.humanReview.assignments[unit.id]=null;
        this.deriveReviewPages(next);
      }
      for (const page of next.pages) this.validateTemplateReferences(page, next.rawId, current.pages.find(p => p.pageId === page.pageId), next.humanReview);
      // F04-05: the Source body and its Key Takeaways list exactly the pages that would be
      // created, unless the user has written their own body text.
      const takeawaysUnchanged = incomingTakeaways === undefined
        || JSON.stringify(incomingTakeaways) === JSON.stringify(current.source.key_takeaways);
      if (takeawaysUnchanged) next.source.key_takeaways = derivedTakeaways(next.pages.filter(page => page.selected));
      if (!next.source.bodyEditedByUser) {
        next.source.body = renderSourceBody(next.source, next.rawMeta, next.pages.filter(page => page.selected), next.pages.filter(page => !page.selected));
      }
      if (JSON.stringify(candidateContent(next)) === JSON.stringify(candidateContent(current))) return current;
      if(next.humanReview)next.humanReview.approvals=[];
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      await writeJsonAtomic(this.fileFor(next.id), next);
      return next;
    });
  }

  async setDecision(id: string, pageId: string, input: { baseRevision: number; decision: 'update' | 'create' | 'defer'; targetWikiId?: string }): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      if (current.status !== 'pending_confirmation') throw new DraftError('DRAFT_NOT_EDITABLE', '草稿不在待审核状态。', 409);
      if (current.revision !== input.baseRevision) throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新审阅。', 409, { currentRevision: current.revision });
      const next: DraftRecord = JSON.parse(JSON.stringify(current)) as DraftRecord;
      const page = next.pages.find(item => item.pageId === pageId);
      if (!page) throw new DraftError('NOT_FOUND', '没有找到这条知识建议。', 404);
      if (input.decision === 'update' && !input.targetWikiId) throw new DraftError('TARGET_REQUIRED', '选择更新已有 Wiki 时必须指定目标页面。');
      page.reviewDecision = input.decision;
      page.updateTargetWikiId = input.decision === 'update' ? input.targetWikiId : undefined;
      if (input.decision === 'defer' || input.decision === 'update') page.selected = false;
      if (input.decision === 'create') page.selected = true;
      if(JSON.stringify(candidateContent(next))===JSON.stringify(candidateContent(current)))return current;
      if(next.humanReview)next.humanReview.approvals=[];
      next.revision++; next.updatedAt = new Date().toISOString();
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  private applyPagePatch(page: DraftPage, item: DraftPagePatch, context: { body: string; rules: DraftRules }, rawId: string): void {
    const edited = new Set(page.editedFields ?? []);
    const candidateBasis = new Set(['title', 'type', 'category', 'one_line_definition', 'source_facts', 'ai_organized', 'templateFields']);
    const setField = (key: keyof DraftPage, value: unknown) => {
      const name = key as string;
      if(JSON.stringify((page as Record<string,unknown>)[name])===JSON.stringify(value))return;
      if (candidateBasis.has(name) && JSON.stringify((page as Record<string, unknown>)[name]) !== JSON.stringify(value)) { page.reviewDecision = undefined; page.updateTargetWikiId = undefined; }
      edited.add(name); (page as Record<string, unknown>)[name] = value;
    };
    if (item.selected !== undefined) page.selected = Boolean(item.selected);
    if (item.reviewDecision !== undefined) {
      if (!['update', 'create', 'defer'].includes(item.reviewDecision)) throw new DraftError('INVALID_DECISION', '知识建议处理决策无效。', 400);
      page.reviewDecision = item.reviewDecision;
      page.updateTargetWikiId = item.reviewDecision === 'update' ? item.updateTargetWikiId : undefined;
      if (item.reviewDecision === 'update' && !item.updateTargetWikiId) throw new DraftError('TARGET_REQUIRED', '选择更新已有 Wiki 时必须指定目标页面。', 400);
      if (item.reviewDecision === 'defer') page.selected = false;
    }
    if (item.title !== undefined) { if (!item.title.trim()) throw new DraftError('INVALID_FIELD', '标题不能为空。', 400); setField('title', item.title.trim()); }
    if (item.type !== undefined) {
      if (!context.rules.types.includes(item.type)) throw new DraftError('INVALID_TYPE', '知识类型无效。', 400);
      if (item.type !== page.type && hasTemplateFields(page.templateFields)) throw new DraftError('TEMPLATE_TYPE_CHANGE_UNSUPPORTED', '本批不支持带字段归位的类型切换，原内容已保留。', 409);
      setField('type', item.type);
    }
    if (item.templateFields !== undefined) {
      if (!validTemplateFields(item.templateFields, page.type)) throw new DraftError('INVALID_TEMPLATE_FIELDS', '字段归位格式或字段名称无效。', 400);
      const normalized: TemplateFields = {};
      for (const [key, field] of Object.entries(item.templateFields)) {
        const humanText = field.humanText?.trim();
        const oldAi = page.templateFields?.[key as keyof TemplateFields]?.aiContent;
        const ai = field.aiContent;
        if (ai && (!oldAi || JSON.stringify(ai.factIds) !== JSON.stringify(oldAi.factIds) || JSON.stringify(ai.evidenceIds) !== JSON.stringify(oldAi.evidenceIds))) throw new DraftError('TEMPLATE_AI_REFERENCES_IMMUTABLE', 'AI字段的原事实引用只读；可修改AI草稿文字或删除该AI项。', 409);
        const aiContent = ai && oldAi ? {text:ai.text.trim(),factIds:[...oldAi.factIds],evidenceIds:[...oldAi.evidenceIds],...(oldAi.humanEdited || ai.text.trim() !== oldAi.text ? {humanEdited:true as const} : {})} : undefined;
        if (field.evidenceIds.length || humanText || aiContent) normalized[key as keyof TemplateFields] = { evidenceIds: [...field.evidenceIds], ...(humanText ? { humanText } : {}), ...(aiContent ? {aiContent} : {}) };
      }
      setField('templateFields', hasTemplateFields(normalized) ? normalized : undefined);
      if (page.templateFields === undefined) delete page.templateFields;
    }
    if (item.category !== undefined) { if (!context.rules.categories.includes(item.category)) throw new DraftError('INVALID_CATEGORY', '分类无效。', 400); setField('category', item.category); }
    if (item.one_line_definition !== undefined) { if (!item.one_line_definition.trim()) throw new DraftError('INVALID_FIELD', '一句话定义不能为空。', 400); setField('one_line_definition', item.one_line_definition.trim()); }
    if (item.ai_organized !== undefined) setField('ai_organized', item.ai_organized.map(value => value.trim()).filter(Boolean));
    if (item.ai_inferences !== undefined) setField('ai_inferences', item.ai_inferences.map(value => value.trim()).filter(Boolean));
    if (item.related_pages !== undefined) setField('related_pages', item.related_pages.map(value => value.trim()).filter(Boolean));
    // Original questions are immutable, including whitespace and duplicate occurrences.
    if (item.source_evidence !== undefined) {
      const located: DraftEvidence[] = item.source_evidence.map(evidence => {
        if (evidence.rawId !== undefined && evidence.rawId !== rawId) {
          throw new DraftError('EVIDENCE_INVALID_SOURCE', '证据的 rawId 不能改成本条 Raw 之外的值。', 422);
        }
        if (!evidence.id?.trim()) throw new DraftError('EVIDENCE_ID_REQUIRED', '证据必须有 id。', 400);
        try {
          const result = locateEvidenceInBody({ id: evidence.id, rawId, quote: evidence.quote, start: evidence.start, end: evidence.end }, context.body, rawId);
          return { id: result.id, rawId, quote: result.quote, start: result.start, end: result.end, chunkIndex: page.source_evidence.find(current => current.id === result.id)?.chunkIndex ?? -1 };
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
    if (item.source_facts !== undefined && JSON.stringify(item.source_facts)!==JSON.stringify(page.source_facts)) {
      const facts = item.source_facts.map(fact => ({ text: String(fact.text ?? '').trim(), evidenceIds: [...(fact.evidenceIds ?? [])] }));
      if (!facts.length) throw new DraftError('INVALID_FIELD', '来源事实不能全部删除；没有事实的条目请改为推断或删除该建议。', 400);
      for (const fact of facts) {
        if (!fact.text) throw new DraftError('INVALID_FIELD', '来源事实内容不能为空。', 400);
        if (!fact.evidenceIds.length) throw new DraftError('FACT_WITHOUT_EVIDENCE', `来源事实「${fact.text.slice(0, 20)}…」缺少证据引用。`, 422);
      }
      setField('source_facts', facts);
    }
    if (item.knowledge_status !== undefined) { if (!context.rules.knowledge_status.includes(item.knowledge_status)) throw new DraftError('INVALID_FIELD', '知识状态无效。', 400); setField('knowledge_status', item.knowledge_status); }
    if (item.confidence !== undefined) { if (!context.rules.confidence.includes(item.confidence)) throw new DraftError('INVALID_FIELD', '可信度无效。', 400); setField('confidence', item.confidence); }
    if (item.source_level !== undefined) { if (!context.rules.source_level.includes(item.source_level)) throw new DraftError('INVALID_FIELD', '来源等级无效。', 400); setField('source_level', item.source_level); }
    if (edited.size) page.editedFields = [...edited];
  }

  private applyMerge(next: DraftRecord, merge: { pageIds: string[]; title?: string }): void {
    const ids = [...new Set(merge.pageIds)];
    if (ids.length < 2) throw new DraftError('INVALID_MERGE', '合并至少需要选择两条建议。', 400);
    const targets = ids.map(id => next.pages.find(page => page.pageId === id));
    if (targets.some(page => !page)) throw new DraftError('NOT_FOUND', '合并目标里有不存在的建议。', 404);
    const pages = targets as DraftPage[];
    if (pages.some(page => hasTemplateFields(page.templateFields))) throw new DraftError('TEMPLATE_MERGE_UNSUPPORTED', '本批不支持带字段归位的合并，原字段及人工说明已保留。', 409);
    const [first, ...rest] = pages;
    const merged: DraftPage = JSON.parse(JSON.stringify(first)) as DraftPage;
    merged.selected = pages.some(page => page.selected);
    merged.title = merge.title?.trim() || first.title;
    merged.mergedFrom = [...new Set([...(first.mergedFrom ?? [first.title]), ...pages.slice(1).flatMap(page => page.mergedFrom ?? [page.title])])];
    merged.provenance = [];
    for (const page of pages) for (const entry of page.provenance) {
      if (!merged.provenance.some(current => current.chunkIndex === entry.chunkIndex && current.start === entry.start)) merged.provenance.push({ ...entry });
    }
    const evidenceSeen = new Map<string, DraftEvidence>();
    merged.source_evidence = [];
    // F04-07: rebuild the fact list from every merged page. Facts keep their identity as facts
    // (never moved into inferences); equal facts are deduplicated and their evidence combined.
    merged.source_facts = [];
    for (const page of pages) {
      const rename = new Map<string, string>();
      for (const evidence of page.source_evidence) {
        const taken = evidenceSeen.get(evidence.id);
        if (!taken) { evidenceSeen.set(evidence.id, evidence); merged.source_evidence.push({ ...evidence }); rename.set(evidence.id, evidence.id); continue; }
        if (taken.quote === evidence.quote && taken.start === evidence.start) { rename.set(evidence.id, taken.id); continue; }
        let candidate = `${evidence.id}-m${merged.source_evidence.length + 1}`;
        while (evidenceSeen.has(candidate)) candidate = `${candidate}x`;
        evidenceSeen.set(candidate, evidence);
        merged.source_evidence.push({ ...evidence, id: candidate });
        rename.set(evidence.id, candidate);
      }
      for (const fact of page.source_facts) {
        const idsForFact = fact.evidenceIds.map(id => rename.get(id) ?? id);
        const duplicate = merged.source_facts.find(item => item.text === fact.text);
        if (duplicate) {
          for (const id of idsForFact) {
            if (!duplicate.evidenceIds.includes(id)) duplicate.evidenceIds.push(id);
          }
        } else {
          merged.source_facts.push({ text: fact.text, evidenceIds: idsForFact });
        }
      }
    }
    merged.ai_organized = [...new Set(pages.flatMap(page => page.ai_organized))];
    merged.ai_inferences = [...new Set(pages.flatMap(page => page.ai_inferences))];
    merged.open_questions = [...new Set(pages.flatMap(page => page.open_questions))];
    merged.related_pages = [...new Set(pages.flatMap(page => page.related_pages).filter(title => title !== merged.title))];
    merged.notes = [...new Set([...(merged.notes ?? []), ...rest.flatMap(page => page.notes ?? []), `由用户合并 ${pages.length} 条建议（${pages.map(page => page.title).join('、')}）。`])];
    merged.editedFields = [...new Set([...(merged.editedFields ?? []), 'merge'])];
    merged.knowledge_status = pages.some(page => page.knowledge_status === 'ai_organized') ? 'ai_organized' : first.knowledge_status;
    merged.confidence = pages.some(page => page.confidence === 'low') ? 'low' : first.confidence;
    next.pages = [...next.pages.filter(page => !ids.includes(page.pageId)), merged];
    if(next.humanReview)for(const unit of next.humanReview.units)if(ids.includes(next.humanReview.assignments[unit.id]??''))next.humanReview.assignments[unit.id]=merged.pageId;
  }

  private validateTemplateReferences(page: DraftPage, rawId: string, previous?: DraftPage, review?: HumanReview): void {
    if (page.templateFields === undefined) return;
    if (!validTemplateFields(page.templateFields, page.type)) throw new DraftError('INVALID_TEMPLATE_FIELDS', '字段归位格式或字段名称无效。', 422);
    const previousIds = new Set(Object.values(previous?.templateFields ?? {}).flatMap(field => field.evidenceIds));
    for (const field of Object.values(page.templateFields)) for (const id of field.evidenceIds) {
      const evidence = page.source_evidence.find(item => item.id === id);
      if (!evidence || evidence.rawId !== rawId) throw new DraftError('TEMPLATE_EVIDENCE_UNKNOWN', `字段引用 ${id} 不属于当前页面；请撤销对应引用后再移动来源。`, 422);
      const old = previousIds.has(id) ? previous?.source_evidence.find(item => item.id === id) : undefined;
      if (old && (old.rawId !== evidence.rawId || old.quote !== evidence.quote || old.start !== evidence.start || old.end !== evidence.end)) {
        throw new DraftError('TEMPLATE_EVIDENCE_CHANGED', `来源移动会改变字段引用 ${id} 的原文，操作已停止，原字段已保留。`, 409);
      }
    }
    for (const field of Object.values(page.templateFields)) {
      const ai = field.aiContent;
      if (!ai) continue;
      const units = review?.units.filter(unit => unit.kind === 'fact' && review.assignments[unit.id] === page.pageId) ?? [];
      const expected: string[] = [];
      for (const id of ai.factIds) {
        const unit = units.find(item => item.records.some(record => record.id === id));
        const fact = unit?.records.find(record => record.id === id);
        if (!unit || !fact || unit.records.some(record => !ai.factIds.includes(record.id))) throw new DraftError('TEMPLATE_AI_FACT_UNKNOWN', `AI字段引用的完整原事实 ${id} 不属于当前页面；请先删除对应AI项再移动来源。`, 422);
        for (const ref of fact.evidenceIds) {
          const original = unit.evidence.find(evidence => evidence.id === ref);
          const evidence = original && page.source_evidence.find(item => item.rawId === rawId && item.rawId === original.rawId && item.start === original.start && item.end === original.end && item.quote === original.quote);
          if (!evidence) throw new DraftError('TEMPLATE_AI_EVIDENCE_UNKNOWN', 'AI字段的原事实证据无法对应当前页面，原草稿已保留。', 422);
          expected.push(evidence.id);
        }
      }
      const ids = [...new Set(expected)];
      if (ids.length !== ai.evidenceIds.length || ai.evidenceIds.some(id => !ids.includes(id))) throw new DraftError('TEMPLATE_AI_EVIDENCE_UNKNOWN', 'AI字段未保留原事实的完整来源引用，原草稿已保留。', 422);
    }
  }

  private validatePage(page: DraftPage, rules: DraftRules): void {
    if (!page.title.trim()) throw new DraftError('INVALID_FIELD', '每条建议都必须有标题。', 400);
    if (!rules.types.includes(page.type)) throw new DraftError('INVALID_TYPE', `类型 ${page.type} 无效。`, 400);
    if (!rules.categories.includes(page.category)) throw new DraftError('INVALID_CATEGORY', `分类 ${page.category} 无效。`, 400);
    if (!page.one_line_definition.trim()) throw new DraftError('INVALID_FIELD', `建议「${page.title}」缺少一句话说明。`, 400);
    if (!rules.knowledge_status.includes(page.knowledge_status)) throw new DraftError('INVALID_FIELD', '知识状态无效。', 400);
    if (!rules.confidence.includes(page.confidence)) throw new DraftError('INVALID_FIELD', '可信度无效。', 400);
    if (!rules.source_level.includes(page.source_level)) throw new DraftError('INVALID_FIELD', '来源等级无效。', 400);
    const ids = new Set(page.source_evidence.map(evidence => evidence.id));
    for (const fact of page.source_facts) {
      for (const id of fact.evidenceIds) {
        if (!ids.has(id)) throw new DraftError('EVIDENCE_UNKNOWN_ID', `建议「${page.title}」引用了不存在的证据 ${id}。`, 422);
      }
    }
  }

  /** Preview payload: adds the server-rendered body for each page. */
  view(record: DraftRecord, options: { sourceTitle?: string } = {}): DraftRecord & { pages: Array<DraftPage & { renderedBody: string }>; sourceRenderedBody: string } {
    // F04-05: when an existing Source is reused, the pages must link its real title.
    const sourceTitle = options.sourceTitle ?? record.source.title;
    const selectedPages = record.pages.filter(page => page.selected);
    const createdTitles = new Set([...selectedPages.map(page => page.title), sourceTitle]);
    const sourceBody = record.source.bodyEditedByUser
      ? record.source.body
      : renderSourceBody(record.source, record.rawMeta, selectedPages, record.pages.filter(page => !page.selected));
    return {
      ...record,
      sourceRenderedBody: sourceBody,
      pages: record.pages.map(page => ({
        ...page,
        renderedBody: renderPageBody(page, { sourceTitle, rawId: record.rawId, createdTitles }),
      })),
    };
  }

  async discard(id: string, baseRevision: number | undefined): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      if (current.status === 'discarded') return current;
      if (current.status === 'confirmed') throw new DraftError('DRAFT_CONFIRMED', '这份草稿已经写入正式知识，不能放弃。', 409);
      if (current.status === 'committing') throw new DraftError('DRAFT_COMMITTING', '这份草稿正在提交，暂不能放弃；请先查看提交状态。', 409);
      if (baseRevision !== undefined && baseRevision !== current.revision) {
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新确认放弃。', 409, { currentRevision: current.revision });
      }
      const next: DraftRecord = { ...current, status: 'discarded', discardedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  async markCommitting(id: string, operationId: string): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      const next: DraftRecord = { ...current, status: 'committing', commitOperationId: operationId, updatedAt: new Date().toISOString() };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  async markConfirmed(id: string, operationId: string): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      const next: DraftRecord = { ...current, status: 'confirmed', commitOperationId: operationId, confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  /** Returns the draft to the editable state after a failure that wrote nothing. */
  async resetToPending(id: string, reason: string): Promise<DraftRecord | undefined> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) return undefined;
      const next: DraftRecord = {
        ...current, status: 'pending_confirmation', updatedAt: new Date().toISOString(),
        warnings: [...current.warnings, reason],
      };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
}


