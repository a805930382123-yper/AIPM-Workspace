import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type { RawRecord } from '../raw/store.ts';
import { findDuplicateCandidates } from '../search/duplicates.ts';
import { rankWikiChunks, type RetrievalQuery } from '../search/fts-retriever.ts';
import { rankHybridChunks } from '../search/hybrid-retriever.ts';
import { wikiFileHash } from '../search/indexer.ts';
import { buildFtsQuery } from '../search/tokenizer.ts';
import {
  evaluateFreshness,
  pendingReviewEvents,
  rankReviewQueue,
  wikiFreshnessEnabled,
  wikiReviewDate,
  type ReviewPage,
  type ReviewQueueView,
} from './freshness.ts';
import { assertWikiSourcesAllowed } from './source-lineage.ts';
import { parseWikiMarkdown, type WikiRecord, type WikiStore } from './store.ts';

type RawSources = { get(id: string): Promise<unknown> };

async function isAllowed(check: () => Promise<void>) {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

type ReviewStore = Awaited<ReturnType<WikiStore['reviewTriggers']['read']>>;

async function allowedReminderSources(raws: RawSources, pageIds: Iterable<string>, state: ReviewStore) {
  const ids = new Set<string>();
  for (const pageId of pageIds)
    for (const event of state[pageId]?.events ?? []) if (event.kind !== 'snooze') ids.add(event.rawId);
  const allowed = await Promise.all(
    [...ids].map(async (id) =>
      (await isAllowed(async () => assertRawNotMeeting(await raws.get(id)))) ? id : undefined,
    ),
  );
  return new Set(allowed.filter((id): id is string => id !== undefined));
}

function reminders(page: ReviewPage, date: string, state: ReviewStore, allowedRawIds: ReadonlySet<string>) {
  return pendingReviewEvents(page, date, state[page.pageId], allowedRawIds).flatMap((event) =>
    event.kind === 'snooze'
      ? []
      : [
          {
            ...event,
            origin: event.kind === 'new_source' ? ('system_inference' as const) : ('system_reminder' as const),
          },
        ],
  );
}

export async function readWikiFreshness(wiki: WikiStore, raws: RawSources, records: readonly WikiRecord[]) {
  if (!wikiFreshnessEnabled() || !records.length) return;
  const date = wikiReviewDate();
  const state = await wiki.reviewTriggers.read().catch(() => undefined);
  const allowedRawIds = state
    ? await allowedReminderSources(
        raws,
        records.map((page) => page.id),
        state,
      )
    : undefined;
  return Object.fromEntries(
    records.map((record) => {
      const page = { ...record, pageId: record.id };
      return [
        page.pageId,
        {
          ...evaluateFreshness(page, date, state?.[page.pageId], undefined, allowedRawIds),
          asOf: date,
          remindersAvailable: state !== undefined,
          reminders: state && allowedRawIds ? reminders(page, date, state, allowedRawIds) : [],
        },
      ];
    }),
  );
}

export async function wikiReviewQueue(wiki: WikiStore, raws: RawSources, view: ReviewQueueView) {
  const asOf = wikiReviewDate();
  const state = await wiki.reviewTriggers.read();
  const pages = (await wiki.allVisibleRecords()).map((page) => ({ ...page, pageId: page.id }));
  const allowedRawIds = await allowedReminderSources(
    raws,
    pages.map((page) => page.pageId),
    state,
  );
  const items = rankReviewQueue(pages, asOf, state, 5, allowedRawIds, view).map((item) => {
    const page = pages.find((p) => p.pageId === item.pageId)!;
    return { ...item, revision: page.revision, reminders: reminders(page, asOf, state, allowedRawIds) };
  });
  return { asOf, items };
}

export async function recordRawReview(
  wiki: WikiStore,
  raws: { get(id: string): Promise<RawRecord | undefined> },
  kind: 'new_source' | 'source_changed',
  raw: RawRecord,
  assertSafeQuery?: (queries: RetrievalQuery[]) => Promise<void>,
) {
  if (!wikiFreshnessEnabled() || raw.isDemo || raw.origin !== undefined) return;
  const readCurrent = async () => {
    const current = await raws.get(raw.id);
    assertRawNotMeeting(current);
    if (kind === 'new_source' && (current?.bodySha256 !== raw.bodySha256 || current?.bodyRevision !== raw.bodyRevision))
      throw new Error('Raw changed before similarity review');
  };
  await readCurrent();
  const event = { kind, date: wikiReviewDate(), rawId: raw.id, bodyRevision: raw.bodyRevision ?? 0 };
  if (kind === 'source_changed') {
    await wiki.withLock(async () => {
      await readCurrent();
      const linked = [];
      for (const { id } of await wiki.referencesToRaw(raw.id)) {
        const page = await wiki.get(id);
        if (page && (await isAllowed(() => assertWikiSourcesAllowed(wiki, raws, page)))) linked.push(id);
      }
      await wiki.reviewTriggers.appendEvent(linked, {
        ...event,
        reason: '已关联的 Raw 正文已更新，请复核受影响的结论。',
      });
    });
    return;
  }
  const index = wiki.searchIndex;
  if (!index || process.env.SEARCH_ENGINE === 'legacy_scan') return;
  const content = raw.body.slice(0, 3000).replace(/[\ud800-\udbff]$/u, '');
  const queries = [{ title: raw.title, content, tags: raw.tags }];
  const matches =
    process.env.SEARCH_ENGINE === 'sqlite_fts'
      ? rankWikiChunks(index, queries, { includeSources: true })
      : await rankHybridChunks(
          index,
          queries,
          {
            includeSources: true,
            authorizeQuery: async () => {
              await readCurrent();
              await assertSafeQuery?.(queries);
            },
          },
          () => undefined,
        );
  const titleWeight = buildFtsQuery([raw.title]).queryGroups.reduce(
    (weight, group) => weight + group.coverageWeight,
    0,
  );
  await wiki.withLock(async () => {
    await readCurrent();
    const existing = await wiki.reviewTriggers.read();
    if (
      Object.values(existing).some((page) =>
        page.events?.some((item) => item.kind === 'new_source' && item.rawId === raw.id),
      )
    )
      return;
    const selected = new Map<string, string>();
    const pages = new Map<string, WikiRecord | undefined>();
    for (const { chunk, fileHash } of matches) {
      if (selected.has(chunk.pageId)) continue;
      if (!pages.has(chunk.pageId)) {
        const file = await wiki.readPageFile(chunk.pageId);
        const page = file && wikiFileHash(file) === fileHash ? parseWikiMarkdown(file) : undefined;
        pages.set(
          chunk.pageId,
          page &&
            !page.isDemo &&
            !page.sources.includes(raw.id) &&
            Date.parse(page.created) <= Date.parse(raw.importedAt) &&
            (await isAllowed(() => assertWikiSourcesAllowed(wiki, raws, page)))
            ? page
            : undefined,
        );
      }
      const page = pages.get(chunk.pageId);
      if (!page) continue;
      const [lexical] = findDuplicateCandidates({ title: raw.title, category: '', content }, [
        { ...page, body: chunk.rawText },
      ]);
      const nameMatch =
        titleWeight >= 4 &&
        lexical?.matches.some(
          ({ dimension, score }) => (dimension === 'title' || dimension === 'aliases') && score >= 0.9,
        );
      const bodyMatch =
        content.trim().length >= 30 &&
        lexical?.matches.some(({ dimension, score }) => dimension === 'content' && score >= 0.6);
      const vectorMatch = (chunk.vectorScore ?? 0) >= 0.6;
      if (!nameMatch && !bodyMatch && !vectorMatch) continue;
      const reason = nameMatch ? '标题或别名高度相似' : bodyMatch ? '正文片段高度相似' : '语义相似度较高';
      selected.set(page.id, reason);
      if (selected.size === 3) break;
    }
    await wiki.reviewTriggers.appendEvents(
      [...selected].map(([pageId, reason]) => ({
        pageId,
        event: { ...event, reason: `${reason}，请比对这条新 Raw 是否影响本页结论。` },
      })),
    );
  });
}
