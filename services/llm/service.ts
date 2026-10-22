// B04: LLMService.wikiExtract — chunk a Raw, call the single configured provider with the
// frozen rules, validate the structured JSON strictly, locate evidence against the complete
// Raw, and merge all chunks into one reviewable result. Any chunk failure fails the whole
// extraction: a partial set of chunks is never presented as a complete result.
import { chunkText, type TextChunk } from './chunk.ts';
import { buildDocumentMergeSystemPrompt, buildLocatorSystemPrompt, loadExtractionRules, type ExtractionRulesBundle } from './rules.ts';
import { locateEvidence, validateEvidenceReferences, type LocatedEvidence } from './evidence.ts';
import { buildEvidenceLocatorCatalog, locatorProviderSchema, resolveLocatorEvidence, EVIDENCE_LOCATOR_FORMAT_VERSION } from './locators.ts';
import { assertNoKnownSecret, LlmError, describeUnparsable, sanitizeDeep, sanitizeProviderText, type LlmProvider } from './provider.ts';
import { validateSchema, type JsonSchemaNode } from './schema-validator.ts';

export type ExtractRawInput = {
  id: string; title: string; sourceType: string; sourceName: string;
  author?: string; publishedAt?: string; url?: string; tags: string[];
};
export type ExtractStage = 'chunking' | 'extracting' | 'merging' | 'validating' | 'planning' | 'assembling';
export type ExtractProgress = { stage: ExtractStage; chunksTotal: number; chunksDone: number; pagesFound: number };
export type ExtractedFact = { text: string; evidenceIds: string[] };
export type ExtractedPage = {
  title: string; type: string; category: string; one_line_definition: string;
  source_facts: ExtractedFact[]; ai_organized: string[]; ai_inferences: string[];
  related_pages: string[]; open_questions: string[];
  source_evidence: LocatedEvidence[];
  provenance: Array<{ chunkIndex: number; start: number; end: number }>;
  mergedFrom?: string[];
  notes?: string[];
};
export type ExtractDocument = { title: string; main_topic: string; summary: string };
export type ExtractOutcome = {
  document: ExtractDocument; pages: ExtractedPage[];
  provider: { name: string; model: string }; rulesVersion: string;
  callCount: number; chunkCount: number;
  chunkCoverage: Array<{ index: number; start: number; end: number }>;
  usage: { promptTokens: number; completionTokens: number };
  warnings: string[];
};

type ProviderPage = {
  title: string; type: string; category: string; one_line_definition: string;
  source_facts: ExtractedFact[]; ai_organized: string[]; ai_inferences: string[];
  related_pages: string[]; open_questions: string[];
  source_evidence: Array<{ id: string; rawId: string; quote: string; start?: number; end?: number }>;
};
type ProviderResult = { document: ExtractDocument; suggested_pages: ProviderPage[] };

const DOCUMENT_ONLY_SCHEMA: JsonSchemaNode = {
  type: 'object', additionalProperties: false, required: ['document'],
  properties: {
    document: {
      type: 'object', additionalProperties: false, required: ['title', 'main_topic', 'summary'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        main_topic: { type: 'string', minLength: 1, maxLength: 300 },
        summary: { type: 'string', minLength: 1, maxLength: 4000 },
      },
    },
  },
};

const normalizeTitle = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s_\-·、，,。.；;：:（）()【】\[\]]+/gu, '');

/** F04-11: the aggregate and the per-chunk snapshots must never share mutable state. */
function clonePage(page: ExtractedPage): ExtractedPage {
  return {
    ...page,
    source_facts: page.source_facts.map(fact => ({ text: fact.text, evidenceIds: [...fact.evidenceIds] })),
    ai_organized: [...page.ai_organized],
    ai_inferences: [...page.ai_inferences],
    related_pages: [...page.related_pages],
    open_questions: [...page.open_questions],
    source_evidence: page.source_evidence.map(evidence => ({ ...evidence })),
    provenance: page.provenance.map(item => ({ ...item })),
    ...(page.mergedFrom ? { mergedFrom: [...page.mergedFrom] } : {}),
    ...(page.notes ? { notes: [...page.notes] } : {}),
  };
}

