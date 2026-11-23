import { createHash } from 'node:crypto';
import type { MediaArtifact, MediaEvidenceSource } from './media-artifact.ts';
import type { RawRecord } from './store.ts';
import { sliceMatches } from '../llm/chunk.ts';

export type { MediaEvidenceSource } from './media-artifact.ts';
export { validMediaEvidenceSource } from './media-artifact.ts';
export type MediaEvidenceText = MediaEvidenceSource & { text: string };
type ContentSpan = { start: number; end: number; sourceStart?: number; media?: MediaEvidenceSource };
export type RawAiContent = ReturnType<typeof buildRawContentForAI>;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const mediaLabels = {
  flowchart: '流程图',
  comparison_table: '对比表格',
  chart_or_ranking: '图表/排行榜',
  ui_screenshot: '界面截图',
  text_excerpt: '文字截图',
  mixed: '混合配图',
  decorative: '装饰图',
} as const;
type RawImageBody = Pick<RawRecord, 'body' | 'webImages'>;
type Span = { start: number; end: number };
type ImageMarker = Span & { imageIndex: number };
type LegacyOcrBlock = Span & { header: number; text: string };
const markerPattern = /【来源图片 ([1-9]\d*)(?: · [^】\r\n]*)?】/gu;
const isBefore = (body: string, marker: ImageMarker, block: Span) =>
  marker.end <= block.start && /^[ \t]*$/u.test(body.slice(marker.end, block.start));

