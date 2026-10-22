import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ExtractionCheckpointStore, type ExtractionCheckpoint} from '../services/llm/checkpoints.ts';
import {chunkText} from '../services/llm/chunk.ts';
import {buildKnowledgeAtoms, coverageDiagnostic} from '../services/llm/knowledge-atoms.ts';
import {buildEvidenceLocatorCatalog} from '../services/llm/locators.ts';
import {runKnowledgePipeline, validateKnowledgeCheckpoint} from '../services/llm/knowledge-extraction.ts';
import {loadExtractionRules} from '../services/llm/rules.ts';
import {type LlmCompletionRequest, type LlmProvider} from '../services/llm/provider.ts';
import {validateSchema} from '../services/llm/schema-validator.ts';
import {storageFixture} from './support/kb02-storage-fixture.ts';
import {storageHttp} from './support/kb02-storage-http.ts';

const fixturePath='tests/acceptance/KB02-FINAL-REPAIR-20261022-builder-failure-fixture.json';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
type Atom={id:string;text:string;fragment:boolean};
const notes=['【资料，虚构】\n','排版说明：这里只用于阅读，不补充业务事实。','排版说明：这里只用于阅读，不补充任何【下一资料，虚构】\n','阅读排版用途，不增加经营内容【下一节】\n'];
const business=['说明：虚构渠道在售28家。','本渠道未开展促销。','AI尚未上线，仅建议未来用于补货分析。'];
const unknown='业务说明：异常审批负责人未知。';
const fragment='说明：虚构渠道在售28家，口径尚'+'未说明'.repeat(180);
const body=notes.join('')+business.join('')+unknown+fragment;

