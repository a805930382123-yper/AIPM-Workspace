import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {lwFixture} from '../lw01-fixture.ts';
import {maintenanceDigest} from '../../services/wiki/maintenance.ts';
import {retrieveKnowledgeContext,MAINTENANCE_LIMITS} from '../../services/llm/knowledge-maintenance.ts';
import {WikiCommitService} from '../../services/wiki/commits.ts';

// Reviewer-owned assertions; reuses only the builder's synthetic provider/service assembly.
async function formalSha(root){
  const result={};
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else result[path.relative(root,p)]=createHash('sha256').update(await readFile(p)).digest('hex');}}
  await walk(path.join(root,'knowledge'));return result;
}

for(const mode of ['standard','deep'])test(`review ${mode}: default runner, immutable preapproval, exact snapshot and two-source update`,async()=>{
  const f=await lwFixture();
  const a=await f.rawStore.create({title:'独验渠道A',sourceType:'report',sourceName:'独验合成A',tags:['渠道覆盖'],body:'2024年有效门店覆盖81家。'});
  const empty=await formalSha(f.root),draftA=await f.generate(a.id,mode);
  assert.deepEqual(await formalSha(f.root),empty);
  assert.equal(draftA.maintenance.changes[0].decision,'defer');
  await assert.rejects(f.confirm(draftA));
  assert.deepEqual(await formalSha(f.root),empty);
  const ca=await f.confirm(await f.accept(draftA));
  const initial=ca.manifest.snapshot.pageRecords[0];
  await f.wiki.update(initial.id,initial.revision,{...initial,body:initial.body+'\n\n人工备注：门店关闭日期以线下台账为准。'});
  const before=await f.wiki.get(initial.id);
  const b=await f.rawStore.create({title:'独验渠道B',sourceType:'report',sourceName:'独验合成B',tags:['渠道覆盖'],body:'2025年签约门店覆盖97家。\n2025年另一口径覆盖75家，尚需核对。'});
  const stable=await formalSha(f.root),draftB=await f.generate(b.id,mode);
  assert.deepEqual(await formalSha(f.root),stable);
  const maintenance=f.requests.filter(r=>{try{return JSON.parse(r.user).stage==='maintenance';}catch{return false;}}).at(-1);
  assert(maintenance,'default runner must call maintenance provider');
  const sent=JSON.parse(maintenance.user).context.find(p=>p.id===initial.id);
  assert.equal(sent.body,before.body);assert.equal(sent.revision,before.revision);assert.deepEqual(sent.sources,[a.id]);
  assert.equal(draftB.maintenance.changes[0].targetWikiId,initial.id);
  const committed=await f.confirm(await f.accept(draftB));
  const after=await f.wiki.get(initial.id);
  assert.equal(after.revision,before.revision+1);assert.deepEqual(after.sources,[a.id,b.id]);
  for(const part of ['2024','81','2025','97','75','人工备注'])assert(after.body.includes(part),part);
  assert.deepEqual(committed.manifest.snapshot.maintenance.before[initial.id],before);
  assert(!after.body.includes('本次更新审核'));
});

test('review: link adds only source, repeated noop preserves all formal bytes',async()=>{
  const f=await lwFixture();f.setTopics(['渠道指标定义']);
  const a=await f.rawStore.create({title:'定义A',sourceType:'report',sourceName:'独验',tags:['渠道指标定义'],body:'渠道指标定义为已签约终端数。'});
  const first=await f.confirm(await f.accept(await f.generate(a.id)));
  const old=first.manifest.snapshot.pageRecords[0];
  const b=await f.rawStore.create({title:'定义B',sourceType:'report',sourceName:'独验',tags:['渠道指标定义'],body:'渠道指标定义为已签约终端数。'});
  const d=await f.generate(b.id);assert.equal(d.maintenance.changes[0].action,'link');
  await f.confirm(await f.accept(d));const linked=await f.wiki.get(old.id);
  assert.equal(linked.body,old.body);assert.equal(linked.revision,old.revision+1);assert.deepEqual(linked.sources,[a.id,b.id]);
  const stable=await formalSha(f.root),repeat=await f.generate(b.id,'standard',true);
  assert.equal(repeat.maintenance.changes[0].action,'noop');await f.confirm(await f.accept(repeat));
  assert.deepEqual(await formalSha(f.root),stable);assert.equal((await f.wiki.allRecords()).filter(p=>p.type==='source'&&p.sources.includes(b.id)).length,1);
});

test('review: retrieval real records, aliases, linked page, strict size/count, category-only exclusion and restricted sources',async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'检索原文',sourceType:'report',sourceName:'独验',tags:[],body:'渠道覆盖11家。'});
  const result=await f.confirm(await f.accept(await f.generate(raw.id))),base=result.manifest.snapshot.pageRecords[0];
  const related=await f.wiki.create({...base,title:'冷链审核',aliases:[],tags:[],body:'检查冷藏温度。'});
  const irrelevant=await f.wiki.create({...base,title:'办公室钥匙',aliases:[],tags:[],body:'保管钥匙。'});
  await f.wiki.update(base.id,base.revision,{...base,aliases:['有效网点'],tags:['覆盖指标'],body:base.body+'\n[[冷链审核]]'});
  const found=await retrieveKnowledgeContext(f.wiki,f.rawStore,[{title:'有效网点',tags:['覆盖指标'],content:'有效网点'}]);
  assert(found.some(p=>p.id===base.id));assert(found.some(p=>p.id===related.id));assert(!found.some(p=>p.id===irrelevant.id));
  const calls=[];const restricted={get:async id=>{calls.push(id);return {...await f.rawStore.get(id),origin:{invalid:true}};}};
  assert.deepEqual(await retrieveKnowledgeContext(f.wiki,restricted,[{title:'有效网点',tags:[],content:''}]),[]);assert(calls.includes(raw.id));
  for(let i=0;i<12;i++)await f.wiki.create({...base,title:`覆盖指标附录${i}`,aliases:[],tags:['边界词'],body:'边界词。'.repeat(1800)});
  const bounded=await retrieveKnowledgeContext(f.wiki,f.rawStore,[{title:'边界词',tags:['边界词'],content:'边界词'}]);
  assert(bounded.length>0);assert(bounded.length<=MAINTENANCE_LIMITS.pages);assert(JSON.stringify(bounded).length<=MAINTENANCE_LIMITS.characters);
});

