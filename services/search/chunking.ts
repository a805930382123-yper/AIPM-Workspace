import { createHash } from 'node:crypto';
import type { WikiRecord } from '../wiki/store.ts';

export type SectionKind = 'fact' | 'inference' | 'mixed' | 'meta';

export interface WikiChunk {
  chunkId: string;
  pageId: string;
  chunkIndex: number;
  headingPath: string;
  sectionKind: SectionKind;
  rawText: string;
  startOffset: number;
  endOffset: number;
  rawHash: string;
  charCount: number;
}

type Section = Pick<WikiChunk, 'headingPath' | 'sectionKind' | 'startOffset' | 'endOffset'> & { parent: number };

const SOFT_MIN = 150;
const HARD_MAX = 1200;
const OVERLAP = 100;
const paragraphBreak = /(?:\r\n|\r(?!\n)|\n)[ \t]*(?:\r\n|\r(?!\n)|\n)/g;
const sentenceBreak = /\r\n|[\r\n。！？；.!?;]/g;

function headingKind(title: string): SectionKind | undefined {
  const label = title
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/^\*{1,2}|\*{1,2}$/g, '');
  const name = label.split(/[:(]/, 1)[0];
  if (/^(?:(?:来源|原文|原始|已核实|可验证)?事实|原文字层|原文支持|来源摘录|来源证据)$/.test(name)) return 'fact';
  if (/^(?:(?:AI|分析与|问答|模型)?推断(?:与建议|与来源观点)?|推论|分析建议)$/i.test(name)) return 'inference';
  if (/^(?:来源(?:信息|等级)?|Raw来源|主要来源|本主题依据|PDF页级依据|摘要|元信息|关联)$/i.test(name)) return 'meta';
  if (/^(?:(?:AI|综合|人工)?整理|整理归纳|待(?:核|确认|验证)(?:实|内容|问题)?|PDF页图AI解读)$/i.test(name))
    return 'mixed';
}

function sectionsOf(sourceText: string, pageTitle: string): Section[] {
  const sections: Section[] = [];
  let active: Omit<Section, 'endOffset'> = { startOffset: 0, headingPath: pageTitle, sectionKind: 'mixed', parent: -1 };
  const headings: Array<{ title: string; offset: number; kind: SectionKind }> = [];
  let path = pageTitle;
  let kind: SectionKind = 'mixed';
  let fence: string | undefined;
  let diagramRows = false;
  const begin = (startOffset: number, sectionKind: SectionKind) => {
    if (startOffset > active.startOffset) sections.push({ ...active, endOffset: startOffset });
    active = { startOffset, sectionKind, headingPath: path, parent: headings[2]?.offset ?? -1 };
  };

  for (const match of sourceText.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const line = match[0].replace(/[\r\n]+$/, '');
    if (!line.trim()) continue;
    const offset = match.index;
    const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMarker?.[1].startsWith(fence) && !fenceMarker[2].trim()) fence = undefined;
      continue;
    }
    if (fenceMarker) {
      if (active.sectionKind !== kind) begin(offset, kind);
      fence = fenceMarker[1];
      diagramRows = false;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
      diagramRows = false;
      headings.length = Math.min(level, headings.length);
      if (level === 1) {
        path = pageTitle;
        kind = 'mixed';
        if (active.headingPath !== path || active.sectionKind !== kind) begin(offset, kind);
        continue;
      }
      const parents = headings.filter(Boolean);
      const marked = headingKind(title);
      const inherited = marked ?? parents.at(-1)?.kind ?? 'mixed';
      headings[level] = { title, offset, kind: inherited };
      const split = level <= 3 || marked !== undefined || inherited !== kind;
      kind = inherited;
      if (split) path = [...parents.map((parent) => parent.title), title].join(' > ');
      if (split || active.sectionKind !== kind) begin(offset, kind);
      continue;
    }

    // The formal renderer appends attribution to diagram rows after its node/relationship labels.
    const diagramLabel = line === '节点：' || line === '关系：';
    diagramRows = diagramLabel || (diagramRows && line.startsWith('- '));
    const diagramAttribution = diagramRows
      ? /^- .+? 【(原文支持|整理归纳|补充知识，未经原文支持|待核实)】(?: 事实引用：[^\s；]+)?(?:；原因：.*)?$/.exec(
          line,
        )?.[1]
      : undefined;
    const attribution = diagramAttribution ?? /(?:^\s*(?:[-+*]\s+)?|^\|.*\|[ \t]*)【([^】]+)】/.exec(line)?.[1];
    const lineKind =
      attribution === '补充知识，未经原文支持' ? 'mixed' : (attribution && headingKind(attribution)) || kind;
    if (lineKind !== active.sectionKind) begin(offset, lineKind);
  }
  if (active.startOffset < sourceText.length) sections.push({ ...active, endOffset: sourceText.length });

  const merged: Section[] = [];
  for (const section of sections) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.parent === section.parent &&
      previous.sectionKind === section.sectionKind &&
      previous.endOffset - previous.startOffset < SOFT_MIN &&
      section.endOffset - section.startOffset < SOFT_MIN
    ) {
      previous.endOffset = section.endOffset;
    } else {
      merged.push(section);
    }
  }
  return merged;
}

