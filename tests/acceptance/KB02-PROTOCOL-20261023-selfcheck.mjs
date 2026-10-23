// Finite fake-only checks; never loads real configuration or invokes a real transport.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OpenAiCompatibleProvider } from '../../services/llm/provider.ts';
import { PREFIX, ROOT, EXPERIMENT, ARTIFACT_SHA, OLD_SHA, ENDPOINT, LIMITS, HISTORY, sha, validateFrozen, assess, scanSecret, runMatrix } from './KB02-PROTOCOL-20261023-runner.mjs';

const report = path.join(ROOT, 'docs/reports', PREFIX + 'selfcheck.json');
const a = validateFrozen();
const results = [], failures = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
const secret = 'offlineCredentialForProtocolSafetyCheck';
const fakeConfig = { baseUrl: 'http://127.0.0.1:1/v4', model: 'GLM-5.3-Flash', apiKey: secret, source: 'fake', knownSecrets: [secret] };
let index = 0;
// Filesystem-only protection (sandbox forbids Node child processes). Concurrent owned
// reports/status are excluded; all product modules and old history remain included.
function protection() {
  const out = {};
  function walk(p) {
    const rel = path.relative(ROOT, p).replaceAll('\\', '/');
    if (['docs/status.md', 'docs/agent-control.md'].includes(rel) || rel.startsWith('docs/reports/KB02-PROTOCOL-') || rel.startsWith('tests/acceptance/KB02-PROTOCOL-')) return;
    const stat = fs.lstatSync(p); if (stat.isSymbolicLink()) { out[rel] = 'SYMLINK:' + fs.readlinkSync(p); return; }
    if (stat.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n)); else if (stat.isFile()) out[rel] = sha(fs.readFileSync(p));
  }
  for (const name of ['app', 'docs', 'rules', 'scripts', 'server', 'services', 'tests', '.githooks']) walk(path.join(ROOT, name));
  for (const name of fs.readdirSync(ROOT)) if (fs.lstatSync(path.join(ROOT, name)).isFile() && name !== '.env.local') walk(path.join(ROOT, name));
  return out;
}
const before = protection();
const localPaths = ['.env.local', 'workspace'];
function privateProtection() {
  const out = {};
  function walk(p) { if (!fs.existsSync(p)) return; const stat = fs.lstatSync(p); if (stat.isSymbolicLink()) { out[path.relative(ROOT, p)] = 'SYMLINK:' + fs.readlinkSync(p); return; } if (stat.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n)); else if (stat.isFile()) out[path.relative(ROOT, p)] = sha(fs.readFileSync(p)); }
  for (const name of localPaths) walk(path.join(ROOT, name)); return out;
}
const privateBefore = privateProtection();
function setup() {
  const root = path.join(temp, String(++index)); fs.mkdirSync(path.join(root, 'docs/reports'), { recursive: true });
  for (const name of [EXPERIMENT, 'docs/reports/KB02-REPLAN-20261023-experiment.json', HISTORY, 'services/llm/provider.ts', 'services/llm/knowledge-semantic-review.ts', 'rules/kb02-semantic-review.schema.json']) {
    const dest = path.join(root, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(ROOT, name), dest);
  }
  const dir = path.join(root, 'docs/reports');
  const permit = { artifactSha256: ARTIFACT_SHA, engineeringApproved: true, astraIndependentReviewApproved: true, mainAgentExecutionApproved: true, realCallsApproved: true, start: 209, maximumNew: 10, maximumCumulative: 219, totalLimit: 500 };
  const file = suffix => path.join(dir, PREFIX + suffix);
  fs.writeFileSync(file('authorization.json'), JSON.stringify(permit));
  let calls = 0, active = 0;
  const options = { root, reportDir: dir, test: true, endpoint: fakeConfig.baseUrl + '/chat/completions', readConfig: async () => structuredClone(fakeConfig), fetchImpl: async (url, init) => {
    assert.equal(active++, 0); const n = calls++;
    assert.equal(url, options.endpoint); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal(init.body, JSON.stringify(a.requests[n].request));
    // Exact equality proves no extra field/oracle/whole-artifact content is sent.
    assert.deepEqual(JSON.parse(init.body), a.requests[n].request);
    const rows = fs.readFileSync(file('attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, n + 1); assert.equal(rows[n].sequence, 210 + n);
    assert.equal(rows[n].requestSha256, sha(init.body));
    assert.equal(init.headers.authorization, 'Bearer ' + secret);
    await Promise.resolve(); active--; return response(valid(a.requests[n]));
  } };
  return { root, dir, permit, file, options, count: () => calls };
}
function valid(r) {
  const c = a.cases.find(x => x.id === r.sampleId);
  return r.condition === 'B' ? { decisions: c.oracle } : { version: 1, pages: c.plan.pages.map((p, i) => ({ pageIndex: i, decision: c.oracle[i], code: c.oracle[i] === 'pass' ? 'OK' : 'UNSUPPORTED_TOPIC', unitIds: [p.factUnitIds[0]], reason: '离线虚构响应，只检查执行器' })) };
}
function response(v, status = 200) { return new Response(JSON.stringify({ choices: [{ message: { content: typeof v === 'string' ? v : JSON.stringify(v) }, finish_reason: 'stop' }] }), { status }); }
async function check(name, fn) { try { await fn(); results.push({ name, pass: true }); } catch (e) { failures.push(name); results.push({ name, pass: false, error: e?.code || e?.name || 'ERROR' }); } }
async function rejects(fn, code) { await assert.rejects(fn, e => !code || e.code === code || e.message === code); }

await check('frozen SHA/current schema/system/original eight byte equality', () => {
  assert.equal(sha(fs.readFileSync(path.join(ROOT, EXPERIMENT))), ARTIFACT_SHA);
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'docs/reports/KB02-REPLAN-20261023-experiment.json'))), OLD_SHA);
  assert.equal(validateFrozen().requests.length, 10);
});
await check('real entry default closed and no started/attempt output', async () => {
  const started = path.join(ROOT, 'docs/reports', PREFIX + 'started.json'); assert(!fs.existsSync(started));
  await rejects(() => runMatrix(), 'EXECUTION_NOT_AUTHORIZED'); assert(!fs.existsSync(started));
});
await check('current product Provider reconstructs all ten frozen bodies exactly under intercepted fake fetch', async () => {
  const original = globalThis.fetch; let n = 0;
  globalThis.fetch = async (url, init) => { assert.equal(url, ENDPOINT); assert.equal(init.body, JSON.stringify(a.requests[n].request)); return response(valid(a.requests[n++])); };
  try {
    const provider = new OpenAiCompatibleProvider({ ...fakeConfig, baseUrl: ENDPOINT.replace(/\/chat\/completions$/u, '') });
    for (const r of a.requests) await provider.complete({ system: r.request.messages[0].content, user: r.request.messages[1].content, purpose: 'knowledge', timeoutMs: LIMITS.timeoutMs, maxOutputBytes: LIMITS.outputBytes });
    assert.equal(n, 10);
  } finally { globalThis.fetch = original; }
});
await check('ten exact wire bodies; zero oracle; pre-send durable ledger; serial 210-219; full first raw bytes', async () => {
  const s = setup(); const final = await runMatrix(s.options);
  assert.equal(s.count(), 10); assert.equal(final.attempted, 10); assert.equal(final.cumulative, 219);
  assert(final.results.every(x => x.outcome.structure && x.outcome.semantic.matches));
  for (const record of final.results) assert.equal(sha(fs.readFileSync(s.file(`seq${record.sequence}-response.bin`))), record.responseSha256);
  assert(!fs.existsSync(path.join(s.root, 'workspace')));
  const original = fs.readFileSync(s.file('seq210-response.bin'));
  await rejects(() => runMatrix(s.options), 'EVIDENCE_STORAGE_OR_EXISTING_RUN_SAFETY_STOP'); assert.equal(s.count(), 10);
  assert.deepEqual(fs.readFileSync(s.file('seq210-response.bin')), original);
});
await check('artifact hash drift sends zero', async () => { const s = setup(); fs.appendFileSync(path.join(s.root, EXPERIMENT), ' '); await rejects(() => runMatrix(s.options), 'ARTIFACT_HASH_DRIFT'); assert.equal(s.count(), 0); });
await check('orphan attempt ledger also refuses a new run', async () => { const s = setup(); fs.writeFileSync(s.file('attempts.jsonl'), '{"sequence":210}\n'); await rejects(() => runMatrix(s.options), 'EVIDENCE_STORAGE_OR_EXISTING_RUN_SAFETY_STOP'); assert.equal(s.count(), 0); });
await check('product/current schema and original request drift sends zero', async () => {
  for (const f of ['rules/kb02-semantic-review.schema.json', 'docs/reports/KB02-REPLAN-20261023-experiment.json']) { const s = setup(); fs.appendFileSync(path.join(s.root, f), ' '); await rejects(() => runMatrix(s.options)); assert.equal(s.count(), 0); }
});
await check('authorization/cumulative/maximum budget tampering sends zero', async () => {
  for (const change of [{ start: 500 }, { maximumNew: 11 }, { maximumCumulative: 220 }, { totalLimit: 501 }, { realCallsApproved: false }]) { const s = setup(); fs.writeFileSync(s.file('authorization.json'), JSON.stringify({ ...s.permit, ...change })); await rejects(() => runMatrix(s.options)); assert.equal(s.count(), 0); }
  const s = setup(); fs.appendFileSync(path.join(s.root, HISTORY), '\n'); await rejects(() => runMatrix(s.options), 'CUMULATIVE_HISTORY_DRIFT'); assert.equal(s.count(), 0);
});
await check('configuration/key drift between preflight and first send stops', async () => { const s = setup(); let loads = 0; s.options.readConfig = async () => ({ ...fakeConfig, apiKey: ++loads === 1 ? secret : 'changedOfflineCredential' }); await rejects(() => runMatrix(s.options), 'CONFIGURATION_DRIFT'); assert.equal(s.count(), 0); });
await check('pre-accounting exception or nonpersisted row sends zero and cannot resume', async () => {
  for (const appendAttempt of [() => { const e = new Error('do not log'); e.code = 'EIO'; throw e; }, () => {}]) { const s = setup(); s.options.appendAttempt = appendAttempt; await rejects(() => runMatrix(s.options)); assert.equal(s.count(), 0); await rejects(() => runMatrix(s.options)); assert.equal(s.count(), 0); }
});
await check('unknown network outcome counts once; no retry; fixed remaining cells; rerun refused', async () => {
  const s = setup(); const good = s.options.fetchImpl; let calls = 0;
  s.options.fetchImpl = async (url, init) => { calls++; if (calls === 1) { await good(url, init); throw new Error('unknown offline transport result'); } return good(url, init); };
  const final = await runMatrix(s.options); assert.equal(calls, 10); assert.equal(final.attempted, 10); assert.equal(final.results[0].outcome.error, 'NETWORK_OR_CAPTURE_FAILURE_OUTCOME_UNKNOWN');
  await rejects(() => runMatrix(s.options)); assert.equal(calls, 10);
});
await check('invalid JSON/schema/semantic mismatch and HTTP500 do not retry or stop matrix', async () => {
  const s = setup(); const good = s.options.fetchImpl; let n = 0;
  s.options.fetchImpl = async (url, init) => { await good(url, init); n++; if (n === 1) return response('```json\n{}\n```'); if (n === 2) return response({ decisions: ['pass'] }); if (n === 3) return response({ decisions: ['reject'] }); if (n === 4) return new Response('provider offline error', { status: 500 }); return response(valid(a.requests[n - 1])); };
  const final = await runMatrix(s.options); assert.equal(n, 10); assert.equal(final.results[0].outcome.error, 'INVALID_JSON'); assert.equal(final.results[1].outcome.error, 'DECISIONS_LENGTH'); assert.equal(final.results[2].outcome.semantic.matches, false); assert.equal(final.results[3].outcome.error, 'PROVIDER_HTTP_FAILURE');
});
await check('A cross-field gates and B exact lengths; no response repair', () => {
  const r = a.requests[0];
  for (const mutate of [v => { v.pages[1].pageIndex = 0; }, v => { v.pages[0].unitIds.push(v.pages[0].unitIds[0]); }, v => { v.pages[0].unitIds = ['unknown']; }, v => { v.pages[0].code = 'BOUNDARY_ATTRIBUTION'; }, v => { v.pages[0].unitIds = [a.cases[0].plan.pages[2].factUnitIds[0]]; }, v => { v.pages[0].reason = ' '; }, v => { delete v.pages[0].reason; }, v => { v.extra = true; }]) { const v = valid(r); mutate(v); assert.equal(assess(JSON.stringify(v), r, a).structure, false); }
  assert.equal(assess('{}', r, a).structure, false); assert.equal(assess(JSON.stringify(valid(r)), r, a, 'length').error, 'OUTPUT_TRUNCATED');
  assert.equal(assess('{"decisions":["pass","pass","reject"],"extra":true}', a.requests[1], a).structure, false);
});
await check('timeout counts once; late response cannot overwrite or appear after capture deadline', async () => {
  const s = setup(); const good = s.options.fetchImpl; let n = 0;
  s.options.limits = { ...LIMITS, timeoutMs: 10 };
  s.options.fetchImpl = async (url, init) => { const r = await good(url, init); if (++n === 1) await new Promise(resolve => setTimeout(resolve, 90)); return r; };
  const final = await runMatrix(s.options); await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(n, 10); assert.equal(final.results[0].outcome.error, 'TIMEOUT_OUTCOME_UNKNOWN'); assert(!fs.existsSync(s.file('seq210-response.bin')));
});
await check('request input size stops before any attempt', async () => { const s = setup(); s.options.limits = { ...LIMITS, inputBytes: 1 }; await rejects(() => runMatrix(s.options), 'REQUEST_SIZE_SAFETY_STOP'); assert.equal(s.count(), 0); assert(!fs.existsSync(s.file('started.json'))); });
await check('declared and streamed response overflow stop immediately with no raw fragment', async () => {
  for (const declared of [false, true]) { const s = setup(); let n = 0; s.options.limits = { ...LIMITS, outputBytes: 20 }; s.options.fetchImpl = async () => { n++; return new Response('x'.repeat(21), declared ? { headers: { 'content-length': '21' } } : {}); }; await rejects(() => runMatrix(s.options), 'RESPONSE_SIZE_SAFETY_STOP'); assert.equal(n, 1); assert(!fs.existsSync(s.file('seq210-response.bin'))); }
});
await check('raw/JSON escaped/percent encoded secrets never persist; abort matrix', async () => {
  const encodings = [secret, [...secret].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''), [...secret].map(c => '%' + c.charCodeAt(0).toString(16)).join('')];
  for (const encoded of encodings) { const s = setup(); let n = 0; s.options.fetchImpl = async () => { n++; return new Response('{"choices":[{"message":{"content":"' + encoded + '"}}]}'); }; await rejects(() => runMatrix(s.options), 'SECRET_SAFETY_STOP'); assert.equal(n, 1); assert(!fs.existsSync(s.file('seq210-response.bin'))); for (const f of fs.readdirSync(s.dir).filter(f => f.startsWith(PREFIX))) assert(!fs.readFileSync(path.join(s.dir, f), 'utf8').includes(secret)); }
  assert.throws(() => scanSecret({ [secret]: 'safe' }, [secret]));
});
await check('request secret prevents any send; auth401 consumes one then stops', async () => {
  const s = setup(); s.options.readConfig = async () => ({ ...fakeConfig, knownSecrets: ['知识规划'] }); await rejects(() => runMatrix(s.options), 'SECRET_SAFETY_STOP'); assert.equal(s.count(), 0);
  const t = setup(); let calls = 0; t.options.fetchImpl = async () => { calls++; return new Response('{"error":"offline auth refused"}', { status: 401 }); }; await rejects(() => runMatrix(t.options), 'CREDENTIAL_SAFETY_STOP'); assert.equal(calls, 1); assert.equal(fs.readFileSync(t.file('attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
});
await check('real overrides/nonloopback fake forbidden', async () => {
  await rejects(() => runMatrix({ root: temp }), 'REAL_OVERRIDE_FORBIDDEN');
  await rejects(() => runMatrix({ test: true, endpoint: ENDPOINT }), 'FAKE_LOOPBACK_REQUIRED');
});
await check('product/history and local config/formal workspace hashes unchanged', () => { assert.deepEqual(protection(), before); assert.deepEqual(privateProtection(), privateBefore); });
const output = { at: new Date().toISOString(), command: 'node --import tsx tests/acceptance/KB02-PROTOCOL-20261023-selfcheck.mjs', suppliedHead: '13e4104e63150c10ec74b2ef2be36ae56c206fb2', artifactSha256: ARTIFACT_SHA, realProviderCalls: 0, transport: 'in-memory fake; no server/socket/browser/product startup', pass: failures.length === 0, checkCount: results.length, results, protectedFileCount: Object.keys(before).length, localProtectedCount: Object.keys(privateBefore).length, temporaryEvidenceDirectory: temp, limitations: 'Finite builder self-check, not Astra independent review or semantic/product/batch acceptance.' };
const temporaryReport = path.join(temp, 'selfcheck.json');
fs.writeFileSync(temporaryReport, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ pass: output.pass, checks: results.length, failed: failures, realProviderCalls: 0, temporaryReport, intendedReport: path.relative(ROOT, report) }));
if (failures.length) process.exitCode = 1;
