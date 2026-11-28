import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Audit, AuditDraft, Wiki } from '../app/api.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
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
  CustomEvent: window.CustomEvent,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { WikiPage } = await import('../app/pages/WikiPage.tsx');

const a: Wiki = {
  id: 'wiki-a',
  title: '合成知识甲',
  type: 'concept',
  domain: 'fmcg',
  category: 'industry_basics',
  aliases: [],
  tags: [],
  sources: [],
  body: '合成甲正文',
  revision: 1,
  created: '2026-11-28',
  updated: '2026-11-28',
  knowledge_status: 'needs_verification',
  review_status: 'reviewed',
  confidence: 'low',
  source_level: 'D',
  links: [],
};
const b: Wiki = { ...a, id: 'wiki-b', title: '合成知识乙', body: '合成乙正文' };
const schema = {
  types: [{ id: 'concept', label: '概念' }],
  categories: [{ id: 'industry_basics', label: '行业基础' }],
  pageTemplates: {},
  enums: {
    knowledge_status: ['needs_verification'],
    confidence: ['low'],
    source_level: ['D'],
    review_status: ['reviewed'],
  },
  sourcePolicy: { levels: [], guidance: '' },
};
const auditA: Audit = {
  id: 'audit-a',
  wikiId: a.id,
  scope: 'page',
  severity: 'suggestion',
  comment: '甲纠错反馈',
  anchor: { before: '', text: a.body, after: '' },
  pageBodySha256: 'synthetic',
  createdRevision: 1,
  revision: 3,
  createdAt: '2026-11-28',
  status: 'open',
  location: { status: 'found', start: 0, end: 6, method: 'exact' },
  decisionHistory: [],
};
const auditB: Audit = { ...auditA, id: 'audit-b', comment: '乙纠错反馈' };
const auditC: Audit = { ...auditA, id: 'audit-c', wikiId: b.id, comment: '另一页纠错反馈' };
const draftA: AuditDraft = {
  id: 'draft-a',
  auditId: auditA.id,
  revision: 4,
  status: 'pending',
  baseWikiRevision: 1,
  baseAuditRevision: 3,
  replacement: '甲替换预览',
  rationale: '合成建议',
  evidence: [],
  provider: { name: 'offline-fixture', model: 'synthetic' },
};
const draftB: AuditDraft = { ...draftA, id: 'draft-b', auditId: auditB.id, replacement: '乙替换预览' };
const reply = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function wait(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => {
      await tick(10);
    });
  }
  assert.fail(`等待超时：${label}`);
}
async function click(target: HTMLElement | undefined | null) {
  assert(target);
  await act(async () => {
    target.click();
    await tick();
  });
}
async function input(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      target instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value);
    target.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();
  });
}
const button = (container: ParentNode, text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === text);
const item = (container: ParentNode, page: Wiki) =>
  [...container.querySelectorAll<HTMLButtonElement>('.wiki-list-item')].find((node) =>
    node.textContent?.includes(page.title),
  );
const detail = (container: ParentNode) => container.querySelector('.wiki-detail')?.textContent ?? '';
const auditDetail = (container: ParentNode) => container.querySelector('.audit-detail')?.textContent ?? '';
const preview = (container: ParentNode) => container.querySelector<HTMLTextAreaElement>('.audit-draft textarea')!;

