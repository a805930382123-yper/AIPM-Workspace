import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { promisify } from 'node:util';
import { acquireInstanceLock } from '../services/automation/instance-lock.ts';
import { WikiSearchIndexer } from '../services/search/indexer.ts';
import { openSearchDatabase } from '../services/search/sqlite-store.ts';
import { parseWikiMarkdown } from '../services/wiki/store.ts';

const FIRST = '00000000-0000-0000-0000-000000000001';
const SECOND = '00000000-0000-0000-0000-000000000002';
const THIRD = '00000000-0000-0000-0000-000000000003';
const cli = path.resolve(import.meta.dirname, '../scripts/rebuild-search-index.ts');

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'aipm-search-test-'));
  const index = new WikiSearchIndexer(root);
  t.after(async () => {
    await index.close();
    await rm(root, { recursive: true, force: true });
  });
  const dir = path.join(root, 'knowledge', 'wiki');
  await mkdir(dir, { recursive: true });
  const file = (id: string) => path.join(dir, `${id}.md`);
  const save = async (
    id: string,
    term = 'startingterm',
    title = '正式页面',
    body = `## 来源事实\r\n${term} 逐字🧾\r\n`,
  ) => {
    await writeFile(
      file(id),
      [
        '---',
        `id: ${id}`,
        `title: ${title}`,
        'aliases: [渠道政策]',
        'tags: [陈列]',
        'type: concept',
        'category: channel',
        'source_level: B',
        'updated: "2026-11-24T12:00:00Z"',
        '---',
        `# ${title}`,
        '',
        body,
      ].join('\r\n'),
    );
  };
  const query = (term: string) =>
    index.read((db) =>
      db
        .prepare<[string], { chunk_id: string; raw_text: string }>(
          `
    SELECT chunks.chunk_id, chunks.raw_text FROM chunks_fts JOIN chunks ON chunks.chunk_id = chunks_fts.chunk_id
    WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 0, 0, 6, 3, 1), chunks.chunk_id
  `,
        )
        .all(term),
    );
  const meta = () =>
    index.read((db) =>
      Object.fromEntries(
        db
          .prepare<[], { key: string; value: string }>('SELECT key, value FROM meta')
          .all()
          .map(({ key, value }) => [key, value]),
      ),
    );
  return { root, index, file, save, query, meta };
}

test('clean and deleted indexes rebuild identical content, hashes, body coordinates and query results', async (t) => {
  const { root, index, file, save, query, meta } = await fixture(t);
  const body = '## 来源事实\r\nstartingterm 逐字🧾\r\n\r\n## 推断\r\n相邻内容。';
  await save(FIRST, undefined, undefined, body);
  await save(SECOND);
  await writeFile(path.join(root, 'knowledge', 'wiki', 'index.md'), '# 自动索引，不是正式页面');
  const counts = await index.rebuildAll();
  assert.equal(counts.pagesIndexed, 2);
  assert.equal(counts.chunksIndexed, 3);
  assert.ok(counts.durationMs > 0);
  assert.equal(index.databaseFile, path.join(root, 'state', 'search-index.sqlite'));
  const { last_reconciled_at, ...versions } = meta();
  assert.equal(new Date(last_reconciled_at).toISOString(), last_reconciled_at);
  assert.deepEqual(versions, {
    schema_version: '2',
    chunking_version: '1',
    tokenizer_version: 'intl-zh-v2',
    embedding_provider: '',
    embedding_model: '',
    embedding_dimensions: '0',
    index_dirty: '0',
  });
  const bytes = await readFile(file(FIRST));
  assert.equal(parseWikiMarkdown(bytes.toString()).body, body);
  const snapshot = () =>
    index.read((db) => ({
      pages: db
        .prepare(
          'SELECT page_id, file_hash, aliases_json, tags_json, wiki_type, category, source_grade, char_count FROM pages ORDER BY page_id',
        )
        .all(),
      chunks: db.prepare('SELECT * FROM chunks ORDER BY chunk_id').all(),
      fts: db.prepare('SELECT * FROM chunks_fts ORDER BY chunk_id').all(),
    }));
  const initial = snapshot();
  assert.deepEqual(initial.pages[0], {
    page_id: FIRST,
    file_hash: createHash('sha256').update(bytes).digest('hex'),
    aliases_json: '["渠道政策"]',
    tags_json: '["陈列"]',
    wiki_type: 'concept',
    category: 'channel',
    source_grade: 'B',
    char_count: body.length,
  });
  const initialHits = query('startingterm');
  assert.equal(initialHits.length, 2);
  assert.equal(initialHits[0].raw_text, body.slice(0, body.indexOf('## 推断')));
  index.read((db) => {
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('synchronous', { simple: true }), 1);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(
      db.prepare('SELECT count(*) FROM chunks WHERE embedding IS NULL AND embedding_ver IS NULL').pluck().get(),
      3,
    );
  });
  await index.close();
  await rm(index.databaseFile);
  assert.equal(await index.reconcileOnStartup(), true);
  assert.deepEqual(snapshot(), initial);
  assert.deepEqual(query('startingterm'), initialHits);
});

