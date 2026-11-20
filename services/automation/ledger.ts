import { readFile, readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { clearStorageScanIssue, reportStorageIssue, SerialQueue, StorageError, writeJsonAtomic } from '../storage/files.ts';
import { automationRunStatuses, type AutomationIssue, type AutomationRun } from './types.ts';

export const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const triggers = ['schedule', 'manual', 'catch-up'];
const stepStatuses = ['running', 'succeeded', 'failed', 'cancelled', 'interrupted'];
export const isActiveRun = (run: AutomationRun) => run.status === 'queued' || run.status === 'running';
export const runTimestamp = (run: AutomationRun) => run.startedAt ?? run.endedAt ?? run.scheduledAt;
export const newestRunFirst = (a: AutomationRun, b: AutomationRun) => runTimestamp(b).localeCompare(runTimestamp(a)) || b.id.localeCompare(a.id);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const optionalText = (value: unknown) => value === undefined || string(value);
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const isIsoDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function isStoredRun(value: unknown, id: string, month: string): value is AutomationRun {
  if (!object(value) || value.id !== id || !string(value.type) || !value.type || !triggers.includes(String(value.trigger))
    || !isIsoDate(value.scheduledAt) || value.scheduledAt.slice(0, 7) !== month
    || !(value.startedAt === null || isIsoDate(value.startedAt)) || !(value.endedAt === null || isIsoDate(value.endedAt))
    || !automationRunStatuses.some(status => status === value.status) || !optionalText(value.error) || value.budget !== null) return false;
  if ((value.status === 'queued' || value.status === 'running') !== (value.endedAt === null)
    || (value.status === 'running' && value.startedAt === null)) return false;
  if (!Array.isArray(value.steps) || !value.steps.every(step => object(step) && string(step.name)
    && stepStatuses.includes(String(step.status)) && isIsoDate(step.startedAt)
    && (step.endedAt === null || isIsoDate(step.endedAt)) && (step.durationMs === null || nonnegative(step.durationMs))
    && string(step.summary) && optionalText(step.error))) return false;
  if (!object(value.usage) || !['requests', 'inputTokens', 'outputTokens', 'unknownUsageCount'].every(key => nonnegative((value.usage as Record<string, unknown>)[key]))
    || (value.sourceRequests !== undefined && !nonnegative(value.sourceRequests)) || !optionalText(value.candidateId)) return false;
  const artifacts = value.artifacts;
  return object(artifacts) && ['rawIds', 'jobIds', 'draftIds'].every(key => Array.isArray(artifacts[key]) && artifacts[key].every(string))
    && (artifacts.lintSnapshotId === undefined || (string(artifacts.lintSnapshotId) && runIdPattern.test(artifacts.lintSnapshotId)))
    && (artifacts.inspectionIds === undefined || (Array.isArray(artifacts.inspectionIds)
      && artifacts.inspectionIds.every(id => string(id) && runIdPattern.test(id))))
    && (artifacts.weeklyReviewWeekKey === undefined || (string(artifacts.weeklyReviewWeekKey)
      && /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/u.test(artifacts.weeklyReviewWeekKey)));
}

export class AutomationLedger {
  private readonly dir: string;
  // On Windows a read handle can deny replacement of the same file. Polling and
  // per-request accounting both touch the live ledger, so share one file access queue.
  private readonly io = new SerialQueue();
  private readonly files = new Map<string, string>();
  private readonly runs = new Map<string, AutomationRun>();
  private readonly issues = new Map<string, AutomationIssue>();

  constructor(private readonly root: string) { this.dir = path.join(root, 'state', 'automation', 'runs'); }

  private issue(file: string, reason: AutomationIssue['reason']) {
    this.issues.set(file, { file: path.relative(this.root, file).split(path.sep).join('/'), reason });
    reportStorageIssue(this.root, file, reason);
  }

  private async entries(dir: string) {
    try { return await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.issue(dir, 'directory');
      return [];
    }
  }

  private async read(file: string, id: string): Promise<AutomationRun | undefined> {
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch { this.issue(file, 'read'); return undefined; }
    let value: unknown;
    try { value = JSON.parse(raw) as unknown; }
    catch { this.issue(file, 'parse'); return undefined; }
    if (!isStoredRun(value, id, path.basename(path.dirname(file)))) { this.issue(file, 'shape'); return undefined; }
    this.issues.delete(file);
    clearStorageScanIssue(this.root, file);
    return value;
  }

  async initialize() {
    for (const month of await this.entries(this.dir)) {
      if (!monthPattern.test(month.name)) continue;
      const folder = path.join(this.dir, month.name);
      if (!month.isDirectory()) { this.issue(folder, 'directory'); continue; }
      for (const entry of await this.entries(folder)) {
        if (!entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        const file = path.join(folder, entry.name);
        if (!entry.isFile() || !runIdPattern.test(id) || this.files.has(id)) { this.issue(file, 'shape'); continue; }
        this.files.set(id, file);
        const run = await this.io.run(() => this.read(file, id));
        if (run) this.runs.set(id, run);
      }
    }
  }

  values() { return this.runs.values(); }
  listIssues() { return [...this.issues.values()]; }

  async get(id: string) {
    return this.io.run(async () => {
      const file = this.files.get(id);
      if (!file) return undefined;
      const run = await this.read(file, id);
      if (!run) throw new StorageError('AUTOMATION_RUN_CORRUPT', '运行记录无法读取，原文件已保留。', 500);
      return run;
    });
  }

  async save(run: AutomationRun) {
    const file = path.join(this.dir, run.scheduledAt.slice(0, 7), `${run.id}.json`);
    const snapshot = structuredClone(run);
    return this.io.run(async () => {
      await writeJsonAtomic(file, snapshot);
      this.files.set(snapshot.id, file);
      this.runs.set(snapshot.id, snapshot);
      return snapshot;
    });
  }

  async prune(now: number) {
    const cutoff = now - 90 * 24 * 60 * 60 * 1000;
    const oldest = [...this.runs.values()].sort(newestRunFirst).slice(2000);
    const changed = new Set<string>();
    for (const run of oldest) {
      if (isActiveRun(run) || Date.parse(runTimestamp(run)) >= cutoff) continue;
      await this.io.run(async () => {
        const file = this.files.get(run.id);
        // Keep records damaged since startup for diagnosis rather than cleaning over them.
        if (!file || !await this.read(file, run.id)) return;
        await rm(file, { force: true });
        this.files.delete(run.id);
        this.runs.delete(run.id);
        changed.add(path.dirname(file));
      });
    }
    for (const dir of changed) {
      try { await rmdir(dir); }
      catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
  }
}
