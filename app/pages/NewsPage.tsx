import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { evaluateResearchValue } from '../../services/news/research-value';
import type { NewsCheckMode, NewsEdition, NewsItem, NewsSection, NewsSectionName, SourceHealth } from '../../services/news/types';
import '../news.css';
type View={date:string;aiEnabled:boolean;edition:NewsEdition|null;recentFmcg?:Array<{date:string;item:NewsItem}>;fallbacks:Partial<Record<NewsSectionName,{date:string;section:NewsSection}>>};
const time=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未记录';
const labels={fmcg:'快消研报与洞察',ai:'AI 前沿'};
const status={running:'正在准备',ready:'分析已生成',source_only:'来源摘录可阅读',empty:'近期内容不足',failed:'读取失败',interrupted:'上次准备中断'};
const hasSourceFailure=(source:SourceHealth)=>source.diagnosis?['partial','failed'].includes(source.diagnosis.outcome):source.status==='failed'||!!source.error;
const outcomeLabel={ok:'读取成功',empty:'没有合格条目',partial:'部分读取失败',failed:'读取失败'};
const errorLabel={timeout:'超时',network:'网络错误',tls:'TLS 错误',http:'HTTP 错误',parse:'解析错误',unknown:'未知错误'};
const stageLabel={list:'来源列表',detail:'详情',pdf:'PDF',parse:'内容解析'};

function sectionStatus(section:NewsSection|undefined,missing:string) {
 if(!section) return missing;
 if(section.status==='running') return section.items.length?'正在检查更新，已收录内容可继续阅读':'正在检查更新';
 if(section.status==='interrupted'&&section.items.length) return '上次检查中断，保留已收录内容';
 return status[section.status];
}

function SectionDiagnosis({section}:{section?:NewsSection}) {
 if(!section) return null;
 return <>
  <p className="news-meta">尝试开始 {time(section.startedAt)} · 完成 {time(section.finishedAt)}</p>
  {section.error&&<p className="form-error" role="status">{section.error}</p>}
  {section.checkMessage&&<p role="status">{section.checkMessage}</p>}
  {section.sources.some(hasSourceFailure)&&<p className="news-notice">部分来源不可用，覆盖不完整。</p>}
  {!!section.sources.length&&<details className="news-diagnosis">
   <summary>来源诊断</summary>
   <ul>
    {section.sources.map(source=>{
     const diagnosis=source.diagnosis;
     return <li key={source.sourceId||source.name}>
      <strong>{source.name}</strong> · {diagnosis?outcomeLabel[diagnosis.outcome]:source.status==='ok'&&source.error?'部分读取失败':outcomeLabel[source.status]}
      {diagnosis?<div>
       <p>开始 {time(diagnosis.startedAt)} · 完成 {time(diagnosis.finishedAt)} · 耗时 {diagnosis.elapsedMs} 毫秒</p>
       <p>候选 {diagnosis.counts.candidates} · 合格 {diagnosis.counts.qualified} · 重复 {diagnosis.counts.duplicates} · 正文不合格 {diagnosis.counts.rejected} · 读取失败 {diagnosis.counts.failed}</p>
       <p>最近读取成功 {time(diagnosis.lastSuccessAt)}</p>
       {diagnosis.error&&<p>{stageLabel[diagnosis.error.stage]} · {errorLabel[diagnosis.error.type]} · {diagnosis.error.message}</p>}
      </div>:<p>详细诊断未记录 · 最近读取成功未记录</p>}
     </li>;
    })}
   </ul>
  </details>}
 </>;
}

