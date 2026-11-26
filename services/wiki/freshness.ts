import reviewCycles from '../../config/review-cycles.json' with { type: 'json' };

export type WikiFreshnessFields = {
  last_verified_at?: string;
  source_published_at?: string;
  review_cycle_days?: number | null;
  review_trigger_checkpoint?: number;
};

export type FreshnessStatus = 'unverified' | 'evergreen' | 'fresh' | 'due_soon' | 'due';
export const reviewTriggerKinds = ['new_source', 'source_changed', 'inference'] as const;
export type ReviewTriggerKind = (typeof reviewTriggerKinds)[number];
export type ReviewEvent =
  | { kind: 'snooze'; date: string }
  | { kind: 'source_changed' | 'new_source'; date: string; rawId: string; bodyRevision: number; reason: string };
export type ReviewPageState = {
  triggers?: Partial<Record<ReviewTriggerKind, readonly string[]>>;
  snoozedOn?: readonly string[];
  events?: readonly ReviewEvent[];
};

export type ReviewPage = WikiFreshnessFields & { pageId: string; title: string; type: string; category: string };
export type ReviewRules = {
  byType: Readonly<Record<string, number | null>>;
  byCategory: Readonly<Record<string, number | null>>;
  fallback: number | null;
};

const DAY_MS = 86_400_000;
const LAST_DAY = Date.parse('9999-12-31T00:00:00Z') / DAY_MS;
const SOON_DAYS = 30;
export const SNOOZE_DAYS = 30;

export function wikiFreshnessEnabled() {
  return process.env.WIKI_FRESHNESS_ENABLED !== '0';
}

const reviewDateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });

export function wikiReviewDate(time: Date = new Date()) {
  return reviewDateFormatter.format(time);
}

export function civilDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value) return value;
}

function civilDay(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

export function readReviewCycleDays(value: unknown): number | null | undefined {
  if (value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return value;
}

export function effectiveReviewCycle(page: ReviewPage, rules: ReviewRules = reviewCycles): number | null {
  const override = readReviewCycleDays(page.review_cycle_days);
  if (override !== undefined) return override === 0 ? null : override;
  if (page.type === 'concept' && Object.hasOwn(rules.byType, page.type)) return rules.byType[page.type];
  if (Object.hasOwn(rules.byCategory, page.category)) return rules.byCategory[page.category];
  if (Object.hasOwn(rules.byType, page.type)) return rules.byType[page.type];
  return rules.fallback;
}

const freshnessPoints: Record<FreshnessStatus, number> = {
  due: 70,
  unverified: 60,
  due_soon: 30,
  fresh: 0,
  evergreen: 0,
};
const triggerPoints: Record<ReviewTriggerKind, number> = { new_source: 50, source_changed: 50, inference: 20 };

function latestApplicableDate(dates: readonly string[] | undefined, asOf: string) {
  let latest: string | undefined;
  for (const date of dates ?? []) if (date <= asOf && (!latest || date > latest)) latest = date;
  return latest;
}

export function pendingReviewEvents(
  page: WikiFreshnessFields,
  asOf: string,
  state?: ReviewPageState,
  allowedRawIds?: ReadonlySet<string>,
) {
  const verified = civilDate(page.last_verified_at);
  const lastVerifiedAt = verified && verified <= asOf ? verified : undefined;
  const checkpoint = lastVerifiedAt ? page.review_trigger_checkpoint : undefined;
  return (state?.events ?? []).filter(
    (event, index) =>
      event.date <= asOf &&
      (!lastVerifiedAt ||
        event.date > lastVerifiedAt ||
        (event.date === lastVerifiedAt && index >= (checkpoint ?? 0))) &&
      (event.kind === 'snooze' || !allowedRawIds || allowedRawIds.has(event.rawId)),
  );
}

export function evaluateFreshness(
  page: ReviewPage,
  asOf: string,
  state?: ReviewPageState,
  rules?: ReviewRules,
  allowedRawIds?: ReadonlySet<string>,
) {
  if (!civilDate(asOf)) throw new RangeError('Review date must be YYYY-MM-DD');
  const asOfDay = civilDay(asOf);
  const verified = civilDate(page.last_verified_at);
  const lastVerifiedAt = verified && verified <= asOf ? verified : null;
  const cycleDays = effectiveReviewCycle(page, rules);
  let status: FreshnessStatus = 'unverified';
  let dueOn: string | null = null;
  if (lastVerifiedAt && cycleDays === null) status = 'evergreen';
  if (lastVerifiedAt && cycleDays !== null) {
    const verifiedDay = civilDay(lastVerifiedAt);
    const daysRemaining = cycleDays - (asOfDay - verifiedDay);
    if (cycleDays <= LAST_DAY - verifiedDay)
      dueOn = new Date((verifiedDay + cycleDays) * DAY_MS).toISOString().slice(0, 10);
    status = daysRemaining <= 0 ? 'due' : daysRemaining <= SOON_DAYS ? 'due_soon' : 'fresh';
  }
  const checkpoint = lastVerifiedAt ? page.review_trigger_checkpoint : undefined;
  const pending = pendingReviewEvents(page, asOf, state, allowedRawIds);
  const activeTriggers = reviewTriggerKinds.filter((kind) => {
    const date = latestApplicableDate(state?.triggers?.[kind], asOf);
    return (
      pending.some((event) => event.kind === kind) ||
      (date && (!lastVerifiedAt || (checkpoint === undefined ? date >= lastVerifiedAt : date > lastVerifiedAt)))
    );
  });
  const legacySnooze = latestApplicableDate(state?.snoozedOn, asOf);
  const snoozedOn = latestApplicableDate(
    [
      ...pending.filter((event) => event.kind === 'snooze').map((event) => event.date),
      ...(legacySnooze && (!lastVerifiedAt || checkpoint === undefined || legacySnooze > lastVerifiedAt)
        ? [legacySnooze]
        : []),
    ],
    asOf,
  );
  const elapsedSnoozeDays = snoozedOn ? asOfDay - civilDay(snoozedOn) : -1;
  return {
    status,
    cycleDays,
    dueOn,
    lastVerifiedAt,
    sourcePublishedAt: civilDate(page.source_published_at) ?? null,
    activeTriggers,
    snoozed: elapsedSnoozeDays >= 0 && elapsedSnoozeDays < SNOOZE_DAYS,
    priority: freshnessPoints[status] + activeTriggers.reduce((points, kind) => points + triggerPoints[kind], 0),
  };
}

export type WikiFreshness = ReturnType<typeof evaluateFreshness>;

export function rankReviewQueue(
  pages: readonly ReviewPage[],
  asOf: string,
  state: Readonly<Record<string, ReviewPageState>>,
  limit = 5,
  allowedRawIds?: ReadonlySet<string>,
  view: 'pending' | 'snoozed' = 'pending',
) {
  if (!civilDate(asOf)) throw new RangeError('Review date must be YYYY-MM-DD');
  return pages
    .map((page) => ({
      pageId: page.pageId,
      title: page.title,
      type: page.type,
      category: page.category,
      ...evaluateFreshness(page, asOf, state[page.pageId], undefined, allowedRawIds),
    }))
    .filter((row) => (view === 'pending' ? row.priority > 0 && !row.snoozed : row.snoozed))
    .sort((a, b) => {
      const aDue = a.dueOn ?? '\uffff';
      const bDue = b.dueOn ?? '\uffff';
      return (
        b.priority - a.priority ||
        (aDue < bDue ? -1 : aDue > bDue ? 1 : 0) ||
        (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0)
      );
    })
    .slice(0, limit);
}
