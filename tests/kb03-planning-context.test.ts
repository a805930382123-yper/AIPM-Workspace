import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildKnowledgePlanningInput, buildKnowledgePlanningWire, expandKnowledgePlan, projectKnowledgePlan, type KnowledgePlanningInput, type KnowledgeWirePlan } from '../services/llm/knowledge-planning.ts';
import { buildKnowledgeAtoms } from '../services/llm/knowledge-atoms.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { chunkText } from '../services/llm/chunk.ts';
import { ExtractionCheckpointStore, type CheckpointChunk } from '../services/llm/checkpoints.ts';
import { OpenAiCompatibleProvider, type LlmCompletionRequest } from '../services/llm/provider.ts';
import { FROZEN_BUDGETS, KB02_PROMPT_REVISION, loadExtractionRules } from '../services/llm/rules.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { approveDraft } from './support/human-review.ts';
// @ts-expect-error Existing offline acceptance ESM support has no declaration file.
import { stores, runnerFor, fakeWireReply } from './support/kb03-quality-runner.mjs';

function reversible(body:string, input:KnowledgePlanningInput) {
  const saved=structuredClone(input), wire=buildKnowledgePlanningWire(body,input);
  assert.deepEqual(input,saved);
  for(const key of ['facts','questions','factUnits','questionUnits'] as const)assert.deepEqual(wire[key],input[key]);
  for(let i=0;i<input.sourceContexts.length;i++){
    const old=input.sourceContexts[i],current=wire.sourceContexts[i],{text,...metadata}=old;
    const {passageId,...currentMetadata}=current;assert.deepEqual(currentMetadata,metadata);assert(!('text' in current));
    const passage=wire.passages.find(p=>p.id===passageId)!;
    assert.equal(passage.text.slice(old.contextStart-passage.start,old.contextEnd-passage.start),text);
    assert.equal(text,body.slice(old.contextStart,old.contextEnd));
  }
  for(let i=0;i<wire.passages.length;i++){
    const p=wire.passages[i];assert.equal(p.id,`p-${p.start}-${p.end}`);assert.equal(p.text,body.slice(p.start,p.end));
    if(i)assert(wire.passages[i-1].end<p.start);
    assert(!/^[\uDC00-\uDFFF]/u.test(p.text));assert(!/[\uD800-\uDBFF]$/u.test(p.text));
  }
  assert.deepEqual(buildKnowledgePlanningWire(body,input),wire);
  return wire;
}

test('R6 overlapping/contained/adjacent windows merge; gaps and UTF16 boundaries remain exact',()=>{
  const body='甲😀乙'+'甲'.repeat(16)+'乙😀丙'+'后'.repeat(10);
  const ranges=[[25,34],[1,3],[3,8],[0,4],[8,12],[12,14],[20,24]];
  const sourceContexts=ranges.map(([start,end],i)=>({id:`s-${i}`,start,end,contextStart:start,contextEnd:end,text:body.slice(start,end),factIds:[`f-${i}`],questionIds:[]}));
  const input:KnowledgePlanningInput={facts:[],questions:[],factUnits:[],questionUnits:[],sourceContexts};
  const wire=reversible(body,input);
  assert.deepEqual(wire.passages.map(p=>[p.start,p.end]),[[0,14],[20,24],[25,34]]);
  assert.deepEqual(buildKnowledgePlanningWire(body,{...input,sourceContexts:[...sourceContexts].reverse()}).passages,wire.passages);
});

