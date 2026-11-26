import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { LintFinding, WikiFreshnessSummary, WikiLint } from '../../audit/lint.ts';
import {
  clearStorageScanIssue,
  readJsonRecord,
  reportStorageIssue,
  SerialQueue,
  StorageError,
  takeStorageScanIssues,
  writeJsonAtomic,
} from '../../storage/files.ts';
import { isIsoDate, runIdPattern } from '../ledger.ts';
import type { AutomationScheduler, TaskDefinition } from '../scheduler.ts';

export const wikiLintType = 'wiki.lint';
type SnapshotFinding = LintFinding & { fingerprint: string };
export type WikiLintSnapshot = {
  runId: string;
  checkedAt: string;
  total: number;
  byCode: Record<string, number>;
  findings: SnapshotFinding[];
  freshness?: WikiFreshnessSummary;
  diff: {
    isBaseline: boolean;
    previousRunId: string | null;
    addedCount: number;
    resolvedCount: number;
    unchangedCount: number;
    added: SnapshotFinding[];
    resolved: SnapshotFinding[];
  };
};

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const findings = (value: unknown): value is SnapshotFinding[] =>
  Array.isArray(value) &&
  value.every(
    (finding) =>
      object(finding) &&
      typeof finding.code === 'string' &&
      typeof finding.fingerprint === 'string' &&
      /^[a-f0-9]{64}$/u.test(finding.fingerprint) &&
      (finding.objectId === null || typeof finding.objectId === 'string') &&
      (finding.pageTitle === null || typeof finding.pageTitle === 'string') &&
      typeof finding.file === 'string' &&
      typeof finding.message === 'string' &&
      object(finding.location) &&
      (finding.location.scope === 'page' || finding.location.scope === 'line') &&
      count(finding.location.line) &&
      (finding.location.text === undefined || typeof finding.location.text === 'string'),
  );

function validSnapshot(value: unknown, id: string): value is WikiLintSnapshot {
  return (
    object(value) &&
    value.runId === id &&
    isIsoDate(value.checkedAt) &&
    findings(value.findings) &&
    value.total === value.findings.length &&
    object(value.byCode) &&
    Object.values(value.byCode).every(count) &&
    Object.values(value.byCode).reduce<number>((sum, item) => sum + (item as number), 0) === value.total &&
    object(value.diff) &&
    typeof value.diff.isBaseline === 'boolean' &&
    (value.diff.isBaseline
      ? value.diff.previousRunId === null
      : typeof value.diff.previousRunId === 'string' && runIdPattern.test(value.diff.previousRunId)) &&
    findings(value.diff.added) &&
    value.diff.addedCount === value.diff.added.length &&
    findings(value.diff.resolved) &&
    value.diff.resolvedCount === value.diff.resolved.length &&
    count(value.diff.unchangedCount) &&
    (value.diff.isBaseline
      ? value.diff.unchangedCount === 0 && value.diff.addedCount === 0 && value.diff.resolvedCount === 0
      : value.diff.unchangedCount === value.findings.length - value.diff.added.length)
  );
}

export class WikiLintSnapshots {
  private readonly dir: string;
  private readonly io = new SerialQueue();

  constructor(private readonly root: string) {
    this.dir = path.join(root, 'state', 'automation', 'wiki-lint');
  }

  private async read(id: string) {
    const file = path.join(this.dir, `${id}.json`);
    const snapshot = await readJsonRecord(this.root, file, (value): value is WikiLintSnapshot =>
      validSnapshot(value, id),
    );
    if (!snapshot) throw new StorageError('AUTOMATION_LINT_SNAPSHOT_NOT_FOUND', '没有找到这份结构检查快照。', 404);
    clearStorageScanIssue(this.root, file);
    return snapshot;
  }

  get(id: string) {
    return this.io.run(() => this.read(id));
  }

  save(snapshot: WikiLintSnapshot) {
    return this.io.run(() => writeJsonAtomic(path.join(this.dir, `${snapshot.runId}.json`), snapshot));
  }

  issues() {
    return takeStorageScanIssues(this.root).filter(
      (issue) => issue.file === this.dir || path.dirname(issue.file) === this.dir,
    );
  }

