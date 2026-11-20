import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertRawNotMeeting, SourcePolicyError } from '../../meeting/source-policy.ts';
import type { RawStore } from '../../raw/store.ts';
import type { StorageScanIssue } from '../../storage/files.ts';
import type { WorkAnalysisRuns } from '../../work-items/analysis-runs.ts';
import type { WorkItemStore } from '../../work-items/store.ts';
import { REMINDER_DAY, reminderDate, type ReminderCandidate, type ReminderKind, type ReminderScan, type ReminderSettings, type RemindersStore } from '../reminders.ts';
import type { TaskDefinition } from '../scheduler.ts';
import type { AutomationIssue } from '../types.ts';

export const workRemindersType = 'work.reminders';

type ReminderDeps = {
  root: string;
  items: Pick<WorkItemStore, 'scanForReminders'>;
  analysis: Pick<WorkAnalysisRuns, 'reminderBasis'>;
  raws: Pick<RawStore, 'get'>;
};

export async function scanWorkReminders(deps: ReminderDeps, settings: ReminderSettings, now: number, signal: AbortSignal): Promise<ReminderScan> {
  const { root, items, analysis, raws } = deps;
  const scan = await items.scanForReminders();
  const issues = new Map<string, AutomationIssue>();
  const report = ({ file, reason }: StorageScanIssue) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    issues.set(relative, { file: relative, reason });
  };
  scan.issues.forEach(report);
  const foundItems = new Set(scan.items.map(item => item.id));
  const unreadableItems = new Set(scan.issues.map(issue => path.basename(issue.file, '.json')));
  const wholeScanIncomplete = scan.partial || scan.issues.some(issue => issue.file === path.join(root, 'work-items'));
  const uncertainAnalysis = new Set<string>();
  const candidates: ReminderCandidate[] = [];
  const readableRaws = new Map<string, 'allowed' | 'excluded' | 'unknown'>();
  const today = reminderDate(now);
  for (const item of scan.items) {
    signal.throwIfAborted();
    if (item.status === 'closed') continue;
    const add = (kind: ReminderKind, conditionKey: string, summary: string, count?: number) => {
      candidates.push({ itemId: item.id, itemTitle: item.title, itemKind: item.kind, kind,
        dedupeKey: JSON.stringify([item.id, kind, conditionKey]), summary, count });
    };
    const daysSinceUpdate = (Date.parse(today) - Date.parse(reminderDate(Date.parse(item.updatedAt)))) / REMINDER_DAY;
    if (item.followUpOn && item.followUpOn <= today) {
      const late = (Date.parse(today) - Date.parse(item.followUpOn)) / REMINDER_DAY;
      add('due_follow_up', item.followUpOn, late ? '跟进已逾期 ' + late + ' 天' : '今日到期跟进', late);
    } else if (settings.staleDays > 0 && daysSinceUpdate > settings.staleDays && ['in_progress', 'waiting', 'retest'].includes(item.status)) {
      add('stale_item', item.updatedAt, '已 ' + daysSinceUpdate + ' 天未推进');
    }

    if (item.kind !== 'product_analysis' || !item.rawIds.length) continue;
    const { issues: basisIssues, coveredRawIds } = await analysis.reminderBasis(item.id);
    if (basisIssues.length) {
      basisIssues.forEach(report);
      uncertainAnalysis.add(item.id);
      continue;
    }
    const used = new Set(coveredRawIds);
    const eligible: string[] = [];
    for (const id of new Set(item.rawIds)) {
      signal.throwIfAborted();
      if (used.has(id)) continue;
      if (!readableRaws.has(id)) {
        try {
          const raw = await raws.get(id);
          if (raw) assertRawNotMeeting(raw);
          readableRaws.set(id, raw ? 'allowed' : 'excluded');
        } catch (error) {
          const restricted = error instanceof SourcePolicyError;
          if (!restricted) report({ file: path.join(root, 'knowledge', 'raw', id + '.md'), reason: 'read' });
          readableRaws.set(id, restricted ? 'excluded' : 'unknown');
        }
      }
      const allowed = readableRaws.get(id);
      if (allowed === 'unknown') uncertainAnalysis.add(item.id);
      if (allowed === 'allowed') eligible.push(id);
    }
    if (eligible.length && !uncertainAnalysis.has(item.id)) {
      const setHash = createHash('sha256').update(JSON.stringify(eligible.sort())).digest('hex');
      add('new_raw_ready', setHash, '有 ' + eligible.length + ' 条新资料待分析', eligible.length);
    }
  }
  return {
    candidates, issues: [...issues.values()].sort((a, b) => a.file.localeCompare(b.file)),
    uncertain: (itemId, kind) => (!foundItems.has(itemId) && (wholeScanIncomplete || unreadableItems.has(itemId)))
      || (kind === 'new_raw_ready' && uncertainAnalysis.has(itemId)),
  };
}

export function createWorkReminders(deps: ReminderDeps, store: RemindersStore): TaskDefinition {
  return {
    type: workRemindersType, name: '工作事项到期与新资料提醒',
    defaultPlan: { kind: 'interval', minutes: 60 }, allowsCatchUp: false, mayCallModel: false,
    async execute({ step, signal }) {
      await step('扫描工作事项与投递提醒', async () => {
        const result = await store.scan((settings, now) => scanWorkReminders(deps, settings, now, signal), signal);
        return '识别 ' + result.active + ' 条提醒，新增 ' + result.new + ' 条，消解 ' + result.resolved
          + ' 条。桌面通知已投递 ' + result.delivered + ' 次、失败 ' + result.failed + ' 次，静默或无法投递 ' + result.suppressed
          + ' 条。读取问题 ' + result.issues + ' 项。';
      });
    },
  };
}
