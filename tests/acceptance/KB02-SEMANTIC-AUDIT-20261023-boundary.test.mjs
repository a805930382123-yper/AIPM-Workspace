import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {runKnowledgePipeline} from '../../services/llm/knowledge-extraction.ts';import {loadExtractionRules} from '../../services/llm/rules.ts';import {chunkText} from '../../services/llm/chunk.ts';import {reviewKnowledgePlan} from '../../services/llm/knowledge-semantic-review.ts';
import {storageFixture} from '../support/kb02-storage-fixture.ts';import {ExtractionCheckpointStore} from '../../services/llm/checkpoints.ts';
const sha=x=>createHash('sha256').update(x).digest('hex'),data=r=>JSON.parse(r.user.split('\n').at(-1)),reply=x=>({text:JSON.stringify(x),bytes:Buffer.byteLength(JSON.stringify(x)),finishReason:'stop'});
const traces=(await fs.readFile('docs/reports/KB02-REGION-AUDIT-20261023-provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse),trace=n=>traces.find(t=>t.sequence===n);
const originalPlan=JSON.parse(trace(202).response.content),body=JSON.parse(trace(202).request.messages.find(m=>m.role==='user').content.split('\n').at(-1)).sourceContexts[0].text;
function passReview(request){const d=data(request);return {version:1,pages:d.plan.pages.map((page,pageIndex)=>({pageIndex,decision:'pass',code:'OK',unitIds:[page.factUnitIds[0]],reason:'Controlled fake: this checks gate mechanics, never semantic truth.'}))};}
async function harness(){const bundle=await loadExtractionRules('rules');let cp={version:1,jobId:'independent-boundary',rawId:'fictional-source',rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'offline',chunks:chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString(),integrity:'memory'};const requests=[],saves=[];let review=r=>reply(passReview(r));
 const args={raw:{id:cp.rawId,title:'independent original supplement',sourceType:'report',sourceName:'fictional',tags:[]},body,bodySha256:sha(body),rulesDir:'rules',provider:{name:'offline',model:'no-network',complete:async r=>{requests.push(r);if(r.user.startsWith('请审核'))return review(r);return r.user.startsWith('请对下列')?reply(structuredClone(originalPlan)):{text:trace(201).response.content,bytes:Buffer.byteLength(trace(201).response.content),finishReason:'stop'};}},beforeCall:async stage=>cp={...cp,stage,attempts:cp.attempts+1},saveCheckpoint:async c=>{saves.push(structuredClone(c));return cp=c;}};
 return {args,requests,saves,get cp(){return cp;},set cp(v){cp=v;},set review(v){review=v;},run:()=>runKnowledgePipeline({...args,checkpoint:cp})};}
test('AUDIT original seq202: reject and uncertain retain evidence; dishonest fake pass is not quality proof',async()=>{
 for(const decision of ['reject','uncertain','pass']){const f=await harness();f.review=r=>{assert(!f.cp.plan);const v=passReview(r);v.pages.at(-1).decision=decision;v.pages.at(-1).code=decision==='reject'?'UNSUPPORTED_TOPIC':decision==='uncertain'?'INSUFFICIENT_EVIDENCE':'OK';return reply(v);};
 if(decision==='pass'){const result=await f.run();assert.equal(result.outcome.pages.at(-1).title,originalPlan.pages.at(-1).title);assert.equal(result.outcome.pages.at(-1).source_facts[0].text,'AI异常提示为未来建议，无上线或收益事实。');}
 else{await assert.rejects(f.run(),{code:decision==='reject'?'LLM_PLAN_SEMANTIC_REJECTED':'LLM_PLAN_SEMANTIC_UNCERTAIN'});assert(!f.cp.plan);assert(f.saves.every(c=>!c.plan));}
 assert.equal(f.cp.completedChunks.length,1);assert.equal(f.cp.attempts,3);assert.equal(f.requests.length,3);
 }
});
test('AUDIT ordinary pipeline never inherits completed-draft lower-count exception; one remaining call costs zero',async()=>{
 const f=await harness();await f.run();const valid=structuredClone(f.cp),calls=f.requests.length,writes=f.saves.length;
 f.cp={...valid,attempts:valid.completedChunks.length+1};await assert.rejects(f.run(),{code:'LLM_CHECKPOINT_CORRUPT'});assert.equal(f.requests.length,calls);assert.equal(f.saves.length,writes);
 f.cp={...valid,plan:undefined,stage:'planning',attempts:5};const before=JSON.stringify(f.cp);await assert.rejects(f.run(),{code:'LLM_ATTEMPT_LIMIT'});assert.equal(JSON.stringify(f.cp),before);assert.equal(f.requests.length,calls);
 f.cp={...valid,rulesVersion:valid.rulesVersion.replace('planning-12-','planning-11-')};await assert.rejects(f.run(),{code:'LLM_CHECKPOINT_INCOMPATIBLE'});assert.equal(f.requests.length,calls);
});
test('AUDIT review schema: own-page fact support, full unique indices, decision-code and response bounds',async()=>{
 const bundle=await loadExtractionRules('rules'),source=JSON.parse(trace(202).request.messages.find(m=>m.role==='user').content.split('\n').at(-1));
 for(const mutate of [v=>v.pages.pop(),v=>v.pages[1].pageIndex=0,v=>v.pages[0].unitIds=['fu-unknown'],v=>v.pages[0].unitIds=[originalPlan.pages[1].factUnitIds[0]],v=>v.pages[0].decision='uncertain',v=>v.pages[0].reason=' ',v=>v.pages[0].extra=true]){
 let calls=0,charged=0;await assert.rejects(reviewKnowledgePlan({input:structuredClone(source),plan:structuredClone(originalPlan),schema:bundle.kb02SemanticReviewSchema,deadline:Date.now()+600000,guard:()=>{},beforeCall:async()=>{charged++;},provider:{name:'fake',model:'schema',complete:async r=>{calls++;const v=passReview(r);mutate(v);return reply(v);}}}),{code:'LLM_SCHEMA_INVALID'});assert.equal(calls,1);assert.equal(charged,1);
 }
});
test('AUDIT same immutable candidate is checked; a second candidate needs a fresh call',async()=>{
 const f=await harness();await f.run();const request=f.requests.find(r=>r.user.startsWith('请审核')),value=data(request),schema=(await loadExtractionRules('rules')).kb02SemanticReviewSchema;let calls=0;
 for(const title of ['first','second']){const plan=structuredClone(value.plan);plan.pages[0].title=title;await reviewKnowledgePlan({input:structuredClone(value.input),plan,schema,deadline:Date.now()+600000,guard:()=>{},beforeCall:async()=>{assert(Object.isFrozen(plan.pages[0]));assert.throws(()=>plan.pages[0].title='mutated',TypeError);},provider:{name:'fake',model:'binding',complete:async r=>{calls++;assert.equal(data(r).plan.pages[0].title,title);return reply(passReview(r));}}});}assert.equal(calls,2);
});
test('AUDIT completed old draft reconciles without calls; forged new undercount cannot settle',async()=>{
 for(const legacy of [true,false]){const f=await storageFixture();try{f.succeed();const {job}=await f.start();const done=await f.wait(job.id);assert.equal(done.status,'completed');const cp=await f.checkpoint(job.id),draft=await f.drafts.get(done.draftId);const version=legacy?cp.rulesVersion.replace('planning-12-','planning-11-'):cp.rulesVersion;
  await fs.writeFile(path.join(f.root,'drafts',draft.id+'.json'),JSON.stringify({...draft,rulesVersion:version+'-kb02-2',extraction:{...draft.extraction,callCount:2}}));await new ExtractionCheckpointStore(f.root).save({...cp,rulesVersion:version,attempts:2,stage:'assembling'});await f.jobs.update(job.id,{status:'running',stage:'assembling',callCount:2});const calls=f.requests.length;
  const runner=f.newRunner();await runner.reconcile();const result=await runner.readJob(job.id);assert.equal(f.requests.length,calls);
  if(legacy){assert.equal(result.job.status,'completed');assert(!result.recovery);const settled=await f.checkpoint(job.id);assert.equal(settled.rulesVersion,version);assert.equal(settled.attempts,2);assert.deepEqual(settled.plan,cp.plan);}
  else{assert(result.recovery,'Impossible new-revision ledger must remain a recovery error');assert.notEqual(result.job.status,'completed');}
 }finally{await f.clean();}}
});