test('startup reconciles metadata-only changes with unchanged mtime, disk additions and deletions, and version drift', async (t) => {
  const { index, file, save, query, meta } = await fixture(t);
  await save(FIRST, 'retained');
  await save(SECOND, 'removed');
  assert.equal(await index.reconcileOnStartup(), true);
  const fixed = new Date('2020-01-01T00:00:00Z');
  await utimes(file(FIRST), fixed, fixed);
  const indexed = () =>
    index.read((db) => db.prepare('SELECT indexed_at FROM pages WHERE page_id = ?').pluck().get(FIRST));
  const initialTime = indexed();
  assert.equal(await index.reconcileOnStartup(), true);
  assert.equal(indexed(), initialTime);
  await save(FIRST, 'retained', 'newtitle');
  await utimes(file(FIRST), fixed, fixed);
  await rm(file(SECOND));
  await save(THIRD, 'newterm');
  assert.equal(await index.reconcileOnStartup(), true);
  assert.equal(query('newtitle').length, 1);
  assert.equal(query('removed').length, 0);
  assert.equal(query('newterm').length, 1);
  for (const key of ['schema_version', 'chunking_version', 'tokenizer_version']) {
    index.read((db) => {
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('older', key);
      db.prepare('INSERT INTO meta VALUES (?, ?)').run('old_generation', 'true');
    });
    assert.equal(await index.reconcileOnStartup(), true);
    assert.equal(meta()[key], key === 'tokenizer_version' ? 'intl-zh-v2' : key === 'schema_version' ? '2' : '1');
    assert.equal(meta().old_generation, undefined);
  }
});

test('incremental updates roll pages, chunks and FTS back together and dirty failures leave the Markdown in place', async (t) => {
  const { index, file, save, query, meta } = await fixture(t);
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(await index.reconcileOnStartup(), true);
  await save(FIRST);
  assert.equal(await index.syncPage(file(FIRST)), true);
  await save(FIRST, 'updatedterm');
  index.read((db) =>
    db.exec("CREATE TRIGGER force_failure BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT, 'test fault'); END"),
  );
  assert.equal(await index.syncPage(file(FIRST)), false);
  assert.equal(index.isDirty, true);
  assert.equal(meta().index_dirty, '1');
  assert.equal(warn.mock.calls[0].arguments[1].operation, 'syncPage');
  assert.match(await readFile(file(FIRST), 'utf8'), /updatedterm/);
  assert.equal(query('startingterm').length, 1);
  assert.equal(query('updatedterm').length, 0);
  assert.equal(await index.reconcileOnStartup(), true);
  assert.equal(index.isDirty, false);
  assert.equal(query('startingterm').length, 0);
  assert.equal(query('updatedterm').length, 1);
  await save(FIRST, 'editedagain');
  assert.equal(await index.syncPage(file(FIRST)), true);
  assert.equal(query('updatedterm').length, 0);
  assert.equal(query('editedagain').length, 1);
  await rm(file(FIRST));
  assert.equal(await index.removePage(FIRST), true);
  index.read((db) => {
    for (const table of ['pages', 'chunks', 'chunks_fts']) {
      assert.equal(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get(), 0);
    }
  });
});

