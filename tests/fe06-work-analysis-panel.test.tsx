import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw, WorkItem } from '../app/api.ts';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Event: window.Event,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { WorkAnalysisPanel } = await import('../app/pages/WorkAnalysisPanel.tsx');
const { LlmAvailabilityProvider } = await import('../app/hooks/llmAvailability.tsx');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item: Extract<WorkItem, { kind: 'product_analysis' }> = {
  id: 'p',
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  title: '分析',
  kind: 'product_analysis',
  status: 'triage',
  analysis: { goal: '目标', dataScope: '', confirmedConclusions: '', openQuestions: '' },
  rawIds: ['r', 'private'],
  history: [{ kind: 'stage_result', at: '2026-01-01T00:00:00Z', body: '阶段背景' }],
  screenshots: [],
};
const raw: Raw = {
  id: 'r',
  title: '公开资料',
  body: '原文',
  sourceType: 'meeting',
  sourceName: '笔记',
  tags: [],
  importedAt: '2026-01-01T00:00:00Z',
  status: 'unprocessed',
  bodySha256: '1'.repeat(64),
};
const rawById = new Map([
  ['r', raw],
  ['private', { ...raw, id: 'private', title: '私有资料', origin: { type: 'work_item', id: 'p' } } as unknown as Raw],
]);
function button(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  assert.ok(found, label);
  return found;
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await tick();
  });
}
async function value(el: HTMLTextAreaElement | HTMLSelectElement, text: string) {
  await act(async () => {
    const proto =
      el instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
    el.dispatchEvent(new window.Event(el instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await tick();
  });
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(async () => {
      await tick(10);
    });
  }
  assert.fail('timed out');
}
async function mount(props: Partial<Parameters<typeof WorkAnalysisPanel>[0]> = {}, provider = false) {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  const render = async (next = props) => {
    const panel = createElement(WorkAnalysisPanel, {
      item,
      rawById,
      busy: false,
      analysisDirty: false,
      reloadItem: async () => {},
      analysisNotice: null,
      saveStage: () => {},
      stageNotice: null,
      ...next,
    });
    await act(async () => {
      root.render(provider ? createElement(LlmAvailabilityProvider, null, panel) : panel);
      await tick();
    });
  };
  await render();
  return { root, container, render };
}

test('关闭、busy、缺少有效资料及模型禁用时不能预览发送', async () => {
  const original = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'POST') posts++;
    if (String(input).endsWith('/availability')) return json({ heavy: { reason: 'disabled' } });
    return json({ items: [] });
  }) as typeof fetch;
  for (const props of [{ item: { ...item, status: 'closed' as const } }, { busy: true }]) {
    const { root, container, render } = await mount();
    try {
      await waitFor(() => container.textContent!.includes('暂无分析记录'));
      const selected = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      await click(selected);
      assert.equal(button(container, '预览发送内容').disabled, false);
      await render(props);
      assert.equal(selected.checked, true);
      assert.equal(button(container, '预览发送内容').disabled, true);
      await click(button(container, '预览发送内容'));
      assert.equal(posts, 0);
    } finally {
      await act(async () => root.unmount());
    }
  }
  for (const props of [{ rawById: new Map() }]) {
    const { root, container } = await mount(props);
    try {
      await waitFor(() => container.textContent!.includes('暂无分析记录'));
      assert.equal(button(container, '预览发送内容').disabled, true);
    } finally {
      await act(async () => root.unmount());
    }
  }
  const { root, container } = await mount({}, true);
  try {
    await waitFor(() => container.textContent!.includes('模型已在本机配置中关闭'));
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    assert.equal(boxes[1].disabled, true);
    await click(boxes[0]);
    assert.equal(button(container, '预览发送内容').disabled, true);
    assert.equal(posts, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});

