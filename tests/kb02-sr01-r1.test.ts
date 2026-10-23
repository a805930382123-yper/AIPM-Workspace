import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { atomicFault } from './support/kb02-storage-fault.ts';
import { storageHttp } from './support/kb02-storage-http.ts';

const options = () => ({ newJobId: randomUUID(), now: new Date().toISOString() });
type Fixture = Awaited<ReturnType<typeof storageFixture>>;
async function interruptedRestart(f: Fixture) {
  const old = (await f.start()).job; await f.wait(old.id);
  const oldBytes = await f.hashes(old.id), calls = f.requests.length;
  const fault = atomicFault(f.root, 'start-state');
  let id = '';
  try {
    await assert.rejects(f.start({ restart: true }), (error: any) => { id = error.details?.jobId; return error.code === 'STORAGE_WRITE_FAILED' && !!id; });
    assert.equal(fault.events.length, 6); assert.deepEqual(await f.hashes(old.id), oldBytes);
    assert.equal(f.requests.length, calls); assert.equal((await f.jobs.get(id))?.callCount, 0);
    return { id, old, oldBytes, calls, fault };
  } catch (error) { fault.restore(); throw error; }
}

for (const reboot of [false, true]) test(`F-SR01-01 old-bound restart recovers storage only, reboot=${reboot}`, async () => {
  const f = await storageFixture(); let setup: Awaited<ReturnType<typeof interruptedRestart>> | undefined;
  try {
    setup = await interruptedRestart(f); const { id, old, calls, fault } = setup;
    const runner = reboot ? f.newRunner() : f.runner;
    if (reboot) {
      // An orphan cannot be bypassed even before the startup recovery scan.
      await assert.rejects(runner.start(f.raw.id, { ...options(), restart: true }), { code: 'STORAGE_RECONCILE_REQUIRED' });
      assert.equal((await runner.readJob(id)).recovery?.phase, 'restart-disk');
    }
    for (const extra of [{}, { restart: true }, { planningRetry: true }]) await assert.rejects(runner.start(f.raw.id, { ...options(), ...extra }), { code: 'STORAGE_RECONCILE_REQUIRED' });
    fault.release();
    const recovered = await runner.reconcileStorage(id);
    assert.equal(recovered.job?.status, 'failed'); assert.equal(recovered.recovery, undefined);
    assert.equal(recovered.job?.callCount, 0); assert.equal((await f.checkpoint(id))?.attempts, 0);
    assert.equal((await f.checkpoint(id))?.completedChunks.length, 0);
    assert.equal((await f.rawStates.get(f.raw.id)).jobId, id); assert.equal(f.requests.length, calls);
    assert.equal((await f.drafts.list()).length, 0);
    const saved = await f.hashes(id); await runner.reconcileStorage(id); assert.deepEqual(await f.hashes(id), saved);
    const oldHashes = await f.hashes(old.id); assert.deepEqual(oldHashes.slice(0, 2), setup.oldBytes.slice(0, 2));
    assert.equal((await f.checkpoint(old.id))?.lastError?.code, 'LLM_PLAN_COVERAGE_INVALID');
    f.succeed(); const next = await runner.start(f.raw.id, options()); assert.equal(next.job.id, id);
    assert.equal((await runner.waitForSettlement(id)).job?.status, 'completed');
    assert.equal((await f.drafts.list()).length, 1); assert.equal(f.requests.length, calls + 2);
  } finally { setup?.fault.restore(); await f.clean(); }
});

