import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { validReviewDate } from '../home/review.ts';
import type { RawStore } from '../raw/store.ts';
import {
  JSON_SCAN_BUDGET,
  listJsonRecords,
  readJsonRecord,
  scanJsonRecords,
  SerialQueue,
  StorageError,
  writeFileAtomic,
  writeJsonAtomic,
} from '../storage/files.ts';
import { isUuid } from '../storage/record-validators.ts';
import { readWorkAnalysisRun, validWorkAnalysis } from './analysis-runs.ts';
import {
  workStatuses,
  type WorkHistory,
  type WorkHistoryInput,
  type WorkItem,
  type WorkItemSummary,
  type WorkScreenshot,
  type WorkStatus,
} from './types.ts';

const TEXT_LIMIT = 20_000;
const contextLimits = {
  customer: 200,
  project: 200,
  waitingFor: 300,
  nextStep: 1000,
  reportDraft: TEXT_LIMIT,
} as const;
const customerFields = ['customer', 'project', 'occurredAt', 'reportDraft', 'feedback'] as const;
const analysisFields = {
  dataScope: '数据范围与口径',
  confirmedConclusions: '已确认结论',
  openQuestions: '未解问题',
} as const;
const historyKinds = ['feedback', 'reproduction', 'technical_reply', 'customer_reply', 'sent', 'retest'] as const;
const imageTypes = { 'image/png': 'png', 'image/jpeg': 'jpg' } as const;
export const MAX_WORK_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function invalid(message: string): never {
  throw new StorageError('INVALID_WORK_ITEM', message, 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`请填写${label}。`);
  if (value.length > limit) invalid(`${label}最多 ${limit} 字。`);
  return value;
}

function optionalText(value: unknown, limit: number, label: string): string | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined;
  return requiredText(value, limit, label);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return (
    !!parts &&
    validReviewDate(parts[1]) &&
    Number(parts[2]) < 24 &&
    Number(parts[3]) < 60 &&
    Number(parts[4]) < 60 &&
    Number.isFinite(Date.parse(value))
  );
}

function timestamp(value: unknown, label: string): string {
  if (!validTimestamp(value)) invalid(`请输入有效的${label}。`);
  return new Date(value).toISOString();
}

function validStatus(value: unknown): value is WorkStatus {
  return workStatuses.some((status) => status === value);
}

function validOutcome(value: unknown): value is 'passed' | 'failed' {
  return value === 'passed' || value === 'failed';
}

function historyInput(value: unknown): WorkHistoryInput {
  if (!isRecord(value)) invalid('处理记录格式不正确。');
  const body = requiredText(value.body, TEXT_LIMIT, '记录正文');
  switch (value.kind) {
    case 'feedback':
    case 'reproduction':
    case 'technical_reply':
    case 'customer_reply':
      return { kind: value.kind, body };
    case 'sent':
      return { kind: 'sent', body, sentAt: timestamp(value.sentAt, '实际发送时间') };
    case 'retest':
      if (!validOutcome(value.outcome)) invalid('请选择复测结果。');
      return { kind: 'retest', body, outcome: value.outcome };
    case 'stage_result':
      if (value.analysisRunId !== undefined && !isUuid(value.analysisRunId)) invalid('请选择有效的分析执行。');
      return { kind: 'stage_result', body, analysisRunId: value.analysisRunId };
    default:
      return invalid('请选择有效的处理记录类型。');
  }
}

function validImageType(value: unknown): value is WorkScreenshot['type'] {
  return value === 'image/png' || value === 'image/jpeg';
}

