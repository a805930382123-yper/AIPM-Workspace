// B04: evidence location. A quote produced for one chunk is located inside that chunk's range
// of the complete Raw body; the stored start/end are absolute UTF-16 indices into the whole
// body. Ambiguous or non-matching quotes fail explicitly — the first match is never taken.
import { allOccurrences, sliceMatches, type TextChunk } from './chunk.ts';
import { LlmError } from './provider.ts';

export type EvidenceInput = { id: string; rawId: string; quote: string; start?: number; end?: number };
export type LocatedEvidence = {
  id: string; rawId: string; quote: string; start: number; end: number; chunkIndex: number; occurrences: number;
};

function badInput(error: LlmError): never { throw error; }

/** Locates provider evidence inside the chunk that produced it. */
export function locateEvidence(input: EvidenceInput, context: { body: string; rawId: string; chunk: TextChunk }): LocatedEvidence {
  const { body, rawId, chunk } = context;
  if (!input.id || !input.id.trim()) badInput(new LlmError('LLM_SCHEMA_INVALID', '证据缺少 id。', 502));
  if (input.rawId !== rawId) {
    throw new LlmError('LLM_EVIDENCE_INVALID_SOURCE', `证据 ${input.id} 的 rawId（${input.rawId}）不属于本次整理的原资料。`, 422);
  }
  if (!input.quote || !input.quote.length) {
    throw new LlmError('LLM_EVIDENCE_QUOTE_EMPTY', `证据 ${input.id} 的 quote 为空。`, 502);
  }
  // A provider may offer start/end as a hint, but only an exact slice of this chunk is accepted.
  if (input.start !== undefined && input.end !== undefined) {
    if (sliceMatches(body, input.start, input.end, input.quote) && input.start >= chunk.start && input.end <= chunk.end) {
      return { id: input.id, rawId, quote: input.quote, start: input.start, end: input.end, chunkIndex: chunk.index, occurrences: 1 };
    }
  }
  const positions = allOccurrences(body, input.quote, chunk.start, chunk.end);
  if (positions.length === 0) {
    const anywhere = allOccurrences(body, input.quote);
    if (anywhere.length) {
      throw new LlmError('LLM_EVIDENCE_OUTSIDE_CHUNK', `证据 ${input.id} 的 quote 出现在原文其它位置，但不属于本段（第 ${chunk.index + 1} 段）。`, 422);
    }
    throw new LlmError('LLM_EVIDENCE_QUOTE_NOT_FOUND', `证据 ${input.id} 的 quote 在原文中找不到（可能被改写或拼接）。`, 422);
  }
  if (positions.length > 1) {
    throw new LlmError('LLM_EVIDENCE_AMBIGUOUS', `证据 ${input.id} 的 quote 在本段出现 ${positions.length} 次，无法确定唯一位置；请在证据中给出准确的 start/end。`, 422, { occurrences: positions.length, chunkIndex: chunk.index });
  }
  const start = positions[0];
  return { id: input.id, rawId, quote: input.quote, start, end: start + input.quote.length, chunkIndex: chunk.index, occurrences: 1 };
}

/**
 * Re-locates user-edited evidence against the complete body (draft PATCH path): a unique
 * occurrence, or an exact start/end slice, must be confirmed.
 */
export function locateEvidenceInBody(input: EvidenceInput, body: string, rawId: string): LocatedEvidence {
  if (input.rawId !== rawId) {
    throw new LlmError('LLM_EVIDENCE_INVALID_SOURCE', `证据 ${input.id} 的 rawId 不属于本条 Raw。`, 422);
  }
  if (!input.quote || !input.quote.length) {
    throw new LlmError('LLM_EVIDENCE_QUOTE_EMPTY', `证据 ${input.id} 的 quote 为空。`, 422);
  }
  if (input.start !== undefined && input.end !== undefined && sliceMatches(body, input.start, input.end, input.quote)) {
    return { id: input.id, rawId, quote: input.quote, start: input.start, end: input.end, chunkIndex: -1, occurrences: 1 };
  }
  const positions = allOccurrences(body, input.quote);
  if (positions.length === 0) {
    throw new LlmError('LLM_EVIDENCE_QUOTE_NOT_FOUND', `证据 ${input.id} 的 quote 在原文中找不到，请原样复制原文片段。`, 422);
  }
  if (positions.length > 1) {
    throw new LlmError('LLM_EVIDENCE_AMBIGUOUS', `证据 ${input.id} 的 quote 在原文出现 ${positions.length} 次，请给出准确的 start/end 以消歧。`, 422, { occurrences: positions.length });
  }
  return { id: input.id, rawId, quote: input.quote, start: positions[0], end: positions[0] + input.quote.length, chunkIndex: -1, occurrences: 1 };
}

/** Verifies facts reference existing, unique, same-page evidence ids. */
export function validateEvidenceReferences(
  pageTitle: string,
  facts: Array<{ text: string; evidenceIds: string[] }>,
  evidence: Array<{ id: string }>,
): void {
  const ids = new Set<string>();
  for (const item of evidence) {
    if (ids.has(item.id)) throw new LlmError('LLM_EVIDENCE_DUPLICATE_ID', `建议「${pageTitle}」的证据 id ${item.id} 重复。`, 502);
    ids.add(item.id);
  }
  for (const fact of facts) {
    for (const id of fact.evidenceIds) {
      if (!ids.has(id)) throw new LlmError('LLM_EVIDENCE_UNKNOWN_ID', `建议「${pageTitle}」的来源事实引用了不存在的证据 id ${id}。`, 502);
    }
  }
}

/** Extracts the exact original text with a small context window for previews. */
export function evidenceContext(body: string, start: number, end: number, window = 40): { before: string; after: string } {
  return { before: body.slice(Math.max(0, start - window), start), after: body.slice(end, Math.min(body.length, end + window)) };
}
