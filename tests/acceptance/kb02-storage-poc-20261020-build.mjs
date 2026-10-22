// Builds disposable source-only copies. Never copies workspace, .env, or config.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const workspace = process.cwd();
const prefix = 'docs/reports/KB02-STORAGE-POC-20261020-';
const report = name => path.join(workspace, prefix + name);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const frozen = JSON.parse(await fs.readFile('docs/reports/KB02-R2-Q02-20261018-builder-main-frozen.json', 'utf8'));
const owned = {...frozen.product, ...frozen.tests};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all(Object.keys(owned).map(async f => [f, hash(await fs.readFile(f))])));
const before = await hashes();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb02-storage-poc-'));
const copies = {};
for (const variant of ['original', 'patched']) {
  const dest = path.join(root, variant); copies[variant] = dest;
  await fs.mkdir(dest, {recursive: true});
  for (const dir of ['services', 'rules']) await fs.cp(path.join(workspace, dir), path.join(dest, dir), {recursive: true});
  await fs.mkdir(path.join(dest, 'tests'), {recursive: true});
  await fs.copyFile('tests/kb02-planning-budget.test.ts', path.join(dest, 'tests/kb02-planning-budget.test.ts'));
  const fixtureSource = (await fs.readFile('tests/kb02-planning-budget.test.ts', 'utf8')).split("test('KB02 exhausted explicit")[0].replace('async function fixture()', 'export async function fixture()').replace('return { root, raw, jobs, requests,', 'return { root, raw, jobs, requests, runner, drafts, rawStates,');
  await fs.writeFile(path.join(dest, 'tests/poc-fixture.ts'), fixtureSource);
  await fs.copyFile('tests/acceptance/kb02-storage-poc-20261020-case.mts', path.join(dest, 'tests/storage-poc.mts'));
  await fs.copyFile('package.json', path.join(dest, 'package.json'));
  await fs.symlink(path.join(workspace, 'node_modules'), path.join(dest, 'node_modules'), 'junction');
}
function replaceExactly(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw Error('Patch anchor is not unique: ' + before.slice(0, 80));
  return source.replace(before, after);
}
let files = (await fs.readFile(path.join(copies.patched, 'services/storage/files.ts'), 'utf8')).replaceAll('\r\n', '\n');
files = replaceExactly(files, '    throw error;\n  }\n}\n\nexport async function writeJsonAtomic', `    const errno = (error as NodeJS.ErrnoException).code;
    throw new StorageError('STORAGE_WRITE_FAILED', '本机存储写入失败；旧文件已保留，请解除故障后显式对账。', 503, { operation: 'atomic-write', errno: ['EPERM', 'EACCES', 'EBUSY', 'ENOSPC', 'EIO'].includes(errno ?? '') ? errno : 'OTHER' });
  }
}

export async function writeJsonAtomic`);
await fs.writeFile(path.join(copies.patched, 'services/storage/files.ts'), files);
let jobs = (await fs.readFile(path.join(copies.patched, 'services/llm/jobs.ts'), 'utf8')).replaceAll('\r\n', '\n');
jobs = replaceExactly(jobs, '  private readonly controllers = new Map<string, AbortController>();', `  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly recovery = new Map<string, { issue: {code: string; message: string; persisted: false; phase: string; details?: unknown}; checkpoint: Omit<ExtractionCheckpoint, 'integrity'>; failure?: ExtractionJob['error'] }>();

  async readJob(id: string) {
    return { job: await this.deps.jobs.get(id), recovery: this.recovery.get(id)?.issue, settled: !this.tasks.has(id) };
  }
  async waitForSettlement(id: string) { await this.tasks.get(id); return this.readJob(id); }

  /** Explicit, storage-only recovery. The disk getter remains the source of persisted status. */
  async reconcileStorage(id: string) {
    return this.startQueue.run(async () => {
      if (this.tasks.has(id)) throw new JobError('LLM_JOB_ALREADY_RUNNING', '任务仍在收尾。', 409);
      const pending = this.recovery.get(id);
      if (!pending) return this.readJob(id);
      const job = await this.deps.jobs.get(id);
      if (!job) throw new JobError('JOB_NOT_FOUND', '没有找到任务。', 404);
      const draft = pending.checkpoint.draftId ? await this.deps.drafts.get(pending.checkpoint.draftId) : undefined;
      if (pending.checkpoint.draftId && (!draft || draft.jobId !== id || draft.rawId !== job.rawId || draft.status === 'discarded')) throw new JobError('STORAGE_RECONCILE_CONFLICT', '已有草稿不能安全对账。', 409);
      const cp = await new ExtractionCheckpointStore(this.deps.root).save(pending.checkpoint);
      const at = new Date().toISOString();
      const failure = pending.failure ?? { code: 'STORAGE_WRITE_FAILED', message: pending.issue.message, at, retryable: true };
      await this.deps.rawStates.set(job.rawId, draft
        ? { status: 'pending_confirmation', reason: '存储恢复后对账已有草稿', jobId: id, draftId: draft.id }
        : { status: 'failed', reason: '存储恢复后保留原失败', jobId: id, lastError: failure });
      await this.deps.jobs.update(id, { status: draft ? 'completed' : 'failed', stage: cp.stage, draftId: draft?.id, callCount: Math.max(job.callCount, cp.attempts), chunksDone: cp.completedChunks.length, finishedAt: at, error: draft ? undefined : failure });
      this.recovery.delete(id);
      return this.readJob(id);
    });
  }`);
