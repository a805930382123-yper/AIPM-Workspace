export const CONFIDENTIALITY = ['Public', 'Internal', 'Sensitive', 'Restricted'] as const;
export type Confidentiality = typeof CONFIDENTIALITY[number];
export const STORAGE_MODES = ['cloud_index', 'local_archive'] as const;
export type StorageMode = typeof STORAGE_MODES[number];

export type MeetingCatalogEntry = { id: string; name: string; active: boolean };
export type MeetingCatalog = { schema_version: 1; revision: number; types: MeetingCatalogEntry[]; tags: MeetingCatalogEntry[] };
export type MeetingCapabilities = {
  canImportMinutes: boolean; canRegisterRaw: boolean; canUseAi: false;
  importReason: string; rawReason: string; aiReason: string;
};
export type MeetingMinuteVersion = {
  import_id: string;
  imported_at: string;
  imported_minutes: string;
  editable_minutes: string;
  original_filename: string | null;
  original_sha256: string;
  file_sha256?: string;
};
export type MinuteRequest = { requestId: string; inputSha256: string; importId: string; deleted: boolean };
export type MeetingRawLinkError = { code: string; at: string };
export type MeetingRawLink = { request_id: string; import_id: string; raw_id: string; original_sha256: string; created_at: string; status: 'pending' | 'linked' | 'failed' | 'unlinked' | 'raw_deleted'; request_fingerprint: string; request_fingerprint_version?: 2; raw_title: string; source_name: string; tags: string[]; registered_at?: string; error?: MeetingRawLinkError };
export type Meeting = {
  schema_version: 1;
  meeting_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  title: string;
  meeting_date: string;
  meeting_time: string | null;
  meeting_type: string;
  tags: string[];
  customer: string | null;
  project: string | null;
  description: string | null;
  recording_url: string | null;
  minutes_url: string | null;
  confidentiality: Confidentiality;
  storage_mode: StorageMode;
  local_storage_authorized: boolean;
  external_ai_authorized: false;
  raw_transfer_authorized: boolean;
  policy_updated_at: string;
  imports: MeetingMinuteVersion[];
  active_import_id: string | null;
  minute_requests: MinuteRequest[];
  raw_links: MeetingRawLink[];
  raw_source_id: string | null;
  creation: { requestId: string; inputSha256: string };
};
export type MeetingSummary = Omit<Meeting, 'imports' | 'active_import_id' | 'minute_requests' | 'raw_links' | 'raw_source_id' | 'creation'>;

export const DEFAULT_MEETING_TYPES = [
  '需求对接', '项目进展', '客户拜访', '方案评审', '内部例会', '培训学习', '业务复盘', '其他',
] as const;
