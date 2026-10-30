import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chunkText } from '../services/llm/chunk.ts';
import { buildKnowledgeAtoms } from '../services/llm/knowledge-atoms.ts';
import { buildKnowledgePlanningInput, type KnowledgePlanningInput, type KnowledgeWirePlan } from '../services/llm/knowledge-planning.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { reviewKnowledgePlan } from '../services/llm/knowledge-semantic-review.ts';
import { runKnowledgePipeline } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules, KB02_PROMPT_REVISION } from '../services/llm/rules.ts';
import { LlmError, type LlmCompletionRequest, type LlmCompletion, type LlmProvider } from '../services/llm/provider.ts';
import { ExtractionCheckpointStore, type CheckpointChunk, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { semanticReviewReply } from './support/semantic-review.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { approveDraft } from './support/human-review.ts';

const payload=(r:LlmCompletionRequest)=>JSON.parse(r.user.split('\n').at(-1)!);
const isReview=(r:LlmCompletionRequest)=>r.user.startsWith('请审核下列完整候选知识规划');
const reply=(value:unknown):LlmCompletion=>({text:JSON.stringify(value),bytes:1,finishReason:'stop'});
type Review={version:number;pages:Array<{pageIndex:number;decision:string;code:string;unitIds:string[];reason:string}>};

// Independent module fixture: no fabricated third production stage or draft approval.
// Use the actual locator/atom/planning projection with exact source positions.
async function fixture(body='岚河渠道门店20家。异常审批负责人未知。') {
  const bundle=await loadExtractionRules('rules');
  const chunks=chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000});
  const catalogs=new Map(chunks.map(c=>[c.index,buildEvidenceLocatorCatalog(body,c)]));
  const blocks:CheckpointChunk[]=chunks.map(c=>{
    const atoms=buildKnowledgeAtoms(body,catalogs.get(c.index)!);
    return {...c,facts:atoms.map((a,i)=>({id:'f-c'+(c.index+1)+'-'+(i+1),text:a.text,atomId:a.id,kind:a.fragment?'ambiguous' as const:'fact' as const,locatorIds:a.locatorIds,chunkIndex:c.index})),questions:atoms.filter(a=>a.text.includes('负责人未知')).map((a,i)=>({id:'q-c'+(c.index+1)+'-'+(i+1),text:a.text,atomId:a.id,locatorIds:a.locatorIds,chunkIndex:c.index})),evidence:[]};
  });
  let input=buildKnowledgePlanningInput(body,blocks,catalogs);
  let plan:KnowledgeWirePlan={version:3,document:{title:'隔离语义审核',main_topic:'渠道经营',source_level:'D'},pages:[{title:'岚河渠道经营',type:'concept',category:'channel',factUnitIds:input.factUnits.map(u=>u.id),questionUnitIds:input.questionUnits.map(u=>u.id)}]};
  const requests:LlmCompletionRequest[]=[];
  let attempts=0,deadline=Date.now()+600_000;
  let audit:(r:LlmCompletionRequest)=>Promise<LlmCompletion>|LlmCompletion=r=>semanticReviewReply(r)!;
  let beforeHook:(()=>void|Promise<void>)|undefined;
  const provider:LlmProvider={name:'fake',model:'semantic',secrets:['semantic-isolated-secret'],complete:async r=>{requests.push(r);return audit(r);}};
  const run=(signal?:AbortSignal)=>reviewKnowledgePlan({input,plan,schema:bundle.kb02SemanticReviewSchema,provider,signal,deadline,
    guard:()=>{if(signal?.aborted)throw new LlmError('LLM_CANCELLED','cancelled',409);if(Date.now()>=deadline)throw new LlmError('LLM_DEADLINE_EXCEEDED','deadline',504);},
    beforeCall:async()=>{await beforeHook?.();attempts++;}});
  return {requests,run,get input(){return input;},get plan(){return plan;},get attempts(){return attempts;},candidate:(value:KnowledgeWirePlan)=>{plan=value;},source:(value:KnowledgePlanningInput)=>{input=value;},audit:(f:typeof audit)=>{audit=f;},before:(f?:typeof beforeHook)=>{beforeHook=f;},deadline:(value:number)=>{deadline=value;}};
}

