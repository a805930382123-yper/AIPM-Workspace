import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { readResearchSources } from '../services/news/research-sources.ts';
import { textPdf } from './support/news-pdf-fixture.ts';

const now = new Date('2026-11-20T10:00:00Z');
const origin = 'https://nielseniq.cn';
const htmlDirectory = origin + '/global/zh/insights/consumer-packaged-goods/';
const restDirectory = origin + '/wp-json/wp/v2/insight';
const detail = (slug:string) => origin + '/global/zh/insights/analysis/2026/' + slug + '/';
const pdfUrl = (slug:string) => origin + '/wp-content/uploads/sites/9/2026/11/' + slug + '.pdf';
const html = (body:string) => new Response(body,{headers:{'content-type':'text/html'}});
const pdf = (bytes:Buffer) => new Response(new Uint8Array(bytes),{headers:{'content-type':'application/pdf'}});
const row = (title:string,link:string,date_gmt='2026-11-19T02:30:03') => ({title:{rendered:title},link,date_gmt});
const card = (link:string,title:string,datetime='2026-11-19T02:30:03Z') =>
  `<a class="niq-card-link" href="${link}"><h3 class="niq-insight-title">${title}</h3><time datetime="${datetime}"></time></a>`;
const paragraph = '快消饮料零售研究显示，受监测便利店中无糖茶销量同比增长12.8%，小包装在工作日下午时段的购买频率更高。';
const pdfFinding = '试点门店销售额同比增长12.8%。' + '报告覆盖快消饮料、零食及乳品的门店动销。'.repeat(15);

async function replay(response:(url:URL)=>Response, exclusions?:Parameters<typeof readResearchSources>[1]) {
  const original = globalThis.fetch;
  const requests:string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requests.push(url.href);
    return response(url);
  };
  try {
    const result = await readResearchSources(now, exclusions, new Set(['niq']));
    return { result, requests };
  } finally {
    globalThis.fetch = original;
  }
}

test('NIQ 官网快照片段能在通用 HTML 目录以外发现两份即时零售报告', async () => {
  const snapshot = JSON.parse(await readFile(new URL('./fixtures/news12-niq-20261120.json', import.meta.url),'utf8'));
  const white = snapshot.whitePaper;
  const other = snapshot.omnichannel[0];
  const replayPdf = textPdf([...Array(9).fill('目录'), pdfFinding]);
  assert.ok(snapshot.cards.every(({link}:{link:string}) => link !== white.url && link !== other.link));
  const {result,requests} = await replay(url=>{
    if(url.href === htmlDirectory) return html(snapshot.cards.map(({link,title,datetime}:{link:string;title:string;datetime:string})=>card(link,title,datetime)).join(''));
    if(url.href.startsWith(restDirectory+'?industries=')) return Response.json(snapshot.industry);
    if(url.href.startsWith(restDirectory+'?topics=')) return Response.json(snapshot.omnichannel);
    if(url.href === white.url) return html(`<article><div class="content-row"><div class="content-container"><h2>${white.downloadHeading}</h2><a href="${white.pdfUrl}">${white.pdfLinkText}</a></div></div></article>`);
    if(url.href === white.pdfUrl) return pdf(replayPdf);
    if(url.href === other.link) return html(`<article><h2>报告摘要</h2><p>${paragraph}</p></article>`);
    return html('<article><h2>下载报告</h2></article>');
  });
  const whiteItem = result.items.find(item=>item.url === white.url);
  assert.equal(whiteItem?.publishedAt, '2026-10-23T07:15:46.000Z');
  assert.equal(whiteItem?.evidenceKind, 'article_excerpt');
  assert.equal(whiteItem?.research?.pdfUrl, white.pdfUrl);
  assert.equal(whiteItem?.research?.pageRange, white.pageRange);
  assert.match(whiteItem?.excerpt||'', /12\.8%/u);
  assert.equal(result.items.find(item=>item.url===other.link)?.evidenceKind,'source_summary');
  assert.equal(requests.filter(url=>url.includes('/wp-json/wp/v2/insight?')).length,2);
  assert.equal(requests.filter(url=>url===white.url).length,1);
  assert.equal(result.sources[0].diagnosis?.outcome,'ok');
});

