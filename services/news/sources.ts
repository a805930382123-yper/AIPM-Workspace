import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { NewsItem, NewsSectionName, SourceResult } from './types.ts';

const sources = {
  ce: {name:'中国经济网食品', url:'http://www.ce.cn/cysc/sp/'},
  commerce: {name:'商务部', url:'https://www.mofcom.gov.cn/'},
  aihot: {name:'AIHOT', url:'https://aihot.news/api/v1/items?mode=selected&window=24h&limit=20'},
};
const allowed = (u:URL) => (u.origin === 'http://www.ce.cn' && /^\/cysc\/(?:sp\/|newmain\/yc\/jsxw\/)/u.test(u.pathname)) || (u.origin === 'https://www.mofcom.gov.cn' && (u.pathname === '/' || /^\/xwfb\/sjfzrfb\/art\/\d{4}\/art_[a-f0-9]+\.html$/u.test(u.pathname))) || (u.origin === 'https://aihot.news' && u.pathname === '/api/v1/items');
async function get(url:string):Promise<string> {
  let target = new URL(url);
  for (let i=0;i<=3;i++) {
    if (!allowed(target)) throw Error('来源地址不在允许范围');
    const response = await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'Accept':'text/html,application/json'}});
    if ([301,302,303,307,308].includes(response.status)) { const location=response.headers.get('location'); if(!location || i===3) throw Error('来源跳转无效'); target=new URL(location,target); continue; }
    if (!response.ok) throw Error(`来源返回 HTTP ${response.status}`);
    const type=response.headers.get('content-type') || ''; if(!/^(text\/html|application\/json)/iu.test(type)) throw Error('来源响应类型不支持');
    if(Number(response.headers.get('content-length'))>2*1024*1024) throw Error('来源响应过大');
    const chunks:Uint8Array[]=[]; let size=0; if(!response.body) throw Error('来源无响应正文');
    const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('来源响应过大');}chunks.push(value);}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  }
  throw Error('来源跳转过多');
}
const dom=(text:string,url:string)=>new JSDOM(text,{url,virtualConsole:new VirtualConsole()});
const id=(url:string)=>createHash('sha256').update(url).digest('hex').slice(0,24);
const cleaned=(s:string)=>s.replace(/\s+/gu,' ').trim();
export function matchesNewsFocus(section:NewsSectionName,title:string,summary:string):boolean {
  const text=title+' '+summary;
  if(section==='fmcg') {
    if (/汽车|房地产|地产|手机|农业收储/u.test(title)) return false;
    return /食品|饮料|日化|乳品|乳制品|啤酒|咖啡|可口可乐|餐饮品牌|商超|超市|便利店|零售|批发和零售|批零|商贸流通|消费品|连锁门店/u.test(text);
  }
  const product=/人工智能|大模型|模型|智能体|agent|ChatGPT|Cursor|GPT|AI工具|编程助手|图像生成|语音助手/iu.test(text);
  const practical=/发布|推出|更新|上线|开放|新增|支持|升级|评测|测评|工作流|功能|可用|分析|语音|图像/iu.test(text);
  const capital=/融资|估值|投资者|上市|IPO|芯片.*(?:滞留|禁运|出口|贸易|限制)|(?:禁运|出口|贸易).*芯片/iu.test(text);
  const productChange=/(?:发布|推出|上线|升级|新增|开放|更新)(?:了|的|全新|新款|新版|新一代|首款|与)*(?:模型|智能体|agent|AI工具|工具|产品|功能|ChatGPT|Cursor|GPT)|(?:模型|智能体|agent|AI工具|ChatGPT|Cursor|GPT)(?:[\w. -]{0,15}|新版本)?(?:发布|推出|上线|升级|新增|开放|更新|评测|测评)(?!融资|投资|估值)/iu.test(title);
  return product && practical && (!capital || productChange);
}
export const newsPriority=(section:NewsSectionName,item:NewsItem)=>{
  const text=item.title+' '+item.excerpt;
  return section==='fmcg' ? Number(/发布|推出|新增|更新|新品|增长|下降|销量|市场|经营|供应链|开店|发展|战略/u.test(text)) : Number(/发布|推出|更新|上线|新增|升级|评测|测评|工作流|功能/iu.test(text));
};
function safeOriginal(value:unknown):string|null { if(typeof value!=='string') return null; try {const u=new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href:null;} catch{return null;} }
export async function readNewsSources(section:NewsSectionName, now:Date):Promise<SourceResult> {
  const keys=section==='fmcg'?(['ce','commerce'] as const):(['aihot'] as const); const result:SourceResult={items:[],sources:[]};
  await Promise.all(keys.map(async key=>{
    const source=sources[key],checkedAt=now.toISOString();
    try {
      const text=await get(source.url); const items:NewsItem[]=[];
      if(key==='aihot') {
        const json=JSON.parse(text); if(!Array.isArray(json.items)) throw Error('来源格式异常'); let validCount=0;
        for(const row of json.items.slice(0,20)) {const url=safeOriginal(row.links?.original); if(!url||typeof row.id!=='string'||typeof row.title!=='string'||typeof row.summary!=='string') continue; validCount++; if(!matchesNewsFocus('ai',row.title,row.summary))continue; items.push({id:id(url),title:row.title.slice(0,300),sourceId:key,sourceName:source.name,url,publishedAt:typeof row.publishedAt==='string'&&!Number.isNaN(Date.parse(row.publishedAt))?row.publishedAt:null,fetchedAt:checkedAt,excerpt:row.summary.slice(0,1500),evidenceKind:'source_summary'});}
        if(json.items.length&&!validCount)throw Error('来源条目格式异常');
      } else {
        const page=dom(text,source.url), doc=page.window.document;
        const anchors=key==='ce'?[...doc.querySelectorAll('.txt3 h3 a')]:[...doc.querySelectorAll('.ovdColumn')].filter(el=>el.querySelector('h4')?.textContent?.includes('司局负责人发布')).flatMap(el=>[...el.querySelectorAll('.con a')]).filter(a=>/零售|流通|商贸|消费/u.test(a.textContent||''));
        if(key==='ce'&&!doc.querySelector('.txt3')) throw Error('来源列表格式异常');
        if(key==='commerce'&&![...doc.querySelectorAll('.ovdColumn h4')].some(h=>h.textContent?.includes('司局负责人发布'))) throw Error('来源列表格式异常');
        const candidates=anchors.slice(0,20).map(a=>({title:cleaned(a.textContent||''),summary:cleaned(a.closest('.txt3')?.querySelector('p')?.textContent||''),url:new URL(a.getAttribute('href')||'',source.url).href})).filter(x=>x.title && allowed(new URL(x.url)) && matchesNewsFocus('fmcg',x.title,x.summary));
        page.window.close();
        for(const candidate of candidates.slice(0,8)) {
          try { const article=dom(await get(candidate.url),candidate.url), body=article.window.document; const excerpt=cleaned(body.querySelector(key==='ce'?'.trs_editor_view':'.art-con')?.textContent||'').slice(0,1500); const date=cleaned(body.body.textContent||'').match(/20\d\d-\d\d-\d\d(?:\s+\d\d:\d\d)?/u)?.[0]||null; article.window.close(); if(excerpt) items.push({id:id(candidate.url),title:candidate.title,sourceId:key,sourceName:source.name,url:candidate.url,publishedAt:date?(date.includes(' ')?date.replace(' ','T')+':00+08:00':date):null,fetchedAt:checkedAt,excerpt,evidenceKind:'article_excerpt'}); } catch { /* one unavailable detail does not erase other articles */ }
        }
        if(candidates.length&&!items.length) throw Error('来源文章无法读取');
      }
      result.items.push(...items); result.sources.push({name:source.name,checkedAt,status:items.length?'ok':'empty'});
    } catch { result.sources.push({name:source.name,checkedAt,status:'failed',error:'来源读取或解析失败，请稍后重试。'}); }
  })); return result;
}
