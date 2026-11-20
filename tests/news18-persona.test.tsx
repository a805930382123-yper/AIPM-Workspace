import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { NewsEdition, NewsItem, SourceHealth } from '../services/news/types';

test('人物抽屉跨平台排序、按日降级，并沿用阅读与 Raw 操作', async () => {
  const date = '2026-11-20';
  const oldDate = '2026-11-19';
  const emptyDate = '2026-11-18';
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/#ai' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const sourceNames = {
    aihot: 'AIHOT', 'karpathy-youtube': 'Karpathy · YouTube', 'karpathy-x': 'Karpathy · X 公开帖',
    'karpathy-github': 'Karpathy · GitHub', 'karpathy-blog': 'Karpathy · Bear Blog',
  };
  const item = (id: string, sourceId: keyof typeof sourceNames, publishedAt: string | null): NewsItem => ({
    id, sourceId, sourceName: sourceNames[sourceId], publishedAt, fetchedAt: `${date}T14:00:00Z`,
    url: `https://example.com/${id}`, title: `示例标题 ${id}`, excerpt: '完整摘录。'.repeat(60), evidenceKind: 'source_summary',
  });
  const aihot = item('aihot', 'aihot', date);
  const video = item('video', 'karpathy-youtube', '2026-11-19T23:00:00-08:00');
  const noDate = item('no-date', 'karpathy-youtube', null);
  const post = item('post', 'karpathy-x', '2026-11-19T18:00:00Z');
  const repo = item('repo', 'karpathy-github', '2026-11-19T15:30:00Z');
  const blog = item('blog', 'karpathy-blog', '2026-11-17T10:00:00Z');
  const invalid = item('invalid', 'karpathy-blog', 'invalid');
  const sources: SourceHealth[] = Object.entries(sourceNames).map(([sourceId, name]) => ({
    sourceId, name, checkedAt: `${date}T16:00:00Z`, status: sourceId === 'karpathy-x' ? 'failed' : 'ok',
    homepage: sourceId === 'karpathy-x' ? 'https://x.com/karpathy' : undefined,
  }));
  const edition = (date: string, items: NewsItem[], sourceItems: NewsItem[]): NewsEdition => ({
    schemaVersion: 1, date, updatedAt: date, sections: { ai: { status: 'source_only', attempt: 1, startedAt: date, sources, items, sourceItems } },
  });
  const today = edition(date, [aihot, repo], [noDate, video, post, invalid, blog]);
  const history = edition(oldDate, [], [repo, blog]);
  const quietHistory = edition(emptyDate, [], [repo, blog]);
  let savedRequest: unknown;
  let openedRaw: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/today')) return Response.json({ date, edition: today, aiEnabled: false, fallbacks: {} });
    if (url.endsWith('/history')) return Response.json({ items: [{ date: oldDate }, { date: emptyDate }], errors: [] });
    if (url.endsWith(`/editions/${oldDate}`)) return Response.json(history);
    if (url.endsWith(`/editions/${emptyDate}`)) return Response.json(quietHistory);
    if (url.endsWith('/saved-raws')) return Response.json({ items: [] });
    if (url.endsWith(`/editions/${date}/items/save-raw`)) {
      savedRequest = JSON.parse(String(init?.body));
      return Response.json({ rawId: 'video-raw', status: 'saved', created: true });
    }
    throw Error(url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage');
  const root = createRoot(document.getElementById('root')!);
  const click = async (element: HTMLElement | undefined | null) => {
    assert.ok(element);
    await act(async () => element.click());
  };
  const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(entry => entry.textContent?.trim() === text);
  const drawer = (id: string) => document.getElementById(`news-drawer-${id}`);
  const headers = () => [...document.querySelectorAll<HTMLButtonElement>('.news-drawer-head button')];
  const persona = () => drawer('karpathy')!.closest('.news-drawer')!;
  const filterButtons = () => [...persona().querySelectorAll<HTMLButtonElement>('.news-platform-filters button')];
  const platformButton = (platform: string) => filterButtons().find(entry => entry.querySelector(`.source-logo-platform-${platform}`));
  const articleIds = (scope: ParentNode) => [...scope.querySelectorAll('article h4 a')].map(entry => entry.getAttribute('href')!.split('/').at(-1));
  const chooseDate = async (value: string) => act(async () => {
    const select = document.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });

  try {
    await act(async () => root.render(<NewsPage onOpenRaw={id => { openedRaw = id; }} />));
    assert.equal(headers().length, 2);
    assert.deepEqual(headers().map(entry => entry.getAttribute('aria-expanded')), ['true', 'false']);
    assert.match(document.querySelector('.news-reading-tools')!.textContent!, /共 2 个来源 · 7 条资讯/);
    const heading = headers()[1];
    assert.match(heading.textContent!, /Andrej Karpathy.*6 条.*最新 2026-11-20.*含缓存渠道/);
    assert.match(heading.querySelector('.source-logo-portrait img')!.getAttribute('src')!, /\/karpathy\.png$/);
    assert.equal(heading.querySelector('.source-logo-portrait .source-logo-platform'), null);
    assert.match(heading.querySelector('.news-chip-warn')!.getAttribute('title')!, /X/);
    assert.deepEqual([...heading.querySelectorAll('.news-platform-count')].map(entry => entry.textContent), ['YouTube 2', 'X 1', 'GitHub 1', 'Bear Blog 2']);
    assert.match(document.querySelector('.news-diagnosis')!.textContent!, /5 个来源/);
    assert.match(document.querySelector('.news-diagnosis-list')!.textContent!, /Karpathy · X 公开帖/);

    await click(button('全部展开'));
    assert.deepEqual(headers().map(entry => entry.getAttribute('aria-expanded')), ['true', 'true']);
    assert.deepEqual(filterButtons().map(entry => entry.textContent?.trim()), ['全部 6', 'YouTube2', 'X1', 'GitHub1', 'Bear Blog2']);
    assert.equal(filterButtons()[0].getAttribute('aria-pressed'), 'true');
    assert.equal(platformButton('x')!.querySelector('.news-cache-dot')?.getAttribute('title'), '本次抓取失败，展示缓存');
    assert.equal(persona().querySelector('a[aria-label$="官方入口"]'), null);
    assert.deepEqual(articleIds(persona()), ['video', 'post', 'repo', 'blog', 'no-date', 'invalid']);
    assert.deepEqual([...persona().querySelectorAll('.news-source-chip')].map(entry => entry.textContent), ['YouTube', 'X', 'GitHub', 'Bear Blog', 'YouTube', 'Bear Blog']);
    const videoCard = persona().querySelector('article:has(a[href="https://example.com/video"])')!;
    await click(button('展开完整摘录', videoCard));
    assert.equal(videoCard.querySelector('.news-excerpt.is-expanded')?.textContent, video.excerpt);
    await click(button('保存到 Raw', videoCard));
    assert.deepEqual(savedRequest, { section: 'ai', itemId: 'video' });

    await click(platformButton('youtube'));
    assert.deepEqual(articleIds(persona()), ['no-date', 'video']);
    const official = persona().querySelector<HTMLAnchorElement>('a[aria-label="YouTube 官方入口"]')!;
    assert.match(official.href, /^https:\/\/www\.youtube\.com\/channel\//);
    assert.equal(official.target, '_blank');
    assert.equal(official.rel, 'noopener noreferrer');
    await click(button('查看 Raw', persona()));
    assert.equal(openedRaw, 'video-raw');

    await click(platformButton('github'));
    await click(button('仅今日更新'));
    assert.match(document.querySelector('.news-reading-tools')!.textContent!, /共 2 个来源 · 3 条资讯/);
    await click(headers()[1]);
    assert.deepEqual(articleIds(persona()), ['video', 'post']);
    assert.equal(filterButtons()[0].getAttribute('aria-pressed'), 'true');
    assert.equal(platformButton('github'), undefined);
    await click(button('全部', document.querySelector('.news-reading-tools')!));
    await click(headers()[1]);
    assert.equal(filterButtons()[0].getAttribute('aria-pressed'), 'true');
    await click(platformButton('x'));
    await click(button('全部收起'));
    assert.deepEqual(headers().map(entry => entry.getAttribute('aria-expanded')), ['false', 'false']);

    await chooseDate(oldDate);
    assert.equal(headers().length, 1);
    assert.equal(headers()[0].getAttribute('aria-expanded'), 'true');
    assert.equal(filterButtons()[0].getAttribute('aria-pressed'), 'true');
    await click(button('仅今日更新'));
    assert.equal(drawer('karpathy'), null);
    assert.deepEqual(articleIds(drawer('karpathy-github')!), ['repo']);
    assert.equal(document.querySelector('.news-platform-filters'), null);
    assert.equal(document.querySelector('a[aria-label="Karpathy · GitHub 官方入口"]')?.getAttribute('href'), 'https://github.com/karpathy?tab=repositories');

    await chooseDate(emptyDate);
    assert.equal(filterButtons()[0].getAttribute('aria-pressed'), 'true');
    await click(button('仅今日更新'));
    assert.equal(headers().length, 0);
    assert.match(document.querySelector('.news-reading')!.textContent!, /共 0 个来源 · 0 条资讯.*暂无当日更新/);
    assert.equal(button('全部展开')?.disabled, true);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
