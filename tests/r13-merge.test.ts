import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { r13Fixture } from './support/r13-merge-fixture.ts';
import { approveDraft, approveWorkflow } from './support/human-review.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { renderPageBody } from '../services/wiki/render.ts';
import { captureTemplateFields, renderInputTemplateFields, validInputTemplateFields } from '../services/wiki/template-fields.ts';

for(const type of ['concept','business_process'] as const)test(`R13 M01 ${type} equal fields retain separate 4000-char AI items and immutable units`,async t=>{
  const f=await r13Fixture({types:[type,type,type],longAi:true});t.after(f.clean);
  const before=await approveDraft(f.drafts,f.draft.id,f.body),raw=await readFile(path.join(f.root,'knowledge/raw/notes',f.raw.id+'.md'));
  const merged=await f.drafts.patch(before.id,{baseRevision:before.revision,merge:{pageIds:before.pages.slice(0,2).map(p=>p.pageId)}},{body:f.body,rules:f.rules});
  assert.deepEqual(merged.humanReview!.units,before.humanReview!.units);assert.equal(merged.humanReview!.basisDigest,before.humanReview!.basisDigest);assert.equal(merged.humanReview!.approvals.length,0);
  const page=merged.pages.find(p=>p.pageId===before.pages[0].pageId)!,group=page.mergedTemplateFields![0],key=type==='concept'?'definition':'steps';
  assert.equal(page.type,type);assert.equal(page.templateFields![key]!.aiContent!.text.length,4000);assert.equal(group.fields[key]!.aiContent!.text.length,4000);assert.equal(group.fields[key]!.aiContent!.humanEdited,true);
  assert.equal(group.title,before.pages[1].title);assert.equal(group.facts[0].id,'fact-2');assert.equal(group.evidence[0].start,before.pages[1].source_evidence[0].start);
  assert.equal(merged.humanReview!.assignments['unit-2'],page.pageId);assert.equal(page.source_evidence.length,2);
  assert.equal(renderPageBody(page,{sourceTitle:'来源',rawId:f.raw.id,createdTitles:new Set()}).includes('乙'.repeat(4000)),true);
  assert.deepEqual(await readFile(path.join(f.root,'knowledge/raw/notes',f.raw.id+'.md')),raw);
});

test('R13 M01/03 same type distinct fields and explicit AI deletion retain the remaining original group',async t=>{
  const f=await r13Fixture({types:['concept','concept']});t.after(f.clean);const second=f.draft.pages[1];
  let d=await f.drafts.patch(f.draft.id,{baseRevision:f.draft.revision,pages:[{pageId:second.pageId,templateFields:{...second.templateFields,scenarios:{evidenceIds:['shared'],humanText:'第二原页独立场景说明'}}}]},{body:f.body,rules:f.rules});
  d=await f.drafts.patch(d.id,{baseRevision:d.revision,merge:{pageIds:f.draft.pages.map(p=>p.pageId)}},{body:f.body,rules:f.rules});const groups=structuredClone(d.pages[0].mergedTemplateFields!);
  assert.equal(groups[0].fields.scenarios!.humanText,'第二原页独立场景说明');assert.equal(groups[0].fields.definition!.humanText,'原页2人工说明。');
  delete groups[0].fields.definition!.aiContent;
  d=await f.drafts.patch(d.id,{baseRevision:d.revision,pages:[{pageId:d.pages[0].pageId,mergedTemplateFields:groups}]},{body:f.body,rules:f.rules});
  assert.equal(d.pages[0].mergedTemplateFields![0].fields.definition!.aiContent,undefined);assert.equal(d.pages[0].mergedTemplateFields![0].fields.scenarios!.humanText,'第二原页独立场景说明');assert.equal(d.pages[0].templateFields!.definition!.aiContent!.text,f.draft.pages[0].templateFields!.definition!.aiContent!.text);
});

for(const first of ['concept','business_process'] as const)test(`R13 M02 ${first} first, cross type and repeated merge flatten original namespaces`,async t=>{
  const other=first==='concept'?'business_process':'concept',f=await r13Fixture({types:[first,other,'concept']});t.after(f.clean);
  const original=f.draft,firstIds=original.pages.slice(0,2).map(p=>p.pageId);
  let merged=await f.drafts.patch(original.id,{baseRevision:original.revision,merge:{pageIds:firstIds}},{body:f.body,rules:f.rules});
  const target=merged.pages.find(p=>p.pageId===firstIds[0])!;assert.equal(target.type,first);assert.equal(target.mergedTemplateFields![0].pageType,other);
  merged=await f.drafts.patch(merged.id,{baseRevision:merged.revision,merge:{pageIds:[original.pages[2].pageId,target.pageId]}},{body:f.body,rules:f.rules});
  const page=merged.pages[0];assert.equal(page.pageId,original.pages[2].pageId);assert.equal(page.type,'concept');assert.equal(page.mergedTemplateFields!.length,2);assert.equal(new Set(page.mergedTemplateFields!.map(g=>g.pageId)).size,2);
  for(const group of page.mergedTemplateFields!){assert.equal('mergedTemplateFields'in group,false);for(const evidence of group.evidence)assert.equal(f.body.slice(evidence.start,evidence.end),evidence.quote);}
  assert.deepEqual(merged.humanReview!.units,original.humanReview!.units);assert.equal(page.source_evidence.length,3);
});

