import path from 'node:path';
import { readJsonFile, SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import {
  civilDate,
  reviewTriggerKinds,
  type ReviewEvent,
  type ReviewPageState,
  type ReviewTriggerKind,
} from './freshness.ts';
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

function validEvent(value: unknown): value is ReviewEvent {
  return (
    record(value) &&
    Boolean(civilDate(value.date)) &&
    (value.kind === 'snooze' ||
      ((value.kind === 'source_changed' || value.kind === 'new_source') &&
        typeof value.rawId === 'string' &&
        Boolean(wikiPageIdFromFilename(`${value.rawId}.md`)) &&
        typeof value.bodyRevision === 'number' &&
        Number.isSafeInteger(value.bodyRevision) &&
        value.bodyRevision >= 0 &&
        typeof value.reason === 'string' &&
        value.reason.length > 0))
  );
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
    if (!record(value) || ![1, 2, 3].includes(value.version as number) || !record(value.pages))
      throw new Error('Invalid Wiki review state');
    const legacy = value.version === 1;
    const pages: ReviewState = {};
    for (const [id, page] of Object.entries(value.pages)) {
      if (!wikiPageIdFromFilename(`${id}.md`) || !record(page)) throw new Error('Invalid Wiki review page state');
      const entry: ReviewPageState = {};
      pages[id] = entry;
      if (page.snoozedOn !== undefined) entry.snoozedOn = readDates(page.snoozedOn, legacy);
      if (value.version === 3 && page.events !== undefined) {
        if (!Array.isArray(page.events) || !page.events.every(validEvent)) throw new Error('Invalid Wiki review event');
        entry.events = page.events;
      }
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
    return this.update([{ pageId, date }], (page) => {
      const previous = page.triggers?.[kind] ?? [];
      return previous.includes(date)
        ? page
        : { ...page, triggers: { ...page.triggers, [kind]: [...previous, date].sort() } };
    });
  }

  snooze(pageId: string, date: string): Promise<void> {
    return this.update([{ pageId, date }], (page) => {
      const previous = page.snoozedOn ?? [];
      return previous.includes(date) ? page : { ...page, snoozedOn: [...previous, date].sort() };
    });
  }

  appendEvent(pageIds: string[], event: ReviewEvent, checkpoint = 0): Promise<void> {
    return this.appendEvents(
      pageIds.map((pageId) => ({ pageId, event })),
      checkpoint,
    );
  }

  appendEvents(entries: { pageId: string; event: ReviewEvent }[], checkpoint = 0): Promise<void> {
    return this.update(
      entries.map((item) => ({ ...item, date: item.event.date })),
      (page, { event }) => {
        const previous = page.events ?? [];
        const recorded =
          event.kind === 'snooze'
            ? previous.slice(checkpoint).some((item) => item.kind === 'snooze' && item.date === event.date)
            : previous.some(
                (item) =>
                  item.kind === event.kind && item.rawId === event.rawId && item.bodyRevision === event.bodyRevision,
              );
        return recorded ? page : { ...page, events: [...previous, event] };
      },
    );
  }

  private update<T extends { pageId: string; date: string }>(
    entries: T[],
    apply: (page: ReviewPageState, entry: T) => ReviewPageState,
  ): Promise<void> {
    if (!entries.length) return Promise.resolve();
    if (entries.some(({ pageId, date }) => !wikiPageIdFromFilename(`${pageId}.md`) || !civilDate(date)))
      return Promise.reject(new Error('Invalid Wiki review state update'));
    return this.writes.run(async () => {
      const pages = await this.read();
      let changed = false;
      for (const entry of entries) {
        const previous = pages[entry.pageId] ?? {};
        const next = apply(previous, entry);
        if (next === previous) continue;
        pages[entry.pageId] = next;
        changed = true;
      }
      if (changed)
        await writeJsonAtomic(this.file, { version: Object.values(pages).some((p) => p.events) ? 3 : 2, pages });
    });
  }
}
