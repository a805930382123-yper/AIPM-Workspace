import os from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore, type WikiInput } from '../services/wiki/store.ts';
import { renderPageBody } from '../services/wiki/render.ts';
import { AuditError, AuditService, locateAnchor } from '../services/audit/service.ts';
import { WikiLint } from '../services/audit/lint.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import type { WikiLintResult } from '../app/api.ts';
import { registerAuditRoutes } from '../server/audit-api.ts';

const baseInput = (title:string, sources:string[] = [], body='正文段落需要核对。'):WikiInput => ({title,type:'concept',category:'industry_basics',sources,tags:[],aliases:[],knowledge_status:'needs_verification',confidence:'low',source_level:'D',review_status:'reviewed',body});
function provider(rawId:string, quote:string, delay?:Promise<void>):LlmProvider { return {name:'fake-audit',model:'fixture',secrets:[],complete:async()=>{if(delay) await delay;return {text:JSON.stringify({replacement:'已确认的修订内容。',rationale:'反馈指出原表述不够准确。',evidence:[{rawId,quote}]}),finishReason:'stop',bytes:180};} }; }

test('B06 Anchor supports context after line movement and rejects duplicate/missing/page-stale targets', () => {
  const moved = locateAnchor('new line\nleft target right\n', {before:'left ',text:'target',after:' right'}, 'paragraph');
  assert.equal(moved.status, 'located'); assert.equal(moved.method, 'context');
  const duplicate = locateAnchor('left target right\nx left target right', {before:'left ',text:'target',after:' right'}, 'paragraph');
  assert.equal(duplicate.status, 'uncertain'); assert.equal(duplicate.method, 'ambiguous');
  const missing = locateAnchor('unrelated', {before:'left ',text:'target',after:' right'}, 'paragraph');
  assert.equal(missing.method, 'missing');
  const stale = locateAnchor('edited body', {before:'',text:'original body',after:''}, 'page', 'wrong-sha');
  assert.equal(stale.method, 'page-changed');
});

