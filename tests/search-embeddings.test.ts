import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { KnowledgeAnswerService } from '../services/llm/knowledge-answers.ts';
import { retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';
import { PromptStore } from '../services/prompt/store.ts';
import {
  embeddingInput,
  OpenAiEmbeddingProvider,
  resolveEmbeddingConfig,
  type EmbeddingUsageMeta,
} from '../services/search/embedding-provider.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { WikiVectorCache } from '../services/search/vector-retriever.ts';
import {
  decodeEmbedding,
  openSearchDatabase,
  readEmbeddingLock,
  writeEmbeddings,
} from '../services/search/sqlite-store.ts';
import { assertWikiSourcesAllowed } from '../services/wiki/source-lineage.ts';
import type { WikiInput } from '../services/wiki/store.ts';
import { lwFixture } from './lw01-fixture.ts';
import { withoutInheritedEmbeddings } from './support/isolated-embedding-env.mjs';

type WireRequest = { model: string; input: string[]; dimensions?: number };
type WireChat = { model: string; messages: Array<{ role: string; content: string }> };

function reply(response: ServerResponse, request: WireRequest, dimensions = request.dimensions ?? 2) {
  const data = request.input.map((_, index) => ({
    index,
    embedding: [3, 4 + index, ...Array<number>(dimensions - 2).fill(0)],
  }));
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      data: data.reverse(),
      usage: { prompt_tokens: request.input.length * 2, total_tokens: request.input.length * 2 },
    }),
  );
}

async function endpoint(t: TestContext) {
  const requests: WireRequest[] = [];
  const usage: Array<EmbeddingUsageMeta & { error?: string }> = [];
  let handler = reply;
  let chat: ((request: WireChat) => unknown) | undefined;
  const server = createServer(async (req, res) => {
    const body: Buffer[] = [];
    for await (const bytes of req) body.push(bytes);
    const request = JSON.parse(Buffer.concat(body).toString());
    assert.equal(req.headers.authorization, 'Bearer synthetic-credential');
    if (req.url === '/v1/chat/completions' && chat) {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(chat(request)) },
            },
          ],
        }),
      );
      return;
    }
    requests.push(request);
    assert.equal(req.url, '/v1/embeddings');
    handler(res, request);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1///`;
  return {
    baseUrl,
    requests,
    usage,
    handle: (next: typeof handler) => {
      handler = next;
    },
    handleChat: (next: NonNullable<typeof chat>) => {
      chat = next;
    },
    provider: (env: NodeJS.ProcessEnv = {}) =>
      new OpenAiEmbeddingProvider(
        resolveEmbeddingConfig({
          EMBEDDING_BASE_URL: baseUrl,
          EMBEDDING_API_KEY: 'synthetic-credential',
          EMBEDDING_MODEL: 'synthetic-a',
          ...env,
        })!,
        (entry, error) => usage.push({ ...entry, error }),
      ),
  };
}

test('embedding configuration requires explicit model and keeps credentials bound to the configured endpoint', () => {
  const main = { baseUrl: 'https://main.example/v1/', apiKey: 'main-credential' };
  const explicit = { EMBEDDING_MODEL: 'vector-a' };
  assert.equal(resolveEmbeddingConfig({}, main), null);
  assert.equal(resolveEmbeddingConfig(explicit, main)?.apiKey, main.apiKey);
  assert.equal(resolveEmbeddingConfig({ ...explicit, EMBEDDING_BASE_URL: main.baseUrl }, main)?.apiKey, main.apiKey);
  assert.equal(resolveEmbeddingConfig({ ...explicit, EMBEDDING_BASE_URL: 'https://other.example/v1' }, main), null);
  assert.equal(resolveEmbeddingConfig({ ...explicit, EMBEDDING_BASE_URL: 'https://main.example/v2' }, main), null);
  assert.equal(
    resolveEmbeddingConfig({ ...explicit, EMBEDDING_API_KEY: 'new-credential' }, main)?.baseUrl,
    'https://main.example/v1',
  );
  const defaults = resolveEmbeddingConfig(explicit, main)!;
  assert.equal(defaults.indexTimeoutMs, 15000);
  assert.equal(defaults.queryTimeoutMs, 4000);
  assert.equal(defaults.batchSize, 32);
  assert.equal(resolveEmbeddingConfig({ ...explicit, EMBEDDING_DIMENSIONS: '1.5' }, main), null);
  assert.equal(resolveEmbeddingConfig({ ...explicit, EMBEDDING_MODEL: main.apiKey }, main), null);
  assert(embeddingInput('长标题', '事实', 'fact', '🧾'.repeat(3000)).length <= 3000);
  assert(!/[\ud800-\udbff]$/u.test(embeddingInput('长标题', '事实', 'fact', '🧾'.repeat(3000))));
});

