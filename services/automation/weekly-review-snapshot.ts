import { periodReview, validReviewDate } from '../home/review.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type { NewsService } from '../news/service.ts';
import { StorageError } from '../storage/files.ts';
import { assertWikiSourcesAllowed } from '../wiki/source-lineage.ts';
import type { WorkItemStore } from '../work-items/store.ts';
import type { KnowledgeInspectionService } from '../llm/knowledge-inspections.ts';
import { reminderDate, REMINDER_DAY, type RemindersStore } from './reminders.ts';
import type { AutomationScheduler } from './scheduler.ts';
import type { WikiLintSnapshots } from './tasks/wiki-lint.ts';

export type WeeklyReviewPeriod = {
  weekKey: string;
  start: string;
  end: string;
  from: string;
  until: string;
  partialWeek: boolean;
};
export type ReviewTarget = { kind: 'wiki' | 'work' | 'prompt' | 'run' | 'inspection' | 'lint' | 'raw'; id: string };
type Entry = { ref: string; title: string; date?: string; status?: string; target?: ReviewTarget };
type Metric = { ref: string; label: string; count: number };
export type ReviewSection = {
  key: string;
  title: string;
  scope: 'period' | 'current';
  status: 'ok' | 'error';
  message?: string;
  metrics: Metric[];
  entries: Entry[];
};
export type WeeklyReviewSnapshot = { sections: ReviewSection[]; hasActivity: boolean };

const DAY = REMINDER_DAY;
const WEEK = 7 * DAY;
const SHANGHAI = 8 * 3600_000;
const iso = (value: number) => new Date(value).toISOString();
const localMonday = (value: number) => {
  const midnight = Math.floor(value / DAY) * DAY;
  return midnight - ((new Date(midnight).getUTCDay() + 6) % 7) * DAY;
};
const isoKey = (monday: number) => {
  const year = new Date(monday + 3 * DAY).getUTCFullYear().toString().padStart(4, '0');
  const janWeek = localMonday(Date.parse(year + '-01-04T00:00:00.000Z'));
  return year + '-W' + (Math.round((monday - janWeek) / WEEK) + 1).toString().padStart(2, '0');
};

export function validWeekKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/u.test(value)) return false;
  const monday =
    localMonday(Date.parse(value.slice(0, 4) + '-01-04T00:00:00.000Z')) + (Number(value.slice(6)) - 1) * WEEK;
  return isoKey(monday) === value;
}

export function weeklyReviewPeriod(now: number, weekKey?: string, scheduledAt = now): WeeklyReviewPeriod {
  let monday = localMonday(scheduledAt + SHANGHAI) - WEEK;
  if (weekKey !== undefined) {
    if (!validWeekKey(weekKey))
      throw new StorageError('WEEKLY_REVIEW_INVALID_WEEK', '周标识无效，请使用有效的 ISO 周。', 400);
    monday =
      localMonday(Date.parse(weekKey.slice(0, 4) + '-01-04T00:00:00.000Z')) + (Number(weekKey.slice(6)) - 1) * WEEK;
  }
  const from = monday - SHANGHAI,
    end = from + WEEK;
  if (from > now) throw new StorageError('WEEKLY_REVIEW_FUTURE_WEEK', '请选择当前周或已经结束的一周。', 400);
  return {
    weekKey: isoKey(monday),
    start: iso(monday).slice(0, 10),
    end: iso(monday + WEEK).slice(0, 10),
    from: iso(from),
    until: iso(Math.min(now, end)),
    partialWeek: now < end,
  };
}

const shortTitle = (value: string) =>
  Array.from(value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim())
    .slice(0, 180)
    .join('');
const runLabels: Record<string, string> = {
  'system.selfcheck': '系统自检',
  'news.daily': '每日资讯',
  'pipeline.organize': '资讯入库与整理',
  'wiki.lint': '知识库结构巡检',
  'wiki.inspect': '知识库主动巡检',
  'work.reminders': '工作事项提醒',
  'review.weekly': '每周工作回顾',
};

export type WeeklyReviewSources = Parameters<typeof periodReview>[0] & {
  workItems: Pick<WorkItemStore, 'scanForWeeklyReview'>;
  news: Pick<NewsService, 'edition' | 'rawSaves'>;
  automation: Pick<AutomationScheduler, 'listRuns' | 'successfulRuns'>;
  lint: Pick<WikiLintSnapshots, 'get'>;
  inspections: Pick<KnowledgeInspectionService, 'get'>;
  reminders?: Pick<RemindersStore, 'read'>;
};

