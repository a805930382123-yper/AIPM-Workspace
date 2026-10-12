import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore, type WikiInput } from '../services/wiki/store.ts';
import { AuditError, AuditService, locateAnchor } from '../services/audit/service.ts';
import { WikiLint } from '../services/audit/lint.ts';
import type { LlmProvider } from '../services/llm/provider.ts';

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
  const root = await mkdtemp(path.join(process.cwd(), '.test-b06-audit-'));
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
  const root = await mkdtemp(path.join(process.cwd(), '.test-b06-recover-'));
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
    const root = await mkdtemp(path.join(process.cwd(), `.test-b06-${mutation}-`));
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
  const root = await mkdtemp(path.join(process.cwd(), '.test-b06-race-'));
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
  const root = await mkdtemp(path.join(process.cwd(), '.test-b06-lint-'));
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
