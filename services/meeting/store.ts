import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { MeetingError } from './errors.ts';
import {
  normalizeCreate,
  normalizePatch,
  normalizePolicy,
  requireUuid,
  UUID_PATTERN,
  type PolicyInput,
} from './policy.ts';
import type { RawRecord } from '../raw/store.ts';
import {
  CONFIDENTIALITY,
  DEFAULT_MEETING_TYPES,
  STORAGE_MODES,
  type Meeting,
  type MeetingCatalog,
  type MeetingCatalogEntry,
  type MeetingRawLink,
  type MeetingSummary,
  type MeetingMinuteVersion,
  type MinuteRequest,
} from './types.ts';

const cleanClone = <T>(value: T): T => structuredClone(value);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function linkFingerprint(value: { baseRevision: number; import_id: string; confirm: true }) {
  return digest({ import_id: value.import_id, confirm: true });
}
function minuteDigest(value: MeetingMinuteVersion): string {
  return digest({
    text: value.imported_minutes,
    original_filename: value.original_filename,
    file_sha256: value.original_filename === null ? null : value.file_sha256,
  });
}
function catalogName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value))
    throw new MeetingError('INVALID_NAME', '目录名称必须为 1–100 个不含控制字符的文本。');
  return value.trim();
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function validStoredText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function validOptionalText(value: unknown, max: number): boolean {
  return value === null || validStoredText(value, max);
}
function validUrl(value: unknown): boolean {
  if (value === null) return true;
  if (!validStoredText(value, 2048)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
const MAX_MINUTE_BYTES = 2 * 1024 * 1024;
const MAX_MINUTE_CHARS = 500_000;
const MAX_MEETING_JSON_BYTES = 32 * 1024 * 1024;
function validUnicodeText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function validMinute(value: unknown): value is MeetingMinuteVersion {
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
        !/[\\/\u0000-\u001f\u007f]/.test(x.original_filename))) &&
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
function validMinuteRequest(value: unknown): value is MinuteRequest {
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
function validRawLink(value: unknown): value is MeetingRawLink {
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
function isEntry(value: unknown): value is MeetingCatalogEntry {
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
function validCatalog(value: unknown): value is MeetingCatalog {
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
function validMeeting(value: unknown, id: string): value is Meeting {
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
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x.description)));
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

export class MeetingStore {
  private readonly queue = new SerialQueue();
  private readonly base: string;
  private readonly records: string;
  private readonly catalogFile: string;
  constructor(public readonly root: string) {
    this.base = path.join(root, 'meetings');
    this.records = path.join(this.base, 'records');
    this.catalogFile = path.join(this.base, 'catalog.json');
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }

  private async ensureDirectory(dir: string, create: boolean): Promise<void> {
    let info = await lstat(dir).catch((error) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
    );
    if (!info && create) {
      await mkdir(dir, { recursive: dir === this.root });
      info = await lstat(dir);
    }
    if (!info || info.isSymbolicLink() || !info.isDirectory())
      throw new MeetingError('MEETING_PATH_INVALID', '会议数据目录不是安全的本地目录。', 409);
  }
  private async ensurePaths(create: boolean): Promise<void> {
    await this.ensureDirectory(this.root, create);
    await this.ensureDirectory(this.base, create);
    await this.ensureDirectory(this.records, create);
  }
  private async catalog(): Promise<MeetingCatalog> {
    await this.ensurePaths(true);
    const info = await lstat(this.catalogFile).catch((error) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
    );
    if (info?.isSymbolicLink() || (info && !info.isFile()))
      throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议目录文件路径无效，原文件已保留。', 409);
    if (!info) {
      const existingFiles = await readdir(this.records).catch(() => {
        throw new MeetingError('MEETING_READ_FAILED', '会议记录目录无法读取。', 500);
      });
      if (existingFiles.length)
        throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议记录已存在但目录文件缺失，拒绝重新生成目录。', 409);
      const catalog: MeetingCatalog = {
        schema_version: 1,
        revision: 1,
        types: DEFAULT_MEETING_TYPES.map((name) => ({ id: randomUUID(), name, active: true })),
        tags: [],
      };
      try {
        await writeJsonAtomic(this.catalogFile, catalog);
      } catch {
        throw new MeetingError('MEETING_WRITE_FAILED', '会议目录初始化失败。', 500);
      }
      return catalog;
    }
    let value: unknown;
    try {
      value = await readJsonFile<unknown>(this.catalogFile);
    } catch {
      throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议目录文件损坏或不可读取，原文件已保留。', 409);
    }
    if (!validCatalog(value))
      throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议目录结构无效，原文件已保留。', 409);
    return value;
  }
  async initialize(): Promise<void> {
    await this.serialized(async () => {
      await this.catalog();
    });
  }
  async getCatalog(): Promise<MeetingCatalog> {
    return cleanClone(await this.catalog());
  }
  private async read(idValue: unknown): Promise<Meeting | undefined> {
    const id = requireUuid(idValue, 'meeting_id');
    await this.ensurePaths(false);
    const file = path.join(this.records, `${id}.json`);
    const info = await lstat(file).catch((error) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
    );
    if (!info) return undefined;
    if (info.isSymbolicLink() || !info.isFile())
      throw new MeetingError('CORRUPT_MEETING', '会议记录路径无效，原文件已保留。', 409, { meeting_id: id });
    if (info.size > MAX_MEETING_JSON_BYTES)
      throw new MeetingError('CORRUPT_MEETING', '会议记录超过 32 MiB 上限，原文件已保留。', 409, {
        meeting_id: id,
        limitBytes: MAX_MEETING_JSON_BYTES,
      });
    let value: unknown;
    try {
      value = await readJsonFile<unknown>(file);
    } catch {
      throw new MeetingError('CORRUPT_MEETING', '会议记录损坏或不可读取，原文件已保留。', 409, { meeting_id: id });
    }
    if (!validMeeting(value, id))
      throw new MeetingError('CORRUPT_MEETING', '会议记录结构无效或与文件名不一致，原文件已保留。', 409, {
        meeting_id: id,
      });
    if (value.minute_requests === undefined) value.minute_requests = [];
    const catalog = await this.catalog();
    if (
      !catalog.types.some((entry) => entry.id === value.meeting_type) ||
      value.tags.some((tag) => !catalog.tags.some((entry) => entry.id === tag))
    )
      throw new MeetingError('CORRUPT_MEETING', '会议记录引用了不存在的目录项，原文件已保留。', 409, {
        meeting_id: id,
      });
    return value;
  }
  async get(id: unknown): Promise<Meeting | undefined> {
    return cleanClone(await this.read(id));
  }
  private async all(): Promise<Meeting[]> {
    await this.ensurePaths(false);
    let names: string[];
    try {
      names = await readdir(this.records);
    } catch {
      throw new MeetingError('MEETING_READ_FAILED', '会议记录目录无法读取。', 500);
    }
    const ids: string[] = [];
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!UUID_PATTERN.test(id))
        throw new MeetingError('CORRUPT_MEETING', '会议记录目录包含无效 JSON 文件名，原文件已保留。', 409);
      ids.push(id.toLowerCase());
    }
    const result: Meeting[] = [];
    for (const id of [...new Set(ids)].sort()) {
      const record = await this.read(id);
      if (!record)
        throw new MeetingError('CORRUPT_MEETING', '会议记录在读取期间消失，请重试。', 409, { meeting_id: id });
      result.push(record);
    }
    return result;
  }
  async allDetailed(): Promise<Meeting[]> {
    return cleanClone(await this.all());
  }
  async list(): Promise<MeetingSummary[]> {
    return (await this.all()).map(
      ({
        imports: _imports,
        active_import_id: _active,
        minute_requests: _requests,
        raw_links: _links,
        raw_source_id: _raw,
        creation: _creation,
        ...item
      }) => item,
    );
  }
  private async save(record: Meeting): Promise<void> {
    if (Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`, 'utf8') > MAX_MEETING_JSON_BYTES)
      throw new MeetingError(
        'MEETING_JSON_TOO_LARGE',
        '会议历史版本已达到单条记录上限，请先删除部分本地纪要版本。',
        413,
        { limitBytes: MAX_MEETING_JSON_BYTES },
      );
    const file = path.join(this.records, `${record.meeting_id}.json`);
    const existing = await lstat(file).catch((error) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
    );
    if (existing?.isSymbolicLink() || (existing && !existing.isFile()))
      throw new MeetingError('CORRUPT_MEETING', '会议记录路径无效，拒绝覆盖。', 409, { meeting_id: record.meeting_id });
    try {
      await writeJsonAtomic(file, record);
    } catch {
      throw new MeetingError('MEETING_WRITE_FAILED', '会议记录保存失败，原有内容保持不变。', 500, {
        meeting_id: record.meeting_id,
      });
    }
  }
  async create(value: unknown): Promise<{ meeting: Meeting; reused: boolean }> {
    return this.serialized(async () => {
      const { requestId, input } = normalizeCreate(value);
      const all = await this.all();
      const existing = all.find((record) => record.creation.requestId === requestId);
      if (existing) {
        if (existing.creation.inputSha256 !== digest(input))
          throw new MeetingError('IDEMPOTENCY_CONFLICT', 'requestId 已用于不同的会议内容。', 409, { requestId });
        return { meeting: cleanClone(existing), reused: true };
      }
      const catalog = await this.catalog();
      this.validateSelection(catalog, input.meeting_type, input.tags, false);
      const now = new Date().toISOString();
      const record: Meeting = {
        schema_version: 1,
        meeting_id: randomUUID(),
        revision: 1,
        created_at: now,
        updated_at: now,
        ...input,
        storage_mode: 'cloud_index',
        local_storage_authorized: false,
        external_ai_authorized: false,
        raw_transfer_authorized: false,
        policy_updated_at: now,
        imports: [],
        active_import_id: null,
        minute_requests: [],
        raw_links: [],
        raw_source_id: null,
        creation: { requestId, inputSha256: digest(input) },
      };
      await this.save(record);
      return { meeting: cleanClone(record), reused: false };
    });
  }
  async update(id: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(async () => {
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const { baseRevision, input } = normalizePatch(value, current);
      if (baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请刷新后重试。', 409, {
          currentRevision: current.revision,
        });
      const patch = value as Record<string, unknown>;
      const catalog = await this.catalog();
      this.validateSelection(
        catalog,
        input.meeting_type!,
        input.tags!,
        true,
        current,
        'meeting_type' in patch,
        'tags' in patch,
      );
      if (
        current.confidentiality === 'Restricted' &&
        ['customer', 'project', 'description', 'recording_url', 'minutes_url'].some(
          (k) => k in patch && patch[k] !== null && patch[k] !== '',
        )
      )
        throw new MeetingError('RESTRICTED_FIELDS', 'Restricted 会议只能修改代称、日期和类型。', 403);
      if (current.confidentiality === 'Restricted' && 'tags' in patch && Array.isArray(patch.tags) && patch.tags.length)
        throw new MeetingError('RESTRICTED_FIELDS', 'Restricted 会议不能保存标签。', 403);
      const next = { ...current, ...input, revision: current.revision + 1, updated_at: new Date().toISOString() };
      await this.save(next);
      return cleanClone(next);
    });
  }
  async updatePolicy(id: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(async () => {
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const input = normalizePolicy(value);
      if (input.baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议策略已有更新，请刷新后重试。', 409, {
          currentRevision: current.revision,
        });
      return this.changePolicy(current, input);
    });
  }
  async importMinutes(
    id: unknown,
    value: unknown,
  ): Promise<{ meeting: Meeting; imported: MeetingMinuteVersion; reused: boolean }> {
    return this.serialized(async () => {
      const source =
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const allowed = [
        'baseRevision',
        'requestId',
        'text',
        'confirmReimport',
        'original_filename',
        'file_sha256',
        'file_base64',
        'file_format',
      ];
      if (Object.keys(source).some((key) => !allowed.includes(key)))
        throw new MeetingError('UNKNOWN_FIELD', '导入请求包含不支持的字段。');
      if (!Number.isSafeInteger(source.baseRevision) || (source.baseRevision as number) < 1)
        throw new MeetingError('INVALID_REVISION', 'baseRevision 必须是大于 0 的整数。', 400, {
          field: 'baseRevision',
        });
      const requestId = requireUuid(source.requestId, 'requestId');
      if (typeof source.text !== 'string')
        throw new MeetingError('INVALID_MINUTES', '纪要正文必须是文本。', 400, { field: 'text' });
      const text = source.text;
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > MAX_MINUTE_BYTES)
        throw new MeetingError('MINUTES_TOO_LARGE', '纪要原文超过 2 MiB 上限，未保存。', 413, {
          limitBytes: MAX_MINUTE_BYTES,
        });
      if (text.length > MAX_MINUTE_CHARS)
        throw new MeetingError('MINUTES_TOO_LARGE', '纪要正文超过 500000 字符上限，未保存。', 413, {
          limitCharacters: MAX_MINUTE_CHARS,
        });
      if (!text.length || !text.trim() || text.includes('\0') || !validUnicodeText(text))
        throw new MeetingError('INVALID_MINUTES', '纪要正文不能为空、不能全为空白或包含不支持的字符。', 400, {
          field: 'text',
        });
      if (source.confirmReimport !== undefined && typeof source.confirmReimport !== 'boolean')
        throw new MeetingError('INVALID_FIELD', 'confirmReimport 必须是布尔值。', 400, { field: 'confirmReimport' });
      const filename = source.original_filename === undefined ? null : source.original_filename;
      if (
        filename !== null &&
        (typeof filename !== 'string' ||
          !filename ||
          filename.length > 255 ||
          /[\\/\u0000-\u001f\u007f]/.test(filename) ||
          !/\.(md|txt|docx|pdf)$/i.test(filename))
      )
        throw new MeetingError('INVALID_FILENAME', '文件名无效或格式不支持。', 415, { field: 'file' });
      if (
        filename !== null &&
        source.file_sha256 !== undefined &&
        (typeof source.file_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.file_sha256))
      )
        throw new MeetingError('INVALID_FILE_DIGEST', '上传文件摘要格式无效。');
      if (filename === null && source.file_sha256 !== undefined)
        throw new MeetingError('INVALID_FILE_DIGEST', '粘贴纪要不接受上传文件摘要。');
      const textSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      if (
        filename !== null &&
        source.file_base64 === undefined &&
        source.file_sha256 !== undefined &&
        source.file_sha256 !== textSha256
      )
        throw new MeetingError('INVALID_FILE_DIGEST', '上传文件字节摘要与原文不一致。');
      const fileSha = filename === null ? null : source.file_sha256;
      const inputSha256 = digest({ text, original_filename: filename, file_sha256: fileSha });
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const ledger = current.minute_requests ?? [];
      const priorRequest = ledger.find((item) => item.requestId === requestId);
      if (priorRequest) {
        if (priorRequest.inputSha256 !== inputSha256)
          throw new MeetingError('IDEMPOTENCY_CONFLICT', 'requestId 已用于不同的纪要内容。', 409);
        if (priorRequest.deleted)
          throw new MeetingError('MINUTES_REQUEST_DELETED', '该纪要请求对应的本地副本已删除，旧请求不会恢复它。', 409);
        const imported = current.imports.find((item) => item.import_id === priorRequest.importId);
        if (!imported) throw new MeetingError('CORRUPT_MEETING', '纪要幂等记录与版本不一致，原文件已保留。', 409);
        return { meeting: cleanClone(current), imported: cleanClone(imported), reused: true };
      }
      if ((source.baseRevision as number) !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请刷新后重试。', 409, {
          currentRevision: current.revision,
        });
      const allowedNow =
        current.storage_mode === 'local_archive' &&
        current.confidentiality !== 'Restricted' &&
        (current.confidentiality === 'Public' || current.local_storage_authorized);
      if (!allowedNow)
        throw new MeetingError(
          'MINUTES_NOT_AUTHORIZED',
          current.confidentiality === 'Restricted'
            ? 'Restricted 会议禁止保存本地正文。'
            : '当前会议策略不允许导入纪要。',
          403,
        );
      if (current.imports.length >= 1000)
        throw new MeetingError('MINUTES_VERSION_LIMIT', '会议纪要版本已达到 1000 个上限，请先删除本地纪要。', 413, {
          limit: 1000,
        });
      if (ledger.length >= 10000)
        throw new MeetingError('MINUTES_REQUEST_LIMIT', '会议纪要请求记录已达到上限，暂不能继续导入。', 413, {
          limit: 10000,
        });
      if (current.imports.length && source.confirmReimport !== true)
        throw new MeetingError(
          'REIMPORT_CONFIRMATION_REQUIRED',
          '已有纪要版本；确认后才会新增版本并切换工作副本。',
          409,
          { versionCount: current.imports.length },
        );
      const now = new Date().toISOString();
      const imported: MeetingMinuteVersion = {
        import_id: randomUUID(),
        imported_at: now,
        imported_minutes: text,
        editable_minutes: text,
        original_filename: filename,
        original_sha256: textSha256,
        ...(source.file_base64 !== undefined
          ? {
              file_base64: source.file_base64 as string,
              file_format: source.file_format as MeetingMinuteVersion['file_format'],
            }
          : {}),
        ...(filename !== null && source.file_sha256 !== undefined ? { file_sha256: source.file_sha256 as string } : {}),
      };
      const next: Meeting = {
        ...current,
        imports: [...current.imports, imported],
        active_import_id: imported.import_id,
        raw_source_id:
          current.raw_links.find((item) => item.status === 'linked' && item.import_id === imported.import_id)?.raw_id ??
          null,
        minute_requests: [...ledger, { requestId, inputSha256, importId: imported.import_id, deleted: false }],
        revision: current.revision + 1,
        updated_at: now,
      };
      await this.save(next);
      return { meeting: cleanClone(next), imported: cleanClone(imported), reused: false };
    });
  }
  async updateEditableMinutes(id: unknown, importIdValue: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(async () => {
      const source =
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      if (!exactKeys(source, ['baseRevision', 'editable_minutes']))
        throw new MeetingError('INVALID_BODY', '工作副本请求只接受 baseRevision 和 editable_minutes。');
      if (!Number.isSafeInteger(source.baseRevision) || (source.baseRevision as number) < 1)
        throw new MeetingError('INVALID_REVISION', 'baseRevision 必须是大于 0 的整数。', 400, {
          field: 'baseRevision',
        });
      const importId = requireUuid(importIdValue, 'import_id');
      if (typeof source.editable_minutes === 'string' && source.editable_minutes.length > MAX_MINUTE_CHARS)
        throw new MeetingError('MINUTES_TOO_LARGE', '工作副本超过 500000 字符上限，未保存。', 413, {
          limitCharacters: MAX_MINUTE_CHARS,
        });
      if (
        typeof source.editable_minutes !== 'string' ||
        !source.editable_minutes.length ||
        !source.editable_minutes.trim() ||
        source.editable_minutes.includes('\0') ||
        !validUnicodeText(source.editable_minutes)
      )
        throw new MeetingError('INVALID_MINUTES', '工作副本不能为空、不能全为空白或包含不支持的字符。', 400, {
          field: 'editable_minutes',
        });
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      if (source.baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请重载后检查。', 409, {
          currentRevision: current.revision,
        });
      if (current.active_import_id !== importId)
        throw new MeetingError('MINUTES_VERSION_READ_ONLY', '只有当前纪要版本的工作副本可以编辑。', 409, {
          currentImportId: current.active_import_id,
        });
      const now = new Date().toISOString();
      const next: Meeting = {
        ...current,
        imports: current.imports.map((item) =>
          item.import_id === importId ? { ...item, editable_minutes: source.editable_minutes as string } : item,
        ),
        revision: current.revision + 1,
        updated_at: now,
      };
      await this.save(next);
      return cleanClone(next);
    });
  }
  async clearMinutes(id: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(async () => {
      const source =
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      if (!exactKeys(source, ['baseRevision', 'confirm']) || source.confirm !== true)
        throw new MeetingError('CONFIRMATION_REQUIRED', '清除全部本地纪要前必须明确确认。', 403, {
          required: ['baseRevision', 'confirm'],
        });
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      if (!Number.isSafeInteger(source.baseRevision) || source.baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请重新确认删除。', 409, {
          currentRevision: current.revision,
        });
      const removedIds = new Set(current.imports.map((item) => item.import_id));
      const next: Meeting = {
        ...current,
        imports: [],
        active_import_id: null,
        raw_source_id: null,
        minute_requests: (current.minute_requests ?? []).map((item) =>
          removedIds.has(item.importId) ? { ...item, deleted: true } : item,
        ),
        revision: current.revision + 1,
        updated_at: new Date().toISOString(),
      };
      await this.save(next);
      return cleanClone(next);
    });
  }
  async beginRawRegistration(
    id: unknown,
    value: unknown,
  ): Promise<{ meeting: Meeting; link: MeetingRawLink; imported: MeetingMinuteVersion; reused: boolean }> {
    return this.serialized(async () => {
      const source =
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      if (!exactKeys(source, ['baseRevision', 'requestId', 'import_id', 'confirm']))
        throw new MeetingError('INVALID_BODY', 'Raw登记请求字段不符合要求。');
      const requestId = requireUuid(source.requestId, 'requestId');
      const importId = requireUuid(source.import_id, 'import_id');
      if (source.confirm !== true)
        throw new MeetingError('CONFIRMATION_REQUIRED', '登记Raw前必须明确确认。', 403, { required: 'confirm' });
      if (!Number.isSafeInteger(source.baseRevision) || (source.baseRevision as number) < 1)
        throw new MeetingError('INVALID_REVISION', 'baseRevision必须是大于0的整数。', 400, { field: 'baseRevision' });
      const baseRevision = source.baseRevision as number;
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const fingerprint = linkFingerprint({ baseRevision, import_id: importId, confirm: true });
      const prior = current.raw_links.find((item) => item.request_id === requestId);
      if (prior) {
        // Version 2 stores the stable business fingerprint. Versionless v1 receipts hashed a
        // baseRevision that was never persisted; retry compatibility is therefore based on the
        // durable requestId/importId receipt fields, with confirm:true checked above. Do not guess
        // the original revision or scan an arbitrary range. Unknown versions fail schema validation.
        const modernFingerprintMatches =
          prior.request_fingerprint_version === 2 && prior.request_fingerprint === fingerprint;
        const legacyReceiptMatches =
          prior.request_fingerprint_version === undefined &&
          prior.import_id === importId &&
          /^[0-9a-f]{64}$/.test(prior.request_fingerprint);
        if (prior.import_id !== importId || (!modernFingerprintMatches && !legacyReceiptMatches))
          throw new MeetingError('IDEMPOTENCY_CONFLICT', 'requestId已用于不同的Raw登记请求。', 409, {
            request_id: requestId,
          });
        if (prior.status === 'unlinked' || prior.status === 'raw_deleted')
          throw new MeetingError('RAW_LINK_NOT_ACTIVE', '该登记请求的展示关联已解除或Raw已删除，不会自动恢复。', 409, {
            status: prior.status,
          });
        const allowedNow =
          current.storage_mode === 'local_archive' &&
          (current.confidentiality === 'Public' || current.confidentiality === 'Internal') &&
          current.raw_transfer_authorized;
        if (!allowedNow) throw new MeetingError('RAW_NOT_AUTHORIZED', '当前会议策略不允许恢复该Raw登记。', 403);
        const imported = current.imports.find((item) => item.import_id === prior.import_id);
        if (!imported || imported.original_sha256 !== prior.original_sha256)
          throw new MeetingError('CORRUPT_MEETING', 'Raw登记请求引用的纪要版本无效。', 409);
        return { meeting: cleanClone(current), link: cleanClone(prior), imported: cleanClone(imported), reused: true };
      }
      if (baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请刷新后重新确认登记。', 409, {
          currentRevision: current.revision,
        });
      const allowed =
        current.storage_mode === 'local_archive' &&
        (current.confidentiality === 'Public' || current.confidentiality === 'Internal') &&
        current.raw_transfer_authorized;
      if (!allowed) throw new MeetingError('RAW_NOT_AUTHORIZED', '当前会议策略不允许登记Raw。', 403);
      const imported = current.imports.find((item) => item.import_id === importId);
      if (!imported) throw new MeetingError('NOT_FOUND', '没有找到选定的纪要原件版本。', 404);
      if (current.raw_links.some((item) => item.import_id === importId && ['pending', 'linked'].includes(item.status)))
        throw new MeetingError('RAW_IMPORT_ALREADY_REGISTERED', '该纪要原件已有登记请求或有效Raw。', 409);
      const now = new Date().toISOString();
      const link: MeetingRawLink = {
        request_id: requestId,
        import_id: importId,
        raw_id: randomUUID(),
        original_sha256: imported.original_sha256,
        created_at: now,
        status: 'pending',
        request_fingerprint: fingerprint,
        request_fingerprint_version: 2,
        raw_title: `${current.title.slice(0, 195)} 原始纪要`,
        source_name: current.title,
        tags: [...current.tags],
      };
      const next: Meeting = {
        ...current,
        raw_links: [...current.raw_links, link],
        revision: current.revision + 1,
        updated_at: now,
      };
      await this.save(next);
      return { meeting: cleanClone(next), link: cleanClone(link), imported: cleanClone(imported), reused: false };
    });
  }

  async settleRawRegistration(
    id: unknown,
    requestId: unknown,
    writeRaw: (args: {
      meeting: Meeting;
      link: MeetingRawLink;
      imported: MeetingMinuteVersion;
    }) => Promise<{ record: RawRecord; created: boolean }>,
  ): Promise<{ meeting: Meeting; link: MeetingRawLink; raw: RawRecord; created: boolean }> {
    return this.serialized(async () => {
      const request = requireUuid(requestId, 'requestId');
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const index = current.raw_links.findIndex((item) => item.request_id === request);
      if (index < 0) throw new MeetingError('NOT_FOUND', '没有找到Raw登记请求。', 404);
      const link = current.raw_links[index]!;
      if (link.status === 'linked') {
        const imported = current.imports.find((item) => item.import_id === link.import_id);
        if (!imported) throw new MeetingError('CORRUPT_MEETING', '已关联Raw的纪要原件版本缺失。', 409);
        const result = await writeRaw({ meeting: current, link, imported });
        return { meeting: cleanClone(current), link: cleanClone(link), raw: result.record, created: result.created };
      }
      if (link.status !== 'pending' && link.status !== 'failed')
        throw new MeetingError('RAW_LINK_NOT_ACTIVE', '该Raw登记请求已结束。', 409, { status: link.status });
      const imported = current.imports.find((item) => item.import_id === link.import_id);
      if (!imported || imported.original_sha256 !== link.original_sha256)
        throw new MeetingError('CORRUPT_MEETING', 'Raw登记请求与纪要原件摘要不一致。', 409);
      let created: boolean;
      let raw: RawRecord;
      try {
        const result = await writeRaw({ meeting: current, link, imported });
        raw = result.record;
        created = result.created;
      } catch (error) {
        const code = error instanceof MeetingError ? error.code : (error as { code?: string })?.code;
        const stable =
          typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,99}$/.test(code) ? code : 'RAW_REGISTRATION_FAILED';
        const failed: MeetingRawLink = {
          ...link,
          status: 'failed',
          error: { code: stable, at: new Date().toISOString() },
        };
        const links = [...current.raw_links];
        links[index] = failed;
        await this.save({ ...current, raw_links: links, updated_at: failed.error!.at });
        throw error;
      }
      if (
        raw.origin?.meeting_id !== current.meeting_id ||
        raw.origin?.import_id !== imported.import_id ||
        raw.body !== imported.imported_minutes ||
        raw.bodySha256 !== imported.original_sha256
      )
        throw new MeetingError('RAW_INTEGRITY_ERROR', 'Raw写入后校验失败，登记未标记完成。', 409);
      const now = new Date().toISOString();
      const linked: MeetingRawLink = { ...link, status: 'linked', registered_at: now, error: undefined };
      const links = [...current.raw_links];
      links[index] = linked;
      const next: Meeting = {
        ...current,
        raw_links: links,
        raw_source_id: link.import_id === current.active_import_id ? link.raw_id : current.raw_source_id,
        revision: current.revision + 1,
        updated_at: now,
      };
      await this.save(next);
      return { meeting: cleanClone(next), link: cleanClone(linked), raw, created };
    });
  }

  async unlinkRaw(id: unknown, rawIdValue: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(async () => {
      const source =
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      if (!exactKeys(source, ['baseRevision', 'confirm']) || source.confirm !== true)
        throw new MeetingError('CONFIRMATION_REQUIRED', '解除Raw展示关联前必须明确确认。', 403, {
          required: 'confirm',
        });
      const rawId = requireUuid(rawIdValue, 'rawId');
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      if (!Number.isSafeInteger(source.baseRevision) || source.baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请重新确认解除关联。', 409, {
          currentRevision: current.revision,
        });
      const index = current.raw_links.findIndex((item) => item.raw_id === rawId && item.status === 'linked');
      if (index < 0) throw new MeetingError('NOT_FOUND', '没有找到可解除的Raw展示关联。', 404);
      const now = new Date().toISOString();
      const links = [...current.raw_links];
      links[index] = { ...links[index]!, status: 'unlinked' };
      const next: Meeting = {
        ...current,
        raw_links: links,
        raw_source_id:
          links.find((item) => item.status === 'linked' && item.import_id === current.active_import_id)?.raw_id ?? null,
        revision: current.revision + 1,
        updated_at: now,
      };
      await this.save(next);
      return cleanClone(next);
    });
  }

  async markRawDeleted(rawIdValue: unknown): Promise<void> {
    await this.serialized(async () => {
      const rawId = requireUuid(rawIdValue, 'rawId');
      for (const current of await this.all()) {
        if (
          !current.raw_links.some(
            (item) => item.raw_id === rawId && ['pending', 'failed', 'linked', 'unlinked'].includes(item.status),
          )
        )
          continue;
        const links = current.raw_links.map((item) =>
          item.raw_id === rawId && ['pending', 'failed', 'linked', 'unlinked'].includes(item.status)
            ? { ...item, status: 'raw_deleted' as const, error: undefined }
            : item,
        );
        const next: Meeting = {
          ...current,
          raw_links: links,
          raw_source_id:
            links.find((item) => item.status === 'linked' && item.import_id === current.active_import_id)?.raw_id ??
            null,
          revision: current.revision + 1,
          updated_at: new Date().toISOString(),
        };
        await this.save(next);
      }
    });
  }
  private async changePolicy(current: Meeting, input: PolicyInput): Promise<Meeting> {
    const nextConf = input.confidentiality ?? current.confidentiality;
    const nextMode = input.storage_mode ?? current.storage_mode;
    if (CONFIDENTIALITY.indexOf(nextConf) < CONFIDENTIALITY.indexOf(current.confidentiality))
      throw new MeetingError('CONFIDENTIALITY_DOWNGRADE_FORBIDDEN', '本版不支持降低会议保密等级。', 403);
    const raisesRestricted = nextConf === 'Restricted' && current.confidentiality !== 'Restricted';
    const localAuth = input.local_storage_authorized ?? current.local_storage_authorized;
    const rawAuth = input.raw_transfer_authorized ?? current.raw_transfer_authorized;
    const hasLocalCopy = current.imports.length > 0 || current.active_import_id !== null;
    const materialLinks = current.raw_links.filter((item) => item.status !== 'raw_deleted');
    const hasRawLink = materialLinks.length > 0 || current.raw_source_id !== null;
    if (
      hasLocalCopy &&
      (raisesRestricted ||
        (nextMode === 'cloud_index' && current.storage_mode !== 'cloud_index') ||
        (!localAuth && current.local_storage_authorized))
    ) {
      throw new MeetingError(
        'LOCAL_COPIES_PENDING',
        '存在本地纪要副本，需先明确删除后才能调整存储模式或撤销本地授权。',
        409,
        { localCopies: current.imports.length },
      );
    }
    if (raisesRestricted && hasRawLink)
      throw new MeetingError('LOCAL_COPIES_PENDING', '存在 Raw 来源，需先处理后才能升级为 Restricted。', 409, {
        localCopies: current.imports.length,
        rawLinks: materialLinks.length,
      });
    if (
      current.confidentiality === 'Restricted' &&
      (nextMode === 'local_archive' ||
        input.local_storage_authorized === true ||
        input.raw_transfer_authorized === true)
    )
      throw new MeetingError('POLICY_FORBIDDEN', 'Restricted 会议不能启用本地正文或 Raw 授权。', 403);
    const raiseWhileLocal =
      current.confidentiality !== nextConf &&
      (nextConf === 'Internal' || nextConf === 'Sensitive') &&
      nextMode === 'local_archive';
    if (raiseWhileLocal && (input.confirm_local_storage !== true || input.local_storage_authorized !== true))
      throw new MeetingError(
        'CONFIRMATION_REQUIRED',
        '提高到 Internal 或 Sensitive 且保留本地归档时，必须本次独立确认并授权本地保存。',
        403,
        { required: ['confirm_local_storage', 'local_storage_authorized'] },
      );
    if (nextConf === 'Restricted' && current.confidentiality !== 'Restricted') {
      const hasData = !!(
        current.tags.length ||
        current.customer ||
        current.project ||
        current.description ||
        current.recording_url ||
        current.minutes_url
      );
      if (hasData && input.confirm_restricted_metadata_clear !== true)
        throw new MeetingError('CONFIRMATION_REQUIRED', '转换为 Restricted 前必须确认清空不允许的元数据。', 409, {
          metadata_to_clear: ['tags', 'customer', 'project', 'description', 'recording_url', 'minutes_url'].filter(
            (k) => {
              const v = current[k as keyof Meeting];
              return Array.isArray(v) ? v.length > 0 : !!v;
            },
          ),
          localCopies: current.imports.length,
        });
    }
    if (
      input.local_storage_authorized === true &&
      !current.local_storage_authorized &&
      (nextConf === 'Internal' || nextConf === 'Sensitive') &&
      input.confirm_local_storage !== true
    )
      throw new MeetingError(
        'CONFIRMATION_REQUIRED',
        'Internal 或 Sensitive 会议授予本地保存权限前必须独立确认。',
        403,
        { required: 'confirm_local_storage' },
      );
    if (
      input.storage_mode === 'local_archive' &&
      current.storage_mode !== 'local_archive' &&
      (nextConf === 'Internal' || nextConf === 'Sensitive') &&
      (input.confirm_local_storage !== true || input.local_storage_authorized !== true)
    )
      throw new MeetingError(
        'CONFIRMATION_REQUIRED',
        'Internal 或 Sensitive 会议启用本地保存前必须本次独立确认并授权。',
        403,
        { required: ['confirm_local_storage', 'local_storage_authorized'] },
      );
    if (nextMode === 'local_archive' && (nextConf === 'Internal' || nextConf === 'Sensitive') && !localAuth)
      throw new MeetingError(
        'POLICY_FORBIDDEN',
        'Internal 或 Sensitive 会议必须先获本地保存授权才能使用 local_archive。',
        403,
      );
    if (
      current.storage_mode === 'local_archive' &&
      current.local_storage_authorized &&
      input.local_storage_authorized === false &&
      input.storage_mode !== 'cloud_index'
    )
      throw new MeetingError('POLICY_FORBIDDEN', '撤销本地保存授权必须在同一请求显式切换至 cloud_index。', 403);
    if (input.raw_transfer_authorized === true && (nextConf === 'Sensitive' || nextConf === 'Restricted'))
      throw new MeetingError('POLICY_FORBIDDEN', '仅 Public 或 Internal 会议允许登记 Raw 授权。', 403);
    if (input.raw_transfer_authorized === true && nextMode !== 'local_archive')
      throw new MeetingError('POLICY_FORBIDDEN', 'Raw 授权只允许用于 local_archive 模式。', 403);
    if (input.raw_transfer_authorized === true && input.confirm_raw_transfer !== true)
      throw new MeetingError('CONFIRMATION_REQUIRED', 'Raw 授权需要独立确认。', 403, {
        required: 'confirm_raw_transfer',
      });
    if ((nextConf === 'Restricted' || !rawAuth || nextMode === 'cloud_index') && hasRawLink)
      throw new MeetingError('RAW_LINKS_PENDING', '存在 Raw 关联，需先处理后才能升级或撤销授权。', 409, {
        rawLinks: materialLinks.length,
      });
    const clearRestricted = raisesRestricted;
    const now = new Date().toISOString();
    const next: Meeting = {
      ...current,
      confidentiality: nextConf,
      storage_mode: raisesRestricted ? 'cloud_index' : nextMode,
      local_storage_authorized: raisesRestricted ? false : localAuth,
      raw_transfer_authorized:
        current.confidentiality !== nextConf || raisesRestricted || nextMode === 'cloud_index' ? false : rawAuth,
      ...(clearRestricted
        ? { tags: [], customer: null, project: null, description: null, recording_url: null, minutes_url: null }
        : {}),
      revision: current.revision + 1,
      updated_at: now,
      policy_updated_at: now,
    };
    await this.save(next);
    return cleanClone(next);
  }
  async delete(id: unknown, value: unknown): Promise<{ meeting_id: string }> {
    return this.serialized(async () => {
      const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      if (
        Object.keys(source).some(
          (k) => !['baseRevision', 'confirm', 'confirmLocalMinutes', 'confirmRawReferences'].includes(k),
        )
      )
        throw new MeetingError('UNKNOWN_FIELD', '删除请求包含不支持的字段。');
      if (source.confirm !== true)
        throw new MeetingError('CONFIRMATION_REQUIRED', '删除会议前必须明确确认。', 403, { required: 'confirm' });
      const current = await this.read(id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const baseRevision = source.baseRevision;
      if (!Number.isSafeInteger(baseRevision) || baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请刷新后重新确认删除。', 409, {
          currentRevision: current.revision,
        });
      if (current.imports.length && source.confirmLocalMinutes !== true)
        throw new MeetingError(
          'MEETING_HAS_LOCAL_MINUTES',
          '会议含有本地纪要原件与工作副本；需额外确认一并删除。',
          409,
          { localCopies: current.imports.length, required: 'confirmLocalMinutes' },
        );
      if (source.confirmLocalMinutes !== undefined && typeof source.confirmLocalMinutes !== 'boolean')
        throw new MeetingError('INVALID_FIELD', 'confirmLocalMinutes 必须是布尔值。', 400, {
          field: 'confirmLocalMinutes',
        });
      const retainedRawLinks = current.raw_links.filter((item) => item.status !== 'raw_deleted');
      if ((retainedRawLinks.length || current.raw_source_id) && source.confirmRawReferences !== true)
        throw new MeetingError(
          'MEETING_HAS_REFERENCES',
          '存在Raw来源；删除会议不会删除或解除Raw限制，需要单独确认保留。',
          409,
          { rawLinks: retainedRawLinks.length, required: 'confirmRawReferences' },
        );
      if (source.confirmRawReferences !== undefined && typeof source.confirmRawReferences !== 'boolean')
        throw new MeetingError('INVALID_FIELD', 'confirmRawReferences必须是布尔值。', 400, {
          field: 'confirmRawReferences',
        });
      const file = path.join(this.records, `${current.meeting_id}.json`);
      try {
        await unlink(file);
      } catch {
        throw new MeetingError('MEETING_DELETE_FAILED', '会议记录删除失败。', 500, { meeting_id: current.meeting_id });
      }
      return { meeting_id: current.meeting_id };
    });
  }
  async mutateCatalog(value: unknown, kind: 'types' | 'tags', id?: unknown): Promise<MeetingCatalog> {
    return this.serialized(async () => {
      const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const allowed = id === undefined ? ['baseRevision', 'name'] : ['baseRevision', 'name', 'active'];
      if (Object.keys(source).some((k) => !allowed.includes(k)))
        throw new MeetingError('UNKNOWN_FIELD', '目录请求包含不支持的字段。');
      const catalog = await this.catalog();
      if (!Number.isSafeInteger(source.baseRevision) || source.baseRevision !== catalog.revision)
        throw new MeetingError('REVISION_CONFLICT', '目录已有更新，请刷新后重试。', 409, {
          currentRevision: catalog.revision,
        });
      const list = [...catalog[kind]];
      if (id === undefined) {
        const name = catalogName(source.name);
        if (
          list.some(
            (entry) =>
              entry.name.normalize('NFKC').toLocaleLowerCase('zh-CN') ===
              name.normalize('NFKC').toLocaleLowerCase('zh-CN'),
          )
        )
          throw new MeetingError('DUPLICATE_NAME', '目录名称已存在。', 409);
        if (list.length >= 500) throw new MeetingError('CATALOG_TOO_LARGE', '目录项数量已达到 500 项上限。', 422);
        list.push({ id: randomUUID(), name, active: true });
      } else {
        const entryId = requireUuid(id, 'id');
        const index = list.findIndex((entry) => entry.id === entryId);
        if (index < 0) throw new MeetingError('NOT_FOUND', '没有找到目录项。', 404);
        const current = list[index];
        let name = current.name;
        let active = current.active;
        if ('name' in source) {
          name = catalogName(source.name);
          if (
            list.some(
              (entry) =>
                entry.id !== entryId &&
                entry.name.normalize('NFKC').toLocaleLowerCase('zh-CN') ===
                  name.normalize('NFKC').toLocaleLowerCase('zh-CN'),
            )
          )
            throw new MeetingError('DUPLICATE_NAME', '目录名称已存在。', 409);
        }
        if ('active' in source) {
          if (typeof source.active !== 'boolean') throw new MeetingError('INVALID_FIELD', 'active 必须是布尔值。');
          active = source.active;
        }
        list[index] = { ...current, name, active };
      }
      const next = { ...catalog, [kind]: list, revision: catalog.revision + 1 };
      await this.writeCatalog(next);
      return cleanClone(next);
    });
  }
  private async writeCatalog(catalog: MeetingCatalog): Promise<void> {
    try {
      await writeJsonAtomic(this.catalogFile, catalog);
    } catch {
      throw new MeetingError('MEETING_WRITE_FAILED', '会议目录保存失败，原有内容保持不变。', 500);
    }
  }
  private validateSelection(
    catalog: MeetingCatalog,
    typeId: string,
    tagIds: string[],
    preserveReferenced: boolean,
    current?: Meeting,
    explicitlySelectedType = false,
    explicitlySelectedTags = false,
  ): void {
    const type = catalog.types.find((x) => x.id === typeId);
    if (!type || (!type.active && !(preserveReferenced && !explicitlySelectedType && current?.meeting_type === typeId)))
      throw new MeetingError('INVALID_MEETING_TYPE', '会议类型不存在或已停用。', 422, { meeting_type: typeId });
    for (const id of tagIds) {
      const tag = catalog.tags.find((x) => x.id === id);
      if (!tag || (!tag.active && !(preserveReferenced && !explicitlySelectedTags && current?.tags.includes(id))))
        throw new MeetingError('INVALID_MEETING_TAG', '标签不存在或已停用。', 422, { tag_id: id });
    }
  }
}
