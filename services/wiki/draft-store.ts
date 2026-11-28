import { validMaintenance, type KnowledgeChange, type KnowledgeMaintenance } from './maintenance.ts';
import { type PdfDraftInput } from './pdf-input.ts';
import type { RawRecord } from '../raw/store.ts';
import { questionHash } from './question-input.ts';
import {
  verifyEvidenceInput,
  validEvidenceInput,
  type EvidenceDraftInput,
  type InspectionDraftInput,
} from './inspection-input.ts';
import { WikiStore } from './store.ts';
import { RawStore } from '../raw/store.ts';
import { randomUUID } from 'node:crypto';
import { validStructuredNote, type StructuredNote } from './structured-note.ts';
import { validDeepQuality, type DeepQualityReport } from '../llm/knowledge-deep.ts';
import path from 'node:path';
import type { DraftModelProvenance } from '../llm/checkpoint-models.ts';
import type { ExtractOutcome, ExtractedPage } from '../llm/service.ts';
import { mkdir } from 'node:fs/promises';
import { SerialQueue, scanJsonRecords, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { isExtractionDraft } from '../storage/record-validators.ts';
import { renderSourceBody } from './render.ts';
import { newHumanReview, type HumanReview, type ReviewBasis, type ReviewUnit } from './human-review.ts';
import { type TemplateFields } from './template-fields.ts';
import type { WikiRecord } from './store.ts';
import {
  DraftError,
  isQuestionDraft,
  derivedTakeaways,
  draftDirectory,
  draftFilePath,
  type DraftRecord,
  type KnowledgeDraftRecord,
  type QuestionDraftRecord,
  type DraftPage,
  type DraftSource,
  type DraftRawMeta,
  type DraftRules,
  type DraftPagePatch,
  type DraftPatch,
} from './draft-types.ts';
import {
  computeDraftContentDigest,
  computeDraftOutcomeDigest,
  loadDraftImageText,
  assertCapturedReview,
  assertRawOutcome,
  assertDraftReviewed,
  assertNoteReviewed,
  normalizedTemplateFields,
  assertRoundtripSize,
  assertEvidenceStillValid,
  validateTemplateReferences,
  validateDraftPage,
  buildDraftView,
  type DraftDigestContext,
} from './draft-digest.ts';
import { reviewFromBasis, buildLegacyReview, migrateDraftReview, deriveReviewPages } from './draft-migration.ts';
import { fromExtractedPage, applyDraftPagePatch, applyDraftMerge, applyDraftPatchRecord } from './draft-patch.ts';
import {
  reviewOperation,
  reviewStructuredNote,
  editStructuredNote,
  reviewQuestionOperation,
  reviewKnowledgeChange,
  savePreparedChange,
  finishMaintenance,
  setDeferred,
  setDecision,
  type DraftReviewContext,
} from './draft-review.ts';
const draftQueues = new Map<string, SerialQueue>();
export class DraftStore {
  private readonly queue: SerialQueue;
  constructor(public readonly root: string) {
    const key = path.resolve(root);
    this.queue = draftQueues.get(key) ?? new SerialQueue();
    draftQueues.set(key, this.queue);
  }
  withReviewLock<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private directory() {
    return draftDirectory(this.root);
  }
  private fileFor(id: string) {
    return draftFilePath(this.root, id);
  }
  private async imageText(rawId: string) {
    return loadDraftImageText(this.digestContext, rawId);
  }
  private async assertCapturedReview(review: HumanReview, id: string, body: string, bodySha256: string) {
    return assertCapturedReview(this.digestContext, review, id, body, bodySha256);
  }
  async initialize() {
    await mkdir(this.directory(), { recursive: true });
  }
  contentDigest(record: KnowledgeDraftRecord): string {
    return computeDraftContentDigest(record);
  }
  outcomeDigest(record: DraftRecord): string {
    return computeDraftOutcomeDigest(record);
  }
  async assertRawOutcome(record: DraftRecord, body: string, selectedPageIds: string[], digest: string): Promise<void> {
    return assertRawOutcome(this.digestContext, record, body, selectedPageIds, digest);
  }
  async assertReviewed(record: KnowledgeDraftRecord, body: string, appliedTargets: WikiRecord[] = []): Promise<string> {
    return assertDraftReviewed(this.digestContext, record, body, appliedTargets);
  }
  private assertNoteReviewed(record: DraftRecord, digest: string): void {
    return assertNoteReviewed(record, digest);
  }
  async reviewStructuredNote(id: string, input: unknown, body: string): Promise<DraftRecord> {
    return reviewStructuredNote(this.reviewContext, id, input, body);
  }
  async prepareReviewedCommit(
    id: string,
    revision: number,
    digest: string,
    body: string,
    operationId: string,
    prepare: () => Promise<void>,
    outcomePageIds?: string[],
  ): Promise<void> {
    await this.queue.run(async () => {
      const current = await this.getKnowledge(id);
      if (!current || current.status !== 'pending_confirmation' || current.revision !== revision)
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿在提交准备期间变化，请刷新并重新审查。', 409);
      if (outcomePageIds !== undefined && !isQuestionDraft(current))
        await this.assertRawOutcome(current, body, outcomePageIds, digest);
      else if ((await this.assertReviewed(current, body)) !== digest)
        throw new DraftError('REVIEW_CONTENT_CHANGED', '草稿内容已变化。', 409);
      await prepare();
      await writeJsonAtomic(this.fileFor(id), {
        ...current,
        status: 'committing',
        commitOperationId: operationId,
        updatedAt: new Date().toISOString(),
      });
    });
  }
  private reviewFromBasis(record: DraftRecord, basis: ReviewBasis): HumanReview {
    return reviewFromBasis(record, basis);
  }
  private legacyReview(record: DraftRecord): HumanReview {
    return buildLegacyReview(record);
  }
  private async migratedReview(record: DraftRecord, body: string, rulesDir: string): Promise<HumanReview> {
    return migrateDraftReview(
      { root: this.root, reviewFromBasis: this.reviewFromBasis.bind(this), legacyReview: this.legacyReview.bind(this) },
      record,
      body,
      rulesDir,
    );
  }
  private normalizedFields(fields: TemplateFields, previous?: TemplateFields): TemplateFields {
    return normalizedTemplateFields(fields, previous);
  }
  private assertRoundtripSize(record: DraftRecord): void {
    return assertRoundtripSize(record);
  }
  private deriveReviewPages(record: KnowledgeDraftRecord, rebindFields = false) {
    return deriveReviewPages(record, rebindFields);
  }
  async reviewOperation(
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
    return reviewOperation(this.reviewContext, id, input, context);
  }
  async assertEvidenceStillValid(draft: DraftRecord, body: string, pages = draft.pages): Promise<void> {
    return assertEvidenceStillValid(this.digestContext, draft, body, pages);
  }
  async getKnowledge(id: string): Promise<KnowledgeDraftRecord | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    return readJsonRecord(this.root, this.fileFor(id), (value): value is KnowledgeDraftRecord =>
      isExtractionDraft(value, id),
    );
  }
  async get(id: string): Promise<DraftRecord | undefined> {
    const record = await this.getKnowledge(id);
    return record && !isQuestionDraft(record) ? record : undefined;
  }
  async listKnowledge(): Promise<KnowledgeDraftRecord[]> {
    const scan = await scanJsonRecords<KnowledgeDraftRecord>(
      this.directory(),
      (value, file): value is KnowledgeDraftRecord => isExtractionDraft(value, path.basename(file, '.json')),
      this.root,
    );
    return scan.records.map((r) => r.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async createInspection(input: {
    id: string;
    input: InspectionDraftInput;
    maintenance: KnowledgeMaintenance;
    provider: DraftRecord['provider'];
    callCount: number;
  }) {
    return this.createQuestion(input);
  }
  async createPdf(input: {
    id: string;
    raw: RawRecord;
    binding: PdfDraftInput;
    pages: Array<Omit<DraftPage, 'pageId' | 'selected'>>;
    maintenance: KnowledgeMaintenance;
    provider: DraftRecord['provider'];
    modelProvenance?: DraftModelProvenance;
    callCount: number;
    batchCount: number;
  }): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const existing = await this.get(input.id);
      if (existing) return existing;
      const { raw, binding } = input;
      const now = new Date().toISOString();
      const pages = input.pages.map((page) => ({ ...page, pageId: randomUUID(), selected: false }));
      const title = raw.title;
      const summary =
        'PDF 第 ' + binding.startPage + '–' + binding.endPage + ' 页内容整理（原件共 ' + binding.pageCount + ' 页）。';
      const rawMeta: DraftRawMeta = {
        rawId: raw.id,
        title,
        sourceType: raw.sourceType,
        sourceName: raw.sourceName,
        author: raw.author,
        publishedAt: raw.publishedAt,
        url: raw.url,
        importedAt: raw.importedAt,
      };
      const source: DraftSource = {
        title,
        category: 'other',
        summary,
        key_takeaways: [],
        body: '',
        knowledge_status: 'ai_organized',
        confidence: 'medium',
        source_level: 'D',
      };
      source.body = renderSourceBody(source, rawMeta, [], pages);
      const record: DraftRecord = {
        id: input.id,
        pdfInput: binding,
        rawId: raw.id,
        rawTitle: title,
        rawSha256: raw.bodySha256,
        rawMeta,
        source,
        document: { title, main_topic: title, summary, source_level: 'D' },
        pages,
        maintenance: input.maintenance,
        status: 'pending_confirmation',
        revision: 1,
        createdAt: now,
        updatedAt: now,
        rulesVersion: 'pdf-cleanup-1',
        provider: input.provider,
        ...(input.modelProvenance ? { modelProvenance: input.modelProvenance } : {}),
        jobId: input.id,
        warnings: ['图像理解为 AI 衍生内容；请对照 PDF 原页审核。'],
        extraction: { callCount: input.callCount, chunkCount: input.batchCount, pagesFound: pages.length },
      };
      if (!isExtractionDraft(record)) throw new DraftError('PDF_DRAFT_INVALID', 'PDF 整理草稿结构无效。', 409);
      await writeJsonAtomic(this.fileFor(record.id), record);
      return record;
    });
  }
  async createQuestion(input: {
    id: string;
    input: EvidenceDraftInput;
    maintenance: KnowledgeMaintenance;
    provider: DraftRecord['provider'];
    callCount: number;
  }): Promise<QuestionDraftRecord> {
    return this.queue.run(async () => {
      const existing = await this.getKnowledge(input.id);
      if (existing) {
        if (!isQuestionDraft(existing) || questionHash(existing.input) !== questionHash(input.input))
          throw new DraftError('QUESTION_DRAFT_CONFLICT', '此草稿标识已绑定其他内容。', 409);
        return existing;
      }
      if (!validEvidenceInput(input.input) || !validMaintenance(input.maintenance))
        throw new DraftError('QUESTION_INPUT_INVALID', '问答维护输入无效。');
      const raws = new RawStore(this.root);
      await verifyEvidenceInput(input.input, new WikiStore(this.root, raws), raws);
      const now = new Date().toISOString(),
        pages: DraftPage[] = input.maintenance.changes.map((c) => ({
          pageId: randomUUID(),
          title: c.candidate.title,
          type: c.candidate.type,
          category: c.candidate.category,
          one_line_definition: c.candidate.title,
          source_facts: input.input.citations.map((ref) => ({
            text: ref.quote,
            evidenceIds: ref.kind === 'raw' ? [ref.id] : [],
          })),
          ai_organized: input.input.sections
            .filter((s) => s.kind === 'fact' || s.kind === 'conflict')
            .map((s) => s.text),
          ai_inferences: input.input.sections
            .filter((s) => s.kind === 'inference' || s.kind === 'advice')
            .map((s) => s.text),
          related_pages: [],
          open_questions: input.input.sections.filter((s) => s.kind === 'insufficient').map((s) => s.text),
          source_evidence: input.input.citations
            .filter((ref) => ref.kind === 'raw')
            .map((ref) => ({
              id: ref.id,
              rawId: ref.recordId,
              quote: ref.quote,
              start: ref.start,
              end: ref.end,
              chunkIndex: -1,
              ...(ref.media ? { media: ref.media } : {}),
            })),
          knowledge_status: c.candidate.knowledge_status,
          confidence: c.candidate.confidence,
          source_level: c.candidate.source_level,
          selected: false,
          provenance: [],
        }));
      const units: ReviewUnit[] = input.input.citations.map((ref, i) => ({
        id: 'reference-' + i,
        kind: 'fact',
        origin: ref.kind === 'wiki' ? 'wiki' : 'legacy',
        text: ref.quote,
        memberIds: [],
        records: [{ id: 'reference-' + i, text: ref.quote, evidenceIds: ref.kind === 'raw' ? [ref.id] : [] }],
        evidence:
          ref.kind === 'raw'
            ? [
                {
                  id: ref.id,
                  rawId: ref.recordId,
                  quote: ref.quote,
                  start: ref.start,
                  end: ref.end,
                  chunkIndex: -1,
                  ...(ref.media ? { media: ref.media } : {}),
                },
              ]
            : [],
        sourceLabel:
          ref.kind === 'wiki' ? '知识页内容：' + ref.title + ' / v' + ref.revision : '原始资料：' + ref.title,
      }));
      input.input.sections.forEach((section, i) =>
        units.push({
          id: 'answer-proposal-' + i,
          kind: 'proposal',
          origin: 'model',
          text: section.text,
          memberIds: [],
          records: [],
          evidence: [],
          sourceLabel:
            section.kind === 'inference' || section.kind === 'advice'
              ? '问答推断/建议，非原文事实'
              : '问答整理提议，非原文引文',
        }),
      );
      const record: QuestionDraftRecord = {
        input: structuredClone(input.input),
        maintenance: structuredClone(input.maintenance),
        id: input.id,
        status: 'pending_confirmation',
        revision: 1,
        createdAt: now,
        updatedAt: now,
        rulesVersion: 'lw02-question-answer-1',
        provider: input.provider,
        document: {
          title: input.input.kind === 'inspection' ? '检查维护' : input.input.preview.title,
          main_topic: input.input.kind === 'inspection' ? '检查问题维护' : input.input.question,
          summary:
            input.input.kind === 'inspection'
              ? input.input.findings.map((f) => f.summary).join('；')
              : input.input.preview.conclusion,
        },
        pages,
        warnings: ['引用已核对身份、版本和原句；语义支持程度仍需人工审查。'],
        extraction: { callCount: input.callCount, chunkCount: 0, pagesFound: pages.length },
        humanReview: newHumanReview(units, Object.fromEntries(units.map((u) => [u.id, pages[0].pageId]))),
      };
      await writeJsonAtomic(this.fileFor(record.id), record);
      return record;
    });
  }
  async reviewQuestionOperation(
    id: string,
    input: { baseRevision: number; action: string; unitIds?: string[]; pageId?: string | null },
  ): Promise<QuestionDraftRecord> {
    return reviewQuestionOperation(this.reviewContext, id, input);
  }
  async editStructuredNote(id: string, input: unknown, body: string): Promise<DraftRecord> {
    return editStructuredNote(this.reviewContext, id, input, body);
  }
  async list(): Promise<DraftRecord[]> {
    const scan = await scanJsonRecords<DraftRecord>(
      this.directory(),
      (value, file): value is DraftRecord => isExtractionDraft(value, path.basename(file, '.json')),
      this.root,
    );
    return scan.records.map((record) => record.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async findActiveForRaw(rawId: string): Promise<DraftRecord | undefined> {
    return (await this.list()).find(
      (draft) => draft.rawId === rawId && (draft.status === 'pending_confirmation' || draft.status === 'committing'),
    );
  }
  async findByOperation(operationId: string): Promise<DraftRecord | undefined> {
    return (await this.list()).find((draft) => draft.commitOperationId === operationId);
  }
  async reviewChange(id: string, input: unknown): Promise<DraftRecord> {
    const prior = await this.getKnowledge(id);
    if (prior && isQuestionDraft(prior)) throw new DraftError('QUESTION_REVIEW_REQUIRED', '请使用问答草稿审核入口。');
    const record = await this.reviewKnowledgeChange(id, input);
    if (isQuestionDraft(record)) throw new DraftError('QUESTION_REVIEW_REQUIRED', '草稿身份已变化。');
    return record;
  }
  async reviewKnowledgeChange(id: string, input: unknown): Promise<KnowledgeDraftRecord> {
    return reviewKnowledgeChange(this.reviewContext, id, input);
  }
  async savePreparedChange(
    id: string,
    baseRevision: number,
    change: KnowledgeChange,
    absorbedId: string | undefined,
    target: WikiRecord | undefined,
    callCount: number,
  ): Promise<DraftRecord> {
    return savePreparedChange(this.reviewContext, id, baseRevision, change, absorbedId, target, callCount);
  }
  async finishMaintenance(id: string, baseRevision: number): Promise<DraftRecord> {
    return finishMaintenance(this.reviewContext, id, baseRevision);
  }
  async setDeferred(id: string, baseRevision: number, deferred: boolean): Promise<DraftRecord> {
    return setDeferred(this.reviewContext, id, baseRevision, deferred);
  }
  async create(
    input: {
      raw: {
        id: string;
        title: string;
        bodySha256: string;
        sourceType?: string;
        sourceName?: string;
        author?: string;
        publishedAt?: string;
        url?: string;
        importedAt?: string;
      };
      outcome: ExtractOutcome;
      jobId: string;
      body: string;
      rules: DraftRules;
      maintenance?: KnowledgeMaintenance;
      modelProvenance?: DraftModelProvenance;
    },
    deep?: { note: StructuredNote; qualityReport: DeepQualityReport },
  ): Promise<DraftRecord> {
    return this.queue.run(async () => {
      if (
        [input, input.outcome].some((v) =>
          ['structuredNote', 'qualityReport', 'extractionMode', 'noteReview', 'noteApproval'].some((k) =>
            Object.hasOwn(v, k),
          ),
        )
      )
        throw new DraftError('STRUCTURED_NOTE_INPUT_UNAVAILABLE', '结构化笔记尚未开放创建入口。');
      const now = new Date().toISOString();
      const level = input.outcome.document.source_level ?? 'D';
      const pages: DraftPage[] = input.outcome.pages.map((page) => ({
        ...this.fromExtracted(page, input.rules),
        source_level: level,
      }));
      const sourceTitle = input.outcome.document.title.trim().slice(0, 300) || input.raw.title;
      const rawMeta: DraftRawMeta = {
        rawId: input.raw.id,
        title: input.raw.title,
        sourceType: input.raw.sourceType ?? 'other',
        sourceName: input.raw.sourceName ?? input.raw.title,
        author: input.raw.author,
        publishedAt: input.raw.publishedAt,
        url: input.raw.url,
        importedAt: input.raw.importedAt,
      };
      const source: DraftSource = {
        title: sourceTitle,
        category: 'other',
        summary: input.outcome.document.summary,
        key_takeaways: derivedTakeaways(pages.filter((page) => page.selected)),
        body: '',
        knowledge_status: 'source_supported',
        confidence: 'medium',
        source_level: level,
      };
      const record: DraftRecord = {
        id: randomUUID(),
        rawId: input.raw.id,
        rawSha256: input.raw.bodySha256,
        rawTitle: input.raw.title,
        rawMeta,
        status: 'pending_confirmation',
        revision: 1,
        createdAt: now,
        updatedAt: now,
        rulesVersion: input.outcome.rulesVersion,
        provider: input.outcome.provider,
        ...(input.modelProvenance ? { modelProvenance: input.modelProvenance } : {}),
        jobId: input.jobId,
        document: input.outcome.document,
        pages,
        source,
        warnings: [...input.outcome.warnings],
        extraction: {
          callCount: input.outcome.callCount,
          chunkCount: input.outcome.chunkCount,
          pagesFound: input.outcome.pages.length,
        },
      };
      if (input.outcome.reviewBasis) {
        record.humanReview = this.reviewFromBasis(record, input.outcome.reviewBasis);
        await this.assertCapturedReview(record.humanReview, input.raw.id, input.body, input.raw.bodySha256);
        this.deriveReviewPages(record);
      }
      if (deep) {
        const ids = new Set(
          record.humanReview?.units.filter((u) => u.kind === 'fact').flatMap((u) => u.records.map((r) => r.id)),
        );
        if (
          !record.humanReview ||
          !validStructuredNote(deep.note, ids) ||
          !validDeepQuality(deep.qualityReport, deep.note)
        )
          throw new DraftError('STRUCTURED_NOTE_INVALID', '内部深度草稿契约无效。');
        record.structuredNote = structuredClone(deep.note);
        record.qualityReport = structuredClone(deep.qualityReport);
        record.extractionMode = 'deep';
      }
      for (const page of record.pages)
        this.validateTemplateReferences(page, record.rawId, undefined, record.humanReview);
      if (!pages.length) record.warnings.push('Provider 未给出任何知识建议，请放弃该草稿并检查来源。');
      // F04-03: nothing is selected by default — the user must explicitly choose what to write.
      record.warnings.push('默认未选择任何知识建议；只有勾选的条目会在确认后写入正式 Wiki。');
      // Default preview only: it is re-rendered from the actual selection on every save/confirm
      // while the user has not edited the body themselves (F04-05).
      record.source.body = renderSourceBody(
        record.source,
        record.rawMeta,
        record.pages.filter((page) => page.selected),
        record.pages.filter((page) => !page.selected),
      );
      if (input.maintenance) {
        if (!validMaintenance(input.maintenance)) throw new DraftError('MAINTENANCE_INVALID', '内部维护草稿无效。');
        record.maintenance = structuredClone(input.maintenance);
      }
      await writeJsonAtomic(this.fileFor(record.id), record);
      return record;
    });
  }
  private fromExtracted(page: ExtractedPage, rules: DraftRules): DraftPage {
    return fromExtractedPage(page, rules);
  }
  async patch(id: string, patch: DraftPatch, context: { body: string; rules: DraftRules }): Promise<DraftRecord> {
    return this.queue.run(async () => {
      if (
        [patch, patch.document, patch.source, ...(patch.pages ?? [])].some(
          (v) =>
            v &&
            ['structuredNote', 'qualityReport', 'extractionMode', 'noteReview', 'noteApproval'].some((k) =>
              Object.hasOwn(v, k),
            ),
        )
      )
        throw new DraftError('STRUCTURED_NOTE_INPUT_UNAVAILABLE', '结构化笔记尚未开放编辑入口。');
      if (
        Object.keys(patch).some(
          (k) => !['baseRevision', 'document', 'source', 'pages', 'deletePageIds', 'merge'].includes(k),
        )
      )
        throw new DraftError('INVALID_PATCH', '不能通过普通编辑修改审查目录或确认记录。');
      const current = await this.get(id);
      const next = applyDraftPatchRecord(
        {
          applyPagePatch: this.applyPagePatch.bind(this),
          applyMerge: this.applyMerge.bind(this),
          deriveReviewPages: this.deriveReviewPages.bind(this),
          validatePage: this.validatePage.bind(this),
          validateTemplateReferences: this.validateTemplateReferences.bind(this),
          assertRoundtripSize: this.assertRoundtripSize.bind(this),
        },
        current,
        patch,
        context,
      );
      if (next === current) return current;
      await writeJsonAtomic(this.fileFor(next.id), next);
      return next;
    });
  }
  async setDecision(
    id: string,
    pageId: string,
    input: { baseRevision: number; decision: 'update' | 'create' | 'defer'; targetWikiId?: string },
  ): Promise<DraftRecord> {
    return setDecision(this.reviewContext, id, pageId, input);
  }
  private applyPagePatch(
    page: DraftPage,
    item: DraftPagePatch,
    context: { body: string; rules: DraftRules },
    rawId: string,
  ): void {
    return applyDraftPagePatch(this.normalizedFields.bind(this), page, item, context, rawId);
  }
  private applyMerge(next: DraftRecord, merge: { pageIds: string[]; title?: string }): void {
    return applyDraftMerge(next, merge);
  }
  private validateTemplateReferences(page: DraftPage, rawId: string, previous?: DraftPage, review?: HumanReview): void {
    return validateTemplateReferences(page, rawId, previous, review);
  }
  private validatePage(page: DraftPage, rules: DraftRules): void {
    return validateDraftPage(page, rules);
  }
  view(
    record: DraftRecord,
    options?: { sourceTitle?: string },
  ): DraftRecord & {
    pages: Array<DraftPage & { renderedBody: string }>;
    sourceRenderedBody: string;
    outcomeDigest: string;
    changeDigests?: Record<string, string>;
  };
  view(
    record: KnowledgeDraftRecord,
    options?: { sourceTitle?: string },
  ): KnowledgeDraftRecord & {
    pages: Array<DraftPage & { renderedBody: string }>;
    sourceRenderedBody: string;
    outcomeDigest?: string;
  };
  view(
    record: KnowledgeDraftRecord,
    options: { sourceTitle?: string } = {},
  ): KnowledgeDraftRecord & {
    pages: Array<DraftPage & { renderedBody: string }>;
    sourceRenderedBody: string;
    outcomeDigest?: string;
    changeDigests?: Record<string, string>;
  } {
    return buildDraftView(this.digestContext, record, options);
  }
  async discard(id: string, baseRevision: number | undefined): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      if (current.status === 'discarded') return current;
      if (current.status === 'confirmed')
        throw new DraftError('DRAFT_CONFIRMED', '这份草稿已经写入正式知识，不能放弃。', 409);
      if (current.status === 'committing')
        throw new DraftError('DRAFT_COMMITTING', '这份草稿正在提交，暂不能放弃；请先查看提交状态。', 409);
      if (baseRevision !== undefined && baseRevision !== current.revision) {
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已被修改，请刷新后重新确认放弃。', 409, {
          currentRevision: current.revision,
        });
      }
      const next: DraftRecord = {
        ...current,
        status: 'discarded',
        discardedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async markCommitting(id: string, operationId: string): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      const next: DraftRecord = {
        ...current,
        status: 'committing',
        commitOperationId: operationId,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async markMaintenanceCommitted(id: string, operationId: string, changeIds: string[]): Promise<KnowledgeDraftRecord> {
    return this.queue.run(async () => {
      const current = await this.getKnowledge(id);
      if (!current?.maintenance) throw new DraftError('MAINTENANCE_MISSING', '知识变更草稿不存在。', 409);
      const next = structuredClone(current);
      for (const c of next.maintenance!.changes)
        if (changeIds.includes(c.changeId)) c.committedOperationId = operationId;
      next.status = next.maintenance!.changes.some((c) => !c.committedOperationId)
        ? 'pending_confirmation'
        : 'confirmed';
      next.commitOperationId = operationId;
      next.updatedAt = new Date().toISOString();
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async markConfirmed(id: string, operationId: string): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      const next: DraftRecord = {
        ...current,
        status: 'confirmed',
        commitOperationId: operationId,
        confirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async resetToPending(id: string, reason: string): Promise<DraftRecord | undefined> {
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) return undefined;
      const next: DraftRecord = {
        ...current,
        status: 'pending_confirmation',
        updatedAt: new Date().toISOString(),
        warnings: [...current.warnings, reason],
      };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  private get digestContext(): DraftDigestContext {
    return {
      root: this.root,
      imageText: this.imageText.bind(this),
      assertCapturedReview: this.assertCapturedReview.bind(this),
      assertEvidenceStillValid: this.assertEvidenceStillValid.bind(this),
      assertNoteReviewed: this.assertNoteReviewed.bind(this),
      contentDigest: this.contentDigest.bind(this),
      outcomeDigest: this.outcomeDigest.bind(this),
      validateTemplateReferences: this.validateTemplateReferences.bind(this),
    };
  }
  private get reviewContext(): DraftReviewContext {
    return {
      ...this.digestContext,
      queue: this.queue,
      get: this.get.bind(this),
      getKnowledge: this.getKnowledge.bind(this),
      migratedReview: this.migratedReview.bind(this),
      deriveReviewPages: this.deriveReviewPages.bind(this),
      assertRoundtripSize: this.assertRoundtripSize.bind(this),
    };
  }
}