for (const change of ['binding', 'history', 'body'] as const) test(`F-SR01-01 refuses externally changed ${change} and preserves bytes`, async () => {
  const f = await storageFixture(); let setup: Awaited<ReturnType<typeof interruptedRestart>> | undefined;
  try {
    setup = await interruptedRestart(f); setup.fault.release();
    if (change === 'binding') await f.rawStates.set(f.raw.id, { status: 'failed', jobId: randomUUID(), reason: '外部转绑' });
    if (change === 'history') await f.rawStates.set(f.raw.id, { status: 'failed', jobId: setup.old.id, reason: '同绑定但外部改动' });
    const rawFile = path.join(f.root, 'knowledge/raw/reports', f.raw.id + '.md');
    if (change === 'body') {
      const body = f.raw.body + '外部改动。'; const hash = createHash('sha256').update(body).digest('hex');
      await writeFile(rawFile, (await readFile(rawFile, 'utf8')).replace(f.raw.bodySha256, hash).replace(f.raw.body, body));
    }
    const before = await f.hashes(setup.id), rawBytes = await readFile(rawFile), calls = f.requests.length;
    const restarted = f.newRunner(); await restarted.reconcile();
    assert.ok(restarted.recoveryJobs().some(item => item.jobId === setup!.id));
    for (const runner of [f.runner, restarted]) await assert.rejects(runner.reconcileStorage(setup.id), { code: 'STORAGE_RECONCILE_CONFLICT' });
    assert.deepEqual(await f.hashes(setup.id), before); assert.deepEqual(await readFile(rawFile), rawBytes);
    assert.equal(f.requests.length, calls); assert.equal((await f.drafts.list()).length, 0);
  } finally { setup?.fault.restore(); await f.clean(); }
});

test('F-SR01-02 missing checkpoint fails closed on reboot and ordinary continue; restoring original resumes same ledger', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'failed-job');
  let held: string | undefined, h: Awaited<ReturnType<typeof storageHttp>> | undefined;
  try {
    const job = (await f.start()).job; await f.runner.waitForSettlement(job.id); fault.release();
    const cp = (await f.checkpoint(job.id))!; assert.equal(cp.attempts, 2);
    const file = path.join(f.root, 'state/extraction-checkpoints', job.id + '.json');
    const before = await f.hashes(job.id), calls = f.requests.length;
    held = file; await rename(file, file + '.held');
    const restarted = f.newRunner(); await restarted.reconcile();
    assert.equal((await restarted.readJob(job.id)).job?.status, 'running');
    assert.equal((await restarted.readJob(job.id)).recovery?.persisted, false);
    await assert.rejects(restarted.reconcileStorage(job.id), { code: 'STORAGE_RECONCILE_CONFLICT' });
    await assert.rejects(restarted.start(f.raw.id, options()), { code: 'STORAGE_RECONCILE_REQUIRED' });
    h = await storageHttp(f, restarted);
    assert.equal((await h.request(`/api/extraction-jobs/${job.id}/reconcile-storage`, {})).status, 409);
    assert.equal((await h.request(`/api/raw/${f.raw.id}/extract`, {})).json.error.code, 'STORAGE_RECONCILE_REQUIRED');
    const disk = await Promise.all(['extraction-jobs', 'raw-processing'].map((dir, i) => readFile(path.join(f.root, 'state', dir, (i ? f.raw.id : job.id) + '.json'))));
    assert.equal(createHash('sha256').update(disk[0]).digest('hex'), before[1]); assert.equal(createHash('sha256').update(disk[1]).digest('hex'), before[2]);
    assert.equal((await f.jobs.list()).length, 1); assert.equal(f.requests.length, calls);
    await rename(file + '.held', file); held = undefined;
    assert.equal((await h.request(`/api/extraction-jobs/${job.id}/reconcile-storage`, {})).json.status, 'failed');
    assert.equal((await f.checkpoint(job.id))?.attempts, 2); assert.equal(f.requests.length, calls);
    f.succeed(); const resumed = await restarted.start(f.raw.id, { ...options(), planningRetry: true }); assert.equal(resumed.job.id, job.id);
    assert.equal((await restarted.waitForSettlement(job.id)).job?.status, 'completed'); assert.equal(f.requests.length, calls + 1);
    assert.equal((await f.checkpoint(job.id))?.attempts, 3);
  } finally { if (held) await rename(held + '.held', held); fault.restore(); await h?.close(); await f.clean(); }
});