function validStoredItem(value: unknown, id: string): value is WorkItem {
  const product = isRecord(value) && value.kind === 'product_analysis';
  return (
    isRecord(value) &&
    isUuid(id) &&
    value.id === id &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) > 0 &&
    typeof value.title === 'string' &&
    !!value.title.trim() &&
    (product
      ? validWorkAnalysis(value.analysis) &&
        value.status !== 'retest' &&
        customerFields.every((key) => value[key] === undefined)
      : (value.kind === undefined || value.kind === 'customer_issue') &&
        value.analysis === undefined &&
        typeof value.feedback === 'string' &&
        !!value.feedback.trim()) &&
    validStatus(value.status) &&
    validTimestamp(value.createdAt) &&
    validTimestamp(value.updatedAt) &&
    Object.keys(contextLimits).every((key) => value[key] === undefined || typeof value[key] === 'string') &&
    (value.followUpOn === undefined || validReviewDate(value.followUpOn)) &&
    (value.occurredAt === undefined || validTimestamp(value.occurredAt)) &&
    Array.isArray(value.rawIds) &&
    value.rawIds.every(isUuid) &&
    Array.isArray(value.history) &&
    value.history.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.body === 'string' &&
        validTimestamp(entry.at) &&
        (entry.kind === 'closed' ||
          entry.kind === 'reopened' ||
          (product
            ? entry.kind === 'stage_result' && (entry.analysisRunId === undefined || isUuid(entry.analysisRunId))
            : historyKinds.some((kind) => kind === entry.kind))) &&
        (entry.kind !== 'sent' || validTimestamp(entry.sentAt)) &&
        (entry.kind !== 'retest' || validOutcome(entry.outcome)),
    ) &&
    Array.isArray(value.screenshots) &&
    value.screenshots.every(
      (image) =>
        isRecord(image) &&
        isUuid(image.id) &&
        validImageType(image.type) &&
        validTimestamp(image.uploadedAt) &&
        (image.note === undefined || typeof image.note === 'string'),
    )
  );
}

export class WorkItemStore {
  private readonly directory: string;
  private readonly queue = new SerialQueue();

  constructor(
    private readonly root: string,
    private readonly raws: Pick<RawStore, 'get'>,
  ) {
    this.directory = path.join(root, 'work-items');
  }

  private file(id: string) {
    return path.join(this.directory, `${id}.json`);
  }

  private imageFile(id: string, image: WorkScreenshot) {
    return path.join(this.directory, 'screenshots', id, `${image.id}.${imageTypes[image.type]}`);
  }

