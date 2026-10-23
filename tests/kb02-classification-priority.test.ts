import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExtractionCheckpointStore, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { chunkText } from '../services/llm/chunk.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { LlmError, type LlmCompletionRequest, type LlmProvider } from '../services/llm/provider.ts';
import { KB02_PROMPT_REVISION, loadExtractionRules } from '../services/llm/rules.ts';
import { validateSchema } from '../services/llm/schema-validator.ts';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
type Atom = { id: string; text: string; fragment: boolean };
const atomsOf = (r: LlmCompletionRequest): Atom[] => JSON.parse(r.user.split('\n').at(-1)!);
const title = '【资料附页，虚构】\n', layout = '排版说明：此段仅用于阅读排版，不补充经营指';
const negative = '虚构区域未开展促销。', future = 'AI尚未上线，仅用于未来分析建议。', unknown = '异常审批负责人未知。';
const businessLong = '在售20家，统计范围尚待确认' + '且未说明渠道口径'.repeat(70) + '\n';
const text = '版'.repeat(512) + title + title + negative + future + unknown + businessLong + layout;
async function fixture(body = text) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-q02-'));
  const store = new ExtractionCheckpointStore(root); await store.initialize();
  const bundle = await loadExtractionRules(path.resolve('rules'));
  const raw = {id:randomUUID(),title:'虚构分类对照',sourceType:'report',sourceName:'隔离测试',tags:[]};
  let checkpoint = await store.save({version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'local|fake',chunks:chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString()});
  const requests: LlmCompletionRequest[] = [];
  let respond = (r: LlmCompletionRequest): unknown => {
    const atoms=atomsOf(r);
    // Explicit fixture labels, not a product classifier and not a real-model evaluation.
    const titleAtoms=atoms.filter(a=>a.text===title), note=atoms.find(a=>a.text===layout)!;
    const longAtoms=atoms.filter(a=>[businessLong.slice(0,512),businessLong.slice(512)].includes(a.text));
    assert.equal(titleAtoms.length,2); assert.deepEqual(titleAtoms.map(a=>a.fragment),[true,false]);
    assert(note.fragment); assert.equal(longAtoms.length,2); assert(longAtoms.every(a=>a.fragment));
    return {version:2,facts:[...atoms.filter(a=>[negative,future].includes(a.text)),...longAtoms].map(a=>({atomId:a.id,kind:'fact'})),questions:atoms.filter(a=>a.text===unknown).map(a=>({atomId:a.id})),sourceNotes:[...titleAtoms,note].map(a=>({atomId:a.id}))};
  };
  const provider: LlmProvider = {name:'local',model:'fake',complete:async r=>{
    requests.push(r);
    const planning=r.user.includes('请对下列全部已验证事实规划知识页');
    const d=planning?JSON.parse(r.user.split('\n').at(-1)!):undefined;
    return {text:JSON.stringify(planning?{version:3,document:{title:'虚构业务边界',main_topic:'业务边界'},pages:[{title:'虚构业务边界',type:'metric',category:'metric',factUnitIds:d.factUnits.map((x:{id:string})=>x.id),questionUnitIds:d.questionUnits.map((x:{id:string})=>x.id)}]}:respond(r)),bytes:1,finishReason:'stop'};
  }};
  const args={raw,body,bodySha256:sha(body),provider,rulesDir:path.resolve('rules'),beforeCall:async(stage:'extracting'|'planning')=>checkpoint=await store.save({...checkpoint,stage,attempts:checkpoint.attempts+1}),saveCheckpoint:async(value:Omit<ExtractionCheckpoint,'integrity'>)=>checkpoint=await store.save(value)};
  return {root,store,bundle,args,requests,get checkpoint(){return checkpoint;},reply:(fn:typeof respond)=>{respond=fn;},run:()=>runKnowledgePipeline({...args,checkpoint}),clean:()=>rm(root,{recursive:true,force:true})};
}