test('预览不发送，确认携带所选资料、阶段和修剪的问题；冲突清选择并读取最新', async () => {
  const original = globalThis.fetch;
  const posts: unknown[] = [];
  let reloads = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return posts.length === 1
        ? json({ error: { code: 'REVISION_CONFLICT', message: '冲突' } }, 409)
        : json({ id: 'new-run' });
    }
    return json({ items: [] });
  }) as typeof fetch;
  const { root, container, render } = await mount({
    reloadItem: async () => {
      reloads++;
    },
  });
  try {
    await waitFor(() => container.textContent!.includes('暂无分析记录'));
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    assert.equal(boxes[1].disabled, true);
    await click(boxes[0]);
    await value(container.querySelector('#work-round-question')!, '  问题  ');
    await value(container.querySelector('#work-stage-context')!, '0');
    await click(button(container, '预览发送内容'));
    assert.equal(posts.length, 0);
    assert.match(container.textContent!, /发送预览/);
    await click(button(container, '发起分析'));
    await waitFor(() => reloads === 1);
    assert.deepEqual(posts, [
      { baseRevision: 1, rawIds: ['r'], outputVersion: 2, roundQuestion: '问题', stageHistoryIndex: 0 },
    ]);
    assert.equal(boxes[0].checked, false);
    assert.equal((container.querySelector('#work-stage-context') as HTMLSelectElement).value, '');
    assert.equal(button(container, '预览发送内容').disabled, true);
    await render({ item: { ...item, revision: 2 } });
    await click(boxes[0]);
    await click(button(container, '预览发送内容'));
    await click(button(container, '发起分析'));
    assert.equal((posts[1] as { baseRevision: number }).baseRevision, 2);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});

test('运行记录轮询，卸载后迟到请求不再安排轮询', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((r) => {
    resolve = r;
  });
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return json({ items: [] });
    if (calls === 2)
      return json({
        items: [{ id: 'run', status: 'running', startedAt: '2026-01-01T00:00:00Z', input: { sources: [] } }],
      });
    return pending;
  }) as typeof fetch;
  const { root, container } = await mount();
  try {
    await waitFor(() => container.textContent!.includes('暂无分析记录'));
    const selected = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await click(selected);
    assert.equal(button(container, '预览发送内容').disabled, false);
    await click(button(container, '刷新分析记录'));
    await waitFor(() => container.textContent!.includes('分析中'));
    assert.equal(selected.checked, true);
    assert.equal(selected.closest('fieldset')!.disabled, true);
    assert.equal(button(container, '预览发送内容').disabled, true);
    await act(async () => {
      await tick(1300);
    });
    assert.equal(calls, 3);
    await act(async () => root.unmount());
    resolve(json({ items: [{ status: 'running' }] }));
    await tick(1300);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('V1 与 V2 结果可查看，带入的阶段草稿可编辑并按来源保存', async () => {
  const original = globalThis.fetch;
  const saved: Array<{ body: string; id?: string }> = [];
  const input = { ...item.analysis, sources: [{ rawId: 'r', title: raw.title, body: raw.body }] };
  const output = {
    observations: [{ rawId: 'r', observation: '观察内容', quote: '原文引文' }],
    suggestions: ['建议'],
    openQuestions: ['待核问题'],
  };
  const runs = [
    { id: 'v1', itemId: 'p', baseRevision: 1, startedAt: '2026-01-01T00:00:00Z', status: 'completed', input, output },
    {
      id: 'v2',
      itemId: 'p',
      baseRevision: 1,
      startedAt: '2026-01-02T00:00:00Z',
      status: 'completed',
      input,
      outputVersion: 2,
      output: {
        ...output,
        roundSummary: '摘要内容',
        themes: [
          {
            title: '主题内容',
            conclusion: null,
            evidence: [0],
            counterEvidence: [],
            openQuestions: ['主题待核'],
            nextSteps: [],
            confirmedConflict: null,
          },
        ],
      },
    },
  ];
  globalThis.fetch = (async () => json({ items: runs })) as typeof fetch;
  const { root, container } = await mount({
    saveStage: (body, id, onSaved) => {
      saved.push({ body, id });
      onSaved();
    },
  });
  try {
    await waitFor(() => container.querySelectorAll('.work-run-button').length === 2);
    await click(container.querySelectorAll<HTMLElement>('.work-run-button')[0]);
    assert.match(container.textContent!, /观察内容/);
    assert.match(container.textContent!, /原文引文/);
    await click(container.querySelectorAll<HTMLElement>('.work-run-button')[1]);
    assert.match(container.textContent!, /摘要内容/);
    assert.match(container.textContent!, /主题内容/);
    assert.match(container.textContent!, /主题待核/);
    const second = container.querySelector('#analysis-v2')!;
    await click(button(second, '带入阶段成果'));
    const editor = container.querySelector<HTMLTextAreaElement>('#work-stage-body')!;
    assert.ok(editor.value.includes('摘要内容'));
    assert.equal(saved.length, 0);
    await value(editor, `${editor.value}\n人工补充`);
    await click(button(container, '保存阶段成果'));
    assert.match(saved[0].body, /人工补充/);
    assert.equal(saved[0].id, 'v2');
    assert.equal(editor.value, '');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});
