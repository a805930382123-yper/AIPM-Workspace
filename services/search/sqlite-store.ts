import Database from 'better-sqlite3';
import { rankReviewQueue, type ReviewPage, type ReviewPageState } from '../wiki/freshness.ts';
import { wikiLinkTitles } from '../wiki/link-titles.ts';
import type { WikiRecord } from '../wiki/store.ts';
import type { WikiChunk } from './chunking.ts';
import { embeddingInput, type EmbeddingProvider } from './embedding-provider.ts';
import type { RetrievedChunkItem, SearchOptions } from './fts-retriever.ts';
import { TOKENIZER_VERSION, tokenizeForFts } from './tokenizer.ts';

export type SearchDatabase = Database.Database;

export function openSearchDatabase(filename: string, options?: Database.Options) {
  return new Database(filename, options);
}

const versions = {
  schema_version: '4',
  chunking_version: '1',
  tokenizer_version: TOKENIZER_VERSION,
};

const reviewQueueView = `CREATE VIEW review_queue AS
  SELECT page_id, title, wiki_type, category, last_verified_at, source_published_at, review_cycle_days,
    review_trigger_checkpoint FROM pages`;

const relationSchema = `
  CREATE INDEX idx_pages_link_title ON pages(link_title);
  CREATE TABLE wiki_link_mentions (
    source_page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    target_title TEXT NOT NULL,
    PRIMARY KEY (source_page_id, target_title)
  );
  CREATE INDEX idx_wiki_link_mentions_title ON wiki_link_mentions(target_title);
  CREATE TABLE relations (
    source_page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    target_page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    CHECK (source_page_id <> target_page_id),
    PRIMARY KEY (source_page_id, target_page_id)
  );
  CREATE INDEX idx_relations_target ON relations(target_page_id);
`;

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
      link_title TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      wiki_type TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      source_grade TEXT NOT NULL DEFAULT '',
      file_hash TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      last_verified_at TEXT,
      source_published_at TEXT,
      review_cycle_days INTEGER,
      review_trigger_checkpoint INTEGER
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
      tokenize = "unicode61 remove_diacritics 0 tokenchars '-'"
    );
    ${reviewQueueView};
    ${relationSchema}
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

export function searchIndexState(db: SearchDatabase): 'current' | 'upgrade' | 'rebuild' {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'meta'").get()) return 'rebuild';
  const entries = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM meta').all();
  const current = new Map(entries.map(({ key, value }) => [key, value]));
  if (
    current.get('index_dirty') !== '0' ||
    current.get('chunking_version') !== versions.chunking_version ||
    current.get('tokenizer_version') !== versions.tokenizer_version
  )
    return 'rebuild';
  const schemaVersion = current.get('schema_version');
  return schemaVersion === versions.schema_version
    ? 'current'
    : schemaVersion === '1' || schemaVersion === '2' || schemaVersion === '3'
      ? 'upgrade'
      : 'rebuild';
}

export function readIndexedFiles(db: SearchDatabase) {
  return db
    .prepare<[], { file_path: string; page_id: string; file_hash: string }>(
      'SELECT file_path, page_id, file_hash FROM pages',
    )
    .all();
}

export function readBacklinkIds(db: SearchDatabase, pageId: string) {
  return db
    .prepare<[string], { id: string }>(
      'SELECT source_page_id AS id FROM relations WHERE target_page_id = ? ORDER BY source_page_id',
    )
    .all(pageId)
    .map(({ id }) => id);
}

