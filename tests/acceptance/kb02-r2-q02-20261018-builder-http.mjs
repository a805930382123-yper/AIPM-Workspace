import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createHarness,expect,request,terminal,eventually,rawInput,wikiInput,fileSnapshot,delay} from './kb02-20261015-standards-harness.mjs';
import {coverageDiagnostic} from '../../services/llm/knowledge-atoms.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
const bundle=await loadExtractionRules(path.resolve('rules'));
const [schemaText,rulesText,factsText,planningText]=await Promise.all(['wiki-extract.schema.json','extraction-rules.yaml','kb02-facts.schema.json','kb02-planning.schema.json'].map(name=>fs.readFile(path.join('rules',name),'utf8')));
const previousRevision='kb02-atoms-planning-4',format='locator-v2';
const previousRulesVersion='b04-'+bundle.rules.version+'-'+format+'-'+previousRevision+'-'+createHash('sha256').update([schemaText,rulesText,format,previousRevision,factsText,planningText].join('\n')).digest('hex').slice(0,12);
assert.notEqual(previousRulesVersion,bundle.rulesVersion);
const prefix='docs/reports/KB02-R2-Q02-20261018-builder-',checks=[],started=Date.now();
const parse=w=>{const user=w.messages.find(m=>m.role==='user').content;return {user,planning:user.includes('请对下列全部已验证事实规划知识页'),data:JSON.parse(user.slice(user.lastIndexOf('\n')+1))};};
const good=w=>{const p=parse(w);if(p.planning)return {version:2,document:{title:'虚构铺货率',main_topic:'铺货率'},pages:[{title:'虚构铺货率',type:'metric',category:'metric',factIds:p.data.facts.map(x=>x.id),questionIds:p.data.questions.map(x=>x.id)}]};return {version:2,facts:p.data.filter(x=>x.text.trim()).slice(0,4).map(x=>({atomId:x.id,kind:x.text.includes('旧资料')?'ambiguous':'fact'})),questions:[],sourceNotes:[]};};
const h=await createHarness(good);let s;
const body='目标100家，在售20家，铺货率20%。旧资料是20家及20%。在售30家，铺货率30%。AI尚未上线，仅用于未来分析建议。';
const cpPath=id=>path.join(h.dataRoot,'state','extraction-checkpoints',id+'.json');
const cp=id=>fs.readFile(cpPath(id),'utf8').then(JSON.parse);
const create=title=>expect(s,'/api/raw','POST',rawInput(title,body),201);
const begin=(r,b={})=>request(s,'/api/raw/'+r.id+'/extract','POST',b);
async function fail(r){h.setReply(w=>{const value=good(w);if(parse(w).planning)value.pages[0].factIds.pop();return value;});const b=await begin(r);assert.equal(b.status,202,b.text);const j=await terminal(s,b.json.jobId);assert.equal(j.error.code,'LLM_PLAN_COVERAGE_INVALID');return j;}
async function check(id,fn){try{checks.push({id,result:'PASS',evidence:await fn()});}catch(e){checks.push({id,result:'FAIL',error:e.stack});}console.log(id,checks.at(-1).result);}
try{s=await h.start();
await check('R01-native-HTTP-explicit-replanning-restart-double-resume',async()=>{
 const r=await create('虚构规划恢复'),knowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge')),n=h.requests.length;
 assert.equal((await begin(r,{planningRetry:true})).status,409);assert.equal(h.requests.length,n);
 let j=await fail(r),c=await cp(j.jobId);assert.equal(c.completedChunks.length,1);assert.equal(c.attempts,2);assert.deepEqual(j.error.details,c.lastError.diagnostic);assert.deepEqual(c.lastError.diagnostic.facts.missing,['f-c1-4']);
 const plain=await begin(r);assert.equal(plain.json.jobId,j.jobId);j=await terminal(s,j.jobId);assert.equal(j.status,'failed');assert(!parse(h.requests.at(-1).input).data.coverageFeedback);assert.equal(j.callCount,3);
 await h.stop(s);s=await h.start();const before=h.requests.length;await expect(s,'/api/extraction-jobs/'+j.jobId);assert.equal(h.requests.length,before);
 let release,seen=false;const hold=new Promise(r=>release=r);h.setReply(async w=>{if(parse(w).planning){seen=true;assert.deepEqual(parse(w).data.coverageFeedback,c.lastError.diagnostic);await hold;}return good(w);});
 const replies=await Promise.all([begin(r,{planningRetry:true}),begin(r,{planningRetry:true})]);assert(replies.every(x=>[200,202].includes(x.status)),JSON.stringify(replies));assert(replies.every(x=>x.json.jobId===j.jobId));await eventually(()=>seen,'one planner');assert.equal(h.requests.length,before+1);release();j=await terminal(s,j.jobId);assert.equal(j.status,'completed');assert.equal(j.callCount,4);assert.equal((await cp(j.jobId)).completedChunks.length,1);assert.equal((await begin(r,{planningRetry:true})).status,409);
 const draft=await expect(s,'/api/drafts/'+j.draftId);assert(draft.pages.every(x=>!x.selected));assert(draft.pages.flatMap(x=>x.source_facts).some(x=>x.text==='旧资料是20家及20%。'));assert(!JSON.stringify(draft).includes('目标门店20家'));assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),knowledge);return {jobId:j.jobId,calls:j.callCount,reusedChunks:1,explicitFeedback:true,noFormalWrites:true};
});
await check('R02-diagnostic-current-secret-and-old-pipeline-rejected-with-zero-side-effects',async()=>{
 const r=await create('虚构损坏诊断'),j=await fail(r),c=await cp(j.jobId);c.lastError.diagnostic.facts.unknown=[h.fakeKey];const {integrity,...unsigned}=c;c.integrity=createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');await fs.writeFile(cpPath(j.jobId),JSON.stringify(c));const before=h.requests.length,bytes=await fs.readFile(cpPath(j.jobId));const bad=await begin(r,{planningRetry:true});assert.equal(bad.status,409,bad.text);assert.equal(h.requests.length,before);assert.deepEqual(await fs.readFile(cpPath(j.jobId)),bytes);assert(!bad.text.includes(h.fakeKey));
 const r2=await create('虚构旧规则'),j2=await fail(r2),old=await cp(j2.jobId);old.rulesVersion=previousRulesVersion;assert.equal(old.pipelineVersion,'kb02-2');const {integrity:_,...rest}=old;old.integrity=createHash('sha256').update(JSON.stringify(rest)).digest('hex');await fs.writeFile(cpPath(j2.jobId),JSON.stringify(old));const oldBytes=await fs.readFile(cpPath(j2.jobId)),n=h.requests.length,denied=await begin(r2);assert.equal(denied.status,409,denied.text);assert.equal(denied.json.error.code,'LLM_CHECKPOINT_INCOMPATIBLE');assert.equal(h.requests.length,n);assert.match(denied.json.error.message,/显式重新生成/u);assert.deepEqual(await fs.readFile(cpPath(j2.jobId)),oldBytes);h.setReply(good);const restart=await begin(r2,{restart:true});assert.equal(restart.status,202,restart.text);assert.notEqual(restart.json.jobId,j2.jobId);assert.equal((await terminal(s,restart.json.jobId)).status,'completed');assert.deepEqual(await fs.readFile(cpPath(j2.jobId)),oldBytes);return {secretRejected:true,oldBytesPreserved:true,restartExplicit:true};
});
await check('R03-offline-real-seq39-40-product-coverage-replay',async()=>{
 const rows=(await fs.readFile('docs/reports/KB02-R1-20261015-main-provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse).filter(x=>[39,40].includes(x.sequence)),result=[];assert.equal(rows.length,2);for(const row of rows){const input=parse(row.request).data,output=JSON.parse(row.response.content),diagnostic=coverageDiagnostic(input.facts.map(x=>x.id),input.questions.map(x=>x.id),output.pages);assert.equal(input.facts.length,46);assert.equal(input.questions.length,23);assert.deepEqual(diagnostic.facts.missing,['f-c2-3']);assert.deepEqual(diagnostic.questions.missing,[]);result.push({sequence:row.sequence,legacyInput:true,facts:46,questions:23,diagnostic});}return {noExternalRequests:true,legacyInputOnlyNoCheckpointReuse:true,replay:result};
});
await check('R04-actual-candidate-explicit-update-ID-preview-confirm',async()=>{
 const oldRaw=await expect(s,'/api/raw','POST',rawInput('旧虚构指标','目标100家，在售20家，铺货率20%。'),201),target=await expect(s,'/api/wiki','POST',wikiInput('虚构铺货率',[oldRaw.id],'目标100家，在售20家，铺货率20%。KB02_HUMAN人工备注。'),201);h.setReply(good);const r=await create('新增虚构30%'),start=await begin(r),j=await terminal(s,start.json.jobId);assert.equal(j.status,'completed');const oldDraftPath=path.join(h.dataRoot,'drafts',j.draftId+'.json'),oldDraft=JSON.parse(await fs.readFile(oldDraftPath,'utf8'));oldDraft.rulesVersion=previousRulesVersion+'-kb02-2';await fs.writeFile(oldDraftPath,JSON.stringify(oldDraft));const oldDraftBytes=await fs.readFile(oldDraftPath),resumeCalls=h.requests.length,oldResume=await begin(r);assert.equal(oldResume.status,200,oldResume.text);assert.equal(oldResume.json.jobId,j.jobId);assert.equal(h.requests.length,resumeCalls);assert.deepEqual(await fs.readFile(oldDraftPath),oldDraftBytes);let d=await expect(s,'/api/drafts/'+j.draftId);assert.equal(d.rulesVersion,previousRulesVersion+'-kb02-2');const page=d.pages[0];const candidates=await expect(s,`/api/knowledge/drafts/${d.id}/pages/${page.pageId}/duplicates`);assert(candidates.candidates.some(x=>x.wiki.id===target.id));const decision=await expect(s,`/api/knowledge/drafts/${d.id}/pages/${page.pageId}/decision`,'PATCH',{baseRevision:d.revision,decision:'update',targetWikiId:target.id});d=await expect(s,'/api/drafts/'+d.id);
 h.setReply(w=>{assert(w.messages[0].content.includes('evidenceId'));const input=JSON.parse(w.messages[1].content),e=input.newSource.evidence[0];assert(e.id);return {suggestedAdditions:[{text:'新来源明确在售30家，铺货率30%。',evidenceId:e.id}],conflicts:[{text:'旧来源20%，新来源30%；时点和口径尚待核对，分别保留。',evidenceId:e.id}],agreement:[],inferences:[],openQuestions:['旧20家未说明目标/在售维度，需确认。']};});
 const preview=await expect(s,'/api/knowledge/updates','POST',{draftId:d.id,pageId:page.pageId,targetWikiId:target.id,baseRevision:decision.revision},201);assert.equal((await expect(s,'/api/wiki/'+target.id)).body,target.body);assert(preview.evidence.every(e=>r.body.slice(e.start,e.end)===e.quote));assert(!JSON.stringify(preview.evidence).includes('evidenceId'));const confirmed=await expect(s,'/api/knowledge/workflows/'+preview.id+'/confirm','POST',{baseRevision:preview.revision,idempotencyKey:'kb02-r2-http-confirm'},201),final=await expect(s,'/api/wiki/'+target.id);for(const value of ['20%','30%','KB02_HUMAN'])assert(final.body.includes(value));assert(final.sources.includes(oldRaw.id)&&final.sources.includes(r.id));assert.equal((await request(s,'/api/knowledge/workflows/'+preview.id+'/confirm','POST',{baseRevision:preview.revision,idempotencyKey:'kb02-r2-http-confirm'})).status,200);return {candidate:true,explicitDecision:true,workflow:preview.id,confirmed:confirmed.workflow.status,bothSources:true,humanNotePreserved:true};
});
await check('R05-revision4-original-six-polluted-chunks-409-zero-calls-three-files-then-explicit-restart',async()=>{
 const fixture=JSON.parse(await fs.readFile('tests/acceptance/kb02-r2-q02-20261018-builder-seq62.json','utf8'));
 const r=await expect(s,'/api/raw','POST',rawInput('虚构旧六段检查点',fixture.body),201);
 h.setReply(w=>{
  const p=parse(w);assert(!p.planning);const index=Number(p.data[0].id.match(/^c(\d+)-/)[1])-1;
  if(index===6){assert.deepEqual(p.data,fixture.atoms);return fixture.response;}
  const chunk=fixture.oldCheckpoint.completedChunks[index];assert(chunk);
  return {version:2,facts:chunk.facts.map(({atomId,kind})=>({atomId,kind})),questions:chunk.questions.map(({atomId})=>({atomId})),sourceNotes:chunk.sourceNotes.map(({atomId})=>({atomId}))};
 });
 const start=await begin(r);assert.equal(start.status,202,start.text);const j=await terminal(s,start.json.jobId);
 assert.equal(j.error.code,'LLM_SCHEMA_INVALID');assert.equal(j.error.message,'来源声明与事实/问题分类冲突。');
 const old=await cp(j.jobId);assert.equal(old.completedChunks.length,6);assert.equal(old.completedChunks.flatMap(c=>c.facts).filter(x=>/排版说明|长文验收附录/u.test(x.text)).length,11);
 // Deliberate isolated legacy fixture; no product checkpoint migration occurs.
 old.rulesVersion=fixture.oldCheckpoint.rulesVersion;assert.equal(old.rulesVersion,previousRulesVersion);
 const {integrity,...unsigned}=old;old.integrity=createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');await fs.writeFile(cpPath(j.jobId),JSON.stringify(old));
 const files=[cpPath(j.jobId),path.join(h.dataRoot,'state/extraction-jobs',j.jobId+'.json'),path.join(h.dataRoot,'state/raw-processing',r.id+'.json')];
 const saved=await Promise.all(files.map(f=>fs.readFile(f))),calls=h.requests.length;
 for(let n=0;n<3;n++){const denied=await begin(r);assert.equal(denied.status,409,denied.text);assert.equal(denied.json.error.code,'LLM_CHECKPOINT_INCOMPATIBLE');assert.equal(h.requests.length,calls);assert.deepEqual(await Promise.all(files.map(f=>fs.readFile(f))),saved);}
 let release,seen=false;const hold=new Promise(resolve=>release=resolve);h.setReply(async w=>{seen=true;await hold;return good(w);});
 const restart=await begin(r,{restart:true});assert.equal(restart.status,202,restart.text);assert.notEqual(restart.json.jobId,j.jobId);await eventually(()=>seen,'fresh restart call');
 const fresh=await cp(restart.json.jobId);assert.equal(fresh.completedChunks.length,0);assert.equal(fresh.attempts,1);assert.equal(fresh.rulesVersion,bundle.rulesVersion);assert.equal(h.requests.length-calls,1);
 await expect(s,'/api/extraction-jobs/'+restart.json.jobId+'/cancel','POST',{});release();await terminal(s,restart.json.jobId);assert.deepEqual(await fs.readFile(cpPath(j.jobId)),saved[0]);
 return {legacyValidatedChunks:6,legacyNonbusinessFacts:11,denials:3,providerCallsOnDenials:0,threeFilesUnchanged:true,restartNewJob:true,restartReusedChunks:0,oldCheckpointBytesPreserved:true,scope:'Synthetic localhost replay; restart cancelled after first fresh call, no real classification claim'};
});
}finally{await h.close();const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};await fs.writeFile(prefix+`http-${process.env.KB02_RUN_LABEL??'initial'}.json`,JSON.stringify({at:new Date().toISOString(),scope:'localhost fake actual HTTP plus offline legacy trace replay; no real Provider quality claim',durationMs:Date.now()-started,checks,summary,root:h.dataRoot,calls:h.requests.length,closed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)},null,2));console.log(summary);if(summary.fail)process.exitCode=1;}