test('NIQ 以真实详情结构区分正文和摘要，排除仅下载、目录路径及历史 URL', async () => {
  const results = [
    row('中国便利店食品货盘研究',detail('web-article')),
    row('中国即时零售饮料洞察',detail('report-summary')),
    row('中国零售渠道报告下载',detail('download-only')),
    row('便利店历史研究',detail('old')),
    row('便利店伪目录研究',origin+'/global/zh/insights/analysis/2026/'),
    row('便利店非详情路径',origin+'/global/zh/insights/analysis/2026/another/nested/'),
  ];
  const methodology = '研究小组连续六个月跟踪当地样本门店，按照门店面积、经营区域和客群结构拆分结果，并结合同一时间段的实际销售记录进行对照。';
  const observations = '研究保留了各门店附近商圈的人口密度、办公和居住客群分布、天气及周边替代业态情况，供阅读者结合自身门店的情景理解差异。';
  const implications = '文章进一步分开比较了工作日和节假日，记录销售时段样本口径并说明同一门店在不同期间的价格变化和库存波动，以便读者辨别周期性影响。';
  const long = [paragraph,methodology,observations,implications, '文章将原始订单与门店记录逐项核对，核对报告表格与回访纪要，比较气温变动前后的实际销售情况，并分析各组商品的销量变化。']
    .map(value=>`<p>${value}</p>`).join('');
  const badPdf = pdfUrl('summary');
  const {result,requests} = await replay(url=>{
    if(url.href === htmlDirectory) return html(card(detail('web-article')+'?utm_source=duplicate','中国便利店食品货盘研究'));
    if(url.href.startsWith(restDirectory+'?industries=')) return Response.json(results);
    if(url.href.startsWith(restDirectory+'?topics=')) return Response.json([row('同一便利店食品货盘研究',detail('web-article').slice(0,-1))]);
    if(url.href === detail('web-article')) return html(`<article>${long}</article>`);
    if(url.href === detail('report-summary')) return html(`<body class="asset-download"><article>${long}<a href="${badPdf}">获取报告</a></article></body>`);
    if(url.href === badPdf) return new Response(null,{status:503});
    if(url.href === detail('download-only')) return html(`<article><h2>下载报告</h2><p>扫码预约</p><div class="niq-popup-content"><p>${paragraph}</p></div></article>`);
    throw Error('Unexpected source URL '+url.href);
  },{urls:new Set([detail('old').slice(0,-1)]),titles:new Set()});
  assert.equal(result.items.length,2);
  const article = result.items.find(item=>item.url === detail('web-article'));
  assert.equal(article?.excerpt,paragraph);
  assert.equal(article?.research?.kind,'官方研究正文摘录，非全文');
  assert.equal(article?.evidenceKind,'article_excerpt');
  const summary = result.items.find(item=>item.url === detail('report-summary'));
  assert.equal(summary?.excerpt,paragraph);
  assert.equal(summary?.research?.kind,'官方报告摘要，非报告全文');
  assert.equal(summary?.evidenceKind,'source_summary');
  assert.equal(summary?.research?.pdfUrl,undefined);
  assert.equal(summary?.research?.pageRange,undefined);
  assert.equal(requests.filter(url=>url.includes('/web-article')).length,1);
  assert.ok(!requests.some(url=>url.includes('/old')||url.includes('/nested')||url.endsWith('/analysis/2026/')));
  assert.equal(result.sources[0].diagnosis?.outcome,'partial');
  assert.equal(result.sources[0].diagnosis?.error?.stage,'pdf');
  assert.equal(result.sources[0].diagnosis?.counts.duplicates,3);
  assert.equal(result.sources[0].diagnosis?.counts.rejected,1);
});

test('NIQ 共享详情和 PDF 请求预算，目录一处失败仍继续取证', async () => {
  const rows = Array.from({length:10},(_,i)=>row('中国即时零售报告 '+i,detail('report-'+i)));
  const {result,requests} = await replay(url=>{
    if(url.href === htmlDirectory) return html(card(detail('report-0'),'中国即时零售报告 0'));
    if(url.href.startsWith(restDirectory+'?industries=')) return Response.json(rows);
    if(url.href.startsWith(restDirectory+'?topics=')) return new Response(null,{status:503});
    if(url.pathname.includes('/analysis/')) return html(`<article><a href="${pdfUrl(url.pathname.split('/').at(-2)!)}">下载</a></article>`);
    if(url.href.endsWith('.pdf')) return pdf(textPdf(['封面',pdfFinding]));
    throw Error('Unexpected source URL '+url.href);
  });
  assert.equal(requests.filter(url=>url.includes('/analysis/')).length,8);
  assert.equal(requests.filter(url=>url.endsWith('.pdf')).length,2);
  assert.equal(result.items.length,2);
  assert.ok(result.shortageReasons?.some(reason=>reason.includes('达到 PDF')));
  assert.ok(result.shortageReasons?.some(reason=>reason.includes('达到详情')));
  assert.equal(result.sources[0].diagnosis?.outcome,'partial');
  assert.equal(result.sources[0].diagnosis?.error?.stage,'list');
});
