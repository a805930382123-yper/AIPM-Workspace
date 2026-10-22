import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { storageFixture } from '../support/kb02-storage-fixture.ts';
import { atomicFault } from '../support/kb02-storage-fault.ts';

const f = await storageFixture();
let fault;
const result = { controlled: true, realProviderCalls: 0, node: process.version };
try {
  const old = (await f.start()).job;
  await f.wait(old.id);
  result.previous = await f.safeSnapshot?.(old.id) ?? { job: await f.jobs.get(old.id), raw: await f.rawStates.get(f.raw.id) };
  fault = atomicFault(f.root, 'start-state');
  let id;
  try { await f.start({ restart: true }); } catch (error) { id = error.details?.jobId; result.startError = { code: error.code, jobId: id }; }
  assert.ok(id);
  const beforeCalls = f.requests.length;
  result.before = await f.runner.readJob(id);
  result.stateBefore = await f.rawStates.get(f.raw.id);
  fault.release();
  try { result.recovered = await f.runner.reconcileStorage(id); }
  catch (error) { result.recoveryError = { code: error.code, message: error.message }; }
  result.after = await f.runner.readJob(id);
  result.providerDelta = f.requests.length - beforeCalls;
  result.stateAfter = await f.rawStates.get(f.raw.id);
  result.followupStarts = [];
  for (const options of [{}, { restart: true }, { planningRetry: true }]) {
    try { await f.start(options); result.followupStarts.push({ options, unexpectedlyStarted: true }); }
    catch (error) { result.followupStarts.push({ options, code: error.code }); }
  }
  result.refusals = fault.events.length;
  result.expected = 'After releasing the start-state fault, storage-only recovery settles the inserted job without Provider calls and permits a later start.';
  result.findingReproduced = result.recoveryError?.code === 'STORAGE_RECONCILE_CONFLICT' && result.after.recovery?.persisted === false;
  assert.equal(result.findingReproduced, true);
  assert.equal(result.after.job.status, 'running');
  assert.deepEqual(result.stateAfter, result.stateBefore);
  assert.ok(result.followupStarts.every(item => item.code === 'STORAGE_RECONCILE_REQUIRED'));
  assert.equal(f.requests.length, beforeCalls);
  const restarted = f.newRunner();
  result.restartReconcile = await restarted.reconcile();
  result.afterRestart = await restarted.readJob(id);
  try { result.afterRestartRecovery = await restarted.reconcileStorage(id); }
  catch (error) { result.afterRestartError = { code: error.code, message: error.message }; }
  assert.equal(result.afterRestartError?.code, 'STORAGE_RECONCILE_CONFLICT');
  assert.equal(f.requests.length, beforeCalls);
} finally {
  fault?.restore();
  await writeFile('docs/reports/KB02-STORAGE-AUDIT-20261020-spec-start-state.json', JSON.stringify(result, null, 2) + '\n');
  await f.clean();
}
console.log(JSON.stringify({ findingReproduced: result.findingReproduced, recoveryError: result.recoveryError, providerDelta: result.providerDelta, refusals: result.refusals }));
