import os from 'node:os';
import { semanticReviewReply } from './support/semantic-review.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chunkText } from '../services/llm/chunk.ts';
import {
  ExtractionCheckpointStore,
  KB02_PIPELINE_VERSION,
  type ExtractionCheckpoint,
} from '../services/llm/checkpoints.ts';
import { runKnowledgePipeline } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules, FROZEN_BUDGETS } from '../services/llm/rules.ts';
import { LlmError, type LlmProvider, type LlmCompletionRequest } from '../services/llm/provider.ts';

const rulesDir = fileURLToPath(new URL('../rules', import.meta.url));
const raw = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  title: '虚构销售简报',
  sourceType: 'report',
  sourceName: '测试资料',
  tags: [] as string[],
};

test('KB02 facts/planning builds existing draft outcome and preserves fact/question evidence coverage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), '.test-kb02-'));
  try {
    const body = '华东区域2026年一季度销售额为120万元。是否为含税口径？';
    const bundle = await loadExtractionRules(rulesDir);
    const chunks = chunkText(body, {
      maxChunkChars: FROZEN_BUDGETS.maxChunkChars,
      overlap: FROZEN_BUDGETS.chunkOverlap,
      maxRawChars: FROZEN_BUDGETS.maxRawChars,
    });
    const store = new ExtractionCheckpointStore(dir);
    await store.initialize();
    let checkpoint = await store.save({
      version: 1,
      jobId: '123e4567-e89b-42d3-a456-426614174001',
      rawId: raw.id,
      rawSha256: createHash('sha256').update(body).digest('hex'),
      pipelineVersion: KB02_PIPELINE_VERSION,
      rulesVersion: bundle.rulesVersion,
      providerIdentity: 'fake|fake-model',
      chunks: chunks.map(({ index, start, end }) => ({ index, start, end })),
      completedChunks: [],
      attempts: 0,
      stage: 'extracting',
      updatedAt: new Date().toISOString(),
    });
    const provider: LlmProvider = {
      name: 'fake',
      model: 'fake-model',
      cacheIdentity: 'fake',
      complete: async (request: LlmCompletionRequest) => {
        const review = semanticReviewReply(request);
        if (review) return review;
        if (request.user.includes('请对下列全部已验证事实规划知识页')) {
          const payload = JSON.parse(request.user.slice(request.user.indexOf('{', request.user.indexOf('。') + 1))) as {
            factUnits: Array<{ id: string }>;
            questionUnits: Array<{ id: string }>;
          };
          return {
            text: JSON.stringify({
              version: 3,
              document: { source_level: 'D', title: raw.title, main_topic: '区域销售' },
              pages: [
                {
                  title: '区域销售',
                  type: 'metric',
                  category: 'metric',
                  factUnitIds: payload.factUnits.map((item) => item.id),
                  questionUnitIds: payload.questionUnits.map((item) => item.id),
                },
              ],
            }),
            finishReason: 'stop',
            bytes: 10,
          };
        }
        const atoms = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
        return {
          text: JSON.stringify({
            version: 2,
            facts: [{ atomId: atoms[0].id, kind: 'fact' }],
            questions: [{ atomId: atoms[1].id }],
            sourceNotes: [],
          }),
          finishReason: 'stop',
          bytes: 10,
        };
      },
    };
    let calls = 0;
    const result = await runKnowledgePipeline({
      raw,
      body,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      provider,
      rulesDir,
      checkpoint,
      beforeCall: async (stage) => {
        checkpoint = await store.save({ ...checkpoint, attempts: checkpoint.attempts + 1, stage });
        return checkpoint;
      },
      saveCheckpoint: async (value) => {
        checkpoint = await store.save(value);
        return checkpoint;
      },
    });
    assert.equal(result.outcome.pages.length, 1);
    assert.equal(result.outcome.pages[0].source_facts.length, 1);
    assert.deepEqual(result.outcome.pages[0].ai_inferences, []);
    assert.deepEqual(result.outcome.pages[0].ai_organized, []);
    assert.equal(result.outcome.pages[0].open_questions[0], '是否为含税口径?'.replace('?', '？'));
    assert.equal(result.outcome.pages[0].source_evidence[0].rawId, raw.id);
    assert.equal(checkpoint.attempts, chunks.length + 1);
    calls = checkpoint.attempts;
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('KB02 resume reuses validated chunks and counts failed outbound attempts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), '.test-kb02-resume-'));
  try {
    const body = '事实句。'.repeat(2200);
    const bundle = await loadExtractionRules(rulesDir);
    const chunks = chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 });
    assert.equal(chunks.length, 2);
    const store = new ExtractionCheckpointStore(dir);
    await store.initialize();
    let checkpoint = await store.save({
      version: 1,
      jobId: '123e4567-e89b-42d3-a456-426614174002',
      rawId: raw.id,
      rawSha256: createHash('sha256').update(body).digest('hex'),
      pipelineVersion: KB02_PIPELINE_VERSION,
      rulesVersion: bundle.rulesVersion,
      providerIdentity: 'fake|fake-model',
      chunks: chunks.map(({ index, start, end }) => ({ index, start, end })),
      completedChunks: [],
      attempts: 0,
      stage: 'extracting',
      updatedAt: new Date().toISOString(),
    });
    let failSecond = true;
    const seen: string[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      model: 'fake-model',
      complete: async (request: LlmCompletionRequest) => {
        const review = semanticReviewReply(request);
        if (review) return review;
        if (request.user.includes('请对下列全部已验证事实规划知识页')) {
          const json = request.user.slice(request.user.lastIndexOf('\n') + 1);
          const payload = JSON.parse(json) as {
            factUnits: Array<{ id: string }>;
            questionUnits: Array<{ id: string }>;
          };
          return {
            text: JSON.stringify({
              version: 3,
              document: { source_level: 'D', title: '简报', main_topic: '销售' },
              pages: [
                {
                  title: '销售',
                  type: 'metric',
                  category: 'metric',
                  factUnitIds: payload.factUnits.map((item) => item.id),
                  questionUnitIds: payload.questionUnits.map((item) => item.id),
                },
              ],
            }),
            finishReason: 'stop',
            bytes: 10,
          };
        }
        const atoms = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
        const locator = atoms[0].id;
        const chunk = Number(locator?.match(/^c(\d+)/)?.[1]);
        seen.push(`c${chunk}`);
        if (chunk === 2 && failSecond) {
          failSecond = false;
          throw new LlmError('FAKE_TIMEOUT', 'simulated timeout', 504);
        }
        return {
          text: JSON.stringify({
            version: 2,
            facts: [{ atomId: locator, kind: 'fact' }],
            questions: [],
            sourceNotes: [],
          }),
          finishReason: 'stop',
          bytes: 10,
        };
      },
    };
    const args = {
      raw,
      body,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      provider,
      rulesDir,
      beforeCall: async (stage: 'extracting' | 'planning') => {
        checkpoint = await store.save({ ...checkpoint, attempts: checkpoint.attempts + 1, stage });
        return checkpoint;
      },
      saveCheckpoint: async (value: Omit<ExtractionCheckpoint, 'integrity'>) => {
        checkpoint = await store.save(value);
        return checkpoint;
      },
    };
    await assert.rejects(runKnowledgePipeline({ ...args, checkpoint }), /simulated timeout/);
    assert.equal(checkpoint.completedChunks.length, 1);
    assert.equal(checkpoint.attempts, 2);
    const resumed = await runKnowledgePipeline({ ...args, checkpoint });
    assert.deepEqual(seen, ['c1', 'c2', 'c2']);
    assert.equal(checkpoint.attempts, 4);
    assert.equal(resumed.outcome.pages[0].source_facts.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('KB02 corrupted checkpoint integrity fails closed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), '.test-kb02-corrupt-'));
  try {
    const store = new ExtractionCheckpointStore(dir);
    await store.initialize();
    const id = '123e4567-e89b-42d3-a456-426614174003';
    await store.save({
      version: 1,
      jobId: id,
      rawId: raw.id,
      rawSha256: 'a'.repeat(64),
      pipelineVersion: KB02_PIPELINE_VERSION,
      rulesVersion: 'rules',
      providerIdentity: 'fake|fake-model',
      chunks: [{ index: 0, start: 0, end: 12 }],
      completedChunks: [],
      attempts: 0,
      stage: 'extracting',
      updatedAt: new Date().toISOString(),
    });
    const file = path.join(dir, 'state', 'extraction-checkpoints', `${id}.json`);
    const value = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
    value.attempts = 10;
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(
      store.get(id),
      (error: unknown) => error instanceof LlmError && error.code === 'LLM_CHECKPOINT_CORRUPT',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
