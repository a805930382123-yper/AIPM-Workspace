import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true }),
  w = dom.window;
for (const [k, v] of Object.entries({
  window: w,
  document: w.document,
  navigator: w.navigator,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  HTMLTextAreaElement: w.HTMLTextAreaElement,
  Event: w.Event,
  Node: w.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ImportDialog } = await import('../app/pages/RawPage');
const raw = {
  id: 'r1',
  title: '虚构',
  sourceType: 'article',
  sourceName: '来源',
  body: '原文',
  tags: [],
  importedAt: '2026-01-01',
  status: 'unprocessed',
  bodySha256: 'a',
};
for (const fail of [false, true])
  test(
    fail ? '粘贴保存后生成失败保留输入，同 Raw 重试成功再打开' : '粘贴保存并启动生成成功后打开已保存 Raw',
    async () => {
      let calls = 0,
        opens = 0,
        created = 0,
        committed = 0;
      const old = globalThis.fetch;
      globalThis.fetch = async () => {
        created++;
        return new Response(JSON.stringify(raw), { status: 201 });
      };
      const root = createRoot(w.document.getElementById('root')!);
      const wait = () => new Promise((r) => setTimeout(r, 0));
      try {
        await act(async () => {
          root.render(
            createElement(ImportDialog, {
              onClose: () => {},
              onCommitted: async () => {
                committed++;
              },
              onOpen: (r) => {
                assert.equal(r.id, raw.id);
                opens++;
              },
              onGenerate: async (r) => {
                assert.equal(r.id, raw.id);
                calls++;
                if (fail && calls === 1) throw Error('虚构失败');
              },
            }),
          );
          await wait();
        });
        for (const [selector, value] of [
          ['input[placeholder*="经销商订货"]', '虚构'],
          ['input[placeholder*="客户访谈"]', '来源'],
          ['textarea', '原文'],
        ] as const) {
          const el = w.document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
          await act(async () => {
            Object.getOwnPropertyDescriptor(
              el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype,
              'value',
            )!.set!.call(el, value);
            el.dispatchEvent(new w.Event('input', { bubbles: true }));
            await wait();
          });
        }
        const btn = [...w.document.querySelectorAll('button')].find((x) => x.textContent === '保存并生成 Wiki 草稿')!;
        await act(async () => {
          btn.click();
          await wait();
        });
        assert.equal(created, 1);
        assert.equal(committed, 1);
        if (fail) {
          assert.equal(opens, 0);
          assert.match(w.document.body.textContent!, /虚构失败/);
          assert.equal((w.document.querySelector('textarea') as HTMLTextAreaElement).value, '原文');
          const retry = [...w.document.querySelectorAll('button')].find((x) => x.textContent === '用同一 Raw 重试')!;
          await act(async () => {
            retry.click();
            await wait();
          });
          assert.equal(created, 1);
          assert.equal(calls, 2);
        }
        assert.equal(opens, 1);
      } finally {
        await act(async () => root.unmount());
        globalThis.fetch = old;
      }
    },
  );
