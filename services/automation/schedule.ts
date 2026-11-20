import type { AutomationPlan } from './types.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = 7 * DAY;
const SHANGHAI_OFFSET = 8 * 60 * MINUTE;

export function isAutomationPlan(value: unknown): value is AutomationPlan {
  if (!value || typeof value !== 'object') return false;
  if ('kind' in value && value.kind === 'interval') {
    return Object.keys(value).length === 2 && 'minutes' in value && Number.isSafeInteger(value.minutes)
      && (value.minutes as number) >= 1 && (value.minutes as number) <= 525_600;
  }
  if (!('time' in value) || typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.time)
    || !('timezone' in value) || value.timezone !== 'Asia/Shanghai' || !('kind' in value)) return false;
  if (value.kind === 'daily') return Object.keys(value).length === 3;
  return value.kind === 'weekly' && Object.keys(value).length === 4 && 'weekday' in value
    && typeof value.weekday === 'number' && Number.isInteger(value.weekday) && value.weekday >= 1 && value.weekday <= 7;
}

/** Shanghai currently has no daylight saving changes. Absolute cursors are stored in UTC. */
export function firstDueAfter(plan: AutomationPlan, now: number): number {
  if (plan.kind === 'interval') return now + plan.minutes * MINUTE;
  const [hours, minutes] = plan.time.split(':').map(Number);
  const localMidnight = Math.floor((now + SHANGHAI_OFFSET) / DAY) * DAY;
  const today = localMidnight - SHANGHAI_OFFSET + (hours! * 60 + minutes!) * MINUTE;
  if (plan.kind === 'daily') return today > now ? today : today + DAY;
  const weekday = new Date(localMidnight).getUTCDay() || 7;
  const due = today + ((plan.weekday - weekday + 7) % 7) * DAY;
  return due > now ? due : due + WEEK;
}

export function planWindow(plan: AutomationPlan, due: number, now: number): { latest: number; next: number } {
  const period = plan.kind === 'interval' ? plan.minutes * MINUTE : plan.kind === 'weekly' ? WEEK : DAY;
  const latest = due + Math.floor((now - due) / period) * period;
  return { latest, next: latest + period };
}

export function samePlan(left: AutomationPlan, right: AutomationPlan): boolean {
  if (left.kind === 'interval') return right.kind === 'interval' && left.minutes === right.minutes;
  if (left.kind === 'daily') return right.kind === 'daily' && left.time === right.time;
  return right.kind === 'weekly' && left.weekday === right.weekday && left.time === right.time;
}
