import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Meeting, Raw, RawProcessingState, Stats } from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  location: window.location,
  history: window.history,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  FormData: window.FormData,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../app/App.tsx');

const typeId = '11111111-1111-4111-8111-111111111111';
const meetingId = '22222222-2222-4222-8222-222222222222';
const targetRawId = '33333333-3333-4333-8333-333333333333';
const rawAId = '44444444-4444-4444-8444-444444444444';
const rawBId = '55555555-5555-4555-8555-555555555555';
const rawCId = '66666666-6666-4666-8666-666666666666';
const mkRaw = (id: string, title: string, body: string, importedAt: string): Raw => ({
  id,
  title,
  sourceType: 'article',
  sourceName: title,
  tags: [],
  body,
  importedAt,
  status: 'unprocessed',
  bodySha256: 'a'.repeat(64),
});
const rawA = mkRaw(rawAId, 'AC04 资料', 'AC04_BODY_MUST_NOT_BE_SHOWN', '2026-10-12T03:00:00.000Z');
const rawB = mkRaw(rawBId, '旧资料', 'OLDER_RAW_BODY', '2026-10-11T03:00:00.000Z');
const rawC = mkRaw(rawCId, '首条资料', 'FIRST_RAW_BODY', '2026-10-13T03:00:00.000Z');
const stats: Stats = {
  rawCount: 2,
  wikiCount: 0,
  thisWeekNewCount: 2,
  pendingConfirmationCount: 0,
  openAuditCount: 0,
  promptCount: 0,
  weekStartsOn: '2026-10-12',
};
const baseMeeting: Meeting = {
  schema_version: 1,
  meeting_id: meetingId,
  revision: 4,
  created_at: '2026-10-12T00:00:00.000Z',
  updated_at: '2026-10-12T00:00:00.000Z',
  title: '目标 Raw 缺失会议',
  meeting_date: '2026-10-12',
  meeting_time: null,
  meeting_type: typeId,
  tags: [],
  customer: null,
  project: null,
  description: null,
  recording_url: null,
  minutes_url: null,
  confidentiality: 'Public',
  storage_mode: 'local_archive',
  local_storage_authorized: true,
  external_ai_authorized: false,
  raw_transfer_authorized: true,
  policy_updated_at: '2026-10-12T00:00:00.000Z',
  imports: [],
  active_import_id: null,
  raw_links: [
    {
      request_id: '77777777-7777-4777-8777-777777777777',
      import_id: '88888888-8888-4888-8888-888888888888',
      raw_id: targetRawId,
      original_sha256: 'b'.repeat(64),
      created_at: '2026-10-12T00:00:00.000Z',
      registered_at: '2026-10-12T00:00:00.000Z',
      status: 'linked',
      request_fingerprint: 'fingerprint',
      raw_title: '已删除的目标 Raw',
      source_name: '会议原件',
      tags: [],
    },
  ],
  raw_source_id: targetRawId,
  capabilities: {
    canImportMinutes: false,
    canRegisterRaw: true,
    canUseAi: false,
    importReason: '',
    rawReason: '',
    aiReason: '',
  },
};
const catalog = { schema_version: 1, revision: 1, types: [{ id: typeId, name: '沟通', active: true }], tags: [] };
const statsReply = () => ({ ...stats, rawCount: rawList.length });
let rawList: Raw[] = [rawA, rawB];
let holdNextRaw = false;
let failNextRaw = false;
let pendingRawResponse: ((response: Response) => void) | null = null;
let processingItems: RawProcessingState[] = [];
let extractionJobReply: unknown = null;
const reply = (data: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }) as unknown as Response;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (text: string) =>
  [...window.document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(text)) as
    HTMLButtonElement | undefined;
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
  });
}
async function settle() {
  await act(async () => {
    await tick();
    await tick();
    await tick();
  });
}
function installApi() {
  (globalThis as { fetch?: unknown }).fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (url === '/api/raw') {
      if (failNextRaw) {
        failNextRaw = false;
        throw new Error('transport lost');
      }
      if (holdNextRaw) {
        holdNextRaw = false;
        return await new Promise<Response>((resolve) => {
          pendingRawResponse = resolve;
        });
      }
      return reply({ items: rawList });
    }
    const rawReference = url.match(/^\/api\/raw\/([^/]+)\/references$/);
    if (rawReference) return reply({ items: [] });
    const rawDelete = url.match(/^\/api\/raw\/([^/]+)$/);
    if (rawDelete && init.method === 'DELETE') {
      rawList = rawList.filter((item) => item.id !== decodeURIComponent(rawDelete[1]));
      return reply({
        id: decodeURIComponent(rawDelete[1]),
        title: '',
        assetId: null,
        assetRetained: false,
        warnings: [],
      });
    }
    if (url === '/api/stats') return reply(statsReply());
    if (url === '/api/raw-processing') return reply({ items: processingItems });
    if (url === '/api/extraction-jobs/job-1') {
      processingItems = [];
      return reply(extractionJobReply);
    }
    if (url === '/api/knowledge/workflows') return reply({ items: [] });
    if (url === '/api/meeting-catalog') return reply(catalog);
    if (url === '/api/meetings') {
      const {
        imports: _imports,
        active_import_id: _active,
        raw_links: _links,
        raw_source_id: _raw,
        capabilities: _caps,
        ...summary
      } = baseMeeting;
      return reply({ items: [summary] });
    }
    if (url === `/api/meetings/${meetingId}`) return reply(baseMeeting);
    throw new Error(`unexpected request ${url}`);
  };
}
async function mountApp() {
  history.replaceState({}, '', '/');
  const root = createRoot(window.document.getElementById('root')!);
  await act(async () => {
    root.render(<App />);
    await tick();
    await tick();
  });
  return root;
}
async function openMissingLinkedRaw() {
  await click(button('会议档案')!);
  await settle();
  await click(button('目标 Raw 缺失会议')!);
  await settle();
  await click(button('查看 Raw')!);
  await settle();
}

