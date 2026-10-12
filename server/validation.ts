import { SOURCE_TYPES, type RawInput, type RawMetadata, type SourceType } from '../services/raw/store.ts';
import { MAX_BODY_CHARS } from '../services/raw/limits.ts';

export class InputError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}

/** Validate every Raw metadata field except the body. Used by both paste and file import. */
export function validateRawMetadata(value: unknown): RawMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('INVALID_BODY', '请求内容格式不正确。');
  const x = value as Record<string, unknown>;
  if (x.origin !== undefined) throw new InputError('MEETING_ORIGIN_FORBIDDEN', 'Meeting 来源标识只能由服务端登记。', 403);
  for (const field of ['id','importedAt','status','bodySha256','isDemo','assetId','assetFileName','assetFormat','assetByteSize','assetSha256','extractionParser','extractionNote']) {
    if (field in x) throw new InputError('SYSTEM_FIELD_FORBIDDEN', 'Raw 系统字段只能由服务端生成。', 403, { field });
  }
  const requiredText = (key: string, label: string) => {
    const v = x[key];
    if (typeof v !== 'string' || !v.trim()) throw new InputError('REQUIRED_FIELD', `${label}不能为空。`);
    return v;
  };
  const title = requiredText('title', '标题');
  const sourceName = requiredText('sourceName', '来源名称');
  if (typeof x.sourceType !== 'string' || !SOURCE_TYPES.includes(x.sourceType as SourceType)) throw new InputError('INVALID_SOURCE_TYPE', '来源类型无效。');
  if (x.tags !== undefined && (!Array.isArray(x.tags) || x.tags.some(t => typeof t !== 'string'))) throw new InputError('INVALID_TAGS', '标签必须是文本列表。');
  const optional = (key: string) => {
    const v = x[key];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') throw new InputError('INVALID_FIELD', `${key}格式不正确。`);
    return v;
  };
  const publishedAt = optional('publishedAt');
  if (publishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) throw new InputError('INVALID_DATE', '原发布日期请使用 YYYY-MM-DD 格式。');
  const url = optional('url');
  if (url) {
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
    catch { throw new InputError('INVALID_URL', '链接必须是有效的 http 或 https 地址。'); }
  }
  return {
    title, sourceType: x.sourceType as SourceType, sourceName,
    author: optional('author'), publishedAt, url,
    tags: ((x.tags as string[] | undefined) ?? []).map(t => t.trim()).filter(Boolean),
  };
}

export function validateBody(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new InputError('REQUIRED_FIELD', '正文不能为空。');
  if (value.length > MAX_BODY_CHARS) throw new InputError('BODY_TOO_LARGE', `正文超过 ${MAX_BODY_CHARS.toLocaleString()} 字符上限。`, 413);
  return value;
}

export function validateRaw(value: unknown): RawInput {
  const metadata = validateRawMetadata(value);
  return { ...metadata, body: validateBody((value as { body?: unknown }).body) };
}
