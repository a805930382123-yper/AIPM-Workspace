import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api, apiForm, ApiError, type Meeting } from './api';

type MinuteVersion = { import_id:string; imported_at:string; imported_minutes:string; editable_minutes:string; original_filename:string|null; original_sha256:string; file_sha256?:string };
type Props = { meeting:Meeting; onRefresh:()=>void };
const requestId=()=>crypto.randomUUID();
const textError=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。';
function safeMarkdownHref(value?:string){if(!value||/[\u0000-\u001f\u007f]/.test(value))return undefined;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?value:undefined;}catch{return undefined;}}
function Markdown({text}:{text:string}){return <div className="meeting-markdown"><ReactMarkdown skipHtml components={{
  a:({href,children})=>{const safe=safeMarkdownHref(href);return safe?<a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>;},
  img:({alt})=><span className="meeting-image-marker">[图片已隐藏{alt?`：${alt}`:''}]</span>,
}}>{text}</ReactMarkdown></div>;}

export function MeetingMinutes({meeting,onRefresh}:Props){
 const versions=meeting.imports as unknown as MinuteVersion[];
 const active=versions.find(item=>item.import_id===meeting.active_import_id)??null;
 const [viewId,setViewId]=useState(meeting.active_import_id??'');
 const viewed=versions.find(item=>item.import_id===viewId)??active;
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(active?.editable_minutes??''),[dirty,setDirty]=useState(false);
 const [source,setSource]=useState<'paste'|'file'>('paste'),[paste,setPaste]=useState(''),[file,setFile]=useState<File|null>(null),[confirmReimport,setConfirmReimport]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[serverRevision,setServerRevision]=useState(meeting.revision);
 const [clearConfirm,setClearConfirm]=useState(false);const [showOriginal,setShowOriginal]=useState(false);const [importRequest,setImportRequest]=useState(requestId);
 const lock=useRef(false),epoch=useRef(0),alive=useRef(true),draftRef=useRef(draft);
 useEffect(()=>{alive.current=true;const token=++epoch.current;return()=>{alive.current=false;epoch.current=token+1;};},[meeting.meeting_id]);
 useEffect(()=>{setServerRevision(meeting.revision);if(!dirty){setDraft(active?.editable_minutes??'');draftRef.current=active?.editable_minutes??'';setEditing(false);}if(!viewId||!versions.some(item=>item.import_id===viewId))setViewId(meeting.active_import_id??'');},[meeting.revision,meeting.active_import_id]);
 const setDraftValue=(value:string)=>{draftRef.current=value;setDraft(value);setDirty(value!==(active?.editable_minutes??''));};
 const reload=async()=>{const token=++epoch.current;setError('');try{const latest=await api<Meeting>(`/api/meetings/${encodeURIComponent(meeting.meeting_id)}`);if(!alive.current||token!==epoch.current)return;setServerRevision(latest.revision);setConflict(false);onRefresh();}catch(e){if(alive.current&&token===epoch.current)setError(`${textError(e)} 草稿仍保留。`);}};
 const importMinutes=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setConflict(false);const token=epoch.current;try{
   if(source==='file'){
     if(!file)throw new Error('请选择一个 Markdown 文件。');
     const form=new FormData();form.append('file',file);form.append('baseRevision',String(serverRevision));form.append('requestId',importRequest);if(confirmReimport)form.append('confirmReimport','true');
     const result=await apiForm<Meeting>(`/api/meetings/${encodeURIComponent(meeting.meeting_id)}/minutes/import`,form);
     if(!alive.current||token!==epoch.current)return;setFile(null);setPaste('');setConfirmReimport(false);setImportRequest(requestId());setServerRevision(result.revision);setViewId(result.active_import_id??'');onRefresh();
   }else{
     const result=await api<Meeting>(`/api/meetings/${encodeURIComponent(meeting.meeting_id)}/minutes/import`,{method:'POST',body:JSON.stringify({baseRevision:serverRevision,requestId:importRequest,text:paste,...(confirmReimport?{confirmReimport:true}:{})})});
     if(!alive.current||token!==epoch.current)return;setPaste('');setConfirmReimport(false);setImportRequest(requestId());setServerRevision(result.revision);setViewId(result.active_import_id??'');onRefresh();
   }
 }catch(e){if(alive.current&&token===epoch.current){setError(`${textError(e)} 输入仍保留。`);setConflict(e instanceof ApiError&&e.status===409);}}finally{lock.current=false;if(alive.current&&token===epoch.current)setBusy(false);}};
 const save=async()=>{if(!active||lock.current)return;lock.current=true;setBusy(true);setError('');setConflict(false);const token=epoch.current;try{const result=await api<Meeting>(`/api/meetings/${encodeURIComponent(meeting.meeting_id)}/minutes/${encodeURIComponent(active.import_id)}`,{method:'PATCH',body:JSON.stringify({baseRevision:serverRevision,editable_minutes:draft})});if(!alive.current||token!==epoch.current)return;setServerRevision(result.revision);setDirty(false);setEditing(false);onRefresh();}catch(e){if(alive.current&&token===epoch.current){setError(`${textError(e)} 工作副本仍保留。`);setConflict(e instanceof ApiError&&e.status===409);}}finally{lock.current=false;if(alive.current&&token===epoch.current)setBusy(false);}};
 const clear=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setConflict(false);const token=epoch.current;try{const result=await api<Meeting>(`/api/meetings/${encodeURIComponent(meeting.meeting_id)}/minutes`,{method:'DELETE',body:JSON.stringify({baseRevision:serverRevision,confirm:true})});if(!alive.current||token!==epoch.current)return;setClearConfirm(false);setDirty(false);setEditing(false);setDraft('');setViewId('');setServerRevision(result.revision);onRefresh();}catch(e){if(alive.current&&token===epoch.current){setError(`${textError(e)} 纪要仍保留。`);setConflict(e instanceof ApiError&&e.status===409);}}finally{lock.current=false;if(alive.current&&token===epoch.current)setBusy(false);}};
 return <section className="meeting-minutes"><header><div><h3>本地会议纪要</h3><p>仅存于本机；不创建 Raw，也不会发送到外部 AI。</p></div>{versions.length>0&&<label className="field meeting-version-picker">版本<select aria-label="查看纪要版本" value={viewed?.import_id??''} onChange={e=>{setViewId(e.target.value);setShowOriginal(false);}}>{versions.map((item,index)=><option key={item.import_id} value={item.import_id}>v{index+1} · {new Date(item.imported_at).toLocaleString('zh-CN')}{item.import_id===meeting.active_import_id?'（当前）':'（只读）'}</option>)}</select></label>}</header>
   {error&&<div className="meeting-error" role="alert"><span>{error}{conflict&&<p>冲突后仍保留输入。载入最新 revision 后检查，再决定是否重试。</p>}</span>{conflict&&<button className="text-button" disabled={busy} onClick={()=>void reload()}>重载最新版</button>}</div>}
   {!meeting.capabilities?.canImportMinutes&&versions.length===0?<p className="meeting-minutes-empty">{meeting.capabilities?.importReason||'当前策略不允许保存本地纪要。'}</p>:null}
   {viewed&&<div className="meeting-minute-version"><div className="meeting-minute-meta"><span>{viewed.original_filename??'粘贴纪要'}</span><code>SHA-256 {viewed.original_sha256}</code></div>
     {viewed.import_id===meeting.active_import_id&&editing?<><label className="field">工作副本<textarea aria-label="编辑纪要工作副本" value={draft} onChange={e=>setDraftValue(e.target.value)} /></label><div className="meeting-minute-actions"><button className="secondary-button" disabled={busy} onClick={()=>{setDraftValue(active?.editable_minutes??'');setEditing(false);}}>取消编辑</button><button className="primary-button" disabled={busy||!dirty} onClick={()=>void save()}>{busy?'保存中…':'保存工作副本'}</button></div></>:<>{showOriginal?<pre className="meeting-minute-source-text" aria-label="纪要原始文本">{viewed.imported_minutes}</pre>:<div className="meeting-minute-reader"><Markdown text={viewed.editable_minutes}/></div>}<div className="meeting-minute-actions"><button className="text-button" onClick={()=>setShowOriginal(v=>!v)}>{showOriginal?'阅读工作副本':'查看原文'}</button>{viewed.import_id===meeting.active_import_id&&<button className="secondary-button" onClick={()=>{setDraft(viewed.editable_minutes);draftRef.current=viewed.editable_minutes;setDirty(false);setEditing(true);}}>编辑工作副本</button>}</div></>}
   </div>}
   {meeting.capabilities?.canImportMinutes&&<div className="meeting-minute-import"><h4>{versions.length?'新增纪要版本':'导入纪要'}</h4><div className="meeting-import-tabs"><button type="button" className={source==='paste'?'selected':''} onClick={()=>{setSource('paste');setImportRequest(requestId());}}>粘贴</button><button type="button" className={source==='file'?'selected':''} onClick={()=>{setSource('file');setImportRequest(requestId());}}>上传 .md</button></div>
    {source==='paste'?<label className="field">Markdown 或文本<textarea aria-label="粘贴会议纪要" value={paste} onChange={e=>{setPaste(e.target.value);setImportRequest(requestId());}} placeholder="粘贴获准保存在本机的会议纪要" /></label>:<label className="field">Markdown 文件<input type="file" accept=".md,text/markdown" onChange={e=>{setFile(e.target.files?.[0]??null);setImportRequest(requestId());}} /><small>仅支持 UTF-8 .md，最大 2 MiB。</small></label>}
    {versions.length>0&&<label className="meeting-check"><input type="checkbox" checked={confirmReimport} onChange={e=>setConfirmReimport(e.target.checked)}/>确认新增版本，并将新原件设为当前工作副本；旧版本保留。</label>}
    <button className="primary-button" disabled={busy||(!paste.trim()&&source==='paste')||(!file&&source==='file')||(versions.length>0&&!confirmReimport)} onClick={()=>void importMinutes()}>{busy?'导入中…':versions.length?'新增版本':'导入纪要'}</button>
   </div>}
   {versions.length>0&&<div className="meeting-minute-clear"><label className="meeting-check"><input type="checkbox" checked={clearConfirm} onChange={e=>setClearConfirm(e.target.checked)}/>我确认删除全部 {versions.length} 个本地纪要版本（原件与工作副本）；飞书资料不受影响。</label><button className="secondary-button danger-button" disabled={busy||!clearConfirm} onClick={()=>void clear()}>删除全部本地纪要</button></div>}
 </section>;
}
