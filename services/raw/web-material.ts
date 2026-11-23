import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { writeFileAtomic } from '../storage/files.ts';
import { MAX_BODY_CHARS } from './limits.ts';
import { evaluateImageOcr, type OcrLineInput } from './media-ocr-triage.ts';
import type { MediaArtifactResult } from './media-artifact.ts';
import { readPublicRawUrl, readPublicResource, type WebOptions } from './url-import.ts';

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

export async function readWebImage(root: string, image: RawWebImage) {
  const file = webImageRelativePath(image.sha256);
  if (!file) return;
  const bytes = await readFile(path.join(root, file)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  if (bytes && imageType(bytes) === image.mime && hash(bytes) === image.sha256) return bytes;
}

async function tesseract(bytes: Buffer, format?: 'tsv'): Promise<string> {
  const configured = process.env.FMCG_TESSERACT_PATH;
  const installed = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Tesseract-OCR', 'tesseract.exe');
  const run = (executable: string) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(
        executable,
        ['stdin', 'stdout', '-l', 'chi_sim+eng', '--psm', '11', ...(format ? [format] : [])],
        {
          timeout: 25_000,
          windowsHide: true,
          maxBuffer: 256 * 1024,
          env: { ...process.env, OMP_THREAD_LIMIT: '1' },
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(bytes);
    });
  try {
    return await run(configured || 'tesseract');
  } catch (error) {
    if (configured || process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return run(installed);
  }
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

export async function recognizeWebImageLines(bytes: Buffer): Promise<OcrLineInput[]> {
  return parseTesseractTsv(await tesseract(bytes, 'tsv'));
}

export async function readWebMaterial(
  root: string,
  url: string,
  options: WebOptions & { ocr?: (bytes: Buffer) => Promise<string | OcrLineInput[]> } = {},
) {
  const page = await readPublicRawUrl(url, { ...options, images: true });
  const candidates = page.images ?? [];
  const hasProse = candidates.reduce((text, img) => text.replace(img.marker, ''), page.body).trim().length > 0;
  const images: RawWebImage[] = [];
  const issues: string[] = [];
  const artifacts: MediaArtifactResult[] = [];
  type ImageResult = Pick<RawWebImage, 'sha256' | 'mime' | 'finalUrl' | 'status'> & { artifact: MediaArtifactResult };
  const failedArtifact = (reason: string): MediaArtifactResult => ({
    ...evaluateImageOcr({ lines: [] }),
    routeStatus: 'failed',
    routeReasons: [reason],
    vlmError:
      reason === 'local_ocr_unavailable'
        ? '本机 OCR 未完成，可查看原图或手动精读。'
        : reason === 'image_count_limit'
          ? '超过本次 16 张图片读取限额，尚未读取原图。'
          : '原图下载失败、格式无法识别或超过 8 MiB 限额。',
  });
  const fetched = new Map<string, ImageResult>();
  const readImage = async (sourceUrl: string) => {
    const reused = fetched.get(sourceUrl);
    if (reused) return reused;
    let image: ImageResult = { status: 'failed', artifact: failedArtifact('original_image_unavailable') };
    try {
      const result = await readPublicResource(
        sourceUrl,
        {
          accept: 'image/png,image/jpeg,image/gif,image/webp',
          mime: /^(?:image\/(?:png|jpeg|jpg|gif|webp)|application\/octet-stream)$/u,
          bytes: 8 * 1024 * 1024,
          label: '图片',
        },
        options,
      );
      const mime = imageType(result.bytes);
      if (!mime) return image;
      const sha256 = hash(result.bytes);
      await writeFileAtomic(path.join(root, webImageRelativePath(sha256)!), result.bytes);
      image = { ...image, sha256, mime, finalUrl: result.finalUrl, artifact: failedArtifact('local_ocr_unavailable') };
      const { width, height } = await loadImage(result.bytes);
      image.artifact = { ...image.artifact, width, height };
      const recognized = await (options.ocr ?? recognizeWebImageLines)(result.bytes);
      const lines = typeof recognized === 'string' ? recognized.split(/\r?\n/u).map((text) => ({ text })) : recognized;
      const artifact = evaluateImageOcr({ width, height, lines });
      image = { ...image, status: artifact.metrics.effectiveCharCount >= 2 ? 'transcribed' : 'no_text', artifact };
    } catch {
      // A retained image remains available to verify when local OCR is unavailable.
    }
    fetched.set(sourceUrl, image);
    return image;
  };

  let body = '';
  let offset = 0;
  let inspected = 0;
  for (const candidate of candidates) {
    const start = page.body.indexOf(candidate.marker, offset);
    if (start < 0) continue;
    body += page.body.slice(offset, start);
    offset = start + candidate.marker.length;
    const { label, url: sourceUrl } = candidate;
    const { artifact, ...image } =
      inspected++ < 16
        ? await readImage(sourceUrl)
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
      const issue = image.sha256
        ? `图片 ${number} 的本机 OCR 未完成（需 Tesseract 和简中、英文语言数据）。`
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