test('review: stale target rejects before business writes',async()=>{
  const f=await lwFixture(),a=await f.rawStore.create({title:'过期A',sourceType:'report',sourceName:'独验',tags:[],body:'渠道覆盖13家。'});
  const one=await f.confirm(await f.accept(await f.generate(a.id)));const target=one.manifest.snapshot.pageRecords[0];
  const b=await f.rawStore.create({title:'过期B',sourceType:'report',sourceName:'独验',tags:[],body:'渠道覆盖14家。'}),d=await f.accept(await f.generate(b.id));
  await f.wiki.update(target.id,target.revision,{...target,body:target.body+'\n人工在生成后修订'});const stable=await formalSha(f.root);
  await assert.rejects(f.confirm(d),{code:'WIKI_REVISION_CONFLICT'});assert.deepEqual(await formalSha(f.root),stable);
});

for(const boundary of ['revision','privacy'])test(`review: failed noop recovery rechecks ${boundary} even without page writes`,async()=>{
  const f=await lwFixture(),raw=await f.rawStore.create({title:'恢复无变化',sourceType:'report',sourceName:'独验',tags:[],body:'渠道覆盖16家。'});
  const first=await f.confirm(await f.accept(await f.generate(raw.id)));let target=first.manifest.snapshot.pageRecords[0],restrictedId;
  if(boundary==='privacy'){
    const prior=await f.rawStore.create({title:'旧来源限制',sourceType:'report',sourceName:'独验',tags:[],body:'旧来源渠道数据。'});restrictedId=prior.id;
    target=await f.wiki.update(target.id,target.revision,{...target,sources:[...target.sources,prior.id]});
  }
  const d=await f.accept(await f.generate(raw.id,'standard',true));assert.equal(d.maintenance.changes[0].action,'noop');
  const index=f.wiki.rebuildIndexLocked.bind(f.wiki);f.wiki.rebuildIndexLocked=async()=>{throw Object.assign(Error('review injected index failure'),{code:'EIO'});};
  await assert.rejects(f.confirm(d));f.wiki.rebuildIndexLocked=index;
  let rawStore=f.rawStore;
  if(boundary==='revision')await f.wiki.update(target.id,target.revision,{...target,body:target.body+'\n恢复前人工改变'});
  else rawStore={get:async id=>{const value=await f.rawStore.get(id);return id===restrictedId?{...value,origin:{invalid:true}}:value;}};
  const stable=await formalSha(f.root),resumed=new WikiCommitService({root:f.root,wikiStore:f.wiki,rawStore,rawStates:f.rawStates,drafts:f.drafts});
  const outcome=await resumed.reconcile();assert.equal(outcome.resumed.length,0);assert.equal(outcome.conflicts.length,1);assert.deepEqual(await formalSha(f.root),stable);
});

test('review: partial submit, edited title, deferred link cleaning, edit reapproval and Source reuse',async()=>{
  const f=await lwFixture();f.setTopics(['渠道覆盖','回访周期']);
  const raw=await f.rawStore.create({title:'独验分次提交',sourceType:'report',sourceName:'独验',tags:[],body:'渠道覆盖21家。\n回访周期为9天。'});
  let d=await f.generate(raw.id);const [first,second]=d.maintenance.changes;
  d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:first.changeId,title:'渠道覆盖人工标题',body:first.candidate.body+'\n关联[[回访周期]]'});
  d=await f.accept(d,[first.changeId]);
  const stable=await formalSha(f.root);
  d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:first.changeId,body:d.maintenance.changes[0].candidate.body+'\n人工追加'});
  await assert.rejects(f.confirm(d),{code:'CHANGE_REVIEW_REQUIRED'});assert.deepEqual(await formalSha(f.root),stable);
  d=await f.drafts.reviewChange(d.id,{baseRevision:d.revision,changeId:first.changeId,confirmed:true,digest:maintenanceDigest(d,first.changeId)});
  await f.confirm(d);
  let all=await f.wiki.allRecords();const source=all.find(p=>p.type==='source');
  assert.equal(all.length,2);assert(source.body.includes('[[渠道覆盖人工标题]]'));assert(!source.body.includes('[[回访周期]]'));
  d=await f.drafts.get(d.id);assert.equal(d.maintenance.changes[1].decision,'defer');assert(!d.maintenance.changes[1].committedOperationId);
  d=await f.accept(d,[second.changeId]);await f.confirm(d);
  all=await f.wiki.allRecords();assert.equal(all.length,3);assert.equal(all.filter(p=>p.type==='source').length,1);
  const updated=await f.wiki.get(source.id);assert(updated.body.includes('[[回访周期]]'));assert(updated.body.includes('[[渠道覆盖人工标题]]'));
});