  async list(dueOnly = false, now = new Date()): Promise<WorkItemSummary[]> {
    const records = await listJsonRecords(
      this.directory,
      (value, file): value is WorkItem => validStoredItem(value, path.basename(file, '.json')),
      this.root,
    );
    const today = shanghaiDate.format(now);
    const items: WorkItemSummary[] = records.map(
      ({ value: { id, kind = 'customer_issue', revision, title, status, followUpOn, updatedAt } }) => ({
        id,
        kind,
        revision,
        title,
        status,
        followUpOn,
        updatedAt,
      }),
    );
    if (dueOnly) {
      return items
        .filter((item) => item.status !== 'closed' && item.followUpOn && item.followUpOn <= today)
        .sort(
          (a, b) =>
            a.followUpOn!.localeCompare(b.followUpOn!) ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.id.localeCompare(b.id),
        );
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<WorkItem> {
    const item = isUuid(id)
      ? await readJsonRecord(this.root, this.file(id), (value): value is WorkItem => validStoredItem(value, id))
      : undefined;
    if (!item) throw new StorageError('WORK_ITEM_NOT_FOUND', '没有找到这条工作事项。', 404);
    return item.kind === undefined ? { ...item, kind: 'customer_issue' } : item;
  }

  async scanForReminders() {
    const { records, issues, partial } = await scanJsonRecords(
      this.directory,
      (value, file): value is WorkItem => validStoredItem(value, path.basename(file, '.json')),
      this.root,
    );
    const items = records.map(
      ({ value: { id, kind = 'customer_issue', title, status, followUpOn, updatedAt, rawIds } }) => ({
        id,
        kind,
        title,
        status,
        followUpOn,
        updatedAt,
        rawIds,
      }),
    );
    return { items, issues, partial };
  }

  async scanForWeeklyReview() {
    const { records, issues } = await scanJsonRecords(
      this.directory,
      (value, file): value is WorkItem => validStoredItem(value, path.basename(file, '.json')),
      this.root,
    );
    const items = records.map(
      ({ value: { id, kind = 'customer_issue', title, status, followUpOn, createdAt, rawIds, history } }) => ({
        id,
        kind,
        title,
        status,
        followUpOn,
        createdAt,
        rawIds,
        closedAt: history.flatMap((event) => (event.kind === 'closed' ? [event.at] : [])),
      }),
    );
    return { items, issues };
  }

  private async save(item: WorkItem) {
    if (Buffer.byteLength(`${JSON.stringify(item, null, 2)}\n`) > JSON_SCAN_BUDGET.fileBytes) {
      throw new StorageError('WORK_ITEM_TOO_LARGE', '这条事项的文字记录过大，无法继续保存。', 413);
    }
    await writeJsonAtomic(this.file(item.id), item);
    return item;
  }

  async create(value: unknown): Promise<WorkItem> {
    if (!isRecord(value)) invalid('工作事项格式不正确。');
    const { kind = 'customer_issue' } = value;
    if (kind !== 'customer_issue' && kind !== 'product_analysis') invalid('请选择有效的事项类型。');
    const title = requiredText(value.title, 200, kind === 'product_analysis' ? '事项标题' : '问题标题').trim();
    const now = new Date().toISOString();
    const base = {
      id: randomUUID(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      title,
      status: 'triage' as const,
      rawIds: [],
      history: [],
      screenshots: [],
    };
    if (kind === 'product_analysis' && 'feedback' in value) invalid('产品分析事项请填写分析目标。');
    const item: WorkItem =
      kind === 'product_analysis'
        ? { ...base, kind, analysis: { goal: requiredText(value.goal, TEXT_LIMIT, '分析目标') } }
        : { ...base, kind, feedback: requiredText(value.feedback, TEXT_LIMIT, '客户反馈') };
    return this.queue.run(() => this.save(item));
  }

  private async currentRevision(id: string, baseRevision: unknown) {
    if (!Number.isSafeInteger(baseRevision) || Number(baseRevision) < 1) invalid('请提供要更新的事项版本。');
    const current = await this.get(id);
    if (current.revision !== baseRevision) {
      throw new StorageError('REVISION_CONFLICT', '这条事项已有更新。请重新读取后核对，再保存你的输入。', 409, {
        currentRevision: current.revision,
      });
    }
    return current;
  }

  async delete(id: string, baseRevision: unknown, isRunning: () => boolean) {
    return this.queue.run(async () => {
      await this.currentRevision(id, baseRevision);
      if (isRunning()) throw new StorageError('WORK_ITEM_BUSY', '分析或依据复核正在运行，请结束后再删除。', 409);
      await rm(this.file(id));
    });
  }

  async update(id: string, value: unknown): Promise<WorkItem> {
    if (!isRecord(value)) invalid('工作事项格式不正确。');
    return this.queue.run(async () => {
      const current = await this.currentRevision(id, value.baseRevision);
      const at = new Date().toISOString();
      const next: WorkItem = { ...current, revision: current.revision + 1, updatedAt: at };
      const product = next.kind === 'product_analysis';
      if ('kind' in value) invalid('事项类型不可更改。');
      if (product && customerFields.some((key) => key in value)) invalid('产品分析事项不支持客户问题字段。');
      if ('analysis' in value) {
        if (next.kind !== 'product_analysis' || !isRecord(value.analysis)) invalid('请选择有效的产品分析事项字段。');
        next.analysis = { ...next.analysis };
        if ('goal' in value.analysis) next.analysis.goal = requiredText(value.analysis.goal, TEXT_LIMIT, '分析目标');
        for (const key of Object.keys(analysisFields) as Array<keyof typeof analysisFields>) {
          if (key in value.analysis)
            next.analysis[key] = optionalText(value.analysis[key], TEXT_LIMIT, analysisFields[key]);
        }
      }
      const labels = {
        customer: '客户',
        project: '项目',
        waitingFor: '等待对象',
        nextStep: '下一步',
        reportDraft: '技术反馈正文',
      };
      for (const key of Object.keys(contextLimits) as Array<keyof typeof contextLimits>) {
        if (key in value) next[key] = optionalText(value[key], contextLimits[key], labels[key]);
      }
      if ('occurredAt' in value) {
        next.occurredAt =
          value.occurredAt == null || value.occurredAt === '' ? undefined : timestamp(value.occurredAt, '发生时间');
      }
      if ('followUpOn' in value) {
        const date = value.followUpOn;
        if (date == null || date === '') next.followUpOn = undefined;
        else if (validReviewDate(date)) next.followUpOn = date;
        else invalid('请输入有效的跟进日期。');
      }
      if ('rawIds' in value) {
        if (!Array.isArray(value.rawIds) || !value.rawIds.every(isUuid)) invalid('Raw 关联格式不正确。');
        const rawIds = [...new Set(value.rawIds as string[])];
        for (const rawId of rawIds) {
          // A historical link can be retained when its Raw is later removed.
          if (!current.rawIds.includes(rawId) && !(await this.raws.get(rawId)))
            invalid('所选 Raw 来源不可用，请重新选择。');
        }
        next.rawIds = rawIds;
      }
      const appended: WorkHistory[] = [];
      if ('status' in value) {
        if (!validStatus(value.status) || (product && value.status === 'retest')) invalid('请选择有效的事项状态。');
        next.status = value.status;
      }
      if (current.status !== 'closed' && next.status === 'closed') {
        appended.push({
          kind: 'closed',
          body: requiredText(value.closureReason, TEXT_LIMIT, product ? '完成说明' : '解决说明'),
          at,
        });
      }
      if ('reopen' in value) {
        if (value.reopen !== true || current.status !== 'closed' || value.status === 'closed')
          invalid('只能重开已关闭的事项。');
        next.status = value.status === undefined ? 'triage' : next.status;
        appended.push({ kind: 'reopened', body: '已重开事项。', at });
      } else if (current.status === 'closed' && next.status !== 'closed') {
        invalid('请先明确重开这条事项。');
      }
      if ('history' in value) {
        const entry = historyInput(value.history);
        if (entry.kind === 'stage_result') {
          if (!product) invalid('阶段成果只适用于产品分析事项。');
          if (
            entry.analysisRunId &&
            (await readWorkAnalysisRun(this.root, id, entry.analysisRunId))?.status !== 'completed'
          ) {
            invalid('请选择该事项已完成的分析执行。');
          }
        } else if (product) invalid('产品分析事项请保存阶段成果。');
        appended.push({ ...entry, at });
      }
      if (appended.length) next.history = [...current.history, ...appended];
      return this.save(next);
    });
  }

  async addScreenshot(
    id: string,
    baseRevision: number,
    noteValue: unknown,
    type: unknown,
    bytes: Buffer,
  ): Promise<WorkItem> {
    if (bytes.length > MAX_WORK_SCREENSHOT_BYTES)
      throw new StorageError('WORK_SCREENSHOT_TOO_LARGE', '截图不能超过 5 MiB。', 413);
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (!validImageType(type) || bytes.length <= 8 || (type === 'image/png' ? !png : !jpeg)) {
      throw new StorageError('INVALID_WORK_SCREENSHOT', '请选择有效的 PNG 或 JPEG 截图。', 400);
    }
    const note = optionalText(noteValue, 1000, '截图说明');
    return this.queue.run(async () => {
      const current = await this.currentRevision(id, baseRevision);
      const uploadedAt = new Date().toISOString();
      const image: WorkScreenshot = { id: randomUUID(), type, note, uploadedAt };
      const file = this.imageFile(id, image);
      await writeFileAtomic(file, bytes);
      try {
        return await this.save({
          ...current,
          revision: current.revision + 1,
          updatedAt: uploadedAt,
          screenshots: [...current.screenshots, image],
        });
      } catch (error) {
        await rm(file, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async getScreenshot(id: string, screenshotId: string) {
    const item = await this.get(id);
    const image = item.screenshots.find((entry) => entry.id === screenshotId);
    if (!image) throw new StorageError('WORK_SCREENSHOT_NOT_FOUND', '没有找到这张事项截图。', 404);
    const bytes = await readFile(this.imageFile(id, image)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new StorageError('WORK_SCREENSHOT_NOT_FOUND', '截图文件不可用。', 404);
      throw error;
    });
    return { type: image.type, bytes };
  }
}
