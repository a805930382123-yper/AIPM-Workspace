import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { longBody, longPages } from '../evals/fixtures/batch-1a-long.ts';
import baseline from '../evals/retrieval-baseline.json' with { type: 'json' };
import { loadLlmConfig } from '../services/llm/config.ts';
import { retrieveKnowledgeContextDetailed, type RetrievalStatus } from '../services/llm/knowledge-maintenance.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { BUDGETS, PromptAiService } from '../services/prompt-ai/service.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { RawStore } from '../services/raw/store.ts';
import {
  OpenAiEmbeddingProvider,
  resolveEmbeddingConfig,
  type EmbeddingProvider,
  type EmbeddingUsageMeta,
} from '../services/search/embedding-provider.ts';
import {
  queryPageNames,
  quoteInWikiContext,
  rankWikiChunks,
  type ModelWikiContext,
  type RetrievedChunkItem,
} from '../services/search/fts-retriever.ts';
import { rankHybridChunks } from '../services/search/hybrid-retriever.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { readEmbeddingLock } from '../services/search/sqlite-store.ts';
import { assertWikiSourcesAllowed } from '../services/wiki/source-lineage.ts';
import { parseWikiMarkdown, WikiStore } from '../services/wiki/store.ts';
import { FROZEN_FTS, judgeRetrievalQuality } from './retrieval-quality-gate.ts';

const [rootArg, ...args] = process.argv.slice(2);
assert(
  rootArg && !rootArg.startsWith('--'),
  'Usage: node --import tsx scripts/run-retrieval-eval.ts <local data snapshot> [output.md] [--live] [--threshold=0.42] [--fts-repair]',
);
const source = path.resolve(rootArg);
const outputs = args.filter((arg) => !arg.startsWith('--'));
const thresholds = args.filter((arg) => arg.startsWith('--threshold=')).map((arg) => arg.slice(12));
assert(
  args.every(
    (arg) => !arg.startsWith('--') || ['--live', '--fts-repair'].includes(arg) || arg.startsWith('--threshold='),
  ),
);
assert(outputs.length <= 1 && thresholds.length <= 1);
const requestedLive = args.includes('--live');
const sqliteReference = args.includes('--fts-repair') ? 'fts-repair' : '1a';
const report = path.resolve(
  outputs[0] ??
    (sqliteReference === 'fts-repair'
      ? `evals/results/batch-1b-fts-repair${requestedLive ? '-live' : ''}.md`
      : 'evals/reports/batch-1b-hybrid.md'),
);
const threshold = thresholds.length ? Number(thresholds[0] || NaN) : 0.42;
assert(Number.isFinite(threshold) && threshold >= -1 && threshold <= 1, '阈值必须为 -1 至 1 的数字');
const main =
  requestedLive &&
  process.env.EMBEDDING_MODEL?.trim() &&
  !(process.env.EMBEDDING_BASE_URL?.trim() && process.env.EMBEDDING_API_KEY?.trim())
    ? await loadLlmConfig({ filePath: path.resolve(process.env.FMCG_LLM_CONFIG_FILE || '.env.local') })
    : undefined;
const config = requestedLive ? resolveEmbeddingConfig(process.env, main) : null;
const skip = requestedLive
  ? '缺少有效的真实 Embedding 模型、地址或凭证，跳过 Hybrid 语义评测。'
  : '本轮执行离线评测，跳过真实 Hybrid 语义评测。';
if (!config) console.log(skip);
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-1b-eval-'));
const raws = new RawStore(root);
type Usage = EmbeddingUsageMeta & { error?: string };
const usage: Record<'formal' | 'fixtures' | 'query', Usage[]> = { formal: [], fixtures: [], query: [] };
let phase: keyof typeof usage = 'formal';
class EvalEmbeddingProvider extends OpenAiEmbeddingProvider {
  last?: { query: string; result: Awaited<ReturnType<EmbeddingProvider['embedQuery']>> };
  replaying = false;