function useToday(ensure:boolean){
 const [view,setView]=useState<View|null>(null),[error,setError]=useState('');
 const current=useRef<View|null>(null),refreshRef=useRef<()=>void>(()=>{});
 useEffect(()=>{current.current=view},[view]);
 useEffect(()=>{let active=true,inFlight=false;
  const load=async(first=false,checkDate=false)=>{if(inFlight)return;inFlight=true;try{
   let value=await api<View>(first&&ensure?'/api/news/today/ensure':'/api/news/today',first&&ensure?{method:'POST',body:'{}'}:undefined);
   if(ensure&&checkDate&&current.current&&value.date!==current.current.date)value=await api<View>('/api/news/today/ensure',{method:'POST',body:'{}'});
   if(active){current.current=value;setView(value);setError('');}
  }catch{if(active)setError('资讯状态读取失败，请重新读取。');}finally{inFlight=false;}};
  refreshRef.current=()=>{void load(false,false)};
  const onFocus=()=>{if(document.visibilityState==='visible')void load(false,true)};
  const onVisibility=()=>{if(document.visibilityState==='visible')void load(false,true)};
  if(ensure){window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onVisibility);}
  void load(true);return()=>{active=false;refreshRef.current=()=>{};window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisibility);};
 },[ensure]);
 useEffect(()=>{if(error||!view||!Object.values(view.edition?.sections||{}).some(x=>x.status==='running'))return;const timer=setTimeout(()=>refreshRef.current(),2000);return()=>clearTimeout(timer);},[view,error]);
 return {view,error,setView,setError,refresh:()=>refreshRef.current()};
}
export function NewsHome({onOpen}:{onOpen:()=>void}){const {view,error,refresh}=useToday(true);return <section className="panel news-home"><div><h2>每日资讯</h2><p>{view?`${view.date} · AI 分析${view.aiEnabled?'已启用':'未启用'}`:'正在读取资讯状态'}</p>{error&&<p className="form-error" role="alert">{error} <button className="text-button" onClick={refresh}>重新读取状态</button></p>}<div className="news-home-status">{(['fmcg','ai'] as const).map(n=><span key={n}>{labels[n]}：{view?.edition?.sections[n]?status[view.edition.sections[n]!.status]:'等待准备'}</span>)}</div></div><button className="secondary-button" onClick={onOpen}>阅读资讯</button></section>;}
type Saved={section:NewsSectionName;itemId:string;rawId:string;status:'saved'|'missing'|'pending'};
export function NewsPage({onRawChanged=()=>{},onOpenRaw=()=>{},onBack}:{onRawChanged?:()=>void|Promise<void>;onOpenRaw?:(id:string)=>void;onBack?:()=>void}){const {view,error,setView,setError,refresh}=useToday(false);const [history,setHistory]=useState<{items:Array<{date:string}>;errors:string[]}|null>(null),[selected,setSelected]=useState<string|null>(null),[edition,setEdition]=useState<NewsEdition|null>(null),[readError,setReadError]=useState('');
 useEffect(()=>{let active=true;api<{items:Array<{date:string}>;errors:string[]}>('/api/news/history').then(x=>{if(active)setHistory(x)}).catch(()=>{if(active)setReadError('历史记录读取失败。')});return()=>{active=false}},[]);
 useEffect(()=>{let active=true;setEdition(null);setReadError('');if(selected)void api<NewsEdition>(`/api/news/editions/${selected}`).then(x=>{if(active)setEdition(x)}).catch(()=>{if(active)setReadError('这期记录读取失败。')});return()=>{active=false}},[selected]);
 const [saved,setSaved]=useState<Record<string,Saved[]>>({}),[busy,setBusy]=useState<Record<string,boolean>>({}),[saveErrors,setSaveErrors]=useState<Record<string,string>>({});
 const projectionVersion=useRef<Record<string,number>>({});
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const [projectionReload,setProjectionReload]=useState(0);
 const dates=[...new Set([selected||view?.date,...(!selected?[...(view?.fallbacks.ai?[view.fallbacks.ai.date]:[]),...(view?.recentFmcg||[]).map(x=>x.date)]:[])].filter((x):x is string=>!!x))].join(',');
 useEffect(()=>{let active=true;for(const date of dates.split(',').filter(Boolean)){const version=projectionVersion.current[date]||0;void api<{items:Saved[]}>(`/api/news/editions/${date}/saved-raws`).then(x=>{if(active&&version===(projectionVersion.current[date]||0)){setSaved(prev=>({...prev,[date]:x.items}));setSaveErrors(prev=>({...prev,[date]:''}));}}).catch(()=>{if(active)setSaveErrors(prev=>({...prev,[date]:'保存状态读取失败，请重新读取。'}))});}return()=>{active=false}},[dates,view?.edition?.updatedAt,edition?.updatedAt,projectionReload]);
 const save=async(date:string,section:NewsSectionName,itemId:string)=>{const key=`${date}:${section}:${itemId}`;setBusy(prev=>({...prev,[key]:true}));setSaveErrors(prev=>({...prev,[key]:''}));try{const result=await api<{rawId:string;status:'saved';created:boolean}>(`/api/news/editions/${date}/items/save-raw`,{method:'POST',body:JSON.stringify({section,itemId})});if(alive.current){projectionVersion.current[date]=(projectionVersion.current[date]||0)+1;setSaved(prev=>({...prev,[date]:[...(prev[date]||[]).filter(x=>x.section!==section||x.itemId!==itemId),{section,itemId,rawId:result.rawId,status:'saved'}]}));}void onRawChanged();}catch(e){if(alive.current)setSaveErrors(prev=>({...prev,[key]:e instanceof Error?e.message:'保存失败，请重试。'}));}finally{if(alive.current)setBusy(prev=>({...prev,[key]:false}));}};
 const [checking,setChecking]=useState<Partial<Record<NewsSectionName,NewsCheckMode>>>({});
 const [checkNotices,setCheckNotices]=useState<Partial<Record<NewsSectionName,string>>>({});
 const check=async(section:NewsSectionName,mode:NewsCheckMode,attempt:number)=>{
  setChecking(previous=>({...previous,[section]:mode}));
  setCheckNotices(previous=>({...previous,[section]:undefined}));
  try {
   const result=await api<View&{checkNotice?:{section:NewsSectionName;message:string}}>('/api/news/today/check',{
    method:'POST',body:JSON.stringify({section,mode,attempt}),
   });
   if(!alive.current) return;
   setView(previous=>previous?.edition&&result.edition&&Date.parse(previous.edition.updatedAt)>Date.parse(result.edition.updatedAt)?previous:result);
   setError('');
   if(result.checkNotice) setCheckNotices(previous=>({...previous,[section]:result.checkNotice!.message}));
  } catch(cause) {
   if(alive.current) {
    setCheckNotices(previous=>({...previous,[section]:cause instanceof Error?cause.message:'检查更新失败，请刷新。'}));
    refresh();
   }
  } finally {
   if(alive.current) setChecking(previous=>({...previous,[section]:undefined}));
  }
 };
 const controls=(section:NewsSectionName,current?:NewsSection)=>{
  const activeMode=checking[section];
  const disabled=!view||Boolean(activeMode)||current?.status==='running';
  return <div className="news-check-actions">
   <button className="secondary-button" disabled={disabled} onClick={()=>void check(section,'all',current?.attempt??0)}>{activeMode==='all'?'正在检查更新…':'检查更新'}</button>
   {section==='fmcg'&&<button className="secondary-button" disabled={disabled} onClick={()=>void check(section,'failed',current?.attempt??0)}>{activeMode==='failed'?'正在补抓失败来源…':'仅补抓失败来源'}</button>}
  </div>;
 };
 const renderItem=(item:NewsItem,n:NewsSectionName,date:string)=>{
  const key=`${date}:${n}:${item.id}`,entry=saved[date]?.find(x=>x.section===n&&x.itemId===item.id);
  const value=n==='fmcg'?evaluateResearchValue(item):undefined;
  return <article className="news-article" key={item.id}>
   <h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a></h3>
   <p className="news-meta">{item.sourceName}{item.url.startsWith('http:')?' · HTTP 链接':''} · {item.publishedAt?(/^\d{4}-\d\d$/.test(item.publishedAt)?item.publishedAt+'（仅知月份）':/^\d{4}-\d\d-\d\d$/.test(item.publishedAt)?item.publishedAt:new Date(item.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})):'日期未知'} · {item.research?.kind||(item.evidenceKind==='source_summary'?(n==='ai'?'AIHOT 来源摘要，未核验原文':'来源摘要'):'来源正文摘录')}{item.research&&<> · 数据时期：{item.research.dataPeriod||'请以原文为准'}{item.research.pdfUrl&&<> · <a href={item.research.pdfUrl} target="_blank" rel="noopener noreferrer">报告 PDF</a>{item.research.pageRange&&<>（{item.research.pageRange}）</>}</>}</>}</p>
   {value?.eligible&&<div className="news-analysis">
    <p><b>推荐理由</b> {value.reason}</p>
    {value.application&&<p><b>应用建议</b> {value.application}</p>}
   </div>}
   <p>{item.excerpt.slice(0,280)}{item.excerpt.length>280?'…':''}</p>
   {item.excerpt.length>280&&<details><summary>展开完整摘录</summary><p>{item.excerpt}</p></details>}
   {item.analysis?<div className="news-analysis"><p><b>事实：</b>{item.analysis.fact}</p><p><b>值得关注：</b>{item.analysis.whyItMatters}</p><p><b>可能影响（推断）：</b>{item.analysis.possibleImpact}</p></div>:n==='ai'?<p className="news-meta">为何值得关注 / 可能影响：未生成分析</p>:null}
   <div className="news-save">
    <p className="news-meta">仅保存已取得的摘录或来源摘要；后续 AI 整理需在 Raw 中另行操作。</p>
    {entry?.status==='saved'?<span>已保存 · <button className="text-button" onClick={()=>onOpenRaw(entry.rawId)}>查看 Raw</button></span>:entry?.status==='missing'?<span>原 Raw 已删除</span>:<button className="secondary-button" disabled={!!busy[key]} onClick={()=>void save(date,n,item.id)}>{busy[key]?'正在保存…':entry?.status==='pending'?'核对保存状态':'保存来源摘录到 Raw'}</button>}
    {saveErrors[key]&&<p className="form-error" role="alert">{saveErrors[key]}</p>}
   </div>
  </article>;
 };
 const shown=selected?edition:view?.edition;return <div className="page news-page"><div className="page-heading"><div><h1>每日资讯</h1><p className="subheading">来源摘录与分析分开保存，日期以来源为准。</p></div>{onBack&&<button type="button" className="secondary-button" onClick={onBack}>返回工作台</button>}</div><div className="news-toolbar"><label>阅读日期 <select value={selected||''} onChange={e=>setSelected(e.target.value||null)}><option value="">今天 {view?.date||''}</option>{history?.items.filter(x=>x.date!==view?.date).map(x=><option key={x.date}>{x.date}</option>)}</select></label><span>{!view?.aiEnabled?'AI 分析未启用':'AI 分析已启用'}</span><nav className="news-jump" aria-label="栏目定位"><a href="#news-section-fmcg">快消研报与洞察</a><span aria-hidden="true">·</span><a href="#news-section-ai">AI 前沿</a></nav></div>{error&&<p className="form-error" role="alert">{error} <button className="text-button" onClick={refresh}>重新读取状态</button></p>}{readError&&<p className="form-error" role="alert">{readError}</p>}{history?.errors.map(e=><p className="form-error" key={e}>{e}</p>)}{selected&&!edition&&!readError&&<p>正在读取历史…</p>}
 {(['fmcg','ai'] as const).map(n=>{
  const current=shown?.sections[n];
  if(n==='fmcg'&&!selected) {
   const items=current?.contentVersion==='research-v1'?current.items.slice(0,5):[];
   const recent=view?.recentFmcg||[];
   return <section id={`news-section-${n}`} className="news-section" key={n}>
    <div className="news-section-heading">
     <div><h2>{labels.fmcg}</h2><p>{sectionStatus(current,'今日尚未准备')}</p></div>
     {controls(n,current)}
    </div>
    {checkNotices[n]&&<p role="status">{checkNotices[n]}</p>}
    <SectionDiagnosis section={current}/>
    <p className="news-notice">优先收录与中国即时零售、经销渠道、货盘、促销和门店经营有关的快消研究。近365日发布，最多展示5条。</p>
    {current&&current.status!=='running'&&items.length<5&&<p>今日新增不足原因：{current.shortageReasons?.length?current.shortageReasons.join(' '):'旧记录未记录具体不足原因'}</p>}
    {current?<p>今日收录 {items.length} 条 · 近期精选 {recent.length} 条 · 合计 {items.length+recent.length}/5</p>:<p>近期精选 {recent.length} 条</p>}
    <p>本期首次收录，并非今日发布。</p>
    {items.map(item=>renderItem(item,n,view?.date||''))}
    <h3>近期精选 {recent.length} 条</h3>
    {!recent.length&&<p>无近期精选</p>}
    {recent.map(({date,item})=><div key={date+item.id}><p>原收录：{date} · 原抓取：{time(item.fetchedAt)}</p>{renderItem(item,n,date)}</div>)}
    {[...new Set([view?.date,...recent.map(item=>item.date)].filter((date):date is string=>!!date))].map(date=>
     saveErrors[date]&&<p key={date} className="form-error" role="alert">{saveErrors[date]} <button className="text-button" onClick={()=>setProjectionReload(value=>value+1)}>重新读取保存状态</button></p>)}
   </section>;
  }
  const fallback=!selected&&current&&!current.items.length&&['failed','interrupted'].includes(current.status)?view?.fallbacks[n]:undefined;
  const section=fallback?.section||current,date=fallback?.date||selected||view?.date||'';
  return <section id={`news-section-${n}`} className="news-section" key={n}>
   <div className="news-section-heading">
    <div>
     <h2>{n==='fmcg'&&selected&&section&&!section.contentVersion?'旧版快消新闻':labels[n]}</h2>
     <p>{sectionStatus(current,n==='fmcg'&&shown?.legacyFmcg?'等待更新':'暂无记录')}{fallback&&' · 显示 '+fallback.date+' 的历史内容'}</p>
    </div>
    {!selected&&controls(n,current)}
   </div>
   {!selected&&checkNotices[n]&&<p role="status">{checkNotices[n]}</p>}
   <SectionDiagnosis section={current}/>
   {section&&section.status!=='running'&&<p className="news-meta">
    {section.items.length}/5 条{section.items.length<5&&<> · {section.shortageReasons?.length?section.shortageReasons.join(' '):'旧记录未记录具体不足原因'}</>}
   </p>}
   {section?.status==='empty'&&!section.checkMessage&&!section.sources.some(hasSourceFailure)&&<p>{n==='fmcg'?'暂无新的可核验研报':'近期没有足够的可核验内容。'}</p>}
   {!section&&<p>{n==='fmcg'&&shown?.legacyFmcg?'等待更新快消研报。':'暂无可阅读内容。'}</p>}
   {n==='fmcg'&&selected&&section&&<p>本期收录</p>}
   {section?.items.map(item=>renderItem(item,n,date))}
   {saveErrors[date]&&<p className="form-error" role="alert">{saveErrors[date]} <button className="text-button" onClick={()=>setProjectionReload(value=>value+1)}>重新读取保存状态</button></p>}
  </section>;
 })}
 {shown?.legacyFmcg&&<details className="news-section"><summary>升级前快消资讯（历史）</summary>{shown.legacyFmcg.items.map(item=>renderItem(item,'fmcg',selected||view?.date||''))}</details>}
 </div>;
}
