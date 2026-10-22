// Independent shared six-chain safety regression: actual HTTP and localhost adapter only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHarness,expect,request,terminal,rawInput,wikiInput,fileSnapshot} from './kb02-20261015-standards-harness.mjs';
import {oneFactReply,payload as wirePayload} from './kb02-20261015-standards-wire.mjs';
import {fakeReply,bodyA,bodyB} from './kb01-r4-20261014-legacy-fixture.mjs';
import {reply as promptReply,brief} from './pa01-20261015-main-fixtures.mjs';import {input as promptInput} from './b08-fixtures.mjs';
const checks=[],services=[],started=Date.now(),suffix=process.env.KB02_STANDARDS_RUN??'initial';
const credentials=['kb02-local-only-long-credential-19z!','s8Z!'];
const redact=x=>credentials.reduce((s,k)=>s.replaceAll(k,'[synthetic credential redacted]'),String(x));
async function snapshot(root){const out={};for(const dir of ['knowledge','prompts','drafts','meetings'])out[dir]=await fileSnapshot(path.join(root,dir));return out;}
async function bytes(root){let out='';for(const e of await fs.readdir(root,{withFileTypes:true}).catch(()=>[])){const p=path.join(root,e.name);out+=e.isDirectory()?await bytes(p):await fs.readFile(p,'utf8');}return out;}
function clean(kind,w){return kind==='extract'?oneFactReply(w):['brief','generate','optimize'].includes(kind)?promptReply(w):fakeReply(w);}
function tainted(kind,w,key,variant){const v=clean(kind,w);if(variant==='key')v['echo_'+key]='safe';else if(variant==='nested-key')v.extra={safe:{['echo_'+key]:'safe'}};else if(kind==='extract')v.facts[0].text='echo '+key;else if(kind==='brief')v.goal+=' echo '+key;else if(kind==='generate')v.sections[0].content+=' echo '+key;else if(kind==='optimize')v.checks[0].evidence+=' echo '+key;else v.inferences.push('echo '+key);let text=JSON.stringify(v);if(variant==='escaped')text=text.replaceAll(key,[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));return text;}
async function record(id,fn){try{checks.push({id,result:'PASS',evidence:await fn()});}catch(e){checks.push({id,result:'FAIL',error:redact(e.stack)});}console.log(id+': '+checks.at(-1).result);}
for(const [index,key]of credentials.entries()){
 const label=index?'short':'long',h=await createHarness(oneFactReply,key);let s;
 try{
 s=await h.start();const a=await expect(s,'/api/raw','POST',rawInput('KB02安全旧来源',bodyA),201),b=await expect(s,'/api/raw','POST',rawInput('KB02安全新来源',bodyB),201),wiki=await expect(s,'/api/wiki','POST',wikiInput('KB02安全目标',[a.id],bodyA),201);
 const start=await expect(s,'/api/raw/'+b.id+'/extract','POST',{},202),job=await terminal(s,start.jobId);assert.equal(job.status,'completed',JSON.stringify(job));let d=await expect(s,'/api/drafts/'+job.draftId);
 await expect(s,`/api/knowledge/drafts/${d.id}/pages/${d.pages[0].pageId}/decision`,'PATCH',{baseRevision:d.revision,decision:'update',targetWikiId:wiki.id});d=await expect(s,'/api/drafts/'+d.id);
 const manual=await expect(s,'/api/prompts','POST',{requestId:randomUUID(),...promptInput('KB02手动模板','分析业务流程。')},201);
 const bodyFor={synthesis:{rawIds:[a.id,b.id]},update:{draftId:d.id,pageId:d.pages[0].pageId,targetWikiId:wiki.id,baseRevision:d.revision},brief:{task:'业务任务整理',template:'business_process'},generate:{brief,relatedWikiIds:[wiki.id]},optimize:{body:manual.prompt.body,supplement:'补充要求',targetPromptId:manual.prompt.id,baseVersion:manual.prompt.version}};
 const routeFor={synthesis:'/api/knowledge/syntheses',update:'/api/knowledge/updates',brief:'/api/prompt-ai/brief',generate:'/api/prompt-ai/generate',optimize:'/api/prompt-ai/optimize'};
 for(const kind of ['extract','synthesis','update','brief','generate','optimize']){
  for(const variant of ['value','escaped','key','nested-key'])await record(`${label}-${kind}-${variant}`,async()=>{
   let url=routeFor[kind],body=bodyFor[kind],rawId;if(kind==='extract'){rawId=(await expect(s,'/api/raw','POST',rawInput('拒绝'+variant,bodyA),201)).id;url='/api/raw/'+rawId+'/extract';body={};}
   const before=await snapshot(h.dataRoot),n=h.requests.length;h.setReply(w=>tainted(kind,w,key,variant));const result=await request(s,url,'POST',body);let publicText=result.text,code;
   if(kind==='extract'){assert.equal(result.status,202,result.text);const j=await terminal(s,result.json.jobId);assert.equal(j.status,'failed');assert.equal(j.draftId,null);code=j.error?.code;publicText+=JSON.stringify(j);}else{assert.equal(result.status,502,result.text);code=result.json?.error?.code;}
   assert.equal(code,'LLM_OUTPUT_CONTAINS_SECRET');assert(!publicText.includes(key));assert.deepEqual(await snapshot(h.dataRoot),before);assert(!(await bytes(h.dataRoot)).includes(key));assert(!s.logs.includes(key));assert.equal(h.requests.length,n+1);assert(h.requests.at(-1).authCorrect);return {code,oneAuthenticatedLocalhostCall:true,assetsUnchanged:true,noSecret:true};
  });
  await record(`${label}-${kind}-clean-retry`,async()=>{h.setReply(w=>clean(kind,w));const before={knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),prompts:await fileSnapshot(path.join(h.dataRoot,'prompts'))};if(kind==='extract'){const r=await expect(s,'/api/raw','POST',rawInput('干净新提取',bodyA),201),start=await expect(s,'/api/raw/'+r.id+'/extract','POST',{},202),j=await terminal(s,start.jobId);assert.equal(j.status,'completed',JSON.stringify(j));return {completed:true};}const out=await expect(s,routeFor[kind],'POST',bodyFor[kind],201);assert.deepEqual({knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),prompts:await fileSnapshot(path.join(h.dataRoot,'prompts'))},before);return {previewCreated:Boolean(out.id||out.draftId),noFormalWrites:true};});
 }
 await record(`${label}-meeting-source-zero-calls`,async()=>{
  const catalog=await expect(s,'/api/meeting-catalog');let m=await expect(s,'/api/meetings','POST',{requestId:randomUUID(),title:'KB02安全虚构会议',meeting_date:'2026-10-15',meeting_type:catalog.types[0].id,confidentiality:'Public'},201);
  m=await expect(s,'/api/meetings/'+m.meeting_id+'/policy','PATCH',{baseRevision:m.revision,storage_mode:'local_archive',raw_transfer_authorized:true,confirm_raw_transfer:true});m=await expect(s,'/api/meetings/'+m.meeting_id+'/minutes/import','POST',{baseRevision:m.revision,requestId:randomUUID(),text:'# 虚构本机会议\n会议来源不得外发。'},201);const link=await expect(s,'/api/meetings/'+m.meeting_id+'/raw-links','POST',{baseRevision:m.revision,requestId:randomUUID(),import_id:m.active_import_id,confirm:true},201),n=h.requests.length,before=await snapshot(h.dataRoot);
  const e=await request(s,'/api/raw/'+link.raw_id+'/extract','POST',{}),syn=await request(s,'/api/knowledge/syntheses','POST',{rawIds:[a.id,link.raw_id]});assert.equal(e.status,403,e.text);assert.equal(syn.status,403,syn.text);assert.equal(h.requests.length,n);assert.deepEqual(await snapshot(h.dataRoot),before);return {extract:403,synthesis:403,zeroCalls:true,noWrites:true};
 });
 }catch(e){checks.push({id:label+'-setup',result:'FAIL',error:redact(e.stack)});}finally{await h.close();services.push({root:h.dataRoot,calls:h.requests.length,closed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)});}
}
const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};await fs.writeFile(`docs/reports/PA01-SOL-20261015-builder-security.json`,JSON.stringify({at:new Date().toISOString(),scope:'actual HTTP + localhost fake; six business output chains, not real semantic quality',durationMs:Date.now()-started,checks,summary,services},null,2));console.log(summary);if(summary.fail)process.exitCode=1;


