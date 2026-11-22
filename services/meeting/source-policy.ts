import type { RawRecord } from '../raw/store.ts';
import { CONFIDENTIALITY, type Confidentiality } from './types.ts';
import { UUID_PATTERN } from './policy.ts';

export type RawMeetingOrigin = {
  kind: 'meeting';
  meeting_id: string;
  import_id: string;
  original_sha256: string;
  registered_confidentiality: Confidentiality;
  processing_policy: 'meeting_local_only';
};

export class SourcePolicyError extends Error {
  readonly code = 'MEETING_SOURCE_RESTRICTED';
  constructor(
    message: string,
    public status = 403,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'SourcePolicyError';
  }
}

function exactOrigin(value: unknown): value is RawMeetingOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).length === 6 &&
    item.kind === 'meeting' &&
    typeof item.meeting_id === 'string' &&
    UUID_PATTERN.test(item.meeting_id) &&
    typeof item.import_id === 'string' &&
    UUID_PATTERN.test(item.import_id) &&
    typeof item.original_sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(item.original_sha256) &&
    CONFIDENTIALITY.includes(item.registered_confidentiality as Confidentiality) &&
    item.processing_policy === 'meeting_local_only'
  );
}

export function meetingOrigin(record: unknown): RawMeetingOrigin | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const origin = (record as { origin?: unknown }).origin;
  if (origin === undefined) return null;
  return exactOrigin(origin) ? origin : null;
}

export function isMeetingRestricted(record: unknown): boolean {
  return meetingOrigin(record) !== null;
}

/** Missing origin is legacy-compatible; present but malformed origin is always denied. */
export function assertRawNotMeeting(record: unknown): void {
  if (!record) throw new SourcePolicyError('来源记录不存在或不可读取，已拒绝处理。', 409);
  const rawOrigin = (record as { origin?: unknown }).origin;
  if (rawOrigin !== undefined && meetingOrigin(record) === null) {
    throw new SourcePolicyError('会议来源标识无效，已拒绝AI处理。');
  }
  if (isMeetingRestricted(record)) {
    throw new SourcePolicyError('Meeting Raw 仅允许本机保存，不能进入AI处理。');
  }
}

export function assertRawsNotMeeting(records: Array<RawRecord | undefined | null>): void {
  for (const record of records) assertRawNotMeeting(record);
}
