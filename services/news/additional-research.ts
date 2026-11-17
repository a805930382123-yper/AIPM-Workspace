import {readSourceBytes,sourceAttempt} from './source-health.ts';
import {createHash} from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {normalizedUrl,normalizedTitle} from './normalize.ts';
import type {NewsItem,SourceExclusions,SourceResult} from './types.ts';
const clean=(s:string)=>s.replace(/\s+/gu,' ').trim();
const permitted=(u:URL)=>u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&((u.hostname==='www.stats.gov.cn'&&/^\/sj\/zxfbhjd\/(?:index_\d+\.html|\d{6}\/t\d+_\d+\.html)?$/u.test(u.pathname))||(u.hostname==='www.pwccn.com'&&(/^\/zh\/industries\/retail-and-consumer(?:\/publications\/[\w-]+)?\.html$/u.test(u.pathname)||/^\/zh\/retail-and-consumer\/[\w-]+\.pdf$/iu.test(u.pathname))));
const get=(url:string,pdf=false)=>readSourceBytes(url,permitted,pdf?'application/pdf':'text/html',
  pdf?/^application\/pdf/iu:/^text\/html/iu,(pdf?10:2)*1024*1024,12000);
const html=(bytes:Buffer,url:string)=>new JSDOM(bytes.toString('utf8'),{url,virtualConsole:new VirtualConsole()});
const entries=[
  {id:'nbs',name:'国家统计局',url:'https://www.stats.gov.cn/sj/zxfbhjd/'},
  {id:'pwc',name:'PwC',url:'https://www.pwccn.com/zh/industries/retail-and-consumer.html'},
];

