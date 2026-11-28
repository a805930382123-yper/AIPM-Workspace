import { type KnowledgeMaintenance } from './maintenance.ts';
import { type PdfDraftInput, type PdfEvidence } from './pdf-input.ts';
import { type EvidenceDraftInput } from './inspection-input.ts';
import { type MediaEvidenceSource } from '../raw/media-context.ts';
import { type NoteApproval, type NoteReviewMetadata, type StructuredNote } from './structured-note.ts';
import { type DeepQualityReport } from '../llm/knowledge-deep.ts';
import path from 'node:path';
import type { DraftModelProvenance } from '../llm/checkpoint-models.ts';
import { type HumanReview } from './human-review.ts';
import { type TemplateFields, type MergedTemplateFields } from './template-fields.ts';

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
  modelProvenance?: DraftModelProvenance;
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
  'rawId' | 'rawSha256' | 'rawTitle' | 'rawMeta' | 'jobId' | 'maintenance' | 'source' | 'deferredAt' | 'modelProvenance'
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

export type DraftRules = {
  types: string[];
  categories: string[];
  knowledge_status: string[];
  confidence: string[];
  source_level: string[];
  review_status: string[];
};

export function defaultKnowledgeStatus(page: {
  source_facts: DraftFact[];
  ai_inferences: string[];
  ai_organized: string[];
}): string {
  if (page.ai_inferences.length)
    return page.source_facts.length || page.ai_organized.length ? 'ai_organized' : 'inferred';
  return page.source_facts.length ? 'source_supported' : 'needs_verification';
}

export function derivedTakeaways(pages: Array<Pick<DraftPage, 'one_line_definition'>>): string[] {
  return pages
    .slice(0, 8)
    .map((page) => page.one_line_definition)
    .filter(Boolean);
}

export function draftDirectory(root: string): string {
  return path.join(root, 'drafts');
}
export function draftFilePath(root: string, id: string): string {
  return path.join(draftDirectory(root), `${id}.json`);
}
export function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}
