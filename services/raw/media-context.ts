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

function imageMarkers(raw: RawImageBody) {
  if (!raw.webImages?.length) return [];
  const visible = new Map<string, number[]>();
  let fence: string | undefined;
  for (const match of raw.body.matchAll(/^[^\r\n]+/gmu)) {
    const [line] = match;
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (delimiter) {
      const marks = delimiter[1];
      if (!fence) fence = marks;
      else if (marks[0] === fence[0] && marks.length >= fence.length && !delimiter[2].trim()) fence = undefined;
    }
    if (!fence && /^【来源图片 \d/u.test(line)) {
      const marker = line.trimEnd();
      const offsets = visible.get(marker) ?? [];
      offsets.push(match.index);
      visible.set(marker, offsets);
    }
  }
  return raw.webImages
    .flatMap(({ start, label }, index) => {
      const imageIndex = index + 1;
      const marker = `【来源图片 ${imageIndex}${label ? ` · ${label}` : ''}】`;
      const offsets = visible.get(marker) ?? [];
      const position = raw.body.startsWith(marker, start) ? start : offsets.length === 1 ? offsets[0] : undefined;
      return position === undefined ? [] : [{ imageIndex, start: position, end: position + marker.length }];
    })
    .sort((a, b) => a.start - b.start);
}

function legacyOcrRanges(body: string, markers: ReturnType<typeof imageMarkers>) {
  return markers.flatMap(({ end }, index) => {
    const next = markers[index + 1]?.start ?? body.length;
    const block = /^[ \t]*\r?\n【图片 OCR 转录（需核对）】[ \t]*\r?\n[\s\S]*?^【转录结束】[ \t]*(?=\r?$)/mu.exec(
      body.slice(end, next),
    );
    return block?.index === 0 ? [{ start: end, end: end + block[0].length }] : [];
  });
}

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
export function buildRawContentForAI(raw: RawImageBody, artifacts: readonly MediaArtifact[]) {
  const markers = imageMarkers(raw);
  const removed = legacyOcrRanges(raw.body, markers);
  const inserts = artifacts
    .flatMap((artifact) => {
      const media = mediaForEvidence(artifact);
      if (!media) return [];
      const at = markers.find((marker) => marker.imageIndex === artifact.imageIndex)?.end ?? raw.body.length;
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

export function rawMediaContext(raw: RawImageBody, imageIndex: number) {
  const markers = imageMarkers(raw);
  const match = markers.find((marker) => marker.imageIndex === imageIndex);
  if (!match) return { context_before: '', context_after: '' };
  const removed = legacyOcrRanges(raw.body, markers);
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
