import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { registerHomeRoutes } from '../../server/home-api.ts';
import { registerB04Routes } from '../../server/llm-api.ts';
import type { HomeAction } from '../../services/home/actions.ts';
import { LLMService } from '../../services/llm/service.ts';
import { lwFixture } from '../lw01-fixture.ts';
import { lw03Fixture } from '../lw03-fixture.ts';

async function isolatedHttp(existing?: Awaited<ReturnType<typeof lwFixture>>) {
  const f = existing ?? await lwFixture();
  const app = express();
  app.use(express.json());
  registerB04Routes(app, {
    root: f.root, rulesDir: 'rules', provider: () => f.provider, llm: new LLMService('rules'),
    runner: f.runner, jobs: f.jobs, drafts: f.drafts, commits: f.commits,
    rawStates: f.rawStates, rawStore: f.rawStore, wikiStore: f.wiki,
  });
  registerHomeRoutes(app, { root: f.root, raws: f.rawStore, wiki: f.wiki, runner: f.runner });
  app.use(((error, _req, res, _next) => {
    res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message } });
  }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (url: string, body?: unknown) => {
    const result = await fetch(base + url, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: result.status, json: await result.json() };
  };
  const actionList = async (): Promise<HomeAction[]> => (await request('/api/home/actions')).json.items;
  const currentActions = async (rawId: string) => (await actionList()).filter(item => item.target.rawId === rawId);
  const createRaw = (title: string) => f.rawStore.create({
    title, sourceType: 'report', sourceName: 'AUTO02 隔离独验', tags: [],
    body: '渠道覆盖10家。\n\n回访周期7天。',
  });
  return {
    ...f, request, currentActions, createRaw,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const detail = (item: HomeAction) =>
  `/api/home/actions/${item.kind}/${item.id}?versionToken=${item.versionToken}`;

for (const writeStage of ['raw-state', 'job'] as const) test(`AUTO02 独验：${writeStage} 落盘失败时，运行、恢复和审核各只有一张任务卡`, async () => {
  const f = await isolatedHttp();
  const raw = await f.createRaw('首页整理与状态恢复');
  const complete = f.provider.complete.bind(f.provider);
  const updateJob = f.jobs.update.bind(f.jobs);
  const setRawState = f.rawStates.set.bind(f.rawStates);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let jobId: string | undefined;
  try {
    f.provider.complete = async input => { await waiting; return complete(input); };
    f.jobs.update = async (id, input) => {
      if (writeStage === 'job' && input.status === 'completed') throw Object.assign(Error('isolated job settlement failure'), { code: 'EIO' });
      return updateJob(id, input);
    };
    f.rawStates.set = async (id, input) => {
      if (writeStage === 'raw-state' && input.status === 'pending_confirmation') throw Object.assign(Error('isolated raw state settlement failure'), { code: 'EIO' });
      return setRawState(id, input);
    };
    const start = await f.request(`/api/raw/${raw.id}/extract`, { mode: 'standard' });
    assert.equal(start.status, 202, JSON.stringify(start));
    jobId = start.json.jobId;
    assert(jobId);
    const running = await f.currentActions(raw.id);
    assert.equal(running.length, 1, JSON.stringify(running));
    assert.equal(running[0].target.jobId, jobId);
    assert.equal((await f.request(detail(running[0]))).status, 200);
    release();
    const failedSettlement = await f.runner.waitForSettlement(jobId);
    assert(failedSettlement.recovery);
    const boundDraft = (await f.drafts.list()).find(draft => draft.jobId === jobId)?.id;
    assert(boundDraft);
    const recovery = await f.currentActions(raw.id);
    assert.equal(recovery.length, 1, JSON.stringify(recovery));
    assert.equal(recovery[0].target.jobId, jobId);
    assert.match(recovery[0].problem, /恢复|保存/);
    assert.equal((await f.request(detail(running[0]))).status, 409);
    f.jobs.update = updateJob;
    f.rawStates.set = setRawState;
    const calls = f.requests.length;
    const reconciled = await f.request(`/api/extraction-jobs/${jobId}/reconcile-storage`, {});
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled));
    assert.equal(reconciled.json.draftId, boundDraft);
    const pending = await f.currentActions(raw.id);
    assert.equal(pending.length, 1, JSON.stringify(pending));
    assert.equal(pending[0].target.draftId, boundDraft);
    assert.equal((await f.request(detail(pending[0]))).status, 200);
    assert.equal(f.requests.length, calls);

    const draft = (await f.drafts.get(boundDraft))!;
    const older = { ...draft, id: randomUUID(), jobId: randomUUID() };
    delete older.maintenance;
    await writeFile(path.join(f.root, 'drafts', `${older.id}.json`), JSON.stringify(older));
    assert.deepEqual(new Set((await f.currentActions(raw.id)).map(item => item.target.draftId)), new Set([boundDraft, older.id]));
  } finally {
    release();
    f.jobs.update = updateJob;
    f.rawStates.set = setRawState;
    if (jobId) await f.runner.waitForSettlement(jobId);
    await f.close();
  }
});