export function readRelatedWikiChunks(
  db: SearchDatabase,
  seedIds: string[],
  directIds: Set<string>,
  scope: SearchOptions,
) {
  const rows = db
    .prepare<unknown[], Omit<RetrievedChunkItem, 'score'> & { fileHash: string }>(
      `WITH seeds AS (SELECT key AS rank, value AS id FROM json_each(?)),
        edges AS (
          SELECT seeds.rank, r.target_page_id AS id
          FROM seeds JOIN relations AS r ON r.source_page_id = seeds.id
          UNION ALL
          SELECT seeds.rank, r.source_page_id AS id
          FROM seeds JOIN relations AS r ON r.target_page_id = seeds.id
        ), neighbors AS MATERIALIZED (
          SELECT e.id, MIN(e.rank) AS seed_rank
          FROM edges AS e JOIN pages AS p ON p.page_id = e.id
          WHERE (? OR p.wiki_type <> 'source')
            AND (? IS NULL OR e.id IN (SELECT value FROM json_each(?)))
            AND e.id NOT IN (SELECT value FROM json_each(?))
          GROUP BY e.id
          ORDER BY seed_rank, e.id LIMIT 16
        )
        SELECT c.chunk_id AS chunkId, c.page_id AS pageId, c.chunk_index AS chunkIndex,
          c.heading_path AS headingPath, c.section_kind AS sectionKind, c.raw_text AS rawText,
          c.start_offset AS startOffset, c.end_offset AS endOffset, c.raw_hash AS rawHash,
          p.title AS pageTitle, p.file_hash AS fileHash
        FROM neighbors AS n JOIN pages AS p ON p.page_id = n.id
        JOIN chunks AS c ON c.chunk_id = (
          SELECT chunk_id FROM chunks WHERE page_id = n.id
          ORDER BY section_kind <> 'fact', section_kind = 'meta', chunk_index LIMIT 1
        )
        ORDER BY n.seed_rank, n.id`,
    )
    .all(
      JSON.stringify(seedIds),
      Number(scope.includeSources ?? false),
      scope.pageIds ? 1 : null,
      JSON.stringify(scope.pageIds ?? []),
      JSON.stringify([...directIds, ...(scope.excludeIds ?? [])]),
    );
  return rows.map(({ fileHash, ...chunk }) => ({
    fileHash,
    chunk: { ...chunk, score: 0, hitSource: 'relation' as const },
  }));
}

export function readReviewQueue(
  db: SearchDatabase,
  asOf: string,
  state: Readonly<Record<string, ReviewPageState>>,
  allowedPageIds?: ReadonlySet<string>,
) {
  const rows = db
    .prepare<
      [],
      Omit<
        ReviewPage,
        'last_verified_at' | 'source_published_at' | 'review_cycle_days' | 'review_trigger_checkpoint'
      > & {
        last_verified_at: string | null;
        source_published_at: string | null;
        review_cycle_days: number | null;
        review_trigger_checkpoint: number | null;
      }
    >(
      `SELECT page_id AS pageId, title, wiki_type AS type, category, last_verified_at, source_published_at,
        review_cycle_days, review_trigger_checkpoint FROM review_queue`,
    )
    .all();
  return rankReviewQueue(
    rows
      .filter((row) => !allowedPageIds || allowedPageIds.has(row.pageId))
      .map((row) => ({
        ...row,
        last_verified_at: row.last_verified_at ?? undefined,
        source_published_at: row.source_published_at ?? undefined,
        review_cycle_days: row.review_cycle_days ?? undefined,
        review_trigger_checkpoint: row.review_trigger_checkpoint ?? undefined,
      })),
    asOf,
    state,
  );
}

export interface IndexedPage {
  page: WikiRecord;
  filePath: string;
  fileHash: string;
  chunks: WikiChunk[];
}

export type EmbeddingLock = {
  provider: string;
  model: string;
  identity: string;
  configuredDimensions: number;
  dimensions: number;
  version: string | null;
};

export function matchesEmbeddingProvider(lock: EmbeddingLock, provider: EmbeddingProvider | null) {
  return (
    provider?.providerName === lock.provider &&
    provider.modelName === lock.model &&
    provider.identity === lock.identity &&
    (provider.configuredDimensions ?? 0) === lock.configuredDimensions
  );
}

