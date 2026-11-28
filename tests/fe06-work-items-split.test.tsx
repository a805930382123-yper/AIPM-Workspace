import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { WorkItem } from '../app/api.ts';

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
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { WorkItemsPage } = await import('../app/pages/WorkItemsPage.tsx');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const customer: WorkItem = {
  id: 'c',
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  title: '客户事项',
  kind: 'customer_issue',
  status: 'triage',
  feedback: '反馈',
  rawIds: [],
  history: [],
  screenshots: [],
  reportDraft: '',
};
const product: WorkItem = {
  id: 'p',
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  title: '产品事项',
  kind: 'product_analysis',
  status: 'triage',
  analysis: { goal: '目标', dataScope: '范围', confirmedConclusions: '', openQuestions: '' },
  rawIds: [],
  history: [],
  screenshots: [],
};
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
async function value(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    const proto =
      el instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
  });
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.fail('timed out');
}
async function mount(initialId: string | null, changed: () => void) {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WorkItemsPage, { initialId, raws: [], onOpenRaw: () => {}, onChanged: changed }));
    await tick();
  });
  return { container, root };
}
function field(container: ParentNode, label: string) {
  const found = [...container.querySelectorAll('label')].find((el) => el.textContent?.includes(label));
  assert.ok(found, label);
  const input = found.querySelector('input,textarea');
  assert.ok(input, label);
  return input as HTMLInputElement | HTMLTextAreaElement;
}

test('两类创建准确发送数据，失败保留输入并可重试', async () => {
  const original = globalThis.fetch;
  const requests: unknown[] = [];
  let fail = true;
  let changed = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === '/api/work-items' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if (fail) {
        fail = false;
        return json({ error: { message: '创建失败' } }, 500);
      }
      return json(body.kind === 'product_analysis' ? product : customer);
    }
    if (url.endsWith('/analysis-runs')) return json({ items: [] });
    return json({ items: [] });
  }) as typeof fetch;
  const { container, root } = await mount(null, () => changed++);
  try {
    await waitFor(() => container.textContent!.includes('还没有工作事项'));
    await click(button(container, '新建客户问题'));
    await value(container.querySelector('input')!, '客户标题');
    await value(container.querySelector('textarea')!, '客户反馈');
    await click(button(container, '创建事项'));
    assert.match(container.textContent!, /创建失败/);
    assert.equal(container.querySelector('input')!.value, '客户标题');
    assert.equal(container.querySelector('textarea')!.value, '客户反馈');
    assert.equal(button(container, '创建事项').disabled, false);
    await click(button(container, '创建事项'));
    assert.match(container.textContent!, /客户事项/);
    assert.equal(changed, 1);
    await click(button(container, '返回工作事项'));
    await click(button(container, '新建产品分析'));
    await value(container.querySelector('input')!, '分析标题');
    await value(container.querySelector('textarea')!, '分析目标');
    await click(button(container, '创建事项'));
    assert.match(container.textContent!, /产品事项/);
    assert.equal(changed, 2);
    assert.deepEqual(requests, [
      { title: '客户标题', feedback: '客户反馈' },
      { title: '客户标题', feedback: '客户反馈' },
      { kind: 'product_analysis', title: '分析标题', goal: '分析目标' },
    ]);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});

test('迟到详情响应不覆盖新选择或卸载后的实例', async () => {
  const original = globalThis.fetch;
  let resolveA!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveA = resolve;
  });
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === '/api/work-items') return json({ items: [customer, product] });
    if (url.endsWith('/c')) return pending;
    if (url.endsWith('/p')) return json(product);
    if (url.endsWith('/analysis-runs')) return json({ items: [] });
    throw new Error(url);
  }) as typeof fetch;
  const { container, root } = await mount(null, () => {});
  try {
    await waitFor(() => container.querySelectorAll('.work-list-row').length === 2);
    await click(button(container, '客户事项客户问题待整理'));
    await click(button(container, '返回工作事项'));
    await waitFor(() => container.querySelectorAll('.work-list-row').length === 2);
    await click(button(container, '产品事项产品分析待开始'));
    await waitFor(() => container.querySelector('h1')?.textContent === '产品事项');
    await act(async () => {
      resolveA(json(customer));
      await tick();
    });
    assert.equal(container.querySelector('h1')?.textContent, '产品事项');
    await act(async () => root.unmount());
  } finally {
    globalThis.fetch = original;
  }
});

