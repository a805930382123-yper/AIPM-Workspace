import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const worldpanel = 'https://worldpanelbynumerator.com';
export const worldpanelList = worldpanel + '/language/chinese-simplified';
export const niq = 'https://nielseniq.cn';
export const niqDetail = niq + '/global/zh/insights/analysis/news11-pdf/';
export const niqPdf = niq + '/wp-content/uploads/sites/9/news11.pdf';
export const titles = {
  first: '中国食品零售第一份合成研究', second: '中国食品零售补抓合成研究',
  tiny: '中国食品零售低质量候选', history: '中国食品零售往期研究',
  stored: '中国食品零售已收录研究', ai: '已有 AI 原始条目', freshAi: 'AIHOT 合成新增',
};
const html = body => new Response(body, { headers: { 'content-type': 'text/html' } });
const unavailable = () => new Response('NEWS11_PRIVATE_BODY_MUST_NOT_LEAK', { status: 503 });
const paragraph = '中国消费者调研显示，食品零售购买频率同比增长 13%，调研覆盖城市渠道。'.repeat(10);
export const responseFor = (url, mode, date) => {
  if (mode === 'all-fail') return unavailable();
  if (url.hostname === 'aihot.news') {
    if (mode === 'diagnostics') return new Response('{', { headers: { 'content-type': 'application/json' } });
    return Response.json({ items: [
      { id: 'already', title: '覆盖已有摘要的候选', summary: '此文是重复候选，不能覆盖原摘要。', links: { original: 'https://example.invalid/news11/old-ai' } },
      { id: 'fresh', title: titles.freshAi, summary: '这是新获取的 AIHOT 原始摘要。', links: { original: 'https://example.invalid/news11/fresh-ai' } },
    ] });
  }
  if (url.href === worldpanelList) {
    return html(['first', 'second', 'tiny', 'history'].map(key =>
      `<article class="blog-post-title"><a href="/insights/news11-${key}">${titles[key]}</a>` +
      `<div class="post-meta"><span class="small-text">${date}</span></div></article>`).join(''));
  }
  if (url.origin === worldpanel && url.pathname.startsWith('/insights/news11-')) {
    if (mode !== 'retry' && url.pathname.endsWith('-second')) return unavailable();
    return html(`<div class="article w-richtext"><p>${url.pathname.endsWith('-tiny') ? '广告' : paragraph}</p></div>`);
  }
  if (url.origin === niq) {
    if (url.href === niqPdf) throw new DOMException('private timeout marker', 'TimeoutError');
    if (url.href === niqDetail) return html(`<a href="${niqPdf}">PDF</a>`);
    return html(`<a class="niq-card-link" href="${niqDetail}"><span class="niq-insight-title">${mode === 'diagnostics' ? '中国食品零售研究' : '家电论坛'}</span><time datetime="${date}"/></a>`);
  }
  if (url.hostname === 'www.stats.gov.cn') return html('<main></main>');
  if (url.hostname === 'www.pwccn.com') return mode === 'diagnostics' ? unavailable() : html('<main></main>');
  if (url.hostname === 'kpmg.com') {
    if (mode === 'diagnostics') throw new TypeError('private socket marker', { cause: { code: 'CERT_HAS_EXPIRED' } });
    return html('<main></main>');
  }
  if (url.hostname === 'china.mintel.com') {
    if (url.pathname.endsWith('feed/')) return new Response(mode === 'diagnostics' ? '<broken' : '<rss><channel/></rss>', { headers: { 'content-type': 'application/rss+xml' } });
    return html('<link rel="alternate" type="application/rss+xml" href="/press-centre/feed/">');
  }
  throw Error('未配置的隔离来源：' + url.hostname);
};

if (process.env.NEWS11_REVIEW_DIR) {
  const run = process.env.NEWS11_REVIEW_DIR;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = new URL(args[0] instanceof Request ? args[0].url : args[0]);
    if (url.hostname === '127.0.0.1') return nativeFetch(...args);
    const { mode, date } = JSON.parse(await readFile(path.join(run, 'fixture.json'), 'utf8'));
    await appendFile(path.join(run, 'source-requests.ndjson'), JSON.stringify({ mode, url: url.href }) + '\n');
    if (mode === 'partial' && url.href === worldpanelList) {
      for (let i = 0; i < 80; i++) {
        if (await readFile(path.join(run, 'release-partial'), 'utf8').then(() => true, () => false)) break;
        if (i === 79) throw Error('验收未释放挂起的来源请求');
        await delay(250);
      }
    }
    // Every remote request is intercepted; real network remains unused, including unexpected URLs.
    return responseFor(url, mode, date);
  };
}
