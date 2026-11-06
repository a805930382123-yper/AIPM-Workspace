import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {lw02Fixture} from '../lw02-fixture.ts';
import {WikiCommitService} from '../../services/wiki/commits.ts';
import {answerText} from '../../services/llm/knowledge-answers.ts';

// Only assembly/fake are shared; assertions, inputs and failure cases belong to independent review.
async function hashes(root,sub){const out={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else out[path.relative(root,p)]=createHash('sha256').update(await readFile(p)).digest('hex');}}await walk(path.join(root,sub));return out;}
const raw=async(f,title,body)=>f.rawStore.create({title,sourceType:'report',sourceName:'独验合成',tags:[],body});

test('review LW02: actual body input, 3 pages/2 roots, new topic and requery preserve provenance without Raw/Source/state writes',async()=>{
 const f=await lw02Fixture(),a=await raw(f,'独验资料甲','2024年活跃渠道81家。'),b=await raw(f,'独验资料乙','2025年签约渠道97家，另一口径75家。');
 const first=await f.seed('渠道甲页','2024年活跃渠道81家。\n人工备注：合同需要回访。',[a.id]);await f.seed('渠道甲补页','有效门店统计须参考活跃口径。',[a.id]);await f.seed('渠道乙页','2025年签约渠道97家，另一口径75家。',[b.id]);
 const before=await hashes(f.root,'knowledge'),rawBefore=await hashes(f.root,'knowledge/raw'),stateBefore=await hashes(f.root,'state/raw-processing');
 const r=await f.ask();assert.equal(r.status,'completed');const sent=JSON.parse(f.requests[0].user).wiki.find(p=>p.id===first.id);assert.equal(sent.body,first.body);assert.equal(sent.revision,first.revision);assert.deepEqual(new Set(r.independentRawIds),new Set([a.id,b.id]));assert.equal(r.usedWikiIds.length,3);assert.deepEqual(await hashes(f.root,'knowledge'),before);
 const preview=f.preview(r,{title:'独验渠道交叉口径'}),saved=await f.answers.save(r.id,{key:'review-create',resultRevision:r.revision,preview});assert.deepEqual(await hashes(f.root,'knowledge'),before);
 const draft=await f.drafts.getKnowledge(saved.draftId);assert.equal(draft.input.kind,'question_answer');for(const key of ['rawId','rawSha256','rawMeta','source'])assert(!Object.hasOwn(draft,key),key);
 const committed=await f.commit(await f.approve(saved.draftId)),page=committed.manifest.snapshot.pageRecords[0];assert(!committed.manifest.snapshot.sourceRecord);assert.deepEqual(new Set(page.sources),new Set([a.id,b.id]));assert.equal((await f.wiki.allRecords()).filter(p=>p.type==='source').length,0);
 assert.deepEqual(await hashes(f.root,'knowledge/raw'),rawBefore);assert.deepEqual(await hashes(f.root,'state/raw-processing'),stateBefore);
 const again=await f.ask('独验渠道交叉口径说明什么？');assert(again.readWiki.some(p=>p.id===page.id));assert.deepEqual(new Set(again.independentRawIds),new Set([a.id,b.id]));
});

test('review LW02: no evidence/partial and false record or false quote fail without fake links',async()=>{
 const f=await lw02Fixture();const none=await f.ask('火星发动机燃料');assert.equal(none.status,'insufficient');assert.equal(f.requests.length,0);
 await f.seed('渠道人工口径','有效门店统计为最近有动销门店。');f.mode('partial');const partial=await f.ask();assert.equal(partial.status,'partial');assert(partial.sections.some(s=>s.kind==='insufficient'));
 f.mode('invalid');const invalid=await f.ask();assert.equal(invalid.status,'failed');assert.equal(invalid.citations.length,0);
 f.mode('normal');const complete=f.provider.complete;f.provider.complete=async request=>{const reply=await complete(request),value=JSON.parse(reply.text);if(JSON.parse(request.user).stage==='knowledge_answer')value.citations[0].quote='并不存在于正文的伪引文';return {...reply,text:JSON.stringify(value)};};
 const badQuote=await f.ask();assert.equal(badQuote.status,'failed');assert.equal(badQuote.error.code,'ANSWER_CITATION_INVALID');assert.equal((await f.drafts.listKnowledge()).length,0);
});

