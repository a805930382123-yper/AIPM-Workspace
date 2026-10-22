import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExtractionCheckpointStore, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { chunkText } from '../services/llm/chunk.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { LlmError, type LlmCompletionRequest, type LlmProvider } from '../services/llm/provider.ts';
import { FROZEN_BUDGETS, KB02_PROMPT_REVISION, loadExtractionRules } from '../services/llm/rules.ts';
import { validateSchema } from '../services/llm/schema-validator.ts';

const schemaLabel = '完整输出契约与服务端严格校验使用同一JSON Schema：';
const text = '在售20家。旧资料20家未注明维度。负责人未知。虚构验收免责声明。排版说明仅供阅读。';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
type Atom = { id: string; text: string };
const atomsOf = (r: LlmCompletionRequest): Atom[] => JSON.parse(r.user.split('\n').at(-1)!);
const legal = (r: LlmCompletionRequest) => {
  const a = atomsOf(r);
  return { version: 2, facts: [{ atomId: a[0].id, kind: 'fact' }, { atomId: a[1].id, kind: 'ambiguous' }], questions: [{ atomId: a[2].id }], sourceNotes: [{ atomId: a[3].id }] };
};
async function fixture(rulesDir = path.resolve('rules')) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-q01-'));
  const store = new ExtractionCheckpointStore(root); await store.initialize();
  const bundle = await loadExtractionRules(rulesDir), raw = { id: randomUUID(), title: '虚构契约', sourceType: 'report', sourceName: '隔离测试', tags: [] };
  let checkpoint = await store.save({ version: 1, jobId: randomUUID(), rawId: raw.id, rawSha256: sha(text), pipelineVersion: 'kb02-2', rulesVersion: bundle.rulesVersion, providerIdentity: 'local|fake', chunks: chunkText(text, { maxChunkChars: FROZEN_BUDGETS.maxChunkChars, overlap: FROZEN_BUDGETS.chunkOverlap, maxRawChars: FROZEN_BUDGETS.maxRawChars }).map(({ index, start, end }) => ({ index, start, end })), completedChunks: [], attempts: 0, stage: 'extracting', updatedAt: new Date().toISOString() });
  const requests: LlmCompletionRequest[] = [];
  let extraction = (r: LlmCompletionRequest): unknown => legal(r);
  const provider: LlmProvider = { name: 'local', model: 'fake', complete: async r => {
    requests.push(r);
    const planning = r.user.includes('请对下列全部已验证事实规划知识页');
    const data = planning ? JSON.parse(r.user.split('\n').at(-1)!) : undefined;
    return { text: JSON.stringify(planning ? { version:3,document: { title: '虚构指标', main_topic: '渠道' }, pages: [{ title: '虚构指标', type: 'metric', category: 'metric', factUnitIds:data.factUnits.map((x: { id: string }) => x.id), questionUnitIds:data.questionUnits.map((x: { id: string }) => x.id) }] } : extraction(r)), bytes: 1, finishReason: 'stop' };
  } };
  const args = { raw, body: text, bodySha256: sha(text), provider, rulesDir, beforeCall: async (stage: 'extracting' | 'planning') => checkpoint = await store.save({ ...checkpoint, stage, attempts: checkpoint.attempts + 1 }), saveCheckpoint: async (value: Omit<ExtractionCheckpoint, 'integrity'>) => checkpoint = await store.save(value) };
  return { root, args, bundle, requests, store, get checkpoint() { return checkpoint; }, reply: (fn: typeof extraction) => { extraction = fn; }, run: () => runKnowledgePipeline({ ...args, checkpoint }), clean: () => rm(root, { recursive: true, force: true }) };
}