test('explicitly linked Raw missing from refreshed list stays selected and never displays another Raw', async () => {
  rawList = [rawA, rawB];
  holdNextRaw = false;
  installApi();
  const root = await mountApp();
  try {
    await openMissingLinkedRaw();
    assert.match(window.document.body.textContent ?? '', /所选 Raw 不存在或已删除/);
    assert.equal(window.document.querySelector('.raw-detail'), null);
    assert.equal((window.document.querySelector('.raw-detail-panel')?.textContent ?? '').includes(rawA.body), false);
    assert.equal((window.document.querySelector('.raw-detail-panel')?.textContent ?? '').includes(rawB.body), false);
  } finally {
    await act(async () => root.unmount());
  }
});

test('missing explicit target survives a transport failure and reconnect, then ordinary Raw navigation clears it', async () => {
  rawList = [rawA, rawB];
  holdNextRaw = false;
  failNextRaw = false;
  installApi();
  const root = await mountApp();
  try {
    await click(button('会议档案')!);
    await settle();
    await click(button('目标 Raw 缺失会议')!);
    await settle();
    failNextRaw = true;
    await click(button('查看 Raw')!);
    await settle();
    assert.match(window.document.querySelector('.global-error')?.textContent ?? '', /transport lost/);
    assert.equal(window.document.querySelector('.raw-detail'), null);
    await click(button('重新连接')!);
    await settle();
    assert.equal(window.document.querySelector('.global-error'), null);
    assert.match(window.document.querySelector('.raw-detail-panel')?.textContent ?? '', /所选 Raw 不存在或已删除/);
    assert.equal(window.document.querySelector('.raw-detail'), null);
    await click(button('Raw 原始资料')!);
    await settle();
    assert.match(window.document.querySelector('.raw-detail')?.textContent ?? '', /AC04_BODY_MUST_NOT_BE_SHOWN/);
  } finally {
    await act(async () => root.unmount());
  }
});

