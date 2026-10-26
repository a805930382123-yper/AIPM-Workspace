import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import test from 'node:test';
import {r12Fixture,questionUnitIds,markedText} from './acceptance/R12-20261026-fixture.ts';
import {DraftStore} from '../services/wiki/drafts.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {WikiCommitService} from '../services/wiki/commits.ts';
import {approveDraft} from './support/human-review.ts';
import {isExtractionDraft} from '../services/storage/record-validators.ts';

test('R12 original C explicit question references preserve source records, invalidate approvals, persist and formally render',async()=>{
 const f=await r12Fixture();try{
  let d=f.draft;const oldPages=structuredClone(d.pages),oldReview=structuredClone(d.humanReview!);
  const affected=questionUnitIds.map(id=>oldReview.assignments[id]);
  assert(affected.every(id=>!d.pages.find(p=>p.pageId===id)!.open_questions.length));
  const before=await readFile(f.file);await f.drafts.get(d.id);assert.deepEqual(await readFile(f.file),before);
  d=await approveDraft(f.drafts,d.id,f.raw.body);const oldDigest=f.drafts.contentDigest(d),revision=d.revision;
  const result=await f.h.request(`/api/drafts/${d.id}/review/questions`,{baseRevision:revision,unitIds:questionUnitIds,marked:true});assert.equal(result.status,200);d=result.json;
  assert.deepEqual(d.humanQuestionUnitIds,questionUnitIds);assert.equal(d.humanReview!.approvals.length,0);assert.notEqual(f.drafts.contentDigest(d),oldDigest);
  assert.deepEqual(d.humanReview!.units,oldReview.units);assert.equal(d.humanReview!.basisDigest,oldReview.basisDigest);
  for(const p of d.pages){assert.deepEqual(p.source_facts,oldPages.find(x=>x.pageId===p.pageId)!.source_facts);assert.deepEqual(p.source_evidence,oldPages.find(x=>x.pageId===p.pageId)!.source_evidence);if(affected.includes(p.pageId))assert.deepEqual(p.open_questions,[markedText]);}
  assert.equal((await f.h.request(`/api/drafts/${d.id}/review/questions`,{baseRevision:revision,unitIds:questionUnitIds,marked:true})).status,409);
  await assert.rejects(f.drafts.reviewOperation(d.id,{action:'page',baseRevision:d.revision,pageId:d.pages[0].pageId,reviewContentDigest:oldDigest,confirmed:true},f.context),{code:'REVIEW_CONTENT_CHANGED'});
  const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();
  const input=()=>({draftId:d.id,baseRevision:d.revision,selectedPageIds:[affected[0] as string],idempotencyKey:randomUUID(),operationId:randomUUID(),now:new Date().toISOString()});
  await assert.rejects(wiki.withLock(()=>commits.confirm(input())),{code:'HUMAN_REVIEW_INCOMPLETE'});assert.equal((await wiki.allRecords()).length,0);
  const restarted=new DraftStore(f.root);await restarted.initialize();d=(await restarted.get(d.id))!;assert.deepEqual(d.humanQuestionUnitIds,questionUnitIds);
  d=await approveDraft(restarted,d.id,f.raw.body);const completed=await wiki.withLock(()=>commits.confirm(input()));assert.equal(completed.manifest.status,'completed');
  const records=await wiki.allRecords();assert(records.some(r=>r.type!=='source'&&r.body.includes(markedText)));assert.equal((await f.rawStore.get(f.raw.id))!.body,f.raw.body);assert.equal(f.requests.length,0);
  assert.equal((await f.h.request(`/api/drafts/${d.id}/review/questions`,{baseRevision:(await f.drafts.get(d.id))!.revision,unitIds:questionUnitIds,marked:false})).status,409);
 }finally{await f.close();}
});

test('R12 reversible marks follow units, preserve native questions and custom Source, reject bad inputs and persisted marks',async()=>{
 const f=await r12Fixture();try{
  let d=f.draft;const baseline=structuredClone(d.pages),unitId=questionUnitIds[0],owner=d.humanReview!.assignments[unitId]!,target=d.pages[0].pageId;
  const mark=async(marked:boolean)=>d=await f.drafts.reviewOperation(d.id,{action:'questions',baseRevision:d.revision,unitIds:[unitId],marked},f.context);
  d.source.body='人工自定义来源正文';d.source.bodyEditedByUser=true;d.source.key_takeaways=['人工要点'];await writeFile(f.file,JSON.stringify(d));
  await mark(true);const markedRevision=d.revision;await mark(true);assert.equal(d.revision,markedRevision);assert.equal(d.source.body,'人工自定义来源正文');assert.deepEqual(d.source.key_takeaways,['人工要点']);
  d=await f.drafts.reviewOperation(d.id,{action:'move',baseRevision:d.revision,unitIds:[unitId],pageId:target},f.context);
  assert(d.pages.find(p=>p.pageId===target)!.open_questions.includes(markedText));assert(!d.pages.find(p=>p.pageId===owner)!.open_questions.includes(markedText));
  d=await f.drafts.reviewOperation(d.id,{action:'move',baseRevision:d.revision,unitIds:[unitId],pageId:null},f.context);await assert.rejects(f.drafts.assertReviewed(d,f.raw.body),{code:'HUMAN_REVIEW_INCOMPLETE'});
  d=await f.drafts.reviewOperation(d.id,{action:'move',baseRevision:d.revision,unitIds:[unitId],pageId:owner},f.context);await mark(false);
  assert.equal(d.humanQuestionUnitIds,undefined);for(const p of d.pages)assert.deepEqual(p.open_questions,baseline.find(x=>x.pageId===p.pageId)!.open_questions);
  const question=d.humanReview!.units.find(u=>u.kind==='question')!;assert(question);
  const cases=[{unitIds:'bad',marked:true},{unitIds:[unitId,unitId],marked:true},{unitIds:['unknown'],marked:true},{unitIds:[question.id],marked:true},{unitIds:[unitId],marked:'true'},{unitIds:[unitId],marked:true,extra:1}];
  for(const bad of cases){const before=await readFile(f.file);assert((await f.h.request(`/api/drafts/${d.id}/review/questions`,{baseRevision:d.revision,...bad})).status>=400);assert.deepEqual(await readFile(f.file),before);}
  const response=await fetch(f.h.base+`/api/drafts/${d.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:d.revision,humanQuestionUnitIds:[unitId]})});assert.equal(response.status,400);
  for(const bad of ['bad',[unitId,unitId],['unknown'],[question.id]])assert.equal(isExtractionDraft({...d,humanQuestionUnitIds:bad}),false);
  assert.equal(isExtractionDraft({...d,humanReview:undefined,humanQuestionUnitIds:[unitId]}),false);assert.equal(isExtractionDraft(d),true);
  await mark(true);const rules=await new WikiStore(f.root,f.rawStore).schema();d=await f.drafts.patch(d.id,{baseRevision:d.revision,merge:{pageIds:[owner,target]}},{body:f.raw.body,rules:{types:rules.types.map(t=>t.id),categories:rules.categories.map(c=>c.id),...rules.enums} as any});
  const finalOwner=d.humanReview!.assignments[unitId];assert(d.pages.find(p=>p.pageId===finalOwner)!.open_questions.includes(markedText));assert.deepEqual(d.humanReview!.units,f.original.humanReview!.units);assert.equal(f.requests.length,0);
 }finally{await f.close();}
});
