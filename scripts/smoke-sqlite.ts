import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openSearchDatabase } from '../services/search/sqlite-store.ts';

const pageCount = 1000;
const chunksPerPage = 6;
const queryCount = 20;
const topicCount = 25;
const maxWriteMs = 1500;
const maxQueryMeanMs = 50;
const bodyTokens = '门店 陈列 库存 促销 订单 分销 销量 复购 货架 品类 渠道 标价 退货 执行 门店 SKU '.repeat(12);

function runSmoke(filename: string) {
  const db = openSearchDatabase(filename);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE pages (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        raw_text TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        chunk_id UNINDEXED,
        page_id UNINDEXED,
        title_tokens,
        meta_tokens,
        body_tokens,
        tokenize = 'unicode61 remove_diacritics 0'
      );
    `);
    const journalMode = db.prepare<[], { journal_mode: string }>('PRAGMA journal_mode').get()?.journal_mode;
    const synchronous = db.prepare<[], { synchronous: number }>('PRAGMA synchronous').get()?.synchronous;
    const foreignKeys = db.prepare<[], { foreign_keys: number }>('PRAGMA foreign_keys').get()?.foreign_keys;
    assert.equal(journalMode, 'wal');
    assert.equal(synchronous, 1);
    assert.equal(foreignKeys, 1);

    const insertPage = db.prepare('INSERT INTO pages (id, title) VALUES (?, ?)');
    const insertChunk = db.prepare('INSERT INTO chunks (id, page_id, raw_text) VALUES (?, ?, ?)');
    const insertFts = db.prepare('INSERT INTO chunks_fts VALUES (?, ?, ?, ?, ?)');
    assert.throws(() => insertChunk.run(1, 1, '孤立记录'), /FOREIGN KEY constraint failed/);

    const writeStarted = performance.now();
    db.exec('BEGIN');
    for (let page = 1; page <= pageCount; page++) {
      const topic = `topic${page % topicCount}`;
      const title = `快消 门店 ${topic} page${page}`;
      insertPage.run(page, title);
      for (let chunk = 1; chunk <= chunksPerPage; chunk++) {
        const id = (page - 1) * chunksPerPage + chunk;
        const body = `${bodyTokens}chunk${id}${id === 2 ? ' 权重样本' : ''}`;
        insertChunk.run(id, page, body);
        insertFts.run(id, page, id === 1 ? `${title} 权重样本` : title, '渠道 动销 终端 监测', body);
      }
    }
    db.exec('COMMIT');
    const writeMs = performance.now() - writeStarted;

    const query = db.prepare<[string], { id: number; raw_text: string; score: number }>(`
      SELECT chunks.id, chunks.raw_text, bm25(chunks_fts, 0, 0, 6.0, 3.0, 1.0) AS score
      FROM chunks_fts
      JOIN chunks ON chunks.id = chunks_fts.chunk_id
      JOIN pages ON pages.id = chunks.page_id
      WHERE chunks_fts MATCH ?
      ORDER BY score, chunks.id
      LIMIT 30
    `);
    const topics = new Set<number>();
    while (topics.size < queryCount) topics.add(randomInt(topicCount));
    const lookupMs: number[] = [];
    for (const topic of topics) {
      const started = performance.now();
      const rows = query.all(`topic${topic}`);
      lookupMs.push(performance.now() - started);
      assert.equal(rows.length, 30);
    }
    const weighted = query.all('权重样本');
    assert.deepEqual(
      weighted.map((row) => row.id),
      [1, 2],
    );
    const [titleScore, bodyScore] = weighted.map((row) => row.score);
    assert(typeof titleScore === 'number' && typeof bodyScore === 'number' && titleScore < bodyScore && bodyScore < 0);

    const counts = db
      .prepare<[], { pages: number; chunks: number; ftsRows: number }>(
        `
      SELECT (SELECT count(*) FROM pages) AS pages,
             (SELECT count(*) FROM chunks) AS chunks,
             (SELECT count(*) FROM chunks_fts) AS ftsRows
    `,
      )
      .get();
    assert(counts);
    const { pages, chunks, ftsRows } = counts;
    assert.equal(pages, pageCount);
    assert.equal(chunks, pageCount * chunksPerPage);
    assert.equal(ftsRows, chunks);

    const meanQueryMs = lookupMs.reduce((sum, ms) => sum + ms, 0) / lookupMs.length;
    const p95QueryMs = lookupMs.sort((a, b) => a - b)[Math.ceil(0.95 * lookupMs.length) - 1];
    console.log(
      JSON.stringify(
        {
          driver: 'better-sqlite3',
          node: process.version,
          sqlite: db.prepare<[], { version: string }>('SELECT sqlite_version() AS version').get()?.version,
          journalMode,
          synchronous,
          foreignKeys,
          weightedBm25: true,
          pages,
          chunks,
          ftsRows,
          writeMs,
          queries: lookupMs.length,
          meanQueryMs,
          p95QueryMs,
        },
        null,
        2,
      ),
    );
    assert(writeMs < maxWriteMs, `SQLite write took ${writeMs.toFixed(2)} ms (threshold < ${maxWriteMs} ms)`);
    assert(
      meanQueryMs < maxQueryMeanMs,
      `SQLite mean query took ${meanQueryMs.toFixed(2)} ms (threshold < ${maxQueryMeanMs} ms)`,
    );
  } finally {
    db.close();
  }
}

const directory = mkdtempSync(path.join(tmpdir(), 'aipm-sqlite-smoke-'));
try {
  runSmoke(path.join(directory, 'smoke.sqlite'));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
