import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {lwFixture} from './lw01-fixture.ts';
import {WikiCommitService} from '../services/wiki/commits.ts';
import {maintenanceDigest} from '../services/wiki/maintenance.ts';
import {retrieveKnowledgeContext} from '../services/llm/knowledge-maintenance.ts';

test('LW01 partial accept keeps deferred draft; source links accumulate actual selections, independent item approval survives deferred edit',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'分项合成资料',sourceType:'report',sourceName:'合成',tags:['渠道'],body:'渠道覆盖10家。\n回访周期7天。'});f.setTopics(['渠道覆盖','回访周期']);let d=await f.generate(raw.id);
  d=await f.accept(d,['change-0']);const approved=d.maintenance!.changes[0].approval!;
  d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:'change-1',title:'人工回访标题',body:d.maintenance!.changes[1].candidate.body+'\n[[不存在的新页]]'});assert.deepEqual(d.maintenance!.changes[0].approval,approved);
  const first=await f.confirm(d);const sourceId=first.manifest.snapshot.sourceRecord!.id;assert.equal((await f.wiki.allRecords()).length,2);assert.equal((await f.drafts.get(d.id))!.status,'pending_confirmation');assert(!(await f.wiki.get(sourceId))!.body.includes('[[人工回访标题]]'));
  d=(await f.drafts.get(d.id))!;d=await f.accept(d,['change-1']);const second=await f.confirm(d);assert.equal(second.manifest.snapshot.reuseSourceId,sourceId);assert.equal((await f.wiki.allRecords()).filter(p=>p.type==='source').length,1);const source=(await f.wiki.get(sourceId))!;assert(source.body.includes('[[渠道覆盖]]'));assert(source.body.includes('[[人工回访标题]]'));assert.equal(source.revision,2);assert(!(await f.wiki.get(second.manifest.snapshot.pageRecords[0].id))!.body.includes('[[不存在的新页]]'));
});

for(const phase of ['source','pages','index','log','state'] as const)test(`LW01 durable ${phase} failure + fresh service recovery preserves IDs/revisions/log and lost-response retry`,async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'恢复合成资料',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖10家。'}),d=await f.accept(await f.generate(raw.id));let fired=false;
  const fail=()=>{if(!fired){fired=true;throw Object.assign(Error('controlled '+phase),{code:'EIO'});}};
  const write=f.wiki.writePageLocked.bind(f.wiki),index=f.wiki.rebuildIndexLocked.bind(f.wiki),log=f.wiki.appendLogLocked.bind(f.wiki),state=f.rawStates.set.bind(f.rawStates);
  if(phase==='source'||phase==='pages')f.wiki.writePageLocked=async p=>{await write(p);if((phase==='source')===(p.type==='source'))fail();};
  if(phase==='index')f.wiki.rebuildIndexLocked=async()=>{await index();fail();};
  if(phase==='log')f.wiki.appendLogLocked=async entries=>{await log(entries);fail();};
  if(phase==='state')f.rawStates.set=async(...args)=>{fail();return state(...args);};
  await assert.rejects(f.confirm(d));const frozen=(await f.commits.list())[0];assert(frozen);f.wiki.writePageLocked=write;f.wiki.rebuildIndexLocked=index;f.wiki.appendLogLocked=log;f.rawStates.set=state;
  const resumed=new WikiCommitService({root:f.root,wikiStore:f.wiki,rawStore:f.rawStore,rawStates:f.rawStates,drafts:f.drafts});const recovered=await resumed.reconcile();assert.equal(recovered.conflicts.length,0,JSON.stringify(recovered.conflicts));assert.equal(recovered.resumed[0].status,'completed');assert.equal((await f.wiki.allRecords()).length,2);assert.deepEqual(recovered.resumed[0].snapshot.pageRecords.map(p=>p.id),frozen.snapshot.pageRecords.map(p=>p.id));
  const retry=await f.wiki.withLock(()=>resumed.confirm({draftId:d.id,baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:'lost-response',operationId:randomUUID(),now:new Date().toISOString()}));assert(retry.reused);assert.equal((await f.wiki.get(frozen.snapshot.pageRecords[0].id))!.revision,1);
  const lines=(await readFile(path.join(f.root,'knowledge/logs/wiki.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines.filter(line=>line.operationId===frozen.operationId).length,2);
});

test('LW01 dependency rejection, bounded retrieval aliases/tags/related links, category-only exclusion and restricted source',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'依赖合成资料',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖10家。\n回访周期7天。'});f.setTopics(['渠道覆盖','回访周期']);let d=await f.generate(raw.id);d.maintenance!.changes[0].dependsOn=['change-1'];await writeFile(path.join(f.root,'drafts',d.id+'.json'),JSON.stringify(d));d=await f.accept(d,['change-0']);await assert.rejects(f.confirm(d),{code:'CHANGE_DEPENDENCY_REQUIRED'});assert.equal((await f.wiki.allRecords()).length,0);
  d=await f.accept((await f.drafts.get(d.id))!,['change-1']);await f.confirm(d);const pages=(await f.wiki.allRecords()).filter(p=>p.type!=='source'),base=pages[0];await f.wiki.update(base.id,base.revision,{...base,aliases:['有效网点'],tags:['覆盖指标'],body:base.body+'\n[[回访周期]]'});await f.wiki.create({...base,title:'毫无关系的同类页面',aliases:[],tags:[],body:'这是一段其他知识。'});
  const found=await retrieveKnowledgeContext(f.wiki,f.rawStore,[{title:'有效网点',tags:['覆盖指标'],content:'有效网点'}]);assert(found.some(p=>p.id===base.id));assert(found.some(p=>p.title==='回访周期'));assert(!found.some(p=>p.title==='毫无关系的同类页面'));assert(found.length<=8);assert(JSON.stringify(found).length<=48000);
  assert(maintenanceDigest(d));
});
