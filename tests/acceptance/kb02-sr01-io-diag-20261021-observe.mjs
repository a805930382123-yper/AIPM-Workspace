// Explicit diagnostic preload. Originals are always called once; errno/retries unchanged.
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { ExtractionRunner, ExtractionJobStore } from '../../services/llm/jobs.ts';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';

const output = process.env.KB02_IO_DIAG_OUTPUT, tag = process.env.KB02_IO_DIAG_TAG ?? 'manual';
const original = Object.fromEntries(['readFile', 'writeFile', 'rename', 'open', 'rm', 'mkdir', 'stat'].map(key => [key, fs[key].bind(fs)]));
const events = [], roots = new Set(), pendingReads = new Map(), handles = new Map(), captures = new Set();
let sequence = 0, dropped = 0;
const canonical = value => typeof value === 'string' ? path.resolve(value).replaceAll('\\', '/').toLowerCase() : '';
const inside = value => /[\\/]kb02-budget-[^\\/]+(?:[\\/]|$)/u.test(String(value));
const rootOf = file => { const match = path.resolve(String(file)).match(/^(.*[\\/]kb02-budget-[^\\/]+)/u); if (match) roots.add(match[1]); return match?.[1]; };
const relative = file => { const root = rootOf(file); return root ? path.relative(root, String(file)).replaceAll('\\', '/') : ''; };
const emit = event => { if (events.length < 16000) events.push({ atMs: performance.now(), ...event }); else dropped++; };
const safeError = error => ({ code: error?.code, syscall: error?.syscall, errno: error?.errno });
function readers(file) {
  const target = canonical(file);
  return { reads: [...pendingReads.values()].filter(value => value.file === target).map(({ id, start }) => ({ id, start })), handles: [...handles.values()].filter(value => value.file === target).map(({ id, start, flags }) => ({ id, start, flags })) };
}
fs.readFile = async (file, ...args) => {
  if (!inside(file)) return original.readFile(file, ...args);
  const id = ++sequence, start = performance.now(), target = relative(file); pendingReads.set(id, { id, start, file: canonical(file) }); emit({ op: 'readFile:start', id, target });
  try { return await original.readFile(file, ...args); }
  finally { pendingReads.delete(id); emit({ op: 'readFile:end', id, target }); }
};
fs.open = async (file, ...args) => {
  if (!inside(file)) return original.open(file, ...args);
  const id = ++sequence, start = performance.now(), target = relative(file);
  const handle = await original.open(file, ...args); handles.set(id, { id, start, flags: args[0], file: canonical(file) }); emit({ op: 'open', id, target, flags: args[0] });
  const close = handle.close.bind(handle);
  handle.close = async (...closeArgs) => { try { const value = await close(...closeArgs); handles.delete(id); emit({ op: 'close', id, target }); return value; } catch (error) { emit({ op: 'close:error', id, target, error: safeError(error) }); throw error; } };
  return handle;
};
fs.writeFile = async (file, value, ...args) => {
  if (!inside(file)) return original.writeFile(file, value, ...args);
  const id = ++sequence, target = relative(file); emit({ op: 'writeFile:start', id, target });
  try { const result = await original.writeFile(file, value, ...args); emit({ op: 'writeFile:end', id, target }); return result; }
  catch (error) { emit({ op: 'writeFile:error', id, target, error: safeError(error) }); throw error; }
};
fs.rename = async (from, to) => {
  if (!inside(to)) return original.rename(from, to);
  const id = ++sequence, target = relative(to), source = relative(from), entryReaders = readers(to); emit({ op: 'rename:start', id, target, source, readers: entryReaders });
  try { const result = await original.rename(from, to); emit({ op: 'rename:end', id, target }); return result; }
  catch (error) {
    let attempted;
    try { const value = JSON.parse(await original.readFile(from, 'utf8')); attempted = { status: value.status, stage: value.stage, callCount: value.callCount, attempts: value.attempts }; } catch { /* Only diagnostic summary is optional. */ }
    emit({ op: 'rename:error', id, target, source, entryReaders, exitReaders: readers(to), error: safeError(error), attempted });
    throw error;
  }
};
syncBuiltinESMExports();

function wrap(klass, method, summary) {
  const call = klass.prototype[method];
  klass.prototype[method] = async function (...args) {
    const root = this.root ?? this.deps?.root;
    if (!root || !inside(root)) return call.apply(this, args);
    roots.add(root); const id = ++sequence;
    emit({ op: klass.name + '.' + method + ':start', id, jobId: typeof args[0] === 'string' ? args[0] : args[0]?.jobId });
    try { const value = await call.apply(this, args); emit({ op: klass.name + '.' + method + ':end', id, value: summary(value) }); return value; }
    catch (error) { emit({ op: klass.name + '.' + method + ':error', id, error: safeError(error) }); throw error; }
  };
}
const jobInfo = job => job && ({ id: job.id, status: job.status, stage: job.stage, callCount: job.callCount, errorCode: job.error?.code });
wrap(ExtractionJobStore, 'update', jobInfo);
wrap(ExtractionCheckpointStore, 'save', cp => ({ jobId: cp.jobId, attempts: cp.attempts, stage: cp.stage, chunks: cp.completedChunks.length, errorCode: cp.lastError?.code, diagnostic: !!cp.lastError?.diagnostic }));

const readJob = ExtractionRunner.prototype.readJob;
ExtractionRunner.prototype.readJob = async function (id) {
  const result = await readJob.call(this, id), root = this.deps.root;
  if (output && inside(root) && result.recovery && result.execution === 'settled' && !captures.has(id)) {
    captures.add(id);
    const directory = path.join(output, `${tag}-${process.pid}-${id}`); await original.mkdir(directory, { recursive: true });
    const files = [['job.json', `state/extraction-jobs/${id}.json`], ['checkpoint.json', `state/extraction-checkpoints/${id}.json`], ['raw-state.json', `state/raw-processing/${result.job.rawId}.json`], ['raw.md', `knowledge/raw/reports/${result.job.rawId}.md`]];
    const saved = [];
    for (const [name, relativeFile] of files) {
      const file = path.join(root, relativeFile);
      try { const stat = await original.stat(file); if (stat.size > 1024 * 1024) { saved.push({ name, skipped: 'size' }); continue; } const bytes = await original.readFile(file); await original.writeFile(path.join(directory, name), bytes); saved.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
      catch (error) { saved.push({ name, error: safeError(error) }); }
    }
    const snapshot = { at: new Date().toISOString(), controlled: true, root, job: jobInfo(result.job), execution: result.execution, recovery: result.recovery, files: saved };
    await original.writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
    emit({ op: 'retained-failure', jobId: id, phase: result.recovery.phase, directory });
  }
  return result;
};
process.on('exit', () => {
  if (output && (events.length || roots.size)) syncFs.writeFileSync(path.join(output, `${tag}-${process.pid}.json`), JSON.stringify({ controlled: true, node: process.version, pid: process.pid, roots: [...roots], dropped, captures: [...captures], activeReads: [...pendingReads.values()], activeHandles: [...handles.values()], events }, null, 2));
});