test('SEMANTIC original seq202 reject/uncertain reviews exact source/units and retains immutable input',async()=>{
  const evidence=JSON.parse(await readFile('docs/reports/KB02-SUPPLEMENT-DIAG-20261023-source-evidence.json','utf8'));
  for(const decision of ['reject','uncertain']) {
    const f=await fixture(evidence.raw.body);f.source(structuredClone(evidence.actualInput));f.candidate(structuredClone(evidence.actualPlan));
    const before=JSON.stringify({input:f.input,plan:f.plan});
    f.audit(r=>{const p=payload(r);assert.deepEqual(p.input,evidence.actualInput);assert.deepEqual(p.plan,evidence.actualPlan);return reply({version:1,pages:p.plan.pages.map((page:{factUnitIds:string[]},pageIndex:number)=>({pageIndex,decision:pageIndex===p.plan.pages.length-1?decision:'pass',code:pageIndex===p.plan.pages.length-1?(decision==='reject'?'UNSUPPORTED_TOPIC':'INSUFFICIENT_EVIDENCE'):'OK',unitIds:page.factUnitIds,reason:'仅未来边界缺独立定义；受控fake不证明真实语义质量。'}))});});
    await assert.rejects(f.run(),{code:decision==='reject'?'LLM_PLAN_SEMANTIC_REJECTED':'LLM_PLAN_SEMANTIC_UNCERTAIN'});
    assert.equal(f.requests.length,1);assert.equal(f.attempts,1);assert.equal(JSON.stringify({input:f.input,plan:f.plan}),before);
    const next=structuredClone(f.plan);next.pages[0].factUnitIds.push(...next.pages.pop()!.factUnitIds);f.candidate(next);f.audit(r=>semanticReviewReply(r)!);
    assert.equal(await f.run(),undefined);assert.equal(f.requests.length,2);assert.equal(f.attempts,2);
    assert.deepEqual(f.plan.pages.flatMap(p=>p.factUnitIds).sort(),f.input.factUnits.map(u=>u.id).sort());
  }
});

for(const [name,mutate] of Object.entries({
  reject:(v:Review)=>{v.pages[0].decision='reject';v.pages[0].code='BOUNDARY_ATTRIBUTION';},
  uncertain:(v:Review)=>{v.pages[0].decision='uncertain';v.pages[0].code='INSUFFICIENT_EVIDENCE';},
  missing:(v:Review)=>{v.pages=[];},duplicate:(v:Review)=>{v.pages.push(v.pages[0]);},
  unknownPage:(v:Review)=>{v.pages[0].pageIndex=1;},unknownUnit:(v:Review)=>{v.pages[0].unitIds=['fu-unknown'];},
  duplicateUnit:(v:Review)=>{v.pages[0].unitIds.push(v.pages[0].unitIds[0]);},
  conflictingPass:(v:Review)=>{v.pages[0].code='UNSUPPORTED_TOPIC';},conflictingReject:(v:Review)=>{v.pages[0].decision='reject';},
  extraTop:(v:Review)=>{Object.assign(v,{debug:'untrusted-provider-text'});},extraPage:(v:Review)=>{Object.assign(v.pages[0],{debug:'untrusted-provider-text'});},
  secret:(v:Review)=>{v.pages[0].reason='semantic-isolated-secret';},emptyReason:(v:Review)=>{v.pages[0].reason=' ';},
  longReason:(v:Review)=>{v.pages[0].reason='x'.repeat(501);},badVersion:(v:Review)=>{v.version=2;},
  questionOnly:(v:Review)=>{v.pages[0].unitIds=['qu-10-21'];},
}))test('SEMANTIC direct review rejects '+name+' without changing candidate or exposing payload',async()=>{
  const f=await fixture(),before=JSON.stringify({input:f.input,plan:f.plan});
  f.audit(r=>{const v=JSON.parse(semanticReviewReply(r)!.text) as Review;mutate(v);return reply(v);});
  const code=name==='reject'?'LLM_PLAN_SEMANTIC_REJECTED':name==='uncertain'?'LLM_PLAN_SEMANTIC_UNCERTAIN':name==='secret'?'LLM_OUTPUT_CONTAINS_SECRET':'LLM_SCHEMA_INVALID';
  await assert.rejects(f.run(),(e:unknown)=>e instanceof LlmError&&e.code===code&&!JSON.stringify(e).includes('untrusted-provider-text')&&!JSON.stringify(e).includes('semantic-isolated-secret'));
  assert.equal(f.attempts,1);assert.equal(f.requests.length,1);assert.equal(JSON.stringify({input:f.input,plan:f.plan}),before);
});

