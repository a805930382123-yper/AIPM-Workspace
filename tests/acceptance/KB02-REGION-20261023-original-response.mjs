// Offline diagnosis only: original Provider response is returned by an in-memory fake.
// No product changes, network, persistent checkpoint writes, or historical report writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chunkText } from '../../services/llm/chunk.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { buildKnowledgePlanningInput, expandKnowledgePlan, projectKnowledgePlan } from '../../services/llm/knowledge-planning.ts';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { coverageDiagnostic, hasCoverageErrors } from '../../services/llm/knowledge-atoms.ts';
import { validateSchema } from '../../services/llm/schema-validator.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';

const old = 'docs/reports/KB02-FIELDS-AUDIT-20261022-';
const prefix = 'docs/reports/KB02-REGION-20261023-';
const own = 'KB02-REGION-20261023';
const started = Date.now();
const sha = value => createHash('sha256').update(value).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (name, value) => fs.writeFile(prefix + name + '.json', JSON.stringify(value, null, 2) + '\n');
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('Offline diagnostic forbids network'); };
async function snapshot() {
  const result = {};
  async function walk(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      const file = path.join(folder, item.name);
      if (item.name.startsWith(own)) continue;
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) result[file.replaceAll('\\', '/')] = sha(await fs.readFile(file));
    }
  }
  for (const folder of ['services', 'app', 'server', 'rules', 'tests', 'docs/reports', 'workspace', 'config']) await walk(folder);
  return result;
}
const before = await snapshot();
const headPointer = (await fs.readFile('.git/HEAD', 'utf8')).trim();
const head = headPointer.startsWith('ref: ') ? (await fs.readFile(path.join('.git', headPointer.slice(5)), 'utf8')).trim() : headPointer;
await write('baseline', { head, node: process.version, protectedFiles: before, excludedMainAgentOwnedFiles: ['AGENTS.md', 'docs/status.md', 'docs/agent-control.md', 'docs/coordination.md', 'docs/github-sync.md'] });
const traces = (await fs.readFile(old + 'provider-trace.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
const trace = traces.find(item => item.sequence === 180);
assert(trace);
const originalCheckpoint = await read(old + 'long-checkpoint.json');
const artifacts = (await read(old + 'real-http-LONG.json')).artifacts;
const browser = await read(old + 'browser-long-observed.json');
const quality = await read(old + 'quality.json');
const wireInput = JSON.parse(trace.request.messages.find(item => item.role === 'user').content.split('\n').at(-1));
const wirePlan = JSON.parse(trace.response.content);
// Reconstruct the exact fictional fixture from the historical source generator.
// Region labels and 7600-char boundaries are test oracles, never runtime rules.
let body = '';
const fixtureRegions = [];
for (let n = 1; n <= 14; n++) {
  const region = '虚构区域' + String(n).padStart(2, '0');
  const header = `【长文验收附录${n}，虚构】\n`;
  const business = `${region}2026年9月有100家目标门店，${n + 10}家在售，门店数铺货率${n + 10}%。此区域与其它附录区域独立，不能混用。异常审批负责人未知，AI仅未来分析建议。`;
  let block = header + business + '\n', line = 0;
  while (block.length < 7600) block += `附录${n}排版说明${++line}：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客户身份、AI上线事实或收益。\n`;
  fixtureRegions.push({ region, start: body.length, end: body.length + 7600, businessStart: body.length + header.length, business });
  body += block.slice(0, 7600);
}
assert.equal(body.length, 106400);
assert.equal(sha(body), artifacts.longRaw.sha256);
assert.equal(sha(body), originalCheckpoint.rawSha256);
const chunks = chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 });
const catalogs = new Map(chunks.map(chunk => [chunk.index, buildEvidenceLocatorCatalog(body, chunk)]));
const rebuilt = buildKnowledgePlanningInput(body, originalCheckpoint.completedChunks, catalogs);
assert.deepEqual(rebuilt, wireInput);
for (const source of rebuilt.sourceContexts) assert.equal(source.text, body.slice(source.contextStart, source.contextEnd));
const bundle = await loadExtractionRules('rules');
assert.match(originalCheckpoint.rulesVersion, /kb02-atoms-planning-10-/u, 'historical checkpoint fingerprint remains unchanged');
assert.deepEqual(validateSchema(wirePlan, bundle.kb02PlanningSchema), []);
const expansion = expandKnowledgePlan(wirePlan, wireInput);
assert.deepEqual(expansion, originalCheckpoint.plan.pages);
assert.deepEqual(projectKnowledgePlan(originalCheckpoint.plan, wireInput), wirePlan);
assert(!hasCoverageErrors(coverageDiagnostic(wireInput.factUnits.map(u => u.id), wireInput.questionUnits.map(u => u.id), wirePlan.pages.map(p => ({ title: p.title, factIds: p.factUnitIds, questionIds: p.questionUnitIds })))));
const allUnits = [...wireInput.factUnits.map(unit => ({ column: 'fact', ...unit })), ...wireInput.questionUnits.map(unit => ({ column: 'question', ...unit }))];
const genericPage = wirePlan.pages.find(page => page.title === '异常审批负责人未知与AI仅未来分析建议（待确认）');
assert(genericPage);
const rows = fixtureRegions.map(region => {
  const sources = wireInput.sourceContexts.filter(source => source.start >= region.start && source.end <= region.end);
  const selected = allUnits.filter(unit => sources.some(source => source.id === unit.sourceId));
  const boundary = selected.filter(unit => unit.text === '异常审批负责人未知，AI仅未来分析建议。');
  const source = sources.find(source => boundary.some(unit => unit.sourceId === source.id));
  assert(source);
  const containing = body.slice(source.contextStart, source.contextEnd);
  assert(containing.includes(region.business));
  const owners = unit => wirePlan.pages.filter(page => (unit.column === 'fact' ? page.factUnitIds : page.questionUnitIds).includes(unit.id)).map(page => page.title);
  for (const unit of boundary) assert.deepEqual(owners(unit), [genericPage.title]);
  const factualPage = wirePlan.pages.find(page => page.factUnitIds.some(id => selected.find(unit => unit.id === id)?.text.startsWith(region.region)));
  assert(factualPage);
  return { ...region, sourceId: source.id, sourceRange: [source.start, source.end], contextRange: [source.contextStart, source.contextEnd], contextBusinessExact: containing.includes(region.business), contextSubjectLabels: [...new Set(containing.match(/虚构区域\d{2}/gu))], contextText: containing, factualPage: factualPage.title, boundaryUnits: boundary.map(unit => ({ ...unit, owners: owners(unit) })), facts: boundary.filter(unit => unit.column === 'fact').flatMap(unit => unit.memberIds), questions: boundary.filter(unit => unit.column === 'question').flatMap(unit => unit.memberIds) };
});
assert.equal(rows.reduce((n, row) => n + row.facts.length, 0), 25);
assert.equal(rows.reduce((n, row) => n + row.questions.length, 0), 21);
assert.equal(allUnits.length, 55);
assert.equal(allUnits.reduce((n, unit) => n + unit.memberIds.length, 0), 100);
assert.equal(rows.reduce((n, row) => n + row.boundaryUnits.length, 0), 27);
await write('source-matrix', { sequence: 180, inputMatchesActualCode: true, historicalCheckpointFingerprint: originalCheckpoint.rulesVersion, inMemoryReplayWillUseCurrentRulesVersion: bundle.rulesVersion, sourceContexts: rebuilt.sourceContexts.length, factUnits: wireInput.factUnits.length, questionUnits: wireInput.questionUnits.length, rows });

