import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NewsService } from '../services/news/service.ts';
import { readNewsSources } from '../services/news/sources.ts';
import { RawStore } from '../services/raw/store.ts';
import type { NewsEdition, NewsItem } from '../services/news/types.ts';

const now=new Date('2026-11-20T08:00:00Z');
const date='2026-11-20';

test('AIHOT 前五保留，其他来源隔离失败、稳定去重，满额检查后仍可保存新来源',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'news13-'));
  const originalFetch=globalThis.fetch;
  const channel='UCXUPKJO5MZQN11PqgIvyuvQ';
  const ids=['abcdefghijk','ABCDEFGHIJK','KJIHGFEDCBA'];
  const rows=Array.from({length:5},(_,i)=>({id:String(i),title:`AIHOT ${i}`,summary:`AIHOT 摘要 ${i}`,
    publishedAt:now.toISOString(),links:{original:i===0?`https://www.youtube.com/watch?v=${ids[0]}&utm_source=aihot`:`https://example.com/${i}`}}));
  let limit=2,models=0;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.hostname==='aihot.news') return Response.json({items:rows});
    if(url.pathname==='/feeds/videos.xml') {
      const entries=ids.slice(0,limit).map((id,i)=>`<entry><title>课程 ${i}</title><published>2026-11-20T06:00:00Z</published><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId><media:group><media:description>视频简介 ${i}</media:description></media:group></entry>`);
      return new Response(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">${entries.join('')}</feed>`,{headers:{'Content-Type':'application/xml'}});
    }
    return new Response('',{status:503});
  };
  try {
    const rawStore=new RawStore(root);
    await rawStore.initialize();
    const make=()=>new NewsService({root,rawStore,clock:()=>now,aiEnabled:false,
      readSources:(section,at,exclusions,sourceIds)=>section==='ai'?readNewsSources(section,at,exclusions,sourceIds):Promise.resolve({items:[],sources:[]}),
      providerFactory:async()=>{models++;throw Error('Unexpected model call');},
    });
    const service=make();
    const first=(await service.ensure(true))!.sections.ai!;
    assert.deepEqual(first.items.map(item=>item.title),rows.map(row=>row.title));
    assert.equal(first.sources.length,9);
    const unavailable=first.sources.find(source=>source.sourceId==='karpathy-blog');
    assert.equal(unavailable?.homepage,'https://karpathy.bearblog.dev/blog/');
    assert.equal(unavailable?.diagnosis?.error?.httpStatus,503);
    const youtube=first.sources.find(source=>source.sourceId==='karpathy-youtube');
    assert.equal(youtube?.diagnosis?.counts.duplicates,1);
    assert.deepEqual(first.sourceItems?.map(item=>item.url),[`https://www.youtube.com/watch?v=${ids[1]}`]);

    limit=3;
    await service.check('ai','all',first.attempt);
    const checked=await service.ensure(true);
    const second=checked!.sections.ai!;
    assert.deepEqual(second.items,first.items);
    assert.deepEqual(second.sourceItems?.map(item=>item.url),ids.slice(1).map(id=>`https://www.youtube.com/watch?v=${id}`));
    assert.match(second.checkMessage??'',/满5条.*按来源浏览新增 1 条/);
    assert.equal(second.sources.length,9);

    const restored=make();
    const item=(await restored.edition(date))!.sections.ai!.sourceItems![1];
    const saved=await restored.saveRaw(date,'ai',item.id);
    const raw=await rawStore.get(saved.rawId);
    assert.equal(raw?.body,item.excerpt);
    assert.equal(raw?.url,item.url);
    assert.equal(raw?.publishedAt,item.publishedAt);
    assert.equal(raw?.extractionNote,'视频简介；作者：Andrej Karpathy');
    assert.deepEqual((await restored.savedRaws(date)).items,[{section:'ai',itemId:item.id,rawId:saved.rawId,status:'saved'}]);
    assert.equal((await restored.saveRaw(date,'ai',item.id)).created,false);
    assert.equal(models,0);
  } finally {
    globalThis.fetch=originalFetch;
    await rm(root,{recursive:true,force:true});
  }
});

test('AI 前沿有五条时可按来源展开视频简介并保存，也能打开无条目的官方入口',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5173/',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,
    Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
  const items:Array<NewsItem>=Array.from({length:5},(_,i)=>({id:`ai-${i}`,title:`精选 ${i}`,sourceId:'aihot',sourceName:'AIHOT',
    url:`https://example.com/${i}`,publishedAt:null,fetchedAt:now.toISOString(),excerpt:'来源摘要',evidenceKind:'source_summary'}));
  const video:NewsItem={...items[0],id:'video',title:'视频',sourceId:'karpathy-youtube',sourceName:'Karpathy · YouTube',
    author:'Andrej Karpathy',url:'https://www.youtube.com/watch?v=ABCDEFGHIJK',excerpt:'来源提供的视频介绍'};
  const edition:NewsEdition={schemaVersion:1,date,updatedAt:now.toISOString(),sections:{ai:{status:'source_only',attempt:1,
    startedAt:now.toISOString(),items,sourceItems:[video],sources:[{sourceId:'karpathy-x',name:'Karpathy · X 公开帖',
      checkedAt:now.toISOString(),status:'failed',homepage:'https://x.com/karpathy'}]}}};
  const originalFetch=globalThis.fetch;
  let saved:unknown;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.endsWith('/today')) return Response.json({date,edition,aiEnabled:false,fallbacks:{}});
    if(url.endsWith('/history')||url.endsWith('/saved-raws')) return Response.json({items:[],errors:[]});
    if(url.endsWith('/save-raw')) {
      saved=JSON.parse(String(init?.body));
      return Response.json({rawId:'raw-id',status:'saved',created:true});
    }
    throw Error(url);
  };
  const {NewsPage}=await import('../app/pages/NewsPage.tsx');
  const root=createRoot(document.getElementById('root')!);
  try {
    await act(async()=>root.render(<NewsPage/>));
    const ai=document.getElementById('news-section-ai')!;
    assert.match(ai.textContent!,/5\/5 条/);
    assert.equal(ai.querySelectorAll(':scope > .news-article').length,5);
    const group=ai.querySelector<HTMLDetailsElement>('.news-source-items details')!;
    assert.equal(group.querySelector('summary')?.textContent,'Karpathy · YouTube（1 条）');
    group.open=true;
    assert.match(group.textContent!,/Andrej Karpathy.*视频简介/u);
    assert.match(group.textContent!,/来源提供的视频介绍/u);
    assert.doesNotMatch(group.textContent!,/AIHOT/u);
    assert.equal(ai.querySelector('a[aria-label="Karpathy · X 公开帖 官方入口"]')?.getAttribute('href'),'https://x.com/karpathy');
    await act(async()=>group.querySelector('button')!.click());
    assert.deepEqual(saved,{section:'ai',itemId:'video'});
    assert.match(group.textContent!,/已保存/);
  } finally {
    await act(async()=>root.unmount());
    globalThis.fetch=originalFetch;
    dom.window.close();
  }
});
