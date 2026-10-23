// Isolated, one-shot protocol experiment. No extraction, planning, draft or product server.
// Real CLI takes no path/model/retry options. Dependency injection below exists for offline tests.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadLlmConfig, safeBaseUrl, validateModel, validateApiKey, containsKnownSecret } from '../../services/llm/config.ts';
import { validateSchema } from '../../services/llm/schema-validator.ts';
import { KNOWLEDGE_SEMANTIC_REVIEW_INSTRUCTION } from '../../services/llm/knowledge-semantic-review.ts';

export const PREFIX = 'KB02-PROTOCOL-20261023-';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EXPERIMENT = 'docs/reports/KB02-PROTOCOL-AUDIT-20261023-experiment.json';
export const ARTIFACT_SHA = 'b8f28bdab8f9b3408703bd1201a2f7b613b34b7fb56bf2b874162438269d6ace';
export const OLD_SHA = '1d11e66fd8ba5e37dab18a1fc4722044d753d0907efa0ccded96f9332498f114';
export const ENDPOINT = 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
export const LIMITS = Object.freeze({ timeoutMs: 60_000, inputBytes: 192 * 1024, outputBytes: 2 * 1024 * 1024 });
export const HISTORY = 'docs/reports/KB02-SEMANTIC-AUDIT-20261023-provider-attempts.jsonl';
const HISTORY_SHA = '8443f198efddd2556a43acab87493a4b5f944a5237fce3716d9d3e09cd03e271';
const CODE_HASHES = {
  'services/llm/provider.ts': '7f80cb0b7758de5b4c74112ab831f01409896d49c4a2afe7c3e2b04fa05ca945',
  'services/llm/knowledge-semantic-review.ts': 'e1803a471446185f4cb79460acdf8130b1a4db98ff6a0a520316c6b409f13cd7',
  'rules/kb02-semantic-review.schema.json': '4b1f7eb304d09a9770ba376b853a8bbc74d51653747ccc950cb156a3dbcb6851',
};
export const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
class GateError extends Error { constructor(code) { super(code); this.code = code; } }
function must(ok, code) { if (!ok) throw new GateError(code); }
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

// Both raw wire and parsed/escaped string values are checked before any persistence.
export function scanSecret(value, secrets) {
  const visit = (v, depth = 0) => {
    if (typeof v === 'string') {
      must(!containsKnownSecret(v, secrets) && !/(?:sk|rk|pk)[-_][A-Za-z0-9._~-]{8,}/iu.test(v), 'SECRET_SAFETY_STOP');
      if (['[', '{', '"'].includes(v.trimStart()[0])) {
        let parsed; try { parsed = JSON.parse(v); } catch { return; }
        must(depth < 8, 'SECRET_ENCODING_DEPTH_SAFETY_STOP');
        if (parsed !== v) visit(parsed, depth + 1);
      }
    } else if (Array.isArray(v)) v.forEach(x => visit(x, depth));
    else if (object(v)) for (const [key, child] of Object.entries(v)) { visit(key, depth); visit(child, depth); }
  };
  visit(value);
}

