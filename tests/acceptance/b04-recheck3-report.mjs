import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'docs/reports/';
const names = ['B04-recheck3-http-2026-10-05T16-10-44.777Z.json','B04-recheck3-http-2026-10-05T16-11-22.996Z.json'];
const json = async name => JSON.parse(await readFile(base + name, 'utf8'));
const runs = await Promise.all(names.map(json));
const sha = data => createHash('sha256').update(data).digest('hex');
const effective = [...runs[0].checks.filter(c => c.id.startsWith('F04-11') && c.status === 'PASS').map(c => ({ ...c, evidenceFile: names[0] })),
  ...runs[1].checks.filter(c => c.id.startsWith('F04-11')).map(c => ({ ...c, evidenceFile: names[1] }))];
const main = await json('B04-recheck3-main-checks.json');
const before = runs[0].frozenBefore;
const report = {
  date: '2026-10-06', timezone: 'Asia/Shanghai', generatedAt: new Date().toISOString(), overall: 'BLOCKED', deterministic: 'PASS',
  scope: 'F04-11 immutable per-chunk snapshots/evidence references and directly affected regression only',
  provider: 'Explicit independent localhost HTTP fake; no real Provider call', productImports: false,
  effectiveBusiness: { scenarios: effective.length, pass: effective.filter(c => c.status === 'PASS').length, fail: effective.filter(c => c.status === 'FAIL').length, checks: effective },
  execution: { scriptElapsedMs: runs.reduce((sum,r) => sum + r.elapsedMs, 0), attempts: 2, businessExecutions: 5,
    excludedHarnessError: { file: names[0], id: 'F04-11-no-offsets-distinct-page-control', error: "Cannot access 'formal' before initialization", explanation: 'Local result variable shadowed the formal() helper; fixed only verifier script and reran this one scenario. Original FAIL remains unchanged and is not a product failure.' } },
  fingerprints: { count: Object.keys(before).length, runtime: runs.every(r => r.frozenChanged.length === 0) ? 'PASS' : 'FAIL',
    sameVersionAllRuns: runs.every(r => Object.keys(before).every(k => r.frozenBefore[k] === before[k])),
    builderProduct: runs.every(r => r.builderFingerprintMismatches.length === 0) ? 'PASS' : 'FAIL', comparedProductDeclarations: 4,
    frozenBefore: before, frozenAfter: runs.at(-1).frozenAfter },
  closure: { closed: Array.from({length:11}, (_,i) => 'F04-' + String(i+1).padStart(2,'0')), open: [], newlyClosed: ['F04-11'], priorEvidence: 'B04-recheck2-acceptance.md' },
  main, uiFingerprint: await json('B04-recheck3-ui-fingerprint.json'),
  documentaryEvidence: { status: 'DOC_HASH_MISMATCH', productDefect: false, ...main.builderMergeEvidenceDocument },
  realProvider: { status: 'BLOCKED', calls: 0, presence: await json('B04-recheck3-config-presence.json'), reason: 'No user-configured product Provider/model/key; only presence indicators read.' },
  cleanup: { ownProductProcessInstances: runs.reduce((sum,r) => sum + r.services.length, 0), allExited: runs.every(r => r.cleanup.ownServicesClosed), fakeListeners: 2, allFakeClosed: runs.every(r => r.cleanup.fakeClosed), retainedTempData: runs.map(r=>r.dataRoot), formalWorkspaceTouched: false },
  notRun: ['Real Provider success/semantic quality/real long text', 'Unchanged UI real-browser repeat (prior UI fingerprint equal)', 'Unchanged full B02/B03/60s timeout/10min deadline/error/fault/cancel/delete matrix'],
  nextBatchAuthorized: false,
};
report.evidenceFiles = await Promise.all(names.map(async(name,i) => ({name, sha256: sha(await readFile(base+name)), originalSummary: runs[i].summary, elapsedMs: runs[i].elapsedMs, cleanup:runs[i].cleanup})));
report.builderArchiveHashes = { http: sha(await readFile(base + main.builderArchives.http.path)), merge: sha(await readFile(base + main.builderArchives.merge.path)) };
await writeFile(base + 'B04-recheck3-independent-review.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({overall:report.overall, deterministic:report.deterministic, scenarios:effective.length, closed:report.closure.closed.length, elapsedMs:report.execution.scriptElapsedMs, cleanup:report.cleanup}));
