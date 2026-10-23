import { semanticReviewReply } from './support/semantic-review.ts';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {buildKnowledgeAtoms} from '../services/llm/knowledge-atoms.ts';
import {buildEvidenceLocatorCatalog} from '../services/llm/locators.ts';
import {chunkText} from '../services/llm/chunk.ts';
import {ExtractionCheckpointStore,type ExtractionCheckpoint} from '../services/llm/checkpoints.ts';
import {runKnowledgePipeline,validateKnowledgeCheckpoint} from '../services/llm/knowledge-extraction.ts';
import {loadExtractionRules} from '../services/llm/rules.ts';
import type {LlmCompletionRequest,LlmProvider} from '../services/llm/provider.ts';
import {storageFixture} from './support/kb02-storage-fixture.ts';
import {storageHttp} from './support/kb02-storage-http.ts';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const original=async()=>JSON.parse(await readFile('tests/acceptance/KB02-EDGE-20261022-short-fixture.json','utf8'));
const chunks=(body:string)=>chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000});
type WireAtom={id:string;text:string;fragment:boolean};
const payload=(r:LlmCompletionRequest)=>JSON.parse(r.user.split('\n').at(-1)!);
const legal=(r:LlmCompletionRequest)=>({version:2,facts:(payload(r) as WireAtom[]).map(a=>({atomId:a.id,kind:a.fragment?'ambiguous':'fact'})),questions:[],sourceNotes:[]});
async function fixture(body:string,reply:(r:LlmCompletionRequest)=>unknown=legal){
 const root=await mkdtemp(path.join(os.tmpdir(),'kb02-edge-')),store=new ExtractionCheckpointStore(root);await store.initialize();
 const raw={id:randomUUID(),title:'隔离边界',sourceType:'report',sourceName:'离线',tags:[],body},bundle=await loadExtractionRules('rules');
 let cp=await store.save({version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'offline|edge',chunks:chunks(body).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString()});
 const requests:LlmCompletionRequest[]=[],provider:LlmProvider={name:'offline',model:'edge',complete:async r=>{requests.push(r);const review=semanticReviewReply(r);if(review)return review;const p=payload(r);return {text:JSON.stringify(Array.isArray(p)?reply(r):{version:3,document:{title:'隔离指标',main_topic:'业务'},pages:[{title:'隔离指标',type:'metric',category:'metric',factUnitIds:p.factUnits.map((u:{id:string})=>u.id),questionUnitIds:p.questionUnits.map((u:{id:string})=>u.id)}]}),bytes:1,finishReason:'stop'};}};
 const args={raw,body,bodySha256:sha(body),rulesDir:'rules',provider,beforeCall:async(stage:'extracting'|'planning')=>cp=await store.save({...cp,stage,attempts:cp.attempts+1}),saveCheckpoint:async(value:Omit<ExtractionCheckpoint,'integrity'>)=>cp=await store.save(value)};
 return {root,store,args,requests,get cp(){return cp;},run:()=>runKnowledgePipeline({...args,checkpoint:cp}),clean:()=>rm(root,{recursive:true,force:true})};
}

test('EDGE original seq144 bad selection remains rejected although its blank atom is absent from the request',async()=>{
 const old=await original(),f=await fixture(old.raw.body,()=>old.response);try{
 await assert.rejects(f.run(),{code:'LLM_SCHEMA_INVALID',message:'不能将空白分隔符选择为陈述。'});assert.equal(f.requests.length,1);assert(!payload(f.requests[0]).some((a:WireAtom)=>a.id==='c1-a0005'));assert.equal(f.cp.completedChunks.length,0);assert(!f.cp.plan);assert.equal(f.cp.attempts,1);await new Promise(r=>setTimeout(r,20));assert.equal(f.requests.length,1);assert.equal(sha(old.raw.body),old.raw.bodySha256);
 }finally{await f.clean();}
});

