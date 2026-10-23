import { semanticReviewReply } from './support/semantic-review.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildKnowledgeAtoms, coverageDiagnostic, hasCoverageErrors } from '../services/llm/knowledge-atoms.ts';
import { buildKnowledgePlanningInput, type KnowledgePlanningInput, type KnowledgeWirePlan } from '../services/llm/knowledge-planning.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { chunkText } from '../services/llm/chunk.ts';
import { ExtractionCheckpointStore, type CheckpointChunk, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const fixture=async()=>JSON.parse(await readFile('tests/acceptance/KB02-SOURCE-20261022-seq121-fixture.json','utf8'));
const parts=(body:string)=>chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000});
const catalogs=(body:string)=>new Map(parts(body).map(c=>[c.index,buildEvidenceLocatorCatalog(body,c)]));
const payload=(r:LlmCompletionRequest):KnowledgePlanningInput=>JSON.parse(r.user.split('\n').at(-1)!);
const page=(title:string,factUnitIds:string[],questionUnitIds:string[]=[])=>({title,type:'metric',category:'metric',factUnitIds,questionUnitIds});
const plan=(p:KnowledgePlanningInput):KnowledgeWirePlan=>({version:3,document:{title:'隔离主题',main_topic:'业务'},pages:[page('隔离主题',p.factUnits.map(u=>u.id),p.questionUnits.map(u=>u.id))]});
async function run(source:{raw:any;checkpoint:ExtractionCheckpoint},reply:(p:KnowledgePlanningInput)=>unknown=plan,secrets:string[]=[]) {
 const root=await mkdtemp(path.join(os.tmpdir(),'kb02-source-')),store=new ExtractionCheckpointStore(root);await store.initialize();
 let cp=await store.save({...structuredClone(source.checkpoint),rulesVersion:(await loadExtractionRules('rules')).rulesVersion,plan:undefined,draftId:undefined,stage:'planning',lastError:undefined});
 let respond=reply;const requests:LlmCompletionRequest[]=[];
 const provider:LlmProvider={name:'offline',model:'source-units',secrets,complete:async r=>{requests.push(r);const review=semanticReviewReply(r);if(review)return review;return {text:JSON.stringify(respond(payload(r))),bytes:1,finishReason:'stop'};}};
 const args={raw:source.raw,body:source.raw.body,bodySha256:sha(source.raw.body),rulesDir:'rules',provider,beforeCall:async(stage:'extracting'|'planning')=>cp=await store.save({...cp,stage,attempts:cp.attempts+1}),saveCheckpoint:async(value:Omit<ExtractionCheckpoint,'integrity'>)=>cp=await store.save(value)};
 return {args,store,requests,get cp(){return cp;},reply:(fn:typeof reply)=>{respond=fn;},run:(planningRetry=false)=>runKnowledgePipeline({...args,checkpoint:cp,planningRetry}),clean:()=>rm(root,{recursive:true,force:true})};
}
async function synthetic(body:string,choose:(text:string)=>boolean) {
 const raw={id:randomUUID(),body,title:'隔离多主题',sourceType:'report',sourceName:'测试',tags:[]},chunks=parts(body);
 const completedChunks:CheckpointChunk[]=chunks.map(c=>{const locators=buildEvidenceLocatorCatalog(body,c),atoms=buildKnowledgeAtoms(body,locators).filter(a=>choose(a.text));const facts=atoms.map((a,i)=>({id:`f-c${c.index+1}-${i+1}`,text:a.text,atomId:a.id,kind:a.fragment?'ambiguous' as const:'fact' as const,locatorIds:a.locatorIds,chunkIndex:c.index}));return {index:c.index,start:c.start,end:c.end,facts,questions:[],sourceNotes:[],evidence:locators.filter(l=>facts.some(f=>f.locatorIds.includes(l.id))).map(l=>({id:l.id,rawId:raw.id,quote:l.text,start:l.start,end:l.end,chunkIndex:c.index}))};});
 const checkpoint:ExtractionCheckpoint={version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:'memory',providerIdentity:'offline',chunks:chunks.map(({index,start,end})=>({index,start,end})),completedChunks,attempts:chunks.length,stage:'planning',updatedAt:new Date().toISOString(),integrity:''};return {raw,checkpoint};
}