async function harness(count = 1) {
  const nativeFetch = globalThis.fetch;
  const calls: Array<{ route: string; method: string; body: unknown }> = [];
  let intercept: (route: string, method: string) => Promise<Response> | undefined = () => undefined;
  globalThis.fetch = async (url, init = {}) => {
    const route = String(url),
      method = init.method ?? 'GET';
    calls.push({ route, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const pending = intercept(route, method);
    if (pending) return pending;
    if (route === '/api/wiki/schema') return reply(schema);
    if (route.startsWith('/api/raw?') || route.startsWith('/api/drafts?') || route === '/api/knowledge/workflows')
      return reply({ items: [] });
    if (route.startsWith('/api/wiki?')) return reply({ items: [a, b], categoryCounts: { industry_basics: 2 } });
    if (route === '/api/wiki/wiki-a') return reply(a);
    if (route === '/api/wiki/wiki-b') return reply(b);
    if (route.endsWith('/references')) return reply({ items: [] });
    if (route.startsWith('/api/audits?')) return reply({ items: route.endsWith(a.id) ? [auditA, auditB] : [auditC] });
    if (route === '/api/audits/audit-a') return reply({ audit: auditA, draft: draftA, conflicts: [] });
    if (route === '/api/audits/audit-b') return reply({ audit: auditB, draft: draftB, conflicts: [] });
    if (route === '/api/audits/audit-c') return reply({ audit: auditC, draft: null, conflicts: [] });
    assert.fail(`未预期的请求：${method} ${route}`);
  };
  const mounts = Array.from({ length: count }, () => {
    const container = window.document.createElement('div');
    window.document.body.append(container);
    return { container, root: createRoot(container), mounted: true };
  });
  await act(async () => {
    for (const mount of mounts)
      mount.root.render(createElement(WikiPage, { onOpenRaw: () => {}, onChanged: () => {} }));
    await tick();
  });
  const unmount = async (index: number) => {
    await act(async () => {
      mounts[index].root.unmount();
      mounts[index].mounted = false;
      await tick();
    });
  };
  return {
    mounts,
    calls,
    intercept: (next: typeof intercept) => {
      intercept = next;
    },
    unmount,
    clean: async () => {
      for (let index = 0; index < mounts.length; index++) if (mounts[index].mounted) await unmount(index);
      for (const mount of mounts) mount.container.remove();
      globalThis.fetch = nativeFetch;
    },
  };
}

test('FE05 delete preflight deduplicates and ignores an old selection, then permits the new selection', async () => {
  const f = await harness(),
    container = f.mounts[0].container,
    pending = deferred<Response>();
  try {
    await wait(() => detail(container).includes(a.body), '甲详情');
    f.intercept((route) => (route === '/api/wiki/wiki-a/references' ? pending.promise : undefined));
    await click(button(container, '删除'));
    await click(button(container, '删除'));
    assert.equal(f.calls.filter((call) => call.route === '/api/wiki/wiki-a/references').length, 1);
    await click(item(container, b));
    await wait(() => detail(container).includes(b.body), '乙详情');
    await act(async () => {
      pending.resolve(reply({ items: [{ id: 'incoming', title: '旧入链' }] }));
      await tick();
    });
    assert.equal(container.querySelector('[role="dialog"]'), null);
    await click(button(container, '删除'));
    await wait(() => !!container.querySelector('[role="dialog"]'), '乙删除确认');
    assert(container.querySelector('[role="dialog"]')!.textContent!.includes(`删除“${b.title}”`));
    assert.equal(f.calls.filter((call) => call.route === '/api/wiki/wiki-b/references').length, 1);
  } finally {
    pending.resolve(reply({ items: [] }));
    await f.clean();
  }
});

test('FE05 late Audit detail cannot replace another Audit or survive the keyed Wiki boundary', async () => {
  const f = await harness(),
    container = f.mounts[0].container,
    pending = deferred<Response>();
  try {
    await wait(() => detail(container).includes(a.body), '甲详情');
    await click(container.querySelector<HTMLElement>('.audit-toggle'));
    f.intercept((route) => (route === '/api/audits/audit-a' ? pending.promise : undefined));
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.audit-row')].find((node) =>
        node.textContent!.includes(auditA.comment),
      ),
    );
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.audit-row')].find((node) =>
        node.textContent!.includes(auditB.comment),
      ),
    );
    await wait(() => auditDetail(container).includes(auditB.comment), '乙 Audit');
    await act(async () => {
      pending.resolve(reply({ audit: auditA, draft: draftA, conflicts: [] }));
      await tick();
    });
    assert(auditDetail(container).includes(auditB.comment));
    assert.equal(preview(container).value, draftB.replacement);
    const crossPage = deferred<Response>();
    f.intercept((route) => (route === '/api/audits/audit-a' ? crossPage.promise : undefined));
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.audit-row')].find((node) =>
        node.textContent!.includes(auditA.comment),
      ),
    );
    await click(item(container, b));
    await wait(() => detail(container).includes(b.body), '切换 Wiki');
    await click(container.querySelector<HTMLElement>('.audit-toggle'));
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.audit-row')].find((node) =>
        node.textContent!.includes(auditC.comment),
      ),
    );
    await wait(() => auditDetail(container).includes(auditC.comment), '另一页 Audit');
    await act(async () => {
      crossPage.resolve(reply({ audit: auditA, draft: draftA, conflicts: [] }));
      await tick();
    });
    assert(auditDetail(container).includes(auditC.comment));
    assert.equal(container.querySelector('.audit-draft'), null);
  } finally {
    pending.resolve(reply({ audit: auditA, draft: draftA, conflicts: [] }));
    await f.clean();
  }
});

