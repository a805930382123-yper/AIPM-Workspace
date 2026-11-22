import path from 'node:path';
import { validateSchema, type JsonSchemaNode } from '../llm/schema-validator.ts';
import { readJsonRecord, scanJsonRecords, SerialQueue, StorageError, writeJsonAtomic } from '../storage/files.ts';
import { isIsoDate } from './ledger.ts';
import type { AutomationIssue, AutomationUsage } from './types.ts';
import { validWeekKey, type WeeklyReviewPeriod, type WeeklyReviewSnapshot } from './weekly-review-snapshot.ts';

export type { WeeklyReviewPeriod } from './weekly-review-snapshot.ts';
export type WeeklyReviewDraft = {
  executiveSummary: string;
  highlights: { text: string; refs: string[] }[];
  risksAndBlockers: { text: string; refs: string[] }[];
  nextWeekFocus: { text: string; reason: string }[];
  openQuestions: string[];
};
export type WeeklyReview = {
  weekKey: string;
  period: WeeklyReviewPeriod;
  revision: number;
  status: 'draft' | 'reviewed';
  aiStatus: 'ready' | 'facts_only' | 'ai_failed';
  snapshot: WeeklyReviewSnapshot;
  draft: WeeklyReviewDraft | null;
  userMarkdown: string;
  generatedAt: string;
  updatedAt: string;
  reviewedAt?: string;
  usage: AutomationUsage;
  aiError?: string;
};
export type WeeklyReviewSettings = { revision: number; aiSummaryEnabled: boolean };
export type WeeklyReviewSummary = Pick<
  WeeklyReview,
  'weekKey' | 'period' | 'revision' | 'status' | 'aiStatus' | 'updatedAt'
>;
export type WeeklyReviewList = {
  items: WeeklyReviewSummary[];
  settings: WeeklyReviewSettings;
  issues: AutomationIssue[];
};
export type WeeklyReviewRegeneration = { weekKey: string; baseRevision: number; overwriteEdited: boolean };
type Patch = Partial<Pick<WeeklyReview, 'status' | 'userMarkdown'>>;

const text = { type: 'string', minLength: 1, maxLength: 800 } as const;
const linked: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'refs'],
  properties: {
    text,
    refs: { type: 'array', minItems: 1, maxItems: 12, items: { ...text, maxLength: 200 } },
  },
};
export const weeklyReviewDraftSchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['executiveSummary', 'highlights', 'risksAndBlockers', 'nextWeekFocus', 'openQuestions'],
  properties: {
    executiveSummary: { ...text, maxLength: 300 },
    highlights: { type: 'array', maxItems: 12, items: linked },
    risksAndBlockers: { type: 'array', maxItems: 12, items: linked },
    nextWeekFocus: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'reason'],
        properties: { text, reason: text },
      },
    },
    openQuestions: { type: 'array', maxItems: 10, items: text },
  },
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
function validSettings(value: unknown): value is WeeklyReviewSettings {
  return object(value) && revision(value.revision) && typeof value.aiSummaryEnabled === 'boolean';
}
function validSnapshot(value: unknown): value is WeeklyReviewSnapshot {
  return (
    object(value) &&
    typeof value.hasActivity === 'boolean' &&
    Array.isArray(value.sections) &&
    value.sections.every(
      (section) =>
        object(section) &&
        string(section.key) &&
        string(section.title) &&
        (section.scope === 'period' || section.scope === 'current') &&
        (section.status === 'ok' || section.status === 'error') &&
        (section.message === undefined || string(section.message)) &&
        Array.isArray(section.metrics) &&
        section.metrics.every(
          (metric) => object(metric) && string(metric.ref) && string(metric.label) && Number.isFinite(metric.count),
        ) &&
        Array.isArray(section.entries) &&
        section.entries.every(
          (entry) =>
            object(entry) &&
            string(entry.ref) &&
            string(entry.title) &&
            (entry.date === undefined || string(entry.date)) &&
            (entry.status === undefined || string(entry.status)) &&
            (entry.target === undefined ||
              (object(entry.target) &&
                string(entry.target.id) &&
                ['wiki', 'work', 'prompt', 'run', 'inspection', 'lint', 'raw'].some(
                  (kind) => kind === (entry.target as Record<string, unknown>).kind,
                ))),
        ),
    )
  );
}

