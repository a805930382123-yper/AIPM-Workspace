import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import { BUDGETS } from '../services/prompt-ai/service.ts';
import { RawStore } from '../services/raw/store.ts';
import type { EmbeddingProvider } from '../services/search/embedding-provider.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import {
  countEmbeddings,
  openSearchIndex,
  readEmbeddingLock,
  setEmbeddingLock,
} from '../services/search/sqlite-store.ts';
import { WikiVectorCache } from '../services/search/vector-retriever.ts';
import { assertWikiSourcesAllowed } from '../services/wiki/source-lineage.ts';
import { WikiStore, type WikiRecord } from '../services/wiki/store.ts';

const gc = globalThis.gc;
assert(gc, 'Usage: node --expose-gc --import tsx scripts/bench-vector-1000.ts');
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-1b-bench-'));
const dimensions = 1536;
const pages = 1000;
const chunks = 6000;
const topics = 25;
const samples = 50;
const topicWord = (topic: number) => 'qsku' + String(topic).padStart(2, '0') + 'x';
const pageId = (n: number) => 'a1b00000-0000-4000-8000-' + String(n).padStart(12, '0');
let seed = 0x7b823dd8;
function vector(topic: number) {
  const values = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    values[i] = ((seed >>> 0) / 2 ** 31 - 1) / Math.sqrt(dimensions);
  }
  values[topic] += 1;
  const norm = Math.hypot(...values);
  return values.map((component) => component / norm);
}

const inputs = Array.from({ length: samples }, (_, i) => vector(i % topics));
const queries = new Map(inputs.map((vec, i) => [`${topicWord(i % topics)} 终端周报 ${i}`, vec]));
const provider: EmbeddingProvider = {
  providerName: 'synthetic',
  modelName: 'seeded-unit-vectors',
  identity: 'local-benchmark',
  configuredDimensions: dimensions,
  batchSize: 32,
  getVersionKey: (size) => `synthetic:seeded-unit-vectors:${size}`,
  async embedTexts() {
    throw new Error('Benchmark must read complete persisted vectors');
  },
  async embedQuery(query, options) {
    const vec = queries.get(query);
    assert(vec, 'Unexpected benchmark query');
    // Execute the real query authorization callback without a socket.
    await options?.dispatch?.(() => Promise.resolve(new Response(null, { status: 204 })));
    return {
      vector: vec,
      dimensions,
      usage: { provider: this.providerName, model: this.modelName, inputCount: 1, durationMs: 0 },
    };
  },
};