test('KB02 Q02 request puts business relevance before fragment ambiguity and supplies schema-valid counterexamples',async()=>{
  const f=await fixture();try{
    await f.run(); const prompt=f.requests[0].user;
    assert(prompt.indexOf('先判断业务陈述或非业务来源声明')<prompt.indexOf('仅对选入facts的业务陈述'));
    assert(prompt.includes('非业务标题、排版或来源说明即使fragment=true也不能进入facts/questions'));
    assert(prompt.includes('不能只凭标题形式、编号或“虚构/说明/未来”等词排除业务陈述'));
    assert(!prompt.includes('fragment必须ambiguous'));
    const line=prompt.split('\n').find(x=>x.startsWith('分类优先级示例'))!;
    const example=JSON.parse(line.slice(line.indexOf('{')));
    assert.deepEqual(validateSchema(example.output,f.bundle.kb02FactsSchema),[]);
    assert.deepEqual(example.atoms.slice(0,3).map((a:Atom)=>a.fragment),[true,false,true]);
    assert.deepEqual(example.output.sourceNotes.map((n:{atomId:string})=>n.atomId),example.atoms.slice(0,3).map((a:Atom)=>a.id));
    assert.deepEqual(example.output.facts,[{atomId:'示例业务片段',kind:'ambiguous'},{atomId:'示例业务边界',kind:'fact'}]);
    assert.deepEqual(example.output.questions,[{atomId:'示例业务未知'}]);
    const selectedNotes=new Set(example.output.sourceNotes.map((n:{atomId:string})=>n.atomId));
    assert([...example.output.facts,...example.output.questions].every((n:{atomId:string})=>!selectedNotes.has(n.atomId)));
  }finally{await f.clean();}
});

test('KB02 Q02 controlled correct classifications keep both title fragment forms and truncated layout out of business output',async()=>{
  const f=await fixture();try{
    const {outcome}=await f.run(),part=f.checkpoint.completedChunks[0];
    assert.deepEqual(part.sourceNotes?.map(n=>n.text),[title,title,layout]);
    assert.deepEqual(part.facts.slice(0,2).map(n=>n.text),[negative,future]);
    assert(part.facts.slice(2).every(n=>n.kind==='ambiguous')); assert.equal(part.facts.slice(2).map(n=>n.text).join(''),businessLong);
    assert.deepEqual(part.questions.map(q=>q.text),[unknown]);
    const planning=JSON.parse(f.requests[1].user.split('\n').at(-1)!);
    assert.deepEqual(planning.facts.map((x:{text:string})=>x.text),part.facts.map(x=>x.text));
    const business=JSON.stringify({planning:{facts:planning.facts,questions:planning.questions},document:outcome.document,pages:outcome.pages.map(({source_facts,open_questions})=>({source_facts,open_questions}))});
    for(const note of [title,layout])assert(!business.includes(JSON.stringify(note).slice(1,-1)));
    for(const context of planning.sourceContexts)assert.equal(context.text,text.slice(context.contextStart,context.contextEnd));
    assert(f.requests[1].system.includes('附近其它陈述只帮助定位，不能作为新增事实'));
    assert(outcome.pages[0].open_questions.some(q=>q.includes('原文口径或边界待确认：在售20家')));
    const noteIds=new Set(part.sourceNotes!.map(n=>n.atomId));
    assert([...part.facts,...part.questions].every(n=>n.atomId!==undefined&&!noteIds.has(n.atomId)));
    for(const e of outcome.pages[0].source_evidence)assert.equal(text.slice(e.start,e.end),e.quote);
    assert.equal(f.checkpoint.rawSha256,sha(text)); assert.equal(outcome.callCount,2);
  }finally{await f.clean();}
});

test('KB02 Q02 controlled omitted nonbusiness fragments are not promoted to facts or questions',async()=>{
  const f=await fixture();try{
    f.reply(r=>{const a=atomsOf(r);return {version:2,facts:a.filter(x=>[negative,future].includes(x.text)).map(x=>({atomId:x.id,kind:'fact'})),questions:a.filter(x=>x.text===unknown).map(x=>({atomId:x.id})),sourceNotes:[]};});
    const {outcome}=await f.run();assert.deepEqual(f.checkpoint.completedChunks[0].sourceNotes,[]);
    assert.deepEqual(outcome.pages[0].source_facts.map(x=>x.text),[negative,future]);
    assert.deepEqual(f.checkpoint.completedChunks[0].questions.map(x=>x.text),[unknown]);
    assert(!outcome.document.summary.includes('排版'));assert(!outcome.document.summary.includes('附页'));
  }finally{await f.clean();}
});

