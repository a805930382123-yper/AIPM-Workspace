import type { MeetingConfidentiality, MeetingSummary } from '../../api';
import { readQueryParams, updateRouteQuery } from '../../router/routes';

export const MEETING_LEVELS: MeetingConfidentiality[] = ['Public', 'Internal', 'Sensitive', 'Restricted'];

export type MeetingFilters = {
  q: string;
  type: string;
  tag: string;
  customer: string;
  project: string;
  level: string;
  order: 'desc' | 'asc';
};

export const DEFAULT_MEETING_FILTERS: MeetingFilters = {
  q: '',
  type: '',
  tag: '',
  customer: '',
  project: '',
  level: '',
  order: 'desc',
};

export const newMeetingRequestId = () => crypto.randomUUID();

export function todayLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function readMeetingFilters(): MeetingFilters {
  const q = readQueryParams();
  return {
    q: q.get('mq') || '',
    type: q.get('mt') || '',
    tag: q.get('mg') || '',
    customer: q.get('mc') || '',
    project: q.get('mp') || '',
    level: q.get('ml') || '',
    order: q.get('mo') === 'asc' ? 'asc' : 'desc',
  };
}

export function saveMeetingFilters(f: MeetingFilters, meetingId?: string | null, push = false): void {
  updateRouteQuery(
    (p) => {
      for (const [key, value] of Object.entries({
        mq: f.q,
        mt: f.type,
        mg: f.tag,
        mc: f.customer,
        mp: f.project,
        ml: f.level,
        mo: f.order,
        meeting: meetingId || '',
      })) {
        if (value) {
          p.set(key, value);
        } else {
          p.delete(key);
        }
      }
    },
    { push },
  );
}

export function formatMeetingError(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败，请重试。';
}

export function compareMeetingByDate(a: MeetingSummary, b: MeetingSummary, order: 'desc' | 'asc'): number {
  return order === 'asc'
    ? a.meeting_date.localeCompare(b.meeting_date) || a.meeting_id.localeCompare(b.meeting_id)
    : b.meeting_date.localeCompare(a.meeting_date) || b.meeting_id.localeCompare(a.meeting_id);
}

export function filterAndSortMeetings(
  items: MeetingSummary[],
  filters: MeetingFilters,
  resolveTagName: (tagId: string) => string,
): MeetingSummary[] {
  const q = filters.q.trim().toLocaleLowerCase();
  return items
    .filter((m) => {
      const tags = m.tags.map((t) => resolveTagName(t) ?? '已停用目录项');
      return (
        (!q || [m.title, ...tags, m.customer || '', m.project || ''].some((x) => x.toLocaleLowerCase().includes(q))) &&
        (!filters.type || m.meeting_type === filters.type) &&
        (!filters.tag || m.tags.includes(filters.tag)) &&
        (!filters.customer || m.customer === filters.customer) &&
        (!filters.project || m.project === filters.project) &&
        (!filters.level || m.confidentiality === filters.level)
      );
    })
    .sort((a, b) => compareMeetingByDate(a, b, filters.order));
}

export function safeMeetingHref(value: string): string | undefined {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? value : undefined;
  } catch {
    return undefined;
  }
}
