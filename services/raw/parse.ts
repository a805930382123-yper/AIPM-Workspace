// B03: detect the real format from bytes and extract the body with real parsers.
// Nothing here trusts a file extension or a client-provided MIME type on its own:
// the extension only selects the expected format, which is then verified against
// the actual bytes and rejected loudly when the two contradict each other.
import path from 'node:path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';

export type RawFileFormat = 'markdown' | 'txt' | 'docx' | 'pdf';
export type StoredFormat = RawFileFormat | 'unknown';

export class ParseError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.docx', '.pdf'];
export const FORMAT_BY_EXTENSION: Record<string, RawFileFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'txt',
  '.docx': 'docx',
  '.pdf': 'pdf',
};
export const EXTENSION_BY_FORMAT: Record<StoredFormat, string> = {
  markdown: '.md',
  txt: '.txt',
  docx: '.docx',
  pdf: '.pdf',
  unknown: '.bin',
};
const FORMAT_LABEL: Record<StoredFormat, string> = {
  markdown: 'Markdown',
  txt: 'TXT 文本',
  docx: 'DOCX 文档',
  pdf: 'PDF 文档',
  unknown: '未知格式',
};
export const MAMMOTH_PARSER = 'mammoth 1.13.0';

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const DOCX_ENTRY = Buffer.from('word/document.xml', 'latin1');
// PDF headers may legally be preceded by junk, but only inside the first 1024 bytes.
const PDF_SNIFF_WINDOW = 1024;

/** Extension of the original file name, lowercased. Only metadata: never used as a path. */
export function fileExtension(fileName: string): string {
  const base = path.basename(fileName.replace(/\\/g, '/'));
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** File name without directory parts, extension and control characters; used to derive a title. */
export function fileStem(fileName: string): string {
  const base = path.basename(fileName.replace(/\\/g, '/'));
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 300);
}

/** Format assumed from the extension alone; drives the retained original's file name. */
export function declaredFormat(extension: string): StoredFormat {
  return FORMAT_BY_EXTENSION[extension] ?? 'unknown';
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200) || '未知原因';
}

function isStrictUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type Detection = { format: RawFileFormat } | { failure: { code: string; message: string; status: number } };

/** Non-throwing format detection: the caller can retain the original before reporting the failure. */
export function detectFileFormat(bytes: Buffer, extension: string): Detection {
  if (bytes.length === 0) {
    return {
      failure: { code: 'EMPTY_FILE', message: '文件内容为空（0 字节），没有可提取的正文；未创建 Raw。', status: 400 },
    };
  }
  const looksLikePdf = bytes.subarray(0, PDF_SNIFF_WINDOW).includes(PDF_MAGIC);
  if (looksLikePdf) {
    if (extension !== '.pdf') {
      return {
        failure: {
          code: 'FORMAT_MISMATCH',
          message: `文件内容是 PDF，但扩展名是 ${extension || '（无）'}；文件名与内容不一致，已拒绝导入。`,
          status: 415,
        },
      };
    }
    return { format: 'pdf' };
  }
  if (bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
    const complete = bytes.includes(ZIP_END_OF_CENTRAL_DIRECTORY);
    if (!complete) {
      return extension === '.docx'
        ? {
            failure: {
              code: 'DOCX_INVALID',
              message: 'DOCX 压缩包不完整（找不到中央目录记录），文件已损坏或被截断；未创建 Raw。',
              status: 422,
            },
          }
        : {
            failure: {
              code: 'FORMAT_MISMATCH',
              message: `文件内容是损坏的压缩包，但扩展名是 ${extension || '（无）'}；未创建 Raw。`,
              status: 415,
            },
          };
    }
    if (!bytes.includes(DOCX_ENTRY)) {
      return {
        failure: {
          code: 'FORMAT_MISMATCH',
          message: '压缩包中缺少 word/document.xml，不是 Word DOCX 文档；已拒绝导入。',
          status: 415,
        },
      };
    }
    if (extension !== '.docx') {
      return {
        failure: {
          code: 'FORMAT_MISMATCH',
          message: `文件内容是 Word DOCX 文档，但扩展名是 ${extension || '（无）'}；文件名与内容不一致，已拒绝导入。`,
          status: 415,
        },
      };
    }
    return { format: 'docx' };
  }
  const declared = FORMAT_BY_EXTENSION[extension];
  if (declared === 'docx' || declared === 'pdf') {
    return {
      failure: {
        code: 'FORMAT_MISMATCH',
        message: `扩展名是 ${extension}，但文件内容不是${FORMAT_LABEL[declared]}；已拒绝导入。`,
        status: 415,
      },
    };
  }
  if (!declared) {
    return {
      failure: {
        code: 'UNSUPPORTED_FORMAT',
        message: `不支持的文件格式${extension ? `：${extension}` : '（缺少扩展名）'}。本批支持 Markdown（.md/.markdown）、TXT（.txt）、DOCX（.docx）与 PDF（.pdf）。`,
        status: 415,
      },
    };
  }
  if (!isStrictUtf8(bytes)) {
    return {
      failure: {
        code: 'UNSUPPORTED_ENCODING',
        message:
          '文本不是严格的 UTF-8 编码（可能是 GBK 等其它编码）。为避免产生乱码，本批不做猜测解码；请另存为 UTF-8 后重新导入，或改用粘贴文本。',
        status: 415,
      },
    };
  }
  return { format: declared };
}

