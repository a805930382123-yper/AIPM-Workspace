import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { writeFileAtomic } from '../storage/files.ts';
import { MAX_BODY_CHARS } from './limits.ts';
import { checkLocalOcr, LocalOcrError, readLocalOcrTsv } from './local-ocr.ts';
import { createWebImageScreening, webImagePositionSignals, type WebImageScreeningInput } from './media-image-screen.ts';
import { evaluateImageOcr, type OcrLineInput } from './media-ocr-triage.ts';
import type { MediaArtifactResult } from './media-artifact.ts';
import { RawUrlError, readPublicRawUrl, readPublicResource, type WebOptions } from './url-import.ts';

export type RawWebImage = {
  start: number;
  sourceUrl: string;
  finalUrl?: string;
  sha256?: string;
  mime?: string;
  label: string;
  status: 'transcribed' | 'no_text' | 'failed';
};

export function identifyWebImages(rawId: string, images: readonly RawWebImage[] = []) {
  return images.map((image, index) => {
    const imageIndex = index + 1;
    const mediaId = createHash('sha256')
      .update(JSON.stringify([rawId, imageIndex, image.sourceUrl, image.sha256 ?? null]))
      .digest('hex');
    return { ...image, mediaId, imageIndex };
  });
}

function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (['GIF89a', 'GIF87a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const webImageRelativePath = (sha?: string) =>
  sha && /^[a-f\d]{64}$/u.test(sha) ? `knowledge/raw/web-images/${sha}` : undefined;

export async function readWebImage(root: string, image: Pick<RawWebImage, 'sha256' | 'mime'>) {
  const file = webImageRelativePath(image.sha256);
  if (!file) return;
  const bytes = await readFile(path.join(root, file)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  if (bytes && imageType(bytes) === image.mime && hash(bytes) === image.sha256) return bytes;
}

/** Tesseract TSV groups word records into lines with pixel coordinates and 0–1 confidence. */
export function parseTesseractTsv(tsv: string): OcrLineInput[] {
  const lines = new Map<
    string,
    {
      text: string[];
      bbox: NonNullable<OcrLineInput['bbox']>;
      confidence: number[];
      previous?: { text: string; right: number; height: number };
    }
  >();
  for (const row of tsv.split(/\r?\n/u)) {
    const fields = row.split('\t');
    if (fields[0] !== '5' || fields.length < 12) continue;
    const text = fields.slice(11).join('\t').trim();
    const [x, y, width, height, confidence] = fields.slice(6, 11).map(Number);
    if (!text || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const id = fields.slice(1, 5).join(':');
    const line = lines.get(id) ?? { text: [], bbox: [x, y, x + width, y + height], confidence: [] };
    const prior = line.previous;
    if (prior) {
      const gap = (x - prior.right) / Math.max(height, prior.height);
      const continuousChinese =
        /[\p{Script=Han}，。！？：；、…（）【】《》「」『』]$/u.test(prior.text) &&
        /^[\p{Script=Han}，。！？：；、…（）【】《》「」『』]/u.test(text);
      // Sparse text detection splits continuous Han words. A large measured gap still indicates columns.
      line.text.push(gap >= 1.5 ? '   ' : continuousChinese && gap < 0.6 ? '' : ' ');
    }
    line.text.push(text);
    line.previous = { text, right: x + width, height };
    const [left, top, right, bottom] = line.bbox;
    line.bbox = [Math.min(left, x), Math.min(top, y), Math.max(right, x + width), Math.max(bottom, y + height)];
    if (fields[10].trim() && confidence >= 0 && confidence <= 100) line.confidence.push(confidence);
    lines.set(id, line);
  }
  return [...lines.values()].map(({ text, bbox, confidence }) => ({
    text: text.join(''),
    bbox,
    ...(confidence.length
      ? { confidence: confidence.reduce((sum, value) => sum + value, 0) / confidence.length / 100 }
      : {}),
  }));
}

export async function recognizeWebImageLines(
  bytes: Buffer,
  image?: Image,
  engine = checkLocalOcr(),
): Promise<OcrLineInput[]> {
  const checked = await engine;
  if (imageType(bytes) === 'image/gif') {
    // Leptonica rejects animated GIFs. Only the OCR input uses the first frame.
    try {
      const frame = image ?? (await loadImage(bytes));
      const canvas = createCanvas(frame.width, frame.height);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frame, 0, 0);
      bytes = canvas.toBuffer('image/png');
    } catch {
      throw new LocalOcrError('local_ocr_image_decode_failed');
    }
  }
  return parseTesseractTsv(await readLocalOcrTsv(checked, bytes));
}

export async function readWebMaterial(
  root: string,
  url: string,
  options: WebOptions & { ocr?: (bytes: Buffer) => Promise<string | OcrLineInput[]> } = {},
) {
  const page = await readPublicRawUrl(url, { ...options, images: true });
  let offset = 0;
  const candidates = (page.images ?? []).flatMap((candidate) => {
    const start = page.body.indexOf(candidate.marker, offset);
    if (start < 0) return [];
    offset = start + candidate.marker.length;
    return [{ ...candidate, start, end: offset }];
  });
  const positions = webImagePositionSignals(page.body, candidates);
  const hasProse = candidates.reduce((text, img) => text.replace(img.marker, ''), page.body).trim().length > 0;
  const images: RawWebImage[] = [];
  const issues: string[] = [];
  const artifacts: MediaArtifactResult[] = [];
  type ImageResult = Pick<RawWebImage, 'sha256' | 'mime' | 'finalUrl' | 'status'> & { artifact: MediaArtifactResult };
  const failedArtifact = (reason: 'original_image_unavailable' | 'image_count_limit'): MediaArtifactResult => ({
    ...evaluateImageOcr({ lines: [] }),
    routeStatus: 'failed',
    routeReasons: [reason],
    vlmError:
      reason === 'image_count_limit'
        ? '超过本次 16 张图片读取限额，尚未读取原图。'
        : '原图下载失败、格式无法识别或超过 8 MiB 限额。',
    ...(reason === 'image_count_limit' ? { mediaFailure: { stage: 'download', code: 'MEDIA_DOWNLOAD_LIMIT' } } : {}),
  });
  const fallbackToVlm = process.env.FMCG_OCR_FALLBACK === 'vlm';
  let engine: ReturnType<typeof checkLocalOcr> | undefined;
  const screening = createWebImageScreening(async (bytes, decoded) => {
    const recognized = options.ocr
      ? await options.ocr(bytes)
      : await recognizeWebImageLines(bytes, decoded, (engine ??= checkLocalOcr()));
    return typeof recognized === 'string' ? recognized.split(/\r?\n/u).map((text) => ({ text })) : recognized;
  });
  const fetched = new Map<string, ImageResult>();
  const readImage = async (sourceUrl: string, label: string, position: WebImageScreeningInput['position']) => {
    const reused = fetched.get(sourceUrl);
    if (reused && !reused.sha256) return reused;
    let image: ImageResult = reused ?? { status: 'failed', artifact: failedArtifact('original_image_unavailable') };
    let writing = false;
    try {
      let bytes: Buffer;
      let sha256 = image.sha256;
      if (sha256) {
        const retained = await readWebImage(root, image).catch(() => undefined);
        if (!retained) {
          const mediaFailure = { stage: 'original' as const, code: 'MEDIA_ORIGINAL_UNAVAILABLE' };
          console.warn('[raw-media] 本地原图校验失败', mediaFailure);
          return {
            ...image,
            artifact: {
              ...image.artifact,
              routeReasons: ['original_image_unavailable'],
              mediaFailure,
              vlmError: '本地原图无法读取或校验失败。',
            },
          };
        }
        bytes = retained;
      } else {
        const result = await readPublicResource(
          sourceUrl,
          {
            accept: 'image/png,image/jpeg,image/gif,image/webp',
            mime: /^(?:image\/(?:png|jpeg|jpg|gif|webp)|application\/octet-stream)$/u,
            bytes: 8 * 1024 * 1024,
            label: '图片',
            userAgent: ({ hostname }) =>
              hostname === 'mmbiz.qpic.cn' || hostname === 'mmbiz.qlogo.cn'
                ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                : undefined,
          },
          options,
        );
        bytes = result.bytes;
        const mime = imageType(bytes);
        if (!mime) throw new RawUrlError('MEDIA_DOWNLOAD_INVALID_IMAGE', '响应不含受支持的图片字节。', 422);
        sha256 = hash(bytes);
        writing = true;
        await writeFileAtomic(path.join(root, webImageRelativePath(sha256)!), bytes);
        image = { ...image, sha256, mime, finalUrl: result.finalUrl };
        fetched.set(sourceUrl, image);
      }
      const artifact = await screening.screen({ sha256, bytes, label, position });
      return {
        ...image,
        status: artifact.metrics.effectiveCharCount >= 2 ? ('transcribed' as const) : ('no_text' as const),
        artifact,
      };
    } catch (error) {
      if (!image.sha256) {
        const code =
          error instanceof RawUrlError ? error.code : writing ? 'MEDIA_DOWNLOAD_STORE_FAILED' : 'URL_FETCH_FAILED';
        const httpStatus = error instanceof RawUrlError ? error.upstreamStatus : undefined;
        const failure = { stage: 'download' as const, code, ...(httpStatus === undefined ? {} : { httpStatus }) };
        image.artifact.mediaFailure = failure;
        console.warn('[raw-media] 原图下载失败', failure);
        fetched.set(sourceUrl, image);
      }
      if (image.sha256) {
        const diagnostic = error instanceof LocalOcrError ? error : new LocalOcrError('local_ocr_unavailable');
        const { code, source, affectedLanguages } = diagnostic;
        console.warn('[raw-ocr]', { code, source, affectedLanguages });
        const { width, height } = screening.dimensions(image.sha256) ?? {};
        const routedToVlm = fallbackToVlm && !!width && !!height && code !== 'local_ocr_image_decode_failed';
        const artifact: MediaArtifactResult = {
          width,
          height,
          metrics: image.artifact.metrics,
          ocrRawText: '',
          routeStatus: routedToVlm ? 'needs_vlm' : 'failed',
          routeReasons: [code],
          decisionReason: routedToVlm ? '本机 OCR 未完成，已列入待精读。' : '本机 OCR 未完成，等待人工处理。',
          ocrError: diagnostic.message,
        };
        return { ...image, artifact };
      }
    }
    return image;
  };

  let body = '';
  offset = 0;
  let inspected = 0;
  for (const candidate of candidates) {
    const { start, end, label, url: sourceUrl } = candidate;
    body += page.body.slice(offset, start);
    offset = end;
    const { artifact, ...image } =
      inspected++ < 16
        ? await readImage(sourceUrl, label, positions.get(start))
        : {
            status: 'failed' as const,
            artifact: failedArtifact('image_count_limit'),
          };
    const number = images.length + 1;
    const marker = `【来源图片 ${number}${label ? ` · ${label}` : ''}】`;
    images.push({ start: body.length, sourceUrl, label, ...image });
    artifacts.push(artifact);
    body += marker;
    if (image.status === 'failed') {
      const issue = artifact.ocrError
        ? `图片 ${number} 的本机 OCR 未完成。${artifact.ocrError}`
        : `图片 ${number} 原图读取失败或超出读取限额。`;
      issues.push(issue);
    }
  }
  body += page.body.slice(offset);
  const leading = body.length - body.trimStart().length;
  for (const image of images) image.start -= leading;
  if (body.length > MAX_BODY_CHARS) throw new Error('正文与来源图锚点合计超过 500,000 字符。');
  return {
    ...page,
    body: body.trim(),
    parser: images.length ? 'url_html_images' : page.parser,
    images,
    artifacts,
    hasProse,
    issues,
  };
}
