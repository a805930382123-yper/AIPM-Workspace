import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {lw02Fixture} from './lw02-fixture.ts';
import {startFakeProvider} from './support/fake-llm.ts';

test('formal entry carries provider context through answer and inspection operations', async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'provider01-')); const f=await lw02Fixture(dir);
 const raw=await f.rawStore.create({title:'虚构资料',body:'星桥2026直营网点目标100家。',sourceType:'report',sourceName:'测试',tags:[]});
 const pages=await Promise.all([f.seed('重复主题','星桥2026直营网点目标100家。',[raw.id]),f.seed('重复主题副本','星桥2026直营网点目标100家。',[raw.id])]);
 const fake=await startFakeProvider(req=>{const p=JSON.parse(req.user); let result:any;
 if(p.stage==='knowledge_inspection'){const [a,b]=p.wiki;result={version:1,findings:[{type:'duplicate',wikiIds:[a.id,b.id],summary:'两主题可能重复',reason:'双页陈述并列待核。',differences:'保留各自口径。',nextStep:'add_note',evidence:[a,b].map((w:any)=>({wikiId:w.id,quote:w.body,start:0,end:w.body.length}))}]};}
 else if(p.stage==='inspection_maintenance')result={version:1,changes:p.context.filter((w:any)=>p.findings.some((x:any)=>x.wikiIds.includes(w.id))).map((w:any)=>({action:'update',targetWikiId:w.id,baseRevision:w.revision,title:w.title,body:w.body+'\n\n## 待核\n保留双页口径。',reason:'补充口径说明。',summary:['保留旧内容'],questions:['仍待核对'],findingIds:p.findings.filter((x:any)=>x.wikiIds.includes(w.id)).map((x:any)=>x.id)}))};
 else {const data=p; if(data.stage==='knowledge_answer'){const citations=data.wiki.map((w:any,i:number)=>({id:'wiki-'+i,kind:'wiki',recordId:w.id,quote:w.body,start:0,end:w.body.length}));result={version:1,needsRaw:[],citations,sections:[{kind:'fact',text:data.wiki.map((w:any)=>w.body).join('\n'),citationIds:citations.map((c:any)=>c.id)}]};} else {result={action:'create',targetWikiId:null,baseRevision:null,title:data.preview.title,type:'synthesis',category:'channel',body:'## 问答整理\n'+data.preview.conclusion,tags:data.preview.tags,reason:'整理所选内容。',summary:['保留依据'],questions:['待核对']};}}
 return {kind:'content',content:JSON.stringify(result)};});
 const socket=net.createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as net.AddressInfo).port;await new Promise<void>(r=>socket.close(()=>r()));
 const cfg=path.join(dir,'provider.env');await writeFile(cfg,'');const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^FMCG_LLM_|proxy|^NODE_OPTIONS$/i.test(k)));
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),windowsHide:true,env:{...env,FMCG_DATA_DIR:dir,FMCG_PORT:String(port),FMCG_LLM_CONFIG_FILE:cfg,FMCG_LLM_BASE_URL:fake.url,FMCG_LLM_MODEL:'fake',FMCG_LLM_API_KEY:'synthetic'},stdio:'ignore'});
 const url=`http://127.0.0.1:${port}`;const req=async(p:string,body?:unknown)=>{const r=await fetch(url+p,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,json:await r.json() as any};};
 try{for(let i=0;i<100;i++){try{if((await req('/api/health')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const a=await req('/api/knowledge/answers',{requestId:randomUUID(),question:'有效门店统计的口径是什么？'});assert.equal(a.json.status,'completed',JSON.stringify(a));
 const save=await req(`/api/knowledge/answers/${a.json.id}/save`,{resultRevision:a.json.revision,key:randomUUID(),preview:f.preview(a.json)});assert.equal(save.status,200,JSON.stringify(save));
 const start=await req('/api/knowledge/inspections',{requestId:randomUUID(),wikiIds:pages.map(p=>p.id),includeRelated:false});assert.equal(start.status,202);let check:any;for(let i=0;i<100;i++){check=(await req(`/api/knowledge/inspections/${start.json.id}`)).json;if(!['checking','queued'].includes(check.status))break;await new Promise(r=>setTimeout(r,100));}assert.equal(check.status,'completed',JSON.stringify(check));
 const draft=await req(`/api/knowledge/inspections/${check.id}/draft`,{baseRevision:check.revision,selectedFindingIds:[check.findings[0].id],key:randomUUID()});assert.equal(draft.status,200,JSON.stringify(draft));assert.deepEqual(fake.requests.map(r=>JSON.parse(r.user).stage),['knowledge_answer','answer_maintenance','knowledge_inspection','inspection_maintenance']);
 }finally{await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});await fake.close();await rm(dir,{recursive:true,force:true});}
});





test('manual and read routes work with absent and malformed optional configuration',async()=>{
 for(const config of ['', 'FMCG_LLM_BASE_URL=not-a-url\n']){
 const dir=await mkdtemp(path.join(os.tmpdir(),'provider01-manual-'));const cfg=path.join(dir,'config.env');await writeFile(cfg,config);
 const sock=net.createServer();await new Promise<void>(r=>sock.listen(0,'127.0.0.1',r));const port=(sock.address() as net.AddressInfo).port;await new Promise<void>(r=>sock.close(()=>r()));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^FMCG_LLM_|proxy|^NODE_OPTIONS$/i.test(k)));
 const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),windowsHide:true,env:{...env,FMCG_DATA_DIR:dir,FMCG_PORT:String(port),FMCG_LLM_CONFIG_FILE:cfg},stdio:'ignore'});const base=`http://127.0.0.1:${port}`;
 try{let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
 assert.equal((await fetch(base+'/api/knowledge/answers/current')).status,200);assert.equal((await fetch(base+'/api/raw')).status,200);
 const raw=await fetch(base+'/api/raw',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'隔离手工原文',body:'虚构内容。',sourceType:'report',sourceName:'测试',tags:[]})});assert.equal(raw.status,201,await raw.text());
 }finally{await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});await rm(dir,{recursive:true,force:true});}
 }
});