  override async embedQuery(query: string, options?: Parameters<EmbeddingProvider['embedQuery']>[1]) {
    if (this.replaying) {
      assert(this.last?.query === query, '诊断与正式调用的查询文本不同');
      return this.last.result;
    }
    this.last = { query, result: await super.embedQuery(query, options) };
    return this.last.result;
  }
}
const embeddings = config && new EvalEmbeddingProvider(config, (item, error) => usage[phase].push({ ...item, error }));
const index = new WikiSearchIndexer(
  root,
  embeddings
    ? {
        provider: async () => embeddings,
        authorize: (page) => assertWikiSourcesAllowed(fts, raws, page),
        withSourceLock: (work) => fts.withLock(work),
      }
    : undefined,
);
const legacy = new WikiStore(root, raws);
const fts: WikiStore = new WikiStore(root, raws, undefined, index);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const types = ['A', 'B', 'C', 'D', 'E'] as const;
const engines = ['legacy_scan', 'sqlite_fts', 'hybrid'] as const;
const k = baseline.scoring.k;
const queries = (title: string) => [{ title, content: '', tags: [] }];
type Case = (typeof baseline.cases)[number];
type Gold = Case['gold'][number];
type WirePage = ModelWikiContext[number] | { id: string; excerpt: string };
type Diagnostics = {
  ftsGold?: number;
  rawVectorGold?: number;
  rawVectorGoldScore?: number;
  vectorGold?: number;
  fusedGold?: RetrievedChunkItem;
  sentGold?: RetrievedChunkItem;
  topCosine?: number;
};
type Grade = {
  hit: boolean;
  heading: boolean;
  falseRecall: boolean;
  evidence: string[];
  elapsedMs: number;
  pages: number;
  chars: number;
  contextSha256: string;
};

