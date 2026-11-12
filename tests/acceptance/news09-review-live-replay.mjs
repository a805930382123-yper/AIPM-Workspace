import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {readResearchSources} from '../../services/news/research-sources.ts';

const base=path.resolve('node_modules/.cache');
const primary=path.join(base,'news09-live'), second=path.join(base,'news09-live-2');
const raw=JSON.parse(await readFile(path.join(primary,'result.json'),'utf8'));
const extra=JSON.parse(await readFile(path.join(second,'pdf-extra-log.json'),'utf8'));
const stats='https://www.stats.gov.cn/sj/zxfbhjd/';
const requests=[];
const responses=new Map();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clean=text=>text.replace(/\s+/gu,' ').trim();
for(const entry of raw.log){
  assert.equal(entry.status,200,entry.url);
  const bytes=await readFile(path.join(primary,entry.snapshot));
  assert.equal(bytes.length,entry.bytes);
  assert.equal(hash(bytes),entry.sha256);
  if(entry.url.startsWith(stats))responses.set(entry.url,bytes);
}
assert.equal(responses.size,6);
const original=globalThis.fetch;
let result;
try{
  globalThis.fetch=async input=>{
    const url=String(input);
    requests.push(url);
    if(responses.has(url))return new Response(responses.get(url),{headers:{'content-type':'text/html'}});
    if(url==='https://worldpanelbynumerator.com/language/chinese-simplified'||url==='https://nielseniq.cn/global/zh/insights/consumer-packaged-goods/')return new Response(null,{status:503});
    throw Error('Missing recorded response: '+url);
  };
  result=await readResearchSources(new Date(raw.result.items[0].fetchedAt));
}finally{globalThis.fetch=original;}
assert.ok(requests.every(url=>!url.includes('pwccn.com')&&!url.includes('ccfa.org.cn')));
assert.deepEqual(requests.filter(url=>url.startsWith(stats)).sort(),[...responses.keys()].sort());
assert.equal(result.sources.find(source=>source.name==='国家统计局').status,'ok');
assert.equal(result.items.length,2);
assert.deepEqual(result.items.map(row=>row.publishedAt),['2026-10-19','2026-09-15']);
const dom=(bytes,url)=>new JSDOM(bytes.toString('utf8'),{url,virtualConsole:new VirtualConsole()});
const listings=[...responses].filter(([url])=>url===stats||url.includes('/index_'));
for(const item of result.items){
  const found=listings.some(([url,bytes])=>{
    const page=dom(bytes,url);
    try{return [...page.window.document.querySelectorAll('a[href]')].some(a=>a.href===item.url&&clean(a.textContent)===item.title&&a.closest('li').textContent.includes(item.publishedAt));}
    finally{page.window.close();}
  });
  assert.ok(found,item.title);
  const page=dom(responses.get(item.url),item.url);
  try{
    const paragraphs=[...page.window.document.querySelectorAll('.trs_editor_view p')].filter(node=>!node.closest('table')).map(node=>clean(node.textContent));
    assert.ok(item.excerpt.split('\n\n').every(part=>paragraphs.includes(clean(part))),item.title);
  }finally{page.window.close();}
}
const retained=await readdir(second);
for(const name of retained.filter(file=>file.endsWith('.bin'))){
  assert.notEqual((await readFile(path.join(second,name))).subarray(0,5).toString('ascii'),'%PDF-');
}
assert.equal(extra.log.length,1);
const request=extra.log[0];
assert.equal(request.status,200);
assert.match(request.error,/TimeoutError/);
assert.equal(extra.result.items.length,0);
const detail=dom(await readFile(path.join(second,'8.bin')),'https://www.pwccn.com/zh/industries/retail-and-consumer/publications/voice-of-consumers-china-report-dec2025.html');
try{assert.ok([...detail.window.document.querySelectorAll('a[href]')].some(a=>a.href===request.url));}
finally{detail.window.close();}
console.log(JSON.stringify({
  replayRequests:requests.length,externalRequests:0,nbsSnapshots:responses.size,pwcDefaultRequests:0,
  statistics:result.items.map(({url,title,publishedAt,research,excerpt})=>({url,title,publishedAt,dataPeriod:research.dataPeriod,excerptLength:excerpt.length,excerptSha256:hash(excerpt)})),
  pwcExtra:{status:request.status,durationMs:request.ms,error:request.error,pdfBodyVerified:false},
},null,2));
