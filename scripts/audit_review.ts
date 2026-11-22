#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.env.FMCG_DATA_DIR ?? path.join(process.cwd(), 'workspace'));
const mode = process.argv[3] ?? '--open';
if (!['--open', '--resolved', '--all'].includes(mode)) {
  console.error('Usage: node --import tsx scripts/audit_review.ts [data-root] [--open|--resolved|--all]');
  process.exitCode = 2;
} else {
  const dir = path.join(root, 'knowledge', 'audit');
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
  const entries = (
    await Promise.all(
      names.map(async (name) => {
        try {
          return JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Record<string, unknown>;
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is Record<string, unknown> => Boolean(item));
  const wanted =
    mode === '--all' ? entries : entries.filter((item) => item.status === (mode === '--open' ? 'open' : 'resolved'));
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const entry of wanted) {
    const key = String(entry.wikiId ?? '(no Wiki)');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const output = [...groups].map(([wikiId, audits]) => ({
    wikiId,
    audits: audits
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((a) => ({
        id: a.id,
        severity: a.severity,
        status: a.status,
        comment: a.comment,
        createdAt: a.createdAt,
        revision: a.revision,
      })),
  }));
  process.stdout.write(`${JSON.stringify({ root, mode, total: wanted.length, groups: output }, null, 2)}\n`);
}
