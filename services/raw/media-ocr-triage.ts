import type { MediaArtifactResult, OcrQualityMetrics } from './media-artifact.ts';

export interface OcrLineInput {
  text: string;
  confidence?: number;
  bbox?: [number, number, number, number];
}

export interface ImageMetaInput {
  width?: number;
  height?: number;
  lines: OcrLineInput[];
  preserveVisuals?: boolean;
}

export const OCR_TRIAGE_CONFIG = {
  minImageWidth: 120,
  minImageHeight: 80,
  maxBannerAspectRatio: 6,
  minBannerTextChars: 30,
  minEffectiveChars: 15,
  shortLineMaxChars: 4,
  maxGibberishRatio: 0.18,
  maxShortLineRatio: 0.45,
  minLinesForShortLineRule: 6,
  minAvgConfidence: 0.72,
  maxLayoutDispersion: 0.55,
  minLinesForLayoutRule: 5,
  minChartSignalScore: 0.6,
  minDecorativeChartSignal: 0.35,
  minQualityScore: 70,
  pseudoWordMinLength: 6,
  pseudoWordMinVowelRatio: 0.15,
  pseudoWordMaxVowelRatio: 0.8,
  pseudoWordConsonantRun: 5,
  columnSpaces: 3,
  chartDigitMinRatio: 0.15,
  chartDigitWeight: 0.35,
  chartDirectionWeight: 0.35,
  chartColumnMinLines: 3,
  chartColumnWeight: 0.3,
  chartLabelMinRatio: 0.25,
  chartLabelWeight: 0.3,
  qualityGibberishPenalty: 120,
  qualityShortLinePenalty: 45,
  qualityLayoutPenalty: 25,
  qualityTargetConfidence: 0.85,
  qualityConfidencePenalty: 80,
  cleanupEdgeFragmentMaxChars: 3,
  cleanupShortLineMaxChars: 8,
} as const;

const config = OCR_TRIAGE_CONFIG;
const effectiveChars = /[\p{Script=Han}A-Za-z\p{Nd}]/gu;
const wordOrDigit = /[A-Za-z\p{Nd}\p{Script=Han}]+(?:[-./_][A-Za-z\p{Nd}\p{Script=Han}]+)*/gu;
const commonOcrChar =
  /[\p{Script=Han}\p{Nd}\x20-\x7E，。！？：；、（）【】《》「」『』“”‘’…—–·•●▪％＃＠＆＋＝／｜～．－→↓↑]/u;
const columns = new RegExp(`\\t| {${config.columnSpaces},}`, 'u');
const listItem = /^(?:[-+*]\s+|[•●▪]\s*|[（(]?[\p{Nd}一二三四五六七八九十]+[.、)）](?!\p{Nd}))/u;
const sentenceEnd = /[。！？：；…!?;:]$/u;
const heading = /^#{1,6}\s|^【[^】]+】$/u;

function layoutDispersion(lines: OcrLineInput[], lengths: number[], columnCount: number, width?: number) {
  const boxes = lines.flatMap(({ bbox }) =>
    bbox?.every(Number.isFinite) && bbox[2] > bbox[0] && bbox[3] > bbox[1] ? [bbox] : [],
  );
  if (boxes.length >= 2) {
    const normalized = boxes.every((box) => box[0] >= 0 && box[1] >= 0 && box[2] <= 1 && box[3] <= 1);
    const left = Math.min(...boxes.map(([x]) => x));
    const inferredWidth = Math.max(...boxes.map((box) => box[2])) - Math.min(left, 0);
    const coordinateWidth = normalized ? 1 : (width ?? inferredWidth);
    const offsets = boxes.map(([x]) => (x - left) / coordinateWidth);
    const mean = offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length;
    const stddev = Math.sqrt(offsets.reduce((sum, offset) => sum + (offset - mean) ** 2, 0) / offsets.length);
    const sameBandColumns = boxes.filter(([x1, y1, x2, y2], index) =>
      boxes.some(
        ([otherX1, otherY1, otherX2, otherY2], other) =>
          index !== other && y1 < otherY2 && y2 > otherY1 && (x2 <= otherX1 || x1 >= otherX2),
      ),
    ).length;
    return Math.min(1, 2 * stddev + sameBandColumns / lines.length);
  }
  const mean = lengths.reduce((sum, length) => sum + length, 0) / (lines.length || 1);
  const stddev = Math.sqrt(lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / (lines.length || 1));
  return Math.min(1, (mean ? stddev / mean : 0) + columnCount / (lines.length || 1));
}

