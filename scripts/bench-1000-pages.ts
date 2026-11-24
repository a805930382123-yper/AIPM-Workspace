import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { retrieveKnowledgeContextDetailed } from '../services/llm/knowledge-maintenance.ts';
import { RawStore } from '../services/raw/store.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { WikiStore, type WikiRecord } from '../services/wiki/store.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-1a-bench-'));
const index = new WikiSearchIndexer(root);
const raws = new RawStore(root);
const wiki = new WikiStore(root, raws, undefined, index);
const legacy = new WikiStore(root, raws);
const pageCount = 1_000;
const plannedQueries = ['终端动销', '月度结算', '分销覆盖', '补货', '门店执行'];
const marker = (n: number) => 'qsku' + String(n % 25).padStart(2, '0') + 'x';
try {
  const directory = path.join(root, 'knowledge', 'wiki');
  await mkdir(directory, { recursive: true });
  for (let start = 0; start < pageCount; start += 50) {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const number = start + i;
        const id = 'a1100000-0000-4000-8000-' + String(number).padStart(12, '0');
        const page: WikiRecord = {
          id,
          title: '终端营运周报 ' + number,
          type: 'concept',
          domain: 'fmcg',
          category: 'channel',
          sources: [],
          tags: ['快消', '终端'],
          aliases: [],
          revision: 1,
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'D',
          review_status: 'unreviewed',
          created: '2026-11-24',
          updated: '2026-11-24',
          body: ['终端动销', '月度结算', '分销覆盖', '补货', '门店执行', '陈列']
            .map(
              (heading, section) =>
                `## ${heading}\n\n${section === number % 6 ? marker(number) : ''} 本期按签约门店核对台账。\n\n` +
                '业务员按实际到店生效日期逐点登记货架陈列和渠道库存，区域组复核进货批次后记录差异。'.repeat(5),
            )
            .join('\n\n'),
        };
        return writeFile(path.join(directory, id + '.md'), wiki.pageContent(page));
      }),
    );
  }
  const build = await index.rebuildAll();
  assert.equal(build.pagesIndexed, pageCount);
  assert.equal(build.chunksIndexed, pageCount * 6);
  const driver = index.read((db) => db.prepare('SELECT sqlite_version() AS version').get()) as { version: string };
  console.log(
    `Node ${process.version}, SQLite ${driver.version}, ${build.pagesIndexed} 页 / ${build.chunksIndexed} 块`,
  );
  console.log(`全量重建 ${build.durationMs.toFixed(2)} ms`);

  const compare = [];
  const samples = 30;
  for (const [engine, store] of [
    ['sqlite_fts', wiki],
    ['legacy_scan', legacy],
  ] as const) {
    process.env.SEARCH_ENGINE = engine;
    const times: number[] = [];
    for (let i = -5; i < samples; i++) {
      const n = i + 5;
      const title = `${marker(n)} ${plannedQueries[n % plannedQueries.length]}`;
      const started = performance.now();
      const result = await retrieveKnowledgeContextDetailed(store, raws, [{ title, content: '', tags: [] }]);
      const elapsed = performance.now() - started;
      assert.equal(result.engine, engine);
      assert.equal(result.degraded, false);
      assert(result.context.length > 0, title);
      if (i >= 0) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    compare.push({
      engine,
      samples,
      meanMs: times.reduce((total, time) => total + time, 0) / samples,
      p95Ms: times[Math.ceil(0.95 * samples) - 1],
    });
  }
  console.table(compare);
  assert(build.durationMs < 5_000 && compare[0].meanMs < 50 && compare[0].p95Ms < 50);
} finally {
  await index.close();
  await rm(root, { recursive: true, force: true });
}