for(const [name,result,code] of [
  ['malformed',{text:'{"reason":"arbitrary-failure-payload"',bytes:1,finishReason:'stop'},'LLM_INVALID_JSON'],
  ['length',{text:'{}',bytes:2,finishReason:'length'},'LLM_OUTPUT_TRUNCATED'],
  ['oversize',{text:'x'.repeat(2*1024*1024+1),bytes:1,finishReason:'stop'},'LLM_RESPONSE_TOO_LARGE'],
] as const)test('SEMANTIC direct '+name+' fails closed without raw failure details',async()=>{
  const f=await fixture(),before=JSON.stringify(f.plan);f.audit(()=>result);
  await assert.rejects(f.run(),(e:unknown)=>e instanceof LlmError&&e.code===code&&!JSON.stringify(e).includes('arbitrary-failure-payload'));
  assert.equal(JSON.stringify(f.plan),before);assert.equal(f.attempts,1);
});

test('SEMANTIC schema fingerprint changes; production rejects old revision and undercount before calls or writes',async()=>{
  const f=await storageFixture();try{
    f.succeed();const job=await f.wait((await f.start()).job.id),valid=(await f.checkpoint(job.id))!;assert.equal(KB02_PROMPT_REVISION,'kb02-atoms-planning-17');
    const calls=f.requests.length,hashes=await f.hashes(job.id);
    const run=(checkpoint:typeof valid)=>runKnowledgePipeline({raw:f.raw,body:f.raw.body,bodySha256:valid.rawSha256,provider:f.provider,rulesDir:'rules',checkpoint,beforeCall:async()=>{assert.fail('invalid checkpoint must not account');},saveCheckpoint:async()=>{assert.fail('invalid checkpoint must not write');}});
    await assert.rejects(run({...valid,attempts:valid.completedChunks.length}),{code:'LLM_CHECKPOINT_CORRUPT'});
    await assert.rejects(run({...valid,plan:undefined,rulesVersion:valid.rulesVersion.replace(KB02_PROMPT_REVISION,'kb02-atoms-planning-12')}),{code:'LLM_CHECKPOINT_INCOMPATIBLE',status:409});
    assert.equal(f.requests.length,calls);assert.deepEqual(await f.hashes(job.id),hashes);
    const dir=await mkdtemp(path.join(os.tmpdir(),'semantic-rules-'));try{await cp('rules',dir,{recursive:true});const file=path.join(dir,'kb02-semantic-review.schema.json');await writeFile(file,(await readFile(file,'utf8'))+'\n');assert.notEqual((await loadExtractionRules(dir)).rulesVersion,valid.rulesVersion);}finally{await rm(dir,{recursive:true,force:true});}
  }finally{await f.clean();}
});

test('SEMANTIC pre-call accounting failure stops direct review; explicit retry returns no reusable approval',async()=>{
  const f=await fixture(),before=JSON.stringify(f.plan);f.before(()=>{throw new LlmError('STORAGE_WRITE_FAILED','ledger failure',503);});
  await assert.rejects(f.run(),{code:'STORAGE_WRITE_FAILED'});assert.equal(f.requests.length,0);assert.equal(f.attempts,0);
  f.before();assert.equal(await f.run(),undefined);assert.equal(f.attempts,1);assert.equal(f.requests.length,1);assert.equal(JSON.stringify(f.plan),before);
});

test('SEMANTIC cancellation while review waits rejects immediately and ignores late pass',async()=>{
  const f=await fixture(),controller=new AbortController(),before=JSON.stringify(f.plan);let release!:(v:LlmCompletion)=>void,entered!:()=>void;
  const atReview=new Promise<void>(r=>{entered=r;});f.audit(()=>{entered();return new Promise<LlmCompletion>(r=>{release=r;});});
  const run=f.run(controller.signal);await atReview;controller.abort();await assert.rejects(run,{code:'LLM_CANCELLED'});assert(f.requests[0].signal?.aborted);
  release(semanticReviewReply(f.requests[0])!);await Promise.resolve();assert.equal(JSON.stringify(f.plan),before);assert.equal(f.attempts,1);assert.equal(f.requests.length,1);
});