test('EDGE controlled short reply preserves five facts, one question, source note and exact original IDs/evidence then restores without a call',async()=>{
 const old=await original();const correct=structuredClone(old.response);correct.sourceNotes=correct.sourceNotes.filter((n:{atomId:string})=>n.atomId!=='c1-a0005');
 const f=await fixture(old.raw.body,()=>correct);try{const result=await f.run(),part=f.cp.completedChunks[0],all=buildKnowledgeAtoms(old.raw.body,buildEvidenceLocatorCatalog(old.raw.body,chunks(old.raw.body)[0]));
 assert.deepEqual(payload(f.requests[0]),all.filter(a=>a.text.trim()).map(({id,text,fragment})=>({id,text,fragment})));assert.deepEqual(part.facts.map(a=>a.atomId),old.response.facts.map((a:{atomId:string})=>a.atomId));assert.equal(part.facts.length,5);assert.equal(part.questions.length,1);assert.deepEqual(part.sourceNotes!.map(n=>n.atomId),['c1-a0001']);
 for(const item of [...part.facts,...part.questions,...part.sourceNotes!]){const atom=all.find(a=>a.id===item.atomId)!;assert.equal(item.text,atom.text);assert.deepEqual(item.locatorIds,atom.locatorIds);}
 for(const e of part.evidence)assert.equal(old.raw.body.slice(e.start,e.end),e.quote);assert.equal(result.outcome.pages[0].source_facts.length,5);assert.equal(f.requests.length,3);const saved=await f.store.get(f.cp.jobId);await validateKnowledgeCheckpoint({...f.args,checkpoint:saved!});await runKnowledgePipeline({...f.args,checkpoint:saved!});assert.equal(f.requests.length,3);
 }finally{await f.clean();}
});

for(const column of ['facts','questions','sourceNotes'] as const)for(const fault of ['blank','unknown','cross-chunk'] as const)test(`EDGE ${column} ${fault} selection fails intact without partial chunk save`,async()=>{
 const old=await original(),id=fault==='blank'?'c1-a0005':fault==='cross-chunk'?'c2-a0001':'invented-atom',f=await fixture(old.raw.body,()=>({version:2,facts:column==='facts'?[{atomId:id,kind:'fact'}]:[],questions:column==='questions'?[{atomId:id}]:[],sourceNotes:column==='sourceNotes'?[{atomId:id}]:[]}));
 try{await assert.rejects(f.run(),{code:fault==='blank'?'LLM_SCHEMA_INVALID':'LLM_EVIDENCE_UNKNOWN_LOCATOR'});assert.equal(f.cp.completedChunks.length,0);assert(!f.cp.plan);assert.equal(f.requests.length,1);assert.equal(f.cp.attempts,1);}finally{await f.clean();}
});

for(const body of ['\n\r\n \t\u00a0\u2003\n甲区20家。 \t乙区30家。\n','甲'.repeat(7599)+'。\n\t乙区20家。\n'+'甲'.repeat(500)+'😀。','\u200b\n甲区20家。'])test(`EDGE exact nonempty projection preserves IDs, UTF16 text and source coverage (${body.length} chars)`,async()=>{
 const f=await fixture(body);try{await f.run();const requests=f.requests.filter(r=>Array.isArray(payload(r)));assert.equal(requests.length,chunks(body).length);
 for(let n=0;n<requests.length;n++){const all=buildKnowledgeAtoms(body,buildEvidenceLocatorCatalog(body,chunks(body)[n])),sent=payload(requests[n]) as WireAtom[];assert.deepEqual(sent,all.filter(a=>a.text.trim()).map(({id,text,fragment})=>({id,text,fragment})));for(const atom of all)assert.equal(body.slice(atom.start,atom.end),atom.text);for(let i=chunks(body)[n].start;i<chunks(body)[n].end;i++)if(body[i].trim())assert(all.filter(a=>a.text.trim()).some(a=>i>=a.start&&i<a.end));}
 await validateKnowledgeCheckpoint({...f.args,checkpoint:f.cp});assert.equal(f.cp.attempts,chunks(body).length+2);
 }finally{await f.clean();}
});

for(const body of ['\n \t\r\n\u00a0\u2003','【虚构来源声明】\n'])test(`EDGE no-business input retains empty/source-only chunk and exact call accounting (${body.length} chars)`,async()=>{
 const f=await fixture(body,r=>({version:2,facts:[],questions:[],sourceNotes:(payload(r) as WireAtom[]).map(a=>({atomId:a.id}))}));try{await assert.rejects(f.run(),{code:'LLM_EMPTY_RESULT'});assert.equal(f.requests.length,1);assert.equal(f.cp.attempts,1);assert.equal(f.cp.completedChunks.length,1);assert.equal(f.cp.completedChunks[0].facts.length,0);assert.equal(f.cp.completedChunks[0].sourceNotes!.length,body.trim()?1:0);assert(!f.cp.plan);if(!body.trim())assert.deepEqual(payload(f.requests[0]),[]);await validateKnowledgeCheckpoint({...f.args,checkpoint:f.cp});}finally{await f.clean();}
});