test('review LW02: selected inference cannot lose its original section/citations; saved manual knowledge remains inferred',async()=>{
 const f=await lw02Fixture(),manual=await f.seed('渠道人工页','有效门店统计存在多种口径。');f.mode('inference');const r=await f.ask(),inference=r.sections.find(s=>s.kind==='inference');
 const p=f.preview(r,{title:'独验人工推断',selectedText:answerText([inference]),selectedSectionIds:[inference.id],citationIds:inference.citationIds,conclusion:'',inferences:inference.text}),calls=f.requests.length;
 await assert.rejects(f.answers.save(r.id,{key:'wrong-label',resultRevision:r.revision,preview:{...p,selectedSectionIds:[r.sections[0].id]}}),{code:'SAVE_SELECTION_MISMATCH'});
 await assert.rejects(f.answers.save(r.id,{key:'drop-source',resultRevision:r.revision,preview:{...p,citationIds:[]}}),{code:'SAVE_SELECTION_MISMATCH'});assert.equal(f.requests.length,calls);
 const saved=await f.answers.save(r.id,{key:'proper',resultRevision:r.revision,preview:p}),committed=await f.commit(await f.approve(saved.draftId)),page=committed.manifest.snapshot.pageRecords[0];
 assert.equal(page.knowledge_status,'inferred');assert(page.body.includes('推断'));assert.deepEqual(page.sources,[]);assert(page.answerDerivations[0].manualWikiIds.includes(manual.id));assert.equal((await f.rawStore.list()).length,0);
});

test('review LW02: persisted proposed Draft ID recovers save failure and concurrent retries resolve one Draft',async()=>{
 const f=await lw02Fixture();await f.seed('渠道原页','有效门店统计为活跃渠道。');const r=await f.ask(),preview=f.preview(r),create=f.drafts.createQuestion.bind(f.drafts);
 f.drafts.createQuestion=async()=>{throw Error('review disk fail before draft write');};await assert.rejects(f.answers.save(r.id,{key:'durable',resultRevision:r.revision,preview}));const stored=await f.answers.get(r.id),planned=stored.saves[0].draftId,calls=f.requests.length;assert(planned);
 f.drafts.createQuestion=create;const service=f.newAnswers();await service.initialize();const [a,b]=await Promise.all([service.save(r.id,{key:'durable',resultRevision:r.revision,preview}),service.save(r.id,{key:'durable',resultRevision:r.revision,preview})]);
 assert.equal(a.draftId,planned);assert.equal(b.draftId,planned);assert.equal((await f.drafts.listKnowledge()).length,1);assert.equal(f.requests.length,calls);
 await assert.rejects(service.save(r.id,{key:'durable',resultRevision:r.revision,preview:{...preview,conclusion:'改变内容'}}),{code:'SAVE_KEY_MISMATCH'});
});

test('review LW02: self-basis update survives after-write failure, retries reuse operation and save; external edits still reject',async()=>{
 const f=await lw02Fixture(),page=await f.seed('渠道原主题','有效门店统计按活跃口径。\n人工保留：区域负责人复核。'),r=await f.ask(),preview=f.preview(r,{title:page.title,targetWikiId:page.id,conclusion:'独验补充：按年度分别审核。'}),saved=await f.answers.save(r.id,{key:'update',resultRevision:r.revision,preview}),d=await f.approve(saved.draftId);
 const index=f.wiki.rebuildIndexLocked.bind(f.wiki);f.wiki.rebuildIndexLocked=async()=>{throw Error('review index unavailable after Wiki write');};await assert.rejects(f.commit(d,'fixed'));f.wiki.rebuildIndexLocked=index;
 assert.equal((await f.wiki.get(page.id)).revision,2);const commits=new WikiCommitService({root:f.root,wikiStore:f.wiki,rawStore:f.rawStore,rawStates:f.rawStates,drafts:f.drafts}),recovered=await commits.reconcile();assert.equal(recovered.conflicts.length,0);assert.equal(recovered.resumed.length,1);
 const retry=await f.wiki.withLock(()=>commits.confirm({draftId:d.id,baseRevision:d.revision,selectedPageIds:d.pages.map(p=>p.pageId),idempotencyKey:'fixed',operationId:randomUUID(),now:new Date().toISOString()}));assert(retry.reused);assert.equal((await f.wiki.get(page.id)).revision,2);assert.equal((await f.answers.save(r.id,{key:'update',resultRevision:r.revision,preview})).draftId,d.id);
 const fresh=await f.ask(),current=await f.wiki.get(page.id);await f.wiki.update(page.id,current.revision,{...current,body:current.body+'\n独验后续人工改变'});const calls=f.requests.length;await assert.rejects(f.answers.save(fresh.id,{key:'stale',resultRevision:fresh.revision,preview:f.preview(fresh)}),{code:'ANSWER_BASIS_CHANGED'});assert.equal(f.requests.length,calls);
});