export function cleanParagraphOcr(lines: readonly OcrLineInput[]): string {
  const text = lines.map(({ text }) => text.trim().replace(/[\t \u00a0]+/gu, ' '));
  const edgeNoise = (line: string) => {
    if (!line || /^\p{Nd}+(?:[.,]\p{Nd}+)*$/u.test(line)) return true;
    const glyphs = Array.from(line.replace(/\s/gu, ''));
    return (
      glyphs.length <= config.cleanupEdgeFragmentMaxChars &&
      (glyphs.length === 1 || [...line.matchAll(wordOrDigit)].every(([word]) => Array.from(word).length === 1))
    );
  };
  let first = 0;
  let end = text.length;
  while (first < end && edgeNoise(text[first])) first++;
  while (end > first && edgeNoise(text[end - 1])) end--;
  let cleaned = '';
  for (let index = first; index < end; index++) {
    const current = text[index];
    const previous = text[index - 1];
    const softWrap =
      index > first &&
      previous &&
      current &&
      !sentenceEnd.test(previous) &&
      !listItem.test(previous) &&
      !listItem.test(current) &&
      !heading.test(previous) &&
      !heading.test(current) &&
      !/[：:]$/u.test(current) &&
      (previous.match(effectiveChars)?.length ?? 0) > config.cleanupShortLineMaxChars &&
      (current.match(effectiveChars)?.length ?? 0) > config.cleanupShortLineMaxChars &&
      (/\p{Script=Han}$/u.test(previous) || /^\p{Script=Han}/u.test(current));
    cleaned += (index > first && !softWrap ? '\n' : '') + current;
  }
  return cleaned.replace(/\n{3,}/gu, '\n\n');
}

type OcrEvaluation = MediaArtifactResult & { routeStatus: 'skipped' | 'ocr_ready' | 'needs_vlm' };

