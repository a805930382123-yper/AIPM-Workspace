import path from 'node:path';
import { readJsonFile, SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { civilDate, reviewTriggerKinds, type ReviewPageState, type ReviewTriggerKind } from './freshness.ts';
import { wikiPageIdFromFilename } from './store.ts';

type ReviewState = Record<string, ReviewPageState>;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readDates(value: unknown, legacy: boolean): string[] {
  const dates = legacy ? [value] : value;
  if (!Array.isArray(dates) || dates.some((date) => !civilDate(date))) throw new Error('Invalid Wiki review date');
  return [...new Set(dates as string[])].sort();
}

export class ReviewTriggerStore {
  private readonly file: string;
  private readonly writes = new SerialQueue();

  constructor(root: string) {
    this.file = path.join(root, 'state', 'review-triggers.json');
  }

  async read(): Promise<ReviewState> {
    const value = await readJsonFile<unknown>(this.file);
    if (value === undefined) return {};
    if (!record(value) || (value.version !== 1 && value.version !== 2) || !record(value.pages))
      throw new Error('Invalid Wiki review state');
    const legacy = value.version === 1;
    const pages: ReviewState = {};
    for (const [id, page] of Object.entries(value.pages)) {
      if (!wikiPageIdFromFilename(`${id}.md`) || !record(page)) throw new Error('Invalid Wiki review page state');
      const entry: ReviewPageState = {};
      pages[id] = entry;
      if (page.snoozedOn !== undefined) entry.snoozedOn = readDates(page.snoozedOn, legacy);
      if (page.triggers === undefined) continue;
      if (!record(page.triggers)) throw new Error('Invalid Wiki review trigger');
      entry.triggers = {};
      for (const [kind, dates] of Object.entries(page.triggers)) {
        if (!(reviewTriggerKinds as readonly string[]).includes(kind)) throw new Error('Invalid Wiki review trigger');
        entry.triggers[kind as ReviewTriggerKind] = readDates(dates, legacy);
      }
    }
    return pages;
  }

  recordTrigger(pageId: string, kind: ReviewTriggerKind, date: string): Promise<void> {
    return this.update(pageId, date, (page) => {
      const previous = page.triggers?.[kind] ?? [];
      return previous.includes(date)
        ? page
        : { ...page, triggers: { ...page.triggers, [kind]: [...previous, date].sort() } };
    });
  }

  snooze(pageId: string, date: string): Promise<void> {
    return this.update(pageId, date, (page) => {
      const previous = page.snoozedOn ?? [];
      return previous.includes(date) ? page : { ...page, snoozedOn: [...previous, date].sort() };
    });
  }

  private update(pageId: string, date: string, apply: (page: ReviewPageState) => ReviewPageState): Promise<void> {
    if (!wikiPageIdFromFilename(`${pageId}.md`) || !civilDate(date))
      return Promise.reject(new Error('Invalid Wiki review state update'));
    return this.writes.run(async () => {
      const pages = await this.read();
      const previous = pages[pageId] ?? {};
      const next = apply(previous);
      if (next === previous) return;
      pages[pageId] = next;
      await writeJsonAtomic(this.file, { version: 2, pages });
    });
  }
}
