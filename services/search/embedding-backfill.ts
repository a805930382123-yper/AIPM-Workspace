import { EmbeddingError, type EmbeddingProvider } from './embedding-provider.ts';
import {
  countEmbeddings,
  readEmbeddingLock,
  readPendingEmbeddings,
  setEmbeddingLock,
  writeEmbeddings,
  type SearchDatabase,
} from './sqlite-store.ts';

type Candidate = ReturnType<typeof readPendingEmbeddings>[number];

export interface EmbeddingStatus {
  enabled: boolean;
  embeddingVer: string | null;
  totalChunks: number;
  embeddedChunks: number;
  pendingChunks: number;
  isBackfilling: boolean;
  lastError: string | null;
}

export class EmbeddingBackfill {
  private current: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private requested = false;
  private enabled = false;
  private lastError: string | null = null;

  constructor(
    private readonly currentDb: () => SearchDatabase | undefined,
    private readonly provider: () => Promise<EmbeddingProvider | null>,
    private readonly authorize: (row: Candidate) => Promise<void>,
    private readonly withSourceLock: <T>(work: () => Promise<T>) => Promise<T>,
  ) {}

  status(): EmbeddingStatus {
    const db = this.currentDb();
    const lock = db && readEmbeddingLock(db);
    const { totalChunks, embeddedChunks } =
      db && lock ? countEmbeddings(db, lock) : { totalChunks: 0, embeddedChunks: 0 };
    return {
      enabled: this.enabled,
      embeddingVer: lock?.version || null,
      totalChunks,
      embeddedChunks,
      pendingChunks: totalChunks - embeddedChunks,
      isBackfilling: Boolean(this.current),
      lastError: this.lastError,
    };
  }

  request(): Promise<void> {
    this.requested = true;
    if (this.current) return this.current;
    const abort = (this.abort = new AbortController());
    this.current = Promise.resolve().then(async () => {
      while (this.requested && !abort.signal.aborted) {
        this.requested = false;
        try {
          this.lastError = null;
          await this.run(abort.signal);
        } catch (error) {
          if (abort.signal.aborted) break;
          if (error instanceof EmbeddingError && error.code === 'EMBEDDING_STALE') continue;
          this.lastError = error instanceof EmbeddingError ? error.code : 'EMBEDDING_BACKFILL_FAILED';
          console.warn('[search-embedding]', { code: this.lastError });
          this.requested = false;
        }
      }
      this.current = undefined;
      this.abort = undefined;
      if (this.requested) await this.request();
    });
    return this.current;
  }

  stop() {
    this.abort?.abort();
    this.requested = false;
  }

  private async run(signal: AbortSignal) {
    const db = this.currentDb();
    if (!db) return;
    const provider = await this.provider();
    if (signal.aborted || db !== this.currentDb()) return;
    this.enabled = Boolean(provider);
    if (!provider) return;
    const target = {
      provider: provider.providerName,
      model: provider.modelName,
      identity: provider.identity,
      configuredDimensions: provider.configuredDimensions ?? 0,
    };
    const sameProvider = (other: EmbeddingProvider | null) =>
      other?.providerName === target.provider &&
      other.modelName === target.model &&
      other.identity === target.identity &&
      (other.configuredDimensions ?? 0) === target.configuredDimensions;
    let lock = readEmbeddingLock(db);
    if (
      lock.provider !== target.provider ||
      lock.model !== target.model ||
      lock.identity !== target.identity ||
      lock.configuredDimensions !== target.configuredDimensions
    ) {
      lock = { ...target, dimensions: 0, version: null };
      setEmbeddingLock(db, lock);
    }
    let after = '';
    let roundDimensions: number | undefined;
    const checkProvider = async () => {
      const latest = await this.provider();
      if (signal.aborted || db !== this.currentDb()) throw new EmbeddingError('EMBEDDING_STALE');
      if (!sameProvider(latest)) {
        this.requested = true;
        throw new EmbeddingError('EMBEDDING_STALE');
      }
    };

    while (!signal.aborted && db === this.currentDb()) {
      const pending = readPendingEmbeddings(db, lock, after, provider.batchSize);
      if (!pending.length) return;
      after = pending[pending.length - 1].chunkId;
      const authorized = new Map<string, boolean>();
      const rows: Candidate[] = [];
      for (const row of pending) {
        if (!authorized.has(row.pageId)) {
          const allowed = await this.authorize(row).then(
            () => true,
            () => false,
          );
          authorized.set(row.pageId, allowed);
          if (!allowed) this.lastError = 'EMBEDDING_SOURCE_UNAVAILABLE';
        }
        if (authorized.get(row.pageId)) rows.push(row);
      }
      if (!rows.length) continue;
      const uniquePages = [...new Map(rows.map((row) => [row.pageId, row])).values()];
      const result = await provider.embedTexts(
        rows.map(({ input }) => input),
        {
          signal,
          dispatch: async (send) => {
            const { response } = await this.withSourceLock(async () => {
              await checkProvider();
              // Recheck source authorization on each attempt. Release the Wiki lock once fetch starts.
              for (const row of uniquePages) {
                await this.authorize(row).catch(() => {
                  this.requested = true;
                  throw new EmbeddingError('EMBEDDING_STALE');
                });
              }
              if (signal.aborted || db !== this.currentDb()) throw new EmbeddingError('EMBEDDING_STALE');
              return { response: send() };
            });
            return response;
          },
        },
      );
      const currentPages = new Set<string>();
      for (const row of uniquePages) {
        if (
          await this.authorize(row).then(
            () => true,
            () => false,
          )
        )
          currentPages.add(row.pageId);
      }
      await checkProvider();
      const { dimensions, vectors } = result;
      if (
        !Number.isSafeInteger(dimensions) ||
        dimensions <= 0 ||
        (target.configuredDimensions && dimensions !== target.configuredDimensions) ||
        (roundDimensions !== undefined && roundDimensions !== dimensions) ||
        vectors.length !== rows.length ||
        vectors.some((vector) => vector.length !== dimensions)
      ) {
        throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
      }
      roundDimensions = dimensions;
      const version = provider.getVersionKey(dimensions);
      if (lock.version !== version || lock.dimensions !== dimensions) {
        if (lock.dimensions) after = '';
        lock = { ...target, dimensions, version };
        setEmbeddingLock(db, lock);
      }
      writeEmbeddings(db, version, rows, vectors, currentPages);
    }
  }
}