test('review LW02: cached POST/GET/citation/save and derived pages cannot evade tightened root policy',async()=>{
 const f=await lw02Fixture(),a=await raw(f,'独验限制资料','有效门店统计按活跃口径。');await f.seed('渠道受限前页','有效门店统计按活跃口径。',[a.id]);const r=await f.ask(),preview=f.preview(r),saved=await f.answers.save(r.id,{key:'derive',resultRevision:r.revision,preview}),result=await f.commit(await f.approve(saved.draftId)),derived=result.manifest.snapshot.pageRecords[0];
 await f.wiki.update(derived.id,derived.revision,{...derived,sources:[]});const get=f.rawStore.get.bind(f.rawStore);f.rawStore.get=async id=>{const value=await get(id);return id===a.id?{...value,origin:{invalid:true}}:value;};const calls=f.requests.length;
 for(const action of [()=>f.answers.read(r.id),()=>f.ask(r.question,r.id),()=>f.answers.citation(r.id,r.citations[0].id),()=>f.answers.save(r.id,{key:'derive',resultRevision:r.revision,preview})])await assert.rejects(action(),{code:'MEETING_SOURCE_RESTRICTED'});
 assert.equal((await f.ask('渠道统计专题整理有哪些结论？')).status,'insufficient');assert.equal(f.requests.length,calls);
});

test('review LW02: QA unresolved original citation blocks formal commit and no_change writes nothing',async()=>{
 const f=await lw02Fixture(),p=await f.seed('渠道既有页','有效门店统计按有效合同。'),r=await f.ask(),saved=await f.answers.save(r.id,{key:'new',resultRevision:r.revision,preview:f.preview(r)});let d=await f.drafts.getKnowledge(saved.draftId);
 d=await f.drafts.reviewQuestionOperation(d.id,{baseRevision:d.revision,action:'move',unitIds:[d.humanReview.units[0].id],pageId:null});d=await f.approve(d.id);const before=await hashes(f.root,'knowledge');await assert.rejects(f.commit(d),{code:'HUMAN_REVIEW_INCOMPLETE'});assert.deepEqual(await hashes(f.root,'knowledge'),before);
 f.mode('no_change');const answer=await f.ask(),count=(await f.drafts.listKnowledge()).length,status=await f.answers.save(answer.id,{key:'covered',resultRevision:answer.revision,preview:f.preview(answer,{title:p.title,targetWikiId:p.id})});assert.equal(status.status,'no_change');assert.equal((await f.drafts.listKnowledge()).length,count);assert.deepEqual(await hashes(f.root,'knowledge'),before);
});

test('review LW02: bounded necessary Raw supplement and explicit failures keep cumulative attempt count',async()=>{
 const f=await lw02Fixture(),a=await raw(f,'独验长原文','渠道统计120家。'+ '原始渠道资料。'.repeat(2500));await f.seed('渠道摘要','有效门店统计120家，口径需查原始资料。',[a.id]);f.mode('raw');const r=await f.ask();assert.equal(r.attempts,2);assert(r.readRaw.length<=3);assert(r.readRaw.reduce((n,x)=>n+x.quote.length,0)<=24000);for(const fragment of r.readRaw)assert.equal((await f.rawStore.get(fragment.rawId)).body.slice(fragment.start,fragment.end),fragment.quote);
 f.mode('normal');f.fail(2);const id=randomUUID(),one=await f.ask(undefined,id),two=await f.ask(undefined,id,true),three=await f.ask(undefined,id,true);assert.equal(one.attempts,1);assert.equal(two.attempts,2);assert.equal(three.attempts,3);assert.equal(three.status,'completed');
});
