import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  Node: window.Node,
  FormData: window.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MeetingMinutes } = await import('../app/MeetingMinutes.tsx');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const version = {
  import_id: 'v1',
  imported_at: '2026-11-07T00:00:00Z',
  imported_minutes: '原文',
  editable_minutes: '工作副本',
  original_filename: null,
  original_sha256: 'abc',
};
const meeting = {
  meeting_id: 'm1',
  revision: 1,
  imports: [version],
  active_import_id: 'v1',
  capabilities: { canImportMinutes: true },
} as unknown as import('../app/api').Meeting;
const button = (name: string) => [...document.querySelectorAll('button')].find((x) => x.textContent === name)!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
  });
}
async function input(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
  });
}

test('pending import and work edit stay separate; failed save retains text and successful save disables repeat', async () => {
  let calls = 0,
    resolveRequest: (value: Response) => void = () => {};
  globalThis.fetch = (async () => {
    calls++;
    return await new Promise((resolve) => {
      resolveRequest = resolve;
    });
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(<MeetingMinutes meeting={meeting} onRefresh={() => {}} />);
      await tick();
    });
    const paste = document.querySelector('[aria-label="粘贴会议纪要"]') as HTMLTextAreaElement;
    await input(paste, '待导入');
    await click(button('编辑工作副本'));
    assert.match(document.body.textContent!, /请先保存或清空/);
    assert.equal(paste.value, '待导入');
    await click(button('清空待导入内容'));
    await click(button('编辑工作副本'));
    assert.equal(paste.disabled, true);
    const draft = document.querySelector('[aria-label="编辑纪要工作副本"]') as HTMLTextAreaElement;
    await input(draft, '修改后');
    await click(button('保存会议档案'));
    assert.equal(draft.disabled, true);
    assert.equal(button('保存会议档案').disabled, true);
    assert.equal(calls, 1);
    await act(async () => {
      resolveRequest({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: '失败' } }),
      } as Response);
      await tick();
    });
    assert.equal(draft.value, '修改后');
    assert.match(document.body.textContent!, /工作副本仍保留/);
    await click(button('保存会议档案'));
    assert.equal(calls, 2);
    await act(async () => {
      resolveRequest({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ...meeting, revision: 2 }),
      } as Response);
      await tick();
    });
    assert.match(document.body.textContent!, /纪要已保存/);
    assert.equal(button('保存会议档案').disabled, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
