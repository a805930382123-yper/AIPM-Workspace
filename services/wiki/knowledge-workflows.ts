import path from 'node:path';
import { isWorkflow, isWorkflowManifest } from '../storage/record-validators.ts';
import { mkdir } from 'node:fs/promises';
import { SerialQueue, scanJsonRecords, StorageError, readJsonRecord, writeJsonAtomic } from '../storage/files.ts';
import { type RawStore } from '../raw/store.ts';
import { type LlmProvider } from '../llm/provider.ts';
import { WikiError, type WikiStore } from './store.ts';
import { candidateContent, reviewContentDigest } from './human-review.ts';
import {
  type KnowledgeWorkflow,
  type WorkflowManifest,
  type WorkflowContext,
  type WorkflowUpdateInput,
} from './workflow-types.ts';
export type { KnowledgeWorkflow } from './workflow-types.ts';
import { reviewOperation, patch, discard } from './workflow-review.ts';
import { createUpdate, createSynthesis } from './workflow-create.ts';
import { confirm, reconcile } from './workflow-commit.ts';

const workflowQueues = new Map<string, SerialQueue>();
export class KnowledgeWorkflowStore {
  private readonly queue: SerialQueue;
  constructor(
    private readonly root: string,
    private readonly wiki: WikiStore,
    private readonly raws: RawStore,
  ) {
    const key = path.resolve(root);
    this.queue = workflowQueues.get(key) ?? new SerialQueue();
    workflowQueues.set(key, this.queue);
  }
  private dir() {
    return path.join(this.root, 'drafts', 'knowledge-workflows');
  }
  private file(id: string) {
    return path.join(this.dir(), `${id}.json`);
  }
  async initialize() {
    await mkdir(this.dir(), { recursive: true });
    await mkdir(this.operationsDir(), { recursive: true });
    await this.reconcile();
  }
  private operationsDir() {
    return path.join(this.root, 'state', 'knowledge-commits');
  }
  private operationFile(id: string) {
    return path.join(this.operationsDir(), `${id}.json`);
  }
  async get(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const v = await readJsonRecord<KnowledgeWorkflow>(this.root, this.file(id), (x): x is KnowledgeWorkflow =>
      isWorkflow(x, id),
    );
    if (v === undefined) return undefined;
    if (!isWorkflow(v, id))
      throw new StorageError('STORAGE_CORRUPT', '知识工作流记录结构无效，原文件已保留。', 500, {
        category: 'recovery',
        nextAction: 'inspect_or_restore',
      });
    return v;
  }
  async getCommit(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const v = await readJsonRecord<WorkflowManifest>(this.root, this.operationFile(id), (x): x is WorkflowManifest =>
      isWorkflowManifest(x, id),
    );
    if (v === undefined) return undefined;
    if (!isWorkflowManifest(v, id))
      throw new StorageError('STORAGE_CORRUPT', '知识提交清单结构无效，原文件已保留；恢复执行已停止。', 500, {
        category: 'recovery',
        nextAction: 'inspect_or_restore',
      });
    return v;
  }
  async list() {
    return (
      await scanJsonRecords<KnowledgeWorkflow>(
        this.dir(),
        (v, file): v is KnowledgeWorkflow => isWorkflow(v, path.basename(file, '.json')),
        this.root,
      )
    ).records.map((x) => x.value);
  }
  async save(record: KnowledgeWorkflow) {
    await writeJsonAtomic(this.file(record.id), record);
    return record;
  }

  contentDigest(record: KnowledgeWorkflow): string {
    if (!record.humanReview) throw new WikiError('HUMAN_REVIEW_REQUIRED', '请先开始审查知识预览。', 409);
    return reviewContentDigest(
      { workflowId: record.id, rawSnapshots: record.rawSnapshots },
      candidateContent(record),
      record.humanReview,
    );
  }
  view(record: KnowledgeWorkflow) {
    return { ...record, reviewContentDigest: record.humanReview ? this.contentDigest(record) : null };
  }

  async reviewOperation(
    id: string,
    input: {
      baseRevision: number;
      action: 'start' | 'move' | 'page';
      unitIds?: string[];
      pageId?: string | null;
      reviewContentDigest?: string;
      confirmed?: boolean;
    },
  ): Promise<KnowledgeWorkflow> {
    return reviewOperation(this.context(), id, input);
  }

  async createUpdate(args: WorkflowUpdateInput) {
    return createUpdate(this.context(), args);
  }

  async createSynthesis(args: { rawIds: string[]; provider: LlmProvider }) {
    return createSynthesis(this.context(), args);
  }

  async patch(
    id: string,
    baseRevision: number,
    sections: KnowledgeWorkflow['sections'],
    title?: string,
    sourceLevel?: unknown,
  ) {
    return patch(this.context(), id, baseRevision, sections, title, sourceLevel);
  }

  async discard(id: string, baseRevision: number) {
    return discard(this.context(), id, baseRevision);
  }

  async confirm(id: string, baseRevision: number, idempotencyKey: string) {
    return confirm(this.context(), id, baseRevision, idempotencyKey);
  }

  async reconcile() {
    return reconcile(this.context());
  }

  private context(): WorkflowContext {
    return {
      root: this.root,
      wiki: this.wiki,
      raws: this.raws,
      queue: this.queue,
      get: (id) => this.get(id),
      getCommit: (id) => this.getCommit(id),
      save: (record) => this.save(record),
      contentDigest: (record) => this.contentDigest(record),
      operationsDir: () => this.operationsDir(),
      operationFile: (id) => this.operationFile(id),
    };
  }
}
