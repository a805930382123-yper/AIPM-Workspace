import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OpenAiCompatibleProvider } from '../services/llm/provider.ts';
import { kb02StructuredOutput, decodeKb02StructuredOutput } from '../services/llm/openai-structured.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { ExtractionCheckpointStore, type ExtractionCheckpoint } from '../services/llm/checkpoints.ts';
import { RawStore } from '../services/raw/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import type { JsonSchemaNode } from '../services/llm/schema-validator.ts';
import { validateSchema } from '../services/llm/schema-validator.ts';

// Model simulator fills only the wire's null slots, without changing business values.
function wireValue(value: any, schema: JsonSchemaNode): any {
  if (value === undefined) return null;
  if (schema.properties) return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, wireValue(value[key], child)]));
  if (schema.items) return value.map((item: any) => wireValue(item, schema.items!));
  return value;
}

async function pipeline(t: any, change?: (value: any, stage: number) => void, failure?: string, fields = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openai-structured-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root), drafts = new DraftStore(root), store = new ExtractionCheckpointStore(root);
  await Promise.all([raws.initialize(), drafts.initialize(), store.initialize()]);
  const body = '补货安排已编制但尚未发货。\n审批负责人未知。';
  const raw = await raws.create({ title: '虚构补货', sourceType: 'report', sourceName: '隔离测试', body, tags: [] });
  const bundle = await loadExtractionRules('rules');
  let checkpoint = await store.save({ version: 1, jobId: randomUUID(), rawId: raw.id, rawSha256: raw.bodySha256, pipelineVersion: 'kb02-2', rulesVersion: bundle.rulesVersion, providerIdentity: 'test', chunks: [{ index: 0, start: 0, end: body.length }], completedChunks: [], attempts: 0, stage: 'extracting', updatedAt: new Date().toISOString() });
  const prior = globalThis.fetch, requests: any[] = [], originalTexts: string[] = [];
  t.after(() => { globalThis.fetch = prior; });
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)); requests.push(sent);
    const stage = requests.length, input = JSON.parse(sent.messages[1].content.split('\n').at(-1));
    if (failure === 'http') return new Response('{}', { status: 400 });
    if (failure === 'format') return new Response('not-json');
    let value = stage === 1
      ? { version: 2, facts: [{ atomId: input[0].id, kind: 'fact' }], questions: input.slice(1).map((atom: any) => ({ atomId: atom.id })), sourceNotes: [] }
      : { version: 3, document: { source_level: 'D', title: '补货', main_topic: '补货' }, pages: [{ title: '补货流程', type: 'business_process', category: 'supply_chain', factUnitIds: input.factUnits.map((unit: any) => unit.id), questionUnitIds: input.questionUnits.map((unit: any) => unit.id), ...(fields ? { templateFields: { outputs: { text: '补货安排已编制但尚未发货。', factUnitIds: input.factUnits.map((unit: any) => unit.id) } } } : {}) }] };
    value = wireValue(value, sent.response_format.json_schema.schema); change?.(value, stage);
    const text = JSON.stringify(value); originalTexts.push(text);
    return new Response(JSON.stringify({ choices: [{ message: { content: text, ...(failure === 'refusal' ? { refusal: 'refused' } : {}) }, finish_reason: failure === 'length' ? 'length' : 'stop' }] }));
  }) as typeof fetch;
  const provider = new OpenAiCompatibleProvider({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-terra', apiKey: 'fixture-key', source: 'env' });
  const args = { raw, body, bodySha256: raw.bodySha256, provider, rulesDir: path.resolve('rules'), beforeCall: async (stage: 'extracting' | 'planning') => checkpoint = await store.save({ ...checkpoint, stage, attempts: checkpoint.attempts + 1 }), saveCheckpoint: async (value: Omit<ExtractionCheckpoint, 'integrity'>) => checkpoint = await store.save(value) };
  return { root, raws, drafts, raw, bundle, requests, originalTexts, args, get checkpoint() { return checkpoint; }, run: () => runKnowledgePipeline({ ...args, checkpoint }) };
}

for (const fields of [false, true]) test(`strict fetch carries both loaded schemas and publishes a faithful draft, nested fields=${fields}`, async t => {
  const f = await pipeline(t, undefined, undefined, fields);
  const { outcome } = await f.run();
  assert.equal(f.requests.length, 2);
  for (const [index, schema] of [f.bundle.kb02FactsSchema, f.bundle.kb02PlanningSchema].entries()) {
    assert.deepEqual(f.requests[index].response_format, { type: 'json_schema', json_schema: { ...kb02StructuredOutput(index ? 'kb02_planning' : 'kb02_facts', schema), strict: true } });
    assert.equal('temperature' in f.requests[index], false);
  }
  assert.equal(f.originalTexts[1].includes(':null'), true);
  assert.equal(JSON.stringify(f.checkpoint.plan).includes(':null'), false);
  assert.equal(outcome.pages[0].source_facts[0].text, '补货安排已编制但尚未发货。');
  assert.deepEqual(outcome.pages[0].open_questions, ['审批负责人未知。']);
  assert.equal(outcome.document.summary, '来源事实：\n补货安排已编制但尚未发货。');
  assert.equal(outcome.pages[0].templateFields?.outputs?.aiContent?.text, fields ? '补货安排已编制但尚未发货。' : undefined);
  const rules = { types: f.bundle.fmcg.types.map(x => x.id), categories: f.bundle.fmcg.categories.map(x => x.id), knowledge_status: f.bundle.fmcg.enums.knowledge_status, confidence: f.bundle.fmcg.enums.confidence, source_level: f.bundle.fmcg.enums.source_level, review_status: f.bundle.fmcg.enums.review_status };
  const draft = await f.drafts.create({ raw: f.raw, body: f.raw.body, rules, jobId: f.checkpoint.jobId, outcome });
  assert.equal((await f.drafts.list()).length, 1);
  assert.equal((await f.raws.get(f.raw.id))!.body, f.raw.body);
  assert(f.drafts.view(draft).pages[0].renderedBody.includes('审批负责人未知。'));
  const old = { ...f.checkpoint, rulesVersion: f.bundle.rulesVersion.replace(/planning-\d+-/u, 'planning-16-') };
  await assert.rejects(validateKnowledgeCheckpoint({ ...f.args, checkpoint: old }), { code: 'LLM_CHECKPOINT_INCOMPATIBLE' });
  // Completed records remain readable and reconciliation can validate under the current schema.
  await validateKnowledgeCheckpoint({ ...f.args, checkpoint: f.checkpoint }, { rulesVersion: old.rulesVersion, callCount: old.attempts });
  assert.equal((await f.drafts.get(draft.id))!.id, draft.id);
});

const invalid = [
  ['required', (v: any) => { delete v.document.title; }, 'LLM_SCHEMA_INVALID'],
  ['null required', (v: any) => { v.document.title = null; }, 'LLM_SCHEMA_INVALID'],
  ['wrong type', (v: any) => { v.document.title = 3; }, 'LLM_SCHEMA_INVALID'],
  ['extra', (v: any) => { v.extra = 'x'; }, 'LLM_SCHEMA_INVALID'],
  ['string pages', (v: any) => { v.pages.push('bad page'); }, 'LLM_SCHEMA_INVALID'],
  ['missing wire slot', (v: any) => { delete v.pages[0].templateFields; }, 'LLM_SCHEMA_INVALID'],
  ['illegal reference', (v: any) => { v.pages[0].factUnitIds = ['unknown-id']; }, 'LLM_PLAN_COVERAGE_INVALID'],
] as const;
for (const [name, change, code] of invalid) test(`strict product pipeline rejects ${name} with no draft or retry`, async t => {
  const f = await pipeline(t, (v, stage) => { if (stage === 2) change(v); });
  await assert.rejects(f.run(), { code }); assert.equal(f.requests.length, 2);
  assert.equal(f.checkpoint.plan, undefined); assert.equal((await f.drafts.list()).length, 0);
});

test('strict facts reject missing, null, wrong type, extra fields and unknown atom references', async t => {
  for (const [change, code] of [
    [(v: any) => { delete v.facts; }, 'LLM_SCHEMA_INVALID'],
    [(v: any) => { v.facts = null; }, 'LLM_SCHEMA_INVALID'],
    [(v: any) => { v.facts[0].kind = 'invented'; }, 'LLM_SCHEMA_INVALID'],
    [(v: any) => { v.facts[0].extra = true; }, 'LLM_SCHEMA_INVALID'],
    [(v: any) => { v.facts[0].atomId = 'unknown'; }, 'LLM_EVIDENCE_UNKNOWN_LOCATOR'],
  ] as const) {
    const f = await pipeline(t, change); await assert.rejects(f.run(), { code });
    assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.completedChunks.length, 0); assert.equal((await f.drafts.list()).length, 0);
  }
});

