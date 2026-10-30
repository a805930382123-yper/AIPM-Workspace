import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {deepFixture} from './support/kb03-deep-fixture.ts';
import {approveDraft} from './support/human-review.ts';
import {ExtractionCheckpointStore} from '../services/llm/checkpoints.ts';
import type {StructuredNote} from '../services/wiki/structured-note.ts';

async function candidate(){const f=await deepFixture();f.mutate((s,v)=>{if(s==='quality')v.findings=[{severity:'warning',category:'semantic',sectionId:'core',blockIndex:0,reason:'生成时原警告保持。'}];return v;});const r=await f.start();const runtime=await f.wait(r.json.jobId);assert.equal(runtime.job?.status,'completed');const d=await approveDraft(f.drafts,runtime.job!.draftId!,f.raw.body);return {...f,d,jobId:r.json.jobId};}
async function patch(f:Awaited<ReturnType<typeof candidate>>,value:unknown){const response=await fetch(f.http.base+`/api/drafts/${f.d.id}/structured-note`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:response.status,json:await response.json() as any};}
test('KB03 review cell edit invalidates all approvals, preserves historic report/checkpoint/Raw and reuses edited draft without Provider',async()=>{
 const f=await candidate();try{const before=JSON.stringify(f.d.humanReview!.units),report=JSON.stringify(f.d.qualityReport),oldDigest=f.drafts.contentDigest(f.d),cpBefore=await readFile(path.join(f.root,'state/extraction-checkpoints',f.jobId+'.json'));const note=structuredClone(f.d.structuredNote!);const table=note.sections[0].blocks.find(b=>b.type==='table')!;assert(table.type==='table');table.rows[0].cells[1]='人工说明，待核对';
 const result=await patch(f,{baseRevision:f.d.revision,structuredNote:note,exclusions:[],questionIds:[],humanQuestions:['人工补充负责人问题']});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.json.revision,f.d.revision+1);assert.equal(result.json.noteQualityStatus,'historical');assert.equal(result.json.humanReview.approvals.length,0);assert.equal(JSON.stringify(result.json.qualityReport),report);assert.equal(JSON.stringify(result.json.humanReview.units),before);assert.notEqual(result.json.reviewContentDigest,oldDigest);
 const read=await f.http.request(`/api/drafts/${f.d.id}`);assert.deepEqual(read.json.structuredNote,note);assert.deepEqual(read.json.noteReview.humanQuestions,['人工补充负责人问题']);assert.equal(read.json.noteQualityStatus,'historical');
 const used=f.requests.length,resumed=await f.start();assert.equal(resumed.status,200);assert.equal(resumed.json.draftId,f.d.id);assert.equal(f.requests.length,used);assert.deepEqual((await f.drafts.get(f.d.id))!.structuredNote,note);assert.deepEqual(await readFile(path.join(f.root,'state/extraction-checkpoints',f.jobId+'.json')),cpBefore);assert.equal((await f.rawStore.get(f.raw.id))!.body,f.raw.body);
 const unchanged=await patch(f,{baseRevision:result.json.revision,structuredNote:note,exclusions:[],questionIds:[],humanQuestions:['人工补充负责人问题']});assert.equal(unchanged.json.revision,result.json.revision);
 const formal=await f.http.request(`/api/drafts/${f.d.id}/confirm`,{baseRevision:result.json.revision,selectedPageIds:[f.d.pages[0].pageId],idempotencyKey:'blocked'});assert.equal(formal.status,409);assert.equal(formal.json.error.code,'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE');
 }finally{await f.clean();}
});
test('KB03 review deleting unique fact chapter exposes uncovered, only explicit nonempty reason excludes, original units remain',async()=>{
 const f=await candidate();try{const facts=f.d.humanReview!.units.filter(u=>u.kind==='fact').flatMap(u=>u.records);assert(facts.length>=2);let note:StructuredNote={version:1,orientation:'人工阅读',sections:facts.map((fact,i)=>({id:'section-'+i,title:'来源'+i,question:'原文是什么？',blocks:[{type:'paragraph',text:fact.text,role:'source_supported',factIds:[fact.id]}]}))};
 let result=await patch(f,{baseRevision:f.d.revision,structuredNote:note});assert.equal(result.status,200);const removed=facts[0].id;note={...note,sections:note.sections.slice(1)};result=await patch(f,{baseRevision:result.json.revision,structuredNote:note});assert.equal(result.status,200);assert.equal(result.json.noteCoverage.find((c:any)=>c.id===removed).status,'uncovered');assert.equal(JSON.stringify(result.json.humanReview.units),JSON.stringify(f.d.humanReview!.units));
 const empty=await patch(f,{baseRevision:result.json.revision,structuredNote:note,exclusions:[{kind:'fact',id:removed,reason:''}]});assert.equal(empty.status,400);
 const excluded=await patch(f,{baseRevision:result.json.revision,structuredNote:note,exclusions:[{kind:'fact',id:removed,reason:'本节另行整理，原文目录保留。'}]});assert.equal(excluded.status,200);assert.equal(excluded.json.noteCoverage.find((c:any)=>c.id===removed).status,'excluded');assert.equal(excluded.json.qualityReport.findings[0].reason,'生成时原警告保持。');assert.equal(excluded.json.noteQualityStatus,'historical');
 }finally{await f.clean();}
});
test('KB03 review strict HTTP rejects protected fields/invalid references/empty reason/path/revision without writing',async()=>{
 const f=await candidate();try{const file=path.join(f.root,'drafts',f.d.id+'.json'),before=await readFile(file);const valid={baseRevision:f.d.revision,structuredNote:f.d.structuredNote};
 const badNote=(fn:(v:any)=>void)=>{const note=structuredClone(f.d.structuredNote!);fn(note);return {...valid,structuredNote:note};};
 for(const input of [{...valid,humanReview:{}},{...valid,qualityReport:{}},{...valid,noteReview:{}},{...valid,exclusions:[{kind:'fact',id:'unknown',reason:'假的'}]},{...valid,questionIds:['unknown']},badNote(n=>n.sections[0].blocks[0].factIds=['fake']),badNote(n=>{const b=n.sections[0].blocks.find((b:any)=>b.type==='callout');b.reason='';}),badNote(n=>{const b=n.sections[0].blocks.find((b:any)=>b.type==='path_diagram');b.edges[0].to='fake';}),{...valid,baseRevision:1}]){const result=await patch(f,input);assert(result.status>=400,JSON.stringify(result));assert.deepEqual(await readFile(file),before);}
 for(const key of ['noteReview','structuredNote','qualityReport']){const result=await fetch(f.http.base+`/api/drafts/${f.d.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:f.d.revision,[key]:{}})});assert.equal(result.status,400);}
 }finally{await f.clean();}
});
test('KB03 review human numeric changes save as pending with warning and no automatic correction or request',async()=>{
 const f=await candidate();try{const note=structuredClone(f.d.structuredNote!);const b=note.sections[0].blocks[0];assert(b.type==='paragraph');b.text='人工改成120家。';const used=f.requests.length,result=await patch(f,{baseRevision:f.d.revision,structuredNote:note});assert.equal(result.status,200);assert(result.json.noteWarnings.some((w:string)=>w.includes('数值')));assert.equal(result.json.structuredNote.sections[0].blocks[0].text,'人工改成120家。');assert.equal(f.requests.length,used);}finally{await f.clean();}
});
test('KB03 review changed Raw SHA prevents edits and preserves draft bytes',async()=>{
 const f=await candidate();try{const file=path.join(f.root,'drafts',f.d.id+'.json'),before=await readFile(file);await assert.rejects(f.drafts.editStructuredNote(f.d.id,{baseRevision:f.d.revision,structuredNote:f.d.structuredNote},'changed Raw'),{code:'RAW_CHANGED'});assert.deepEqual(await readFile(file),before);
 const rawFile=path.join(f.root,'knowledge/raw/reports',f.raw.id+'.md'),original=await readFile(rawFile,'utf8');await writeFile(rawFile,original.replace(f.raw.body,'changed Raw'));const response=await patch(f,{baseRevision:f.d.revision,structuredNote:f.d.structuredNote});assert(response.status>=400);assert.deepEqual(await readFile(file),before);await writeFile(rawFile,original);
 const cp=(await new ExtractionCheckpointStore(f.root).get(f.jobId))!;assert.equal(cp.stage,'done');
 }finally{await f.clean();}
});