test('KB02 Q01 sends the complete loaded schema and valid nonempty examples; declarations stay out of planning records and draft', async () => {
  const f = await fixture();
  try {
    const result = await f.run(), request = f.requests[0];
    const sent = JSON.parse(request.user.split('\n').find(line => line.startsWith(schemaLabel))!.slice(schemaLabel.length));
    assert.deepEqual(sent, f.bundle.kb02FactsSchema);
    const exampleLine = request.user.split('\n').find(line => line.startsWith('合法非空结构示意'))!;
    const example = JSON.parse(exampleLine.slice(exampleLine.indexOf('{')));
    assert.deepEqual(validateSchema(example, sent), []);
    assert.deepEqual(example.facts.map((x: { kind: string }) => x.kind), ['fact', 'ambiguous']);
    assert.equal(example.questions.length, 1); assert.equal(example.sourceNotes.length, 1);
    assert(request.user.includes('示意ID不是目录ID，禁止照抄'));
    assert(request.user.includes('不要求穷举')); assert(request.user.includes('可为空'));
    const saved = f.checkpoint.completedChunks[0];
    assert.equal(saved.facts[1].kind, 'ambiguous');
    assert.equal(saved.sourceNotes?.[0].text, '虚构验收免责声明。');
    assert.equal(saved.sourceNotes?.length, 1); // Additional layout atom may be omitted.
    const planning = JSON.parse(f.requests[1].user.split('\n').at(-1)!);
    assert.deepEqual(Object.keys(planning).sort(), ['factUnits', 'facts', 'questionUnits', 'questions', 'sourceContexts']);
    for (const context of planning.sourceContexts) assert.equal(context.text, text.slice(context.contextStart, context.contextEnd));
    assert(f.requests[1].system.includes('附近其它陈述只帮助定位，不能作为新增事实'));
    assert.deepEqual(planning.facts.map((x: { text: string }) => x.text), ['在售20家。', '旧资料20家未注明维度。']);
    const planningRecords = JSON.stringify({ facts: planning.facts, questions: planning.questions });
    assert(!planningRecords.includes('免责声明')); assert(!planningRecords.includes('排版'));
    const business = JSON.stringify({ document: result.outcome.document, pages: result.outcome.pages.map(({ source_facts, open_questions, ai_organized, ai_inferences }) => ({ source_facts, open_questions, ai_organized, ai_inferences })) });
    assert(!business.includes('免责声明')); assert(!business.includes('排版'));
    // Locator evidence retains the exact containing source span, even when it spans several atoms.
    for (const evidence of result.outcome.pages[0].source_evidence) assert.equal(text.slice(evidence.start, evidence.end), evidence.quote);
    assert(result.outcome.pages[0].open_questions.some(x => x.includes('旧资料20家未注明维度。')));
    assert.equal(result.outcome.callCount, 2);
  } finally { await f.clean(); }
});

