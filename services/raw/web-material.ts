import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../storage/files.ts';
import { MAX_BODY_CHARS } from './limits.ts';
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

function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (['GIF89a', 'GIF87a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const imageFile = (root: string, sha: string) => path.join(root, 'knowledge', 'raw', 'web-images', sha);

export async function readWebImage(root: string, image: RawWebImage) {
  if (!image.sha256 || !/^[a-f\d]{64}$/u.test(image.sha256)) return;
  const bytes = await readFile(imageFile(root, image.sha256)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  if (bytes && imageType(bytes) === image.mime && hash(bytes) === image.sha256) return bytes;
}

async function tesseract(bytes: Buffer): Promise<string> {
  const configured = process.env.FMCG_TESSERACT_PATH;
  const installed = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Tesseract-OCR', 'tesseract.exe');
  const run = (executable: string) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile(
        executable,
        ['stdin', 'stdout', '-l', 'chi_sim+eng', '--psm', '11'],
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

export async function readWebMaterial(
  root: string,
  url: string,
  options: WebOptions & { ocr?: (bytes: Buffer) => Promise<string> } = {},
) {
  const page = await readPublicRawUrl(url, { ...options, images: true });
  const candidates = page.images ?? [];
  const hasProse = candidates.reduce((text, img) => text.replace(img.marker, ''), page.body).trim().length > 0;
  const images: RawWebImage[] = [];
  const issues: string[] = [];
  const fetched = new Map<string, Pick<RawWebImage, 'sha256' | 'mime' | 'finalUrl' | 'status'> & { text?: string }>();
  const readImage = async (sourceUrl: string) => {
    const reused = fetched.get(sourceUrl);
    if (reused) return reused;
    let image: Pick<RawWebImage, 'sha256' | 'mime' | 'finalUrl' | 'status'> & { text?: string } = { status: 'failed' };
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
      await writeFileAtomic(imageFile(root, sha256), result.bytes);
      image = { sha256, mime, finalUrl: result.finalUrl, status: 'failed' };
      const text = (await (options.ocr ?? tesseract)(result.bytes)).replace(/\r\n/gu, '\n').trim();
      const readable = (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2;
      image = { ...image, status: readable ? 'transcribed' : 'no_text', ...(readable ? { text } : {}) };
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
    const { explicit, label, context, width, height, url: sourceUrl } = candidate;
    const key = explicit || !hasProse;
    const assess = key || (width >= 240 && (height >= 100 || !height)) || (!width && !height);
    if (!assess) continue;
    const { text, ...image } = inspected++ < 16 ? await readImage(sourceUrl) : { status: 'failed' as const };
    if (!key && image.status === 'no_text') continue;
    const number = images.length + 1;
    const diagram = /流[程向]|架构|拓扑|线路|关系图|diagram|flowchart|architecture/iu.test(`${label} ${context}`);
    const marker = `【来源图片 ${number}${label ? ` · ${label}` : ''}】`;
    images.push({ start: body.length, sourceUrl, label, ...image });
    body += marker;
    if (text) {
      body += `\n【图片 OCR 转录（需核对）】\n${text}\n【转录结束】`;
    }
    if (diagram && image.sha256) body += '\n【图中连线、方向及步骤顺序请以原图核对】';
    if (image.status === 'failed') {
      const issue = image.sha256
        ? `图片 ${number} 的本机 OCR 未完成（需 Tesseract 和简中、英文语言数据）。`
        : `图片 ${number} 原图读取失败或超出读取限额。`;
      issues.push(issue);
      body += `\n【${issue}】`;
    } else if (image.status === 'no_text') {
      issues.push(`图片 ${number} 未识别到可转录文字，需核对原图。`);
      body += '\n【未识别到可转录文字，可查看原图】';
    }
  }
  body += page.body.slice(offset);
  const leading = body.length - body.trimStart().length;
  for (const image of images) image.start -= leading;
  if (body.length > MAX_BODY_CHARS) throw new Error('正文与图片转录合计超过 500,000 字符。');
  return {
    ...page,
    body: body.trim(),
    parser: images.length ? 'url_html_images_ocr' : page.parser,
    images,
    hasProse,
    issues,
  };
}
