import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHarness, expect, request, rawInput, wikiInput, fileSnapshot, filesUnder, delay } from './b06-harness.mjs';
const rawBody = '验收原始资料：铺货率采用有销售门店数除以目标门店数，统计周期为自然月。';
const original = '铺货率采用上架门店数除以目标门店数。';
const corrected = '铺货率采用有销售门店数除以目标门店数。';
const prefix = '## 人工保留前文\n';
const suffix = '\n## 人工保留后文\n范围需要业务确认。';
let replyRaw;
const fakeReply = () => ({ replacement: corrected, rationale: '按原始资料修改口径，保留人工上下文', evidence: [{ rawId: replyRaw.id, quote: rawBody }] });
const started = Date.now(), harness = await createHarness(fakeReply);
const report = { clientDate: '2026-10-07', provider: 'independent HTTP fake only; real quality BLOCKED', dataRoot: harness.dataRoot, checks: [], services: [] };
let service, sequence = 0;
async function reset() {
  if (service) await harness.stop(service);
  const dir = path.join(harness.dataRoot, String(++sequence)); await mkdir(dir);
  harness.setReply(fakeReply); service = await harness.start(dir);
}
async function test(id, fn) {
  if (process.env.B06_ONLY && !process.env.B06_ONLY.split(',').includes(id)) return;
  try { await reset(); report.checks.push({ id, result: 'PASS', evidence: await fn() }); }
  catch (error) { report.checks.push({ id, result: 'FAIL', error: error.stack }); }
  console.log(id + ': ' + report.checks.at(-1).result);
}
const unwrapAudit = data => data.audit;
const getAudit = async id => unwrapAudit(await expect(service, `/api/audits/${id}`, 'GET'));
const getDraft = async id => { const data = await expect(service, `/api/audit-drafts/${id}`, 'GET'); return data.draft ?? data; };
const getWiki = id => expect(service, `/api/wiki/${id}`, 'GET');
const rawHashes = () => fileSnapshot(path.join(service.dir, 'knowledge', 'raw'));
const wikiHashes = () => fileSnapshot(path.join(service.dir, 'knowledge', 'wiki'));
const allKnowledge = () => fileSnapshot(path.join(service.dir, 'knowledge'));
async function fixture(body = prefix + original + suffix) {
  const raw = await expect(service, '/api/raw', 'POST', rawInput('B06口径来源', rawBody), 201); replyRaw = raw;
  const wiki = await expect(service, '/api/wiki', 'POST', wikiInput('B06铺货率', [raw.id], body, { aliases: ['B06原别名'], tags: ['验收口径'] }), 201);
  return { raw, wiki };
}
async function audit(wiki, scope = 'paragraph', severity = 'error', anchor = { before: prefix, text: original, after: suffix }) {
  const data = await expect(service, '/api/audits', 'POST', { wikiId: wiki.id, scope, severity, comment: '反馈：口径错误，请依Raw纠正并保留其他人工文字。', ...(scope === 'paragraph' ? { anchor } : {}) }, 201);
  const record = data.audit ?? data; assert.ok(record.id && record.revision); return record;
}
async function propose(a) {
  const result = await request(service, `/api/audits/${a.id}/propose`, 'POST', {});
  assert.ok([200, 201, 202].includes(result.status), result.text);
  assert.ok(result.json.draft?.id, result.text); Object.assign(a, result.json.audit ?? await getAudit(a.id)); return result.json.draft;
}
const payload = (a, d, decision = 'accepted', extra = {}) => ({ decision, confirm: true, baseAuditRevision: a.revision, draftId: d.id, baseDraftRevision: d.revision, ...extra });
async function resolve(a, body, status = 200) { return expect(service, `/api/audits/${a.id}/resolve`, 'POST', body, status); }
async function editWiki(wiki, body) { return expect(service, `/api/wiki/${wiki.id}`, 'PUT', { ...wikiInput(wiki.title, wiki.sources, body, wiki), body, baseRevision: wiki.revision }); }
async function restart() { const dir = service.dir; await harness.stop(service); service = await harness.start(dir); }
try {
  await test('E06-01-create-persist-stats', async () => {
    const { wiki } = await fixture(); const hashes = await rawHashes();
    const audits = [];
    for (const severity of ['error', 'warning', 'suggestion', 'supplement']) audits.push(await audit(wiki, severity === 'supplement' ? 'page' : 'paragraph', severity));
    const invalid = await request(service, '/api/audits', 'POST', { wikiId: wiki.id, scope: 'paragraph', severity: 'error', comment: '虚构目标', anchor: { before: '', text: '从来不存在的句子', after: '' } });
    assert.ok(invalid.status >= 400, invalid.text);
    const invalidId = await request(service, '/api/audits/../bad/relocate', 'POST', {}); assert.ok(invalidId.status >= 400);
    assert.equal((await expect(service, '/api/stats', 'GET')).openAuditCount, 4);
    await restart();
    for (const a of audits) { const stored = await getAudit(a.id); assert.equal(stored.status, 'open'); assert.equal(stored.comment, a.comment); assert.equal(stored.severity, a.severity); assert.deepEqual(stored.anchor, a.anchor); }
    assert.equal((await expect(service, '/api/audits?status=open', 'GET')).items.length, 4); assert.deepEqual(await rawHashes(), hashes);
    return { ids: audits.map(a => a.id), restartSameDirectory: true, rawUnchanged: true };
  });
  await test('E06-02-anchor-movement-and-negatives', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki);
    await editWiki(wiki, '插入的三行\n新行\n新行\n' + wiki.body);
    const d = await propose(a); assert.equal(d.baseWikiRevision, 2);
    const before = await wikiHashes();
    await editWiki(await getWiki(wiki.id), wiki.body + '\n' + wiki.body);
    const ambiguous = await request(service, `/api/audits/${a.id}/propose`, 'POST', {});
    assert.equal(ambiguous.status, 409, ambiguous.text);
    const current = await getWiki(wiki.id);
    await editWiki(current, '原目标已删除，只剩人工记录。');
    const missing = await request(service, `/api/audits/${a.id}/propose`, 'POST', {}); assert.equal(missing.status, 409, missing.text);
    const latestAudit = await getAudit(a.id);
    const relocated = await expect(service, `/api/audits/${a.id}/relocate`, 'POST', { baseAuditRevision: latestAudit.revision, anchor: { before: '', text: '原目标已删除，只剩人工记录。', after: '' } });
    assert.ok(relocated.audit.revision > latestAudit.revision); assert.ok(JSON.stringify(relocated.audit).includes(original), 'old anchor history must remain');
    const whole = await audit(await getWiki(wiki.id), 'page');
    await editWiki(await getWiki(wiki.id), '人工整页已改动。');
    assert.equal((await request(service, `/api/audits/${whole.id}/propose`, 'POST', {})).status, 409);
    assert.ok(Object.keys(before).length); return { movement: 'found', ambiguous: ambiguous.json, deleted: missing.json, wholePageStale: true, originalAnchorRetained: true };
  });
  await test('E06-03-provider-preview-edit-discard', async () => {
    const { wiki, raw } = await fixture(); const a = await audit(wiki), before = await wikiHashes(), rawBefore = await rawHashes();
    const d = await propose(a);
    const sent = harness.requests.at(-1).input.messages.map(m => m.content).join('\n'); assert.ok(sent.includes(rawBody) && (sent.includes(wiki.body) || sent.includes(wiki.body.replaceAll('\n', '\\n'))) && sent.includes(a.comment), 'Provider did not receive all required inputs');
    const edited = await expect(service, `/api/audit-drafts/${d.id}`, 'PATCH', { baseRevision: d.revision, replacement: '人工编辑建议：' + corrected });
    const saved = edited.draft ?? edited; await restart(); assert.equal((await getDraft(d.id)).replacement, saved.replacement);
    assert.deepEqual(await wikiHashes(), before); assert.deepEqual(await rawHashes(), rawBefore);
    await expect(service, `/api/audit-drafts/${d.id}`, 'DELETE');
    assert.deepEqual(await wikiHashes(), before); assert.equal((await getAudit(a.id)).status, 'open');
    return { draftId: d.id, rawId: raw.id, providerInputAllThree: true, savedAcrossRestart: true, discardedWithoutWikiWrite: true };
  });
  await test('E06-02b-repeat-context-and-deleted-page', async () => {
    const { wiki } = await fixture('左段前文\n' + original + '\n左段后文\n右段前文\n' + original + '\n右段后文');
    const a = await audit(wiki, 'paragraph', 'error', { before: '右段前文\n', text: original, after: '\n右段后文' });
    const d = await propose(a); await resolve(a, payload(a, d));
    const updated = await getWiki(wiki.id); assert.equal(updated.body, '左段前文\n' + original + '\n左段后文\n右段前文\n' + corrected + '\n右段后文');
    const b = await audit(updated, 'page');
    await expect(service, `/api/wiki/${wiki.id}`, 'DELETE', { baseRevision: updated.revision });
    const before = await allKnowledge(); const missing = await request(service, `/api/audits/${b.id}/propose`, 'POST', {}); assert.ok([404,409].includes(missing.status), missing.text); assert.deepEqual(await allKnowledge(), before);
    return { duplicateTextContextSelectsRightOccurrence: true, deletedWikiBlocksProposal: true };
  });
  await test('E06-04-four-decisions-and-precise-write', async () => {
    const { wiki } = await fixture(); const rawBefore = await rawHashes();
    let a = await audit(wiki), d = await propose(a); const result = await resolve(a, payload(a, d));
    let updated = await getWiki(wiki.id); assert.equal(updated.body, prefix + corrected + suffix); assert.equal(updated.revision, 2); assert.equal(result.audit.status, 'resolved');
    for (const field of ['title', 'sources', 'aliases', 'tags', 'created']) assert.deepEqual(updated[field], wiki[field]);
    a = await audit(updated, 'paragraph', 'suggestion', { before: prefix, text: corrected, after: suffix }); d = await propose(a);
    const partialText = '人工部分采纳：销售门店口径，周期待确认。';
    await resolve(a, payload(a, d, 'partial', { replacement: partialText, reason: '只采纳口径，周期保留待确认' }));
    updated = await getWiki(wiki.id); assert.equal(updated.body, prefix + partialText + suffix); assert.equal(updated.revision, 3);
    const before = await wikiHashes();
    const rejected = await audit(updated, 'page', 'warning'); await resolve(rejected, { decision: 'rejected', baseAuditRevision: rejected.revision, reason: '人工核验原口径正确，保留反馈历史' });
    const deferred = await audit(updated, 'page', 'supplement'); await resolve(deferred, { decision: 'deferred', baseAuditRevision: deferred.revision, reason: '待业务负责人确认' });
    assert.deepEqual(await wikiHashes(), before); await restart();
    assert.equal((await getAudit(rejected.id)).status, 'resolved'); const def = await getAudit(deferred.id); assert.equal(def.status, 'open'); assert.ok(JSON.stringify(def).includes('待业务负责人确认'));
    assert.equal((await expect(service, '/api/stats', 'GET')).openAuditCount, 1); assert.deepEqual(await rawHashes(), rawBefore);
    return { accepted: result, partialBody: updated.body, rejectedId: rejected.id, deferredId: deferred.id, rawUnchanged: true };
  });
  await test('E06-05-versions-confirm-and-idempotence', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a);
    const before = await wikiHashes(); assert.ok((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, d, 'accepted', { confirm: false }))).status >= 400); assert.deepEqual(await wikiHashes(), before);
    const changed = await expect(service, `/api/audit-drafts/${d.id}`, 'PATCH', { baseRevision: d.revision, replacement: corrected + '人工增补' });
    assert.equal((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, d))).status, 409);
    await editWiki(wiki, wiki.body + '\n后来人工新编辑'); const afterHuman = await wikiHashes();
    assert.equal((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, changed.draft ?? changed))).status, 409); assert.deepEqual(await wikiHashes(), afterHuman);
    const manualAudit = await audit(await getWiki(wiki.id), 'page');
    await resolve(manualAudit, { decision: 'deferred', baseAuditRevision: manualAudit.revision, reason: '第一次延期' });
    assert.equal((await request(service, `/api/audits/${manualAudit.id}/resolve`, 'POST', { decision: 'rejected', baseAuditRevision: manualAudit.revision, reason: '旧版本不同决策' })).status, 409);
    const fresh = await audit(await getWiki(wiki.id)); const fd = await propose(fresh); const accepted = payload(fresh, fd); const committed = await resolve(fresh, accepted);
    const current = await getWiki(wiki.id); await editWiki(current, current.body + '\n提交后新的人工编辑');
    const finalHashes = await allKnowledge(); const repeated = await resolve(fresh, accepted); assert.equal(repeated.operationId, committed.operationId); assert.deepEqual(await allKnowledge(), finalHashes);
    return { explicitConfirmRequired: true, staleDraftWikiAudit: true, completedRetryNoWrites: true, operationId: committed.operationId };
  });
  await test('E06-06-real-io-failure-recovery', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a), rawBefore = await rawHashes();
    const sent = payload(a, d); const faultFile = path.join(service.dir, '.b06-fault.json');
    await writeFile(faultFile, JSON.stringify({ tag: randomUUID(), method: 'rename', match: '/knowledge/wiki/index.md', action: 'throw' }));
    const failed = await request(service, `/api/audits/${a.id}/resolve`, 'POST', sent); assert.ok(failed.status >= 500, failed.text);
    assert.equal((await getAudit(a.id)).status, 'open'); assert.ok(JSON.stringify(failed.json).includes('operationId'), failed.text);
    await rm(faultFile); await restart();
    const finalAudit = await getAudit(a.id), finalWiki = await getWiki(wiki.id); assert.equal(finalAudit.status, 'resolved'); assert.equal(finalWiki.revision, 2); assert.equal(finalWiki.body, prefix + corrected + suffix);
    const retried = await resolve(a, sent); assert.ok(retried.operationId);
    const log = (await readFile(path.join(service.dir, 'knowledge/logs/wiki.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); assert.equal(log.filter(e => e.operationId === retried.operationId && e.id === wiki.id).length, 1);
    assert.deepEqual(await rawHashes(), rawBefore); return { failed: failed.json, recovered: finalAudit, stableWikiRevision: 2, logOnce: true };
  });
  await test('E06-06b-recovery-human-conflict', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a); const faultFile = path.join(service.dir, '.b06-fault.json');
    await writeFile(faultFile, JSON.stringify({ tag: randomUUID(), method: 'rename', match: '/knowledge/wiki/index.md', action: 'throw' }));
    assert.ok((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, d))).status >= 500); await rm(faultFile);
    const operationFiles = (await filesUnder(path.join(service.dir, 'state/audit-operations'))).filter(f => f.endsWith('.json'));
    assert.ok(operationFiles.length, 'failed confirmed operation must have durable evidence');
    const human = await editWiki(await getWiki(wiki.id), '中断提交后人工修订，必须保留。'); await restart();
    const final = await getWiki(wiki.id); assert.equal(final.body, human.body); assert.equal(final.revision, human.revision); assert.equal((await getAudit(a.id)).status, 'open');
    for (const file of operationFiles) { const op = JSON.parse(await readFile(file, 'utf8')); assert.equal(op.status, 'conflict', 'failed operation evidence must survive as readable conflict'); const detail = await expect(service, `/api/audits/${a.id}`, 'GET'); assert.ok(JSON.stringify(detail).includes(op.operationId), 'persisted conflict operation must be discoverable through normal Audit API'); }
    return { humanRevisionPreserved: human.revision, humanBodyPreserved: true, auditNotFalselyResolved: true, conflictEvidenceRetained: true };
  });
  await test('E06-06c-log-failure-is-not-success', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a); const faultFile = path.join(service.dir, '.b06-fault.json'); const sent = payload(a, d);
    await writeFile(faultFile, JSON.stringify({ tag: randomUUID(), method: 'appendFile', match: '/knowledge/logs/wiki.jsonl', action: 'throw' }));
    const failed = await request(service, `/api/audits/${a.id}/resolve`, 'POST', sent); assert.ok(failed.status >= 500, failed.text); assert.ok(failed.text.includes('operationId')); assert.equal((await getAudit(a.id)).status, 'open');
    await rm(faultFile); await restart(); assert.equal((await getAudit(a.id)).status, 'resolved'); assert.equal((await getWiki(wiki.id)).revision, 2);
    const repeated = await resolve(a, sent); const logs = (await readFile(path.join(service.dir, 'knowledge/logs/wiki.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(logs.filter(x => x.id === wiki.id && x.operationId === repeated.operationId).length, 1);
    return { failure: failed.json, noFalseSuccess: true, restartCompletedOnce: true };
  });
  await test('E06-06d-recovery-matches-actual-wiki-content', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a); const faultFile = path.join(service.dir, '.b06-fault.json');
    await writeFile(faultFile, JSON.stringify({ tag: randomUUID(), method: 'rename', match: '/knowledge/wiki/index.md', action: 'throw' }));
    assert.ok((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, d))).status >= 500); await rm(faultFile);
    const file = path.join(service.dir, 'knowledge/wiki', wiki.id + '.md'); const content = await readFile(file, 'utf8');
    await writeFile(file, content.replace(corrected, '外部人工在同revision改了公式，必须保留。'));
    await restart(); const current = await getWiki(wiki.id); assert.ok(current.body.includes('外部人工')); assert.equal(current.revision, 2);
    assert.equal((await getAudit(a.id)).status, 'open', 'recovery cannot mark resolved by revision alone when actual content differs');
    return { sameRevisionExternalEditPreserved: true, auditNotFalselyResolved: true };
  });
  await test('E06-06e-recovery-checks-actual-raw-snapshot', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a); const faultFile = path.join(service.dir, '.b06-fault.json');
    await writeFile(faultFile, JSON.stringify({ tag: randomUUID(), method: 'rename', match: '/knowledge/wiki/index.md', action: 'throw' }));
    assert.ok((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, d))).status >= 500); await rm(faultFile);
    const rawFile = (await filesUnder(path.join(service.dir, 'knowledge/raw'))).find(p => p.endsWith('.md')); await writeFile(rawFile, (await readFile(rawFile, 'utf8')) + '\n中断后实际来源已发生变化。');
    await restart(); assert.equal((await getAudit(a.id)).status, 'open', 'changed Raw must prevent recovery falsely completing Audit');
    return { changedActualRawBlocksRecoveryCompletion: true };
  });
  await test('E06-07-raw-integrity-and-provider-failures', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), d = await propose(a);
    const rawFile = (await filesUnder(path.join(service.dir, 'knowledge/raw'))).find(p => p.endsWith('.md'));
    const originalRawFile = await readFile(rawFile, 'utf8');
    await writeFile(rawFile, originalRawFile + '\n外部新增实际Raw正文。'); const before = await wikiHashes();
    assert.equal((await request(service, `/api/audits/${a.id}/resolve`, 'POST', payload(a, d))).status, 409); assert.deepEqual(await wikiHashes(), before);
    await writeFile(rawFile, originalRawFile);
    const cases = ['{bad json', { replacement: corrected, rationale: 'bad', evidence: [{ rawId: replyRaw.id, quote: '伪造不存在的引用' }] }, { replacement: '', rationale: 'bad', evidence: [] }];
    for (const output of cases) { harness.setReply(() => output); const failed = await request(service, `/api/audits/${a.id}/propose`, 'POST', {}); assert.equal(failed.status, 502, failed.text); assert.deepEqual(await wikiHashes(), before); }
    const dir = service.dir; await harness.stop(service); service = await harness.start(dir, false);
    assert.equal((await request(service, `/api/audits/${a.id}/propose`, 'POST', {})).status, 503);
    const latest = await getAudit(a.id); await resolve(latest, { decision: 'deferred', baseAuditRevision: latest.revision, reason: '无Provider也可人工延期' });
    return { changedActualRawRejected: true, invalidProviderRejected: true, noProvider503: true, manualDecisionStillWorks: true };
  });
  await test('E06-07b-strict-schema-and-quote-source', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki), before = await wikiHashes();
    const statuses = [];
    for (const output of [{ ...fakeReply(), extra: 'illegal' }, { ...fakeReply(), rationale: '长'.repeat(4001) }, { ...fakeReply(), replacement: '长'.repeat(200001) }, { ...fakeReply(), evidence: [{ rawId: replyRaw.id, quote: rawBody, invented: true }] }]) {
      harness.setReply(() => output); const failed = await request(service, `/api/audits/${a.id}/propose`, 'POST', {}); statuses.push({ case: statuses.length + 1, expected: 502, status: failed.status, code: failed.json?.error?.code }); assert.deepEqual(await wikiHashes(), before);
    }
    const repeatedRaw = await expect(service, '/api/raw', 'POST', rawInput('重复引文Raw', rawBody + '\n' + rawBody), 201);
    const target = await expect(service, '/api/wiki', 'POST', wikiInput('重复引文Wiki', [repeatedRaw.id], prefix + original + suffix), 201);
    const quoteAudit = await audit(target); harness.setReply(() => ({ replacement: corrected, rationale: '引文虽存在于其他Raw，却不是本页来源', evidence: [{ rawId: replyRaw.id, quote: rawBody }] }));
    const ambiguous = await request(service, `/api/audits/${quoteAudit.id}/propose`, 'POST', {}); statuses.push({ case: 'wrong-source-quote', expected: 502, status: ambiguous.status, code: ambiguous.json?.error?.code });
    assert.ok(statuses.every(s => s.status === s.expected), JSON.stringify(statuses));
    return { strictRequiredFieldsLengthsAndUnknownFields: true, wrongSourceQuoteRejected: true, statuses };
  });
  await test('E06-09-proposal-race-cannot-resurrect-resolved-audit', async () => {
    const { wiki } = await fixture(); const a = await audit(wiki); let release, entered;
    const gate = new Promise(resolve => { release = resolve; }); const seen = new Promise(resolve => { entered = resolve; });
    harness.setReply(async () => { entered(); await gate; return fakeReply(); });
    const inflight = request(service, `/api/audits/${a.id}/propose`, 'POST', {}); await seen;
    let rejected, rejectionError, stale;
    try { rejected = await Promise.race([resolve(a, { decision: 'rejected', baseAuditRevision: a.revision, reason: '人工先完成拒绝，不允许慢建议复活Audit' }), delay(8000).then(() => { throw new Error('Manual decision is blocked behind the long Provider request'); })]); }
    catch (error) { rejectionError = error; }
    finally { release(); stale = await inflight; }
    if (rejectionError) throw rejectionError;
    assert.equal(stale.status, 409, stale.text);
    const final = await getAudit(a.id); assert.equal(final.status, 'resolved'); assert.ok(JSON.stringify(final.decisionHistory).includes('人工先完成拒绝')); assert.equal(final.revision, rejected.audit.revision); assert.equal(final.pendingDraftId, undefined);
    return { concurrentProposalRejected409: true, manualDecisionAndHistoryPreserved: true };
  });
  await test('E06-08-lint-eleven-and-readonly-cli', async () => {
    const { wiki, raw } = await fixture(); await audit(wiki);
    const fixtures = {};
    const create = async (title, body = '正常人工说明') => expect(service, '/api/wiki', 'POST', wikiInput(title, [raw.id], body), 201);
    const broken = await create('坏链fixture', '引用 [[不存在的页面]]'); fixtures.broken_link = broken.id;
    const orphan = await create('孤儿fixture'); fixtures.orphan_wiki = orphan.id;
    const noFm = await create('缺元数据fixture'); fixtures.frontmatter_missing = noFm.id;
    const missingSource = await create('无效来源fixture'); fixtures.source_missing = missingSource.id;
    const status = await create('缺知识状态fixture'); fixtures.knowledge_status_missing = status.id;
    const confidence = await create('缺可信度fixture'); fixtures.confidence_missing = confidence.id;
    const level = await create('缺来源等级fixture'); fixtures.source_level_missing = level.id;
    const fact = await create('无来源事实fixture', '## 来源事实\n铺货率增长99%，无来源定位。'); fixtures.unsourced_fact = fact.id;
    const b04Fact = await create('B04有效证据fixture', `## 来源事实\n- ${rawBody}（证据 ev-b06）\n## 来源证据\n- ev-b06｜原文 [0, ${rawBody.length})：${rawBody}\n## 来源\n- 来源（Raw ${raw.id}）`);
    const longBody = rawBody.repeat(4);
    const longRaw = await expect(service, '/api/raw', 'POST', rawInput('B04长引文兼容资料', longBody), 201);
    const longFact = await expect(service, '/api/wiki', 'POST', wikiInput('B04长引文显示兼容fixture', [longRaw.id], `## 来源事实\n- 来源内容需业务确认（证据 ev-long-b06）\n## 来源证据\n- ev-long-b06｜原文 [0, ${longBody.length})：${longBody.slice(0,90)}…\n## 来源\n- 来源（Raw ${longRaw.id}）`), 201);
    const forgedLong = await create('长引文伪前缀fixture', `## 来源事实\n- 无依据增长说法（证据 ev-forged-b06）\n## 来源证据\n- ev-forged-b06｜原文 [0, ${rawBody.length})：伪造的显示前缀…\n## 来源\n- 来源（Raw ${raw.id}）`);
    const outOfBounds = await create('长引文越界fixture', `## 来源事实\n- 无依据增长说法（证据 ev-bounds-b06）\n## 来源证据\n- ev-bounds-b06｜原文 [0, 999999)：${rawBody.slice(0,20)}…\n## 来源\n- 来源（Raw ${raw.id}）`);
    const directFact = await create('显式有效证据fixture', `## 来源事实\n- ${rawBody} [[raw:${raw.id}]] “${rawBody}”`);
    const sourcePage = await expect(service, '/api/wiki', 'POST', wikiInput('Source不算孤儿fixture', [raw.id], rawBody, { type: 'source' }), 201);
    const dup = await create('Ｂ０６重复标题'); await create('B06重复标题'); fixtures.duplicate_title = dup.id;
    const dir = path.join(service.dir, 'knowledge/wiki');
    await writeFile(path.join(dir, noFm.id + '.md'), '# 无YAML的真实页\n真实正文仍须报告。');
    for (const [id, field] of [[status.id, 'knowledge_status'], [confidence.id, 'confidence'], [level.id, 'source_level']]) {
      const file = path.join(dir, id + '.md'); await writeFile(file, (await readFile(file, 'utf8')).replace(new RegExp('^' + field + ':.*\\r?\\n', 'm'), ''));
    }
    const file = path.join(dir, missingSource.id + '.md'); await writeFile(file, (await readFile(file, 'utf8')).replace(raw.id, randomUUID()));
    await rm(path.join(dir, 'index.md')); const before = await fileSnapshot(service.dir);
    const lint = await expect(service, '/api/wiki-lint', 'GET'); assert.ok(Array.isArray(lint.findings));
    // The code vocabulary is frozen by the construction handoff; assert the eleven required kinds below.
    const codes = [...new Set(lint.findings.map(f => f.code))];
    const codeMap = { broken_link: 'BROKEN_WIKI_LINK', orphan_wiki: 'ORPHAN_WIKI', index_missing: 'INDEX_MISSING', frontmatter_missing: 'FRONTMATTER_MISSING', source_missing: 'SOURCE_MISSING', knowledge_status_missing: 'KNOWLEDGE_STATUS_MISSING', confidence_missing: 'CONFIDENCE_MISSING', source_level_missing: 'SOURCE_LEVEL_MISSING', unsourced_fact: 'UNSOURCED_FACT', open_audit: 'OPEN_AUDIT', duplicate_title: 'DUPLICATE_TITLE' };
    for (const code of Object.values(codeMap)) assert.ok(codes.includes(code), `Missing Lint kind ${code}; got ${codes}`);
    for (const [code, id] of Object.entries(fixtures)) assert.ok(lint.findings.some(f => f.code === codeMap[code] && (f.objectId === id || String(f.file).includes(id))), `${code} failed to locate fixture ${id}`);
    for (const id of [b04Fact.id, longFact.id, directFact.id]) assert.ok(!lint.findings.some(f => f.code === 'UNSOURCED_FACT' && f.objectId === id), `valid fact evidence falsely flagged: ${id}`);
    for (const id of [forgedLong.id, outOfBounds.id]) assert.ok(lint.findings.some(f => f.code === 'UNSOURCED_FACT' && f.objectId === id), 'invalid truncated evidence escaped validation');
    assert.ok(!lint.findings.some(f => f.code === 'BROKEN_WIKI_LINK' && f.objectId === directFact.id), 'Raw provenance marker is not a missing Wiki');
    assert.ok(!lint.findings.some(f => f.code === 'ORPHAN_WIKI' && f.objectId === sourcePage.id), 'Source incorrectly counted as orphan');
    const brokenText = await readFile(path.join(dir, broken.id + '.md'), 'utf8'); const trueLine = brokenText.slice(0, brokenText.indexOf('[[不存在的页面]]')).split('\n').length;
    assert.equal(lint.findings.find(f => f.code === 'BROKEN_WIKI_LINK' && f.objectId === broken.id).location.line, trueLine, 'Lint line must refer to physical Markdown including frontmatter');
    assert.deepEqual(await fileSnapshot(service.dir), before);
    const cli = async name => { const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${name}.ts`, service.dir], { windowsHide: true, env: { ...process.env, FMCG_DATA_DIR: service.dir }, stdio: ['ignore','pipe','pipe'] }); let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c); const code = await new Promise(resolve => child.on('exit', resolve)); assert.equal(code, name === 'wiki_lint' ? 1 : 0, output); return output; };
    const lintOutput = await cli('wiki_lint'), auditOutput = await cli('audit_review'); assert.ok(lintOutput.includes(noFm.id)); assert.ok(auditOutput.includes(wiki.id)); assert.deepEqual(await fileSnapshot(service.dir), before);
    return { codes, findings: lint.findings, fixtures, cliReadOnly: true, completeDataRootUnchanged: true };
  });
} finally {
  await harness.close(); report.services = harness.services.map(s => ({ pid: s.child.pid, dir: s.dir, closed: s.child.exitCode !== null || s.child.signalCode !== null, logs: s.logs }));
  report.durationMs = Date.now() - started; report.summary = { pass: report.checks.filter(c => c.result === 'PASS').length, fail: report.checks.filter(c => c.result === 'FAIL').length };
  await writeFile('docs/reports/FULL-20261010-repair-audit-lint.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.summary)); if (report.summary.fail) process.exitCode = 1;
}