test('SOURCE seq121 exact real failure passed old ID coverage and is refused as v2 without changing any extracted ID',async()=>{
 const old=await fixture();assert.equal(old.raw.body.length,106400);assert.equal(sha(old.raw.body),old.checkpoint.rawSha256);
 assert(!hasCoverageErrors(coverageDiagnostic(old.input.facts.map((i:any)=>i.id),old.input.questions.map((i:any)=>i.id),old.response.pages)));
 const p=buildKnowledgePlanningInput(old.raw.body,old.checkpoint.completedChunks,catalogs(old.raw.body)),unit=p.factUnits.find(u=>u.memberIds.includes('f-c6-3'))!;
 assert.deepEqual(unit.memberIds,['f-c6-3','f-c7-1']);assert.equal(unit.kind,'fact');assert.equal(unit.sourceId,'s-45613-45652');assert.equal(unit.text,old.raw.body.slice(45613,45652));assert.equal(p.facts.length,79);assert.equal(p.questions.length,25);
 const f=await run(old,()=>old.response);try{const before=structuredClone(f.cp.completedChunks);await assert.rejects(f.run(),{code:'LLM_SCHEMA_INVALID'});assert.equal(f.requests.length,1);assert(!f.cp.plan);assert.deepEqual(f.cp.completedChunks,before);}finally{await f.clean();}
});

test('SOURCE controlled real seq121 creates 14 correct areas with all 104 original IDs then saves and restores the new plan',async()=>{
 const old=await fixture(),f=await run(old,p=>({...plan(p),pages:Array.from({length:14},(_,n)=>{const area=String(n+1).padStart(2,'0');return page('虚构区域'+area,p.factUnits.filter(u=>old.expectedAreas[u.memberIds[0]]===area).map(u=>u.id),p.questionUnits.filter(u=>old.expectedAreas[u.memberIds[0]]===area).map(u=>u.id));})}));
 try{const before=structuredClone(f.cp.completedChunks),done=await f.run();assert.equal(done.outcome.pages.length,14);assert.deepEqual(f.cp.completedChunks,before);assert.equal(f.cp.plan!.pages.flatMap(p=>p.factIds).length,79);assert.equal(f.cp.plan!.pages.flatMap(p=>p.questionIds).length,25);assert.deepEqual(new Set(f.cp.plan!.pages.flatMap(p=>p.factIds)),new Set(old.input.facts.map((i:any)=>i.id)));assert.deepEqual(new Set(f.cp.plan!.pages.flatMap(p=>p.questionIds)),new Set(old.input.questions.map((i:any)=>i.id)));
 for(const p of f.cp.plan!.pages)for(const id of [...p.factIds,...p.questionIds])assert.equal(old.expectedAreas[id],p.title.slice(-2));
 const six=f.cp.plan!.pages.find(p=>p.title==='虚构区域06')!,seven=f.cp.plan!.pages.find(p=>p.title==='虚构区域07')!;assert(!six.factIds.includes('f-c6-3'));assert(seven.factIds.includes('f-c6-3'));assert(seven.factIds.includes('f-c7-1'));
 const saved=await f.store.get(f.cp.jobId);await validateKnowledgeCheckpoint({...f.args,checkpoint:saved!});const calls=f.requests.length;await runKnowledgePipeline({...f.args,checkpoint:saved!});assert.equal(f.requests.length,calls);assert.equal(sha(old.raw.body),old.checkpoint.rawSha256);
 }finally{await f.clean();}
});