test('R13 M03 group edits roundtrip and clear all approvals; directories, empty array and invalid references reject atomically',async t=>{
  const f=await r13Fixture({types:['concept','business_process','concept'],humanOnly:[2]});t.after(f.clean);
  let merged=await f.drafts.patch(f.draft.id,{baseRevision:f.draft.revision,merge:{pageIds:f.draft.pages.slice(0,2).map(p=>p.pageId)}},{body:f.body,rules:f.rules});
  const pageId=f.draft.pages[0].pageId,file=path.join(f.root,'drafts',merged.id+'.json');
  await assert.rejects(f.wiki.withLock(()=>f.commits.confirm({draftId:merged.id,baseRevision:merged.revision,selectedPageIds:[pageId],idempotencyKey:'unreviewed',operationId:randomUUID(),now:new Date().toISOString()})),{code:'HUMAN_REVIEW_INCOMPLETE'});
  merged=await approveDraft(f.drafts,merged.id,f.body);const page=merged.pages.find(p=>p.pageId===pageId)!,groups=structuredClone(page.mergedTemplateFields!);groups[0].fields.steps!.humanText='本轮人工编辑组说明';groups[0].fields.steps!.aiContent!.text='本轮人工编辑AI文字';
  merged=await f.drafts.patch(merged.id,{baseRevision:merged.revision,pages:[{pageId,mergedTemplateFields:groups}]},{body:f.body,rules:f.rules});
  assert.equal(merged.humanReview!.approvals.length,0);const reloaded=(await new DraftStore(f.root).get(merged.id))!,saved=reloaded.pages.find(p=>p.pageId===pageId)!.mergedTemplateFields!;
  assert.equal(saved[0].fields.steps!.humanText,'本轮人工编辑组说明');assert.equal(saved[0].fields.steps!.aiContent!.humanEdited,true);
  const bytes=await readFile(file);for(const invalid of [[],[{...saved[0],title:'注入身份'}],[{...saved[0],facts:[{...saved[0].facts[0],text:'篡改事实'}]}],[{...saved[0],fields:{steps:{evidenceIds:['outside']}}}]]){
    await assert.rejects(f.drafts.patch(merged.id,{baseRevision:merged.revision,pages:[{pageId,mergedTemplateFields:invalid}]},{body:f.body,rules:f.rules}));assert.deepEqual(await readFile(file),bytes);
  }
  const humanUnit=merged.humanReview!.units.find(u=>u.kind==='question')!;merged=await f.drafts.reviewOperation(merged.id,{action:'move',baseRevision:merged.revision,unitIds:[humanUnit.id],pageId:null},{body:f.body,rulesDir:'rules'});
  merged=await approveDraft(f.drafts,merged.id,f.body);await assert.rejects(f.wiki.withLock(()=>f.commits.confirm({draftId:merged.id,baseRevision:merged.revision,selectedPageIds:[pageId],idempotencyKey:'unresolved',operationId:randomUUID(),now:new Date().toISOString()})),{code:'HUMAN_REVIEW_INCOMPLETE'});
  const bad=structuredClone(merged);bad.pages.find(p=>p.pageId===pageId)!.mergedTemplateFields![0].evidence[0].start=0;const badBytes=JSON.stringify(bad);await writeFile(file,badBytes);await assert.rejects(f.drafts.get(merged.id));assert.equal(await readFile(file,'utf8'),badBytes);
});

test('R13 M03 human-only groups allow empty fact directory; 3MiB roundtrip limit rejects merge without changing bytes',async t=>{
  const f=await r13Fixture({types:['concept','business_process'],humanOnly:[1]});t.after(f.clean);
  const merged=await f.drafts.patch(f.draft.id,{baseRevision:f.draft.revision,merge:{pageIds:f.draft.pages.map(p=>p.pageId)}},{body:f.body,rules:f.rules});assert.deepEqual(merged.pages[0].mergedTemplateFields![0].facts,[]);assert.equal(merged.pages[0].mergedTemplateFields![0].fields.steps!.humanText,'原页2人工说明。');
  const large=await r13Fixture({types:['concept','concept'],humanLength:450000});t.after(large.clean);const file=path.join(large.root,'drafts',large.draft.id+'.json'),bytes=await readFile(file);
  await assert.rejects(large.drafts.patch(large.draft.id,{baseRevision:large.draft.revision,pages:large.draft.pages.map(p=>({pageId:p.pageId,selected:true})),merge:{pageIds:large.draft.pages.map(p=>p.pageId)}},{body:large.body,rules:large.rules}),{code:'DRAFT_PATCH_TOO_LARGE'});assert.deepEqual(await readFile(file),bytes);
});

