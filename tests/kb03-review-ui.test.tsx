import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { deepFixture, deepReply } from './support/kb03-deep-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import type { Raw, ExtractionJob } from '../app/api';

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  }),
  w = dom.window;
for (const [name, value] of Object.entries({
  window: w,
  document: w.document,
  navigator: w.navigator,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  HTMLTextAreaElement: w.HTMLTextAreaElement,
  HTMLSelectElement: w.HTMLSelectElement,
  Event: w.Event,
  Node: w.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
w.HTMLElement.prototype.scrollIntoView = () => {};
const { act, createElement } = await import('react'),
  { createRoot } = await import('react-dom/client'),
  { DraftReviewPage } = await import('../app/pages/DraftReviewPage'),
  { RawPage } = await import('../app/pages/RawPage');
const nativeFetch = globalThis.fetch;
const buttons = (label: string) =>
  [...w.document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
async function tick(check: () => boolean, label: string) {
  const end = performance.now() + 6000;
  while (performance.now() < end) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
    if (check()) return;
  }
  assert.fail(label + ' ' + w.document.body.textContent?.slice(0, 700));
}
async function click(button: HTMLButtonElement | undefined) {
  assert(button);
  assert(!button.disabled);
  await act(async () => {
    button.click();
  });
}
async function change(element: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      element instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : w.HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new w.Event(element instanceof w.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

test('KB03 React real HTTP table editing/delete supplement/questions survives refresh, report stale and actual second offset highlighted', async () => {
  const block = ('重复目标100家，在售20家。' + '资料'.repeat(256)).slice(0, 509) + '。\n\n';
  const f = await storageFixture();
  f.succeed();
  const raw = await f.rawStore.create({
    title: '虚构深度资料',
    sourceType: 'report',
    sourceName: '隔离fake',
    tags: [],
    body: block.repeat(2),
  });
  const original = f.provider.complete;
  const stages: string[] = [];
  f.provider.complete = async (request) => {
    if (request.system.startsWith('KB03 ')) {
      stages.push(JSON.parse(request.user).stage);
      const text = JSON.stringify(deepReply(request));
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    }
    stages.push(
      request.system.startsWith('知识维护提议')
        ? 'maintenance'
        : request.user.includes('请对下列全部已验证事实规划知识页')
          ? 'planning'
          : 'extraction',
    );
    return original(request);
  };
  let root: ReturnType<typeof createRoot> | undefined;
  const h = await storageHttp(f, f.runner, { knowledge: true });
  globalThis.fetch = (url, init) => nativeFetch(String(url).startsWith('/api/') ? h.base + url : url, init);
  try {
    const r = await h.request(`/api/raw/${raw.id}/extract`, { mode: 'deep' });
    assert.equal(r.status, 202);
    const job = await f.wait(r.json.jobId);
    assert.equal(job.status, 'completed');
    assert.ok(job.draftId);
    const draftId = job.draftId;
    const expected = ['extraction', 'planning', 'outline', 'writing', 'quality', 'maintenance'];
    assert.deepEqual(stages, expected);
    assert.equal(job.callCount, expected.length);
    const mount = async () => {
      root = createRoot(w.document.getElementById('root')!);
      await act(async () =>
        root!.render(
          createElement(DraftReviewPage, {
            draftId,
            onBack: () => {},
            onCommitted: async () => assert.fail('Editing must not commit'),
            onOpenRaw: () => {},
          }),
        ),
      );
      await tick(
        () => !!w.document.querySelector('.structured-note table') && buttons('保存笔记')[0]?.disabled === false,
        'table and Raw loaded',
      );
    };
    const confirm = () =>
      [...w.document.querySelectorAll('button')].find(
        (b) => b.textContent?.includes('确认来源笔记入库') || b.textContent?.startsWith('确认所选成果入库'),
      )!;
    const original = (await f.drafts.get(draftId))!;
    await mount();
    assert(w.document.querySelector('.structured-note table thead'));
    assert(w.document.querySelector('.structured-note table tbody'));
    assert.equal(w.document.querySelector('.note-approval'), null);
    assert.equal(confirm().disabled, false);

    const second = [...w.document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('定位 c1-l002 [512, 1024)'),
    );
    await click(second);
    const mark = w.document.querySelector('mark')!;
    assert.equal(mark.getAttribute('data-start'), '512');
    assert.equal(mark.textContent, block);
    assert.equal(mark.previousSibling!.textContent, block);
    await click(buttons('编辑笔记')[0]);
    await change(w.document.querySelector<HTMLTextAreaElement>('.structured-note td textarea')!, '人工单元格说明');
    await click(buttons('删除补充')[0]);
    await click(buttons('添加人工问题')[0]);
    const question = [...w.document.querySelectorAll('label')]
      .find((l) => l.textContent?.startsWith('人工问题（无原文证据）'))!
      .querySelector('textarea')!;
    await change(question, '人工追问负责人');
    assert(confirm().disabled);
    await click(buttons('保存笔记')[0]);
    await tick(
      () =>
        w.document.body.textContent!.includes('历史模型报告，编辑后未复核') &&
        buttons('保存笔记')[0]?.disabled === false &&
        !confirm().disabled,
      'saved edit refreshed the outcome',
    );
    const saved = (await f.drafts.get(draftId))!;
    assert.equal(saved.noteApproval, undefined);
    assert(saved.maintenance!.changes.every((change) => !change.approval));
    assert.notEqual(f.drafts.outcomeDigest(saved), f.drafts.outcomeDigest(original));
    assert.deepEqual(saved.noteReview!.humanQuestions, ['人工追问负责人']);
    assert(!JSON.stringify(saved.structuredNote).includes('渠道层级是理解商品流通的补充概念'));
    assert.equal(confirm().disabled, false);
    await act(async () => root!.unmount());
    root = undefined;
    await mount();
    assert(w.document.body.textContent!.includes('人工单元格说明'));
    assert(w.document.body.textContent!.includes('人工追问负责人'));
    assert(w.document.body.textContent!.includes('人工修改，待核对'));
    assert.equal(w.document.querySelector('.note-approval'), null);
    assert.equal(confirm().disabled, false);
    assert.deepEqual(stages, expected);
  } finally {
    if (root) await act(async () => root!.unmount());
    globalThis.fetch = nativeFetch;
    await h.close();
    await f.clean();
  }
});
test('KB03 Raw React defaults/boundaries and explicit standard selection reset per Raw', async () => {
  const f = await deepFixture(),
    h = await storageHttp(f as any, f.runner, { knowledge: true });
  const root = createRoot(w.document.getElementById('root')!);
  const long = await f.rawStore.create({
    title: '超限',
    body: '长'.repeat(30001),
    sourceType: 'report',
    sourceName: 'fake',
    tags: [],
  });
  let started: ExtractionJob | undefined;
  const sent: any[] = [];
  globalThis.fetch = (url, init) => {
    if (String(url).endsWith('/extract')) sent.push(JSON.parse(String(init?.body)));
    return nativeFetch(String(url).startsWith('/api/') ? h.base + url : url, init);
  };
  const render = async (selectedId: string) => {
    await act(async () =>
      root.render(
        createElement(RawPage, {
          items: [f.raw, long] as Raw[],
          selectedId,
          onSelected: () => {},
          onOpenImport: () => {},
          onCommitted: async () => {},
          openImport: false,
          onCloseImport: () => {},
          onDeleted: async () => {},
          processing: {},
          job: null,
          onJobStarted: (v) => {
            started = v;
          },
          onOpenDraft: () => {},
          onRefresh: async () => {},
        }),
      ),
    );
  };
  try {
    await render(f.raw.id);
    const select = () => w.document.querySelector<HTMLSelectElement>('[aria-label="整理模式"]')!;
    assert.equal(select().value, 'deep');
    await change(select(), 'standard');
    await render(long.id);
    assert.equal(select().value, 'standard');
    assert(select().querySelector<HTMLOptionElement>('option[value="deep"]')!.disabled);
    assert(w.document.body.textContent!.includes('超过30000字符'));
    await render(f.raw.id);
    assert.equal(select().value, 'deep');
    await change(select(), 'standard');
    await click(buttons('整理到知识库')[0]);
    await tick(() => !!started, 'standard explicitly started');
    assert.deepEqual(sent, [{ mode: 'standard' }]);
    assert.equal(started!.mode, 'standard');
    assert.equal((await f.wait(started!.jobId)).job?.status, 'completed');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
    await h.close();
    await f.clean();
  }
});
test('KB03 Raw React explicit continuation follows failed standard job mode despite short Raw deep default', async () => {
  const f = await deepFixture();
  f.hook(async () => {
    throw Error('once');
  });
  const first = await f.start('standard');
  await f.wait(first.json.jobId);
  f.hook(undefined);
  const job = (await f.http.request(`/api/extraction-jobs/${first.json.jobId}`)).json;
  const state = await f.rawStates.get(f.raw.id),
    h = await storageHttp(f as any, f.runner, { knowledge: true }),
    root = createRoot(w.document.getElementById('root')!);
  let sent: any;
  globalThis.fetch = (url, init) => {
    if (String(url).endsWith('/extract')) sent = JSON.parse(String(init?.body));
    return nativeFetch(String(url).startsWith('/api/') ? h.base + url : url, init);
  };
  try {
    await act(async () =>
      root.render(
        createElement(RawPage, {
          items: [f.raw] as Raw[],
          selectedId: f.raw.id,
          onSelected: () => {},
          onOpenImport: () => {},
          onCommitted: async () => {},
          openImport: false,
          onCloseImport: () => {},
          onDeleted: async () => {},
          processing: { [f.raw.id]: state },
          job,
          onJobStarted: () => {},
          onOpenDraft: () => {},
          onRefresh: async () => {},
        }),
      ),
    );
    assert.equal(w.document.querySelector<HTMLSelectElement>('[aria-label="整理模式"]')!.value, 'deep');
    await click(buttons('显式继续提取')[0]);
    await tick(() => !!sent, 'resume');
    assert.equal(sent.mode, 'standard');
    await f.runner.waitForSettlement(job.jobId);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
    await h.close();
    await f.clean();
  }
});
