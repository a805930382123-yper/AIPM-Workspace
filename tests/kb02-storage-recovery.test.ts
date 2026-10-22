import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { EXTRACTION_RECOVERY_CAPACITY } from '../services/llm/jobs.ts';
import { storageFailure } from '../services/llm/storage-recovery.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { atomicFault, type FaultMode } from './support/kb02-storage-fault.ts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const mode of ['failed-job', 'done-checkpoint', 'coverage-checkpoint'] as FaultMode[]) {
  for (const persistent of [false, true]) test(`SR01 real atomic ${mode} ${persistent ? 'persistent explicit recovery' : 'transient retry'}`, async t => {
    const f = await storageFixture();
    let fault: ReturnType<typeof atomicFault> | undefined;
    try {
      if (mode === 'done-checkpoint') f.succeed();
      const errno = mode === 'failed-job' ? 'EPERM' : mode === 'done-checkpoint' ? 'EACCES' : 'EBUSY';
      fault = atomicFault(f.root, mode, persistent ? Infinity : 2, errno);
      const job = (await f.start()).job;
      const view = await f.runner.waitForSettlement(job.id);
      assert.equal(view.execution, 'settled'); assert.deepEqual(view.job, await f.jobs.get(job.id));
      if (!persistent) {
        assert.equal(fault.events.length, 2); assert.equal(view.recovery, undefined);
        t.diagnostic(JSON.stringify({ controlled: true, mode, errno, transientRefusals: 2, status: view.job?.status, providerCalls: f.requests.length }));
        assert.equal(view.job?.status, mode === 'done-checkpoint' ? 'completed' : 'failed'); return;
      }
      assert.equal(view.recovery?.code, 'STORAGE_WRITE_FAILED'); assert.equal(view.recovery?.phase, mode);
      assert.equal(view.recovery?.persisted, false); assert.equal(JSON.stringify(view.recovery).includes(f.root), false);
      assert.equal(fault.events.length, 6); assert.equal(hash(await readFile(fault.events[0].target)), fault.events[0].before);
      const calls = f.requests.length, cp = await f.checkpoint(job.id), draftIds = (await f.drafts.list()).map(d => d.id);
      for (const opts of [{}, { restart: true }, { planningRetry: true }, { restart: true, planningRetry: true }]) await assert.rejects(f.start(opts), { code: 'STORAGE_RECONCILE_REQUIRED' });
      await assert.rejects(f.runner.reconcileStorage(job.id), { code: 'STORAGE_WRITE_FAILED' });
      assert.equal(fault.events.length, 12); assert.equal(f.requests.length, calls);
      assert.equal((await f.runner.readJob(job.id)).recovery?.persisted, false);
      fault.release();
      const recovered = await f.runner.reconcileStorage(job.id);
      assert.equal(recovered.recovery, undefined); assert.equal(recovered.job?.status, mode === 'done-checkpoint' ? 'completed' : 'failed');
      assert.equal(f.requests.length, calls); assert.equal((await f.checkpoint(job.id))?.attempts, cp?.attempts);
      assert.deepEqual((await f.checkpoint(job.id))?.completedChunks, cp?.completedChunks);
      assert.deepEqual((await f.drafts.list()).map(d => d.id), draftIds);
      if (mode !== 'done-checkpoint') {
        assert.equal(recovered.job?.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
        assert.deepEqual((await f.checkpoint(job.id))?.lastError?.diagnostic?.facts.missing, ['fu-13-26-fact']);
      }
      const before = await f.hashes(job.id); await f.runner.reconcileStorage(job.id); assert.deepEqual(await f.hashes(job.id), before);
      assert.equal(f.requests.length, calls);
      t.diagnostic(JSON.stringify({ controlled: true, mode, errno, rejectedRenames: fault.events.length, failedTargetBefore: fault.events[0].before, failedTargetPreserved: true, execution: recovered.execution, recoveryCleared: true, providerBefore: calls, providerAfter: f.requests.length, attemptsBefore: cp?.attempts, attemptsAfter: (await f.checkpoint(job.id))?.attempts, draftIds, finalJob: recovered.job?.status, finalError: recovered.job?.error?.code, idempotentHashes: before }));
    } finally { fault?.restore(); await f.clean(); }
  });
}

test('SR01 restart reuses a verified existing draft with Provider unconfigured and skips historical jobs', async () => {
  const f = await storageFixture();
  const fault = atomicFault(f.root, 'done-checkpoint');
  try {
    f.succeed(); const job = (await f.start()).job; await f.runner.waitForSettlement(job.id); fault.release();
    const draft = (await f.drafts.list())[0]; assert.ok(draft);
    // A prior failed job for this Raw must not poison recovery of its current running job.
    await f.jobs.insert({ ...job, id: randomUUID(), status: 'failed' });
    f.setConfigured(false); const restarted = f.newRunner(), calls = f.requests.length;
    await restarted.reconcile();
    assert.equal((await restarted.readJob(job.id)).job?.status, 'completed');
    assert.equal((await f.rawStates.get(f.raw.id)).status, 'pending_confirmation');
    assert.equal((await restarted.start(f.raw.id, { newJobId: randomUUID(), now: new Date().toISOString() })).job.draftId, draft.id);
    assert.equal(f.requests.length, calls); assert.equal((await f.drafts.list()).length, 1);
  } finally { fault.restore(); await f.clean(); }
});

test('SR01 restart without saved diagnostic reports loss explicitly and never calls Provider', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'coverage-checkpoint');
  try {
    const job = (await f.start()).job; await f.runner.waitForSettlement(job.id); fault.release();
    assert.equal((await f.checkpoint(job.id))?.lastError, undefined);
    const restarted = f.newRunner(), calls = f.requests.length; await restarted.reconcile();
    const view = await restarted.readJob(job.id); assert.equal(view.job?.status, 'failed');
    assert.equal(view.job?.error?.code, 'LLM_INTERRUPTED'); assert.match(view.job!.error!.message, /未保存的诊断无法恢复/u);
    assert.equal((await f.checkpoint(job.id))?.lastError, undefined); assert.equal(f.requests.length, calls);
  } finally { fault.restore(); await f.clean(); }
});

