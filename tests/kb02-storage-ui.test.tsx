import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ExtractionJob, Raw, RawProcessingState } from '../app/api.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';
import { atomicFault } from './support/kb02-storage-fault.ts';

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
for (const [name, value] of Object.entries({ window: w, document: w.document, navigator: w.navigator, HTMLElement: w.HTMLElement, HTMLInputElement: w.HTMLInputElement, HTMLTextAreaElement: w.HTMLTextAreaElement, HTMLSelectElement: w.HTMLSelectElement, MouseEvent: w.MouseEvent, Event: w.Event, Node: w.Node, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawPage } = await import('../app/pages/RawPage.tsx');
const { App } = await import('../app/App.tsx');
const nativeFetch = globalThis.fetch;
const button = (label: string) => [...w.document.querySelectorAll('button')].find(x => x.textContent?.trim() === label);
async function tick(check: () => boolean, label: string) {
  const deadline = performance.now() + 6_000;
  while (performance.now() < deadline) { await act(async () => { await new Promise(r => setTimeout(r, 15)); }); if (check()) return; }
  assert.fail('UI deadline: ' + label);
}
async function click(value: HTMLButtonElement | undefined) { assert.ok(value); assert.equal(value.disabled, false); await act(async () => { value.click(); await new Promise(r => setTimeout(r, 0)); }); }

test('SR01 React and actual HTTP show persistent failure, retry only storage, and survive refresh', async () => {
  const f = await storageFixture(), h = await storageHttp(f), fault = atomicFault(f.root, 'done-checkpoint');
  let root: ReturnType<typeof createRoot> | undefined;
  const requests: string[] = []; let opened = '';
  globalThis.fetch = async (url, init) => { requests.push(String(url)); return nativeFetch(String(url).startsWith('/api/') ? h.base + url : url, init); };
  try {
    f.succeed(); const job = (await f.start()).job; await f.runner.waitForSettlement(job.id);
    const calls = f.requests.length;
    const initialState = (await h.request('/api/raw-processing')).json.items[0] as RawProcessingState;
    function Harness() {
      const [state, setState] = useState(initialState), [view, setView] = useState<ExtractionJob | null>(null);
      return createElement(RawPage, { items: [f.raw as Raw], selectedId: f.raw.id, onSelected: () => {}, onOpenImport: () => {}, onCommitted: async () => {}, openImport: false, onCloseImport: () => {}, onDeleted: async () => {}, processing: { [f.raw.id]: state }, job: view, onJobStarted: setView, onOpenDraft: id => { opened = id; }, onRefresh: async () => { setState((await h.request('/api/raw-processing')).json.items[0]); } });
    }
    const mount = async () => { root = createRoot(w.document.getElementById('root')!); await act(async () => { root!.render(createElement(Harness)); }); await tick(() => !!button('重试保存状态'), 'recovery action'); };
    await mount(); assert.match(w.document.body.textContent!, /任务已停止，状态保存失败/u); assert.match(w.document.body.textContent!, /不会重新调用模型/u);
    assert.equal(button('取消整理'), undefined); assert.equal(button('继续审核'), undefined);
    await click(button('重试保存状态')); await tick(() => !!w.document.querySelector('.form-error'), 'persistent error'); assert.equal(f.requests.length, calls);
    await act(async () => { root!.unmount(); }); root = undefined; await mount(); assert.equal(f.requests.length, calls);
    fault.release(); await click(button('重试保存状态')); await tick(() => !!button('继续审核'), 'saved draft');
    assert.equal(button('重试保存状态'), undefined); await click(button('继续审核')); assert.ok(opened);
    assert.equal(f.requests.length, calls); assert.equal((await f.drafts.list()).length, 1);
    assert.equal(requests.filter(x => x.endsWith('/extract')).length, 0); assert.equal(requests.filter(x => x.endsWith('/reconcile-storage')).length, 2);
  } finally { if (root) await act(async () => { root!.unmount(); }); globalThis.fetch = nativeFetch; fault.restore(); await h.close(); await f.clean(); }
});

test('SR01 App polls execution running despite disk failed until recovery button becomes actionable', async () => {
  const f = await storageFixture(), h = await storageHttp(f), fault = atomicFault(f.root, 'failed-job');
  let root: ReturnType<typeof createRoot> | undefined, jobReads = 0;
  try {
    const job = (await f.start()).job; await f.runner.waitForSettlement(job.id);
    globalThis.fetch = async (url, init) => {
      const route = String(url);
      if (route === '/api/raw') return new Response(JSON.stringify({ items: [f.raw] }));
      if (route === '/api/stats') return new Response(JSON.stringify({ rawCount: 1, wikiCount: 0, thisWeekNewCount: 1, pendingConfirmationCount: 0, openAuditCount: 0, promptCount: 0, weekStartsOn: '' }));
      if (route === '/api/recovery' || route === '/api/knowledge/workflows') return new Response(JSON.stringify({ items: [] }));
      const response = await nativeFetch(route.startsWith('/api/') ? h.base + route : url, init);
      if (route === `/api/extraction-jobs/${job.id}`) {
        const value = await response.json(); jobReads++;
        return new Response(JSON.stringify({ ...value, status: 'failed', execution: jobReads <= 2 ? 'running' : 'settled' }), { status: response.status });
      }
      return response;
    };
    root = createRoot(w.document.getElementById('root')!); await act(async () => { root!.render(createElement(App)); });
    await tick(() => [...w.document.querySelectorAll('button')].some(x => x.textContent?.includes('Raw 原始资料')), 'navigation');
    const nav = [...w.document.querySelectorAll('button')].find(x => x.textContent?.includes('Raw 原始资料')); await click(nav);
    await tick(() => !!button('重试保存状态') && button('重试保存状态')!.disabled === false, 'settled after further polls');
    assert.ok(jobReads >= 3); assert.equal(f.requests.length, 2);
  } finally { if (root) await act(async () => { root!.unmount(); }); globalThis.fetch = nativeFetch; fault.restore(); await h.close(); await f.clean(); }
});

test('SR01 start failure reload is actionable and late storage response cannot change a different Raw selection', async () => {
  const f = await storageFixture(), h = await storageHttp(f), fault = atomicFault(f.root, 'start-state');
  let root: ReturnType<typeof createRoot> | undefined, release!: () => void, started!: () => void, callbackCount = 0;
  const seen = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const failed = await h.request(`/api/raw/${f.raw.id}/extract`, {}); assert.equal(failed.status, 503);
    const other = await f.rawStore.create({ title: '另一个虚构Raw', sourceType: 'report', sourceName: '隔离', body: '另一个事实。', tags: [] });
    const state = (await h.request('/api/raw-processing')).json.items[0] as RawProcessingState;
    globalThis.fetch = async (url, init) => {
      const response = await nativeFetch(String(url).startsWith('/api/') ? h.base + url : url, init);
      if (String(url).endsWith('/reconcile-storage')) { started(); await gate; }
      return response;
    };
    const props = { items: [f.raw as Raw, other as Raw], selectedId: f.raw.id, onSelected: () => {}, onOpenImport: () => {}, onCommitted: async () => {}, openImport: false, onCloseImport: () => {}, onDeleted: async () => {}, processing: { [f.raw.id]: state }, job: null, onJobStarted: () => { callbackCount++; }, onOpenDraft: () => { callbackCount++; }, onRefresh: async () => {} };
    root = createRoot(w.document.getElementById('root')!); await act(async () => { root!.render(createElement(RawPage, props)); });
    await tick(() => !!button('重试保存状态'), 'start-state recovery on reload'); assert.equal(button('AI 整理知识')?.disabled, true);
    fault.release(); await click(button('重试保存状态')); await seen;
    await act(async () => { root!.render(createElement(RawPage, { ...props, selectedId: other.id, selectionGeneration: 1 })); });
    release(); await act(async () => { await new Promise(r => setTimeout(r, 60)); });
    assert.equal(callbackCount, 0); assert.equal(button('重试保存状态'), undefined); assert.equal(w.document.querySelector('.raw-detail h2')?.textContent, other.title); assert.equal(f.requests.length, 0);
  } finally { release(); if (root) await act(async () => { root!.unmount(); }); globalThis.fetch = nativeFetch; fault.restore(); await h.close(); await f.clean(); }
});

test('SR01 App recovers coverage storage failure then polls same-job explicit planning retry through draft review', async () => {
  const f = await storageFixture(), h = await storageHttp(f), fault = atomicFault(f.root, 'coverage-checkpoint');
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    const job = (await f.start()).job; await f.runner.waitForSettlement(job.id);
    globalThis.fetch = async (url, init) => {
      const route = String(url);
      if (route === '/api/raw') return new Response(JSON.stringify({ items: [f.raw] }));
      if (route === '/api/stats') return new Response(JSON.stringify({ rawCount: 1, wikiCount: 0, thisWeekNewCount: 1, pendingConfirmationCount: 0, openAuditCount: 0, promptCount: 0, weekStartsOn: '' }));
      if (route === '/api/recovery-issues' || route === '/api/knowledge/workflows') return new Response(JSON.stringify({ items: [] }));
      return nativeFetch(route.startsWith('/api/') ? h.base + route : url, init);
    };
    root = createRoot(w.document.getElementById('root')!); await act(async () => { root!.render(createElement(App)); });
    await tick(() => !![...w.document.querySelectorAll('button')].find(x => x.textContent?.includes('Raw 原始资料')), 'navigation');
    await click([...w.document.querySelectorAll('button')].find(x => x.textContent?.includes('Raw 原始资料')));
    await tick(() => !!button('重试保存状态'), 'storage recovery'); fault.release(); await click(button('重试保存状态'));
    await tick(() => !!button('仅重新规划（带覆盖诊断）'), 'recovered business failure');
    // Allow the recovered failed status to settle the old poll before continuing the same id.
    await act(async () => { await new Promise(r => setTimeout(r, 1600)); });
    f.succeed(); await click(button('仅重新规划（带覆盖诊断）'));
    await tick(() => !!w.document.querySelector('.draft-page h1')?.textContent?.includes('审核'), 'same-job completed opens draft');
    assert.equal((await f.jobs.get(job.id))?.status, 'completed'); assert.equal(f.requests.length, 3); assert.equal((await f.jobs.list()).length, 1);
  } finally { if (root) await act(async () => { root!.unmount(); }); globalThis.fetch = nativeFetch; fault.restore(); await h.close(); await f.clean(); }
});