test('KB02 Q01 request limits follow the loaded schema, whose cap still rejects excess declarations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-q01-rules-'));
  try {
    await cp(path.resolve('rules'), path.join(root, 'rules'), { recursive: true });
    const schemaPath = path.join(root, 'rules/kb02-facts.schema.json'), schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    schema.properties.sourceNotes.maxItems = 1;
    await writeFile(schemaPath, JSON.stringify(schema));
    const f = await fixture(path.join(root, 'rules'));
    try {
      f.reply(r => ({ ...legal(r), sourceNotes: atomsOf(r).slice(3).map(x => ({ atomId: x.id })) }));
      await assert.rejects(f.run(), (e: unknown) => e instanceof LlmError && e.code === 'LLM_SCHEMA_INVALID');
      assert(f.requests[0].user.includes('sourceNotes最多1条'));
      assert(f.requests[0].user.includes('不要求穷举、重复列举全部排版说明，最多1条'));
      assert.equal(f.checkpoint.completedChunks.length, 0); assert.equal(f.requests.length, 1);
    } finally { await f.clean(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

const replayPath = 'tests/acceptance/kb02-r2-q01-20261018-builder-responses.json';
for (const sequence of [41, 44, 45, 49]) test(`KB02 Q01 original sanitized seq${sequence} remains rejected without retry or successful cache`, async () => {
  const rows = JSON.parse(await readFile(replayPath, 'utf8')) as Array<{ sequence: number; response: unknown }>;
  const row = rows.find(x => x.sequence === sequence)!; assert(row);
  const f = await fixture();
  try {
    f.reply(() => row.response);
    assert(validateSchema(row.response, f.bundle.kb02FactsSchema).length > 0);
    await assert.rejects(f.run(), (e: unknown) => e instanceof LlmError && e.code === 'LLM_SCHEMA_INVALID');
    assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.attempts, 1);
    assert.equal(f.checkpoint.completedChunks.length, 0); assert(!f.checkpoint.plan);
  } finally { await f.clean(); }
});

test('KB02 Q01 preserves strict classification, unknown IDs, duplicates and source declaration separation', async () => {
  const variants: Array<{ code: string; change: (r: LlmCompletionRequest) => unknown }> = [
    { code: 'LLM_EVIDENCE_UNKNOWN_LOCATOR', change: r => ({ ...legal(r), sourceNotes: [{ atomId: 'c99-a0001' }] }) },
    { code: 'LLM_SCHEMA_INVALID', change: r => ({ ...legal(r), sourceNotes: [legal(r).sourceNotes[0], legal(r).sourceNotes[0]] }) },
    { code: 'LLM_SCHEMA_INVALID', change: r => ({ ...legal(r), facts: [legal(r).facts[0], legal(r).facts[0]] }) },
    { code: 'LLM_SCHEMA_INVALID', change: r => ({ ...legal(r), questions: [legal(r).questions[0], legal(r).questions[0]] }) },
    { code: 'LLM_SCHEMA_INVALID', change: r => ({ ...legal(r), sourceNotes: [{ atomId: legal(r).facts[0].atomId }] }) },
    { code: 'LLM_SCHEMA_INVALID', change: r => ({ ...legal(r), sourceNotes: [{ atomId: legal(r).questions[0].atomId }] }) },
    { code: 'LLM_SCHEMA_INVALID', change: r => ({ ...legal(r), facts: [{ atomId: legal(r).facts[0].atomId, kind: 'sourceNote' }] }) },
  ];
  for (const variant of variants) {
    const f = await fixture();
    try {
      f.reply(variant.change);
      await assert.rejects(f.run(), (e: unknown) => e instanceof LlmError && e.code === variant.code);
      assert.equal(f.checkpoint.completedChunks.length, 0); assert.equal(f.requests.length, 1);
    } finally { await f.clean(); }
  }
});

test('KB02 Q01 previous prompt fingerprint is incompatible and unfinished checkpoint bytes remain intact', async () => {
  const f = await fixture();
  try {
    const [schema, rules, facts, planning] = await Promise.all(['wiki-extract.schema.json', 'extraction-rules.yaml', 'kb02-facts.schema.json', 'kb02-planning.schema.json'].map(name => readFile(path.join('rules', name), 'utf8')));
    const revision = 'kb02-atoms-planning-3', format = 'locator-v2';
    const oldVersion = `b04-${f.bundle.rules.version}-${format}-${revision}-${sha(`${schema}\n${rules}\n${format}\n${revision}\n${facts}\n${planning}`).slice(0, 12)}`;
    assert.equal(KB02_PROMPT_REVISION, 'kb02-atoms-planning-8'); assert.notEqual(f.bundle.rulesVersion, oldVersion);
    const old = await f.store.save({ ...f.checkpoint, rulesVersion: oldVersion });
    const file = path.join(f.root, 'state/extraction-checkpoints', old.jobId + '.json'), bytes = await readFile(file);
    await assert.rejects(validateKnowledgeCheckpoint({ ...f.args, checkpoint: old }), (e: unknown) => e instanceof LlmError && e.code === 'LLM_CHECKPOINT_INCOMPATIBLE' && e.status === 409);
    assert.deepEqual(await readFile(file), bytes); assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});