test('SR01 changed checkpoint and corrupt restart fail closed with original bytes', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'done-checkpoint');
  try {
    f.succeed(); const job = (await f.start()).job; await f.runner.waitForSettlement(job.id); fault.release();
    const file = path.join(f.root, 'state/extraction-checkpoints', job.id + '.json');
    const cp = (await f.checkpoint(job.id))!; await new ExtractionCheckpointStore(f.root).save({ ...cp, rulesVersion: 'changed' });
    const before = await f.hashes(job.id), calls = f.requests.length;
    await assert.rejects(f.runner.reconcileStorage(job.id), { code: 'STORAGE_RECONCILE_CONFLICT' });
    assert.deepEqual(await f.hashes(job.id), before);
    await writeFile(file, '{broken'); const restarted = f.newRunner(); await restarted.reconcile();
    assert.equal((await restarted.readJob(job.id)).recovery?.persisted, false);
    await assert.rejects(restarted.reconcileStorage(job.id));
    assert.equal(await readFile(file, 'utf8'), '{broken'); assert.equal(f.requests.length, calls);
  } finally { fault.restore(); await f.clean(); }
});

test('SR01 cancel before late Provider return and failed cancelled terminal recover without a draft', async () => {
  const f = await storageFixture(); let release!: () => void, entered!: () => void;
  const seen = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  f.setHook(async () => { entered(); await gate; });
  const fault = atomicFault(f.root, 'cancelled-job');
  try {
    const job = (await f.start()).job; await seen; await f.runner.cancel(job.id); release();
    const view = await f.runner.waitForSettlement(job.id);
    assert.equal(view.execution, 'settled'); assert.equal(view.recovery?.phase, 'cancelled-job');
    assert.equal((await f.drafts.list()).length, 0); const calls = f.requests.length; fault.release();
    assert.equal((await f.runner.reconcileStorage(job.id)).job?.status, 'cancelled');
    assert.equal(f.requests.length, calls); assert.equal((await f.drafts.list()).length, 0);
  } finally { release(); fault.restore(); await f.clean(); }
});

