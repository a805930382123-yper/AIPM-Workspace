import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { homeActions } from '../services/home/actions.ts';

test('已确认且正文未改的失败重跑不进待办；旧版成果和无关页面不能消除失败', async () => {
  const f = await storageFixture();
  try {
    const wikiId = randomUUID();
    await f.rawStates.set(f.raw.id, { status: 'failed', reason: '重复整理失败', generatedWikiIds: [wikiId] });
    const sources: string[] = [];
    const deps = { root: f.root, raws: f.rawStore, runner: f.runner, wiki: { get: async () => ({ sources }) } as any };
    const count = async () => {
      const result = await homeActions(deps);
      assert.equal(result.sources['raw-task'].status, 'ok');
      return result.items.filter((item) => item.kind === 'raw-task').length;
    };
    assert.equal(await count(), 1);
    sources.push(f.raw.id);
    assert.equal(await count(), 0);
    await f.rawStore.updateBody(
      f.raw.id,
      { expectedBodyRevision: 0, expectedBodySha256: f.raw.bodySha256, body: '新版正文' },
      async () => {},
    );
    assert.equal(await count(), 1);
  } finally {
    await f.clean();
  }
});

test('孤立 Raw 不生成恢复任务，也不遮住留下的草稿', async () => {
  const f = await storageFixture();
  try {
    f.succeed();
    const { job } = await f.start();
    await f.runner.waitForSettlement(job.id);
    await f.rawStates.set(f.raw.id, { status: 'failed', reason: '历史失败', jobId: job.id });
    const result = await homeActions({
      root: f.root,
      raws: { get: async () => undefined } as any,
      runner: f.runner,
      wiki: { get: async () => undefined } as any,
    });
    assert.equal(result.sources['raw-task'].status, 'ok');
    assert.equal(
      result.items.some((item) => item.kind === 'raw-task'),
      false,
    );
    assert.ok(result.items.some((item) => item.kind === 'draft' && item.target.rawId === f.raw.id));
  } finally {
    await f.clean();
  }
});

test('四源安全扫描、真实草稿、当前恢复任务与缺失引用', async () => {
  const f = await storageFixture();
  try {
    f.succeed();
    const job = (await f.start()).job;
    await f.runner.waitForSettlement(job.id);
    const draft = (await f.drafts.list())[0];
    assert.ok(draft);
    const second = { ...draft, id: randomUUID() };
    await writeFile(path.join(f.root, 'drafts', second.id + '.json'), JSON.stringify(second));
    const auditId = randomUUID(),
      wikiId = randomUUID(),
      now = new Date().toISOString();
    await mkdir(path.join(f.root, 'knowledge', 'audit'), { recursive: true });
    await writeFile(
      path.join(f.root, 'knowledge', 'audit', auditId + '.json'),
      JSON.stringify({ id: auditId, wikiId, revision: 1, updatedAt: now, status: 'open', comment: '待核' }),
    );
    const wiki = {
      get: async (id: string) => (id === wikiId ? { id, title: '虚构Wiki', revision: 1 } : undefined),
    } as any;
    const deps = { root: f.root, raws: f.rawStore, wiki, runner: f.runner };
    let r = await homeActions(deps);
    assert.equal(r.items.filter((x) => x.kind === 'draft').length, 2);
    assert.equal(r.items.filter((x) => x.kind === 'audit').length, 1);
    assert.ok(Object.values(r.sources).every((x) => x.status === 'ok'));
    const stored = await f.jobs.get(job.id);
    await f.jobs.update(job.id, { status: 'running' });
    await f.rawStates.set(f.raw.id, { status: 'processing', reason: 'test', jobId: job.id });
    r = await homeActions(deps);
    assert.equal(r.items.filter((x) => x.kind === 'raw-task').length, 1);
    assert.equal(r.items[0].priority, 0);
    await f.jobs.update(job.id, { status: stored!.status });
    await f.rawStates.set(f.raw.id, { status: 'pending_confirmation', reason: 'test', draftId: draft.id });
    await rm(path.join(f.root, 'drafts', draft.id + '.json'));
    r = await homeActions(deps);
    assert.equal(r.sources.draft.status, 'error');
    assert.equal(r.sources.audit.status, 'ok');
    await writeFile(path.join(f.root, 'knowledge', 'audit', 'bad.json'), '{bad');
    r = await homeActions(deps);
    assert.equal(r.sources.audit.status, 'error');
    assert.equal(
      r.items.some((x) => x.kind === 'audit'),
      false,
    );
  } finally {
    await f.clean();
  }
});