test('a user Raw selection made during a pending refresh wins over the stale preferred target', async () => {
  rawList = [rawA, rawB];
  holdNextRaw = false;
  installApi();
  const root = await mountApp();
  try {
    await click(button('会议档案')!);
    await settle();
    await click(button('目标 Raw 缺失会议')!);
    await settle();
    holdNextRaw = true;
    await click(button('查看 Raw')!);
    assert.ok(pendingRawResponse, 'navigation should start the deferred Raw list read');
    await click(button('旧资料')!);
    rawList = [rawC, rawA, rawB];
    await act(async () => {
      pendingRawResponse!(reply({ items: rawList }));
      await tick();
      await tick();
    });
    pendingRawResponse = null;
    assert.match(window.document.querySelector('.raw-detail')?.textContent ?? '', /OLDER_RAW_BODY/);
    assert.doesNotMatch(window.document.querySelector('.raw-detail')?.textContent ?? '', /FIRST_RAW_BODY|AC04_BODY/);
  } finally {
    await act(async () => root.unmount());
  }
});

test('Home recent Raw navigation preserves the clicked older Raw ID', async () => {
  rawList = [rawA, rawB];
  holdNextRaw = false;
  installApi();
  const root = await mountApp();
  try {
    await click(button('旧资料')!);
    await settle();
    assert.match(window.document.querySelector('.raw-detail')?.textContent ?? '', /OLDER_RAW_BODY/);
    assert.doesNotMatch(window.document.querySelector('.raw-detail')?.textContent ?? '', /AC04_BODY/);
  } finally {
    await act(async () => root.unmount());
  }
});

test('deleting the selected Raw returns to the first remaining real item', async () => {
  rawList = [rawA, rawB];
  holdNextRaw = false;
  failNextRaw = false;
  installApi();
  const root = await mountApp();
  try {
    await click(button('旧资料')!);
    await settle();
    await click(button('删除')!);
    await settle();
    await click(button('确认删除')!);
    await settle();
    assert.match(window.document.querySelector('.raw-detail')?.textContent ?? '', /AC04_BODY_MUST_NOT_BE_SHOWN/);
    assert.doesNotMatch(window.document.querySelector('.raw-detail')?.textContent ?? '', /OLDER_RAW_BODY/);
    assert.match(window.document.querySelector('.raw-list-panel')?.textContent ?? '', /1 条/);
  } finally {
    await act(async () => root.unmount());
  }
});

test('a settled background job refresh follows the current Raw selection, not the poll closure selection', async () => {
  rawList = [rawC, rawB, rawA];
  holdNextRaw = false;
  failNextRaw = false;
  processingItems = [{ rawId: rawCId, status: 'processing', updatedAt: '2026-10-13T00:00:00.000Z', jobId: 'job-1' }];
  extractionJobReply = {
    jobId: 'job-1',
    rawId: rawCId,
    status: 'failed',
    stage: 'extracting',
    progress: { chunksTotal: 1, chunksDone: 1, pagesFound: 0 },
    draftId: null,
    error: { code: 'provider_error', message: 'failed', retryable: false },
    provider: { name: 'localfake', model: 'fake' },
    callCount: 1,
    startedAt: '2026-10-13T00:00:00.000Z',
    finishedAt: '2026-10-13T00:00:01.000Z',
    cancelRequested: false,
  };
  installApi();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let poll: (() => Promise<void>) | null = null;
  globalThis.setInterval = ((callback: TimerHandler) => {
    if (typeof callback === 'function') poll = callback as () => Promise<void>;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => undefined) as typeof clearInterval;
  const root = await mountApp();
  try {
    await settle();
    assert.ok(poll, 'running job should install its background poll');
    await click(button('Raw 原始资料')!);
    await settle();
    await click(button('旧资料')!);
    assert.match(window.document.querySelector('.raw-detail')?.textContent ?? '', /OLDER_RAW_BODY/);
    await act(async () => {
      await poll!();
      await tick();
      await tick();
    });
    assert.match(window.document.querySelector('.raw-detail')?.textContent ?? '', /OLDER_RAW_BODY/);
    assert.doesNotMatch(window.document.querySelector('.raw-detail')?.textContent ?? '', /FIRST_RAW_BODY/);
  } finally {
    await act(async () => root.unmount());
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    processingItems = [];
    extractionJobReply = null;
  }
});
