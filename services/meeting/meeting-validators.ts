import { createHash } from 'node:crypto';
import { MeetingError } from './errors.ts';
import { UUID_PATTERN } from './policy.ts';
import {
  CONFIDENTIALITY,
  STORAGE_MODES,
  type Meeting,
  type MeetingCatalog,
  type MeetingCatalogEntry,
  type MeetingRawLink,
  type MeetingSummary,
  type MeetingMinuteVersion,
  type MinuteRequest,
} from './types.ts';

export const cleanClone = <T>(value: T): T => structuredClone(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
export function linkFingerprint(value: { baseRevision: number; import_id: string; confirm: true }) {
  return digest({ import_id: value.import_id, confirm: true });
}
export function minuteDigest(value: MeetingMinuteVersion): string {
  return digest({
    text: value.imported_minutes,
    original_filename: value.original_filename,
    file_sha256: value.original_filename === null ? null : value.file_sha256,
  });
}
export function catalogName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || hasControlChar(value))
    throw new MeetingError('INVALID_NAME', '目录名称必须为 1–100 个不含控制字符的文本。');
  return value.trim();
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
export function validStoredText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= max &&
    !hasControlChar(value)
  );
}
export function validOptionalText(value: unknown, max: number): boolean {
  return value === null || validStoredText(value, max);
}
export function validUrl(value: unknown): boolean {
  if (value === null) return true;
  if (!validStoredText(value, 2048)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
export function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
export const MAX_MINUTE_BYTES = 2 * 1024 * 1024;
export const MAX_MINUTE_CHARS = 500_000;
export const MAX_MEETING_JSON_BYTES = 32 * 1024 * 1024;
export function validUnicodeText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function validMinute(value: unknown): value is MeetingMinuteVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as MeetingMinuteVersion;
  const keys = [
    'import_id',
    'imported_at',
    'imported_minutes',
    'editable_minutes',
    'original_filename',
    'original_sha256',
  ];
  if (x.file_sha256 !== undefined) keys.push('file_sha256');
  if (x.file_base64 !== undefined) keys.push('file_base64', 'file_format');
  return (
    exactKeys(x as unknown as Record<string, unknown>, keys) &&
    typeof x.import_id === 'string' &&
    UUID_PATTERN.test(x.import_id) &&
    x.import_id === x.import_id.toLowerCase() &&
    validTimestamp(x.imported_at) &&
    typeof x.imported_minutes === 'string' &&
    x.imported_minutes.length > 0 &&
    x.imported_minutes.length <= MAX_MINUTE_CHARS &&
    !!x.imported_minutes.trim() &&
    !x.imported_minutes.includes('\0') &&
    validUnicodeText(x.imported_minutes) &&
    Buffer.byteLength(x.imported_minutes, 'utf8') <= MAX_MINUTE_BYTES &&
    typeof x.editable_minutes === 'string' &&
    x.editable_minutes.length > 0 &&
    x.editable_minutes.length <= MAX_MINUTE_CHARS &&
    !!x.editable_minutes.trim() &&
    !x.editable_minutes.includes('\0') &&
    validUnicodeText(x.editable_minutes) &&
    (x.original_filename === null ||
      (typeof x.original_filename === 'string' &&
        x.original_filename.length > 0 &&
        x.original_filename.length <= 255 &&
        /\.(md|txt|docx|pdf)$/i.test(x.original_filename) &&
        validUnicodeText(x.original_filename) &&
        !/[\\/]/.test(x.original_filename) &&
        !hasControlChar(x.original_filename))) &&
    typeof x.original_sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.original_sha256) &&
    x.original_sha256 === createHash('sha256').update(x.imported_minutes, 'utf8').digest('hex') &&
    (x.file_sha256 === undefined ||
      (typeof x.file_sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(x.file_sha256) &&
        (x.file_base64 !== undefined || x.file_sha256 === x.original_sha256))) &&
    (x.file_base64 === undefined ||
      (typeof x.file_base64 === 'string' &&
        x.file_base64.length > 0 &&
        Buffer.from(x.file_base64, 'base64').toString('base64') === x.file_base64 &&
        Buffer.from(x.file_base64, 'base64').length <= MAX_MINUTE_BYTES &&
        createHash('sha256').update(Buffer.from(x.file_base64, 'base64')).digest('hex') === x.file_sha256 &&
        ['markdown', 'txt', 'docx', 'pdf'].includes(x.file_format!)))
  );
}
export function validMinuteRequest(value: unknown): value is MinuteRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as MinuteRequest;
  return (
    exactKeys(x as unknown as Record<string, unknown>, ['requestId', 'inputSha256', 'importId', 'deleted']) &&
    typeof x.requestId === 'string' &&
    UUID_PATTERN.test(x.requestId) &&
    x.requestId === x.requestId.toLowerCase() &&
    typeof x.inputSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.inputSha256) &&
    typeof x.importId === 'string' &&
    UUID_PATTERN.test(x.importId) &&
    x.importId === x.importId.toLowerCase() &&
    typeof x.deleted === 'boolean'
  );
}
export function validRawLink(value: unknown): value is MeetingRawLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as MeetingRawLink;
  const baseKeys = [
    'request_id',
    'import_id',
    'raw_id',
    'original_sha256',
    'created_at',
    'status',
    'request_fingerprint',
    'raw_title',
    'source_name',
    'tags',
  ];
  if (x.request_fingerprint_version !== undefined && x.request_fingerprint_version !== 2) return false;
  const withFingerprintVersion = (keys: string[]) =>
    x.request_fingerprint_version === 2 ? [...keys, 'request_fingerprint_version'] : keys;
  if (!['pending', 'linked', 'failed', 'unlinked', 'raw_deleted'].includes(x.status)) return false;
  if (x.status === 'pending') {
    if (!exactKeys(x as unknown as Record<string, unknown>, withFingerprintVersion(baseKeys))) return false;
  } else if (x.status === 'failed') {
    if (
      !exactKeys(x as unknown as Record<string, unknown>, withFingerprintVersion([...baseKeys, 'error'])) ||
      !x.error ||
      typeof x.error !== 'object' ||
      Array.isArray(x.error) ||
      !exactKeys(x.error as unknown as Record<string, unknown>, ['code', 'at']) ||
      !validStoredText(x.error.code, 100) ||
      !validTimestamp(x.error.at)
    )
      return false;
  } else if (x.status === 'linked' || x.status === 'unlinked') {
    if (
      !exactKeys(x as unknown as Record<string, unknown>, withFingerprintVersion([...baseKeys, 'registered_at'])) ||
      !validTimestamp(x.registered_at)
    )
      return false;
  } else if (x.status === 'raw_deleted') {
    const keys = withFingerprintVersion(x.registered_at === undefined ? baseKeys : [...baseKeys, 'registered_at']);
    if (
      !exactKeys(x as unknown as Record<string, unknown>, keys) ||
      (x.registered_at !== undefined && !validTimestamp(x.registered_at))
    )
      return false;
  }
  return (
    typeof x.request_id === 'string' &&
    UUID_PATTERN.test(x.request_id) &&
    x.request_id === x.request_id.toLowerCase() &&
    typeof x.import_id === 'string' &&
    UUID_PATTERN.test(x.import_id) &&
    x.import_id === x.import_id.toLowerCase() &&
    typeof x.raw_id === 'string' &&
    UUID_PATTERN.test(x.raw_id) &&
    x.raw_id === x.raw_id.toLowerCase() &&
    typeof x.original_sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.original_sha256) &&
    validTimestamp(x.created_at) &&
    typeof x.request_fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(x.request_fingerprint) &&
    validStoredText(x.raw_title, 200) &&
    validStoredText(x.source_name, 200) &&
    Array.isArray(x.tags) &&
    x.tags.every((tag) => typeof tag === 'string' && UUID_PATTERN.test(tag)) &&
    new Set(x.tags).size === x.tags.length
  );
}
export function isEntry(value: unknown): value is MeetingCatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as MeetingCatalogEntry;
  return (
    exactKeys(entry as unknown as Record<string, unknown>, ['id', 'name', 'active']) &&
    typeof entry.id === 'string' &&
    UUID_PATTERN.test(entry.id) &&
    entry.id === entry.id.toLowerCase() &&
    validStoredText(entry.name, 100) &&
    typeof entry.active === 'boolean'
  );
}
export function validCatalog(value: unknown): value is MeetingCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as MeetingCatalog;
  if (
    !exactKeys(item as unknown as Record<string, unknown>, ['schema_version', 'revision', 'types', 'tags']) ||
    item.schema_version !== 1 ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 1 ||
    !Array.isArray(item.types) ||
    item.types.length < 8 ||
    item.types.length > 500 ||
    !item.types.every(isEntry) ||
    !Array.isArray(item.tags) ||
    item.tags.length > 500 ||
    !item.tags.every(isEntry)
  )
    return false;
  const names = (entries: MeetingCatalogEntry[]) =>
    entries.map((entry) => entry.name.normalize('NFKC').toLocaleLowerCase('zh-CN'));
  const allIds = [...item.types, ...item.tags].map((entry) => entry.id);
  const typeNames = new Set(names(item.types));
  return (
    new Set(allIds).size === allIds.length &&
    typeNames.size === item.types.length &&
    new Set(names(item.tags)).size === item.tags.length
  );
}
export function validMeeting(value: unknown, id: string): value is Meeting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as Meeting;
  const oldKeys = [
    'schema_version',
    'meeting_id',
    'revision',
    'created_at',
    'updated_at',
    'title',
    'meeting_date',
    'meeting_time',
    'meeting_type',
    'tags',
    'customer',
    'project',
    'description',
    'recording_url',
    'minutes_url',
    'confidentiality',
    'storage_mode',
    'local_storage_authorized',
    'external_ai_authorized',
    'raw_transfer_authorized',
    'policy_updated_at',
    'imports',
    'active_import_id',
    'raw_links',
    'raw_source_id',
    'creation',
  ];
  const currentKeys = [...oldKeys, 'minute_requests'];
  if (!(
    exactKeys(x as unknown as Record<string, unknown>, oldKeys) ||
    exactKeys(x as unknown as Record<string, unknown>, currentKeys)
  ))
    return false;
  if (
    !x.creation ||
    typeof x.creation !== 'object' ||
    Array.isArray(x.creation) ||
    !exactKeys(x.creation as unknown as Record<string, unknown>, ['requestId', 'inputSha256'])
  )
    return false;
  if (!Array.isArray(x.tags) || !CONFIDENTIALITY.includes(x.confidentiality) || !STORAGE_MODES.includes(x.storage_mode))
    return false;
  if (!Array.isArray(x.imports) || x.imports.length > 1000 || !x.imports.every(validMinute)) return false;
  const dateValid =
    typeof x.meeting_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.meeting_date) &&
    !Number.isNaN(Date.parse(`${x.meeting_date}T00:00:00Z`)) &&
    new Date(`${x.meeting_date}T00:00:00Z`).toISOString().slice(0, 10) === x.meeting_date;
  const timeValid =
    x.meeting_time === null ||
    (typeof x.meeting_time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x.meeting_time));
  const tagsValid =
    Array.isArray(x.tags) &&
    x.tags.length <= 100 &&
    x.tags.every((tag) => typeof tag === 'string' && UUID_PATTERN.test(tag) && tag === tag.toLowerCase()) &&
    new Set(x.tags).size === x.tags.length;
  const nullableText =
    validOptionalText(x.customer, 200) &&
    validOptionalText(x.project, 200) &&
    (x.description === null ||
      (typeof x.description === 'string' &&
        x.description === x.description.trim() &&
        x.description.length > 0 &&
        x.description.length <= 2000 &&
        !hasDisallowedDescriptionControlChar(x.description)));
  const policyConsistent =
    x.external_ai_authorized === false &&
    !(
      x.confidentiality === 'Restricted' &&
      (x.storage_mode !== 'cloud_index' ||
        x.local_storage_authorized ||
        x.raw_transfer_authorized ||
        x.tags.length ||
        x.customer ||
        x.project ||
        x.description ||
        x.recording_url ||
        x.minutes_url)
    ) &&
    !(
      (x.confidentiality === 'Internal' || x.confidentiality === 'Sensitive') &&
      x.storage_mode === 'local_archive' &&
      !x.local_storage_authorized
    ) &&
    !(x.storage_mode === 'cloud_index' && x.raw_transfer_authorized) &&
    !(x.raw_transfer_authorized && x.storage_mode !== 'local_archive') &&
    !(x.raw_transfer_authorized && (x.confidentiality === 'Sensitive' || x.confidentiality === 'Restricted')) &&
    !(
      x.imports.length &&
      (x.confidentiality === 'Restricted' ||
        x.storage_mode !== 'local_archive' ||
        ((x.confidentiality === 'Internal' || x.confidentiality === 'Sensitive') && !x.local_storage_authorized))
    );
  return (
    x.schema_version === 1 &&
    x.meeting_id === id &&
    Number.isSafeInteger(x.revision) &&
    x.revision >= 1 &&
    validTimestamp(x.created_at) &&
    validTimestamp(x.updated_at) &&
    validTimestamp(x.policy_updated_at) &&
    x.created_at <= x.updated_at &&
    x.policy_updated_at <= x.updated_at &&
    validStoredText(x.title, 200) &&
    dateValid &&
    timeValid &&
    typeof x.meeting_type === 'string' &&
    UUID_PATTERN.test(x.meeting_type) &&
    x.meeting_type === x.meeting_type.toLowerCase() &&
    tagsValid &&
    nullableText &&
    validUrl(x.recording_url) &&
    validUrl(x.minutes_url) &&
    CONFIDENTIALITY.includes(x.confidentiality) &&
    STORAGE_MODES.includes(x.storage_mode) &&
    typeof x.local_storage_authorized === 'boolean' &&
    x.external_ai_authorized === false &&
    typeof x.raw_transfer_authorized === 'boolean' &&
    policyConsistent &&
    Array.isArray(x.imports) &&
    x.imports.length <= 1000 &&
    x.imports.every(validMinute) &&
    new Set(x.imports.map((item) => item.import_id)).size === x.imports.length &&
    (x.imports.length === 0
      ? x.active_import_id === null
      : typeof x.active_import_id === 'string' && x.imports.at(-1)?.import_id === x.active_import_id) &&
    (x.minute_requests === undefined ||
      (Array.isArray(x.minute_requests) &&
        x.minute_requests.length <= 10000 &&
        x.minute_requests.every(validMinuteRequest) &&
        new Set(x.minute_requests.map((item) => item.requestId)).size === x.minute_requests.length)) &&
    (x.minute_requests === undefined
      ? x.imports.length === 0
      : x.imports.every((item) =>
          x.minute_requests!.some(
            (request) =>
              request.importId === item.import_id && !request.deleted && request.inputSha256 === minuteDigest(item),
          ),
        ) &&
        x.minute_requests.every((request) =>
          request.deleted
            ? !x.imports.some((item) => item.import_id === request.importId)
            : x.imports.some(
                (item) => item.import_id === request.importId && minuteDigest(item) === request.inputSha256,
              ),
        ) &&
        new Set(x.minute_requests.filter((request) => !request.deleted).map((request) => request.importId)).size ===
          x.imports.length) &&
    Array.isArray(x.raw_links) &&
    x.raw_links.length <= 1000 &&
    x.raw_links.every(validRawLink) &&
    new Set(x.raw_links.map((item) => item.request_id)).size === x.raw_links.length &&
    new Set(x.raw_links.filter((item) => item.status === 'linked').map((item) => item.raw_id)).size ===
      x.raw_links.filter((item) => item.status === 'linked').length &&
    x.raw_source_id ===
      (x.raw_links.find((item) => item.status === 'linked' && item.import_id === x.active_import_id)?.raw_id ?? null) &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_MEETING_JSON_BYTES &&
    typeof x.creation.requestId === 'string' &&
    UUID_PATTERN.test(x.creation.requestId) &&
    x.creation.requestId === x.creation.requestId.toLowerCase() &&
    typeof x.creation.inputSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.creation.inputSha256)
  );
}
export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
export function hasDisallowedDescriptionControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code <= 0x1f && code !== 9 && code !== 10 && code !== 13) || code === 0x7f) return true;
  }
  return false;
}
export function toMeetingSummary(value: Meeting): MeetingSummary {
  return {
    schema_version: value.schema_version,
    meeting_id: value.meeting_id,
    revision: value.revision,
    created_at: value.created_at,
    updated_at: value.updated_at,
    title: value.title,
    meeting_date: value.meeting_date,
    meeting_time: value.meeting_time,
    meeting_type: value.meeting_type,
    tags: value.tags,
    customer: value.customer,
    project: value.project,
    description: value.description,
    recording_url: value.recording_url,
    minutes_url: value.minutes_url,
    confidentiality: value.confidentiality,
    storage_mode: value.storage_mode,
    local_storage_authorized: value.local_storage_authorized,
    external_ai_authorized: value.external_ai_authorized,
    raw_transfer_authorized: value.raw_transfer_authorized,
    policy_updated_at: value.policy_updated_at,
  };
}