test('SEMANTIC actual 60s timer bounds ignoring provider and discards late success',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();let release!:(v:LlmCompletion)=>void,entered!:()=>void;
  const atReview=new Promise<void>(r=>{entered=r;});f.audit(()=>{entered();return new Promise<LlmCompletion>(r=>{release=r;});});
  const run=f.run();await atReview;assert.equal(f.requests[0].timeoutMs,60_000);t.mock.timers.tick(60_000);await assert.rejects(run,{code:'LLM_TIMEOUT'});assert(f.requests[0].signal?.aborted);
  release(semanticReviewReply(f.requests[0])!);await Promise.resolve();assert.equal(f.attempts,1);
});

test('SEMANTIC total deadline after review cannot pass; cancellation during accounting cannot call provider',async()=>{
  const f=await fixture(),now=Date.now;try{f.audit(r=>{const result=semanticReviewReply(r)!;Date.now=()=>now()+600_001;return result;});await assert.rejects(f.run(),{code:'LLM_DEADLINE_EXCEEDED'});}finally{Date.now=now;}
  const g=await fixture(),cancel=new AbortController();g.before(()=>{cancel.abort();});await assert.rejects(g.run(cancel.signal),{code:'LLM_CANCELLED'});assert.equal(g.requests.length,0);assert.equal(g.attempts,1);
});

test('SEMANTIC single-unit independent future AI mechanism can pass retaining boundaries in frozen candidate',async()=>{
  const fixtures=JSON.parse(await readFile('docs/reports/KB02-SEMANTIC-AUDIT-20261023-fixtures.json','utf8'));
  const sample=fixtures.fixtures.find((x:{id:string})=>x.id==='independent-ai-positive');assert(sample,'frozen positive exists');
  const f=await fixture('未来AI复核机制定义为辅助财务检查且未上线并在超过到期日三天无到账时提示财务核对后审批。');
  f.candidate({version:3,document:{title:'AI复核',main_topic:'辅助复核机制',source_level:'D'},pages:[{title:'AI辅助复核机制',type:'business_process',category:'ai_application',factUnitIds:f.input.factUnits.map(u=>u.id),questionUnitIds:[]}]});
  f.before(()=>{assert(Object.isFrozen(f.plan));assert.throws(()=>{f.plan.pages[0].title='篡改候选';},TypeError);});
  f.audit(r=>{const p=payload(r);assert.equal(p.input.factUnits.length,1);assert.equal(p.plan.pages[0].title,'AI辅助复核机制');assert(p.input.factUnits[0].text.includes('未上线'));return semanticReviewReply(r)!;});
  assert.equal(await f.run(),undefined);assert.equal(f.requests.length,1);
  const frozen=await fixture(sample.body),before=JSON.stringify(frozen.input);await frozen.run();assert.equal(JSON.stringify(frozen.input),before);assert.deepEqual(frozen.plan.pages.flatMap(p=>p.factUnitIds),frozen.input.factUnits.map(u=>u.id));
});

test('SEMANTIC current production uses N+1 calls, remains unreviewed across restart and cannot confirm',async()=>{
  const f=await storageFixture();try{
    f.succeed();const original=f.provider.complete;f.provider.complete=async r=>{assert(!isReview(r),'B1 is not a production request');return original(r);};
    const first=await f.wait((await f.start()).job.id);assert.equal(first.status,'completed');assert(!first.error);
    const cp=(await f.checkpoint(first.id))!;assert(cp.plan);assert.equal(first.callCount,cp.chunks.length+1);assert(!cp.lastError);
    await assert.rejects(f.start({planningRetry:true}));const before=f.requests.length;await f.newRunner().reconcile();assert.equal(f.requests.length,before);
    assert.deepEqual((await f.checkpoint(first.id))!.completedChunks,cp.completedChunks);const drafts=await f.drafts.list();assert.equal(drafts.length,1);
    const draft=drafts[0];assert.equal(draft.humanReview!.approvals.length,0);
    const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();
    await assert.rejects(wiki.withLock(()=>commits.confirm({draftId:draft.id,baseRevision:draft.revision,selectedPageIds:draft.pages.map(p=>p.pageId),idempotencyKey:'unreviewed-semantic-test',operationId:randomUUID(),now:new Date().toISOString()})),{code:'HUMAN_REVIEW_INCOMPLETE'});
    assert.equal((await wiki.list()).length,0);assert.equal(f.requests.length,before);
  }finally{await f.clean();}
});