test(
  'provider batches, orders, normalizes, records usage, retries temporary index failure and bounds query waits',
  { timeout: 8_000 },
  async (t) => {
    const wire = await endpoint(t);
    const provider = wire.provider({
      EMBEDDING_BATCH_SIZE: '2',
      EMBEDDING_DIMENSIONS: '2',
      EMBEDDING_QUERY_TIMEOUT_MS: '80',
    });
    const batch = await provider.embedTexts(['one', 'two', 'three']);
    assert.deepEqual(
      wire.requests.map(({ input }) => input),
      [['one', 'two'], ['three']],
    );
    assert.equal(batch.dimensions, 2);
    assert.equal(batch.usage.totalTokens, 6);
    assert.equal(batch.usage.inputCount, 3);
    assert(Math.abs(batch.vectors[0][0] - 0.6) < 1e-7);
    assert(batch.vectors[1][0] < batch.vectors[0][0]);
    assert(batch.vectors.every((v) => Math.abs(Math.hypot(...v) - 1) < 1e-7));
    assert.deepEqual(
      wire.requests.map(({ dimensions }) => dimensions),
      [2, 2],
    );
    let failures = 0;
    wire.handle((res, req) => {
      if (failures++ === 0) res.writeHead(429).end('wire-error-text');
      else reply(res, req);
    });
    await provider.embedTexts(['retry']);
    assert.equal(failures, 2);
    assert.deepEqual(
      wire.usage.slice(-2).map((entry) => entry.error),
      ['EMBEDDING_HTTP_429', undefined],
    );
    wire.handle((res) => res.writeHead(503).end('wire-error-text'));
    await assert.rejects(() => provider.embedQuery('immediate failure'), { code: 'EMBEDDING_HTTP_503' });
    assert.equal(wire.requests.filter(({ input }) => input.includes('immediate failure')).length, 1);
    wire.handle(() => {});
    await assert.rejects(() => provider.embedQuery('timeout'), { code: 'EMBEDDING_TIMEOUT' });
    assert.equal(wire.requests.filter(({ input }) => input.includes('timeout')).length, 1);
    for (const data of [
      [
        { index: 0, embedding: [1, 0] },
        { index: 0, embedding: [1, 0] },
      ],
      [
        { index: 1, embedding: [1, 0] },
        { index: 0, embedding: [1, 0, 1] },
      ],
      [
        { index: 1, embedding: [1, 0] },
        { index: 0, embedding: ['NaN', 'Infinity'] },
      ],
      [
        { index: 1, embedding: [1, 0] },
        { index: 0, embedding: [0, 0] },
      ],
    ]) {
      wire.handle((res) => res.end(JSON.stringify({ data })));
      await assert.rejects(() => provider.embedTexts(['invalid', 'response']), { code: 'EMBEDDING_INVALID_RESPONSE' });
    }
    assert(
      wire.usage.every(
        ({ provider, model, durationMs }) =>
          provider === 'openai-compatible' && model === 'synthetic-a' && durationMs >= 0,
      ),
    );
  },
);

const wikiInput = (title: string, body: string): WikiInput => ({
  title,
  body,
  sources: [],
  tags: [],
  aliases: [],
  type: 'concept',
  category: 'channel',
  knowledge_status: 'ai_organized',
  confidence: 'medium',
  source_level: 'D',
  review_status: 'unreviewed',
});

test('multi-lane dot products preserve cosine ranking and the tail of a non-multiple-of-four dimension', () => {
  const cache = new WikiVectorCache();
  const query = Float32Array.from({ length: 1537 }, (_, i) => Math.sin(i) / 32);
  const vectors = Array.from({ length: 12 }, (_, row) =>
    Float32Array.from({ length: query.length }, (_, i) => Math.sin(i + row) / 32),
  );
  cache.upsertChunks(vectors.map((vec, i) => ({ chunkId: String(i), pageId: String(i), wikiType: 'concept', vec })));
  const scalar = vectors
    .map((vector, i) => ({
      chunkId: String(i),
      score: vector.reduce((sum, value, j) => sum + value * query[j], 0),
    }))
    .sort((a, b) => b.score - a.score);
  const actual = cache.rank(query, {}, -1);
  assert.deepEqual(
    actual.map(({ chunkId }) => chunkId),
    scalar.map(({ chunkId }) => chunkId),
  );
  assert(actual.every(({ score }, i) => Math.abs(score - scalar[i].score) < 1e-12));
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'aipm-1b-embedding-'));
  const wire = await endpoint(t);
  let provider: OpenAiEmbeddingProvider | null = null;
  const index = new WikiSearchIndexer(root, {
    provider: async () => provider,
    authorize: (page) => assertWikiSourcesAllowed(f.wiki, f.rawStore, page),
    withSourceLock: (work) => f.wiki.withLock(work),
  });
  t.after(async () => {
    await index.close();
    await rm(root, { recursive: true, force: true });
  });
  const f = await lwFixture(root, index);
  const rows = () =>
    index.read((db) =>
      db
        .prepare<[], { pageId: string; raw: string; version: string | null; vector: Buffer | null }>(
          'SELECT page_id AS pageId, raw_text AS raw, embedding_ver AS version, embedding AS vector FROM chunks ORDER BY page_id, chunk_index',
        )
        .all(),
    );
  const retrieve = (title: string) =>
    retrieveKnowledgeContextDetailed(f.wiki, f.rawStore, [{ title, content: '', tags: [] }]);
  return {
    ...f,
    wire,
    index,
    rows,
    retrieve,
    enable: (value = wire.provider()) => {
      provider = value;
    },
  };
}

test('memory dot products keep the best 30 after intersecting source, allow and exclude filters', () => {
  const cache = new WikiVectorCache();
  cache.upsertChunks(
    Array.from({ length: 35 }, (_, i) => {
      const x = 0.5 + i / 100;
      return {
        chunkId: String(i),
        pageId: 'allowed',
        wikiType: 'concept',
        vec: Float32Array.of(x, Math.sqrt(1 - x * x)),
      };
    }),
  );
  cache.upsertChunks([
    { chunkId: 'excluded-strong', pageId: 'excluded', wikiType: 'concept', vec: Float32Array.of(1, 0) },
    { chunkId: 'source-strong', pageId: 'source', wikiType: 'source', vec: Float32Array.of(1, 0) },
  ]);
  const query = Float32Array.of(1, 0);
  const hits = cache.rank(
    query,
    { allowedPageIds: new Set(['allowed', 'excluded', 'source']), excludeIds: ['excluded'] },
    0.42,
  );
  assert.deepEqual(
    hits.map(({ chunkId }) => chunkId),
    Array.from({ length: 30 }, (_, i) => String(34 - i)),
  );
  assert.deepEqual(cache.rank(query, { allowedPageIds: [] }, 0.42), []);
  assert.deepEqual(cache.rank(query, { allowedPageIds: ['source'], includeSources: true }, 0.42), [
    { chunkId: 'source-strong', score: 1 },
  ]);
  cache.removeByPageId('allowed');
  assert.deepEqual(cache.rank(query, { allowedPageIds: ['allowed'] }, 0.42), []);
});

