export type MeetingConfidentiality = 'Public' | 'Internal' | 'Sensitive' | 'Restricted';

export type MeetingCatalogEntry = { id: string; name: string; active: boolean };

export type MeetingCatalog = {
  schema_version: 1;
  revision: number;
  types: MeetingCatalogEntry[];
  tags: MeetingCatalogEntry[];
};

export type MeetingCapabilities = {
  canImportMinutes: boolean;
  canRegisterRaw: boolean;
  canUseAi: false;
  importReason: string;
  rawReason: string;
  aiReason: string;
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

export type MeetingRawLinkError = { code: string; at: string };

export type MeetingRawLink = {
  request_id: string;
  import_id: string;
  raw_id: string;
  original_sha256: string;
  created_at: string;
  status: 'pending' | 'linked' | 'failed' | 'unlinked' | 'raw_deleted';
  request_fingerprint: string;
  raw_title: string;
  source_name: string;
  tags: string[];
  registered_at?: string;
  error?: MeetingRawLinkError;
};

export type MeetingSummary = {
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
  confidentiality: MeetingConfidentiality;
  storage_mode: 'cloud_index' | 'local_archive';
  local_storage_authorized: boolean;
  external_ai_authorized: false;
  raw_transfer_authorized: boolean;
  policy_updated_at: string;
};

export type Meeting = MeetingSummary & {
  imports: MeetingMinuteVersion[];
  active_import_id: string | null;
  raw_links: MeetingRawLink[];
  raw_source_id: string | null;
  capabilities: MeetingCapabilities;
  reused?: boolean;
};