jobs = replaceExactly(jobs, '    const state = await this.deps.rawStates.get(rawId);', `    const state = await this.deps.rawStates.get(rawId);
    if (state.jobId && this.recovery.has(state.jobId)) throw new JobError('STORAGE_RECONCILE_REQUIRED', '上次任务存储未完成，请显式对账后继续。', 409);
    if (this.recovery.size >= 100) throw new JobError('STORAGE_RECOVERY_CAPACITY', '待对账任务已达本进程上限，请先处理。', 503);`);
jobs = replaceExactly(jobs, '    void this.runKnowledge(job, raw, provider, checkpoint, options.planningRetry === true).catch(() => undefined);', `    const task = this.runKnowledge(job, raw, provider, checkpoint, options.planningRetry === true).finally(() => { this.tasks.delete(job.id); });
    this.tasks.set(job.id, task);
    // The explicit task is observable through waitForSettlement; no rejected task is left unhandled.
    void task.catch(error => { console.error('Extraction settlement failed', { code: error instanceof StorageError ? error.code : 'SETTLEMENT_FAILED' }); });`);
jobs = replaceExactly(jobs, '    const saveCheckpoint = async (value: Omit<ExtractionCheckpoint, \'integrity\'>) => { checkpoint = await checkpoints.save(value); return checkpoint; };', `    let checkpointIntent: Omit<ExtractionCheckpoint, 'integrity'> = initial;
    let phase = 'pipeline';
    const progressWrites: Promise<unknown>[] = [];
    const saveCheckpoint = async (value: Omit<ExtractionCheckpoint, 'integrity'>) => { checkpointIntent = value; phase = value.stage === 'done' ? 'done-checkpoint' : value.lastError?.diagnostic ? 'coverage-checkpoint' : 'checkpoint'; checkpoint = await checkpoints.save(value); return checkpoint; };
    const retain = (error: StorageError, failure?: ExtractionJob['error']) => {
      this.recovery.set(job.id, { issue: {code: error.code, message: error.message, persisted: false, phase, details: error.details}, checkpoint: checkpointIntent, failure });
    };`);
