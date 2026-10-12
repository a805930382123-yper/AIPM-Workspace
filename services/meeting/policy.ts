import { MeetingError } from './errors.ts';
import { CONFIDENTIALITY, STORAGE_MODES, type Confidentiality, type Meeting, type MeetingCapabilities, type StorageMode } from './types.ts';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = ['title','meeting_date','meeting_time','meeting_type','tags','customer','project','description','recording_url','minutes_url','confidentiality','requestId'] as const;
const PATCH_FIELDS = ['baseRevision','title','meeting_date','meeting_time','meeting_type','tags','customer','project','description','recording_url','minutes_url'] as const;
const POLICY_FIELDS = ['baseRevision','confidentiality','storage_mode','local_storage_authorized','raw_transfer_authorized','external_ai_authorized','confirm_local_storage','confirm_raw_transfer','confirm_restricted_metadata_clear'] as const;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MeetingError('INVALID_BODY', `${name}格式不正确。`);
  return value as Record<string, unknown>;
}
function allowKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new MeetingError('UNKNOWN_FIELD', '请求包含不支持的字段。');
}
export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new MeetingError('INVALID_ID', `${field}必须是有效 UUID。`, 400, { field });
  return value.toLowerCase();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new MeetingError('INVALID_REVISION', 'baseRevision 必须是大于 0 的整数。', 400, { field: 'baseRevision' });
  return value as number;
}
function text(value: unknown, field: string, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null) { if (required) throw new MeetingError('REQUIRED_FIELD', `${label}不能为空。`, 400, { field }); return null; }
  if (typeof value !== 'string') throw new MeetingError('INVALID_FIELD', `${label}必须是文本。`, 400, { field });
  const normalized = value.trim();
  if (required && !normalized) throw new MeetingError('REQUIRED_FIELD', `${label}不能为空。`, 400, { field });
  if (normalized.length > max) throw new MeetingError('FIELD_TOO_LARGE', `${label}超过 ${max} 字符上限。`, 400, { field, limit: max });
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new MeetingError('INVALID_FIELD', `${label}包含控制字符。`, 400, { field });
  return normalized || null;
}
function url(value: unknown, field: string, label: string): string | null {
  if (typeof value === 'string' && /[\u0000-\u001f\u007f]/.test(value)) throw new MeetingError('INVALID_URL', `${label}必须是不含控制字符的 HTTPS 链接。`, 400, { field });
  const raw = text(value, field, label, 2048);
  if (raw === null) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new MeetingError('INVALID_URL', `${label}必须是有效 HTTPS 链接。`, 400, { field }); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /[\u0000-\u001f\u007f]/.test(raw)) throw new MeetingError('INVALID_URL', `${label}必须是无凭证且不含控制字符的 HTTPS 链接。`, 400, { field });
  return raw;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MeetingError('INVALID_DATE', 'meeting_date 必须采用 YYYY-MM-DD 格式。', 400, { field: 'meeting_date' });
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new MeetingError('INVALID_DATE', 'meeting_date 不是有效日期。', 400, { field: 'meeting_date' });
  return value;
}
function time(value: unknown): string | null {
  const result = text(value, 'meeting_time', '会议时间', 5);
  if (result !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new MeetingError('INVALID_TIME', 'meeting_time 必须采用 HH:mm 格式。', 400, { field: 'meeting_time' });
  return result;
}
function tags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new MeetingError('INVALID_TAGS', 'tags 必须是最多 100 项的 UUID 列表。', 400, { field: 'tags' });
  const items = value.map(id => requireUuid(id, 'tags'));
  if (new Set(items).size !== items.length) throw new MeetingError('DUPLICATE_TAG', 'tags 不能包含重复 ID。', 400, { field: 'tags' });
  return items;
}
export type MeetingInput = { title: string; meeting_date: string; meeting_time: string | null; meeting_type: string; tags: string[]; customer: string | null; project: string | null; description: string | null; recording_url: string | null; minutes_url: string | null; confidentiality: Confidentiality };
function normalizeFields(source: Record<string, unknown>, prior?: Meeting): Partial<MeetingInput> {
  const out: Partial<MeetingInput> = {};
  for (const field of ['title','meeting_date','meeting_time','meeting_type','tags','customer','project','description','recording_url','minutes_url'] as const) {
    if (!(field in source)) continue;
    switch (field) {
      case 'title': out.title = text(source[field], field, '会议标题', 200, true)!; break;
      case 'meeting_date': out.meeting_date = date(source[field]); break;
      case 'meeting_time': out.meeting_time = time(source[field]); break;
      case 'meeting_type': out.meeting_type = requireUuid(source[field], field); break;
      case 'tags': out.tags = tags(source[field]); break;
      case 'customer': out.customer = text(source[field], field, '客户', 200); break;
      case 'project': out.project = text(source[field], field, '项目', 200); break;
      case 'description': out.description = text(source[field], field, '备注', 2000); break;
      case 'recording_url': out.recording_url = url(source[field], field, '录音链接'); break;
      case 'minutes_url': out.minutes_url = url(source[field], field, '纪要链接'); break;
    }
  }
  if (prior) for (const key of ['title','meeting_date','meeting_time','meeting_type','tags','customer','project','description','recording_url','minutes_url'] as const) {
    if (!(key in out)) out[key] = prior[key] as never;
  }
  return out;
}
export function normalizeCreate(value: unknown): { requestId: string; input: MeetingInput } {
  const source = object(value, '会议请求'); allowKeys(source, CREATE_FIELDS);
  const requestId = requireUuid(source.requestId, 'requestId');
  if (source.confidentiality !== undefined && !CONFIDENTIALITY.includes(source.confidentiality as Confidentiality)) throw new MeetingError('INVALID_CONFIDENTIALITY', 'confidentiality 无效。', 400, { field: 'confidentiality' });
  const input = { meeting_time: null, tags: [], customer: null, project: null, description: null, recording_url: null, minutes_url: null, ...normalizeFields(source) } as MeetingInput;
  if (!input.title || !input.meeting_date || !input.meeting_type) throw new MeetingError('REQUIRED_FIELD', 'title、meeting_date 和 meeting_type 为必填字段。', 400);
  input.confidentiality = (source.confidentiality as Confidentiality | undefined) ?? 'Sensitive';
  if (input.confidentiality === 'Restricted' && (input.tags.length || input.customer || input.project || input.description || input.recording_url || input.minutes_url)) throw new MeetingError('RESTRICTED_FIELDS', 'Restricted 会议只能登记代称、日期和主类型。', 403);
  return { requestId, input };
}
export function normalizePatch(value: unknown, prior: Meeting): { baseRevision: number; input: Partial<MeetingInput> } {
  const source = object(value, '会议更新'); allowKeys(source, PATCH_FIELDS);
  const baseRevision = revision(source.baseRevision);
  if (!PATCH_FIELDS.some(field => field !== 'baseRevision' && field in source)) throw new MeetingError('EMPTY_PATCH', '至少提供一个可修改字段。');
  const input = normalizeFields(source, prior);
  return { baseRevision, input };
}
export type PolicyInput = { baseRevision: number; confidentiality?: Confidentiality; storage_mode?: StorageMode; local_storage_authorized?: boolean; raw_transfer_authorized?: boolean; external_ai_authorized?: boolean; confirm_local_storage?: boolean; confirm_raw_transfer?: boolean; confirm_restricted_metadata_clear?: boolean };
export function normalizePolicy(value: unknown): PolicyInput {
  const source = object(value, '策略请求'); allowKeys(source, POLICY_FIELDS);
  const result: PolicyInput = { baseRevision: revision(source.baseRevision) };
  if ('confidentiality' in source) {
    if (!CONFIDENTIALITY.includes(source.confidentiality as Confidentiality)) throw new MeetingError('INVALID_CONFIDENTIALITY', 'confidentiality 无效。', 400, { field: 'confidentiality' });
    result.confidentiality = source.confidentiality as Confidentiality;
  }
  if ('storage_mode' in source) {
    if (!STORAGE_MODES.includes(source.storage_mode as StorageMode)) throw new MeetingError('INVALID_STORAGE_MODE', 'storage_mode 无效。', 400, { field: 'storage_mode' });
    result.storage_mode = source.storage_mode as StorageMode;
  }
  for (const field of ['local_storage_authorized','raw_transfer_authorized','external_ai_authorized','confirm_local_storage','confirm_raw_transfer','confirm_restricted_metadata_clear'] as const) if (field in source) {
    if (typeof source[field] !== 'boolean') throw new MeetingError('INVALID_FIELD', `${field} 必须是布尔值。`, 400, { field });
    if (field === 'external_ai_authorized' && source[field] === true) throw new MeetingError('AI_NOT_SUPPORTED', '本版不支持 Meeting 外部 AI 处理。', 403, { field });
    (result as Record<string, unknown>)[field] = source[field];
    if (field === 'external_ai_authorized' && source[field] === false) result.external_ai_authorized = false;
  }
  if (Object.keys(result).length === 1) throw new MeetingError('EMPTY_POLICY', '至少提供一个策略变更。');
  return result;
}
export function capabilities(meeting: Meeting): MeetingCapabilities {
  const canImportMinutes = meeting.storage_mode === 'local_archive'
    && meeting.confidentiality !== 'Restricted'
    && (meeting.confidentiality === 'Public' || meeting.local_storage_authorized);
  const importReason = canImportMinutes ? '' : meeting.confidentiality === 'Restricted'
    ? 'Restricted 会议禁止保存本地正文。'
    : meeting.storage_mode !== 'local_archive' ? '请先切换到本地归档模式。' : '请先确认已获本地保存授权。';
  const canRegisterRaw = meeting.storage_mode === 'local_archive'
    && (meeting.confidentiality === 'Public' || meeting.confidentiality === 'Internal')
    && meeting.raw_transfer_authorized;
  return { canImportMinutes, canRegisterRaw, canUseAi: false,
    importReason, rawReason: canRegisterRaw ? '' : '需要本地归档、Public/Internal等级和独立Raw授权。', aiReason: '本版不支持 Meeting 外部 AI 处理。' };
}

