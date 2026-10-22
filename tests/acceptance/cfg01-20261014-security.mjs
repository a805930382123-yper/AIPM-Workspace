// Independent public HTTP checks; real adapter to a localhost fake, never real AI quality.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHarness,request,expect,rawInput,wikiInput,fileSnapshot,delay} from './cfg01-20261014-security-harness.mjs';
import {fakeReply,bodyA,bodyB} from './b05-fake-reply.mjs';
import {reply as promptReply,brief,input as promptInput} from './b08-fixtures.mjs';
const prefix='docs/reports/CFG01-20261014-security', checks=[], services=[], started=Date.now();
const phase=process.argv[2]??'final';
const only=process.env.CFG01_SEC_ONLY?.split(',');
const credentials=['local-sec-long-fixture-7uQ!', 'x4Q!z'];
const redact=s=>credentials.reduce((s,k)=>s.replaceAll(k,'[fixture credential redacted]'),String(s));
async function record(id,fn){if(only&&!only.some(suffix=>id.endsWith(suffix)))return;try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',reason:redact(e.message)});}console.log(`${id}: ${checks.at(-1).result}`);}
async function assetSnapshot(root){const out={};for(const dir of ['knowledge','prompts','drafts','meetings'])out[dir]=await fileSnapshot(path.join(root,dir));return out;}
async function bytesUnder(root){let out='';for(const e of await fs.readdir(root,{withFileTypes:true}).catch(()=>[])){const p=path.join(root,e.name);out+=e.isDirectory()?await bytesUnder(p):await fs.readFile(p,'utf8');}return out;}
async function jobResult(s,id){for(let i=0;i<240;i++){const job=await expect(s,`/api/extraction-jobs/${id}`);if(job.status!=='running')return job;await delay(40);}throw Error('Job did not reach terminal state');}
async function extract(h,s,rawId){h.setReply(fakeReply);const started=await expect(s,`/api/raw/${rawId}/extract`,'POST',{},202);const job=await jobResult(s,started.jobId);assert.equal(job.status,'completed');return expect(s,`/api/drafts/${job.draftId}`);}
function cleanResponse(kind,wire){return ['brief','generate','optimize'].includes(kind)?promptReply(wire):fakeReply(wire);}
function payload(kind,wire,key,variant){
 const value=cleanResponse(kind,wire);
 const nested=variant==='nested';
 if(variant==='key') value[`extra_${key}`]='ordinary';
 else if(variant==='nested-key') value.extra={safe:{[`nested_${key}`]:'ordinary'}};
 else if(kind==='extract') {if(nested)value.suggested_pages[0].ai_inferences.push('echo '+key);else value.document.summary+=' echo '+key;}
 else if(kind==='brief') value.goal+=' echo '+key;
 else if(['generate','optimize'].includes(kind)) {if(nested&&kind==='optimize')value.improvements[0].action+=' echo '+key;else value.preview.body+=' echo '+key;}
 else {if(nested)value.suggestedAdditions[0].text+=' echo '+key;else value.inferences.push('echo '+key);}
 let text=JSON.stringify(value);
 if(variant==='escaped')text=text.replaceAll(key,[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
 return text;
}
for(const [credentialIndex,key]of credentials.entries()){
 const label=credentialIndex?'short':'long';const h=await createHarness(fakeReply,undefined,key);let s;
 try{
  s=await h.start();
  const a=await expect(s,'/api/raw','POST',rawInput('安全来源A',bodyA),201);
  const b=await expect(s,'/api/raw','POST',rawInput('安全来源B',bodyB),201);
  const wiki=await expect(s,'/api/wiki','POST',wikiInput('安全已有页面',[a.id],'人工正文与旧事实。'),201);
  let draft=await extract(h,s,b.id),page=draft.pages[0];
  const decision=await expect(s,`/api/knowledge/drafts/${draft.id}/pages/${page.pageId}/decision`,'PATCH',{baseRevision:draft.revision,decision:'update',targetWikiId:wiki.id});
  draft=await expect(s,`/api/drafts/${draft.id}`);
  const manual=await expect(s,'/api/prompts','POST',{requestId:randomUUID(),...promptInput('手动旧模板','分析业务流程。')},201);
  h.setReply(promptReply);await expect(s,'/api/prompt-ai/brief','POST',{task:'安全基线任务',template:'business_process'},201);
  const bodyFor={synthesis:{rawIds:[a.id,b.id]},update:{draftId:draft.id,pageId:page.pageId,targetWikiId:wiki.id,baseRevision:decision.revision},brief:{task:'业务任务整理',template:'business_process'},generate:{brief,relatedWikiIds:[wiki.id]},optimize:{body:manual.prompt.body,supplement:'补充要求',targetPromptId:manual.prompt.id,baseVersion:manual.prompt.version}};
  const routeFor={synthesis:'/api/knowledge/syntheses',update:'/api/knowledge/updates',brief:'/api/prompt-ai/brief',generate:'/api/prompt-ai/generate',optimize:'/api/prompt-ai/optimize'};
  for(const kind of ['synthesis','update','brief','generate','optimize','extract']){
   const variants=phase==='baseline'?['value']:['value','escaped','key','nested-key','nested'];
   for(const variant of variants)await record(`${label}-${kind}-${variant}`,async()=>{
    let rawId,url=routeFor[kind],body=bodyFor[kind];
    if(kind==='extract'){const raw=await expect(s,'/api/raw','POST',rawInput('失败提取 '+variant,bodyA),201);rawId=raw.id;url=`/api/raw/${rawId}/extract`;body={};}
    const before=await assetSnapshot(h.dataRoot),callStart=h.requests.length;
    h.setReply(wire=>payload(kind,wire,key,variant));
    const result=await request(s,url,'POST',body);let publicText=result.text,job;
    if(kind==='extract'){
     assert.equal(result.status,202);job=await jobResult(s,result.json.jobId);publicText+=JSON.stringify(job);
     assert.equal(job.status,'failed','Credential output must fail extraction');assert.equal(job.error.code,'LLM_OUTPUT_CONTAINS_SECRET');assert.equal(job.draftId,null);
     const states=await expect(s,'/api/raw-processing');assert.equal(states.items.find(x=>x.rawId===rawId).status,'failed');
    }else{assert.equal(result.status,502,'Credential output must be rejected before schema/write');assert.equal(result.json.error.code,'LLM_OUTPUT_CONTAINS_SECRET');}
    assert.ok(!publicText.includes(key),'HTTP must not expose credential');
    assert.deepEqual(await assetSnapshot(h.dataRoot),before,'Rejected output must preserve all assets and existing drafts');
    assert.ok(!(await bytesUnder(h.dataRoot)).includes(key),'No credential in any data file');
    assert.ok(!s.logs.includes(key),'No credential in process logs');
    assert.equal(h.requests.length-callStart,1,'Fixture must reach real adapter exactly once');assert.ok(h.requests.slice(callStart).every(x=>x.authCorrect));
    return {httpStatus:result.status,jobStatus:job?.status,noCredential:true,assetsUnchanged:true,adapterAuthenticated:true};
   });
   if(phase!=='baseline')await record(`${label}-${kind}-clean-retry`,async()=>{
    const formalBefore={knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),prompts:await fileSnapshot(path.join(h.dataRoot,'prompts'))};
    h.setReply(wire=>cleanResponse(kind,wire));let out;
    if(kind==='extract'){
     const all=await expect(s,'/api/raw-processing');const failed=all.items.find(x=>x.status==='failed');assert.ok(failed);
     const began=await expect(s,`/api/raw/${failed.rawId}/extract`,'POST',{},202);const job=await jobResult(s,began.jobId);assert.equal(job.status,'completed');out=await expect(s,`/api/drafts/${job.draftId}`);
    }else out=await expect(s,routeFor[kind],'POST',bodyFor[kind],201);
    assert.deepEqual({knowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),prompts:await fileSnapshot(path.join(h.dataRoot,'prompts'))},formalBefore,'Successful preview must not write formal assets');
    return {pendingDraftCreated:Boolean(out.id||out.draftId),formalAssetsUnchanged:true};
   });
  }
  if(phase!=='baseline'){
   await record(`${label}-audit-regression`,async()=>{
    const audit=await expect(s,'/api/audits','POST',{wikiId:wiki.id,scope:'page',severity:'warning',comment:'安全回归'},201);
    const clean={replacement:'已核验人工正文',rationale:'人工依据',evidence:[]};h.setReply(()=>clean);await expect(s,`/api/audits/${audit.id}/propose`,'POST',{},201);
    for(const variant of ['value','key','escaped','provider-error']){
     const before=await assetSnapshot(h.dataRoot);h.setReply(()=>{
      if(variant==='provider-error')return {httpStatus:401,message:'echo '+key};
      const o={...clean};if(variant==='key')o['echo_'+key]='safe';else o.rationale='echo '+key;
      let text=JSON.stringify(o);if(variant==='escaped')text=text.replaceAll(key,key.split('').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));return text;
     });
     const r=await request(s,`/api/audits/${audit.id}/propose`,'POST',{});assert.ok(r.status>=400);assert.ok(!r.text.includes(key));assert.deepEqual(await assetSnapshot(h.dataRoot),before);assert.ok(!(await bytesUnder(h.dataRoot)).includes(key));
    }
    return {cleanProposalCreated:true,rejectedCases:4,existingPendingDraftUnchanged:true,noCredential:true};
   });
   for(const kind of ['synthesis','update','brief','generate','optimize','extract'])await record(`${label}-${kind}-provider-error`,async()=>{
    let url=routeFor[kind],body=bodyFor[kind],rawId;
    if(kind==='extract'){rawId=(await expect(s,'/api/raw','POST',rawInput('错误路径',bodyA),201)).id;url=`/api/raw/${rawId}/extract`;body={};}
    const before=await assetSnapshot(h.dataRoot);h.setReply(()=>({httpStatus:401,message:'fake authentication failed '+key}));
    const r=await request(s,url,'POST',body);let text=r.text;
    if(kind==='extract'){const j=await jobResult(s,r.json.jobId);assert.equal(j.status,'failed');text+=JSON.stringify(j);assert.equal(j.error.code,'LLM_AUTH_FAILED');}
    else {assert.ok(r.status>=400);assert.equal(r.json.error.code,'LLM_AUTH_FAILED');}
    assert.ok(!text.includes(key));assert.ok(!(await bytesUnder(h.dataRoot)).includes(key));assert.deepEqual(await assetSnapshot(h.dataRoot),before);
    return {noCredential:true,assetsUnchanged:true};
   });
   await record(`${label}-long-extract-early-rejection`,async()=>{
    const raw=await expect(s,'/api/raw','POST',rawInput('多段原文',bodyA.repeat(1600)),201);const before=await assetSnapshot(h.dataRoot);const count=h.requests.length;
    h.setReply(wire=>payload('extract',wire,key,'value'));const r=await expect(s,`/api/raw/${raw.id}/extract`,'POST',{},202);const j=await jobResult(s,r.jobId);
    assert.equal(j.status,'failed');assert.equal(j.error.code,'LLM_OUTPUT_CONTAINS_SECRET');const calls=h.requests.length-count;assert.ok(calls>0&&calls<=2,'Only the first concurrent wave may run, no subsequent chunk/merge');assert.deepEqual(await assetSnapshot(h.dataRoot),before);
    assert.ok(!JSON.stringify(h.requests.slice(count).map(x=>x.input)).includes(key));return {calls,noLaterInputWithCredential:true};
   });
   await record(`${label}-raw-integrity-gate`,async()=>{
    const raw=await expect(s,'/api/raw','POST',rawInput('正文完整性',bodyA),201);const files=Object.keys(await fileSnapshot(path.join(h.dataRoot,'knowledge/raw')));const relative=files.find(p=>p.endsWith(raw.id+'.md'));assert.ok(relative);
    const f=path.join(h.dataRoot,'knowledge/raw',relative),original=await fs.readFile(f);await fs.writeFile(f,original.toString('utf8')+' tampered');const count=h.requests.length;
    try{const r=await request(s,`/api/raw/${raw.id}/extract`,'POST',{});assert.equal(r.status,409);assert.equal(h.requests.length,count);return {httpStatus:409,providerCalls:0};}finally{await fs.writeFile(f,original);}
   });
   await record(`${label}-malformed-json-prefix`,async()=>{
    const raw=await expect(s,'/api/raw','POST',rawInput('非法JSON前缀',bodyA),201);const before=await assetSnapshot(h.dataRoot);
    h.setReply(()=>key+' {invalid');const r=await expect(s,`/api/raw/${raw.id}/extract`,'POST',{},202);const j=await jobResult(s,r.jobId);
    assert.equal(j.status,'failed');assert.equal(j.error.code,'LLM_INVALID_JSON');assert.ok(!JSON.stringify(j).includes(key));assert.ok(!(await bytesUnder(h.dataRoot)).includes(key));assert.deepEqual(await assetSnapshot(h.dataRoot),before);return {errorCode:j.error.code,noCredential:true};
   });
   await record(`${label}-merge-output-and-retry`,async()=>{
    const raw=await expect(s,'/api/raw','POST',rawInput('汇总门禁',bodyA.repeat(500)),201);let chunkCalls=0,mergeCalls=0;
    const mergeResponder=tainted=>wire=>{
     const user=wire.messages.find(x=>x.role==='user').content;
     if(!user.includes('<<<\n')){mergeCalls++;return {document:{title:'安全汇总',main_topic:'业务口径',summary:tainted?'echo '+key:'完整安全汇总'}};}
     const o=fakeReply(wire);o.document.summary='safe chunk '+(++chunkCalls);o.suggested_pages[0].one_line_definition='业务事实';o.suggested_pages[0].source_facts[0].text='来源口径';const ev=o.suggested_pages[0].source_evidence[0];ev.quote=ev.quote.slice(0,180);ev.start=Number(user.match(/全局区间 \[(\d+),/)?.[1]);ev.end=ev.start+ev.quote.length;return o;
    };
    const before=await assetSnapshot(h.dataRoot);const count=h.requests.length;h.setReply(mergeResponder(true));
    const start=await expect(s,`/api/raw/${raw.id}/extract`,'POST',{},202);const bad=await jobResult(s,start.jobId);
    assert.equal(bad.status,'failed');assert.equal(bad.error.code,'LLM_OUTPUT_CONTAINS_SECRET');assert.ok(chunkCalls>1);assert.equal(mergeCalls,1);assert.deepEqual(await assetSnapshot(h.dataRoot),before);
    assert.ok(!JSON.stringify(h.requests.slice(count).map(x=>x.input)).includes(key));chunkCalls=mergeCalls=0;h.setReply(mergeResponder(false));
    const retry=await expect(s,`/api/raw/${raw.id}/extract`,'POST',{},202);const good=await jobResult(s,retry.jobId);assert.equal(good.status,'completed');assert.equal(mergeCalls,1);assert.ok(chunkCalls>1);
    return {failedMergeRejected:true,safeMergeInputs:true,cleanRetryCompleted:true,chunkCalls,mergeCalls};
   });
   await record(`${label}-same-root-restart`,async()=>{
    const before=await assetSnapshot(h.dataRoot);await h.stop(s);s=await h.start();assert.deepEqual(await assetSnapshot(h.dataRoot),before);assert.ok(!(await bytesUnder(h.dataRoot)).includes(key));return {assetsUnchanged:true,noCredentialAfterRestart:true};
   });
   await record(`${label}-meeting-local-only-regression`,async()=>{
    const catalog=await expect(s,'/api/meeting-catalog');
    let meeting=await expect(s,'/api/meetings','POST',{requestId:randomUUID(),title:'安全回归会议',meeting_date:'2026-10-14',meeting_type:catalog.types[0].id,confidentiality:'Public'},201);
    meeting=await expect(s,`/api/meetings/${meeting.meeting_id}/policy`,'PATCH',{baseRevision:meeting.revision,storage_mode:'local_archive'});
    meeting=await expect(s,`/api/meetings/${meeting.meeting_id}/minutes/import`,'POST',{baseRevision:meeting.revision,requestId:randomUUID(),text:'# 本机会议\n\n仅本地来源'},201);
    meeting=await expect(s,`/api/meetings/${meeting.meeting_id}/policy`,'PATCH',{baseRevision:meeting.revision,raw_transfer_authorized:true,confirm_raw_transfer:true});
    const linked=await expect(s,`/api/meetings/${meeting.meeting_id}/raw-links`,'POST',{baseRevision:meeting.revision,requestId:randomUUID(),import_id:meeting.active_import_id,confirm:true},201);
    const before=await assetSnapshot(h.dataRoot),count=h.requests.length;
    const extraction=await request(s,`/api/raw/${linked.raw_id}/extract`,'POST',{}),synthesis=await request(s,'/api/knowledge/syntheses','POST',{rawIds:[a.id,linked.raw_id]});
    assert.equal(extraction.status,403);assert.equal(synthesis.status,403);assert.equal(h.requests.length,count);assert.deepEqual(await assetSnapshot(h.dataRoot),before);
    return {extractStatus:403,synthesisStatus:403,providerCalls:0,assetsUnchanged:true};
   });
   await record(`${label}-prompt-explicit-confirmation`,async()=>{
    h.setReply(promptReply);const g=await expect(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[wiki.id]},201);
    const created=await expect(s,`/api/prompt-ai/drafts/${g.draftId}/confirm`,'POST',{requestId:g.draftId,mode:'new',input:g.preview},201);
    assert.equal(created.prompt.body,g.preview.body);assert.equal(created.prompt.source,'ai_generated');
    const optimized=await expect(s,'/api/prompt-ai/optimize','POST',{body:created.prompt.body,supplement:'补充约束',targetPromptId:created.prompt.id,baseVersion:created.prompt.version},201);
    const saved=await expect(s,`/api/prompt-ai/drafts/${optimized.draftId}/confirm`,'POST',{requestId:optimized.draftId,mode:'version',input:optimized.preview},201);
    assert.equal(saved.prompt.id,created.prompt.id);assert.equal(saved.prompt.version,created.prompt.version+1);
    const reread=await expect(s,`/api/prompts/${created.prompt.id}`);assert.equal(reread.prompt.body,optimized.preview.body);const versions=await expect(s,`/api/prompts/${created.prompt.id}/versions`);assert.equal(versions.items.length,2);
    return {explicitCreate:true,explicitNewVersion:true,persistedBodyMatches:true};
   });
  }
 }catch(e){checks.push({id:`${label}-setup`,result:'FAIL',reason:redact(e.message)});}
 finally{await h.close();services.push({dataRoot:h.dataRoot,ports:h.services.map(x=>x.port),servicesClosed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null),fakeClosed:true});}
}
const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};
await fs.writeFile(`${prefix}-${phase}.json`,JSON.stringify({date:'2026-10-14',phase,scope:'actual product HTTP + real adapter + localhost fake, no external provider',durationMs:Date.now()-started,checks,summary,services},null,2));
console.log(JSON.stringify(summary));if(summary.fail)process.exitCode=1;