test('AUTO02 独验：部分入库后暂缓、显式继续、剩余确认保留原事务与正文', async () => {
  const f = await isolatedHttp();
  try {
    f.setTopics(['渠道覆盖', '回访周期']);
    const raw = await f.createRaw('部分写入后稍后处理');
    const draft = await f.generate(raw.id);
    const url = `/api/drafts/${draft.id}`;
    const change = draft.maintenance!.changes[1];
    const edited = await f.drafts.reviewChange(draft.id, {
      baseRevision: draft.revision, changeId: change.changeId,
      body: change.candidate.body + '\n\n人工保存的说明。',
    });
    const ids = edited.maintenance!.changes.map(item => edited.pages[item.pageIndex].pageId);
    assert.equal(ids.length, 2);
    const view = async () => (await f.request(url)).json;
    const confirm = (record: { revision: number; outcomeDigest: string }, pageId: string) => ({
      baseRevision: record.revision, outcomeDigest: record.outcomeDigest, selectedPageIds: [pageId], idempotencyKey: randomUUID(),
    });
    const firstRequest = confirm(await view(), ids[0]);
    const first = await f.request(url + '/confirm', firstRequest);
    assert.equal(first.status, 201, JSON.stringify(first));
    const firstWiki = await f.wiki.get(first.json.wikiIds[0]);
    const wikiBefore = await f.wiki.allRecords();
    const callsBefore = f.requests.length;
    const jobFilesBefore = await readFile(path.join(f.root, 'state', 'extraction-jobs', `${draft.jobId}.json`));
    const draftBefore = (await f.drafts.get(draft.id))!;
    const [partial] = await f.currentActions(raw.id);
    assert.equal(partial.target.draftId, draft.id);
    const bad = await f.request(url + '/defer', { baseRevision: draftBefore.revision, deferred: 'true' });
    assert.equal(bad.status, 400, JSON.stringify(bad));
    const deferred = await f.request(url + '/defer', { baseRevision: draftBefore.revision, deferred: true });
    assert.equal(deferred.status, 200, JSON.stringify(deferred));
    const onDisk = await f.drafts.get(draft.id);
    assert(onDisk);
    const { deferredAt, revision, updatedAt, ...saved } = onDisk as typeof onDisk & { deferredAt: string };
    const { revision: _oldRevision, updatedAt: _oldTimestamp, ...prior } = draftBefore;
    assert(Number.isFinite(Date.parse(deferredAt)));
    assert.equal(deferred.json.deferredAt, deferredAt);
    assert.equal(revision, draftBefore.revision + 1);
    assert.deepEqual(saved, prior);
    assert(Number.isFinite(Date.parse(updatedAt)));
    assert.equal((await view()).deferredAt, deferredAt);
    const [snoozed] = await f.currentActions(raw.id);
    assert.equal(snoozed.target.draftId, draft.id);
    assert.equal((await f.request(detail(partial))).status, 409);
    assert.equal((await f.request(detail(snoozed))).status, 200);
    assert.equal((await f.request(url + '/defer', { baseRevision: draftBefore.revision, deferred: false })).status, 409);
    assert.equal((await f.request(url + '/defer', { baseRevision: revision, deferred: true })).json.revision, revision);
    assert.equal((await f.request(url + '/confirm', confirm(await view(), ids[1]))).status, 409);
    const replay = await f.request(url + '/confirm', firstRequest);
    assert.equal(replay.status, 201, JSON.stringify(replay));
    assert.equal(replay.json.operationId, first.json.operationId);
    assert.deepEqual(await f.wiki.allRecords(), wikiBefore);
    const resumed = await f.request(url + '/defer', { baseRevision: revision, deferred: false });
    assert.equal(resumed.status, 200, JSON.stringify(resumed));
    assert.equal(resumed.json.id, draft.id);
    assert.equal(resumed.json.deferredAt, undefined);
    assert.equal(resumed.json.maintenance.changes[0].committedOperationId, first.json.operationId);
    assert.match(resumed.json.maintenance.changes[1].candidate.body, /人工保存的说明/);
    const second = await f.request(url + '/confirm', confirm(resumed.json, ids[1]));
    assert.equal(second.status, 201, JSON.stringify(second));
    assert.equal(second.json.sourceId, first.json.sourceId);
    assert.notEqual(second.json.operationId, first.json.operationId);
    assert.equal((await f.currentActions(raw.id)).length, 0);
    assert.deepEqual(await f.wiki.get(first.json.wikiIds[0]), firstWiki);
    assert.match((await f.wiki.get(second.json.wikiIds[0]))!.body, /人工保存的说明/);
    assert.equal((await f.rawStore.get(raw.id))!.bodySha256, raw.bodySha256);
    assert.equal(f.requests.length, callsBefore);
    assert.deepEqual(await readFile(path.join(f.root, 'state', 'extraction-jobs', `${draft.jobId}.json`)), jobFilesBefore);
  } finally { await f.close(); }
});