for(const fault of ['missing','duplicate','unknown','wrong-column','split'] as const)test(`SOURCE v3 ${fault} units fail before expansion and only explicit retry resumes planning`,async()=>{
 const old=await fixture(),f=await run(old,p=>{const bad=plan(p),ids=bad.pages[0].factUnitIds;if(fault==='missing')ids.pop();if(fault==='duplicate')ids.push(ids[0]);if(fault==='unknown')ids.push('fu-unknown');if(fault==='wrong-column')bad.pages[0].questionUnitIds.push(ids.pop()!);if(fault==='split')bad.pages.push(page('另一主题',[ids[0]]));return bad;});
 try{const before=structuredClone(f.cp.completedChunks),attempts=f.cp.attempts;await assert.rejects(f.run(),{code:'LLM_PLAN_COVERAGE_INVALID'});assert(!f.cp.plan);assert.deepEqual(f.cp.completedChunks,before);assert.equal(f.cp.attempts,attempts+1);assert.equal(f.requests.length,1);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.requests.length,1);assert.equal((await f.store.get(f.cp.jobId))!.stage,'planning');
 f.reply(plan);await f.run(true);assert.equal(f.requests.length,3);assert.equal(f.cp.attempts,attempts+3);assert.deepEqual(f.cp.completedChunks,before);assert(payload(f.requests[1]).factUnits.length>0);assert(JSON.parse(f.requests[1].user.split('\n').at(-1)!).coverageFeedback);
 }finally{await f.clean();}
});

test('SOURCE current-rule tampered persisted split, unknown page field and metadata are rejected; valid plan remains restorable',async()=>{
 const old=await fixture(),f=await run(old,p=>({...plan(p),pages:[page('甲',p.factUnits.slice(0,1).map(u=>u.id)),page('乙',p.factUnits.slice(1).map(u=>u.id),p.questionUnits.map(u=>u.id))]}));try{await f.run();const good=structuredClone(f.cp);await validateKnowledgeCheckpoint({...f.args,checkpoint:good});
 for(const change of [(cp:ExtractionCheckpoint)=>{const p=cp.plan!.pages,from=p.find(p=>p.factIds.includes('f-c6-3'))!,to=p.find(p=>p!==from)!;from.factIds.splice(from.factIds.indexOf('f-c6-3'),1);to.factIds.push('f-c6-3');},(cp:ExtractionCheckpoint)=>{(cp.plan!.pages[0] as any).unknown='x';},(cp:ExtractionCheckpoint)=>{cp.plan!.pages[0].type='unknown';},(cp:ExtractionCheckpoint)=>{(cp.plan!.document as any).unknown='x';}]){const cp=structuredClone(good);change(cp);await assert.rejects(validateKnowledgeCheckpoint({...f.args,checkpoint:cp}),{code:'LLM_CHECKPOINT_CORRUPT'});assert.equal(f.requests.length,2);}
 }finally{await f.clean();}
});

test('SOURCE same text at different Raw positions is not merged and may have distinct primary pages',async()=>{
 const text='共同业务口径待确认。',source=await synthetic(text+'填'.repeat(600)+'。'+text,t=>t===text),f=await run(source,p=>{assert.equal(p.factUnits.length,2);assert.notEqual(p.factUnits[0].id,p.factUnits[1].id);assert.notEqual(p.factUnits[0].sourceId,p.factUnits[1].sourceId);return {...plan(p),pages:p.factUnits.map((u,i)=>page('主题'+i,[u.id]))};});try{const done=await f.run();assert.equal(done.outcome.pages.length,2);await validateKnowledgeCheckpoint({...f.args,checkpoint:f.cp});}finally{await f.clean();}
});

test('SOURCE same multi-business atom remains whole; duplicate full statements cannot invent separate semantic projections',async()=>{
 const text='甲区在售20家，乙区在售30家，异常负责人未知。',source=await synthetic('填'.repeat(7599)+'。'+text+'填'.repeat(500)+'。',t=>t===text),f=await run(source,p=>{assert.equal(p.facts.length,2);assert.equal(p.factUnits.length,1);assert.equal(p.factUnits[0].memberIds.length,2);assert.equal(p.factUnits[0].text,text);return plan(p);});try{const done=await f.run();assert.equal(done.outcome.pages[0].source_facts.length,2);assert(done.outcome.pages[0].source_facts.every(f=>f.text===text));}finally{await f.clean();}
});

