import {readSourceBytes,sourceAttempt} from './source-health.ts';
import {researchTopicPriority} from './research-value.ts';
import {createHash} from 'node:crypto';import {JSDOM,VirtualConsole} from 'jsdom';import {normalizedUrl,normalizedTitle} from './normalize.ts';import type {NewsItem,SourceExclusions,SourceResult} from './types.ts';
const clean=(s:string)=>s.replace(/\s+/gu,' ').trim();const kdir='https://kpmg.com/cn/zh/industries/consumer-and-retail.html';const mintelDirectory='https://china.mintel.com/press-centre/';
const allowed=(u:URL)=>u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&((u.hostname==='kpmg.com'&&(u.href===kdir||/^\/cn\/zh\/insights\/\d{4}\/\d{2}\//u.test(u.pathname)))||(['kpmg.com','assets.kpmg.com'].includes(u.hostname)&&/^\/content\/dam\/kpmgsites\/cn\/pdf\/zh\//u.test(u.pathname)&&/\.pdf(?:\.coredownload\.inline\.pdf)?$/iu.test(u.pathname))||(u.hostname==='china.mintel.com'&&(u.pathname==='/press-centre/'||/^\/insights\/(articles|downloads)\/$/u.test(u.pathname)||/^\/(insights|press-centre)\/[\w\-/]+\/?$/u.test(u.pathname))));
const get=(url:string,pdf=false)=>readSourceBytes(url,allowed,pdf?'application/pdf':'text/html',
  pdf?/^application\/pdf/iu:/^(text\/html|application\/rss\+xml|application\/xml|text\/xml)/iu,(pdf?10:2)*1024*1024,pdf?60000:12000,true);
const dom=(data:Buffer,url:string)=>new JSDOM(data.toString('utf8'),{url,virtualConsole:new VirtualConsole()});
const entries=[{id:'kpmg',name:'KPMG',url:kdir},{id:'mintel',name:'Mintel',url:mintelDirectory}];

export async function readNewResearch(now:Date,exclusions?:SourceExclusions,enabled=false,sourceIds?:ReadonlySet<string>):Promise<SourceResult> {
  const shortageReasons:string[]=[];
  const result:SourceResult={items:[],sources:[],shortageReasons};
  if(!enabled) return result;
  const cutoff=Date.parse(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)+'T00:00:00+08:00')-364*86400000;
  await Promise.all(entries.filter(source=>!sourceIds||sourceIds.has(source.id)).map(async source=>{
    const attempt=sourceAttempt(source,now);
    const items:NewsItem[]=[], candidates:{url:string;title:string;date?:string}[]=[];
    const seenUrls=new Set<string>(), seenTitles=new Set<string>(), seenPdfs=new Set<string>();
    try {
      const bytes=await get(source.url);
      attempt.stage='parse';
      const listing=dom(bytes,source.url);
      try {
        if(source.id==='mintel') {
          const link=[...listing.window.document.querySelectorAll('link[rel~="alternate"][type="application/rss+xml"][href]')]
            .map(element=>new URL(element.getAttribute('href')!,source.url))
            .find(target=>allowed(target)&&target.hostname==='china.mintel.com'&&/^\/press-centre\/[^?#]*feed\/?$/u.test(target.pathname));
          if(!link) throw Error('缺少官方RSS声明');
          attempt.stage='list';
          const feedBytes=await get(link.href);
          attempt.stage='parse';
          const feed=new JSDOM(feedBytes.toString('utf8'),{contentType:'text/xml'});
          try {
            if(!feed.window.document.querySelector('rss > channel')) throw Error('RSS结构异常');
            for(const row of feed.window.document.querySelectorAll('item')) {
              const title=clean(row.querySelector('title')?.textContent||''),url=clean(row.querySelector('link')?.textContent||''),date=clean(row.querySelector('pubDate')?.textContent||'');
              if(!url||!allowed(new URL(url))||(!researchTopicPriority(title)&&!/美容|零售|消费|风味/u.test(title))) continue;
              attempt.counts.candidates++;
              const key=normalizedUrl(url);
              if(seenUrls.has(key)||exclusions?.urls.has(key)||exclusions?.titles.has(normalizedTitle(title))) {attempt.counts.duplicates++;continue;}
              seenUrls.add(key);
              candidates.push({url,title,date});
            }
          } finally {feed.window.close();}
        } else {
          for(const anchor of listing.window.document.querySelectorAll('a[href]')) {
            const target=new URL(anchor.getAttribute('href')!,source.url),title=clean(anchor.textContent||'');
            if(!allowed(target)||!/^\/cn\/zh\/insights\/\d{4}\/\d{2}\//u.test(target.pathname)||(!researchTopicPriority(title)&&!/消费|零售/u.test(title))) continue;
            attempt.counts.candidates++;
            const key=normalizedUrl(target.href);
            if(seenUrls.has(key)||exclusions?.urls.has(key)||exclusions?.titles.has(normalizedTitle(title))) {attempt.counts.duplicates++;continue;}
            seenUrls.add(key);
            candidates.push({url:target.href,title});
          }
        }
      } finally {listing.window.close();}
    } catch(error) {attempt.fail(error,attempt.stage);}
    candidates.sort((a,b)=>researchTopicPriority(b.title)-researchTopicPriority(a.title)||
      (source.id==='mintel'?Number(/中国/u.test(b.title))-Number(/中国/u.test(a.title))||
        Number(b.url.includes('/press-centre/'))-Number(a.url.includes('/press-centre/'))||
        (Date.parse(b.date||'')||0)-(Date.parse(a.date||'')||0):0));
    let pdfs=0;
    for(const c of candidates.slice(0,source.id==='kpmg'?4:6)) {
      if(source.id==='kpmg'&&items.length>=2) break;
      const title=normalizedTitle(c.title);
      if(seenTitles.has(title)) {attempt.counts.duplicates++;continue;}
      try {
        attempt.stage='detail';
        const bytes=await get(c.url);
        attempt.stage='parse';
        const page=dom(bytes,c.url),d=page.window.document;
        try {
          let date=d.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
            ||d.querySelector('meta[name="date_published"]')?.getAttribute('content')
            ||d.querySelector('time[datetime]:not([class*=modified]):not([class*=updated])')?.getAttribute('datetime')
            ||clean(d.querySelector('time:not([class*=modified]):not([class*=updated])')?.textContent||'')
            ||clean(d.querySelector('main .always-first-block .text-medium-grey')?.textContent||'');
          for(const el of d.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const parsed=JSON.parse(el.textContent||'');
              const rows=Array.isArray(parsed)?parsed:[parsed,...(parsed['@graph']||[])];
              date ||=rows.find(row=>row.datePublished)?.datePublished||'';
            } catch { /* The same publication date may be available in other metadata. */ }
          }
          if(!date&&c.date&&Number.isFinite(Date.parse(c.date))) {
            date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(c.date));
          }
          const match=date.match(/^(20\d\d)[-年](\d{1,2})(?:[-月](\d{1,2}))?/u);
          if(!match||(!match[3]&&source.id!=='kpmg')) continue;
          date=match[1]+'-'+match[2].padStart(2,'0')+(match[3]?'-'+match[3].padStart(2,'0'):'');
          const time=Date.parse(date+(match[3]?'':'-01')+'T00:00:00+08:00');
          if(!Number.isFinite(time)||new Date(time+8*3600000).toISOString().slice(0,date.length)!==date||time<cutoff||time>now.getTime()) continue;
          let excerpt='',pdfUrl:string|undefined,pageRange:string|undefined,kind='公开洞察正文';
          if(source.id==='kpmg') {
            kind='行业研究报告PDF摘录，含机构分析及引用数据';
            const link=[...d.querySelectorAll('a[href]')].map(a=>new URL(a.getAttribute('href')!,c.url))
              .find(u=>allowed(u)&&/\.pdf(?:\.coredownload\.inline\.pdf)?$/iu.test(u.pathname));
            if(link) {
              const pdfKey=normalizedUrl(link.href);
              if(exclusions?.pdfs?.has(pdfKey)||seenPdfs.has(pdfKey)) {attempt.counts.duplicates++;continue;}
              if(pdfs>=2) continue;
              pdfs++;
              pdfUrl=link.href;
              attempt.stage='pdf';
              const bytes=await get(pdfUrl,true);
              attempt.stage='parse';
              const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
              const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
              try {
                const pdf=await task.promise;
                for(let n=2;n<=Math.min(pdf.numPages,100);n++) {
                  const page=await pdf.getPage(n),content=await page.getTextContent();
                  const text=clean(content.items.map(item=>'str'in item?item.str:'').join(' '));
                  if(/目录|序言|前言/u.test(text.slice(0,180))) continue;
                  const sentences=text.split(/(?<=[。！？])/u).map(value=>value.trim());
                  for(let j=0;j<sentences.length;j++) {
                    const sentence=sentences[j],china=sentence.lastIndexOf('中国');
                    if(china<0) continue;
                    const evidence=sentence.lastIndexOf('数据显示',china);
                    const lead=sentence.slice(evidence>=0&&china-evidence<100?evidence:china);
                    const window=[lead,...sentences.slice(j+1,j+3)].join(' ');
                    if(window.length<=800&&/消费者|渠道/u.test(lead)&&/食品|饮料|餐饮|美妆|个护/u.test(lead)
                      &&/\d+(?:\.\d+)?\s*[%％]/u.test(window)&&/食品|饮料|餐饮|美妆|个护|渠道/u.test(window)&&!/资料来源|图\s*\d/u.test(lead)) {
                      excerpt=window;
                      pageRange='第 '+n+' 页';
                      break;
                    }
                  }
                  if(excerpt) break;
                }
              } finally {await task.destroy();}
              if(excerpt) seenPdfs.add(pdfKey);
            }
          } else {
            const paragraphs=[...d.querySelectorAll('.article-content .mintel-paragraph p,article p')]
              .map(p=>clean(p.textContent||'')).filter(value=>value.length>25&&!/下载|订阅|联系我们|联系您的|预约|了解未来|注册/u.test(value));
            for(const paragraph of paragraphs) {
              if(excerpt.length+paragraph.length+(excerpt?2:0)>1500) break;
              excerpt+=(excerpt?'\n\n':'')+paragraph;
            }
            const evidence=excerpt.split(/[。！？]/u)
              .filter(value=>!/研究方法|研究设计|方法介绍|例如.{0,20}可以|比如.{0,20}可以|可以先|再比较/u.test(value)).join('。');
            if(excerpt.length<200||!/消费者|购买|食品|饮料|美妆|零售/u.test(excerpt)
              ||!/(?:消费者|受访者)[^。！？]{0,60}(?:倾向|偏好|选择|认为|表示|更重视|增长|下降)|(?:调查|研究)(?:发现|显示|表明)[^。！？]{0,100}(?:倾向|偏好|选择|认为|表示|转向|增长|下降|\d+(?:\.\d+)?\s*[%％])/u.test(evidence)) {
              excerpt='';
            }
            if(new URL(c.url).pathname.startsWith('/press-centre/')||/报告|白皮书/u.test(c.title)) kind='公开报告摘要，未取得报告全文';
          }
          if(!excerpt) {attempt.counts.rejected++;continue;}
          seenTitles.add(title);
          items.push({id:createHash('sha256').update(c.url).digest('hex').slice(0,24),title:c.title,sourceId:source.id,sourceName:source.name,
            url:c.url,publishedAt:date,fetchedAt:now.toISOString(),excerpt,evidenceKind:'article_excerpt',research:{kind,dataPeriod:null,...(pdfUrl?{pdfUrl,pageRange}:{})}});
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
