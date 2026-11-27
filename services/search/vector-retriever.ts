import { pageNameMatch, type RankedWikiChunk, type RetrievedChunkItem, type SearchOptions } from './fts-retriever.ts';
import { decodeEmbedding, readEmbeddingLock, type SearchDatabase } from './sqlite-store.ts';

type VectorEntry = { chunkId: string; pageId: string; wikiType: string; vec: Float32Array };
type VectorHit = { chunkId: string; score: number };
type VectorSearchOptions = Omit<SearchOptions, 'pageIds'> & { allowedPageIds?: ReadonlySet<string> | string[] };

export class WikiVectorCache {
  private readonly pages = new Map<string, Map<string, VectorEntry>>();

  clear() {
    this.pages.clear();
  }

  removeByPageId(pageId: string) {
    this.pages.delete(pageId);
  }

  upsertChunks(items: VectorEntry[]) {
    for (const item of items) {
      let page = this.pages.get(item.pageId);
      if (!page) this.pages.set(item.pageId, (page = new Map()));
      page.set(item.chunkId, item);
    }
  }

  reloadFromStore(db: SearchDatabase, pageIds?: readonly string[]) {
    if (pageIds) for (const pageId of pageIds) this.removeByPageId(pageId);
    else this.clear();
    const { version, dimensions } = readEmbeddingLock(db);
    if (!version || !dimensions) return;
    const rows = db
      .prepare<unknown[], Omit<VectorEntry, 'vec'> & { embedding: Buffer }>(
        `SELECT c.chunk_id AS chunkId, c.page_id AS pageId, p.wiki_type AS wikiType, c.embedding
      FROM chunks c JOIN pages p ON p.page_id = c.page_id
      WHERE embedding_ver = ? AND typeof(embedding) = 'blob' AND length(embedding) = ?
        AND (? IS NULL OR c.page_id IN (SELECT value FROM json_each(?)))`,
      )
      .all(version, dimensions * Float32Array.BYTES_PER_ELEMENT, pageIds ? 1 : null, JSON.stringify(pageIds ?? []));
    this.upsertChunks(
      rows.flatMap(({ embedding, ...row }) => {
        const vec = decodeEmbedding(embedding, dimensions);
        if (!vec) return [];
        let lengthSquared = 0;
        for (const value of vec) lengthSquared += value * value;
        return Math.abs(lengthSquared - 1) <= 0.0001 ? [{ ...row, vec }] : [];
      }),
    );
  }

  private *eligible(options: VectorSearchOptions) {
    const allowed = Array.isArray(options.allowedPageIds) ? new Set(options.allowedPageIds) : options.allowedPageIds;
    if (allowed?.size === 0) return;
    const excluded = new Set(options.excludeIds);
    for (const [pageId, chunks] of this.pages) {
      if ((allowed && !allowed.has(pageId)) || excluded.has(pageId)) continue;
      for (const entry of chunks.values()) {
        if (options.includeSources || entry.wikiType !== 'source') yield entry;
      }
    }
  }

  hasEligible(options: VectorSearchOptions) {
    return !this.eligible(options).next().done;
  }

  rank(
    query: Float32Array,
    options: VectorSearchOptions,
    minScore: number,
    topK = 30,
    distinctPages = false,
  ): VectorHit[] {
    const scored: VectorHit[] = [];
    const bestByPage = distinctPages ? new Map<string, VectorHit>() : undefined;
    for (const { chunkId, pageId, vec } of this.eligible(options)) {
      // Independent accumulators let the CPU overlap multiply-add work on long vectors.
      let a = 0;
      let b = 0;
      let c = 0;
      let d = 0;
      const length = vec.length;
      let i = 0;
      for (; i + 3 < length; i += 4) {
        a += query[i] * vec[i];
        b += query[i + 1] * vec[i + 1];
        c += query[i + 2] * vec[i + 2];
        d += query[i + 3] * vec[i + 3];
      }
      let score = a + b + (c + d);
      for (; i < length; i++) score += query[i] * vec[i];
      score = Math.max(-1, Math.min(1, score));
      if (score < minScore || !Number.isFinite(score)) continue;
      if (!bestByPage) scored.push({ chunkId, score });
      else {
        const prior = bestByPage.get(pageId);
        if (!prior || score > prior.score || (score === prior.score && chunkId.localeCompare(prior.chunkId) < 0))
          bestByPage.set(pageId, { chunkId, score });
      }
    }
    return (bestByPage ? [...bestByPage.values()] : scored)
      .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
      .slice(0, topK);
  }
}

export function readVectorHits(db: SearchDatabase, hits: VectorHit[], names: string[]): RankedWikiChunk[] {
  if (!hits.length) return [];
  const rows = db
    .prepare<[string], Omit<RetrievedChunkItem, 'score'> & { fileHash: string; aliases: string }>(
      `SELECT c.chunk_id AS chunkId, c.page_id AS pageId, c.chunk_index AS chunkIndex,
      c.heading_path AS headingPath, c.section_kind AS sectionKind, c.raw_text AS rawText,
      c.start_offset AS startOffset, c.end_offset AS endOffset, c.raw_hash AS rawHash,
      p.title AS pageTitle, p.aliases_json AS aliases, p.file_hash AS fileHash
    FROM chunks c JOIN pages p ON p.page_id = c.page_id
    WHERE c.chunk_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(hits.map(({ chunkId }) => chunkId)));
  const byId = new Map(
    rows.map(({ aliases, fileHash, ...chunk }) => [
      chunk.chunkId,
      {
        chunk,
        fileHash,
        exactName: pageNameMatch(
          [chunk.pageTitle, ...(JSON.parse(aliases) as string[])].map((title) => title.trim().toLowerCase()),
          names,
        ),
      },
    ]),
  );
  return hits.map(({ chunkId, score }) => {
    const row = byId.get(chunkId);
    if (!row) throw new Error('Wiki vector cache is stale');
    return { ...row, chunk: { ...row.chunk, score } };
  });
}