export function readEmbeddingLock(db: SearchDatabase): EmbeddingLock {
  const entries = db
    .prepare<[], { key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE 'embedding_%'")
    .all();
  const metadata = new Map(entries.map(({ key, value }) => [key, value]));
  return {
    provider: metadata.get('embedding_provider') ?? '',
    model: metadata.get('embedding_model') ?? '',
    identity: metadata.get('embedding_identity') ?? '',
    configuredDimensions: Number(metadata.get('embedding_configured_dimensions') ?? 0),
    dimensions: Number(metadata.get('embedding_dimensions') ?? 0),
    version: metadata.get('embedding_version') || null,
  };
}

export function setEmbeddingLock(db: SearchDatabase, lock: EmbeddingLock) {
  db.transaction(() => {
    db.exec('UPDATE chunks SET embedding = NULL, embedding_ver = NULL');
    setIndexMeta(db, {
      embedding_provider: lock.provider,
      embedding_model: lock.model,
      embedding_identity: lock.identity,
      embedding_configured_dimensions: String(lock.configuredDimensions),
      embedding_dimensions: String(lock.dimensions),
      embedding_version: lock.version ?? '',
    });
  })();
}

export function decodeEmbedding(bytes: Buffer, dimensions: number): Float32Array | undefined {
  if (dimensions <= 0 || bytes.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) return undefined;
  const vector = new Float32Array(Uint8Array.from(bytes).buffer);
  if (vector.every(Number.isFinite)) return vector;
}

type EmbeddingCandidate = { chunkId: string; pageId: string; fileHash: string; filePath: string; input: string };
const validEmbedding = `embedding_ver IS @version AND typeof(embedding) = 'blob' AND length(embedding) = @bytes`;

export function countEmbeddings(db: SearchDatabase, lock: EmbeddingLock) {
  return db
    .prepare<{ version: string | null; bytes: number }, { totalChunks: number; embeddedChunks: number }>(
      `SELECT count(*) AS totalChunks, count(*) FILTER (WHERE ${validEmbedding}) AS embeddedChunks FROM chunks`,
    )
    .get({ version: lock.version, bytes: lock.dimensions * Float32Array.BYTES_PER_ELEMENT })!;
}

export function readPendingEmbeddings(
  db: SearchDatabase,
  lock: EmbeddingLock,
  after: string,
  limit: number,
): EmbeddingCandidate[] {
  const rows = db
    .prepare<
      { version: string | null; bytes: number; after: string; limit: number },
      Omit<EmbeddingCandidate, 'input'> & { title: string; heading: string; kind: string; text: string }
    >(
      `SELECT c.chunk_id AS chunkId, c.page_id AS pageId, p.file_hash AS fileHash, p.file_path AS filePath,
    p.title, c.heading_path AS heading, c.section_kind AS kind, c.raw_text AS text
    FROM chunks c JOIN pages p ON p.page_id = c.page_id
    WHERE c.chunk_id > @after AND NOT (${validEmbedding}) ORDER BY c.chunk_id LIMIT @limit`,
    )
    .all({ version: lock.version, bytes: lock.dimensions * Float32Array.BYTES_PER_ELEMENT, after, limit });
  return rows.map(({ title, heading, kind, text, ...row }) => ({
    ...row,
    input: embeddingInput(title, heading, kind, text),
  }));
}

export function writeEmbeddings(
  db: SearchDatabase,
  version: string,
  rows: EmbeddingCandidate[],
  vectors: Float32Array[],
  currentPages: ReadonlySet<string>,
) {
  const update = db.prepare<[Buffer, string, string, string, string]>(
    `UPDATE chunks SET embedding = ?, embedding_ver = ? WHERE chunk_id = ? AND page_id = ?
     AND EXISTS (SELECT 1 FROM pages WHERE page_id = chunks.page_id AND file_hash = ?)`,
  );
  return db.transaction(() => {
    const changed = new Set<string>();
    for (const [index, { chunkId, pageId, fileHash }] of rows.entries()) {
      if (!currentPages.has(pageId)) continue;
      const vector = vectors[index];
      if (
        update.run(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), version, chunkId, pageId, fileHash)
          .changes
      )
        changed.add(pageId);
    }
    return [...changed];
  })();
}

