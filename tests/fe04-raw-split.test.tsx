// FE04 boundary regression tests: real React in jsdom, deliberately ordered fetch promises.
// HTTP storage interoperability is covered separately by kb02-storage-ui and ui-interaction.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw, RawTranslation } from '../app/api';

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const w = dom.window;
for (const [name, value] of Object.entries({
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
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawPage, ImportDialog } = await import('../app/pages/RawPage');
const none = () => {};
const settled = async () => {};
const props = {
  onSelected: none,
  onOpenImport: none,
  onCommitted: settled,
  openImport: false,
  onCloseImport: none,
  onDeleted: settled,
  processing: {},
  job: null,
  onJobStarted: none,
  onOpenDraft: none,
  onRefresh: settled,
};
const raw = (id: string, overrides: Partial<Raw> = {}): Raw => ({
  id,
  title: `资料 ${id}`,
  sourceType: 'article',
  sourceName: 'FE04 fixture',
  tags: [],
  body: `Original ${id}`,
  importedAt: '2026-11-28T00:00:00Z',
  status: 'unprocessed',
  bodySha256: id.padEnd(64, '0'),
  ...overrides,
});
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function button(text: string, scope: ParentNode = w.document) {
  const found = [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
  assert(found, text);
  return found;
}
async function click(text: string, scope: ParentNode = w.document) {
  await act(async () => button(text, scope).click());
}
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
}
async function mount(element: React.ReactElement) {
  const root = createRoot(w.document.getElementById('root')!);
  await act(async () => root.render(element));
  return root;
}

test('FE04 a late translation cannot cross the keyed Raw boundary or restart polling after unmount', async () => {
  const native = globalThis.fetch;
  const a = raw('a', { urlImport: { finalUrl: 'https://fixture.example/a', fetchedAt: '2026-11-28' } });
  const b = raw('b', { urlImport: { finalUrl: 'https://fixture.example/b', fetchedAt: '2026-11-28' } });
  const first = deferred<Response>(),
    unmounted = deferred<Response>();
  const calls: string[] = [];
  const translated = (item: Raw, status: RawTranslation['status']): RawTranslation => ({
    rawId: item.id,
    rawSha256: item.bodySha256,
    status,
    body: `译文 ${item.id}`,
    attempts: 1,
    completedChunks: 1,
    totalChunks: 1,
  });
  let aReads = 0;
  globalThis.fetch = async (input) => {
    const route = String(input);
    calls.push(route);
    if (route === '/api/raw/a/translation') return ++aReads === 1 ? first.promise : unmounted.promise;
    if (route === '/api/raw/b/translation') return reply({ translation: translated(b, 'completed') });
    return reply({ items: [] });
  };
  const root = await mount(createElement(RawPage, { ...props, items: [a, b], selectedId: a.id }));
  let didUnmount = false;
  try {
    await act(async () => root.render(createElement(RawPage, { ...props, items: [a, b], selectedId: b.id })));
    assert.equal(w.document.querySelector('.raw-body')!.textContent, '译文 b');
    await act(async () => first.resolve(reply({ translation: translated(a, 'completed') })));
    assert.equal(w.document.querySelector('.raw-body')!.textContent, '译文 b');
    await click('原文');
    assert.equal(w.document.querySelector('.raw-body')!.textContent, b.body);
    await act(async () => root.render(createElement(RawPage, { ...props, items: [a, b], selectedId: a.id })));
    await act(async () => root.unmount());
    didUnmount = true;
    await act(async () => unmounted.resolve(reply({ translation: translated(a, 'running') })));
    await new Promise((done) => setTimeout(done, 550));
    assert.equal(calls.filter((route) => route === '/api/raw/a/translation').length, 2);
  } finally {
    if (!didUnmount) await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('FE04 two RawPage instances keep selection, filter and AI busy state independent', async () => {
  const native = globalThis.fetch,
    extraction = deferred<Response>();
  const a = raw('a'),
    b = raw('b');
  globalThis.fetch = async (input) =>
    String(input) === '/api/raw/a/extract' ? extraction.promise : reply({ items: [] });
  function Harness() {
    const [left, setLeft] = useState('a'),
      [right, setRight] = useState('b');
    return createElement(
      'div',
      {},
      createElement(
        'div',
        { id: 'left' },
        createElement(RawPage, { ...props, items: [a, b], selectedId: left, onSelected: setLeft }),
      ),
      createElement(
        'div',
        { id: 'right' },
        createElement(RawPage, { ...props, items: [a, b], selectedId: right, onSelected: setRight }),
      ),
    );
  }
  const root = await mount(createElement(Harness));
  try {
    const left = w.document.getElementById('left')!,
      right = w.document.getElementById('right')!;
    await type(left.querySelector('input')!, 'nothing');
    assert.equal(left.querySelectorAll('.raw-list-item').length, 0);
    assert.equal(right.querySelectorAll('.raw-list-item').length, 2);
    assert.equal(left.querySelector('.raw-body')!.textContent, a.body);
    assert.equal(right.querySelector('.raw-body')!.textContent, b.body);
    const start = button('整理到知识库', left);
    assert(start);
    await act(async () => start.click());
    assert(start.disabled);
    const rightStart = button('整理到知识库', right);
    assert.equal(rightStart.disabled, false);
    await act(async () => right.querySelectorAll<HTMLButtonElement>('.raw-list-item')[0].click());
    assert.equal(right.querySelector('.raw-body')!.textContent, a.body);
    assert.equal(left.querySelector('.raw-body')!.textContent, a.body);
    await act(async () => extraction.resolve(reply({ error: { code: 'FIXTURE', message: 'fixture stopped' } }, 503)));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('FE04 import double click commits once, waits for onCommitted, and generation retries reuse that Raw', async () => {
  const native = globalThis.fetch,
    created = deferred<Response>(),
    committed = deferred<void>();
  const saved = raw('saved');
  const events: string[] = [],
    posts: string[] = [];
  let attempts = 0;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      posts.push(String(input));
      return created.promise;
    }
    return reply({ items: [] });
  };
  const root = await mount(
    createElement(ImportDialog, {
      prefill: saved,
      onClose: () => events.push('close'),
      onCommitted: async (item) => {
        events.push(`committed:${item.id}`);
        await committed.promise;
      },
      onGenerate: async (item) => {
        events.push(`generate:${item.id}`);
        if (++attempts === 1) throw new Error('fixture generation failed');
      },
      onOpen: (item) => events.push(`open:${item.id}`),
    }),
  );
  try {
    await type(w.document.querySelector('textarea')!, '  exact body\n');
    await act(async () => {
      const save = button('保存并生成 Wiki 草稿');
      save.click();
      save.click();
    });
    assert.deepEqual(posts, ['/api/raw']);
    await act(async () => created.resolve(reply(saved, 201)));
    assert.deepEqual(events, ['committed:saved']);
    await act(async () => committed.resolve());
    assert.deepEqual(events, ['committed:saved', 'generate:saved']);
    assert.match(w.document.body.textContent!, /Raw 已保存，Wiki 草稿未生成/);
    await click('用同一 Raw 重试');
    assert.deepEqual(posts, ['/api/raw']);
    assert.deepEqual(events, ['committed:saved', 'generate:saved', 'generate:saved', 'open:saved']);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('FE04 history ignores a late response from the previously selected body revision', async () => {
  const native = globalThis.fetch,
    older = deferred<Response>(),
    newer = deferred<Response>();
  const item = raw('history', { bodyRevision: 3 });
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/body-history/2')) return older.promise;
    if (String(input).endsWith('/body-history/1')) return newer.promise;
    return reply({ items: [] });
  };
  const root = await mount(createElement(RawPage, { ...props, items: [item], selectedId: item.id }));
  try {
    await click('查看原文修改历史');
    await click('更早一版');
    await act(async () => newer.resolve(reply({ ...item, bodyRevision: 1, body: 'selected revision 1' })));
    const dialog = w.document.querySelector('[role=dialog]')!;
    assert.equal(dialog.querySelector('.raw-body')!.textContent, 'selected revision 1');
    await act(async () => older.resolve(reply({ ...item, bodyRevision: 2, body: 'late revision 2' })));
    assert.equal(dialog.querySelector('.raw-body')!.textContent, 'selected revision 1');
    assert.equal(dialog.querySelector('textarea'), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('FE04 body conflict preserves edits and uses the latest revision only after explicit acknowledgement', async () => {
  const native = globalThis.fetch,
    conflict = deferred<Response>(),
    latestRead = deferred<Response>();
  const item = raw('edit', { bodyRevision: 1 }),
    latest = raw('edit', { bodyRevision: 2, bodySha256: 'f'.repeat(64), body: 'another editor latest' });
  const writes: Array<{ body: string; expectedBodySha256: string; expectedBodyRevision: number }> = [];
  const saved: Raw[] = [];
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'PATCH') {
      writes.push(JSON.parse(String(init.body)));
      return writes.length === 1 ? conflict.promise : reply({ ...latest, body: writes[1].body, bodyRevision: 3 });
    }
    if (String(input) === '/api/raw/edit') return latestRead.promise;
    return reply({ items: [] });
  };
  const root = await mount(
    createElement(RawPage, { ...props, items: [item], selectedId: item.id, onBodySaved: (value) => saved.push(value) }),
  );
  try {
    await click('编辑原文');
    const edited = '  my exact edit\n';
    await type(w.document.querySelector('textarea')!, edited);
    await click('保存原文');
    await act(async () => conflict.resolve(reply({ error: { code: 'RAW_BODY_CONFLICT', message: '版本冲突' } }, 409)));
    assert(button('保存原文').disabled);
    assert.equal(w.document.querySelector('textarea')!.value, edited);
    await click('读取最新原文');
    await act(async () => latestRead.resolve(reply(latest)));
    assert.equal(w.document.querySelectorAll('textarea')[1].value, latest.body);
    assert.equal(w.document.querySelector('textarea')!.value, edited);
    assert(button('保存原文').disabled);
    await click('已核对，保留我的编辑');
    await click('保存原文');
    assert.deepEqual(writes, [
      { body: edited, expectedBodySha256: item.bodySha256, expectedBodyRevision: 1 },
      { body: edited, expectedBodySha256: latest.bodySha256, expectedBodyRevision: 2 },
    ]);
    assert.equal(saved[0].body, edited);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});
