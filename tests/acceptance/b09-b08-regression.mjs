import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createHarness,request,expect,fileSnapshot,wikiInput,rawInput} from './b08-harness.mjs';
import {reply,brief,task,input,providerUser,dimensions} from './b08-fixtures.mjs';
const prefix='docs/reports/B09-regression-acceptance-http'+(process.argv[2]?'-'+process.argv[2]:'');
const h=await createHarness(reply),checks=[];let s,raw,w1,w2,g,o,manual,knowledge;
const test=async(id,fn)=>{try{const details=await fn();checks.push({id,result:'PASS',details});}catch(e){checks.push({id,result:'FAIL',message:String(e),stack:e.stack});}await fs.writeFile(prefix+'.json',JSON.stringify({provider:'independent fake; not real quality',dataRoot:h.dataRoot,checks},null,2));};
const unchanged=async before=>assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'prompts')),before);
const confirm=(d,mode,edited)=>expect(s,`/api/prompt-ai/drafts/${d}/confirm`,'POST',{requestId:d,mode,input:edited},201);
try{
 s=await h.start();
 raw=await expect(s,'/api/raw','POST',rawInput('B08独立来源','独立验收正文，不得改写。'),201);
 w1=await expect(s,'/api/wiki','POST',wikiInput('订货访谈流程',[raw.id],'订货访谈选中背景独特标记SELECTED_B08\n\n订货流程需要核对角色与异常。'),201);
 w2=await expect(s,'/api/wiki','POST',wikiInput('不选择的库存页',[raw.id],'不得发送的内容UNSELECTED_B08'),201);
 manual=await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),...input('B08原始手动模板',' 原始正文\n{{客户名称}}\n完整保留 ')},201);
 knowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge'));
 await test('E08-01-brief-templates',async()=>{
  const schema=await expect(s,'/api/prompt-ai/schema');assert.equal(schema.templates.length,7);assert.equal(schema.checks.length,9);
  for(const template of schema.templates){const r=await expect(s,'/api/prompt-ai/brief','POST',{task,template:template.id},201);assert.deepEqual(r.brief,brief);assert.ok(r.draftId);assert.ok(r.wikiCandidates.every(c=>c.selected===false));}
  return {templates:schema.templates.map(t=>t.id),budgets:schema.budgets};
 });
 await test('E08-02-03-edited-brief-selection-background',async()=>{
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));
  const b={...brief,goal:'只分析人工审批，修改目标EDITED_B08',constraints:'不得编造审批事实'};
  g=await expect(s,'/api/prompt-ai/generate','POST',{brief:b,relatedWikiIds:[w1.id]},201);
  const u=providerUser(h.requests.at(-1).input);assert.deepEqual(u.brief,b);assert.deepEqual(u.relatedWikiIds,[w1.id]);
  assert.ok(JSON.stringify(u).includes('SELECTED_B08'));assert.ok(!JSON.stringify(u).includes('UNSELECTED_B08'));assert.ok(g.preview.body.includes(b.goal));assert.deepEqual(g.preview.relatedWikiIds,[w1.id]);
  const zero=await expect(s,'/api/prompt-ai/generate','POST',{brief:b,relatedWikiIds:[]},201);const zu=providerUser(h.requests.at(-1).input);assert.deepEqual(zu.relatedWikiIds,[]);assert.ok(!JSON.stringify(zu).includes('SELECTED_B08'));await unchanged(before);
  return {selected:g.relatedWiki,emptySelection:zero.relatedWiki,editedGoal:g.preview.body.includes(b.goal)};
 });
 await test('E08-03-context-budget-and-missing-selection',async()=>{
  const ids=[];for(let i=0;i<5;i++){const p=await expect(s,'/api/wiki','POST',wikiInput('长订货'+i,[raw.id],('订货业务流程相关背景段落'+i+'。').repeat(350)),201);ids.push(p.id);}
  knowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge'));
  const r=await expect(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:ids},201);
  assert.ok(r.contextBudget.used<=12000);assert.ok(r.relatedWiki.every(p=>p.usedChars<=3000));assert.ok(r.relatedWiki.some(p=>p.truncated));assert.equal(r.relatedWiki.length,5);
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts')),count=h.requests.length;
  const bad=await request(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[crypto.randomUUID()]});assert.ok(bad.status>=400);assert.equal(h.requests.length,count);await unchanged(before);
  return {budget:r.contextBudget,used:r.relatedWiki.map(p=>({id:p.id,chars:p.usedChars,truncated:p.truncated})),missingStatus:bad.status};
 });
 await test('E08-04-05-explicit-save-edits-source-retry',async()=>{
  const edited={...g.preview,name:'B08用户编辑正式模板',body:' 用户编辑\n{{门店名称}}\n尾部 ',tags:['用户编辑'],favorite:true};
  const saved=await confirm(g.draftId,'new',edited);assert.equal(saved.prompt.source,'ai_generated');assert.equal(saved.prompt.body,edited.body);assert.deepEqual(saved.prompt.variables,['门店名称']);assert.equal(saved.prompt.name,edited.name);assert.equal(saved.prompt.favorite,true);
  const versions=await expect(s,`/api/prompts/${saved.prompt.id}/versions`);assert.equal(versions.items.length,1);assert.equal(versions.items[0].changeSource,'ai_generated');
  const retry=await expect(s,`/api/prompt-ai/drafts/${g.draftId}/confirm`,'POST',{requestId:g.draftId,mode:'new',input:edited});assert.equal(retry.prompt.id,saved.prompt.id);assert.equal(retry.reused,true);
  const changed=await request(s,`/api/prompt-ai/drafts/${g.draftId}/confirm`,'POST',{requestId:g.draftId,mode:'new',input:{...edited,body:'不同提交'}});assert.equal(changed.status,409);
  return {id:saved.prompt.id,source:saved.prompt.source,changeSource:versions.items[0].changeSource,retryReused:retry.reused};
 });
 await test('E08-06-weak-complete-supplement-original',async()=>{
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));const body=' 帮我分析一下这个业务流程，看哪里能用AI。\n原文尾部 ';
  o=await expect(s,'/api/prompt-ai/optimize','POST',{body,supplement:'补充负责人访谈，先核实事实'},201);assert.equal(o.originalBody,body);assert.deepEqual(o.checks.map(c=>c.id),dimensions);assert.ok(o.checks.some(c=>c.status==='missing'));assert.ok(o.improvements.length>0);
  const done=await expect(s,'/api/prompt-ai/optimize','POST',{body:'完整九维：角色、目标、背景、输入、步骤、约束、输出、事实推断、防虚构'},201);assert.ok(done.checks.every(c=>c.status==='present'));assert.equal(done.improvements.length,0);assert.ok(!('score' in done));
  const more=await expect(s,'/api/prompt-ai/optimize','POST',{body,supplement:'第二次补充：输出异常表'},201);assert.ok(more.preview.body.includes('第二次补充'));assert.equal(providerUser(h.requests.at(-1).input).supplement,'第二次补充：输出异常表');await unchanged(before);
  return {weakMissing:o.checks.filter(c=>c.status==='missing').map(c=>c.id),completeImprovements:done.improvements.length,originalPreserved:true};
 });
 await test('E08-07-optimize-new-source',async()=>{
  const r=await confirm(o.draftId,'new',{...o.preview,name:'B08优化新资产'});assert.equal(r.prompt.source,'optimized');const v=await expect(s,`/api/prompts/${r.prompt.id}/versions`);assert.equal(v.items[0].changeSource,'ai_optimized');return {id:r.prompt.id,source:r.prompt.source};
 });
 await test('E08-07-08-target-new-version-concurrent-idempotent',async()=>{
  const d=await expect(s,'/api/prompt-ai/optimize','POST',{body:manual.prompt.body,targetPromptId:manual.prompt.id,baseVersion:1},201);
  const payload={requestId:d.draftId,mode:'version',input:{...d.preview,name:manual.prompt.name,body:' AI优化第二版\n{{客户名称}}\n保留事实约束 ',relatedWikiIds:[w1.id]}};
  const rs=await Promise.all([request(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',payload),request(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',payload)]);assert.ok(rs.every(r=>[200,201].includes(r.status)));
  const v=await expect(s,`/api/prompts/${manual.prompt.id}/versions`);assert.equal(v.items.length,2);assert.equal(v.items[0].snapshot.body,manual.prompt.body);assert.equal(v.items[1].changeSource,'ai_optimized');assert.equal(v.items[1].snapshot.source,'manual');return {statuses:rs.map(r=>r.status),versions:v.items.map(v=>({version:v.version,changeSource:v.changeSource}))};
 });
 await test('E08-08-stale-optimization-no-write',async()=>{
  const current=(await expect(s,`/api/prompts/${manual.prompt.id}`)).prompt;
  const d=await expect(s,'/api/prompt-ai/optimize','POST',{body:current.body,targetPromptId:current.id,baseVersion:current.version},201);
  const keys=['name','category','scenario','body','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'];const edited=Object.fromEntries(keys.map(k=>[k,current[k]]));edited.scenario='另一窗口已经修改';
  await expect(s,`/api/prompts/${current.id}`,'PUT',{...edited,baseVersion:current.version});const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));
  const r=await request(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',{requestId:d.draftId,mode:'version',input:d.preview});assert.equal(r.status,409);await unchanged(before);return {status:r.status,error:r.json.error};
 });
 await test('E08-08-real-prompt-rename-failure-retry',async()=>{
  const d=await expect(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[]},201);const payload={requestId:d.draftId,mode:'new',input:d.preview};const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));
  await fs.writeFile(path.join(h.dataRoot,'.b08-fault.json'),JSON.stringify({method:'rename',match:`/prompts/${d.draftId}.json`}));
  const bad=await request(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',payload);assert.equal(bad.status,500);const observed=JSON.parse(await fs.readFile(path.join(h.dataRoot,'.b08-fault-observed.json'),'utf8'));await unchanged(before);
  await fs.rm(path.join(h.dataRoot,'.b08-fault.json'));const good=await expect(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',payload,201);const v=await expect(s,`/api/prompts/${good.prompt.id}/versions`);assert.equal(v.items.length,1);return {failure:bad.json,observed,retryId:good.prompt.id};
 });
 await test('E08-08-partial-confirmation-restart-recovery',async()=>{
  const d=await expect(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[]},201);
  const payload={requestId:d.draftId,mode:'new',input:d.preview};
  await fs.writeFile(path.join(h.dataRoot,'.b08-fault.json'),JSON.stringify({method:'rename',match:`/drafts/prompts/${d.draftId}.json`}));
  const bad=await request(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',payload);assert.equal(bad.status,500);
  const committed=await expect(s,`/api/prompts/${d.draftId}`);assert.equal(committed.prompt.version,1);
  assert.ok(bad.json.error.details?.promptId===d.draftId||bad.json.error.details?.id===d.draftId,'Partial commit error must identify the committed Prompt');
  assert.ok(bad.json.error.details?.committed===true,'Partial commit must be explicit');
  await fs.rm(path.join(h.dataRoot,'.b08-fault.json'));await h.stop(s);s=await h.start();
  const retry=await request(s,`/api/prompt-ai/drafts/${d.draftId}/confirm`,'POST',payload);assert.ok([200,201].includes(retry.status));assert.equal(retry.json.reused,true);
  const v=await expect(s,`/api/prompts/${d.draftId}/versions`);assert.equal(v.items.length,1);
  return {initialError:bad.json,retryStatus:retry.status,reused:retry.json.reused,versionCount:v.items.length};
 });
 await test('E08-09-provider-error-matrix-no-formal-write',async()=>{
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));const failures=[];
  for(const [name,output] of [['auth',{httpStatus:401}],['rate-limit',{httpStatus:429}],['server',{httpStatus:500}],['disconnect',{disconnect:true}],['invalid-json','not valid json'],['empty',''],['schema',{}],['truncated',{content:brief,finishReason:'length'}]]){
   h.setReply(()=>output);const r=await request(s,'/api/prompt-ai/brief','POST',{task,template:'custom'});assert.ok(r.status>=400,name);assert.ok(r.json.error.code);failures.push({name,status:r.status,error:r.json.error});await unchanged(before);
  }
  h.setReply(reply);return failures;
 });
 await test('E08-09-provider-preview-and-check-validation',async()=>{
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));const rs=[];
  for(const [label,patch] of [['unknown-category',{category:'unknown'}],['oversized-name',{name:'名'.repeat(1001)}],['newline-name',{name:'名称\n换行'}],['oversized-scenario',{scenario:'景'.repeat(30001)}],['oversized-input',{inputRequirements:'入'.repeat(30001)}],['oversized-output',{outputRequirements:'出'.repeat(30001)}],['oversized-examples',{examples:'例'.repeat(50001)}],['oversized-tag',{tags:['签'.repeat(1001)]}],['too-many-tags',{tags:Array.from({length:101},(_,i)=>'tag'+i)}],['empty-body',{body:'  '}],['wrong-wiki',{relatedWikiIds:[w2.id]}],['unknown-field',{score:92}]]){
   h.setReply(()=>({preview:{...input('无效预览','正文'),...patch}}));
   const draftsBefore=await fileSnapshot(path.join(h.dataRoot,'drafts','prompts'));
   const r=await request(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:[]});assert.equal(r.status,502,label+' should reject Provider output before preview success');assert.equal(r.json.error.code,'LLM_SCHEMA_MISMATCH');await unchanged(before);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'drafts','prompts')),draftsBefore);rs.push({label,kind:'generator',status:r.status,error:r.json.error.code});
   const validOpt=reply({messages:[{role:'user',content:JSON.stringify({body:'弱Prompt',supplement:''})}]});h.setReply(()=>({...validOpt,preview:{...validOpt.preview,...patch}}));const o=await request(s,'/api/prompt-ai/optimize','POST',{body:'弱Prompt'});assert.equal(o.status,502,label+' optimization should reject');assert.equal(o.json.error.code,'LLM_SCHEMA_MISMATCH');await unchanged(before);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'drafts','prompts')),draftsBefore);rs.push({label,kind:'optimizer',status:o.status,error:o.json.error.code});
  }
  const valid=reply({messages:[{role:'user',content:JSON.stringify({body:'弱Prompt',supplement:''})}]});
  for(const [label,patch] of [['duplicate-dimension',{checks:valid.checks.map(()=>valid.checks[0])}],['score',{score:92}],['present-improvement',{improvements:[{dimensionId:'goal',issue:'伪缺项',action:'不适用'}]}]]){
   h.setReply(()=>({...valid,...patch}));const r=await request(s,'/api/prompt-ai/optimize','POST',{body:'弱Prompt'});assert.ok(r.status>=400,label);await unchanged(before);rs.push({label,status:r.status,error:r.json.error.code});
  }
  h.setReply(reply);return rs;
 });
 h.setReply(reply);
 await test('E08-09-invalid-input-and-ordinary-source-spoof',async()=>{
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));const rs=[];
  for(const [url,payload] of [['/api/prompt-ai/brief',{task:'',template:'custom'}],['/api/prompt-ai/brief',{task,template:'unknown'}],['/api/prompt-ai/brief',{task:'超'.repeat(10001),template:'custom'}],['/api/prompt-ai/generate',{brief:{...brief,extra:'unknown'},relatedWikiIds:[]}],['/api/prompt-ai/optimize',{body:'',supplement:''}],['/api/prompts',{requestId:crypto.randomUUID(),...input('伪造来源','正文'),source:'ai_generated'}]]){const r=await request(s,url,'POST',payload);assert.ok(r.status>=400);rs.push({url,status:r.status,error:r.json.error.code});}
  await unchanged(before);return rs;
 });
 await test('E08-11-restart-persistence-export-knowledge-isolation',async()=>{
  const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),knowledge);const count=(await expect(s,'/api/prompts')).items.length;
  await h.stop(s);s=await h.start();await unchanged(before);const list=await expect(s,'/api/prompts'),stats=await expect(s,'/api/stats');assert.equal(list.items.length,count);assert.equal(stats.promptCount,count);
  for(const p of list.items){const v=await expect(s,`/api/prompts/${p.id}/versions`);assert.equal(v.items.at(-1).snapshot.body,p.body);const e=await request(s,`/api/prompts/${p.id}/export`);assert.equal(e.status,200);assert.ok(e.text.includes(p.body));}
  return {promptCount:count,stats,wholePromptsUnchanged:true,knowledgeUnchanged:true};
 });
 await test('E08-09-12-no-provider-manual-library',async()=>{
  await h.stop(s);s=await h.start(h.dataRoot,false);const config=await expect(s,'/api/llm/config');assert.equal(config.configured,false);const before=await fileSnapshot(path.join(h.dataRoot,'prompts'));
  const r=await request(s,'/api/prompt-ai/brief','POST',{task,template:'custom'});assert.ok(r.status>=400);assert.equal(r.json.error.code,'LLM_NOT_CONFIGURED');await unchanged(before);
  const saved=await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),...input('无Provider手动测试','无变量原文')},201);const render=await expect(s,`/api/prompts/${saved.prompt.id}/render`,'POST',{baseVersion:1,values:{}});assert.equal(render.body,'无变量原文');assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),knowledge);return {configured:false,aiStatus:r.status,manualId:saved.prompt.id};
 });
}finally{
 await fs.rm(path.join(h.dataRoot,'.b08-fault.json'),{force:true});await h.close();
 const result={result:checks.every(c=>c.result==='PASS')?'PASS':'FAIL',provider:'independent fake; actual Provider success/quality BLOCKED if absent',dataRoot:h.dataRoot,checks,requests:h.requests,closed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)};
 await fs.writeFile(prefix+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,total:checks.length,failed:checks.filter(c=>c.result==='FAIL').map(c=>({id:c.id,message:c.message})),closed:result.closed,dataRoot:h.dataRoot}));
 if(result.result==='FAIL')process.exitCode=1;
}
