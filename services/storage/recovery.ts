import { open, opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  takeStorageScanIssues,
  clearStorageScanIssue,
  storageObserverOverflow,
  clearStorageObserverOverflow,
  JSON_SCAN_BUDGET,
} from './files.ts';
import {
  isRawState,
  isJob,
  isCommitManifest,
  isWorkflow,
  isWorkflowManifest,
  isExtractionDraft,
} from './record-validators.ts';
import { validStoredDraft } from '../prompt-ai/service.ts';
import { withJobFileAccess } from './job-file-access.ts';
export type RecoveryIssue = { id: string; kind: string; reason: 'read' | 'parse' | 'shape' | 'directory' };
const directories = [
  ['wiki', 'knowledge/wiki'],
  ['raw-state', 'state/raw-processing'],
  ['jobs', 'state/extraction-jobs'],
  ['workflows', 'drafts/knowledge-workflows'],
  ['workflow-commits', 'state/knowledge-commits'],
  ['prompt-drafts', 'drafts/prompts'],
  ['drafts', 'drafts'],
  ['commits', 'state/wiki-commits'],
  ['operations', 'state/wiki-operations'],
  ['audit', 'knowledge/audit'],
  ['audit-drafts', 'drafts/audit'],
] as const;
const active = new Map<string, { root: string; issue: RecoveryIssue; file: string }>();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const rootKey = (root: string, id: string) => JSON.stringify([root, id]);
function wikiRecord(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    uuid((v as any).id) &&
    typeof (v as any).title === 'string' &&
    ['source', 'concept', 'entity', 'business_process', 'metric', 'synthesis'].includes((v as any).type) &&
    Array.isArray((v as any).sources) &&
    Array.isArray((v as any).tags) &&
    Array.isArray((v as any).aliases) &&
    Number.isInteger((v as any).revision) &&
    typeof (v as any).body === 'string'
  );
}
function validShape(kind: string, v: unknown, id: string) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const x = v as Record<string, unknown>;
  if (kind === 'jobs') return isJob(x);
  if (kind === 'raw-state') return isRawState(x);
  if (kind === 'commits') return isCommitManifest(x);
  if (kind === 'workflow-commits') return isWorkflowManifest(x);
  if (kind === 'prompt-drafts') return validStoredDraft(v, id);
  if (kind === 'workflows') return isWorkflow(x);
  if (kind === 'drafts') return isExtractionDraft(v, id);
  if (kind === 'wiki') return wikiRecord(x);
  return true;
}
export class RecoveryRegistry {
  constructor(private readonly root: string) {}
  private put(file: string, kind: string, reason: RecoveryIssue['reason']) {
    const root = path.resolve(this.root),
      id = createHash('sha256').update(path.relative(root, file)).digest('hex').slice(0, 16);
    active.set(rootKey(root, id), { root, issue: { id, kind, reason }, file });
  }
  async scan() {
    const root = path.resolve(this.root),
      seen = new Set<string>();
    let totalFiles = 0,
      totalBytes = 0,
      partial = false,
      overflow = false;
    for (const [kind, relative] of directories) {
      const dir = path.join(root, relative);
      let iterator;
      try {
        iterator = await opendir(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        this.put(dir, kind, 'directory');
        seen.add(rootKey(root, createHash('sha256').update(path.relative(root, dir)).digest('hex').slice(0, 16)));
        continue;
      }
      clearStorageScanIssue(root, dir);
      try {
        for await (const entry of iterator) {
          if (!entry.name.endsWith('.json')) continue;
          if (totalFiles >= JSON_SCAN_BUDGET.files) {
            partial = true;
            overflow = true;
            break;
          }
          totalFiles++;
          const file = path.join(dir, entry.name),
            id = createHash('sha256').update(path.relative(root, file)).digest('hex').slice(0, 16),
            key = rootKey(root, id);
          seen.add(key);
          await withJobFileAccess(file, async () => {
            let fh;
            try {
              fh = await open(file, 'r');
              const before = await fh.stat(),
                remaining = JSON_SCAN_BUDGET.totalBytes - totalBytes;
              if (before.size > JSON_SCAN_BUDGET.fileBytes || before.size > remaining) {
                this.put(file, kind, 'read');
                partial = true;
                overflow = true;
                return;
              }
              const bytes = Buffer.alloc(before.size);
              let pos = 0;
              while (pos < bytes.length) {
                const result = await fh.read(bytes, pos, bytes.length - pos, pos);
                if (!result.bytesRead) break;
                pos += result.bytesRead;
              }
              const after = await fh.stat();
              if (after.size !== before.size || pos !== before.size) {
                this.put(file, kind, 'read');
                partial = true;
                overflow = true;
                return;
              }
              totalBytes += pos;
              const value: unknown = JSON.parse(bytes.toString('utf8')),
                record = value as Record<string, unknown>,
                stem = entry.name.slice(0, -5);
              const identity =
                kind === 'jobs'
                  ? record.id
                  : kind === 'raw-state'
                    ? record.rawId
                    : kind === 'commits' || kind === 'workflow-commits'
                      ? record.operationId
                      : kind === 'prompt-drafts' || kind === 'workflows' || kind === 'drafts'
                        ? record.id
                        : undefined;
              if ((identity !== undefined && identity !== stem) || !validShape(kind, value, stem))
                this.put(file, kind, 'shape');
              else {
                active.delete(key);
                clearStorageScanIssue(root, file);
              }
            } catch (error) {
              this.put(file, kind, error instanceof SyntaxError ? 'parse' : 'read');
            } finally {
              await fh?.close().catch(() => undefined);
            }
          });
        }
      } finally {
        await iterator.close().catch(() => undefined);
      }
      if (overflow) break;
    }
    for (const issue of takeStorageScanIssues(root)) {
      if (!partial) {
        try {
          await stat(issue.file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            clearStorageScanIssue(root, issue.file);
            continue;
          }
        }
      }
      const kind =
        directories.find(
          ([, relative]) =>
            issue.file === path.join(root, relative) || issue.file.startsWith(path.join(root, relative) + path.sep),
        )?.[0] ?? 'storage';
      this.put(issue.file, kind, issue.reason);
      seen.add(rootKey(root, createHash('sha256').update(path.relative(root, issue.file)).digest('hex').slice(0, 16)));
    }
    if (storageObserverOverflow(root)) {
      if (partial) {
        overflow = true;
        this.put(path.join(root, 'observer-budget'), 'scan', 'directory');
      } else {
        clearStorageObserverOverflow(root);
      }
    }
    if (partial) {
      const file = path.join(root, 'scan-budget');
      this.put(file, 'scan', 'directory');
      seen.add(rootKey(root, createHash('sha256').update('scan-budget').digest('hex').slice(0, 16)));
    }
    if (!partial) for (const [key, item] of active) if (item.root === root && !seen.has(key)) active.delete(key);
    if (!partial) clearStorageObserverOverflow(root);
    const items = [...active.values()]
      .filter((x) => x.root === root)
      .map((x) => x.issue)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const totalIssues = items.length,
      truncated = totalIssues > 500;
    return {
      scanned: !partial,
      partial,
      overflow: overflow || truncated,
      truncated,
      totalIssues,
      hiddenIssues: Math.max(0, totalIssues - 500),
      scannedFiles: totalFiles,
      scannedBytes: totalBytes,
      items: items.slice(0, 500),
    };
  }
}
