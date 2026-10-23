import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chunkText } from '../services/llm/chunk.ts';
import { runKnowledgePipeline } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules, KB02_PROMPT_REVISION } from '../services/llm/rules.ts';
import { LlmError, type LlmCompletionRequest, type LlmCompletion, type LlmProvider } from '../services/llm/provider.ts';
import { ExtractionCheckpointStore, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import type { KnowledgeWirePlan } from '../services/llm/knowledge-planning.ts';
import { semanticReviewReply } from './support/semantic-review.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { reviewKnowledgePlan } from '../services/llm/knowledge-semantic-review.ts';
import {buildKnowledgePlanningInput,projectKnowledgePlan} from '../services/llm/knowledge-planning.ts';
import {buildEvidenceLocatorCatalog} from '../services/llm/locators.ts';
import {knowledgeCallLimit} from '../services/llm/checkpoints.ts';
import {approveDraft} from './support/human-review.ts';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const payload=(r:LlmCompletionRequest)=>JSON.parse(r.user.split('\n').at(-1)!);
const isReview=(r:LlmCompletionRequest)=>r.user.startsWith('请审核下列完整候选知识规划');
const reply=(value:unknown):LlmCompletion=>({text:JSON.stringify(value),bytes:1,finishReason:'stop'});
type Review={version:number;pages:Array<{pageIndex:number;decision:string;code:string;unitIds:string[];reason:string}>};
async function fixture(body='岚河渠道门店20家。异常审批负责人未知。') {
  const bundle=await loadExtractionRules('rules');
  const raw={id:randomUUID(),title:'语义审核隔离',sourceType:'report',sourceName:'虚构',tags:[]};
  let checkpoint:ExtractionCheckpoint={version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'fake|semantic',chunks:chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString(),integrity:'memory'};
  const requests:LlmCompletionRequest[]=[],saves:ExtractionCheckpoint[]=[];
  let audit:(r:LlmCompletionRequest)=>Promise<LlmCompletion>|LlmCompletion=r=>semanticReviewReply(r)!;
  let planner:(r:LlmCompletionRequest)=>KnowledgeWirePlan=r=>{const p=payload(r);return {version:3,document:{title:raw.title,main_topic:'渠道经营'},pages:[{title:'岚河渠道经营',type:'concept',category:'channel',factUnitIds:p.factUnits.map((u:{id:string})=>u.id),questionUnitIds:p.questionUnits.map((u:{id:string})=>u.id)}]};};
  let select:(r:LlmCompletionRequest)=>unknown=r=>{const a=payload(r) as Array<{id:string;text:string;fragment:boolean}>;return {version:2,facts:a.filter(a=>!a.text.startsWith('【')).map(a=>({atomId:a.id,kind:a.fragment?'ambiguous':'fact'})),questions:a.filter(a=>a.text.includes('负责人未知')).map(a=>({atomId:a.id})),sourceNotes:a.filter(a=>a.text.startsWith('【')).map(a=>({atomId:a.id}))};};
  const provider:LlmProvider={name:'fake',model:'semantic',secrets:['semantic-isolated-secret'],complete:async r=>{requests.push(r);return isReview(r)?audit(r):r.user.includes('请对下列全部已验证事实规划知识页')?reply(planner(r)):reply(select(r));}};
  let beforeHook:((n:number)=>void|Promise<void>)|undefined,saveHook:((c:Omit<ExtractionCheckpoint,'integrity'>)=>void)|undefined;
  const args={raw,body,bodySha256:sha(body),provider,rulesDir:'rules',beforeCall:async(stage:'extracting'|'planning')=>{await beforeHook?.(checkpoint.attempts+1);return checkpoint={...checkpoint,stage,attempts:checkpoint.attempts+1};},saveCheckpoint:async(c:Omit<ExtractionCheckpoint,'integrity'>)=>{saveHook?.(c);checkpoint=c as ExtractionCheckpoint;saves.push(structuredClone(checkpoint));return checkpoint;}};
  // Revision13 intentionally does NOT call B1. Preserve its historical failure, safety,
  // timer and accounting assertions through an explicit test-only direct-function harness.
  // The production runner's new two-call behavior is separately asserted below/HUMAN tests.
  const historicalReview=async(signal?:AbortSignal)=>{
    if(checkpoint.plan)return runKnowledgePipeline({...args,checkpoint,signal});
    if(knowledgeCallLimit(checkpoint.chunks.length)-checkpoint.attempts<2)throw new LlmError('LLM_ATTEMPT_LIMIT','Historical B1 requires planning + review',429);
    const deadline=Date.now()+600_000;let staged:ExtractionCheckpoint|undefined;
    const result=await runKnowledgePipeline({...args,checkpoint,signal,saveCheckpoint:async value=>{if(value.plan){staged={...value,integrity:'memory'};return staged;}return args.saveCheckpoint(value);}});
    assert(staged?.plan);const accepted=staged;
    const catalogs=new Map(chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(c=>[c.index,buildEvidenceLocatorCatalog(body,c)]));
    const input=buildKnowledgePlanningInput(body,accepted.completedChunks,catalogs),plan=projectKnowledgePlan(accepted.plan!,input);
    const guard=()=>{if(signal?.aborted)throw new LlmError('LLM_CANCELLED','cancelled',409);if(Date.now()>=deadline)throw new LlmError('LLM_DEADLINE_EXCEEDED','deadline',504);};
    await reviewKnowledgePlan({input,plan,schema:bundle.kb02SemanticReviewSchema,provider,signal,deadline,guard,beforeCall:async()=>{await args.beforeCall('planning');}});
    const saved=await args.saveCheckpoint({...accepted,attempts:checkpoint.attempts});
    return {...result,checkpoint:saved,outcome:{...result.outcome,callCount:checkpoint.attempts}};
  };
  return {args,requests,saves,get cp(){return checkpoint;},set cp(c:ExtractionCheckpoint){checkpoint=c;},audit:(f:typeof audit)=>audit=f,plan:(f:typeof planner)=>planner=f,select:(f:typeof select)=>select=f,before:(f:typeof beforeHook)=>beforeHook=f,onSave:(f:typeof saveHook)=>saveHook=f,run:historicalReview};
}

test('SEMANTIC original seq202 reject/uncertain gates the full pipeline with exact source/units and retained blocks',async()=>{
  const evidence=JSON.parse(await readFile('docs/reports/KB02-SUPPLEMENT-DIAG-20261023-source-evidence.json','utf8'));
  for(const decision of ['reject','uncertain']) {
    const f=await fixture(evidence.raw.body);
    f.select(r=>{const atoms=payload(r) as Array<{id:string;text:string}>;return {version:2,facts:evidence.actualInput.facts.map((i:{text:string;kind:string})=>({atomId:atoms.find(a=>a.text===i.text)!.id,kind:i.kind})),questions:evidence.actualInput.questions.map((i:{text:string})=>({atomId:atoms.find(a=>a.text===i.text)!.id})),sourceNotes:[]};});
    f.plan(()=>structuredClone(evidence.actualPlan));
    f.audit(r=>{const p=payload(r);assert.deepEqual(p.input,evidence.actualInput);assert.deepEqual(p.plan,evidence.actualPlan);assert(!f.cp.plan);return reply({version:1,pages:p.plan.pages.map((page:{factUnitIds:string[]},pageIndex:number)=>({pageIndex,decision:pageIndex===p.plan.pages.length-1?decision:'pass',code:pageIndex===p.plan.pages.length-1?(decision==='reject'?'UNSUPPORTED_TOPIC':'INSUFFICIENT_EVIDENCE'):'OK',unitIds:page.factUnitIds,reason:'仅未来边界缺独立定义；此为受控fake拒绝，不是模型质量证明。'}))});});
    await assert.rejects(f.run(),{code:decision==='reject'?'LLM_PLAN_SEMANTIC_REJECTED':'LLM_PLAN_SEMANTIC_UNCERTAIN'});
    assert.equal(f.requests.length,3);assert.equal(f.cp.attempts,3);assert.equal(f.cp.completedChunks.length,1);assert(!f.cp.plan);assert(f.saves.every(c=>!c.plan));assert(!JSON.stringify(f.cp).includes('仅未来边界缺独立定义'));
    const blocks=structuredClone(f.cp.completedChunks);f.audit(r=>semanticReviewReply(r)!);f.plan(r=>{const p=payload(r),original=structuredClone(evidence.actualPlan);original.pages[0].factUnitIds.push(...original.pages.pop().factUnitIds);assert.equal(original.pages.flatMap((p:{factUnitIds:string[]})=>p.factUnitIds).length,p.factUnits.length);return original;});
    const done=await f.run();assert.equal(f.cp.attempts,5);assert.equal(done.outcome.pages.length,2);assert.deepEqual(f.cp.completedChunks,blocks);assert.deepEqual(f.cp.plan!.pages.flatMap(p=>p.factIds).sort(),evidence.actualInput.facts.map((i:{id:string})=>i.id).sort());
    const before=f.requests.length,old=structuredClone(f.cp);f.cp={...f.cp,plan:undefined,stage:'planning'};await assert.rejects(f.run(),{code:'LLM_ATTEMPT_LIMIT'});assert.equal(f.requests.length,before);assert.deepEqual(f.cp.completedChunks,old.completedChunks);
  }
});

for(const [name,mutate] of Object.entries({
  reject:(v:Review)=>{v.pages[0].decision='reject';v.pages[0].code='BOUNDARY_ATTRIBUTION';},
  uncertain:(v:Review)=>{v.pages[0].decision='uncertain';v.pages[0].code='INSUFFICIENT_EVIDENCE';},
  missing:(v:Review)=>{v.pages=[];}, duplicate:(v:Review)=>{v.pages.push(v.pages[0]);},
  unknownPage:(v:Review)=>{v.pages[0].pageIndex=1;}, unknownUnit:(v:Review)=>{v.pages[0].unitIds=['fu-unknown'];},
  duplicateUnit:(v:Review)=>{v.pages[0].unitIds.push(v.pages[0].unitIds[0]);},
  conflictingPass:(v:Review)=>{v.pages[0].code='UNSUPPORTED_TOPIC';}, conflictingReject:(v:Review)=>{v.pages[0].decision='reject';},
  extraTop:(v:Review)=>{Object.assign(v,{debug:'untrusted-provider-text'});},extraPage:(v:Review)=>{Object.assign(v.pages[0],{debug:'untrusted-provider-text'});},
  secret:(v:Review)=>{v.pages[0].reason='semantic-isolated-secret';}, emptyReason:(v:Review)=>{v.pages[0].reason=' ';},
  longReason:(v:Review)=>{v.pages[0].reason='x'.repeat(501);},badVersion:(v:Review)=>{v.version=2;},
  questionOnly:(v:Review)=>{v.pages[0].unitIds=['qu-10-21'];},
}))test(`SEMANTIC complete pipeline rejects ${name} without saving plan or arbitrary review payload`,async()=>{
  const f=await fixture();f.audit(r=>{const v=JSON.parse(semanticReviewReply(r)!.text) as Review;mutate(v);return reply(v);});
  const code=name==='reject'?'LLM_PLAN_SEMANTIC_REJECTED':name==='uncertain'?'LLM_PLAN_SEMANTIC_UNCERTAIN':name==='secret'?'LLM_OUTPUT_CONTAINS_SECRET':'LLM_SCHEMA_INVALID';
  await assert.rejects(f.run(),(e:unknown)=>e instanceof LlmError&&e.code===code&&!JSON.stringify(e).includes('untrusted-provider-text'));
  assert.equal(f.cp.attempts,3);assert.equal(f.cp.completedChunks.length,1);assert(!f.cp.plan);assert(f.saves.every(c=>!c.plan));
});

for(const [name,result,code] of [
  ['malformed',{text:'{"reason":"arbitrary-failure-payload"',bytes:1,finishReason:'stop'},'LLM_INVALID_JSON'],
  ['length',{text:'{}',bytes:2,finishReason:'length'},'LLM_OUTPUT_TRUNCATED'],
  ['oversize',{text:'x'.repeat(2*1024*1024+1),bytes:1,finishReason:'stop'},'LLM_RESPONSE_TOO_LARGE'],
] as const)test(`SEMANTIC ${name} fails closed with no plan and no raw failure details`,async()=>{const f=await fixture();f.audit(()=>result);await assert.rejects(f.run(),(e:unknown)=>e instanceof LlmError&&e.code===code&&!JSON.stringify(e).includes('arbitrary-failure-payload'));assert(!f.cp.plan);assert.equal(f.cp.attempts,3);});

test('SEMANTIC schema/instruction revision fingerprint changes, old unfinished revision and new plan undercount fail without calls or writes',async()=>{
  const f=await fixture();await f.run();const valid=structuredClone(f.cp);assert.equal(KB02_PROMPT_REVISION,'kb02-atoms-planning-13');
  const n=f.requests.length,writes=f.saves.length;f.cp={...valid,attempts:valid.completedChunks.length};await assert.rejects(f.run(),{code:'LLM_CHECKPOINT_CORRUPT'});
  f.cp={...valid,plan:undefined,rulesVersion:valid.rulesVersion.replace('planning-13-','planning-12-')};const before=structuredClone(f.cp);await assert.rejects(f.run(),{code:'LLM_CHECKPOINT_INCOMPATIBLE',status:409});assert.deepEqual(f.cp,before);assert.equal(f.requests.length,n);assert.equal(f.saves.length,writes);
  const dir=await mkdtemp(path.join(os.tmpdir(),'semantic-rules-'));try{await cp('rules',dir,{recursive:true});const file=path.join(dir,'kb02-semantic-review.schema.json');await writeFile(file,(await readFile(file,'utf8'))+'\n');assert.notEqual((await loadExtractionRules(dir)).rulesVersion,valid.rulesVersion);}finally{await rm(dir,{recursive:true,force:true});}
});

test('SEMANTIC pre-call accounting failure stops review; crash before accepted-plan save resumes both calls, saved-plan resumes zero',async()=>{
  const f=await fixture();f.before(n=>{if(n===3)throw new LlmError('STORAGE_WRITE_FAILED','ledger failure',503);});await assert.rejects(f.run(),{code:'STORAGE_WRITE_FAILED'});assert.equal(f.requests.length,2);assert(!f.cp.plan);assert.equal(f.cp.attempts,2);
  f.before(undefined);f.onSave(c=>{if(c.plan)throw new LlmError('STORAGE_WRITE_FAILED','crash before plan save',503);});await assert.rejects(f.run(),{code:'STORAGE_WRITE_FAILED'});assert.equal(f.cp.attempts,4);assert(!f.cp.plan);
  f.onSave(undefined);await f.run();assert.equal(f.cp.attempts,6);const calls=f.requests.length;await f.run();assert.equal(f.requests.length,calls);
});

test('SEMANTIC cancellation while review waits rejects immediately and ignores a late pass',async()=>{
  const f=await fixture(),controller=new AbortController();let release!:(value:LlmCompletion)=>void,entered!:()=>void;const atReview=new Promise<void>(r=>entered=r);
  f.audit(()=>{entered();return new Promise<LlmCompletion>(r=>release=r);});const run=f.run(controller.signal);await atReview;controller.abort();await assert.rejects(run,{code:'LLM_CANCELLED'});assert(!f.cp.plan);const saved=f.saves.length;release(reply({version:1,pages:[]}));await Promise.resolve();assert.equal(f.saves.length,saved);assert(!f.cp.plan);assert.equal(f.cp.attempts,3);
});

test('SEMANTIC actual 60s review timer bounds an ignoring provider and discards late success',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();let release!:(v:LlmCompletion)=>void,entered!:()=>void;const atReview=new Promise<void>(r=>entered=r);f.audit(()=>{entered();return new Promise<LlmCompletion>(r=>release=r);});const run=f.run();await atReview;t.mock.timers.tick(60_000);await assert.rejects(run,{code:'LLM_TIMEOUT'});release(reply({}));await Promise.resolve();assert.equal(f.cp.attempts,3);assert(!f.cp.plan);
});