/** F04-11: a normalized page must never contain a fact that points at a missing evidence id. */
function assertReferencesResolve(page: ExtractedPage): void {
  const known = new Set(page.source_evidence.map(evidence => evidence.id));
  for (const fact of page.source_facts) {
    for (const id of fact.evidenceIds) {
      if (!known.has(id)) {
        throw new LlmError('LLM_MERGE_FAILED', `聚合后的「${page.title}」存在无法解析的证据引用 ${id}，已停止而不是把它当成空证据。`, 500, { pageTitle: page.title, missingEvidenceId: id });
      }
    }
  }
}

function parseProviderJson(text: string, secrets: readonly string[]): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new LlmError('LLM_EMPTY_RESULT', 'Provider 返回了空结果，未产生任何知识建议。', 502);
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed) as unknown; }
  catch {
    // F04-10: never echo provider text verbatim — only a redacted shape description.
    throw new LlmError('LLM_INVALID_JSON', 'Provider 返回的内容不是合法 JSON（未做修补，避免把不完整结果当成成功）。', 502, {
      ...describeUnparsable(trimmed, secrets),
    });
  }
  assertNoKnownSecret(parsed, secrets);
  return parsed;
}

function assertSchema(value: unknown, schema: JsonSchemaNode, code: string, label: string, secrets: readonly string[]): void {
  const errors = validateSchema(value, schema);
  if (errors.length) {
    const sanitized = errors.map(item => sanitizeProviderText(item, secrets));
    throw new LlmError(code, sanitizeProviderText(`${label}未通过结构校验（${errors.length} 处问题）：${errors.slice(0, 5).join('；')}`, secrets), 502, { errors: sanitized.slice(0, 20) });
  }
}

export type WikiExtractInput = {
  raw: ExtractRawInput; body: string; provider: LlmProvider;
  signal?: AbortSignal; onProgress?: (progress: ExtractProgress) => void; rulesDir?: string;
};

export class LLMService {
  constructor(private readonly rulesDir: string) {}

