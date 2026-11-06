import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {lw02Fixture} from './lw02-fixture.ts';

test('LW02 actual ask -> QA Draft -> existing Commit -> ask again preserves raw roots and creates no fake Raw/Source/state',async()=>{
  const f=await lw02Fixture(),raw=await f.rawStore.create({title:'合成A',sourceType:'report',sourceName:'合成',tags:[],body:'2025年有效门店100家，按活跃口径统计。'});const original=await f.seed('渠道口径手册','2025年有效门店100家，按活跃口径统计。\n人工补充：渠道负责人需电话复核。',[raw.id]);
  const beforeRaw=(await f.rawStore.list()).map(r=>r.id),beforeState=await readdir(path.join(f.root,'state/raw-processing'));
  const answer=await f.ask();assert.equal(answer.status,'completed');assert(f.requests[0].user.includes(original.id));assert(f.requests[0].user.includes('人工补充'));assert.equal(answer.independentRawIds.length,1);assert.equal(answer.usedWikiIds[0],original.id);
  const saved=await f.answers.save(answer.id,{key:'save-1',resultRevision:answer.revision,preview:f.preview(answer)});assert.equal(saved.status,'draft_created');const json=JSON.parse(await readFile(path.join(f.root,'drafts',saved.draftId!+'.json'),'utf8'));assert.equal(json.input.kind,'question_answer');assert(!Object.hasOwn(json,'rawId'));assert(!Object.hasOwn(json,'rawSha256'));assert(!Object.hasOwn(json,'source'));assert.equal((await f.wiki.allRecords()).length,1);
  const d=await f.approve(saved.draftId!),result=await f.commit(d);assert.equal(result.manifest.status,'completed');assert(!result.manifest.snapshot.sourceRecord);assert.deepEqual((await f.rawStore.list()).map(r=>r.id),beforeRaw);assert.deepEqual(await readdir(path.join(f.root,'state/raw-processing')),beforeState);const page=result.manifest.snapshot.pageRecords[0];assert.deepEqual(page.sources,[raw.id]);assert(page.answerDerivations?.some(item=>item.answerId===answer.id));assert.equal((await f.wiki.allRecords()).filter(p=>p.type==='source').length,0);
  const again=await f.ask('渠道统计专题整理有哪些结论？');assert(again.readWiki.some(p=>p.id===page.id));assert.equal(again.independentRawIds.length,1);
});

test('LW02 manual Wiki evidence needs no Raw identity and inference remains inference',async()=>{
  const f=await lw02Fixture();await f.seed('人工渠道知识','有效门店统计口径需要区分签约与活跃。');f.mode('inference');const answer=await f.ask();assert.equal(answer.independentRawIds.length,0);assert.equal(answer.manualWikiIds.length,1);const save=await f.answers.save(answer.id,{key:'manual',resultRevision:answer.revision,preview:f.preview(answer)}),result=await f.commit(await f.approve(save.draftId!));const page=result.manifest.snapshot.pageRecords[0];assert.deepEqual(page.sources,[]);assert.equal(page.knowledge_status,'inferred');assert(page.body.includes('推断与建议'));assert.equal(page.answerDerivations![0].manualWikiIds.length,1);
});
