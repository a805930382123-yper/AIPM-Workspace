import { readSourceBytes, sourceAttempt } from './source-health.ts';
import { readNewResearch } from './new-research.ts';
import { readAdditionalResearch } from './additional-research.ts';
import { normalizedUrl, normalizedTitle } from './normalize.ts';
import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { NewsItem, SourceExclusions, SourceResult } from './types.ts';

const entries = [
  {id:'worldpanel', name:'Worldpanel by Numerator', url:'https://worldpanelbynumerator.com/language/chinese-simplified'},
  {id:'niq', name:'NIQ', url:'https://nielseniq.cn/global/zh/insights/consumer-packaged-goods/'},
] as const;
const allowed=(u:URL)=>u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&((u.hostname==='worldpanelbynumerator.com'&&(u.pathname==='/language/chinese-simplified'||/^\/insights\/[\w-]+\/?$/u.test(u.pathname)))||(u.hostname==='nielseniq.cn'&&(u.pathname==='/global/zh/insights/consumer-packaged-goods/'||/^\/global\/zh\/insights\/analysis\//u.test(u.pathname)||(/^\/wp-content\/uploads\/sites\/9\//u.test(u.pathname)&&/\.pdf$/iu.test(u.pathname)))));
export const chinaMarketPriority=(item:{title:string;url:string;excerpt?:string})=>Number(/中国|\bChina\b/iu.test(item.title+' '+new URL(item.url).pathname+' '+(item.excerpt||'')));
const clean=(s:string)=>s.replace(/\s+/gu,' ').trim();
const focus=(s:string)=>/快消|购物者|消费品|零售|食品|饮料|乳品|日化|个护|商超|便利店|fmcg|beverage|retail|consumer|food|snack|grocery|category|channel/iu.test(s)&&!/机器人|扫地机|家电|吹风机|润滑|汽车|获奖|活动|论坛|秋粮|粮食收购|农业收储|粮食收储|webinar|robot|appliance|lubricant|hair.?dryer|electronics|wearable/iu.test(s);
function period(text: string): string | null {
  const labels = [...text.matchAll(/(?:^|[\n。！？；;])[ \t]*((?:统计期(?:间)?|统计周期|数据截至|调查时间|调研时间|数据覆盖期)[ \t]*[:：][ \t]*([^\n。！？；;]*))/gu)];
  if (labels.length !== 1) return null;

  const [, citation, value] = labels[0];
  const month = String.raw`(?:0?[1-9]|1[0-2])`;
  const day = String.raw`(?:0?[1-9]|[12]\d|3[01])`;
  const unit = String.raw`(?:${month}\s*月(?:份|\s*${day}\s*日)?|(?:前|第)?[一二三四1-4]\s*季度|[上下]半年|全年)`;
  const date = String.raw`(?:\d{4}(?:\s*年(?:\s*${unit})?|\s*[Qq][1-4]|-${month}-${day})|${unit})`;
  const dateOrRange = new RegExp(String.raw`^${date}(?:\s*(?:至|到|[-–—~～])\s*${date})?$`, 'u');
  return dateOrRange.test(value.trim()) ? citation.trimEnd() : null;
}
const get=(url:string,pdf=false)=>readSourceBytes(url,allowed,pdf?'application/pdf':'text/html',
  pdf?/^application\/pdf/iu:/^text\/html/iu,(pdf?10:2)*1024*1024,12000);
const doc=(data:Buffer,url:string)=>new JSDOM(data.toString('utf8'),{url,virtualConsole:new VirtualConsole()});

export async function readResearchSources(now:Date,exclusions?:SourceExclusions,sourceIds?:ReadonlySet<string>):Promise<SourceResult> {
  const result:SourceResult={items:[],sources:[]};
  const shortageReasons:string[]=[];
  result.shortageReasons=shortageReasons;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const cutoff=Date.parse(today+'T00:00:00+08:00')-364*86400000;
  await Promise.all(entries.filter(source=>!sourceIds||sourceIds.has(source.id)).map(async source=>{
    const attempt=sourceAttempt(source,now);
    const items:NewsItem[]=[];
    const seenUrls=new Set<string>(), seenTitles=new Set<string>(), seenPdfs=new Set<string>();
    let pdfs=0,detailRequests=0,pdfLimited=false,detailLimited=false;
    try {
      const bytes=await get(source.url);
      attempt.stage='parse';
      const list=doc(bytes,source.url),d=list.window.document;
      let candidates:Array<{title:string;url:string;date:string}>;
      try {
        if(source.id==='worldpanel') {
          const cards=[...d.querySelectorAll('.blog-post-title')];
          if(!cards.length) throw Error('列表结构异常');
          candidates=cards.map(card=>{
            const a=card.querySelector('a[href^="/insights/"]'),date=card.querySelector('.post-meta .small-text:not(a)')?.textContent||'';
            return {title:clean(a?.textContent||''),url:a?new URL(a.getAttribute('href')!,source.url).href:'',date:clean(date)+' UTC'};
          });
        } else {
          const cards=[...d.querySelectorAll('a.niq-card-link')];
          if(!cards.length) throw Error('列表结构异常');
          candidates=cards.map(a=>({title:clean(a.querySelector('.niq-insight-title')?.textContent||''),
            url:new URL(a.getAttribute('href')||'',source.url).href,date:a.querySelector('time')?.getAttribute('datetime')||''}));
        }
      } finally {list.window.close();}
      candidates=candidates.filter(candidate=>{
        if(!candidate.url||!allowed(new URL(candidate.url))||!focus(candidate.title)) return false;
        attempt.counts.candidates++;
        const date=Date.parse(candidate.date);
        const time=Number.isFinite(date)&&source.id==='worldpanel'?Date.parse(new Date(date).toISOString().slice(0,10)+'T00:00:00+08:00'):date;
        if(!Number.isFinite(time)||time<cutoff||time>now.getTime()) return false;
        const url=normalizedUrl(candidate.url);
        if(exclusions?.urls.has(url)||exclusions?.titles.has(normalizedTitle(candidate.title))||seenUrls.has(url)) {
          attempt.counts.duplicates++;
          return false;
        }
        seenUrls.add(url);
        return true;
      }).sort((a,b)=>chinaMarketPriority(b)-chinaMarketPriority(a)||Date.parse(b.date)-Date.parse(a.date));
      for(const candidate of candidates) {
        if(items.length>=5) break;
        const title=normalizedTitle(candidate.title);
        if(seenTitles.has(title)) {
          attempt.counts.duplicates++;
          continue;
        }
        if(detailRequests>=8) {
          detailLimited=true;
          break;
        }
        detailRequests++;
        try {
          attempt.stage='detail';
          const bytes=await get(candidate.url);
          attempt.stage='parse';
          const page=doc(bytes,candidate.url);
          let excerpt='',dataPeriod:string|null=null,pdfUrl:string|undefined,pageRange:string|undefined,kind='官方研究正文摘录，非全文';
          try {
            if(source.id==='worldpanel') {
              const body=page.window.document.querySelector('.article.w-richtext');
              if([...body?.querySelectorAll('h1,h2,h3,h4')||[]].some(h=>/^(报告摘要|报告介绍|报告简介)$/u.test(clean(h.textContent||'')))) kind='官方报告介绍摘录，非报告全文';
              const paragraphs=[...(body?.querySelectorAll('p')||[])].map(p=>clean(p.textContent||'')).filter(value=>value.length>=80);
              excerpt=paragraphs.slice(0,3).join('\n\n').slice(0,1500);
              dataPeriod=period(excerpt);
              if(!focus(candidate.title+' '+excerpt)||!/(同比|销售额|销量|渗透率|市场份额|调研|消费者指数)/u.test(excerpt)||!/(?:\d+(?:\.\d+)?\s*[%％]|\d+(?:\.\d+)?\s*(?:亿|万|个百分点|家户))/u.test(excerpt)) excerpt='';
            } else {
              const link=[...page.window.document.querySelectorAll('a[href]')].map(a=>new URL(a.getAttribute('href')!,candidate.url)).find(u=>allowed(u)&&/\.pdf$/iu.test(u.pathname));
              if(link) {
                const pdf=normalizedUrl(link.href);
                if(exclusions?.pdfs?.has(pdf)||seenPdfs.has(pdf)) {
                  attempt.counts.duplicates++;
                  continue;
                }
                if(pdfs>=2) {
                  pdfLimited=true;
                  continue;
                }
                pdfs++;
                pdfUrl=link.href;
                attempt.stage='pdf';
                const bytes=await get(pdfUrl,true);
                attempt.stage='parse';
                const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true});try{const pdf=await task.promise;for(let n=2;n<=Math.min(pdf.numPages,20);n++){const p=await pdf.getPage(n),content=await p.getTextContent();const text=clean(content.items.map(x=>'str' in x?x.str:'').join(' ')).replace(/(?:©\s*\d{4}\s*Nielsen Consumer LLC\.\s*All Rights Reserved\.\s*)+/giu,'').replace(/^Confidential and proprietary\s*/iu,'');if(text.length>=200&&/[\u4e00-\u9fff]/u.test(text)&&!/(前\s*言|序言|寄语|目录)/u.test(text.slice(0,350))&&/(增长|下降|消费者|销售)/u.test(text)&&/\d+(?:\.\d+)?\s*%/u.test(text)){const start=text.search(/主要|根据|数据显示|消费|行业|销售|市场/u);excerpt=text.slice(Math.max(0,start),Math.max(0,start)+1500);dataPeriod=period(excerpt);pageRange=`第 ${n} 页`;break;}}}finally{await task.destroy();}
                if(excerpt) seenPdfs.add(pdf);
              }
              kind='PDF文字提取摘录，非全文，图表文字可能不完整';
            }
          } finally {page.window.close();}
          if(!excerpt) {
            attempt.counts.rejected++;
            continue;
          }
          seenTitles.add(title);
          items.push({id:createHash('sha256').update(candidate.url).digest('hex').slice(0,24),
            title:candidate.title,sourceId:source.id,sourceName:source.name,url:candidate.url,
            publishedAt:source.id==='worldpanel'?new Date(Date.parse(candidate.date)).toISOString().slice(0,10):new Date(Date.parse(candidate.date)).toISOString(),
            fetchedAt:now.toISOString(),excerpt,evidenceKind:'article_excerpt',research:{kind,dataPeriod,...(pdfUrl?{pdfUrl,pageRange}:{})}});
        } catch(error) {attempt.fail(error,attempt.stage);}
      }
    } catch(error) {attempt.fail(error,attempt.stage);}
    if(attempt.counts.duplicates) shortageReasons.push(source.name+'：历史或重复条目已排除。');
    if(attempt.counts.failed) shortageReasons.push(source.name+'：部分请求或内容解析失败。');
    if(attempt.counts.rejected) shortageReasons.push(source.name+'：部分候选未达到正文要求。');
    if(detailLimited) shortageReasons.push(source.name+'：达到详情读取预算。');
    if(pdfLimited) shortageReasons.push(source.name+'：达到 PDF 读取预算。');
    if(items.length<5) shortageReasons.push(source.name+'：合格候选不足。');
    result.items.push(...items);
    result.sources.push(attempt.finish(items.length));
  }));
  const extra=await readAdditionalResearch(now,exclusions,true,sourceIds);
  const newer=await readNewResearch(now,exclusions,true,sourceIds);
  for(const group of [extra,newer]) {
    result.items.push(...group.items);
    result.sources.push(...group.sources);
    shortageReasons.push(...(group.shortageReasons||[]));
  }
  return result;
}
