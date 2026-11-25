import { EmbeddingError } from './embedding-provider.ts';
import {
  queryPageNames,
  rankWikiChunks,
  type RankedWikiChunk,
  type RetrievalQuery,
  type SearchOptions,
} from './fts-retriever.ts';
import type { VectorQueryAuthorization, WikiSearchIndexer } from './indexer.ts';

const DEFAULT_RRF_K = 60;
const EXACT_NAME_BONUS = 0.008;
const VECTOR_GREY_MARGIN = 0.06;

export async function rankHybridChunks(
  index: WikiSearchIndexer,
  queries: RetrievalQuery[],
  options: SearchOptions & VectorQueryAuthorization,
  onDegrade: (reason: string) => void,
) {
  if (options.pageIds?.length === 0) return [];
  if (index.isDirty) throw new Error('Wiki search index is dirty');
  const input = [
    ...new Set(
      queries
        .flatMap(({ title, content, tags }) => [title, content, ...tags])
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
    .join('\n')
    .slice(0, 3000)
    .replace(/[\ud800-\udbff]$/u, '');
  const configured = process.env.SEARCH_VECTOR_MIN_SCORE?.trim();
  const threshold = configured ? Number(configured) : NaN;
  const minScore = Number.isFinite(threshold) && threshold >= -1 && threshold <= 1 ? threshold : 0.42;
  const minVectorOnlyScore = Math.min(1, minScore + VECTOR_GREY_MARGIN);
  const configuredRrfK = Number(process.env.SEARCH_RRF_K);
  const rrfK = Number.isFinite(configuredRrfK) && configuredRrfK > 0 ? configuredRrfK : DEFAULT_RRF_K;
  let vectors: RankedWikiChunk[] = [];
  if (/[\p{L}\p{N}]/u.test(input)) {
    try {
      vectors = await index.rankVectorChunks(input, queryPageNames(queries), options, minScore);
    } catch (error) {
      if (!(error instanceof EmbeddingError)) throw error;
      onDegrade(
        [
          'EMBEDDING_UNCONFIGURED',
          'EMBEDDING_EMPTY',
          'EMBEDDING_TIMEOUT',
          'EMBEDDING_SOURCE_UNAVAILABLE',
          'EMBEDDING_VERSION_CHANGED',
          'EMBEDDING_STALE',
          'EMBEDDING_ABORTED',
          'EMBEDDING_SECRET_BLOCKED',
        ].includes(error.code)
          ? error.code.toLowerCase()
          : 'embedding_error',
      );
      return rankWikiChunks(index, queries, options);
    }
  }
  const fts = rankWikiChunks(index, queries, options);
  const candidates = new Map<
    string,
    { item: RankedWikiChunk; ftsRank?: number; vectorRank?: number; vectorScore?: number }
  >();
  for (const [i, item] of fts.entries()) candidates.set(item.chunk.chunkId, { item, ftsRank: i + 1 });
  for (const [i, item] of vectors.entries()) {
    const prior = candidates.get(item.chunk.chunkId);
    const vectorScore = item.chunk.score;
    if (!prior && vectorScore < minVectorOnlyScore) continue;
    candidates.set(item.chunk.chunkId, { ...prior, item: prior?.item ?? item, vectorRank: i + 1, vectorScore });
  }
  return [...candidates.values()]
    .map(({ item, ftsRank, vectorRank, vectorScore }): RankedWikiChunk => {
      const rrfScore = (ftsRank ? 1 / (rrfK + ftsRank) : 0) + (vectorRank ? 1 / (rrfK + vectorRank) : 0);
      const hitSource = ftsRank ? (vectorRank ? 'both' : 'fts') : 'vector';
      return {
        ...item,
        chunk: {
          ...item.chunk,
          score: rrfScore + (item.exactName ? EXACT_NAME_BONUS : 0),
          hitSource,
          ftsRank,
          vectorRank,
          vectorScore,
          rrfScore,
        },
      };
    })
    .sort((a, b) => b.chunk.score - a.chunk.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
}
