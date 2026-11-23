// Deterministic, chunk-local evidence anchors used by provider output format v2.
import { LlmError } from './provider.ts';
import type { JsonSchemaNode } from './schema-validator.ts';
import type { TextChunk } from './chunk.ts';

export const EVIDENCE_LOCATOR_FORMAT_VERSION = 2;
export const MAX_EVIDENCE_LOCATOR_CHARS = 512;
export const MAX_EVIDENCE_LOCATORS_PER_CHUNK = 256;

export type EvidenceLocator = { id: string; start: number; end: number; text: string; sourceBoundary?: true };

const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isSurrogateSafeBoundary = (body: string, position: number) =>
  !(position > 0 && position < body.length && high(body.charCodeAt(position - 1)) && low(body.charCodeAt(position)));

function preferredBoundary(body: string, start: number, limit: number): number | undefined {
  let paragraph: number | undefined;
  let line: number | undefined;
  let sentence: number | undefined;
  let whitespace: number | undefined;
  for (let index = start; index < limit; index += 1) {
    const char = body[index];
    if (char === '\n') {
      line = index + 1;
      let next = index + 1;
      while (next < limit && (body[next] === ' ' || body[next] === '\t' || body[next] === '\r')) next += 1;
      if (next < limit && body[next] === '\n') paragraph = next + 1;
    }
    if (/[。！？!?；;]/u.test(char)) {
      let next = index + 1;
      while (next < limit && /[。！？!?；;”’」』】）》]/u.test(body[next])) next += 1;
      if (next === limit || /\s/u.test(body[next] ?? '')) sentence = next;
    }
    if (/\s/u.test(char)) whitespace = index + 1;
  }
  const choice = paragraph ?? sentence ?? line ?? whitespace;
  return choice !== undefined && choice > start && choice <= limit ? choice : undefined;
}

/** Splits a complete chunk into bounded, contiguous, UTF-16-safe Raw slices. */
export function buildEvidenceLocatorCatalog(
  body: string,
  chunk: TextChunk,
  limits: { maxLocatorChars?: number; maxLocators?: number; sourceBoundaries?: readonly number[] } = {},
): EvidenceLocator[] {
  const maxChars = limits.maxLocatorChars ?? MAX_EVIDENCE_LOCATOR_CHARS;
  const maxLocators = limits.maxLocators ?? MAX_EVIDENCE_LOCATORS_PER_CHUNK;
  if (
    !Number.isInteger(chunk.start) ||
    !Number.isInteger(chunk.end) ||
    chunk.start < 0 ||
    chunk.end > body.length ||
    chunk.end <= chunk.start ||
    body.slice(chunk.start, chunk.end) !== chunk.text
  ) {
    throw new LlmError(
      'LLM_EVIDENCE_CATALOG_INVALID',
      `第 ${chunk.index + 1} 段的定位目录无法对应完整 Raw 区间。`,
      500,
      { chunkIndex: chunk.index },
    );
  }
  if (!Number.isInteger(maxChars) || maxChars < 1 || !Number.isInteger(maxLocators) || maxLocators < 1) {
    throw new LlmError('LLM_EVIDENCE_CATALOG_INVALID', '证据定位目录的边界配置无效。', 500, {
      chunkIndex: chunk.index,
    });
  }

  const locators: EvidenceLocator[] = [];
  const boundaries =
    limits.sourceBoundaries?.filter((position) => position > chunk.start && position < chunk.end) ?? [];
  let start = chunk.start;
  while (start < chunk.end) {
    if (locators.length >= maxLocators) {
      throw new LlmError(
        'LLM_EVIDENCE_CATALOG_LIMIT',
        `第 ${chunk.index + 1} 段需要超过 ${maxLocators} 个定位锚点，已停止提取。`,
        422,
        { chunkIndex: chunk.index, maxLocators },
      );
    }
    let limit = Math.min(start + maxChars, chunk.end, boundaries.find((position) => position > start) ?? chunk.end);
    if (!isSurrogateSafeBoundary(body, limit)) limit -= 1;
    const end = preferredBoundary(body, start, limit) ?? limit;
    if (end <= start || !isSurrogateSafeBoundary(body, end)) {
      throw new LlmError('LLM_EVIDENCE_CATALOG_INVALID', `第 ${chunk.index + 1} 段无法生成安全定位锚点。`, 500, {
        chunkIndex: chunk.index,
      });
    }
    const ordinal = String(locators.length + 1).padStart(3, '0');
    locators.push({
      id: `c${chunk.index + 1}-l${ordinal}`,
      start,
      end,
      text: body.slice(start, end),
      ...(boundaries.includes(start) ? { sourceBoundary: true as const } : {}),
    });
    start = end;
  }

  let cursor = chunk.start;
  for (const locator of locators) {
    if (
      locator.start !== cursor ||
      locator.end <= locator.start ||
      locator.end - locator.start > maxChars ||
      body.slice(locator.start, locator.end) !== locator.text
    ) {
      throw new LlmError('LLM_EVIDENCE_CATALOG_INVALID', `第 ${chunk.index + 1} 段的定位目录覆盖检查失败。`, 500, {
        chunkIndex: chunk.index,
      });
    }
    cursor = locator.end;
  }
  if (
    !locators.length ||
    cursor !== chunk.end ||
    locators.length > maxLocators ||
    new Set(locators.map((item) => item.id)).size !== locators.length
  ) {
    throw new LlmError('LLM_EVIDENCE_CATALOG_INVALID', `第 ${chunk.index + 1} 段的定位目录未完整覆盖chunk。`, 500, {
      chunkIndex: chunk.index,
    });
  }
  return locators;
}