const progressStart = "        onProgress: progress => { void this.deps.jobs.update(job.id,";
jobs = replaceExactly(jobs, progressStart, "        onProgress: progress => { const progressWrite = this.deps.jobs.update(job.id,");
jobs = replaceExactly(jobs, 'reusedChunks } }).catch(() => undefined); },', 'reusedChunks } }); progressWrites.push(progressWrite); void progressWrite.catch(() => undefined); },');
jobs = replaceExactly(jobs, '      if (controller.signal.aborted) { await this.finishCancelled(job); return; }\n      assertNoKnownSecret', '      await Promise.all(progressWrites);\n      if (controller.signal.aborted) { await this.finishCancelled(job); return; }\n      assertNoKnownSecret');
jobs = replaceExactly(jobs, "      await this.deps.rawStates.set(raw.id, { status: 'pending_confirmation'", "      phase = 'completed-raw-state';\n      await this.deps.rawStates.set(raw.id, { status: 'pending_confirmation'");
jobs = replaceExactly(jobs, "      await this.deps.jobs.update(job.id, { status: 'completed'", "      phase = 'completed-job';\n      await this.deps.jobs.update(job.id, { status: 'completed'");
const catchStart = "    } catch (error) {\n      if (controller.signal.aborted) { await this.finishCancelled(job); return; }\n      const rawCode";
jobs = replaceExactly(jobs, catchStart, "    } catch (error) {\n      await Promise.allSettled(progressWrites);\n      if (error instanceof StorageError && error.code === 'STORAGE_WRITE_FAILED') { retain(error); return; }\n      if (controller.signal.aborted) { await this.finishCancelled(job); return; }\n      const rawCode");
const a = jobs.indexOf('      await saveCheckpoint({ ...checkpoint, lastError:');
const b = jobs.indexOf('    } finally { this.controllers.delete(job.id); }', a);
if (a < 0 || b < 0) throw Error('Missing catch body');
jobs = jobs.slice(0, a) + `      const retryable = !NON_RETRYABLE.has(code);
      const failure = { code, message, at: new Date().toISOString(), retryable, ...(error instanceof LlmError && error.details !== undefined ? {details: sanitizeDeep(error.details, secrets)} : {}) };
      try {
        await saveCheckpoint({ ...checkpoint, lastError: { code, message, at: failure.at, ...(code === 'LLM_PLAN_COVERAGE_INVALID' && checkpoint.lastError?.diagnostic ? { diagnostic: checkpoint.lastError.diagnostic } : {}) } });
        phase = 'failed-raw-state';
        await this.deps.rawStates.set(raw.id, { status: 'failed', reason: '提取失败：' + code, lastError: failure, jobId: job.id });
        phase = 'failed-job';
        await this.deps.jobs.update(job.id, { status: 'failed', stage: checkpoint.stage, pipelineVersion: KB02_PIPELINE_VERSION, checkpoint: { stage: checkpoint.stage, validatedChunks: checkpoint.completedChunks.length, totalChunks: checkpoint.chunks.length, resumable: true, reason: message, attempts: checkpoint.attempts, reusedChunks }, finishedAt: new Date().toISOString(), callCount: checkpoint.attempts, error: failure });
      } catch (storageError) {
        if (!(storageError instanceof StorageError)) throw storageError;
        retain(storageError, failure);
      }
` + jobs.slice(b);
// For an interrupted coverage save, retain the original already-computed business failure.
jobs = replaceExactly(jobs, "retain(error); return;", "retain(error, checkpointIntent.lastError ? { ...checkpointIntent.lastError, retryable: true, details: checkpointIntent.lastError.diagnostic } : undefined); return;");
await fs.writeFile(path.join(copies.patched, 'services/llm/jobs.ts'), jobs);
const patches = [];
for (const file of ['services/storage/files.ts', 'services/llm/jobs.ts']) {
  const original = await fs.readFile(path.join(copies.original, file));
  const patched = await fs.readFile(path.join(copies.patched, file));
  patches.push({file, originalSha256: hash(original), patchedSha256: hash(patched)});
  await fs.copyFile(path.join(copies.patched, file), report(stamp + '-' + path.basename(file) + '.txt'));
}
const metadata = {stamp, root, copies, before, patches, count: {product: Object.keys(frozen.product).length, tests: Object.keys(frozen.tests).length}, externalCalls: 0};
await fs.writeFile(report(stamp + '-build.json'), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({stamp, root, copies}));
const rows = [];
async function run(variant, mode, args) {
  const outputFile = report(stamp + '-' + variant + '-' + mode + '.json');
  const command = ['--import', 'tsx', ...args];
  const start = Date.now();
  const child = spawn(process.execPath, command, {cwd: copies[variant], windowsHide: true, env: {...process.env, KB02_POC_VARIANT: variant, KB02_POC_MODE: mode, KB02_POC_OUTPUT: outputFile}, stdio: ['ignore','pipe','pipe']});
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const result = await new Promise(resolve => { child.on('error', error => resolve({spawnError: error.message})); child.on('close', (exitCode, signal) => resolve({exitCode, signal})); });
  await fs.writeFile(report(stamp + '-' + variant + '-' + mode + '.log'), log);
  const row = {variant, mode, command: [process.execPath, ...command], ...result, durationMs: Date.now() - start}; rows.push(row); console.log(JSON.stringify(row));
}
for (const mode of ['failed-job', 'done-checkpoint', 'coverage-checkpoint']) {
  for (const variant of ['original', 'patched']) await run(variant, mode, ['tests/storage-poc.mts']);
}
await run('patched', 'normal-budget', ['--test', 'tests/kb02-planning-budget.test.ts']);
// Compile the actual modified source plus its dependencies, without needing a copied UI tree.
await run('patched', 'typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--allowImportingTsExtensions', 'services/llm/jobs.ts']);
const after = await hashes();
const sourceChanges = Object.keys(before).filter(f => before[f] !== after[f]);
await fs.writeFile(report(stamp + '-results.json'), JSON.stringify({...metadata, rows, after, sourceChanges}, null, 2));
if (rows.some(row => row.exitCode !== 0 || row.spawnError) || sourceChanges.length) process.exitCode = 1;
