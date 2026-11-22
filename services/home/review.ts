import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isUuid, isWikiRecord } from '../storage/record-validators.ts';
import { FEEDBACK_OUTCOMES } from '../prompt/feedback.ts';
import type { PromptStore } from '../prompt/store.ts';
import type { WikiStore } from '../wiki/store.ts';
import type { RawStore } from '../raw/store.ts';
import type { ExtractionRunner } from '../llm/jobs.ts';
import { homeActions } from './actions.ts';

export function validReviewDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function shanghaiDate(value: unknown): string | null {
  if (validReviewDate(value)) return value;
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (
    !m ||
    !validReviewDate(m[1]) ||
    Number(m[2]) > 23 ||
    Number(m[3]) > 59 ||
    Number(m[4]) > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  const d = new Date(Date.parse(value) + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}
async function files(dir: string, ext: string) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((x) => x.isFile() && x.name.toLowerCase().endsWith(ext) && isUuid(x.name.slice(0, -ext.length)))
      .map((x) => x.name.slice(0, -ext.length));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export async function periodReview(
  deps: { root: string; raws: RawStore; wiki: WikiStore; prompts: PromptStore; runner: ExtractionRunner },
  start: string,
  end: string,
) {
  const { root, wiki, prompts } = deps;
  const pending = await homeActions(deps);
  const snapshotAt = new Date().toISOString();
  let knowledge:
    | {
        status: 'ok';
        items: Array<{ id: string; title: string; created: string; revision: number }>;
        undated: Array<{ id: string; title: string; created: string | null; revision: number }>;
        count: number;
      }
    | { status: 'error'; message: string };
  try {
    const ids = await files(path.join(root, 'knowledge', 'wiki'), '.md');
    const items: Array<{ id: string; title: string; created: string; revision: number }> = [],
      undated: Array<{ id: string; title: string; created: string | null; revision: number }> = [];
    for (const id of ids) {
      const page = await wiki.get(id);
      if (!page || page.id !== id || !isWikiRecord({ ...page, created: '1970-01-01T00:00:00.000Z' }))
        throw Error('invalid wiki');
      const date = shanghaiDate(page.created);
      const row = {
        id,
        title: page.title,
        created: typeof page.created === 'string' ? page.created : null,
        revision: page.revision,
      };
      if (!date) undated.push(row);
      else if (date >= start && date < end) items.push({ ...row, created: row.created! });
    }
    items.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    undated.sort((a, b) => a.id.localeCompare(b.id));
    knowledge = { status: 'ok', items, undated, count: items.length };
  } catch {
    knowledge = { status: 'error', message: '读取失败，无法确认本周期记录。' };
  }
  let feedback:
    | {
        status: 'ok';
        items: Array<Awaited<ReturnType<PromptStore['getFeedback']>>[number] & { promptName: string }>;
        counts: Record<string, number>;
      }
    | { status: 'error'; message: string };
  try {
    const ids = await files(path.join(root, 'prompts'), '.json');
    const items: Array<Awaited<ReturnType<PromptStore['getFeedback']>>[number] & { promptName: string }> = [];
    for (const id of ids) {
      const prompt = await prompts.get(id);
      if (!prompt || prompt.id !== id || typeof prompt.name !== 'string') throw Error('invalid prompt');
      const entries = await prompts.getFeedback(id);
      for (const entry of entries)
        if (entry.usedOn >= start && entry.usedOn < end) items.push({ ...entry, promptName: prompt.name });
    }
    items.sort(
      (a, b) => b.usedOn.localeCompare(a.usedOn) || a.promptId.localeCompare(b.promptId) || a.id.localeCompare(b.id),
    );
    const counts = Object.fromEntries(
      FEEDBACK_OUTCOMES.map((x) => [x, items.filter((item) => item.outcome === x).length]),
    );
    feedback = { status: 'ok', items, counts };
  } catch {
    feedback = { status: 'error', message: '读取失败，无法确认本周期记录。' };
  }
  return { period: { timeZone: 'Asia/Shanghai', start, end }, snapshotAt, knowledge, pending, feedback };
}
