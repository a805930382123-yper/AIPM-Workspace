import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
});
for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AutomationPage } = await import('../app/pages/AutomationPage');
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const error = (message: string) => json({ error: { message } }, 500);
const deferred = () => {
  let resolve!: (r: Response) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<Response>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const status = {
  paused: false,
  scheduler: { healthy: true },
  instance: { mode: 'production', pid: 1, port: 1 },
  nextRunAt: null,
  failuresLast24Hours: 0,
  writeToken: 'test',
};
const schedule = {
  type: 'news.daily',
  name: '资讯计划',
  enabled: true,
  plan: { kind: 'daily', time: '07:30', timezone: 'Asia/Shanghai' },
  catchUp: true,
  revision: 1,
  budget: null,
  nextRunAt: null,
  lastRun: null,
  mayCallModel: false,
  allowsCatchUp: true,
};
const props = { onOpenRaw: () => {}, onOpenDraft: () => {} };
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};

test('polling waits for completion, preserves independent errors, and cleans up stale lifecycles', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let nextTimer = 10000;
  globalThis.setTimeout = ((fn: () => void, delay?: number) =>
    delay === 3000 ? (timers.set(++nextTimer, fn), nextTimer) : originalSetTimeout(fn, delay)) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    if (timers.has(Number(id))) timers.delete(Number(id));
    else originalClearTimeout(id);
  }) as typeof clearTimeout;
  const calls: { path: string; signal: AbortSignal }[] = [];
  const heldStatus = deferred();
  const oldDetail = deferred();
  const oldFailure = deferred();
  const health = deferred();
  let statusCount = 0;
  let runsCount = 0;
  let detailCount = 0;
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    const signal = init!.signal as AbortSignal;
    calls.push({ path, signal });
    if (path.endsWith('/status')) {
      statusCount++;
      return statusCount === 1 ? heldStatus.promise : json(status);
    }
    if (path.endsWith('/schedules')) return statusCount === 1 ? error('计划故障') : json({ items: [schedule] });
    if (path.includes('/runs?')) {
      runsCount++;
      return runsCount === 2
        ? error('历史故障')
        : json({
            items: [
              {
                id: 'r',
                type: runsCount === 1 ? '旧记录' : '新记录',
                status: 'succeeded',
                trigger: 'manual',
                scheduledAt: null,
              },
            ],
          });
    }
    if (path.endsWith('/runs/old')) {
      detailCount++;
      return oldDetail.promise;
    }
    if (path.endsWith('/runs/new')) return error('新详情故障');
    if (path.endsWith('/runs/old-failure')) return oldFailure.promise;
    if (path.endsWith('/runs/final')) return error('最终详情故障');
    if (path.endsWith('/knowledge-health')) return health.promise;
    if (path.endsWith('/candidates')) return json({ counts: { pending: 0 }, items: [] });
    if (path.endsWith('/pipeline/settings')) return json({ topics: [] });
    throw new Error(`Unexpected ${path}`);
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  const render = async (extra: object = {}) => {
    await act(async () => root.render(createElement(AutomationPage, { ...props, ...extra })));
    await flush();
  };
  const advance = async () => {
    const due = [...timers.values()];
    timers.clear();
    await act(async () => {
      due.forEach((fn) => fn());
    });
    await flush();
  };
  try {
    await render({ initialTab: 'runs', initialRunId: 'old', onOpenLint: () => {} });
    assert.equal(statusCount, 1);
    assert.equal(detailCount, 1);
    await advance();
    assert.equal(statusCount, 1, 'slow status request must not overlap');
    assert.equal(detailCount, 1, 'slow detail request must not overlap');
    assert.match(document.body.textContent!, /历史故障/);
    assert.match(document.body.textContent!, /旧记录/);
    heldStatus.resolve(json(status));
    await flush();
    assert.match(document.body.textContent!, /调度器正常/);
    await render({ initialTab: 'runs', initialRunId: 'new' });
    assert.equal(calls.find((c) => c.path.endsWith('/runs/old'))!.signal.aborted, true);
    assert.equal(calls.find((c) => c.path.endsWith('/knowledge-health'))!.signal.aborted, true);
    assert.match(document.body.textContent!, /新详情故障/);
    oldDetail.resolve(json({ id: 'old' }));
    health.reject(new Error('过期健康错误'));
    await flush();
    assert.match(document.body.textContent!, /新详情故障/);
    assert.doesNotMatch(document.body.textContent!, /过期健康错误/);
    await render({ initialTab: 'runs', initialRunId: 'old-failure' });
    await render({ initialTab: 'runs', initialRunId: 'final' });
    assert.equal(calls.find((c) => c.path.endsWith('/runs/old-failure'))!.signal.aborted, true);
    oldFailure.reject(new Error('过期详情错误'));
    await flush();
    assert.match(document.body.textContent!, /最终详情故障/);
    assert.doesNotMatch(document.body.textContent!, /过期详情错误/);
    await advance();
    assert.equal(statusCount, 2);
    assert.doesNotMatch(document.body.textContent!, /历史故障/);
    assert.match(document.body.textContent!, /新记录/);
    assert.equal(calls.filter((c) => c.path.endsWith('/pipeline/settings')).length, 1);
    await advance();
    assert.equal(calls.filter((c) => c.path.endsWith('/pipeline/settings')).length, 1, 'settings is a one-shot read');
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
    assert.ok(calls.every((c) => c.signal.aborted));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('status and schedules allSettled show partial success and recover independently', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let id = 20000;
  let round = 0;
  globalThis.setTimeout = ((fn: () => void, delay?: number) =>
    delay === 3000 ? (timers.set(++id, fn), id) : originalSetTimeout(fn, delay)) as typeof setTimeout;
  globalThis.clearTimeout = ((value: ReturnType<typeof setTimeout>) => {
    if (timers.has(Number(value))) timers.delete(Number(value));
    else originalClearTimeout(value);
  }) as typeof clearTimeout;
  globalThis.fetch = (async (input) => {
    const path = String(input);
    if (path.endsWith('/status')) {
      round++;
      return json(status);
    }
    if (path.endsWith('/schedules')) return round === 1 ? error('计划故障') : json({ items: [] });
    if (path.includes('/runs?')) return json({ items: [] });
    throw new Error(path);
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(AutomationPage, props)));
    await flush();
    assert.match(document.body.textContent!, /调度器正常/);
    assert.match(document.body.textContent!, /计划故障/);
    const due = [...timers.values()];
    timers.clear();
    await act(async () => {
      due.forEach((fn) => fn());
    });
    await flush();
    assert.doesNotMatch(document.body.textContent!, /计划故障/);
    assert.match(document.body.textContent!, /调度器正常/);
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
