import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { JSDOM } from 'jsdom';
import { parseStructuredNote, renderStructuredNote, validStructuredNote, STRUCTURED_NOTE_LIMITS as L } from '../services/wiki/structured-note.ts';
import { candidateContent, assertHumanReviewed, reviewContentDigest } from '../services/wiki/human-review.ts';
import { isExtractionDraft } from '../services/storage/record-validators.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';
import { approveDraft } from './support/human-review.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';

const fixture = JSON.parse(await readFile('tests/fixtures/kb03-structured-note.json', 'utf8'));
const facts = new Set(['fact-1']);
test('KB03 all five blocks and four roles parse without changing original values; deterministic output', () => {
  const note = parseStructuredNote(fixture, facts);
  assert.deepEqual(note, fixture); assert.notEqual(note, fixture);
  const md = renderStructuredNote(note);
  for (let i = 0; i < 10; i++) assert.equal(renderStructuredNote(parseStructuredNote(fixture, facts)), md);
  for (const value of ['100家','20家','20%','补充知识，未经原文支持','原文支持','整理归纳','待核实','事实引用：fact\\-1','原因：','指标名称：','数值与单位：','scope → active']) assert(md.includes(value), value);
});

const invalid: [string, (v: any) => void][] = [
  ['unknown root', v => v.extra = 1], ['version', v => v.version = 2],
  ['section unknown', v => v.sections[0].extra = 1], ['block unknown', v => v.sections[0].blocks[0].extra = 1],
  ['leaf unknown', v => v.sections[0].blocks[1].items[0].extra = 1], ['role', v => v.sections[0].blocks[0].role = 'fact'],
  ['missing refs', v => v.sections[0].blocks[0].factIds = []], ['unknown refs', v => v.sections[0].blocks[0].factIds = ['invented']],
  ['duplicate refs', v => v.sections[0].blocks[0].factIds = ['fact-1','fact-1']],
  ['supplement cites source', v => v.sections[0].blocks[1].items[1].factIds = ['fact-1']],
  ['reason empty', v => v.sections[0].blocks[4].reason = ' '], ['reason missing', v => delete v.sections[0].blocks[4].reason],
  ['row width', v => v.sections[0].blocks[2].rows[0].cells.pop()], ['row unknown', v => v.sections[0].blocks[2].rows[0].extra = 1],
  ['section IDs duplicate', v => v.sections.push(structuredClone(v.sections[0]))],
  ['node IDs duplicate', v => v.sections[0].blocks[3].nodes[1].id = 'scope'],
  ['dangling edge', v => v.sections[0].blocks[3].edges[0].to = 'absent'],
  ['container attribution', v => v.sections[0].blocks[1].role = 'source_supported'],
  ['unknown block', v => v.sections[0].blocks[0].type = 'mermaid'],
  ['null', v => v.sections[0].blocks[0] = null],
];
for (const [name, change] of invalid) test(`KB03 rejects ${name}`, () => {
  const value = structuredClone(fixture); change(value);
  assert(!validStructuredNote(value, facts)); assert.throws(() => parseStructuredNote(value, facts), { code: 'STRUCTURED_NOTE_INVALID' });
});
test('KB03 central limits accept exact boundary and reject overflow', () => {
  const checks: [number, (v: any, n: number) => void][] = [
    [L.sections,(v,n) => v.sections = Array.from({length:n},(_,i)=>({...v.sections[0],id:`s${i}`,blocks:[v.sections[0].blocks[0]]}))],
    [L.blocks,(v,n) => v.sections[0].blocks = Array(n).fill(v.sections[0].blocks[0])],
    [L.items,(v,n) => v.sections[0].blocks[1].items = Array(n).fill(v.sections[0].blocks[1].items[0])],
    [L.columns,(v,n) => {const b=v.sections[0].blocks[2];b.headings=Array(n).fill('列');b.rows.forEach((r:any)=>r.cells=Array(n).fill('值'));}],
    [L.rows,(v,n) => {const b=v.sections[0].blocks[2];b.rows=Array(n).fill({...b.rows[0],cells:['指标','20家','短口径']});}],
    [L.nodes,(v,n) => {const b=v.sections[0].blocks[3];b.nodes=Array.from({length:n},(_,i)=>({...b.nodes[0],id:`n${i}`}));b.edges=[];}],
    [L.edges,(v,n) => {const b=v.sections[0].blocks[3];b.edges=Array(n).fill(b.edges[0]);}],
    [L.id,(v,n) => v.sections[0].id='x'.repeat(n)],
    [L.title,(v,n) => v.sections[0].title='中'.repeat(n)],
    [L.text,(v,n) => v.sections[0].blocks[0].text='中'.repeat(n)],
    [L.reason,(v,n) => v.sections[0].blocks[4].reason='中'.repeat(n)],
  ];
  for (const [limit, set] of checks) {const v=structuredClone(fixture);set(v,limit);assert(validStructuredNote(v,facts),String(limit));set(v,limit+1);assert(!validStructuredNote(v,facts),String(limit));}
  const manyFacts = new Set(Array.from({length:L.factIds+1},(_,i)=>`f${i}`)), v=structuredClone(fixture);
  v.sections[0].blocks=[{type:'paragraph',role:'source_supported',factIds:[...manyFacts].slice(0,L.factIds),text:'有据'}];
  assert(validStructuredNote(v,manyFacts));(v.sections[0].blocks[0] as any).factIds=[...manyFacts];assert(!validStructuredNote(v,manyFacts));
  const oversized=structuredClone(fixture);oversized.sections[0].blocks=Array(L.blocks).fill({...fixture.sections[0].blocks[0],text:'中'.repeat(L.text)});assert(!validStructuredNote(oversized,facts));
});
test('KB03 Markdown hostile text remains text in the installed reader, no injected structure or hidden labels', () => {
  const value=structuredClone(fixture), hostile='# 假标题\n\n| a | b |\n<script>alert(1)</script> [链接](https://example.com) ![图](x) `code` **粗体** &lt;hide&gt;';
  value.orientation=hostile;value.sections[0].title=hostile;value.sections[0].question=hostile;
  value.sections[0].blocks[0].text=hostile;value.sections[0].blocks[2].rows[0].cells[2]=hostile;
  const md=renderStructuredNote(parseStructuredNote(value,facts));
  const html=renderToStaticMarkup(React.createElement(Markdown,{skipHtml:true,children:md}));
  const document=new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll('h1').length,1); assert.equal(document.querySelectorAll('h2').length,1);
  assert.equal(document.querySelectorAll('script,a,img,table,code,strong').length,0);
  assert(document.body.textContent!.includes(hostile));
  assert(document.body.textContent!.includes('补充知识，未经原文支持'));assert(document.body.textContent!.includes('fact-1'));
});

