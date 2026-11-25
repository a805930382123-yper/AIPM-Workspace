import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { MeetingSummary } from '../app/api.ts';

register('./support/css-stub-hooks.mjs', import.meta.url);

const { InboxTab } = await import('../app/components/automation/InboxTab.tsx');
const { WorkRemindersPanel } = await import('../app/components/automation/WorkRemindersPanel.tsx');
const { NewsInboxPanel } = await import('../app/components/automation/NewsInboxPanel.tsx');
const { MeetingPage } = await import('../app/pages/MeetingPage.tsx');
const { MeetingEditor } = await import('../app/pages/meeting/MeetingEditor.tsx');
const { PolicyDialog } = await import('../app/pages/meeting/PolicyDialog.tsx');
const { CatalogDialog } = await import('../app/pages/meeting/CatalogDialog.tsx');
const {
  MEETING_LEVELS,
  DEFAULT_MEETING_FILTERS,
  newMeetingRequestId,
  todayLocalDate,
  readMeetingFilters,
  saveMeetingFilters,
  formatMeetingError,
  compareMeetingByDate,
  filterAndSortMeetings,
  safeMeetingHref,
} = await import('../app/pages/meeting/meetingFilters.ts');

function makeMeeting(overrides: Partial<MeetingSummary>): MeetingSummary {
  return {
    schema_version: 1,
    meeting_id: 'm-default',
    revision: 1,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    title: '默认会议',
    meeting_date: '2026-11-01',
    meeting_time: null,
    meeting_type: 'type-sync',
    tags: [],
    customer: null,
    project: null,
    description: null,
    recording_url: null,
    minutes_url: null,
    confidentiality: 'Sensitive',
    storage_mode: 'cloud_index',
    local_storage_authorized: false,
    external_ai_authorized: false,
    raw_transfer_authorized: false,
    policy_updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

test('FE02 exports preserve expected runtime contract for split components and pure helpers', () => {
  assert.equal(typeof InboxTab, 'function');
  assert.equal(typeof WorkRemindersPanel, 'function');
  assert.equal(typeof NewsInboxPanel, 'function');
  assert.equal(typeof MeetingPage, 'function');
  assert.equal(typeof MeetingEditor, 'function');
  assert.equal(typeof PolicyDialog, 'function');
  assert.equal(typeof CatalogDialog, 'function');

  assert.deepEqual(MEETING_LEVELS, ['Public', 'Internal', 'Sensitive', 'Restricted']);
  assert.deepEqual(DEFAULT_MEETING_FILTERS, {
    q: '',
    type: '',
    tag: '',
    customer: '',
    project: '',
    level: '',
    order: 'desc',
  });
  assert.match(todayLocalDate(), /^\d{4}-\d{2}-\d{2}$/);
  const idA = newMeetingRequestId();
  const idB = newMeetingRequestId();
  assert.notEqual(idA, idB);
  assert.match(idA, /^[0-9a-f-]{36}$/i);
});

test('filterAndSortMeetings filters across 5 dimensions + query fields, sorts by date/id, and never mutates input', () => {
  const tagMap: Record<string, string> = {
    'tag-channel': '渠道验证',
    'tag-pricing': 'Pricing Strategy',
  };
  const resolveTag = (id: string) => tagMap[id] ?? '已停用目录项';

  const m1 = makeMeeting({
    meeting_id: 'm-001',
    title: '华东复盘',
    meeting_date: '2026-11-10',
    meeting_type: 'type-review',
    tags: ['tag-channel'],
    customer: 'Acme Retail',
    project: 'Q4 Launch',
    confidentiality: 'Internal',
  });
  const m2 = makeMeeting({
    meeting_id: 'm-002',
    title: '产品路线对齐',
    meeting_date: '2026-11-10',
    meeting_type: 'type-review',
    tags: ['tag-pricing'],
    customer: 'Beta Mart',
    project: 'Winter Pack',
    confidentiality: 'Internal',
  });
  const m3 = makeMeeting({
    meeting_id: 'm-003',
    title: '历史归档沟通',
    meeting_date: '2026-11-15',
    meeting_type: 'type-sync',
    tags: ['tag-retired'],
    customer: 'Acme Retail',
    project: 'Core SKU',
    confidentiality: 'Public',
  });

  const input = Object.freeze([m1, m2, m3]) as MeetingSummary[];
  const originalOrder = input.map((item) => item.meeting_id);

  // Default desc sorting with same-day meeting_id desc tie-break
  const sortedDesc = filterAndSortMeetings(input, DEFAULT_MEETING_FILTERS, resolveTag);
  assert.notEqual(sortedDesc, input);
  assert.deepEqual(
    sortedDesc.map((item) => item.meeting_id),
    ['m-003', 'm-002', 'm-001'],
  );

  // Asc sorting with same-day meeting_id asc tie-break
  const sortedAsc = filterAndSortMeetings(input, { ...DEFAULT_MEETING_FILTERS, order: 'asc' }, resolveTag);
  assert.deepEqual(
    sortedAsc.map((item) => item.meeting_id),
    ['m-001', 'm-002', 'm-003'],
  );
  assert.ok(compareMeetingByDate(m1, m2, 'asc') < 0);
  assert.ok(compareMeetingByDate(m1, m2, 'desc') > 0);

  // 5-dimension dropdown filter combination
  const combined = filterAndSortMeetings(
    input,
    {
      q: '',
      type: 'type-review',
      tag: 'tag-channel',
      customer: 'Acme Retail',
      project: 'Q4 Launch',
      level: 'Internal',
      order: 'desc',
    },
    resolveTag,
  );
  assert.deepEqual(
    combined.map((item) => item.meeting_id),
    ['m-001'],
  );

  // Query matches title, resolved tag name (including retired fallback), customer, and project
  assert.deepEqual(
    filterAndSortMeetings(input, { ...DEFAULT_MEETING_FILTERS, q: ' 路线对齐 ' }, resolveTag).map((x) => x.meeting_id),
    ['m-002'],
  );
  assert.deepEqual(
    filterAndSortMeetings(input, { ...DEFAULT_MEETING_FILTERS, q: 'pricing' }, resolveTag).map((x) => x.meeting_id),
    ['m-002'],
  );
  assert.deepEqual(
    filterAndSortMeetings(input, { ...DEFAULT_MEETING_FILTERS, q: '已停用目录项' }, resolveTag).map(
      (x) => x.meeting_id,
    ),
    ['m-003'],
  );
  assert.deepEqual(
    filterAndSortMeetings(input, { ...DEFAULT_MEETING_FILTERS, q: 'beta mart' }, resolveTag).map((x) => x.meeting_id),
    ['m-002'],
  );
  assert.deepEqual(
    filterAndSortMeetings(input, { ...DEFAULT_MEETING_FILTERS, q: 'core sku' }, resolveTag).map((x) => x.meeting_id),
    ['m-003'],
  );

  // Input array remains completely unmodified
  assert.deepEqual(
    input.map((item) => item.meeting_id),
    originalOrder,
  );
});

test('safeMeetingHref and formatMeetingError validate URLs and normalize error messages', () => {
  assert.equal(
    safeMeetingHref('https://example.feishu.cn/minutes/123?tab=1'),
    'https://example.feishu.cn/minutes/123?tab=1',
  );
  assert.equal(safeMeetingHref('http://example.com/a'), undefined);
  assert.equal(safeMeetingHref('javascript:alert(1)'), undefined);
  assert.equal(safeMeetingHref('https://user:pass@example.com/a'), undefined);
  assert.equal(safeMeetingHref('https://user@example.com/a'), undefined);
  assert.equal(safeMeetingHref('not-a-valid-url'), undefined);
  assert.equal(safeMeetingHref(''), undefined);

  assert.equal(formatMeetingError(new Error('网络中断')), '网络中断');
  assert.equal(formatMeetingError('unexpected string'), '操作失败，请重试。');
  assert.equal(formatMeetingError(null), '操作失败，请重试。');
});

test('readMeetingFilters and saveMeetingFilters preserve hash, history.state, and clean empty params', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/app?mq=%E5%8D%8E%E4%B8%9C&mt=t1&mg=g1&mc=c1&mp=p1&ml=Sensitive&mo=asc&keep=yes#sec',
  });
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    writable: true,
    configurable: true,
  });

  try {
    dom.window.history.replaceState({ appPage: 'meeting', custom: 7 }, '', dom.window.location.href);

    assert.deepEqual(readMeetingFilters(), {
      q: '华东',
      type: 't1',
      tag: 'g1',
      customer: 'c1',
      project: 'p1',
      level: 'Sensitive',
      order: 'asc',
    });

    const initialLength = dom.window.history.length;
    saveMeetingFilters(
      {
        q: '新品',
        type: '',
        tag: 'g2',
        customer: '',
        project: 'p2',
        level: 'Internal',
        order: 'desc',
      },
      'm-88',
      true,
    );

    assert.equal(dom.window.history.length, initialLength + 1);
    assert.equal(dom.window.location.hash, '#sec');
    assert.deepEqual(dom.window.history.state, { appPage: 'meeting', custom: 7 });
    const afterPush = new URLSearchParams(dom.window.location.search);
    assert.equal(afterPush.get('keep'), 'yes');
    assert.equal(afterPush.get('mq'), '新品');
    assert.equal(afterPush.has('mt'), false);
    assert.equal(afterPush.get('mg'), 'g2');
    assert.equal(afterPush.has('mc'), false);
    assert.equal(afterPush.get('mp'), 'p2');
    assert.equal(afterPush.get('ml'), 'Internal');
    assert.equal(afterPush.get('mo'), 'desc');
    assert.equal(afterPush.get('meeting'), 'm-88');

    saveMeetingFilters(DEFAULT_MEETING_FILTERS, null, false);
    assert.equal(dom.window.history.length, initialLength + 1);
    assert.equal(dom.window.location.hash, '#sec');
    assert.deepEqual(dom.window.history.state, { appPage: 'meeting', custom: 7 });
    assert.equal(dom.window.location.search, '?mo=desc&keep=yes');
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    dom.window.close();
  }
});

test('all 8 FE02 frontend modules stay strictly under 40 KiB and 800 lines with pure meetingFilters', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const fe02Files = [
    'app/components/automation/InboxTab.tsx',
    'app/components/automation/WorkRemindersPanel.tsx',
    'app/components/automation/NewsInboxPanel.tsx',
    'app/pages/MeetingPage.tsx',
    'app/pages/meeting/meetingFilters.ts',
    'app/pages/meeting/MeetingEditor.tsx',
    'app/pages/meeting/PolicyDialog.tsx',
    'app/pages/meeting/CatalogDialog.tsx',
  ];

  for (const relPath of fe02Files) {
    const absPath = path.join(repoRoot, relPath);
    const stat = fs.statSync(absPath);
    const content = fs.readFileSync(absPath, 'utf8');
    const lineCount = content.split(/\r?\n/).length;
    assert.ok(stat.size < 40_960, `${relPath} size ${stat.size} must be < 40960 bytes`);
    assert.ok(lineCount < 800, `${relPath} lineCount ${lineCount} must be < 800 lines`);
    if (relPath.endsWith('meetingFilters.ts')) {
      assert.equal(/from\s+['"]react['"]/.test(content), false, 'meetingFilters.ts must not import React');
    }
  }
});
