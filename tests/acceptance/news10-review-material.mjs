import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readNewResearch} from '../../services/news/new-research.ts';
import {NewsService} from '../../services/news/service.ts';
import {readNewsSources} from '../../services/news/sources.ts';
import {RawStore} from '../../services/raw/store.ts';

const mode=process.argv[2]??'gate';
assert.ok(['gate','production'].includes(mode));
const base=path.resolve('node_modules/.cache');
const round=path.join(base,'news10-live-nJrGHZ');
const mintel=path.join(base,'news10-review','mintel-probe-64UpPY');
const ledger=async file=>(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const compact=text=>text.replace(/\s+/gu,'');
const responses=new Map(),redirects=new Map();
const events=await ledger(path.join(round,'events.jsonl'));
for(const started of events.filter(r=>r.event==='start'&&r.url.includes('kpmg.com'))){
  const headers=events.find(r=>r.id===started.id&&r.event==='headers');
  const end=events.find(r=>r.id===started.id&&r.event==='complete');
  assert.ok(headers&&end);
  const bytes=await readFile(path.join(round,started.id+'.bin'));
  assert.equal(sha(bytes),end.sha256);
  assert.equal(bytes.length,end.bytes);
  if(headers.status===200)responses.set(started.url,{bytes,type:started.url.endsWith('.pdf')?'application/pdf':'text/html'});
  else{
    assert.ok([301,302,303,307,308].includes(headers.status));
    const asset=new URL(started.url);
    asset.hostname='assets.kpmg.com';
    assert.ok(events.some(r=>r.event==='start'&&r.url===asset.href));
    redirects.set(started.url,{target:asset.href,status:headers.status});
  }
}
const press='https://china.mintel.com/press-centre/';
const feed=press+'feed/';
const flavor=press+'flavour-innovation-trends/';
const more=await ledger(path.join(mintel,'events.jsonl'));
for(const [stage,url,type,file] of [
  ['directory',press,'text/html','directory.html'],['feed',feed,'application/rss+xml','feed.xml'],['detail',flavor,'text/html','detail.html'],
]){
  const index=more.findIndex(r=>r.stage===stage&&r.event==='request');
  const bytes=await readFile(path.join(mintel,file));
  assert.equal(more[index].url,url);
  assert.equal(more[index+1].status,200);
  assert.equal(more[index+2].event,'complete');
  assert.equal(more[index+2].sha256,sha(bytes));
  assert.equal(more[index+2].bytes,bytes.length);
  responses.set(url,{bytes,type});
}
const dom=url=>new JSDOM(responses.get(url).bytes.toString('utf8'),{url,virtualConsole:new VirtualConsole()});
const pressPage=dom(press);
try{
  assert.equal(pressPage.window.document.querySelector('link[rel="alternate"][type="application/rss+xml"][href$="/press-centre/feed/"]').href,feed);
}finally{pressPage.window.close();}
const rss=new JSDOM(responses.get(feed).bytes.toString('utf8'),{contentType:'text/xml'});
try{
  const row=[...rss.window.document.querySelectorAll('item')].find(item=>item.querySelector('link')?.textContent===flavor);
  assert.ok(row);
  assert.match(row.querySelector('pubDate').textContent,/17 Sep 2026/);
  assert.ok(row.querySelector('description').textContent.length<200);
  assert.ok([...row.getElementsByTagName('content:encoded')].every(node=>node.textContent.trim().length<200));
}finally{rss.window.close();}

const attempts=[],native=globalThis.fetch;
globalThis.fetch=async input=>{
  const url=String(input);
  attempts.push(url);
  const response=responses.get(url),redirect=redirects.get(url);
  if(response)return new Response(response.bytes,{headers:{'content-type':response.type}});
  if(redirect)return new Response(null,{status:redirect.status,headers:{location:redirect.target}});
  if(url.startsWith('https://aihot.news/'))return Response.json({items:[]});
  return new Response(null,{status:503});
};
const now=new Date('2026-11-12T09:53:00Z');
let cacheAdditional=null,rawVerified=false;
try{
  let items;
  if(mode==='gate'){
    assert.deepEqual((await readNewResearch(now)).items,[]);
    assert.equal(attempts.length,0);
    items=(await readNewResearch(now,undefined,true)).items;
  }else{
    const scratch=path.join(base,'news10-review');
    await mkdir(scratch,{recursive:true});
    const root=await mkdtemp(path.join(scratch,'production-'));
    const rawStore=new RawStore(root);
    await rawStore.initialize();
    const deps={root,clock:()=>now,readSources:readNewsSources,rawStore,aiEnabled:false,
      providerFactory:async()=>{throw Error('Model is disabled in independent review');}};
    const service=new NewsService(deps);
    await service.ensure();
    let view;
    for(let n=0;n<150;n++){
      view=await service.today();
      if(Object.values(view.edition.sections).every(s=>s.status!=='running'))break;
      await wait(20);
    }
    assert.equal(view.edition.sections.fmcg.status,'source_only');
    items=view.edition.sections.fmcg.items;
    assert.ok(items.length<=5);
    const before=attempts.length, file=path.join(root,'state/news',view.date+'.json');
    const bytes=await readFile(file,'utf8');
    const restarted=new NewsService(deps);
    await service.ensure();
    await restarted.ensure();
    cacheAdditional=attempts.length-before;
    assert.equal(cacheAdditional,0);
    for(const item of items){
      const saved=await service.saveRaw(view.date,'fmcg',item.id);
      const again=await restarted.saveRaw(view.date,'fmcg',item.id);
      assert.equal(again.created,false);
      assert.equal(again.rawId,saved.rawId);
      const raw=await rawStore.get(saved.rawId);
      assert.equal(raw.body,item.excerpt);
      assert.equal(raw.publishedAt,item.publishedAt);
      assert.ok(raw.extractionNote.includes(item.research.kind));
      if(item.research.pdfUrl)assert.ok(raw.extractionNote.includes(item.research.pdfUrl)&&raw.extractionNote.includes('第 31 页'));
    }
    assert.equal(await readFile(file,'utf8'),bytes);
    rawVerified=true;
  }
  assert.equal(attempts.filter(x=>x===press).length,1);
  assert.equal(attempts.filter(x=>x===feed).length,1);
  assert.ok(attempts.indexOf(press)<attempts.indexOf(feed)&&attempts.indexOf(feed)<attempts.indexOf(flavor));
  assert.ok(attempts.filter(x=>x.startsWith(press)&&x!==press&&x!==feed).length<=6);
  assert.deepEqual(items.map(item=>item.sourceId).sort(),['kpmg','mintel']);
  const kpmg=items.find(item=>item.sourceId==='kpmg');
  const official=items.find(item=>item.sourceId==='mintel');
  assert.equal(kpmg.publishedAt,'2026-09-09');
  assert.equal(kpmg.research.pageRange,'第 31 页');
  assert.match(kpmg.research.kind,/行业研究报告PDF摘录，含机构分析及引用数据/);
  const kAsset=responses.get(redirects.get(kpmg.research.pdfUrl)?.target??kpmg.research.pdfUrl);
  assert.ok(kAsset);
  const document=getDocument({data:new Uint8Array(kAsset.bytes),useSystemFonts:true});
  try{
    const opened=await document.promise;
    assert.equal(opened.numPages,70);
    const original=(await (await opened.getPage(31)).getTextContent()).items.map(token=>token.str??'').join(' ');
    assert.ok(compact(original).includes(compact(kpmg.excerpt)));
    assert.match(kpmg.excerpt,/中国健康选购食品/);
    assert.match(kpmg.excerpt,/线上电商以 41\.6%/);
    assert.match(kpmg.excerpt,/直播.*16\.3%/);
    assert.match(kpmg.excerpt,/。$/);
  }finally{await document.destroy();}
  assert.equal(official.url,flavor);
  assert.equal(official.publishedAt,'2026-09-17');
  assert.match(official.research.kind,/公开报告摘要，未取得报告全文/);
  assert.ok(official.excerpt.length>=200);
  const detail=dom(flavor);
  try{
    assert.match(detail.window.document.querySelector('main').textContent,/2026年9月17日/);
    const paragraphs=[...detail.window.document.querySelectorAll('.article-content .mintel-paragraph p')].map(p=>compact(p.textContent));
    assert.ok(official.excerpt.split('\n\n').every(part=>paragraphs.includes(compact(part))));
  }finally{detail.window.close();}
  console.log(JSON.stringify({mode,externalRequests:0,replayedRequests:attempts.length,cacheAdditional,rawVerified,
    items:items.map(item=>({source:item.sourceId,publishedAt:item.publishedAt,page:item.research.pageRange,kind:item.research.kind,excerptChars:item.excerpt.length,excerptSha:sha(item.excerpt)}))},null,2));
}finally{globalThis.fetch=native;}