test('KB03 old draft compatible; new field strict read/preserve, digest binding and actual HTTP/service formal gates', async () => {
  const f=await storageFixture(); f.succeed(); const job=await f.wait((await f.start()).job.id);
  const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();
  const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();
  const workflows=new KnowledgeWorkflowStore(f.root,wiki,f.rawStore);await workflows.initialize();
  const http=await storageHttp(f);
  try {
    const initial=(await f.drafts.get(job.draftId!))!;initial.source.title='虚构指标来源';
    await writeFile(path.join(f.root,'drafts',`${initial.id}.json`),JSON.stringify(initial));
    const old=await approveDraft(f.drafts,job.draftId!,f.raw.body), oldDigest=f.drafts.contentDigest(old);
    assert(!Object.hasOwn(old,'structuredNote'));assert(isExtractionDraft(old));
    assert.equal(oldDigest,reviewContentDigest({draftId:old.id,rawId:old.rawId,rawSha256:old.rawSha256},candidateContent(old),old.humanReview!));
    const factId=old.humanReview!.units.find(u=>u.kind==='fact')!.records[0].id;
    const note=parseStructuredNote({version:1,orientation:'隔离来源',sections:[{id:'s',title:'指标',question:'多少家？',blocks:[{type:'paragraph',role:'source_supported',factIds:[factId],text:'目标100家。'}]}]},new Set([factId]));
    const next={...old,structuredNote:note}, file=path.join(f.root,'drafts',`${old.id}.json`);
    assert(isExtractionDraft(next));assert.notEqual(f.drafts.contentDigest(next),oldDigest);
    assert.throws(()=>assertHumanReviewed(next.humanReview,next.pages.map(p=>p.pageId),f.drafts.contentDigest(next)),{code:'HUMAN_REVIEW_INCOMPLETE'});
    const changed=structuredClone(next);changed.structuredNote.orientation='改后';assert.notEqual(f.drafts.contentDigest(changed),f.drafts.contentDigest(next));
    assert(!isExtractionDraft({...next,humanReview:undefined}));
    assert(!isExtractionDraft({...next,structuredNote:{...note,extra:1}}));
    const unknown=structuredClone(next);(unknown.structuredNote.sections[0].blocks[0] as any).factIds=['self-reported'];assert(!isExtractionDraft(unknown));
    await writeFile(file,JSON.stringify(next));assert.deepEqual((await f.drafts.get(old.id))!.structuredNote,note);
    for(const injected of [{structuredNote:note},{document:{structuredNote:note}},{source:{structuredNote:note}},{pages:[{pageId:old.pages[0].pageId,structuredNote:note}]}]){
      const response=await fetch(http.base+`/api/drafts/${old.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:old.revision,...injected})});assert.equal(response.status,400);
      assert.deepEqual((await f.drafts.get(old.id))!.structuredNote,note);
    }
    const commitInput={draftId:old.id,baseRevision:old.revision,selectedPageIds:[old.pages[0].pageId],idempotencyKey:randomUUID(),operationId:randomUUID(),now:new Date().toISOString()};
    await assert.rejects(wiki.withLock(()=>commits.confirm(commitInput)),{code:'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE',message:'请先明确核对深度笔记、引用、覆盖与待确认问题。'});
    await assert.rejects(f.drafts.prepareReviewedCommit(old.id,old.revision,oldDigest,f.raw.body,randomUUID(),async()=>assert.fail('must not prepare')),{code:'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE'});
    const formalHttp=await http.request(`/api/drafts/${old.id}/confirm`,commitInput);assert.equal(formalHttp.status,409);assert.equal(formalHttp.json.error.message,'请先明确核对深度笔记、引用、覆盖与待确认问题。');
    await assert.rejects(workflows.createUpdate({draftId:old.id,pageId:old.pages[0].pageId,baseRevision:old.revision,targetWikiId:randomUUID(),draft:next,raw:f.raw,target:{} as any,provider:f.provider}),{code:'STRUCTURED_NOTE_CONFIRM_UNAVAILABLE'});
    assert.equal((await wiki.allRecords()).length,0);assert.equal(f.requests.length,2);
    // A harmless old-path edit preserves the note and invalidates the former approvals.
    const bundle=await import('../services/llm/rules.ts').then(m=>m.loadExtractionRules('rules'));
    const edited=await f.drafts.patch(old.id,{baseRevision:old.revision,pages:[{pageId:old.pages[0].pageId,title:'人工修改标题'}]},{body:f.raw.body,rules:{types:['metric'],categories:['metric'],...bundle.fmcg.enums} as any});
    assert.deepEqual(edited.structuredNote,note);assert.equal(edited.humanReview!.approvals.length,0);
    // Corruption is refused by the real file reader, and original bytes stay intact.
    const corrupt=JSON.stringify({...edited,structuredNote:{...note,version:2}});await writeFile(file,corrupt);
    await assert.rejects(f.drafts.get(old.id),{code:'STORAGE_CORRUPT'});assert.equal(await readFile(file,'utf8'),corrupt);
    await writeFile(file,JSON.stringify(old));
    // Startup recovery must not bypass the new gate via an existing zero-write manifest.
    const write=wiki.writePageLocked.bind(wiki);wiki.writePageLocked=async()=>{throw Error('isolated disk stop');};
    await assert.rejects(wiki.withLock(()=>commits.confirm(commitInput)));wiki.writePageLocked=write;
    const interrupted=(await f.drafts.get(old.id))!;await writeFile(file,JSON.stringify({...interrupted,structuredNote:note}));
    const recovery=await commits.reconcile();assert.equal(recovery.resumed.length,0);
    assert.equal(recovery.conflicts[0].code,'NOTE_REVIEW_REQUIRED');assert.equal((await wiki.allRecords()).length,0);
    await writeFile(file,JSON.stringify(interrupted));
    const result=await wiki.withLock(()=>commits.confirm(commitInput));assert.equal(result.manifest.status,'completed');
    const hashes=await Promise.all((await wiki.allRecords()).map(r=>createHash('sha256').update(r.body).digest('hex')));
    const again=await wiki.withLock(()=>commits.confirm({...commitInput,operationId:randomUUID()}));assert(again.reused);
    assert.deepEqual(await Promise.all((await wiki.allRecords()).map(r=>createHash('sha256').update(r.body).digest('hex'))),hashes);
    assert.equal((await f.rawStore.get(f.raw.id))!.body,f.raw.body);
  } finally {await http.close();await f.clean();}
});
