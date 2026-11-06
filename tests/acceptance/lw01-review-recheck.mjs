import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lwFixture} from '../lw01-fixture.ts';
import {maintenanceDigest} from '../../services/wiki/maintenance.ts';
test('review repair: unresolved rejects; reassignment invalidates then permits review',async()=>{
 const f=await lwFixture(),raw=await f.rawStore.create({title:'独验归属复验',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。\n有效门店15家。'});
 let d=await f.generate(raw.id),unit=d.humanReview.units[0],owner=d.humanReview.assignments[unit.id];
 d=await f.drafts.reviewOperation(d.id,{baseRevision:d.revision,action:'move',unitIds:[unit.id],pageId:null},{body:raw.body,rulesDir:'rules'});d=await f.accept(d);
 await assert.rejects(f.confirm(d),{code:'HUMAN_REVIEW_INCOMPLETE'});assert.equal((await f.wiki.allRecords()).length,0);
 d=await f.drafts.reviewOperation(d.id,{baseRevision:d.revision,action:'move',unitIds:[unit.id],pageId:owner},{body:raw.body,rulesDir:'rules'});
 await assert.rejects(f.confirm(d),{code:'CHANGE_REVIEW_REQUIRED'});d=await f.accept(d);assert.equal((await f.confirm(d)).manifest.status,'completed');
});
test('review repair: same key payload retry reuses; same key changed selection rejects; new key completes remaining',async()=>{
 const f=await lwFixture();f.setTopics(['渠道覆盖','回访周期']);const raw=await f.rawStore.create({title:'独验幂等复验',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。\n回访周期9天。'});
 let d=await f.accept(await f.generate(raw.id),['change-0']),first=await f.confirm(d,'same-key');
 const retry=await f.wiki.withLock(()=>f.commits.confirm({draftId:d.id,baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:'same-key',operationId:randomUUID(),now:new Date().toISOString()}));assert(retry.reused);assert.equal(retry.manifest.operationId,first.manifest.operationId);
 d=await f.accept(await f.drafts.get(d.id),['change-1']);await assert.rejects(f.confirm(d,'same-key'),{code:'IDEMPOTENCY_KEY_MISMATCH'});assert.equal((await f.wiki.allRecords()).length,2);
 assert.equal((await f.confirm(d,'new-key')).manifest.status,'completed');assert.equal((await f.wiki.allRecords()).length,3);
});
test('review repair: deep note requires explicit acknowledgement and rejects genuinely uncovered facts',async()=>{
 const f=await lwFixture(),raw=await f.rawStore.create({title:'独验深度覆盖复验',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖20家。'});
 let d=await f.generate(raw.id,'deep');d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:'change-0',decision:'accept'});d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:'change-0',confirmed:true,digest:maintenanceDigest(d,'change-0')});
 await assert.rejects(f.confirm(d),{code:'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE'});
 const note=structuredClone(d.structuredNote);note.sections[0].blocks=[{type:'paragraph',role:'needs_verification',factIds:[],text:'仅保留人工待核说明',reason:'尚未核实'}];
 d=await f.drafts.editStructuredNote(d.id,{baseRevision:d.revision,structuredNote:note,exclusions:[],questionIds:[],humanQuestions:[]},raw.body);
 d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:'change-0',confirmed:true,digest:maintenanceDigest(d,'change-0')});
 await assert.rejects(f.drafts.reviewStructuredNote(d.id,{baseRevision:d.revision,reviewContentDigest:f.drafts.contentDigest(d),warningsAcknowledged:true,historicalReportAcknowledged:true},raw.body),{code:'NOTE_COVERAGE_INCOMPLETE'});
 assert.equal((await f.wiki.allRecords()).length,0);
});