test('hybrid runs RRF, protects exact aliases and rejects weak vector-only hits before assembling context', async (t) => {
  const f = await fixture(t);
  const both = await f.wiki.create(wikiInput('dualmark details', 'dualmark confirmed'));
  const protectedPage = await f.wiki.create({ ...wikiInput('Protected', 'alias body'), aliases: ['dualmark'] });
  const strong = await f.wiki.create(wikiInput('Strong', 'completely unrelated text'));
  const weak = await f.wiki.create(wikiInput('Weak', 'marginal resemblance'));
  const below = await f.wiki.create(wikiInput('Below', 'outside threshold'));
  f.wire.handle((res, { input }) =>
    res.end(
      JSON.stringify({
        data: input.map((part, index) => {
          const x = part.startsWith('标题: Strong')
            ? 1
            : part.startsWith('标题: Weak')
              ? 0.45
              : part.startsWith('标题: Below')
                ? 0.41
                : part.startsWith('标题: Protected')
                  ? 0.3
                  : part.startsWith('标题: dualmark')
                    ? 0.85
                    : 1;
          return { index, embedding: [x, Math.sqrt(1 - x * x)] };
        }),
      }),
    ),
  );
  f.enable();
  await f.index.backfillMissingEmbeddings();
  const result = await f.retrieve('dualmark');
  assert.equal(result.engine, 'hybrid');
  assert.deepEqual(
    result.chunks.map(({ pageId, hitSource }) => [pageId, hitSource]),
    [
      [both.id, 'both'],
      [protectedPage.id, 'fts'],
      [strong.id, 'vector'],
    ],
  );
  const hit = result.chunks[0];
  assert.equal(hit.vectorRank, 2);
  assert.equal(hit.rrfScore, 1 / (60 + hit.ftsRank!) + 1 / 62);
  assert.equal(result.chunks[1].score - result.chunks[1].rrfScore!, 0.008);
  assert.equal(result.chunks[2].vectorScore, 1);
  assert(!result.records.some(({ id }) => id === weak.id || id === below.id));
  const paraphrase = await f.retrieve('semantically connected but unshared wording');
  assert(paraphrase.chunks.some(({ pageId, hitSource }) => pageId === both.id && hitSource === 'vector'));
  const previous = process.env.SEARCH_VECTOR_MIN_SCORE;
  const previousRrfK = process.env.SEARCH_RRF_K;
  try {
    process.env.SEARCH_VECTOR_MIN_SCORE = '0.35';
    assert((await f.retrieve('dualmark')).chunks.some(({ pageId }) => pageId === weak.id));
    process.env.SEARCH_VECTOR_MIN_SCORE = '0.42';
    process.env.SEARCH_RRF_K = '10';
    const tuned = await f.retrieve('dualmark');
    const dual = tuned.chunks.find(({ pageId }) => pageId === both.id)!;
    const single = tuned.chunks.find(({ pageId }) => pageId === strong.id)!;
    assert.equal(dual.rrfScore, 1 / (10 + dual.ftsRank!) + 1 / 12);
    assert.equal(single.rrfScore, 1 / 11);
    for (const invalid of ['', '0', '-10', 'Infinity', 'invalid']) {
      process.env.SEARCH_RRF_K = invalid;
      assert.equal((await f.retrieve('dualmark')).chunks[0].rrfScore, hit.rrfScore);
    }
    process.env.SEARCH_RRF_K = '10';
    process.env.SEARCH_VECTOR_MIN_SCORE = '0.99';
    const highThreshold = await f.retrieve('semantically connected but unshared wording');
    assert.deepEqual(
      highThreshold.chunks.map(({ pageId, hitSource, vectorScore, rrfScore }) => ({
        pageId,
        hitSource,
        vectorScore,
        rrfScore,
      })),
      [{ pageId: strong.id, hitSource: 'vector', vectorScore: 1, rrfScore: 1 / 11 }],
    );
  } finally {
    if (previous === undefined) delete process.env.SEARCH_VECTOR_MIN_SCORE;
    else process.env.SEARCH_VECTOR_MIN_SCORE = previous;
    if (previousRrfK === undefined) delete process.env.SEARCH_RRF_K;
    else process.env.SEARCH_RRF_K = previousRrfK;
  }
});

test('a vector-only direct hit can add one-hop evidence in Hybrid without another embedding request', async (t) => {
  const f = await fixture(t);
  const neighbor = await f.wiki.create(wikiInput('Journal', 'Separate ledger evidence.'));
  const seed = await f.wiki.create(wikiInput('Vector seed', 'Primary record. [[Journal]]'));
  f.wire.handle((res, { input }) =>
    res.end(
      JSON.stringify({
        data: input.map((part, index) => ({
          index,
          embedding: part.startsWith('标题: Journal') ? [0, 1] : [1, 0],
        })),
      }),
    ),
  );
  f.enable();
  await f.index.backfillMissingEmbeddings();
  const requests = f.wire.requests.length;
  const result = await f.retrieve('paraphraseprobe');
  assert.equal(result.engine, 'hybrid');
  assert.equal(result.degraded, false);
  assert.equal(f.wire.requests.length, requests + 1);
  assert.deepEqual(
    result.chunks.map(({ pageId, hitSource }) => [pageId, hitSource]),
    [
      [seed.id, 'vector'],
      [neighbor.id, 'relation'],
    ],
  );
  assert.equal(result.chunks[1].rawText, neighbor.body);
});

