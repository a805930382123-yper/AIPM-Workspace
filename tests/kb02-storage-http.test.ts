import assert from 'node:assert/strict';
import test from 'node:test';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';
import { atomicFault } from './support/kb02-storage-fault.ts';

test('SR01 HTTP disk/runtime read and strict storage-only POST preserve requests/bytes then recover', async () => {
  const f = await storageFixture(), h = await storageHttp(f), fault = atomicFault(f.root, 'done-checkpoint');
  try {
    f.succeed(); const start = await h.request(`/api/raw/${f.raw.id}/extract`, {}); assert.equal(start.status, 202);
    const id = start.json.jobId; await f.runner.waitForSettlement(id);
    const view = await h.request(`/api/extraction-jobs/${id}`); assert.equal(view.json.status, (await f.jobs.get(id))?.status);
    assert.equal(view.json.execution, 'settled'); assert.equal(view.json.recovery.persisted, false); assert.equal(view.json.recovery.phase, 'done-checkpoint');
    assert.equal(JSON.stringify(view.json.recovery).includes(f.root), false);
    const before = await f.hashes(id), calls = f.requests.length;
    for (const body of [null, [], { restart: true }, { force: true }]) assert.equal((await h.request(`/api/extraction-jobs/${id}/reconcile-storage`, body)).status, 400);
    for (const body of [{}, { restart: true }, { planningRetry: true }]) assert.equal((await h.request(`/api/raw/${f.raw.id}/extract`, body)).json.error.code, 'STORAGE_RECONCILE_REQUIRED');
    assert.deepEqual(await f.hashes(id), before); assert.equal(f.requests.length, calls);
    assert.equal((await h.request(`/api/extraction-jobs/${id}/reconcile-storage`, {})).status, 503);
    fault.release(); const saved = await h.request(`/api/extraction-jobs/${id}/reconcile-storage`, {});
    assert.equal(saved.status, 200); assert.equal(saved.json.recovery, null); assert.equal(saved.json.status, 'completed'); assert.equal(f.requests.length, calls);
    const after = await f.hashes(id); assert.equal((await h.request(`/api/extraction-jobs/${id}/reconcile-storage`, {})).status, 200); assert.deepEqual(await f.hashes(id), after);
    assert.equal((await h.request('/api/extraction-jobs/not-a-job/reconcile-storage', {})).status, 404);
  } finally { fault.restore(); await h.close(); await f.clean(); }
});

test('SR01 HTTP start-state failure is discoverable after refresh through explicit recoveryJobId', async () => {
  const f = await storageFixture(), h = await storageHttp(f), fault = atomicFault(f.root, 'start-state');
  try {
    const started = await h.request(`/api/raw/${f.raw.id}/extract`, {}); assert.equal(started.status, 503);
    const id = started.json.error.details.jobId; assert.ok(id);
    const states = await h.request('/api/raw-processing'); const state = states.json.items.find((x: { rawId: string }) => x.rawId === f.raw.id);
    assert.equal(state.recoveryJobId, id); assert.equal(state.jobId, undefined); assert.equal(state.status, 'unprocessed');
    assert.equal((await h.request(`/api/extraction-jobs/${id}`)).json.recovery.phase, 'start-state'); fault.release();
    assert.equal((await h.request(`/api/extraction-jobs/${id}/reconcile-storage`, {})).json.status, 'failed'); assert.equal(f.requests.length, 0);
  } finally { fault.restore(); await h.close(); await f.clean(); }
});
