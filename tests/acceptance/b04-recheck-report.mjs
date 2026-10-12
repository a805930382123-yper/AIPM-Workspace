import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dir = path.join(process.cwd(), 'docs/reports');
const read = async name => JSON.parse(await readFile(path.join(dir, name), 'utf8'));
const names = { http: 'B04-recheck-http-2026-10-05T14-56-33.011Z.json', b02: 'B04-recheck-b02-regression-2026-10-05T14-57-36-549Z.json', b03: 'B04-recheck-b03-regression-2026-10-05T14-57-42.823Z.json' };
const http = await read(names.http), b02 = await read(names.b02), b03 = await read(names.b03);
const optional = async name => { try { return await read(name); } catch { return null; } };
const result = {
  conclusion: 'FAIL', sources: names, productImports: false, provider: 'independent localhost fake HTTP; no real AI',
  businessScenarios: http.checks.filter(c => c.id !== 'FROZEN-VERSION').length,
  summary: http.summary, checks: http.checks,
  closedBackend: ['F04-03', 'F04-06', 'F04-07', 'F04-08', 'F04-09', 'F04-10'],
  closedWithBrowser: ['F04-01', 'F04-02', 'F04-03', 'F04-06', 'F04-07', 'F04-08', 'F04-09', 'F04-10'],
  remaining: [
    { id: 'F04-04', check: 'F04-04-unknown-id-retry-not-silently-accepted', status: 'OPEN', priority: 2, reason: 'Unknown selected ID filtered before comparing confirmed payload; different request returns 201.' },
    { id: 'F04-05', check: 'F04-05-selection-renamed-page-and-skipped-text', status: 'OPEN', priority: 2, reason: 'Confirm IDs create page but stale draft selected flags label it uncreated and omit its Key Takeaways.' },
    { id: 'F04-11', check: 'F04-11-no-provider-offsets-summary-gets-located-evidence', status: 'OPEN', priority: 2, reason: 'Legally absent Provider hints are located correctly in draft but missing from actual summary HTTP input.' },
  ],
  fingerprint: { count: Object.keys(http.frozenBefore).length, before: http.frozenBefore, after: http.frozenAfter, changes: http.frozenChanged, builderProductMismatches: http.builderFingerprintMismatches },
  elapsedMs: { http: http.elapsedMs, b02: Date.parse(b02.finishedAt) - Date.parse(b02.startedAt), b03: Date.parse(b03.finishedAt) - Date.parse(b03.startedAt) },
  regressions: { b02: b02.summary, b03: b03.summary, b03BusinessIds: b03.checks.filter(c => c.id !== 'FROZEN-VERSION').map(c => c.id) },
  mainChecks: await optional('B04-recheck-main-checks.json'),
  browserEvidenceReview: { reviewed: true, report: 'B04-recheck-browser.md', persistence: await optional('B04-recheck-browser-checks.json'), note: 'Read actual browser report/API/file results; backend acceptance agent itself did not operate browser.' },
  realProvider: { status: 'BLOCKED', reason: 'No user-configured product Provider credentials; zero real provider calls; fixing deterministic defects would still not allow batch PASS.' },
  notRun: ['60-second timeout unchanged independent boundary (prior evidence retained)', '10-minute total deadline', 'Legacy Raw above 500000 chars', '51 aggregate pages', 'Full Provider error matrix on repaired version', 'Separate final draft-confirmed/final completed-manifest failure'],
  cleanup: { http: http.cleanup, b02Stopped: true, b03Stopped: true, temporaryDataRetained: true, formalWorkspaceTouched: false },
  finishedAt: new Date().toISOString(), tokenUsage: 'Unavailable',
};
await writeFile(path.join(dir, 'B04-recheck-independent-review.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ conclusion: result.conclusion, businessScenarios: result.businessScenarios, summary: result.summary, frozenFiles: result.fingerprint.count, elapsedMs: result.elapsedMs }));
