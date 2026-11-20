import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { NewsEdition, NewsItem, NewsSection } from '../services/news/types.ts';

test('AI 前沿仅翻译已展示的合格条目，跨来源、历史和回退保留原文与 Raw 入口', async () => {
  const date = '2026-11-20';
  const oldDate = '2026-11-19';
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const item = (id: string, sourceId: string, publishedAt = date): NewsItem => ({
    id, sourceId, sourceName: sourceId, title: `Original title ${id}`, excerpt: `Original excerpt ${id}`,
    url: `https://example.com/${id}`, fetchedAt: `${date}T08:00:00Z`, publishedAt, evidenceKind: 'source_summary',
  });
  const cookbook = Array.from({ length: 6 }, (_, index) => item(`cookbook-${index + 1}`, 'openai-cookbook', index === 0 ? oldDate : date));
  const video = { ...item('video', 'karpathy-youtube'), title: '视频原题' };
  const chinese = { ...item('chinese', 'karpathy-youtube'), title: '中文资料', excerpt: '中文摘录' };
  const aihot = item('aihot', 'aihot');
  const fmcg = item('fmcg', 'openai-cookbook');
  const old = { ...video, excerpt: 'Historical video description', publishedAt: oldDate };
  const section: NewsSection = { status: 'source_only', attempt: 1, startedAt: date, sources: [], items: [] };
  // The oldest entry falls outside the per-source cap before the current-day filter runs.
  cookbook[5].publishedAt = '2026-11-18';
  const ai = { ...section, items: [aihot], sourceItems: [...cookbook, video, chinese] };
  const oldAi = { ...section, sourceItems: [old] };
  const edition: NewsEdition = { schemaVersion: 1, date, updatedAt: date, sections: {
    fmcg: { ...section, contentVersion: 'research-v1', items: [fmcg] }, ai,
  } };
  const oldEdition: NewsEdition = { ...edition, date: oldDate, sections: { ai: oldAi } };
  const today = { date, edition, aiEnabled: true, fallbacks: {} };
  const originalFetch = globalThis.fetch;
  const requests: { date: string; ids: string[] }[] = [];
  let completeToday: (response: Response) => void = () => {};
  let saved: unknown;
  const translated = (itemId: string, title = `中文标题 ${itemId}`, excerpt = `中文摘录 ${itemId}`) => ({ itemId, title, excerpt });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/today')) return Response.json(today);
    if (url.endsWith('/history')) return Response.json({ items: [{ date: oldDate }], errors: [] });
    if (url.endsWith(`/editions/${oldDate}`)) return Response.json(oldEdition);
    if (url.endsWith('/saved-raws')) return Response.json({ items: [] });
    if (url.endsWith('/today/check')) return Response.json({ ...today, edition: { ...edition, sections: { ai: { ...section, status: 'failed' } } },
      fallbacks: { ai: { date: oldDate, section: oldAi } } });
    if (url.endsWith('/save-raw')) {
      assert.ok(url.includes(`/editions/${date}/`));
      saved = JSON.parse(String(init?.body));
      return Response.json({ rawId: 'raw-id', status: 'saved', created: true });
    }
    if (url.endsWith('/translations')) {
      assert.equal(init?.method, 'POST');
      const requestDate = url.split('/').at(-2)!;
      const { itemIds: ids } = JSON.parse(String(init?.body));
      requests.push({ date: requestDate, ids });
      if (requests.length === 1) return new Promise(resolve => { completeToday = resolve; });
      if (requests.length === 2) return Response.json({ error: { message: '暂时不可用' } }, { status: 503 });
      const results = ids.map((id: string) => id === 'video'
        ? translated(id, video.title, requestDate === oldDate ? '历史视频中文简介' : '今日视频中文简介') : translated(id));
      return Response.json({ items: results, failedIds: [] });
    }
    throw Error(url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage.tsx');
  const root = createRoot(document.getElementById('root')!);
  const button = (label: string, scope: ParentNode = document) => {
    const match = [...scope.querySelectorAll('button')].find(value => value.textContent === label);
    assert.ok(match, `Missing button ${label}`);
    return match;
  };
  const chooseDate = (value: string) => act(async () => {
    const select = document.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const toggleGroup = (id: string) => act(async () => {
    document.querySelector<HTMLButtonElement>(`[aria-controls="news-drawer-${id}"]`)!.click();
  });
  const card = (id: string) => document.querySelector(`article:has(a[href="https://example.com/${id}"])`)!;
  const tab = (id: string) => act(async () => { document.getElementById(`news-tab-${id}`)!.click(); });

  try {
    await act(async () => root.render(<StrictMode><NewsPage /></StrictMode>));
    assert.match(card('fmcg').textContent!, /Original title fmcg/u);
    assert.deepEqual(requests, []);
    await tab('ai');
    assert.match(card('aihot').textContent!, /Original title aihot/u);
    assert.deepEqual(requests, []);
    await act(async () => button('仅今日更新').click());
    await toggleGroup('openai-cookbook');
    assert.deepEqual(requests, [{ date, ids: ['cookbook-2', 'cookbook-3', 'cookbook-4', 'cookbook-5'] }]);
    assert.match(card('cookbook-2').textContent!, /正在翻译，暂时显示原文/u);
    assert.equal(card('cookbook-1'), null);
    await act(async () => completeToday(Response.json({
      items: ['cookbook-2', 'cookbook-4', 'cookbook-5'].map(id => translated(id)), failedIds: ['cookbook-3'],
    })));
    const entry = card('cookbook-2');
    assert.match(entry.querySelector('h4')!.textContent!, /中文标题 cookbook-2/u);
    assert.equal(entry.querySelector('.news-excerpt')!.textContent, '中文摘录 cookbook-2');
    assert.match(entry.textContent!, /来源摘要.*AI 翻译/u);
    await act(async () => button('查看原文', entry).click());
    assert.match(entry.querySelector('h4')!.textContent!, /Original title cookbook-2/u);
    assert.equal(entry.querySelector('.news-excerpt')!.textContent, 'Original excerpt cookbook-2');
    await act(async () => button('查看中文', entry).click());
    await act(async () => button('保存到 Raw', entry).click());
    assert.deepEqual(saved, { section: 'ai', itemId: 'cookbook-2' });
    assert.match(entry.textContent!, /已保存/u);

    await toggleGroup('openai-cookbook');
    await toggleGroup('openai-cookbook');
    assert.equal(requests.length, 1);
    await act(async () => button('重试翻译', card('cookbook-3')).click());
    assert.deepEqual(requests.at(-1), { date, ids: ['cookbook-3'] });
    assert.match(card('cookbook-3').textContent!, /翻译暂不可用，当前显示原文/u);
    await act(async () => button('重试翻译', card('cookbook-3')).click());
    assert.match(card('cookbook-3').textContent!, /中文标题 cookbook-3/u);

    await toggleGroup('karpathy-youtube');
    assert.deepEqual(requests.at(-1), { date, ids: ['video'] });
    assert.match(card('video').textContent!, /视频简介.*今日视频中文简介/u);
    assert.equal(card('chinese').querySelector('.news-excerpt')!.textContent, chinese.excerpt);
    await tab('fmcg');
    await tab('ai');
    await toggleGroup('karpathy-youtube');
    assert.match(card('video').textContent!, /今日视频中文简介/u);
    assert.equal(requests.length, 4);

    await chooseDate(oldDate);
    assert.deepEqual(requests.at(-1), { date: oldDate, ids: ['video'] });
    assert.match(card('video').textContent!, /历史视频中文简介/u);
    await chooseDate('');
    await act(async () => button('检查更新').click());
    assert.match(document.getElementById('news-section-ai')!.textContent!, /显示 2026-11-19 的历史内容/u);
    assert.match(card('video').textContent!, /历史视频中文简介/u);
    assert.equal(requests.length, 5);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