test('AUTO02 独验：已冻结但未登记提交状态时，暂缓不抢占原事务', async () => {
  const f = await isolatedHttp();
  try {
    const raw = await f.createRaw('冻结清单先于草稿状态');
    const draft = await f.generate(raw.id);
    const url = `/api/drafts/${draft.id}`;
    const prepared = f.drafts.prepareReviewedCommit.bind(f.drafts);
    f.drafts.prepareReviewedCommit = async (_id, _rev, _digest, _body, _op, writeManifest) => {
      await writeManifest();
      throw Object.assign(Error('isolated draft status write failure'), { code: 'EIO' });
    };
    const initial = (await f.request(url)).json;
    const payload = {
      baseRevision: initial.revision, outcomeDigest: initial.outcomeDigest,
      selectedPageIds: [initial.pages[0].pageId], idempotencyKey: randomUUID(),
    };
    const failure = await f.request(url + '/confirm', payload);
    assert.equal(failure.status, 500, JSON.stringify(failure));
    const [manifest] = await f.commits.list();
    assert.equal(manifest.status, 'prepared');
    assert.equal((await f.drafts.get(draft.id))!.status, 'pending_confirmation');
    const recovery = await f.currentActions(raw.id);
    assert.equal(recovery.length, 1);
    assert.equal(recovery[0].status, 'commit-recovery');
    assert.equal(recovery[0].target.draftId, draft.id);
    assert.equal((await f.request(detail(recovery[0]))).status, 200);
    const freeze = await f.request(url + '/defer', { baseRevision: draft.revision, deferred: true });
    assert.equal(freeze.status, 409, JSON.stringify(freeze));
    assert.equal((await f.wiki.allRecords()).length, 0);
    assert.deepEqual(await f.drafts.get(draft.id), draft);
    f.drafts.prepareReviewedCommit = prepared;
    const repeated = await f.request(url + '/confirm', payload);
    assert.equal(repeated.status, 201, JSON.stringify(repeated));
    assert.equal(repeated.json.operationId, manifest.operationId);
    assert.equal((await f.commits.list()).length, 1);
  } finally { await f.close(); }
});