test('KB02 Q02 all nonbusiness title/layout variants still reject sourceNotes overlap without cleaning or retry',async()=>{
  for(const index of [0,1,2])for(const section of ['facts','questions']){
    const f=await fixture();try{
      f.reply(r=>{const notes=atomsOf(r).filter(a=>a.text===title||a.text===layout),atomId=notes[index].id;return {version:2,facts:section==='facts'?[{atomId,kind:'ambiguous'}]:[],questions:section==='questions'?[{atomId}]:[],sourceNotes:[{atomId}]};});
      await assert.rejects(f.run(),(e:unknown)=>e instanceof LlmError&&e.code==='LLM_SCHEMA_INVALID'&&e.message==='来源声明与事实/问题分类冲突。');
      assert.equal(f.requests.length,1);assert.equal(f.checkpoint.completedChunks.length,0);assert.equal(f.checkpoint.attempts,1);
    }finally{await f.clean();}
  }
});

const originalPath='tests/acceptance/kb02-r2-q02-20261018-builder-seq62.json';
test('KB02 Q02 full seq62 original response and exact original atom catalog still reject offline',async()=>{
  const old=JSON.parse(await readFile(originalPath,'utf8')),f=await fixture(old.body);try{
    // Isolated rejection probe only: explicitly rebind historic six chunks to exercise chunk seven.
    // Production old-revision resume is separately required to reject before any write/call.
    const base={...old.oldCheckpoint,jobId:f.checkpoint.jobId,rawId:f.args.raw.id,rulesVersion:f.bundle.rulesVersion};
    for(const chunk of base.completedChunks)for(const e of chunk.evidence)e.rawId=f.args.raw.id;
    const checkpoint=await f.store.save(base),before=structuredClone(checkpoint.completedChunks),callsBefore=f.requests.length;
    f.reply(r=>{assert.deepEqual(atomsOf(r),old.atoms.filter((atom:Atom)=>atom.text.trim().length>0));return old.response;});
    await assert.rejects(runKnowledgePipeline({...f.args,checkpoint,beforeCall:async(stage)=>f.store.save({...checkpoint,stage,attempts:checkpoint.attempts+1})}),
      (e:unknown)=>e instanceof LlmError&&e.code==='LLM_SCHEMA_INVALID'&&e.message==='来源声明与事实/问题分类冲突。');
    assert.equal(f.requests.length-callsBefore,1);assert.deepEqual((await f.store.get(checkpoint.jobId))!.completedChunks,before);assert(!(await f.store.get(checkpoint.jobId))!.plan);
    assert.equal(sha(old.body),old.bodySha256); assert.equal(validateSchema(old.response,f.bundle.kb02FactsSchema).length,0);
  }finally{await f.clean();}
});

test('KB02 Q02 original revision4 six-chunk checkpoint is incompatible with zero calls and unchanged bytes',async()=>{
  const originalBytes=await readFile(originalPath),old=JSON.parse(originalBytes.toString()),f=await fixture(old.body);try{
    assert.equal(KB02_PROMPT_REVISION,'kb02-atoms-planning-11');assert.match(old.oldCheckpoint.rulesVersion,/kb02-atoms-planning-4-/u);
    assert.equal(old.oldCheckpoint.completedChunks.length,6);assert.equal(old.oldCheckpoint.completedChunks.flatMap((c:{facts:Array<{text:string}>})=>c.facts).filter((x:{text:string})=>/排版说明|长文验收附录/u.test(x.text)).length,11);
    const checkpoint=await f.store.save(old.oldCheckpoint),file=path.join(f.root,'state/extraction-checkpoints',checkpoint.jobId+'.json'),bytes=await readFile(file);
    const args={...f.args,raw:old.raw,checkpoint};
    for(const execute of [()=>validateKnowledgeCheckpoint(args),()=>runKnowledgePipeline(args)])await assert.rejects(execute(),(e:unknown)=>e instanceof LlmError&&e.code==='LLM_CHECKPOINT_INCOMPATIBLE'&&e.status===409);
    assert.deepEqual(await readFile(file),bytes);assert.equal(f.requests.length,0);assert.deepEqual(await readFile(originalPath),originalBytes);
  }finally{await f.clean();}
});