function durableNew(file, bytes) {
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { throw new GateError('EVIDENCE_STORAGE_OR_EXISTING_RUN_SAFETY_STOP'); }
}
function durableAppend(file, row) {
  try {
    const fd = fs.openSync(file, 'a');
    try { fs.writeFileSync(fd, JSON.stringify(row) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { throw new GateError('ATTEMPT_STORAGE_SAFETY_STOP'); }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function validateFrozen(root = ROOT) {
  const bytes = fs.readFileSync(path.join(root, EXPERIMENT));
  must(sha(bytes) === ARTIFACT_SHA, 'ARTIFACT_HASH_DRIFT');
  const a = JSON.parse(bytes);
  const oldBytes = fs.readFileSync(path.join(root, 'docs/reports/KB02-REPLAN-20261023-experiment.json'));
  must(sha(oldBytes) === OLD_SHA, 'ORIGINAL_HASH_DRIFT');
  const old = JSON.parse(oldBytes);
  must(JSON.stringify(a.requests.slice(0, 8)) === JSON.stringify(old.requests), 'ORIGINAL_EIGHT_DRIFT');
  must(a.requests.length === 10 && a.cases.length === 5 && a.budget.start === 209 && a.budget.maximumNew === 10 && a.budget.maximumCumulative === 219 && a.budget.totalLimit === 500, 'FROZEN_BUDGET_INVALID');
  for (const [file, hash] of Object.entries(CODE_HASHES)) must(sha(fs.readFileSync(path.join(root, file))) === hash, 'PRODUCT_BASELINE_DRIFT');
  const schema = readJson(path.join(root, 'rules/kb02-semantic-review.schema.json'));
  must(JSON.stringify(schema) === JSON.stringify(a.protocol.aSchema), 'CURRENT_SCHEMA_DRIFT');
  must(a.protocol.aSystem === KNOWLEDGE_SEMANTIC_REVIEW_INSTRUCTION + '\n严格遵守schema：' + JSON.stringify(schema), 'CURRENT_SYSTEM_DRIFT');
  for (const [index, r] of a.requests.entries()) {
    const c = a.cases.find(x => x.id === r.sampleId);
    must(r.ordinal === index + 1 && c && sha(r.request) === r.requestSha256, 'REQUEST_HASH_DRIFT');
    must(r.request.messages[0].content === a.protocol[r.condition === 'A' ? 'aSystem' : 'bSystem'], 'SYSTEM_DRIFT');
    must(r.request.messages[1].content === '请审核下列完整候选知识规划，只输出审核JSON。\n' + JSON.stringify({ input: c.input, plan: c.plan }), 'USER_INPUT_DRIFT');
    must(c.oracle.length === c.plan.pages.length, 'ORACLE_LENGTH_INVALID');
  }
  return a;
}

export function assess(content, request, a, finishReason = 'stop') {
  if (finishReason === 'length') return { structure: false, error: 'OUTPUT_TRUNCATED', semantic: null };
  let value; try { value = JSON.parse(content); } catch { return { structure: false, error: 'INVALID_JSON', semantic: null }; }
  const c = a.cases.find(x => x.id === request.sampleId);
  const schema = a.protocol[request.condition === 'A' ? 'aSchema' : 'bSchema'];
  const invalid = error => ({ structure: false, error, semantic: null });
  if (validateSchema(value, schema).length) return invalid('SCHEMA_INVALID');
  let decisions;
  if (request.condition === 'B') {
    if (value.decisions.length !== c.plan.pages.length) return invalid('DECISIONS_LENGTH');
    decisions = value.decisions;
  } else {
    const known = new Set([...c.input.factUnits, ...c.input.questionUnits].map(u => u.id));
    if (value.pages.length !== c.plan.pages.length || new Set(value.pages.map(p => p.pageIndex)).size !== c.plan.pages.length) return invalid('PAGE_COVERAGE');
    decisions = Array(c.plan.pages.length);
    for (const page of value.pages) {
      const candidate = c.plan.pages[page.pageIndex];
      if (!candidate || !page.reason.trim() || new Set(page.unitIds).size !== page.unitIds.length || page.unitIds.some(id => !known.has(id)) || (page.decision === 'pass') !== (page.code === 'OK') || (page.decision === 'pass' && !page.unitIds.some(id => candidate.factUnitIds.includes(id)))) return invalid('CROSS_FIELD_INVALID');
      decisions[page.pageIndex] = page.decision;
    }
  }
  return { structure: true, semantic: { status: 'PRELIMINARY_ORACLE_COMPARISON_REQUIRES_ASTRA_PAGE_REVIEW', matches: decisions.every((d, i) => d === c.oracle[i]), pages: decisions.map((decision, pageIndex) => ({ pageIndex, title: c.plan.pages[pageIndex].title, expected: c.oracle[pageIndex], actual: decision, matches: decision === c.oracle[pageIndex] })) } };
}

function configIdentity(config, expectedEndpoint) {
  const base = safeBaseUrl(config.baseUrl), model = validateModel(config.model);
  validateApiKey(config.apiKey);
  const endpoint = base + '/chat/completions';
  const secrets = [...new Set([config.apiKey, ...(config.knownSecrets ?? [])].filter(Boolean))];
  scanSecret({ endpoint, model }, secrets);
  must(endpoint === expectedEndpoint && model === 'GLM-5.3-Flash', 'CONFIGURATION_DRIFT');
  return { endpoint, model, secrets };
}
function providerWire(config, r) {
  // Mirrors provider.ts for the current host/model; no schema-decoding or sampling additions.
  const host = new URL(config.baseUrl).hostname.toLowerCase();
  const constrained = ['open.bigmodel.cn', 'api.z.ai'].includes(host) && config.model.trim().toLowerCase() === 'glm-5.3-flash';
  return { model: validateModel(config.model), stream: false, temperature: 0, messages: r.request.messages,
    ...(constrained ? { reasoning_effort: 'low', response_format: { type: 'json_object' } } : {}) };
}
async function capped(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { void response.body?.cancel().catch(() => {}); throw new GateError('RESPONSE_SIZE_SAFETY_STOP'); }
  const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const parts = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { void reader.cancel().catch(() => {}); throw new GateError('RESPONSE_SIZE_SAFETY_STOP'); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}
function history(root) {
  const bytes = fs.readFileSync(path.join(root, HISTORY));
  must(sha(bytes) === HISTORY_SHA, 'CUMULATIVE_HISTORY_DRIFT');
  const rows = bytes.toString('utf8').trim().split(/\r?\n/u).map(JSON.parse);
  must(rows.length === 6 && rows.every((r, i) => r.sequence === 204 + i), 'CUMULATIVE_HISTORY_INVALID');
}

// Test-only injection: fake transport still receives the exact frozen body, and cannot use
// a different HTTP endpoint unless it is loopback. CLI always uses native fetch and ENDPOINT.
export async function runMatrix({ root = ROOT, reportDir = path.join(root, 'docs/reports'), readConfig, fetchImpl = globalThis.fetch, test = false, endpoint = ENDPOINT, limits = LIMITS, appendAttempt = durableAppend } = {}) {
  if (!test) must(endpoint === ENDPOINT && limits === LIMITS && fetchImpl === globalThis.fetch && appendAttempt === durableAppend && readConfig === undefined && root === ROOT && reportDir === path.join(ROOT, 'docs/reports'), 'REAL_OVERRIDE_FORBIDDEN');
  else must(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname), 'FAKE_LOOPBACK_REQUIRED');
  const file = suffix => path.join(reportDir, PREFIX + suffix);
  const load = readConfig ?? (() => loadLlmConfig({ filePath: path.resolve(ROOT, process.env.FMCG_LLM_CONFIG_FILE || '.env.local') }));
  const checkPermit = () => {
    const permit = readJson(file('authorization.json'));
    must(permit.engineeringApproved === true && permit.mainAgentExecutionApproved === true && permit.realCallsApproved === true && permit.astraIndependentReviewApproved === true, 'EXECUTION_NOT_AUTHORIZED');
    must(permit.artifactSha256 === ARTIFACT_SHA && permit.start === 209 && permit.maximumNew === 10 && permit.totalLimit === 500 && permit.maximumCumulative === 219, 'AUTHORIZATION_BUDGET_INVALID');
  };
  checkPermit(); const a = validateFrozen(root); history(root);
  const initialConfig = await load(), initial = configIdentity(initialConfig, endpoint);
  const identity = sha(initialConfig); // Kept only in memory, never written or printed.
  for (const r of a.requests) {
    const body = JSON.stringify(r.request);
    scanSecret(body, initial.secrets); scanSecret(r.request, initial.secrets);
    const c = a.cases.find(x => x.id === r.sampleId);
    must(Buffer.byteLength(JSON.stringify({ input: c.input, plan: c.plan })) <= limits.inputBytes && Buffer.byteLength(body) <= limits.inputBytes, 'REQUEST_SIZE_SAFETY_STOP');
    if (!test) must(JSON.stringify(providerWire(initialConfig, r)) === body, 'PROVIDER_WIRE_DRIFT');
  }
  // Permanent one-shot guard. Never remove it, including on failures or unknown outcomes.
  durableNew(file('started.json'), JSON.stringify({ at: new Date().toISOString(), artifactSha256: ARTIFACT_SHA, start: 209, maximumNew: 10, noResume: true }) + '\n');
  durableNew(file('attempts.jsonl'), '');
  const results = [];
  const summary = () => ({ artifactSha256: ARTIFACT_SHA, start: 209, attempted: fs.readFileSync(file('attempts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length, totalLimit: 500, results, decision: 'REQUIRES_ASTRA_INDEPENDENT_PAGE_REVIEW_NOT_BATCH_ACCEPTANCE' });
  try {
    for (const r of a.requests) {
      checkPermit(); validateFrozen(root); history(root);
      const config = await load(), id = configIdentity(config, endpoint);
      must(sha(config) === identity, 'CONFIGURATION_DRIFT');
      const body = JSON.stringify(r.request);
      must(sha(body) === r.requestSha256, 'REQUEST_HASH_DRIFT');
      scanSecret(body, id.secrets); scanSecret(r.request, id.secrets);
      const rows = fs.readFileSync(file('attempts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      must(rows.length === r.ordinal - 1 && rows.every((x, i) => x.sequence === 210 + i && x.ordinal === i + 1 && x.requestSha256 === a.requests[i].requestSha256), 'ATTEMPT_LEDGER_INVALID');
      must(rows.length < 10 && 209 + rows.length < 219 && 209 + rows.length < 500, 'BUDGET_EXHAUSTED');
      const sequence = 210 + rows.length;
      // fsync MUST complete before the first network byte. Failure/timeout also consumes it.
      appendAttempt(file('attempts.jsonl'), { sequence, ordinal: r.ordinal, sampleId: r.sampleId, condition: r.condition, requestSha256: r.requestSha256, at: new Date().toISOString(), disposition: 'STARTED_COUNTS_EVEN_IF_OUTCOME_UNKNOWN' });
      const saved = fs.readFileSync(file('attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      must(saved.length === r.ordinal && saved.at(-1).sequence === sequence, 'ATTEMPT_NOT_DURABLE');
      const record = { sequence, ordinal: r.ordinal, sampleId: r.sampleId, condition: r.condition, requestSha256: r.requestSha256 };
      const controller = new AbortController(); let timer;
      try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new GateError('TIMEOUT_OUTCOME_UNKNOWN')); }, limits.timeoutMs); });
        const result = await Promise.race([(async () => {
          const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }, body, signal: controller.signal, redirect: 'error' });
          const bytes = await capped(response, limits.outputBytes);
          const raw = bytes.toString('utf8');
          scanSecret(raw, id.secrets);
          let payload; try { payload = JSON.parse(raw); } catch { /* Preserve complete safe raw response below. */ }
          if (payload !== undefined) scanSecret(payload, id.secrets);
          // An uncooperative/late transport must not persist a response after its timeout.
          must(!controller.signal.aborted, 'TIMEOUT_OUTCOME_UNKNOWN');
          durableNew(file(`seq${sequence}-response.bin`), bytes);
          return { response, payload, bytes };
        })(), timeout]);
        record.httpStatus = result.response.status;
        record.responseSha256 = sha(result.bytes); record.responseBytes = result.bytes.length;
        if (result.response.status === 401 || result.response.status === 403) throw new GateError('CREDENTIAL_SAFETY_STOP');
        if (!result.response.ok) record.outcome = { structure: false, semantic: null, error: 'PROVIDER_HTTP_FAILURE' };
        else if (result.payload?.error) record.outcome = { structure: false, semantic: null, error: 'PROVIDER_ERROR' };
        else {
          const choice = result.payload?.choices?.[0], content = choice?.message?.content;
          record.outcome = typeof content === 'string' && content.trim() ? assess(content, r, a, choice.finish_reason) : { structure: false, semantic: null, error: 'INVALID_PROVIDER_ENVELOPE' };
        }
      } catch (error) {
        const code = error instanceof GateError ? error.code : 'NETWORK_OR_CAPTURE_FAILURE_OUTCOME_UNKNOWN';
        record.outcome = { structure: false, semantic: null, error: code };
        // Never include arbitrary error.message/cause/headers or unsafe body fragments.
        if (error instanceof GateError && code !== 'TIMEOUT_OUTCOME_UNKNOWN') { results.push(record); durableNew(file(`seq${sequence}-result.json`), JSON.stringify(record, null, 2) + '\n'); throw error; }
        // Local persistence errors are safety failures, not ordinary network failures.
        if (error?.code && ['EACCES', 'EPERM', 'EIO', 'ENOSPC', 'EEXIST', 'ENOENT', 'EROFS'].includes(error.code)) { results.push(record); throw new GateError('EVIDENCE_STORAGE_SAFETY_STOP'); }
      } finally { clearTimeout(timer); controller.abort(); }
      results.push(record);
      durableNew(file(`seq${sequence}-result.json`), JSON.stringify(record, null, 2) + '\n');
    }
    const final = { ...summary(), completedFixedMatrix: true, cumulative: 219 };
    durableNew(file('summary.json'), JSON.stringify(final, null, 2) + '\n');
    return final;
  } catch (error) {
    durableNew(file('stopped.json'), JSON.stringify({ ...summary(), stopped: true, error: error instanceof GateError ? error.code : 'LOCAL_SAFETY_STOP', neverResumeOrRetry: true }, null, 2) + '\n');
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    must(process.argv.length === 2, 'NO_CLI_OVERRIDES');
    const result = await runMatrix();
    console.log(JSON.stringify({ completedFixedMatrix: result.completedFixedMatrix, attempted: result.attempted, cumulative: result.cumulative, review: result.decision }));
  } catch (error) {
    console.error(JSON.stringify({ stopped: true, code: error instanceof GateError ? error.code : 'LOCAL_SAFETY_STOP', realCallsMayHaveOccurred: fs.existsSync(path.join(ROOT, 'docs/reports', PREFIX + 'started.json')), noRetry: true }));
    process.exitCode = 1;
  }
}