function lastBreak(pattern: RegExp, text: string, after: number) {
  let end: number | undefined;
  for (const match of text.matchAll(pattern)) {
    const boundary = match.index + match[0].length;
    if (boundary > after) end = boundary;
  }
  return end;
}

// A hard cut must also keep a supplementary Unicode character or CRLF intact.
function safeOffset(text: string, offset: number) {
  const code = text.charCodeAt(offset);
  return (code >= 0xdc00 && code <= 0xdfff && /[\ud800-\udbff]/.test(text[offset - 1])) ||
    (text[offset - 1] === '\r' && text[offset] === '\n')
    ? offset - 1
    : offset;
}

export function chunkWikiPage({ id, title, body }: Pick<WikiRecord, 'id' | 'title' | 'body'>): WikiChunk[] {
  const chunks: WikiChunk[] = [];
  for (const section of sectionsOf(body, title)) {
    let start = section.startOffset;
    let covered = start;
    while (covered < section.endOffset) {
      let end = section.endOffset;
      if (end - start > HARD_MAX) {
        const cap = safeOffset(body, start + HARD_MAX);
        const window = body.slice(start, cap);
        // Keep growing the covered interval even when a boundary lies inside the overlap.
        const after = Math.max(OVERLAP, covered - start);
        end =
          start +
          (lastBreak(paragraphBreak, window, after) ?? lastBreak(sentenceBreak, window, after) ?? window.length);
      }
      const rawText = body.slice(start, end);
      const chunkIndex = chunks.length;
      const chunk: WikiChunk = {
        chunkId: `${id}#${chunkIndex}`,
        pageId: id,
        chunkIndex,
        headingPath: section.headingPath,
        sectionKind: section.sectionKind,
        rawText,
        startOffset: start,
        endOffset: end,
        rawHash: createHash('sha256').update(rawText).digest('hex'),
        charCount: rawText.length,
      };
      if (
        end <= covered ||
        chunk.charCount > HARD_MAX ||
        body.slice(chunk.startOffset, chunk.endOffset) !== chunk.rawText
      )
        throw new Error(`Invalid Wiki chunk offsets: ${chunk.chunkId}`);
      chunks.push(chunk);
      covered = end;
      if (end === section.endOffset) break;

      const target = Math.max(start + 1, end - OVERLAP);
      const lower = Math.max(start + 1, target - 25);
      let aligned = target;
      let distance = Infinity;
      for (const match of body.slice(lower - 1, Math.min(end - 1, target + 25)).matchAll(sentenceBreak)) {
        const boundary = lower - 1 + match.index + match[0].length;
        if (Math.abs(target - boundary) < distance) {
          aligned = boundary;
          distance = Math.abs(target - boundary);
        }
      }
      start = safeOffset(body, aligned);
    }
  }
  return chunks;
}