export type PdfTextRange = { page: number; textStart: number | null; textEnd: number | null };
export type PdfTextMap = { pageCount: number; hasTextLayer: boolean; pages: PdfTextRange[] };
export type ExtractedBody = { parser: string; note: string; body: string; pdf?: PdfTextMap };

/** Extract the body for an already detected format. Throws ParseError with a specific code. */
export async function extractBody(
  bytes: Buffer,
  format: RawFileFormat,
  options: { allowPdfWithoutText?: boolean } = {},
): Promise<ExtractedBody> {
  if (format === 'pdf') return extractPdf(bytes, options.allowPdfWithoutText === true);
  if (format === 'docx') return extractDocx(bytes);
  return extractText(bytes);
}

function extractText(bytes: Buffer): ExtractedBody {
  // ignoreBOM:false keeps the decoder's default behaviour of dropping a leading BOM,
  // while every other byte, space and line break is preserved verbatim (no trim).
  const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  return {
    parser: 'utf-8-strict',
    note: '按严格 UTF-8 解码；已去除编码 BOM，正文空白与换行原样保留（不做 trim、不解析 frontmatter）。',
    body,
  };
}

async function extractDocx(bytes: Buffer): Promise<ExtractedBody> {
  let body: string;
  try {
    const result = await mammoth.extractRawText({ buffer: bytes });
    body = result.value;
  } catch (error) {
    throw new ParseError('DOCX_INVALID', `DOCX 解析失败：${reason(error)}；未创建 Raw。`, 422);
  }
  if (!body.trim()) {
    throw new ParseError('EMPTY_CONTENT', 'DOCX 中没有可提取的文字（可能只包含图片、图形或空段落）；未创建 Raw。', 422);
  }
  return {
    parser: MAMMOTH_PARSER,
    note: 'mammoth 提取 Word 文本；段落之间以空行分隔，段落内换行与空白按文档结构还原，不做 trim。',
    body,
  };
}

export async function openPdf(bytes: Buffer, render = false) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageDirectory = render
    ? path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
    : undefined;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    ...(packageDirectory
      ? {
          standardFontDataUrl: path.join(packageDirectory, 'standard_fonts') + '/',
          cMapUrl: path.join(packageDirectory, 'cmaps') + '/',
          wasmUrl: path.join(packageDirectory, 'wasm') + '/',
        }
      : {}),
  });
  try {
    return { document: await task.promise, version: pdfjs.version, close: () => task.destroy() };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      throw new ParseError('PDF_ENCRYPTED', 'PDF 已加密，需要密码才能读取；本批不支持加密文件，未创建 Raw。', 422);
    }
    throw new ParseError('PDF_INVALID', `PDF 结构损坏或无法解析：${reason(error)}；未创建 Raw。`, 422);
  }
}

async function extractPdf(bytes: Buffer, allowWithoutText: boolean): Promise<ExtractedBody> {
  const { document, version, close } = await openPdf(bytes);
  try {
    const pages: PdfTextRange[] = [];
    let body = '';
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      text = text.replace(/\n+$/u, '');
      if (text.trim()) {
        if (body) body += '\n\n';
        const textStart = body.length;
        body += text;
        pages.push({ page: index, textStart, textEnd: body.length });
      } else pages.push({ page: index, textStart: null, textEnd: null });
      page.cleanup();
    }
    const emptyPages = pages.filter((item) => item.textStart === null).map((item) => item.page);
    const parser = `pdfjs-dist ${version}`;
    if (!body && !allowWithoutText) {
      throw new ParseError(
        'PDF_NO_TEXT',
        `PDF 共 ${document.numPages} 页，但没有可提取的文字层（可能是扫描件或纯图片页）。本批不做 OCR；未创建 Raw，请改用粘贴文本。`,
        422,
      );
    }
    return {
      parser,
      note: body
        ? `${parser} 提取页面文字：共 ${document.numPages} 页，页内按行还原、页间以空行分隔，不做 OCR 且不静默截断。` +
          (emptyPages.length ? ` 第 ${emptyPages.join('、')} 页没有文字层（图片/扫描页），未包含在正文中。` : '')
        : `PDF 共 ${document.numPages} 页，没有可提取的文字层。原件已保留，可在 PDF 页面查看或显式启动图文理解。`,
      body,
      pdf: { pageCount: document.numPages, hasTextLayer: !!body, pages },
    };
  } finally {
    await close();
  }
}

/** Convenience for callers that want detection and extraction in one call. */
export async function parseFile(bytes: Buffer, extension: string): Promise<{ format: RawFileFormat } & ExtractedBody> {
  const detection = detectFileFormat(bytes, extension);
  if ('failure' in detection)
    throw new ParseError(detection.failure.code, detection.failure.message, detection.failure.status);
  return { format: detection.format, ...(await extractBody(bytes, detection.format)) };
}
