import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { storageFixture } from '../support/kb02-storage-fixture.ts';
const f = await storageFixture(), rename = fs.rename;
const output = process.env.KB02_IO_DIAG_OUTPUT;
const report = { controlled: true, node: process.version, realProviderCalls: 0, rows: [] };
let fault = true;
const refusals = [];
fs.rename = async (from, to) => {
  if (fault && String(to).startsWith(f.root) && String(to).replaceAll('\\', '/').includes('/extraction-jobs/')) {
    const record = JSON.parse(await fs.readFile(from, 'utf8'));
    if (record.callCount === 3 && record.status === 'running') {
      refusals.push({ at: performance.now(), callCount: record.callCount });
      throw Object.assign(new Error('Isolated call-count-job injection'), { code: 'EPERM', syscall: 'rename' });
    }
  }
  return rename(from, to);
};
syncBuiltinESMExports();
try {
  const first = (await f.start()).job; await f.wait(first.id);
  assert.equal(f.requests.length, 2); assert.equal((await f.checkpoint(first.id)).attempts, 2);
  assert.ok((await f.checkpoint(first.id)).lastError.diagnostic);
  await f.start({ planningRetry: true }); const stopped = await f.runner.waitForSettlement(first.id);
  assert.equal(stopped.recovery.phase, 'call-count-job'); assert.equal(stopped.job.callCount, 2);
  const cp = await f.checkpoint(first.id); assert.equal(cp.attempts, 3); assert.equal(cp.lastError, undefined); assert.equal(f.requests.length, 2); assert.equal(refusals.length, 6);
  const before = { job: stopped.job.callCount, attempts: cp.attempts, requests: f.requests.length, completedChunks: cp.completedChunks.length, diagnostic: !!cp.lastError?.diagnostic };
  const chunksHash = createHash('sha256').update(JSON.stringify(cp.completedChunks)).digest('hex');
  fault = false;
  const recovered = await f.runner.reconcileStorage(first.id);
  assert.equal(recovered.job.status, 'failed'); assert.equal(recovered.job.callCount, 3); assert.equal(recovered.recovery, undefined);
  assert.equal((await f.checkpoint(first.id)).attempts, 3); assert.equal((await f.checkpoint(first.id)).lastError, undefined); assert.equal(f.requests.length, 2);
  assert.equal(createHash('sha256').update(JSON.stringify((await f.checkpoint(first.id)).completedChunks)).digest('hex'), chunksHash);
  const saved = await f.hashes(first.id); await f.runner.reconcileStorage(first.id); assert.deepEqual(await f.hashes(first.id), saved); assert.equal(f.requests.length, 2);
  await assert.rejects(f.start({ planningRetry: true }), { code: 'LLM_PLANNING_RETRY_UNAVAILABLE' });
  assert.equal(f.requests.length, 2); assert.deepEqual(await f.hashes(first.id), saved);
  f.succeed(); const continued = await f.start(); assert.equal(continued.job.id, first.id);
  assert.equal((await f.wait(first.id)).status, 'completed'); assert.equal((await f.checkpoint(first.id)).attempts, 4); assert.equal(f.requests.length, 3);
  report.rows.push({ status: 'PASS', before, recovery: { jobCount: recovered.job.callCount, attempts: 3, providerDelta: 0, inventedDiagnostic: false, idempotent: true }, explicitContinue: { sameJob: true, attempts: 4, actualRequests: 3, addedCalls: 1 }, injectedRefusals: refusals });
} catch (error) { report.failure = { message: error.message, code: error.code, snapshot: await f.safeSnapshot((await f.jobs.list())[0]?.id ?? randomUUID()) }; process.exitCode = 1; }
finally { fs.rename = rename; syncBuiltinESMExports(); await fs.writeFile(path.join(output, 'semantics-result.json'), JSON.stringify(report, null, 2)); await f.clean(); }
console.log(JSON.stringify(report));