  async latest(runs: ReturnType<AutomationScheduler['successfulRuns']>) {
    for await (const { artifacts } of runs) {
      const id = artifacts.lintSnapshotId;
      if (!id) continue;
      const snapshot = await this.get(id).catch((error) => {
        if (!(error instanceof StorageError)) throw error;
        if (error.status === 404) reportStorageIssue(this.root, path.join(this.dir, `${id}.json`), 'read');
        return undefined;
      });
      if (snapshot) return snapshot;
    }
  }

  async prune(now: number) {
    await this.io.run(async () => {
      const entries = await readdir(this.dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') reportStorageIssue(this.root, this.dir, 'directory');
        return [];
      });
      const snapshots: Array<Pick<WikiLintSnapshot, 'runId' | 'checkedAt'>> = [];
      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        if (!entry.isFile() || !runIdPattern.test(id)) {
          reportStorageIssue(this.root, path.join(this.dir, entry.name), 'shape');
          continue;
        }
        const snapshot = await this.read(id).catch((error) => {
          if (!(error instanceof StorageError)) throw error;
          return undefined;
        });
        if (snapshot) snapshots.push({ runId: snapshot.runId, checkedAt: snapshot.checkedAt });
      }
      snapshots.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || b.runId.localeCompare(a.runId));
      const cutoff = now - 90 * 24 * 60 * 60 * 1000;
      for (const { runId, checkedAt } of snapshots.slice(200)) {
        if (Date.parse(checkedAt) < cutoff) await rm(path.join(this.dir, `${runId}.json`), { force: true });
      }
    });
  }
}

export function createWikiLint(
  lint: Pick<WikiLint, 'inspect'>,
  snapshots: WikiLintSnapshots,
  successfulRuns: () => ReturnType<AutomationScheduler['successfulRuns']>,
): TaskDefinition {
  return {
    type: wikiLintType,
    name: '知识库结构巡检',
    defaultPlan: { kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' },
    allowsCatchUp: true,
    mayCallModel: false,
    async execute(context) {
      await context.step('检查知识库结构并保存快照', async () => {
        const { generatedAt, findings: inspected, summary, freshness } = await lint.inspect();
        const previous = await snapshots.latest(successfulRuns());
        const occurrences = new Map<string, number>();
        const current = inspected
          .sort(
            (a, b) =>
              a.file.localeCompare(b.file) ||
              a.location.line - b.location.line ||
              a.code.localeCompare(b.code) ||
              a.message.localeCompare(b.message),
          )
          .map((finding) => {
            // Match repeated findings individually while allowing surrounding lines to move.
            const identity = JSON.stringify([
              finding.file,
              finding.objectId,
              finding.code,
              finding.message,
              finding.location.scope,
              finding.code === 'UNSOURCED_FACT' ? finding.location.text : null,
            ]);
            const occurrence = (occurrences.get(identity) ?? 0) + 1;
            occurrences.set(identity, occurrence);
            return {
              ...finding,
              fingerprint: createHash('sha256')
                .update(JSON.stringify([identity, occurrence]))
                .digest('hex'),
            };
          });
        const oldFingerprints = new Set(previous?.findings.map((finding) => finding.fingerprint));
        const fingerprints = new Set(current.map((finding) => finding.fingerprint));
        const added = previous ? current.filter((finding) => !oldFingerprints.has(finding.fingerprint)) : [];
        const resolved = previous?.findings.filter((finding) => !fingerprints.has(finding.fingerprint)) ?? [];
        const diff = {
          isBaseline: !previous,
          previousRunId: previous?.runId ?? null,
          addedCount: added.length,
          resolvedCount: resolved.length,
          unchangedCount: previous ? current.length - added.length : 0,
          added,
          resolved,
        };
        context.signal.throwIfAborted();
        await snapshots.save({
          runId: context.runId,
          checkedAt: generatedAt,
          total: current.length,
          byCode: summary,
          findings: current,
          ...(freshness ? { freshness } : {}),
          diff,
        });
        await context.link({ lintSnapshotId: context.runId });
        const changes = previous ? `较上次新增 ${added.length} 项、消除 ${resolved.length} 项` : '首次基线';
        const rules = Object.entries(summary)
          .filter(([, total]) => total > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([code, total]) => `${code} ${total}`)
          .join('、');
        return `共 ${current.length} 项，${changes}。${rules ? `主要规则：${rules}。` : ''}`;
      });
    },
  };
}
