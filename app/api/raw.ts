import type { RawInput } from '../../services/raw/store';
import type { MediaArtifact } from '../../services/raw/media-artifact';
import { api } from './client';
import type { MeetingConfidentiality } from './meeting';
import type { WikiType } from './wiki';

export type SourceType = 'wechat' | 'article' | 'report' | 'company' | 'customer' | 'meeting' | 'note' | 'other';

export type MeetingRawOrigin = {
  kind: 'meeting';
  meeting_id: string;
  import_id: string;
  original_sha256: string;
  registered_confidentiality: MeetingConfidentiality;
  processing_policy: 'meeting_local_only';
};

export type PdfTextRange = { page: number; textStart: number | null; textEnd: number | null };

export type Raw = {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceName: string;
  author?: string;
  publishedAt?: string;
  url?: string;
  tags: string[];
  body: string;
  importedAt: string;
  status: 'unprocessed';
  bodySha256: string;
  /** B03: retained original file linkage. Absent for pasted text. */
  assetId?: string;
  assetFileName?: string;
  assetFormat?: string;
  assetByteSize?: number;
  assetSha256?: string;
  extractionParser?: string;
  extractionNote?: string;
  pdf?: { pageCount: number; hasTextLayer: boolean; pages: PdfTextRange[] };
  urlImport?: { finalUrl: string; fetchedAt: string };
  webImages?: RawInput['webImages'];
  newsMaterial?: RawInput['newsMaterial'];
  isDemo?: boolean;
  origin?: MeetingRawOrigin;
  bodyRevision?: number;
  bodyEditedAt?: string;
};

export type RawSummary = Omit<Raw, 'body' | 'bodySha256'>;
export type RawMediaArtifact = Omit<MediaArtifact, 'ocrRawText'>;
export type RawMediaReadingSource = {
  bodySha256: string;
  markers: Array<{ imageIndex: number; start: number; end: number }>;
  removed: Array<{ start: number; end: number }>;
};

const rawMediaUrl = (rawId: string) => `/api/raw/${encodeURIComponent(rawId)}/media`;

export const rawMedia = (rawId: string) =>
  api<{ items: RawMediaArtifact[]; readingSource: RawMediaReadingSource }>(rawMediaUrl(rawId));

export const parseRawMedia = (rawId: string, mediaId: string, force = false) =>
  api<RawMediaArtifact>(`${rawMediaUrl(rawId)}/${encodeURIComponent(mediaId)}/parse-vlm`, {
    method: 'POST',
    body: JSON.stringify(force ? { force: true } : {}),
  });

export const parseRawMediaBatch = (rawId: string, mediaIds: string[]) =>
  api<{ items: Array<{ mediaId: string; artifact?: RawMediaArtifact; error?: string }> }>(
    `${rawMediaUrl(rawId)}/parse-vlm-batch`,
    { method: 'POST', body: JSON.stringify({ mediaIds }) },
  );

export type RawAssetStatus = 'stored' | 'parsed' | 'parse_failed' | 'detached';
export type RawAssetRecord = {
  id: string;
  fileName: string;
  format: string;
  declaredExtension: string;
  byteSize: number;
  sha256: string;
  storedFile: string;
  createdAt: string;
  status: RawAssetStatus;
  rawId?: string;
  parser?: string;
  extractionNote?: string;
  failure?: { code: string; message: string; at: string };
  detachedAt?: string;
};

export type RawImportResult = {
  raw: Raw;
  asset: RawAssetRecord;
  extraction: { parser: string; note: string; bodyChars: number };
  warnings?: string[];
};

export type RawTranslation = {
  rawId: string;
  rawSha256: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  completedChunks: number;
  totalChunks: number;
  attempts: number;
  body?: string;
  reason?: string;
  error?: { code: string; message: string };
};

export type RawUrlImportResult = {
  kind: 'url';
  raw: Raw;
  extraction: RawImportResult['extraction'];
  translation?: RawTranslation;
};

const translationUrl = (rawId: string) => `/api/raw/${encodeURIComponent(rawId)}/translation`;

export const rawTranslation = (rawId: string) => api<{ translation: RawTranslation | null }>(translationUrl(rawId));

export const changeRawTranslation = (rawId: string, action: 'retry' | 'cancel') =>
  api<{ translation: RawTranslation }>(`${translationUrl(rawId)}/${action}`, { method: 'POST', body: '{}' });

export type RawReference = { id: string; title: string; type?: WikiType };

export type PdfPageSummary = PdfTextRange & { imageUrl: string; status: 'pending' | 'completed' };

