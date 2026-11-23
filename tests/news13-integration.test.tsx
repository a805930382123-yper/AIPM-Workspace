import { newsRawFixture } from './support/news-raw-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NewsService } from '../services/news/service.ts';
import { readNewsSources } from '../services/news/sources.ts';
import { RawStore } from '../services/raw/store.ts';
import type { NewsEdition, NewsItem } from '../services/news/types.ts';

const now = new Date('2026-11-20T08:00:00Z');
const date = '2026-11-20';

test('保留 AIHOT 首批及新来源存储，更新提示按实际新增计数，额外来源可以保存 Raw', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'news13-'));
  const originalFetch = globalThis.fetch;
  const channel = 'UCXUPKJO5MZQN11PqgIvyuvQ';
  const ids = ['abcdefghijk', 'ABCDEFGHIJK', 'KJIHGFEDCBA'];
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    title: `AIHOT ${i}`,
    summary: `AIHOT 摘要 ${i}`,
    publishedAt: now.toISOString(),
    links: {
      original: i === 0 ? `https://www.youtube.com/watch?v=${ids[0]}&utm_source=aihot` : `https://example.com/${i}`,
    },
  }));
  let limit = 2,
    models = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'aihot.news') return Response.json({ items: rows });
    if (url.pathname === '/feeds/videos.xml') {
      const entries = ids
        .slice(0, limit)
        .map(
          (id, i) =>
            `<entry><title>课程 ${i}</title><published>2026-11-20T06:00:00Z</published><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId><media:group><media:description>视频简介 ${i}</media:description></media:group></entry>`,
        );
      return new Response(
        `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">${entries.join('')}</feed>`,
        { headers: { 'Content-Type': 'application/xml' } },
      );
    }
    return new Response('', { status: 503 });
  };
  try {
    const rawStore = new RawStore(root);
    await rawStore.initialize();
    const make = () =>
      new NewsService({
        root,
        rawStore,
        rawSave: newsRawFixture,
        clock: () => now,
        aiEnabled: false,
        readSources: (section, at, exclusions, sourceIds) =>
          section === 'ai'
            ? readNewsSources(section, at, exclusions, sourceIds)
            : Promise.resolve({ items: [], sources: [] }),
        providerFactory: async () => {
          models++;
          throw Error('Unexpected model call');
        },
      });
    const service = make();
    const first = (await service.ensure(true))!.sections.ai!;
    assert.deepEqual(
      first.items.map((item) => item.title),
      rows.map((row) => row.title),
    );
    assert.equal(first.sources.length, 9);
    const unavailable = first.sources.find((source) => source.sourceId === 'karpathy-blog');
    assert.equal(unavailable?.homepage, 'https://karpathy.bearblog.dev/blog/');
    assert.equal(unavailable?.diagnosis?.error?.httpStatus, 503);
    const youtube = first.sources.find((source) => source.sourceId === 'karpathy-youtube');
    assert.equal(youtube?.diagnosis?.counts.duplicates, 1);
    assert.deepEqual(
      first.sourceItems?.map((item) => item.url),
      [`https://www.youtube.com/watch?v=${ids[1]}`],
    );

    limit = 3;
    await service.check('ai', 'all', first.attempt);
    const checked = await service.ensure(true);
    const second = checked!.sections.ai!;
    assert.deepEqual(second.items, first.items);
    assert.deepEqual(
      second.sourceItems?.map((item) => item.url),
      ids.slice(1).map((id) => `https://www.youtube.com/watch?v=${id}`),
    );
    assert.equal(second.checkMessage, '本次新增 1 条。');
    assert.equal(second.sources.length, 9);

    await service.check('ai', 'all', second.attempt);
    const unchanged = (await service.ensure(true))!.sections.ai!;
    assert.equal(unchanged.checkMessage, '部分来源未能完整读取。');
    assert.deepEqual(unchanged.items, second.items);
    assert.deepEqual(unchanged.sourceItems, second.sourceItems);

    const restored = make();
    const item = (await restored.edition(date))!.sections.ai!.sourceItems![1];
    const saved = await restored.saveRaw(date, 'ai', item.id);
    const raw = await rawStore.get(saved.rawId);
    assert.equal(raw?.body, item.excerpt);
    assert.equal(raw?.url, item.url);
    assert.equal(raw?.publishedAt, item.publishedAt);
    assert.equal(raw?.author, 'Andrej Karpathy');
    assert.deepEqual((await restored.savedRaws(date)).items, [
      { section: 'ai', itemId: item.id, rawId: saved.rawId, status: 'saved', material: saved.material },
    ]);
    assert.equal((await restored.saveRaw(date, 'ai', item.id)).created, false);
    assert.equal(models, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('AI 前沿合并今日、历史及回退分组，按时间去重限额，保留分析和 Raw 入口', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/#ai', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const oldDate = '2026-11-19';
  const items: Array<NewsItem> = Array.from({ length: 5 }, (_, i) => ({
    id: `ai-${i}`,
    title: `AIHOT ${i}`,
    sourceId: 'aihot',
    sourceName: 'AIHOT',
    url: `https://example.com/${i}`,
    publishedAt: `2026-11-20T0${i + 1}:00:00Z`,
    fetchedAt: now.toISOString(),
    excerpt: '来源摘要',
    evidenceKind: 'source_summary',
  }));
  items[4].analysis = { fact: '旧条目分析', whyItMatters: '现有分析理由', possibleImpact: '现有分析推断' };
  const newAihot: NewsItem = {
    ...items[0],
    id: 'ai-new',
    title: 'AIHOT 新条目',
    url: 'https://example.com/new',
    publishedAt: null,
  };
  const duplicate: NewsItem = {
    ...newAihot,
    id: 'duplicate',
    title: '按源重复包装',
    url: items[4].url + '?utm_source=repost',
  };
  const refreshed: NewsItem = {
    ...newAihot,
    id: 'ai-fresh',
    title: 'AIHOT 更新条目',
    url: 'https://example.com/fresh',
    publishedAt: '2026-11-20T09:00Z',
  };
  const video: NewsItem = {
    ...items[0],
    id: 'video',
    title: '视频',
    sourceId: 'karpathy-youtube',
    sourceName: 'Karpathy · YouTube',
    author: 'Andrej Karpathy',
    url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK',
    publishedAt: date,
    excerpt: '来源提供的视频介绍',
  };
  const section = {
    status: 'source_only' as const,
    attempt: 1,
    startedAt: now.toISOString(),
    items,
    sourceItems: [newAihot, duplicate, video],
    checkMessage: '已检查，本期已满5条。按来源浏览新增 3 条。',
    shortageReasons: ['旧版不足原因'],
    sources: [
      {
        sourceId: 'karpathy-x',
        name: 'Karpathy · X 公开帖',
        checkedAt: now.toISOString(),
        status: 'failed' as const,
        homepage: 'https://x.com/karpathy',
      },
    ],
  };
  const edition: NewsEdition = { schemaVersion: 1, date, updatedAt: now.toISOString(), sections: { ai: section } };
  const oldSection = { ...section, items: [], sourceItems: [{ ...video, publishedAt: '2026-11' }] };
  const oldEdition: NewsEdition = { ...edition, date: oldDate, sections: { ai: oldSection } };
  const today = { date, edition, aiEnabled: false, fallbacks: {} };
  const originalFetch = globalThis.fetch;
  let saved: unknown,
    opened: string | undefined,
    checks = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/today')) return Response.json(today);
    if (url.endsWith('/history')) return Response.json({ items: [{ date: oldDate }], errors: [] });
    if (url.endsWith(`/editions/${oldDate}`)) return Response.json(oldEdition);
    if (url.endsWith('/saved-raws'))
      return Response.json({
        items: url.includes(oldDate) ? [{ section: 'ai', itemId: 'video', rawId: 'old-raw', status: 'saved' }] : [],
      });
    if (url.endsWith('/today/check')) {
      checks++;
      assert.deepEqual(JSON.parse(String(init?.body)), { section: 'ai', mode: 'all', attempt: checks });
      const updated = {
        ...section,
        attempt: checks + 1,
        sourceItems: [...section.sourceItems, refreshed],
        checkMessage: '本次新增 1 条。',
      };
      if (checks === 1) return Response.json({ ...today, edition: { ...edition, sections: { ai: updated } } });
      return Response.json({
        ...today,
        edition: { ...edition, sections: { ai: { ...section, status: 'failed', items: [], sourceItems: [] } } },
        fallbacks: { ai: { date: oldDate, section: oldSection } },
      });
    }
    if (url.endsWith('/save-raw')) {
      assert.match(url, new RegExp(`/editions/${date}/`));
      saved = JSON.parse(String(init?.body));
      return Response.json({ rawId: 'raw-id', status: 'saved', created: true });
    }
    throw Error(url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage.tsx');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () =>
      root.render(
        <NewsPage
          onOpenRaw={(id) => {
            opened = id;
          }}
        />,
      ),
    );
    const ai = document.getElementById('news-section-ai')!;
    const groupTitles = () => [...ai.querySelectorAll('.news-drawer-title')].map((el) => el.textContent);
    const aihotTitles = () =>
      [...ai.querySelectorAll('.news-drawer:first-child h4 a')].map((el) => el.textContent?.replace(/ ↗$/u, ''));
    const drawerButtons = () => [...ai.querySelectorAll<HTMLButtonElement>('.news-drawer-head button')];
    const button = (label: string, scope: Element = ai) =>
      [...scope.querySelectorAll('button')].find((btn) => btn.textContent === label)!;
    const check = () => [...ai.querySelectorAll('button')].find((btn) => btn.textContent === '检查更新')!;
    const noOldQuota = () => assert.doesNotMatch(ai.textContent!, /\/5 条|已满5条|按来源浏览新增|不足/u);
    assert.equal(document.getElementById('news-section-fmcg'), null);
    assert.match(document.getElementById('news-tab-ai')!.textContent!, /AI 前沿 \(6\)/);
    assert.deepEqual(groupTitles(), ['AIHOT', 'Karpathy · YouTube']);
    assert.deepEqual(
      drawerButtons().map((btn) => btn.getAttribute('aria-expanded')),
      ['true', 'false'],
    );
    assert.deepEqual(aihotTitles(), ['AIHOT 新条目', 'AIHOT 4', 'AIHOT 3', 'AIHOT 2', 'AIHOT 1']);
    const timestamp = ai.querySelector('article time[datetime="2026-11-20T05:00:00Z"]');
    assert.equal(timestamp?.textContent, '2026-11-20 13:00:00');
    assert.equal(timestamp?.getAttribute('title'), '上海时间');
    assert.match(ai.textContent!, /旧条目分析/);
    assert.doesNotMatch(ai.textContent!, /未生成分析/);
    noOldQuota();
    await act(async () => button('全部展开').click());
    assert.deepEqual(
      drawerButtons().map((btn) => btn.getAttribute('aria-expanded')),
      ['true', 'true'],
    );
    await act(async () => button('全部收起').click());
    assert.deepEqual(
      drawerButtons().map((btn) => btn.getAttribute('aria-expanded')),
      ['false', 'false'],
    );
    await act(async () => button('仅今日更新').click());
    assert.deepEqual(aihotTitles(), ['AIHOT 4', 'AIHOT 3', 'AIHOT 2', 'AIHOT 1']);
    await act(async () => button('全部').click());
    await act(async () => drawerButtons()[1].click());
    const group = ai.querySelector('.news-drawer:nth-child(2)')!;
    assert.equal(group.querySelector('article time')?.textContent, date);
    assert.match(group.textContent!, /Andrej Karpathy.*视频简介/u);
    assert.match(group.textContent!, /来源提供的视频介绍/u);
    assert.doesNotMatch(group.textContent!, /AIHOT/u);
    assert.equal(
      ai.querySelector('a[aria-label="Karpathy · X 公开帖 官方入口"]')?.getAttribute('href'),
      'https://x.com/karpathy',
    );
    await act(async () => button('保存到 Raw', group).click());
    assert.deepEqual(saved, { section: 'ai', itemId: 'video' });
    assert.match(group.textContent!, /已保存/);

    await act(async () => check().click());
    assert.deepEqual(groupTitles(), ['AIHOT', 'Karpathy · YouTube']);
    assert.deepEqual(aihotTitles(), ['AIHOT 更新条目', 'AIHOT 新条目', 'AIHOT 4', 'AIHOT 3', 'AIHOT 2']);
    assert.equal(ai.querySelector('article time[datetime="2026-11-20T09:00Z"]')?.textContent, '2026-11-20 17:00');
    assert.match(ai.textContent!, /本次新增 1 条/);
    noOldQuota();

    const select = document.querySelector('select')!;
    const read = async (value: string) =>
      act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await read(oldDate);
    assert.deepEqual(groupTitles(), ['Karpathy · YouTube']);
    assert.match(document.getElementById('news-tab-ai')!.textContent!, /AI 前沿 \(1\)/);
    noOldQuota();
    await act(async () => button('仅今日更新').click());
    assert.match(ai.textContent!, /2026-11-19 暂无当日更新/);
    await act(async () => button('查看全部资讯').click());
    const month = ai.querySelector('article time');
    assert.equal(month?.textContent, '2026-11');
    assert.equal(month?.getAttribute('title'), '仅知月份');
    const openRaw = () => [...ai.querySelectorAll('button')].find((btn) => btn.textContent === '查看 Raw')!;
    await act(async () => openRaw().click());
    assert.equal(opened, 'old-raw');

    await read('');
    await act(async () => check().click());
    assert.deepEqual(groupTitles(), ['Karpathy · YouTube']);
    assert.match(ai.textContent!, /缓存 · 本次抓取失败/);
    assert.match(ai.textContent!, /显示 2026-11-19 的历史内容/);
    noOldQuota();
    opened = undefined;
    await act(async () => openRaw().click());
    assert.equal(opened, 'old-raw');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});

test('今日 AI 来源失败时，服务可回退至仅存来源条目的历史期刊', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'news14-fallback-'));
  const oldDate = '2026-11-19';
  const item: NewsItem = {
    id: 'video',
    title: '视频',
    sourceId: 'karpathy-youtube',
    sourceName: 'Karpathy · YouTube',
    url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK',
    publishedAt: null,
    fetchedAt: now.toISOString(),
    excerpt: '视频简介',
    evidenceKind: 'source_summary',
  };
  const oldSection = {
    status: 'source_only',
    attempt: 1,
    startedAt: now.toISOString(),
    items: [],
    sourceItems: [item],
    sources: [],
  };
  const dir = path.join(root, 'state', 'news');
  try {
    await mkdir(dir, { recursive: true });
    const base = { schemaVersion: 1, updatedAt: now.toISOString() };
    await writeFile(
      path.join(dir, `${oldDate}.json`),
      JSON.stringify({ ...base, date: oldDate, sections: { ai: oldSection } }),
    );
    await writeFile(
      path.join(dir, `${date}.json`),
      JSON.stringify({ ...base, date, sections: { ai: { ...oldSection, status: 'failed', sourceItems: [] } } }),
    );
    const service = new NewsService({
      root,
      clock: () => now,
      aiEnabled: false,
      readSources: async () => {
        throw Error('Unexpected source read');
      },
      providerFactory: async () => {
        throw Error('Unexpected model call');
      },
    });
    assert.deepEqual((await service.today()).fallbacks.ai, { date: oldDate, section: oldSection });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