export function writeIndexedPages(db: SearchDatabase, pages: IndexedPage[], removeIds: string[], upgrade = false) {
  db.transaction(() => {
    if (upgrade) {
      const previous = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'schema_version'").get();
      if (previous?.value === '1') {
        db.exec(`ALTER TABLE pages ADD COLUMN last_verified_at TEXT;
        ALTER TABLE pages ADD COLUMN source_published_at TEXT;
        ALTER TABLE pages ADD COLUMN review_cycle_days INTEGER;`);
      }
      if (previous?.value !== '3') {
        db.exec(`DROP VIEW IF EXISTS review_queue;
        ALTER TABLE pages ADD COLUMN review_trigger_checkpoint INTEGER;
        ${reviewQueueView};`);
      }
      db.exec(`ALTER TABLE pages ADD COLUMN link_title TEXT NOT NULL DEFAULT '';
        ${relationSchema}`);
      setIndexMeta(db, { schema_version: versions.schema_version });
    }
    const removeFts = db.prepare<[string]>('DELETE FROM chunks_fts WHERE page_id = ?');
    const removePage = db.prepare<[string]>('DELETE FROM pages WHERE page_id = ?');
    const putPage = db.prepare<
      [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        string,
        string,
        string | null,
        string | null,
        number | null,
        number | null,
      ]
    >(
      `INSERT INTO pages (page_id, file_path, title, link_title, aliases_json, tags_json, wiki_type, category, source_grade,
      file_hash, char_count, updated_at, indexed_at, last_verified_at, source_published_at,
      review_cycle_days, review_trigger_checkpoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const putChunk = db.prepare<WikiChunk & { embedding: Buffer | null; embeddingVer: string | null }>(
      `INSERT INTO chunks (chunk_id, page_id, chunk_index, heading_path, section_kind,
    raw_text, start_offset, end_offset, raw_hash, char_count, embedding, embedding_ver) VALUES
    (@chunkId, @pageId, @chunkIndex, @headingPath, @sectionKind, @rawText, @startOffset, @endOffset, @rawHash, @charCount,
     @embedding, @embeddingVer)`,
    );
    const putFts = db.prepare<[string, string, string, string, string]>(`INSERT INTO chunks_fts
    (chunk_id, page_id, title_tokens, meta_tokens, body_tokens) VALUES (?, ?, ?, ?, ?)`);
    const putMention = db.prepare<[string, string]>('INSERT INTO wiki_link_mentions VALUES (?, ?)');
    // Re-resolve inbound mentions for changed titles and outbound mentions of replaced pages.
    const affected = new Set(
      db
        .prepare<[string], { link_title: string }>(
          'SELECT link_title FROM pages WHERE page_id IN (SELECT value FROM json_each(?))',
        )
        .all(JSON.stringify(removeIds))
        .map(({ link_title }) => link_title),
    );

    const lock = readEmbeddingLock(db);
    const reusable = new Map<string, Map<string, Buffer>>();
    if (lock.identity && lock.version && removeIds.length && pages.length) {
      const prior = db.prepare<
        { ids: string; version: string; bytes: number },
        { pageId: string; title: string; heading: string; kind: string; text: string; embedding: Buffer }
      >(`SELECT c.page_id AS pageId, p.title, c.heading_path AS heading, c.section_kind AS kind, c.raw_text AS text, c.embedding
        FROM chunks c JOIN pages p ON p.page_id = c.page_id
        WHERE c.page_id IN (SELECT value FROM json_each(@ids)) AND ${validEmbedding}`);
      for (const row of prior.all({
        ids: JSON.stringify(removeIds),
        version: lock.version,
        bytes: lock.dimensions * 4,
      })) {
        if (!decodeEmbedding(row.embedding, lock.dimensions)) continue;
        const page = reusable.get(row.pageId) ?? new Map<string, Buffer>();
        page.set(embeddingInput(row.title, row.heading, row.kind, row.text), row.embedding);
        reusable.set(row.pageId, page);
      }
    }
    for (const id of removeIds) {
      removeFts.run(id);
      removePage.run(id);
    }
    const now = new Date().toISOString();
    for (const { page, filePath, fileHash, chunks } of pages) {
      const linkTitle = page.title.trim();
      affected.add(linkTitle);
      putPage.run(
        page.id,
        filePath,
        page.title,
        linkTitle,
        JSON.stringify(page.aliases ?? []),
        JSON.stringify(page.tags ?? []),
        page.type ?? '',
        page.category ?? '',
        page.source_level ?? '',
        fileHash,
        page.body.length,
        page.updated ?? '',
        now,
        page.last_verified_at ?? null,
        page.source_published_at ?? null,
        page.review_cycle_days === null ? 0 : (page.review_cycle_days ?? null),
        page.review_trigger_checkpoint ?? null,
      );
      for (const target of wikiLinkTitles(page.body)) {
        putMention.run(page.id, target);
        affected.add(target);
      }
      const title = tokenizeForFts(page.title).join(' ');
      const meta = tokenizeForFts([...(page.aliases ?? []), ...(page.tags ?? [])].join(' ')).join(' ');
      const prior = reusable.get(page.id);
      for (const chunk of chunks) {
        const embedding =
          prior?.get(embeddingInput(page.title, chunk.headingPath, chunk.sectionKind, chunk.rawText)) ?? null;
        putChunk.run({ ...chunk, embedding, embeddingVer: embedding ? lock.version : null });
        putFts.run(chunk.chunkId, page.id, title, meta, tokenizeForFts(chunk.rawText).join(' '));
      }
    }
    if (affected.size) {
      const titles = JSON.stringify([...affected]);
      db.prepare<[string]>(
        `DELETE FROM relations WHERE target_page_id IN (
        SELECT page_id FROM pages WHERE link_title IN (SELECT value FROM json_each(?))
      )`,
      ).run(titles);
      db.prepare<[string]>(
        `INSERT INTO relations (source_page_id, target_page_id)
        SELECT m.source_page_id, target.page_id
        FROM (SELECT link_title, min(page_id) AS page_id FROM pages
          WHERE link_title IN (SELECT value FROM json_each(?))
          GROUP BY link_title HAVING count(*) = 1) AS target
        JOIN wiki_link_mentions AS m ON m.target_title = target.link_title
        WHERE m.source_page_id <> target.page_id`,
      ).run(titles);
    }
  })();
}
