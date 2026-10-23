import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {storageFixture} from './support/kb02-storage-fixture.ts';
import {storageHttp} from './support/kb02-storage-http.ts';
import {approveDraft,approveWorkflow} from './support/human-review.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {WikiCommitService} from '../services/wiki/commits.ts';
import {DraftStore} from '../services/wiki/drafts.ts';
import {KnowledgeWorkflowStore} from '../services/wiki/knowledge-workflows.ts';
import {knowledgePlanCallMinimum} from '../services/llm/knowledge-extraction.ts';
import {runKnowledgePipeline} from '../services/llm/knowledge-extraction.ts';
import {loadExtractionRules} from '../services/llm/rules.ts';
import {chunkText} from '../services/llm/chunk.ts';
import {ExtractionCheckpointStore,type ExtractionCheckpoint} from '../services/llm/checkpoints.ts';

async function candidate(two=true) {
  const f=await storageFixture();f.succeed();const original=f.provider.complete;
  f.provider.complete=async request=>{const result=await original(request);if(two&&request.user.includes('请对下列全部已验证事实规划知识页')){const p=JSON.parse(result.text),first=p.pages[0];assert(first.factUnitIds.length>1);p.pages=[{...first,factUnitIds:first.factUnitIds.slice(0,1),title:'目标门店'},{...first,factUnitIds:first.factUnitIds.slice(1),title:'铺货现状'}];return {...result,text:JSON.stringify(p)};}return result;};
  const job=await f.wait((await f.start()).job.id);assert.equal(job.status,'completed',JSON.stringify(job.error));
  const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();
  return {...f,job,wiki,commits,draft:(await f.drafts.get(job.draftId!))!,input:()=>({draftId:job.draftId!,baseRevision:0,selectedPageIds:[] as string[],idempotencyKey:randomUUID(),operationId:randomUUID(),now:new Date().toISOString()})};
}
test('HUMAN revision13 uses extraction + planning only, original IDs preserved, all pages gate direct formal writes',async()=>{
  const f=await candidate();try{
    let d=f.draft;assert.equal(f.requests.length,2);assert(d.rulesVersion.includes('planning-13'));assert.equal(d.humanReview!.approvals.length,0);
    const cp=(await f.checkpoint(f.job.id))!;assert.deepEqual(d.humanReview!.units.flatMap(u=>u.memberIds).sort(),cp.completedChunks.flatMap(c=>[...c.facts,...c.questions].map(x=>x.id)).sort());
    assert.equal(knowledgePlanCallMinimum({...cp,rulesVersion:'x-kb02-atoms-planning-12-x'}),3);assert.equal(knowledgePlanCallMinimum(cp),2);
    const input={...f.input(),baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId]};
    await assert.rejects(f.wiki.withLock(()=>f.commits.confirm(input)),{code:'HUMAN_REVIEW_INCOMPLETE'});assert.equal((await f.wiki.allRecords()).length,0);
    d=await f.drafts.reviewOperation(d.id,{action:'page',baseRevision:d.revision,pageId:d.pages[0].pageId,reviewContentDigest:f.drafts.contentDigest(d),confirmed:true},{body:f.raw.body,rulesDir:'rules'});
    await assert.rejects(f.wiki.withLock(()=>f.commits.confirm({...input,baseRevision:d.revision})),{code:'HUMAN_REVIEW_INCOMPLETE'});
    await assert.rejects(f.drafts.patch(d.id,{baseRevision:d.revision,humanReview:{approved:true}} as any,{body:f.raw.body,rules:{} as any}),{code:'INVALID_PATCH'});
    d=await approveDraft(f.drafts,d.id,f.raw.body);
    const result=await f.wiki.withLock(()=>f.commits.confirm({...input,baseRevision:d.revision}));assert.equal(result.manifest.status,'completed');assert.equal((await f.wiki.allRecords()).length,2);
    const again=await f.wiki.withLock(()=>f.commits.confirm({...input,baseRevision:d.revision,operationId:randomUUID()}));assert(again.reused);assert.equal((await f.wiki.allRecords()).length,2);
    assert.equal((await f.rawStore.get(f.raw.id))!.body,f.raw.body);
  }finally{await f.clean();}
});
test('HUMAN whole-unit unresolved/move and merge retain immutable records; edits invalidate all, no-op preserves',async()=>{
  const f=await candidate();try{let d=await approveDraft(f.drafts,f.draft.id,f.raw.body);const units=structuredClone(d.humanReview!.units),digest=f.drafts.contentDigest(d),stale=d.revision;
    const unit=d.humanReview!.units[0];d=await f.drafts.reviewOperation(d.id,{action:'move',baseRevision:d.revision,unitIds:[unit.id],pageId:null},{body:f.raw.body,rulesDir:'rules'});
    assert.equal(d.humanReview!.assignments[unit.id],null);assert.equal(d.humanReview!.approvals.length,0);await assert.rejects(f.drafts.assertReviewed(d,f.raw.body),{code:'HUMAN_REVIEW_INCOMPLETE'});
    await assert.rejects(f.drafts.reviewOperation(d.id,{action:'page',baseRevision:stale,pageId:d.pages[0].pageId,reviewContentDigest:digest,confirmed:true},{body:f.raw.body,rulesDir:'rules'}),{code:'DRAFT_REVISION_CONFLICT'});
    d=await f.drafts.reviewOperation(d.id,{action:'move',baseRevision:d.revision,unitIds:[unit.id],pageId:d.pages[1].pageId},{body:f.raw.body,rulesDir:'rules'});
    const bundle=await import('../services/llm/rules.ts').then(m=>m.loadExtractionRules('rules')),rules={types:['metric'],categories:['metric','other'],...bundle.fmcg.enums} as any;
    d=await f.drafts.patch(d.id,{baseRevision:d.revision,deletePageIds:[d.pages[0].pageId]},{body:f.raw.body,rules});assert.equal(d.pages.length,1);assert.deepEqual(d.humanReview!.units,units);
    d=await approveDraft(f.drafts,d.id,f.raw.body);const rev=d.revision;
    d=await f.drafts.patch(d.id,{baseRevision:d.revision,source:structuredClone(d.source),pages:d.pages.map(p=>({pageId:p.pageId,title:p.title,source_facts:p.source_facts,open_questions:p.open_questions}))},{body:f.raw.body,rules});assert.equal(d.revision,rev);assert.equal(d.humanReview!.approvals.length,1);
    await assert.rejects(f.drafts.patch(d.id,{baseRevision:d.revision,pages:[{pageId:d.pages[0].pageId,source_facts:[{text:'伪造',evidenceIds:[]}]}]},{body:f.raw.body,rules}),{code:'SOURCE_RECORD_IMMUTABLE'});
    d=await f.drafts.patch(d.id,{baseRevision:d.revision,pages:[{pageId:d.pages[0].pageId,title:'人工修正主题'}]},{body:f.raw.body,rules});assert.equal(d.humanReview!.approvals.length,0);
    assert.deepEqual((await new DraftStore(f.root).get(d.id))!.humanReview,d.humanReview);
  }finally{await f.clean();}
});
test('HUMAN HTTP strict protocol rejects direct confirm/forgery, page digests and revisions are server bound',async()=>{
  const f=await candidate();const http=await storageHttp(f);try{
    let d=f.draft;let response=await http.request(`/api/drafts/${d.id}/confirm`,{baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:'unreviewed'});assert.equal(response.status,409);
    response=await http.request(`/api/drafts/${d.id}/review/start`,{baseRevision:d.revision,approved:true});assert.equal(response.status,400);
    response=await http.request(`/api/drafts/${d.id}/review/pages/${d.pages[0].pageId}`,{baseRevision:d.revision,reviewContentDigest:'0'.repeat(64),confirmed:true});assert.equal(response.status,409);
    for(const page of d.pages){response=await http.request(`/api/drafts/${d.id}/review/pages/${page.pageId}`,{baseRevision:d.revision,reviewContentDigest:(d as any).reviewContentDigest??f.drafts.contentDigest(d),confirmed:true});assert.equal(response.status,200,JSON.stringify(response.json));d=response.json;}
    response=await http.request(`/api/drafts/${d.id}/confirm`,{baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:'reviewed'});assert.equal(response.status,201);
  }finally{await http.close();await f.clean();}
});

