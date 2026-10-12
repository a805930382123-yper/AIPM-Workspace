// B04: mutable Raw processing state. The Raw Markdown/body/original bytes are never rewritten;
// only state/raw-processing/<rawId>.json changes. Raws without a state file are `unprocessed`.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SerialQueue, listJsonRecords, readJsonFile, writeJsonAtomic } from '../storage/files.ts';

export const RAW_STATUSES = ['unprocessed', 'processing', 'pending_confirmation', 'generated', 'failed'] as const;
export type RawStatus = typeof RAW_STATUSES[number];
export type RawStateFailure = { code: string; message: string; at: string; retryable: boolean };
export type RawState = {
  rawId: string;
  status: RawStatus;
  updatedAt: string;
  jobId?: string;
  draftId?: string;
  lastError?: RawStateFailure;
  generatedWikiIds?: string[];
  confirmedOperationId?: string;
  /** Internal: the stable status this Raw returns to when an extraction is cancelled/discarded. */
  revertStatus?: RawStatus;
  history: Array<{ at: string; from: RawStatus; to: RawStatus; reason: string; jobId?: string; draftId?: string }>;
};

export class RawStateStore {
  private readonly queue = new SerialQueue();
  constructor(public readonly root: string) {}
  private directory() { return path.join(this.root, 'state', 'raw-processing'); }
  private fileFor(rawId: string) { return path.join(this.directory(), `${rawId}.json`); }

  async initialize() { await mkdir(this.directory(), { recursive: true }); }

  async get(rawId: string): Promise<RawState> {
    const stored = await readJsonFile<RawState>(this.fileFor(rawId));
    if (stored && RAW_STATUSES.includes(stored.status)) return stored;
    return { rawId, status: 'unprocessed', updatedAt: new Date(0).toISOString(), history: [] };
  }

  async list(): Promise<RawState[]> {
    const records = await listJsonRecords<RawState>(this.directory());
    return records.map(record => record.value).filter(value => value && RAW_STATUSES.includes(value.status));
  }

  /** Applies a state transition and appends history; all mutations are serialized. */
  async set(rawId: string, next: { status: RawStatus; reason: string; jobId?: string; draftId?: string; lastError?: RawStateFailure; generatedWikiIds?: string[]; confirmedOperationId?: string; revertStatus?: RawStatus }): Promise<RawState> {
    return this.queue.run(async () => {
      const current = await this.get(rawId);
      const updated: RawState = {
        ...current,
        status: next.status,
        updatedAt: new Date().toISOString(),
        history: [...current.history, {
          at: new Date().toISOString(), from: current.status, to: next.status, reason: next.reason,
          ...(next.jobId ? { jobId: next.jobId } : {}), ...(next.draftId ? { draftId: next.draftId } : {}),
        }].slice(-50),
      };
      if (next.jobId !== undefined) updated.jobId = next.jobId;
      if (next.draftId !== undefined) updated.draftId = next.draftId;
      if (next.lastError !== undefined) updated.lastError = next.lastError; else if (next.status !== 'failed') delete updated.lastError;
      if (next.generatedWikiIds !== undefined) updated.generatedWikiIds = next.generatedWikiIds;
      if (next.confirmedOperationId !== undefined) updated.confirmedOperationId = next.confirmedOperationId;
      if (next.revertStatus !== undefined) updated.revertStatus = next.revertStatus;
      await writeJsonAtomic(this.fileFor(rawId), updated);
      return updated;
    });
  }
}
