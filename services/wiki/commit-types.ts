import { createHash } from 'node:crypto';
import path from 'node:path';
import { scanJsonRecords } from '../storage/files.ts';
import { isCommitManifest } from '../storage/record-validators.ts';
import type { DraftRecord, DraftStore, KnowledgeDraftRecord } from './drafts.ts';
import type { HumanReview } from './human-review.ts';
import type { InspectionDraftInput } from './inspection-input.ts';
import type { QuestionDraftInput } from './question-input.ts';
import type { NoteApproval, NoteReviewMetadata, StructuredNote } from './structured-note.ts';
import type { WikiRecord, WikiStore } from './store.ts';
import type { RawStateStore } from '../raw/state.ts';
import type { RawRecord } from '../raw/store.ts';

export type CommitPhaseName = 'source' | 'pages' | 'index' | 'log' | 'state';
export type CommitPhase = { name: CommitPhaseName; status: 'pending' | 'done' | 'failed'; at?: string; error?: string };
export type CommitStatus = 'prepared' | 'committing' | 'completed' | 'failed';

export type CommitSnapshot = {
  outcomeReview?: { version: 1; digest: string; confirmedAt: string };
  maintenance?: {
    version: 1;
    targets: WikiRecord[];
    before: Record<string, WikiRecord>;
    actions: Record<string, 'create' | 'update' | 'link'>;
    changeIds: string[];
    resultWikiIds: string[];
    reviewDigest: string;
    noChanges?: true;
  };
  deepNote?: {
    note: StructuredNote;
    metadata?: NoteReviewMetadata;
    approval: NoteApproval;
    humanReview: HumanReview;
    reviewDigest: string;
  };
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
  questionInput?: never;
  inspectionInput?: never;
  humanReviewDigest?: string;
  humanReviewBasisDigest?: string;
  legacyRecovery?: 'verified_partial';
  awaitingHumanReview?: boolean;
  supersededBy?: string;
  operationId: string;
  draftId: string;
  idempotencyKey: string;
  rawId: string;
  rawSha256: string;
  rawTitle: string;
  /** F04-04: digest of the frozen payload; a retry compares payloads, not idempotency keys. */
  payloadDigest?: string;
  status: CommitStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  provider: { name: string; model: string };
  snapshot: CommitSnapshot;
  phases: CommitPhase[];
  writtenWikiIds: string[];
  error?: { code: string; message: string; at: string; phase?: string; cause?: { code: string; message: string } };
  recoveryHint?: string;
  responseLost?: boolean;
};

export type QuestionCommitManifest = Omit<
  CommitManifest,
  'rawId' | 'rawSha256' | 'rawTitle' | 'questionInput' | 'inspectionInput'
> & { rawId?: never; rawSha256?: never; rawTitle?: never } & (
    | { questionInput: QuestionDraftInput; inspectionInput?: never }
    | { inspectionInput: InspectionDraftInput; questionInput?: never }
  );

export type KnowledgeCommitManifest = CommitManifest | QuestionCommitManifest;

export type WikiCommitDeps = {
  root: string;
  wikiStore: WikiStore;
  drafts: DraftStore;
  rawStates: RawStateStore;
  rawStore: {
    get(
      id: string,
    ): Promise<
      Pick<RawRecord, 'id' | 'title' | 'body' | 'bodySha256' | 'tags' | 'bodyRevision' | 'newsMaterial'> | undefined
    >;
  };
};

export const commitSha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const normalizeCommitTitle = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim().replace(/\s+/gu, ' ');

export function commitDirectory(root: string): string {
  return path.join(root, 'state', 'wiki-commits');
}

export function commitManifestFile(root: string, operationId: string): string {
  return path.join(commitDirectory(root), `${operationId}.json`);
}

export function reviewProjection<T extends KnowledgeDraftRecord>(draft: T, pageIds: string[]): T {
  const next = structuredClone(draft);
  for (const c of next.maintenance!.changes) {
    if (pageIds.includes(next.pages[c.pageIndex].pageId)) {
      delete c.committedOperationId;
      c.decision = 'accept';
    } else c.decision = 'defer';
  }
  return next;
}

export class CommitError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function scanWikiCommits(root: string) {
  return scanJsonRecords<KnowledgeCommitManifest>(
    commitDirectory(root),
    (value, file): value is KnowledgeCommitManifest => isCommitManifest(value, path.basename(file, '.json')),
    root,
  );
}

/** Include a frozen operation whose draft status could not be saved. */
export function pendingRawCommit(draft: DraftRecord, manifests: KnowledgeCommitManifest[]) {
  const own = manifests.filter((manifest) => manifest.draftId === draft.id);
  if (
    own.some((manifest) => manifest.rawId !== draft.rawId || manifest.rawSha256 !== draft.rawSha256) ||
    (draft.commitOperationId && !own.some((manifest) => manifest.operationId === draft.commitOperationId))
  ) {
    throw new CommitError('COMMIT_DRAFT_MISMATCH', '无法核对草稿关联的原提交，请检查本机记录。', 409);
  }
  const pending = own
    .filter((manifest) => manifest.status !== 'completed' && !manifest.supersededBy)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!pending && draft.status === 'committing') {
    throw new CommitError('COMMIT_DRAFT_MISMATCH', '原提交记录不可用，请检查本机记录。', 409);
  }
  return pending;
}
