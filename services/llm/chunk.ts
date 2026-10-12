// B04: deterministic chunking of a Raw body. Global indices are JavaScript UTF-16 character
// offsets into the COMPLETE Raw body (left-closed, right-open); no silent truncation and no
// surrogate pair is ever split.
import { LlmError } from './provider.ts';

export type TextChunk = { index: number; start: number; end: number; text: string };
export type ChunkOptions = { maxChunkChars: number; overlap: number; maxRawChars: number };

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

export function chunkText(body: string, options: ChunkOptions): TextChunk[] {
  if (body.length > options.maxRawChars) {
    throw new LlmError('LLM_RAW_TOO_LARGE', `原文 ${body.length} 字符，超过本批 ${options.maxRawChars} 字符预算；原文完整保留，未做截尾。`, 413);
  }
  if (!body.length) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + options.maxChunkChars, body.length);
    // Never cut a surrogate pair at the end of a chunk.
    if (end < body.length && isLowSurrogate(body.charCodeAt(end))) end -= 1;
    if (end <= start) end = Math.min(start + 1, body.length);
    chunks.push({ index: chunks.length, start, end, text: body.slice(start, end) });
    if (end >= body.length) break;
    let next = Math.max(0, end - options.overlap);
    // Never start a chunk in the middle of a surrogate pair.
    if (isLowSurrogate(body.charCodeAt(next))) next += 1;
    // Guarantee forward progress even when overlap >= chunk length.
    if (next <= start) next = end;
    start = next;
  }
  return chunks;
}

/** True when [start,end) is a valid, surrogate-safe slice of body whose text equals quote. */
export function sliceMatches(body: string, start: number, end: number, quote: string): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end > body.length || start >= end) return false;
  if (isLowSurrogate(body.charCodeAt(start))) return false;
  if (isHighSurrogate(body.charCodeAt(end - 1))) return false;
  return body.slice(start, end) === quote;
}

export function allOccurrences(body: string, quote: string, from = 0, to = body.length): number[] {
  const positions: number[] = [];
  if (!quote) return positions;
  let index = body.indexOf(quote, from);
  while (index !== -1 && index + quote.length <= to) {
    positions.push(index);
    index = body.indexOf(quote, index + 1);
  }
  return positions;
}