export async function readAdditionalResearch(now:Date,exclusions?:SourceExclusions,enablePwc=true,sourceIds?:ReadonlySet<string>):Promise<SourceResult> {
  const shortageReasons:string[]=[];
  const result:SourceResult={items:[],sources:[],shortageReasons};
  const cutoff=Date.parse(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)+'T00:00:00+08:00')-364*86400000;
  const selected=entries.filter(source=>(enablePwc||source.id!=='pwc')&&(!sourceIds||sourceIds.has(source.id)));
  await Promise.all(selected.map(async source=>{
    const attempt=sourceAttempt(source,now);
    const items:NewsItem[]=[], candidates:{title:string;url:string;date:string}[]=[];
    const seenUrls=new Set<string>(), seenTitles=new Set<string>(), seenPdfs=new Set<string>();
    const excluded=(candidate:{url:string;title:string})=>exclusions?.urls.has(normalizedUrl(candidate.url))||exclusions?.titles.has(normalizedTitle(candidate.title));
    try {
      for(let index=0;index<(source.id==='nbs'?4:1);index++) {
        const url=index?source.url+'index_'+index+'.html':source.url;
        attempt.stage='list';
        const bytes=await get(url);
        attempt.stage='parse';
        const listing=html(bytes,url);
        try {
          if(source.id==='pwc') {
            for(const el of listing.window.document.querySelectorAll('collection-v3[filter1]')) {
              const data=JSON.parse(el.getAttribute('filter1')!);
              for(const row of data.listItemCollection||[]) {
                const title=clean(row.collectionTitle||''),url=row.url||'',month=String(row.publishDate||'').match(/(\d{1,2})月\s*(20\d\d)/u);
                if(!month||!/消费者/u.test(title)||!/报告|调研|调查/u.test(title)||!permitted(new URL(url))) continue;
                attempt.counts.candidates++;
                if(seenUrls.has(url)) {attempt.counts.duplicates++;continue;}
                seenUrls.add(url);
                candidates.push({title,url,date:month[2]+'-'+month[1].padStart(2,'0')});
              }
            }
          }
          for(const anchor of listing.window.document.querySelectorAll('a[href]')) {
            const title=clean(anchor.textContent||''),target=new URL(anchor.getAttribute('href')!,url);
            if(!permitted(target)||!(source.id==='nbs'?/社会消费品零售总额/u.test(title)&&!/解读|解说|评论|专家|分析/u.test(title):/(消费者|consumer)/iu.test(title)&&/(报告|调查|调研|survey|report)/iu.test(title))) continue;
            attempt.counts.candidates++;
            if(seenUrls.has(target.href)) {attempt.counts.duplicates++;continue;}
            seenUrls.add(target.href);
            const context=anchor.closest('li, article, div')?.textContent||'';
            const date=context.match(/20\d\d[-年./]\s*\d{1,2}[-月./]\s*\d{1,2}/u)?.[0].replace(/[年月./]/gu,'-').replace(/日/u,'')||'';
            candidates.push({title,url:target.href,date});
          }
        } finally {listing.window.close();}
        if(candidates.filter(candidate=>!excluded(candidate)).length>=4) break;
      }
    } catch(error) {attempt.fail(error,attempt.stage);}
    let pdfs=0;
    const eligible=candidates.filter(candidate=>{
      if(excluded(candidate)) {attempt.counts.duplicates++;return false;}
      if(source.id==='pwc'&&/^\d{4}-\d{2}$/u.test(candidate.date)) {
        const time=Date.parse(candidate.date+'-01T00:00:00+08:00');
        return Number.isFinite(time)&&time>=cutoff&&time<=now.getTime();
      }
      return true;
    });
    for(const candidate of eligible.slice(0,4)) {
      if(items.length>=2) break;
      const title=normalizedTitle(candidate.title);
      if(seenTitles.has(title)) {attempt.counts.duplicates++;continue;}
      try {
        attempt.stage='detail';
        const bytes=await get(candidate.url);
        attempt.stage='parse';
        const page=html(bytes,candidate.url),d=page.window.document;
        try {
          let date=candidate.date||d.querySelector('meta[property="article:published_time"]')?.getAttribute('content')||d.querySelector('time')?.getAttribute('datetime')||'';
          const match=date.match(/^(20\d\d)[-年./](\d{1,2})(?:[-月./](\d{1,2}))?/u);
          if(!match||(!match[3]&&source.id!=='pwc')) continue;
          date=match[1]+'-'+match[2].padStart(2,'0')+(match[3]?'-'+match[3].padStart(2,'0'):'');
          const time=Date.parse(date+(match[3]?'':'-01')+'T00:00:00+08:00');
          if(!Number.isFinite(time)||new Date(time+8*3600000).toISOString().slice(0,date.length)!==date||time<cutoff||time>now.getTime()) continue;
          let excerpt='',pdfUrl:string|undefined,pageRange:string|undefined;
          if(source.id==='nbs') {
            const paras=[...d.querySelectorAll('.trs_editor_view p')].filter(p=>!p.closest('table')).map(p=>clean(p.textContent||''));
            const related=paras.filter(value=>/(粮油食品|饮料|烟酒|日用品|商品零售|网络零售|便利店|超市|零售业态)/u.test(value)&&/\d/u.test(value)&&/(%|％|亿元|万亿元)/u.test(value));
            if(related.length) {
              const total=paras.find(value=>/社会消费品零售总额/u.test(value)&&/\d/u.test(value)&&/(%|％|亿元|万亿元)/u.test(value));
              excerpt=[...new Set([...(total?[total]:[]),...related])].slice(0,3).join('\n\n').slice(0,1500);
            }
          } else {
            const link=[...d.querySelectorAll('a[href]')].map(a=>new URL(a.getAttribute('href')!,candidate.url)).find(u=>permitted(u)&&/\.pdf$/iu.test(u.pathname));
            if(link) {
              const pdf=normalizedUrl(link.href);
              if(exclusions?.pdfs?.has(pdf)||seenPdfs.has(pdf)) {attempt.counts.duplicates++;continue;}
              if(pdfs>=2) continue;
              pdfs++;
              pdfUrl=link.href;
              attempt.stage='pdf';
              const bytes=await get(pdfUrl,true);
              attempt.stage='parse';
              const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await task.promise;for(let n=2;n<=Math.min(pdf.numPages,40);n++){const p=await pdf.getPage(n),content=await p.getTextContent(),text=clean(content.items.map(x=>'str'in x?x.str:'').join(' '));if(text.length>=200&&/中国|中国内地/u.test(text)&&/消费者|受访/u.test(text)&&/\d+(?:\.\d+)?\s*[%％]/u.test(text)&&!/(目录|前言|序言)/u.test(text.slice(0,100))){excerpt=text.slice(0,1500);pageRange=`第 ${n} 页`;break;}}}finally{await task.destroy();}
              if(excerpt) seenPdfs.add(pdf);
            }
          }
          if(!excerpt) {attempt.counts.rejected++;continue;}
          seenTitles.add(title);
          items.push({id:createHash('sha256').update(candidate.url).digest('hex').slice(0,24),title:candidate.title,sourceId:source.id,sourceName:source.name,
            url:candidate.url,publishedAt:date,fetchedAt:now.toISOString(),excerpt,evidenceKind:'article_excerpt',
            research:{kind:source.id==='nbs'?'官方统计公报 · 宏观零售统计，非品牌销量':'消费者调查报告 · 受访者调查，非实际销量',dataPeriod:null,...(pdfUrl?{pdfUrl,pageRange}:{})}});
        } finally {page.window.close();}
      } catch(error) {attempt.fail(error,attempt.stage);}
    }
    if(attempt.counts.failed) shortageReasons.push(source.name+'：部分请求或内容解析失败。');
    if(attempt.counts.rejected) shortageReasons.push(source.name+'：部分候选未达到正文要求。');
    if(attempt.counts.duplicates) shortageReasons.push(source.name+'：历史或重复条目已排除。');
    if(items.length<2) shortageReasons.push(source.name+'：合格候选不足。');
    result.items.push(...items);
    result.sources.push(attempt.finish(items.length));
  }));
  return result;
}