test('the actual Prompt generation path embeds only with authorized selected pages and never sends unselected context', async (t) => {
  const f = await fixture(t);
  const kept = await f.wiki.create(wikiInput('Saved reference', 'selected wire text'));
  const excluded = await f.wiki.create(wikiInput('Unchosen reference', 'offscope wire text'));
  f.enable();
  await f.index.backfillMissingEmbeddings();
  const prompts = new PromptStore(f.root, f.wiki);
  await prompts.initialize();
  const sent: Array<{ relatedWiki: { id: string; chunks: { rawText: string }[] }[] }> = [];
  const provider: LlmProvider = {
    name: 'loopback-only',
    model: 'prompt-stub',
    async complete({ user }) {
      sent.push(JSON.parse(user));
      const text = JSON.stringify({
        version: 1,
        name: '生成测试',
        category: 'customer',
        scenario: '访谈',
        sections: [{ heading: '任务目标', content: '分析' }],
        inputRequirements: '资料',
        outputRequirements: '结果',
        examples: '',
        tags: [],
      });
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    },
  };
  const service = new PromptAiService(f.root, f.wiki, prompts, () => provider, f.rawStore);
  await service.initialize();
  const brief = {
    taskName: 'semantic query',
    taskType: '访谈',
    role: '产品经理',
    goal: '核验',
    context: '测试',
    input: '资料',
    tasks: '准备',
    constraints: '客观',
    output: '结果',
  };
  const one = await service.generate(brief, [kept.id]);
  assert.equal(one.wikiRetrieval.engine, 'hybrid');
  assert.deepEqual(
    sent[0].relatedWiki.map(({ id }) => id),
    [kept.id],
  );
  assert.equal(sent[0].relatedWiki[0].chunks[0].rawText, kept.body);
  assert(!JSON.stringify(sent[0]).includes(excluded.id));
  const calls = f.wire.requests.length;
  const none = await service.generate(brief, []);
  assert.equal(none.wikiRetrieval.engine, 'hybrid');
  assert.deepEqual(sent[1].relatedWiki, []);
  assert.equal(f.wire.requests.length, calls);
});

test('pure-vector QA checks UTF-16 citations against the current file and authorization after completion', async (t) => {
  const f = await fixture(t);
  const raw = await f.rawStore.create({
    title: '合成',
    sourceType: 'report',
    sourceName: '合成',
    tags: [],
    body: '保留原始记录。',
  });
  const quote = '🧾 精确口径是22%。';
  const page = await f.wiki.create({ ...wikiInput('实读页', '## 来源事实\n\n' + quote), sources: [raw.id] });
  f.enable();
  await f.index.backfillMissingEmbeddings();
  const q = 'unshared paraphrase';
  const result = await f.retrieve(q);
  assert.equal(result.engine, 'hybrid');
  assert.equal(result.chunks[0].hitSource, 'vector');
  const expected = result.chunks[0];
  assert.equal(page.body.slice(expected.startOffset, expected.endOffset), expected.rawText);
  const start = page.body.indexOf(quote);
  const file = path.join(f.root, 'knowledge', 'wiki', page.id + '.md');
  const original = await readFile(file, 'utf8');
  let duringCall = async () => {};
  const provider: LlmProvider = {
    name: 'loopback-only',
    model: 'answer-stub',
    async complete({ user }) {
      assert.equal(JSON.parse(user).wiki[0].chunks[0].rawText, expected.rawText);
      await duringCall();
      const text = JSON.stringify({
        version: 1,
        needsRaw: [],
        sections: [{ kind: 'fact', text: quote, citationIds: ['citation-1'] }],
        citations: [{ id: 'citation-1', kind: 'wiki', recordId: page.id, quote, start, end: start + quote.length }],
      });
      return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
    },
  };
  const service = new KnowledgeAnswerService({
    root: f.root,
    wiki: f.wiki,
    raws: f.rawStore,
    drafts: f.drafts,
    provider: () => provider,
  });
  await service.initialize();
  const ask = () => service.ask({ requestId: randomUUID(), question: q });
  const good = await ask();
  assert.equal(good.status, 'completed');
  assert.equal(good.wikiRetrieval?.engine, 'hybrid');
  assert.equal(good.citations[0].quote, quote);
  duringCall = () => writeFile(file, original.replace(quote, '在模型等待期间变更。'));
  const stale = await ask();
  assert.equal(stale.error?.code, 'ANSWER_BASIS_CHANGED');
  assert.deepEqual(stale.citations, []);
  assert(f.index.isDirty);
  await writeFile(file, original);
  assert(await f.index.reconcileOnStartup());
  await f.index.backfillMissingEmbeddings();
  duringCall = () => rm(path.join(f.root, 'knowledge', 'raw', 'reports', raw.id + '.md'));
  const deniedId = randomUUID();
  await assert.rejects(service.ask({ requestId: deniedId, question: q }), { code: 'KNOWLEDGE_SOURCE_MISSING' });
  assert.deepEqual((await service.get(deniedId))?.citations, []);
  assert.deepEqual((await f.retrieve(q)).records, []);
});

test('hybrid cache follows edits, deletions, reopen, rebuild and dimensions observed by an online query', async (t) => {
  const f = await fixture(t);
  const query = 'unshared phrase';
  let page = await f.wiki.create(wikiInput('Cache status', 'first version'));
  assert.equal((await f.retrieve(query)).degradeReason, 'embedding_unconfigured');
  f.enable();
  await f.index.backfillMissingEmbeddings();
  assert.equal((await f.retrieve(query)).chunks[0].rawText, page.body);
  page = await f.wiki.update(page.id, page.revision, { ...page, body: 'edited version' });
  await f.index.backfillMissingEmbeddings();
  assert.equal((await f.retrieve(query)).chunks[0].rawText, 'edited version');
  await f.index.close();
  assert(await f.index.reconcileOnStartup());
  assert.equal((await f.retrieve(query)).chunks[0].pageId, page.id);
  await f.index.rebuildAll();
  await f.index.backfillMissingEmbeddings();
  assert.equal((await f.retrieve(query)).chunks[0].pageId, page.id);
  f.wire.handle((res, req) => reply(res, req, 3));
  const changedDimension = await f.retrieve(query);
  assert.equal(changedDimension.engine, 'sqlite_fts');
  assert.equal(changedDimension.degradeReason, 'embedding_version_changed');
  await f.index.backfillMissingEmbeddings();
  assert.equal(f.index.read(readEmbeddingLock).dimensions, 3);
  assert.equal((await f.retrieve(query)).engine, 'hybrid');
  const noDispatch = f.wire.requests.length;
  const protectedQuery = await retrieveKnowledgeContextDetailed(
    f.wiki,
    f.rawStore,
    [{ title: 'Cache status', content: 'restricted raw content', tags: [] }],
    {
      authorizeQuery: () => {
        throw new Error('current source policy denies');
      },
    },
  );
  assert.equal(protectedQuery.degradeReason, 'embedding_source_unavailable');
  assert.equal(f.wire.requests.length, noDispatch);
  const knownSecret = await f.retrieve('synthetic-credential');
  assert.equal(knownSecret.degradeReason, 'embedding_secret_blocked');
  assert.equal(f.wire.requests.length, noDispatch);
  await f.wiki.delete(page.id, page.revision);
  const empty = await f.retrieve(query);
  assert.equal(empty.degradeReason, 'embedding_empty');
  assert.equal(f.wire.requests.length, noDispatch);
});