test('R6 exact units preserve cross-chunk members, distinct positions, ambiguity, questions and output roundtrip',()=>{
  const repeated='负责人未知。',body='甲渠道2025年，金额100万元，不含线上。'+repeated+'填'.repeat(7590)+'。'+repeated+'乙渠道2024年不含直营。😀门店30家。'+'尾'.repeat(600)+'。';
  const chunks=chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}),catalogs=new Map(chunks.map(c=>[c.index,buildEvidenceLocatorCatalog(body,c)]));
  const completed:CheckpointChunk[]=chunks.map(c=>{
    const atoms=buildKnowledgeAtoms(body,catalogs.get(c.index)!);
    return {index:c.index,start:c.start,end:c.end,facts:atoms.map((a,i)=>({id:`f-c${c.index+1}-${i}`,text:a.text,atomId:a.id,kind:a.text.includes('未知')?'ambiguous':'fact',locatorIds:a.locatorIds,chunkIndex:c.index})),questions:atoms.filter(a=>a.text===repeated).map((a,i)=>({id:`q-c${c.index+1}-${i}`,text:a.text,atomId:a.id,locatorIds:a.locatorIds,chunkIndex:c.index})),evidence:[]};
  });
  const input=buildKnowledgePlanningInput(body,completed,catalogs);reversible(body,input);
  const sameText=input.factUnits.filter(u=>u.text===repeated);assert(sameText.length>=2);assert.notEqual(sameText[0].sourceId,sameText[1].sourceId);
  assert(input.factUnits.some(u=>u.memberIds.length>1));
  assert(input.questionUnits.some(q=>input.factUnits.some(f=>f.sourceId===q.sourceId&&f.kind==='ambiguous')));
  const plan:KnowledgeWirePlan={version:3,document:{title:'虚构口径',main_topic:'渠道',source_level:'D'},pages:[{title:'逐事实保留',type:'concept',category:'industry_basics',factUnitIds:input.factUnits.map(u=>u.id),questionUnitIds:input.questionUnits.map(u=>u.id)}]};
  const pages=expandKnowledgePlan(plan,input);assert.deepEqual(pages[0].factIds,input.factUnits.flatMap(u=>u.memberIds));
  assert.deepEqual(projectKnowledgePlan({document:{...plan.document,summary:'摘要'},pages},input),plan);
});

