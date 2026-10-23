import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chunkText } from '../services/llm/chunk.ts';
import { buildKnowledgeAtoms } from '../services/llm/knowledge-atoms.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { buildKnowledgePlanningInput, expandKnowledgePlan, type KnowledgeWirePlan } from '../services/llm/knowledge-planning.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import type { CheckpointChunk, ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { LlmError, type LlmCompletionRequest, type LlmProvider } from '../services/llm/provider.ts';

const sha = (value:string) => createHash('sha256').update(value).digest('hex');
const payload = (request:LlmCompletionRequest) => JSON.parse(request.user.split('\n').at(-1)!);
const fixturePath='tests/fixtures/kb02-planning-attribution.fixture.json';

async function source() {
  const sample=JSON.parse(await readFile(fixturePath,'utf8')) as {body:string;owners:string[];notes:string};
  const raw={id:randomUUID(),title:'虚构主体归属',sourceType:'report',sourceName:'隔离fixture',tags:[],body:sample.body,bodySha256:sha(sample.body)};
  const descriptors=chunkText(sample.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000});
  const completedChunks:CheckpointChunk[]=descriptors.map(chunk=>{
    const catalog=buildEvidenceLocatorCatalog(sample.body,chunk);
    const atoms=buildKnowledgeAtoms(sample.body,catalog).filter(atom=>atom.text.trim());
    return {index:chunk.index,start:chunk.start,end:chunk.end,facts:atoms.map((atom,index)=>({id:`f-c${chunk.index+1}-${index+1}`,text:atom.text,atomId:atom.id,chunkIndex:chunk.index,locatorIds:atom.locatorIds,kind:atom.fragment?'ambiguous' as const:'fact' as const})),questions:[],sourceNotes:[],evidence:catalog.map(locator=>({id:locator.id,rawId:raw.id,chunkIndex:chunk.index,start:locator.start,end:locator.end,quote:locator.text}))};
  });
  const bundle=await loadExtractionRules('rules');
  const checkpoint:ExtractionCheckpoint={version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(sample.body),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'offline|fixture',chunks:descriptors.map(({index,start,end})=>({index,start,end})),completedChunks,attempts:completedChunks.length,stage:'extracting',updatedAt:new Date().toISOString(),integrity:'in-memory-test'};
  return {sample,raw,checkpoint,bundle};
}

test('KB02 planning system contains the subject-first decisions and abstract contrast cases',async()=>{
  const f=await source(),requests:LlmCompletionRequest[]=[];
  const provider:LlmProvider={name:'offline',model:'fixture',complete:async request=>{
    requests.push(request);
    if(request.user.includes('请对下列全部已验证事实规划知识页')){
      const p=payload(request);
      return {text:JSON.stringify({version:3,document:{title:'未知事项',main_topic:'未知事项'},pages:[{title:'泛化未知与未来建议',type:'concept',category:'ai_application',factUnitIds:p.factUnits.map((u:{id:string})=>u.id),questionUnitIds:p.questionUnits.map((u:{id:string})=>u.id)}]}),bytes:1,finishReason:'stop'};
    }
    const atoms=JSON.parse(request.user.split('\n').at(-1)!);
    return {text:JSON.stringify({version:2,facts:atoms.map((atom:{id:string})=>({atomId:atom.id,kind:'fact'})),questions:[],sourceNotes:[]}),bytes:1,finishReason:'stop'};
  }};
  let checkpoint=f.checkpoint;
  try {
    await runKnowledgePipeline({raw:f.raw,body:f.sample.body,bodySha256:sha(f.sample.body),provider,rulesDir:'rules',checkpoint,beforeCall:async stage=>checkpoint={...checkpoint,stage,attempts:checkpoint.attempts+1},saveCheckpoint:async value=>checkpoint=value as ExtractionCheckpoint});
    const planning=requests.find(r=>r.user.includes('请对下列全部已验证事实规划知识页'))!;
    assert(planning);
    for(const phrase of ['先逐个unit','主体、时间、条件和口径','不同主体即使边界句字面相同','同主体、同口径、同主题可以跨chunk合并','不要求一主体一页或固定页数','原文确有独立定义、触发条件或流程的AI机制','从每个页面反查','模型应在本次规划响应中调整unit归属','不指令程序在响应后自动搬移'])assert(planning.system.includes(phrase),`missing system instruction: ${phrase}`);
    const p=payload(planning),units=[...p.factUnits,...p.questionUnits],assigned=checkpoint.plan!.pages.flatMap(page=>[...page.factIds,...page.questionIds]);
    assert.equal(new Set(assigned).size,units.length);
    assert.deepEqual([...assigned].sort(),units.flatMap((u:{memberIds:string[]})=>u.memberIds).sort());
    assert.equal(checkpoint.plan!.pages.length,1,'原有泛化响应仍通过机械unit覆盖；本测试记录其语义负例');
    assert(checkpoint.plan!.pages[0].title.includes('泛化未知'));
  } finally { /* all checkpoint state is in memory; no persistent product data is touched */ }
});