test('query failures preserve lexical context and formal saves, with chained failure diagnostics and pure rollback', async (t) => {
  const f = await fixture(t);
  await f.wiki.create(wikiInput('lexicalmark', 'lexicalmark local evidence'));
  f.enable(f.wire.provider({ EMBEDDING_QUERY_TIMEOUT_MS: '85' }));
  await f.index.backfillMissingEmbeddings();
  f.wire.handle((res, req) => {
    if (req.input[0].startsWith('标题:')) reply(res, req);
  });
  const hung = f.retrieve('lexicalmark');
  const written = await f.wiki.create(wikiInput('Still writable', 'formal save during offline query'));
  assert(await f.wiki.get(written.id));
  const timedOut = await hung;
  assert.equal(timedOut.engine, 'sqlite_fts');
  assert.equal(timedOut.degradeReason, 'embedding_timeout');
  assert.equal(timedOut.chunks.length, 1);
  assert.equal(f.index.isDirty, false);
  await f.index.backfillMissingEmbeddings();
  for (const handler of [(res: ServerResponse) => res.writeHead(500).end(), (res: ServerResponse) => res.destroy()]) {
    f.wire.handle(handler);
    const fallback = await f.retrieve('lexicalmark');
    assert.equal(fallback.engine, 'sqlite_fts');
    assert.equal(fallback.degradeReason, 'embedding_error');
    assert.equal(fallback.chunks.length, 1);
  }
  f.wire.handle((res) => {
    f.index.read((db) => db.exec('DROP TABLE chunks_fts'));
    res.writeHead(503).end();
  });
  const chained = await f.retrieve('lexicalmark');
  assert.equal(chained.engine, 'legacy_scan');
  assert.equal(chained.degradeReason, 'embedding_error -> sqlite_error');
  assert.equal(chained.records.length, 1);
  f.wire.handle(reply);
  await f.index.rebuildAll();
  await f.index.backfillMissingEmbeddings();
  const previous = process.env.SEARCH_ENGINE;
  const before = f.wire.requests.length;
  try {
    process.env.SEARCH_ENGINE = 'sqlite_fts';
    const keywordOnly = await f.retrieve('lexicalmark');
    assert.equal(keywordOnly.engine, 'sqlite_fts');
    assert.equal(keywordOnly.degraded, false);
    await f.wiki.create(wikiInput('Rollback write', 'keyword-only save'));
    await f.index.backfillMissingEmbeddings();
    process.env.SEARCH_ENGINE = 'legacy_scan';
    await f.index.close();
    await rm(f.index.databaseFile);
    const legacy = await f.retrieve('lexicalmark');
    assert.equal(legacy.engine, 'legacy_scan');
    assert.equal(legacy.degraded, false);
    assert.equal(legacy.records.length, 1);
    assert.equal(f.wire.requests.length, before);
  } finally {
    if (previous === undefined) delete process.env.SEARCH_ENGINE;
    else process.env.SEARCH_ENGINE = previous;
  }
});

test(
  'source authorization excludes missing, restricted and recursively derived pages from actual outbound inputs',
  { timeout: 8_000 },
  async (t) => {
    const f = await fixture(t);
    const raw = await f.rawStore.createMeetingRegistration({
      id: randomUUID(),
      importedAt: new Date().toISOString(),
      title: 'Synthetic meeting',
      sourceName: 'test',
      tags: [],
      body: 'meeting raw contents',
      origin: {
        kind: 'meeting',
        meeting_id: randomUUID(),
        import_id: randomUUID(),
        original_sha256: 'a'.repeat(64),
        registered_confidentiality: 'Internal',
        processing_policy: 'meeting_local_only',
      },
    });
    const safe = await f.wiki.create(wikiInput('Safetitle', 'safemark 本地公开说明。'));
    const denied = await f.wiki.create(wikiInput('Private', 'restrictedmark 受限说明。'));
    const missing = await f.wiki.create(wikiInput('Missing', 'missingmark 不存在来源。'));
    const derived = await f.wiki.create(wikiInput('Derived', 'derivedmark 受限继承。'));
    await f.wiki.withLock(async () => {
      await f.wiki.writePageLocked({ ...denied, sources: [raw.record.id] });
      await f.wiki.writePageLocked({ ...missing, sources: [randomUUID()] });
      await f.wiki.writePageLocked({
        ...derived,
        answerDerivations: [
          {
            answerId: randomUUID(),
            answerRevision: 1,
            wikiIds: [denied.id],
            rawIds: [],
            manualWikiIds: [],
            containsInference: false,
          },
        ],
      });
    });
    f.enable();
    await f.index.backfillMissingEmbeddings();
    const sent = f.wire.requests.flatMap(({ input }) => input);
    assert.deepEqual(sent, [embeddingInput(safe.title, safe.title, 'mixed', safe.body)]);
    assert.deepEqual(f.index.getEmbeddingStatus(), {
      enabled: true,
      embeddingVer: 'openai-compatible:synthetic-a:2',
      totalChunks: 4,
      embeddedChunks: 1,
      pendingChunks: 3,
      isBackfilling: false,
      lastError: 'EMBEDDING_SOURCE_UNAVAILABLE',
    });
    assert.equal((await f.retrieve('safemark')).engine, 'hybrid');
    assert.equal(f.index.isDirty, false);
  },
);