export function weeklyReviewRefs(snapshot: WeeklyReviewSnapshot) {
  return new Set(
    snapshot.sections.flatMap((section) => [
      ...section.metrics.map((metric) => metric.ref),
      ...section.entries.map((entry) => entry.ref),
    ]),
  );
}
export function validWeeklyReviewDraft(value: unknown, snapshot: WeeklyReviewSnapshot): value is WeeklyReviewDraft {
  if (validateSchema(value, weeklyReviewDraftSchema).length) return false;
  const draft = value as WeeklyReviewDraft;
  const refs = weeklyReviewRefs(snapshot);
  return (
    !!draft.executiveSummary.trim() &&
    draft.nextWeekFocus.every((row) => row.text.trim() && row.reason.trim()) &&
    draft.openQuestions.every((text) => text.trim()) &&
    [...draft.highlights, ...draft.risksAndBlockers].every(
      (row) => row.text.trim() && new Set(row.refs).size === row.refs.length && row.refs.every((ref) => refs.has(ref)),
    )
  );
}
function validReview(value: unknown, id: string): value is WeeklyReview {
  return (
    object(value) &&
    validWeekKey(id) &&
    value.weekKey === id &&
    revision(value.revision) &&
    (value.status === 'reviewed'
      ? isIsoDate(value.reviewedAt)
      : value.status === 'draft' && value.reviewedAt === undefined) &&
    object(value.period) &&
    value.period.weekKey === id &&
    string(value.period.start) &&
    string(value.period.end) &&
    isIsoDate(value.period.from) &&
    isIsoDate(value.period.until) &&
    typeof value.period.partialWeek === 'boolean' &&
    validSnapshot(value.snapshot) &&
    (value.aiStatus === 'ready'
      ? validWeeklyReviewDraft(value.draft, value.snapshot)
      : (value.aiStatus === 'facts_only' || value.aiStatus === 'ai_failed') && value.draft === null) &&
    (value.aiError === undefined || string(value.aiError)) &&
    string(value.userMarkdown) &&
    isIsoDate(value.generatedAt) &&
    isIsoDate(value.updatedAt) &&
    object(value.usage) &&
    ['requests', 'inputTokens', 'outputTokens', 'unknownUsageCount'].every((key) => {
      const amount = (value.usage as Record<string, unknown>)[key];
      return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
    })
  );
}

const conflict = (currentRevision: number) =>
  new StorageError('WEEKLY_REVIEW_REVISION_CONFLICT', '周报已更新，请重新读取后再操作。', 409, { currentRevision });
const missing = () => new StorageError('WEEKLY_REVIEW_NOT_FOUND', '没有找到这一周的回顾草稿。', 404);
const protectedReview = (record: WeeklyReview) => record.status === 'reviewed' || record.userMarkdown.length > 0;
const defaults = (): WeeklyReviewSettings => ({ revision: 1, aiSummaryEnabled: true });
export const emptyWeeklyReviewUsage = (): AutomationUsage => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  unknownUsageCount: 0,
});

export class WeeklyReviewStore {
  private readonly directory: string;
  private readonly settingsFile: string;
  private readonly io = new SerialQueue();

  constructor(
    private readonly root: string,
    private readonly clock = Date.now,
  ) {
    this.directory = path.join(root, 'state', 'automation', 'weekly-reviews');
    this.settingsFile = path.join(this.directory, 'settings.json');
  }

  private file(weekKey: string) {
    if (!validWeekKey(weekKey)) throw new StorageError('WEEKLY_REVIEW_INVALID_WEEK', '周标识无效。', 400);
    return path.join(this.directory, weekKey + '.json');
  }

  private async read(weekKey: string) {
    return readJsonRecord(this.root, this.file(weekKey), (value): value is WeeklyReview => validReview(value, weekKey));
  }

  async get(weekKey: string) {
    const record = await this.read(weekKey);
    if (!record) throw missing();
    return record;
  }

  private async settings() {
    return (await readJsonRecord(this.root, this.settingsFile, validSettings)) ?? defaults();
  }

  async list(): Promise<WeeklyReviewList> {
    const scan = await scanJsonRecords<WeeklyReview | WeeklyReviewSettings>(
      this.directory,
      (value, file): value is WeeklyReview | WeeklyReviewSettings =>
        file === this.settingsFile ? validSettings(value) : validReview(value, path.basename(file, '.json')),
      this.root,
    );
    const items = scan.records
      .flatMap(({ value }) => {
        if (!('weekKey' in value)) return [];
        const { weekKey, period, revision, status, aiStatus, updatedAt } = value;
        return [{ weekKey, period, revision, status, aiStatus, updatedAt }];
      })
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
    const settings =
      scan.records.map(({ value }) => value).find((value): value is WeeklyReviewSettings => !('weekKey' in value)) ??
      defaults();
    return {
      items,
      settings,
      issues: scan.issues.map(({ file, reason }) => ({
        file: path.relative(this.root, file).split(path.sep).join('/'),
        reason,
      })),
    };
  }

  updateSettings(baseRevision: number, aiSummaryEnabled: boolean) {
    return this.io.run(async () => {
      const settings = await this.settings();
      if (settings.revision !== baseRevision) throw conflict(settings.revision);
      const next = { revision: baseRevision + 1, aiSummaryEnabled };
      await writeJsonAtomic(this.settingsFile, next);
      return next;
    });
  }