test('a manually assigned abstract subject plan is representable while retaining every original ID',async()=>{
  const f=await source(),descriptors=chunkText(f.sample.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000});
  const catalogs=new Map(descriptors.map(chunk=>[chunk.index,buildEvidenceLocatorCatalog(f.sample.body,chunk)]));
  const input=buildKnowledgePlanningInput(f.sample.body,f.checkpoint.completedChunks,catalogs);
  assert.equal(input.factUnits.length,5,'fixture contains two channel facts and boundaries plus one independent alert mechanism');
  const firstChannel=input.factUnits.slice(0,2).map(unit=>unit.id),secondChannel=input.factUnits.slice(2,4).map(unit=>unit.id),alertMechanism=input.factUnits.slice(4).map(unit=>unit.id);
  const plan:KnowledgeWirePlan={version:3,document:{title:'渠道经营与告警机制',main_topic:'渠道门店指标及公司告警机制'},pages:[
    {title:'岚河渠道门店经营',type:'metric',category:'metric',factUnitIds:firstChannel,questionUnitIds:[]},
    {title:'栖岸渠道门店经营',type:'metric',category:'metric',factUnitIds:secondChannel,questionUnitIds:[]},
    {title:'公司告警机制',type:'business_process',category:'ai_application',factUnitIds:alertMechanism,questionUnitIds:[]}
  ]};
  const expanded=expandKnowledgePlan(plan,input),assigned=[...expanded.flatMap(page=>page.factIds),...expanded.flatMap(page=>page.questionIds)];
  assert.deepEqual([...assigned].sort(),[...input.facts.map(item=>item.id),...input.questions.map(item=>item.id)].sort());
  assert(expanded[0].factIds.length>0&&expanded[1].factIds.length>0&&expanded[2].factIds.length>0);
  assert.notDeepEqual(expanded[0].factIds,expanded[1].factIds);
});

test('a subject-preserving fake plan is accepted by the complete pipeline',async()=>{
  const f=await source(),requests:LlmCompletionRequest[]=[];
  const provider:LlmProvider={name:'offline',model:'fixture-positive',complete:async request=>{
    requests.push(request);
    if(request.user.includes('请对下列全部已验证事实规划知识页')){
      const p=payload(request),first=p.factUnits.slice(0,2).map((unit:{id:string})=>unit.id),second=p.factUnits.slice(2,4).map((unit:{id:string})=>unit.id),alert=p.factUnits.slice(4).map((unit:{id:string})=>unit.id);
      return {text:JSON.stringify({version:3,document:{title:'渠道经营与告警机制',main_topic:'渠道门店指标及公司告警机制'},pages:[
        {title:'岚河渠道门店经营',type:'metric',category:'metric',factUnitIds:first,questionUnitIds:[]},
        {title:'栖岸渠道门店经营',type:'metric',category:'metric',factUnitIds:second,questionUnitIds:[]},
        {title:'公司告警机制',type:'business_process',category:'ai_application',factUnitIds:alert,questionUnitIds:[]}
      ]}),bytes:1,finishReason:'stop'};
    }
    const atoms=JSON.parse(request.user.split('\n').at(-1)!);
    return {text:JSON.stringify({version:2,facts:atoms.map((atom:{id:string})=>({atomId:atom.id,kind:'fact'})),questions:[],sourceNotes:[]}),bytes:1,finishReason:'stop'};
  }};
  let checkpoint=f.checkpoint;
  await runKnowledgePipeline({raw:f.raw,body:f.sample.body,bodySha256:sha(f.sample.body),provider,rulesDir:'rules',checkpoint,beforeCall:async stage=>checkpoint={...checkpoint,stage,attempts:checkpoint.attempts+1},saveCheckpoint:async value=>checkpoint=value as ExtractionCheckpoint});
  assert.equal(requests.length,1);assert.equal(checkpoint.plan!.pages.length,3);
  const factIds=checkpoint.plan!.pages.flatMap(page=>page.factIds);
  assert.deepEqual([...factIds].sort(),checkpoint.completedChunks.flatMap(chunk=>chunk.facts.map(fact=>fact.id)).sort());
  assert.deepEqual(checkpoint.plan!.pages.map(page=>page.title),['岚河渠道门店经营','栖岸渠道门店经营','公司告警机制']);
});

test('revision10 unfinished checkpoint is rejected before Provider calls and retained chunks stay byte-identical',async()=>{
  const f=await source(),before=JSON.stringify(f.checkpoint.completedChunks),old={...f.checkpoint,rulesVersion:f.bundle.rulesVersion.replace('kb02-atoms-planning-11-','kb02-atoms-planning-10-')};
  let calls=0;const provider:LlmProvider={name:'offline',model:'must-not-run',complete:async()=>{calls++;throw new Error('unexpected Provider call');}};
  await assert.rejects(validateKnowledgeCheckpoint({raw:f.raw,body:f.sample.body,bodySha256:sha(f.sample.body),provider,rulesDir:'rules',checkpoint:old}),
    (error:unknown)=>error instanceof LlmError&&error.code==='LLM_CHECKPOINT_INCOMPATIBLE'&&error.status===409);
  assert.equal(calls,0);assert.equal(JSON.stringify(old.completedChunks),before);
});