for (const [failure, code] of [['refusal', 'LLM_REFUSAL'], ['length', 'LLM_OUTPUT_TRUNCATED'], ['http', 'LLM_PROVIDER_ERROR'], ['format', 'LLM_PROVIDER_ERROR']]) test(`strict ${failure} stops on the first request`, async t => {
  const f = await pipeline(t, undefined, failure); await assert.rejects(f.run(), { code });
  assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.plan, undefined); assert.equal((await f.drafts.list()).length, 0);
});

test('strict nullable conversion follows actual optional properties without altering required constraints', async () => {
  const schema: JsonSchemaNode = { type: 'object', required: ['required'], properties: { required: { type: 'string', minLength: 1 }, optional: { type: 'string', enum: ['allowed'] } } };
  const wire = kb02StructuredOutput('fixture', schema);
  assert.deepEqual(decodeKb02StructuredOutput({ required: 'x', optional: null }, schema, wire), { required: 'x' });
  assert.throws(() => decodeKb02StructuredOutput({ required: '', optional: null }, schema, wire), { code: 'LLM_SCHEMA_INVALID' });
  assert.throws(() => decodeKb02StructuredOutput({ required: 'x', optional: 'wrong' }, schema, wire), { code: 'LLM_SCHEMA_INVALID' });
  assert.deepEqual(schema.required, ['required']);
});

