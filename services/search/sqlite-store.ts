import Database from 'better-sqlite3';
import type { WikiRecord } from '../wiki/store.ts';
import type { WikiChunk } from './chunking.ts';

export type SearchDatabase = Database.Database;

export function openSearchDatabase(filename: string, options?: Database.Options) {
  return new Database(filename, options);
}

const versions = {
  schema_version: '1',
  chunking_version: '1',
  tokenizer_version: 'intl-zh-v1',
};

export function openSearchIndex(filename: string, fileMustExist = false): SearchDatabase {
  // There is one owner. An external SQLite lock should fail promptly on the server thread.
  const db = openSearchDatabase(filename, { fileMustExist, timeout: 0 });
  try {
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal')
      throw new Error('Search index could not enable WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Switching to DELETE checkpoints the WAL before SQLite closes and removes its sidecars.
export function closeIndexForReplacement(db: SearchDatabase) {
  if (db.pragma('journal_mode = DELETE', { simple: true }) !== 'delete')
    throw new Error('Search index could not leave WAL before replacement');
  db.close();
}

export function initSearchSchema(db: SearchDatabase) {
  db.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE pages (
      page_id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      wiki_type TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      source_grade TEXT NOT NULL DEFAULT '',
      file_hash TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );
    CREATE TABLE chunks (
      chunk_id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      heading_path TEXT NOT NULL,
      section_kind TEXT NOT NULL CHECK (section_kind IN ('fact', 'inference', 'mixed', 'meta')),
      raw_text TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      raw_hash TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      embedding BLOB DEFAULT NULL,
      embedding_ver TEXT DEFAULT NULL
    );
    CREATE INDEX idx_chunks_page_id ON chunks(page_id);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      chunk_id UNINDEXED, page_id UNINDEXED, title_tokens, meta_tokens, body_tokens,
      tokenize = 'unicode61 remove_diacritics 0'
    );
  `);
  setIndexMeta(db, {
    ...versions,
    embedding_provider: '',
    embedding_model: '',
    embedding_dimensions: '0',
    index_dirty: '0',
    last_reconciled_at: new Date().toISOString(),
  });
}

export function setIndexMeta(db: SearchDatabase, entries: Record<string, string>) {
  const put = db.prepare<[string, string]>(`INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  for (const [key, value] of Object.entries(entries)) put.run(key, value);
}

export function needsIndexRebuild(db: SearchDatabase) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'meta'").get()) return true;
  const entries = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM meta').all();
  const current = new Map(entries.map(({ key, value }) => [key, value]));
  return (
    current.get('index_dirty') !== '0' || Object.entries(versions).some(([key, value]) => current.get(key) !== value)
  );
}

export interface IndexedPage {
  page: WikiRecord;
  filePath: string;
  fileHash: string;
  chunks: WikiChunk[];
}

export function writeIndexedPages(db: SearchDatabase, pages: IndexedPage[], removeIds: string[]) {
  const removeFts = db.prepare<[string]>('DELETE FROM chunks_fts WHERE page_id = ?');
  const removePage = db.prepare<[string]>('DELETE FROM pages WHERE page_id = ?');
  const putPage = db.prepare<
    [string, string, string, string, string, string, string, string, string, number, string, string]
  >(
    `INSERT INTO pages (page_id, file_path, title, aliases_json, tags_json, wiki_type, category, source_grade,
      file_hash, char_count, updated_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const putChunk =
    db.prepare<WikiChunk>(`INSERT INTO chunks (chunk_id, page_id, chunk_index, heading_path, section_kind,
    raw_text, start_offset, end_offset, raw_hash, char_count) VALUES
    (@chunkId, @pageId, @chunkIndex, @headingPath, @sectionKind, @rawText, @startOffset, @endOffset, @rawHash, @charCount)`);
  const putFts = db.prepare<[string, string, string, string, string]>(`INSERT INTO chunks_fts
    (chunk_id, page_id, title_tokens, meta_tokens, body_tokens) VALUES (?, ?, ?, ?, ?)`);

  db.transaction(() => {
    for (const id of removeIds) {
      removeFts.run(id);
      removePage.run(id);
    }
    const now = new Date().toISOString();
    for (const { page, filePath, fileHash, chunks } of pages) {
      putPage.run(
        page.id,
        filePath,
        page.title,
        JSON.stringify(page.aliases ?? []),
        JSON.stringify(page.tags ?? []),
        page.type ?? '',
        page.category ?? '',
        page.source_level ?? '',
        fileHash,
        page.body.length,
        page.updated ?? '',
        now,
      );
      // 1A-2 seeds FTS5 with Unicode61 input. The 1A-3 tokenizer must rebuild these derived rows.
      const meta = [...(page.aliases ?? []), ...(page.tags ?? []), page.type, page.category, page.source_level].join(
        ' ',
      );
      for (const chunk of chunks) {
        putChunk.run(chunk);
        putFts.run(chunk.chunkId, page.id, page.title, meta, chunk.rawText);
      }
    }
  })();
}
