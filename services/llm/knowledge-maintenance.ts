import { assertWikiSourcesAllowed } from '../wiki/source-lineage.ts';
import { mediaEvidenceHref } from '../raw/media-artifact.ts';
import { parseWikiMarkdown, WikiStore, type WikiRecord } from '../wiki/store.ts';
import { findDuplicateCandidates } from '../search/duplicates.ts';
import { wikiFileHash } from '../search/indexer.ts';
import {
  addModelChunk,
  completeWikiBodyInContext,
  rankWikiChunks,
  WIKI_CHUNK_INSTRUCTIONS,
  type ModelWikiContext,
  type RetrievalQuery,
  type RetrievedChunkItem,
  type SearchOptions,
} from '../search/fts-retriever.ts';
import { assertNoKnownSecret, LlmError, type LlmProvider } from './provider.ts';
import { validateSchema, type JsonSchemaNode } from './schema-validator.ts';
import { kb02StructuredOutput, decodeKb02StructuredOutput } from './openai-structured.ts';
import type { KnowledgeRunInput } from './knowledge-extraction.ts';
import type { ExtractOutcome } from './service.ts';
import { validMaintenance, type KnowledgeChange, type KnowledgeMaintenance } from '../wiki/maintenance.ts';
import type { DraftPage, DraftRecord } from '../wiki/drafts.ts';

export const MAINTENANCE_LIMITS = { pages: 8, characters: 48000 } as const;
type Sources = { get(id: string): Promise<unknown> };
type ContextOptions = SearchOptions & {
  characters?: number;
  perPageCharacters?: number;
  initialContext?: WikiRecord[];
};
export type RetrievedKnowledgeContext = {
  engine: 'sqlite_fts' | 'legacy_scan';
  degraded: boolean;
  records: WikiRecord[];
  chunks: RetrievedChunkItem[];
  context: ModelWikiContext;
};

export async function retrieveKnowledgeContextDetailed(
  wiki: WikiStore,
  rawStore: Sources,
  queries: RetrievalQuery[],
  options: ContextOptions = {},
): Promise<RetrievedKnowledgeContext> {
  const { searchIndex } = wiki;
  let degraded = false;
  const maxChars = options.characters ?? MAINTENANCE_LIMITS.characters;
  const initial = options.initialContext ?? [];
  if (searchIndex && process.env.SEARCH_ENGINE !== 'legacy_scan') {
    try {
      const candidates = rankWikiChunks(searchIndex, queries, options);
      const checked = new Map<string, WikiRecord | undefined>();
      const selected = new Map<string, WikiRecord>();
      const chunks: RetrievedChunkItem[] = [];
      let context: ModelWikiContext = initial;
      for (const { chunk, fileHash } of candidates) {
        const { pageId } = chunk;
        if (
          initial.some((page) => page.id === pageId) ||
          (!selected.has(pageId) && initial.length + selected.size >= MAINTENANCE_LIMITS.pages) ||
          chunks.filter((item) => item.pageId === pageId).length >= 5
        )
          continue;
        if (!checked.has(pageId)) {
          const markdown = await wiki.readPageFile(pageId);
          if (markdown === undefined || wikiFileHash(markdown) !== fileHash)
            throw new Error('Wiki search snapshot is stale');
          const page = parseWikiMarkdown(markdown);
          try {
            await assertWikiSourcesAllowed(wiki, rawStore, page);
            checked.set(pageId, page);
          } catch {
            checked.set(pageId, undefined);
          }
        }
        const page = checked.get(pageId);
        if (!page) continue;
        if (
          page.body.slice(chunk.startOffset, chunk.endOffset) !== chunk.rawText ||
          wikiFileHash(chunk.rawText) !== chunk.rawHash
        )
          throw new Error('Wiki search chunk does not match the stored body');
        const next = addModelChunk(context, page, chunk);
        if (JSON.stringify(next).length > maxChars) continue;
        if (
          options.perPageCharacters !== undefined &&
          JSON.stringify(next.find((item) => item.id === pageId)).length > options.perPageCharacters
        )
          continue;
        context = next;
        chunks.push(chunk);
        selected.set(pageId, page);
      }
      const order = [...selected.keys()];
      chunks.sort((a, b) => order.indexOf(a.pageId) - order.indexOf(b.pageId) || a.chunkIndex - b.chunkIndex);
      return { engine: 'sqlite_fts', degraded, records: [...selected.values()], chunks, context };
    } catch (error) {
      if (!searchIndex.isDirty) searchIndex.markDirty('retrieve', error);
      degraded = true;
    }
  }
  const records = await retrieveKnowledgeContext(wiki, rawStore, queries, options);
  return { engine: 'legacy_scan', degraded, records, chunks: [], context: [...initial, ...records] };
}

