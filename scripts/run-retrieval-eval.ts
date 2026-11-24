import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { longBody, longPages } from '../evals/fixtures/batch-1a-long.ts';
import baseline from '../evals/retrieval-baseline.json' with { type: 'json' };
import { retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { BUDGETS, PromptAiService } from '../services/prompt-ai/service.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { RawStore } from '../services/raw/store.ts';
import { quoteInWikiContext, type ModelWikiContext } from '../services/search/fts-retriever.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { assertWikiSourcesAllowed } from '../services/wiki/source-lineage.ts';
import { parseWikiMarkdown, WikiStore } from '../services/wiki/store.ts';

const rootArg = process.argv[2];
assert(rootArg, 'Usage: node --import tsx scripts/run-retrieval-eval.ts <local data snapshot> [output.md]');
const source = path.resolve(rootArg);
const report = path.resolve(process.argv[3] ?? 'evals/reports/batch-1a-baseline.md');
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-1a-eval-'));
const index = new WikiSearchIndexer(root);
const raws = new RawStore(root);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const types = ['A', 'B', 'C', 'D', 'E'] as const;
const engines = ['legacy_scan', 'sqlite_fts'] as const;
const k = baseline.scoring.k;
const queries = (title: string) => [{ title, content: '', tags: [] }];
type Case = (typeof baseline.cases)[number];
type Gold = Case['gold'][number];
type WirePage = ModelWikiContext[number] | { id: string; excerpt: string };
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
try {
  const digests = await Promise.all(
    ['evals/retrieval-baseline.json', 'evals/fixtures/batch-1a-long.ts', 'scripts/run-retrieval-eval.ts'].map(
      async (file) => [file, hash(await readFile(file))],
    ),
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

  const legacy = new WikiStore(root, raws);
  const fts = new WikiStore(root, raws, undefined, index);
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
    await writeFile(path.join(root, 'knowledge', 'wiki', sample.id + '.md'), fts.pageContent(record));
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

  assert(await index.reconcileOnStartup());
  const scores = { legacy_scan: new Map<string, Grade>(), sqlite_fts: new Map<string, Grade>() };
  const promptCounts = new Map<string, Record<string, number>>();
  for (const [engine, wiki] of [
    [engines[0], legacy],
    [engines[1], fts],
  ] as const) {
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
      if (test.selection) {
        capture = undefined;
        start = performance.now();
        const result = await prompt.generate(
          {
            taskName: test.question,
            taskType: '生成提纲',
            role: '产品经理',
            goal: '按已确认的任务整理提纲',
            context: '根据选中的资料回答',
            input: '已选择的 Wiki',
            tasks: '提取相关口径',
            constraints: '保留来源语境',
            output: '提纲',
          },
          test.selection,
        );
        assert.deepEqual(result.wikiRetrieval, { engine, degraded: false });
        assert(capture);
        const sent: WirePage[] = capture;
        assert(sent.every((page) => test.selection!.includes(page.id)));
        const counted = result.contextBudget.used;
        assert(counted <= BUDGETS.totalWikiChars);
        assert(
          engine === 'sqlite_fts'
            ? sent.every((page) => JSON.stringify(page).length <= BUDGETS.perWikiChars)
            : result.relatedWiki.every(({ excerpt }) => excerpt.length <= BUDGETS.perWikiChars),
        );
        promptCounts.set(test.id, { ...promptCounts.get(test.id), [engine]: counted });
        scores[engine].set(test.id, grade(test, sent, content, elapsed));
      } else {
        start = performance.now();
        const result = await retrieveKnowledgeContextDetailed(wiki, raws, queries(test.question));
        elapsed = performance.now() - start;
        assert.equal(result.engine, engine);
        assert.equal(result.degraded, false);
        assert(JSON.stringify(result.context).length <= 48_000);
        scores[engine].set(test.id, grade(test, result.context, content, elapsed));
      }
    }
  }

  const anchors = [];
  for (const page of longPages) {
    const body = records.get(page.id)!.body;
    for (const [heading, quote, question] of page.anchors) {
      const result = await retrieveKnowledgeContextDetailed(fts, raws, queries(question));
      assert.equal(result.engine, 'sqlite_fts');
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
      anchors.push({ page: page.id, heading, start, end, valid });
    }
  }

  const table = [
    '| 类别 | 引擎 | Hit@' + k + ' | 章节定位 | E 类误召回 | 平均耗时 ms | P95 ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  const comparison = new Map<string, number>();
  for (const category of types) {
    const cases = baseline.cases.filter(({ id }) => id.startsWith(category));
    const measured = [];
    for (const engine of engines) {
      const rows = cases.map(({ id }) => scores[engine].get(id)!);
      const hit = rows.filter((row) => row.hit).length;
      const heading = rows.filter((row) => row.heading).length;
      const errors = rows.filter((row) => row.falseRecall).length;
      const times = rows.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
      const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
      const p95 = times[Math.ceil(0.95 * times.length) - 1];
      const isNegative = category === 'E';
      table.push(
        `| ${category} | ${engine} | ${isNegative ? '—' : pct(hit, rows.length)} | ${isNegative ? '—' : pct(heading, rows.length)} | ${isNegative ? pct(errors, rows.length) : '—'} | ${show(mean)} | ${show(p95)} |`,
      );
      measured.push(isNegative ? errors : hit);
    }
    comparison.set(category, measured[1] - measured[0]);
  }

  const nAnchors = anchors.filter(({ valid }) => valid).length;
  const bMisses = baseline.cases.filter(({ id }) => id.startsWith('B') && !scores.sqlite_fts.get(id)!.hit);
  const driver = index.read((db) => db.prepare('SELECT sqlite_version() AS version').get()) as { version: string };
  const detail = [
    '| 题号 | 引擎 | 命中 | 定位 | 误召回 | 页数 | JSON 字符 | 耗时 ms | 命中证据 | 送出上下文 SHA-256 |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |',
    ...baseline.cases.flatMap(({ id }) =>
      engines.map((engine) => {
        const row = scores[engine].get(id)!;
        const isNegative = id.startsWith('E');
        const flag = (value: boolean) => (value ? '是' : '否');
        return `| ${id} | ${engine} | ${isNegative ? '—' : flag(row.hit)} | ${isNegative ? '—' : flag(row.heading)} | ${isNegative ? flag(row.falseRecall) : '—'} | ${row.pages} | ${row.chars} | ${show(row.elapsedMs)} | ${row.evidence.join('、') || '—'} | ${row.contextSha256} |`;
      }),
    ),
  ];
  const section = (lines: string[]) => lines.join('\n');
  const lines = [
    '# Batch 1A 检索对照快照',
    '',
    `Node ${process.version}，SQLite ${driver.version}。冻结语料包含 ${baseline.corpus.wikiFiles.length} 篇原始正式 Wiki、${baseline.corpus.rawFiles.length} 份关联 Raw 和 ${longPages.length} 篇合成长页。`,
    '',
    ...digests.map(([file, sha256]) => '- `' + file + '` SHA-256 `' + sha256 + '`'),
    '',
    ...Object.values(baseline.scoring)
      .slice(1)
      .map((rule) => '- ' + rule),
    '',
    'A/B/C/E 计时至详细接口返回。D 计时从正式 Prompt 生成入口至进程内模拟 Provider 接收实际请求，包含选页核验、组装和序列化。P95 使用最近秩。两路均核实引擎且没有发生降级，真实模型请求为零。',
    '',
    '## 分类对照',
    '',
    section(table),
    '',
    `A/C/D 命中数变化分别为 ${comparison.get('A')}、${comparison.get('C')}、${comparison.get('D')}，E 误召回次数变化为 ${comparison.get('E')}。`,
    '',
    '## 逐题对照',
    '',
    section(detail),
    '',
    '## Prompt 字符预算',
    '',
    '六个选页及顺序在题库固定。Legacy 按摘录字符计量，SQLite 按实际 Wiki JSON 计量；逐题表同时列出两路的实际 JSON 字符数。',
    '',
    '| 题号 | Legacy 摘录字符 | SQLite JSON 字符 |',
    '| --- | ---: | ---: |',
    ...[...promptCounts].map(([id, counts]) => `| ${id} | ${counts.legacy_scan} | ${counts.sqlite_fts} |`),
    '',
    `## 长页定位 ${nAnchors}/9`,
    '',
    '三篇合成 Wiki 正文均超过 48,000 字符。每个位置核对已发送块的章节、原文切片和生产引文检查。',
    '',
    '| 夹具尾号 | 标题路径 | 正文 UTF-16 坐标 | 逐字定位 |',
    '| --- | --- | --- | --- |',
    ...anchors.map(
      ({ page, heading, start, end, valid }) =>
        `| ${page.slice(-1)} | ${heading} | ${start}–${end} | ${valid ? '通过' : '失败'} |`,
    ),
    '',
    '## B 类 SQLite 漏检',
    '',
    ...(bMisses.length ? bMisses.map(({ id, question }) => `- ${id} ${question}`) : ['无。']),
    '',
  ];
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, lines.join('\n'));
  console.log(section(table));
  console.log(`长页 ${nAnchors}/9，B 类漏检 ${bMisses.map(({ id }) => id).join('、') || '无'}`);
  if (['A', 'C', 'D'].some((category) => comparison.get(category)! <= 0) || comparison.get('E')! > 0 || nAnchors !== 9)
    process.exitCode = 1;
} finally {
  await index.close();
  await rm(root, { recursive: true, force: true });
}
