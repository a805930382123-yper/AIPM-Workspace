import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Meeting, MeetingRawLink } from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true,
});
const { window } = dom;
for (const [name, value] of Object.entries({
  window, document: window.document, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement,
  Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MeetingRawLinks } = await import('../app/MeetingRawLinks.tsx');

const meetingId = '22222222-2222-4222-8222-222222222222';
const importId = '33333333-3333-4333-8333-333333333333';
const failedImportId = '34333333-3333-4333-8333-333333333333';
const rawId = '44444444-4444-4444-8444-444444444444';
const failedRequestId = '55555555-5555-5555-8555-555555555555';
const importedMinutes = 'PRIVATE_MEETING_MINUTES_BODY_MUST_NOT_RENDER';
const version = { import_id: importId, imported_at: '2026-10-12T01:02:03.000Z', imported_minutes: importedMinutes, editable_minutes: importedMinutes, original_filename: null, original_sha256: 'a'.repeat(64) };
const failedVersion = { ...version, import_id: failedImportId, original_sha256: 'b'.repeat(64) };
const linked: MeetingRawLink = {
  request_id: '56565656-5656-5656-8565-565656565656', import_id: importId, raw_id: rawId,
  original_sha256: 'a'.repeat(64), created_at: '2026-10-12T02:00:00.000Z', status: 'linked',
  request_fingerprint: 'digest', raw_title: 'M04 Raw', source_name: 'M04', tags: [],
};
const failed: MeetingRawLink = {
  ...linked, request_id: failedRequestId, import_id: failedImportId, raw_id: '46444444-4444-4444-8444-444444444444',
  original_sha256: 'b'.repeat(64), status: 'failed', error: { code: 'RAW_REGISTRATION_FAILED', at: '2026-10-12T02:01:00.000Z' },
};
const meeting: Meeting = {
  schema_version: 1, meeting_id: meetingId, revision: 7, created_at: '2026-10-12T00:00:00.000Z',
  updated_at: '2026-10-12T02:00:00.000Z', title: 'M04会议', meeting_date: '2026-10-12', meeting_time: null,
  meeting_type: '11111111-1111-4111-8111-111111111111', tags: [], customer: null, project: null,
  description: null, recording_url: null, minutes_url: null, confidentiality: 'Public',
  storage_mode: 'local_archive', local_storage_authorized: true, external_ai_authorized: false,
  raw_transfer_authorized: true, policy_updated_at: '2026-10-12T00:00:00.000Z',
  imports: [version, failedVersion], active_import_id: importId,
  raw_links: [linked, failed], raw_source_id: rawId,
  capabilities: { canImportMinutes: true, canRegisterRaw: true, canUseAi: false, importReason: '', rawReason: '', aiReason: '' },
};
const reply = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }) as unknown as Response;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const button = (text: string) => [...window.document.querySelectorAll('button')].find(item => (item.textContent ?? '').includes(text)) as HTMLButtonElement | undefined;
async function click(target: HTMLElement) {
  await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(); });
}

test('Raw link UI retries failed request unchanged, confirms explicitly, and reloads conflict', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  (globalThis as { fetch?: unknown }).fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input); calls.push({ input: url, init });
    if (url === `/api/meetings/${meetingId}/raw-links` && init.method === 'POST') {
      if (calls.filter(item => item.input === url && item.init.method === 'POST').length === 1) {
        return reply({ error: { code: 'REVISION_CONFLICT', message: 'conflict' } }, 409);
      }
      return reply({ ...meeting, revision: 8 }, 200);
    }
    if (url === `/api/meetings/${meetingId}`) return reply({ ...meeting, revision: 8 });
    throw new Error(`unexpected ${init.method ?? 'GET'} ${url}`);
  };
  const root = createRoot(window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<MeetingRawLinks meeting={meeting} onRefresh={() => undefined} />); await tick(); });
    const rendered = window.document.body.textContent ?? '';
    assert.match(rendered, /已关联/);
    assert.match(rendered, /登记失败/);
    assert.match(rendered, new RegExp(rawId));
    assert.doesNotMatch(rendered, new RegExp(importedMinutes));

    await click(button('使用同一请求重试')!);
    await click(button('恢复')!);
    await tick(); await tick();
    const first = JSON.parse(String(calls.find(item => item.init.method === 'POST')?.init.body));
    assert.equal(first.requestId, failedRequestId);
    assert.equal(first.import_id, failedImportId);
    assert.equal(first.baseRevision, 7);
    assert.equal(first.confirm, true);
    assert.match(window.document.body.textContent ?? '', /conflict/);
    await click(button('重载最新版')!); await tick(); await tick();
    assert.equal(calls.some(item => item.input === `/api/meetings/${meetingId}` && (item.init.method ?? 'GET') === 'GET'), true);
    await click(button('恢复')!); await tick(); await tick();
    const posts = calls.filter(item => item.init.method === 'POST').map(item => JSON.parse(String(item.init.body)));
    assert.equal(posts.length, 2);
    assert.equal(posts[1].requestId, failedRequestId);
    assert.equal(posts[1].baseRevision, 8);
  } finally { await act(async () => root.unmount()); }
});

test('late Raw response from a previous meeting cannot refresh the current meeting after a component rerender', async () => {
  const otherMeetingId = '77777777-7777-4777-8777-777777777777';
  const selectableMeeting = { ...meeting, raw_links: [], raw_source_id: null };
  const otherMeeting = { ...selectableMeeting, meeting_id: otherMeetingId, revision: meeting.revision + 1 };
  let resolvePost: ((response: Response) => void) | undefined;
  (globalThis as { fetch?: unknown }).fetch = async (_input: unknown, init: RequestInit = {}) => {
    if (init.method === 'POST') return await new Promise<Response>(resolve => { resolvePost = resolve; });
    throw new Error('unexpected request');
  };
  const root = createRoot(window.document.getElementById('root')!);
  let refreshes = 0;
  try {
    await act(async () => { root.render(<MeetingRawLinks meeting={selectableMeeting} onRefresh={() => { refreshes++; }} />); await tick(); });
    const confirm = [...window.document.querySelectorAll('.meeting-check input')].find(item => (item.closest('label')?.textContent ?? '').includes('登记为本机 Raw')) as HTMLInputElement;
    await click(confirm);
    await click(button('登记 Raw')!);
    assert.ok(resolvePost, 'the first meeting request should be held');
    await act(async () => { root.render(<MeetingRawLinks meeting={otherMeeting} onRefresh={() => { refreshes++; }} />); await tick(); });
    await act(async () => { resolvePost!(reply({ ...selectableMeeting, revision: selectableMeeting.revision + 1, raw_id: rawId, reused: false })); await tick(); });
    assert.equal(refreshes, 0, 'old meeting response must not invoke the new page refresh callback');
    assert.match(window.document.body.textContent ?? '', /暂无Raw登记记录/);
  } finally { await act(async () => root.unmount()); }
});
