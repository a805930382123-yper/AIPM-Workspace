import { semanticReviewReply } from './support/semantic-review.ts';
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
import { KB02_PROMPT_REVISION, loadExtractionRules } from '../services/llm/rules.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const planningPrompt = '请对下列全部已验证事实规划知识页';
const schemaPrompt = '严格遵守schema：';

async function fixture(pair = { type: 'concept', category: 'ai_application' }, secrets: string[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-planning-fields-'));
  const store = new ExtractionCheckpointStore(root); await store.initialize();
  const body = '渠道门店销售额达到20万元。';
  const bundle = await loadExtractionRules(path.resolve('rules'));
  const raw = { id: randomUUID(), title: '规划字段隔离验证', sourceType: 'report', sourceName: '隔离测试', tags: [] };
  let checkpoint = await store.save({ version: 1, jobId: randomUUID(), rawId: raw.id, rawSha256: sha(body), pipelineVersion: 'kb02-2', rulesVersion: bundle.rulesVersion, providerIdentity: 'local|fake', chunks: chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 }).map(({ index, start, end }) => ({ index, start, end })), completedChunks: [], attempts: 0, stage: 'extracting', updatedAt: new Date().toISOString() });
  const requests: LlmCompletionRequest[] = [];
  const provider: LlmProvider = { name: 'local', model: 'fake', secrets, complete: async request => {
    requests.push(request); { const review = semanticReviewReply(request); if (review) return review; }
    if (!request.user.includes(planningPrompt)) {
      const atoms = JSON.parse(request.user.split('\n').at(-1)!) as Array<{ id: string }>;
      return { text: JSON.stringify({ version: 2, facts: atoms.map(atom => ({ atomId: atom.id, kind: 'fact' })), questions: [], sourceNotes: [] }), bytes: 1, finishReason: 'stop' };
    }
    const input = JSON.parse(request.user.split('\n').at(-1)!) as { factUnits: Array<{ id: string }>; questionUnits: Array<{ id: string }> };
    return { text: JSON.stringify({ version: 3, document: { source_level: 'D', title: '渠道门店', main_topic: '销售额' }, pages: [{ title: '渠道门店销售额', ...pair, factUnitIds: input.factUnits.map(unit => unit.id), questionUnitIds: input.questionUnits.map(unit => unit.id) }] }), bytes: 1, finishReason: 'stop' };
  } };
  const args = {
    raw, body, bodySha256: sha(body), provider, rulesDir: path.resolve('rules'),
    beforeCall: async (stage: 'extracting' | 'planning') => checkpoint = await store.save({ ...checkpoint, stage, attempts: checkpoint.attempts + 1 }),
    saveCheckpoint: async (value: Omit<ExtractionCheckpoint, 'integrity'>) => checkpoint = await store.save(value),
  };
  return { root, bundle, args, requests, get checkpoint() { return checkpoint; }, run: () => runKnowledgePipeline({ ...args, checkpoint }), clean: () => rm(root, { recursive: true, force: true }) };
}

test('KB02 planning prompt defines independent fields from current schema/FMCG data and uses valid illustrative pairs', async () => {
  const f = await fixture();
  try {
    assert.equal(KB02_PROMPT_REVISION, 'kb02-atoms-planning-18');
    const { outcome } = await f.run();
    const system = f.requests[1].system;
    assert.match(system, /type表示知识页的知识形态，category表示该页涉及的快消业务主题/u);
    assert.match(system, /不同维度|独立维度/u);
    assert.match(system, /不要因为主题涉及AI就一律选择concept/u);
    const types = f.bundle.kb02PlanningSchema.properties!.pages!.items!.properties!.type!.enum as string[];
    const categories = f.bundle.kb02PlanningSchema.properties!.pages!.items!.properties!.category!.enum as string[];
    for (const item of f.bundle.fmcg.types.filter(item => types.includes(item.id))) assert(system.includes(`${item.id}（${item.label}：${item.description}）`));
    for (const item of f.bundle.fmcg.categories.filter(item => categories.includes(item.id))) assert(system.includes(`${item.id}（${item.label}）`));
    const exampleLine = system.split('\n').find(line => line.startsWith('合法配对示例'))!;
    const examples = JSON.parse(exampleLine.slice(exampleLine.indexOf('['))) as Array<{ type: string; category: string }>;
    assert(examples.length >= 1);
    for (const example of examples) { assert(types.includes(example.type)); assert(categories.includes(example.category)); }
    assert(examples.some(example => example.type === 'metric' && example.category === 'metric'));
    assert(examples.some(example => example.type === 'concept' && example.category === 'ai_application'));
    assert.equal(outcome.pages[0].type, 'concept'); assert.equal(outcome.pages[0].category, 'ai_application');
    assert.equal(f.checkpoint.completedChunks[0].facts.length, 1);
    assert.equal(f.checkpoint.plan!.pages[0].factIds.length, 1);
    assert(system.includes(schemaPrompt));
  } finally { await f.clean(); }
});

test('KB02 planning keeps strict rejection for category values placed in type and swapped fields', async () => {
  for (const pair of [
    { type: 'ai_application', category: 'ai_application' },
    { type: 'ai_application', category: 'concept' },
  ]) {
    const f = await fixture(pair);
    try {
      await assert.rejects(f.run(), (error: unknown) => error instanceof LlmError && error.code === 'LLM_SCHEMA_INVALID');
      assert.equal(f.requests.length, 2);
      assert.equal(f.checkpoint.completedChunks.length, 1);
      assert.equal(f.checkpoint.plan, undefined);
      assert.equal(f.checkpoint.attempts, 2);
    } finally { await f.clean(); }
  }
});

test('KB02 planning scans the expanded system instructions for known secrets before the planning Provider call', async () => {
  const f = await fixture({ type: 'concept', category: 'ai_application' }, ['业务指标']);
  try {
    await assert.rejects(f.run(), (error: unknown) => error instanceof LlmError && error.code === 'LLM_OUTPUT_CONTAINS_SECRET');
    assert.equal(f.requests.length, 1);
    assert.equal(f.checkpoint.completedChunks.length, 1);
    assert.equal(f.checkpoint.attempts, 1);
    assert.equal(f.checkpoint.plan, undefined);
  } finally { await f.clean(); }
});

test('KB02 planning rules fingerprint tracks FMCG labels and descriptions and rejects checkpoints from old prompt metadata', async () => {
  const f = await fixture();
  const rulesRoot = await mkdtemp(path.join(os.tmpdir(), 'kb02-planning-fields-rules-'));
  try {
    await cp(path.resolve('rules'), rulesRoot, { recursive: true });
    const fmcgPath = path.join(rulesRoot, 'fmcg-schema.yaml');
    const fmcgText = await readFile(fmcgPath, 'utf8');
    assert(fmcgText.includes('label: 概念'));
    await writeFile(fmcgPath, fmcgText.replace('label: 概念', 'label: 临时概念名称'));
    const changed = await loadExtractionRules(rulesRoot);
    assert.notEqual(changed.rulesVersion, f.bundle.rulesVersion);
    const before = structuredClone(f.checkpoint);
    await assert.rejects(validateKnowledgeCheckpoint({ ...f.args, rulesDir: rulesRoot, checkpoint: f.checkpoint }), (error: unknown) => error instanceof LlmError && error.code === 'LLM_CHECKPOINT_INCOMPATIBLE' && error.status === 409);
    assert.deepEqual(f.checkpoint, before);
    assert.equal(f.requests.length, 0);
  } finally { await rm(rulesRoot, { recursive: true, force: true }); await f.clean(); }
});