// Legacy Prompt reorders paragraphs. Check the headings that actually precede
// the exact anchor in the excerpt, using the source only to identify the anchor.
function textHasHeading(text: string, quote: string, expected: string) {
  const headings: string[] = [];
  const positions = [...text.matchAll(/^ {0,3}(#{1,6})[ \t]+(.+)$/gmu)];
  for (const [i, match] of positions.entries()) {
    const depth = match[1].length;
    headings.length = Math.min(depth, headings.length);
    if (depth > 1) headings[depth] = match[2].replace(/[ \t]+#+[ \t]*$/u, '').trim();
    const end = positions[i + 1]?.index ?? text.length;
    if (headings.filter(Boolean).join(' > ') === expected && text.slice(match.index, end).includes(quote)) return true;
  }
  return false;
}

function grade(test: Case, context: WirePage[], quotes: Map<Gold, string>, elapsedMs: number): Grade {
  const selected = context.slice(0, k);
  const texts = (item: WirePage) =>
    'chunks' in item ? item.chunks.map((chunk) => chunk.rawText) : ['excerpt' in item ? item.excerpt : item.body];
  const matched = test.gold.flatMap((gold) => {
    const page = selected.find(({ id }) => id === gold.pageId);
    if (!page) return [];
    const anchor = quotes.get(gold)!;
    if ('chunks' in page) {
      const containing = page.chunks.filter(
        (chunk) =>
          gold.start >= chunk.startOffset &&
          gold.end <= chunk.endOffset &&
          chunk.rawText.slice(gold.start - chunk.startOffset, gold.end - chunk.startOffset) === anchor,
      );
      if (!containing.length) return [];
      const heading = containing.some((chunk) => chunk.label.includes(' | 章节: ' + gold.headingPath + ' | 属性: '));
      return [{ gold, heading }];
    }
    const text = texts(page)[0];
    return text.includes(anchor) ? [{ gold, heading: textHasHeading(text, anchor, gold.headingPath) }] : [];
  });
  const wire = JSON.stringify(context);
  return {
    hit: matched.length > 0,
    heading: matched.some(({ heading }) => heading),
    falseRecall: !test.gold.length && selected.some((page) => texts(page).some((part) => part.trim())),
    evidence: matched.map(({ gold, heading }) => `${gold.pageId.slice(0, 8)}:${gold.start}${heading ? ' ✓' : ''}`),
    elapsedMs,
    pages: context.length,
    chars: wire.length,
    contextSha256: hash(wire),
  };
}

const pct = (n: number, total: number) => `${n}/${total} (${((100 * n) / total).toFixed(1)}%)`;
const show = (n: number) => n.toFixed(2);
const tokens = (rows: Usage[]) =>
  !rows.length || rows.some((row) => row.totalTokens === undefined)
    ? '未完整提供'
    : rows.reduce((sum, row) => sum + row.totalTokens!, 0);
const diagnostics = new Map<string, Diagnostics>();
const stats = (times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  return [times.reduce((sum, value) => sum + value, 0) / times.length, sorted[Math.ceil(0.95 * times.length) - 1]];
};
let vectorChecked = 0;
function verifyVectorQuotes(
  context: WirePage[],
  candidates: RetrievedChunkItem[],
  records: Map<string, ReturnType<typeof parseWikiMarkdown>>,
) {
  const sentChunks = context.flatMap((page) => ('chunks' in page ? page.chunks : []));
  const sentIds = new Set(sentChunks.map((chunk) => chunk.chunkId));
  const model = context.filter((page): page is ModelWikiContext[number] => 'chunks' in page);
  for (const chunk of candidates) {
    if (chunk.hitSource !== 'vector' || !sentIds.has(chunk.chunkId)) continue;
    const { pageId, startOffset, endOffset, rawText } = chunk;
    assert.equal(records.get(pageId)!.body.slice(startOffset, endOffset), rawText);
    assert(quoteInWikiContext(model, pageId, startOffset, endOffset, rawText));
    vectorChecked++;
  }
}
try {
  const digests = await Promise.all(
    [
      'evals/retrieval-baseline.json',
      'evals/fixtures/batch-1a-long.ts',
      'scripts/run-retrieval-eval.ts',
      'scripts/retrieval-quality-gate.ts',
    ].map(async (file) => [file, hash(await readFile(file))]),
  );
  console.table(digests.map(([file, sha256]) => ({ file, sha256 })));
  assert.equal(new Set(baseline.cases.map(({ id }) => id)).size, 25);
  assert.deepEqual(
    types.map((category) => baseline.cases.filter(({ id }) => id.startsWith(category)).length),
    [7, 5, 5, 3, 5],
  );
  const manifest = [...baseline.corpus.wikiFiles, ...baseline.corpus.rawFiles];
  const records = new Map<string, ReturnType<typeof parseWikiMarkdown>>();
  for (const { file, sha256 } of manifest) {
    const bytes = await readFile(path.join(source, file));
    assert.equal(hash(bytes), sha256, 'Local snapshot differs from the frozen manifest: ' + file);
    const destination = path.join(root, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    if (file.startsWith('knowledge/wiki/')) {
      const page = parseWikiMarkdown(bytes.toString('utf8'));
      records.set(page.id, page);
    }
  }

  for (const sample of longPages) {
    assert(!records.has(sample.id));
    const body = longBody(sample);
    assert(body.length > 48_000);
    const page = {
      id: sample.id,
      title: sample.title,
      body,
      type: 'concept',
      domain: 'fmcg',
      category: 'channel',
      sources: [],
      tags: [],
      aliases: [],
      knowledge_status: 'ai_organized',
      confidence: 'medium',
      source_level: 'D',
      review_status: 'unreviewed',
      revision: 1,
      created: '2026-11-24',
      updated: '2026-11-24',
    } as const;
    const record = { ...page, sources: [], tags: [], aliases: [] };
    records.set(sample.id, record);
  }
  const content = new Map<Gold, string>();
  for (const test of baseline.cases) {
    assert.equal(!!test.selection, test.id.startsWith('D'));
    assert.equal(!test.gold.length, test.id.startsWith('E'));
    for (const gold of test.gold) {
      const page = records.get(gold.pageId);
      assert(page, test.id + ' gold page is missing');
      assert(!test.selection || test.selection.includes(page.id), test.id + ' gold page is outside Prompt selection');
      await assertWikiSourcesAllowed(fts, raws, page);
      const quote = page.body.slice(gold.start, gold.end);
      assert(quote.length > 0 && hash(quote) === gold.sha256, test.id + ' gold anchor mismatch');
      assert(textHasHeading(page.body, quote, gold.headingPath), test.id + ' source heading mismatch');
      content.set(gold, quote);
    }
  }

  process.env.SEARCH_ENGINE = 'sqlite_fts';
  process.env.SEARCH_VECTOR_MIN_SCORE = String(threshold);
  process.env.SEARCH_RRF_K = '60';
  assert(await index.reconcileOnStartup());
  await index.backfillMissingEmbeddings();
  const formalChunks = index.getEmbeddingStatus().totalChunks;
  let formalMs = 0;
  let dimensions = 0;
  let fixturesMs = 0;
  const verifyBackfill = () => {
    const status = index.getEmbeddingStatus();
    assert.equal(status.lastError, null, '补算失败');
    assert.equal(status.pendingChunks, 0, '语料向量补算未完整');
    assert(status.embeddingVer);
  };
  if (embeddings) {
    const batch = embeddings.batchSize;
    console.log(`真实 Embedding ${embeddings.modelName}，95 页 ${formalChunks} 块，批量上限 ${batch}，开始补算。`);
    process.env.SEARCH_ENGINE = 'hybrid';
    const start = performance.now();
    await index.backfillMissingEmbeddings();
    formalMs = performance.now() - start;
    verifyBackfill();
    dimensions = index.read((db) => readEmbeddingLock(db).dimensions);
  }
  for (const { id } of longPages) {
    await writeFile(path.join(root, 'knowledge', 'wiki', id + '.md'), fts.pageContent(records.get(id)!));
  }
  process.env.SEARCH_ENGINE = 'sqlite_fts';
  assert(await index.reconcileOnStartup());
  await index.backfillMissingEmbeddings();
  const fixtureChunks = index.getEmbeddingStatus().totalChunks - formalChunks;
  if (embeddings) {
    phase = 'fixtures';
    process.env.SEARCH_ENGINE = 'hybrid';
    const start = performance.now();
    await index.backfillMissingEmbeddings();
    fixturesMs = performance.now() - start;
    verifyBackfill();
    phase = 'query';
  }
  const scores: Record<RetrievalStatus['engine'], Map<string, Grade>> = {
    legacy_scan: new Map(),
    sqlite_fts: new Map(),
    hybrid: new Map(),
  };
  const promptCounts = new Map<string, Record<string, number>>();
  for (const [engine, wiki] of [
    [engines[0], legacy],
    [engines[1], fts],
    [engines[2], fts],
  ] as const) {
    if (engine === 'hybrid' && !embeddings) continue;
    process.env.SEARCH_ENGINE = engine;
    const prompts = new PromptStore(root, wiki);
    await prompts.initialize();
    let capture: WirePage[] | undefined;
    let elapsed = 0;
    let start = 0;
    const provider: LlmProvider = {
      name: 'in-process',
      model: 'retrieval-eval-capture',
      async complete({ user }) {
        elapsed = performance.now() - start;
        capture = (JSON.parse(user) as { relatedWiki: WirePage[] }).relatedWiki;
        const text = JSON.stringify({
          version: 1,
          name: '离线证据核验',
          category: 'customer',
          scenario: '核验',
          sections: [{ heading: '任务目标', content: '归纳资料' }],
          inputRequirements: 'Wiki',
          outputRequirements: '提纲',
          examples: '',
          tags: [],
        });
        return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
      },
    };
    const prompt = new PromptAiService(root, wiki, prompts, () => provider, raws);
    await prompt.initialize();
    for (const test of baseline.cases) {
      let wire: WirePage[];
      let query = queries(test.question);
      const scope = test.selection ? { pageIds: test.selection, includeSources: true } : {};
      if (embeddings) embeddings.last = undefined;
      if (test.selection) {
        const brief = {
          taskName: test.question,
          taskType: '生成提纲',
          role: '产品经理',
          goal: '按已确认的任务整理提纲',
          context: '根据选中的资料回答',
          input: '已选择的 Wiki',
          tasks: '提取相关口径',
          constraints: '保留来源语境',
          output: '提纲',
        };
        capture = undefined;
        start = performance.now();
        const result = await prompt.generate(brief, test.selection);
        assert.deepEqual(result.wikiRetrieval, { engine, degraded: false });
        assert(capture);
        const sent: WirePage[] = capture;
        assert(sent.every((page) => test.selection!.includes(page.id)));
        const counted = result.contextBudget.used;
        assert(counted <= BUDGETS.totalWikiChars);
        assert(
          engine !== 'legacy_scan'
            ? sent.every((page) => JSON.stringify(page).length <= BUDGETS.perWikiChars)
            : result.relatedWiki.every(({ excerpt }) => excerpt.length <= BUDGETS.perWikiChars),
        );
        promptCounts.set(test.id, { ...promptCounts.get(test.id), [engine]: counted });
        wire = sent;
        query = [{ title: brief.taskName, tags: [], content: [brief.goal, brief.context, brief.tasks].join(' ') }];
      } else {
        start = performance.now();
        const result = await retrieveKnowledgeContextDetailed(wiki, raws, query);
        elapsed = performance.now() - start;
        assert.equal(result.engine, engine);
        assert.equal(result.degraded, false);
        assert(JSON.stringify(result.context).length <= 48_000);
        wire = result.context;
      }
      scores[engine].set(test.id, grade(test, wire, content, elapsed));
      if (engine === 'hybrid' && embeddings) {
        // Replay the one real vector already used by the production query. This keeps
        // raw cosine and pre-budget ranking out of the timed path and makes no second request.
        const queryText = embeddings.last?.query;
        assert(queryText);
        embeddings.replaying = true;
        try {
          const lexical = rankWikiChunks(index, query, scope);
          const raw = await index.rankVectorChunks(queryText, queryPageNames(query), scope, -1);
          const vector = raw.filter(({ chunk }) => chunk.score >= threshold);
          const fused = await rankHybridChunks(index, query, scope, (reason) => assert.fail(reason));
          const sentIds = new Set(
            wire.slice(0, k).flatMap((page) => ('chunks' in page ? page.chunks.map(({ chunkId }) => chunkId) : [])),
          );
          const goldMatch = ({ pageId, startOffset, endOffset, rawText }: RetrievedChunkItem) =>
            test.gold.some(
              (gold) =>
                gold.pageId === pageId &&
                gold.start >= startOffset &&
                gold.end <= endOffset &&
                rawText.slice(gold.start - startOffset, gold.end - startOffset) === content.get(gold),
            );
          const ftsGold = lexical.findIndex(({ chunk }) => goldMatch(chunk));
          const rawVectorGold = raw.findIndex(({ chunk }) => goldMatch(chunk));
          const vectorGold = vector.findIndex(({ chunk }) => goldMatch(chunk));
          const fusedGold = fused.find(({ chunk }) => goldMatch(chunk))?.chunk;
          const sentGold = fused.find(({ chunk }) => sentIds.has(chunk.chunkId) && goldMatch(chunk))?.chunk;
          assert.equal(Boolean(sentGold), scores.hybrid.get(test.id)!.hit, '融合复算与实际发送证据不一致');
          assert([...sentIds].every((id) => fused.some(({ chunk }) => chunk.chunkId === id)));
          diagnostics.set(test.id, {
            ftsGold: ftsGold < 0 ? undefined : ftsGold + 1,
            rawVectorGold: rawVectorGold < 0 ? undefined : rawVectorGold + 1,
            rawVectorGoldScore: raw[rawVectorGold]?.chunk.score,
            vectorGold: vectorGold < 0 ? undefined : vectorGold + 1,
            fusedGold,
            sentGold,
            topCosine: raw[0]?.chunk.score,
          });
          verifyVectorQuotes(
            wire,
            fused.map(({ chunk }) => chunk),
            records,
          );
        } finally {
          embeddings.replaying = false;
        }
      }
    }
  }

  const anchors = [];
  for (const engine of ['sqlite_fts', 'hybrid'] as const) {
    if (engine === 'hybrid' && !embeddings) continue;
    process.env.SEARCH_ENGINE = engine;
    for (const page of longPages) {
      const body = records.get(page.id)!.body;
      for (const [heading, quote, question] of page.anchors) {
        const result = await retrieveKnowledgeContextDetailed(fts, raws, queries(question));
        assert.equal(result.engine, engine);
        assert.equal(result.degraded, false);
        const start = body.indexOf(quote);
        const end = start + quote.length;
        const chunk = result.chunks.find(
          (chunk) =>
            chunk.pageId === page.id &&
            chunk.headingPath === heading &&
            chunk.startOffset <= start &&
            end <= chunk.endOffset &&
            chunk.rawText === body.slice(chunk.startOffset, chunk.endOffset),
        );
        const valid = start >= 0 && !!chunk && quoteInWikiContext(result.context, page.id, start, end, quote);
        if (engine === 'hybrid') verifyVectorQuotes(result.context, result.chunks, records);
        anchors.push({ engine, page: page.id, heading, start, end, valid });
      }
    }
  }

  const table = [
    '| 类别 | 引擎 | Hit@' + k + ' | 章节定位 | E 类误召回 | 平均耗时 ms | P95 ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const category of types) {
    const cases = baseline.cases.filter(({ id }) => id.startsWith(category));
    for (const engine of engines) {
      if (!scores[engine].size) {
        table.push(`| ${category} | ${engine} | 待验证 | 待验证 | 待验证 | — | — |`);
        continue;
      }
      const rows = cases.map(({ id }) => scores[engine].get(id)!);
      const hit = rows.filter((row) => row.hit).length;
      const heading = rows.filter((row) => row.heading).length;
      const errors = rows.filter((row) => row.falseRecall).length;
      const [mean, p95] = stats(rows.map(({ elapsedMs }) => elapsedMs));
      const isNegative = category === 'E';
      table.push(
        `| ${category} | ${engine} | ${isNegative ? '—' : pct(hit, rows.length)} | ${isNegative ? '—' : pct(heading, rows.length)} | ${isNegative ? pct(errors, rows.length) : '—'} | ${show(mean)} | ${show(p95)} |`,
      );
    }
  }

  const nAnchors = anchors.filter(({ engine, valid }) => engine === 'sqlite_fts' && valid).length;
  const nHybridAnchors = anchors.filter(({ engine, valid }) => engine === 'hybrid' && valid).length;
  const bMisses = FROZEN_FTS.bMisses;
  const driver = index.read((db) => db.prepare('SELECT sqlite_version() AS version').get()) as { version: string };
  const detail = [
    '| 题号 | 引擎 | 命中 | 定位 | 误召回 | 页数 | JSON 字符 | 耗时 ms | 命中证据 | 送出上下文 SHA-256 |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |',
    ...baseline.cases.flatMap(({ id }) =>
      engines.map((engine) => {
        const row = scores[engine].get(id);
        if (!row) return `| ${id} | ${engine} | 待验证 | 待验证 | 待验证 | — | — | — | — | — |`;
        const isNegative = id.startsWith('E');
        const flag = (value: boolean) => (value ? '是' : '否');
        return `| ${id} | ${engine} | ${isNegative ? '—' : flag(row.hit)} | ${isNegative ? '—' : flag(row.heading)} | ${isNegative ? flag(row.falseRecall) : '—'} | ${row.pages} | ${row.chars} | ${show(row.elapsedMs)} | ${row.evidence.join('、') || '—'} | ${row.contextSha256} |`;
      }),
    ),
  ];
  const positive = [...diagnostics].filter(([id]) => !id.startsWith('E'));
  const shortlisted = positive.filter(([, row]) => row.ftsGold || row.vectorGold);
  const grayLosses = shortlisted.filter(([, row]) => !row.fusedGold);
  const budgetLosses = shortlisted.filter(([, row]) => row.fusedGold && !row.sentGold);
  const budgetRate = shortlisted.length ? budgetLosses.length / shortlisted.length : undefined;
  const bRows = bMisses.map((id) => {
    const row = diagnostics.get(id);
    const lexical = scores.sqlite_fts.get(id)!.hit ? '命中' : '漏检';
    if (!row) return `| ${id} | ${lexical} | 待验证 | — | — | — | — | — |`;
    const chunk = row.sentGold ?? row.fusedGold;
    const where = row.sentGold
      ? '实际送出'
      : row.fusedGold
        ? '预算后丢失'
        : row.vectorGold
          ? 'RRF 前灰区裁切'
          : row.rawVectorGold
            ? '最低阈值裁切'
            : '两路均未进入 Top-30';
    return `| ${id} | ${lexical} | ${where} | ${row.ftsGold ?? '—'} | ${row.vectorGold ?? '—'} | ${row.rawVectorGold ?? '—'} | ${row.rawVectorGoldScore?.toFixed(6) ?? '—'} | ${chunk?.hitSource ?? '—'} |`;
  });
  const eCases = baseline.cases.filter(({ id }) => id.startsWith('E'));
  const eRows = eCases.map(({ id }) => {
    const row = diagnostics.get(id);
    const fts = scores.sqlite_fts.get(id)!.falseRecall;
    return `| ${id} | ${fts ? '是' : '否'} | ${row?.topCosine?.toFixed(6) ?? '—'} | ${row ? (scores.hybrid.get(id)!.falseRecall ? '是' : '否') : '待验证'} |`;
  });
  const queryTimes = usage.query.filter((row) => !row.error).map(({ durationMs }) => durationMs);
  const [queryMean, queryP95] = stats(queryTimes);
  const hybridFalseRecalls = eCases.filter(({ id }) => scores.hybrid.get(id)?.falseRecall).length;
  const eLimit = FROZEN_FTS.falseRecalls.length;
  const quality = judgeRetrievalQuality(
    { grades: scores.sqlite_fts, longAnchors: nAnchors },
    embeddings ? { grades: scores.hybrid, longAnchors: nHybridAnchors, vectorChecks: vectorChecked } : undefined,
    requestedLive,
    sqliteReference,
  );
  const section = (lines: string[]) => lines.join('\n');
  const lines = [
    '# Batch 1B 检索对照',
    '',
    embeddings ? `真实 Hybrid 质量门槛${quality.exitCode === 0 ? '通过' : '未通过'}。` : skip,
    '',
    `SQLite ${sqliteReference === '1a' ? '1A 历史冻结基线' : '本轮 FTS 修复预期（B1 新增命中及定位，其余沿用 1A）'}核对${quality.sqliteProblems.length ? '未通过' : '通过'}。`,
    ...quality.sqliteProblems.map((problem) => `- SQLite ${problem}。`),
    ...(quality.hybridProblems ?? []).map((problem) => `- Hybrid ${problem}。`),
    '',
    `Node ${process.version}，SQLite ${driver.version}。评分输入共 ${baseline.corpus.wikiFiles.length} 篇正式 Wiki、${baseline.corpus.rawFiles.length} 份关联 Raw、${longPages.length} 篇合成长页。正式 Wiki 为 ${formalChunks} 块，合成长页为 ${fixtureChunks} 块。逐文件校验了冻结清单的 SHA-256。`,
    '',
    ...digests.map(([file, sha256]) => '- `' + file + '` SHA-256 `' + sha256 + '`'),
    '- 1A 冻结评测器 SHA-256 `49c18fff8b8fddf2de8b25ea06c697be1057a2de88e62409de77713bfdf0dc59`，沿用其评分函数、题库、长页及 Prompt 入参。',
    '',
    ...Object.values(baseline.scoring)
      .slice(1)
      .map((rule) => '- ' + rule),
    '',
    'A/B/C/E 计时至详细接口返回。D 计时从正式 Prompt 生成入口至进程内捕获 Provider 接收实际请求，包含选页核验、组装和序列化。P95 使用最近秩。所有已评分结果均核实实际引擎和未降级状态。',
    '',
    '## Embedding 配置与开销',
    '',
    ...(embeddings
      ? [
          `- 模型 \`${embeddings.modelName}\`，实际维度 ${dimensions}。正式语料全量补算 ${show(formalMs)} ms，供方返回 Token 合计 ${tokens(usage.formal)}，发出 ${usage.formal.length} 次请求。`,
          `- 合成长页补算 ${show(fixturesMs)} ms，供方返回 Token 合计 ${tokens(usage.fixtures)}，发出 ${usage.fixtures.length} 次请求。`,
          `- 25 问及 9 个长页定位共 ${queryTimes.length} 次成功 Query Embedding，供方返回 Token 合计 ${tokens(usage.query)}。从发送至响应解码及归一化的平均/P95 为 ${show(queryMean)}/${show(queryP95)} ms。`,
        ]
      : ['- 真实模型、维度、建向量耗时、Token 和 Query Embedding 网络延迟待验证。真实模型请求数为 0。']),
    '',
    '## 分类对照',
    '',
    section(table),
    '',
    '## 逐题对照',
    '',
    section(detail),
    '',
    '## Prompt 字符预算',
    '',
    '六个选页及顺序在题库固定。Legacy 按摘录字符计量，SQLite 和 Hybrid 按实际 Wiki JSON 计量。逐题表同时列出送出的 JSON 字符数。',
    '',
    '| 题号 | Legacy 摘录字符 | SQLite JSON 字符 | Hybrid JSON 字符 |',
    '| --- | ---: | ---: | ---: |',
    ...[...promptCounts].map(
      ([id, counts]) => `| ${id} | ${counts.legacy_scan} | ${counts.sqlite_fts} | ${counts.hybrid ?? '待验证'} |`,
    ),
    '',
    '## 长页和逐字引用',
    '',
    `三篇合成 Wiki 正文均超过 48,000 字符。SQLite 九点定位 ${nAnchors}/9。Hybrid ${embeddings ? nHybridAnchors + '/9' : '待验证'}。已发送块核对章节、原文切片和生产引文检查。`,
    '',
    '| 引擎 | 夹具尾号 | 标题路径 | 正文 UTF-16 坐标 | 逐字定位 |',
    '| --- | --- | --- | --- | --- |',
    ...anchors.map(
      ({ engine, page, heading, start, end, valid }) =>
        `| ${engine} | ${page.slice(-1)} | ${heading} | ${start}–${end} | ${valid ? '通过' : '失败'} |`,
    ),
    '',
    embeddings
      ? `实际发出的纯向量块逐字核验 ${vectorChecked}/${vectorChecked}${vectorChecked ? '。' : '，本次未观察到纯向量出块。'}`
      : '真实 Hybrid 纯向量出块及逐字引文待验证。',
    '',
    '## 1A 的 B 类漏题复查',
    '',
    '| 题号 | SQLite | Hybrid 结果 | ftsRank | vectorRank | 阈值前向量排名 | vectorScore | hitSource |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...bRows,
    '',
    '## E 类负样本和阈值',
    '',
    `产品默认最低余弦为 0.42。实际阈值${embeddings ? '为 ' + threshold : '校准待验证'}。最高余弦取自阈值和 RRF 灰区裁切之前的允许范围。`,
    '',
    '| 题号 | SQLite 误召回 | 阈值前最高余弦 | Hybrid 误召回 |',
    '| --- | --- | ---: | --- |',
    ...eRows,
    '',
    ...(embeddings
      ? [
          `1A 冻结误召回门槛为 ${eLimit}/5。本轮 Hybrid ${hybridFalseRecalls}/5，${hybridFalseRecalls <= eLimit ? '满足' : '未满足，须重跑经授权的校准阈值'}。`,
          '',
        ]
      : []),
    '## Top-30 至最终预算',
    '',
    '分母为 A–D 中任一路 Top-30 含完整金标准锚点的题数，向量路应用本轮最低余弦阈值。分子为融合后仍有该锚点、实际发出的前 8 页却未包含它的题数。仅被最低阈值或融合灰区裁切的题目计入各自原因。',
    '',
    ...(embeddings
      ? [
          `- Top-30 命中 ${shortlisted.length}/${positive.length}，融合灰区漏失 ${grayLosses.map(([id]) => id).join('、') || '无'}。`,
          `- 最终预算漏失 ${budgetLosses.map(([id]) => id).join('、') || '无'}，占比 ${budgetRate === undefined ? '分母为零' : pct(budgetLosses.length, shortlisted.length)}。`,
          budgetRate === undefined
            ? '- 重排序判断待验证。'
            : budgetRate <= 0.2
              ? '- 按本次 20% 判据，RRF 已足够，无需引入重排序模型。'
              : '- 超过 20% 判据，以上漏失题纳入后续重排序评估。',
        ]
      : ['待真实 Hybrid 评测后计算，重排序判断待验证。']),
    '',
  ];
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, lines.join('\n'));
  console.log(section(table));
  const currentBMisses = [...FROZEN_FTS.b, ...bMisses].filter((id) => !scores.sqlite_fts.get(id)?.hit);
  console.log(`SQLite 长页 ${nAnchors}/9，本轮 B 类漏检 ${currentBMisses.join('、') || '无'}`);
  for (const problem of quality.sqliteProblems) console.log('SQLite 基线核对失败，' + problem);
  for (const problem of quality.hybridProblems ?? []) console.log('Hybrid 质量核对失败，' + problem);
  process.exitCode = quality.exitCode;
} finally {
  await index.close();
  await rm(root, { recursive: true, force: true });
}
