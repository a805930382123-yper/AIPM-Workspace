import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readResearchSources } from '../services/news/research-sources.ts';
import { NewsService } from '../services/news/service.ts';
const now = new Date('2026-11-08T06:00:00Z');
test('排除农业收储普通新闻，拒绝重定向到非默认端口', async () => {
  const orig = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('nielseniq.cn')) return new Response('', { status: 503 });
    if (url.endsWith('chinese-simplified'))
      return new Response(
        `<div class="blog-post-title"><div class="post-meta"><div class="small-text">November 3, 2026</div></div><a href="/insights/grain">快消企业开展秋粮集中收储</a></div><div class="blog-post-title"><div class="post-meta"><div class="small-text">November 2, 2026</div></div><a href="/insights/report">快消市场消费者研究</a></div>`,
        { headers: { 'content-type': 'text/html' } },
      );
    if (url.endsWith('/insights/report'))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://worldpanelbynumerator.com:8443/insights/report' },
      });
    throw Error('不应访问 ' + url);
  };
  try {
    const x = await readResearchSources(now);
    assert.equal(x.items.length, 0);
    assert.ok(!requests.some((x) => x.includes(':8443')));
    assert.ok(!requests.some((x) => x.endsWith('/insights/grain')));
  } finally {
    globalThis.fetch = orig;
  }
});
test('旧失败栏不允许重试，旧记录保留', async () => {
  const base = path.join(process.cwd(), 'node_modules/.cache/news03');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'retry-'));
  try {
    await mkdir(path.join(root, 'state/news'), { recursive: true });
    const file = path.join(root, 'state/news/2026-11-08.json'),
      content = JSON.stringify({
        schemaVersion: 1,
        date: '2026-11-08',
        updatedAt: now.toISOString(),
        sections: { fmcg: { status: 'failed', attempt: 1, startedAt: now.toISOString(), sources: [], items: [] } },
      });
    await writeFile(file, content);
    const svc = new NewsService({
      root,
      clock: () => now,
      aiEnabled: false,
      providerFactory: async () => undefined,
      readSources: async () => ({ items: [], sources: [] }),
    });
    await assert.rejects(svc.retry('fmcg', 1), (e: any) => e.status === 409);
    assert.equal(await readFile(file, 'utf8'), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('未标注的数据期留在原文，缺乏量化依据的普通新闻不入选', async () => {
  const orig = globalThis.fetch;
  const body =
    '数据显示，2025年中国城镇快速消费品总支出同比增长0.9%，到2026年一季度销售额同比下降1.3%。' +
    '研究分析消费趋势与渠道变化。'.repeat(8);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('nielseniq.cn')) return new Response('', { status: 503 });
    if (url.endsWith('chinese-simplified'))
      return new Response(
        `<div class="blog-post-title"><div class="post-meta"><div class="small-text">November 3, 2026</div></div><a href="/insights/research">中国快消消费者研究报告</a></div><div class="blog-post-title"><div class="post-meta"><div class="small-text">November 2, 2026</div></div><a href="/insights/news">快消行业市场新闻</a></div>`,
        { headers: { 'content-type': 'text/html' } },
      );
    const paragraph = url.endsWith('/research')
      ? body
      : '本行业市场报告介绍销售流程和产品推广，公司持续开展快消市场经营。'.repeat(8);
    return new Response(`<div class="article w-richtext"><p>${paragraph}</p></div>`, {
      headers: { 'content-type': 'text/html' },
    });
  };
  try {
    const x = await readResearchSources(now);
    assert.equal(x.items.length, 1);
    assert.equal(x.items[0].research!.dataPeriod, null);
    assert.equal(x.items[0].excerpt, body);
  } finally {
    globalThis.fetch = orig;
  }
});