test('F-SR01-02 failed modern job without checkpoint refuses ordinary start even without recovery scan', async () => {
  const f = await storageFixture(); let held: string | undefined;
  try {
    const job = (await f.start()).job; await f.wait(job.id);
    const file = path.join(f.root, 'state/extraction-checkpoints', job.id + '.json'), before = await f.hashes(job.id), calls = f.requests.length;
    held = file; await rename(file, file + '.held'); const runner = f.newRunner();
    await assert.rejects(runner.start(f.raw.id, options()), { code: 'LLM_CHECKPOINT_MISSING' });
    await assert.rejects(runner.reconcileStorage(job.id), { code: 'STORAGE_RECONCILE_CONFLICT' });
    await rename(file + '.held', file); held = undefined;
    assert.deepEqual(await f.hashes(job.id), before); assert.equal(f.requests.length, calls); assert.equal((await f.jobs.list()).length, 1);
  } finally { if (held) await rename(held + '.held', held); await f.clean(); }
});

test('F-SR01-02 legacy completed draft without pipeline/checkpoint remains readable and reusable', async () => {
  const f = await storageFixture(); let held: string | undefined;
  try {
    f.succeed(); const job = (await f.start()).job; await f.wait(job.id);
    await f.jobs.update(job.id, { pipelineVersion: undefined, startStateHash: undefined });
    const file = path.join(f.root, 'state/extraction-checkpoints', job.id + '.json'); held = file; await rename(file, file + '.held');
    const runner = f.newRunner(), before = await readFile(path.join(f.root, 'state/extraction-jobs', job.id + '.json')), calls = f.requests.length;
    await runner.reconcile(); const reused = await runner.start(f.raw.id, options()); assert.equal(reused.reused, true); assert.equal(reused.job.id, job.id);
    assert.equal((await runner.reconcileStorage(job.id)).job?.status, 'completed');
    assert.deepEqual(await readFile(path.join(f.root, 'state/extraction-jobs', job.id + '.json')), before); assert.equal(f.requests.length, calls);
  } finally { if (held) await rename(held + '.held', held); await f.clean(); }
});

test('F-SR01-01 HTTP exposes old-bound restart recovery and accepts idempotent storage-only save', async () => {
  const f = await storageFixture(); let setup: Awaited<ReturnType<typeof interruptedRestart>> | undefined;
  let h: Awaited<ReturnType<typeof storageHttp>> | undefined;
  try {
    setup = await interruptedRestart(f); setup.fault.release();
    h = await storageHttp(f);
    const state = (await h.request('/api/raw-processing')).json.items.find((item: { rawId: string }) => item.rawId === f.raw.id);
    // The disk Raw still references the old task, while refresh advertises the new recovery id.
    assert.equal(state.jobId, setup.old.id); assert.equal(state.recoveryJobId, setup.id);
    const saved = await h.request(`/api/extraction-jobs/${setup.id}/reconcile-storage`, {});
    assert.equal(saved.status, 200); assert.equal(saved.json.status, 'failed'); assert.equal(saved.json.recovery, null);
    const before = await f.hashes(setup.id); assert.equal((await h.request(`/api/extraction-jobs/${setup.id}/reconcile-storage`, {})).status, 200);
    assert.deepEqual(await f.hashes(setup.id), before); assert.equal(f.requests.length, setup.calls);
  } finally { setup?.fault.restore(); await h?.close(); await f.clean(); }
});

test('F-SR01-01 startup recovery scan includes new running job whose Raw still has the old binding', async () => {
  const f = await storageFixture(); let setup: Awaited<ReturnType<typeof interruptedRestart>> | undefined;
  try {
    setup = await interruptedRestart(f); setup.fault.release(); const runner = f.newRunner();
    const result = await runner.reconcile(); assert.ok(result.interrupted.includes(setup.id));
    assert.equal((await runner.readJob(setup.id)).job?.status, 'failed'); assert.equal((await runner.readJob(setup.id)).recovery, undefined);
    assert.equal((await f.rawStates.get(f.raw.id)).jobId, setup.id); assert.equal(f.requests.length, setup.calls);
  } finally { setup?.fault.restore(); await f.clean(); }
});