  patch(weekKey: string, baseRevision: number, patch: Patch) {
    return this.io.run(async () => {
      const record = await this.get(weekKey);
      if (record.revision !== baseRevision) throw conflict(record.revision);
      const updatedAt = new Date(this.clock()).toISOString();
      const next = { ...record, ...patch, updatedAt, revision: baseRevision + 1 };
      next.reviewedAt = next.status === 'reviewed' ? (record.reviewedAt ?? updatedAt) : undefined;
      await writeJsonAtomic(this.file(weekKey), next);
      return next;
    });
  }

  prepare(weekKey: string, request?: WeeklyReviewRegeneration) {
    return this.io.run(async () => {
      const current = await this.read(weekKey);
      const baseRevision = current?.revision ?? 0;
      const edited = current && protectedReview(current);
      if (request && baseRevision !== request.baseRevision) throw conflict(baseRevision);
      if (edited && !request) return null;
      if (edited && !request?.overwriteEdited) {
        throw new StorageError('WEEKLY_REVIEW_CONFIRM_OVERWRITE', '周报已有人工编辑或已归档，请确认后重新生成。', 409);
      }
      const { aiSummaryEnabled } = await this.settings();
      return { baseRevision, aiSummaryEnabled };
    });
  }

  writeFacts(period: WeeklyReviewPeriod, expected: number, snapshot: WeeklyReviewSnapshot) {
    return this.io.run(async () => {
      const current = await this.read(period.weekKey);
      if ((current?.revision ?? 0) !== expected) throw conflict(current?.revision ?? 0);
      const generatedAt = new Date(this.clock()).toISOString();
      const record: WeeklyReview = {
        weekKey: period.weekKey,
        period,
        revision: expected + 1,
        status: 'draft',
        aiStatus: 'facts_only',
        snapshot,
        draft: null,
        userMarkdown: '',
        generatedAt,
        updatedAt: generatedAt,
        usage: emptyWeeklyReviewUsage(),
      };
      await writeJsonAtomic(this.file(period.weekKey), record);
      return record;
    });
  }

  finish(weekKey: string, expected: number, outcome: Pick<WeeklyReview, 'aiStatus' | 'draft' | 'usage' | 'aiError'>) {
    return this.io.run(async () => {
      const record = await this.get(weekKey);
      if (record.revision !== expected) return false;
      const next = { ...record, ...outcome, revision: expected + 1, updatedAt: new Date(this.clock()).toISOString() };
      await writeJsonAtomic(this.file(weekKey), next);
      return true;
    });
  }
}

export function weeklyReviewMarkdown(record: WeeklyReview): string {
  const safe = (text: string) => text.replace(/[\r\n]+/gu, ' ').replace(/[\\*_\[\]#<>|]/gu, '\\$&');
  const lines = [
    '# 工作回顾 ' + record.weekKey,
    '',
    '覆盖范围 ' +
      record.period.start +
      ' 至 ' +
      record.period.end +
      '（不含，Asia/Shanghai）' +
      (record.period.partialWeek ? '，部分周截至 ' + record.period.until : ''),
    '',
    '## 本周事实快照',
    '',
  ];
  for (const section of record.snapshot.sections) {
    lines.push('### ' + section.title + (section.scope === 'current' ? '（生成时点）' : ''), '');
    if (section.status === 'error') lines.push('- ' + (section.message ?? '读取失败'));
    else {
      for (const metric of section.metrics) lines.push('- ' + metric.label + ' · ' + metric.count);
      for (const row of section.entries)
        lines.push('- ' + [safe(row.title), row.date, row.status, '〔' + row.ref + '〕'].filter(Boolean).join(' · '));
    }
    lines.push('');
  }
  lines.push('## AI 整理与建议', '');
  const { draft } = record;
  if (draft) {
    lines.push('**AI 整理**　' + safe(draft.executiveSummary), '', '### 本周要点', '');
    for (const item of draft.highlights) lines.push('- ' + safe(item.text) + '〔' + item.refs.join('、') + '〕');
    lines.push('', '### 风险与阻塞', '');
    for (const item of draft.risksAndBlockers) lines.push('- ' + safe(item.text) + '〔' + item.refs.join('、') + '〕');
    lines.push('', '### AI 建议，待确认', '');
    for (const item of draft.nextWeekFocus) lines.push('- ' + safe(item.text) + ' · ' + safe(item.reason));
    lines.push('', '### 待确认问题', '');
    for (const item of draft.openQuestions) lines.push('- ' + safe(item));
  } else lines.push(record.aiError ?? '本周仅保留事实快照。');
  lines.push('', '## 人工审阅备注', '', record.userMarkdown || '暂无人工备注。', '');
  return lines.join('\n');
}
