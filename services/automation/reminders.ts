import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validReviewDate } from '../home/review.ts';
import {
  clearStorageScanIssue,
  readJsonRecord,
  SerialQueue,
  StorageError,
  takeStorageScanIssues,
  writeJsonAtomic,
} from '../storage/files.ts';
import { isUuid } from '../storage/record-validators.ts';
import type { WorkItemKind } from '../work-items/types.ts';
import { sendDesktopNotice, type DesktopNotice, type DesktopNotifier } from './desktop-notify.ts';
import { isIsoDate, runIdPattern } from './ledger.ts';
import type { AutomationIssue } from './types.ts';

const kinds = ['due_follow_up', 'new_raw_ready', 'stale_item'] as const;
const statuses = ['unread', 'acknowledged', 'snoozed', 'resolved'] as const;
const deliveryStatuses = [
  'pending',
  'delivered',
  'suppressed_quiet_hours',
  'suppressed_disabled',
  'suppressed_non_windows',
  'failed',
] as const;
const issueReasons = ['read', 'parse', 'directory', 'shape'] as const;
const workItemKinds = ['customer_issue', 'product_analysis'] as const;
export type ReminderKind = (typeof kinds)[number];
export type WorkReminder = {
  id: string;
  dedupeKey: string;
  itemId: string;
  itemTitle: string;
  itemKind: WorkItemKind;
  kind: ReminderKind;
  summary: string;
  status: (typeof statuses)[number];
  snoozedUntil?: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
  desktopAttemptedAt?: string;
  desktopNotifiedAt?: string;
  deliveryStatus: (typeof deliveryStatuses)[number];
  deliveryError?: string;
};
export type ReminderSettings = {
  desktopNotificationsEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  staleDays: number;
  maxToastsPerRun: number;
};
export type ReminderView = {
  revision: number;
  settings: ReminderSettings;
  items: WorkReminder[];
  unreadCount: number;
  issues: AutomationIssue[];
};
type StoredReminders = Omit<ReminderView, 'unreadCount'>;
export type ReminderCandidate = Pick<
  WorkReminder,
  'dedupeKey' | 'itemId' | 'itemTitle' | 'itemKind' | 'kind' | 'summary'
> & { count?: number };
export type ReminderScan = {
  candidates: ReminderCandidate[];
  issues: AutomationIssue[];
  uncertain(itemId: string, kind: ReminderKind): boolean;
};

export const defaultReminderSettings: Readonly<ReminderSettings> = {
  desktopNotificationsEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  staleDays: 7,
  maxToastsPerRun: 3,
};
export const reminderSettingKeys = Object.keys(defaultReminderSettings) as (keyof ReminderSettings)[];
export const REMINDER_DAY = 24 * 60 * 60 * 1000;
const shanghaiOffset = 8 * 60 * 60 * 1000;
const shanghaiTime = (instant: number) => new Date(instant + shanghaiOffset).toISOString();
export const reminderDate = (instant: number) => shanghaiTime(instant).slice(0, 10);
export const isReminderTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
export const isStaleDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 90;
export const isToastLimit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;

export function isQuietHours(settings: ReminderSettings, instant: number) {
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  const time = shanghaiTime(instant).slice(11, 16);
  return start < end ? time >= start && time < end : start > end && (time >= start || time < end);
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === 'string' && runIdPattern.test(value);
const optionalIsoDate = (value: unknown) => value === undefined || isIsoDate(value);

function validReminder(value: unknown): value is WorkReminder {
  return (
    object(value) &&
    uuid(value.id) &&
    isUuid(value.itemId) &&
    typeof value.dedupeKey === 'string' &&
    typeof value.itemTitle === 'string' &&
    workItemKinds.some((kind) => value.itemKind === kind) &&
    kinds.some((kind) => value.kind === kind) &&
    typeof value.summary === 'string' &&
    statuses.some((status) => value.status === status) &&
    (value.status === 'snoozed' ? validReviewDate(value.snoozedUntil) : value.snoozedUntil === undefined) &&
    (value.status === 'resolved' ? isIsoDate(value.resolvedAt) : value.resolvedAt === undefined) &&
    isIsoDate(value.firstDetectedAt) &&
    isIsoDate(value.lastDetectedAt) &&
    optionalIsoDate(value.desktopAttemptedAt) &&
    optionalIsoDate(value.desktopNotifiedAt) &&
    deliveryStatuses.some((status) => value.deliveryStatus === status) &&
    (value.deliveryError === undefined || typeof value.deliveryError === 'string')
  );
}

function validStored(value: unknown): value is StoredReminders {
  return (
    object(value) &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    object(value.settings) &&
    typeof value.settings.desktopNotificationsEnabled === 'boolean' &&
    isReminderTime(value.settings.quietHoursStart) &&
    isReminderTime(value.settings.quietHoursEnd) &&
    isStaleDays(value.settings.staleDays) &&
    isToastLimit(value.settings.maxToastsPerRun) &&
    Array.isArray(value.items) &&
    value.items.every(validReminder) &&
    new Set(value.items.map((item) => item.dedupeKey)).size === value.items.length &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        object(issue) && typeof issue.file === 'string' && issueReasons.some((reason) => issue.reason === reason),
    )
  );
}