test(
  'incremental reuse compares the full outbound input and versions bind endpoint, model and actual dimensions',
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t);
    const body = `## 来源事实\n\nretentionmark ${'原话逐字内容。'.repeat(35)}\n\n## 推断\n\nchangeone ${'归纳内容。'.repeat(45)}`;
    let page = await f.wiki.create(wikiInput('Stable title', body));
    f.enable();
    await f.index.backfillMissingEmbeddings();
    const initial = f.rows();
    assert.equal(initial.length, 2);
    assert(initial.every(({ vector }) => vector?.length === 8));
    f.wire.requests.length = 0;
    page = await f.wiki.update(page.id, page.revision, { ...page, body: body.replace('changeone', 'changetwo') });
    await f.index.backfillMissingEmbeddings();
    assert.deepEqual(f.rows()[0].vector, initial[0].vector);
    assert.deepEqual(f.wire.requests.flatMap(({ input }) => input).length, 1);
    assert.match(f.wire.requests[0].input[0], /changetwo/);
    f.wire.requests.length = 0;
    await f.wiki.update(page.id, page.revision, { ...page, title: 'Updated title' });
    await f.index.backfillMissingEmbeddings();
    assert(f.wire.requests.flatMap(({ input }) => input).every((input) => input.startsWith('标题: Updated title\n')));
    assert.equal(f.wire.requests.flatMap(({ input }) => input).length, 2);
    const oldGeneration = f.index.read(readEmbeddingLock);
    const alternateDestination = await endpoint(t);
    f.enable(alternateDestination.provider());
    await f.index.backfillMissingEmbeddings();
    assert.equal(alternateDestination.requests.flatMap(({ input }) => input).length, 2);
    assert.notEqual(f.index.read(readEmbeddingLock).identity, oldGeneration.identity);
    f.enable(f.wire.provider({ EMBEDDING_MODEL: 'synthetic-b', EMBEDDING_DIMENSIONS: '3' }));
    await f.index.close();
    assert.equal(await f.index.reconcileOnStartup(), true);
    await f.index.backfillMissingEmbeddings();
    assert(
      f.rows().every(({ vector, version }) => version === 'openai-compatible:synthetic-b:3' && vector?.length === 12),
    );
    assert.equal(f.index.read(readEmbeddingLock).dimensions, 3);
    assert.equal(f.index.isDirty, false);
    assert.equal((await f.retrieve('retentionmark')).engine, 'hybrid');
    const row = f.index.read((db) =>
      db
        .prepare<[], { chunkId: string; pageId: string; fileHash: string; filePath: string; input: string }>(
          `SELECT chunk_id AS chunkId, pages.page_id AS pageId, file_hash AS fileHash, file_path AS filePath, '' AS input
     FROM chunks JOIN pages ON pages.page_id = chunks.page_id LIMIT 1`,
        )
        .get()!,
    );
    const view = new Float32Array([7, 0, 1, 0, 8]).subarray(1, 4);
    f.index.read((db) => writeEmbeddings(db, 'openai-compatible:synthetic-b:3', [row], [view], new Set([row.pageId])));
    assert(f.rows().some(({ vector }) => vector && decodeEmbedding(vector, 3)?.every((value, i) => value === view[i])));
    assert.equal(decodeEmbedding(Buffer.from([0, 0, 0]), 3), undefined);
    const unaligned = Buffer.alloc(13).subarray(1);
    Buffer.from(view.buffer, view.byteOffset, view.byteLength).copy(unaligned);
    assert.deepEqual(decodeEmbedding(unaligned, 3), view);
  },
);

function holdNextResponse(wire: Awaited<ReturnType<typeof endpoint>>) {
  return new Promise<() => void>((resolve) => {
    wire.handle((res, req) => resolve(() => reply(res, req)));
  });
}

test(
  'a hung request leaves formal create/update/delete and confirmed commits responsive, with stale writes discarded',
  { timeout: 12_000 },
  async (t) => {
    const f = await fixture(t);
    const page = await f.wiki.create(wikiInput('Concurrent edits', 'oldmark 旧摘要。'));
    const raw = await f.rawStore.create({
      title: '渠道覆盖新资料',
      sourceType: 'report',
      sourceName: '合成数据',
      tags: [],
      body: '2026年渠道覆盖120家，按签约门店口径。',
    });
    const accepted = await f.accept(await f.generate(raw.id));
    const gate = holdNextResponse(f.wire);
    f.enable();
    const first = f.index.backfillMissingEmbeddings();
    const release = await gate;
    assert.equal(f.index.getEmbeddingStatus().isBackfilling, true);
    const changed = await f.wiki.update(page.id, page.revision, { ...page, body: 'newmark 新摘要。' });
    assert.equal((await f.retrieve('newmark')).chunks[0].pageId, page.id);
    assert.equal((await f.retrieve('oldmark')).chunks.length, 0);
    const temporary = await f.wiki.create(wikiInput('Concurrent create', 'discardmark 删除样本。'));
    await f.wiki.delete(temporary.id, temporary.revision);
    await f.wiki.delete(changed.id, changed.revision);
    const confirmation = await f.confirm(accepted);
    assert.equal(confirmation.manifest.status, 'completed');
    assert.equal((await f.retrieve('签约门店')).engine, 'sqlite_fts');
    assert.equal(f.wire.requests.length, 1);
    assert.equal(f.index.backfillMissingEmbeddings(), first);
    f.wire.handle(reply);
    release();
    await first;
    assert(!f.rows().some((r) => [page.id, temporary.id].includes(r.pageId)));
    assert(f.rows().some((r) => r.raw.includes('按签约门店口径') && r.vector));
    assert(
      f.wire.requests
        .slice(1)
        .flatMap(({ input }) => input)
        .every((text) => !/oldmark|newmark|discardmark/.test(text)),
    );
    assert.equal(f.index.getEmbeddingStatus().pendingChunks, 0);
  },
);

