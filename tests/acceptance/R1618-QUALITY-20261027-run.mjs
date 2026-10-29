// Narrow original-output capture. No HTTP server, browser, retry or product changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RawStore } from '../../services/raw/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { buildKnowledgeAtoms } from '../../services/llm/knowledge-atoms.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { assertNoKnownSecret } from '../../services/llm/provider.ts';

export const FIXTURE = 'tests/acceptance/R1618-QUALITY-20261027-fixture.json';
const SCRIPT = 'tests/acceptance/R1618-QUALITY-20261027-run.mjs';
const CARD = 'docs/handoffs/OPENAI-STRUCTURED-20261029-task.md';
const PLAN = 'docs/reports/R1618-CLOSURE-20261029-plan.md';
const PREFIX = '.scratch-OPENAI-STRUCTURED-20261029-';
const PROFILES = {
  output: { fixture: 'tests/acceptance/R1618-OQ-20261029-output-fixture.json', knowledgeBefore: 254, sequences: [255, 256] },
  question: { fixture: 'tests/acceptance/OPENAI-STRUCTURED-20261029-question-fixture.json', knowledgeBefore: 256, sequences: [257, 258] },
};
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const must = (ok, code) => { if (!ok) { const error = new Error(code); error.code = code; throw error; } };
async function durable(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
}
async function present(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function questionTargets(body, sample) {
  const [chunk] = chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 });
  const atoms = buildKnowledgeAtoms(body, buildEvidenceLocatorCatalog(body, chunk));
  must(atoms.length === 3 && atoms.every((atom, index) => atom.text === sample.quotes[index] && !atom.fragment), 'QUESTION_ATOMS_NOT_INDEPENDENT');
  return { fact: atoms[0], questions: atoms.slice(1) };
}
async function freeze() {
  const files = [];
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files.push({ path: file.replaceAll('\\', '/'), sha256: sha(await fs.readFile(file)) });
    }
  }
  // Includes the actual pipeline/store/render dependencies and runtime rule files.
  await walk('services'); await walk('rules');
  for (const file of [SCRIPT, ...Object.values(PROFILES).map(profile => profile.fixture), CARD, PLAN, 'package.json', 'package-lock.json']) files.push({ path: file, sha256: sha(await fs.readFile(file)) });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, sha256: sha(files) };
}
export async function prepare(profile, mode = 'real') {
  must(Object.hasOwn(PROFILES, profile), 'PROFILE_INVALID');
  const config = PROFILES[profile];
  must(['real', 'fake'].includes(mode), 'MODE_INVALID');
  const sample = await read(config.fixture), body = sample.quotes.join(sample.joinWith);
  must(sample.quotes.length > 0 && chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 }).length === 1, 'SINGLE_FIXED_SAMPLE_REQUIRED');
  const root = await fs.mkdtemp(path.resolve(PREFIX)), raws = new RawStore(root); await raws.initialize();
  const raw = await raws.create({ title: sample.title, sourceType: sample.sourceType, sourceName: sample.sourceName, body, tags: ['虚构', 'R1618-quality'] });
  const rawPath = path.join(root, 'knowledge/raw/notes', raw.id + '.md');
  const frozen = await freeze(); await durable(path.join(root, 'freeze.json'), frozen);
  if (profile === 'question') await durable(path.join(root, 'question-atom-targets.json'), questionTargets(body, sample));
  const session = { id: randomUUID(), root, mode, profile, fixture: config.fixture, rawId: raw.id, rawSha256: raw.bodySha256, rawFileSha256: sha(await fs.readFile(rawPath)), fixtureSha256: sha(await fs.readFile(config.fixture)), freezeSha256: frozen.sha256, knowledgeBefore: config.knowledgeBefore, sequences: config.sequences, maxCalls: 2, promptUsed: 15 };
  await durable(path.join(root, 'session.json'), session);
  return { session, releaseTemplate: { released: false, budgetApproved: false, issuedBy: 'main', issuedAt: null, sessionId: session.id, mode, profile, maxCalls: 2, sequences: config.sequences, rawId: raw.id, rawSha256: raw.bodySha256, fixtureSha256: session.fixtureSha256, freezeSha256: frozen.sha256 } };
}
async function sessionAt(root) {
  root = path.resolve(root);
  must(path.dirname(root) === process.cwd() && path.basename(root).startsWith(PREFIX), 'ISOLATED_ROOT_REQUIRED');
  must(!(await fs.lstat(root)).isSymbolicLink(), 'SYMLINK_ROOT_DENIED');
  const s = await read(path.join(root, 'session.json'));
  must(Object.hasOwn(PROFILES, s.profile), 'PROFILE_INVALID');
  const config = PROFILES[s.profile];
  must(s.root === root && ['real', 'fake'].includes(s.mode) && s.fixture === config.fixture && s.maxCalls === 2 && s.knowledgeBefore === config.knowledgeBefore && s.promptUsed === 15 && JSON.stringify(s.sequences) === JSON.stringify(config.sequences), 'SESSION_INVALID');
  return s;
}
async function releaseFor(s, file, exactSha) {
  must(file && exactSha, 'RELEASE_REQUIRED');
  const bytes = await fs.readFile(file); must(sha(bytes) === exactSha, 'RELEASE_SHA_DRIFT');
  const r = JSON.parse(bytes);
  must(r.released === true && r.budgetApproved === true && r.issuedBy === 'main' && Number.isFinite(Date.parse(r.issuedAt)), 'RELEASE_NOT_APPROVED');
  for (const key of ['sessionId', 'mode', 'profile', 'rawId', 'rawSha256', 'fixtureSha256', 'freezeSha256']) must(r[key] === (key === 'sessionId' ? s.id : s[key]), 'RELEASE_BINDING_DRIFT');
  must(r.maxCalls === 2 && JSON.stringify(r.sequences) === JSON.stringify(s.sequences), 'RELEASE_BUDGET_INVALID');
  must((await freeze()).sha256 === s.freezeSha256, 'SOURCE_FREEZE_DRIFT');
  return { releaseSha256: exactSha };
}
function fakeReply(request, profile) {
  const input = JSON.parse(request.user.split('\n').at(-1));
  // Mechanical capture only: new Q has one independent business fact and two
  // separate unknown atoms. These classifications are not a real quality oracle.
  if (!request.user.startsWith('请对下列全部已验证事实规划知识页')) return { text: JSON.stringify({ version: 2, facts: (profile === 'question' ? input.slice(0, 1) : input).map(atom => ({ atomId: atom.id, kind: 'fact' })), questions: (profile === 'question' ? input.slice(1) : []).map(atom => ({ atomId: atom.id })), sourceNotes: [] }), bytes: 1, finishReason: 'stop' };
  return { text: JSON.stringify({ version: 3, document: { title: '来源：虚构门店补货', main_topic: '补货' }, pages: [
    { title: '虚构门店补货流程', type: 'business_process', category: 'supply_chain', factUnitIds: input.factUnits.map(x => x.id), questionUnitIds: input.questionUnits.map(x => x.id) },
  ] }), bytes: 1, finishReason: 'stop' };
}
export async function run(root, releaseFile, releaseSha256, fakeFailureStage) {
  const s = await sessionAt(root); await releaseFor(s, releaseFile, releaseSha256);
  must(fakeFailureStage === undefined || (s.mode === 'fake' && ['extracting', 'question-missing-second', 'question-dual-track'].includes(fakeFailureStage)), 'FAKE_FAILURE_MODE_INVALID');
  must(!(await present(path.join(s.root, 'run-started.json'))), 'SESSION_ALREADY_STARTED');
  for (const seq of s.sequences) must(!(await present(path.join(s.root, `attempt-${seq}.json`))), 'ATTEMPT_ALREADY_RESERVED');
  const raws = new RawStore(s.root), drafts = new DraftStore(s.root), checkpoints = new ExtractionCheckpointStore(s.root);
  await Promise.all([raws.initialize(), drafts.initialize(), checkpoints.initialize()]);
  const raw = await raws.get(s.rawId), sample = await read(s.fixture), body = sample.quotes.join(sample.joinWith);
  must(raw && raw.body === body && raw.bodySha256 === s.rawSha256 && sha(body) === s.rawSha256, 'RAW_BINDING_DRIFT');
  const rawPath = path.join(s.root, 'knowledge/raw/notes', raw.id + '.md'); must(sha(await fs.readFile(rawPath)) === s.rawFileSha256, 'RAW_FILE_DRIFT');
  await durable(path.join(s.root, 'run-started.json'), { sessionId: s.id, at: new Date().toISOString(), releaseSha256 });
  let configReads = 0, sent = 0, reserved = 0, actual, secrets = [], checkpoint;
  const provider = {
    get name() { return actual?.name ?? (s.mode === 'fake' ? 'fake' : 'openai-compatible'); },
    get model() { return actual?.model ?? 'pending-config'; },
    get secrets() { return secrets; },
    async complete(request) {
      must(reserved < 2 && request.purpose === 'knowledge', 'REQUEST_LIMIT');
      const stage = request.user.startsWith('请对下列全部已验证事实规划知识页') ? 'planning' : 'extracting';
      must(stage === (reserved === 0 ? 'extracting' : 'planning'), 'REQUEST_ORDER_INVALID');
      await releaseFor(s, releaseFile, releaseSha256);
      if (s.profile === 'question' && stage === 'planning') {
        const input = JSON.parse(request.user.split('\n').at(-1));
        const targets = questionTargets(body, sample), sourceId = atom => `s-${atom.start}-${atom.end}`;
        const factObserved = input.factUnits.some(unit => unit.sourceId === sourceId(targets.fact) && unit.text === targets.fact.text);
        const questions = targets.questions.map(atom => {
          const units = input.questionUnits.filter(unit => unit.sourceId === sourceId(atom) && unit.text === atom.text);
          return { atomId: atom.id, text: atom.text, unitIds: units.map(unit => unit.id), questionOnly: units.length === 1 && !input.factUnits.some(unit => unit.sourceId === sourceId(atom)) };
        });
        const passed = factObserved && questions.every(question => question.questionOnly);
        await durable(path.join(s.root, 'question-only-gate.json'), { passed, factObserved, questions, questionOnlyUnitIds: questions.filter(question => question.questionOnly).flatMap(question => question.unitIds), factUnitIds: input.factUnits.map(unit => unit.id), questionUnitIds: input.questionUnits.map(unit => unit.id) });
        must(passed, 'QUESTION_ONLY_TARGET_NOT_OBSERVED');
      }
      const sequence = s.sequences[reserved], safeRequest = { system: request.system, user: request.user, purpose: request.purpose, structuredOutput: request.structuredOutput, timeoutMs: request.timeoutMs, maxOutputBytes: request.maxOutputBytes };
      await durable(path.join(s.root, `attempt-${sequence}.json`), { sequence, stage, sessionId: s.id, requestSha256: sha(safeRequest), releaseSha256, at: new Date().toISOString(), status: 'pending-counts-if-unknown' }); reserved++;
      let response;
      if (s.mode === 'real') {
        if (!actual) {
          configReads++;
          const { loadLlmConfig } = await import('../../services/llm/config.ts');
          const { OpenAiCompatibleProvider } = await import('../../services/llm/provider.ts');
          const config = await loadLlmConfig({ filePath: path.resolve('.env.local') }); actual = new OpenAiCompatibleProvider(config); secrets = [...actual.secrets];
        }
        assertNoKnownSecret(safeRequest, secrets);
        await durable(path.join(s.root, `request-${sequence}.json`), safeRequest);
        sent++; response = await actual.complete(request);
      } else {
        await durable(path.join(s.root, `request-${sequence}.json`), safeRequest);
        sent++;
        if (stage === fakeFailureStage) throw Object.assign(new Error('SMOKE_FIRST_FAILURE'), { code: 'SMOKE_FIRST_FAILURE' });
        response = fakeReply(request, s.profile);
        if (stage === 'extracting' && fakeFailureStage?.startsWith('question-')) {
          const value = JSON.parse(response.text);
          if (fakeFailureStage === 'question-missing-second') value.questions.pop();
          else value.facts.push({ atomId: value.questions[0].atomId, kind: 'fact' });
          response = { ...response, text: JSON.stringify(value) };
        }
      }
      // Private original is retained even if a subsequent secret scan blocks export.
      await durable(path.join(s.root, `response-${sequence}.private.json`), response);
      assertNoKnownSecret(response, secrets);
      await durable(path.join(s.root, `response-${sequence}.json`), response);
      return response;
    },
  };
  try {
    const bundle = await loadExtractionRules('rules');
    checkpoint = await checkpoints.save({ version: 1, jobId: randomUUID(), rawId: raw.id, rawSha256: raw.bodySha256, pipelineVersion: 'kb02-2', rulesVersion: bundle.rulesVersion, providerIdentity: 'r1618-quality-' + s.mode, chunks: chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 }).map(({ index, start, end }) => ({ index, start, end })), completedChunks: [], attempts: 0, stage: 'extracting', updatedAt: new Date().toISOString() });
    const { outcome } = await runKnowledgePipeline({ raw, body, bodySha256: raw.bodySha256, provider, rulesDir: path.resolve('rules'), checkpoint, beforeCall: async stage => checkpoint = await checkpoints.save({ ...checkpoint, stage, attempts: checkpoint.attempts + 1 }), saveCheckpoint: async value => checkpoint = await checkpoints.save(value) });
    const rules = { types: bundle.fmcg.types.map(x => x.id), categories: bundle.fmcg.categories.map(x => x.id), ...bundle.fmcg.enums };
    const draft = await drafts.create({ raw, body, rules, jobId: checkpoint.jobId, outcome });
    const evidence = { sessionId: s.id, mode: s.mode, raw, originalDraft: draft, preview: drafts.view(draft), outcome, checkpoint, rawUnchanged: sha(await fs.readFile(rawPath)) === s.rawFileSha256 };
    assertNoKnownSecret(evidence, secrets); must(evidence.rawUnchanged, 'RAW_CHANGED');
    await durable(path.join(s.root, 'candidate-original.json'), evidence);
    const result = { status: 'captured-awaiting-independent-quality-review', root: s.root, profile: s.profile, draftId: draft.id, reserved, sent, configReads, realCalls: s.mode === 'real' ? reserved : 0, fakeCalls: s.mode === 'fake' ? reserved : 0, knowledgeUsed: s.knowledgeBefore + (s.mode === 'real' ? reserved : 0), promptUsed: 15 };
    await durable(path.join(s.root, 'result.json'), result); return result;
  } catch (error) {
    await durable(path.join(s.root, 'result.json'), { status: 'failed-no-retry', code: error.code ?? 'LOCAL_RUN_FAILED', profile: s.profile, reserved, sent, configReads, realCalls: s.mode === 'real' ? reserved : 0, knowledgeUsed: s.knowledgeBefore + (s.mode === 'real' ? reserved : 0), promptUsed: 15 });
    throw error;
  }
}
export async function smoke() {
  const assert = (await import('node:assert/strict')).default;
  const results = [];
  for (const [profile, config] of Object.entries(PROFILES)) {
    const prepared = await prepare(profile, 'fake'), root = prepared.session.root;
    assert.equal(prepared.session.profile, profile); assert.equal(prepared.session.fixture, config.fixture);
    assert.equal(prepared.session.knowledgeBefore, config.knowledgeBefore); assert.deepEqual(prepared.session.sequences, config.sequences);
    assert.equal(prepared.session.fixtureSha256, sha(await fs.readFile(config.fixture)));
    await assert.rejects(run(root), { code: 'RELEASE_REQUIRED' });
    assert.equal(await present(path.join(root, 'run-started.json')), false);
    for (const seq of config.sequences) assert.equal(await present(path.join(root, `attempt-${seq}.json`)), false);
    const release = { ...prepared.releaseTemplate, released: true, budgetApproved: true, issuedAt: new Date().toISOString() }, file = path.join(root, 'fake-release.json');
    await durable(file, release); const hash = sha(await fs.readFile(file));
    const result = await run(root, file, hash);
    assert.equal(result.fakeCalls, 2); assert.equal(result.realCalls, 0); assert.equal(result.configReads, 0);
    assert.equal(result.knowledgeUsed, config.knowledgeBefore); assert.equal(result.promptUsed, 15);
    const original = await read(path.join(root, 'candidate-original.json'));
    assert.equal(original.originalDraft.pages.length, 1); assert.equal(original.rawUnchanged, true);
    const page = original.originalDraft.pages[0];
    assert.equal([...page.source_facts.map(f => f.text), ...page.open_questions].join(''), original.raw.body);
    assert([...page.source_facts.map(f => f.text), ...page.open_questions].every(text => original.preview.pages[0].renderedBody.includes(text)));
    if (profile === 'question') {
      const targets = await read(path.join(root, 'question-atom-targets.json')), gate = await read(path.join(root, 'question-only-gate.json'));
      assert.equal(gate.passed, true); assert.equal(gate.factObserved, true); assert.equal(gate.questionOnlyUnitIds.length, 2);
      assert.deepEqual(page.open_questions, targets.questions.map(atom => atom.text));
      assert.deepEqual(page.source_facts.map(fact => fact.text), [targets.fact.text]);
      assert(targets.questions.every(atom => original.preview.pages[0].renderedBody.includes(atom.text)));
    }
    await assert.rejects(run(root, file, hash), { code: 'SESSION_ALREADY_STARTED' });
    assert.deepEqual((await fs.readdir(root)).filter(name => /^attempt-\d+\.json$/.test(name)).sort(), config.sequences.map(seq => `attempt-${seq}.json`));
    results.push(result);
  }
  const failed = await prepare('output', 'fake'), failedRoot = failed.session.root;
  const failedRelease = { ...failed.releaseTemplate, released: true, budgetApproved: true, issuedAt: new Date().toISOString() }, failedFile = path.join(failedRoot, 'fake-release.json');
  await durable(failedFile, failedRelease);
  await assert.rejects(run(failedRoot, failedFile, sha(await fs.readFile(failedFile)), 'extracting'), { code: 'SMOKE_FIRST_FAILURE' });
  const failedResult = await read(path.join(failedRoot, 'result.json'));
  assert.equal(failedResult.reserved, 1); assert.equal(failedResult.sent, 1); assert.equal(failedResult.configReads, 0); assert.equal(failedResult.realCalls, 0);
  assert.equal(await present(path.join(failedRoot, 'attempt-256.json')), false);
  assert.equal(await present(path.join(failedRoot, 'candidate-original.json')), false);
  results.push(failedResult);
  for (const failure of ['question-missing-second', 'question-dual-track']) {
    const prepared = await prepare('question', 'fake'), root = prepared.session.root;
    const file = path.join(root, 'fake-release.json');
    await durable(file, { ...prepared.releaseTemplate, released: true, budgetApproved: true, issuedAt: new Date().toISOString() });
    await assert.rejects(run(root, file, sha(await fs.readFile(file)), failure), { code: 'QUESTION_ONLY_TARGET_NOT_OBSERVED' });
    const result = await read(path.join(root, 'result.json')), gate = await read(path.join(root, 'question-only-gate.json'));
    assert.equal(result.reserved, 1); assert.equal(result.sent, 1); assert.equal(result.configReads, 0); assert.equal(result.realCalls, 0); assert.equal(gate.passed, false);
    assert.equal(await present(path.join(root, 'attempt-258.json')), false);
    assert.equal(await present(path.join(root, 'candidate-original.json')), false);
    results.push({ ...result, root, failure });
  }
  return { pass: true, checks: ['profile-binding', 'unreleased-zero-call', 'two-request-original-draft-capture', 'used-session-rejected', 'first-failure-stops-before-second-request', 'three-independent-question-sample-atoms', 'both-complete-question-only-units', 'missing-question-and-dual-track-stop-before-planning'], fakeCalls: 7, realCalls: 0, configReads: 0, results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    let result;
    if (command === 'prepare') result = await prepare(...args);
    else if (command === 'run') result = await run(...args);
    else if (command === 'smoke') result = await smoke();
    else throw Object.assign(new Error('COMMAND_INVALID'), { code: 'COMMAND_INVALID' });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(JSON.stringify({ code: error.code ?? 'LOCAL_TOOL_FAILED', noAutomaticRetry: true })); process.exitCode = 1; }
}