test('仅引用独立标注的明确数据期，报告材料分级与原文保留', async (t) => {
  const orig = globalThis.fetch;
  const body = '消费者研究显示快消销售额同比增长0.9%。' + '研究分析渠道结构和消费者购买行为。'.repeat(8);
  const cases = [
    {
      id: 'mixed',
      text: '本报告于2026年9月发布，数据显示2025年中国快消销售额同比增长0.9%。',
      summary: true,
      expected: null,
    },
    { id: 'published', text: '本报告发布于2026年9月。', expected: null },
    { id: 'range', text: '统计周期：2025年1月至12月。', expected: '统计周期：2025年1月至12月' },
    {
      id: 'quarters',
      text: '本报告于2026年9月发布。统计期间 : 2025年四季度至2026年一季度；',
      expected: '统计期间 : 2025年四季度至2026年一季度',
    },
    { id: 'cutoff', text: '数据截至：2026 年 8 月。', expected: '数据截至：2026 年 8 月' },
    { id: 'survey', text: '调查时间：2025-01-01至2025-12-31。', expected: '调查时间：2025-01-01至2025-12-31' },
    { id: 'fieldwork', text: '调研时间：2025年5月12日。', expected: '调研时间：2025年5月12日' },
    { id: 'coverage', text: '数据覆盖期：2025Q1至2026Q1。', expected: '数据覆盖期：2025Q1至2026Q1' },
    { id: 'forecast', text: '即时物流订单量（预计）：2026 年增长 20%。预计2026年市场走势继续回升。', expected: null },
    { id: 'forecast-label', text: '统计期：2026年（预计）。', expected: null },
    { id: 'mixed-label', text: '统计期：2025年，预测2026年市场走势。', expected: null },
    { id: 'ambiguous', text: '统计期：2025年、2026年。', expected: null },
    { id: 'multiple', text: '统计期：2025年。调查时间：2026年。', expected: null },
    { id: 'inline', text: '报告提到统计期：2025年。', expected: null },
    { id: 'data-source', text: '数据来源：2026年机构调研。', expected: null },
  ];

  for (const { id, text, summary, expected } of cases) {
    await t.test(id, async () => {
      const excerpt = text + body;
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('nielseniq.cn')) return new Response('', { status: 503 });
        const html = url.endsWith('chinese-simplified')
          ? `<div class="blog-post-title"><div class="post-meta"><div class="small-text">November 3, 2026</div></div><a href="/insights/${id}">快消市场研究</a></div>`
          : `<div class="article w-richtext">${summary ? '<h2>报告摘要</h2>' : ''}<p>${excerpt}</p><a href="/report.pdf">下载完整报告</a></div>`;
        return new Response(html, { headers: { 'content-type': 'text/html' } });
      };
      try {
        const { items } = await readResearchSources(now);
        assert.equal(items.length, 1);
        const [item] = items;
        assert.equal(item.research!.dataPeriod, expected);
        assert.equal(item.excerpt, excerpt);
        assert.equal(item.publishedAt, '2026-11-03');
        assert.equal(item.research!.kind, summary ? '官方报告介绍摘录，非报告全文' : '官方研究正文摘录，非全文');
      } finally {
        globalThis.fetch = orig;
      }
    });
  }
});

test('过期中国候选不挤掉有效研报，未来日期不抓取', async () => {
  const orig = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('nielseniq.cn')) return new Response('', { status: 503 });
    if (url.endsWith('chinese-simplified'))
      return new Response(
        [
          ...Array.from({ length: 4 }, (_, i) => ({
            id: 'old-' + i,
            title: '中国快消消费者研究',
            date: 'November 1, 2024',
          })),
          { id: 'future', title: '中国快消研究', date: 'November 9, 2026' },
          { id: 'valid', title: '全球快消消费者研究', date: 'November 3, 2026' },
        ]
          .map(
            (c) =>
              `<div class="blog-post-title"><div class="post-meta"><div class="small-text">${c.date}</div></div><a href="/insights/${c.id}">${c.title}</a></div>`,
          )
          .join(''),
        { headers: { 'content-type': 'text/html' } },
      );
    return new Response(
      `<div class="article w-richtext"><p>${'消费者研究显示快消销售额同比增长0.9%。' + '研究分析渠道结构和消费者购买行为。'.repeat(8)}</p></div>`,
      { headers: { 'content-type': 'text/html' } },
    );
  };
  try {
    const x = await readResearchSources(now);
    assert.equal(x.items.length, 1);
    assert.ok(x.items[0].url.endsWith('/valid'));
    assert.ok(!requests.some((x) => /\/insights\/(old-|future)/u.test(x)));
  } finally {
    globalThis.fetch = orig;
  }
});
