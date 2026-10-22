// Bounded disposable I/O experiment; no product implementation or retry policy changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { writeJsonAtomic } from '../../services/storage/files.ts';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb02-io-probe-'));
const out = process.env.KB02_IO_DIAG_OUTPUT, tag = process.env.KB02_IO_DIAG_TAG;
const rename = fs.rename;
const report = { controlled: true, node: process.version, root, realProviderCalls: 0, cases: [] };
let activeCase, activeReads = 0;
fs.rename = async (from, to) => {
  const at = performance.now(), concurrentReads = activeReads;
  try { return await rename(from, to); }
  catch (error) { if (String(to).startsWith(root)) activeCase?.nativeErrors.push({ at, returned: performance.now(), concurrentReads, atReturnReads: activeReads, code: error.code, source: path.basename(String(from)) }); throw error; }
};
syncBuiltinESMExports();
async function read(file) { activeReads++; try { return await fs.readFile(file); } finally { activeReads--; } }
try {
  for (const mode of ['writer-only', 'serial-read-write', 'polling-read-write', 'continuous-read-write', 'held-read-handle']) {
    const file = path.join(root, mode + '.json'); await fs.writeFile(file, JSON.stringify({ value: 0 }));
    const item = { mode, nativeErrors: [], writes: 0, failedWrites: [], reads: 0, readErrors: [], postQuiesce: [], started: performance.now() }; report.cases.push(item); activeCase = item;
    let stop = false, reader, handle;
    if (mode.endsWith('read-write') && mode !== 'serial-read-write') reader = (async () => {
      while (!stop) { try { await read(file); item.reads++; } catch (error) { item.readErrors.push(error.code); }
        if (mode === 'polling-read-write') await new Promise(resolve => setTimeout(resolve, 10));
      }
    })();
    if (mode === 'held-read-handle') handle = await fs.open(file, 'r');
    const count = mode === 'held-read-handle' ? 1 : 80;
    for (let i = 1; i <= count; i++) {
      if (mode === 'serial-read-write') { await read(file); item.reads++; }
      try { await writeJsonAtomic(file, { value: i }); item.writes++; } catch (error) { item.failedWrites.push({ iteration: i, code: error.code }); if (item.failedWrites.length >= 4) break; }
    }
    stop = true; await reader; await handle?.close();
    for (let i = 0; i < 3; i++) { try { await writeJsonAtomic(file, { quiescent: i }); item.postQuiesce.push('OK'); } catch (error) { item.postQuiesce.push(error.code); } }
    item.durationMs = performance.now() - item.started; delete item.started;
  }
} finally {
  fs.rename = rename; syncBuiltinESMExports(); await fs.writeFile(path.join(out, tag + '.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ node: process.version, root, cases: report.cases.map(({ mode, nativeErrors, writes, failedWrites, reads, postQuiesce, durationMs }) => ({ mode, nativeErrors: nativeErrors.length, writes, failedWrites, reads, postQuiesce, durationMs })) }));