async function setup(text=body){
 const root=await mkdtemp(path.join(os.tmpdir(),'kb02-final-class-')),store=new ExtractionCheckpointStore(root);await store.initialize();
 const bundle=await loadExtractionRules('rules'),raw={id:randomUUID(),title:'虚构边界',sourceName:'隔离',sourceType:'report',tags:[]};
 let cp=await store.save({version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(text),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'fake|final',chunks:chunkText(text,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString()});
 const requests:LlmCompletionRequest[]=[];
 const provider:LlmProvider={name:'fake',model:'final',complete:async r=>{
  requests.push(r);const data=JSON.parse(r.user.split('\n').at(-1)!);
  // Explicit fixture labels test plumbing only, never model quality or a product classifier.
  const output=r.user.includes('请对下列全部已验证事实规划知识页')?{version:3,document:{title:'虚构业务',main_topic:'业务'},pages:[{title:'虚构业务',type:'metric',category:'metric',factUnitIds:data.factUnits.map((a:{id:string})=>a.id),questionUnitIds:data.questionUnits.map((a:{id:string})=>a.id)}]}:{version:2,facts:data.filter((a:Atom)=>business.includes(a.text)||fragment.includes(a.text)&&!!a.text.trim()).map((a:Atom)=>({atomId:a.id,kind:a.fragment?'ambiguous':'fact'})),questions:data.filter((a:Atom)=>a.text===unknown).map((a:Atom)=>({atomId:a.id})),sourceNotes:data.filter((a:Atom)=>notes.includes(a.text)).map((a:Atom)=>({atomId:a.id}))};
  return {text:JSON.stringify(output),bytes:1,finishReason:'stop'};
 }};
 const args={raw,body:text,bodySha256:sha(text),provider,rulesDir:path.resolve('rules'),beforeCall:async(stage:'extracting'|'planning')=>cp=await store.save({...cp,stage,attempts:cp.attempts+1}),saveCheckpoint:async(value:Omit<ExtractionCheckpoint,'integrity'>)=>cp=await store.save(value)};
 return {root,store,bundle,requests,args,get cp(){return cp;},run:()=>runKnowledgePipeline({...args,checkpoint:cp}),clean:()=>rm(root,{recursive:true,force:true})};
}

test('FINAL-01 request defines mechanical concatenations and schema-valid content-neutral paired examples',async()=>{
 const f=await setup();try{
  await f.run();const request=f.requests[0];assert(request.user.includes('每条为一个机械原文切片'));assert(request.user.includes('业务歧义必须先存在业务陈述'));assert(request.user.includes('即使fragment=false'));
  const line=request.user.split('\n').find(s=>s.startsWith('拼接成对示例'))!,example=JSON.parse(line.slice(line.indexOf('{')));
  assert.deepEqual(validateSchema(example.output,f.bundle.kb02FactsSchema),[]);
  const byId=new Map<string,Atom>(example.atoms.map((a:Atom)=>[a.id,a]));
  assert.equal(example.output.sourceNotes.length,2);assert.equal(example.output.facts.length,3);assert.equal(example.output.questions.length,1);
  assert(example.output.sourceNotes.every((a:{atomId:string})=>!example.output.facts.some((b:{atomId:string})=>b.atomId===a.atomId)));
  assert(example.output.sourceNotes.some((a:{atomId:string})=>!byId.get(a.atomId)!.fragment));
  assert(!line.includes('c13-'));assert(!line.includes('附录13'));assert(!line.includes('附录14'));
 }finally{await f.clean();}
});

test('FINAL-01 controlled labels retain real business fragments/negative/unknown/future and exclude concatenated notes',async()=>{
 const f=await setup();try{
  const {outcome}=await f.run(),part=f.cp.completedChunks[0];
  assert.deepEqual(part.sourceNotes!.map(a=>a.text),notes);
  assert.deepEqual(part.questions.map(a=>a.text),[unknown]);
  for(const text of business)assert(part.facts.some(a=>a.text===text));
  const fragments=part.facts.filter(a=>!business.includes(a.text));assert.equal(fragments.map(a=>a.text).join(''),fragment);assert(fragments.every(a=>a.kind==='ambiguous'));
  const planning=JSON.parse(f.requests[1].user.split('\n').at(-1)!);assert.deepEqual(planning.facts.map((a:{text:string})=>a.text),part.facts.map(a=>a.text));
  for(const note of notes){assert(!outcome.document.summary.includes(note));assert(!outcome.pages[0].source_facts.some(a=>a.text===note));assert(!outcome.pages[0].open_questions.some(a=>a.includes(note)));}
  for(const e of outcome.pages[0].source_evidence)assert.equal(body.slice(e.start,e.end),e.quote);
 }finally{await f.clean();}
});

test('FINAL-01 original seq75 full directory and response preserve semantic failure and strict seq77 coverage rejection',async()=>{
 const bytes=await readFile(fixturePath),old=JSON.parse(bytes.toString()),f=await setup(old.body);try{
  assert.equal(sha(old.body),old.bodySha256);assert.equal(old.body.length,106400);
  const chunk=chunkText(old.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000})[12];
  assert.deepEqual(buildKnowledgeAtoms(old.body,buildEvidenceLocatorCatalog(old.body,chunk)).map(({id,text,fragment})=>({id,text,fragment})),old.extraction.atoms);
  assert.deepEqual(validateSchema(old.extraction.response,f.bundle.kb02FactsSchema),[]);
  const bad=old.extraction.atoms.find((a:Atom)=>a.id==='c13-a0272');assert(bad.text.includes('不补充任何【'));assert(old.extraction.response.facts.some((a:{atomId:string;kind:string})=>a.atomId===bad.id&&a.kind==='ambiguous'));
  const oldCp=old.oldCheckpoint;assert.equal(oldCp.completedChunks.length,14);assert.deepEqual(coverageDiagnostic(oldCp.completedChunks.flatMap((c:any)=>c.facts.map((a:any)=>a.id)),oldCp.completedChunks.flatMap((c:any)=>c.questions.map((a:any)=>a.id)),old.planning.response.pages).facts.missing,['f-c13-4']);
  // Deliberate offline current-fingerprint rebind proves no filtering/forced placement workaround.
  const cp=await f.store.save({...oldCp,rulesVersion:f.bundle.rulesVersion});
  f.args.provider.complete=async r=>{f.requests.push(r);return {text:JSON.stringify(old.planning.response),bytes:1,finishReason:'stop'};};
  await assert.rejects(runKnowledgePipeline({...f.args,raw:{...f.args.raw,id:oldCp.rawId},checkpoint:cp,beforeCall:async(stage)=>({...cp,stage,attempts:cp.attempts+1})}),{code:'LLM_SCHEMA_INVALID'});
  assert.equal(f.requests.length,1);assert.equal((await f.store.get(cp.jobId))!.completedChunks[12].facts.find(a=>a.id==='f-c13-4')!.text,bad.text);assert(!(await f.store.get(cp.jobId))!.plan);
  assert.deepEqual(await readFile(fixturePath),bytes);
 }finally{await f.clean();}
});