/** Category alone never selects a page. Bodies are locally ranked; only the bounded selection leaves the machine. */
export async function retrieveKnowledgeContext(
  wiki: WikiStore,
  rawStore: Sources,
  queries: RetrievalQuery[],
  options: ContextOptions = {},
): Promise<WikiRecord[]> {
  const initial = options.initialContext ?? [];
  const allowedPool = options.pageIds
    ? await Promise.all(options.pageIds.map((id) => wiki.get(id)))
    : await wiki.allRecords();
  const all = allowedPool.filter(
      (p): p is WikiRecord =>
        !!p &&
        (options.includeSources || p.type !== 'source') &&
        !options.excludeIds?.includes(p.id) &&
        !initial.some((page) => page.id === p.id),
    ),
    scores = new Map<string, number>();
  for (const query of queries) {
    for (const hit of findDuplicateCandidates({ ...query, category: '', aliases: query.tags }, all)) {
      if (hit.matches.some((m) => m.dimension !== 'category'))
        scores.set(hit.wiki.id, Math.max(scores.get(hit.wiki.id) ?? 0, hit.score));
    }
    for (const p of all) {
      const terms = [query.title, ...query.tags].map((t) => t.trim()).filter((t) => t.length >= 2);
      if (
        terms.some((t) => [p.title, ...p.aliases, ...p.tags, p.body].some((v) => v.includes(t))) ||
        [p.title, ...p.aliases, ...p.tags].some((t) => t.length >= 2 && query.content.includes(t))
      )
        scores.set(p.id, Math.max(scores.get(p.id) ?? 0, 0.4));
    }
  }
  for (const query of queries) {
    const compact = query.title.replace(/[\s\p{P}\p{S}]+/gu, ''),
      grams = [...new Set(Array.from({ length: Math.max(0, compact.length - 2) }, (_, i) => compact.slice(i, i + 3)))];
    for (const p of all) {
      const hay = [p.title, ...p.aliases, ...p.tags, p.body].join(' '),
        hits = grams.filter((g) => hay.includes(g)).length;
      if (hits >= 2)
        scores.set(p.id, Math.max(scores.get(p.id) ?? 0, 0.3 + Math.min(0.35, hits / Math.max(1, grams.length))));
    }
  }
  const ranked = all
    .filter((p) => scores.has(p.id))
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id));
  const linked = new Set(
    ranked.slice(0, 4).flatMap((p) => [...p.body.matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1].trim())),
  );
  const pool = [
    ...ranked,
    ...all.filter((p) => !scores.has(p.id) && linked.has(p.title)).sort((a, b) => a.id.localeCompare(b.id)),
  ];
  const selected: WikiRecord[] = [];
  for (const p of pool) {
    if (initial.length + selected.length >= MAINTENANCE_LIMITS.pages) break;
    if (JSON.stringify([...initial, ...selected, p]).length > (options.characters ?? MAINTENANCE_LIMITS.characters))
      continue;
    // Do not send a restricted page or its metadata; malformed/missing source bindings are denied as well.
    let allowed = true;
    try {
      await assertWikiSourcesAllowed(wiki, rawStore, p);
    } catch {
      allowed = false;
    }
    if (!allowed) continue;
    selected.push(p);
  }
  return selected;
}
const string = { type: 'string', minLength: 1, maxLength: 8000 } as const;
const list = { type: 'array', maxItems: 50, items: string } as const;
const indexes: JsonSchemaNode = { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 0 } };
const fields: Record<string, JsonSchemaNode> = {
  action: { type: 'string', enum: ['create', 'update', 'link', 'noop'] },
  targetWikiId: { type: ['string', 'null'] },
  baseRevision: { type: ['integer', 'null'] },
  title: string,
  body: { type: 'string', minLength: 1, maxLength: 100000 },
  aliases: list,
  tags: list,
  reason: string,
  summary: list,
  questions: list,
  dependsOn: indexes,
};
const maintenanceSchema = (topics: Record<string, JsonSchemaNode>): JsonSchemaNode => ({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'changes'],
  properties: {
    version: { type: 'integer', enum: [1] },
    changes: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...Object.keys(topics), ...Object.keys(fields)],
        properties: { ...topics, ...fields },
      },
    },
  },
});
const schema = maintenanceSchema({ pageIndexes: { ...indexes, minItems: 1 } });
const legacySchema = maintenanceSchema({ pageIndex: { type: 'integer', minimum: 0 } });
type Topic = Pick<DraftPage, 'type' | 'category' | 'open_questions' | 'source_evidence'>;
type WireChange = {
  pageIndexes: number[];
  action: KnowledgeChange['action'];
  targetWikiId: string | null;
  baseRevision: number | null;
  title: string;
  body: string;
  aliases: string[];
  tags: string[];
  reason: string;
  summary: string[];
  questions: string[];
  dependsOn: number[];
};
type Preparation = { action: 'create' | 'update'; target?: WikiRecord; priorCandidate?: KnowledgeChange['candidate'] };