test('SEMANTIC production plan-save crash retains blocks; explicit retry replans once and saved plan resumes zero calls',async()=>{
  const f=await storageFixture();try{
    f.succeed();const job=await f.wait((await f.start()).job.id),original=(await f.checkpoint(job.id))!;
    let checkpoint:ExtractionCheckpoint={...structuredClone(original),plan:undefined,stage:'planning',attempts:original.completedChunks.length};
    const blocks=structuredClone(checkpoint.completedChunks),before=f.requests.length;let crash=true;
    const run=()=>runKnowledgePipeline({raw:f.raw,body:f.raw.body,bodySha256:checkpoint.rawSha256,provider:f.provider,rulesDir:'rules',checkpoint,
      beforeCall:async stage=>{checkpoint={...checkpoint,stage,attempts:checkpoint.attempts+1};return checkpoint;},
      saveCheckpoint:async value=>{if(crash&&value.plan)throw new LlmError('STORAGE_WRITE_FAILED','crash before plan save',503);checkpoint={...value,integrity:'memory'};return checkpoint;}});
    await assert.rejects(run(),{code:'STORAGE_WRITE_FAILED'});assert.equal(f.requests.length,before+1);assert(!checkpoint.plan);assert.equal(checkpoint.attempts,blocks.length+1);assert.deepEqual(checkpoint.completedChunks,blocks);
    crash=false;await run();assert(checkpoint.plan);assert.equal(checkpoint.attempts,blocks.length+2);assert.equal(f.requests.length,before+2);assert.deepEqual(checkpoint.completedChunks,blocks);
    await run();assert.equal(f.requests.length,before+2);assert.equal(f.requests.filter(isReview).length,0);
  }finally{await f.clean();}
});

test('SEMANTIC old completed revision11 chunks+1 draft reconciles, edits and explicitly confirms with zero outbound calls',async()=>{
  const f=await storageFixture();try{
    f.succeed();const job=await f.wait((await f.start()).job.id),original=(await f.checkpoint(job.id))!,draft=(await f.drafts.get(job.draftId!))!;
    const oldRules=original.rulesVersion.replace(KB02_PROMPT_REVISION,'kb02-atoms-planning-11');
    const legacy={...draft,rulesVersion:oldRules+'-kb02-2',extraction:{...draft.extraction,callCount:2}};
    await writeFile(path.join(f.root,'drafts',draft.id+'.json'),JSON.stringify(legacy));
    const old=await new ExtractionCheckpointStore(f.root).save({...original,rulesVersion:oldRules,attempts:2,stage:'assembling'});
    await f.jobs.update(job.id,{status:'running',stage:'assembling',callCount:2});const cpFile=path.join(f.root,'state/extraction-checkpoints',job.id+'.json'),before=await readFile(cpFile),calls=f.requests.length;
    const runner=f.newRunner();await runner.reconcile();const recovered=await runner.readJob(job.id);assert.equal(recovered.job?.status,'completed');assert.equal(recovered.recovery,undefined);assert.equal(f.requests.length,calls);
    const settled=(await f.checkpoint(job.id))!;assert.equal(settled.rulesVersion,oldRules);assert.equal(settled.attempts,2);assert.deepEqual(settled.plan,old.plan);assert.notDeepEqual(await readFile(cpFile),before,'settlement may finish stage, never revision or attempts');
    const bundle=await loadExtractionRules('rules'),rules={types:['metric'],categories:['metric'],knowledge_status:bundle.fmcg.enums.knowledge_status,confidence:bundle.fmcg.enums.confidence,source_level:bundle.fmcg.enums.source_level,review_status:bundle.fmcg.enums.review_status};
    await f.drafts.patch(draft.id,{baseRevision:legacy.revision,pages:[{pageId:legacy.pages[0].pageId,title:'旧草稿人工审核'}]},{body:f.raw.body,rules});
    const edited=await approveDraft(f.drafts,draft.id,f.raw.body);
    const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();
    const committed=await wiki.withLock(()=>commits.confirm({draftId:draft.id,baseRevision:edited.revision,selectedPageIds:edited.pages.map(p=>p.pageId),idempotencyKey:'legacy-semantic-test',operationId:randomUUID(),now:new Date().toISOString()}));assert.equal(committed.manifest.status,'completed');assert.equal(f.requests.length,calls);
  }finally{await f.clean();}
});


