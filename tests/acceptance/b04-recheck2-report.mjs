import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const names = [
  'B04-recheck2-http-2026-10-05T15-39-49.783Z.json',
  'B04-recheck2-http-2026-10-05T15-40-53.592Z.json',
  'B04-recheck2-http-2026-10-05T15-42-57.088Z.json',
  'B04-recheck2-http-2026-10-05T15-43-28.747Z.json',
];
const readJson = async name => JSON.parse(await readFile('docs/reports/' + name, 'utf8'));
const runs = await Promise.all(names.map(readJson));
const effective = [...runs[0].checks.filter(c => !c.id.startsWith('F04-11') && c.id !== 'FROZEN-VERSION').map(c => ({ ...c, evidenceFile: names[0] })),
  ...runs.at(-1).checks.filter(c => c.id.startsWith('F04-11')).map(c => ({ ...c, evidenceFile: names.at(-1) }))];
const main = await readJson('B04-recheck2-main-checks.json');
const browser = await readJson('B04-recheck2-browser-checks.json');
const report = {
  overall: 'FAIL', date: new Date().toISOString(),
  scope: 'Second repair: F04-04/F04-05/F04-11 and direct Source snapshot regression only',
  provider: 'Explicit independent localhost fake; zero real Provider calls',
  effectiveBusiness: { scenarios: effective.length, pass: effective.filter(c => c.status === 'PASS').length, fail: effective.filter(c => c.status === 'FAIL').length, checks: effective },
  historicalRuns: names.map((name, i) => ({ name, sha256: createHash('sha256').update(JSON.stringify(runs[i])).digest('hex'), elapsedMs: runs[i].elapsedMs, originalSummary: runs[i].summary, cleanup: runs[i].cleanup, dataRoot: runs[i].dataRoot })),
  execution: { attempts: 4, businessExecutions: runs.reduce((sum, r) => sum + r.checks.filter(c => c.id !== 'FROZEN-VERSION').length, 0), totalScriptElapsedMs: runs.reduce((sum, r) => sum + r.elapsedMs, 0), note: 'Initial long-run assertions incorrectly assumed each merge entry held evidence only from that entry. Corrected to evidence-own provenance; initial two long failures are NOT product-failure evidence. Intermediate runs retained while completing payload capture and relocating the control test from helper to top-level. Latest run proves the product failures.' },
  fingerprints: {
    files: Object.keys(runs[0].frozenBefore).length,
    runtimeFreeze: runs.every(r => r.frozenChanged.length === 0) ? 'PASS' : 'FAIL',
    sameVersionAllRuns: runs.every(r => JSON.stringify(r.frozenBefore) === JSON.stringify(runs[0].frozenBefore)),
    builderDocument: 'FAIL', mismatches: ['README.md'],
    actualREADME: runs[0].frozenBefore['README.md'], reportedREADME: '814b4c5d1317e3f73db70e4c358486ada4b5bcc30e2f473c54a4fb19128042cd',
    note: 'Historic JSON FROZEN-VERSION combines runtime freeze and builder fingerprint check, so its original FAIL is retained; do not relabel it PASS. Runtime immutability and document mismatch are separate derived judgments.',
    frozenBefore: runs[0].frozenBefore, frozenAfter: runs.at(-1).frozenAfter,
  },
  defectClosure: { closed: ['F04-01','F04-02','F04-03','F04-04','F04-05','F04-06','F04-07','F04-08','F04-09','F04-10'], open: ['F04-11'], inheritedClosures: ['F04-01','F04-02','F04-03','F04-06','F04-07','F04-08','F04-09','F04-10'] },
  main, browser,
  realProvider: { status: 'BLOCKED', calls: 0, reason: 'User-configured product Provider/model/key absent; presence only evidence from parent, no credentials read.', evidence: 'B04-recheck2-config-presence.json' },
  cleanup: { ownProductProcesses: runs.reduce((sum, r) => sum + r.services.length, 0), allOwnProcessesExited: runs.every(r => r.cleanup.ownServicesClosed), ownFakeListeners: 4, allOwnFakeClosed: runs.every(r => r.cleanup.fakeClosed), dataRetained: true, formalWorkspaceTouched: false },
  notRun: ['Unchanged full timeout/budget/cancel/delete/disk recovery matrix (prior evidence retained)', 'Full B02/B03 independent repeat (no relevant product changes; build and 96 selftests separately pass)', 'Real Provider successful semantic/long-text evaluation'],
  nextBatchAuthorized: false,
};
// Hash the exact evidence bytes as well as the parsed report serialization above.
for (const item of report.historicalRuns) item.fileSha256 = createHash('sha256').update(await readFile('docs/reports/' + item.name)).digest('hex');
await writeFile('docs/reports/B04-recheck2-independent-review.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ business: { total: effective.length, pass: report.effectiveBusiness.pass, fail: report.effectiveBusiness.fail }, elapsedMs: report.execution.totalScriptElapsedMs, cleanup: report.cleanup }));