const raws = new RawStore(root);
const index = new WikiSearchIndexer(root, {
  provider: async () => provider,
  authorize: (page) => assertWikiSourcesAllowed(wiki, raws, page),
});
const wiki: WikiStore = new WikiStore(root, raws, undefined, index);
try {
  const directory = path.join(root, 'knowledge', 'wiki');
  await mkdir(directory, { recursive: true });
  for (let offset = 0; offset < pages; offset += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const n = offset + i;
        const page: WikiRecord = {
          id: pageId(n),
          title: `${topicWord(n % topics)} 终端周报 ${n}`,
          type: 'concept',
          domain: 'fmcg',
          category: 'channel',
          sources: n === 1 ? [pageId(pages)] : [],
          tags: [],
          aliases: [],
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'D',
          review_status: 'unreviewed',
          revision: 1,
          created: '2026-11-24',
          updated: '2026-11-24',
          body: ['终端动销', '月度结算', '分销覆盖', '补货', '门店执行', '陈列']
            .map(
              (heading) =>
                `## ${heading}\n\n${topicWord(n % topics)} 按签约门店核对台账。\n\n` +
                '业务员按实际到店生效日期逐点登记货架陈列和渠道库存，区域组复核进货批次后记录差异。'.repeat(5),
            )
            .join('\n\n'),
        };
        return writeFile(path.join(directory, page.id + '.md'), wiki.pageContent(page));
      }),
    );
  }
  process.env.SEARCH_ENGINE = 'sqlite_fts';
  const build = await index.rebuildAll();
  assert.equal(build.pagesIndexed, pages);
  assert.equal(build.chunksIndexed, chunks);
  await index.backfillMissingEmbeddings();
  const sqlite = index.read((db) => {
    const version = provider.getVersionKey(dimensions);
    setEmbeddingLock(db, {
      provider: provider.providerName,
      model: provider.modelName,
      identity: provider.identity,
      dimensions,
      configuredDimensions: dimensions,
      version,
    });
    const put = db.prepare<[Buffer, string, string]>(
      'UPDATE chunks SET embedding = ?, embedding_ver = ? WHERE chunk_id = ?',
    );
    const rows = db
      .prepare<[], { id: string; page: string }>('SELECT chunk_id AS id, page_id AS page FROM chunks ORDER BY chunk_id')
      .all();
    db.transaction(() => {
      for (const { id, page } of rows) {
        const values = vector(Number(page.slice(-12)) % topics);
        put.run(Buffer.from(values.buffer, values.byteOffset, values.byteLength), version, id);
      }
    })();
    assert.deepEqual(countEmbeddings(db, readEmbeddingLock(db)), { totalChunks: chunks, embeddedChunks: chunks });
    return db.prepare<[], { version: string }>('SELECT sqlite_version() AS version').get()!.version;
  });
  await index.close();

  // Read through a new SQLite connection, with no retained write vectors.
  const db = openSearchIndex(index.databaseFile);
  const cache = new WikiVectorCache();
  const dot: number[] = [];
  try {
    gc();
    const before = process.memoryUsage();
    const start = performance.now();
    cache.reloadFromStore(db);
    const loadMs = performance.now() - start;
    gc();
    const after = process.memoryUsage();
    assert.equal(cache.rank(inputs[0], {}, -1, chunks).length, chunks);
    const mib = (bytes: number) => +(bytes / 2 ** 20).toFixed(2);
    console.table({
      corpus: { pages, chunks, dimensions, node: process.version, sqlite },
      sqliteLoad: {
        loadMs: +loadMs.toFixed(2),
        rssDeltaMiB: mib(after.rss - before.rss),
        heapUsedDeltaMiB: mib(after.heapUsed - before.heapUsed),
        arrayBufferDeltaMiB: mib(after.arrayBuffers - before.arrayBuffers),
        vectorPayloadMiB: mib(chunks * dimensions * 4),
      },
    });
    for (let i = -5; i < samples; i++) {
      const start = performance.now();
      const hits = cache.rank(inputs[(i + samples) % samples], {}, 0.42);
      const elapsed = performance.now() - start;
      assert.equal(hits.length, 30);
      if (i >= 0) dot.push(elapsed);
    }
  } finally {
    cache.clear();
    db.close();
  }

  process.env.SEARCH_ENGINE = 'hybrid';
  process.env.SEARCH_VECTOR_MIN_SCORE = '0.42';
  process.env.SEARCH_RRF_K = '60';
  assert(await index.reconcileOnStartup());
  await index.backfillMissingEmbeddings();
  assert.deepEqual(index.getEmbeddingStatus().lastError, null);
  gc();
  const hybrid: number[] = [];
  const phrases = [...queries.keys()];
  for (let i = -5; i < samples; i++) {
    const n = (i + samples) % samples;
    const topic = n % topics;
    // Alternate the normal 48K search and a six-page 12K selection.
    const pageIds = n % 2 ? Array.from({ length: 6 }, (_, j) => pageId(topic + j * topics)) : undefined;
    const query = [{ title: phrases[n], content: '', tags: [] }];
    const characters = pageIds ? BUDGETS.totalWikiChars : 48_000;
    let authorizationChecks = 0;
    const start = performance.now();
    const result = await retrieveKnowledgeContextDetailed(wiki, raws, query, {
      pageIds,
      includeSources: Boolean(pageIds),
      characters,
      perPageCharacters: pageIds ? BUDGETS.perWikiChars : undefined,
      authorizeQuery: () => {
        authorizationChecks++;
      },
    });
    const elapsed = performance.now() - start;
    assert.equal(result.engine, 'hybrid');
    assert.equal(result.degraded, false);
    assert.equal(authorizationChecks, 2);
    assert(
      result.chunks.some(({ ftsRank }) => ftsRank !== undefined),
      'Missing FTS hits',
    );
    assert(
      result.chunks.some(({ vectorRank }) => vectorRank !== undefined),
      'Missing vector hits',
    );
    assert(JSON.stringify(result.context).length <= characters);
    assert(
      result.context.every((page) => page.id !== pageId(1)),
      'Disallowed source was sent',
    );
    if (pageIds) {
      assert(result.context.every((page) => pageIds.includes(page.id)));
      assert(result.context.every((page) => JSON.stringify(page).length <= BUDGETS.perWikiChars));
    }
    if (i >= 0) hybrid.push(elapsed);
  }
  const stats = (times: number[]) => ({
    samples: times.length,
    meanMs: times.reduce((sum, time) => sum + time, 0) / times.length,
    p95Ms: [...times].sort((a, b) => a - b)[Math.ceil(0.95 * times.length) - 1],
  });
  const comparison = { dot: stats(dot), hybrid: stats(hybrid) };
  console.table(comparison);
  console.table({
    hybridUnscoped: stats(hybrid.filter((_, i) => i % 2 === 0)),
    hybridSelected: stats(hybrid.filter((_, i) => i % 2 !== 0)),
  });
  assert(comparison.dot.meanMs < 15, 'Mean dot-scan must be below 15 ms');
  assert(comparison.hybrid.meanMs < 30, 'Mean local hybrid retrieval must be below 30 ms');
} finally {
  await index.close();
  await rm(root, { recursive: true, force: true });
}
