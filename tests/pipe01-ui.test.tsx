import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { AutomationSchedule, AutomationStatus, CandidateList, CandidateView, ConfirmCandidates } from '../app/api';

const { window } = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/', pretendToBeVisual: true });
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator, Event: window.Event,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AutomationPage } = await import('../app/pages/AutomationPage');

const date = '2026-11-16';
const due = '2026-11-16T02:00:00.000Z';
const status: AutomationStatus = {
  paused: false, scheduler: { healthy: true, lastTickAt: due },
  instance: { pid: 42, port: 14643, mode: 'production', startedAt: due, hostname: 'fixture' },
  nextRunAt: due, failuresLast24Hours: 0, writeToken: 'fixture-token',
};
const schedule: AutomationSchedule = {
  type: 'news.daily', name: '每日资讯准备与预筛', enabled: true, plan: { kind: 'daily', time: '07:30', timezone: 'Asia/Shanghai' },
  catchUp: true, revision: 1, budget: null, nextRunAt: due, lastRun: null, mayCallModel: true, allowsCatchUp: true,
};

const rows: CandidateView[] = ['低分资讯', '标准资讯', '未预筛资讯'].map((title, idx) => {
  const id = `${date}/fmcg/news-${idx}`;
  return {
    id, section: 'fmcg', disposition: 'inbox',
    item: { id: 'news-' + idx, title, sourceId: 'sample', sourceName: '合成来源', url: 'https://example.test/' + idx,
      publishedAt: date, fetchedAt: due, excerpt: '原样来源材料。', evidenceKind: idx === 1 ? 'source_summary' : 'article_excerpt' },
    screening: idx === 2 ? { error: '本批读取失败。' } : {
      score: { candidateId: id, relevance: idx === 0 ? 0 : 3, reason: '相关性理由。', categories: ['品类'], suggestedMode: 'deep' },
    },
  };
});
const when = async (check: () => unknown) => {
  for (let n = 0; n < 50; n++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail('未找到预期的收件箱状态');
};
const click = async (text: string, scope: ParentNode = document) => {
  const button = [...scope.querySelectorAll('button')].find(node => node.textContent === text);
  assert.ok(button, text);
  await act(async () => button.click());
};

test('PIPE01 inbox folds only low scores, confirms a reviewed batch with default standard mode, and sends only IDs', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.querySelector('#root')!);
  const grants: ConfirmCandidates[] = [];
  const inbox: CandidateList = { date, items: rows, dates: [date], counts: { fetched: 3, pending: 3, organizing: 0, drafts: 0, failed: 0 } };
  globalThis.fetch = async (input, options) => {
    const route = String(input);
    let data: unknown;
    if (route.endsWith('/status')) data = status;
    else if (route.endsWith('/schedules')) data = { items: [schedule] };
    else if (route.includes('/runs?')) data = { items: [] };
    else if (route.endsWith('/pipeline/settings')) data = { revision: 1, concurrency: 2, topics: ['渠道'], preScreenEnabled: true };
    else if (route.endsWith('/candidates')) data = inbox;
    else if (route.endsWith('/candidates/confirm')) {
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('X-FMCG-Automation-Token'), status.writeToken);
      grants.push(JSON.parse(String(options?.body)));
      data = { items: [] };
    } else throw new Error(route);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try {
    await act(async () => root.render(createElement(AutomationPage, { onOpenRaw() {}, onOpenDraft() {} })));
    await when(() => document.querySelector('#automation-tab-inbox'));
    await act(async () => document.querySelector<HTMLButtonElement>('#automation-tab-inbox')!.click());
    await when(() => document.querySelector('.candidate-low'));
    const low = document.querySelector<HTMLDetailsElement>('.candidate-low')!;
    assert.equal(low.open, false);
    assert.equal(low.querySelector('article')?.getAttribute('aria-label'), '低分资讯');
    assert.equal(document.querySelector('[aria-label="未预筛资讯"]')?.closest('.candidate-low'), null);
    assert.match(document.querySelector('[aria-label="未预筛资讯"]')?.textContent ?? '', /未预筛.*本批读取失败/u);
    const standard = document.querySelector<HTMLElement>('[aria-label="标准资讯"]')!;
    await click('确认入库', standard);
    const single = document.querySelector('[role="dialog"]')!;
    assert.equal(single.querySelector('input')?.checked, true);
    assert.equal(single.querySelector('select')?.value, 'standard');
    assert.match(single.textContent ?? '', /来源摘要（未核验原文）/u);
    await click('取消', single);
    assert.equal(grants.length, 0);
    const first = standard.querySelector('input')!;
    const second = document.querySelector<HTMLInputElement>('[aria-label="选择 未预筛资讯"]')!;
    await act(async () => { first.click(); second.click(); });
    await click('批量确认入库（2 条）');
    const batch = document.querySelector('[role="dialog"]')!;
    assert.equal(batch.querySelectorAll('li').length, 2);
    await click('确认并入库', batch);
    await when(() => grants.length === 1);
    assert.deepEqual(Object.keys(grants[0]!).sort(), ['candidateIds', 'mode', 'organize', 'requestId']);
    assert.deepEqual(grants[0]!.candidateIds, [rows[1]!.id, rows[2]!.id]);
    assert.equal(grants[0]!.mode, 'standard');
    assert.equal(grants[0]!.organize, true);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});