test('无记录目录为空，重复只读扫描不改变文件', async () => {
  const f = await storageFixture();
  try {
    const file = path.join(f.root, 'state', 'raw-processing', f.raw.id + '.json');
    await f.rawStates.set(f.raw.id, { status: 'failed', reason: 'test' });
    const before = await readFile(file);
    const deps = { root: f.root, raws: f.rawStore, wiki: { get: async () => undefined } as any, runner: f.runner };
    const a = await homeActions(deps);
    await homeActions(deps);
    assert.deepEqual(await readFile(file), before);
    assert.equal(a.sources.audit.status, 'ok');
    assert.equal(a.items.filter((x) => x.kind === 'raw-task').length, 1);
  } finally {
    await f.clean();
  }
});

test('未落盘恢复引用和扫描预算故障', async () => {
  const f = await storageFixture();
  try {
    const job = (await f.start()).job;
    await f.runner.waitForSettlement(job.id);
    await rm(path.join(f.root, 'state', 'raw-processing', f.raw.id + '.json'));
    const runner = {
      recoveryJobs: () => [{ rawId: f.raw.id, jobId: job.id }],
      readJob: async () => ({ job: await f.jobs.get(job.id), execution: 'settled', recovery: { phase: 'start' } }),
    } as any;
    const deps = { root: f.root, raws: f.rawStore, wiki: { get: async () => undefined } as any, runner };
    let result = await homeActions(deps);
    assert.ok(result.items.some((x) => x.kind === 'raw-task' && x.id === job.id));
    await mkdir(path.join(f.root, 'knowledge'), { recursive: true });
    await rename(path.join(f.root, 'knowledge', 'audit'), path.join(f.root, 'knowledge', 'audit-hidden'));
    await writeFile(path.join(f.root, 'knowledge', 'audit'), 'x');
    result = await homeActions(deps);
    assert.equal(result.sources.audit.status, 'error');
    await writeFile(path.join(f.root, 'drafts', 'oversize.json'), ' '.repeat(2 * 1024 * 1024 + 1));
    result = await homeActions(deps);
    assert.equal(result.sources.draft.status, 'error');
  } finally {
    await f.clean();
  }
});

test('Raw 状态损坏不掩盖草稿，丢失的当前任务和内存恢复不会静默消失', async () => {
  const f = await storageFixture();
  try {
    f.succeed();
    const original = (await f.start()).job;
    await f.runner.waitForSettlement(original.id);
    const drafts = await f.drafts.list();
    assert.ok(drafts.length);
    const deps = { root: f.root, raws: f.rawStore, wiki: { get: async () => undefined } as any, runner: f.runner };
    const corrupt = path.join(f.root, 'state', 'raw-processing', 'bad.json');
    await writeFile(corrupt, '{broken');
    let result = await homeActions(deps);
    assert.equal(result.sources['raw-task'].status, 'error');
    assert.equal(result.sources.draft.status, 'ok');
    assert.ok(result.items.some((x) => x.kind === 'draft'));
    await rm(corrupt);
    const absent = randomUUID();
    await f.rawStates.set(f.raw.id, { status: 'processing', reason: 'missing', jobId: absent });
    result = await homeActions(deps);
    assert.ok(result.items.some((x) => x.kind === 'raw-task' && x.id === absent && x.target.missing));
    const runner = {
      recoveryJobs: () => [{ rawId: f.raw.id, jobId: absent }],
      readJob: async () => {
        throw Error('must not read missing job');
      },
    } as any;
    result = await homeActions({ ...deps, runner });
    assert.ok(result.items.some((x) => x.kind === 'raw-task' && x.id === absent && x.target.missing));
  } finally {
    await f.clean();
  }
});

test('Audit 状态必须是合法字符串，数组不可伪装成空来源', async () => {
  const f = await storageFixture();
  try {
    const id = randomUUID(),
      wikiId = randomUUID(),
      dir = path.join(f.root, 'knowledge', 'audit');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, id + '.json'),
      JSON.stringify({
        id,
        wikiId,
        revision: 1,
        updatedAt: new Date().toISOString(),
        status: ['open'],
        comment: '待核',
      }),
    );
    const result = await homeActions({
      root: f.root,
      raws: f.rawStore,
      wiki: { get: async () => undefined } as any,
      runner: f.runner,
    });
    assert.equal(result.sources.audit.status, 'error');
    assert.equal(
      result.items.some((x) => x.kind === 'audit'),
      false,
    );
  } finally {
    await f.clean();
  }
});
