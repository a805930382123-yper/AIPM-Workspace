import path from 'node:path';
import type { KnowledgeInspectionService } from '../llm/knowledge-inspections.ts';
import { clearStorageScanIssue, reportStorageIssue, StorageError, takeStorageScanIssues } from '../storage/files.ts';
import type { AutomationScheduler } from './scheduler.ts';
import { wikiInspectType } from './tasks/wiki-inspect.ts';
import { wikiLintType, type WikiLintSnapshots } from './tasks/wiki-lint.ts';
import type { AutomationIssue } from './types.ts';

export type KnowledgeHealth = {
  lint: { runId: string; checkedAt: string; total: number; isBaseline: boolean; addedCount: number; resolvedCount: number } | null;
  inspection: { inspectionId: string; checkedAt: string; readCount: number; pendingCount: number } | null;
  issues: AutomationIssue[];
};

export class WikiHealth {
  private readonly inspectionDir: string;

  constructor(private readonly root: string, readonly snapshots: WikiLintSnapshots, private readonly inspections: KnowledgeInspectionService) {
    this.inspectionDir = path.join(root, 'state', 'knowledge-inspections');
  }

  async read(scheduler: AutomationScheduler): Promise<KnowledgeHealth> {
    const [snapshot, inspection] = await Promise.all([
      this.snapshots.latest(scheduler.successfulRuns(wikiLintType)),
      this.latestInspection(scheduler),
    ]);
    const lint = snapshot ? {
      runId: snapshot.runId, checkedAt: snapshot.checkedAt, total: snapshot.total, isBaseline: snapshot.diff.isBaseline,
      addedCount: snapshot.diff.addedCount, resolvedCount: snapshot.diff.resolvedCount,
    } : null;
    const readIssues = [...this.snapshots.issues(), ...takeStorageScanIssues(this.root)
      .filter(issue => issue.file === this.inspectionDir || path.dirname(issue.file) === this.inspectionDir)];
    const issues = [...scheduler.runIssues(), ...readIssues.map(({ file, reason }) => ({ file: path.relative(this.root, file).split(path.sep).join('/'), reason }))];
    return { lint, inspection, issues };
  }

  private async latestInspection(scheduler: AutomationScheduler): Promise<KnowledgeHealth['inspection']> {
    for await (const run of scheduler.successfulRuns(wikiInspectType)) {
      for (const id of run.artifacts.inspectionIds ?? []) {
        const file = path.join(this.inspectionDir, `${id}.json`);
        const inspection = await this.inspections.get(id).catch(error => {
          if (error instanceof StorageError) return null;
          throw error;
        });
        if (inspection === null) continue;
        if (!inspection) {
          reportStorageIssue(this.root, file, 'read');
          continue;
        }
        if (inspection.id !== id || (inspection.status !== 'completed' && inspection.status !== 'partial')) {
          reportStorageIssue(this.root, file, 'shape');
          continue;
        }
        clearStorageScanIssue(this.root, file);
        return {
          inspectionId: id, checkedAt: run.endedAt ?? inspection.createdAt, readCount: inspection.readWiki.length,
          pendingCount: inspection.findings.filter(finding => finding.status === 'pending').length,
        };
      }
    }
    return null;
  }
}