export async function generateMaintenance(
  input: KnowledgeRunInput,
  outcome: ExtractOutcome,
): Promise<KnowledgeMaintenance> {
  if (input.checkpoint.maintenance?.proposal) {
    const proposal = input.checkpoint.maintenance.proposal;
    if (
      input.checkpoint.maintenance.protocol !== 2 &&
      proposal.changes.some((c) => !c.pageIndexes) &&
      !input.checkpoint.draftId
    ) {
      throw new LlmError(
        'LLM_CHECKPOINT_INCOMPATIBLE',
        '旧维护候选未记录完整主题归并，原检查点保留，请明确重新生成。',
        409,
      );
    }
    return proposal;
  }
  const context = input.checkpoint.maintenance?.context ?? [];
  const wikiRetrieval = input.checkpoint.maintenance?.wikiRetrieval;
  let cp = await input.beforeCall('planning');
  const proposal = await requestMaintenance(
    input.provider,
    input.signal,
    input.raw,
    outcome.document,
    outcome.pages,
    context,
    undefined,
    wikiRetrieval?.context,
    async () => {
      cp = await input.beforeCall('planning');
    },
  );
  await input.saveCheckpoint({
    ...cp,
    maintenance: { version: 1, protocol: 2, context, ...(wikiRetrieval ? { wikiRetrieval } : {}), proposal },
    stage: 'assembling',
  });
  return proposal;
}

export async function reprepareMaintenance(
  provider: LlmProvider,
  signal: AbortSignal,
  raw: KnowledgeRunInput['raw'],
  draft: DraftRecord,
  pages: DraftPage[],
  preparation: Preparation,
): Promise<KnowledgeChange> {
  const result = await requestMaintenance(
    provider,
    signal,
    raw,
    draft.document,
    pages,
    preparation.target ? [preparation.target] : [],
    preparation,
  );
  return result.changes[0];
}

