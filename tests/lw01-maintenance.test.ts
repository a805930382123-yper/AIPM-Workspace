import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {lwFixture} from './lw01-fixture.ts';
import {maintenanceDigest} from '../services/wiki/maintenance.ts';

for(const mode of ['standard','deep'] as const)test(`LW01 ${mode}: actual runner reads Wiki, preserves human text and both sources; idempotent mixed commit`,async()=>{
  const f=await lwFixture();const a=await f.rawStore.create({title:'渠道资料A',sourceType:'report',sourceName:'合成A',tags:['渠道覆盖'],body:'2025年渠道覆盖100家，按有效门店口径。'});
  let da=await f.accept(await f.generate(a.id,mode));const first=await f.confirm(da);assert.equal(first.manifest.status,'completed');const topic=first.manifest.snapshot.pageRecords[0];
  await f.wiki.update(topic.id,topic.revision,{...topic,body:topic.body+'\n\n## 人工补充\n渠道负责人需电话复核。'});
  const b=await f.rawStore.create({title:'渠道资料B',sourceType:'report',sourceName:'合成B',tags:['渠道覆盖'],body:'2026年渠道覆盖120家，按签约门店口径。\n另一统计称2026年渠道覆盖90家，口径待核。'});
  let db=await f.generate(b.id,mode);assert.equal(db.maintenance!.changes[0].targetWikiId,topic.id);assert.equal(db.maintenance!.changes[0].action,'update');
  const planning=[...f.requests].reverse().find(r=>r.user.includes('请对下列全部已验证事实规划知识页'))!;assert(planning.user.includes(topic.id));assert(planning.user.includes('人工补充'));
  assert.equal((await f.wiki.get(topic.id))!.revision,2);db=await f.accept(db);const result=await f.confirm(db,'fixed-key');const updated=(await f.wiki.get(topic.id))!;
  assert.equal(updated.revision,3);assert(updated.body.includes('人工补充'));assert(updated.body.includes('2025'));assert(updated.body.includes('2026'));assert(updated.body.includes('待核'));assert.deepEqual(updated.sources,[a.id,b.id]);assert(!updated.body.includes('本次更新审核'));assert.equal(result.manifest.snapshot.maintenance!.before[topic.id].revision,2);
  const again=await f.wiki.withLock(()=>f.commits.confirm({draftId:db.id,baseRevision:db.revision,selectedPageIds:[db.pages[0].pageId],operationId:randomUUID(),idempotencyKey:'fixed-key',now:new Date().toISOString()}));assert(again.reused);assert.equal((await f.wiki.get(topic.id))!.revision,3);
  const repeated=await f.accept(await f.generate(b.id,mode,true));assert.equal(repeated.maintenance!.changes[0].action,'noop');const noop=await f.confirm(repeated);assert.equal(noop.manifest.snapshot.pageRecords.length,0);assert.equal((await f.wiki.get(topic.id))!.revision,3);assert.equal((await f.wiki.allRecords()).filter(p=>p.type==='source'&&p.sources.includes(b.id)).length,1);
  const log=await readFile(path.join(f.root,'knowledge/logs/wiki.jsonl'),'utf8');assert.equal(log.split('\n').filter(line=>line.includes(result.manifest.operationId)).length,2);
});

test('LW01 editing invalidates approval; stale target revision and missing dependencies reject before formal writes',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'合成资料',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖10家。\n回访周期7天。'});f.setTopics(['渠道覆盖','回访周期']);
  let d=await f.accept(await f.generate(raw.id));const id=d.maintenance!.changes[0].changeId;
  d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:id,body:d.maintenance!.changes[0].candidate.body+'\n人工修改'});assert(!d.maintenance!.changes[0].approval);
  await assert.rejects(f.confirm(d),{code:'CHANGE_REVIEW_REQUIRED'});assert.equal((await f.wiki.allRecords()).length,0);
  d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:id,confirmed:true,digest:maintenanceDigest(d,id)});await f.confirm(d);
  const other=await f.rawStore.create({title:'渠道新资料',sourceType:'report',sourceName:'合成',tags:['渠道覆盖'],body:'渠道覆盖20家。'});f.setTopics(['渠道覆盖']);let next=await f.accept(await f.generate(other.id));const target=(await f.wiki.get(next.maintenance!.changes[0].targetWikiId!))!;await f.wiki.update(target.id,target.revision,{...target,body:target.body+'\n人工先改'});await assert.rejects(f.confirm(next),{code:'WIKI_REVISION_CONFLICT'});assert((await f.wiki.get(target.id))!.body.endsWith('人工先改'));
});