export type PdfPage = PdfPageSummary & {
  text: string;
  understanding?: { blank: boolean; content: string; visuals: string; inference: string; questions: string[] };
};

export type RawPdf = {
  rawId: string;
  assetId: string;
  assetSha256: string;
  pageCount: number;
  hasTextLayer: boolean;
  originalUrl: string;
  pages: PdfPageSummary[];
  job: null | {
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    completedPages: number;
    totalPages: number;
    attempts: number;
    failedPage?: number;
    error?: { code: string; message: string };
  };
};

const rawPdfUrl = (rawId: string) => `/api/raw/${encodeURIComponent(rawId)}/pdf`;

async function pdfSummary(url: string, init?: RequestInit): Promise<RawPdf> {
  const result = await api<RawPdf>(url, init);
  if (!result || !Array.isArray(result.pages)) throw new Error('暂时无法读取 PDF 页目录。');
  return result;
}

export const getRawPdf = (rawId: string) => pdfSummary(rawPdfUrl(rawId));
export const getRawPdfPage = (rawId: string, page: number) => api<PdfPage>(`${rawPdfUrl(rawId)}/pages/${page}`);
export const changeRawPdfJob = (rawId: string, action: 'understand' | 'cancel') =>
  pdfSummary(`${rawPdfUrl(rawId)}/${action}`, { method: 'POST', body: '{}' });

export type PdfCleanupRange = { startPage: number; endPage: number };

export type PdfCleanupDecision = {
  id: string;
  page: number;
  text: string;
  origin: 'text' | 'image';
  kind: 'content' | 'visuals' | 'inference' | 'question';
  decision: 'keep' | 'merge' | 'skip';
  reason: string;
  topic?: string;
  mergedInto?: string;
};

export type PdfCleanupView = {
  rawId: string;
  pageCount: number;
  completedPages: number[];
  job:
    | null
    | (PdfCleanupRange & {
        status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
        stage: 'cleaning' | 'indexing' | 'assembling' | 'done';
        attempts: number;
        completedBatches: number;
        totalBatches: number;
        error?: { code: string; message: string };
        draftId?: string;
        draftStatus?: 'pending_confirmation' | 'committing' | 'confirmed' | 'discarded';
        canRegenerate?: boolean;
        counts: { kept: number; merged: number; skipped: number };
        decisions: PdfCleanupDecision[];
        topics: Array<{ title: string; unitCount: number }>;
      });
};

export const getPdfCleanup = (rawId: string) => api<PdfCleanupView>(`${rawPdfUrl(rawId)}/cleanup`);

export const changePdfCleanup = (rawId: string, action: 'start' | 'cancel' | 'draft', range?: PdfCleanupRange) =>
  api<PdfCleanupView>(`${rawPdfUrl(rawId)}/cleanup${action === 'start' ? '' : `/${action}`}`, {
    method: 'POST',
    body: range ? JSON.stringify(range) : undefined,
  });

export const pdfOriginalPageUrl = (rawId: string, page: number) => `${rawPdfUrl(rawId)}/original#page=${page}`;

export async function rawReferences(id: string): Promise<RawReference[]> {
  return (await api<{ items: RawReference[] }>(`/api/raw/${encodeURIComponent(id)}/references`)).items;
}

export const getRaw = (id: string) => api<Raw>(`/api/raw/${encodeURIComponent(id)}`);

export const getRawBodyHistory = (id: string, revision: number) =>
  api<Raw>(`/api/raw/${encodeURIComponent(id)}/body-history/${revision}`);

export const saveRawBody = (raw: Raw, body: string) =>
  api<Raw>(`/api/raw/${encodeURIComponent(raw.id)}/body`, {
    method: 'PATCH',
    body: JSON.stringify({ body, expectedBodySha256: raw.bodySha256, expectedBodyRevision: raw.bodyRevision ?? 0 }),
  });

export async function deleteRaw(
  id: string,
): Promise<{ id: string; title: string; assetId: string | null; assetRetained: boolean; warnings: string[] }> {
  return api(`/api/raw/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) });
}

export const sourceLabels: Record<SourceType, string> = {
  wechat: '微信公众号',
  article: '网页文章',
  report: '行业报告',
  company: '公司资料',
  customer: '客户资料',
  meeting: '会议纪要',
  note: '个人笔记',
  other: '其他',
};

export const formatLabels: Record<string, string> = {
  markdown: 'Markdown',
  txt: 'TXT 文本',
  docx: 'DOCX 文档',
  pdf: 'PDF 文档',
  unknown: '未识别格式',
};