export function evaluateImageOcr(input: ImageMetaInput): OcrEvaluation {
  const width = input.width && Number.isFinite(input.width) && input.width > 0 ? input.width : undefined;
  const height = input.height && Number.isFinite(input.height) && input.height > 0 ? input.height : undefined;
  const lines = input.lines.map((line) => ({ ...line, text: line.text.trim() })).filter(({ text }) => text);
  const nonEmptyLineCount = lines.length;
  const lineDivisor = nonEmptyLineCount || 1;
  const lengths = lines.map(({ text }) => text.match(effectiveChars)?.length ?? 0);
  const effectiveCharCount = lengths.reduce((sum, length) => sum + length, 0);
  const shortLineRatio = lengths.filter((length) => length <= config.shortLineMaxChars).length / lineDivisor;
  const confidences = lines.flatMap(({ confidence }) =>
    confidence !== undefined && confidence >= 0 && confidence <= 1 ? [confidence] : [],
  );
  const avgConfidence = confidences.length
    ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
    : null;

  let charCount = 0;
  let gibberishChars = 0;
  let digitChars = 0;
  let columnCount = 0;
  let labelCount = 0;
  let directions = false;
  for (const { text } of lines) {
    const chars = Array.from(text.replace(/\s/gu, ''));
    charCount += chars.length;
    // The three noise categories count distinct characters, so each category has equal per-character weight.
    gibberishChars += chars.filter((char) => !commonOcrChar.test(char)).length;
    for (const [token] of text.matchAll(wordOrDigit)) {
      const parts = token.split(/[-./_]/u);
      const technicalCompound = parts.length > 1 && parts.some((part) => /[A-Za-z][A-Za-z\d]/u.test(part));
      for (const part of parts) {
        if (!technicalCompound && part.length <= 2 && [...part].length === 1) gibberishChars++;
        // An English word can touch Han text without a space. Only actually separated glyphs are isolated.
        for (const [word] of part.matchAll(/[A-Za-z\p{Nd}]+/gu)) {
          if (word.length < config.pseudoWordMinLength || !/^[A-Z]+$/u.test(word)) continue;
          const vowelRatio = (word.match(/[AEIOUY]/gu)?.length ?? 0) / word.length;
          const consonantRun = word.split(/[AEIOUY]/u).some((run) => run.length >= config.pseudoWordConsonantRun);
          if (
            vowelRatio < config.pseudoWordMinVowelRatio ||
            vowelRatio > config.pseudoWordMaxVowelRatio ||
            consonantRun
          )
            gibberishChars += word.length;
        }
      }
    }
    digitChars += chars.filter((char) => /[\p{Nd}%％]/u.test(char)).length;
    if (columns.test(text)) columnCount++;
    if (/^[（(]?[+-]?\p{Nd}+(?:[.,．，]\p{Nd}+)*\s*[%％]?[.、)）]?$/u.test(text)) labelCount++;
    if (/[→↓↑]|=>|->/u.test(text)) directions = true;
  }
  const gibberishRatio = Math.min(1, gibberishChars / (charCount || 1));
  const dispersion = layoutDispersion(lines, lengths, columnCount, width);
  const chartSignalScore = Math.min(
    1,
    (digitChars / (charCount || 1) >= config.chartDigitMinRatio ? config.chartDigitWeight : 0) +
      (directions ? config.chartDirectionWeight : 0) +
      (columnCount >= config.chartColumnMinLines ? config.chartColumnWeight : 0) +
      (labelCount / lineDivisor >= config.chartLabelMinRatio ? config.chartLabelWeight : 0),
  );
  const penalty =
    gibberishRatio * config.qualityGibberishPenalty +
    shortLineRatio * config.qualityShortLinePenalty +
    dispersion * config.qualityLayoutPenalty +
    (avgConfidence === null
      ? 0
      : Math.max(0, config.qualityTargetConfidence - avgConfidence) * config.qualityConfidencePenalty);
  const qualityScore = Math.max(0, Math.round(100 - penalty));
  const metrics: OcrQualityMetrics = {
    effectiveCharCount,
    nonEmptyLineCount,
    shortLineRatio,
    gibberishRatio,
    layoutDispersion: dispersion,
    chartSignalScore,
    avgConfidence,
    qualityScore,
  };
  const routeReasons: string[] = [];
  const result = { width, height, routeReasons, metrics, ocrRawText: input.lines.map(({ text }) => text).join('\n') };
  if (!width || !height) {
    routeReasons.push('legacy_missing_dimensions');
  } else if (
    !input.preserveVisuals &&
    (width < config.minImageWidth ||
      height < config.minImageHeight ||
      (Math.max(width, height) / Math.min(width, height) > config.maxBannerAspectRatio &&
        effectiveCharCount < config.minBannerTextChars))
  ) {
    routeReasons.push('tiny_or_banner_image');
    return { ...result, routeStatus: 'skipped' };
  }
  if (effectiveCharCount < config.minEffectiveChars && chartSignalScore < config.minDecorativeChartSignal) {
    if (input.preserveVisuals) {
      routeReasons.push('sparse_image_text');
      return { ...result, routeStatus: 'needs_vlm' };
    }
    routeReasons.push('low_text_decorative');
    return { ...result, routeStatus: 'skipped' };
  }

  const needsVlm: string[] = [];
  if (gibberishRatio >= config.maxGibberishRatio) needsVlm.push(`high_gibberish:${gibberishRatio.toFixed(2)}`);
  if (shortLineRatio >= config.maxShortLineRatio && nonEmptyLineCount >= config.minLinesForShortLineRule)
    needsVlm.push(`high_short_line:${shortLineRatio.toFixed(2)}`);
  if (avgConfidence !== null && avgConfidence + Number.EPSILON < config.minAvgConfidence)
    needsVlm.push(`low_confidence:${Number(avgConfidence.toPrecision(4))}`);
  if (dispersion >= config.maxLayoutDispersion && nonEmptyLineCount >= config.minLinesForLayoutRule)
    needsVlm.push(`scattered_layout:${dispersion.toFixed(2)}`);
  if (chartSignalScore >= config.minChartSignalScore)
    needsVlm.push(`chart_or_table_signal:${chartSignalScore.toFixed(2)}`);
  if (qualityScore < config.minQualityScore) needsVlm.push(`low_quality_score:${qualityScore}`);
  if (needsVlm.length) {
    routeReasons.push(...needsVlm);
    return { ...result, routeStatus: 'needs_vlm' };
  }
  routeReasons.push('clean_text_pass');
  return { ...result, routeStatus: 'ocr_ready', ocrCleanText: cleanParagraphOcr(input.lines) };
}