const empty = (): StoredReminders => ({ revision: 1, settings: { ...defaultReminderSettings }, items: [], issues: [] });
const priority = (item: WorkReminder) => kinds.indexOf(item.kind);
const sameKind = (item: WorkReminder) => item.itemId + ':' + item.kind;

export class RemindersStore {
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(
    private readonly root: string,
    private readonly notifier: DesktopNotifier,
    private readonly clock = Date.now,
    private readonly deliveryTimeoutMs = 5000,
  ) {
    this.file = path.join(root, 'state', 'automation', 'reminders.json');
  }

  private async stored() {
    const state = await readJsonRecord(this.root, this.file, validStored);
    clearStorageScanIssue(this.root, this.file);
    return state ?? empty();
  }

  private save(state: StoredReminders) {
    return writeJsonAtomic(this.file, state);
  }

  private view(state: StoredReminders, includeResolved = false): ReminderView {
    const items = state.items
      .filter((item) => includeResolved || item.status !== 'resolved')
      .sort(
        (a, b) =>
          priority(a) - priority(b) || b.lastDetectedAt.localeCompare(a.lastDetectedAt) || a.id.localeCompare(b.id),
      );
    return { ...state, items, unreadCount: state.items.filter((item) => item.status === 'unread').length };
  }

  async read(includeResolved = false): Promise<ReminderView> {
    const state = await this.stored().catch((error) => {
      if (!(error instanceof StorageError)) throw error;
      const issues = takeStorageScanIssues(this.root)
        .filter((issue) => issue.file === this.file)
        .map(({ reason }) => ({ file: 'state/automation/reminders.json', reason }));
      return { ...empty(), issues };
    });
    return this.view(state, includeResolved);
  }

  updateSettings(revision: number, patch: Partial<ReminderSettings>) {
    return this.queue.run(async () => {
      const state = await this.stored();
      if (revision !== state.revision)
        throw new StorageError('AUTOMATION_REMINDER_REVISION_CONFLICT', '提醒设置已更新，请刷新后重试。', 409, {
          currentRevision: state.revision,
        });
      state.settings = { ...state.settings, ...patch };
      state.revision++;
      await this.save(state);
      return this.view(state);
    });
  }

  mark(id: string, action: 'ack' | 'snooze', until?: string) {
    return this.queue.run(async () => {
      const now = this.clock();
      const snoozedUntil = action === 'snooze' ? (until ?? reminderDate(now + REMINDER_DAY)) : undefined;
      if (snoozedUntil !== undefined && (!validReviewDate(snoozedUntil) || snoozedUntil <= reminderDate(now))) {
        throw new StorageError('AUTOMATION_INVALID_INPUT', '请选择晚于今天的上海日期。', 400);
      }
      const state = await this.stored();
      const item = state.items.find((entry) => entry.id === id && entry.status !== 'resolved');
      if (!item) throw new StorageError('AUTOMATION_REMINDER_NOT_FOUND', '没有找到这条有效提醒。', 404);
      item.status = action === 'snooze' ? 'snoozed' : 'acknowledged';
      item.snoozedUntil = snoozedUntil;
      await this.save(state);
      return this.view(state);
    });
  }

  testNotification() {
    return sendDesktopNotice(this.notifier, { kind: 'test' }, undefined, this.deliveryTimeoutMs);
  }

