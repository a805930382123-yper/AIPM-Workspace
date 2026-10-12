// Consolidation only; the HTTP checks remain independently rerunnable.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dir = path.join(process.cwd(), 'docs/reports');
const read = async name => JSON.parse(await readFile(path.join(dir, name), 'utf8'));
const fullName = 'B04-independent-http-2026-10-05T12-55-45.407Z.json';
const summaryName = 'B04-independent-http-2026-10-05T12-57-59.204Z.json';
const b02Name = 'B04-independent-b02-regression-2026-10-05T12-54-45-798Z.json';
const b03Name = 'B04-independent-b03-regression-2026-10-05T12-54-51.510Z.json';
const full = await read(fullName), summary = await read(summaryName), b02 = await read(b02Name), b03 = await read(b03Name);
const mainChecks = await read('B04-main-checks.json');
const browserReport = await readFile(path.join(dir, 'B04-browser-independent.md'), 'utf8');
const checks = full.checks.map(check => check.id === 'E04-09-summary-complete-structured-input'
  ? { ...summary.checks.find(c => c.id === check.id), evidenceSource: summaryName, replacesHarnessInvalidFixture: fullName }
  : { ...check, evidenceSource: fullName });
const result = {
  conclusion: 'FAIL', basis: 'Independent public HTTP + filesystem; actual browser reviewed separately',
  testMethod: { productModulesImported: false, provider: 'independent fake localhost HTTP; no real AI', faultSeam: 'Acceptance-only --import wraps builtin fs rename/appendFile; separate actual index.md directory blocker test; crash exits 86 before source-phase manifest update' },
  sources: { full: fullName, summaryCorrection: summaryName, b02: b02Name, b03: b03Name },
  checks, summary: Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(s => [s, checks.filter(c => c.status === s).length])),
  businessScenarios: checks.filter(c => c.id !== 'FROZEN-VERSION').length,
  providerErrorMatrixSubcases: full.checks.find(c => c.id === 'E04-06-provider-error-matrix-zero-writes').evidence.length,
  elapsedMs: { full: full.elapsedMs, summaryCorrection: summary.elapsedMs, b02: Date.parse(b02.finishedAt) - Date.parse(b02.startedAt), b03: Date.parse(b03.finishedAt) - Date.parse(b03.startedAt) },
  fingerprint: { count: Object.keys(full.frozenBefore).length, before: full.frozenBefore, after: summary.frozenAfter, changes: full.frozenChanged, builderProductMismatches: full.builderFingerprintMismatches },
  regressions: { b02: b02.summary, b03: b03.summary },
  mainAgentIndependentChecks: mainChecks,
  browserEvidenceReview: { reviewed: true, report: 'B04-browser-independent.md', sha256: createHash('sha256').update(browserReport).digest('hex'), verdict: 'FAIL', failures: ['F04-01', 'F04-02', 'F04-03', 'F04-05'], note: 'Read real-browser report and persistence JSON; no claim that this backend acceptance agent itself operated browser.' },
  exclusions: [
    { source: 'B04-independent-http-2026-10-05T12-51-32.936Z.json', status: 'ENVIRONMENT_BLOCKED', reason: 'Default sandbox denied real product atomic rename with EPERM. Entire run excluded from product verdict.' },
    { source: 'B04-independent-http-2026-10-05T12-51-58.880Z.json', status: 'SUPERSEDED', reason: 'Early script used wrong search URL/stat field/error-code expectation; superseded by corrected full run.' },
    { source: fullName, id: 'E04-09-summary-complete-structured-input', status: 'HARNESS_INVALIDATED', reason: 'Identical block summaries deduplicated below summary-call threshold. Corrected fixture uses distinct >4000 total block summaries and demonstrably captures summary HTTP request.' },
  ],
  realProvider: { status: 'BLOCKED', reason: 'No user-configured product Provider credentials; zero real AI calls; fake cannot satisfy A08/A09/R23 semantic real-provider success.' },
  notRun: ['Ten-minute total deadline wall-clock boundary', 'Legacy Raw above 500000 chars at extractor (public B03 input 500001 limit covered by regression)', '51 aggregate suggestions boundary independent HTTP', 'Final draft-confirmed write and final completed-manifest failure separate from raw-state failure', 'Provider network disconnect independent HTTP (unit coverage belongs to main-agent test record)'],
  cleanup: { full: full.cleanup, summaryCorrection: summary.cleanup, regressionsServicesStopped: true, isolatedDataRetained: true, productionWorkspaceTouched: false },
  finishedAt: new Date().toISOString(), tokenUsage: 'Platform does not expose independent-agent token accounting',
};
await writeFile(path.join(dir, 'B04-independent-review.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ conclusion: result.conclusion, summary: result.summary, businessScenarios: result.businessScenarios, frozenFiles: result.fingerprint.count, elapsedMs: result.elapsedMs }));
