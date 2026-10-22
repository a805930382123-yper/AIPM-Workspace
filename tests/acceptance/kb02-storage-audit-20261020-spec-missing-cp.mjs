import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storageFixture } from '../support/kb02-storage-fixture.ts';
import { atomicFault } from '../support/kb02-storage-fault.ts';
const f = await storageFixture();
const fault = atomicFault(f.root, 'failed-job');
const result = { controlled: true, realProviderCalls: 0, node: process.version };
try {
  const job = (await f.start()).job;
  await f.runner.waitForSettlement(job.id);
  fault.release();
  result.before = await f.runner.readJob(job.id);
  result.originalCheckpoint = await f.checkpoint(job.id);
  const file = path.resolve(f.root, 'state/extraction-checkpoints', job.id + '.json');
  assert.ok(file.startsWith(path.resolve(f.root) + path.sep));
  await rename(file, file + '.isolated-test-hold');
  const restarted = f.newRunner();
  const calls = f.requests.length;
  result.reconcile = await restarted.reconcile();
  result.after = await restarted.readJob(job.id);
  result.reconcileProviderDelta = f.requests.length - calls;
  const next = await restarted.start(f.raw.id, { newJobId: randomUUID(), now: new Date().toISOString() });
  await restarted.waitForSettlement(next.job.id);
  result.nextJob = await restarted.readJob(next.job.id);
  result.afterOrdinaryStartProviderDelta = f.requests.length - calls;
  result.originalJobId = job.id;
  result.freshJobIdWithoutRestart = next.job.id !== job.id;
} finally {
  fault.restore();
  await writeFile('docs/reports/KB02-STORAGE-AUDIT-20261020-spec-missing-cp.json', JSON.stringify(result, null, 2) + '\n');
  await f.clean();
}
console.log(JSON.stringify({ reconciledStatus: result.after?.job?.status, freshJobIdWithoutRestart: result.freshJobIdWithoutRestart, reconcileProviderDelta: result.reconcileProviderDelta, afterOrdinaryStartProviderDelta: result.afterOrdinaryStartProviderDelta }));
