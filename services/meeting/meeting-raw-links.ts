import { randomUUID } from 'node:crypto';
import { cleanClone, exactKeys, linkFingerprint } from './meeting-validators.ts';
import {
  readMeetingRecord,
  readAllMeetingRecords,
  saveMeetingRecord,
  type MeetingStorePaths,
} from './meeting-catalog.ts';
import { MeetingError } from './errors.ts';
import { requireUuid } from './policy.ts';
import type { Meeting, MeetingRawLink, MeetingMinuteVersion } from './types.ts';
import type { RawRecord } from '../raw/store.ts';

export async function beginMeetingRawRegistration(
  paths: MeetingStorePaths,
  id: unknown,
  value: unknown,
): Promise<{ meeting: Meeting; link: MeetingRawLink; imported: MeetingMinuteVersion; reused: boolean }> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  if (!exactKeys(source, ['baseRevision', 'requestId', 'import_id', 'confirm']))
    throw new MeetingError('INVALID_BODY', 'Raw登记请求字段不符合要求。');
  const requestId = requireUuid(source.requestId, 'requestId');
  const importId = requireUuid(source.import_id, 'import_id');
  if (source.confirm !== true)
    throw new MeetingError('CONFIRMATION_REQUIRED', '登记Raw前必须明确确认。', 403, { required: 'confirm' });
  if (!Number.isSafeInteger(source.baseRevision) || (source.baseRevision as number) < 1)
    throw new MeetingError('INVALID_REVISION', 'baseRevision必须是大于0的整数。', 400, { field: 'baseRevision' });
  const baseRevision = source.baseRevision as number;
  const current = await readMeetingRecord(paths, id);
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
  await saveMeetingRecord(paths, next);
  return { meeting: cleanClone(next), link: cleanClone(link), imported: cleanClone(imported), reused: false };
}

export async function settleMeetingRawRegistration(
  paths: MeetingStorePaths,
  id: unknown,
  requestId: unknown,
  writeRaw: (args: {
    meeting: Meeting;
    link: MeetingRawLink;
    imported: MeetingMinuteVersion;
  }) => Promise<{ record: RawRecord; created: boolean }>,
  save: (record: Meeting) => Promise<void>,
): Promise<{ meeting: Meeting; link: MeetingRawLink; raw: RawRecord; created: boolean }> {
  const request = requireUuid(requestId, 'requestId');
  const current = await readMeetingRecord(paths, id);
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
    const stable = typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,99}$/.test(code) ? code : 'RAW_REGISTRATION_FAILED';
    const failed: MeetingRawLink = {
      ...link,
      status: 'failed',
      error: { code: stable, at: new Date().toISOString() },
    };
    const links = [...current.raw_links];
    links[index] = failed;
    await save({ ...current, raw_links: links, updated_at: failed.error!.at });
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
  await save(next);
  return { meeting: cleanClone(next), link: cleanClone(linked), raw, created };
}

export async function unlinkMeetingRaw(
  paths: MeetingStorePaths,
  id: unknown,
  rawIdValue: unknown,
  value: unknown,
): Promise<Meeting> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  if (!exactKeys(source, ['baseRevision', 'confirm']) || source.confirm !== true)
    throw new MeetingError('CONFIRMATION_REQUIRED', '解除Raw展示关联前必须明确确认。', 403, {
      required: 'confirm',
    });
  const rawId = requireUuid(rawIdValue, 'rawId');
  const current = await readMeetingRecord(paths, id);
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
  await saveMeetingRecord(paths, next);
  return cleanClone(next);
}

export async function markMeetingRawDeleted(paths: MeetingStorePaths, rawIdValue: unknown): Promise<void> {
  const rawId = requireUuid(rawIdValue, 'rawId');
  for (const current of await readAllMeetingRecords(paths)) {
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
        links.find((item) => item.status === 'linked' && item.import_id === current.active_import_id)?.raw_id ?? null,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    };
    await saveMeetingRecord(paths, next);
  }
}
