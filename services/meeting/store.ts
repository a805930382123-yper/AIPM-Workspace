import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { SerialQueue } from '../storage/files.ts';
import { MeetingError } from './errors.ts';
import { normalizeCreate, normalizePatch, normalizePolicy } from './policy.ts';
import type { RawRecord } from '../raw/store.ts';
import type { Meeting, MeetingCatalog, MeetingRawLink, MeetingSummary, MeetingMinuteVersion } from './types.ts';
import { cleanClone, digest, toMeetingSummary } from './meeting-validators.ts';
import {
  readOrInitMeetingCatalog,
  readMeetingRecord,
  readAllMeetingRecords,
  saveMeetingRecord,
  validateCatalogSelection,
  mutateMeetingCatalog,
  type MeetingStorePaths,
} from './meeting-catalog.ts';
import { changeMeetingPolicy } from './meeting-policy.ts';
import { importMeetingMinutes, updateEditableMeetingMinutes, clearMeetingMinutes } from './meeting-minutes.ts';
import {
  beginMeetingRawRegistration,
  settleMeetingRawRegistration,
  unlinkMeetingRaw,
  markMeetingRawDeleted,
} from './meeting-raw-links.ts';

export class MeetingStore {
  private readonly queue = new SerialQueue();
  private readonly paths: MeetingStorePaths;
  constructor(public readonly root: string) {
    const base = path.join(root, 'meetings');
    this.paths = { root, base, records: path.join(base, 'records'), catalogFile: path.join(base, 'catalog.json') };
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private async save(record: Meeting): Promise<void> {
    await saveMeetingRecord(this.paths, record);
  }
  async initialize(): Promise<void> {
    await this.serialized(async () => {
      await readOrInitMeetingCatalog(this.paths);
    });
  }
  async getCatalog(): Promise<MeetingCatalog> {
    return cleanClone(await readOrInitMeetingCatalog(this.paths));
  }
  async get(id: unknown): Promise<Meeting | undefined> {
    return cleanClone(await readMeetingRecord(this.paths, id));
  }
  async allDetailed(): Promise<Meeting[]> {
    return cleanClone(await readAllMeetingRecords(this.paths));
  }
  async list(): Promise<MeetingSummary[]> {
    return (await readAllMeetingRecords(this.paths)).map(toMeetingSummary);
  }
  async create(value: unknown): Promise<{ meeting: Meeting; reused: boolean }> {
    return this.serialized(async () => {
      const { requestId, input } = normalizeCreate(value);
      const all = await readAllMeetingRecords(this.paths);
      const existing = all.find((record) => record.creation.requestId === requestId);
      if (existing) {
        if (existing.creation.inputSha256 !== digest(input))
          throw new MeetingError('IDEMPOTENCY_CONFLICT', 'requestId 已用于不同的会议内容。', 409, { requestId });
        return { meeting: cleanClone(existing), reused: true };
      }
      const catalog = await readOrInitMeetingCatalog(this.paths);
      validateCatalogSelection(catalog, input.meeting_type, input.tags, false);
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
      const current = await readMeetingRecord(this.paths, id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const { baseRevision, input } = normalizePatch(value, current);
      if (baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议记录已有更新，请刷新后重试。', 409, {
          currentRevision: current.revision,
        });
      const patch = value as Record<string, unknown>;
      const catalog = await readOrInitMeetingCatalog(this.paths);
      validateCatalogSelection(
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
      const current = await readMeetingRecord(this.paths, id);
      if (!current) throw new MeetingError('NOT_FOUND', '没有找到这条会议记录。', 404);
      const input = normalizePolicy(value);
      if (input.baseRevision !== current.revision)
        throw new MeetingError('REVISION_CONFLICT', '会议策略已有更新，请刷新后重试。', 409, {
          currentRevision: current.revision,
        });
      return changeMeetingPolicy(this.paths, current, input);
    });
  }
  async importMinutes(
    id: unknown,
    value: unknown,
  ): Promise<{ meeting: Meeting; imported: MeetingMinuteVersion; reused: boolean }> {
    return this.serialized(() => importMeetingMinutes(this.paths, id, value));
  }
  async updateEditableMinutes(id: unknown, importIdValue: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(() => updateEditableMeetingMinutes(this.paths, id, importIdValue, value));
  }
  async clearMinutes(id: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(() => clearMeetingMinutes(this.paths, id, value));
  }
  async beginRawRegistration(
    id: unknown,
    value: unknown,
  ): Promise<{ meeting: Meeting; link: MeetingRawLink; imported: MeetingMinuteVersion; reused: boolean }> {
    return this.serialized(() => beginMeetingRawRegistration(this.paths, id, value));
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
    return this.serialized(() =>
      settleMeetingRawRegistration(this.paths, id, requestId, writeRaw, (record) => this.save(record)),
    );
  }
  async unlinkRaw(id: unknown, rawIdValue: unknown, value: unknown): Promise<Meeting> {
    return this.serialized(() => unlinkMeetingRaw(this.paths, id, rawIdValue, value));
  }
  async markRawDeleted(rawIdValue: unknown): Promise<void> {
    return this.serialized(() => markMeetingRawDeleted(this.paths, rawIdValue));
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
      const current = await readMeetingRecord(this.paths, id);
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
      const file = path.join(this.paths.records, `${current.meeting_id}.json`);
      try {
        await unlink(file);
      } catch {
        throw new MeetingError('MEETING_DELETE_FAILED', '会议记录删除失败。', 500, { meeting_id: current.meeting_id });
      }
      return { meeting_id: current.meeting_id };
    });
  }
  async mutateCatalog(value: unknown, kind: 'types' | 'tags', id?: unknown): Promise<MeetingCatalog> {
    return this.serialized(() => mutateMeetingCatalog(this.paths, value, kind, id));
  }
}