test('AUTO02 独验：结束部分选择保留未选历史，移除首页事项', async () => {
  const f = await isolatedHttp();
  try {
    f.setTopics(['渠道覆盖', '回访周期']);
    const raw = await f.createRaw('部分确认后结束选择');
    const draft = await f.generate(raw.id);
    const url = `/api/drafts/${draft.id}`;
    const initial = (await f.request(url)).json;
    const first = await f.request(url + '/confirm', {
      baseRevision: initial.revision, outcomeDigest: initial.outcomeDigest,
      selectedPageIds: [initial.pages[0].pageId], idempotencyKey: randomUUID(),
    });
    assert.equal(first.status, 201, JSON.stringify(first));
    const partial = (await f.request(url)).json;
    assert.equal(partial.deferredAt, undefined);
    const items = await f.currentActions(raw.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'partial');
    const before = await f.wiki.allRecords();
    const finished = await f.request(url + '/finish', { baseRevision: partial.revision });
    assert.equal(finished.status, 200, JSON.stringify(finished));
    assert.equal(finished.json.status, 'confirmed');
    assert(finished.json.discardedAt);
    assert.equal(finished.json.deferredAt, undefined);
    assert.deepEqual(finished.json.maintenance, partial.maintenance);
    assert.equal((await f.rawStates.get(raw.id)).draftId, draft.id);
    assert.equal((await f.currentActions(raw.id)).length, 0);
    assert.deepEqual(await f.wiki.allRecords(), before);
  } finally { await f.close(); }
});

test('AUTO02 独验：问答和检查草稿保留独立首页入口，Raw 暂缓端点拒绝', async () => {
  const evidence = await lw03Fixture();
  const f = await isolatedHttp(evidence);
  try {
    const check = await evidence.check(evidence.pages.slice(0, 2).map(page => page.id));
    const inspection = await evidence.inspections.draft(check.id, {
      baseRevision: check.revision, selectedFindingIds: [check.findings[0].id], key: 'auto02-inspection',
    });
    await evidence.seed('人工渠道知识', '有效门店统计口径需要区分签约与活跃。');
    const answer = await evidence.ask();
    const question = await evidence.answers.save(answer.id, {
      key: 'auto02-answer', resultRevision: answer.revision, preview: evidence.preview(answer),
    });
    const actions = await f.request('/api/home/actions');
    assert.equal(actions.status, 200);
    assert.equal(actions.json.sources.draft.status, 'ok');
    for (const [id, kind] of [[inspection.draftId, 'inspection'], [question.draftId, 'question_answer']]) {
      const items = (actions.json.items as HomeAction[]).filter(item => item.target.draftId === id);
      assert.equal(items.length, 1, JSON.stringify(items));
      assert.equal(items[0].kind, 'draft');
      assert.equal(items[0].target.rawId, undefined);
      assert.equal((await f.request(detail(items[0]))).status, 200);
      const view = await f.request(`/api/drafts/${id}`);
      assert.equal(view.status, 200, JSON.stringify(view));
      assert.equal(view.json.input.kind, kind);
      assert.equal((await f.request(`/api/drafts/${id}/defer`, { baseRevision: view.json.revision, deferred: true })).status, 404);
      assert.deepEqual((await f.request(`/api/drafts/${id}`)).json, view.json);
    }
    assert.equal((await f.commits.list()).length, 0);
  } finally { await f.close(); }
});
