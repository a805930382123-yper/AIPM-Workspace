import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chunkText} from '../../services/llm/chunk.ts';
import {runKnowledgePipeline} from '../../services/llm/knowledge-extraction.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
import {KNOWLEDGE_SEMANTIC_REVIEW_INSTRUCTION} from '../../services/llm/knowledge-semantic-review.ts';
import {validateSchema} from '../../services/llm/schema-validator.ts';

const started=Date.now(),p='docs/reports/KB02-SEMANTIC-AUDIT-20261023-',out='docs/reports/KB02-SEMANTIC-DIAG-20261023-';
const sha=b=>createHash('sha256').update(b).digest('hex');
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw Error('Offline diagnosis forbids network');};
const frozenBytes=await fs.readFile('docs/reports/KB02-SEMANTIC-20261023-frozen.json');
assert.equal(sha(frozenBytes),'1cdc22d855c3a4e2175cfe22899799a49471f14ff355d6cf99669ed90220d421');
const frozen=JSON.parse(frozenBytes),closure=JSON.parse(await fs.readFile('docs/reports/KB02-SEMANTIC-20261023-closure.json','utf8'));
const protectPaths=[...new Set([...frozen.files.map(f=>f.path),...closure.protectedFiles.map(f=>f.path),p+'fixtures.json',p+'provider-trace.jsonl',p+'provider-attempts.jsonl',p+'supplement-original-http.json',p+'independent-ai-positive-http.json'])];
const hashes=async()=>Object.fromEntries(await Promise.all(protectPaths.map(async file=>[file,sha(await fs.readFile(file))])));
const before=await hashes();
for(const f of frozen.files)assert.equal(before[f.path],f.sha256,'frozen source mismatch: '+f.path);
const traceBytes=await fs.readFile(p+'provider-trace.jsonl'),trace=traceBytes.toString().trim().split('\n').map(JSON.parse),bySeq=new Map(trace.map(row=>[row.sequence,row]));
const attempts=(await fs.readFile(p+'provider-attempts.jsonl','utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(attempts.map(r=>r.sequence),[204,205,206,207,208,209]);
const fixtureBytes=await fs.readFile(p+'fixtures.json');assert.equal(sha(fixtureBytes),'5cc5a6bdcb10738687e226bfca86e52a9a037ddad57d5eac492365c16745fbc5');
const fixtures=JSON.parse(fixtureBytes).fixtures,bundle=await loadExtractionRules('rules');
const system=`${KNOWLEDGE_SEMANTIC_REVIEW_INSTRUCTION}\n严格遵守schema：${JSON.stringify(bundle.kb02SemanticReviewSchema)}`;
const request=(row,role)=>row.request.messages.find(m=>m.role===role).content;
const parsed=row=>JSON.parse(row.response.content);
const selectPage=page=>({title:page.title,type:page.type,category:page.category,one_line_definition:page.one_line_definition,source_facts:page.source_facts,open_questions:page.open_questions});
for(const seq of [206,209]){const row=bySeq.get(seq);assert.equal(row.status,200);assert.equal(row.response.finishReason,'stop');assert.equal(request(row,'system'),system);assert.deepEqual(JSON.parse(system.split('\n严格遵守schema：')[1]),bundle.kb02SemanticReviewSchema);}

async function replay(id,seqs,control){
 const sample=fixtures.find(f=>f.id===id),actual=JSON.parse(await fs.readFile(p+id+'-http.json','utf8'));
 assert.equal(sha(sample.body),sample.sha256);
 const first=bySeq.get(seqs[0]),meta=request(first,'user').match(/来源标题：([^；]+)；类型：([^；]+)；来源：([^;]+); Raw ID：([^\n]+)/u);assert(meta);
 const raw={id:actual.rawId,title:meta[1],sourceType:meta[2],sourceName:meta[3],tags:[]};assert.equal(raw.id,meta[4]);
 let checkpoint={version:1,jobId:actual.jobId,rawId:raw.id,rawSha256:sample.sha256,pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'offline|trace',chunks:chunkText(sample.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:'2026-10-23T00:00:00.000Z',integrity:'memory'};
 let calls=0;const saves=[],requests=[];
 const provider={name:'offline-trace',model:'GLM-5.3-Flash',complete:async r=>{const row=bySeq.get(seqs[calls++]);assert(row,'unexpected extra call');assert.equal(r.system,request(row,'system'));assert.equal(r.user,request(row,'user'));requests.push({sequence:row.sequence,systemSha256:sha(r.system),userSha256:sha(r.user),exactSystem:true,exactUser:true});const value=control&&row.sequence===seqs.at(-1)?control(parsed(row)):undefined;return{text:value?JSON.stringify(value):row.response.content,finishReason:row.response.finishReason,bytes:Buffer.byteLength(value?JSON.stringify(value):row.response.content)};}};
 let outcome,error;
 try{outcome=(await runKnowledgePipeline({raw,body:sample.body,bodySha256:sample.sha256,provider,rulesDir:'rules',checkpoint,beforeCall:async stage=>checkpoint={...checkpoint,stage,attempts:checkpoint.attempts+1},saveCheckpoint:async value=>{saves.push(structuredClone(value));return checkpoint=value;}})).outcome;}catch(e){error={code:e.code,message:e.message,status:e.status};}
 assert.equal(calls,3);assert.equal(checkpoint.attempts,3);assert.equal(checkpoint.completedChunks.length,1);
 if(!control&&id==='supplement-original'){assert(outcome);assert(checkpoint.plan);assert.deepEqual(outcome.pages.map(selectPage),actual.draft.pages.map(selectPage));assert.equal(outcome.pages.length,3);}
 if(!control&&id==='independent-ai-positive'){assert.equal(error.code,'LLM_SCHEMA_INVALID');assert.equal(actual.job.error.code,error.code);assert(!checkpoint.plan);assert(saves.every(c=>!c.plan));assert.equal(actual.job.draftId,null);}
 return{id,control:!!control,requests,calls,attempts:checkpoint.attempts,validatedChunks:checkpoint.completedChunks.length,planSaved:!!checkpoint.plan,pages:outcome?.pages.map(selectPage),error,sourceFacts:checkpoint.completedChunks.flatMap(c=>c.facts.map(f=>({id:f.id,text:f.text}))),sourceQuestions:checkpoint.completedChunks.flatMap(c=>c.questions.map(f=>({id:f.id,text:f.text})))};
}
const bad=await replay('supplement-original',[204,205,206]);
const goodFailed=await replay('independent-ai-positive',[207,208,209]);
const rejectedControl=await replay('supplement-original',[204,205,206],value=>{value.pages[2].decision='reject';value.pages[2].code='UNSUPPORTED_TOPIC';return value;});assert.equal(rejectedControl.error.code,'LLM_PLAN_SEMANTIC_REJECTED');assert(!rejectedControl.planSaved);
const positiveShapeControl=await replay('independent-ai-positive',[207,208,209],value=>({version:1,pages:[{...value.pages[1],reason:'人工夹具仅验证既有规划可表达且严格门禁可接受；不证明模型会正确响应。'}]}));assert(positiveShapeControl.planSaved);assert.equal(positiveShapeControl.pages.length,1);
const row206=parsed(bySeq.get(206)),row209=parsed(bySeq.get(209)),input206=JSON.parse(request(bySeq.get(206),'user').split('\n').at(-1)),input209=JSON.parse(request(bySeq.get(209),'user').split('\n').at(-1));
assert.deepEqual(validateSchema(row206,bundle.kb02SemanticReviewSchema),[]);
const issues209=validateSchema(row209,bundle.kb02SemanticReviewSchema);assert.equal(issues209.filter(s=>s.includes('reason')).length,2);
assert.equal(row209.pages.length,2);assert.equal(input209.plan.pages.length,1);assert.equal(new Set(row209.pages.map(p=>p.pageIndex)).size,1);assert.equal(new Set(row209.pages[0].unitIds).size,row209.pages[0].unitIds.length-1);
assert.equal(input206.input.sourceContexts.length,5);assert(input206.input.sourceContexts.every(s=>s.text===fixtures.find(f=>f.id==='supplement-original').body));
const boundary=input206.input.factUnits.find(u=>u.id===input206.plan.pages[2].factUnitIds[0]);assert.equal(boundary.text,'AI异常提示为未来建议，无上线或收益事实。');
const after=await hashes();assert.deepEqual(after,before);assert.equal(networkAttempts,0);
const report={at:new Date().toISOString(),node:process.version,elapsedMs:Date.now()-started,baseHead:'0e44ab5563e5de3f4cdd8ed663a51393fde53422',frozenSha256:sha(frozenBytes),frozenFilesVerified:frozen.files.length,protectedPaths:protectPaths.length,unchanged:true,traceSha256:sha(traceBytes),attemptSequences:attempts.map(r=>r.sequence),auditSystemExact:[206,209],auditSchemaExact:[206,209],badCandidate:{boundaryUnit:boundary,rawReview:row206,schemaIssues:[],fullExactContexts:5,mechanism:'Provider explicitly returned pass/OK for the unsupported boundary-only page; structural gate correctly accepts that shape and persists the plan. The reviewer reason makes an unsupported independence claim. Assembly copies the accepted title and original fact.'},positiveFailure:{rawReview:row209,schemaIssues:issues209,candidatePages:input209.plan.pages.length,responsePages:row209.pages.length,duplicatePageIndex:true,duplicateUnitInFirstPage:true,missingReasonCount:2,mechanism:'Raw Provider JSON already violates the contract; strict validation rejects before plan save. No response repair or post-processing divergence.'},cases:[bad,goodFailed,rejectedControl,positiveShapeControl],guarantee:'Trace replay proves visible requests, raw outputs and pipeline behavior only; model internal cause and generalized semantic accuracy remain unproved.',realProviderCalls:0,networkAttempts,kb02Budget:'209/500 unchanged',promptBudget:'15/24 unchanged',protectionBefore:before,protectionAfter:after};
await fs.writeFile(out+'replay.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({elapsedMs:report.elapsedMs,exactRequests:12,frozenFiles:report.frozenFilesVerified,protectedPaths:report.protectedPaths,cases:report.cases.map(c=>({id:c.id,control:c.control,planSaved:c.planSaved,error:c.error?.code})),realProviderCalls:0,networkAttempts}));