test('卸载后的详情迟到响应不改变新挂载页面', async () => {
  const original = globalThis.fetch;
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  globalThis.fetch = (async (input) =>
    String(input).endsWith('/c') ? pending : json({ items: [product] })) as typeof fetch;
  const first = await mount('c', () => {});
  await act(async () => first.root.unmount());
  const second = await mount(null, () => {});
  try {
    await waitFor(() => second.container.textContent!.includes('产品事项'));
    await act(async () => {
      resolve(json(customer));
      await tick();
    });
    assert.ok(second.container.textContent!.includes('产品事项'));
    assert.ok(!second.container.textContent!.includes('客户事项'));
  } finally {
    await act(async () => second.root.unmount());
    globalThis.fetch = original;
  }
});

test('冲突读回后保留产品脏字段、刷新未改字段并以新版本保存', async () => {
  const original = globalThis.fetch;
  let reads = 0;
  let changed = 0;
  const writes: Array<{ baseRevision: number; waitingFor: string; analysis: { goal: string; dataScope: string } }> = [];
  const latest = {
    ...product,
    revision: 2,
    waitingFor: '最新等待',
    nextStep: '最新下一步',
    analysis: { ...product.analysis!, goal: '最新目标', dataScope: '最新范围' },
  };
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/analysis-runs')) return json({ items: [] });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      return writes.length === 1
        ? json({ error: { code: 'REVISION_CONFLICT', message: '版本冲突' } }, 409)
        : json({ ...latest, ...body, revision: 3 });
    }
    if (url.endsWith('/p')) return json(reads++ === 0 ? product : latest);
    throw new Error(url);
  }) as typeof fetch;
  const { container, root } = await mount('p', () => changed++);
  try {
    await waitFor(() => !!container.querySelector('#work-goal'));
    await value(field(container, '等谁／等什么'), '我的等待');
    await value(container.querySelector('#work-goal')!, '我的目标');
    await click(button(container, '保存当前情况'));
    assert.equal(changed, 0);
    await click(button(container, '重新读取最新版本'));
    assert.equal(changed, 1);
    assert.equal(field(container, '等谁／等什么').value, '我的等待');
    assert.equal(field(container, '下一步（选填）').value, '最新下一步');
    assert.equal((container.querySelector('#work-goal') as HTMLTextAreaElement).value, '我的目标');
    assert.equal((container.querySelector('#work-data-scope') as HTMLTextAreaElement).value, '最新范围');
    await click(button(container, '保存当前情况'));
    assert.equal(writes[1].baseRevision, 2);
    assert.equal(writes[1].waitingFor, '我的等待');
    assert.equal(writes[1].analysis.goal, '我的目标');
    assert.equal(writes[1].analysis.dataScope, '最新范围');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});

test('建议先预览，冲突后重新读取并保留客户报告草稿和脏跟进字段', async () => {
  const original = globalThis.fetch;
  let reads = 0;
  let changed = 0;
  const writes: Array<Record<string, unknown>> = [];
  const initial = {
    ...customer,
    nextStep: '',
    waitingFor: '',
    history: [{ kind: 'sent', at: '2026-01-01T00:00:00Z', sentAt: '2026-01-01T00:00:00Z', body: '已发送' }],
  };
  const latest = { ...initial, revision: 2, customer: '最新客户', reportDraft: '远端报告' };
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      return writes.length === 1
        ? json({ error: { code: 'REVISION_CONFLICT', message: '版本冲突' } }, 409)
        : json({ ...latest, ...body, revision: 3 });
    }
    if (String(input).endsWith('/c')) return json(reads++ === 0 ? initial : latest);
    throw new Error(String(input));
  }) as typeof fetch;
  const { container, root } = await mount('c', () => changed++);
  try {
    await waitFor(() => container.textContent!.includes('预览建议'));
    await value(field(container, '下一步（选填）'), '我的下一步');
    const report = [...container.querySelectorAll('textarea')].find((el) =>
      el.closest('form')?.textContent?.includes('技术反馈'),
    )!;
    assert.ok(report);
    await value(report, '我的报告');
    await click(button(container, '预览建议'));
    assert.equal(writes.length, 0);
    await click(button(container, '应用建议'));
    assert.deepEqual(writes[0], { baseRevision: 1, status: 'waiting', waitingFor: '技术' });
    assert.equal(changed, 0);
    assert.match(container.textContent!, /版本已变化/);
    await click(button(container, '重新读取最新版本'));
    assert.equal(report.value, '我的报告');
    assert.equal(field(container, '下一步（选填）').value, '我的下一步');
    assert.equal(field(container, '客户（选填）').value, '最新客户');
    assert.ok(button(container, '预览建议'));
    await click(button(container, '预览建议'));
    await click(button(container, '应用建议'));
    assert.deepEqual(writes[1], { baseRevision: 2, status: 'waiting', waitingFor: '技术' });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});