test('SEMANTIC total deadline after review result cannot publish; cancellation during accounting cannot call review',async()=>{
  const f=await fixture(),now=Date.now;try{f.audit(r=>{const result=semanticReviewReply(r)!;Date.now=()=>now()+600_001;return result;});await assert.rejects(f.run(),{code:'LLM_DEADLINE_EXCEEDED'});assert(!f.cp.plan);}finally{Date.now=now;}
  const g=await fixture(),cancel=new AbortController();g.before(n=>{if(n===3)cancel.abort();});await assert.rejects(g.run(cancel.signal),{code:'LLM_CANCELLED'});assert.equal(g.requests.length,2);assert(!g.cp.plan);assert.equal(g.cp.attempts,3);
});

test('SEMANTIC single-unit independent future AI mechanism passes without deleting future boundaries; candidate snapshot is binding',async()=>{
  const fixtures=JSON.parse(await readFile('docs/reports/KB02-SEMANTIC-AUDIT-20261023-fixtures.json','utf8'));
  const sample=fixtures.fixtures.find((x:{id:string})=>x.id==='independent-ai-positive');assert(sample,'frozen positive exists');
  const f=await fixture('未来AI复核机制定义为辅助财务检查且未上线并在超过到期日三天无到账时提示财务核对后审批。');
  let candidate:KnowledgeWirePlan|undefined;
  f.plan(r=>candidate={version:3,document:{title:'AI复核',main_topic:'辅助复核机制'},pages:[{title:'AI辅助复核机制',type:'business_process',category:'ai_application',factUnitIds:payload(r).factUnits.map((u:{id:string})=>u.id),questionUnitIds:[]}]});
  // Provider's pre-serialization object is separate from the strict parsed candidate.
  f.before(n=>{if(n===3){assert(candidate);candidate.pages[0].title='篡改候选';candidate.pages[0].factUnitIds=[];}});
  f.audit(r=>{const p=payload(r);assert.equal(p.input.factUnits.length,1);assert.equal(p.plan.pages[0].title,'AI辅助复核机制');return semanticReviewReply(r)!;});
  const done=await f.run();assert.equal(done.outcome.pages.length,1);assert(done.outcome.pages[0].source_facts[0].text.includes('未上线'));assert.equal(f.requests.length,3);
  const frozen=await fixture(sample.body);await frozen.run();assert.equal(frozen.cp.plan!.pages.flatMap(p=>p.factIds).length,frozen.cp.completedChunks.flatMap(c=>c.facts).length);
});

