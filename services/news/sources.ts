import { readSourceBytes, sourceAttempt } from './source-health.ts';
import { readResearchSources } from './research-sources.ts';
import { editorialSources } from './ai-editorial.ts';
import { karpathySources } from './ai-karpathy.ts';
import { createHash } from 'node:crypto';
import type { NewsItem, NewsSectionName, SourceExclusions, SourceHealth, SourceResult } from './types.ts';

const aihot={id:'aihot',name:'AIHOT',homepage:'https://aihot.news/',url:'https://aihot.news/api/v1/items?mode=selected&window=24h&limit=5'};
const allowed=(url:URL)=>url.origin==='https://aihot.news'&&url.pathname==='/api/v1/items'&&!url.username&&!url.password;
const id=(url:string)=>createHash('sha256').update(url).digest('hex').slice(0,24);
const aiSources=[{...aihot,read:readAihot},...editorialSources,...karpathySources];
const enabledSources = {
  fmcg: Object.entries({worldpanel:'Worldpanel by Numerator', niq:'NIQ', nbs:'国家统计局', pwc:'PwC', kpmg:'KPMG', mintel:'Mintel'}),
  ai: aiSources.map(({id,name})=>[id,name]),
};

export function enabledSourceId(section:NewsSectionName, source:SourceHealth) {
  return enabledSources[section].find(([id,name])=>source.sourceId ? id===source.sourceId : name===source.name)?.[0];
}

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

export async function readNewsSources(section:NewsSectionName,now:Date,exclusions?:SourceExclusions,sourceIds?:ReadonlySet<string>):Promise<SourceResult> {
  if(section==='fmcg') return readResearchSources(now,exclusions,sourceIds);
  const results=await Promise.all(aiSources.filter(source=>!sourceIds||sourceIds.has(source.id)).map(async (source):Promise<SourceResult>=>{
    const attempt=sourceAttempt(source,now);
    try {
      const result=await source.read(now);
      return {...result,sources:result.sources.map(health=>({...health,homepage:source.homepage}))};
    } catch(error) {
      attempt.fail(error,attempt.stage);
      return {items:[],sources:[{...attempt.finish(0),homepage:source.homepage}]};
    }
  }));
  return {items:results.flatMap(result=>result.items),sources:results.flatMap(result=>result.sources),
    shortageReasons:results.flatMap(result=>result.shortageReasons??[])};
}

async function readAihot(now:Date):Promise<SourceResult> {
  const items:NewsItem[]=[];
  const attempt=sourceAttempt(aihot,now);
  try {
    const bytes=await readSourceBytes(aihot.url,allowed,'text/html,application/json',/^(text\/html|application\/json)/iu,2*1024*1024,12000);
    attempt.stage='parse';
    const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!Array.isArray(json?.items)) throw Error('来源格式异常');
    for(const row of json.items.slice(0,5)) {
      attempt.counts.candidates++;
      const url=safeOriginal(row?.links?.original);
      if(!url||typeof row.id!=='string'||typeof row.title!=='string'||typeof row.summary!=='string') {
        attempt.counts.rejected++;
        continue;
      }
      items.push({id:id(url),title:row.title.slice(0,300),sourceId:aihot.id,sourceName:aihot.name,url,
        publishedAt:typeof row.publishedAt==='string'&&!Number.isNaN(Date.parse(row.publishedAt))?row.publishedAt:null,
        fetchedAt:now.toISOString(),excerpt:row.summary.slice(0,1500),evidenceKind:'source_summary'});
    }
    if(json.items.length&&!items.length) throw Error('来源条目格式异常');
  } catch(error) {attempt.fail(error,attempt.stage);}
  return {items,sources:[attempt.finish(items.length)]};
}
