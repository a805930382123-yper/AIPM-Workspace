import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { LocalOcrError } from './local-ocr.ts';
import type { MediaArtifactResult } from './media-artifact.ts';
import { evaluateImageOcr, OCR_TRIAGE_CONFIG, type OcrLineInput } from './media-ocr-triage.ts';

const defaultAnchors = [
  '加微信',
  '添加微信',
  '关注微信公众号',
  '关注公众号',
  '扫码关注',
  '扫码进群',
  '长按识别二维码',
  '领取资料',
  '领取大礼包',
  '面试一对一辅导',
  'END',
  '推荐阅读',
  '往期推荐',
  '延伸阅读',
  '点击“阅读原文”',
  '点击「阅读原文」',
  '点击阅读原文',
];
const nearbyPromotion =
  /微信|关注|领取|扫码|公众号|二维码|加群|入群|进群|私信|推广|引流|阅读原文|follow us|join (?:us|our)|subscribe/iu;
const decorativeLabel =
  /^(?:装饰(?:动?图)?|分[隔割](?:线|动图)|页眉|页脚|占位图?|广告|推广海报|表情包?|贴纸|logo|banner|spacer)$/iu;
const minSide = 100;

type Span = { start: number; end: number };
type Position = { afterPromotion: boolean; nearPromotion: boolean; nearAnchor: boolean };
type Analysis = { width: number; height: number; qr?: boolean; ocr?: Promise<MediaArtifactResult> };

export function webImagePositionSignals(
  body: string,
  markers: readonly Span[],
  removed: readonly Span[] = [],
): Map<number, Position> {
  const configured = process.env.FMCG_WEB_IMAGE_PROMO_TAIL_RATIO?.trim();
  const ratio = configured ? Number(configured) : 0.3;
  const tailRatio = Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 0.3;
  const words = process.env.FMCG_WEB_IMAGE_PROMO_ANCHORS;
  const anchors =
    words === undefined
      ? defaultAnchors
      : words
          .split(/[,，\r\n]/u)
          .map((word) => word.trim())
          .filter(Boolean);
  const offsets = new Map<number, number>();
  let prose = '';
  let cursor = 0;
  const spans = [
    ...markers.map(({ start, end }) => ({ start, end, marker: true })),
    ...removed.map(({ start, end }) => ({ start, end, marker: false })),
  ].sort((left, right) => left.start - right.start || Number(right.marker) - Number(left.marker));
  for (const { start, end, marker } of spans) {
    if (start >= cursor) prose += body.slice(cursor, start).replace(/[^\S\n]+/gu, ' ');
    if (marker) offsets.set(start, prose.length);
    cursor = Math.max(cursor, end);
  }
  prose += body.slice(cursor).replace(/[^\S\n]+/gu, ' ');
  const minAnchorOffset = Math.ceil(prose.length * (1 - tailRatio));
  const patterns = anchors.map((anchor) => {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return /^[A-Za-z]+$/u.test(anchor) ? `\\b${escaped}\\b` : escaped;
  });
  const anchorPattern = patterns.length ? new RegExp(patterns.join('|'), 'giu') : undefined;
  const nearbyAnchor = patterns.length ? new RegExp(patterns.join('|'), 'iu') : undefined;
  if (anchorPattern) anchorPattern.lastIndex = minAnchorOffset;
  const anchorAt = anchorPattern?.exec(prose)?.index ?? Infinity;
  const locations = [...offsets];
  return new Map(
    locations.map(([start, offset], index) => {
      const before =
        prose
          .slice(locations[index - 1]?.[1] ?? 0, offset)
          .trimEnd()
          .split('\n')
          .at(-1) ?? '';
      const after = prose
        .slice(offset, locations[index + 1]?.[1] ?? prose.length)
        .trimStart()
        .split('\n')[0];
      const nearby = `${before}\n${after}`;
      return [
        start,
        {
          afterPromotion: offset > anchorAt,
          nearPromotion: nearbyPromotion.test(nearby),
          nearAnchor: nearbyAnchor?.test(nearby) ?? false,
        },
      ];
    }),
  );
}