test('historical response254 still fails both original business schema and the real strict product pipeline', async t => {
  const archived = JSON.parse(await readFile('docs/reports/R1618-OQ-20261029-real-evidence/output/response-254.json', 'utf8'));
  const original = JSON.parse(archived.text);
  const bundle = await loadExtractionRules('rules');
  assert(validateSchema(original, bundle.kb02PlanningSchema).some(issue => issue.includes('pages[1]')));
  const f = await pipeline(t, (value, stage) => {
    if (stage === 2) { for (const key of Object.keys(value)) delete value[key]; Object.assign(value, original); }
  });
  await assert.rejects(f.run(), { code: 'LLM_SCHEMA_INVALID' });
  assert.equal(f.requests.length, 2); assert.equal((await f.drafts.list()).length, 0);
});

test('strict output requires exact host/model, knowledge purpose and an explicit descriptor; original text is preserved', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const structuredOutput = kb02StructuredOutput('fixture', { type: 'object', properties: { optional: { type: 'string' } } });
  const content = '{ "optional" : null }'; let sent: any;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  }) as typeof fetch;
  for (const [baseUrl, model, purpose, descriptor, enabled] of [
    ['https://api.openai.com/v1', 'gpt-6.1-terra', 'knowledge', true, true],
    ['https://API.OPENAI.COM/v1', 'gpt-6.1-terra', 'knowledge', true, true],
    ['https://api.openai.com/v1', 'gpt-6.1-terra', undefined, true, false],
    ['https://api.openai.com/v1', 'gpt-6.1-terra', 'prompt', true, false],
    ['https://api.openai.com/v1', 'gpt-6.1-terra', 'knowledge', false, false],
    ['https://api.openai.com.attacker.example/v1', 'gpt-6.1-terra', 'knowledge', true, false],
    ['https://api.openai.com/v1', 'gpt-6.1-terra-preview', 'knowledge', true, false],
    ['https://api.z.ai/v1', 'glm-5.3-flash', 'knowledge', true, false],
  ] as const) {
    const result = await new OpenAiCompatibleProvider({ baseUrl, model, apiKey: 'fixture-key', source: 'env' }).complete({ system: 'test', user: 'test', purpose, timeoutMs: 1000, maxOutputBytes: 4096, ...(descriptor ? { structuredOutput } : {}) });
    assert.equal(sent.response_format?.type === 'json_schema', enabled);
    assert.equal(result.structuredOutputApplied === true, enabled);
    assert.equal(result.text, content);
    if (model === 'glm-5.3-flash') assert.deepEqual(sent.response_format, { type: 'json_object' });
  }
});
