import { randomUUID } from 'node:crypto';
import type { Meeting, MeetingMinuteVersion, MeetingRawLink } from './types.ts';
import { MeetingStore } from './store.ts';
import { MeetingError } from './errors.ts';
import type { MeetingRawRegistration, RawStore } from '../raw/store.ts';

/** Owns the two-file pending -> Raw -> linked handoff. The UI never supplies a Raw ID. */
export class MeetingRawBridge {
  constructor(
    private readonly meetings: MeetingStore,
    private readonly raws: RawStore,
  ) {}

  async register(
    meetingId: unknown,
    value: unknown,
  ): Promise<{ meeting: Meeting; link: MeetingRawLink; rawId: string; reused: boolean }> {
    const begun = await this.meetings.beginRawRegistration(meetingId, value);
    if (begun.link.status === 'linked') {
      let raw: Awaited<ReturnType<RawStore['get']>>;
      try {
        raw = await this.raws.get(begun.link.raw_id);
      } catch {
        throw new MeetingError('RAW_LINK_INTEGRITY_ERROR', '已关联 Raw 缺失或损坏，未复用该登记结果。', 409);
      }
      const origin = raw?.origin;
      const valid = Boolean(
        raw &&
        origin &&
        raw.id === begun.link.raw_id &&
        raw.sourceType === 'meeting' &&
        raw.title === begun.link.raw_title &&
        raw.sourceName === begun.link.source_name &&
        JSON.stringify(raw.tags ?? []) === JSON.stringify(begun.link.tags) &&
        raw.body === begun.imported.imported_minutes &&
        raw.bodySha256 === begun.link.original_sha256 &&
        origin.kind === 'meeting' &&
        origin.meeting_id === begun.meeting.meeting_id &&
        origin.import_id === begun.link.import_id &&
        origin.original_sha256 === begun.link.original_sha256 &&
        origin.registered_confidentiality === begun.meeting.confidentiality &&
        origin.processing_policy === 'meeting_local_only',
      );
      if (!valid)
        throw new MeetingError('RAW_LINK_INTEGRITY_ERROR', '已关联 Raw 与会议来源记录不一致，未复用该登记结果。', 409);
      return { meeting: begun.meeting, link: begun.link, rawId: begun.link.raw_id, reused: true };
    }
    const settled = await this.meetings.settleRawRegistration(
      meetingId,
      begun.link.request_id,
      async ({ meeting, link, imported }) => {
        const allowedNow =
          meeting.storage_mode === 'local_archive' &&
          (meeting.confidentiality === 'Public' || meeting.confidentiality === 'Internal') &&
          meeting.raw_transfer_authorized;
        if (!allowedNow)
          throw new MeetingError('RAW_REGISTRATION_NOT_AUTHORIZED', 'Raw登记发起后策略已变化，已停止补写。', 403);
        const existing = await this.raws.get(link.raw_id);
        const input = this.registrationInput(meeting, link, imported);
        if (existing) {
          const result = await this.raws.createMeetingRegistration({ ...input, id: link.raw_id });
          return { record: result.record, created: result.created };
        }
        return await this.raws.createMeetingRegistration({ ...input, id: link.raw_id });
      },
    );
    return { meeting: settled.meeting, link: settled.link, rawId: settled.raw.id, reused: !settled.created };
  }

  async unlink(meetingId: unknown, rawId: unknown, value: unknown): Promise<Meeting> {
    return await this.meetings.unlinkRaw(meetingId, rawId, value);
  }

  /** Used by the existing Raw deletion route after all Wiki/task protections have passed. */
  async deleteRaw(rawId: unknown): Promise<void> {
    await this.meetings.markRawDeleted(rawId);
  }

  /** Startup recovery only resumes a durable pending request; failed requests remain explicit retries. */
  async reconcile(): Promise<{ resumed: string[]; deleted: string[]; failed: string[] }> {
    const resumed: string[] = [];
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const meeting of await this.meetings.allDetailed()) {
      for (const link of meeting.raw_links) {
        if (['linked', 'unlinked'].includes(link.status) && !(await this.raws.get(link.raw_id))) {
          await this.meetings.markRawDeleted(link.raw_id);
          deleted.push(link.raw_id);
          continue;
        }
        if (link.status !== 'pending') continue;
        try {
          const settled = await this.meetings.settleRawRegistration(
            meeting.meeting_id,
            link.request_id,
            async ({ meeting: current, link: pending, imported }) => {
              const allowedNow =
                current.storage_mode === 'local_archive' &&
                (current.confidentiality === 'Public' || current.confidentiality === 'Internal') &&
                current.raw_transfer_authorized;
              if (!allowedNow)
                throw new MeetingError('RAW_REGISTRATION_NOT_AUTHORIZED', 'Raw登记发起后策略已变化，已停止补写。', 403);
              const existing = await this.raws.get(pending.raw_id);
              const input = this.registrationInput(current, pending, imported);
              if (existing) return await this.raws.createMeetingRegistration({ ...input, id: pending.raw_id });
              return await this.raws.createMeetingRegistration({ ...input, id: pending.raw_id });
            },
          );
          resumed.push(settled.raw.id);
        } catch {
          failed.push(link.raw_id);
        }
      }
    }
    return { resumed, deleted, failed };
  }

  private registrationInput(
    meeting: Meeting,
    link: MeetingRawLink,
    imported: MeetingMinuteVersion,
  ): MeetingRawRegistration {
    return {
      title: link.raw_title,
      sourceName: link.source_name,
      tags: [...link.tags],
      id: link.raw_id,
      body: imported.imported_minutes,
      importedAt: link.created_at,
      origin: {
        kind: 'meeting',
        meeting_id: meeting.meeting_id,
        import_id: imported.import_id,
        original_sha256: imported.original_sha256,
        registered_confidentiality: meeting.confidentiality,
        processing_policy: 'meeting_local_only',
      },
    };
  }
}

export function newRegistrationRequest(
  baseRevision: number,
  importId: string,
): { baseRevision: number; requestId: string; import_id: string; confirm: true } {
  return { baseRevision, requestId: randomUUID(), import_id: importId, confirm: true };
}
