import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {normalizedTitle,normalizedUrl} from '../../../services/news/normalize.ts';

const base=path.resolve(process.argv[2]??'node_modules/.cache/news07-live-20261109');
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clean=text=>text.replace(/\s+/gu,' ').trim();
const ymd=instant=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));
const result=await readJson(path.join(base,'result.json'));
assert.equal(result.error,undefined);
assert.equal(result.providerCalls,0);
assert.equal(result.rounds.length,2);
assert.equal(result.cache.unchanged,true);
assert.equal(result.cache.requestsBefore,result.cache.requestsAfter);
for(const [file,hash] of Object.entries(result.hashes)) assert.equal(sha(await readFile(file)),hash,file);

const wp='https://worldpanelbynumerator.com';
const niq='https://nielseniq.cn';
const wpList=wp+'/language/chinese-simplified';
const niqList=niq+'/global/zh/insights/consumer-packaged-goods/';
const aiApi='https://aihot.news/api/v1/items?mode=selected&window=24h&limit=5';
const dirs=[wpList,niqList,aiApi];
const rounds=[];
for(const [index,{view,durationMs}] of result.rounds.entries()){
  const round=index+1;
  const requests=result.requests.filter(r=>r.round===round);
  const records=new Map();
  for(const r of requests){
    assert.equal(r.status,200,r.url);
    assert.ok(Date.parse(r.startedAt)<=Date.parse(r.finishedAt));
    assert.ok(r.durationMs>=0);
    assert.equal(r.error,undefined);
    assert.match(r.snapshot,/^response-\d+\.bin$/);
    const bytes=await readFile(path.join(base,r.snapshot));
    assert.equal(bytes.length,r.bytes);
    assert.equal(sha(bytes),r.sha256);
    assert.ok(bytes.length<=(r.url.endsWith('.pdf')?10:2)*1024*1024);
    records.set(r.url,bytes);
  }
  for(const url of dirs) assert.equal(requests.filter(r=>r.url===url).length,1);
  const wpDetails=requests.filter(r=>r.url.startsWith(wp+'/insights/'));
  const niqDetails=requests.filter(r=>r.url.startsWith(niq+'/global/zh/insights/analysis/'));
  const pdfs=requests.filter(r=>r.url.startsWith(niq+'/wp-content/uploads/sites/9/')&&r.url.endsWith('.pdf'));
  assert.equal(requests.length,3+wpDetails.length+niqDetails.length+pdfs.length);
  assert.ok(wpDetails.length<=8&&niqDetails.length<=8&&pdfs.length<=2);
  const edition=view.edition;
  assert.equal(view.aiEnabled,false);
  assert.equal(view.date,ymd(edition.sections.fmcg.startedAt));
  assert.deepEqual(await readJson(path.join(base,'round'+round,'state/news',view.date+'.json')),edition);
  for(const section of Object.values(edition.sections)){
    assert.ok(section.items.length<=5);
    assert.equal(section.status,'source_only');
    assert.ok(Date.parse(section.startedAt)<=Date.parse(section.finishedAt));
    assert.ok(section.sources.every(s=>s.checkedAt===section.startedAt));
    assert.ok(section.items.every(i=>i.fetchedAt===section.startedAt));
  }

  const list=(url,selector,parse)=>{
    const dom=new JSDOM(records.get(url).toString('utf8'),{url,virtualConsole:new VirtualConsole()});
    try{return [...dom.window.document.querySelectorAll(selector)].map(parse);}finally{dom.window.close();}
  };
  const cards=[
    ...list(wpList,'.blog-post-title',node=>{
      const a=node.querySelector('a[href^="/insights/"]');
      return {url:a?.href,title:clean(a?.textContent??''),date:clean(node.querySelector('.post-meta .small-text:not(a)')?.textContent??'')};
    }),
    ...list(niqList,'a.niq-card-link',a=>({url:a.href,title:clean(a.querySelector('.niq-insight-title')?.textContent??''),date:a.querySelector('time')?.getAttribute('datetime')})),
  ];
  const verified=[];
  for(const item of edition.sections.fmcg.items){
    const card=cards.find(c=>c.url===item.url&&c.title===item.title);
    assert.ok(card,item.title);
    const rawDate=new Date(item.sourceId==='worldpanel'?card.date+' UTC':card.date).toISOString();
    assert.equal(Date.parse(item.publishedAt),Date.parse(item.sourceId==='worldpanel'?rawDate.slice(0,10):rawDate));
    assert.ok(item.excerpt.length>0);
    assert.equal(item.evidenceKind,'article_excerpt');
    if(item.sourceId==='worldpanel'){
      const paragraphs=list(item.url,'.article.w-richtext p',p=>clean(p.textContent));
      const excerpt=item.excerpt.split('\n\n');
      assert.ok(excerpt.every(piece=>paragraphs.some(p=>p.includes(clean(piece)))),item.title);
    }else{
      const links=list(item.url,'a[href]',a=>a.href);
      assert.ok(links.includes(item.research.pdfUrl));
      const task=getDocument({data:new Uint8Array(records.get(item.research.pdfUrl)),useSystemFonts:true});
      try{
        const doc=await task.promise;
        const page=await doc.getPage(Number(item.research.pageRange.match(/\d+/)[0]));
        const text=clean((await page.getTextContent()).items.map(token=>token.str??'').join(' '))
          .replace(/(?:©\s*\d{4}\s*Nielsen Consumer LLC\.\s*All Rights Reserved\.\s*)+/giu,'')
          .replace(/^Confidential and proprietary\s*/iu,'');
        assert.ok(text.includes(item.excerpt),item.title);
      }finally{await task.destroy();}
    }
    if(item.research.dataPeriod) assert.ok(item.excerpt.includes(item.research.dataPeriod));
    verified.push({source:item.sourceId,title:item.title,url:item.url,publishedAt:item.publishedAt,pdfUrl:item.research.pdfUrl,page:item.research.pageRange,dataPeriod:item.research.dataPeriod,excerptSha:sha(item.excerpt)});
  }
  const ai=JSON.parse(records.get(aiApi).toString('utf8')).items.slice(0,5);
  assert.equal(edition.sections.ai.items.length,ai.length);
  for(const [i,item] of edition.sections.ai.items.entries()){
    const row=ai[i];
    assert.equal(item.title,row.title.slice(0,300));
    assert.equal(item.url,new URL(row.links.original).href);
    assert.equal(item.publishedAt,row.publishedAt);
    assert.equal(item.excerpt,row.summary.slice(0,1500));
    assert.equal(item.evidenceKind,'source_summary');
  }
  if(round===2){
    const older=await readJson(path.join(base,'round2','state/news',result.history.date+'.json'));
    const before=result.rounds[0].view.edition.sections.fmcg.items;
    assert.equal(older.sections.fmcg.contentVersion,'research-v1');
    assert.equal(older.sections.fmcg.status,'source_only');
    assert.deepEqual(older.sections.fmcg.items,before);
    const titles=new Set(before.map(i=>normalizedTitle(i.title)));
    const urls=new Set(before.map(i=>normalizedUrl(i.url)));
    const excluded=cards.filter(c=>c.url&&(urls.has(normalizedUrl(c.url))||titles.has(normalizedTitle(c.title))));
    assert.equal(new Set(excluded.map(c=>normalizedUrl(c.url))).size,5);
    assert.ok(excluded.every(c=>!requests.some(r=>normalizedUrl(r.url)===normalizedUrl(c.url))));
    assert.ok(verified.every(i=>!urls.has(normalizedUrl(i.url))&&!titles.has(normalizedTitle(i.title))));
    const unrequestedPdfs=niqDetails.flatMap(r=>list(r.url,'a[href]',a=>a.href))
      .filter(url=>url.startsWith(niq+'/wp-content/uploads/sites/9/')&&url.endsWith('.pdf')&&!records.has(url));
    assert.ok(unrequestedPdfs.length>0);
    assert.ok(edition.sections.fmcg.shortageReasons.some(s=>s.includes('PDF 读取预算')));
    assert.ok(edition.sections.fmcg.shortageReasons.some(s=>s.includes('历史或重复')));
  }
  rounds.push({round,durationMs,requests:requests.length,wpDetails:wpDetails.length,niqDetails:niqDetails.length,pdfs:pdfs.length,verified,ai:ai.length});
}
console.log(JSON.stringify({sourceRequests:result.requests.length,extraReviewRequests:0,cache:result.cache,rounds},null,2));
