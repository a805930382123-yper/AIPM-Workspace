import {appendFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {JSDOM,VirtualConsole} from 'jsdom';

const origin='https://china.mintel.com';
const directory=origin+'/press-centre/';
const base=path.resolve('node_modules/.cache/news10-review');
const [stage,folder,detail]=process.argv.slice(2);
await mkdir(base,{recursive:true});
const clean=text=>text.replace(/\s+/gu,' ').trim();
const dom=(bytes,url)=>new JSDOM(bytes.toString('utf8'),{url,virtualConsole:new VirtualConsole()});
function rssItems(bytes){
  const feed=new JSDOM(bytes.toString('utf8'),{contentType:'text/xml'});
  try{
    return [...feed.window.document.querySelectorAll('item')].map(row=>{
      const url=row.querySelector('link')?.textContent?.trim()??'';
      const title=clean(row.querySelector('title')?.textContent??'');
      const date=row.querySelector('pubDate')?.textContent?.trim()??null;
      const encoded=row.getElementsByTagName('content:encoded')[0]?.textContent??'';
      const summary=row.querySelector('description')?.textContent??'';
      return {url,title,date,encodedChars:encoded.length,summaryChars:summary.length};
    }).filter(row=>row.url.startsWith(origin+'/press-centre/')&&row.title);
  }finally{feed.window.close();}
}
function cards(bytes){
  const page=dom(bytes,directory);
  try{
    const found=new Map();
    for(const a of page.window.document.querySelectorAll('a[href]')){
      const url=new URL(a.href);
      const title=clean(a.textContent??'')||a.getAttribute('aria-label')||'';
      if(url.origin!==origin||!/^\/press-centre\/[a-z0-9-]+\/?$/iu.test(url.pathname)||title.length<8)continue;
      const sameCard=a.closest('article,li')??a.parentElement?.parentElement;
      const date=sameCard?.textContent?.match(/20\d\d年\s*\d{1,2}月\s*\d{1,2}日/u)?.[0]??null;
      found.set(url.href,{title,url:url.href,date});
    }
    return [...found.values()];
  }finally{page.window.close();}
}

if(!['directory','feed','detail'].includes(stage))throw Error('Expected directory, feed, or detail');
const run=stage==='directory'?await mkdtemp(path.join(base,'mintel-probe-')):path.resolve(folder);
if(!run.startsWith(base+path.sep))throw Error('Evidence must stay in the isolated review directory');
const ledger=path.join(run,'events.jsonl');
const emit=(event,fields={})=>{
  const entry={event,at:new Date().toISOString(),...fields};
  appendFileSync(ledger,JSON.stringify(entry)+'\n');
  console.log(JSON.stringify(entry));
};
const directoryBytes=stage==='directory'?null:await readFile(path.join(run,'directory.html'));
let url=stage==='directory'?directory:detail;
if(stage==='feed'){
  const page=dom(directoryBytes,directory);
  try{
    url=page.window.document.querySelector('link[rel="alternate"][type="application/rss+xml"][href$="/press-centre/feed/"]')?.href;
    if(url!==origin+'/press-centre/feed/')throw Error('Expected declared official press RSS');
  }finally{page.window.close();}
}
if(stage==='detail'){
  const feed=await readFile(path.join(run,'feed.xml')).catch(()=>null);
  if(![...cards(directoryBytes),...(feed?rssItems(feed):[])].some(card=>card.url===url))throw Error('Detail URL must be discovered in the captured official directory or RSS');
}
const started=performance.now();
const duration=()=>Math.round(performance.now()-started);
let bytes=0,phase='headers';
try{
  emit('request',{url,run,stage,timeoutMs:12000});
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:stage==='feed'?'application/rss+xml,application/xml,text/xml':'text/html'}});
  const type=response.headers.get('content-type')??'';
  emit('headers',{status:response.status,type,durationMs:duration()});
  const expected=stage==='feed'?/^(?:application\/(?:rss\+xml|xml)|text\/xml)/i:/^text\/html/i;
  if(response.status!==200||!expected.test(type)){await response.body?.cancel();throw Error('Expected HTTP 200 with an official listing or article content type');}
  phase='body';
  const stream=response.body.getReader(), chunks=[];
  for(;;){
    const read=await stream.read();
    if(read.done)break;
    bytes+=read.value.length;
    if(bytes>2*1024*1024){await stream.cancel();throw Error('HTML exceeds size limit');}
    chunks.push(read.value);
  }
  const body=Buffer.concat(chunks,bytes);
  await writeFile(path.join(run,stage==='feed'?'feed.xml':stage+'.html'),body);
  emit('complete',{bytes,sha256:createHash('sha256').update(body).digest('hex'),durationMs:duration()});
  if(stage==='directory')emit('discovered',{cards:cards(body)});
  else if(stage==='feed')emit('rss',{items:rssItems(body)});
  else{
    const page=dom(body,url);
    try{
      const d=page.window.document;
      const roots=[...d.querySelectorAll('article,main')];
      const main=roots.sort((a,b)=>a.textContent.length-b.textContent.length).find(node=>node.querySelector('p'))??d.body;
      const date=clean(main.textContent).match(/20\d\d年\s*\d{1,2}月\s*\d{1,2}日/u)?.[0]??null;
      const ld=[...d.querySelectorAll('script[type="application/ld+json"]')].flatMap(node=>{
        try{
          const value=JSON.parse(node.textContent??'');
          return Array.isArray(value)?value:[value,...(value['@graph']??[])];
        }catch{return [];}
      });
      const paragraphs=[...main.querySelectorAll('p')].map(p=>clean(p.textContent));
      const evidence=paragraphs.filter(p=>/食品|饮料|美妆|美容|个护|零售/u.test(p)&&/\d+(?:\.\d+)?\s*[%％]/u.test(p));
      emit('material',{title:d.querySelector('h1')?.textContent.trim(),visibleDate:date,datePublished:ld.find(x=>x.datePublished)?.datePublished??null,
        qualifiedParagraphs:evidence.length,qualifiedCharacters:evidence.reduce((n,p)=>n+p.length,0),candidateSha256:evidence.map(p=>createHash('sha256').update(p).digest('hex'))});
    }finally{page.window.close();}
  }
}catch(error){
  emit('failed',{phase,bytes,durationMs:duration(),name:error.name,message:error.message});
  process.exitCode=1;
}