test('R13 M04 merged groups survive reviewed update and formal Source/Wiki commit; edits invalidate old update input',async t=>{
  const f=await r13Fixture({types:['concept','business_process']});t.after(f.clean);
  let draft=await f.drafts.patch(f.draft.id,{baseRevision:f.draft.revision,merge:{pageIds:f.draft.pages.map(p=>p.pageId)}},{body:f.body,rules:f.rules});draft=await approveDraft(f.drafts,draft.id,f.body);const page=draft.pages[0];
  const result=await f.wiki.withLock(()=>f.commits.confirm({draftId:draft.id,baseRevision:draft.revision,selectedPageIds:[page.pageId],idempotencyKey:'merged-create',operationId:randomUUID(),now:new Date().toISOString()}));
  draft=(await f.drafts.get(draft.id))!;
  const snapshotWithLegacyExtra=captureTemplateFields({...page,source_evidence:page.source_evidence.map(e=>({...e,occurrences:1}))},f.raw.id,draft.humanReview!)!;
  assert.equal(validInputTemplateFields(snapshotWithLegacyExtra),true);assert(snapshotWithLegacyExtra.evidence.every(e=>!Object.hasOwn(e,'occurrences')));
  const target=await f.wiki.create({title:'既有合并目标',type:'concept',category:'supply_chain',sources:[f.raw.id],tags:[],aliases:[],body:'旧正文保持。',knowledge_status:'source_supported',confidence:'low',source_level:'D',review_status:'unreviewed'});let request:any;
  const create=()=>f.workflows.createUpdate({draftId:draft.id,pageId:page.pageId,baseRevision:draft.revision,targetWikiId:target.id,draft,raw:f.raw,target,provider:{name:'offline-fake',model:'update',complete:async r=>{request=JSON.parse(r.user);return{text:JSON.stringify({suggestedAdditions:[],conflicts:[],agreement:[],inferences:[],openQuestions:[]}),bytes:1,finishReason:'stop'};}}});
  let workflow=await create();assert.deepEqual(request.newSource.templateFields.mergedTemplateFields,page.mergedTemplateFields);const appendix=renderInputTemplateFields(workflow.inputTemplateFields!);assert(appendix.includes('business_process'));assert(appendix.includes('原页2人工说明。'));
  workflow=await approveWorkflow(f.workflows,workflow.id);const formalUpdate=await f.workflows.confirm(workflow.id,workflow.revision,'merged-update');assert((await f.wiki.get(target.id))!.body.includes(appendix));
  const records=await f.wiki.allRecords();assert(records.find(p=>p.id===result.manifest.snapshot.pageRecords[0].id)!.body.includes('原页2人工说明。'));assert(records.find(p=>p.type==='source')!.body.includes('原页2人工说明。'));
  const before=await readFile(path.join(f.root,'knowledge/logs/wiki.jsonl'));await f.workflows.confirm(workflow.id,formalUpdate.workflow.revision,'merged-update');assert.deepEqual(await readFile(path.join(f.root,'knowledge/logs/wiki.jsonl')),before);
  const fresh=await r13Fixture({types:['concept','business_process']});t.after(fresh.clean);let d=await fresh.drafts.patch(fresh.draft.id,{baseRevision:fresh.draft.revision,merge:{pageIds:fresh.draft.pages.map(p=>p.pageId)}},{body:fresh.body,rules:fresh.rules});d=await approveDraft(fresh.drafts,d.id,fresh.body);
  const old=await fresh.wiki.create({...target,title:'其他目标',sources:[fresh.raw.id]});const w=await fresh.workflows.createUpdate({draftId:d.id,pageId:d.pages[0].pageId,baseRevision:d.revision,targetWikiId:old.id,draft:d,raw:fresh.raw,target:old,provider:{name:'fake',model:'no-network',complete:async()=>({text:'{"suggestedAdditions":[],"conflicts":[],"agreement":[],"inferences":[],"openQuestions":[]}',bytes:1,finishReason:'stop'})}});const reviewed=await approveWorkflow(fresh.workflows,w.id),groups=structuredClone(d.pages[0].mergedTemplateFields!);groups[0].fields.steps!.humanText='修改后旧更新应失效';await fresh.drafts.patch(d.id,{baseRevision:d.revision,pages:[{pageId:d.pages[0].pageId,mergedTemplateFields:groups}]},{body:fresh.body,rules:fresh.rules});await assert.rejects(fresh.workflows.confirm(w.id,reviewed.revision,'stale'),{code:'INPUT_REVIEW_CHANGED'});
});