/** Strict provider-only schema for v2; persisted and normalized evidence schema remains unchanged. */
export function locatorProviderSchema(base: JsonSchemaNode): JsonSchemaNode {
  const schema = JSON.parse(JSON.stringify(base)) as JsonSchemaNode;
  const properties = schema.properties;
  const pageSchema = properties?.suggested_pages?.items;
  const evidenceSchema = pageSchema?.properties?.source_evidence;
  if (!properties || !schema.required || !pageSchema?.properties || !evidenceSchema?.items) {
    throw new LlmError('LLM_RULES_INVALID', '无法从提取schema构造locator v2输入校验。', 500);
  }
  schema.$id = 'fmcg-wiki-extract-locator-v2';
  schema.required = [...schema.required, 'evidence_format_version'];
  properties.evidence_format_version = { type: 'integer', enum: [EVIDENCE_LOCATOR_FORMAT_VERSION] };
  evidenceSchema.items = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'locatorId'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      locatorId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  };
  return schema;
}

/** Converts validated provider locator IDs into the legacy normalized evidence contract. */
export function resolveLocatorEvidence(
  value: Record<string, unknown>,
  catalog: EvidenceLocator[],
  rawId: string,
  chunkIndex: number,
): Record<string, unknown> {
  const suggestedPages = value.suggested_pages;
  if (!Array.isArray(suggestedPages)) return value;
  const byId = new Map(catalog.map((locator) => [locator.id, locator]));
  const pages = suggestedPages.map((page, pageIndex) => {
    if (!page || typeof page !== 'object' || Array.isArray(page)) return page;
    const record = page as Record<string, unknown>;
    if (!Array.isArray(record.source_evidence)) return page;
    return {
      ...record,
      source_evidence: record.source_evidence.map((item, evidenceIndex) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const evidence = item as Record<string, unknown>;
        const locatorId = evidence.locatorId;
        const locator = typeof locatorId === 'string' ? byId.get(locatorId) : undefined;
        if (!locator) {
          throw new LlmError(
            'LLM_EVIDENCE_UNKNOWN_LOCATOR',
            `第 ${chunkIndex + 1} 段第 ${pageIndex + 1} 条建议的第 ${evidenceIndex + 1} 个证据引用了未知或其它分块的定位锚点。`,
            422,
            { chunkIndex, locatorId: typeof locatorId === 'string' ? locatorId : undefined },
          );
        }
        return { id: evidence.id, rawId, quote: locator.text, start: locator.start, end: locator.end };
      }),
    };
  });
  const normalized = { ...value, suggested_pages: pages };
  delete (normalized as Record<string, unknown>).evidence_format_version;
  return normalized;
}