test('SEMANTIC revision13 runner no longer requests semantic rejection; candidate remains unreviewed across zero-call restart',async()=>{
  const f=await storageFixture();try{f.succeed();const original=f.provider.complete;f.provider.complete=async r=>{assert(!isReview(r),'B1 is not a production request');return original(r);};const first=await f.wait((await f.start()).job.id);assert.equal(first.status,'completed');assert.equal(first.callCount,2);assert(!first.error);const cp=(await f.checkpoint(first.id))!;assert(cp.plan);assert(!cp.lastError);assert(!JSON.stringify(cp).includes('UNTRUSTED-REASON'));await assert.rejects(f.start({planningRetry:true}));const before=f.requests.length;const restart=f.newRunner();await restart.reconcile();assert.equal(f.requests.length,before);assert.deepEqual((await f.checkpoint(first.id))!.completedChunks,cp.completedChunks);assert.equal((await f.drafts.list()).length,1);assert.equal((await f.drafts.list())[0].humanReview!.approvals.length,0);}finally{await f.clean();}
});

test('SEMANTIC old completed revision11 chunks+1 draft reconciles, edits and explicitly confirms with zero outbound calls',async()=>{
  const f=await storageFixture();try{
    f.succeed();const job=await f.wait((await f.start()).job.id),original=(await f.checkpoint(job.id))!,draft=(await f.drafts.get(job.draftId!))!;
    const oldRules=original.rulesVersion.replace('planning-13-','planning-11-');
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

test('SEMANTIC single closure freezes actual candidate and review cannot be reused for a different plan',async()=>{
  const f=await fixture();await f.run();const request=f.requests.find(isReview)!,data=payload(request),schema=(await loadExtractionRules('rules')).kb02SemanticReviewSchema;
  let calls=0;const candidate=data.plan as KnowledgeWirePlan;
  await reviewKnowledgePlan({input:data.input,plan:candidate,schema,deadline:Date.now()+600_000,guard:()=>{},beforeCall:async()=>{assert(Object.isFrozen(candidate));assert(Object.isFrozen(candidate.pages[0].factUnitIds));assert.throws(()=>candidate.pages[0].factUnitIds.push('fu-other'),TypeError);},provider:{name:'fake',model:'bound',complete:async r=>{calls++;return semanticReviewReply(r)!;}}});
  const different=structuredClone(candidate);different.pages[0].title='另一个候选';
  await assert.rejects(reviewKnowledgePlan({input:data.input,plan:different,schema,deadline:Date.now()+600_000,guard:()=>{},beforeCall:async()=>{},provider:{name:'fake',model:'bound',complete:async()=>{calls++;return reply({version:1,pages:[{pageIndex:0,decision:'reject',code:'UNSUPPORTED_LABEL',unitIds:different.pages[0].factUnitIds,reason:'不同候选必须重新调用审核。'}]});}}}),{code:'LLM_PLAN_SEMANTIC_REJECTED'});assert.equal(calls,2);
});

test('SEMANTIC audit input over192KiB fails before review accounting without truncating validated source or candidate',async()=>{
  const body=Array.from({length:33},(_,n)=>`区域${n}门店100家${'甲'.repeat(450)}。`).join(''),f=await fixture(body);
  f.plan(r=>{const p=payload(r);assert(Buffer.byteLength(JSON.stringify(p))<=192*1024);const plan:KnowledgeWirePlan={version:3,document:{title:'各区域指标',main_topic:'各主体保留'},pages:p.factUnits.map((u:{id:string},i:number)=>({title:`区域${i}`+'题'.repeat(190),type:'metric',category:'metric',factUnitIds:[u.id],questionUnitIds:[]}))};assert(Buffer.byteLength(JSON.stringify({input:p,plan}))>192*1024,'fixture must cross review-only input bound');return plan;});
  await assert.rejects(f.run(),{code:'LLM_PLANNING_TOO_LARGE'});assert.equal(f.requests.filter(isReview).length,0);assert.equal(f.requests.length,f.cp.chunks.length+1);assert.equal(f.cp.attempts,f.cp.chunks.length+1);assert.equal(f.cp.completedChunks.length,f.cp.chunks.length);assert(!f.cp.plan);
});

test('SEMANTIC pass must cite its own page fact, not a known neighboring fact or known question',async()=>{
  for(const column of ['question','neighbor']){const f=await fixture();f.plan(r=>{const p=payload(r);return {version:3,document:{title:'两主题',main_topic:'完整引用'},pages:p.factUnits.map((u:{id:string},i:number)=>({title:'主题'+i,type:'concept',category:'channel',factUnitIds:[u.id],questionUnitIds:i===0?p.questionUnits.map((u:{id:string})=>u.id):[]}))};});f.audit(r=>{const d=payload(r),v=JSON.parse(semanticReviewReply(r)!.text) as Review;v.pages[0].unitIds=[column==='question'?d.input.questionUnits[0].id:d.plan.pages[1].factUnitIds[0]];return reply(v);});await assert.rejects(f.run(),{code:'LLM_SCHEMA_INVALID'});assert(!f.cp.plan);}
});
