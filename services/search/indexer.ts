import { createHash } from 'node:crypto';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SerialQueue } from '../storage/files.ts';
import { ReviewTriggerStore } from '../wiki/review-triggers.ts';
import { parseWikiMarkdown, wikiPageIdFromFilename, type WikiRecord } from '../wiki/store.ts';
import { chunkWikiPage } from './chunking.ts';
import { EmbeddingBackfill, type EmbeddingStatus } from './embedding-backfill.ts';
import { EmbeddingError, type EmbeddingProvider } from './embedding-provider.ts';
import type { SearchOptions } from './fts-retriever.ts';
import {
  closeIndexForReplacement,
  initSearchSchema,
  matchesEmbeddingProvider,
  openSearchIndex,
  readEmbeddingLock,
  readIndexedFiles,
  readReviewQueue,
  searchIndexState,
  setEmbeddingLock,
  setIndexMeta,
  writeIndexedPages,
  type IndexedPage,
  type SearchDatabase,
} from './sqlite-store.ts';
import { readVectorHits, WikiVectorCache } from './vector-retriever.ts';

const READ_BATCH = 32;
const SIDECARS = ['-wal', '-shm', '-journal'];

export function wikiFileHash(contents: string | Buffer) {
  return createHash('sha256').update(contents).digest('hex');
}

export interface RebuildResult {
  pagesIndexed: number;
  chunksIndexed: number;
  durationMs: number;
}

type EmbeddingOptions = {
  provider: () => Promise<EmbeddingProvider | null>;
  authorize: (page: WikiRecord) => Promise<void>;
  withSourceLock?: <T>(work: () => Promise<T>) => Promise<T>;
};

export type VectorQueryAuthorization = {
  authorizeQuery?: () => Promise<void> | void;
  signal?: AbortSignal;
};

// The workbench holds its existing data-root instance lock and owns one indexer per root.
export class WikiSearchIndexer {
  readonly databaseFile: string;
  readonly reviewTriggers: ReviewTriggerStore;
  private readonly root: string;
  private readonly wikiDir: string;
  private readonly queue = new SerialQueue();
  private db: SearchDatabase | undefined;
  private dirty = false;
  private readonly embeddings: EmbeddingBackfill;
  private readonly vectors = new WikiVectorCache();

  constructor(
    root: string,
    private readonly embeddingOptions?: EmbeddingOptions,
  ) {
    this.root = path.resolve(root);
    this.wikiDir = path.join(this.root, 'knowledge', 'wiki');
    this.databaseFile = path.join(this.root, 'state', 'search-index.sqlite');
    this.reviewTriggers = new ReviewTriggerStore(this.root);
    this.embeddings = new EmbeddingBackfill(
      () => this.db,
      () => this.embeddingProvider(),
      async ({ filePath, fileHash, pageId }) => {
        const file = path.join(this.root, filePath);
        if (wikiPageIdFromFilename(path.relative(this.wikiDir, file)) !== pageId)
          throw new EmbeddingError('EMBEDDING_SOURCE_UNAVAILABLE');
        const bytes = await readFile(file).catch(() => undefined);
        if (!bytes || wikiFileHash(bytes) !== fileHash) throw new EmbeddingError('EMBEDDING_STALE');
        const page = parseWikiMarkdown(bytes.toString('utf8'));
        if (page.id !== pageId) throw new EmbeddingError('EMBEDDING_SOURCE_UNAVAILABLE');
        await embeddingOptions?.authorize(page).catch(() => {
          throw new EmbeddingError('EMBEDDING_SOURCE_UNAVAILABLE');
        });
      },
      embeddingOptions?.withSourceLock ?? ((work) => work()),
      (pageIds) => this.read((db) => this.vectors.reloadFromStore(db, pageIds)),
    );
  }

  get isDirty() {
    return this.dirty;
  }

  // Read callbacks must materialize results synchronously and leave the connection owned by the indexer.
  read<T>(query: (db: SearchDatabase) => T): T {
    if (!this.db) throw new Error('Search index is unavailable');
    return query(this.db);
  }

  async reviewQueue(asOf: string, allowedPageIds?: ReadonlySet<string>) {
    const state = await this.reviewTriggers.read();
    if (this.dirty) throw new Error('Wiki review index is stale');
    return this.read((db) => readReviewQueue(db, asOf, state, allowedPageIds));
  }

  getEmbeddingStatus(): EmbeddingStatus {
    return this.embeddings.status();
  }

  backfillMissingEmbeddings(): Promise<void> {
    return this.embeddings.request();
  }

  private async embeddingProvider() {
    if (process.env.SEARCH_ENGINE === 'sqlite_fts' || process.env.SEARCH_ENGINE === 'legacy_scan') return null;
    return (await this.embeddingOptions?.provider()) ?? null;
  }

