import test from 'node:test';
import assert from 'node:assert/strict';
import {lwFixture} from './lw01-fixture.ts';
import {maintenanceDigest} from '../services/wiki/maintenance.ts';

test('LW01 repair: public unassigned fact blocks formal commit, restored ownership needs new item confirmation',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'未归属返修合成',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。\n有效门店15家。'});let d=await f.accept(await f.generate(raw.id));const unit=d.humanReview!.units[0],owner=d.humanReview!.assignments[unit.id];
  d=await f.drafts.reviewOperation(d.id,{baseRevision:d.revision,action:'move',unitIds:[unit.id],pageId:null},{body:raw.body,rulesDir:'rules'});assert(!d.maintenance!.changes[0].approval);d=await f.accept(d);await assert.rejects(f.confirm(d),{code:'HUMAN_REVIEW_INCOMPLETE'});assert.equal((await f.wiki.allRecords()).length,0);
  d=await f.drafts.reviewOperation(d.id,{baseRevision:d.revision,action:'move',unitIds:[unit.id],pageId:owner},{body:raw.body,rulesDir:'rules'});assert(!d.maintenance!.changes[0].approval);await assert.rejects(f.confirm(d),{code:'CHANGE_REVIEW_REQUIRED'});await f.confirm(await f.accept(d));
});

test('LW01 repair: draft+key rejects changed selection after partial completion; same payload retries reuse; new key continues',async()=>{
  const f=await lwFixture();f.setTopics(['渠道覆盖','回访周期']);const raw=await f.rawStore.create({title:'幂等返修合成',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。\n回访周期9天。'});let d=await f.accept(await f.generate(raw.id),['change-0']);const first=await f.confirm(d,'same-key');
  d=await f.accept((await f.drafts.get(d.id))!,['change-1']);const before=await f.wiki.allRecords();await assert.rejects(f.confirm(d,'same-key'),{code:'IDEMPOTENCY_KEY_MISMATCH'});assert.deepEqual(await f.wiki.allRecords(),before);const second=await f.confirm(d,'next-key');assert.notEqual(first.manifest.operationId,second.manifest.operationId);
});

test('LW01 repair: deep item confirmations cannot bypass note coverage and actual quality acknowledgement',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'深度门禁返修合成',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。'});let d=await f.generate(raw.id,'deep');for(const c of d.maintenance!.changes){d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:c.changeId,decision:'accept'});d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:c.changeId,confirmed:true,digest:maintenanceDigest(d,c.changeId)});}
  await assert.rejects(f.confirm(d),{code:'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE'});assert.equal((await f.wiki.allRecords()).length,0);
  await assert.rejects(f.drafts.reviewStructuredNote(d.id,{baseRevision:d.revision,reviewContentDigest:f.drafts.contentDigest(d),warningsAcknowledged:false,historicalReportAcknowledged:true},raw.body),{code:'INVALID_NOTE_REVIEW'});
  d=await f.drafts.reviewStructuredNote(d.id,{baseRevision:d.revision,reviewContentDigest:f.drafts.contentDigest(d),warningsAcknowledged:true,historicalReportAcknowledged:true},raw.body);await f.confirm(d);
});

test('LW01 repair: an uncovered deep fact cannot be approved even with both quality acknowledgements',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'深度覆盖返修合成',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。'});let d=await f.generate(raw.id,'deep');
  const note={...d.structuredNote!,sections:d.structuredNote!.sections.map(s=>({...s,blocks:[{type:'paragraph' as const,role:'needs_verification' as const,factIds:[],text:'笔记内容待核。',reason:'没有来源引用。'}]}))};
  d=await f.drafts.editStructuredNote(d.id,{baseRevision:d.revision,structuredNote:note,exclusions:[],questionIds:[],humanQuestions:[]},raw.body);
  for(const c of d.maintenance!.changes){d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:c.changeId,decision:'accept'});d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:c.changeId,confirmed:true,digest:maintenanceDigest(d,c.changeId)});}
  await assert.rejects(f.drafts.reviewStructuredNote(d.id,{baseRevision:d.revision,reviewContentDigest:f.drafts.contentDigest(d),warningsAcknowledged:true,historicalReportAcknowledged:true},raw.body),{code:'NOTE_COVERAGE_INCOMPLETE'});assert.equal((await f.wiki.allRecords()).length,0);
});