  scan(discover: (settings: ReminderSettings, now: number) => Promise<ReminderScan>, signal: AbortSignal) {
    return this.queue.run(async () => {
      const state = await this.stored();
      const now = this.clock();
      const timestamp = new Date(now).toISOString();
      const today = reminderDate(now);
      const { candidates, issues, uncertain } = await discover(state.settings, now);
      signal.throwIfAborted();
      state.issues = issues;
      const detected = new Map(candidates.map((candidate) => [candidate.dedupeKey, candidate]));
      const existing = new Map(state.items.map((item) => [item.dedupeKey, item]));
      const counts = {
        active: candidates.length,
        new: 0,
        resolved: 0,
        delivered: 0,
        failed: 0,
        suppressed: 0,
        issues: issues.length,
      };
      for (const item of state.items) {
        if (item.deliveryStatus === 'pending' && item.desktopAttemptedAt) {
          item.deliveryStatus = 'failed';
          item.deliveryError = '上一次桌面通知投递中断，结果未确认。';
        }
        if (item.status === 'snoozed' && item.snoozedUntil! <= today) {
          item.status = 'unread';
          item.snoozedUntil = undefined;
        }
        if (item.status !== 'resolved' && !detected.has(item.dedupeKey) && !uncertain(item.itemId, item.kind)) {
          item.status = 'resolved';
          item.resolvedAt = timestamp;
          item.snoozedUntil = undefined;
          counts.resolved++;
        }
      }
      const attemptedToday = new Set(
        state.items.flatMap((item) =>
          item.desktopAttemptedAt && reminderDate(Date.parse(item.desktopAttemptedAt)) === today
            ? [sameKind(item)]
            : [],
        ),
      );
      const outgoing: Array<{ item: WorkReminder; count?: number }> = [];
      for (const { count, ...candidate } of candidates) {
        let item = existing.get(candidate.dedupeKey);
        if (!item) {
          item = {
            ...candidate,
            id: randomUUID(),
            firstDetectedAt: timestamp,
            lastDetectedAt: timestamp,
            status: 'unread',
            deliveryStatus: 'pending',
          };
          state.items.push(item);
          counts.new++;
        } else if (item.status === 'resolved') {
          item.status = 'unread';
          item.resolvedAt = undefined;
        }
        Object.assign(item, candidate, { lastDetectedAt: timestamp });
        const attempted =
          item.kind === 'new_raw_ready' ? item.desktopAttemptedAt !== undefined : attemptedToday.has(sameKind(item));
        if (item.status === 'unread' && !attempted) outgoing.push({ item, count });
      }
      state.items = state.items.filter(
        (item) => !item.resolvedAt || Date.parse(item.resolvedAt) >= now - 30 * REMINDER_DAY,
      );
      await this.save(state);

      outgoing.sort((a, b) => priority(a.item) - priority(b.item) || a.item.itemId.localeCompare(b.item.itemId));
      const limit = state.settings.maxToastsPerRun;
      const needsSummary = outgoing.length > limit;
      const individual = needsSummary ? outgoing.slice(0, limit - 1) : outgoing;
      const batches = individual.map(({ item, count }) => ({
        items: [item],
        notice: { kind: item.kind, itemTitle: item.itemTitle, count } as DesktopNotice,
      }));
      if (needsSummary) {
        const items = outgoing.slice(limit - 1).map(({ item }) => item);
        batches.push({ items, notice: { kind: 'summary', count: items.length } });
      }
      for (const { items, notice } of batches) {
        signal.throwIfAborted();
        const instant = this.clock();
        if (!state.settings.desktopNotificationsEnabled || isQuietHours(state.settings, instant)) {
          for (const item of items) {
            item.deliveryStatus = state.settings.desktopNotificationsEnabled
              ? 'suppressed_quiet_hours'
              : 'suppressed_disabled';
            item.deliveryError = undefined;
          }
          counts.suppressed += items.length;
          continue;
        }
        // Claim each recipient durably before handing anything off to the OS.
        for (const item of items) {
          item.deliveryStatus = 'pending';
          item.deliveryError = undefined;
          item.desktopAttemptedAt = new Date(instant).toISOString();
        }
        await this.save(state);
        const delivered = await sendDesktopNotice(this.notifier, notice, signal, this.deliveryTimeoutMs);
        for (const item of items) {
          item.deliveryStatus = delivered.deliveryStatus;
          item.deliveryError = delivered.deliveryError;
          if (delivered.deliveryStatus === 'delivered') item.desktopNotifiedAt = new Date(this.clock()).toISOString();
          if (delivered.deliveryStatus === 'suppressed_non_windows') item.desktopAttemptedAt = undefined;
        }
        if (delivered.deliveryStatus === 'delivered') counts.delivered++;
        else if (delivered.deliveryStatus === 'failed') counts.failed++;
        else counts.suppressed += items.length;
        await this.save(state);
      }
      if (counts.suppressed) await this.save(state);
      return counts;
    });
  }
}