test('B06 four decisions preserve history, only accepted/partial write, and accepted retry is idempotent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-b06-audit-'));
  try {
    const raws = new RawStore(root); await raws.initialize(); const raw = await raws.create({title:'Evidence',sourceType:'report',sourceName:'Fixture',tags:[],body:'门店铺货率为72%，来自实测样本。'});
    const wiki = new WikiStore(root, raws); await wiki.initialize();
    const audits = new AuditService(root,wiki,raws); await audits.initialize(); const beforeRaw = await raws.get(raw.id);
    const decisions = ['accepted','partial','rejected','deferred'] as const;
    for (const decision of decisions) {
      const page = await wiki.create(baseInput(`铺货率 ${decision}`,[raw.id],'前文。门店铺货率为72%，来自实测样本。后文。'));
      const anchor = {before:'前文。',text:'门店铺货率为72%，来自实测样本。',after:'后文。'};
      const audit = await audits.create({wikiId:page.id,scope:'paragraph',severity:'error',comment:`decision ${decision}`,anchor});
      const proposed = await audits.propose(audit.id,provider(raw.id,'门店铺货率为72%'));
      const replacement = decision==='partial' ? '用户编辑后保留范围内修订。' : proposed.draft.replacement;
      const input = {baseAuditRevision:proposed.audit.revision,decision,confirm:decision==='accepted'||decision==='partial',draftId:proposed.draft.id,baseDraftRevision:proposed.draft.revision,replacement:decision==='accepted'||decision==='partial'?replacement:undefined,reason:decision==='rejected'||decision==='deferred'?`原因：${decision}`:undefined};
      const priorBody = (await wiki.get(page.id))!.body; const result = await audits.resolve(audit.id,input);
      const after = await wiki.get(page.id); const savedAudit = await audits.get(audit.id);
      if (decision==='accepted'||decision==='partial') { assert.notEqual(after!.body,priorBody); assert.equal(savedAudit?.status,'resolved'); }
      else { assert.equal(after!.body,priorBody); assert.equal(savedAudit?.status,decision==='rejected'?'resolved':'open'); }
      assert.equal(savedAudit?.decisionHistory.at(-1)?.decision,decision);
      if (decision==='accepted') { const retry = await audits.resolve(audit.id,input); assert.equal(retry.reused,true); assert.equal(retry.operationId,result.operationId); }
    }
    assert.equal((await raws.get(raw.id))?.body, beforeRaw?.body); assert.equal((await raws.get(raw.id))?.bodySha256,beforeRaw?.bodySha256);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('B06 failed Audit log leaves open operation evidence and restart reconciles it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-b06-recover-'));
  try {
    const raws = new RawStore(root); await raws.initialize(); const raw = await raws.create({title:'Evidence',sourceType:'report',sourceName:'Fixture',tags:[],body:'来源句子存在于Raw。'});
    const wiki = new WikiStore(root,raws); await wiki.initialize(); const page = await wiki.create(baseInput('恢复页',[raw.id],'开头。原始目标段。结尾。'));
    const audits = new AuditService(root,wiki,raws); await audits.initialize(); const audit = await audits.create({wikiId:page.id,scope:'paragraph',severity:'warning',comment:'验证恢复',anchor:{before:'开头。',text:'原始目标段。',after:'结尾。'}});
    const proposal = await audits.propose(audit.id,provider(raw.id,'来源句子'));
    const original = wiki.appendLogLocked.bind(wiki); let failed = false;
    wiki.appendLogLocked = async entries => { if (!failed && entries[0]?.action==='audit') { failed=true; throw new Error('injected log EIO'); } return original(entries); };
    await assert.rejects(() => audits.resolve(audit.id,{baseAuditRevision:proposal.audit.revision,decision:'accepted',confirm:true,draftId:proposal.draft.id,baseDraftRevision:proposal.draft.revision,replacement:proposal.draft.replacement}), (e:unknown) => e instanceof AuditError && e.code==='AUDIT_LOG_PENDING' && Boolean(e.details));
    assert.equal((await audits.get(audit.id))?.status,'open'); assert.equal((await wiki.get(page.id))?.body.includes('已确认的修订内容。'),true);
    wiki.appendLogLocked = original; const restarted = new AuditService(root,wiki,raws); await restarted.initialize();
    assert.equal((await restarted.get(audit.id))?.status,'resolved'); assert.equal((await restarted.getDraft(proposal.draft.id))?.status,'applied');
    assert.match(await readFile(path.join(root,'knowledge','logs','wiki.jsonl'),'utf8'),/"action":"audit"/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('B06 recovery preserves conflict manifests and does not resolve against changed Wiki or Raw bytes', async () => {
  for (const mutation of ['wiki-body', 'wiki-revision', 'raw-body'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `.test-b06-${mutation}-`));
    try {
      const raws = new RawStore(root); await raws.initialize(); const raw = await raws.create({title:'Evidence',sourceType:'report',sourceName:'Fixture',tags:[],body:'恢复时必须仍然一致的原文。'});
      const wiki = new WikiStore(root,raws); await wiki.initialize(); const page = await wiki.create(baseInput(`冲突恢复 ${mutation}`,[raw.id],'开头。要替换的目标段。结尾。'));
      const audits = new AuditService(root,wiki,raws); await audits.initialize(); const audit = await audits.create({wikiId:page.id,scope:'paragraph',severity:'warning',comment:'冲突不能静默完成',anchor:{before:'开头。',text:'要替换的目标段。',after:'结尾。'}});
      const proposal = await audits.propose(audit.id,provider(raw.id,'恢复时必须仍然一致'));
      const original = wiki.appendLogLocked.bind(wiki); let failed = false;
      wiki.appendLogLocked = async entries => { if (!failed && entries[0]?.action==='audit') { failed=true; throw new Error('injected audit log outage'); } return original(entries); };
      await assert.rejects(() => audits.resolve(audit.id,{baseAuditRevision:proposal.audit.revision,decision:'accepted',confirm:true,draftId:proposal.draft.id,baseDraftRevision:proposal.draft.revision,replacement:proposal.draft.replacement}),e=>e instanceof AuditError&&e.code==='AUDIT_LOG_PENDING');
      wiki.appendLogLocked = original;
      if (mutation === 'wiki-body') { const current = await wiki.get(page.id); await wiki.writePageLocked({...current!,body:'用户手工改过的正文。'}); }
      if (mutation === 'wiki-revision') { const current = await wiki.get(page.id); await wiki.update(page.id,current!.revision,{...current!,body:'用户按 API 新增的正文。'}); }
      if (mutation === 'raw-body') { const rawFile=path.join(root,'knowledge','raw','reports',`${raw.id}.md`); const saved=await readFile(rawFile,'utf8'); await writeFile(rawFile,saved.replace('恢复时必须仍然一致的原文。','用户手工改过的Raw正文。')); }
      const restarted = new AuditService(root,wiki,raws); await restarted.initialize();
      const final = await restarted.get(audit.id); const restoredDraft = await restarted.getDraft(proposal.draft.id); const conflicts = await restarted.conflictsForAudit(audit.id);
      assert.equal(final?.status,'open',`${mutation} must leave Audit open`); assert.equal(final?.decisionHistory.length,0); assert.equal(restoredDraft?.status,'pending'); assert.equal(conflicts.length,1); assert.match(String(conflicts[0]?.conflictReason),/Wiki|Raw/);
      const op = JSON.parse(await readFile(path.join(root,'state','audit-operations',`${conflicts[0]!.operationId}.json`),'utf8')) as {status:string;operationId:string}; assert.equal(op.status,'conflict'); assert.equal(op.operationId,conflicts[0]!.operationId);
      if (mutation === 'wiki-body') assert.equal((await wiki.get(page.id))?.body,'用户手工改过的正文。');
      if (mutation === 'wiki-revision') assert.equal((await wiki.get(page.id))?.body,'用户按 API 新增的正文。');
      if (mutation === 'raw-body') {
        const rawFile=path.join(root,'knowledge','raw','reports',`${raw.id}.md`);
        const changedBytes=await readFile(rawFile,'utf8');
        assert.match(changedBytes,/用户手工改过的Raw正文。/,'恢复冲突不得重写外部修改');
        await assert.rejects(() => raws.get(raw.id), error => (error as { code?: string }).code === 'RAW_INTEGRITY_ERROR');
      }
    } finally { await rm(root,{recursive:true,force:true}); }
  }
});

test('B06 a slow Provider cannot save or revive a suggestion after a human resolves the Audit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-b06-race-'));
  try {
    const raws = new RawStore(root); await raws.initialize(); const raw=await raws.create({title:'race raw',sourceType:'report',sourceName:'Fixture',tags:[],body:'可核验的原句。'});
    const wiki=new WikiStore(root,raws); await wiki.initialize(); const page=await wiki.create(baseInput('race page',[raw.id],'开头。待确认的目标段。结尾。'));
    const audits=new AuditService(root,wiki,raws); await audits.initialize(); const audit=await audits.create({wikiId:page.id,scope:'paragraph',severity:'warning',comment:'竞态',anchor:{before:'开头。',text:'待确认的目标段。',after:'结尾。'}});
    let startedResolve!:()=>void; let releaseResolve!:()=>void; const started=new Promise<void>(resolve=>{startedResolve=resolve;}); const release=new Promise<void>(resolve=>{releaseResolve=resolve;});
    const slow:LlmProvider={name:'slow-fake',model:'race',secrets:[],complete:async()=>{startedResolve();await release;return {text:JSON.stringify({replacement:'延迟建议',rationale:'迟到结果',evidence:[{rawId:raw.id,quote:'可核验的原句'}]}),finishReason:'stop',bytes:100};}};
    const pending=audits.propose(audit.id,slow); await started;
    const rejected=await audits.resolve(audit.id,{baseAuditRevision:audit.revision,decision:'rejected',reason:'用户先拒绝'});
    releaseResolve();
    await assert.rejects(()=>pending,(e:unknown)=>e instanceof AuditError&&e.code==='AUDIT_REVISION_CONFLICT');
    const final=await audits.get(audit.id); assert.equal(final?.status,'resolved'); assert.equal(final?.decisionHistory.length,1); assert.equal(final?.decisionHistory[0]?.decision,'rejected'); assert.equal(final?.pendingDraftId,undefined); assert.equal(rejected.audit.status,'resolved');
    assert.deepEqual(await readdir(path.join(root,'drafts','audit')),[]);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('B06 Wiki Lint reads disk directly and reports all 11 frozen codes without repairing files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-b06-lint-'));
  try {
    const raws = new RawStore(root); await raws.initialize(); const raw = await raws.create({title:'Raw evidence',sourceType:'report',sourceName:'Fixture',tags:[],body:'原文证据定位到这里。'});
    const wiki = new WikiStore(root,raws); await wiki.initialize();
    const broken = await wiki.create(baseInput('坏链页',[], '正文链接 [[不存在页]]。'));
    await wiki.create(baseInput('孤儿页'));
    const duplicateA = await wiki.create(baseInput('重复标题')); await wiki.create(baseInput('重复标题'));
    const unsourced = await wiki.create(baseInput('无证据页',[raw.id],'## 来源事实\n\n- 该门店铺货率增长99%，无来源定位。\n'));
    const b04Fact = await wiki.create(baseInput('B04有效证据页',[raw.id],`## 来源事实\n- 门店铺货率为72%，来自实测样本。（证据 ev1）\n## 来源证据\n- ev1｜原文 [0, ${'原文证据定位到这里。'.length})：原文证据定位到这里。\n`));
    const plainFact = await wiki.create(baseInput('普通段落无证据页',[raw.id],'## 来源事实\n\n铺货率增长99%，无来源定位。\n'));
    const longBody = '经销商样本显示，目标市场门店的有效铺货率为百分之七十二，测量期间覆盖多个城市并经过二次复核。'.repeat(2);
    const longRaw = await raws.create({title:'Long evidence',sourceType:'report',sourceName:'Fixture',tags:[],body:longBody});
    const longFact = await wiki.create(baseInput('B04长引文有效页',[longRaw.id],`## 来源事实\n- 长引文对应事实（证据 ev-long）\n## 来源证据\n- ev-long｜原文 [0, ${longBody.length})：${longBody.slice(0,90)}…\n`));
    const fakeLongFact = await wiki.create(baseInput('B04伪长引文页',[longRaw.id],`## 来源事实\n- 伪造前缀事实（证据 ev-fake）\n## 来源证据\n- ev-fake｜原文 [0, ${longBody.length})：这段文本不是Raw前缀${'假'.repeat(80)}…\n`));
    const sourceMissing = await wiki.create(baseInput('缺来源页',[]));
    const open = await new AuditService(root,wiki,raws).create({wikiId:broken.id,scope:'page',severity:'warning',comment:'待处理整页',});
    const wikiDir=path.join(root,'knowledge','wiki'); const malformedId='11111111-1111-4111-8111-111111111111'; await writeFile(path.join(wikiDir,`${malformedId}.md`),'没有Frontmatter\n## 内容');
    const missingFieldsId='22222222-2222-4222-8222-222222222222'; await writeFile(path.join(wikiDir,`${missingFieldsId}.md`),`---\nid: ${missingFieldsId}\ntitle: 缺字段页\ntype: concept\nsources: []\n---\n# 缺字段页\n`);
    await unlink(path.join(wikiDir,'index.md'));
    const audits=new AuditService(root,wiki,raws); const result=await new WikiLint(root,raws,audits).inspect();
    for (const code of ['BROKEN_WIKI_LINK','ORPHAN_WIKI','INDEX_MISSING','FRONTMATTER_MISSING','SOURCE_MISSING','KNOWLEDGE_STATUS_MISSING','CONFIDENCE_MISSING','SOURCE_LEVEL_MISSING','UNSOURCED_FACT','OPEN_AUDIT','DUPLICATE_TITLE']) assert.ok(result.findings.some(f=>f.code===code),`${code} must be found`);
    assert.ok(result.findings.some(f=>f.objectId===unsourced.id&&f.code==='UNSOURCED_FACT')); assert.ok(result.findings.some(f=>f.objectId===plainFact.id&&f.code==='UNSOURCED_FACT'),'ordinary paragraph facts must be inspected'); assert.ok(!result.findings.some(f=>f.objectId===b04Fact.id&&f.code==='UNSOURCED_FACT'),'B04 fact-level evidence must not be reported as unsourced'); assert.ok(!result.findings.some(f=>f.objectId===longFact.id&&f.code==='UNSOURCED_FACT'),'B04 truncated long quotes must match the verified Raw span'); assert.ok(result.findings.some(f=>f.objectId===fakeLongFact.id&&f.code==='UNSOURCED_FACT'),'an invented B04 prefix must still fail verification'); assert.ok(result.findings.some(f=>f.objectId===sourceMissing.id&&f.code==='SOURCE_MISSING')); assert.ok(result.findings.some(f=>f.objectId===open.wikiId&&f.code==='OPEN_AUDIT'));
    assert.equal(await readFile(path.join(wikiDir,`${broken.id}.md`),'utf8'),(await wiki.readPageFile(broken.id)));
    assert.equal(await readFile(path.join(wikiDir,`${duplicateA.id}.md`),'utf8'),await wiki.readPageFile(duplicateA.id));
    assert.equal(await readFile(path.join(wikiDir,'index.md')).catch(()=>''),'');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('LINT01 validates the renderer’s exact multiline evidence and keeps uncited list items and subheadings in scope', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-lint01-render-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root);
  await raws.initialize();
  const long = '原文首行\r\n\r\n  - 原文列表\r\n## 原文同级标题\r\n' + '符合当前实际筛选条件的门店已完成盘点。'.repeat(7);
  const short = '完整原文\n\n- 原文下一项\n### 原文三级标题';
  const raw = await raws.create({ title: 'Markdown Raw', sourceType: 'report', sourceName: 'Fixture', tags: [], body: `${long}\n${short}` });
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();

  const rendered = renderPageBody({
    pageId: 'fixture', title: '生成页', type: 'concept', category: 'industry_basics', one_line_definition: '夹具',
    source_facts: [
      { text: '生成事实，引用留在下一行。\n', evidenceIds: ['long'] },
      { text: '生成事实使用完整多行证据。', evidenceIds: ['full'] },
    ],
    ai_organized: [], ai_inferences: [], open_questions: [], related_pages: [],
    source_evidence: [
      { id: 'full', rawId: raw.id, quote: short, start: long.length + 1, end: raw.body.length, chunkIndex: 0 },
      { id: 'long', rawId: raw.id, quote: long, start: 0, end: long.length, chunkIndex: 0 },
    ],
    knowledge_status: 'source_supported', confidence: 'medium', source_level: 'B', selected: true, provenance: [],
  }, { sourceTitle: '来源', rawId: raw.id, createdTitles: new Set() });
  assert.ok(rendered.includes(`原文 [0, ${long.length})：${long.slice(0, 90)}…`));
  assert.ok(rendered.includes(`原文 [${long.length + 1}, ${raw.body.length})：${short}`));
  const generated = await wiki.create(baseInput('生成页', [raw.id], rendered));
  const expanded = rendered.replace('## AI 整理', [
    '- 需保留列表标记的独立漏引事实。',
    '- 列表事实的正文续行',
    '  仍属本条。（证据 long）',
    '  - 有依据的子项目。（证据 long）',
    '  - 漏引子项目。',
    '- 引用只属于下一条嵌套事实。',
    '  1. 子项目有引文。（证据 full）',
    '',
    '- 引用被空行隔开的事实。',
    '',
    '（证据 long）',
    '### 小标题',
    '- 子标题下漏引。',
    '- 子标题下有引文。（证据 full）',
    '#### 更深标题',
    '小标题下普通段落漏引。',
    '## AI 整理',
  ].join('\n'));
  const mixed = await wiki.create(baseInput('混合页', [raw.id], expanded));
  const forged = await wiki.create(baseInput('伪造证据', [raw.id], rendered.replace('原文列表', '伪造列表')));
  const wrongEnd = await wiki.create(baseInput('越界证据', [raw.id], rendered.replace(`[0, ${long.length})`, `[0, ${raw.body.length + 1})`)));
  const missing = await wiki.create(baseInput('缺失 Raw', [raw.id], rendered));
  const missingRawId = '11111111-1111-4111-8111-111111111111';
  const missingFile = path.join(root, 'knowledge', 'wiki', `${missing.id}.md`);
  await writeFile(missingFile, (await readFile(missingFile, 'utf8')).replaceAll(raw.id, missingRawId));

  const result = await new WikiLint(root, raws, new AuditService(root, wiki, raws)).inspect();
  const facts = (id: string) => result.findings.filter(f => f.objectId === id && f.code === 'UNSOURCED_FACT').map(f => f.location.text);
  assert.deepEqual(facts(generated.id), []);
  assert.deepEqual(facts(mixed.id), [
    '- 需保留列表标记的独立漏引事实。', '  - 漏引子项目。', '- 引用只属于下一条嵌套事实。',
    '- 引用被空行隔开的事实。', '- 子标题下漏引。', '小标题下普通段落漏引。',
  ]);
  assert.deepEqual(facts(forged.id), ['- 生成事实，引用留在下一行。']);
  assert.deepEqual(facts(wrongEnd.id), ['- 生成事实，引用留在下一行。']);
  assert.equal(facts(missing.id).length, 2);
  assert.ok(result.findings.some(f => f.code === 'SOURCE_MISSING' && f.objectId === missing.id));
});

