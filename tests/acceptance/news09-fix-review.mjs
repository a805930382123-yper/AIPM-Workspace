import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {NewsService} from '../../services/news/service.ts';
import {readNewsSources} from '../../services/news/sources.ts';
import {RawStore} from '../../services/raw/store.ts';

const base=path.resolve('node_modules/.cache');
const input=path.resolve(process.argv[2]??path.join(base,'news09-fix-live-OxChUt'));
const load=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const events=(await readFile(path.join(input,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const attempts=events.filter(event=>event.event==='start');
assert.equal(attempts.length,3);
assert.ok(events.every(event=>['start','headers','complete'].includes(event.event)));
const snapshots=new Map();
for(const request of attempts){
  const headers=events.find(row=>row.id===request.id&&row.event==='headers');
  const complete=events.find(row=>row.id===request.id&&row.event==='complete');
  assert.equal(headers.status,200);
  assert.ok(headers.ms<=complete.ms&&complete.ms<=12000);
  const bytes=await readFile(path.join(input,request.id+'.bin'));
  assert.equal(bytes.length,complete.bytes);
  assert.equal(sha(bytes),complete.sha256);
  assert.ok(bytes.length<=(request.url.endsWith('.pdf')?10:2)*1024*1024);
  snapshots.set(request.url,bytes);
}
const pwc='https://www.pwccn.com/zh/';
const directory=pwc+'industries/retail-and-consumer.html';
const live=await load(path.join(input,'result.json'));
const [item]=live.items.filter(row=>row.sourceId==='pwc');
assert.ok(item);
assert.equal(live.items.filter(row=>row.sourceId==='pwc').length,1);
assert.equal(live.sources.find(row=>row.name==='PwC').status,'ok');
assert.deepEqual(attempts.map(row=>row.url),[directory,item.url,item.research.pdfUrl]);
const dom=(url)=>new JSDOM(snapshots.get(url).toString('utf8'),{url,virtualConsole:new VirtualConsole()});
const list=dom(directory),detail=dom(item.url);
try{
  const cards=[...list.window.document.querySelectorAll('collection-v3[filter1]')].flatMap(node=>
    JSON.parse(node.getAttribute('filter1')).listItemCollection??[]);
  const card=cards.find(row=>row.url===item.url&&row.collectionTitle.replace(/\s+/gu,' ').trim()===item.title);
  assert.ok(card);
  assert.match(card.publishDate,/12月\s*2025/u);
  assert.equal(item.publishedAt,'2025-12');
  assert.ok([...detail.window.document.querySelectorAll('a[href]')].some(a=>a.href===item.research.pdfUrl));
}finally{list.window.close();detail.window.close();}
const pdf=snapshots.get(item.research.pdfUrl);
assert.equal(sha(pdf),'60d413237288aab359f00a93453fdb1750b3e1a2847df09a9c2dd03b3c8f91a0');
const document=getDocument({data:new Uint8Array(pdf),useSystemFonts:true});
try{
  const opened=await document.promise;
  assert.equal(opened.numPages,40);
  assert.equal(item.research.pageRange,'第 6 页');
  const page=await opened.getPage(6);
  const content=(await page.getTextContent()).items.map(token=>token.str??'').join(' ').replace(/\s+/gu,' ').trim();
  assert.ok(content.includes(item.excerpt));
  assert.match(item.excerpt,/中国消费者|中国内地/);
  assert.match(item.excerpt,/\d+(?:\.\d+)?\s*%/);
}finally{await document.destroy();}

const replayParent=path.join(base,'news09-fix-diagnosis');
await mkdir(replayParent,{recursive:true});
const root=await mkdtemp(path.join(replayParent,'service-review-'));
const rawStore=new RawStore(root);
await rawStore.initialize();
const now=new Date(attempts[0].at);
const clock=()=>now;
const replayed=[],unexpected=[];
const nativeFetch=globalThis.fetch;
let providerCalls=0;
try{
  globalThis.fetch=async input=>{
    const url=String(input);
    replayed.push(url);
    if(snapshots.has(url))return new Response(snapshots.get(url),{headers:{'content-type':url.endsWith('.pdf')?'application/pdf':'text/html'}});
    if(url==='https://aihot.news/api/v1/items?mode=selected&window=24h&limit=5')return Response.json({items:[]});
    if(['https://www.stats.gov.cn/sj/zxfbhjd/','https://worldpanelbynumerator.com/language/chinese-simplified','https://nielseniq.cn/global/zh/insights/consumer-packaged-goods/'].includes(url))return new Response(null,{status:503});
    unexpected.push(url);
    throw Error('Unexpected request in offline replay');
  };
  const deps={root,clock,readSources:readNewsSources,aiEnabled:false,rawStore,
    providerFactory:async()=>{providerCalls++;throw Error('Product model disabled in review');}};
  const service=new NewsService(deps);
  await service.ensure();
  let view;
  for(let i=0;i<150;i++){
    view=await service.today();
    if(Object.values(view.edition.sections).every(section=>section.status!=='running'))break;
    await wait(20);
  }
  assert.equal(view.edition.sections.fmcg.status,'source_only');
  assert.deepEqual(view.edition.sections.fmcg.items.map(row=>row.sourceId),['pwc']);
  const selected=view.edition.sections.fmcg.items[0];
  for(const field of ['title','url','publishedAt','excerpt','research'])assert.deepEqual(selected[field],item[field],field);
  assert.deepEqual(replayed.filter(url=>url.startsWith(pwc)),attempts.map(row=>row.url));
  assert.deepEqual(unexpected,[]);
  const prior=replayed.length,filename=path.join(root,'state/news',view.date+'.json');
  const periodBytes=await readFile(filename,'utf8');
  await service.ensure();
  const restarted=new NewsService(deps);
  await restarted.ensure();
  assert.equal(replayed.length,prior);
  const saved=await service.saveRaw(view.date,'fmcg',selected.id);
  const again=await restarted.saveRaw(view.date,'fmcg',selected.id);
  assert.equal(again.created,false);
  assert.equal(again.rawId,saved.rawId);
  const raw=await rawStore.get(saved.rawId);
  assert.equal(raw.body,item.excerpt);
  assert.equal(raw.publishedAt,'2025-12');
  assert.ok(raw.extractionNote.includes(item.research.pdfUrl)&&raw.extractionNote.includes('第 6 页'));
  assert.equal(await readFile(filename,'utf8'),periodBytes);
  assert.equal(providerCalls,0);
  console.log(JSON.stringify({root,observedLiveRequests:attempts.length,replayRequests:replayed.length,externalRequests:0,cacheAdditional:replayed.length-prior,
    pdfBytes:pdf.length,pdfSha256:sha(pdf),page:6,publishedAt:item.publishedAt,excerptSha256:sha(item.excerpt),rawVerified:true,modelCalls:providerCalls},null,2));
}finally{globalThis.fetch=nativeFetch;}
