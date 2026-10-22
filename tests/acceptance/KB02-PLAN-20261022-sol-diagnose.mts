import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coverageDiagnostic, hasCoverageErrors, buildKnowledgeAtoms } from '../../services/llm/knowledge-atoms.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { candidatePlanningInput, candidatePlannerInstruction } from './KB02-PLAN-20261022-sol-context-poc.ts';
const prefix='docs/reports/KB02-PLAN-20261022-sol-',old='docs/reports/KB02-FINAL-REPAIR-AUDIT-20261022-';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const traces=(await fs.readFile(old+'provider-trace.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const cases=[{seq:100,job:'fced5619-1e36-4d9f-a4ed-af54e39276c8',raw:'cb682823-26f1-4a8d-8e6e-4caadf8931ad'},{seq:104,job:'79b2825a-884f-43e8-9045-1d3f72ee430e',raw:'0bf75e35-7f25-4f7c-bc3d-fb9e93e789b9'}];
const result:any={at:new Date().toISOString(),realProviderCalls:0,checks:[],cases:[],calibration:['Baseline script initial syntax error corrected before baseline; first inline trace inspection used seq instead of sequence and failed read-only. Neither invoked a provider.']};
const check=(name:string,fn:()=>void)=>{fn();result.checks.push({name,ok:true});};
for(const c of cases) {
  const cp=await read(old+'checkpoint-'+c.job+'.json'), raw=await read(old+'raw-'+c.raw+'.json'), trace=traces.find(t=>t.sequence===c.seq),plan=JSON.parse(trace.response.content),payload=JSON.parse(trace.request.messages.find((m:any)=>m.role==='user').content.split('\n').at(-1));
  const facts=cp.completedChunks.flatMap((p:any)=>p.facts),questions=cp.completedChunks.flatMap((p:any)=>p.questions);
  check(`${c.seq} exact raw/checkpoint hash`,()=>assert.equal(sha(raw.body),cp.rawSha256));
  check(`${c.seq} trace input all facts/questions byte-exact`,()=>assert.deepEqual(payload,{facts:facts.map(({id,text,kind}:any)=>({id,text,kind})),questions:questions.map(({id,text}:any)=>({id,text}))}));
  const atoms=new Map(chunkText(raw.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(ch=>[ch.index,new Map(buildKnowledgeAtoms(raw.body,buildEvidenceLocatorCatalog(raw.body,ch)).map(a=>[a.id,a]))]));
  const all=[...facts.map((i:any)=>({...i,column:'facts'})),...questions.map((i:any)=>({...i,column:'questions'}))];
  const bindings=all.map(item=>{
    const atom=atoms.get(item.chunkIndex)!.get(item.atomId)!;assert.equal(atom.text,item.text);
    const preceding=raw.body.slice(0,atom.start),region=[...preceding.matchAll(/虚构区域(\d{2})/gu)].at(-1)?.[1],own=item.text.match(/虚构区域(\d{2})/u)?.[1];
    const expectedRegion=c.seq===100?own??region:undefined;
    const assigned=plan.pages.filter((p:any)=>(item.column==='facts'?p.factIds:p.questionIds).includes(item.id)).map((p:any)=>p.title);
    return {...item,start:atom.start,end:atom.end,expectedRegion,assigned,wrongRegion:assigned.some((t:string)=>c.seq===100&&t.match(/虚构区域(\d{2})/u)?.[1]!==expectedRegion)};
  });
  const bySpan=new Map<string,any[]>();for(const i of bindings){const key=`${i.column}|${i.start}|${i.end}`;bySpan.set(key,[...(bySpan.get(key)??[]),i]);}
  const duplicates=[...bySpan.values()].filter(a=>a.length>1).map(a=>({column:a[0].column,start:a[0].start,end:a[0].end,ids:a.map(i=>i.id),pages:[...new Set(a.flatMap(i=>i.assigned))]}));
  const diagnostic=coverageDiagnostic(facts.map((f:any)=>f.id),questions.map((q:any)=>q.id),plan.pages);
  check(`${c.seq} original response still rejected by coverage`,()=>assert.equal(hasCoverageErrors(diagnostic),true));
  check(`${c.seq} exact original missing diagnostics`,()=>assert.deepEqual(diagnostic,cp.lastError.diagnostic));
  let current=structuredClone(cp),calls=0,caught:any;
  try{await runKnowledgePipeline({raw,body:raw.body,bodySha256:raw.bodySha256,provider:{name:'offline',model:'fixture',complete:async req=>{calls++;assert.deepEqual(JSON.parse(req.user.split('\n').at(-1)!),payload);return {text:trace.response.content,bytes:Buffer.byteLength(trace.response.content),finishReason:'stop'};}},rulesDir:'rules',checkpoint:current,beforeCall:async stage=>(current={...current,attempts:current.attempts+1,stage}),saveCheckpoint:async v=>(current=v as any)});}catch(e){caught=e;}
  check(`${c.seq} product pipeline offline replay rejects no plan`,()=>{assert.equal(caught?.code,'LLM_PLAN_COVERAGE_INVALID');assert.equal(calls,1);assert.equal(current.plan,undefined);assert.deepEqual(current.lastError.diagnostic,diagnostic);});
  const candidate=candidatePlanningInput(raw.body,cp);
  check(`${c.seq} candidate retains all IDs/text/classification`,()=>{assert.deepEqual(candidate.facts.map(({sourceId,...i})=>i),payload.facts);assert.deepEqual(candidate.questions.map(({sourceId,...i})=>i),payload.questions);});
  check(`${c.seq} candidate context exact and within bounds`,()=>{for(const s of candidate.sourceContexts){assert.equal(s.text,raw.body.slice(s.contextStart,s.contextEnd));assert(s.start>=s.contextStart&&s.end<=s.contextEnd);assert(s.start-s.contextStart<=257&&s.contextEnd-s.end<=129);}});
  check(`${c.seq} candidate within unchanged 192KiB`,()=>assert(Buffer.byteLength(JSON.stringify(candidate))<=192*1024));
  if(c.seq===100)check('all 106 records have original area visible in local preceding context',()=>{for(const b of bindings){const s=candidate.sourceContexts.find(s=>s.id===`s-${b.start}-${b.end}`)!;const localBefore=s.text.slice(0,b.start-s.contextStart);const r=b.text.match(/虚构区域(\d{2})/u)?.[1]??[...localBefore.matchAll(/虚构区域(\d{2})/gu)].at(-1)?.[1];assert.equal(r,b.expectedRegion);}});
  await fs.writeFile(prefix+`seq${c.seq}-candidate-input.json`,JSON.stringify(candidate,null,2));
  result.cases.push({sequence:c.seq,rawHash:sha(raw.body),sourceTraceHash:sha(await fs.readFile(old+'provider-trace.jsonl')),checkpointHash:sha(await fs.readFile(old+'checkpoint-'+c.job+'.json')),facts:facts.length,questions:questions.length,inputBytes:Buffer.byteLength(JSON.stringify(payload)),candidateInputBytes:Buffer.byteLength(JSON.stringify(candidate)),sourceContextCount:candidate.sourceContexts.length,diagnostic,wrongRegionRecords:bindings.filter(b=>b.wrongRegion).length,pagesWithWrongRegion:plan.pages.filter((p:any)=>bindings.some(b=>b.wrongRegion&&b.assigned.includes(p.title))).length,sameColumnOverlapGroups:duplicates.length,sameColumnOverlapExtraRecords:duplicates.reduce((n,g)=>n+g.ids.length-1,0),duplicates,bindings});
}
// Same source text at distinct positions must remain distinct, and cross-column records keep both IDs.
const long=result.cases[0];check('same text at distinct source positions is not one record',()=>{const qs=long.bindings.filter((b:any)=>b.column==='questions');assert.equal(new Set(qs.map((q:any)=>q.text)).size,1);assert.equal(new Set(qs.map((q:any)=>q.start)).size,14);});
result.candidateInstruction=candidatePlannerInstruction;
await fs.writeFile(prefix+'analysis.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({checks:result.checks.length,cases:result.cases.map(({bindings,duplicates,...c}:any)=>c),realProviderCalls:0}));