async function replay(response, label) {
  let cp = structuredClone(originalCheckpoint), calls = 0, writes = 0;
  // Reuse old extracted chunks only in memory; do not rewrite the historical checkpoint or its fingerprint.
  cp.rulesVersion = bundle.rulesVersion;
  delete cp.plan; delete cp.lastError;
  cp.attempts = cp.completedChunks.length;
  cp.stage = 'planning';
  const chunksBefore = structuredClone(cp.completedChunks);
  const provider = { name: 'offline-original-response', model: 'frozen-seq180', secrets: [], complete: async request => {
    calls++;
    assert(request.system.includes('先逐个unit'));
    assert(request.system.includes('模型应在本次规划响应中调整unit归属'));
    assert(request.system.includes('不同主体即使边界句字面相同'));
    assert.deepEqual(JSON.parse(request.user.split('\n').at(-1)), wireInput);
    return { text: JSON.stringify(response), bytes: Buffer.byteLength(JSON.stringify(response)), finishReason: 'stop' };
  } };
  const raw = { id: cp.rawId, title: 'KB02十四区域中文长文虚构验收', sourceType: 'report', sourceName: '隔离虚构', tags: [], body };
  const result = await runKnowledgePipeline({ raw, body, bodySha256: sha(body), provider, rulesDir: 'rules', checkpoint: cp,
    beforeCall: async stage => cp = { ...cp, stage, attempts: cp.attempts + 1 },
    saveCheckpoint: async value => { writes++; return cp = value; },
  });
  assert.equal(calls, 1);
  assert.equal(cp.attempts, 15);
  assert.deepEqual(cp.completedChunks, chunksBefore);
  return { label, result, calls, writes, inMemoryOnly: true };
}
const replayOriginal = await replay(wirePlan, 'original-response-verbatim');
assert.deepEqual(replayOriginal.result.checkpoint.plan.pages, originalCheckpoint.plan.pages);
const originalDraft = artifacts.longDraft;
const normalizeEvidence = page => ({ ...page, source_evidence: page.source_evidence.map(({ occurrences, ...evidence }) => evidence) });
const selectedStoredFields = originalDraft.pages.map(({ pageId, ...page }) => {
  // Stored draft pages have editor metadata; compare the emitted fields only.
  const emitted = replayOriginal.result.outcome.pages[originalDraft.pages.findIndex(item => item.pageId === pageId)];
  return Object.fromEntries(Object.keys(emitted).map(key => [key, page[key]]));
});
assert.deepEqual(replayOriginal.result.outcome.pages.map(normalizeEvidence), selectedStoredFields.map(normalizeEvidence));
const browserGeneric = browser.cards.find(card => card.fields.some(field => field.value === genericPage.title));
assert(browserGeneric);
assert.equal(browserGeneric.fields.find(field => field.tag === 'SELECT').value, 'concept');
const browserTextareas = browserGeneric.fields.filter(field => field.tag === 'TEXTAREA').map(field => field.value);
assert.equal(browserTextareas.length, 25 + 21);
assert(browserTextareas.every(text => text === '异常审批负责人未知，AI仅未来分析建议。'));
assert(!browserTextareas.some(text => /虚构区域\d{2}/u.test(text)));
assert(browserGeneric.text.includes('待确认问题'));
const originalGeneric = replayOriginal.result.outcome.pages.find(page => page.title === genericPage.title);
assert.equal(originalGeneric.open_questions.length, 21);
assert(quality.issues.some(issue => issue.kind === 'region-attribution' && issue.title === genericPage.title));
// A positive representability control, supplied to the fake by this fixture only.
// This is NOT a runtime repair/semantic classifier, nor evidence that a model will choose it.
const controlPlan = structuredClone(wirePlan);
const controlGeneric = controlPlan.pages.find(page => page.title === genericPage.title);
for (const row of rows) {
  const page = controlPlan.pages.find(page => page.title === row.factualPage);
  for (const unit of row.boundaryUnits) (unit.column === 'fact' ? page.factUnitIds : page.questionUnitIds).push(unit.id);
}
controlPlan.pages = controlPlan.pages.filter(page => page !== controlGeneric);
const replayControl = await replay(controlPlan, 'fixture-only-subject-preserving-representability-control');
assert.equal(replayControl.result.outcome.pages.reduce((n, page) => n + page.source_facts.length, 0), wireInput.facts.length);
assert.equal(replayControl.result.outcome.pages.reduce((n, page) => n + page.open_questions.length, 0), wireInput.questions.length);
for (const row of rows) {
  const owner = replayControl.result.checkpoint.plan.pages.find(page => page.title === row.factualPage);
  assert(row.facts.every(id => owner.factIds.includes(id)));
  assert(row.questions.every(id => owner.questionIds.includes(id)));
}
const after = await snapshot();
assert.deepEqual(after, before);
assert.equal(networkAttempts, 0);
await write('replay', {
  at: new Date().toISOString(), head, productCommit: 'a836270f53f0fc5bb802695e3f4101cf182ee3b9', node: process.version, elapsedMs: Date.now() - started,
  sourceHashes: Object.fromEntries(await Promise.all(['provider-trace.jsonl', 'long-checkpoint.json', 'real-http-LONG.json', 'quality.json', 'browser-long-observed.json'].map(async name => [old + name, sha(await fs.readFile(old + name))]))),
  rawSha256: sha(body), inputBytes: Buffer.byteLength(JSON.stringify(wireInput)), actualInputMatchesRebuilt: true, currentSystemContainsAttributionSteps: true, historicalPromptNotReused: true, oldExtractedChunksReusedInMemoryWithCurrentRulesRevision: true,
  mechanical: { units: allUnits.length, originalIds: allUnits.reduce((n, u) => n + u.memberIds.length, 0), sourceContexts: rebuilt.sourceContexts.length, originalPlanExpansionUnchanged: true, split: 0, schemaPass: true, coveragePass: true },
  contexts: { boundarySubjects: rows.length, withExactSubjectDateMetricAndIndependenceText: rows.filter(row => row.contextBusinessExact).length, boundaryUnits: rows.reduce((n, row) => n + row.boundaryUnits.length, 0), facts: rows.reduce((n, row) => n + row.facts.length, 0), questions: rows.reduce((n, row) => n + row.questions.length, 0) },
  originalResponseReplay: { fakeCalls: replayOriginal.calls, checkpointWritesInMemory: replayOriginal.writes, acceptedByPipeline: true, pages: replayOriginal.result.outcome.pages.length, assembledFieldsMatchStoredDraft: true, comparisonNormalization: 'evidence.occurrences emitted as 1 but absent from stored draft; editor metadata excluded', genericPage: { title: genericPage.title, factCount: originalGeneric.source_facts.length, questionCount: originalGeneric.open_questions.length }, semanticRegionalQualityPass: false },
  positiveControl: { fakeCalls: replayControl.calls, acceptedByPipeline: true, unchangedUnitsAndOriginalIds: true, subjectAssociationsPreservedByFixture: true, modelQualityProof: false },
  browserEvidence: { historicalOnly: true, cardIndex: browserGeneric.index, factAndQuestionTextareas: browserTextareas.length, fieldSubjectsPresent: false, currentBrowserStarted: false },
  scope: { productsModified: false, defaultTestsModified: false, realCalls: 0, networkAttempts, kb02Cumulative: 183, kb02Cap: 500, currentStageCap: 24, promptCumulative: 15, promptCap: 24, defectFixed: false, kb02Passed: false },
  integrity: { protectedFiles: Object.keys(before).length, changed: [], historicalReportsUnchanged: true, workspaceAndConfigUnchanged: true },
});
console.log(JSON.stringify({ head, inputBytes: Buffer.byteLength(JSON.stringify(wireInput)), subjectsWithFullContext: rows.length, units: allUnits.length, ids: 100, boundaryUnits: 27, boundaryFacts: 25, boundaryQuestions: 21, originalResponseAccepted: true, semanticQuality: 'FAIL remains', positiveRepresentabilityControl: 'PASS (fake only)', networkAttempts, protectedFiles: Object.keys(before).length, elapsedMs: Date.now() - started }));