function containsQr(image: Image): boolean {
  const limit = 800;
  const scan = (x: number, y: number, width: number, height: number) => {
    const scale = Math.min(1, limit / Math.max(width, height));
    const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return Boolean(jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
  };
  if (scan(0, 0, image.width, image.height)) return true;
  if (Math.max(image.width, image.height) <= limit) return false;
  const width = Math.min(image.width, Math.max(limit, Math.ceil(image.width * 0.42)));
  const height = Math.min(image.height, Math.max(limit, Math.ceil(image.height * 0.42)));
  const xOffsets = new Set([0, Math.floor((image.width - width) / 2), image.width - width]);
  const yOffsets = new Set([0, Math.floor((image.height - height) / 2), image.height - height]);
  // Overlapping crops preserve detail for QR codes that cover only part of a large image.
  return [...yOffsets].some((y) => [...xOffsets].some((x) => scan(x, y, width, height)));
}

function isAnimatedGif(bytes: Buffer): boolean {
  if (!/^GIF8[79]a/u.test(bytes.toString('ascii', 0, 6)) || bytes.length < 14) return false;
  const colorTableBytes = (packed: number) => (packed & 0x80 ? 3 * (2 << (packed & 7)) : 0);
  let cursor = 13 + colorTableBytes(bytes[10]);
  let frames = 0;
  while (cursor < bytes.length) {
    const block = bytes[cursor++];
    if (block === 0x2c && cursor + 9 < bytes.length) {
      if (++frames > 1) return true;
      cursor += 10 + colorTableBytes(bytes[cursor + 8]);
    } else if (block === 0x21) {
      cursor++;
    } else {
      break;
    }
    // Both extension and image blocks carry length-prefixed sub-blocks terminated by zero.
    while (cursor < bytes.length) {
      const size = bytes[cursor++];
      if (!size) break;
      cursor += size;
    }
  }
  return false;
}

export type WebImageScreeningInput = { sha256: string; bytes: Buffer; label: string; position: Position | undefined };
export function createWebImageScreening(recognize: (bytes: Buffer, decoded?: Image) => Promise<OcrLineInput[]>) {
  const analyses = new Map<string, Analysis>();
  const seen = new Set<string>();
  return {
    dimensions: (sha: string) => analyses.get(sha),
    noteOccurrence: (sha: string) => seen.add(sha),
    async screen({ sha256, bytes, label, position }: WebImageScreeningInput): Promise<MediaArtifactResult> {
      let decoded: Image | undefined;
      const decode = async () =>
        (decoded ??= await loadImage(bytes).catch(() => {
          throw new LocalOcrError('local_ocr_image_decode_failed');
        }));
      let analysis = analyses.get(sha256);
      if (!analysis) {
        const { width, height } = await decode();
        if (!width || !height) throw new LocalOcrError('local_ocr_image_decode_failed');
        analysis = { width, height };
        analyses.set(sha256, analysis);
      }
      const duplicate = seen.has(sha256);
      seen.add(sha256);
      const { width, height } = analysis;
      const preset = (
        routeStatus: 'skipped' | 'needs_vlm',
        code: string,
        decisionReason: string,
      ): MediaArtifactResult => ({
        ...evaluateImageOcr({ width, height, lines: [] }),
        routeStatus,
        routeReasons: [code],
        decisionReason,
      });
      if (position?.afterPromotion) return preset('skipped', 'promotion_tail', '文末推广区截断，已跳过此图。');
      if (Math.min(width, height) < minSide)
        return preset('skipped', 'tiny_image', `像素过小，原图为 ${width}×${height}（任一边小于 100 像素）。`);
      const decorative = decorativeLabel.test(label.trim());
      if (Math.max(width, height) <= 180 && decorative && isAnimatedGif(bytes))
        return preset('skipped', 'decorative_animation', '图片尺寸较小，图注表明属于装饰动图。');
      if (duplicate && (position?.nearAnchor || decorative))
        return preset('skipped', 'repeated_template', '相同图片已在本文出现，此处属于装饰或推广模板。');
      if (position?.nearPromotion && (analysis.qr ??= containsQr(await decode())))
        return preset('skipped', 'qr_with_promotion', '疑似引流二维码，图内检出二维码且相邻正文含引流用语。');
      if (Math.max(width, height) / Math.min(width, height) > OCR_TRIAGE_CONFIG.maxBannerAspectRatio)
        return preset('needs_vlm', 'body_slender_image', '正文图片较为细长，待精读图中结构与关系。');

      analysis.ocr ??= recognize(bytes, decoded).then((lines) => {
        const result = evaluateImageOcr({ width, height, lines, preserveVisuals: true });
        const reason =
          result.routeStatus === 'ocr_ready'
            ? '本机 OCR 已识别出可读文字。'
            : result.routeReasons.includes('sparse_image_text')
              ? '本机 OCR 提取的文字很少，待精读图中信息。'
              : '识别文字的质量或排版需要进一步核对，已列入待精读。';
        return { ...result, decisionReason: reason };
      });
      return analysis.ocr;
    },
  };
}