async function proposeMaintenance(
  provider: LlmProvider,
  signal: AbortSignal | undefined,
  raw: KnowledgeRunInput['raw'],
  document: ExtractOutcome['document'],
  pages: Topic[],
  context: ModelWikiContext,
  preparation?: Preparation,
): Promise<WireChange[]> {
  const structuredOutput = kb02StructuredOutput('knowledge_maintenance', schema);
  const { id, title, sourceType, sourceName, author, publishedAt, url, tags } = raw;
  const request = {
    stage: 'maintenance',
    source: { id, title, sourceType, sourceName, author, publishedAt, url, tags },
    document,
    pages,
    context,
    ...(preparation
      ? {
          requested: {
            action: preparation.action,
            targetWikiId: preparation.target?.id ?? null,
            priorCandidate: preparation.priorCandidate,
          },
        }
      : {}),
  };
  assertNoKnownSecret(request, provider.secrets);
  const response = await provider.complete({
    purpose: 'knowledge',
    signal,
    timeoutMs: 120000,
    maxOutputBytes: 3 * 1024 * 1024,
    structuredOutput,
    system:
      '知识维护提议，严格输出schema JSON。pages为从0开始的本次输入主题，每个索引必须恰好被一个成果的pageIndexes覆盖。同一真实targetWikiId只可出现一次：将涉及该页的所有主题归并在一个pageIndexes集合及一份完整候选内，保留全部主题的依据与待核问题。独立新主题按语义分开，同分类或检索命中不能作为合并依据。已有同主题优先update同一真实ID。完整body保留旧有效内容、人工补充、旧来源，并整合本次内容；事实/整理/推断/待核分别分段。不同年份、主体、条件、单位及口径并列；矛盾并列待核，禁止自行裁定。相同内容及来源无变化选noop；仅增加来源选link且body和title原样；新主题create。targetWikiId/baseRevision只可来自context，create为null。dependsOn填写被引用的新页面所属输入主题索引，同一成果内部无需依赖。不要引用未提议的新页。summary列实际差异和保留内容，questions列矛盾待核。不增加本次更新审核章节。若输入含requested，严格按指定动作/目标输出一份覆盖全部给定主题的候选。create只依据给定主题和原文证据，禁止带入旧页内容；update基于唯一新目标快照，若有同一目标此前候选，保留其中已有的人工编辑。' +
      (context.some((page) => 'chunks' in page)
        ? WIKI_CHUNK_INSTRUCTIONS +
          '针对只有chunks的目标，link/noop保持原题名，body写为“（正文保持原样）”。update时依据已读片段判断目标并提出整合，系统会用完整目标正文复核不完整片段的更新提议。'
        : '') +
      (pages.some((page) => page.source_evidence.some((entry) => entry.media))
        ? '有media标记的证据是来源图片解析，引用时注明图序，位置只对应图片解析文本。'
        : '') +
      JSON.stringify(schema),
    user: JSON.stringify(request),
  });
  if (signal?.aborted) throw new LlmError('LLM_CANCELLED', '知识维护已取消。', 409);
  if (response.finishReason === 'length' || Buffer.byteLength(response.text) > 3 * 1024 * 1024)
    throw new LlmError('LLM_OUTPUT_TRUNCATED', '维护提议超过上限，检查点保留。', 502);
  let value: unknown;
  try {
    value = JSON.parse(response.text);
  } catch {
    throw new LlmError('LLM_INVALID_JSON', '维护提议不是合法JSON。', 502);
  }
  assertNoKnownSecret(value, provider.secrets);
  if (response.structuredOutputApplied) value = decodeKb02StructuredOutput(value, schema, structuredOutput);
  let changes: WireChange[];
  if (!validateSchema(value, schema).length) changes = (value as { changes: WireChange[] }).changes;
  else if (!response.structuredOutputApplied && !validateSchema(value, legacySchema).length) {
    changes = (value as { changes: Array<Omit<WireChange, 'pageIndexes'> & { pageIndex: number }> }).changes.map(
      ({ pageIndex, ...change }) => ({ ...change, pageIndexes: [pageIndex] }),
    );
  } else throw new LlmError('LLM_SCHEMA_INVALID', '维护提议未通过结构校验。', 502);
  return changes;
}

