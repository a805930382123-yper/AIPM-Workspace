import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Meeting, MeetingRawLink } from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MeetingRawLinks } = await import('../app/MeetingRawLinks.tsx');

const meetingId = '22222222-2222-4222-8222-222222222222';
const importId = '33333333-3333-4333-8333-333333333333';
const rawId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const minute = {
  import_id: importId,
  imported_at: '2026-10-12T01:02:03.000Z',
  imported_minutes: 'PRIVATE_BODY',
  editable_minutes: 'PRIVATE_BODY',
  original_filename: null,
  original_sha256: 'a'.repeat(64),
};
const linked: MeetingRawLink = {
  request_id: requestId,
  import_id: importId,
  raw_id: rawId,
  original_sha256: 'a'.repeat(64),
  created_at: '2026-10-12T02:00:00.000Z',
  status: 'linked',
  request_fingerprint: 'digest',
  raw_title: '会议原始纪要',
  source_name: '会议',
  tags: [],
};
const meeting: Meeting = {
  schema_version: 1,
  meeting_id: meetingId,
  revision: 7,
  created_at: '2026-10-12T00:00:00.000Z',
  updated_at: '2026-10-12T02:00:00.000Z',
  title: 'M05会议',
  meeting_date: '2026-10-12',
  meeting_time: null,
  meeting_type: '11111111-1111-4111-8111-111111111111',
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
  imports: [minute],
  active_import_id: importId,
  raw_links: [],
  raw_source_id: null,
  capabilities: {
    canImportMinutes: true,
    canRegisterRaw: true,
    canUseAi: false,
    importReason: '',
    rawReason: '',
    aiReason: '',
  },
};
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

test('successful Meeting Raw registration refreshes the shared Raw cache and linked Raw can be opened by ID', async () => {
  let refreshCount = 0;
  const opened: string[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (_input: unknown, init: RequestInit = {}) => {
    assert.equal(init.method, 'POST');
    return reply({ ...meeting, revision: 8, raw_links: [linked], raw_source_id: rawId, raw_id: rawId, reused: false });
  };
  const root = createRoot(window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <MeetingRawLinks
          meeting={meeting}
          onRefresh={() => undefined}
          onRawChanged={async () => {
            refreshCount++;
          }}
          onOpenRaw={(id) => opened.push(id)}
        />,
      );
      await tick();
    });
    const confirm = [...window.document.querySelectorAll('.meeting-check input')].find((item) =>
      (item.closest('label')?.textContent ?? '').includes('登记为本机 Raw'),
    ) as HTMLInputElement;
    await act(async () => {
      confirm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await tick();
    });
    await click(button('登记 Raw')!);
    await act(async () => {
      await tick();
      await tick();
    });
    assert.equal(refreshCount, 1, 'only a successful registration should request the shared Raw and stats refresh');
    const rawMeeting = { ...meeting, revision: 8, raw_links: [linked], raw_source_id: rawId };
    await act(async () => {
      root.render(
        <MeetingRawLinks
          meeting={rawMeeting}
          onRefresh={() => undefined}
          onRawChanged={async () => {
            refreshCount++;
          }}
          onOpenRaw={(id) => opened.push(id)}
        />,
      );
      await tick();
    });
    assert.equal(button('查看 Raw') !== undefined, true, 'active links expose a real Raw navigation action');
    await click(button('查看 Raw')!);
    assert.deepEqual(opened, [rawId]);
  } finally {
    await act(async () => root.unmount());
  }
});

test('failed Meeting Raw registration does not refresh the shared Raw cache', async () => {
  let refreshCount = 0;
  (globalThis as { fetch?: unknown }).fetch = async () =>
    reply({ error: { code: 'STORAGE_ERROR', message: 'write failed' } }, 500);
  const root = createRoot(window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <MeetingRawLinks
          meeting={meeting}
          onRefresh={() => undefined}
          onRawChanged={async () => {
            refreshCount++;
          }}
        />,
      );
      await tick();
    });
    const confirm = [...window.document.querySelectorAll('.meeting-check input')].find((item) =>
      (item.closest('label')?.textContent ?? '').includes('登记为本机 Raw'),
    ) as HTMLInputElement;
    await act(async () => {
      confirm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await tick();
    });
    await click(button('登记 Raw')!);
    await act(async () => {
      await tick();
      await tick();
    });
    assert.equal(refreshCount, 0);
    assert.match(window.document.body.textContent ?? '', /write failed/);
  } finally {
    await act(async () => root.unmount());
  }
});