test('FE05 Audit draft PATCH uses its revision and a delayed readback leaves the newer Audit preview intact', async () => {
  const f = await harness(),
    container = f.mounts[0].container,
    readback = deferred<Response>();
  const saved = { ...draftA, revision: 5, replacement: '人工编辑甲预览' };
  try {
    await wait(() => detail(container).includes(a.body), '甲详情');
    await click(container.querySelector<HTMLElement>('.audit-toggle'));
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.audit-row')].find((node) =>
        node.textContent!.includes(auditA.comment),
      ),
    );
    await wait(() => !!container.querySelector('.audit-draft'), '甲草稿');
    await input(preview(container), saved.replacement);
    f.intercept((route, method) =>
      route === '/api/audit-drafts/draft-a'
        ? method === 'PATCH'
          ? Promise.resolve(reply({ draft: saved }))
          : readback.promise
        : undefined,
    );
    await click(button(container, '保存草稿'));
    await wait(
      () => f.calls.some((call) => call.route === '/api/audit-drafts/draft-a' && call.method === 'GET'),
      '草稿读回',
    );
    assert.deepEqual(
      f.calls.find((call) => call.route === '/api/audit-drafts/draft-a' && call.method === 'PATCH')!.body,
      { baseRevision: 4, replacement: saved.replacement },
    );
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('.audit-row')].find((node) =>
        node.textContent!.includes(auditB.comment),
      ),
    );
    await wait(() => auditDetail(container).includes(auditB.comment), '乙 Audit');
    await act(async () => {
      readback.resolve(reply({ draft: saved }));
      await tick();
    });
    assert.equal(preview(container).value, draftB.replacement);
    assert(!auditDetail(container).includes('草稿已保存并读回'));
    assert.equal(f.calls.filter((call) => call.method === 'PUT' || call.route.endsWith('/resolve')).length, 0);
  } finally {
    readback.resolve(reply({ draft: saved }));
    await f.clean();
  }
});

test('FE05 two WikiPage instances keep independent selection and editing, and unmount removes refresh subscriptions', async () => {
  const f = await harness(2),
    left = f.mounts[0].container,
    right = f.mounts[1].container;
  try {
    await wait(() => detail(left).includes(a.body) && detail(right).includes(a.body), '两个甲详情');
    await click(item(right, b));
    await wait(() => detail(right).includes(b.body), '右乙详情');
    await click(button(left, '编辑'));
    const title = left.querySelector<HTMLInputElement>('.wiki-editor input')!;
    await input(title, '仅左实例的未保存编辑');
    assert.equal(left.querySelector<HTMLInputElement>('.wiki-editor input')!.value, '仅左实例的未保存编辑');
    assert.equal(right.querySelector('.wiki-editor'), null);
    assert(detail(right).includes(b.body));
    await f.unmount(0);
    const before = f.calls.length;
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent('wiki:refresh'));
      await tick();
    });
    assert.deepEqual(
      f.calls.slice(before).map((call) => call.route),
      ['/api/wiki/wiki-b'],
    );
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent('wiki:new'));
      await tick();
    });
    assert.equal(right.querySelector<HTMLInputElement>('.wiki-editor input')!.value, '');
  } finally {
    await f.clean();
  }
});
