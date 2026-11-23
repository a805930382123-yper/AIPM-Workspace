import {
  changePageIndexes,
  validMaintenance,
  maintenanceDigest,
  assertMaintenanceReviewed,
  type KnowledgeChange,
  type KnowledgeMaintenance,
} from './maintenance.ts';
import { assertPdfEvidence, type PdfDraftInput, type PdfEvidence } from './pdf-input.ts';
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
import {
  buildRawContentForAI,
  mediaForEvidence,
  mediaQuoteMatches,
  type MediaEvidenceSource,
} from '../raw/media-context.ts';
// B04: recoverable, versioned extraction drafts. A draft is the only place AI output lives
// until the user explicitly confirms; it is stored under drafts/<UUID>.json and never inside
// the formal Wiki directory.
import { createHash, randomUUID } from 'node:crypto';
import {
  validStructuredNote,
  validNoteReview,
  validNoteApproval,
  noteCoverage,
  noteReviewContent,
  noteFactIds,
  type NoteApproval,
  type NoteReviewMetadata,
  type NoteExclusion,
  type StructuredNote,
} from './structured-note.ts';
import { validDeepQuality, type DeepQualityReport } from '../llm/knowledge-deep.ts';
import path from 'node:path';
import type { LlmError } from '../llm/provider.ts';
import { locateEvidenceInBody } from '../llm/evidence.ts';
import type { ExtractOutcome, ExtractedPage } from '../llm/service.ts';
import { mkdir } from 'node:fs/promises';
import { SerialQueue, scanJsonRecords, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { isExtractionDraft } from '../storage/record-validators.ts';
import { renderPageBody, renderSourceBody } from './render.ts';
import {
  assertHumanReviewed,
  assertReviewSources,
  assertReviewStructure,
  candidateContent,
  confirmHumanPage,
  moveHumanUnits,
  newHumanReview,
  reviewContentDigest,
  type HumanReview,
  type ReviewBasis,
  type ReviewUnit,
} from './human-review.ts';
import { ExtractionCheckpointStore } from '../llm/checkpoints.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../llm/rules.ts';
import {
  captureTemplateFields,
  hasTemplateFields,
  validTemplateFields,
  validMergedTemplateFields,
  mergedFieldsMatchReview,
  type TemplateFields,
  type MergedTemplateFields,
} from './template-fields.ts';

export const DRAFT_STATUSES = ['pending_confirmation', 'committing', 'confirmed', 'discarded'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type DraftEvidence = {
  id: string;
  rawId: string;
  quote: string;
  start: number;
  end: number;
  chunkIndex: number;
  media?: MediaEvidenceSource;
};
export type DraftFact = { text: string; evidenceIds: string[] };
export type DraftPage = {
  pdfEvidence?: PdfEvidence[];
  templateFields?: TemplateFields;
  mergedTemplateFields?: MergedTemplateFields[];
  pageId: string;
  title: string;
  type: string;
  category: string;
  one_line_definition: string;
  source_facts: DraftFact[];
  ai_organized: string[];
  ai_inferences: string[];
  related_pages: string[];
  open_questions: string[];
  source_evidence: DraftEvidence[];
  knowledge_status: string;
  confidence: string;
  source_level: string;
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
  rawId: string;
  title: string;
  sourceType: string;
  sourceName: string;
  author?: string;
  publishedAt?: string;
  url?: string;
  importedAt?: string;
};
export type DraftSource = {
  title: string;
  category: string;
  summary: string;
  key_takeaways: string[];
  body: string;
  knowledge_status: string;
  confidence: string;
  source_level: string;
  reuseWikiId?: string;
  editedByUser?: boolean;
  bodyEditedByUser?: boolean;
};
export type DraftRecord = {
  pdfInput?: PdfDraftInput;
  maintenance?: KnowledgeMaintenance;
  structuredNote?: StructuredNote;
  extractionMode?: 'deep';
  qualityReport?: DeepQualityReport;
  noteReview?: NoteReviewMetadata;
  noteApproval?: NoteApproval;
  humanReview?: HumanReview;
  /** Explicit user references; original source units and classifications stay immutable. */
  humanQuestionUnitIds?: string[];
  id: string;
  rawId: string;
  rawSha256: string;
  rawTitle: string;
  rawMeta: DraftRawMeta;
  status: DraftStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  rulesVersion: string;
  provider: { name: string; model: string };
  jobId: string;
  document: { title: string; main_topic: string; summary: string; source_level?: 'A' | 'B' | 'C' | 'D' };
  pages: DraftPage[];
  source: DraftSource;
  warnings: string[];
  commitOperationId?: string;
  confirmedAt?: string;
  discardedAt?: string;
  deferredAt?: string;
  extraction: { callCount: number; chunkCount: number; pagesFound: number };
};
export type QuestionDraftRecord = Omit<
  DraftRecord,
  'rawId' | 'rawSha256' | 'rawTitle' | 'rawMeta' | 'jobId' | 'maintenance' | 'source' | 'deferredAt'
> & { input: EvidenceDraftInput; maintenance: KnowledgeMaintenance };
export type KnowledgeDraftRecord = DraftRecord | QuestionDraftRecord;
export function isQuestionDraft(record: KnowledgeDraftRecord): record is QuestionDraftRecord {
  return 'input' in record && ['question_answer', 'inspection'].includes(record.input?.kind);
}

export class DraftError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type DraftPagePatch = {
  templateFields?: TemplateFields;
  mergedTemplateFields?: MergedTemplateFields[];
  pageId: string;
  selected?: boolean;
  reviewDecision?: 'update' | 'create' | 'defer';
  updateTargetWikiId?: string;
  title?: string;
  type?: string;
  category?: string;
  one_line_definition?: string;
  source_facts?: DraftFact[];
  ai_organized?: string[];
  ai_inferences?: string[];
  related_pages?: string[];
  open_questions?: string[];
  source_evidence?: Array<{ id: string; rawId?: string; quote: string; start?: number; end?: number }>;
  knowledge_status?: string;
  confidence?: string;
  source_level?: string;
};
export type DraftPatch = {
  baseRevision: number;
  document?: Partial<DraftRecord['document']>;
  source?: Partial<DraftSource>;
  pages?: DraftPagePatch[];
  deletePageIds?: string[];
  merge?: { pageIds: string[]; title?: string };
};

type DraftRules = {
  types: string[];
  categories: string[];
  knowledge_status: string[];
  confidence: string[];
  source_level: string[];
  review_status: string[];
};

function defaultKnowledgeStatus(page: {
  source_facts: DraftFact[];
  ai_inferences: string[];
  ai_organized: string[];
}): string {
  if (page.ai_inferences.length)
    return page.source_facts.length || page.ai_organized.length ? 'ai_organized' : 'inferred';
  return page.source_facts.length ? 'source_supported' : 'needs_verification';
}

/**
 * F04-05: Key Takeaways are derived from the pages that will actually be created. Callers pass the
 * effective selection, so the derived Source sections can never disagree with the confirmed set
 * (the draft's own `selected` flags are only a review convenience).
 */
export function derivedTakeaways(pages: Array<Pick<DraftPage, 'one_line_definition'>>): string[] {
  return pages
    .slice(0, 8)
    .map((page) => page.one_line_definition)
    .filter(Boolean);
}

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
    return path.join(this.root, 'drafts');
  }
  private fileFor(id: string) {
    return path.join(this.directory(), `${id}.json`);
  }

  private async imageText(rawId: string) {
    return (await new RawStore(this.root).getMediaArtifacts(rawId)).flatMap((artifact) => {
      const text = mediaForEvidence(artifact);
      return text ? [text] : [];
    });
  }

  private async assertCapturedReview(review: HumanReview, id: string, body: string, bodySha256: string) {
    const media = review.units.some((unit) => unit.media || unit.evidence.some((evidence) => evidence.media))
      ? await this.imageText(id)
      : undefined;
    assertReviewSources(review, [{ id, body, bodySha256, media }]);
  }

  async initialize() {
    await mkdir(this.directory(), { recursive: true });
  }

  contentDigest(record: KnowledgeDraftRecord): string {
    if (isQuestionDraft(record)) return maintenanceDigest(record);
    if (record.maintenance) return maintenanceDigest(record);
    if (!record.humanReview) throw new DraftError('HUMAN_REVIEW_REQUIRED', '请先开始逐页人工审查。', 409);
    return reviewContentDigest(
      { draftId: record.id, rawId: record.rawId, rawSha256: record.rawSha256 },
      candidateContent(record),
      record.humanReview,
    );
  }
  outcomeDigest(record: DraftRecord): string {
    const maintenance = record.maintenance && {
      ...record.maintenance,
      changes: record.maintenance.changes.map(
        ({ approval: _approval, committedOperationId: _operation, ...change }) => change,
      ),
    };
    const review = record.humanReview && {
      basisDigest: record.humanReview.basisDigest,
      assignments: record.humanReview.assignments,
    };
    return createHash('sha256')
      .update(JSON.stringify({ content: candidateContent({ ...record, maintenance }), review }))
      .digest('hex');
  }
  async assertRawOutcome(record: DraftRecord, body: string, selectedPageIds: string[], digest: string): Promise<void> {
    if (this.outcomeDigest(record) !== digest)
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
    if (record.pdfInput) await assertPdfEvidence(this.root, record, selectedPages);
    await this.assertEvidenceStillValid(record, body, selectedPages);
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
      await this.assertCapturedReview({ ...record.humanReview, units }, record.rawId, body, record.rawSha256);
    }
  }
  async assertReviewed(
    record: KnowledgeDraftRecord,
    body: string,
    appliedTargets: import('./store.ts').WikiRecord[] = [],
  ): Promise<string> {
    if (isQuestionDraft(record)) {
      const raws = new RawStore(this.root),
        wiki = new WikiStore(this.root, raws);
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
      await this.assertCapturedReview(record.humanReview, record.rawId, body, record.rawSha256);
      await this.assertEvidenceStillValid(record, body);
      const digest = assertMaintenanceReviewed(record);
      if (record.structuredNote) this.assertNoteReviewed(record, digest);
      return digest;
    }
    assertReviewStructure(
      record.humanReview,
      record.pages.map((p) => p.pageId),
    );
    await this.assertCapturedReview(record.humanReview, record.rawId, body, record.rawSha256);
    await this.assertEvidenceStillValid(record, body);
    const digest = this.contentDigest(record);
    if (record.structuredNote) this.assertNoteReviewed(record, digest);
    assertHumanReviewed(
      record.humanReview,
      record.pages.map((p) => p.pageId),
      digest,
    );
    return digest;
  }
  private assertNoteReviewed(record: DraftRecord, digest: string): void {
    if (!validNoteApproval(record.noteApproval) || record.noteApproval.digest !== digest)
      throw new DraftError(
        'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE',
        '请先明确核对深度笔记、引用、覆盖与待确认问题。',
        409,
      );
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
  async reviewStructuredNote(id: string, input: unknown, body: string): Promise<DraftRecord> {
    return this.queue.run(async () => {
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
      const record = await this.get(id);
      if (!record?.structuredNote) throw new DraftError('NOTE_NOT_FOUND', '没有结构化笔记。', 404);
      if (record.status !== 'pending_confirmation' || record.revision !== value.baseRevision)
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化，请刷新后重新核对。', 409);
      assertReviewStructure(
        record.humanReview,
        record.pages.map((p) => p.pageId),
      );
      await this.assertCapturedReview(record.humanReview, record.rawId, body, record.rawSha256);
      await this.assertEvidenceStillValid(record, body);
      const digest = this.contentDigest(record);
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
      this.assertNoteReviewed({ ...record, noteApproval: approval }, digest);
      const next = {
        ...record,
        noteApproval: approval,
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
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
    if (basis.pageUnitIds.length !== record.pages.length)
      throw new DraftError('REVIEW_BASIS_INVALID', '审查页与来源目录不一致。', 409);
    const refs = basis.pageUnitIds.flat();
    if (
      refs.length !== basis.units.length ||
      new Set(refs).size !== refs.length ||
      basis.units.some((u) => !refs.includes(u.id))
    )
      throw new DraftError('REVIEW_BASIS_INVALID', '审查 unit 必须完整且唯一归属。', 409);
    return newHumanReview(
      basis.units,
      Object.fromEntries(basis.pageUnitIds.flatMap((ids, i) => ids.map((id) => [id, record.pages[i].pageId]))),
    );
  }
  private legacyReview(record: DraftRecord): HumanReview {
    const units: ReviewUnit[] = [],
      owners: Record<string, string> = {};
    for (const page of record.pages)
      for (const kind of ['fact', 'question'] as const) {
        const entries =
          kind === 'fact'
            ? page.source_facts.map((f) => ({ text: f.text, evidenceIds: f.evidenceIds }))
            : page.open_questions.map((text) => ({ text, evidenceIds: [] as string[] }));
        entries.forEach((entry, i) => {
          const id = `legacy-${page.pageId}-${kind}-${i + 1}`;
          units.push({
            id,
            kind,
            origin: 'legacy',
            text: entry.text,
            memberIds: [],
            records: [{ id, text: entry.text, evidenceIds: [...entry.evidenceIds] }],
            evidence: page.source_evidence.filter((e) => entry.evidenceIds.includes(e.id)).map((e) => ({ ...e })),
            sourceLabel: kind === 'question' ? '旧记录无原文定位' : '旧草稿原有事实，非原模型 fact ID',
          });
          owners[id] = page.pageId;
        });
      }
    return newHumanReview(units, owners);
  }
  private async migratedReview(record: DraftRecord, body: string, rulesDir: string): Promise<HumanReview> {
    const cp = await new ExtractionCheckpointStore(this.root).get(record.jobId);
    if (
      cp &&
      cp.rawId === record.rawId &&
      cp.rawSha256 === record.rawSha256 &&
      cp.jobId === record.jobId &&
      cp.draftId === record.id &&
      cp.plan &&
      cp.stage === 'done' &&
      cp.attempts === record.extraction.callCount
    ) {
      const bundle = await loadExtractionRules(rulesDir);
      const provider = {
        ...record.provider,
        complete: async () => {
          throw new DraftError('MIGRATION_OUTBOUND_FORBIDDEN', '旧草稿迁移不得调用模型。', 500);
        },
      };
      const rawStore = new RawStore(this.root);
      const raw = cp.mediaInputSha256 ? await rawStore.get(record.rawId) : undefined;
      const content = raw ? buildRawContentForAI(raw, await rawStore.getMediaArtifacts(raw.id)) : undefined;
      const args = {
        raw: { ...record.rawMeta, id: record.rawId, tags: [] },
        body: content?.body ?? body,
        content,
        bodySha256: record.rawSha256,
        provider,
        rulesDir,
        checkpoint: { ...cp, rulesVersion: bundle.rulesVersion },
      };
      await validateKnowledgeCheckpoint(args, {
        rulesVersion: record.rulesVersion,
        callCount: record.extraction.callCount,
      });
      const result = await runKnowledgePipeline({
        ...args,
        beforeCall: async () => {
          throw new DraftError('MIGRATION_OUTBOUND_FORBIDDEN', '旧草稿迁移不得调用模型。', 500);
        },
        saveCheckpoint: async (value) => ({ ...value, integrity: cp.integrity }),
      });
      const projection = (
        p: Pick<DraftPage, 'title' | 'type' | 'category' | 'source_facts' | 'open_questions' | 'source_evidence'>,
      ) => ({
        title: p.title,
        type: p.type,
        category: p.category,
        source_facts: p.source_facts,
        open_questions: p.open_questions,
        source_evidence: p.source_evidence.map(({ id, rawId, quote, start, end, chunkIndex, media }) => ({
          id,
          rawId,
          quote,
          start,
          end,
          chunkIndex,
          ...(media ? { media } : {}),
        })),
      });
      if (
        JSON.stringify(result.outcome.pages.map(projection)) === JSON.stringify(record.pages.map(projection)) &&
        result.outcome.reviewBasis
      )
        return this.reviewFromBasis(record, result.outcome.reviewBasis);
    }
    return this.legacyReview(record);
  }
  private normalizedFields(fields: TemplateFields, previous?: TemplateFields): TemplateFields {
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
  private assertRoundtripSize(record: DraftRecord): void {
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
      throw new DraftError(
        'DRAFT_PATCH_TOO_LARGE',
        '合并后的完整保存内容超过现有3MiB请求上限；原草稿及审批保持。',
        413,
      );
  }
  private deriveReviewPages(record: KnowledgeDraftRecord, rebindFields = false) {
    if (!record.humanReview) return;
    assertReviewStructure(
      record.humanReview,
      record.pages.map((p) => p.pageId),
    );
    for (const page of record.pages) {
      const units = record.humanReview.units.filter((u) => record.humanReview!.assignments[u.id] === page.pageId);
      const facts = units.filter((u) => u.kind === 'fact'),
        questions = units.filter((u) => u.kind === 'question');
      const evidence: DraftEvidence[] = [],
        aliases = new Map<string, Map<string, string>>();
      for (const unit of units) {
        const map = new Map<string, string>();
        for (const item of unit.evidence) {
          let id = item.id;
          const old = evidence.find((e) => e.id === id);
          if (
            old &&
            (old.rawId !== item.rawId || old.start !== item.start || old.end !== item.end || old.quote !== item.quote)
          )
            id = `${id.slice(0, 44)}-review-${createHash('sha256')
              .update(JSON.stringify([item.rawId, item.start, item.end, item.quote]))
              .digest('hex')
              .slice(0, 12)}`;
          map.set(item.id, id);
          if (!evidence.some((e) => e.id === id)) evidence.push({ ...item, id });
        }
        aliases.set(unit.id, map);
      }
      page.source_facts = facts.flatMap((u) =>
        u.records.map((r) => ({
          text: r.text,
          evidenceIds: r.evidenceIds.map((id) => aliases.get(u.id)?.get(id) ?? id),
        })),
      );
      page.open_questions = [
        ...questions.flatMap((u) => u.records.map((r) => r.text)),
        ...facts
          .filter((u) => u.factKind === 'ambiguous')
          .flatMap((u) => u.records.map((r) => '原文口径或边界待确认：' + r.text)),
        ...facts.filter((u) => record.humanQuestionUnitIds?.includes(u.id)).map((u) => '人工标记待确认：' + u.text),
      ];
      const previousEvidence = page.source_evidence;
      page.source_evidence = evidence;
      for (const field of Object.values(page.templateFields ?? {})) {
        if (rebindFields)
          field.evidenceIds = field.evidenceIds.map((id) => {
            const old = previousEvidence.find((e) => e.id === id);
            return old
              ? (evidence.find(
                  (e) => e.rawId === old.rawId && e.start === old.start && e.end === old.end && e.quote === old.quote,
                )?.id ?? id)
              : id;
          });
        const ai = field.aiContent;
        if (!ai) continue;
        const references = ai.factIds.map((id) => {
          const unit = facts.find((u) => u.records.some((r) => r.id === id));
          return unit
            ? unit.records.find((r) => r.id === id)!.evidenceIds.map((ref) => aliases.get(unit.id)?.get(ref) ?? ref)
            : undefined;
        });
        if (references.every((ids): ids is string[] => ids !== undefined))
          ai.evidenceIds = [...new Set(references.flat())];
      }
    }
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
    return this.queue.run(async () => {
      const current = await this.get(id);
      if (!current) throw new DraftError('NOT_FOUND', '没有找到这份草稿。', 404);
      if (current.status !== 'pending_confirmation')
        throw new DraftError('DRAFT_NOT_EDITABLE', '草稿不在待审查状态。', 409);
      if (input.baseRevision !== current.revision)
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已修改，请刷新后审查。', 409, {
          currentRevision: current.revision,
        });
      await this.assertEvidenceStillValid(current, context.body);
      const next = structuredClone(current);
      if (input.action === 'start' && !next.humanReview)
        next.humanReview = await this.migratedReview(next, context.body, context.rulesDir);
      assertReviewStructure(
        next.humanReview,
        next.pages.map((p) => p.pageId),
      );
      await this.assertCapturedReview(next.humanReview, next.rawId, context.body, next.rawSha256);
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
        this.deriveReviewPages(next);
      }
      if (input.action === 'move') {
        moveHumanUnits(
          next.humanReview,
          next.pages.map((p) => p.pageId),
          input.unitIds!,
          input.pageId!,
        );
        this.deriveReviewPages(next);
      }
      for (const page of next.pages)
        this.validateTemplateReferences(
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
          this.contentDigest(next),
        );
      if (next.maintenance && maintenanceDigest(next) !== maintenanceDigest(current))
        for (const c of next.maintenance.changes) delete c.approval;
      if (next.structuredNote && this.contentDigest(next) !== this.contentDigest(current)) delete next.noteApproval;
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      next.revision++;
      next.updatedAt = new Date().toISOString();
      this.assertRoundtripSize(next);
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  /** Defensive load-time check: a draft whose evidence no longer matches its Raw is reported. */
  async assertEvidenceStillValid(draft: DraftRecord, body: string, pages = draft.pages): Promise<void> {
    const imageText = pages.some((page) => page.source_evidence.some((evidence) => evidence.media))
      ? await this.imageText(draft.rawId)
      : [];
    for (const page of pages) {
      this.validateTemplateReferences(page, draft.rawId, undefined, draft.humanReview);
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
    return this.queue.run(async () => {
      const current = await this.getKnowledge(id);
      if (!current || !isQuestionDraft(current))
        throw new DraftError('QUESTION_DRAFT_MISSING', '问答草稿不存在。', 404);
      if (current.status !== 'pending_confirmation' || current.revision !== input.baseRevision)
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化，请刷新。', 409);
      if (input.action !== 'move' && input.action !== 'start')
        throw new DraftError('QUESTION_REVIEW_ACTION', '问答草稿请使用来源归属及逐项审核。');
      const raws = new RawStore(this.root);
      await verifyEvidenceInput(current.input, new WikiStore(this.root, raws), raws);
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
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }
  async editStructuredNote(id: string, input: unknown, body: string): Promise<DraftRecord> {
    return this.queue.run(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new DraftError('INVALID_NOTE_PATCH', '结构化笔记编辑格式无效。');
      const patch = input as Record<string, unknown>;
      if (
        Object.keys(patch).some(
          (k) => !['baseRevision', 'structuredNote', 'exclusions', 'questionIds', 'humanQuestions'].includes(k),
        )
      )
        throw new DraftError('INVALID_NOTE_PATCH', '不能写入审批、模型报告或原始来源字段。');
      const current = await this.get(id);
      if (!current?.structuredNote || !current.humanReview)
        throw new DraftError('NOTE_NOT_FOUND', '草稿没有结构化笔记。', 404);
      if (current.status !== 'pending_confirmation' || current.revision !== patch.baseRevision)
        throw new DraftError('DRAFT_REVISION_CONFLICT', '草稿已变化或不可编辑，请刷新后重试。', 409);
      await this.assertCapturedReview(current.humanReview, current.rawId, body, current.rawSha256);
      await this.assertEvidenceStillValid(current, body);
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
        metadata.exclusions.some((e) =>
          e.kind === 'fact' ? referenced.has(e.id) : metadata.questionIds.includes(e.id),
        )
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
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
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
    return this.queue.run(async () => {
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
      const current = await this.getKnowledge(id);
      if (!current?.maintenance) throw new DraftError('MAINTENANCE_MISSING', '没有知识维护草稿。', 404);
      if (isQuestionDraft(current)) {
        const raws = new RawStore(this.root);
        await verifyEvidenceInput(current.input, new WikiStore(this.root, raws), raws);
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
        if (value.digest !== digest)
          throw new DraftError('REVIEW_CONTENT_CHANGED', '内容变化，请保存后重新核对。', 409);
        if (change.decision !== 'accept') throw new DraftError('CHANGE_NOT_ACCEPTED', '请先接受本项。', 409);
        change.approval = { digest, at: new Date().toISOString() };
      }
      if (value.confirmed === false) delete change.approval;
      next.revision++;
      next.updatedAt = new Date().toISOString();
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  async savePreparedChange(
    id: string,
    baseRevision: number,
    change: KnowledgeChange,
    absorbedId: string | undefined,
    target: import('./store.ts').WikiRecord | undefined,
    callCount: number,
  ): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const next = await this.get(id);
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
      this.assertRoundtripSize(next);
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  async finishMaintenance(id: string, baseRevision: number): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const draft = await this.get(id);
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
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  async setDeferred(id: string, baseRevision: number, deferred: boolean): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const draft = await this.get(id);
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
      await writeJsonAtomic(this.fileFor(id), draft);
      return draft;
    });
  }

  /** Creates the reviewable draft from a validated extraction outcome. */
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

  /** Applies a user review patch: whole-record validation, server-anchored evidence and ids. */
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
        if (
          Object.keys(item).some((k) => ['humanReview', 'reviewBasis', 'reviewContentDigest', 'reviewView'].includes(k))
        )
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
        this.applyPagePatch(page, item, context, next.rawId);
      }
      if (patch.merge) this.applyMerge(next, patch.merge);
      if (next.humanReview) {
        for (const unit of next.humanReview.units)
          if (
            next.humanReview.assignments[unit.id] !== null &&
            !next.pages.some((p) => p.pageId === next.humanReview!.assignments[unit.id])
          )
            next.humanReview.assignments[unit.id] = null;
        this.deriveReviewPages(next, !!patch.merge);
      }
      for (const page of next.pages) this.validatePage(page, context.rules);
      for (const page of next.pages)
        this.validateTemplateReferences(
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
      this.assertRoundtripSize(next);
      await writeJsonAtomic(this.fileFor(next.id), next);
      return next;
    });
  }

  async setDecision(
    id: string,
    pageId: string,
    input: { baseRevision: number; decision: 'update' | 'create' | 'defer'; targetWikiId?: string },
  ): Promise<DraftRecord> {
    return this.queue.run(async () => {
      const current = await this.get(id);
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
      await writeJsonAtomic(this.fileFor(id), next);
      return next;
    });
  }

  private applyPagePatch(
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
      if (
        candidateBasis.has(name) &&
        JSON.stringify((page as Record<string, unknown>)[name]) !== JSON.stringify(value)
      ) {
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
      const normalized = this.normalizedFields(item.templateFields, page.templateFields);
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
          { fields: _oldFields, ...identity } = old,
          { fields, ...incoming } = group;
        if (JSON.stringify(identity) !== JSON.stringify(incoming))
          throw new DraftError('MERGED_FIELDS_IMMUTABLE', '合并字段组身份、顺序与原事实/证据目录只读。', 409);
        return { ...old, fields: this.normalizedFields(fields, old.fields) };
      });
      setField('mergedTemplateFields', groups);
    }
    if (item.category !== undefined) {
      if (!context.rules.categories.includes(item.category))
        throw new DraftError('INVALID_CATEGORY', '分类无效。', 400);
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
      if (!context.rules.confidence.includes(item.confidence))
        throw new DraftError('INVALID_FIELD', '可信度无效。', 400);
      setField('confidence', item.confidence);
    }
    if (item.source_level !== undefined) {
      if (!context.rules.source_level.includes(item.source_level))
        throw new DraftError('INVALID_FIELD', '来源等级无效。', 400);
      setField('source_level', item.source_level);
    }
    if (edited.size) page.editedFields = [...edited];
  }

  private applyMerge(next: DraftRecord, merge: { pageIds: string[]; title?: string }): void {
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
        const { mergedTemplateFields: _groups, ...snapshot } = captureTemplateFields(
          page,
          next.rawId,
          next.humanReview!,
        )!;
        groups.push({ ...snapshot, title: page.title });
      }
      groups.push(...(page.mergedTemplateFields ?? []));
    }
    if (groups.length)
      merged.mergedTemplateFields = structuredClone([
        ...new Map(groups.map((group) => [group.pageId, group])).values(),
      ]);
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

  private validateTemplateReferences(page: DraftPage, rawId: string, previous?: DraftPage, review?: HumanReview): void {
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

  private validatePage(page: DraftPage, rules: DraftRules): void {
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

  /** Preview payload: adds the server-rendered body for each page. */
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
      outcomeDigest: this.outcomeDigest(record),
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

  /** Returns the draft to the editable state after a failure that wrote nothing. */
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
}