test(
  'in-flight model switches and out-of-band edits are rejected; provider errors preserve FTS and allow retry',
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t);
    const page = await f.wiki.create(wikiInput('Distinct title', 'distinctmark 召回样本。'));
    const gate = holdNextResponse(f.wire);
    f.enable();
    const first = f.index.backfillMissingEmbeddings();
    const release = await gate;
    const file = path.join(f.root, 'knowledge', 'wiki', page.id + '.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('召回样本', '外部修改'));
    f.enable(f.wire.provider({ EMBEDDING_MODEL: 'replacement', EMBEDDING_DIMENSIONS: '3' }));
    f.wire.handle(reply);
    release();
    await first;
    assert.equal(f.rows()[0].vector, null);
    assert.equal(f.wire.requests.length, 1);
    assert.equal(f.index.read(readEmbeddingLock).model, 'replacement');
    f.wire.handle((res) => res.writeHead(500).end('error echo must be kept private'));
    assert.equal(await f.index.reconcileOnStartup(), true);
    await f.index.backfillMissingEmbeddings();
    assert.equal(f.wire.requests.filter(({ model }) => model === 'replacement').length, 2);
    assert.equal(f.index.getEmbeddingStatus().lastError, 'EMBEDDING_HTTP_500');
    assert.equal(f.index.getEmbeddingStatus().pendingChunks, 1);
    assert.equal(f.index.isDirty, false);
    assert.equal((await f.retrieve('distinctmark')).engine, 'sqlite_fts');
    f.wire.handle(reply);
    await f.index.backfillMissingEmbeddings();
    assert.equal(f.index.getEmbeddingStatus().lastError, null);
    assert.equal(f.rows()[0].version, 'openai-compatible:replacement:3');
    assert.match(f.rows()[0].raw, /外部修改/);
    assert.equal((await f.index.rebuildAll()).pagesIndexed, 1);
    await f.index.backfillMissingEmbeddings();
    assert.equal(f.index.getEmbeddingStatus().pendingChunks, 0);
  },
);

