import { createHash } from 'node:crypto';
import { type InputTemplateFields } from './template-fields.ts';
import { type SerialQueue } from '../storage/files.ts';
import { type RawStore } from '../raw/store.ts';
import { type LlmProvider } from '../llm/provider.ts';
import { type WikiInput, type WikiRecord, type WikiStore, type SourceLevel } from './store.ts';
import { type HumanReview } from './human-review.ts';

export type WorkflowUpdateInput = {
  draftId: string;
  pageId: string;
  baseRevision: number;
  targetWikiId: string;
  draft: any;
  raw: any;
  target: WikiRecord;
  provider: LlmProvider;
};

export type KnowledgeWorkflow = {
  reviewProtocolVersion?: 1;
  legacyStandaloneInput?: {
    version: 1;
    source: 'stored_workflow';
    rawSnapshots: KnowledgeWorkflow['rawSnapshots'];
    targetWikiId: string;
    targetBaseRevision: number;
    snapshotDigest: string;
  };
  humanReview?: HumanReview;
  humanEditedSections?: string[];
  id: string;
  kind: 'update' | 'synthesis';
  status: 'pending_confirmation' | 'confirmed' | 'discarded' | 'conflict';
  revision: number;
  createdAt: string;
  updatedAt: string;
  provider: { name: string; model: string };
  rawSnapshots: Array<{ id: string; title: string; bodySha256: string }>;
  targetWikiId?: string;
  baseRevision?: number;
  baseWiki?: WikiRecord;
  inputDraft?: { draftId: string; pageId: string; revision: number; reviewContentDigest?: string };
  inputTemplateFields?: InputTemplateFields;
  sections: {
    existing?: string;
    newSource?: string;
    suggestedAdditions: string[];
    conflicts: string[];
    inferences: string[];
    openQuestions: string[];
    agreement: string[];
    sourceList: Array<{ id: string; title: string; source_level?: SourceLevel; existingSourceId?: string }>;
  };
  title: string;
  category: string;
  sources: string[];
  wikiInput?: WikiInput;
  source_level?: SourceLevel;
  commitOperationId?: string;
  committedWikiId?: string;
  evidence?: Array<{ section: string; text: string; rawId: string; quote: string; start: number; end: number }>;
  lastCommitError?: string;
};

export type WorkflowManifest = {
  humanReviewDigest?: string;
  humanReviewBasisDigest?: string;
  legacyRecovery?: 'verified_partial';
  awaitingHumanReview?: boolean;
  supersededBy?: string;
  operationId: string;
  workflowId: string;
  idempotencyKey: string;
  payloadDigest: string;
  status: 'prepared' | 'committing' | 'completed' | 'conflict';
  createdAt: string;
  updatedAt: string;
  records: WikiRecord[];
  updateTargetId?: string;
  targetBaseRevision?: number;
  rawSnapshots: KnowledgeWorkflow['rawSnapshots'];
  writtenIds: string[];
  error?: string;
};

export type WorkflowContext = {
  root: string;
  wiki: WikiStore;
  raws: RawStore;
  queue: SerialQueue;
  get(id: string): Promise<KnowledgeWorkflow | undefined>;
  getCommit(id: string): Promise<WorkflowManifest | undefined>;
  save(record: KnowledgeWorkflow): Promise<KnowledgeWorkflow>;
  contentDigest(record: KnowledgeWorkflow): string;
  operationsDir(): string;
  operationFile(id: string): string;
};

export const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