test('SR01 cancel during terminal Raw write wins and discards a just-created draft', async () => {
  const f = await storageFixture(); f.succeed();
  const set = f.rawStates.set.bind(f.rawStates); let reached!: () => void, release!: () => void;
  const seen = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
  f.rawStates.set = async (id, value) => { if (value.status === 'pending_confirmation') { reached(); await gate; } return set(id, value); };
  try {
    const job = (await f.start()).job; await seen; const cancelled = f.runner.cancel(job.id); release(); await cancelled;
    const view = await f.runner.waitForSettlement(job.id); assert.equal(view.job?.status, 'cancelled'); assert.equal(view.recovery, undefined);
    assert.equal((await f.rawStates.get(f.raw.id)).status, 'unprocessed'); assert.ok((await f.drafts.list()).every(d => d.status === 'discarded'));
  } finally { release(); await f.clean(); }
});

test('SR01 start Raw state failure leaves observable recoverable job and zero Provider calls', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'start-state');
  try {
    let id = '';
    await assert.rejects(f.start(), (error: any) => { id = error.details?.jobId; return error.code === 'STORAGE_WRITE_FAILED' && !!id && !error.message.includes(f.root); });
    assert.equal((await f.runner.readJob(id)).execution, 'settled'); assert.equal((await f.runner.readJob(id)).recovery?.phase, 'start-state');
    assert.equal(f.requests.length, 0); fault.release(); await f.runner.reconcileStorage(id);
    assert.equal((await f.jobs.get(id))?.status, 'failed'); assert.equal((await f.rawStates.get(f.raw.id)).jobId, id);
  } finally { fault.restore(); await f.clean(); }
});

test('SR01 bounded registry refuses new tasks without evicting unresolved writes or blocking reads', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'failed-job');
  try {
    const ids: string[] = [];
    for (let i = 0; i < EXTRACTION_RECOVERY_CAPACITY; i++) {
      const raw = i === 0 ? f.raw : await f.rawStore.create({ title: '虚构容量' + i, sourceType: 'report', sourceName: '隔离', body: f.raw.body, tags: [] });
      const started = await f.runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString() }); ids.push(started.job.id); await f.runner.waitForSettlement(started.job.id);
    }
    const raw = await f.rawStore.create({ title: '容量外', sourceType: 'report', sourceName: '隔离', body: f.raw.body, tags: [] }), calls = f.requests.length;
    await assert.rejects(f.runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString() }), { code: 'STORAGE_RECOVERY_CAPACITY' });
    for (const id of ids) assert.equal((await f.runner.readJob(id)).recovery?.persisted, false);
    assert.equal(f.requests.length, calls); fault.release(); for (const id of ids) await f.runner.reconcileStorage(id);
  } finally { fault.restore(); await f.clean(); }
});

test('SR01 errno classification is bounded and never returns OS paths or text', () => {
  for (const syscall of ['mkdir', 'open', 'write', 'rename']) for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ENOSPC', 'EIO']) {
    const safe = storageFailure(Object.assign(new Error('SECRET /absolute/private'), { code, syscall, path: '/absolute/private' }));
    assert.equal(safe?.code, 'STORAGE_WRITE_FAILED'); assert.deepEqual(safe?.details, { operation: syscall, errno: code }); assert.equal(JSON.stringify(safe).includes('SECRET'), false);
  }
  assert.equal(storageFailure(new Error('arbitrary')), undefined);
});

test('SR01 restart capacity overflow remains lazily recoverable after registered issues clear', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'failed-job');
  try {
    const ids: string[] = [];
    for (let i = 0; i <= EXTRACTION_RECOVERY_CAPACITY; i++) {
      const raw = await f.rawStore.create({ title: '重启容量' + i, sourceType: 'report', sourceName: '隔离', body: f.raw.body, tags: [] });
      // Each represents a previous process, avoiding construction of an unbounded live registry.
      const runner = f.newRunner(); const j = await runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString() });
      await runner.waitForSettlement(j.job.id); ids.push(j.job.id);
    }
    const restarted = f.newRunner(); await restarted.reconcile();
    assert.equal(restarted.recoveryJobs().length, EXTRACTION_RECOVERY_CAPACITY);
    const orphan = ids.find(id => !restarted.recoveryJobs().some(x => x.jobId === id))!;
    assert.equal((await restarted.readJob(orphan)).recovery?.phase, 'restart-disk');
    const calls = f.requests.length; fault.release();
    for (const { jobId } of restarted.recoveryJobs()) await restarted.reconcileStorage(jobId);
    assert.equal((await restarted.reconcileStorage(orphan)).job?.status, 'failed'); assert.equal(f.requests.length, calls);
  } finally { fault.restore(); await f.clean(); }
});

