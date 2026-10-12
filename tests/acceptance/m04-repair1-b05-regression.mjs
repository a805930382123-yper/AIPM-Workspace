import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHarness, expect, request, extract, rawInput, wikiInput, fileSnapshot, filesUnder } from './b05-harness.mjs';
import { fakeReply, formulaA, formulaB, bodyA, bodyB } from './b05-fake-reply.mjs';
const startedAt = Date.now();
const harness = await createHarness(fakeReply);
const report = { clientDate: '2026-10-07', startedAt: new Date().toISOString(), dataRoot: harness.dataRoot, provider: 'independent HTTP fake; real AI quality BLOCKED', checks: [], services: [] };
let service, sequence = 0;
async function reset() {
  if (service) await harness.stop(service);
  harness.setReply(fakeReply);
  const dir = path.join(harness.dataRoot, String(++sequence)); await mkdir(dir);
  service = await harness.start(dir);
}
async function test(id, fn) {
  if (process.env.B05_ONLY && !process.env.B05_ONLY.split(',').includes(id)) return;
  try { await reset(); const evidence = await fn(); report.checks.push({ id, result: 'PASS', evidence }); }
  catch (error) { report.checks.push({ id, result: 'FAIL', error: error.stack }); }
  process.stdout.write(`${id}: ${report.checks.at(-1).result}\n`);
}
const raw = async (title, body, tags) => expect(service, '/api/raw', 'POST', rawInput(title, body, tags), 201);
const wiki = async (title, sources, body, extra) => expect(service, '/api/wiki', 'POST', wikiInput(title, sources, body, extra), 201);
const getWiki = id => expect(service, `/api/wiki/${id}`, 'GET');
const getWorkflow = id => expect(service, `/api/knowledge/workflows/${id}`, 'GET');
const formal = () => fileSnapshot(path.join(service.dir, 'knowledge'));
const rawHashes = () => fileSnapshot(path.join(service.dir, 'knowledge', 'raw'));
const decision = async (draft, page, value, targetWikiId) => {
  await expect(service, `/api/knowledge/drafts/${draft.id}/pages/${page.pageId}/decision`, 'PATCH', { baseRevision: draft.revision, decision: value, targetWikiId });
  return expect(service, `/api/drafts/${draft.id}`, 'GET');
};
async function updateFixture() {
  const a = await raw('来源A', bodyA), b = await raw('来源B', bodyB);
  const old = await wiki('铺货率', [a.id], `## 来源事实\n${bodyA}\n## AI推断\n旧推断\n## 待确认问题\n旧问题`, { aliases: ['Distribution Rate'], tags: ['门店覆盖'] });
  let draft = await extract(service, b.id); const page = draft.pages[0];
  const d = await decision(draft, page, 'update', old.id); draft = d.draft ?? d;
  if (!draft.id || !draft.pages) draft = await expect(service, `/api/drafts/${draft.id ?? page.draftId}`, 'GET');
  const workflow = await expect(service, '/api/knowledge/updates', 'POST', { draftId: draft.id, pageId: page.pageId, targetWikiId: old.id, baseRevision: draft.revision }, 201);
  return { a, b, old, draft, page, workflow };
}
async function confirm(workflow, key = randomUUID()) {
  const result = await request(service, `/api/knowledge/workflows/${workflow.id}/confirm`, 'POST', { baseRevision: workflow.revision, idempotencyKey: key });
  assert.ok([200, 201].includes(result.status), result.text); return result.json;
}
try {
  await test('E05-01-five-dimensions', async () => {
    const r = await raw('候选全维度', '全维度样本：中文正文相似片段门店渠道覆盖定义足够长', ['only-tag']);
    const draft = await extract(service, r.id); const page = draft.pages[0];
    const fixtures = [
      await wiki('Ｄｉｓｔｒｉｂｕｔｉｏｎ Ｒａｔｅ', [r.id], '无关正文', { category: 'other' }),
      await wiki('别名页', [r.id], '别名独立正文', { category: 'other', aliases: ['distribution rate'] }),
      await wiki('只有分类页', [r.id], 'abcdefghxyz'),
      await wiki('标签页', [r.id], '123456789xyz', { category: 'other', tags: ['only-tag'] }),
      await wiki('正文页', [r.id], r.body, { category: 'other' }),
    ];
    const result = await expect(service, `/api/knowledge/drafts/${draft.id}/pages/${page.pageId}/duplicates`, 'GET');
    const items = result.items ?? result.candidates ?? result;
    const expected = ['title', 'aliases', 'category', 'tags', 'content'];
    const evidence = fixtures.map((fixture, i) => {
      const item = items.find(x => (x.wiki?.id ?? x.wikiId ?? x.id) === fixture.id);
      assert.ok(item, `${expected[i]} fixture missing`); assert.ok(item.matches.some(x => x.dimension === expected[i]), JSON.stringify(item));
      assert.ok(item.matches.every(x => typeof x.reason === 'string' && x.reason.length)); assert.equal(typeof item.score, 'number');
      return { id: fixture.id, expected: expected[i], score: item.score, matches: item.matches };
    });
    assert.ok(evidence[2].score < evidence[0].score);
    return evidence;
  });
  await test('E05-02-explicit-create-and-defer', async () => {
    const r = await raw('三决策', bodyB), old = await wiki('铺货率', [r.id], bodyA);
    let draft = await extract(service, r.id); const page = draft.pages[0];
    const before = await formal();
    const denied = await request(service, `/api/drafts/${draft.id}/confirm`, 'POST', { baseRevision: draft.revision, selectedPageIds: [page.pageId], idempotencyKey: randomUUID() });
    assert.equal(denied.status, 409); assert.deepEqual(await formal(), before);
    const deferred = await decision(draft, page, 'defer'); draft = deferred.draft ?? deferred;
    const deferConfirm = await request(service, `/api/drafts/${draft.id}/confirm`, 'POST', { baseRevision: draft.revision, selectedPageIds: [page.pageId], idempotencyKey: randomUUID() });
    assert.ok(deferConfirm.status >= 400, deferConfirm.text); assert.deepEqual(await formal(), before);
    const chosen = await decision(draft, page, 'create'); draft = chosen.draft ?? chosen;
    const created = await request(service, `/api/drafts/${draft.id}/confirm`, 'POST', { baseRevision: draft.revision, selectedPageIds: [page.pageId], idempotencyKey: randomUUID() });
    assert.equal(created.status, 201, created.text);
    assert.ok(created.json.wikiIds.some(id => id !== old.id)); assert.equal((await getWiki(old.id)).body, old.body);
    return { denied: denied.json, deferConfirm: deferConfirm.json, created: created.json };
  });
  await test('E05-03-update-cancel-edit-confirm', async () => {
    const { old, a, b, workflow } = await updateFixture();
    const baseline = await formal(), hashes = await rawHashes();
    assert.equal(workflow.sections.existing, old.body); assert.ok(workflow.sections.newSource.includes(formulaB));
    for (const key of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions']) assert.ok(workflow.sections[key].length);
    assert.deepEqual(await formal(), baseline);
    const edited = await expect(service, `/api/knowledge/workflows/${workflow.id}`, 'PATCH', { baseRevision: workflow.revision, title: '铺货率 人工审核更名', sections: { ...workflow.sections, suggestedAdditions: [...workflow.sections.suggestedAdditions, '人工增加的说明'] } });
    const stale = await request(service, `/api/knowledge/workflows/${workflow.id}/confirm`, 'POST', { baseRevision: workflow.revision, idempotencyKey: randomUUID() });
    assert.equal(stale.status, 409); assert.deepEqual(await formal(), baseline);
    const committed = await confirm(edited), updated = await getWiki(old.id);
    for (const expected of [formulaA, formulaB, '人工旧备注', '旧推断', '旧问题', '人工增加的说明', '冲突', '待确认']) assert.ok(updated.body.includes(expected), expected);
    assert.deepEqual([...updated.sources].sort(), [a.id, b.id].sort()); assert.equal(updated.revision, old.revision + 1);
    assert.equal(updated.title, '铺货率 人工审核更名'); assert.ok(updated.aliases.includes(old.title));
    assert.deepEqual(await rawHashes(), hashes);
    const countBefore = await formal();
    const reused = await confirm(edited, randomUUID()); assert.equal(reused.operationId, committed.operationId); assert.equal(reused.wikiId, old.id); assert.deepEqual(await formal(), countBefore);
    return { workflowId: workflow.id, committed, reused, updatedRevision: updated.revision };
  });
  await test('E05-04-stale-target-and-cancel', async () => {
    const { old, workflow } = await updateFixture();
    await expect(service, `/api/wiki/${old.id}`, 'PUT', { ...wikiInput(old.title, old.sources, old.body + '\n人工新编辑'), baseRevision: old.revision });
    const before = await formal();
    const stale = await request(service, `/api/knowledge/workflows/${workflow.id}/confirm`, 'POST', { baseRevision: workflow.revision, idempotencyKey: randomUUID() });
    assert.equal(stale.status, 409); assert.deepEqual(await formal(), before);
    await expect(service, `/api/knowledge/workflows/${workflow.id}`, 'DELETE', { baseRevision: workflow.revision });
    assert.deepEqual(await formal(), before); return { stale: stale.json };
  });
  await test('E05-05-synthesis-source-resolution', async () => {
    const a = await raw('综合来源A', bodyA), b = await raw('综合来源B', bodyB);
    const sa = await wiki('Source A', [a.id], bodyA, { type: 'source' }), sb = await wiki('Source B', [b.id], bodyB, { type: 'source' });
    const baseline = await formal(), hashes = await rawHashes();
    const duplicate = await request(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id], sourceIds: [sa.id], idempotencyKey: randomUUID() });
    assert.ok(duplicate.status >= 400); assert.deepEqual(await formal(), baseline);
    const workflow = await expect(service, '/api/knowledge/syntheses', 'POST', { sourceIds: [sa.id, sb.id], idempotencyKey: randomUUID() }, 201);
    assert.equal(workflow.rawSnapshots.length, 2); assert.deepEqual(await formal(), baseline);
    const edited = await expect(service, `/api/knowledge/workflows/${workflow.id}`, 'PATCH', { baseRevision: workflow.revision, title: '人工综合标题', sections: { ...workflow.sections, openQuestions: [...workflow.sections.openQuestions, '人工追加问题'] } });
    const dir = service.dir; await harness.stop(service); service = await harness.start(dir);
    assert.deepEqual(await getWorkflow(workflow.id), edited);
    const committed = await confirm(edited), saved = await getWiki(committed.wikiId);
    assert.equal(saved.type, 'synthesis'); assert.equal(saved.title, '人工综合标题'); assert.deepEqual(saved.sources.sort(), [a.id, b.id].sort());
    for (const text of [formulaA, formulaB, '一致', '冲突', 'AI 推断', '人工追加问题', a.id, b.id]) assert.ok(saved.body.includes(text), text);
    const list = await expect(service, '/api/wiki', 'GET'); assert.equal(list.items.filter(x => x.type === 'source').length, 2);
    assert.deepEqual(await rawHashes(), hashes); return { duplicate: duplicate.json, committed, sources: saved.sources };
  });
  await test('E05-06-fault-recovery-idempotency', async () => {
    const a = await raw('故障A', bodyA), b = await raw('故障B', bodyB);
    const workflow = await expect(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id, b.id], idempotencyKey: randomUUID() }, 201);
    const hashes = await rawHashes();
    await writeFile(path.join(service.dir, '.b05-fault.json'), JSON.stringify({ tag: 'index-write', method: 'rename', match: '/knowledge/wiki/index.md', action: 'error' }));
    const failed = await request(service, `/api/knowledge/workflows/${workflow.id}/confirm`, 'POST', { baseRevision: workflow.revision, idempotencyKey: randomUUID() });
    assert.ok(failed.status >= 400, failed.text); assert.ok(failed.json.error.details?.operationId, failed.text);
    await readFile(path.join(service.dir, '.b05-fault-observed.json'));
    const operationId = failed.json.error.details.operationId;
    const before = (await expect(service, '/api/wiki', 'GET')).items.map(x => x.id).sort(); assert.ok(before.length > 0);
    const dir = service.dir; await harness.stop(service); await rm(path.join(dir, '.b05-fault.json')); service = await harness.start(dir);
    const status = await expect(service, `/api/knowledge/commits/${operationId}`, 'GET'); assert.ok(['completed', 'confirmed'].includes(status.status), JSON.stringify(status));
    assert.equal((await getWorkflow(workflow.id)).status, 'confirmed', 'recovered formal commit must finalize its persisted workflow');
    const after = (await expect(service, '/api/wiki', 'GET')).items.map(x => x.id).sort(); assert.deepEqual(after, before);
    const log = (await readFile(path.join(dir, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8')).trim().split('\n').map(x => JSON.parse(x));
    assert.equal(log.filter(x => x.operationId === operationId).length, after.length);
    assert.deepEqual(await rawHashes(), hashes); return { failed: failed.json, operationId, before, after, status };
  });
  await test('E05-08-invalid-provider-and-missing-config', async () => {
    const a = await raw('非法A', bodyA), b = await raw('非法B', bodyB); const baseline = await formal();
    harness.setReply(() => 'not JSON sk-b05-public-test-secret-is-not-real');
    const invalid = await request(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id, b.id] });
    assert.ok(invalid.status >= 400); assert.deepEqual(await formal(), baseline); assert.ok(!invalid.text.includes('sk-b05-public'));
    const dir = service.dir; await harness.stop(service); service = await harness.start(dir, false);
    const missing = await request(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id, b.id] });
    assert.ok(missing.status >= 400); assert.deepEqual(await formal(), baseline);
    return { invalid: invalid.json, missing: missing.json, realProvider: 'BLOCKED: no actual config' };
  });
  await test('E05-06b-recovery-protects-human-edit', async () => {
    const { workflow, old } = await updateFixture();
    await writeFile(path.join(service.dir, '.b05-fault.json'), JSON.stringify({ tag: 'protect-new-edit', method: 'rename', match: '/knowledge/wiki/index.md', action: 'error' }));
    const failed = await request(service, `/api/knowledge/workflows/${workflow.id}/confirm`, 'POST', { baseRevision: workflow.revision, idempotencyKey: randomUUID() });
    assert.ok(failed.status >= 400); assert.ok(failed.json.error.details?.operationId, failed.text);
    await rm(path.join(service.dir, '.b05-fault.json'));
    const partial = await getWiki(old.id);
    const manual = await expect(service, `/api/wiki/${old.id}`, 'PUT', { ...wikiInput(partial.title, partial.sources, partial.body + '\n恢复前的人工新编辑'), baseRevision: partial.revision });
    const before = await formal(); const dir = service.dir; await harness.stop(service); service = await harness.start(dir);
    const restored = await getWiki(old.id); assert.equal(restored.body, manual.body); assert.equal(restored.revision, manual.revision);
    const status = await expect(service, `/api/knowledge/commits/${failed.json.error.details.operationId}`, 'GET'); assert.equal(status.status, 'conflict');
    return { failed: failed.json, manualRevision: manual.revision, restoredRevision: restored.revision, status, before, after: await formal() };
  });
  await test('E05-09-schema-and-evidence-rejection', async () => {
    const a = await raw('schemaA', bodyA), b = await raw('schemaB', bodyB); const baseline = await formal();
    const failures = [];
    for (const mutate of [
      result => { delete result.title; return result; },
      result => ({ ...result, category: 'not-a-real-category' }),
      result => ({ ...result, suggestedAdditions: [{ text: '虚构事实', rawId: a.id, quote: '正文中没有的引用', start: 0, end: 8 }] }),
    ]) {
      harness.setReply(input => mutate(fakeReply(input)));
      const response = await request(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id, b.id] });
      assert.ok(response.status >= 400, response.text); assert.deepEqual(await formal(), baseline); failures.push({ status: response.status, body: response.json });
    }
    return failures;
  });
  await test('E05-11-completed-retry-after-human-edit', async () => {
    const a = await raw('重试A', bodyA), b = await raw('重试B', bodyB);
    const workflow = await expect(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id, b.id] }, 201);
    const original = await confirm(workflow), saved = await getWiki(original.wikiId);
    await expect(service, `/api/wiki/${saved.id}`, 'PUT', { ...wikiInput(saved.title, saved.sources, saved.body + '\n提交后的人工编辑', { type: 'synthesis' }), baseRevision: saved.revision });
    const before = await formal(); const repeated = await confirm(workflow, randomUUID());
    assert.equal(repeated.operationId, original.operationId); assert.deepEqual(await formal(), before);
    return { original, repeated };
  });
  await test('E05-12-revalidate-actual-raw-body', async () => {
    const a = await raw('原文完整性A', bodyA), b = await raw('原文完整性B', bodyB);
    const workflow = await expect(service, '/api/knowledge/syntheses', 'POST', { rawIds: [a.id, b.id] }, 201);
    const file = (await filesUnder(path.join(service.dir, 'knowledge', 'raw'))).find(file => file.endsWith(a.id + '.md'));
    await writeFile(file, (await readFile(file, 'utf8')) + '\n外部追加，元数据中的摘要未更新');
    const before = await formal();
    const result = await request(service, `/api/knowledge/workflows/${workflow.id}/confirm`, 'POST', { baseRevision: workflow.revision, idempotencyKey: randomUUID() });
    assert.equal(result.status, 409, result.text); assert.deepEqual(await formal(), before);
    return { status: result.status, body: result.json };
  });
} finally {
  await harness.close(); report.services = harness.services.map(x => ({ pid: x.child.pid, dir: x.dir, base: x.base, closed: x.child.exitCode !== null || x.child.signalCode !== null, logs: x.logs }));
  report.durationMs = Date.now() - startedAt;
  report.summary = { pass: report.checks.filter(x => x.result === 'PASS').length, fail: report.checks.filter(x => x.result === 'FAIL').length };
  await writeFile(process.env.B05_REPORT ?? 'docs/reports/M04-repair1-20261012-b05-regression.json', JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report.summary) + '\n');
}
if (report.summary.fail) process.exitCode = 1;
