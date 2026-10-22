import fs from 'node:fs/promises';
import path from 'node:path';
const prefix = 'docs/reports/KB02-SR01-IO-DIAG-20261021-';
const report = { at: new Date().toISOString(), traces: [], probes: [], retained: [], realProviderCalls: 0 };
const dirs = (await fs.readdir('docs/reports', { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('KB02-SR01-IO-DIAG-20261021-') && entry.name.endsWith('-events'));
for (const dir of dirs) {
  const parent = 'docs/reports/' + dir.name;
  for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
    const file = parent + '/' + entry.name;
    if (entry.isDirectory()) {
      const snapshot = JSON.parse(await fs.readFile(file + '/snapshot.json', 'utf8'));
      const job = JSON.parse(await fs.readFile(file + '/job.json', 'utf8'));
      const cp = JSON.parse(await fs.readFile(file + '/checkpoint.json', 'utf8'));
      const raw = JSON.parse(await fs.readFile(file + '/raw-state.json', 'utf8'));
      report.retained.push({ directory: file, phase: snapshot.recovery.phase, error: snapshot.recovery.details, job: { id: job.id, status: job.status, callCount: job.callCount }, checkpoint: { attempts: cp.attempts, stage: cp.stage, chunks: cp.completedChunks.length, error: cp.lastError?.code, diagnostic: !!cp.lastError?.diagnostic }, rawStatus: raw.status, savedFiles: snapshot.files });
    } else if (entry.name.endsWith('.json')) {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.events) {
        const failures = value.events.filter(event => event.op === 'rename:error');
        const groups = new Map();
        for (const error of failures) { const key = error.source ?? 'unrecorded-source'; const group = groups.get(key) ?? []; group.push(error); groups.set(key, group); }
        const exhausted = [...groups].filter(([key, events]) => key !== 'unrecorded-source' && events.length >= 6).map(([source, errors]) => ({ source, target: errors[0].target, count: errors.length, elapsedMs: errors.at(-1).atMs - errors[0].atMs, attempted: errors[0].attempted, readerOverlap: errors.map(error => ({ atMs: error.atMs, atEntry: error.entryReaders.reads.length + error.entryReaders.handles.length, atExit: error.exitReaders.reads.length + error.exitReaders.handles.length })), lastReaderEvents: value.events.filter(event => event.target === errors[0].target && event.atMs <= errors.at(-1).atMs && ['readFile:start', 'readFile:end', 'open', 'close'].includes(event.op)).slice(-12) }));
        report.traces.push({ file, node: value.node, events: value.events.length, dropped: value.dropped, activeReads: value.activeReads.length, activeHandles: value.activeHandles.length, nativeRenameErrors: failures.length, errorsWithSameProcessReaderAtEntry: failures.filter(error => error.entryReaders.reads.length || error.entryReaders.handles.length).length, exhausted, retainedPhases: value.events.filter(event => event.op === 'retained-failure').map(event => ({ jobId: event.jobId, phase: event.phase })) });
      } else if (value.cases) report.probes.push({ file, node: value.node, cases: value.cases.map(item => ({ mode: item.mode, writes: item.writes, nativeErrors: item.nativeErrors.length, failedWrites: item.failedWrites, reads: item.reads, postQuiesce: item.postQuiesce, durationMs: item.durationMs })) });
    }
  }
}
await fs.writeFile(prefix + 'analysis.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ traces: report.traces.length, nativeRenameErrors: report.traces.reduce((sum, row) => sum + row.nativeRenameErrors, 0), readerOverlapErrors: report.traces.reduce((sum, row) => sum + row.errorsWithSameProcessReaderAtEntry, 0), exhausted: report.traces.flatMap(row => row.exhausted.map(group => ({ file: row.file, source: group.source, attempted: group.attempted, count: group.count, readerOverlap: group.readerOverlap }))), retained: report.retained.map(({ directory, phase, job, checkpoint, rawStatus }) => ({ directory, phase, job, checkpoint, rawStatus })), probes: report.probes.map(({ node, cases }) => ({ node, cases })) }));