test('F-SR01-01 React refresh selects new recovery id over old failed job and saves without regenerating', async () => {
  const f = await storageFixture(); let h: Awaited<ReturnType<typeof storageHttp>> | undefined;
  let fault: ReturnType<typeof atomicFault> | undefined, root: ReturnType<typeof createRoot> | undefined;
  const routes: string[] = [];
  let refreshed = false;
  try {
    const old = (await f.start()).job; await f.wait(old.id);
    fault = atomicFault(f.root, 'start-state'); h = await storageHttp(f);
    const failed = await h.request(`/api/raw/${f.raw.id}/extract`, { restart: true }); assert.equal(failed.status, 503);
    const id = failed.json.error.details.jobId; assert.ok(id); assert.notEqual(id, old.id);
    const calls = f.requests.length;
    const state = (await h.request('/api/raw-processing')).json.items.find((item: RawProcessingState) => item.rawId === f.raw.id) as RawProcessingState;
    assert.equal(state.jobId, old.id); assert.equal(state.recoveryJobId, id);
    globalThis.fetch = async (url, init) => { routes.push(String(url)); return nativeFetch(String(url).startsWith('/api/') ? h!.base + url : url, init); };
    function Harness() {
      const [processing, setProcessing] = useState(state), [view, setView] = useState<ExtractionJob | null>(null);
      return createElement(RawPage, { items: [f.raw as Raw], selectedId: f.raw.id, onSelected: () => {}, onOpenImport: () => {}, onCommitted: async () => {}, openImport: false, onCloseImport: () => {}, onDeleted: async () => {}, processing: { [f.raw.id]: processing }, job: view, onJobStarted: setView, onOpenDraft: () => assert.fail('No draft exists before regeneration'), onRefresh: async () => { setProcessing((await h!.request('/api/raw-processing')).json.items.find((item: RawProcessingState) => item.rawId === f.raw.id)); refreshed = true; } });
    }
    root = createRoot(w.document.getElementById('root')!); await act(async () => { root!.render(createElement(Harness)); });
    await tick(() => !!button('重试保存状态') && !button('重试保存状态')!.disabled, 'old-bound restart recovery');
    assert.ok(routes.includes(`/api/extraction-jobs/${id}`)); assert.equal(routes.includes(`/api/extraction-jobs/${old.id}`), false);
    assert.equal(button('显式继续提取')?.disabled, true); assert.equal(button('明确重新生成')?.disabled, true);
    fault.release(); await click(button('重试保存状态'));
    await tick(() => refreshed && !button('重试保存状态') && !button('正在保存状态…') && button('显式继续提取')?.disabled === false, 'storage settled');
    assert.equal((await f.jobs.get(id))?.status, 'failed'); assert.equal((await f.rawStates.get(f.raw.id)).jobId, id);
    assert.equal(f.requests.length, calls); assert.equal((await f.drafts.list()).length, 0);
    assert.equal(routes.filter(route => route.endsWith('/reconcile-storage')).length, 1); assert.equal(routes.filter(route => route.endsWith('/extract')).length, 0);
  } finally { if (root) await act(async () => { root!.unmount(); }); globalThis.fetch = nativeFetch; fault?.restore(); await h?.close(); await f.clean(); }
});