export async function buildWeeklyReviewSnapshot(
  deps: WeeklyReviewSources,
  period: WeeklyReviewPeriod,
  now: number,
  runId: string,
): Promise<WeeklyReviewSnapshot> {
  const today = reminderDate(now);
  const from = Date.parse(period.from),
    until = Date.parse(period.until);
  const inPeriod = (value?: string | null) => {
    if (!value) return false;
    const time = Date.parse(value) - (validReviewDate(value) ? SHANGHAI : 0);
    return time >= from && time < until;
  };
  const review = periodReview(deps, period.start, period.end);
  const work = deps.workItems.scanForWeeklyReview();
  const runs = deps.automation.listRuns({ from: period.from, until: period.until, limit: Number.POSITIVE_INFINITY });
  const wikiAllowed = new Map<string, Promise<boolean>>();
  const rawAllowed = new Map<string, Promise<boolean>>();
  const permitWiki = (id: string) => {
    if (!wikiAllowed.has(id))
      wikiAllowed.set(
        id,
        deps.wiki
          .get(id)
          .then(async (page) => {
            if (!page) return false;
            await assertWikiSourcesAllowed(deps.wiki, deps.raws, page);
            return true;
          })
          .catch(() => false),
      );
    return wikiAllowed.get(id)!;
  };
  const permitRaw = (id: string) => {
    if (!rawAllowed.has(id))
      rawAllowed.set(
        id,
        deps.raws
          .get(id)
          .then((raw) => {
            assertRawNotMeeting(raw);
            return true;
          })
          .catch(() => false),
      );
    return rawAllowed.get(id)!;
  };
  const validRuns = async () => {
    const { items, issues } = await runs;
    if (issues?.length) throw Error('run source');
    return items.filter((item) => item.id !== runId);
  };
  type SectionWriter = (
    metric: (id: string, label: string, count: number) => void,
    entry: (item: Entry) => void,
  ) => Promise<void>;
  const section = async (
    key: string,
    title: string,
    scope: ReviewSection['scope'],
    read: SectionWriter,
  ): Promise<ReviewSection> => {
    const base = { key, title, scope };
    const metrics: Metric[] = [],
      entries: Entry[] = [];
    try {
      await read(
        (id, label, count) => metrics.push({ ref: 'metric:' + key + ':' + id, label, count }),
        (row) => entries.push({ ...row, title: shortTitle(row.title) }),
      );
      return { ...base, status: 'ok', metrics, entries };
    } catch {
      return { ...base, status: 'error', metrics: [], entries: [], message: '读取失败，无法确认该来源的数据。' };
    }
  };
  const entriesWithWorkSources = async () => {
    const result = await work;
    if (result.issues.length) throw Error('work source');
    return result.items;
  };
  const dates = Array.from({ length: 7 }, (_, day) => iso(from + SHANGHAI + day * DAY).slice(0, 10)).filter(
    (date) => date <= today,
  );
  const sections = await Promise.all([
    section('knowledge', '新增 Wiki', 'period', async (metric, entry) => {
      const { knowledge } = await review;
      if (knowledge.status === 'error') throw Error('knowledge source');
      const selected = knowledge.items.filter((row) => inPeriod(row.created));
      let hidden = 0;
      for (const row of selected) {
        if (!(await permitWiki(row.id))) {
          hidden++;
          continue;
        }
        const current = await deps.wiki.get(row.id);
        if (current?.revision !== row.revision || current.title !== row.title) {
          hidden++;
          continue;
        }
        entry({
          ref: 'wiki:' + row.id,
          title: row.title,
          date: reminderDate(Date.parse(row.created) - (validReviewDate(row.created) ? SHANGHAI : 0)),
          target: { kind: 'wiki', id: row.id },
        });
      }
      metric('created', '本周新增 Wiki', selected.length);
      if (hidden) metric('hidden', '来源受限或无法核实，已隐藏明细', hidden);
      if (knowledge.undated.length) metric('undated', '时间缺失，无法归入周统计', knowledge.undated.length);
    }),
    section('feedback', 'Prompt 使用反馈', 'period', async (metric, entry) => {
      const { feedback } = await review;
      if (feedback.status === 'error') throw Error('feedback source');
      const selected = feedback.items.filter((row) => inPeriod(row.usedOn));
      const outcomes = new Map<string, number>();
      let hidden = 0;
      for (const row of selected) {
        outcomes.set(row.outcome, (outcomes.get(row.outcome) ?? 0) + 1);
        const prompt = (await deps.prompts.getVersion(row.promptId, row.promptVersion)).snapshot;
        const allowed = await Promise.all(prompt.relatedWikiIds.map(permitWiki));
        if (allowed.includes(false)) {
          hidden++;
          continue;
        }
        entry({
          ref: 'prompt:' + row.promptId + ':' + row.id,
          title: prompt.name,
          date: row.usedOn,
          status: row.outcome,
          target: { kind: 'prompt', id: row.promptId },
        });
      }
      metric('feedback', '本周 Prompt 反馈', selected.length);
      for (const [outcome, count] of outcomes) metric(outcome, '反馈类型 · ' + outcome, count);
      if (hidden) metric('hidden', '来源受限或无法核实，已隐藏明细', hidden);
    }),
    section('pending', '待处理', 'current', async (metric, entry) => {
      const { pending } = await review;
      if (Object.values(pending.sources).some((source) => source.status === 'error')) throw Error('pending source');
      let hidden = 0;
      for (const item of pending.items) {
        const { rawId, wikiId } = item.target;
        if ((rawId && !(await permitRaw(rawId))) || (wikiId && !(await permitWiki(wikiId))) || (!rawId && !wikiId)) {
          hidden++;
          continue;
        }
        entry({
          ref: 'pending:' + item.kind + ':' + item.id,
          title: item.title,
          status: item.status,
          ...(Number.isFinite(Date.parse(item.updatedAt)) ? { date: reminderDate(Date.parse(item.updatedAt)) } : {}),
          ...(rawId ? { target: { kind: 'raw', id: rawId } } : wikiId ? { target: { kind: 'wiki', id: wikiId } } : {}),
        });
      }
      metric('open', '当前待处理', pending.items.length);
      if (hidden) metric('hidden', '来源受限或无法核实，已隐藏明细', hidden);
    }),
    section('work', '工作事项进展', 'period', async (metric, entry) => {
      let created = 0,
        closed = 0,
        hidden = 0;
      for (const item of await entriesWithWorkSources()) {
        const wasCreated = inPeriod(item.createdAt);
        const closedAt = item.closedAt.filter(inPeriod).sort().at(-1);
        if (wasCreated) created++;
        if (closedAt) closed++;
        if (!wasCreated && !closedAt) continue;
        if ((await Promise.all(item.rawIds.map(permitRaw))).includes(false)) {
          hidden++;
          continue;
        }
        const detail = { title: item.title, target: { kind: 'work', id: item.id } as const };
        if (wasCreated)
          entry({
            ...detail,
            ref: 'work:' + item.id + ':created',
            status: '新建 · ' + item.kind,
            date: reminderDate(Date.parse(item.createdAt)),
          });
        if (closedAt)
          entry({
            ...detail,
            ref: 'work:' + item.id + ':closed',
            status: '关闭 · ' + item.kind,
            date: reminderDate(Date.parse(closedAt)),
          });
      }
      metric('created', '本周新建事项', created);
      metric('closed', '本周关闭事项', closed);
      if (hidden) metric('hidden', '来源受限或无法核实，已隐藏明细', hidden);
    }),
    section('work-active', '未结与到期事项', 'current', async (metric, entry) => {
      const current = (await entriesWithWorkSources()).filter((item) => item.status !== 'closed');
      metric('open', '当前未结事项', current.length);
      metric('due', '当前到期与逾期事项', current.filter((item) => item.followUpOn && item.followUpOn <= today).length);
      let hidden = 0;
      for (const item of current) {
        if ((await Promise.all(item.rawIds.map(permitRaw))).includes(false)) {
          hidden++;
          continue;
        }
        entry({
          ref: 'work:' + item.id,
          title: item.title,
          status: (item.followUpOn && item.followUpOn <= today ? '到期 · ' : '') + item.status + ' · ' + item.kind,
          date: item.followUpOn,
          target: { kind: 'work', id: item.id },
        });
      }
      if (hidden) metric('hidden', '来源受限或无法核实，已隐藏明细', hidden);
    }),
    section('news', '资讯抓取', 'period', async (metric) => {
      let count = 0,
        editions = 0;
      for (const date of dates) {
        const day = await deps.news.edition(date);
        if (!day) continue;
        const entries = [...Object.values(day.sections), day.legacyFmcg].flatMap((part) => [
          ...(part?.items ?? []),
          ...(part?.sourceItems ?? []),
        ]);
        entries.push(...(day.researchOverflow ?? []));
        const usable = entries.filter((item) => inPeriod(item.fetchedAt));
        count += new Set(usable.map((item) => item.id)).size;
        if (usable.length) editions++;
      }
      metric('fetched', '本周抓取可用资讯条目', count);
      metric('editions', '有抓取结果的资讯版次', editions);
    }),
    section('news-saves', '资讯确认入库', 'period', async (metric) => {
      metric(
        'confirmed',
        '本周确认保存资讯 Raw',
        await deps.news.rawSaves().confirmedBetween(period.from, period.until),
      );
    }),
    section('lint', '本周 Wiki 结构变化', 'period', async (metric) => {
      const week = (await validRuns()).filter(
        (item) => item.type === 'wiki.lint' && item.status === 'succeeded' && item.artifacts.lintSnapshotId,
      );
      const snapshots = [];
      for (const item of week) {
        const snapshot = await deps.lint.get(item.artifacts.lintSnapshotId!);
        if (!inPeriod(snapshot.checkedAt)) continue;
        snapshots.push(snapshot);
      }
      metric(
        'added',
        '本周结构问题新增',
        snapshots.reduce((sum, item) => sum + item.diff.addedCount, 0),
      );
      metric(
        'resolved',
        '本周结构问题消除',
        snapshots.reduce((sum, item) => sum + item.diff.resolvedCount, 0),
      );
      metric(
        'net',
        '本周结构问题净增减',
        snapshots.reduce((sum, item) => sum + item.diff.addedCount - item.diff.resolvedCount, 0),
      );
    }),
    section('lint-current', '最近一次 Wiki 结构巡检', 'current', async (metric, entry) => {
      const capturedAt = iso(now);
      for await (const run of deps.automation.successfulRuns('wiki.lint')) {
        if (!run.endedAt || run.endedAt > capturedAt || !run.artifacts.lintSnapshotId) continue;
        const latest = await deps.lint.get(run.artifacts.lintSnapshotId);
        metric('total', '最近一次结构巡检问题数', latest.total);
        entry({
          ref: 'lint:' + latest.runId,
          title: '最近结构巡检快照',
          date: reminderDate(Date.parse(latest.checkedAt)),
          target: { kind: 'lint', id: latest.runId },
        });
        break;
      }
    }),
    section('inspection', '知识库主动巡检', 'period', async (metric, entry) => {
      const records = new Set(
        (await validRuns())
          .filter((item) => item.type === 'wiki.inspect' && item.status === 'succeeded')
          .flatMap((item) => item.artifacts.inspectionIds ?? []),
      );
      let pending = 0;
      for (const id of records) {
        const record = await deps.inspections.get(id);
        if (!record || (record.status !== 'completed' && record.status !== 'partial')) throw Error('inspection source');
        pending += record.findings.filter((finding) => finding.status === 'pending').length;
        entry({
          ref: 'inspection:' + id,
          title: '主动检查记录',
          date: reminderDate(Date.parse(record.createdAt)),
          status: record.status,
          target: { kind: 'inspection', id },
        });
      }
      metric('pending', '本周巡检发现中当前待核数', pending);
    }),
    section('automation', '自动化运行与用量', 'period', async (metric, entry) => {
      const week = await validRuns();
      metric('runs', '本周运行总数', week.length);
      metric('failed', '本周失败运行', week.filter((item) => item.status === 'failed').length);
      const usage = [
        ['requests', '模型请求'],
        ['inputTokens', '输入 Token'],
        ['outputTokens', '输出 Token'],
        ['unknownUsageCount', '用量未知的请求'],
      ] as const;
      for (const [field, label] of usage)
        metric(
          field,
          label,
          week.reduce((sum, item) => sum + item.usage[field], 0),
        );
      for (const item of week)
        entry({
          ref: 'run:' + item.id,
          title: runLabels[item.type] ?? '自动化运行',
          date: reminderDate(Date.parse(item.startedAt ?? item.scheduledAt)),
          status: item.status,
          target: { kind: 'run', id: item.id },
        });
    }),
    ...(deps.reminders
      ? [
          section('reminders', '站内事项提醒', 'current', async (metric) => {
            const view = await deps.reminders!.read();
            if (view.issues.length) throw Error('reminder source');
            metric('active', '当前活动提醒', view.items.length);
            metric('unread', '当前未读提醒', view.unreadCount);
          }),
        ]
      : []),
  ]);
  const activity = new Set([
    'metric:knowledge:created',
    'metric:feedback:feedback',
    'metric:pending:open',
    'metric:work:created',
    'metric:work:closed',
    'metric:work-active:due',
    'metric:news:fetched',
    'metric:news-saves:confirmed',
    'metric:lint:added',
    'metric:lint:resolved',
    'metric:inspection:pending',
    'metric:automation:failed',
    'metric:reminders:active',
  ]);
  return {
    sections,
    hasActivity: sections.some(
      (value) =>
        value.status === 'error' || value.metrics.some((metric) => activity.has(metric.ref) && metric.count > 0),
    ),
  };
}
