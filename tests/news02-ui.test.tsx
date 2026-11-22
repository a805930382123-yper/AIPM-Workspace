import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

test('StrictMode 保存结束后显示 Raw，保存状态失败可重读', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/#ai', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const date = '2026-11-08',
    item = {
      id: 'id1',
      title: '测试资讯',
      sourceId: 'aihot',
      sourceName: 'AIHOT',
      url: 'https://example.test',
      publishedAt: null,
      fetchedAt: '2026-11-08T00:00:00Z',
      excerpt: '摘要',
      evidenceKind: 'source_summary',
    };
  const section = { status: 'source_only', attempt: 1, startedAt: '', sources: [], items: [item] },
    edition = { schemaVersion: 1, date, updatedAt: 'a', sections: { ai: section } };
  let fail = true,
    changed = 0,
    opened = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/today')) return Response.json({ date, aiEnabled: false, edition, fallbacks: {} });
    if (url.endsWith('/history')) return Response.json({ items: [], errors: [] });
    if (url.endsWith('/saved-raws')) return fail ? new Response('{}', { status: 503 }) : Response.json({ items: [] });
    if (url.endsWith('/save-raw') && init?.method === 'POST')
      return Response.json({ rawId: 'raw-id', status: 'saved', created: true });
    throw Error('unexpected ' + url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage.tsx');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        React.createElement(
          StrictMode,
          null,
          React.createElement(NewsPage, {
            onRawChanged: () => {
              changed++;
            },
            onOpenRaw: (id: string) => {
              opened = id;
            },
          }),
        ),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.match(
      document.querySelector('.news-save-warning + .news-workspace')?.previousElementSibling?.textContent ?? '',
      /保存状态读取失败/,
    );
    fail = false;
    const retry = [...document.querySelectorAll('button')].find((b) => b.textContent === '重新读取保存状态');
    assert.ok(retry);
    await act(async () => {
      retry.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.doesNotMatch(document.body.textContent!, /保存状态读取失败/);
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存到 Raw');
    assert.ok(save);
    await act(async () => {
      save.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.doesNotMatch(document.body.textContent!, /正在保存/);
    assert.match(document.body.textContent!, /已保存/);
    assert.equal(changed, 1);
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent === '查看 Raw');
    assert.ok(open);
    await act(async () => open.click());
    assert.equal(opened, 'raw-id');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
test('保存请求完成前离页仍刷新共享数据且不导航', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/#ai', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const date = '2026-11-08',
    item = {
      id: 'id1',
      title: '测试资讯',
      sourceId: 'aihot',
      sourceName: 'AIHOT',
      url: 'https://example.test',
      publishedAt: null,
      fetchedAt: '2026-11-08T00:00:00Z',
      excerpt: '摘要',
      evidenceKind: 'source_summary',
    };
  const edition = {
    schemaVersion: 1,
    date,
    updatedAt: 'a',
    sections: { ai: { status: 'source_only', attempt: 1, startedAt: '', sources: [], items: [item] } },
  };
  let release!: (r: Response) => void,
    changed = 0,
    opened = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/today')) return Response.json({ date, aiEnabled: false, edition, fallbacks: {} });
    if (url.endsWith('/history') || url.endsWith('/saved-raws')) return Response.json({ items: [], errors: [] });
    if (url.endsWith('/save-raw') && init?.method === 'POST')
      return new Promise<Response>((r) => {
        release = r;
      });
    throw Error('unexpected ' + url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage.tsx');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        React.createElement(NewsPage, {
          onRawChanged: () => {
            changed++;
          },
          onOpenRaw: () => {
            opened++;
          },
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存到 Raw');
    assert.ok(save);
    await act(async () => save.click());
    assert.equal(typeof release, 'function');
    await act(async () => root.render(React.createElement('div', null, '首页')));
    await act(async () => {
      release(Response.json({ rawId: 'raw-id', status: 'saved', created: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.equal(changed, 1);
    assert.equal(opened, 0);
    assert.equal(document.body.textContent, '首页');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('单条保存状态异常只显示在对应栏目和卡片', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const date = '2026-11-08';
  const item = {
    id: 'report',
    title: '受影响研报',
    sourceId: 'source',
    sourceName: '来源',
    url: 'https://example.test/report',
    publishedAt: null,
    fetchedAt: '2026-11-08T00:00:00Z',
    excerpt: '摘要',
    evidenceKind: 'source_summary',
  };
  const section = { status: 'source_only', attempt: 1, startedAt: '', sources: [] };
  const edition = {
    schemaVersion: 1,
    date,
    updatedAt: 'a',
    sections: {
      fmcg: {
        ...section,
        contentVersion: 'research-v1',
        items: [item, { ...item, id: 'another', title: '正常研报', url: 'https://example.test/another' }],
      },
      ai: { ...section, items: [{ ...item, id: 'ai', title: '已保存的 AI 资讯', url: 'https://example.test/ai' }] },
    },
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/today')) return Response.json({ date, aiEnabled: false, edition, fallbacks: {} });
    if (url.endsWith('/history')) return Response.json({ items: [], errors: [] });
    if (url.endsWith('/saved-raws'))
      return Response.json({
        items: [
          { section: 'fmcg', itemId: 'report', status: 'error', message: '保存收据损坏，原文件已保留。' },
          { section: 'ai', itemId: 'ai', status: 'saved', rawId: 'ai-raw' },
        ],
      });
    throw Error('unexpected ' + url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage.tsx');
  const root = createRoot(document.getElementById('root')!);
  let opened = '';
  try {
    await act(async () =>
      root.render(
        React.createElement(NewsPage, {
          onOpenRaw: (id) => {
            opened = id;
          },
        }),
      ),
    );
    const cards = document.querySelectorAll('article');
    assert.match(cards[0].querySelector('[role="alert"]')?.textContent ?? '', /保存收据损坏/);
    assert.doesNotMatch(cards[0].textContent ?? '', /保存到 Raw|已保存/);
    assert.match(cards[1].textContent ?? '', /保存到 Raw/);
    assert.equal(document.querySelector('.news-save-warning'), null);
    await act(async () => document.querySelector<HTMLButtonElement>('#news-tab-ai')!.click());
    assert.doesNotMatch(document.body.textContent ?? '', /保存收据损坏|保存状态读取失败/);
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent === '查看 Raw');
    assert.ok(open);
    await act(async () => open.click());
    assert.equal(opened, 'ai-raw');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('今日尚无期刊时不发起保存状态查询，两栏均无失败提示', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let projectionReads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/today'))
      return Response.json({ date: '2026-11-08', aiEnabled: false, edition: null, fallbacks: {} });
    if (url.endsWith('/history')) return Response.json({ items: [], errors: [] });
    if (url.endsWith('/saved-raws')) {
      projectionReads++;
      return new Response('{}', { status: 404 });
    }
    throw Error('unexpected ' + url);
  };
  const { NewsPage } = await import('../app/pages/NewsPage.tsx');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(React.createElement(NewsPage)));
    assert.match(document.body.textContent ?? '', /今日尚未准备/);
    assert.equal(document.querySelector('.news-save-warning'), null);
    await act(async () => document.querySelector<HTMLButtonElement>('#news-tab-ai')!.click());
    assert.match(document.body.textContent ?? '', /暂无可阅读的 AI 资讯/);
    assert.equal(document.querySelector('.news-save-warning'), null);
    assert.equal(projectionReads, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