async function fixture(mode:'standard'|'deep'='deep',mutate?:(stage:string,value:any,wire:any)=>string|undefined) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb03-r6-')),state=await stores(root);
  const raw=await state.rawStore.create({title:'虚构窗口接线',sourceType:'article',sourceName:'虚构R6',tags:['测试'],body:'甲渠道2025年目标100家，不含线上。乙渠道2024年在售30家。金额为100万元，不是门店数量。负责人未知。😀'});
  const requests:LlmCompletionRequest[]=[],wires:any[]=[],originalFetch=globalThis.fetch;
  const provider=new OpenAiCompatibleProvider({baseUrl:'https://api.openai.com/v1',model:'gpt-6.1-terra',apiKey:'synthetic-r6-credential',source:'env'});
  const complete=provider.complete.bind(provider);provider.complete=async request=>{requests.push(request);return complete(request);};
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://api.openai.com/v1/chat/completions');const wire=JSON.parse(options!.body as string);wires.push(wire);
    const {stage,value}=fakeWireReply(wire);if(stage==='planning')value.pages[0].title='虚构知识卡';const changed=mutate?.(stage,value,wire);
    return new Response(JSON.stringify({choices:[{message:{content:changed??JSON.stringify(value)},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const runner=runnerFor(root,state,provider),checkpoints=new ExtractionCheckpointStore(root);
  const start=async(options:{planningRetry?:boolean}={})=>{const result=await runner.start(raw.id,{mode,newJobId:randomUUID(),now:new Date().toISOString(),...options});await runner.waitForSettlement(result.job.id);return (await runner.readJob(result.job.id)).job;};
  return {root,state,raw,requests,wires,runner,checkpoints,start,clean:async()=>{globalThis.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true});}};
}

for(const mode of ['standard','deep'] as const)test(`R6 actual adapter ${mode} sends compact wire with unchanged source/schema/timeouts and N+1/N+4`,async()=>{
  const f=await fixture(mode);try{
    const job=await f.start();assert.equal(job.status,'completed');assert.equal(f.requests.length,mode==='deep'?5:2);
    const cp=(await f.checkpoints.get(job.id))!,catalogs=new Map(cp.chunks.map(c=>[c.index,buildEvidenceLocatorCatalog(f.raw.body,{...c,text:f.raw.body.slice(c.start,c.end)})]));
    const internal=buildKnowledgePlanningInput(f.raw.body,cp.completedChunks,catalogs),payload=JSON.parse(f.requests[1].user.split('\n').at(-1)!);
    const projected=reversible(f.raw.body,internal);assert.deepEqual(payload,{...projected,source:{id:f.raw.id,title:f.raw.title,sourceType:f.raw.sourceType,sourceName:f.raw.sourceName,tags:f.raw.tags},sourcePolicy:(await loadExtractionRules('rules')).sourcePolicy});
    assert(payload.sourceContexts.every((c:any)=>!('text'in c)&&c.passageId));assert(payload.passages.length>0);
    assert(f.requests[1].system.includes('不能把整passage内其它陈述归给每个unit'));
    assert(f.requests[1].system.includes('passage.text.slice(contextStart-passage.start,contextEnd-passage.start)'));
    assert.deepEqual(f.wires[1].response_format.json_schema,{...f.requests[1].structuredOutput,strict:true});
    assert.equal(FROZEN_BUDGETS.totalDeadlineMs,600000);assert.equal(KB02_PROMPT_REVISION,'kb02-atoms-planning-19');
    assert.deepEqual(f.requests.map(r=>r.timeoutMs),mode==='deep'?[60000,60000,120000,120000,120000]:[60000,60000]);
    for(const w of f.wires){assert.equal(w.model,'gpt-6.1-terra');assert.equal(w.stream,false);assert(!('temperature'in w));assert(!('reasoning_effort'in w));assert(!('max_tokens'in w));}
    const draft=await f.state.drafts.get(job.draftId);assert.equal(draft.humanReview.approvals.length,0);
    for(const unit of draft.humanReview.units){assert.equal(unit.text,f.raw.body.slice(unit.start,unit.end));}
  }finally{await f.clean();}
});

for(const [name,code,mutate]of [
  ['unknown unit','LLM_PLAN_COVERAGE_INVALID',(v:any)=>{v.pages[0].factUnitIds[0]='fu-unknown';}],
  ['omitted unit','LLM_PLAN_COVERAGE_INVALID',(v:any)=>{v.pages[0].factUnitIds.pop();}],
  ['secret','LLM_OUTPUT_CONTAINS_SECRET',(v:any)=>{v.document.title='synthetic-r6-credential';}],
] as const)test(`R6 compact actual pipeline still rejects ${name} without draft or automatic retry`,async()=>{
  const f=await fixture('standard',(stage,value)=>{if(stage==='planning')mutate(value);return JSON.stringify(value);});try{
    const job=await f.start();assert.equal(job.status,'failed');assert.equal(job.error.code,code);assert.equal(f.requests.length,2);assert.equal((await f.state.drafts.list()).length,0);
  }finally{await f.clean();}
});

test('R6 compact actual wire still rejects a template field referencing another page unit',async()=>{
  const f=await fixture('standard',(stage,value,wire)=>{
    if(stage==='planning'){
      const first=value.pages[0],other=structuredClone(first);other.title='另一知识卡';other.factUnitIds=first.factUnitIds.slice(1);first.factUnitIds=first.factUnitIds.slice(0,1);other.questionUnitIds=[];
      first.templateFields=Object.fromEntries(Object.keys(wire.response_format.json_schema.schema.properties.pages.items.properties.templateFields.properties).map(key=>[key,null]));
      first.templateFields.definition={text:'跨页字段不应通过。',factUnitIds:[other.factUnitIds[0]]};value.pages.push(other);
    }
    return JSON.stringify(value);
  });try{const job=await f.start();assert.equal(job.status,'failed');assert.equal(job.error.code,'LLM_PLAN_FIELD_INVALID');assert.equal(f.requests.length,2);assert.equal((await f.state.drafts.list()).length,0);}finally{await f.clean();}
});

test('R6 explicit coverage retry retains source/policy/records/passages and exact diagnostic on the actual adapter path',async()=>{
  let fail=true;const f=await fixture('standard',(stage,value)=>{if(stage==='planning'&&fail)value.pages[0].factUnitIds.pop();return JSON.stringify(value);});try{
    const first=await f.start();assert.equal(first.error.code,'LLM_PLAN_COVERAGE_INVALID');assert.equal(f.requests.length,2);
    const saved=(await f.checkpoints.get(first.id))!,original=JSON.parse(f.requests[1].user.split('\n').at(-1)!);fail=false;
    const completed=await f.start({planningRetry:true});assert.equal(completed.id,first.id);assert.equal(completed.status,'completed');assert.equal(completed.callCount,3);assert.equal(f.requests.length,3);
    const retry=JSON.parse(f.requests[2].user.split('\n').at(-1)!);assert.deepEqual(retry,{...original,coverageFeedback:saved.lastError!.diagnostic});assert.deepEqual((await f.checkpoints.get(first.id))!.completedChunks,saved.completedChunks);
  }finally{await f.clean();}
});

test('R6 new-version failed planning explicitly resumes same job and reuses chunks; revision17 rejects with 409/zero writes',async()=>{
  let fail=true;const f=await fixture('deep',(stage,value)=>stage==='planning'&&fail?'{invalid':JSON.stringify(value));try{
    const first=await f.start();assert.equal(first.status,'failed');assert.equal(f.requests.length,2);
    const extracted=structuredClone((await f.checkpoints.get(first.id))!.completedChunks);
    fail=false;const done=await f.start();assert.equal(done.status,'completed');assert.equal(done.id,first.id);assert.equal(done.callCount,6);assert.equal(f.requests.length,6);assert.deepEqual((await f.checkpoints.get(done.id))!.completedChunks,extracted);
  }finally{await f.clean();}
  const old=await fixture('deep',(stage,value)=>stage==='planning'?'{invalid':JSON.stringify(value));try{
    const job=await old.start(),cp=(await old.checkpoints.get(job.id))!;
    await old.checkpoints.save({...cp,rulesVersion:cp.rulesVersion.replace(KB02_PROMPT_REVISION,'kb02-atoms-planning-17')});
    const file=path.join(old.root,'state/extraction-checkpoints',job.id+'.json'),before=await fs.readFile(file);
    await assert.rejects(old.start(),{code:'LLM_CHECKPOINT_INCOMPATIBLE',status:409});assert.equal(old.requests.length,2);assert.deepEqual(await fs.readFile(file),before);
  }finally{await old.clean();}
});

for(const revision of ['17','18'])for(const mode of ['standard','deep'] as const)test(`R9 completed revision${revision} ${mode} draft remains readable, HUMAN reviewed and explicitly confirmable`,async()=>{
  const f=await fixture(mode);try{
    const job=await f.start(),cp=(await f.checkpoints.get(job.id))!;await f.checkpoints.save({...cp,rulesVersion:cp.rulesVersion.replace(KB02_PROMPT_REVISION,'kb02-atoms-planning-'+revision)});
    const file=path.join(f.root,'drafts',job.draftId+'.json'),draft=JSON.parse(await fs.readFile(file,'utf8'));draft.rulesVersion=draft.rulesVersion.replace(KB02_PROMPT_REVISION,'kb02-atoms-planning-'+revision);await fs.writeFile(file,JSON.stringify(draft));
    assert.equal((await f.state.drafts.get(draft.id)).id,draft.id);
    if(mode==='standard'){const reused=await f.start();assert.equal(reused.id,job.id);}else await assert.rejects(f.start(),{code:'STORAGE_RECONCILE_CONFLICT'});
    const used=f.requests.length,wiki=new WikiStore(f.root,f.state.rawStore);await wiki.initialize();
    const commits=new WikiCommitService({root:f.root,wikiStore:wiki,...f.state});await commits.initialize();
    const input=(d:any)=>({draftId:d.id,baseRevision:d.revision,selectedPageIds:mode==='deep'?[]:d.pages.map((p:any)=>p.pageId),idempotencyKey:randomUUID(),operationId:randomUUID(),now:new Date().toISOString()});
    await assert.rejects(wiki.withLock(()=>commits.confirm(input(draft))));assert.equal((await wiki.allRecords()).length,0);
    let approved=await approveDraft(f.state.drafts,draft.id,f.raw.body);
    if(mode==='deep')approved=await f.state.drafts.reviewStructuredNote(approved.id,{baseRevision:approved.revision,reviewContentDigest:f.state.drafts.contentDigest(approved),warningsAcknowledged:true,historicalReportAcknowledged:true},f.raw.body);
    const result=await wiki.withLock(()=>commits.confirm(input(approved)));assert.equal(result.manifest.status,'completed');assert.equal(f.requests.length,used);
  }finally{await f.clean();}
});
