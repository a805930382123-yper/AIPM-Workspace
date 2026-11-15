import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import dns from 'node:dns';
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkText } from '../../services/llm/chunk.ts';
import { ExtractionCheckpointStore, KB02_PIPELINE_VERSION } from '../../services/llm/checkpoints.ts';
import { buildKnowledgeAtoms } from '../../services/llm/knowledge-atoms.ts';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { FROZEN_BUDGETS, loadExtractionRules } from '../../services/llm/rules.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const chain = 'standard-extract';
const caseRoot = path.join(repo, 'evals', 'cases', chain);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = text => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const canonical = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right, 'en')))
    : item,
);
const chunkOptions = {
  maxChunkChars: FROZEN_BUDGETS.maxChunkChars,
  overlap: FROZEN_BUDGETS.chunkOverlap,
  maxRawChars: FROZEN_BUDGETS.maxRawChars,
};

async function verifySeeds() {
  const sourceFile = 'docs/reports/WORK-CLOSED-20261109/materials.json';
  const materials = await readJson(path.join(repo, sourceFile));
  assert.equal(materials.synthetic, true);
  const ids = (await readdir(caseRoot)).sort();
  assert.equal(ids.length, 8);
  assert.equal(ids.filter(id => id.startsWith('basic-')).length, 6);
  assert.equal(ids.filter(id => id.startsWith('trap-')).length, 2);

  const fingerprints = {};
  const representedEvents = new Set();
  const rawIds = new Set();
  let requirements = 0;
  for (const id of ids) {
    const directory = path.join(caseRoot, id);
    const caseBytes = await readFile(path.join(directory, 'case.json'));
    const goldBytes = await readFile(path.join(directory, 'gold.json'));
    const definition = JSON.parse(caseBytes);
    const gold = JSON.parse(goldBytes);
    assert.equal(definition.id, id);
    assert.equal(definition.chain, chain);
    assert.equal(definition.license, 'synthetic');
    assert.equal(definition.input.mode, 'standard');
    assert.equal(definition.bodyNormalization, 'lf-v1');
    assert(!rawIds.has(definition.input.rawId), `reused Raw ID for ${id}`);
    rawIds.add(definition.input.rawId);
    assert.equal(definition.input.bodyFile, path.basename(definition.input.bodyFile));
    const body = (await readFile(path.join(directory, definition.input.bodyFile), 'utf8')).replace(/\r\n?/gu, '\n');
    if (id.startsWith('basic-')) {
      const [reference, eventId] = definition.source.split('#');
      assert.equal(reference, sourceFile);
      assert(!representedEvents.has(eventId), `reused source event for ${id}`);
      representedEvents.add(eventId);
      assert.equal(materials.events.find(event => event.eventId === eventId)?.body, body);
    } else {
      assert(body.includes('合成模拟材料'), `missing synthetic source marker for ${id}`);
    }
    const chunks = chunkText(body, chunkOptions);
    assert.equal(chunks.length, 1, id);
    const [chunk] = chunks;
    const atoms = buildKnowledgeAtoms(body, buildEvidenceLocatorCatalog(body, chunk)).map(atom => normalize(atom.text));
    assert(gold.requiredFacts.length >= 2, id);
    assert(gold.forbiddenAssertions.length >= 1, id);
    for (const requirement of [...gold.requiredFacts, ...gold.requiredQuestions]) {
      const meetsRequirement = requirement.variants.some(variant =>
        atoms.some(atom => variant.every(fragment => atom.includes(normalize(fragment)))),
      );
      assert(meetsRequirement, `${id}/${requirement.id} cannot match a single product atom`);
      requirements += 1;
    }
    fingerprints[id] = { case: sha256(caseBytes), body: sha256(body), gold: sha256(goldBytes) };
  }
  assert.equal(representedEvents.size, materials.events.length);
  console.log(JSON.stringify({ chain, cases: ids.length, requirements, expectedLiveRequests: 2 * ids.length, fingerprints }, null, 2));
}

function blockNetwork() {
  const reject = () => {
    process.stderr.write('EVAL01_OFFLINE_NETWORK_ATTEMPT\n');
    throw new Error('EVAL01_OFFLINE_NETWORK_ATTEMPT');
  };
  globalThis.fetch = reject;
  http.get = http.request = https.get = https.request = reject;
  dns.lookup = dns.resolve = dns.promises.lookup = dns.promises.resolve = reject;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (typeof options === 'number' || options?.port !== undefined) return reject();
    return connect.apply(this, args);
  };
  syncBuiltinESMExports();
}