test('SR01 incompatible persisted task identity and missing bound draft are never overwritten on restart', async () => {
  for (const change of ['rules', 'ledger', 'draft'] as const) {
    const f = await storageFixture(), fault = atomicFault(f.root, 'done-checkpoint');
    try {
      f.succeed(); const job = (await f.start()).job; await f.runner.waitForSettlement(job.id); fault.release();
      const cp = (await f.checkpoint(job.id))!, draft = (await f.drafts.list())[0];
      if (change === 'rules') await new ExtractionCheckpointStore(f.root).save({ ...cp, rulesVersion: 'other-rules' });
      if (change === 'ledger') await f.jobs.update(job.id, { callCount: cp.attempts + 1 });
      if (change === 'draft') await new ExtractionCheckpointStore(f.root).save({ ...cp, stage: 'done', draftId: randomUUID() });
      const before = await f.hashes(job.id), calls = f.requests.length, draftBytes = await readFile(path.join(f.root, 'drafts', draft.id + '.json'));
      const restarted = f.newRunner(); await restarted.reconcile();
      assert.equal((await restarted.readJob(job.id)).recovery?.persisted, false);
      await assert.rejects(restarted.reconcileStorage(job.id)); assert.deepEqual(await f.hashes(job.id), before);
      assert.deepEqual(await readFile(path.join(f.root, 'drafts', draft.id + '.json')), draftBytes); assert.equal(f.requests.length, calls);
    } finally { fault.restore(); await f.clean(); }
  }
});

test('SR01 actual atomic mkdir and temp write failures are safely classified before any Provider call', async () => {
  for (const stage of ['mkdir', 'writeFile'] as const) {
    const f = await storageFixture(), originalMkdir = fs.mkdir, originalWrite = fs.writeFile;
    try {
      const refuse = (target: unknown) => String(target).startsWith(f.root) && String(target).includes('extraction-checkpoints');
      if (stage === 'mkdir') fs.mkdir = (async (target: any, options: any) => { if (refuse(target)) throw Object.assign(new Error('private path ' + f.root), { code: 'ENOSPC', syscall: 'mkdir', path: String(target) }); return originalMkdir(target, options); }) as typeof fs.mkdir;
      else fs.writeFile = async (target, value, options) => { if (refuse(target)) throw Object.assign(new Error('private path ' + f.root), { code: 'EIO', syscall: 'write', path: String(target) }); return originalWrite(target, value, options); };
      syncBuiltinESMExports();
      await assert.rejects(f.start(), (error: any) => error.code === 'STORAGE_WRITE_FAILED' && !JSON.stringify(error).includes(f.root));
      assert.equal(f.requests.length, 0); assert.equal((await f.jobs.list()).length, 0);
      fs.mkdir = originalMkdir; fs.writeFile = originalWrite; syncBuiltinESMExports();
      await f.wait((await f.start()).job.id); assert.equal(f.requests.length, 2);
    } finally { fs.mkdir = originalMkdir; fs.writeFile = originalWrite; syncBuiltinESMExports(); await f.clean(); }
  }
});

test('SR01 new-job insert failure has no unreachable recovery id and permits a later explicit start', async () => {
  const f = await storageFixture(), fault = atomicFault(f.root, 'new-job');
  try {
    await assert.rejects(f.start(), (error: any) => error.code === 'STORAGE_WRITE_FAILED' && error.details?.jobId === undefined);
    assert.equal(fault.events.length, 6); assert.equal(f.requests.length, 0); assert.equal((await f.jobs.list()).length, 0); assert.equal(f.runner.recoveryJobs().length, 0);
    const store = new ExtractionCheckpointStore(f.root), checkpoints = await store.list(); assert.equal(checkpoints.length, 1);
    const file = path.join(f.root, 'state/extraction-checkpoints', checkpoints[0].jobId + '.json'), bytes = await readFile(file);
    fault.release(); const job = await f.wait((await f.start()).job.id); assert.equal(job.status, 'failed'); assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
    assert.equal(f.requests.length, 2); assert.deepEqual(await readFile(file), bytes);
  } finally { fault.restore(); await f.clean(); }
});
