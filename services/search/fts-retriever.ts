import type { WikiRecord } from '../wiki/store.ts';
import type { WikiChunk } from './chunking.ts';
import type { WikiSearchIndexer } from './indexer.ts';
import { buildFtsQuery } from './tokenizer.ts';

export type RetrievedChunkItem = Omit<WikiChunk, 'charCount'> & {
  pageTitle: string;
  score: number;
  hitSource?: 'both' | 'fts' | 'vector';
  ftsRank?: number;
  vectorRank?: number;
  vectorScore?: number;
  rrfScore?: number;
};
export type RankedWikiChunk = { chunk: RetrievedChunkItem; fileHash: string; exactName: boolean };
type Candidate = Omit<RetrievedChunkItem, 'score'> & {
  aliases: string;
  fileHash: string;
  bm25: number;
  titleTokens: string;
  metaTokens: string;
  bodyTokens: string;
};
type ModelWikiChunk = Pick<RetrievedChunkItem, 'chunkId' | 'startOffset' | 'endOffset' | 'rawText'> & { label: string };
export type ModelWikiPage = Pick<WikiRecord, 'id' | 'title' | 'type' | 'revision' | 'sources' | 'knowledge_status'> & {
  chunks: ModelWikiChunk[];
};
export type ModelWikiContext = (WikiRecord | ModelWikiPage)[];
export type RetrievalQuery = { title: string; content: string; tags: string[] };
export type SearchOptions = { includeSources?: boolean; pageIds?: string[]; excludeIds?: string[] };

const sectionLabels = { fact: '事实', inference: '推断', mixed: '混合', meta: '元信息' } as const;

export function queryPageNames(queries: RetrievalQuery[]) {
  return [
    ...new Set(
      queries
        .flatMap(({ title, tags }) => [title, ...tags])
        .map((text) => text.trim().toLowerCase())
        .filter((text) => text.length >= 2),
    ),
  ];
}

export function pageNameMatch(pageNames: string[], names: string[]) {
  return pageNames.some(
    (name) => name.length >= 2 && names.some((keyword) => name.includes(keyword) || keyword.includes(name)),
  );
}