async function runOfflineAudit(originalResultFile) {
  const evidence = path.join(repo, '.scratch-eval01-evidence');
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(path.join(evidence, 'independent-'));
  await cp(path.join(repo, 'scripts', 'eval'), path.join(scratch, 'scripts', 'eval'), { recursive: true });
  await cp(path.join(repo, 'evals'), path.join(scratch, 'evals'), {
    recursive: true,
    filter: source => !['local', 'results'].includes(path.relative(path.join(repo, 'evals'), source).split(path.sep)[0]),
  });
  await symlink(path.join(repo, 'services'), path.join(scratch, 'services'), 'junction');
  await symlink(path.join(repo, 'rules'), path.join(scratch, 'rules'), 'junction');
  const results = path.join(scratch, 'evals', 'results');
  await mkdir(results);
  const env = { ...process.env, FMCG_LLM_CONFIG_FILE: path.join(scratch, 'evals') };
  delete env.FMCG_LLM_BASE_URL;
  delete env.FMCG_LLM_MODEL;
  delete env.FMCG_LLM_API_KEY;
  delete env.EVAL01_REVIEW_GUARD;

  async function cli(args, status, fakeConfig) {
    const before = new Set(await readdir(results));
    const argv = ['--import', 'tsx'];
    if (!fakeConfig) argv.push('--import', import.meta.url);
    argv.push('scripts/eval/run.mjs', '--chain', chain, ...args);
    const child = spawn(process.execPath, argv, {
      cwd: scratch,
      env: fakeConfig ? { ...env, ...fakeConfig } : { ...env, EVAL01_REVIEW_GUARD: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, status, `${argv.slice(-8).join(' ')}\n${stdout}\n${stderr}`);
    assert(!stderr.includes('EVAL01_OFFLINE_NETWORK_ATTEMPT'), 'replay attempted outbound network');
    const created = (await readdir(results)).filter(file => file.endsWith(`-${chain}.json`) && !before.has(file));
    const outputs = await Promise.all(created.map(async name => {
      const file = path.join(results, name);
      return { file, result: await readJson(file) };
    }));
    const matching = args.includes('--resume-from') ? outputs.filter(output => output.result.mode === 'mixed') : outputs;
    assert(matching.length <= 1, 'multiple final result JSON files written by one CLI command');
    return { ...matching[0], stdout, stderr };
  }

  const replay = await cli(['--recording', 'synthetic-v1'], 0);
  assert.equal(replay.result.mode, 'replay');
  assert.equal(replay.result.cases.length, 8);
  assert(replay.result.cases.every(row => row.status === 'PASS'));
  assert.deepEqual(replay.result.ledger, []);
  await cli(['--record', '--recording', 'synthetic-v1'], 1);
  const comparison = await cli(['--recording', 'synthetic-v1', '--baseline', replay.file], 0);
  const measures = comparison.result.baseline.measures;
  assert.equal(Object.keys(measures).length, 8);
  for (const { before, after, delta } of Object.values(measures)) {
    assert.equal(after, before);
    assert.equal(delta, before === null ? null : 0);
  }
  await cli(['--case', 'trap-01-forecast', '--recording', 'synthetic-v1', '--baseline', replay.file], 1);
  const badBaseline = structuredClone(replay.result);
  delete badBaseline.summary.measures.evidence;
  badBaseline.summary.measures.unexpected = 1;
  const badBaselineFile = path.join(scratch, 'bad-baseline.json');
  await writeJson(badBaselineFile, badBaseline);
  await cli(['--recording', 'synthetic-v1', '--baseline', badBaselineFile], 1);

  const trap = 'trap-01-forecast';
  const trapBaseline = await cli(['--case', trap, '--recording', 'synthetic-v1'], 0);
  const trapDir = path.join(caseRoot, trap);
  const definition = await readJson(path.join(trapDir, 'case.json'));
  const gold = await readJson(path.join(trapDir, 'gold.json'));
  const recording = await readJson(path.join(trapDir, 'recordings', 'synthetic-v1.json'));
  const body = (await readFile(path.join(trapDir, 'body.txt'), 'utf8')).replace(/\r\n?/gu, '\n');
  const scoring = await import('../../scripts/eval/score.mjs');
  const rulesDir = path.join(repo, 'rules');
  const ruleBundle = await loadExtractionRules(rulesDir);
  const { rawId, title, sourceType, sourceName, tags } = definition.input;
  const raw = { id: rawId, title, sourceType, sourceName, tags };
  const store = new ExtractionCheckpointStore(scratch);

  async function direct(complete) {
    const chunks = chunkText(body, chunkOptions).map(({ index, start, end }) => ({ index, start, end }));
    const bodySha256 = sha256(body);
    let checkpoint = store.prepare({
      version: 1, jobId: randomUUID(), rawId, rawSha256: bodySha256, pipelineVersion: KB02_PIPELINE_VERSION,
      rulesVersion: ruleBundle.rulesVersion, providerIdentity: 'review', chunks, completedChunks: [], attempts: 0, stage: 'extracting',
    });
    const saveCheckpoint = async value => { checkpoint = store.prepare(value); return checkpoint; };
    return runKnowledgePipeline({
      raw, body, bodySha256, provider: { ...recording.provider, complete }, rulesDir, checkpoint, saveCheckpoint,
      beforePlanning: current => saveCheckpoint({ ...current, maintenance: { version: 1, context: [] } }),
      beforeCall: stage => saveCheckpoint({ ...checkpoint, stage, attempts: checkpoint.attempts + 1 }),
    });
  }

  const malformed = { text: '{', bytes: 1, finishReason: 'stop' };
  let attempts = 0;
  await assert.rejects(direct(async () => { attempts++; return malformed; }), { code: 'LLM_INVALID_JSON' });
  assert.equal(attempts, 1);
  const badRecording = structuredClone(recording);
  badRecording.calls[0].completion = malformed;
  const scratchRecordings = path.join(scratch, 'evals', 'cases', chain, trap, 'recordings');
  await writeJson(path.join(scratchRecordings, 'review-malformed.json'), badRecording);
  const invalid = await cli(['--case', trap, '--recording', 'review-malformed'], 1);
  assert.equal(invalid.result.cases[0].error.code, 'LLM_INVALID_JSON');

  const refError = structuredClone(recording);
  const refWire = JSON.parse(refError.calls[0].completion.text);
  refWire.facts[0].atomId = 'c1-a9999';
  refError.calls[0].completion.text = JSON.stringify(refWire);
  refError.calls[0].completion.bytes = Buffer.byteLength(refError.calls[0].completion.text);
  await assert.rejects(direct(async () => refError.calls[0].completion), { code: 'LLM_EVIDENCE_UNKNOWN_LOCATOR' });
  await writeJson(path.join(scratchRecordings, 'review-unknown-locator.json'), refError);
  const missingLocator = await cli(['--case', trap, '--recording', 'review-unknown-locator'], 1);
  assert.equal(missingLocator.result.cases[0].error.code, 'LLM_EVIDENCE_UNKNOWN_LOCATOR');

  let consumed = 0;
  const { outcome } = await direct(async () => recording.calls[consumed++].completion);
  assert.equal(consumed, 2);
  const score = value => scoring.score(value, body, rawId, gold);
  const unmodified = score(outcome);
  assert.equal(unmodified.facts.passed, 3);
  assert.equal(unmodified.questions.passed, 1);
  assert.equal(unmodified.forbidden.length, 0);
  assert.equal(unmodified.partition.length, 0);
  assert.equal(unmodified.evidence.total, unmodified.evidence.passed);
  assert.equal(unmodified.duplicates.count, 0);
  assert.equal(unmodified.emptyTopics, 0);
  assert(unmodified.validFields.pass);

  if (originalResultFile) {
    const localNegationGold = structuredClone(gold);
    localNegationGold.forbiddenAssertions = [{
      id: 'warehouse-scope', variants: [['所有仓库', '超载']], scope: ['document'], exclude: ['不证明所有仓库超载'],
    }];
    for (const [text, expected] of [
      ['仅抽查一个批次，不证明所有仓库超载。', 0],
      ['检查了一个仓库，不能据此证明所有仓库都会超载。', 0],
      ['所有仓库都会超载。', 1],
      ['不能证明所有仓库都会超载，然而所有仓库超载。', 1],
      ['确认所有仓库都会超载；不能证明所有仓库超载。', 1],
      ['不能证明某个仓库超载\n所有仓库都会超载。', 1],
    ]) {
      const candidate = { ...outcome, document: { ...outcome.document, title: text } };
      assert.equal(scoring.score(candidate, body, rawId, localNegationGold).forbidden.length, expected, text);
    }
    const offsetText = '📦确认所有仓库都会超载。';
    const offsetCandidate = { ...outcome, document: { ...outcome.document, title: offsetText } };
    const offsetHit = scoring.score(offsetCandidate, body, rawId, localNegationGold).forbidden[0];
    assert.equal(offsetText.slice(offsetHit.spans[0].start, offsetHit.spans[0].end), '所有仓库都会超载');
  }

  const evidenceEdit = structuredClone(outcome);
  const quote = evidenceEdit.pages[0].source_evidence[0];
  quote.quote = '误' + quote.quote.slice(1);
  assert.equal(score(evidenceEdit).evidence.passed, unmodified.evidence.passed - 1);
  const positionEdit = structuredClone(outcome);
  const lastQuote = positionEdit.pages[0].source_evidence.at(-1);
  lastQuote.quote = body.slice(lastQuote.start);
  lastQuote.end = body.length + 1;
  assert.equal(score(positionEdit).evidence.passed, unmodified.evidence.passed - 1);
  const duplicate = structuredClone(outcome);
  duplicate.pages[0].source_facts.push(structuredClone(duplicate.pages[0].source_facts[0]));
  assert.equal(score(duplicate).duplicates.count, 1);
  const empty = structuredClone(outcome);
  empty.pages[0].source_facts = [];
  assert.equal(score(empty).emptyTopics, 1);
  const wrongPartition = structuredClone(outcome);
  const misplaced = wrongPartition.pages[0].open_questions.pop();
  wrongPartition.pages[0].source_facts.push({ ...wrongPartition.pages[0].source_facts[0], text: misplaced });
  assert.equal(score(wrongPartition).partition.filter(hit => hit.id === 'p2').length, 1);
  assert.equal(score(wrongPartition).questions.passed, 0);

  const fieldEdit = structuredClone(outcome);
  fieldEdit.document.source_level = '';
  fieldEdit.pages[0].source_facts[0].evidenceIds = ['missing-location'];
  const fields = score(fieldEdit).validFields;
  assert.equal(fields.pass, false);
  assert(fields.invalidFields.includes('document.source_level'));
  assert(fields.unresolvedReferences.some(ref => ref.includes('missing-location')));

  const alteredRecording = structuredClone(recording);
  let cursor = 0;
  await direct(async request => {
    const call = alteredRecording.calls[cursor++];
    const { system, user, purpose, structuredOutput } = request;
    call.requestHash = sha256(canonical({ system, user, purpose, structuredOutput }));
    call.requestSummary = { systemSha256: sha256(system), userSha256: sha256(user), purpose, structuredOutput: Boolean(structuredOutput) };
    const wire = JSON.parse(call.completion.text);
    if (call.stage === 'extracting') wire.facts.shift();
    if (call.stage === 'planning') {
      const requestBody = JSON.parse(user.slice(user.lastIndexOf('\n') + 1));
      wire.pages[0].factUnitIds = requestBody.factUnits.map(unit => unit.id);
    }
    call.completion.text = JSON.stringify(wire);
    call.completion.bytes = Buffer.byteLength(call.completion.text);
    return call.completion;
  });
  await writeJson(path.join(scratchRecordings, 'review-missing-fact.json'), alteredRecording);
  const missingFact = await cli(['--case', trap, '--recording', 'review-missing-fact', '--baseline', trapBaseline.file], 1);
  const missingFactRow = missingFact.result.cases[0];
  assert(!missingFactRow.error, 'the mutated response should still assemble with valid planning coverage');
  assert.equal(missingFactRow.metrics.facts.passed, 2);
  assert.equal(missingFactRow.metrics.facts.total, 3);
  assert.equal(missingFact.result.baseline.measures.factRecall.delta, 2 / 3 - 1);

  const fabricatedRecording = structuredClone(recording);
  const plan = JSON.parse(fabricatedRecording.calls[1].completion.text);
  const page = plan.pages[0];
  page.type = 'concept';
  page.category = 'ai_application';
  page.templateFields = { definition: { text: '虚构渠道已售120箱。', factUnitIds: [page.factUnitIds[0]] } };
  fabricatedRecording.calls[1].completion.text = JSON.stringify(plan);
  fabricatedRecording.calls[1].completion.bytes = Buffer.byteLength(fabricatedRecording.calls[1].completion.text);
  await writeJson(path.join(scratchRecordings, 'review-fabricated-number.json'), fabricatedRecording);
  const fabricatedNumber = await cli(['--case', trap, '--recording', 'review-fabricated-number'], 1);
  const fabricatedNumberRow = fabricatedNumber.result.cases[0];
  assert(!fabricatedNumberRow.error, 'only deterministic scoring should reject the legal model response');
  assert(fabricatedNumberRow.metrics.forbidden.some(hit => hit.id === 'b1' && hit.path.includes('templateFields.definition.aiContent')));
  assert(fabricatedNumberRow.metrics.partition.some(hit => hit.id === 'p1'));

  const beforeFake = new Set(await readdir(results));
  const firstCase = 'basic-01-timeout';
  const firstFixture = await readJson(path.join(caseRoot, firstCase, 'recordings', 'synthetic-v1.json'));
  let localRequests = 0;
  let mockError;
  const mock = http.createServer(async (request, response) => {
    try {
      localRequests++;
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      for await (const chunk of request) assert(chunk.length > 0);
      const journals = (await readdir(results)).filter(file => file.endsWith('.json') && !beforeFake.has(file));
      assert.equal(journals.length, 1);
      const journal = await readJson(path.join(results, journals[0]));
      assert.equal(journal.ledger.length, localRequests);
      assert.equal(journal.ledger.at(-1).status, 'attempted');
      assert.equal(journal.ledger.at(-1).caseId, firstCase);
      assert(localRequests <= 2, 'unexpected retry or following case');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        choices: [{ message: { content: firstFixture.calls[localRequests - 1].completion.text }, finish_reason: localRequests === 1 ? 'stop' : 'length' }],
        usage: localRequests === 1 ? { prompt_tokens: 19, completion_tokens: 5 } : { completion_tokens: 7 },
      }));
    } catch (error) {
      mockError = error;
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', resolve);
  });
  let failedLive;
  try {
    failedLive = await cli(['--mode', 'live', '--record', '--recording', 'review-fail-stop'], 1, {
      FMCG_LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`,
      FMCG_LLM_MODEL: 'eval01-fake', FMCG_LLM_API_KEY: 'synthetic-acceptance-value', NO_PROXY: '127.0.0.1,localhost',
    });
  } finally {
    await new Promise((resolve, reject) => mock.close(error => error ? reject(error) : resolve()));
  }
  assert.ifError(mockError);
  assert.equal(localRequests, 2);
  assert.match(failedLive.stdout, /16/u);
  assert.equal(failedLive.result.cases[0].error.code, 'LLM_OUTPUT_TRUNCATED');
  assert(failedLive.result.cases.slice(1).every(row => row.status === 'NOT_RUN'));
  assert.deepEqual(failedLive.result.ledger.map(entry => ({ status: entry.status, usage: entry.usage, unknownUsage: entry.unknownUsage })), [
    { status: 'success', usage: { promptTokens: 19, completionTokens: 5 }, unknownUsage: false },
    { status: 'failed', usage: { completionTokens: 7 }, unknownUsage: true },
  ]);

  let continued;
  if (originalResultFile) {
    const originalBytes = await readFile(originalResultFile);
    const original = JSON.parse(originalBytes);
    const sourceSha = sha256(originalBytes);
    assert.equal(sourceSha, 'ca9a118ee1f7bba97facaf49c186675537e8ad5612a6d2398b8d33ecd3387b61');
    const resumeFrom = ['--resume-from', path.resolve(originalResultFile), '--resume-sha256', sourceSha];
    const recordingArgs = ['--record', '--recording', 'live-20261115-baseline'];
    await cli([...resumeFrom, '--recording', 'live-20261115-baseline'], 1);
    await cli(['--mode', 'live', ...resumeFrom], 1);
    await cli(['--mode', 'live', ...recordingArgs, '--case', 'basic-05-reconcile', ...resumeFrom], 1);
    await cli(['--mode', 'live', ...recordingArgs, ...resumeFrom.slice(0, -1), '0'.repeat(64)], 1);

    const prefix = original.cases.slice(0, 4);
    for (const row of prefix) {
      const check = await cli(['--case', row.id, '--recording', 'live-20261115-baseline'], 0);
      const updated = check.result.cases[0];
      assert.equal(check.result.scoringSchemaVersion, 2);
      assert.equal(updated.recordingHash, row.recordingHash);
      for (const measure of ['validFields', 'evidence', 'facts', 'questions', 'partition', 'duplicates', 'emptyTopics']) {
        assert.deepEqual(updated.metrics[measure], row.metrics[measure], `${row.id} changed ${measure}`);
      }
      assert.deepEqual(updated.metrics.forbidden, []);
    }

    const remaining = original.cases.slice(4).map(row => row.id);
    const fixtures = await Promise.all(remaining.map(id => readJson(path.join(caseRoot, id, 'recordings', 'synthetic-v1.json'))));
    let remainingRequests = 0;
    let resumeError;
    const resumedMock = http.createServer(async (request, response) => {
      try {
        assert.equal(request.url, '/v1/chat/completions');
        const nextCase = Math.floor(remainingRequests / 2);
        const nextStage = remainingRequests % 2;
        const requestParts = [];
        for await (const chunk of request) requestParts.push(chunk);
        const call = JSON.parse(Buffer.concat(requestParts));
        if (nextStage === 0) {
          const current = await readJson(path.join(caseRoot, remaining[nextCase], 'case.json'));
          assert(call.messages[1].content.includes(current.input.rawId), 'a free replay case reached the Provider or order changed');
        }
        remainingRequests++;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          choices: [{ message: { content: fixtures[nextCase].calls[nextStage].completion.text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 5 },
        }));
      } catch (error) {
        resumeError = error;
        response.writeHead(500).end();
      }
    });
    await new Promise((resolve, reject) => {
      resumedMock.once('error', reject);
      resumedMock.listen(0, '127.0.0.1', resolve);
    });
    const fakeConfig = {
      FMCG_LLM_BASE_URL: `http://127.0.0.1:${resumedMock.address().port}/v1`,
      FMCG_LLM_MODEL: prefix[0].provider.model,
      FMCG_LLM_API_KEY: 'synthetic-acceptance-value',
      NO_PROXY: '127.0.0.1,localhost',
    };
    try {
      const args = ['--mode', 'live', ...recordingArgs, ...resumeFrom];
      continued = await cli(args, 0, fakeConfig);
      await cli(args, 1, fakeConfig);
    } finally {
      await new Promise((resolve, reject) => resumedMock.close(error => error ? reject(error) : resolve()));
    }
    assert.ifError(resumeError);
    assert.equal(remainingRequests, 8);
    assert.equal(continued.result.mode, 'mixed');
    assert.equal(continued.result.scoringSchemaVersion, 2);
    assert.equal(continued.result.sourceRunId, original.runId);
    assert.equal(continued.result.sourceResultSha, sourceSha);
    assert.equal(continued.result.sourceLedgerSha, sha256(canonical(original.ledger)));
    assert.equal(continued.result.replayCalls, 8);
    assert.deepEqual(continued.result.sourceUsage, { requests: 8, promptTokens: 33295, completionTokens: 3865, unknownRequests: 0 });
    assert.deepEqual(continued.result.summary.usage, { sourceRequests: 8, newRequests: 8, totalRequests: 16, promptTokens: 33383, completionTokens: 3905, unknownRequests: 0 });
    assert.equal(continued.result.ledger.length, 8);
    assert.deepEqual(continued.result.ledger.map(entry => entry.caseId), remaining.flatMap(id => [id, id]));
    assert.deepEqual(continued.result.cases.map(row => row.executionMode), ['replay', 'replay', 'replay', 'replay', 'live', 'live', 'live', 'live']);
    assert.equal(sha256(await readFile(originalResultFile)), sourceSha);
  }

  console.log(JSON.stringify({
    scratch, replay: replay.file, comparison: comparison.file, malformed: invalid.file, unknownLocator: missingLocator.file,
    missingFact: missingFact.file, fabricatedNumber: fabricatedNumber.file, fakeFailStop: failedLive.file, localRequests,
    fakeAuthorizedResume: continued?.file,
  }));
}

if (process.env.EVAL01_REVIEW_GUARD === '1') blockNetwork();
else if (process.argv.at(2) === '--offline') await runOfflineAudit(process.argv.at(3));
else await verifySeeds();