  async rankVectorChunks(
    query: string,
    names: string[],
    options: SearchOptions & VectorQueryAuthorization,
    minScore: number,
  ) {
    const db = this.read((db) => db);
    const provider = await this.embeddingProvider().catch(() => {
      throw new EmbeddingError('EMBEDDING_CONFIG_ERROR');
    });
    if (!provider) throw new EmbeddingError('EMBEDDING_UNCONFIGURED');
    if (this.dirty || this.db !== db) throw new EmbeddingError('EMBEDDING_STALE');
    const lock = readEmbeddingLock(db);
    if (!matchesEmbeddingProvider(lock, provider)) {
      void this.backfillMissingEmbeddings();
      throw new EmbeddingError('EMBEDDING_VERSION_CHANGED');
    }
    const scope = { ...options, allowedPageIds: options.pageIds };
    if (!lock.version || !this.vectors.hasEligible(scope)) throw new EmbeddingError('EMBEDDING_EMPTY');
    const authorize = async () => {
      try {
        await options.authorizeQuery?.();
      } catch {
        throw new EmbeddingError('EMBEDDING_SOURCE_UNAVAILABLE');
      }
    };
    await authorize();
    const result = await provider
      .embedQuery(query, {
        signal: options.signal,
        dispatch: async (send) => {
          const dispatch = async () => {
            await authorize();
            const currentProvider = await this.embeddingProvider();
            if (
              this.dirty ||
              db !== this.db ||
              !matchesEmbeddingProvider(lock, currentProvider) ||
              readEmbeddingLock(db).version !== lock.version
            )
              throw new EmbeddingError('EMBEDDING_STALE');
            return { response: send() };
          };
          const { response } = !this.embeddingOptions?.withSourceLock
            ? await dispatch()
            : await this.embeddingOptions.withSourceLock(dispatch);
          return response;
        },
      })
      .catch((error: unknown) => {
        throw error instanceof EmbeddingError ? error : new EmbeddingError('EMBEDDING_QUERY_FAILED');
      });
    const currentProvider = await this.embeddingProvider().catch(() => null);
    if (
      this.dirty ||
      this.db !== db ||
      !matchesEmbeddingProvider(lock, currentProvider) ||
      readEmbeddingLock(db).version !== lock.version
    )
      throw new EmbeddingError('EMBEDDING_STALE');
    const { vector, dimensions } = result;
    if (
      !Number.isSafeInteger(dimensions) ||
      dimensions <= 0 ||
      vector.length !== dimensions ||
      !vector.every(Number.isFinite)
    )
      throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
    if (dimensions !== lock.dimensions || provider.getVersionKey(dimensions) !== lock.version) {
      setEmbeddingLock(db, { ...lock, dimensions, version: provider.getVersionKey(dimensions) });
      this.vectors.clear();
      void this.backfillMissingEmbeddings();
      throw new EmbeddingError('EMBEDDING_VERSION_CHANGED');
    }
    return readVectorHits(db, this.vectors.rank(vector, scope, minScore), names);
  }

  reconcileOnStartup(): Promise<boolean> {
    return this.queue.run(async () => {
      try {
        this.openExisting();
        const db = this.db;
        const state = db && !this.dirty ? searchIndexState(db) : 'rebuild';
        if (!db || state === 'rebuild') {
          await this.buildAndSwap();
          return true;
        }

        const previous = readIndexedFiles(db);
        const hashes = new Map(state === 'upgrade' ? [] : previous.map((row) => [row.file_path, row.file_hash]));
        const files = await this.wikiFiles();
        const present = new Set(files.map((file) => path.relative(this.root, file)));
        const replaced = new Set<string>();
        const changes: IndexedPage[] = [];
        for (let offset = 0; offset < files.length; offset += READ_BATCH) {
          const batch = await Promise.all(
            files.slice(offset, offset + READ_BATCH).map((file) => this.readWiki(file, hashes)),
          );
          for (const page of batch) {
            if (!page) continue;
            changes.push(page);
            replaced.add(page.page.id);
          }
        }
        writeIndexedPages(
          db,
          changes,
          previous.filter((row) => replaced.has(row.page_id) || !present.has(row.file_path)).map((row) => row.page_id),
          state === 'upgrade',
        );
        this.vectors.reloadFromStore(db);
        setIndexMeta(db, { last_reconciled_at: new Date().toISOString() });
        if (this.embeddingOptions) void this.backfillMissingEmbeddings();
        return true;
      } catch (error) {
        this.markDirty('reconcileOnStartup', error);
        return false;
      }
    });
  }