test('SOURCE different kinds and fact/question units at the same span can belong to different topics without losing ambiguity',async()=>{
 const text='甲区20家，乙区30家，负责人未知。',source=await synthetic('填'.repeat(7599)+'。'+text+'填'.repeat(500)+'。',t=>t===text);assert.equal(source.checkpoint.completedChunks.length,2);source.checkpoint.completedChunks[1].facts[0].kind='ambiguous';for(const c of source.checkpoint.completedChunks){const fact=c.facts[0];c.questions=[{id:`q-c${c.index+1}-1`,text:fact.text,locatorIds:fact.locatorIds,chunkIndex:c.index,atomId:fact.atomId}];}
 const f=await run(source,p=>{assert.equal(p.factUnits.length,2);assert.equal(p.questionUnits.length,1);assert.notEqual(p.factUnits[0].id,p.factUnits[1].id);assert(p.factUnits.every(u=>u.sourceId===p.questionUnits[0].sourceId));return {...plan(p),pages:[page('事实主题',[p.factUnits[0].id],p.questionUnits.map(u=>u.id)),page('歧义主题',[p.factUnits[1].id])]};});try{const done=await f.run();assert.equal(done.outcome.pages.length,2);assert(done.outcome.pages[1].open_questions.some(q=>q.startsWith('原文口径或边界待确认：')));assert(done.outcome.pages[0].open_questions.includes(text));assert.equal(f.cp.plan!.pages.flatMap(p=>p.questionIds).length,2);await validateKnowledgeCheckpoint({...f.args,checkpoint:f.cp});}finally{await f.clean();}
});

test('SOURCE exact text binding rejects a fabricated different fact projection before any Provider call',async()=>{
 const text='甲区20家，乙区30家。',source=await synthetic('填'.repeat(7599)+'。'+text+'填'.repeat(500)+'。',t=>t===text);source.checkpoint.completedChunks[1].facts[0].text='乙区30家。';const f=await run(source);try{await assert.rejects(f.run(),{code:'LLM_CHECKPOINT_CORRUPT'});assert.equal(f.requests.length,0);}finally{await f.clean();}
});

test('SOURCE old revision7 unfinished checkpoint fails preflight with no call/write and original extraction retained',async()=>{
 const old=await fixture(),f=await run(old);try{const original=structuredClone(old.checkpoint);original.plan=undefined;original.draftId=undefined;original.stage='planning';const persisted=await f.store.save(original),bytes=JSON.stringify(persisted);await assert.rejects(runKnowledgePipeline({...f.args,checkpoint:persisted}),{code:'LLM_CHECKPOINT_INCOMPATIBLE'});assert.equal(f.requests.length,0);assert.equal(JSON.stringify(await f.store.get(original.jobId)),bytes);}finally{await f.clean();}
});

for(const extra of [0,1])test('SOURCE complete unit/context/feedback payload at 192KiB '+(extra?'plus one byte rejects before call':'is accepted'),async()=>{
 const source=await synthetic('选中事实。',()=>true),f=await run(source);try{
 const input=buildKnowledgePlanningInput(source.raw.body,f.cp.completedChunks,catalogs(source.raw.body)),diagnostic=coverageDiagnostic([],[],[]);
 const target=192*1024+extra,base=Buffer.byteLength(JSON.stringify({...input,coverageFeedback:diagnostic}),'utf8'),needed=target-base,count=Math.ceil((needed+1)/67);
 diagnostic.facts.unknown=Array.from({length:count},(_,i)=>('u'+String(i).padStart(4,'0')).padEnd(64,'x'));
 let excess=Buffer.byteLength(JSON.stringify({...input,coverageFeedback:diagnostic}),'utf8')-target;
 for(let i=count-1;excess>0;i--){const cut=Math.min(excess,diagnostic.facts.unknown[i].length-5);diagnostic.facts.unknown[i]=diagnostic.facts.unknown[i].slice(0,-cut||undefined);excess-=cut;}
 assert.equal(Buffer.byteLength(JSON.stringify({...input,coverageFeedback:diagnostic}),'utf8'),target);
 f.cp.lastError={code:'LLM_PLAN_COVERAGE_INVALID',message:'隔离边界',at:new Date().toISOString(),diagnostic};const before=structuredClone(f.cp);
 if(extra){await assert.rejects(f.run(true),{code:'LLM_PLANNING_TOO_LARGE'});assert.equal(f.requests.length,0);assert.deepEqual(f.cp,before);}else{await f.run(true);assert.equal(f.requests.length,2);assert.equal(Buffer.byteLength(f.requests[0].user.split('\n').at(-1)!,'utf8'),target);}
 }finally{await f.clean();}
});