test('SEMANTIC closure freezes source/candidate and different plan requires another review',async()=>{
  const f=await fixture();f.before(()=>{assert(Object.isFrozen(f.plan));assert(Object.isFrozen(f.input));assert(Object.isFrozen(f.plan.pages[0].factUnitIds));assert.throws(()=>f.plan.pages[0].factUnitIds.push('fu-other'),TypeError);});await f.run();
  const different=structuredClone(f.plan);different.pages[0].title='另一个候选';f.candidate(different);
  f.audit(()=>reply({version:1,pages:[{pageIndex:0,decision:'reject',code:'UNSUPPORTED_LABEL',unitIds:different.pages[0].factUnitIds,reason:'不同候选必须重新调用审核。'}]}));
  await assert.rejects(f.run(),{code:'LLM_PLAN_SEMANTIC_REJECTED'});assert.equal(f.requests.length,2);assert.equal(f.attempts,2);
});

test('SEMANTIC audit input over192KiB fails before accounting without truncating source or candidate',async()=>{
  const body=Array.from({length:33},(_,n)=>'区域'+n+'门店100家'+'甲'.repeat(450)+'。').join(''),f=await fixture(body);
  const plan:KnowledgeWirePlan={version:3,document:{title:'各区域指标',main_topic:'各主体保留',source_level:'D'},pages:f.input.factUnits.map((u,i)=>({title:'区域'+i+'题'.repeat(190),type:'metric',category:'metric',factUnitIds:[u.id],questionUnitIds:[]}))};f.candidate(plan);
  assert(Buffer.byteLength(JSON.stringify(f.input))<=192*1024,'source input fits planning budget');const before=JSON.stringify({input:f.input,plan});assert(Buffer.byteLength(before)>192*1024,'complete review input crosses actual byte limit');
  await assert.rejects(f.run(),{code:'LLM_PLANNING_TOO_LARGE'});assert.equal(f.requests.length,0);assert.equal(f.attempts,0);assert.equal(JSON.stringify({input:f.input,plan}),before);
});

test('SEMANTIC pass must cite its own page fact, not a known neighboring fact or known question',async()=>{
  for(const column of ['question','neighbor']){const f=await fixture();f.candidate({version:3,document:{title:'两主题',main_topic:'完整引用',source_level:'D'},pages:f.input.factUnits.map((u,i)=>({title:'主题'+i,type:'concept',category:'channel',factUnitIds:[u.id],questionUnitIds:i===0?f.input.questionUnits.map(u=>u.id):[]}))});
    f.audit(r=>{const d=payload(r),v=JSON.parse(semanticReviewReply(r)!.text) as Review;v.pages[0].unitIds=[column==='question'?d.input.questionUnits[0].id:d.plan.pages[1].factUnitIds[0]];return reply(v);});await assert.rejects(f.run(),{code:'LLM_SCHEMA_INVALID'});assert.equal(f.requests.length,1);
  }
});

test('SEMANTIC known secret in direct input fails before accounting and provider request',async()=>{
  const f=await fixture('semantic-isolated-secret是不得发送的隔离测试密钥。');await assert.rejects(f.run(),(e:unknown)=>e instanceof LlmError&&e.code==='LLM_OUTPUT_CONTAINS_SECRET'&&!JSON.stringify(e).includes('semantic-isolated-secret'));assert.equal(f.requests.length,0);assert.equal(f.attempts,0);
});