  syncPage(filePath: string): Promise<boolean> {
    return this.queue.run(async () => {
      try {
        const file = path.resolve(this.root, filePath);
        if (!wikiPageIdFromFilename(path.relative(this.wikiDir, file)))
          throw new Error('Search index sync requires a formal Wiki page path');
        const db = this.db;
        if (!db) throw new Error('Search index is unavailable');
        const page = await this.readWiki(file);
        writeIndexedPages(db, [page], [page.page.id]);
        this.vectors.reloadFromStore(db, [page.page.id]);
        if (this.embeddingOptions) void this.backfillMissingEmbeddings();
        return true;
      } catch (error) {
        this.markDirty('syncPage', error);
        return false;
      }
    });
  }

  removePage(pageId: string): Promise<boolean> {
    return this.queue.run(async () => {
      try {
        this.read((db) => writeIndexedPages(db, [], [pageId]));
        this.vectors.removeByPageId(pageId);
        return true;
      } catch (error) {
        this.markDirty('removePage', error);
        return false;
      }
    });
  }

  rebuildAll(): Promise<RebuildResult> {
    return this.queue.run(async () => {
      try {
        this.openExisting();
        return await this.buildAndSwap();
      } catch (error) {
        this.markDirty('rebuildAll', error);
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.queue.run(async () => {
      this.embeddings.stop();
      this.db?.close();
      this.db = undefined;
      this.vectors.clear();
    });
  }

  private openExisting() {
    if (this.db || !existsSync(this.databaseFile)) return;
    try {
      this.db = openSearchIndex(this.databaseFile, true);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'SQLITE_NOTADB' && code !== 'SQLITE_CORRUPT') throw error;
      this.markDirty('openExisting', error);
    }
  }

  private async wikiFiles() {
    const names = await readdir(this.wikiDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return names
      .filter(wikiPageIdFromFilename)
      .sort()
      .map((name) => path.join(this.wikiDir, name));
  }

  private async readWiki(file: string): Promise<IndexedPage>;
  private async readWiki(file: string, existing: Map<string, string>): Promise<IndexedPage | undefined>;
  private async readWiki(file: string, existing?: Map<string, string>): Promise<IndexedPage | undefined> {
    const bytes = await readFile(file);
    const fileHash = wikiFileHash(bytes);
    const filePath = path.relative(this.root, file);
    if (existing?.get(filePath) === fileHash) return;
    const page = parseWikiMarkdown(bytes.toString('utf8'));
    if (page.id !== wikiPageIdFromFilename(path.basename(file)) || typeof page.title !== 'string')
      throw new Error('Invalid Wiki metadata for search index');
    return { page, filePath, fileHash, chunks: chunkWikiPage(page) };
  }

  private async buildAndSwap(): Promise<RebuildResult> {
    const started = performance.now();
    const tempFile = `${this.databaseFile}.rebuilding`;
    await mkdir(path.dirname(this.databaseFile), { recursive: true });
    for (const suffix of ['', ...SIDECARS]) await rm(tempFile + suffix, { force: true });
    const temp = openSearchIndex(tempFile);
    let chunksIndexed = 0;
    let pagesIndexed = 0;
    try {
      const files = await this.wikiFiles();
      initSearchSchema(temp);
      for (let offset = 0; offset < files.length; offset += READ_BATCH) {
        // Disk reads yield to the server between short batches while its previous SQLite connection remains open.
        const batch = await Promise.all(files.slice(offset, offset + READ_BATCH).map((file) => this.readWiki(file)));
        writeIndexedPages(temp, batch, []);
        for (const { chunks } of batch) chunksIndexed += chunks.length;
        pagesIndexed += batch.length;
      }
      setIndexMeta(temp, { last_reconciled_at: new Date().toISOString() });
      closeIndexForReplacement(temp);

      // No async gap between close, same-volume rename and reopen. Windows requires released SQLite handles.
      if (this.db) {
        closeIndexForReplacement(this.db);
      } else {
        // An absent or corrupt previous database may have sidecars left by a crashed process.
        for (const suffix of SIDECARS) rmSync(this.databaseFile + suffix, { force: true });
      }
      this.db = undefined;
      this.vectors.clear();
      try {
        renameSync(tempFile, this.databaseFile);
      } finally {
        // If rename failed, the previous file is still at databaseFile.
        this.openExisting();
      }
      if (!this.db) throw new Error('Could not reopen the rebuilt search index');
      this.vectors.reloadFromStore(this.db);
      this.dirty = false;
      if (this.embeddingOptions) void this.backfillMissingEmbeddings();
      return { pagesIndexed, chunksIndexed, durationMs: performance.now() - started };
    } catch (error) {
      if (temp.open) temp.close();
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  markDirty(operation: string, error: unknown) {
    this.dirty = true;
    try {
      if (this.db) setIndexMeta(this.db, { index_dirty: '1' });
    } catch {
      // A failed or unwritable database can still be marked dirty in memory for this process.
    }
    console.warn('[search-index]', {
      operation,
      code: (error as NodeJS.ErrnoException | undefined)?.code,
      message: error instanceof Error && error.name !== 'YAMLException' ? error.message : 'Could not index Wiki data',
    });
  }
}