export function rankWikiChunks(
  index: WikiSearchIndexer,
  queries: RetrievalQuery[],
  options: SearchOptions,
): RankedWikiChunk[] {
  if (index.isDirty) throw new Error('Wiki search index is dirty');
  if (options.pageIds?.length === 0) return [];
  const keywords = queries.flatMap(({ title, tags }) => [title, ...tags]);
  const { match, queryGroups } = buildFtsQuery([...keywords, ...queries.map(({ content }) => content)]);
  if (!match) return [];
  // For a longer standalone question, broad topic overlap alone is weak evidence.
  // Count characters so segmentation into single Han characters does not give a
  // fragmented word multiple votes. Briefs and document-based searches can use
  // individual concepts from the supplied document or explicitly selected pages.
  const standalone =
    !options.pageIds && queries.length === 1 && (!queries[0].content || queries[0].content === queries[0].title);
  const informative = queryGroups.filter(({ coverageWeight }) => coverageWeight > 0);
  const minimumCoverage =
    standalone && informative.length >= 6 ? informative.reduce((sum, group) => sum + group.coverageWeight, 0) / 2 : 0;
  const search = index.read((db) =>
    db
      .prepare<unknown[], Candidate>(
        `
    SELECT c.chunk_id AS chunkId, c.page_id AS pageId, c.chunk_index AS chunkIndex,
      c.heading_path AS headingPath, c.section_kind AS sectionKind, c.raw_text AS rawText,
      c.start_offset AS startOffset, c.end_offset AS endOffset, c.raw_hash AS rawHash,
      p.title AS pageTitle, p.aliases_json AS aliases, p.file_hash AS fileHash,
      f.title_tokens AS titleTokens, f.meta_tokens AS metaTokens, f.body_tokens AS bodyTokens,
      bm25(chunks_fts, 0, 0, 6.0, 3.0, 1.0) AS bm25
    FROM chunks_fts AS f JOIN chunks AS c ON c.chunk_id = f.chunk_id
    JOIN pages AS p ON p.page_id = c.page_id
    WHERE chunks_fts MATCH ?
      AND (? OR p.wiki_type <> 'source')
      AND (? IS NULL OR p.page_id IN (SELECT value FROM json_each(?)))
      AND p.page_id NOT IN (SELECT value FROM json_each(?))
    ORDER BY bm25 ASC, c.chunk_id ASC LIMIT 30
  `,
      )
      .all(
        match,
        Number(options.includeSources ?? false),
        options.pageIds ? 1 : null,
        JSON.stringify(options.pageIds ?? []),
        JSON.stringify(options.excludeIds ?? []),
      ),
  );

  const names = queryPageNames(queries);
  return search
    .flatMap(({ bm25, aliases, titleTokens, metaTokens, bodyTokens, fileHash, ...chunk }) => {
      const fields = [titleTokens, metaTokens, bodyTokens].map((field) => ` ${field} `);
      const covered = queryGroups.filter(({ terms }) =>
        terms.some((term) => fields.some((field) => field.includes(' ' + term + ' '))),
      );
      const pageNames = [chunk.pageTitle, ...(JSON.parse(aliases) as string[])].map((title) =>
        title.toLowerCase().trim(),
      );
      const exactName = pageNameMatch(pageNames, names);
      const normalized = -bm25 / (1 - bm25);
      if (!covered.length || (covered.length === 1 && covered[0].generic && normalized < 0.35)) return [];
      if (
        minimumCoverage > 0 &&
        !pageNames.includes(queries[0].title.toLowerCase().trim()) &&
        covered.reduce((sum, group) => sum + group.coverageWeight, 0) < minimumCoverage
      )
        return [];
      const score = normalized + (covered.length / queryGroups.length) * 0.45 + (exactName ? 0.3 : 0);
      return [{ chunk: { ...chunk, score }, fileHash, exactName }];
    })
    .sort((a, b) => b.chunk.score - a.chunk.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
}

export function addModelChunk(context: ModelWikiContext, page: WikiRecord, item: RetrievedChunkItem) {
  const chunk: ModelWikiChunk = {
    chunkId: item.chunkId,
    startOffset: item.startOffset,
    endOffset: item.endOffset,
    label: `[Wiki页: ${page.title} | 章节: ${item.headingPath} | 属性: ${sectionLabels[item.sectionKind]} | 块ID: ${item.chunkId}]`,
    rawText: item.rawText,
  };
  return context.some((p) => p.id === page.id)
    ? context.map((p) =>
        p.id === page.id && 'chunks' in p
          ? { ...p, chunks: [...p.chunks, chunk].sort((a, b) => a.startOffset - b.startOffset) }
          : p,
      )
    : [
        ...context,
        {
          id: page.id,
          title: page.title,
          type: page.type,
          revision: page.revision,
          sources: page.sources,
          knowledge_status: page.knowledge_status,
          chunks: [chunk],
        },
      ];
}

export const WIKI_CHUNK_INSTRUCTIONS =
  'Wiki的chunks为原始正文片段。rawText未改写，startOffset/endOffset为完整Wiki正文UTF-16位置；引用使用正文绝对位置并完整落在一段已提供的rawText内。';

export function quoteInWikiContext(context: ModelWikiContext, id: string, start: number, end: number, quote: string) {
  const page = context.find((p) => p.id === id);
  return (
    !!page &&
    (!('chunks' in page) ||
      page.chunks.some(
        (chunk) =>
          start >= chunk.startOffset &&
          end <= chunk.endOffset &&
          chunk.rawText.slice(start - chunk.startOffset, end - chunk.startOffset) === quote,
      ))
  );
}

export function completeWikiBodyInContext(context: ModelWikiContext, page: WikiRecord) {
  const wire = context.find((item) => item.id === page.id);
  if (!wire) return false;
  if (!('chunks' in wire)) return true;
  let covered = 0;
  for (const chunk of wire.chunks) {
    if (chunk.startOffset > covered) return false;
    covered = Math.max(covered, chunk.endOffset);
  }
  return covered === page.body.length;
}
