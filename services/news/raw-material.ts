import { AssetStore } from '../raw/assets.ts';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../raw/limits.ts';
import { detectFileFormat, extractBody } from '../raw/parse.ts';
import type { RawInput } from '../raw/store.ts';
import { readPublicResource } from '../raw/url-import.ts';
import { readWebMaterial } from '../raw/web-material.ts';
import type { NewsItem } from './types.ts';

type MaterialFields = Omit<RawInput, 'title' | 'sourceType' | 'sourceName' | 'url' | 'tags'>;
export type NewsMaterial = MaterialFields & { newsMaterial: NonNullable<RawInput['newsMaterial']> };
export class PartialNewsMaterialError extends Error {
  readonly code = 'NEWS_MATERIAL_INCOMPLETE';
}
export class UnavailableNewsMaterialError extends Error {
  readonly code = 'NEWS_MATERIAL_UNAVAILABLE';
}
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : '无法获取来源材料。');

export async function acquireNewsMaterial(
  root: string,
  item: NewsItem,
  keepPartial: boolean,
  options?: Parameters<typeof readWebMaterial>[2],
): Promise<NewsMaterial> {
  let pdfIssue = '';
  const directPdf = /\.pdf$/iu.test(URL.parse(item.url)?.pathname ?? '');
  const pdfUrl = item.research?.pdfUrl || (directPdf ? item.url : undefined);
  if (pdfUrl) {
    try {
      const fetched = await readPublicResource(
        pdfUrl,
        {
          accept: 'application/pdf,application/octet-stream',
          mime: /^application\/(?:pdf|octet-stream)$/u,
          bytes: MAX_UPLOAD_BYTES,
          label: 'PDF',
        },
        options,
      );
      if (!('format' in detectFileFormat(fetched.bytes, '.pdf'))) throw new Error('页面未返回 PDF 原件。');
      const extracted = await extractBody(fetched.bytes, 'pdf', { allowPdfWithoutText: true });
      if (extracted.body.length > MAX_BODY_CHARS) throw new Error('PDF 提取文字超过 500,000 字符。');
      const missing = extracted.pdf?.pages.filter((page) => page.textStart === null).length ?? 0;
      const issue = !extracted.body.trim()
        ? 'PDF 原件已取得，未取得可整理的文字层。'
        : missing
          ? `PDF 原件已取得，有 ${missing} 页未取得文字层。`
          : '';
      if (issue && !keepPartial) throw new PartialNewsMaterialError(issue);
      const fileName = `${item.title.slice(0, 180)}.pdf`;
      const asset = await new AssetStore(root).store(fetched.bytes, {
        fileName,
        format: 'pdf',
        declaredExtension: '.pdf',
      });
      return {
        body: extracted.body,
        pdf: extracted.pdf,
        assetId: asset.id,
        assetFormat: 'pdf',
        assetByteSize: asset.byteSize,
        assetFileName: fileName,
        assetSha256: asset.sha256,
        urlImport: { finalUrl: fetched.finalUrl, fetchedAt: new Date().toISOString() },
        extractionParser: extracted.parser,
        extractionNote: [`PDF 来源：${pdfUrl}`, extracted.note, issue].filter(Boolean).join('；'),
        newsMaterial: { kind: 'report_pdf', revision: 0, ...(issue ? { issue } : {}) },
      };
    } catch (error) {
      if (error instanceof PartialNewsMaterialError) throw error;
      pdfIssue = `PDF 获取或解析失败：${errorMessage(error)}`;
    }
  }

  let pageIssue = '';
  if (item.sourceId === 'karpathy-youtube') {
    pageIssue = '来源为视频，当前未取得可保存的原始转录。';
  } else if (!directPdf) {
    try {
      const page = await readWebMaterial(root, item.url, options);
      const isReport = Boolean(item.research);
      if (!page.body || (!page.hasProse && !page.images.some((img) => img.sha256)))
        throw new Error('网页中没有取得正文或可保留的图片。');
      const issue = [pdfIssue || (isReport ? '取得报告发布页，未取得报告全文。' : ''), ...page.issues]
        .filter(Boolean)
        .join(' ');
      if (issue && !keepPartial) throw new PartialNewsMaterialError(issue);
      return {
        body: page.body,
        extractionParser: page.parser,
        extractionNote: [isReport ? '报告发布页正文' : '来源网页正文', page.note, issue].filter(Boolean).join('；'),
        urlImport: { finalUrl: page.finalUrl, fetchedAt: page.fetchedAt },
        webImages: page.images.length ? page.images : undefined,
        webImageArtifacts: page.artifacts.length ? page.artifacts : undefined,
        newsMaterial: { kind: isReport ? 'report_page' : 'article', revision: 0, ...(issue ? { issue } : {}) },
      };
    } catch (error) {
      if (error instanceof PartialNewsMaterialError) throw error;
      pageIssue = errorMessage(error);
    }
  }
  throw new UnavailableNewsMaterialError([pdfIssue, pageIssue].filter(Boolean).join(' '));
}
