import { createHash, randomUUID } from 'node:crypto';
import {
  cleanClone,
  digest,
  exactKeys,
  hasControlChar,
  MAX_MINUTE_BYTES,
  MAX_MINUTE_CHARS,
  validUnicodeText,
} from './meeting-validators.ts';
import { readMeetingRecord, saveMeetingRecord, type MeetingStorePaths } from './meeting-catalog.ts';
import { MeetingError } from './errors.ts';
import { requireUuid } from './policy.ts';
import type { Meeting, MeetingMinuteVersion } from './types.ts';

export async function importMeetingMinutes(
  paths: MeetingStorePaths,
  id: unknown,
  value: unknown,
): Promise<{ meeting: Meeting; imported: MeetingMinuteVersion; reused: boolean }> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
      /[\\/]/.test(filename) ||
      hasControlChar(filename) ||
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
  const current = await readMeetingRecord(paths, id);
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
      current.confidentiality === 'Restricted' ? 'Restricted 会议禁止保存本地正文。' : '当前会议策略不允许导入纪要。',
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
    throw new MeetingError('REIMPORT_CONFIRMATION_REQUIRED', '已有纪要版本；确认后才会新增版本并切换工作副本。', 409, {
      versionCount: current.imports.length,
    });
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
  await saveMeetingRecord(paths, next);
  return { meeting: cleanClone(next), imported: cleanClone(imported), reused: false };
}

export async function updateEditableMeetingMinutes(
  paths: MeetingStorePaths,
  id: unknown,
  importIdValue: unknown,
  value: unknown,
): Promise<Meeting> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
  const current = await readMeetingRecord(paths, id);
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
  await saveMeetingRecord(paths, next);
  return cleanClone(next);
}

export async function clearMeetingMinutes(paths: MeetingStorePaths, id: unknown, value: unknown): Promise<Meeting> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  if (!exactKeys(source, ['baseRevision', 'confirm']) || source.confirm !== true)
    throw new MeetingError('CONFIRMATION_REQUIRED', '清除全部本地纪要前必须明确确认。', 403, {
      required: ['baseRevision', 'confirm'],
    });
  const current = await readMeetingRecord(paths, id);
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
  await saveMeetingRecord(paths, next);
  return cleanClone(next);
}