test('HUMAN historical seq204/205 and 207/208 publish only unreviewed candidates, no third semantic request',async()=>{
  const fixtures=JSON.parse(await readFile('docs/reports/KB02-SEMANTIC-AUDIT-20261023-fixtures.json','utf8')).fixtures;
  const traces=(await readFile('docs/reports/KB02-SEMANTIC-AUDIT-20261023-provider-trace.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const bundle=await loadExtractionRules('rules');
  for(const [fixtureId,seq]of [['supplement-original',204],['independent-ai-positive',207]] as const){
    const sample=fixtures.find((f:any)=>f.id===fixtureId),body=sample.body,raw={id:randomUUID(),title:fixtureId,sourceType:'report',sourceName:'隔离历史',tags:[]};
    let cp:ExtractionCheckpoint={version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sample.sha256,pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'fake|historical',chunks:chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString(),integrity:'memory'};
    let calls=0;const result=await runKnowledgePipeline({raw,body,bodySha256:sample.sha256,rulesDir:'rules',checkpoint:cp,provider:{name:'fake',model:'historical',complete:async request=>{assert(!request.user.startsWith('请审核'));const sequence=seq+calls++;const response=traces.find((t:any)=>t.sequence===sequence)!.response;assert(calls<=2);return {text:response.content,bytes:Buffer.byteLength(response.content),finishReason:response.finishReason};}},beforeCall:async stage=>cp={...cp,stage,attempts:cp.attempts+1},saveCheckpoint:async value=>cp={...value,integrity:'memory'}});
    assert.equal(calls,2);assert(result.outcome.reviewBasis);assert(result.outcome.pages.some(p=>p.source_facts.some(f=>f.text.includes('AI'))));
    if(seq===204)assert(result.outcome.pages.some(p=>p.title.startsWith('AI异常提示')),'原错主题保留为未审候选，未被程序静默删去');
  }
});
test('HUMAN original 106400-char long plan keeps all original IDs and indivisible region units without calls',async()=>{
  let body='';for(let n=1;n<=14;n++){const region='虚构区域'+String(n).padStart(2,'0'),header=`【长文验收附录${n}，虚构】\n`,business=`${region}2026年9月有100家目标门店，${n+10}家在售，门店数铺货率${n+10}%。此区域与其它附录区域独立，不能混用。异常审批负责人未知，AI仅未来分析建议。`;let block=header+business+'\n',line=0;while(block.length<7600)block+=`附录${n}排版说明${++line}：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客户身份、AI上线事实或收益。\n`;body+=block.slice(0,7600);}
  const original=JSON.parse(await readFile('docs/reports/KB02-REGION-AUDIT-20261023-long-checkpoint.json','utf8')) as ExtractionCheckpoint,bundle=await loadExtractionRules('rules');assert.equal(body.length,106400);assert.equal(createHash('sha256').update(body).digest('hex'),original.rawSha256);
  let cp={...original,rulesVersion:bundle.rulesVersion};const result=await runKnowledgePipeline({raw:{id:cp.rawId,title:'原长文回放',sourceType:'report',sourceName:'历史',tags:[]},body,bodySha256:cp.rawSha256,checkpoint:cp,rulesDir:'rules',provider:{name:'fake',model:'no-call',complete:async()=>{throw Error('No outbound');}},beforeCall:async()=>{throw Error('No calls');},saveCheckpoint:async value=>cp={...value,integrity:original.integrity}});
  const units=result.outcome.reviewBasis!.units;assert.equal(units.length,55);assert.equal(units.flatMap(u=>u.memberIds).length,101);assert.deepEqual(units.flatMap(u=>u.memberIds).sort(),original.completedChunks.flatMap(c=>[...c.facts,...c.questions].map(r=>r.id)).sort());
  for(const unit of units){assert.equal(body.slice(unit.start,unit.end),unit.text);assert.equal(result.outcome.reviewBasis!.pageUnitIds.flat().filter(id=>id===unit.id).length,1);}
});
for(const mode of ['zero','partial','conflict','reviewed-restart'] as const)test(`HUMAN ${mode} transaction recovery verifies disk, never trusts written IDs, and retains old evidence`,async()=>{
  const f=await candidate();try{let d=await approveDraft(f.drafts,f.draft.id,f.raw.body);const input={...f.input(),baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId]},write=f.wiki.writePageLocked.bind(f.wiki);let calls=0;
    f.wiki.writePageLocked=async record=>{if(++calls===(mode==='zero'?1:2))throw Object.assign(new Error('injected disk stop'),{code:'EIO',syscall:'write'});return write(record);};
    await assert.rejects(f.wiki.withLock(()=>f.commits.confirm(input)));f.wiki.writePageLocked=write;
    const file=path.join(f.root,'state/wiki-commits',input.operationId+'.json'),manifest=JSON.parse(await readFile(file,'utf8'));
    if(mode!=='reviewed-restart'){delete manifest.humanReviewDigest;delete manifest.humanReviewBasisDigest;manifest.status='prepared';manifest.writtenWikiIds=[manifest.snapshot.sourceRecord.id];await writeFile(file,JSON.stringify(manifest));const legacy=(await f.drafts.get(d.id))!;delete legacy.humanReview;await writeFile(path.join(f.root,'drafts',d.id+'.json'),JSON.stringify(legacy));}
    if(mode==='conflict')await write({...manifest.snapshot.sourceRecord,body:'外部修改，禁止覆盖'});
    const result=await f.commits.reconcile();
    if(mode==='zero'){
      assert.equal(result.resumed.length,0);assert(result.conflicts.some(c=>c.code==='HUMAN_REVIEW_REQUIRED'));assert.equal((await f.wiki.allRecords()).length,0);d=await approveDraft(f.drafts,d.id,f.raw.body);const next={...f.input(),baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId]};const completed=await f.wiki.withLock(()=>f.commits.confirm(next));assert.equal(completed.manifest.status,'completed');assert.equal(JSON.parse(await readFile(file,'utf8')).supersededBy,next.operationId);
    }else if(mode==='conflict'){assert.equal(result.resumed.length,0);assert(result.conflicts.some(c=>c.code==='COMMIT_TARGET_CONFLICT'));assert.equal((await f.wiki.allRecords()).length,1);}
    else{assert.equal(result.resumed.length,1);assert.equal((await f.wiki.allRecords()).length,2);if(mode==='partial')assert.equal(result.resumed[0].legacyRecovery,'verified_partial');}
    assert.equal(f.requests.length,2);
  }finally{await f.clean();}
});
test('HUMAN legacy explicit migration uses real cp IDs, GET does not write and fallback preserves duplicate/no-location entries',async()=>{
  const f=await candidate();try{
    const file=path.join(f.root,'drafts',f.draft.id+'.json'),old=structuredClone(f.draft);delete old.humanReview;await writeFile(file,JSON.stringify(old));const before=await readFile(file);assert(!(await f.drafts.get(old.id))!.humanReview);assert.deepEqual(await readFile(file),before);
    let d=await f.drafts.reviewOperation(old.id,{action:'start',baseRevision:old.revision},{body:f.raw.body,rulesDir:'rules'});assert(d.humanReview!.units.every(u=>u.origin==='kb02'));assert.equal(f.requests.length,2);
    delete d.humanReview;d.pages[0].source_facts.push(structuredClone(d.pages[0].source_facts[0]));d.pages[0].open_questions=['旧问题无法定位','旧问题无法定位'];await writeFile(file,JSON.stringify(d));
    d=await f.drafts.reviewOperation(d.id,{action:'start',baseRevision:d.revision},{body:f.raw.body,rulesDir:'rules'});assert(d.humanReview!.units.every(u=>u.origin==='legacy'));
    const qs=d.humanReview!.units.filter(u=>u.kind==='question');assert.equal(qs.length,2);assert.notEqual(qs[0].id,qs[1].id);assert(qs.every(q=>q.evidence.length===0&&q.memberIds.length===0));
  }finally{await f.clean();}
});
test('HUMAN update requires all input pages before any call; output needs new review and input revocation invalidates',async()=>{
  const f=await candidate();try{
    const target=await f.wiki.create({title:'既有指标',type:'metric',category:'metric',sources:[f.raw.id],body:'人工既有内容',tags:[],aliases:[],knowledge_status:'source_supported',confidence:'medium',source_level:'C',review_status:'reviewed'} as any);
    const service=new KnowledgeWorkflowStore(f.root,f.wiki,f.rawStore);await service.initialize();let calls=0;
    const provider={name:'fake',model:'update',complete:async()=>{calls++;return {text:JSON.stringify({suggestedAdditions:[],conflicts:[],inferences:['人工需复核'],openQuestions:[],agreement:[]}),bytes:1,finishReason:'stop'};}};
    let d=f.draft;let args={draftId:d.id,pageId:d.pages[0].pageId,baseRevision:d.revision,targetWikiId:target.id,draft:d,raw:f.raw,target,provider};
    await assert.rejects(service.createUpdate(args),{code:'HUMAN_REVIEW_INCOMPLETE'});assert.equal(calls,0);
    d=await approveDraft(f.drafts,d.id,f.raw.body);args={...args,baseRevision:d.revision,draft:d};let w=await service.createUpdate(args);assert.equal(calls,1);assert.equal(w.humanReview!.approvals.length,0);
    await assert.rejects(f.wiki.withLock(()=>service.confirm(w.id,w.revision,'unreviewed')),{code:'HUMAN_REVIEW_INCOMPLETE'});
    w=await approveWorkflow(service,w.id);d=await f.drafts.reviewOperation(d.id,{action:'page',baseRevision:d.revision,pageId:d.pages[1].pageId,reviewContentDigest:f.drafts.contentDigest(d),confirmed:false},{body:f.raw.body,rulesDir:'rules'});
    await assert.rejects(f.wiki.withLock(()=>service.confirm(w.id,w.revision,'stale')),(e:any)=>['HUMAN_REVIEW_INCOMPLETE','INPUT_REVIEW_CHANGED'].includes(e.code));assert.equal((await f.wiki.get(target.id))!.body,'人工既有内容');
  }finally{await f.clean();}
});
test('HUMAN synthesis proposals have separate immutable snapshots; corrected prose is human organized, unresolved blocks',async()=>{
  const f=await candidate(false);try{const second=await f.rawStore.create({title:'第二来源',sourceType:'report',sourceName:'虚构',tags:[],body:'门店增长12%。'}),service=new KnowledgeWorkflowStore(f.root,f.wiki,f.rawStore);await service.initialize();
    const provider={name:'fake',model:'synthesis',complete:async()=>({text:JSON.stringify({title:'综合候选',category:'metric',suggestedAdditions:[],conflicts:[],inferences:['模型原推断'],openQuestions:['待确认'],agreement:[]}),bytes:1,finishReason:'stop'})};
    let w=await service.createSynthesis({rawIds:[f.raw.id,second.id],provider});const snapshot=structuredClone(w.humanReview!.units);
    w=await service.patch(w.id,w.revision,{...w.sections,inferences:['人工修正说明']});assert.deepEqual(w.humanReview!.units,snapshot);assert(w.humanEditedSections!.includes('inferences'));
    w=await service.reviewOperation(w.id,{action:'move',baseRevision:w.revision,unitIds:[snapshot[0].id],pageId:null});w=await approveWorkflow(service,w.id);await assert.rejects(f.wiki.withLock(()=>service.confirm(w.id,w.revision,'unresolved')),{code:'HUMAN_REVIEW_INCOMPLETE'});
    w=await service.reviewOperation(w.id,{action:'move',baseRevision:w.revision,unitIds:[snapshot[0].id],pageId:w.id});w=await approveWorkflow(service,w.id);
    const result=await f.wiki.withLock(()=>service.confirm(w.id,w.revision,'done'));assert.equal(result.workflow.status,'confirmed');assert((await f.wiki.get(result.wikiId))!.body.includes('人工修正说明'));
  }finally{await f.clean();}
});
for(const mode of ['zero','partial','conflict'] as const)test(`HUMAN synthesis ${mode} legacy transaction recovery requires real disk evidence and remains reviewable`,async()=>{
 const f=await candidate(false);try{
  const second=await f.rawStore.create({title:'第二事务来源',sourceType:'report',sourceName:'虚构',tags:[],body:'门店120家。'}),service=new KnowledgeWorkflowStore(f.root,f.wiki,f.rawStore);await service.initialize();
  let w=await service.createSynthesis({rawIds:[f.raw.id,second.id],provider:{name:'fake',model:'legacy',complete:async()=>({text:JSON.stringify({title:'旧综合事务',category:'metric',suggestedAdditions:[],conflicts:[],agreement:[],inferences:['原始推断'],openQuestions:[]}),bytes:1,finishReason:'stop'})}});w=await approveWorkflow(service,w.id);
  const write=f.wiki.writePageLocked.bind(f.wiki);let calls=0;f.wiki.writePageLocked=async record=>{if(++calls===(mode==='zero'?1:2))throw Error('legacy workflow disk stop');return write(record);};
  await assert.rejects(f.wiki.withLock(()=>service.confirm(w.id,w.revision,'first')),{code:'WORKFLOW_COMMIT_PENDING'});f.wiki.writePageLocked=write;
  const saved=(await service.get(w.id))!,operation=(await import('node:fs/promises')).readdir;const names=await operation(path.join(f.root,'state/knowledge-commits'));assert.equal(names.length,1);const file=path.join(f.root,'state/knowledge-commits',names[0]),manifest=JSON.parse(await readFile(file,'utf8'));delete manifest.humanReviewDigest;delete manifest.humanReviewBasisDigest;manifest.status='prepared';manifest.writtenIds=manifest.records.map((r:any)=>r.id);await writeFile(file,JSON.stringify(manifest));delete saved.humanReview;await writeFile(path.join(f.root,'drafts/knowledge-workflows',w.id+'.json'),JSON.stringify(saved));
  if(mode==='conflict')await write({...manifest.records[0],body:'事务目标被人工修改'});
  const reboot=new KnowledgeWorkflowStore(f.root,f.wiki,f.rawStore);await reboot.initialize();
  if(mode==='zero'){
    assert.equal((await f.wiki.allRecords()).length,0);assert.equal((await reboot.get(w.id))!.status,'pending_confirmation');
    w=await approveWorkflow(reboot,w.id);const result=await f.wiki.withLock(()=>reboot.confirm(w.id,w.revision,'after-human'));assert.equal(result.workflow.status,'confirmed');assert.equal(JSON.parse(await readFile(file,'utf8')).supersededBy,result.workflow.commitOperationId);
  }else if(mode==='partial'){assert.equal((await reboot.get(w.id))!.status,'confirmed');assert.equal((await reboot.getCommit(manifest.operationId))!.legacyRecovery,'verified_partial');assert.equal((await f.wiki.allRecords()).length,3);}
  else{assert.equal((await f.wiki.allRecords()).length,1);assert.notEqual((await reboot.get(w.id))!.status,'confirmed');assert.equal((await f.wiki.get(manifest.records[0].id))!.body,'事务目标被人工修改');}
 }finally{await f.clean();}
});
for(const count of [2,3])test(`HUMAN completed revision12 actual storage reconciliation enforces chunks+2 lower bound (${count} attempts)`,async()=>{
 const f=await candidate(false);try{const cp=(await f.checkpoint(f.job.id))!,oldRules=cp.rulesVersion.replace('planning-13-','planning-12-'),draft=structuredClone(f.draft);draft.rulesVersion=oldRules+'-kb02-2';draft.extraction.callCount=count;await writeFile(path.join(f.root,'drafts',draft.id+'.json'),JSON.stringify(draft));await new ExtractionCheckpointStore(f.root).save({...cp,rulesVersion:oldRules,attempts:count,stage:'assembling'});await f.jobs.update(f.job.id,{status:'running',stage:'assembling',callCount:count});const calls=f.requests.length,reboot=f.newRunner();await reboot.reconcile();const result=await reboot.readJob(f.job.id);if(count===2){assert.notEqual(result.job?.status,'completed');assert(result.recovery);}else{assert.equal(result.job?.status,'completed');assert.equal(result.recovery,undefined);}assert.equal(f.requests.length,calls);assert.equal((await f.checkpoint(f.job.id))!.attempts,count);
 }finally{await f.clean();}
});
test('HUMAN legacy merge retains same text at different positions and colliding evidence IDs; deleting an occupied page keeps units unresolved',async()=>{
 const f=await candidate();try{const d=structuredClone(f.draft);delete d.humanReview;const texts=['目标100家','在售20家'];d.pages.forEach((p,i)=>{const quote=texts[i],start=f.raw.body.indexOf(quote);assert(start>=0);p.source_facts=[{text:'旧相同表述',evidenceIds:['e1']}];p.source_evidence=[{id:'e1',rawId:f.raw.id,quote,start,end:start+quote.length,chunkIndex:0}];p.open_questions=['同字问题无定位'];});await writeFile(path.join(f.root,'drafts',d.id+'.json'),JSON.stringify(d));let reviewed=await f.drafts.reviewOperation(d.id,{action:'start',baseRevision:d.revision},{body:f.raw.body,rulesDir:'rules'});const original=structuredClone(reviewed.humanReview!.units),bundle=await loadExtractionRules('rules'),rules={types:['metric'],categories:['metric'],...bundle.fmcg.enums} as any;
   reviewed=await f.drafts.patch(d.id,{baseRevision:reviewed.revision,merge:{pageIds:reviewed.pages.map(p=>p.pageId)}},{body:f.raw.body,rules});assert.equal(reviewed.pages[0].source_facts.length,2);assert.equal(reviewed.pages[0].open_questions.length,2);assert.equal(reviewed.pages[0].source_evidence.length,2);assert.equal(new Set(reviewed.pages[0].source_evidence.map(e=>e.id)).size,2);assert.deepEqual(reviewed.humanReview!.units,original);for(const fact of reviewed.pages[0].source_facts)for(const id of fact.evidenceIds)assert(reviewed.pages[0].source_evidence.some(e=>e.id===id));
 }finally{await f.clean();}
 const other=await candidate();try{const d=other.draft,bundle=await loadExtractionRules('rules'),rules={types:['metric'],categories:['metric'],...bundle.fmcg.enums} as any;const removed=d.pages[0].pageId,ids=Object.entries(d.humanReview!.assignments).filter(([,owner])=>owner===removed).map(([id])=>id),next=await other.drafts.patch(d.id,{baseRevision:d.revision,deletePageIds:[removed]},{body:other.raw.body,rules});assert(ids.length);assert(ids.every(id=>next.humanReview!.assignments[id]===null));assert.deepEqual(next.humanReview!.units,d.humanReview!.units);await assert.rejects(other.drafts.assertReviewed(next,other.raw.body),{code:'HUMAN_REVIEW_INCOMPLETE'});
 }finally{await other.clean();}
});
test('HUMAN legitimate old standalone update migrates explicit snapshots; new missing input binding and damaged legacy source cannot downgrade',async()=>{
 const f=await candidate(false);try{const target=await f.wiki.create({title:'旧独立更新目标',type:'metric',category:'metric',sources:[f.raw.id],tags:[],aliases:[],knowledge_status:'source_supported',confidence:'medium',source_level:'C',review_status:'reviewed',body:'原有人工内容'}),service=new KnowledgeWorkflowStore(f.root,f.wiki,f.rawStore);await service.initialize();const d=await approveDraft(f.drafts,f.draft.id,f.raw.body),provider={name:'fake',model:'legacy-standalone',complete:async()=>({text:JSON.stringify({suggestedAdditions:[],conflicts:[],agreement:[],inferences:['旧提议需人工核对'],openQuestions:[]}),bytes:1,finishReason:'stop'})};
  const create=()=>service.createUpdate({draftId:d.id,pageId:d.pages[0].pageId,baseRevision:d.revision,targetWikiId:target.id,draft:d,raw:f.raw,target,provider});
  const modern=await create();delete modern.inputDraft;delete modern.humanReview;await service.save(modern);await assert.rejects(service.reviewOperation(modern.id,{action:'start',baseRevision:modern.revision}),{code:'INPUT_REVIEW_REQUIRED'});
  const damaged=await create();delete damaged.inputDraft;delete damaged.humanReview;delete damaged.reviewProtocolVersion;damaged.rawSnapshots[0].bodySha256='0'.repeat(64);await service.save(damaged);await assert.rejects(service.reviewOperation(damaged.id,{action:'start',baseRevision:damaged.revision}),{code:'RAW_CHANGED'});
  const legacy=await create();delete legacy.inputDraft;delete legacy.humanReview;delete legacy.reviewProtocolVersion;await service.save(legacy);const started=await service.reviewOperation(legacy.id,{action:'start',baseRevision:legacy.revision});assert(started.legacyStandaloneInput);assert.equal(started.reviewProtocolVersion,1);assert(!started.inputDraft);assert(started.humanReview!.units.every(u=>u.origin==='model'&&u.memberIds.length===0));const reviewed=await approveWorkflow(service,legacy.id),result=await f.wiki.withLock(()=>service.confirm(legacy.id,reviewed.revision,'legacy-explicit'));assert.equal(result.workflow.status,'confirmed');assert((await f.wiki.get(target.id))!.body.startsWith('原有人工内容'));assert.equal(f.requests.length,2);
 }finally{await f.clean();}
});
