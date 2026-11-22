import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { RawDraftView } from '../app/api';

const { window } = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
const { document } = window;
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawOutcomeReview } = await import('../app/pages/RawOutcomeReview');
const { StructuredNoteEditor } = await import('../app/components/StructuredNoteEditor');

const page = (title: string) => ({
  pageId: title,
  title,
  type: 'concept',
  category: 'other',
  one_line_definition: '说明',
  source_facts: [],
  ai_organized: ['原整理内容'],
  ai_inferences: [],
  related_pages: [],
  open_questions: [],
  source_evidence: [],
  knowledge_status: 'ai_organized',
  confidence: 'medium',
  source_level: 'D',
  selected: true,
  provenance: [],
});
const fixture: RawDraftView = {
  id: 'draft',
  rawId: 'raw',
  rawTitle: '合成资料',
  status: 'pending_confirmation',
  revision: 1,
  outcomeDigest: 'before',
  jobId: 'job',
  createdAt: '2026-11-14',
  updatedAt: '2026-11-14',
  rulesVersion: 'fixture',
  raw: null,
  document: { title: '合成资料', main_topic: '主题', summary: '' },
  pages: [page('主题一'), page('主题二')],
  source: {
    title: '来源草稿',
    body: '来源草稿正文',
    category: 'other',
    summary: '',
    key_takeaways: [],
    knowledge_status: 'ai_organized',
    confidence: 'medium',
    source_level: 'D',
  },
  provider: { name: 'fake', model: 'fixture' },
  warnings: [],
  extraction: { callCount: 0, chunkCount: 1, pagesFound: 2 },
  preview: {
    rawExists: true,
    rawSha256Matches: true,
    titleConflicts: [],
    sourceReuse: null,
    sourceAmbiguous: null,
    batchDuplicateTitles: [],
  },
};
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === name);
const click = (name: string) =>
  act(async () => {
    const target = button(name);
    assert(target, name);
    target.click();
  });
const input = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
const confirm = () => document.querySelector<HTMLButtonElement>('.outcome-confirm .primary-button')!;
const checks = () =>
  [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((item) => item.checked);

test('cancel preserves selection, while saving a topic clears only that topic and protects navigation during edits', async () => {
  const root = createRoot(document.getElementById('root')!);
  const fetch = globalThis.fetch;
  let persisted = fixture;
  let writes = 0,
    exits = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, 'PATCH');
    const patch = JSON.parse(String(init.body));
    assert.equal(patch.baseRevision, 1);
    assert.deepEqual(patch.pages, [
      { pageId: '主题一', title: '修改后的主题', one_line_definition: '说明', ai_organized: ['人工整理段落'] },
    ]);
    writes++;
    persisted = {
      ...fixture,
      revision: 2,
      outcomeDigest: 'after',
      pages: [{ ...fixture.pages[0], title: '修改后的主题', ai_organized: ['人工整理段落'] }, fixture.pages[1]],
    };
    return Response.json(persisted);
  };
  const render = () =>
    root.render(
      createElement(RawOutcomeReview, {
        view: persisted,
        body: '合成原文',
        onView: render,
        onBack: () => exits++,
        onOpenRaw: () => exits++,
        onCommitted: async () => {},
        advanced: null,
        advancedDirty: false,
        advancedBusy: false,
      }),
    );
  try {
    await act(async () => render());
    await click('编辑主题成果');
    await input(document.querySelector('.outcome-edit input')!, '未保存主题');
    assert(confirm().disabled);
    await click('返回');
    await click('查看原始资料');
    assert.equal(exits, 0);
    await click('取消编辑');
    assert.equal(writes, 0);
    assert.deepEqual(checks(), [true, true]);
    await click('编辑主题成果');
    assert.equal(document.querySelector<HTMLInputElement>('.outcome-edit input')!.value, '主题一');
    await input(document.querySelector('.outcome-edit input')!, '修改后的主题');
    await input(document.querySelector('.outcome-edit textarea')!, '人工整理段落');
    await click('保存成果编辑');
    assert.equal(writes, 1);
    assert.deepEqual(checks(), [false, true]);
    assert.match(document.body.textContent!, /重新选择/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = fetch;
  }
});