test(
  'server enables startup and incremental embedding from explicit isolated configuration',
  { timeout: 30_000 },
  async (t) => {
    const f = await fixture(t);
    const startup = await f.wiki.create(wikiInput('Startup sample', 'startupmarker 初始化样本。'));
    await f.index.close();
    const portProbe = createServer();
    await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
    const port = (portProbe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => portProbe.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    const env = withoutInheritedEmbeddings(
      Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_LLM_|SEARCH_ENGINE$)/iu.test(key))),
    );
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...env,
        FMCG_PORT: String(port),
        FMCG_DATA_DIR: f.root,
        FMCG_LLM_CONFIG_FILE: path.join(f.root, 'missing.env'),
        FMCG_LLM_BASE_URL: f.wire.baseUrl,
        FMCG_LLM_API_KEY: 'synthetic-credential',
        FMCG_LLM_MODEL: 'production-chat-stub',
        EMBEDDING_MODEL: 'production-smoke',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finished = once(child, 'exit');
    let logs = '';
    child.stdout.on('data', (chunk) => {
      logs += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      logs += String(chunk);
    });
    try {
      for (let attempt = 0; !logs.includes(`API: ${base}`); attempt++) {
        assert(child.exitCode === null && attempt < 160, logs);
        await setTimeout(100);
      }
      const response = await fetch(`${base}/api/wiki`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wikiInput('Production smoke', 'productionmarker 正式入口样本。')),
        signal: AbortSignal.timeout(5000),
      });
      const created = (await response.json()) as { id: string };
      assert.equal(response.status, 201, JSON.stringify(created));
      for (let attempt = 0; f.wire.requests.length < 2 || !logs.includes('inputCount'); attempt++) {
        assert(child.exitCode === null && attempt < 80, logs);
        await setTimeout(100);
      }
      const db = openSearchDatabase(f.index.databaseFile, { readonly: true });
      try {
        const indexed = db.prepare<[string], { version: string }>(
          'SELECT embedding_ver AS version FROM chunks WHERE page_id = ?',
        );
        for (const id of [startup.id, created.id]) {
          for (let attempt = 0; !indexed.get(id)?.version; attempt++) {
            assert(child.exitCode === null && attempt < 80, logs);
            await setTimeout(100);
          }
          assert.equal(indexed.get(id)?.version, 'openai-compatible:production-smoke:2');
        }
      } finally {
        db.close();
      }
      let answerCalls = 0;
      f.wire.handleChat(({ model, messages }) => {
        answerCalls++;
        assert.equal(model, 'production-chat-stub');
        const { wiki } = JSON.parse(messages.find(({ role }) => role === 'user')!.content);
        const chunk = wiki.find(({ id }: { id: string }) => id === startup.id).chunks[0];
        assert.equal(chunk.rawText, startup.body);
        return {
          version: 1,
          needsRaw: [],
          sections: [{ kind: 'fact', text: startup.body, citationIds: ['startup-citation'] }],
          citations: [
            {
              id: 'startup-citation',
              kind: 'wiki',
              recordId: startup.id,
              quote: startup.body,
              start: chunk.startOffset,
              end: chunk.endOffset,
            },
          ],
        };
      });
      const question = 'semanticprobe';
      const answerResponse = await fetch(`${base}/api/knowledge/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: randomUUID(), question }),
        signal: AbortSignal.timeout(5000),
      });
      const answer = await answerResponse.json();
      assert.equal(answerResponse.status, 200, JSON.stringify(answer));
      assert.equal(answer.status, 'completed', JSON.stringify(answer));
      assert.equal(answer.wikiRetrieval.engine, 'hybrid');
      assert.equal(answer.citations[0].quote, startup.body);
      assert.equal(answerCalls, 1);
      assert(f.wire.requests.some(({ input }) => input[0] === question));
      assert(f.wire.requests.every(({ model }) => model === 'production-smoke'));
      assert.match(logs, /\[search-embedding-usage\]/);
      assert(!logs.includes('synthetic-credential'));
    } finally {
      child.kill();
      await finished;
    }
  },
);

test(
  'server process rolls back hybrid to FTS to Legacy without the SQLite file and verifies the same citation',
  { timeout: 90_000 },
  async (t) => {
    const f = await fixture(t);
    const title = '仓配回滚演练';
    const quote = '临时货架交接按签收件数登记。';
    const page = await f.wiki.create(wikiInput(title, '## 来源事实\n\n' + quote));
    const file = path.join(f.root, 'knowledge', 'wiki', page.id + '.md');
    const checksum = async () =>
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
    const before = await checksum();
    await f.index.close();
    let answers = 0;
    let expectChunks = false;
    f.wire.handleChat(({ messages }) => {
      const input = JSON.parse(messages.find(({ role }) => role === 'user')!.content);
      assert.equal(input.stage, 'knowledge_answer');
      assert.equal(input.wiki.length, 1);
      const [sent] = input.wiki;
      assert.equal(sent.id, page.id);
      assert.equal('chunks' in sent, expectChunks);
      const chunk = expectChunks ? sent.chunks[0] : undefined;
      const offset = (chunk?.rawText ?? sent.body).indexOf(quote);
      assert(offset >= 0);
      const start = (chunk?.startOffset ?? 0) + offset;
      answers++;
      return {
        version: 1,
        needsRaw: [],
        sections: [{ kind: 'fact', text: quote, citationIds: ['c1'] }],
        citations: [{ id: 'c1', kind: 'wiki', recordId: page.id, quote, start, end: start + quote.length }],
      };
    });
    const cleanEnv = withoutInheritedEmbeddings(
      Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_LLM_|NODE_OPTIONS$)/iu.test(key))),
    );
    const shutdown =
      'data:text/javascript,' +
      encodeURIComponent("process.once('message', () => { process.disconnect(); process.emit('SIGTERM'); });");
    for (const engine of ['hybrid', 'sqlite_fts', 'legacy_scan'] as const) {
      expectChunks = engine !== 'legacy_scan';
      if (engine === 'legacy_scan') {
        await rm(f.index.databaseFile);
        await assert.rejects(access(f.index.databaseFile), { code: 'ENOENT' });
      }
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const base = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--import', shutdown, 'server/index.ts'], {
        env: {
          ...cleanEnv,
          SEARCH_ENGINE: engine,
          SEARCH_VECTOR_MIN_SCORE: '0.42',
          FMCG_PORT: String(port),
          FMCG_DATA_DIR: f.root,
          FMCG_LLM_CONFIG_FILE: path.join(f.root, 'missing.env'),
          FMCG_LLM_BASE_URL: f.wire.baseUrl,
          FMCG_LLM_API_KEY: 'synthetic-credential',
          FMCG_LLM_MODEL: 'production-chat-stub',
          EMBEDDING_MODEL: 'rollback-embedding',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      });
      const finished = once(child, 'close');
      let out = '';
      let err = '';
      assert(child.stdout && child.stderr);
      child.stdout.on('data', (bytes) => {
        out += String(bytes);
      });
      child.stderr.on('data', (bytes) => {
        err += String(bytes);
      });
      try {
        for (let i = 0; !out.includes(`API: ${base}`); i++) {
          assert(child.exitCode === null && i < 180, out + err);
          await setTimeout(100);
        }
        if (engine === 'hybrid') {
          const db = openSearchDatabase(f.index.databaseFile, { readonly: true });
          try {
            const check = db.prepare<[], { version: string | null }>('SELECT embedding_ver AS version FROM chunks');
            for (let i = 0; !check.get()?.version; i++) {
              assert(child.exitCode === null && i < 60, out + err);
              await setTimeout(100);
            }
          } finally {
            db.close();
          }
        }
        const get = async (route: string) => {
          const response = await fetch(base + route, { signal: AbortSignal.timeout(5000) });
          assert.equal(response.status, 200);
          return response.json();
        };
        assert.equal((await get('/api/health')).ok, true);
        assert.equal((await get('/api/wiki/' + page.id)).body, page.body);
        const question = engine === 'hybrid' ? 'semanticonly' : title;
        const response = await fetch(base + '/api/knowledge/answers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: randomUUID(), question }),
          signal: AbortSignal.timeout(15_000),
        });
        assert.equal(response.status, 200);
        const answer = await response.json();
        assert.equal(answer.status, 'completed');
        assert.equal(answer.wikiRetrieval.engine, engine);
        assert.equal(answer.wikiRetrieval.degraded, false);
        const citation = answer.citations[0];
        assert.equal(citation.quote, quote);
        assert.equal(page.body.slice(citation.start, citation.end), quote);
        assert.equal(await checksum(), before);
        if (engine === 'legacy_scan') await assert.rejects(access(f.index.databaseFile), { code: 'ENOENT' });
        else await access(f.index.databaseFile);
        assert.equal(err, '');
      } finally {
        if (child.connected) child.send('stop');
        const kill = AbortSignal.timeout(10_000);
        const onTimeout = () => child.kill();
        kill.addEventListener('abort', onTimeout, { once: true });
        const [code] = await finished;
        kill.removeEventListener('abort', onTimeout);
        assert.equal(code, 0, out + err);
      }
    }
    assert.equal(answers, 3);
    assert.deepEqual(
      f.wire.requests.map(({ input }) => input.length),
      [1, 1],
    );
    assert.equal(f.wire.requests[1].input[0], 'semanticonly');
  },
);

test(
  'ordinary direct HTTP tests send no request to an inherited embedding endpoint',
  { timeout: 30_000 },
  async (t) => {
    const f = await fixture(t);
    const env = withoutInheritedEmbeddings(
      Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(FMCG_LLM_|SEARCH_ENGINE$|NODE_TEST_CONTEXT$)/iu.test(key)),
      ),
    );
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', '--test-name-pattern=E04-01 HTTP', 'tests/llm-http.test.ts'],
      {
        env: {
          ...env,
          FMCG_DATA_DIR: f.root,
          FMCG_LLM_CONFIG_FILE: path.join(f.root, 'missing.env'),
          EMBEDDING_BASE_URL: f.wire.baseUrl,
          EMBEDDING_MODEL: 'host-should-be-ignored',
          EMBEDDING_API_KEY: 'synthetic-credential',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const [exit] = await once(child, 'close');
    assert.equal(exit, 0, output);
    assert.match(output, /E04-01 HTTP/);
    assert.equal(f.wire.requests.length, 0);
  },
);