test('the prior index answers queries throughout a rebuild, then the new index is visible without leaked staging files', async (t) => {
  const { index, save, query } = await fixture(t);
  await save(FIRST);
  await index.rebuildAll();
  await save(FIRST, 'replacement');
  assert.equal(query('startingterm').length, 1);
  const rebuild = index.rebuildAll();
  let switched = false;
  void rebuild.then(
    () => {
      switched = true;
    },
    () => {
      switched = true;
    },
  );
  let oldReads = 0;
  while (!switched) {
    assert.equal(query('startingterm').length, 1);
    assert.equal(query('replacement').length, 0);
    oldReads++;
    await setImmediate();
  }
  await rebuild;
  assert.ok(oldReads > 1);
  assert.equal(query('startingterm').length, 0);
  assert.equal(query('replacement').length, 1);
  await index.close();
  assert.deepEqual(await readdir(path.dirname(index.databaseFile)), ['search-index.sqlite']);
});

test('a failed rebuild keeps the old connection readable and a repaired source or damaged SQLite file can be rebuilt', async (t) => {
  const { index, file, save, query, meta } = await fixture(t);
  t.mock.method(console, 'warn', () => {});
  await save(FIRST);
  await index.rebuildAll();
  await writeFile(file(FIRST), 'malformed Wiki frontmatter');
  await assert.rejects(index.rebuildAll(), /Frontmatter/);
  assert.equal(meta().index_dirty, '1');
  assert.equal(query('startingterm').length, 1);
  assert.match(await readFile(file(FIRST), 'utf8'), /malformed Wiki/);
  await save(FIRST, 'repaired');
  await index.close();
  await writeFile(index.databaseFile, 'damaged SQLite file');
  await writeFile(index.databaseFile + '-wal', 'stale WAL sidecar');
  assert.equal(await index.reconcileOnStartup(), true);
  assert.equal(query('repaired').length, 1);
  assert.equal(meta().index_dirty, '0');
});

test('a busy SQLite reader prevents replacement safely and the next rebuild succeeds', async (t) => {
  const { index, save, query } = await fixture(t);
  t.mock.method(console, 'warn', () => {});
  await save(FIRST);
  await index.rebuildAll();
  await save(FIRST, 'replacement');
  const secondReader = openSearchDatabase(index.databaseFile, { readonly: true });
  try {
    secondReader.exec('BEGIN');
    assert.equal(secondReader.prepare('SELECT count(*) FROM chunks').pluck().get(), 1);
    await assert.rejects(index.rebuildAll(), /locked|busy|leave WAL/i);
    assert.equal(query('startingterm').length, 1);
  } finally {
    secondReader.close();
  }
  await index.rebuildAll();
  assert.equal(query('replacement').length, 1);
});

test('offline rebuild command reports counts and respects the application data-root lock', async (t) => {
  const { root, save, index, query } = await fixture(t);
  await save(FIRST);
  const run = () => promisify(execFile)(process.execPath, ['--import', 'tsx', cli, root]);
  const lock = await acquireInstanceLock(root, 0, 'production');
  try {
    await assert.rejects(run(), /RUNTIME_INSTANCE_IN_USE/);
  } finally {
    lock.close();
  }
  const { stdout } = await run();
  assert.match(stdout, /"pagesIndexed":1,"chunksIndexed":1,"durationMs":\d/);
  assert.equal(await index.reconcileOnStartup(), true);
  assert.equal(query('startingterm').length, 1);
});