  /** Extracts structured knowledge suggestions for one Raw. Never writes formal knowledge. */
  async wikiExtract(input: WikiExtractInput): Promise<ExtractOutcome> {
    const bundle = await loadExtractionRules(input.rulesDir ?? this.rulesDir);
    const budgets = bundle.rules.budgets;
    const deadline = Date.now() + budgets.totalDeadlineMs;
    const progress = (stage: ExtractStage, chunksTotal: number, chunksDone: number, pagesFound: number) =>
      input.onProgress?.({ stage, chunksTotal, chunksDone, pagesFound });
    const guard = () => {
      if (input.signal?.aborted) throw new LlmError('LLM_CANCELLED', '提取已被取消。', 409);
      if (Date.now() > deadline) throw new LlmError('LLM_DEADLINE_EXCEEDED', `提取超过本批 ${budgets.totalDeadlineMs / 1000} 秒总期限，已中止；未生成草稿。`, 504);
    };

    progress('chunking', 0, 0, 0);
    const chunks = chunkText(input.body, { maxChunkChars: budgets.maxChunkChars, overlap: budgets.chunkOverlap, maxRawChars: budgets.maxRawChars });
    if (!chunks.length) throw new LlmError('LLM_EMPTY_RESULT', '这条原文没有可分析的正文，无法提取知识。', 422);

    const warnings: string[] = [];
    const usage = { promptTokens: 0, completionTokens: 0 };
    let callCount = 0;
    progress('extracting', chunks.length, 0, 0);

    const chunkResults: Array<{ chunk: TextChunk; result: ProviderResult; pages: ExtractedPage[] }> = [];
    for (let wave = 0; wave < chunks.length; wave += budgets.maxConcurrentChunks) {
      guard();
      const batch = chunks.slice(wave, wave + budgets.maxConcurrentChunks);
      const settled = await Promise.all(batch.map(async chunk => {
        const call = await this.callChunk(bundle, input.raw, input.body, chunk, {
          provider: input.provider, signal: input.signal, timeoutMs: Math.min(budgets.callTimeoutMs, Math.max(1000, deadline - Date.now())),
          maxOutputBytes: budgets.maxOutputBytesPerCall, maxSuggestedPages: budgets.maxSuggestedPages,
        });
        return { chunk, call };
      }));
      for (const item of settled) {
        callCount += 1;
        usage.promptTokens += item.call.usage.promptTokens ?? 0;
        usage.completionTokens += item.call.usage.completionTokens ?? 0;
        chunkResults.push({ chunk: item.chunk, result: item.call.result, pages: item.call.pages });
        progress('extracting', chunks.length, chunkResults.length, chunkResults.reduce((sum, entry) => sum + entry.pages.length, 0));
      }
    }
    guard();
    if (chunks.length > 1 && !chunkResults.some(entry => entry.chunk.end >= input.body.length)) {
      throw new LlmError('LLM_CHUNK_COVERAGE', '分块未覆盖原文末尾，未生成草稿。', 500);
    }

    progress('merging', chunks.length, chunks.length, chunkResults.reduce((sum, entry) => sum + entry.pages.length, 0));
    const merged = this.mergePages(chunkResults, warnings);
    if (merged.length > budgets.maxSuggestedPages) {
      throw new LlmError('LLM_TOO_MANY_PAGES', `整理出 ${merged.length} 条建议，超过本批 ${budgets.maxSuggestedPages} 条上限；请缩短资料或分次整理。`, 422, { pages: merged.length });
    }

    let document = this.mergeDocument(chunkResults.map(entry => entry.result.document), merged);
    if (!document) {
      const call = await this.callDocumentMerge(bundle, input.raw, chunkResults, {
        provider: input.provider, signal: input.signal, timeoutMs: Math.min(budgets.callTimeoutMs, Math.max(1000, deadline - Date.now())),
        maxOutputBytes: budgets.maxOutputBytesPerCall,
      });
      callCount += 1;
      usage.promptTokens += call.usage.promptTokens ?? 0;
      usage.completionTokens += call.usage.completionTokens ?? 0;
      document = call.document;
    }

    progress('validating', chunks.length, chunks.length, merged.length);
    if (!merged.length) throw new LlmError('LLM_EMPTY_RESULT', 'Provider 没有给出任何知识建议（suggested_pages 为空）。', 502);
    for (const page of merged) {
      validateEvidenceReferences(page.title, page.source_facts, page.source_evidence);
      if (!page.source_facts.length) throw new LlmError('LLM_EMPTY_FACTS', `建议「${page.title}」没有任何来源事实。`, 502);
    }
    const seen = new Map<string, string>();
    for (const page of merged) {
      const key = normalizeTitle(page.title);
      if (seen.has(key)) throw new LlmError('LLM_DUPLICATE_PAGE_TITLE', `合并后仍存在重复标题（${seen.get(key)} / ${page.title}）。`, 500);
      seen.set(key, page.title);
    }

    return {
      document, pages: merged, provider: { name: input.provider.name, model: input.provider.model },
      rulesVersion: bundle.rulesVersion, callCount, chunkCount: chunks.length,
      chunkCoverage: chunks.map(chunk => ({ index: chunk.index, start: chunk.start, end: chunk.end })),
      usage, warnings,
    };
  }

