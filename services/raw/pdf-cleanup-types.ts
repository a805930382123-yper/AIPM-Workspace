import { createHash } from 'node:crypto';
import type { CompletedBlockModels } from '../llm/checkpoint-models.ts';
import path from 'node:path';
import type { LlmProvider } from '../llm/provider.ts';
import type { SerialQueue } from '../storage/files.ts';
import type { DraftRecord, DraftStore } from '../wiki/drafts.ts';
import type { PdfDraftInput, PdfUnit } from '../wiki/pdf-input.ts';
import type { PdfPresentationGroup, PdfTopicItem } from '../wiki/render.ts';
import type { WikiStore } from '../wiki/store.ts';
import type { PdfPageService } from './pdf-pages.ts';
import type { RawStateStore } from './state.ts';
import type { RawStore } from './store.ts';
import type { WritingRequest, WritingResult } from './pdf-topic-writing.ts';

export const VERSION = 1;

export const LONG_REVISION = 6;

export const DIRECTORY_REVISION = 7;

export const LONG_REPORT_UNITS = 1000;

export const PROMPT_REVISION = 5;

export const FRAGMENT_REVISION = 4;

export const PRESENTATION_REVISION = 3;

export const CLEAN_UNITS = 48;

export const CLEAN_BYTES = 32 * 1024;

export const INDEX_TOPICS = 16;

export const MAX_TOPICS = 50;

export const DIRECTORY_EXCERPT_CHARS = 80;

export const DIRECTORY_BYTES = 80 * 1024;

export type Range = { startPage: number; endPage: number };

export type Status = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type Decision = Pick<PdfTopicItem, 'id' | 'decision' | 'table' | 'mergedInto'> & {
  reason: string;
  topic?: string;
};

export type Assignment = { topic: string; title: string };

export type Fragment = { id: string; unitId: string; start: number; end: number };

export type ShapeStage = 'pdf_cleanup' | 'pdf_topic_index' | 'pdf_topic_directory' | 'pdf_presentation';

export type ShapeIssue = { stage: ShapeStage | WritingRequest['stage']; path: string; reason: string };

export type Issue = { code: string; message: string; details?: ShapeIssue };

export type Job = {
  version: number;
  binding: PdfDraftInput;
  provider: DraftRecord['provider'];
  identity: string;
  taskFingerprint?: string;
  completedModels?: CompletedBlockModels;
  promptRevision?: number;
  status: Status;
  stage: 'cleaning' | 'indexing' | 'assembling' | 'done';
  attempts: number;
  totalBatches: number;
  batches: Decision[][];
  index: Assignment[];
  reusedCleanupBatches?: number;
  reusedIndexEntries?: number;
  fragments?: Fragment[];
  presentation?: { completedBatches: number; groups: PdfPresentationGroup[]; parallel: PdfPresentationGroup[] };
  writing?: WritingResult[];
  error?: Issue;
  draftId?: string;
};

export function completedBlocks(job: Job) {
  return [
    ...job.batches.map((_, index) => `cleanup-${index}`),
    ...job.index.map((_, index) => `index-${index}`),
    ...(job.writing ?? []).map((_, index) => `writing-${index}`),
    ...Array.from({ length: job.presentation?.completedBatches ?? 0 }, (_, index) => `presentation-${index}`),
  ];
}

export const cleanupFingerprint = (job: Job) =>
  createHash('sha256')
    .update(JSON.stringify([job.version, job.promptRevision ?? 1, job.binding.basisDigest, job.totalBatches]))
    .digest('hex');

export type CleanupInput = Awaited<ReturnType<PdfPageService['cleanupInput']>>;

export type WireUnit = {
  id: string;
  page: number;
  text: string;
  origin: PdfUnit['kind'];
  kind: PdfUnit['section'];
} & Partial<Omit<Fragment, 'id'>>;

export type PresentationUnit = WireUnit & { topic: string };

export type IndexBasis = { topic: string; samples: WireUnit[]; suggestedTopic?: string };

export type DirectoryTopic = {
  id: string;
  label: string;
  startPage: number;
  endPage: number;
  sample: Pick<WireUnit, 'page' | 'origin' | 'kind'> & { excerpt: string };
};

export type ShapeRequest =
  | { stage: 'pdf_cleanup'; units: WireUnit[] }
  | { stage: 'pdf_topic_index'; topics: string[]; existing: string[]; basis: IndexBasis[]; existingBasis: IndexBasis[] }
  | { stage: 'pdf_topic_directory'; topics: DirectoryTopic[] }
  | { stage: 'pdf_presentation'; units: PresentationUnit[] };

export type PresentationMapping = { id: string; representativeId: string | null; reason: string };

export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const titleOk = (value: string) => value === value.trim() && !/[\r\n[\]<>]/u.test(value);

export function topicIssue(value: string) {
  if (/[\r\n]/u.test(value)) return 'multiline_label';
  if (!value.trim()) return 'blank_label';
}

export function finalTitleIssue(value: string) {
  const issue = topicIssue(value);
  if (issue) return issue;
  if (value !== value.trim()) return 'surrounding_whitespace';
  if (/[[\]<>]/u.test(value)) return 'unsafe_title_characters';
}

export const nameKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export const evidenceKey = (unit: WireUnit) =>
  JSON.stringify([
    unit.origin,
    unit.kind,
    unit.text
      .replace(/^\s*•\s+/u, '')
      .replace(/\s+/gu, ' ')
      .trim(),
  ]);

export const wireUnit = (unit: PdfUnit): WireUnit => ({
  id: unit.unitId,
  page: unit.page,
  text: unit.text,
  origin: unit.kind,
  kind: unit.section,
});

export const activeStatus = (status: Status) => status === 'queued' || status === 'running';

export class CleanupError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details?: ShapeIssue,
  ) {
    super(message);
  }
}

export const payloadBytes = (payload: ShapeRequest) => Buffer.byteLength(JSON.stringify(payload));

export type PdfCleanupDeps = {
  root: string;
  pdf: PdfPageService;
  raws: RawStore;
  drafts: DraftStore;
  wiki: WikiStore;
  rawStates: RawStateStore;
  provider: () => Promise<LlmProvider | undefined>;
};

export type PdfCleanupRunnerContext = {
  deps: PdfCleanupDeps;
  queue: SerialQueue;
  save(rawId: string, job: Job): Promise<void>;
  assertBasis(input: CleanupInput, job: Job): void;
};
export type PdfCleanupContext<Result> = PdfCleanupRunnerContext & {
  active: Map<string, AbortController>;
  file(rawId: string, range?: Range): string;
  selected(rawId: string): Promise<Range | undefined>;
  job(rawId: string, range: Range): Promise<Job | undefined>;
  get(rawId: string): Promise<Result>;
};

export function pdfCleanupFile(root: string, rawId: string, range?: Range) {
  return path.join(
    root,
    'state',
    'raw-pdf',
    rawId,
    range ? 'cleanup-' + range.startPage + '-' + range.endPage + '.json' : 'cleanup-selection.json',
  );
}

export function assertCleanupBasis(input: CleanupInput, job: Job) {
  if (job.version !== VERSION || input.binding.basisDigest !== job.binding.basisDigest) {
    throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '原件、页理解或整理版本已变化，已保留旧结果，不能混用。');
  }
}
