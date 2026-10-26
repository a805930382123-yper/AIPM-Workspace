// Read-only independent verification of main agent's Chrome session.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RawStore} from '../../services/raw/store.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {renderPageBody} from '../../services/wiki/render.ts';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const lab=await json('docs/reports/R12-20261026-builder-lab.json');
const orig=await json('.scratch-KB02-K204-C-20261024-vKvjss/candidate-C.json');
const draft=await json(path.join(lab.root,'drafts',lab.draftId+'.json'));
assert.equal(draft.status,'confirmed');assert.equal(draft.revision,21);assert.deepEqual(draft.humanQuestionUnitIds,lab.questionUnitIds);
assert.deepEqual(draft.humanReview.units,orig.humanReview.units);assert.deepEqual(draft.humanReview.assignments,orig.humanReview.assignments);assert.equal(draft.humanReview.basisDigest,orig.humanReview.basisDigest);
const owners=lab.questionUnitIds.map(id=>draft.humanReview.assignments[id]);
const text='人工标记待确认：异常审批负责人未知，AI仅未来分析建议。';
for(const p of draft.pages){const before=orig.pages.find(x=>x.pageId===p.pageId);assert.deepEqual(p.source_facts,before.source_facts);assert.deepEqual(p.source_evidence,before.source_evidence);assert.deepEqual(p.open_questions,owners.includes(p.pageId)?[text]:before.open_questions);assert.equal(p.selected,owners.includes(p.pageId));}
const raw=await new RawStore(lab.root).get(lab.rawId);assert.equal(raw.bodySha256,orig.rawSha256);assert.equal(hash(raw.body),orig.rawSha256);
const ds=new DraftStore(lab.root);assert.equal(draft.humanReview.approvals.length,14);const digest=await ds.assertReviewed(draft,raw.body);assert(draft.humanReview.approvals.every(a=>a.digest===digest));
const operation=await json(path.join(lab.root,'state/wiki-commits',draft.commitOperationId+'.json'));
assert.equal(operation.operationId,'ed4a52b6-3ad2-4946-9cd1-5f04d65cbd7c');assert.equal(operation.status,'completed');assert.equal(operation.snapshot.capturedRevision,21);assert.deepEqual(operation.snapshot.selectedPageIds,owners);
const wiki=new WikiStore(lab.root,new RawStore(lab.root));const records=await wiki.allRecords();assert.equal(records.length,3);
const source=records.find(r=>r.type==='source');assert(source);assert(source.sources.includes(lab.rawId));
const snapshots=[operation.snapshot.sourceRecord,...operation.snapshot.pageRecords];
for(const r of records){const expected=snapshots.find(x=>x.id===r.id);assert(expected);assert.deepEqual(r,expected);assert.equal(r.revision,1);if(r.type!=='source'){const p=draft.pages.find(x=>x.title===r.title);assert(owners.includes(p.pageId));assert.equal(r.body,renderPageBody(p,{sourceTitle:source.title,rawId:lab.rawId,createdTitles:new Set(draft.pages.filter(p=>p.selected).map(p=>p.title))}));assert(r.body.includes('## 待确认问题\n\n- '+text));assert(source.body.includes('[['+r.title+']]'));}}
const logs=(await readFile(path.join(lab.root,'knowledge/logs/wiki.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(logs.length,3);assert.deepEqual(logs.map(l=>l.id).sort(),records.map(r=>r.id).sort());assert(logs.every(l=>l.operationId===operation.operationId&&l.action==='create'));
const reviewSteps=await json('docs/reports/R12-MAIN-20261026-reviews.json');assert.equal(reviewSteps.length,14);for(let i=0;i<14;i++){assert.equal(reviewSteps[i].page,i+1);assert(reviewSteps[i].state.includes(`已审  ${i+1} / 14`));}
const readback=await readFile('docs/reports/R12-MAIN-20261026-readback-ax.txt','utf8');assert(readback.includes('状态  confirmed'));assert(readback.includes('button (disabled) 确认写入 Wiki（2）'));assert(!readback.includes('checkbox 同时列入待确认问题'));assert(readback.split(text).length>=3);
const freeze=await json('docs/reports/R12-20261026-builder-freeze.json');for(const f of [...freeze.files,...freeze.originalFiles])assert.equal(hash(await readFile(f.path)),f.sha256,f.path);
console.log(JSON.stringify({status:'PASS',revision:draft.revision,units:draft.humanReview.units.length,approvals:14,digest,rawSha256:raw.bodySha256,operationId:operation.operationId,wikiIds:records.map(r=>r.id),logs:logs.length,freeze:freeze.aggregate,realCalls:0,configReads:0}));
