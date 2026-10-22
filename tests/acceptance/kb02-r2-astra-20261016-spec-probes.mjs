import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildKnowledgeAtoms} from '../../services/llm/knowledge-atoms.ts';
import {buildEvidenceLocatorCatalog} from '../../services/llm/locators.ts';
import {chunkText} from '../../services/llm/chunk.ts';
import {ExtractionCheckpointStore} from '../../services/llm/checkpoints.ts';
import {runKnowledgePipeline,validateKnowledgeCheckpoint} from '../../services/llm/knowledge-extraction.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
import {RawStore} from '../../services/raw/store.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-r2-astra-spec-')),rows=[];
const sha=v=>createHash('sha256').update(v).digest('hex');
const record=async(id,fn)=>{try{rows.push({id,result:'PASS',evidence:await fn()});}catch(e){rows.push({id,result:'FAIL',error:e.stack});}};
const atomsFor=body=>chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).flatMap(c=>buildKnowledgeAtoms(body,buildEvidenceLocatorCatalog(body,c)));
async function pipeline(body,select){
 const raw={id:randomUUID(),title:'独立虚构边界资料',sourceType:'report',sourceName:'isolated',tags:[]};
 const dir=path.join(root,randomUUID()),store=new ExtractionCheckpointStore(dir);await store.initialize();
 const rulesDir=path.resolve('rules'),rules=await loadExtractionRules(rulesDir),calls=[];
 let checkpoint=await store.save({version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:rules.rulesVersion,providerIdentity:'isolated',chunks:chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end})),completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString()});
 const provider={name:'isolated-memory',model:'fixture',secrets:[],async complete(request){calls.push(request);const data=JSON.parse(request.user.slice(request.user.lastIndexOf('\n')+1));return {text:JSON.stringify(Array.isArray(data)?select(data):{version:2,document:{title:'边界核验',main_topic:'条件与口径'},pages:[{title:'业务边界',type:'metric',category:'metric',factIds:data.facts.map(f=>f.id),questionIds:data.questions.map(q=>q.id)}]}),bytes:100,finishReason:'stop'};}};
 const args={raw,body,bodySha256:sha(body),provider,rulesDir,beforeCall:async stage=>checkpoint=await store.save({...checkpoint,stage,attempts:checkpoint.attempts+1}),saveCheckpoint:async value=>checkpoint=await store.save(value)};
 const result=await runKnowledgePipeline({...args,checkpoint});return {result,args,calls,checkpoint};
}
await record('KSP01-negation-condition-cross-subject-exact-atoms',async()=>{
 const body='如果预算未获批，甲区域不得新增20家；乙区域的30家是历史覆盖，不是甲区域目标。AI目前未上线，仅在未来作为建议。';
 const atoms=atomsFor(body);assert.equal(atoms.map(a=>a.text).join(''),body);for(const a of atoms)assert.equal(body.slice(a.start,a.end),a.text);
 const p=await pipeline(body,a=>({version:2,facts:a.map(x=>({atomId:x.id,kind:'fact'})),questions:[],sourceNotes:[]}));assert.deepEqual(p.result.outcome.pages[0].source_facts.map(x=>x.text),atoms.map(a=>a.text));
 return {atomTexts:atoms.map(a=>a.text),factsPreserveNegations:true};
});
await record('KSP02-fragment-forced-ambiguous',async()=>{
 const body='只有预算获批且'+ '条件'.repeat(270)+'时才能新增20家。';
 const p=await pipeline(body,a=>({version:2,facts:a.map(x=>({atomId:x.id,kind:'fact'})),questions:[],sourceNotes:[]}));
 assert(p.checkpoint.completedChunks[0].facts.every(x=>x.kind==='ambiguous'));assert.equal(p.result.outcome.pages[0].open_questions.length,atomsFor(body).length);
 return {forcedAmbiguous:p.checkpoint.completedChunks[0].facts.length};
});
await record('KSP03-source-notes-and-summary-restore',async()=>{
 const body='甲区域当前在售20家，不代表目标。仅供虚构测试，不是公司事实。负责人未知。';
 const p=await pipeline(body,a=>({version:2,facts:[{atomId:a[0].id,kind:'fact'}],questions:[{atomId:a[2].id}],sourceNotes:[{atomId:a[1].id}]}));
 const planner=p.calls.at(-1).user;assert(!planner.includes('仅供虚构测试'));assert(!p.result.outcome.document.summary.includes('仅供虚构测试'));assert.equal(p.checkpoint.completedChunks[0].sourceNotes[0].text,'仅供虚构测试，不是公司事实。');
 for(const change of [c=>c.plan.document.summary='甲区域目标20家',c=>c.completedChunks[0].facts[0].text='甲区域目标20家']){const cp=structuredClone(p.checkpoint);change(cp);await assert.rejects(validateKnowledgeCheckpoint({...p.args,checkpoint:cp}),e=>e.code==='LLM_CHECKPOINT_CORRUPT');}
 await validateKnowledgeCheckpoint({...p.args,checkpoint:p.checkpoint});return {sourceNoteExcludedFromPlanningAndSummary:true,tamperRejected:2,cleanRestore:true};
});
await record('KSP04-natural-newline-semantic-limit',async()=>{
 const body='仅在预算获批时：\n甲区域新增20家。';const atoms=atomsFor(body);
 const p=await pipeline(body,a=>({version:2,facts:[{atomId:a.at(-1).id,kind:'fact'}],questions:[],sourceNotes:[]}));
 assert.equal(atoms.at(-1).fragment,false);assert.equal(p.result.outcome.pages[0].source_facts[0].text,'甲区域新增20家。');
 return {classification:'OBSERVED_MODEL_DEPENDENCY_NOT_REAL_QUALITY_FAILURE',atoms,summary:p.result.outcome.document.summary,openQuestions:p.result.outcome.pages[0].open_questions};
});
const raws=new RawStore(path.join(root,'workflow'));await raws.initialize();const wiki=new WikiStore(path.join(root,'workflow'),raws);await wiki.initialize();const workflows=new KnowledgeWorkflowStore(path.join(root,'workflow'),wiki,raws);await workflows.initialize();
const raw=await raws.create({title:'补充资料',sourceType:'report',sourceName:'虚构',tags:[],body:'甲区域在售20家。\n甲区域在售20家。'}),other=await raws.create({title:'同文另一来源',sourceType:'report',sourceName:'虚构',tags:[],body:raw.body});
const target=await wiki.create({title:'区域指标',type:'metric',category:'metric',sources:[other.id],tags:[],knowledge_status:'source_supported',confidence:'medium',source_level:'C',review_status:'unreviewed',aliases:[],body:'旧来源铺货率20%，KB02_HUMAN。'});
const quote='甲区域在售20家。',start=raw.body.lastIndexOf(quote),draftId=randomUUID(),pageId=randomUUID();
const draft={id:draftId,rawId:raw.id,revision:1,rawSha256:raw.bodySha256,pages:[{pageId,source_facts:[{text:quote,evidenceIds:['position-2']}],source_evidence:[{id:'position-2',rawId:raw.id,quote,start,end:start+quote.length}],ai_organized:[],ai_inferences:[],open_questions:[]}]};
let fakeCalls=0,output={suggestedAdditions:[],conflicts:[{text:'新旧口径需核对；保留旧20%与新来源在售20家。',evidenceId:'position-2'}],agreement:[],inferences:[],openQuestions:['时点是否相同？']};
const provider={name:'isolated-memory',model:'fixture',secrets:['fictional-ksp-key'],async complete(){fakeCalls++;return {text:JSON.stringify(output),finishReason:'stop',bytes:100};}};
const args={draftId,pageId,baseRevision:1,targetWikiId:target.id,draft,raw,target,provider};
await record('KSP05-update-invalid-directory-zero-provider',async()=>{
 const mutations=[x=>x.raw=other,x=>x.draft.pages[0].source_evidence[0].rawId=other.id,x=>x.draft.pages[0].source_evidence[0].start=String(start),x=>x.draft.pages[0].source_evidence[0].end=99999,x=>x.draft.pages[0].source_evidence[0].quote='目标20家',x=>x.draft.pages[0].source_facts[0].evidenceIds=[123],x=>x.draft.pages[0].source_facts[0].evidenceIds=['unknown'],x=>x.draft.pages[0].source_evidence.push({...x.draft.pages[0].source_evidence[0]}),x=>x.draft.pages[0].source_evidence.push({...x.draft.pages[0].source_evidence[0],id:'unbound'})];
 const n=fakeCalls;for(const mutate of mutations){const x={...args,draft:structuredClone(draft)};mutate(x);await assert.rejects(workflows.createUpdate(x),e=>e.code==='EVIDENCE_INVALID');}assert.equal(fakeCalls,n);return {rejected:mutations.length,providerCalls:0};
});
await record('KSP06-update-provider-id-types-and-unknown',async()=>{
 const original=output;for(const id of [42,null,{},'unknown']){output={...original,conflicts:[{text:'受控错误返回',evidenceId:id}]};await assert.rejects(workflows.createUpdate(args),e=>['EVIDENCE_INVALID','LLM_SCHEMA_INVALID'].includes(e.code));}output=original;return {rejected:4};
});
await record('KSP07-legacy-storage-read-edit-confirm-replay',async()=>{
 const flow=await workflows.createUpdate(args);assert.equal(flow.evidence[0].start,start);assert(!('evidenceId' in flow.evidence[0]));
 const read=await workflows.get(flow.id);const sections=structuredClone(read.sections);sections.openQuestions.push('人工保留 KB02_HUMAN 核验');const edited=await workflows.patch(flow.id,flow.revision,sections);
 const first=await workflows.confirm(flow.id,edited.revision,'ksp-confirm');const second=await workflows.confirm(flow.id,edited.revision,'ksp-confirm');const final=await wiki.get(target.id);assert(final.body.includes('KB02_HUMAN'));assert(final.sources.includes(raw.id)&&final.sources.includes(other.id));
 return {position:start,readOldShape:true,edited:true,confirmed:true,replayed:true,revision:final.revision};
});
const report={at:new Date().toISOString(),root,scope:'controlled Spec only; synthetic in-memory provider; no browser; no external calls',externalCalls:0,workflowFakeCalls:fakeCalls,rows,summary:{pass:rows.filter(r=>r.result==='PASS').length,fail:rows.filter(r=>r.result==='FAIL').length}};
await fs.writeFile('docs/reports/KB02-R2-ASTRA-20261016-spec-probes.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