test('EDGE genuine revision8 short checkpoint is HTTP409 without writes/calls; explicit restart uses no old chunks',async()=>{
 const old=await original(),f=await storageFixture(),h=await storageHttp(f),store=new ExtractionCheckpointStore(f.root);let restartId='',release=()=>{};
 try{const raw=await f.rawStore.create({title:'隔离旧短文',sourceType:'report',sourceName:'本地',tags:[],body:old.raw.body}),cp={...structuredClone(old.checkpoint),rawId:raw.id,jobId:randomUUID(),providerIdentity:'fake|budget-model'};await store.save(cp);const now=new Date().toISOString();
 await f.jobs.insert({id:cp.jobId,rawId:raw.id,status:'failed',stage:'extracting',chunksTotal:1,chunksDone:0,pagesFound:0,provider:{name:f.provider.name,model:f.provider.model},error:{...cp.lastError,retryable:true},cancelRequested:false,callCount:1,pipelineVersion:'kb02-2',startedAt:now,finishedAt:now,updatedAt:now});await f.rawStates.set(raw.id,{status:'failed',reason:'隔离旧规则',jobId:cp.jobId});
 const files=[path.join(f.root,'state/extraction-checkpoints',cp.jobId+'.json'),path.join(f.root,'state/extraction-jobs',cp.jobId+'.json'),path.join(f.root,'state/raw-processing',raw.id+'.json')],before=await Promise.all(files.map(p=>readFile(p)));
 for(const options of [{},{planningRetry:true},{}]){const r=await h.request(`/api/raw/${raw.id}/extract`,options);assert.equal(r.status,409);assert.equal(r.json.error.code,'LLM_CHECKPOINT_INCOMPATIBLE');assert.deepEqual(await Promise.all(files.map(p=>readFile(p))),before);assert.equal(f.requests.length,0);}
 let seen=false;const hold=new Promise<void>(r=>{release=r;});f.setHook(async()=>{seen=true;await hold;});const result=await h.request(`/api/raw/${raw.id}/extract`,{restart:true});assert.equal(result.status,202);restartId=result.json.jobId;assert.notEqual(restartId,cp.jobId);for(let i=0;i<200&&!seen;i++)await new Promise(r=>setTimeout(r,10));assert(seen);const fresh=await store.get(restartId);assert.equal(fresh!.completedChunks.length,0);assert.equal(fresh!.attempts,1);assert.match(fresh!.rulesVersion,/kb02-atoms-planning-12-/u);await f.runner.cancel(restartId);release();await f.runner.waitForSettlement(restartId);assert.deepEqual(await readFile(files[0]),before[0]);assert.equal(f.requests.length,1);
 }finally{release();if(restartId)await f.runner.waitForSettlement(restartId);await h.close();await f.clean();}
});

test('EDGE completed revision8 draft remains HTTP-readable and reused with no additional Provider call',async()=>{
 const old=await original(),f=await storageFixture(),h=await storageHttp(f);try{f.succeed();const done=await f.wait((await f.start()).job.id),file=path.join(f.root,'drafts',done.draftId+'.json'),draft=JSON.parse(await readFile(file,'utf8'));draft.rulesVersion=old.checkpoint.rulesVersion+'-kb02-2';await writeFile(file,JSON.stringify(draft));const bytes=await readFile(file),calls=f.requests.length;
 const read=await h.request('/api/drafts/'+done.draftId);assert.equal(read.status,200);assert.equal(read.json.rulesVersion,draft.rulesVersion);const again=await h.request(`/api/raw/${f.raw.id}/extract`,{});assert.equal(again.status,200);assert.equal(again.json.draftId,done.draftId);assert.equal(f.requests.length,calls);assert.deepEqual(await readFile(file),bytes);
 }finally{await h.close();await f.clean();}
});