test('LINT01 preserves citation formats and exposes the real disk line and degraded Audit over HTTP', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-lint01-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root);
  await raws.initialize();
  const quote = '同一资料中可验证的原文。';
  const paddedQuote = ' 含首尾空格的真实原文。 ';
  const firstPart = `${quote}另一条确定的原文。`;
  const paddedStart = firstPart.length + 2;
  const raw = await raws.create({ title: '原始资料', sourceType: 'note', sourceName: 'Fixture', tags: [], body: `${firstPart}  ${paddedQuote}` });
  const other = await raws.create({ title: '外页资料', sourceType: 'note', sourceName: 'Fixture', tags: [], body: quote });
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const expectedUnsourced = [
    `- 空白内联引文 [[raw:${raw.id}]]“  ”`,
    `- 内联引文的首尾空格与原文不同 [[raw:${raw.id}]]“ ${paddedQuote} ”`,
    `- 空引文。来源 Raw ${raw.id}，原文 [0, ${quote.length})：`,
    `- 空白坐标引文。来源 Raw ${raw.id}，原文 [0, ${quote.length})：“  ”`,
    `- 坐标引文的首尾空格与原文不同。来源 Raw ${raw.id}，原文 [0, ${quote.length})：“ ${quote} ”`,
    `- 只能定位到空白的坐标。来源 Raw ${raw.id}，原文 [${firstPart.length}, ${paddedStart})`,
    '- 不能把别页 Raw 算作出处。（unlisted）',
    '- 超过 Raw 原文。（overflow）',
    '- 同名坐标有冲突。（collision）',
    '- 证据 ID 存在但无引文。（证据 empty）',
    '- 原文区间只有空白。（证据 whitespace）',
    '- 书目坐标只能定位到空白。（legacy-space）',
    '- 仅页级书目，无逐条引用。' + '长'.repeat(120),
    '- 裸 ID 无书目坐标。（missing）',
    '- B04 的证据 ID 需要引用标记。（plain）',
  ];
  const factsBody = [
    '## Source Facts',
    `- 可核验的内联引文 [[raw:${raw.id}]]“${quote}”`,
    `- 可核验的带空格内联引文 [[raw:${raw.id}]]“${paddedQuote}”`,
    `- 可核验的行内坐标。来源 Raw ${raw.id}，原文 [0, ${quote.length})`,
    `- 可核验的行内精确引文。来源 Raw ${raw.id}，原文 [0, ${quote.length})：“${quote}”`,
    `- 可核验的带空格行内坐标引文。来源 Raw ${raw.id}，原文 [${paddedStart}, ${raw.body.length})：“${paddedQuote}”`,
    '- 历史书目带坐标的引用。（legacy1）',
    '- 历史书目的多坐标引用。（legacy1、legacy2）',
    ...expectedUnsourced,
    '## Source Evidence',
    `- 《原始资料》，Raw ${raw.id}，证据 legacy1（原文 [0, ${quote.length})）、legacy2（原文 [${quote.length}, ${raw.body.length})）。`,
    `- 《外页资料》，Raw ${other.id}，证据 unlisted（原文 [0, ${quote.length})）。`,
    `- 《原始资料》，Raw ${raw.id}，证据 overflow（原文 [0, ${raw.body.length + 1})）。`,
    `- 《原始资料》，Raw ${raw.id}，证据 collision（原文 [0, ${quote.length})）。`,
    `- 《原始资料》，Raw ${raw.id}，证据 collision（原文 [${quote.length}, ${raw.body.length})）。`,
    `- 《原始资料》，Raw ${raw.id}，证据 legacy-space（原文 [${firstPart.length}, ${paddedStart})）。`,
    `- empty｜原文 [0, ${quote.length})：`,
    `- whitespace｜原文 [${firstPart.length}, ${paddedStart})：  `,
    `- plain｜原文 [0, ${quote.length})：${quote}`,
    '## 其它内容',
    '有断链 [[不存在页]]。',
  ].join('\r\n');
  const page = await wiki.create(baseInput('来源匹配页', [raw.id], factsBody));
  const lostPage = await wiki.create(baseInput('即将移除的页面', [raw.id]));
  const audits = new AuditService(root, wiki, raws);
  const open = await audits.create({ wikiId: lostPage.id, scope: 'page', severity: 'warning', comment: '目标缺页仍可定位 Audit。' });
  await unlink(path.join(root, 'knowledge', 'wiki', `${lostPage.id}.md`));
  const app = express();
  registerAuditRoutes(app, { root, wiki, raws, audits, provider: () => undefined });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/wiki-lint`);
    assert.equal(response.status, 200);
    const result = await response.json() as WikiLintResult;
    assert.match(result.wikiFilesSha256, /^[\da-f]{64}$/);
    const file = `knowledge/wiki/${page.id}.md`;
    const rows = (await readFile(path.join(root, file), 'utf8')).split(/\r?\n/u);
    const findings = result.findings.filter(f => f.objectId === page.id && f.code === 'UNSOURCED_FACT');
    assert.deepEqual(findings.map(f => f.location.text), expectedUnsourced.map(line => line.slice(0, 120)));
    for (const finding of findings) {
      assert.equal(finding.pageTitle, page.title);
      assert.equal(finding.file, file);
      assert.equal(finding.location.scope, 'line');
      assert.equal(finding.location.text, rows[finding.location.line - 1]!.slice(0, 120));
      assert.ok(finding.message.length);
    }
    const broken = result.findings.find(f => f.code === 'BROKEN_WIKI_LINK' && f.objectId === page.id);
    assert.equal(broken?.location.text, '有断链 [[不存在页]]。');
    const orphan = result.findings.find(f => f.code === 'ORPHAN_WIKI' && f.objectId === page.id);
    assert.equal(orphan?.location.scope, 'page');
    assert.equal(orphan?.location.line, 1);
    const degraded = result.findings.find(f => f.code === 'OPEN_AUDIT');
    assert.deepEqual(degraded, {
      code: 'OPEN_AUDIT', objectId: null, pageTitle: null, file: `knowledge/audit/${open.id}.json`,
      message: `Audit ${open.id} 尚未处理：${open.comment}`, location: { scope: 'page', line: 1 },
    });
    assert.equal(result.summary['UNSOURCED_FACT'], findings.length);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
