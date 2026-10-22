import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
const mode = process.env.KB02_POC_MODE;
const variant = process.env.KB02_POC_VARIANT;
const output = process.env.KB02_POC_OUTPUT!;
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const originalRename = fs.rename;
let active = false;
const rejected: Array<{target: string; temp: string; before: string; at: number}> = [];
const atomicFailures: unknown[] = [];
let fixtureRoot = '';
fs.rename = async (from, to) => {
  const target = String(to).replaceAll('\\', '/');
  if (active && fixtureRoot && target.startsWith(fixtureRoot.replaceAll('\\', '/') + '/')) {
    const record = await fs.readFile(from, 'utf8').then(x => {try {return JSON.parse(x);} catch {return undefined;}}, () => undefined);
    const inject = mode === 'failed-job' && target.includes('/extraction-jobs/') && record?.status === 'failed'
      || mode === 'done-checkpoint' && target.includes('/extraction-checkpoints/') && record?.stage === 'done'
      || mode === 'coverage-checkpoint' && target.includes('/extraction-checkpoints/') && record?.lastError?.code === 'LLM_PLAN_COVERAGE_INVALID';
    if (inject) {
      rejected.push({target: String(to), temp: String(from), before: sha(await fs.readFile(to)), at: performance.now()});
      throw Object.assign(new Error('Synthetic isolated rename refusal'), {code: 'EPERM', syscall: 'rename', path: String(from), dest: String(to)});
    }
  }
  return originalRename(from, to);
};
syncBuiltinESMExports();
const {fixture} = await import('./poc-fixture.ts');
const {ExtractionJobStore, ExtractionRunner} = await import('../services/llm/jobs.ts');
const {ExtractionCheckpointStore} = await import('../services/llm/checkpoints.ts');
// Read immediately after the genuine helper exhausted retries, before the runner fallback.
for (const [klass, method, dir] of [[ExtractionJobStore, 'update', 'extraction-jobs'], [ExtractionCheckpointStore, 'save', 'extraction-checkpoints']] as const) {
  const prototype = klass.prototype as any, original = prototype[method];
  prototype[method] = async function(...args: any[]) {
    try {return await original.apply(this, args);}
    catch (error) {
      const id = method === 'update' ? args[0] : args[0].jobId;
      const target = path.join(this.root, 'state', dir, id + '.json');
      const batch = rejected.filter(x => x.target === target);
      if (batch.length) {
        const temp = batch.at(-1)!.temp, attempts = batch.filter(x => x.temp === temp);
        const after = sha(await fs.readFile(target));
        atomicFailures.push({target, attempts: attempts.length, before: attempts[0].before, after, intact: attempts.every(x => x.before === after), error: {code: (error as any).code, message: (error as any).message, details: (error as any).details}});
      }
      throw error;
    }
  };
}
// Observe actual original run completion, avoiding a timed guess about swallowed settlement.
const settlements = new Map<string, Promise<void>>();
const run = (ExtractionRunner.prototype as any).runKnowledge;
(ExtractionRunner.prototype as any).runKnowledge = function(job: any, ...args: any[]) {
  const task = run.call(this, job, ...args); settlements.set(job.id, task); return task;
};
const f = await fixture(); fixtureRoot = f.root;
const evidence: any = {runtime: process.version, variant, mode, fixtureRoot, synthetic: true, externalCalls: 0};
const snapshot = async (id: string) => ({job: await f.jobs.get(id), checkpoint: await f.checkpoint(id), rawState: await f.rawStates.get(f.raw.id), draftIds: (await f.drafts.list()).map(x => x.id), calls: f.requests.length});
try {
  let job: any;
  if (mode === 'done-checkpoint') {
    job = await f.wait((await f.start()).job.id);
    for (let call = 3; call <= 5; call++) { await f.start({planningRetry: true}); job = await f.wait(job.id); assert.equal(job.callCount, call); }
    f.succeed(); active = true;
    await f.start({planningRetry: true});
  } else {
    active = true; job = (await f.start()).job;
  }
  await settlements.get(job.id);
  evidence.beforeRecovery = await snapshot(job.id);
  evidence.atomicFailures = atomicFailures;
  assert.ok(atomicFailures.length >= 1);
  assert.ok(atomicFailures.every((x: any) => x.attempts === 6 && x.intact));
  const before = evidence.beforeRecovery;
  if (variant === 'original') {
    if (mode === 'failed-job') assert.equal(before.job.status, 'running');
    if (mode === 'done-checkpoint') {assert.equal(before.job.status, 'failed'); assert.equal(before.job.error.code, 'LLM_INTERNAL_ERROR'); assert.equal(before.calls, 6); assert.equal(before.draftIds.length, 1);}
    if (mode === 'coverage-checkpoint') {assert.equal(before.checkpoint.lastError?.diagnostic, undefined); await assert.rejects(f.start({planningRetry: true}), (e: any) => e.code === 'LLM_PLANNING_RETRY_UNAVAILABLE');}
    evidence.result = 'KNOWN_BAD_BEHAVIOR_REPRODUCED';
  } else {
    const view = await (f.runner as any).readJob(job.id);
    evidence.runtimeView = view;
    assert.equal(view.settled, true); assert.equal(view.recovery.code, 'STORAGE_WRITE_FAILED'); assert.equal(view.recovery.persisted, false);
    assert.equal(view.recovery.phase, mode);
    assert.deepEqual(view.job, before.job);
    assert.equal(JSON.stringify(view.recovery).includes(f.root), false);
    await assert.rejects(f.start(), (e: any) => e.code === 'STORAGE_RECONCILE_REQUIRED');
    // The original target still has the exact pre-refusal bytes while refusal is active.
    const blockedTarget = rejected[0]; assert.equal(sha(await fs.readFile(blockedTarget.target)), blockedTarget.before);
    const originalCalls = f.requests.length, originalAttempts = before.checkpoint.attempts;
    const attemptsBefore = rejected.length;
    await assert.rejects((f.runner as any).reconcileStorage(job.id), (e: any) => e.code === 'STORAGE_WRITE_FAILED');
    assert.ok(rejected.length >= attemptsBefore + 6);
    assert.equal((await (f.runner as any).readJob(job.id)).recovery.persisted, false);
    assert.equal(f.requests.length, originalCalls);
    active = false;
    evidence.afterRecovery = await (f.runner as any).reconcileStorage(job.id);
    const after = await snapshot(job.id); evidence.afterSnapshot = after;
    assert.equal(evidence.afterRecovery.recovery, undefined);
    assert.equal(after.job.status, mode === 'done-checkpoint' ? 'completed' : 'failed');
    assert.equal(after.calls, originalCalls); assert.equal(after.checkpoint.attempts, originalAttempts);
    assert.equal(after.job.callCount, originalCalls);
    assert.deepEqual(after.draftIds, before.draftIds);
    assert.deepEqual(after.checkpoint.completedChunks, before.checkpoint.completedChunks);
    if (mode === 'done-checkpoint') {
      assert.equal(after.calls, 6); assert.equal(after.draftIds.length, 1); assert.equal(after.checkpoint.stage, 'done'); assert.equal(after.checkpoint.draftId, after.draftIds[0]); assert.equal(after.rawState.status, 'pending_confirmation');
    } else {assert.equal(after.job.error.code, 'LLM_PLAN_COVERAGE_INVALID'); assert.deepEqual(after.checkpoint.lastError.diagnostic.facts.missing, ['f-c1-2']);}
    const hashesBefore = await Promise.all(['extraction-checkpoints', 'extraction-jobs', 'raw-processing'].map(async dir => sha(await fs.readFile(path.join(f.root, 'state', dir, (dir === 'raw-processing' ? f.raw.id : job.id) + '.json')))));
    await (f.runner as any).reconcileStorage(job.id);
    const hashesAfter = await Promise.all(['extraction-checkpoints', 'extraction-jobs', 'raw-processing'].map(async dir => sha(await fs.readFile(path.join(f.root, 'state', dir, (dir === 'raw-processing' ? f.raw.id : job.id) + '.json')))));
    assert.deepEqual(hashesAfter, hashesBefore); assert.equal(f.requests.length, originalCalls);
    evidence.result = 'PROOF_OF_FIX_CHECKS_PASSED';
  }
  evidence.rejected = rejected;
} catch (error) {evidence.result = 'FAIL'; evidence.failure = {message: (error as Error).message, stack: (error as Error).stack}; process.exitCode = 1;}
finally {active = false; fs.rename = originalRename; syncBuiltinESMExports(); await fs.writeFile(output, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({variant, mode, result: evidence.result, failure: evidence.failure, calls: f.requests.length, renameRejections: rejected.length}));}
