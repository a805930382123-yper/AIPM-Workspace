import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, writeJsonAtomic } from '../storage/files.ts';
import { MeetingError } from './errors.ts';
import { requireUuid, UUID_PATTERN } from './policy.ts';
import { DEFAULT_MEETING_TYPES, type Meeting, type MeetingCatalog } from './types.ts';
import { catalogName, cleanClone, MAX_MEETING_JSON_BYTES, validCatalog, validMeeting } from './meeting-validators.ts';
export type MeetingStorePaths = { root: string; base: string; records: string; catalogFile: string };

export async function ensureMeetingDirectory(paths: MeetingStorePaths, dir: string, create: boolean): Promise<void> {
  let info = await lstat(dir).catch((error) =>
    (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
  );
  if (!info && create) {
    await mkdir(dir, { recursive: dir === paths.root });
    info = await lstat(dir);
  }
  if (!info || info.isSymbolicLink() || !info.isDirectory())
    throw new MeetingError('MEETING_PATH_INVALID', '会议数据目录不是安全的本地目录。', 409);
}

export async function ensureMeetingPaths(paths: MeetingStorePaths, create: boolean): Promise<void> {
  await ensureMeetingDirectory(paths, paths.root, create);
  await ensureMeetingDirectory(paths, paths.base, create);
  await ensureMeetingDirectory(paths, paths.records, create);
}

export async function readOrInitMeetingCatalog(paths: MeetingStorePaths): Promise<MeetingCatalog> {
  await ensureMeetingPaths(paths, true);
  const info = await lstat(paths.catalogFile).catch((error) =>
    (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error),
  );
  if (info?.isSymbolicLink() || (info && !info.isFile()))
    throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议目录文件路径无效，原文件已保留。', 409);
  if (!info) {
    const existingFiles = await readdir(paths.records).catch(() => {
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
      await writeJsonAtomic(paths.catalogFile, catalog);
    } catch {
      throw new MeetingError('MEETING_WRITE_FAILED', '会议目录初始化失败。', 500);
    }
    return catalog;
  }
  let value: unknown;
  try {
    value = await readJsonFile<unknown>(paths.catalogFile);
  } catch {
    throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议目录文件损坏或不可读取，原文件已保留。', 409);
  }
  if (!validCatalog(value)) throw new MeetingError('CORRUPT_MEETING_CATALOG', '会议目录结构无效，原文件已保留。', 409);
  return value;
}

export async function writeMeetingCatalog(paths: MeetingStorePaths, catalog: MeetingCatalog): Promise<void> {
  try {
    await writeJsonAtomic(paths.catalogFile, catalog);
  } catch {
    throw new MeetingError('MEETING_WRITE_FAILED', '会议目录保存失败，原有内容保持不变。', 500);
  }
}

export async function mutateMeetingCatalog(
  paths: MeetingStorePaths,
  value: unknown,
  kind: 'types' | 'tags',
  id?: unknown,
): Promise<MeetingCatalog> {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const allowed = id === undefined ? ['baseRevision', 'name'] : ['baseRevision', 'name', 'active'];
  if (Object.keys(source).some((k) => !allowed.includes(k)))
    throw new MeetingError('UNKNOWN_FIELD', '目录请求包含不支持的字段。');
  const catalog = await readOrInitMeetingCatalog(paths);
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
          entry.name.normalize('NFKC').toLocaleLowerCase('zh-CN') === name.normalize('NFKC').toLocaleLowerCase('zh-CN'),
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
  await writeMeetingCatalog(paths, next);
  return cleanClone(next);
}

export function validateCatalogSelection(
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

export async function readMeetingRecord(paths: MeetingStorePaths, idValue: unknown): Promise<Meeting | undefined> {
  const id = requireUuid(idValue, 'meeting_id');
  await ensureMeetingPaths(paths, false);
  const file = path.join(paths.records, `${id}.json`);
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
  const catalog = await readOrInitMeetingCatalog(paths);
  if (
    !catalog.types.some((entry) => entry.id === value.meeting_type) ||
    value.tags.some((tag) => !catalog.tags.some((entry) => entry.id === tag))
  )
    throw new MeetingError('CORRUPT_MEETING', '会议记录引用了不存在的目录项，原文件已保留。', 409, {
      meeting_id: id,
    });
  return value;
}

export async function readAllMeetingRecords(paths: MeetingStorePaths): Promise<Meeting[]> {
  await ensureMeetingPaths(paths, false);
  let names: string[];
  try {
    names = await readdir(paths.records);
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
    const record = await readMeetingRecord(paths, id);
    if (!record) throw new MeetingError('CORRUPT_MEETING', '会议记录在读取期间消失，请重试。', 409, { meeting_id: id });
    result.push(record);
  }
  return result;
}

export async function saveMeetingRecord(paths: MeetingStorePaths, record: Meeting): Promise<void> {
  if (Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`, 'utf8') > MAX_MEETING_JSON_BYTES)
    throw new MeetingError(
      'MEETING_JSON_TOO_LARGE',
      '会议历史版本已达到单条记录上限，请先删除部分本地纪要版本。',
      413,
      { limitBytes: MAX_MEETING_JSON_BYTES },
    );
  const file = path.join(paths.records, `${record.meeting_id}.json`);
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
