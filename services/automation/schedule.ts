import type { AutomationPlan } from './types.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SHANGHAI_OFFSET = 8 * 60 * MINUTE;

export function isAutomationPlan(value: unknown): value is AutomationPlan {
  if (!value || typeof value !== 'object') return false;
  if ('kind' in value && value.kind === 'interval') {
    return Object.keys(value).length === 2 && 'minutes' in value && Number.isSafeInteger(value.minutes)
      && (value.minutes as number) >= 1 && (value.minutes as number) <= 525_600;
  }
  return Object.keys(value).length === 3 && 'kind' in value && value.kind === 'daily'
    && 'time' in value && typeof value.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.time)
    && 'timezone' in value && value.timezone === 'Asia/Shanghai';
}

/** Shanghai currently has no daylight saving changes. Absolute cursors are stored in UTC. */
export function firstDueAfter(plan: AutomationPlan, now: number): number {
  if (plan.kind === 'interval') return now + plan.minutes * MINUTE;
  const [hours, minutes] = plan.time.split(':').map(Number);
  const localMidnight = Math.floor((now + SHANGHAI_OFFSET) / DAY) * DAY - SHANGHAI_OFFSET;
  const today = localMidnight + (hours! * 60 + minutes!) * MINUTE;
  return today > now ? today : today + DAY;
}

export function planWindow(plan: AutomationPlan, due: number, now: number): { latest: number; next: number } {
  const period = plan.kind === 'interval' ? plan.minutes * MINUTE : DAY;
  const latest = due + Math.floor((now - due) / period) * period;
  return { latest, next: latest + period };
}

export function samePlan(left: AutomationPlan, right: AutomationPlan): boolean {
  return left.kind === 'interval' && right.kind === 'interval' ? left.minutes === right.minutes
    : left.kind === 'daily' && right.kind === 'daily' && left.time === right.time;
}