test('FINAL-01 genuine revision5 fourteen-chunk checkpoint returns HTTP409 zero calls/three-file writes; restart uses zero old chunks',async()=>{
 const old=JSON.parse(await readFile(fixturePath,'utf8')),f=await storageFixture(),h=await storageHttp(f);let restartId='';let release:()=>void=()=>{};
 try{
  const raw=await f.rawStore.create({title:'虚构旧14段',sourceType:'report',sourceName:'隔离',tags:[],body:old.body}),cpStore=new ExtractionCheckpointStore(f.root);
  const cp={...old.oldCheckpoint,rawId:raw.id,jobId:randomUUID(),providerIdentity:'fake|budget-model'};
  for(const c of cp.completedChunks)for(const e of c.evidence)e.rawId=raw.id;
  await cpStore.save(cp);const now=new Date().toISOString();
  await f.jobs.insert({id:cp.jobId,rawId:raw.id,status:'failed',stage:'planning',chunksTotal:14,chunksDone:14,pagesFound:0,provider:{name:f.provider.name,model:f.provider.model},error:{...cp.lastError,retryable:true},cancelRequested:false,callCount:15,pipelineVersion:'kb02-2',startedAt:now,finishedAt:now,updatedAt:now});
  await f.rawStates.set(raw.id,{status:'failed',reason:'隔离历史夹具',jobId:cp.jobId});
  const files=[path.join(f.root,'state/extraction-checkpoints',cp.jobId+'.json'),path.join(f.root,'state/extraction-jobs',cp.jobId+'.json'),path.join(f.root,'state/raw-processing',raw.id+'.json')],before=await Promise.all(files.map(p=>readFile(p)));
  for(const options of [{},{planningRetry:true},{}]){const r=await h.request(`/api/raw/${raw.id}/extract`,options);assert.equal(r.status,409);assert.equal(r.json.error.code,'LLM_CHECKPOINT_INCOMPATIBLE');assert.deepEqual(await Promise.all(files.map(p=>readFile(p))),before);assert.equal(f.requests.length,0);}
  let seen=false;const hold=new Promise<void>(resolve=>{release=resolve;});f.setHook(async()=>{seen=true;await hold;});
  const r=await h.request(`/api/raw/${raw.id}/extract`,{restart:true});assert.equal(r.status,202);restartId=r.json.jobId;assert.notEqual(restartId,cp.jobId);
  for(let n=0;n<200&&!seen;n++)await new Promise(resolve=>setTimeout(resolve,10));assert(seen);
  const fresh=await cpStore.get(restartId);assert.equal(fresh!.completedChunks.length,0);assert.equal(fresh!.attempts,1);assert.match(fresh!.rulesVersion,/kb02-atoms-planning-8-/u);
  await f.runner.cancel(restartId);release();await f.runner.waitForSettlement(restartId);assert.deepEqual(await readFile(files[0]),before[0]);assert.equal(f.requests.length,1);
 }finally{release();if(restartId)await f.runner.waitForSettlement(restartId);await h.close();await f.clean();}
});

test('FINAL-01 old completed revision5 draft remains HTTP-readable and start reuses it without outbound call',async()=>{
 const f=await storageFixture(),h=await storageHttp(f);try{
  f.succeed();const s=await f.start();const job=await f.wait(s.job.id);assert.equal(job.status,'completed');
  const file=path.join(f.root,'drafts',job.draftId+'.json'),draft=JSON.parse(await readFile(file,'utf8'));draft.rulesVersion=JSON.parse(await readFile(fixturePath,'utf8')).oldCheckpoint.rulesVersion+'-kb02-2';await writeFile(file,JSON.stringify(draft));
  const before=await readFile(file),calls=f.requests.length,read=await h.request(`/api/drafts/${draft.id}`);assert.equal(read.status,200);assert.equal(read.json.rulesVersion,draft.rulesVersion);
  const start=await h.request(`/api/raw/${f.raw.id}/extract`,{});assert.equal(start.status,200);assert.equal(start.json.jobId,job.id);assert.equal(f.requests.length,calls);assert.deepEqual(await readFile(file),before);
 }finally{await h.close();await f.clean();}
});

test('FINAL-01 revision5 preflight rejects without invoking any pipeline callbacks',async()=>{
 const old=JSON.parse(await readFile(fixturePath,'utf8')),f=await setup(old.body);try{
  const cp=await f.store.save(old.oldCheckpoint),file=path.join(f.root,'state/extraction-checkpoints',cp.jobId+'.json'),before=await readFile(file);
  let writes=0;await assert.rejects(validateKnowledgeCheckpoint({...f.args,raw:{...f.args.raw,id:cp.rawId},checkpoint:cp}),{code:'LLM_CHECKPOINT_INCOMPATIBLE',status:409});
  await assert.rejects(runKnowledgePipeline({...f.args,raw:{...f.args.raw,id:cp.rawId},checkpoint:cp,beforeCall:async()=>{writes++;return cp;},saveCheckpoint:async()=>{writes++;return cp;}}),{code:'LLM_CHECKPOINT_INCOMPATIBLE',status:409});
  assert.equal(writes,0);assert.equal(f.requests.length,0);assert.deepEqual(await readFile(file),before);
 }finally{await f.clean();}
});
