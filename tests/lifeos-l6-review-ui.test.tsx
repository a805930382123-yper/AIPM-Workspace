import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
for (const [name, value] of Object.entries({
  window: w,
  document: w.document,
  navigator: w.navigator,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  Event: w.Event,
  Node: w.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { HomePage } = await import('../app/pages/HomePage.tsx');
const { PeriodReview } = await import('../app/components/PeriodReview.tsx');
const tick = () => new Promise((r) => setTimeout(r, 0));
const stats = {
  rawCount: 0,
  wikiCount: 0,
  thisWeekNewCount: 0,
  pendingConfirmationCount: 0,
  openAuditCount: 0,
  promptCount: 0,
  weekStartsOn: '',
};
const response = (start: string) => ({
  period: { timeZone: 'Asia/Shanghai', start, end: '2026-11-02' },
  snapshotAt: '2026-10-31T00:00:00.000Z',
  knowledge: { status: 'ok', items: [], undated: [], count: 0 },
  pending: { items: [], sources: { draft: { status: 'ok' } } },
  feedback: { status: 'ok', items: [], counts: { helpful: 0, needs_revision: 0, not_applicable: 0, unverified: 0 } },
});
test('首页不自动请求回顾，主动打开才读取', async () => {
  const old = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(
      JSON.stringify(url.startsWith('/api/home/review') ? response('2026-10-26') : { items: [], sources: {} }),
    );
  };
  const root = createRoot(w.document.getElementById('root')!);
  const noop = () => {};
  try {
    await act(async () => {
      root.render(
        createElement(HomePage, {
          stats,
          items: [],
          onOpenRaw: noop,
          onOpenWiki: noop,
          onOpenPrompt: noop,
          onImport: noop,
          onCreateWiki: noop,
          onCreatePrompt: noop,
          onGeneratePrompt: noop,
          onLint: noop,
        }),
      );
      await tick();
    });
    assert.equal(calls.filter((x) => x.startsWith('/api/home/review')).length, 0);
    await act(async () => {
      [...w.document.querySelectorAll('button')].find((b) => b.textContent === '周期回顾')!.click();
      await tick();
    });
    assert.equal(calls.filter((x) => x.startsWith('/api/home/review')).length, 1);
    assert.match(w.document.body.textContent!, /本周期没有使用反馈/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = old;
  }
});
test('日期变化取消迟到响应并仅显示最新周期', async () => {
  const old = globalThis.fetch;
  const pending: Array<(r: Response) => void> = [];
  globalThis.fetch = async () => await new Promise<Response>((resolve) => pending.push(resolve));
  const root = createRoot(w.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(createElement(PeriodReview, { onClose: () => {}, onOpenWiki: () => {}, onOpenAction: () => {} }));
      await tick();
    });
    const date = w.document.querySelector('input[type=date]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(date, '2026-10-19');
      date.dispatchEvent(new w.Event('input', { bubbles: true }));
      date.dispatchEvent(new w.Event('change', { bubbles: true }));
      await tick();
    });
    await act(async () => {
      [...w.document.querySelectorAll('button')].find((b) => b.textContent === '刷新回顾')!.click();
      await tick();
    });
    assert.equal(pending.length, 2);
    await act(async () => {
      pending[1](new Response(JSON.stringify(response('2026-10-19'))));
      await tick();
      pending[0](new Response(JSON.stringify(response('2026-10-26'))));
      await tick();
    });
    assert.match(w.document.body.textContent!, /覆盖 2026-10-19/);
    assert.doesNotMatch(w.document.body.textContent!, /覆盖 2026-10-26/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = old;
  }
});
