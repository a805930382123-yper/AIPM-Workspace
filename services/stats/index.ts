import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RawStore } from '../raw/store.ts';
import { countActivePrompts } from '../prompt/store.ts';

async function filesUnder(dir: string): Promise<string[]> {
  const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(names.map(entry => entry.isDirectory()
    ? filesUnder(path.join(dir, entry.name))
    : Promise.resolve([path.join(dir, entry.name)])));
  return nested.flat();
}

function shanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function weekRange(date: Date): { start: string; end: string } {
  const local = shanghaiDate(date);
  const utc = new Date(`${local}T00:00:00Z`);
  const daysFromMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - daysFromMonday);
  const start = utc.toISOString().slice(0, 10);
  utc.setUTCDate(utc.getUTCDate() + 7);
  return { start, end: utc.toISOString().slice(0, 10) };
}

export type Stats = { rawCount: number; wikiCount: number; thisWeekNewCount: number; pendingConfirmationCount: number; openAuditCount: number; promptCount: number; weekStartsOn: string; recentChanges: Array<{ time: string; action: string; id: string; title: string; type: string; revision: number; isDemo?: boolean }> };

/**
 * `prompts` is the Prompt Library counter. The homepage must count real `current` prompts only:
 * recycled records, version history inside the same file, temporary files and unrelated JSON in
 * `prompts/` never inflate the number. Without a store the same rule is applied directly to the
 * directory, so the legacy recursive `.json` count cannot come back.
 */
export async function getStats(root: string, rawStore: RawStore, now = new Date(), prompts?: { count(): Promise<number> }): Promise<Stats> {
  const raw = await rawStore.list();
  const wikiFiles = (await filesUnder(path.join(root, 'knowledge', 'wiki')))
    .filter(f => f.toLowerCase().endsWith('.md') && path.basename(f).toLowerCase() !== 'index.md');
  const draftFiles = (await filesUnder(path.join(root, 'drafts'))).filter(f => f.toLowerCase().endsWith('.json'));
  // B04: "待确认" counts drafts that are actually waiting for review, not every historical
  // JSON file (confirmed/discarded drafts must not keep the counter alive).
  let pendingConfirmationCount = 0;
  for (const file of draftFiles) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (/"status"\s*:\s*"pending_confirmation"/.test(text)) pendingConfirmationCount += 1;
  }
  const auditFiles = (await filesUnder(path.join(root, 'knowledge', 'audit'))).filter(f => f.toLowerCase().endsWith('.md') || f.toLowerCase().endsWith('.json'));
  // B07: promptCount comes from the active Prompt Library records, not from every JSON/Markdown
  // file found under prompts/. The previous recursive scan is deliberately gone.
  const promptCount = prompts ? await prompts.count() : await countActivePrompts(root);
  const { start, end } = weekRange(now);
  const rawWeekCount = raw.filter(r => {
    const date = shanghaiDate(new Date(r.importedAt));
    return date >= start && date < end;
  }).length;
  let wikiWeekCount = 0;
  for (const file of wikiFiles) {
    const text = await readFile(file, 'utf8');
    const createdMatch = /^created:\s*["']?([^\r\n"']+)/m.exec(text);
    const match = /^createdAt:\s*["']?([^\r\n"']+)/m.exec(text);
    const dateMatch = /^created_at:\s*["']?([^\r\n"']+)/m.exec(text);
    const value = createdMatch?.[1] ?? match?.[1] ?? dateMatch?.[1];
    if (value) {
      const date = shanghaiDate(new Date(value));
      if (date >= start && date < end) wikiWeekCount++;
    }
  }
  let openAuditCount = 0;
  for (const file of auditFiles) {
    const text = await readFile(file, 'utf8');
    if (/"status"\s*:\s*"open"/i.test(text)) openAuditCount++;
  }
  const logText = await readFile(path.join(root, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8').catch(() => '');
  const recentChanges = logText.split(/\r?\n/).filter(Boolean).flatMap(line => { try { const item = JSON.parse(line) as Record<string, unknown>; if (typeof item.time !== 'string' || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.action !== 'string') return []; return [{ time: item.time, action: item.action, id: item.id, title: item.title, type: typeof item.type === 'string' ? item.type : '', revision: typeof item.revision === 'number' ? item.revision : 0, ...(item.isDemo === true ? { isDemo: true } : {}) }]; } catch { return []; } }).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 8);
  return {
    rawCount: raw.length, wikiCount: wikiFiles.length,
    thisWeekNewCount: rawWeekCount + wikiWeekCount,
    pendingConfirmationCount, openAuditCount, promptCount,
    weekStartsOn: start, recentChanges,
  };
}
