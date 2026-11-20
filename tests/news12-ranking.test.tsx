import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { evaluateResearchValue } from '../services/news/research-value.ts';
import { NewsService } from '../services/news/service.ts';
import type { NewsEdition, NewsItem } from '../services/news/types.ts';
import { RawStore } from '../services/raw/store.ts';

const now=new Date('2026-11-20T06:00:00Z');
const item=(id:string,title:string,excerpt:string,publishedAt='2026-11-18'):NewsItem=>({
  id,title,excerpt,publishedAt,url:`https://example.com/${id}`,fetchedAt:now.toISOString(),
  sourceId:id,sourceName:'官方研究机构',evidenceKind:'article_excerpt',
  research:{kind:'官方研究正文摘录，非全文',dataPeriod:null},
});
const detailed='调研覆盖中国 200 家线下门店和即时零售渠道。饮料即时零售销量同比增长 15%。';
const immediate=item('older','中国饮料即时零售与线下货盘研究',detailed,'2026-10-23');
const general=item('general','全球食品消费趋势研究','消费者调查发现，购物者更重视低糖零食。');
const macro=item('macro','10月份社会消费品零售总额增长','限额以上粮油食品类零售额同比增长 3%，超市零售额增长 6%。');

test('重点经营、限定口径和数据能解释优先级，宣传、转载与纯宏观排除',()=>{
  const value=evaluateResearchValue(immediate);
  assert.ok(value.priority>evaluateResearchValue(general).priority);
  assert.equal(value.reason,'研究正文摘录涉及中国市场、即时零售与 O2O、货盘与 SKU，提供品类信息、量化数据、数据范围或口径。');
  assert.match(value.application??'',/畅销 SKU 重合度.+？/u);
  assert.equal(evaluateResearchValue(general).application,undefined);
  for(const row of [
    macro,
    item('event','中国即时零售峰会回顾',detailed),
    item('promotion','中国即时零售品牌上新：饮料买一送一',detailed),
    item('repost','转载：中国饮料即时零售研究',detailed),
    item('brief','行业快讯：中国即时配送研究',detailed),
    item('vague','中国即时零售洞察报告','报告围绕市场现状和未来机会，欢迎下载阅读。'),
    {...immediate,evidenceKind:'source_summary' as const},
  ]) assert.equal(evaluateResearchValue(row).eligible,false,row.title);
  assert.equal(evaluateResearchValue({...immediate,evidenceKind:'source_summary',research:{kind:'官方报告摘要，非报告全文',dataPeriod:null}}).eligible,true);
});

test('新期按业务分档、同档按发布日期、联合 PDF 只收一份，保留上期 Raw',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'news12-ranking-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const rawStore=new RawStore(root);
  await rawStore.initialize();
  const recent={...immediate,id:'recent',title:'中国即时零售与线下的饮料货盘对比',url:'https://example.com/recent',
    sourceId:'recent',publishedAt:'2026-11-01',research:{...immediate.research!,pdfUrl:'https://example.com/joint.pdf'}};
  const shared={...immediate,research:{...immediate.research!,pdfUrl:recent.research.pdfUrl}};
  const other=item('other','中国食品即时零售货盘研究',detailed,'2026-10-24');
  const archived=item('archived','中国食品经销渠道研究','研究显示，中国食品经销渠道销量同比下降 8%。');
  const legacyBrief={...item('legacy','零售行业快讯','品牌发布新品，欢迎到店选购。'),research:undefined};
  const date='2026-11-19';
  const originalEdition:NewsEdition={schemaVersion:1,date,updatedAt:now.toISOString(),sections:{fmcg:{
    contentVersion:'research-v1',status:'source_only',attempt:1,startedAt:now.toISOString(),sources:[],items:[macro,archived,legacyBrief],
  }}};
  const dir=path.join(root,'state','news'),file=path.join(dir,`${date}.json`);
  await mkdir(dir,{recursive:true});
  await writeFile(file,JSON.stringify(originalEdition));
  const before=await readFile(file,'utf8');
  const service=new NewsService({root,rawStore,clock:()=>now,aiEnabled:false,providerFactory:async()=>assert.fail('意外的模型调用'),
    readSources:async section=>({items:section==='fmcg'?[macro,general,shared,other,recent]:[],
      sources:[{name:'fixture',checkedAt:now.toISOString(),status:'ok'}]})});
  const savedBefore=await service.saveRaw(date,'fmcg',archived.id);
  const today=await service.ensure(true);
  assert.deepEqual(today?.sections.fmcg?.items.map(row=>row.id),['recent','other','general']);
  assert.deepEqual((await service.today()).recentFmcg.map(entry=>[entry.date,entry.item.id]),[[date,'archived']]);
  assert.equal(await readFile(file,'utf8'),before);
  assert.equal((await service.saveRaw(date,'fmcg',archived.id)).rawId,savedBefore.rawId);
  assert.equal((await rawStore.get(savedBefore.rawId))?.body,archived.excerpt);
});

test('快消研究卡显示官方材料类型、选入理由和可验证问题，保存仍引用原期刊',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const fetchBefore=globalThis.fetch;
  t.after(()=>{globalThis.fetch=fetchBefore;dom.window.close();});
  const sourceSummary:NewsItem={...immediate,evidenceKind:'source_summary',research:{kind:'官方报告摘要，非报告全文',dataPeriod:null}};
  const date='2026-11-19';
  const requests:Array<{url:string;body?:BodyInit|null}>=[];
  globalThis.fetch=async (input,init)=>{
    const url=String(input);
    if(url.endsWith('/today')) return Response.json({date:'2026-11-20',aiEnabled:false,edition:null,fallbacks:{},recentFmcg:[{date,item:sourceSummary}]});
    if(url.endsWith('/history')||url.endsWith('/saved-raws')) return Response.json({items:[],errors:[]});
    if(url.endsWith('/save-raw')) {requests.push({url,body:init?.body});return Response.json({rawId:'saved',status:'saved',created:true});}
    assert.fail(`意外请求 ${url}`);
  };
  const {NewsPage}=await import('../app/pages/NewsPage.tsx');
  const root=createRoot(document.querySelector('#root')!);
  try {
    await act(async()=>root.render(<NewsPage/>));
    const card=document.querySelector('.news-article');
    assert.match(card?.textContent??'',/官方研究机构.*官方报告摘要，非报告全文/u);
    assert.match(card?.textContent??'',/推荐理由.*公开报告摘要.*即时零售与 O2O/u);
    assert.match(card?.textContent??'',/应用建议.*畅销 SKU 重合度有多高？/u);
    const button=card?.querySelector('button');
    assert.ok(button);
    await act(async()=>button.click());
    assert.deepEqual(requests,[{url:'/api/news/editions/2026-11-19/items/save-raw',body:JSON.stringify({section:'fmcg',itemId:immediate.id})}]);
  } finally {await act(async()=>root.unmount());}
});
