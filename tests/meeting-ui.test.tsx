import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

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
const { MeetingPage } = await import('../app/pages/MeetingPage.tsx');
const typeId = '11111111-1111-4111-8111-111111111111';
const meetingId = '22222222-2222-4222-8222-222222222222';
const catalog = { schema_version: 1, revision: 1, types: [{ id: typeId, name: '需求对接', active: true }], tags: [] };
const base = {
  schema_version: 1,
  meeting_id: meetingId,
  revision: 1,
  created_at: '2026-10-11T00:00:00Z',
  updated_at: '2026-10-11T00:00:00Z',
  title: '新品沟通',
  meeting_date: '2026-10-10',
  meeting_time: null,
  meeting_type: typeId,
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
  policy_updated_at: '2026-10-11T00:00:00Z',
};
const detailFields = {
  imports: [],
  active_import_id: null,
  raw_links: [],
  raw_source_id: null,
  capabilities: {
    canImportMinutes: false,
    canRegisterRaw: false,
    canUseAi: false,
    importReason: '当前策略不允许保存本地纪要。',
    rawReason: '本批不开放会议 Raw 登记。',
    aiReason: '本版不支持 Meeting 外部 AI 处理。',
  },
};
const summary = (record: Record<string, unknown>) => {
  const {
    imports: _imports,
    active_import_id: _active,
    raw_links: _links,
    raw_source_id: _raw,
    creation: _creation,
    capabilities: _capabilities,
    reused: _reused,
    ...item
  } = record;
  return item;
};
const reply = (data: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }) as unknown as Response;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (text: string) =>
  [...window.document.querySelectorAll('button')].find((x) => x.textContent?.includes(text)) as
    HTMLButtonElement | undefined;
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
  });
}
async function setValue(target: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(target, value);
    target.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
  });
}
async function submit() {
  const form = window.document.querySelector('form');
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
  });
}

test('Meeting UI retries create with the same requestId after a lost response', async () => {
  const posted: Array<Record<string, unknown>> = [];
  let record: Record<string, unknown> | null = null;
  let lose = true;
  (globalThis as { fetch?: unknown }).fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input),
      method = (init.method || 'GET').toUpperCase();
    if (url === '/api/meeting-catalog') return reply(catalog);
    if (url === '/api/meetings' && method === 'GET') return reply({ items: record ? [summary(record)] : [] });
    if (url === '/api/meetings' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push(body);
      if (lose) {
        lose = false;
        record = {
          ...base,
          ...body,
          ...detailFields,
          meeting_id: meetingId,
          revision: 1,
          created_at: base.created_at,
          updated_at: base.updated_at,
          policy_updated_at: base.policy_updated_at,
        };
        throw new Error('connection lost after commit');
      }
      return reply({ ...record, reused: true }, 200);
    }
    if (url === `/api/meetings/${meetingId}`) return reply(record);
    throw new Error(`unexpected ${method} ${url}`);
  };
  const root = createRoot(window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(<MeetingPage />);
      await tick();
      await tick();
    });
    await click(button('新建会议')!);
    const title = window.document.querySelector('input[maxlength="200"]') as HTMLInputElement;
    await setValue(title, '新品沟通');
    await submit();
    assert.match(window.document.querySelector('[role="alert"]')?.textContent || '', /connection lost after commit/);
    await submit();
    assert.equal(posted.length, 2);
    assert.equal(posted[0].requestId, posted[1].requestId);
    assert.equal(posted[1].title, '新品沟通');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
