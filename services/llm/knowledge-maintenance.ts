import { assertWikiSourcesAllowed } from '../wiki/source-lineage.ts';
import { WikiStore, type WikiRecord } from '../wiki/store.ts';
import { findDuplicateCandidates } from '../search/duplicates.ts';
import { assertNoKnownSecret, LlmError, type LlmProvider } from './provider.ts';
import { validateSchema, type JsonSchemaNode } from './schema-validator.ts';
import { kb02StructuredOutput, decodeKb02StructuredOutput } from './openai-structured.ts';
import type { KnowledgeRunInput } from './knowledge-extraction.ts';
import type { ExtractOutcome } from './service.ts';
import { validMaintenance, type KnowledgeChange, type KnowledgeMaintenance } from '../wiki/maintenance.ts';
import type { DraftPage, DraftRecord } from '../wiki/drafts.ts';

export const MAINTENANCE_LIMITS = { pages: 8, characters: 48000 } as const;
/** Category alone never selects a page. Bodies are locally ranked; only the bounded selection leaves the machine. */
export async function retrieveKnowledgeContext(
  wiki: WikiStore,
  rawStore: { get(id: string): Promise<unknown> },
  queries: { title: string; content: string; tags: string[] }[],
  options: { includeSources?: boolean } = {},
): Promise<WikiRecord[]> {
  const all = (await wiki.allRecords()).filter((p) => options.includeSources || p.type !== 'source'),
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
  let size = 0;
  const selected: WikiRecord[] = [];
  for (const p of pool) {
    if (selected.length === MAINTENANCE_LIMITS.pages) break;
    const length = JSON.stringify(p).length;
    if (size + length > MAINTENANCE_LIMITS.characters) continue;
    // Do not send a restricted page or its metadata; malformed/missing source bindings are denied as well.
    let allowed = true;
    try {
      await assertWikiSourcesAllowed(wiki, rawStore, p);
    } catch {
      allowed = false;
    }
    if (!allowed) continue;
    selected.push(p);
    size += length;
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
  const cp = await input.beforeCall('planning');
  const proposal = await requestMaintenance(
    input.provider,
    input.signal,
    input.raw,
    outcome.document,
    outcome.pages,
    context,
  );
  await input.saveCheckpoint({
    ...cp,
    maintenance: { version: 1, protocol: 2, context, proposal },
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

async function requestMaintenance(
  provider: LlmProvider,
  signal: AbortSignal | undefined,
  raw: KnowledgeRunInput['raw'],
  document: ExtractOutcome['document'],
  pages: Topic[],
  context: WikiRecord[],
  preparation?: Preparation,
): Promise<KnowledgeMaintenance> {
  const structuredOutput = kb02StructuredOutput('knowledge_maintenance', schema);
  const request = {
    stage: 'maintenance',
    source: raw,
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
          body: metadataOnly ? old.body : c.body,
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