async function requestMaintenance(
  provider: LlmProvider,
  signal: AbortSignal | undefined,
  raw: KnowledgeRunInput['raw'],
  document: ExtractOutcome['document'],
  pages: Topic[],
  context: WikiRecord[],
  preparation?: Preparation,
  retrievedContext?: ModelWikiContext,
  beforeRepair?: () => Promise<void>,
): Promise<KnowledgeMaintenance> {
  const changes = await proposeMaintenance(
    provider,
    signal,
    raw,
    document,
    pages,
    retrievedContext ?? context,
    preparation,
  );
  const owners = new Map<number, string>(),
    targets = new Set<string>();
  for (const change of changes) {
    change.pageIndexes.sort((a, b) => a - b);
    const id = `change-${change.pageIndexes[0]}`;
    for (const index of change.pageIndexes) {
      if (!pages[index] || owners.has(index))
        throw new LlmError('LLM_MAINTENANCE_COVERAGE', '维护提议必须恰好覆盖每个输入主题一次。', 502);
      owners.set(index, id);
    }
    if (change.targetWikiId && targets.has(change.targetWikiId))
      throw new LlmError(
        'LLM_MAINTENANCE_TARGET',
        '维护提议为同一目标返回了多份候选，请继续重试以重新准备归并成果。',
        502,
      );
    if (change.targetWikiId) targets.add(change.targetWikiId);
  }
  if (owners.size !== pages.length) throw new LlmError('LLM_MAINTENANCE_COVERAGE', '维护提议遗漏输入主题。', 502);
  if (
    preparation &&
    (changes.length !== 1 ||
      changes[0].action !== preparation.action ||
      changes[0].targetWikiId !== (preparation.target?.id ?? null))
  )
    throw new LlmError('LLM_MAINTENANCE_TARGET', '重准备未遵守指定动作与目标，原草稿保留。', 502);
  for (const c of changes) {
    const old = context.find((page) => page.id === c.targetWikiId);
    if (
      !old ||
      old.revision !== c.baseRevision ||
      !retrievedContext?.some((page) => page.id === old.id && 'chunks' in page)
    )
      continue;
    if ((c.action === 'link' || c.action === 'noop') && c.body === '（正文保持原样）') c.body = old.body;
    if (c.action !== 'update' || completeWikiBodyInContext(retrievedContext, old)) continue;
    if (JSON.stringify([old]).length > MAINTENANCE_LIMITS.characters)
      throw new LlmError('LLM_MAINTENANCE_CONTEXT_TOO_LARGE', '更新目标完整正文超过48000字符，检查点保留。', 413);
    await beforeRepair?.();
    const topics = c.pageIndexes.map((index) => pages[index]);
    const [repaired, extra] = await proposeMaintenance(provider, signal, raw, document, topics, [old], {
      action: 'update',
      target: old,
    });
    if (
      !repaired ||
      extra ||
      repaired.action !== 'update' ||
      repaired.targetWikiId !== old.id ||
      repaired.baseRevision !== old.revision ||
      repaired.pageIndexes.length !== topics.length ||
      topics.some((_, index) => !repaired.pageIndexes.includes(index))
    )
      throw new LlmError('LLM_MAINTENANCE_TARGET', '完整目标复核没有返回覆盖原主题的同一目标更新。', 502);
    Object.assign(c, { ...repaired, pageIndexes: c.pageIndexes, dependsOn: c.dependsOn });
  }
  const proposal: KnowledgeMaintenance = {
    version: 1,
    context,
    changes: changes.map((c) => {
      const [pageIndex] = c.pageIndexes,
        changeId = owners.get(pageIndex)!,
        page = pages[pageIndex],
        old = context.find((p) => p.id === c.targetWikiId);
      if (
        !page ||
        (c.action === 'create'
          ? c.targetWikiId !== null || c.baseRevision !== null
          : !old || old.revision !== c.baseRevision)
      )
        throw new LlmError('LLM_MAINTENANCE_TARGET', '维护目标不在已读取的真实Wiki快照中。', 502);
      if (old && (c.action === 'link' || c.action === 'noop') && (c.body !== old.body || c.title !== old.title))
        throw new LlmError('LLM_MAINTENANCE_TARGET', '关联/无变化操作不能重写正文或标题。', 502);
      if (c.dependsOn.some((i) => !owners.has(i)))
        throw new LlmError('LLM_MAINTENANCE_INVALID', '维护提议包含未知主题依赖。', 502);
      const unchanged =
        old &&
        c.title === old.title &&
        c.body.trimEnd() === old.body.trimEnd() &&
        c.aliases.every((alias) => old.aliases.includes(alias)) &&
        c.tags.every((tag) => old.tags.includes(tag));
      const metadataOnly = old && (c.action === 'link' || c.action === 'noop' || unchanged);
      const action = metadataOnly ? (old.sources.includes(raw.id) ? 'noop' : 'link') : c.action;
      const reason =
        action === c.action
          ? c.reason
          : action === 'link'
            ? '目标正文保持原样，本次资料补充为新来源。'
            : '目标正文和来源均已包含本次资料。';
      const summary = metadataOnly
        ? [action === 'link' ? '补充本次 Raw 来源，正文与主题元数据保持原样。' : '正文与来源均无需变更。']
        : c.summary;
      const mediaLinks = [
        ...new Set(
          c.pageIndexes.flatMap((index) =>
            pages[index].source_evidence.flatMap((item) =>
              item.media
                ? [
                    `[Raw ${item.rawId} · 来源图片 ${item.media.imageIndex}](${mediaEvidenceHref(item.rawId, item.media)})`,
                  ]
                : [],
            ),
          ),
        ),
      ].filter((link) => !c.body.includes(link));
      return {
        changeId,
        pageIndex,
        pageIndexes: c.pageIndexes,
        action,
        ...(old ? { targetWikiId: old.id, baseRevision: old.revision } : {}),
        candidate: {
          title: c.title,
          type: old?.type ?? (page.type as WikiRecord['type']),
          category: old?.category ?? page.category,
          body: metadataOnly
            ? old.body
            : c.body +
              (mediaLinks.length ? '\n\n### 来源图片解析\n\n' + mediaLinks.map((link) => `- ${link}`).join('\n') : ''),
          aliases: metadataOnly ? old.aliases : [...new Set([...(old?.aliases ?? []), ...c.aliases])],
          tags: metadataOnly ? old.tags : [...new Set([...(old?.tags ?? []), ...c.tags])],
          sources: [...new Set([...(old?.sources ?? []), raw.id])],
          knowledge_status: old?.knowledge_status ?? 'ai_organized',
          confidence: old?.confidence ?? 'medium',
          source_level: old?.source_level ?? document.source_level ?? 'D',
        },
        reason,
        summary,
        questions: [...new Set([...c.questions, ...c.pageIndexes.flatMap((i) => pages[i].open_questions)])],
        dependsOn: metadataOnly
          ? []
          : [...new Set(c.dependsOn.map((i) => owners.get(i)!).filter((id) => id !== changeId))],
        decision: 'defer',
      };
    }),
  };
  if (!validMaintenance(proposal)) throw new LlmError('LLM_MAINTENANCE_INVALID', '维护提议包含非法依赖或元数据。', 502);
  return proposal;
}
