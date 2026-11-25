import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import {
  embeddingInput,
  OpenAiEmbeddingProvider,
  resolveEmbeddingConfig,
  type EmbeddingUsageMeta,
} from '../services/search/embedding-provider.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
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
  const server = createServer(async (req, res) => {
    const body: Buffer[] = [];
    for await (const bytes of req) body.push(bytes);
    const request = JSON.parse(Buffer.concat(body).toString()) as WireRequest;
    requests.push(request);
    assert.equal(req.url, '/v1/embeddings');
    assert.equal(req.headers.authorization, 'Bearer synthetic-credential');
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
    assert.equal((await f.retrieve('safemark')).engine, 'sqlite_fts');
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
    assert.equal((await f.retrieve('retentionmark')).engine, 'sqlite_fts');
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
