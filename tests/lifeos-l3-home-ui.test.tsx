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
  Event: w.Event,
  Node: w.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { HomePage } = await import('../app/pages/HomePage.tsx');
const stats = {
  rawCount: 0,
  wikiCount: 0,
  thisWeekNewCount: 0,
  pendingConfirmationCount: 0,
  openAuditCount: 0,
  promptCount: 0,
  weekStartsOn: '',
};
const item = {
  kind: 'draft',
  id: 'one',
  title: '虚构待审',
  problem: '待审核',
  result: '草稿已保存',
  action: '继续审核',
  updatedAt: '2026-10-01',
  priority: 1,
  target: { draftId: 'one' },
  versionToken: 'v1',
};
test('分源错误可见，预检成功才导航；版本变化给提示', async () => {
  let opened = 0,
    conflict = false;
  const old = globalThis.fetch;
  globalThis.fetch = async (input) =>
    String(input) === '/api/wiki'
      ? new Response(JSON.stringify({ items: [] }))
      : String(input).includes('?versionToken=')
        ? conflict
          ? new Response(JSON.stringify({ error: { message: '事项已变化，请刷新' } }), { status: 409 })
          : new Response(JSON.stringify(item))
        : new Response(
            JSON.stringify({
              items: [item],
              sources: {
                draft: { status: 'ok' },
                audit: { status: 'error', message: '读取失败，无法确认是否还有待办。' },
              },
            }),
          );
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
          onOpenAction: () => opened++,
        }),
      );
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(w.document.body.textContent!, /Audit：读取失败/);
    assert.doesNotMatch(w.document.body.textContent!, /当前没有需要处理/);
    const button = [...w.document.querySelectorAll('button')].find((b) => b.textContent === '继续审核')!;
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(opened, 1);
    conflict = true;
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(opened, 1);
    assert.match(w.document.body.textContent!, /事项已变化/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = old;
  }
});