function* visibleLines(body: string, excluded: Span[]) {
  let fence: string | undefined;
  for (const match of body.matchAll(/^[^\r\n]+/gmu)) {
    const [line] = match;
    if (excluded.some(({ start, end }) => start < match.index && match.index < end)) continue;
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (delimiter) {
      const marks = delimiter[1];
      if (!fence) fence = marks;
      else if (marks[0] === fence[0] && marks.length >= fence.length && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    if (!fence && !/^(?: {4}|\t)/u.test(line)) yield match;
  }
}

function imageMarkers(raw: RawImageBody, excluded: Span[] = []): ImageMarker[] {
  if (!raw.webImages?.length) return [];
  const visible = new Map<number, ImageMarker[]>();
  for (const match of visibleLines(raw.body, excluded)) {
    const [line] = match;
    const inlineCode = [...line.matchAll(/(?<!`)(`+)(?!`)[\s\S]*?\1(?!`)/gu)];
    for (const found of line.matchAll(markerPattern)) {
      const imageIndex = Number(found[1]);
      if (
        imageIndex > raw.webImages.length ||
        inlineCode.some((code) => code.index <= found.index && found.index < code.index + code[0].length)
      )
        continue;
      const start = match.index + found.index;
      const markers = visible.get(imageIndex) ?? [];
      markers.push({ imageIndex, start, end: start + found[0].length });
      visible.set(imageIndex, markers);
    }
  }
  return [...visible.values()]
    .flatMap((markers) => (markers.length === 1 ? markers : []))
    .sort((a, b) => a.start - b.start);
}

function legacyOcrBlocks(body: string): LegacyOcrBlock[] {
  const blocks: LegacyOcrBlock[] = [];
  let opening: RegExpMatchArray | undefined;
  for (const delimiter of body.matchAll(/^(【图片 OCR 转录（需核对）】|【转录结束】)[ \t]*(?=\r?$)/gmu)) {
    if (delimiter[1] === '【图片 OCR 转录（需核对）】') {
      opening = delimiter;
      continue;
    }
    if (!opening) continue;
    const header = opening.index!;
    const headerEnd = header + opening[0].length;
    const contentStart = headerEnd + (body[headerEnd] === '\r' ? 2 : 1);
    blocks.push({
      header,
      start: header - (body.slice(header - 2, header) === '\r\n' ? 2 : body[header - 1] === '\n' ? 1 : 0),
      end: delimiter.index + delimiter[0].length,
      text: body.slice(contentStart, delimiter.index).replace(/\r\n/gu, '\n'),
    });
    opening = undefined;
  }
  if (!blocks.length) return [];
  // Ignore fence-shaped lines inside possible OCR text when checking its opening delimiter.
  const interiors = blocks.map(({ header, end }) => ({ start: header, end }));
  const visible = new Set([...visibleLines(body, interiors)].map((line) => line.index));
  return blocks.filter((block) => visible.has(block.header));
}

function legacyOcrPositions(body: string, blocks: LegacyOcrBlock[], markers: ImageMarker[]) {
  const neighborChars = 64;
  return blocks.map((block, index) => {
    const marker = markers.find((item) => isBefore(body, item, block));
    const before = body
      .slice(blocks[index - 1]?.end ?? 0, marker?.start ?? block.start)
      .replace(/\r\n/gu, '\n')
      .trimEnd()
      .slice(-neighborChars);
    const after = body
      .slice(block.end, blocks[index + 1]?.start ?? body.length)
      .replace(/\r\n/gu, '\n')
      .trimStart()
      .slice(0, neighborChars);
    const hasLeftBoundary = before || index === 0;
    const hasRightBoundary = after || index === blocks.length - 1;
    return {
      block,
      marker,
      neighbors: hasLeftBoundary && hasRightBoundary ? JSON.stringify([before || null, after || null]) : undefined,
    };
  });
}

/** History identifies legacy transcriptions. The current body alone authorizes a picture occurrence. */
export function inspectRawMedia(raw: RawImageBody, acquisition: RawImageBody = raw) {
  if (!raw.webImages?.length) return { markers: [], removed: [] };
  const originalBlocks = legacyOcrBlocks(acquisition.body);
  const acquired =
    acquisition.webImages?.flatMap(({ start }, index) => {
      const [, number] = /^【来源图片 ([1-9]\d*)(?: · [^】\r\n]*)?】/u.exec(acquisition.body.slice(start)) ?? [];
      if (Number(number) !== index + 1) return [];
      const match = acquisition.body.indexOf('】', start);
      return [{ imageIndex: index + 1, start, end: match + 1 }];
    }) ?? [];
  // Direct callers can supply a collected body with offsets already shifted by a harmless preface.
  const originalMarkers = acquired.length ? acquired : imageMarkers(acquisition, originalBlocks);
  const original = legacyOcrPositions(acquisition.body, originalBlocks, originalMarkers);
  if (!original.some(({ marker }) => marker)) return { markers: imageMarkers(raw), removed: [] };
  const currentBlocks = acquisition === raw ? originalBlocks : legacyOcrBlocks(raw.body);
  const markers = imageMarkers(raw, currentBlocks);
  const current = legacyOcrPositions(raw.body, currentBlocks, markers);
  const removed: Span[] = current.flatMap(({ block, marker, neighbors }, index) => {
    // Once the acquisition proves there was legacy OCR, ambiguous complete blocks stay local.
    // Keep an ordinary example when its original provenance and content are still verifiable.
    if (acquisition === raw && !original[index].marker) return [];
    if (!marker && neighbors) {
      const matches = original.filter((candidate) => candidate.neighbors === neighbors);
      if (
        matches.length === 1 &&
        !matches[0].marker &&
        matches[0].block.text === block.text &&
        current.filter((candidate) => candidate.neighbors === neighbors).length === 1
      )
        return [];
    }
    return [{ start: marker?.end ?? block.start, end: block.end }];
  });
  return { markers, removed };
}

export type RawMediaSource = ReturnType<typeof inspectRawMedia>;

export function parsedMediaText(artifact: MediaArtifact): string | undefined {
  if (artifact.routeStatus === 'ocr_ready') return artifact.ocrCleanText?.trim() || undefined;
  if (artifact.routeStatus === 'vlm_done' && artifact.vlmMarkdown?.trim()) {
    return [artifact.vlmSummary?.trim(), artifact.vlmMarkdown.trim()].filter(Boolean).join('\n');
  }
}

export function mediaForEvidence(artifact: MediaArtifact) {
  const text = parsedMediaText(artifact);
  if (!text) return;
  const { mediaId, imageIndex } = artifact;
  return { mediaId, imageIndex, textSha256: sha(text), text };
}

/** Keep source coordinate systems separate while presenting the text in reading order. */
export function buildRawContentForAI(
  raw: RawImageBody,
  artifacts: readonly MediaArtifact[],
  source = inspectRawMedia(raw),
) {
  const { markers, removed } = source;
  const inserts = artifacts
    .flatMap((artifact) => {
      const media = mediaForEvidence(artifact);
      if (!media) return [];
      const at = markers.find((marker) => marker.imageIndex === artifact.imageIndex)?.end;
      if (at === undefined) return [];
      const label =
        artifact.routeStatus === 'vlm_done' && artifact.vlmImageType ? mediaLabels[artifact.vlmImageType] : '提取文本';
      return [{ at, media, label }];
    })
    .sort((a, b) => a.at - b.at || a.media.imageIndex - b.media.imageIndex);
  const parts: string[] = [];
  const spans: ContentSpan[] = [];
  let length = 0;
  const append = (text: string, sourceStart?: number, media?: MediaEvidenceSource) => {
    if (!text) return;
    parts.push(text);
    spans.push({ start: length, end: length + text.length, sourceStart, ...(media ? { media } : {}) });
    length += text.length;
  };
  let cursor = 0;
  const events: Array<{ at: number; end: number; media?: MediaEvidenceText; label?: string }> = [
    ...inserts.map((insert) => ({ ...insert, end: insert.at })),
    ...removed.map(({ start, end }) => ({ at: start, end })),
  ];
  for (const event of events.sort((a, b) => a.at - b.at)) {
    if (event.at >= cursor) append(raw.body.slice(cursor, event.at), cursor);
    if (event.media && event.at >= cursor) {
      const { text, ...source } = event.media;
      append(`\n[来源图片 #${source.imageIndex} · ${event.label}]\n`);
      append(text, 0, source);
      append('\n');
    }
    cursor = Math.max(cursor, event.end);
  }
  append(raw.body.slice(cursor), cursor);
  const body = parts.join('');
  return { body, spans, digest: removed.length || inserts.length ? sha(JSON.stringify([body, spans])) : undefined };
}

export function sourceRange(content: RawAiContent, start: number, end: number) {
  const span = content.spans.find((entry) => entry.start <= start && end <= entry.end);
  if (span?.sourceStart === undefined) return;
  return {
    start: span.sourceStart + start - span.start,
    end: span.sourceStart + end - span.start,
    ...(span.media ? { media: span.media } : {}),
  };
}

export function evidenceSourceId(start: number, end: number, media?: MediaEvidenceSource) {
  return media ? `image-${media.mediaId}-${start}-${end}` : `s-${start}-${end}`;
}

export function mediaQuoteMatches(
  media: MediaEvidenceSource,
  start: number,
  end: number,
  quote: string,
  texts: readonly MediaEvidenceText[],
) {
  const source = texts.find(
    (item) =>
      item.mediaId === media.mediaId && item.imageIndex === media.imageIndex && item.textSha256 === media.textSha256,
  );
  return !!source && sliceMatches(source.text, start, end, quote);
}

export function rawMediaContext(raw: RawImageBody, imageIndex: number, { markers, removed } = inspectRawMedia(raw)) {
  const match = markers.find((marker) => marker.imageIndex === imageIndex);
  if (!match) return { context_before: '', context_after: '' };
  const codePoints = (start: number, end: number) => {
    let cursor = start;
    let result = '';
    for (const span of removed) {
      if (span.start >= end || span.end <= start) continue;
      result += raw.body.slice(cursor, Math.max(cursor, span.start));
      cursor = Math.min(span.end, end);
    }
    return [...(result + raw.body.slice(cursor, end)).trim()];
  };
  return {
    context_before: codePoints(0, match.start).slice(-250).join(''),
    context_after: codePoints(match.end, raw.body.length).slice(0, 250).join(''),
  };
}