  private async callChunk(
    bundle: ExtractionRulesBundle, raw: ExtractRawInput, body: string, chunk: TextChunk,
    options: { provider: LlmProvider; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number; maxSuggestedPages: number },
  ): Promise<{ result: ProviderResult; pages: ExtractedPage[]; usage: { promptTokens?: number; completionTokens?: number } }> {
    const metadata = [
      `- 标题：${raw.title}`,
      `- 来源类型：${raw.sourceType} / 来源名称：${raw.sourceName}`,
      raw.author ? `- 作者：${raw.author}` : null,
      raw.publishedAt ? `- 原发布日期：${raw.publishedAt}` : null,
      raw.url ? `- 链接：${raw.url}` : null,
      raw.tags.length ? `- 标签：${raw.tags.join('、')}` : null,
    ].filter(Boolean).join('\n');
    const catalog = buildEvidenceLocatorCatalog(body, chunk);
    const v2Schema = locatorProviderSchema(bundle.schema);
    const user = [
      '请把下面这段资料整理为结构化知识建议（只输出 JSON 对象）。',
      '',
      '资料元数据：',
      metadata,
      '',
      `原文总长度：${body.length} 个 JavaScript 字符。`,
      `本次只提供第 ${chunk.index + 1} 段，覆盖原文全局区间 [${chunk.start}, ${chunk.end})。`,
      `当前 Raw ID：${raw.id}（仅作上下文，locator v2证据不输出该字段）`,
      `本次证据输入格式版本为 ${EVIDENCE_LOCATOR_FORMAT_VERSION}：顶层必须含 evidence_format_version: ${EVIDENCE_LOCATOR_FORMAT_VERSION}；每条 source_evidence 只输出 {"id":"本页唯一证据ID","locatorId":"下方目录中的ID"}。locatorId 必须来自当前分块目录；不要输出 rawId、quote、start 或 end。服务端会从不可变 Raw 按该 locator 精确生成这些字段。`,
      'source_facts[].evidenceIds 只能引用本页 source_evidence[].id；输出前逐页核对每个事实引用都存在。不得引用其它建议页或分块的证据 ID。locator目录覆盖当前块全文，优先按句/段切分，定位ID各自代表精确连续原文片段；重复文本的位置拥有不同ID。只在原文支持且具有独立业务知识价值时生成建议页；不要为了排版、文档标记或免责声明单独创建填充页。',
      `最多给出 ${options.maxSuggestedPages} 条建议；每条只解决一个知识问题。`,
      '',
      '当前分块证据 locator 目录（只用于选择定位ID，不是事实来源）：',
      JSON.stringify(catalog.map(({ id, text }) => ({ id, text }))),
      '',
      '资料正文：',
      '<<<',
      chunk.text,
      '>>>',
    ].join('\n');
    let completion;
    try {
      completion = await options.provider.complete({ system: buildLocatorSystemPrompt(bundle.rules, v2Schema), user, timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes, signal: options.signal, purpose: 'knowledge' });
    } catch (error) {
      if (error instanceof LlmError) {
        const details = error.details === undefined ? {} : sanitizeDeep(error.details, options.provider.secrets);
        throw new LlmError(sanitizeProviderText(error.code, options.provider.secrets) || 'LLM_PROVIDER_ERROR', `${sanitizeProviderText(error.message, options.provider.secrets)}（第 ${chunk.index + 1} 段）`, error.status, { ...(typeof details === 'object' && details ? details as object : {}), chunkIndex: chunk.index });
      }
      throw error;
    }
    const parsed = parseProviderJson(completion.text, options.provider.secrets ?? []);
    const hasVersion = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'evidence_format_version');
    let normalized: unknown = parsed;
    if (hasVersion) {
      assertSchema(parsed, v2Schema, 'LLM_SCHEMA_INVALID', `第 ${chunk.index + 1} 段的 locator v2 返回`, options.provider.secrets ?? []);
      normalized = resolveLocatorEvidence(parsed as Record<string, unknown>, catalog, raw.id, chunk.index);
    }
    assertNoKnownSecret(normalized, options.provider.secrets ?? []);
    assertSchema(normalized, bundle.schema, 'LLM_SCHEMA_INVALID', `第 ${chunk.index + 1} 段的返回`, options.provider.secrets ?? []);
    const result = normalized as ProviderResult;
    const pages = result.suggested_pages.map(page => this.buildPage(page, raw, body, chunk));
    return { result, pages, usage: completion.usage ?? {} };
  }

  private buildPage(page: ProviderPage, raw: ExtractRawInput, body: string, chunk: TextChunk): ExtractedPage {
    const evidence = page.source_evidence.map(item => locateEvidence(item, { body, rawId: raw.id, chunk }));
    const facts = page.source_facts.map(fact => ({ text: fact.text.trim(), evidenceIds: [...fact.evidenceIds] }));
    validateEvidenceReferences(page.title.trim() || '(无标题)', facts, evidence);
    return {
      title: page.title.trim(), type: page.type, category: page.category,
      one_line_definition: page.one_line_definition.trim(),
      source_facts: facts,
      ai_organized: page.ai_organized.map(item => item.trim()).filter(Boolean),
      ai_inferences: page.ai_inferences.map(item => item.trim()).filter(Boolean),
      related_pages: page.related_pages.map(item => item.trim()).filter(Boolean),
      open_questions: page.open_questions.map(item => item.trim()).filter(Boolean),
      source_evidence: evidence,
      provenance: [{ chunkIndex: chunk.index, start: chunk.start, end: chunk.end }],
    };
  }

  private mergePages(entries: Array<{ chunk: TextChunk; pages: ExtractedPage[] }>, warnings: string[]): ExtractedPage[] {
    const merged = new Map<string, ExtractedPage>();
    for (const entry of entries) {
      for (const source of entry.pages) {
        // F04-11: the aggregate works on an independent deep copy. Every chunk's normalized
        // snapshot (evidence ids *and* the facts referencing them) stays intact and internally
        // consistent for the document-merge call, which reads those per-chunk snapshots.
        const page = clonePage(source);
        const key = normalizeTitle(page.title);
        const existing = merged.get(key);
        if (!existing) { merged.set(key, page); continue; }
        const renamed = new Map<string, string>();
        // Reserve all current IDs before generating suffixes. A valid provider ID may
        // already equal the suffix we'd otherwise assign to another evidence item.
        const reservedIds = new Set([
          ...existing.source_evidence.map(item => item.id),
          ...page.source_evidence.map(item => item.id),
        ]);
        for (const evidence of page.source_evidence) {
          const taken = existing.source_evidence.find(item => item.id === evidence.id);
          if (!taken) continue;
          if (sameEvidenceSource(taken, evidence)) { renamed.set(evidence.id, evidence.id); continue; }
          const base = `${evidence.id}-c${evidence.chunkIndex + 1}`;
          let candidate = base;
          let disambiguator = 2;
          while (reservedIds.has(candidate)) candidate = `${base}-${disambiguator++}`;
          reservedIds.add(candidate);
          renamed.set(evidence.id, candidate);
          evidence.id = candidate;
          warnings.push(`证据 id ${taken.id} 在不同分块中含义不同，「${page.title}」将其重命名为 ${candidate}。`);
        }
        // Keep this copy's own fact references in sync with the renamed evidence ids.
        for (const fact of page.source_facts) fact.evidenceIds = fact.evidenceIds.map(id => renamed.get(id) ?? id);
        for (const fact of page.source_facts) {
          const ids = [...fact.evidenceIds];
          const duplicate = existing.source_facts.find(item => item.text === fact.text);
          if (duplicate) {
            for (const id of ids) if (!duplicate.evidenceIds.includes(id)) duplicate.evidenceIds.push(id);
          } else {
            existing.source_facts.push({ text: fact.text, evidenceIds: ids });
          }
        }
        const appendUnique = <T,>(target: T[], source: T[]) => { for (const item of source) if (!target.includes(item)) target.push(item); };
        appendUnique(existing.ai_organized, page.ai_organized);
        appendUnique(existing.ai_inferences, page.ai_inferences);
        appendUnique(existing.related_pages, page.related_pages);
        appendUnique(existing.open_questions, page.open_questions);
        for (const evidence of page.source_evidence) {
          if (!existing.source_evidence.some(item => sameEvidenceSource(item, evidence))) existing.source_evidence.push(evidence);
        }
        for (const item of page.provenance) {
          if (!existing.provenance.some(current => current.chunkIndex === item.chunkIndex && current.start === item.start)) existing.provenance.push(item);
        }
        existing.mergedFrom = [...(existing.mergedFrom ?? []), page.title];
        if (page.one_line_definition.length > existing.one_line_definition.length) existing.one_line_definition = page.one_line_definition;
        if (page.type !== existing.type) {
          existing.notes = [...(existing.notes ?? []), `不同分块对「${page.title}」给出不同类型（${existing.type} / ${page.type}），已保留先出现的类型，请人工确认。`];
        }
        if (page.category !== existing.category) {
          existing.notes = [...(existing.notes ?? []), `不同分块对「${page.title}」给出不同分类（${existing.category} / ${page.category}），已保留先出现的分类，请人工确认。`];
        }
      }
    }
    for (const page of merged.values()) assertReferencesResolve(page);
    return [...merged.values()];
  }

  /** Deterministic document merge; returns undefined when an extra (budgeted) summary call is needed. */
  private mergeDocument(documents: ExtractDocument[], pages: ExtractedPage[]): ExtractDocument | undefined {
    const first = documents[0];
    if (!first) return undefined;
    if (documents.length === 1) return { title: first.title, main_topic: first.main_topic, summary: first.summary };
    const summaries = [...new Set(documents.map(item => item.summary.trim()).filter(Boolean))];
    const combined = summaries.join('\n\n');
    // F04-11: chunks that describe the source differently cannot be merged by simple
    // concatenation without losing information, so the extra structured merge call runs and
    // receives every chunk's complete result. Identical summaries stay on the cheap path.
    if (summaries.length > 1) return undefined;
    if (combined.length > 4000) return undefined;
    const mainTopic = [...new Set(documents.map(item => item.main_topic.trim()).filter(Boolean))].join(' / ').slice(0, 300);
    return {
      title: first.title.slice(0, 300),
      main_topic: mainTopic || first.main_topic,
      summary: combined || `${pages.length} 条知识建议`,
    };
  }

  private async callDocumentMerge(
    bundle: ExtractionRulesBundle, raw: ExtractRawInput, entries: Array<{ chunk: TextChunk; result: ProviderResult; pages: ExtractedPage[] }>,
    options: { provider: LlmProvider; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number },
  ): Promise<{ document: ExtractDocument; usage: { promptTokens?: number; completionTokens?: number } }> {
    // F04-11: the merge call must receive every chunk's complete structured result — facts with
    // their evidence, organized text, inferences and open questions — not only summaries. It uses
    // the *normalized* per-chunk pages (entry.pages), so every evidence keeps the global UTF-16
    // position that was resolved against the full Raw, even when the provider omitted its
    // optional start/end hint.
    const payload = entries.map(entry => ({
      chunk: entry.chunk.index + 1,
      chunkRange: { start: entry.chunk.start, end: entry.chunk.end },
      document: entry.result.document,
      pages: entry.pages.map(page => ({
        title: page.title, type: page.type, category: page.category,
        one_line_definition: page.one_line_definition,
        source_facts: page.source_facts.map(fact => ({
          text: fact.text,
          evidence: fact.evidenceIds.map(id => {
            const evidence = page.source_evidence.find(item => item.id === id);
            // F04-11: „should exist" evidence may not be silently downgraded to unresolved and
            // still sent as a successful merge input — that would hide a real reference bug.
            if (!evidence) {
              throw new LlmError('LLM_MERGE_FAILED', `分块汇总输入里「${page.title}」引用的证据 ${id} 无法解析（第 ${entry.chunk.index + 1} 段），已停止汇总。`, 500, { chunkIndex: entry.chunk.index, pageTitle: page.title, missingEvidenceId: id });
            }
            return { id: evidence.id, rawId: evidence.rawId, quote: evidence.quote, start: evidence.start, end: evidence.end, chunkIndex: evidence.chunkIndex };
          }),
        })),
        ai_organized: page.ai_organized,
        ai_inferences: page.ai_inferences,
        open_questions: page.open_questions,
        related_pages: page.related_pages,
      })),
    }));
    const user = [
      '下面是同一份资料按顺序切分后每一段各自产出的**完整结构化结果**（JSON 数组）：包括每段的摘要、每条建议的标题/类型/分类/一句话说明、来源事实（含对应证据引文与全局位置）、AI 整理、AI 推断、待确认问题和关联页面。',
      '请只输出一个 JSON 对象：{"document":{"title":"","main_topic":"","summary":""}}，',
      'summary 必须综合所有分块的事实、整理与推断，覆盖每一段，不能丢段、不能只看摘要；如果不同分块有冲突或缺口，请在 summary 中明确写出。',
      `title/main_topic 各不超过 300 字，summary 不超过 4000 字。`,
      `资料标题：${raw.title}`,
      '',
      JSON.stringify(payload),
    ].join('\n');
    let completion;
    try {
      completion = await options.provider.complete({ system: buildDocumentMergeSystemPrompt(bundle.rules, DOCUMENT_ONLY_SCHEMA), user, timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes, signal: options.signal, purpose: 'knowledge' });
    } catch (error) {
      if (error instanceof LlmError) throw new LlmError('LLM_MERGE_FAILED', `分块汇总失败：${sanitizeProviderText(error.message, options.provider.secrets)}`, error.status);
      throw error;
    }
    const parsed = parseProviderJson(completion.text, options.provider.secrets ?? []);
    assertSchema(parsed, DOCUMENT_ONLY_SCHEMA, 'LLM_MERGE_FAILED', '分块汇总的返回', options.provider.secrets ?? []);
    return { document: (parsed as { document: ExtractDocument }).document, usage: completion.usage ?? {} };
  }
}

// Neighboring chunks can independently report the same Raw-backed evidence. Chunk
// provenance is intentionally excluded: the identity is the full source span and text.
function sameEvidenceSource(left: LocatedEvidence, right: LocatedEvidence): boolean {
  return left.id === right.id && left.rawId === right.rawId && left.start === right.start &&
    left.end === right.end && left.quote === right.quote;
}