test('a saved maintenance edit whose readback failed is recovered by GET only', async () => {
  const root = createRoot(document.getElementById('root')!);
  const fetch = globalThis.fetch;
  const before: RawDraftView = {
    ...fixture,
    maintenance: {
      version: 1,
      context: [],
      changes: [
        {
          changeId: 'change-1',
          pageIndex: 0,
          action: 'create',
          decision: 'defer',
          reason: '合成测试',
          candidate: {
            title: '主题一',
            body: '原文草稿',
            type: 'concept',
            category: 'other',
            aliases: [],
            tags: [],
            sources: ['raw'],
            knowledge_status: 'ai_organized',
            confidence: 'medium',
            source_level: 'D',
          },
          summary: [],
          questions: [],
          dependsOn: [],
        },
      ],
    },
  };
  let view = before;
  const methods: string[] = [];
  const updated = {
    ...before,
    revision: 2,
    outcomeDigest: 'after',
    maintenance: {
      ...before.maintenance!,
      changes: [
        {
          ...before.maintenance!.changes[0],
          candidate: { ...before.maintenance!.changes[0].candidate, title: '更新主题', body: '## 新段落\n\n人工内容' },
        },
      ],
    },
  };
  globalThis.fetch = async (_url, init) => {
    const method = init?.method ?? 'GET';
    methods.push(method);
    if (method === 'POST') return Response.json(updated);
    if (methods.length === 2)
      return Response.json({ error: { code: 'TEMPORARY', message: '暂时读取失败' } }, { status: 503 });
    return Response.json(updated);
  };
  const render = () =>
    root.render(
      createElement(RawOutcomeReview, {
        view,
        body: '合成原文',
        onView: (value) => {
          view = value as RawDraftView;
          render();
        },
        onBack: () => {},
        onOpenRaw: () => {},
        onCommitted: async () => {},
        advanced: null,
        advancedDirty: false,
        advancedBusy: false,
      }),
    );
  try {
    await act(async () => render());
    await click('编辑主题成果');
    await input(document.querySelector('.outcome-edit input')!, '更新主题');
    await input(document.querySelector('.outcome-edit textarea')!, '## 新段落\n\n人工内容');
    await click('保存成果编辑');
    assert.deepEqual(methods, ['POST', 'GET']);
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /草稿已保存/);
    assert.equal(document.querySelector<HTMLTextAreaElement>('.outcome-edit textarea')!.value, '## 新段落\n\n人工内容');
    assert(confirm().disabled);
    assert.equal(button('取消编辑'), undefined);
    await click('重新读取已保存草稿');
    assert.deepEqual(methods, ['POST', 'GET', 'GET']);
    assert.equal(view.revision, 2);
    assert.deepEqual(checks(), [false]);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = fetch;
  }
});

test('cancelling a deep note restores the last saved note and review fields', async () => {
  const root = createRoot(document.getElementById('root')!);
  const fetch = globalThis.fetch;
  const dirty: boolean[] = [];
  globalThis.fetch = async () => assert.fail('Cancelling must not write to the server');
  const view: RawDraftView = {
    ...fixture,
    structuredNote: { version: 1, orientation: '保存的定位', sections: [] },
    humanReview: { version: 1, basisDigest: 'fixture', units: [], assignments: {}, approvals: [] },
  };
  try {
    await act(async () =>
      root.render(
        createElement(StructuredNoteEditor, {
          view,
          body: '合成原文',
          disabled: false,
          onSaved: () => assert.fail(),
          onDirty: (value) => dirty.push(value),
          outcomeReview: true,
        }),
      ),
    );
    await click('编辑笔记');
    await input(document.querySelector('textarea')!, '未保存定位');
    await click('添加人工问题');
    await input(document.querySelectorAll('textarea')[1], '未保存问题');
    assert.equal(dirty.at(-1), true);
    await click('取消笔记编辑');
    assert.equal(dirty.at(-1), false);
    assert.match(document.body.textContent!, /保存的定位/);
    assert.doesNotMatch(document.body.textContent!, /未保存定位|未保存问题/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = fetch;
  }
});
