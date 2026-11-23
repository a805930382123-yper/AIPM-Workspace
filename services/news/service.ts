import { normalizedUrl, normalizedTitle } from './normalize.ts';
export { normalizedUrl } from './normalize.ts';
import { evaluateResearchValue } from './research-value.ts';
import { sourceNeedsRetry } from './source-health.ts';
import { enabledSourceId } from './sources.ts';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { assertNoKnownSecret, type LlmProvider } from '../llm/provider.ts';
import { NewsRawSave, type NewsSaveDependencies, type NewsSaveOptions } from './raw-save.ts';
import { NewsTranslations } from './translations.ts';
import type { RawStore } from '../raw/store.ts';
import { isNewsTranslationSource } from './types.ts';
import type {
  NewsCheckMode,
  NewsEdition,
  NewsItem,
  NewsSection,
  NewsSectionName,
  SourceExclusions,
  SourceResult,
} from './types.ts';

const names: NewsSectionName[] = ['fmcg', 'ai'];
export const validNewsDate = (date: string) => {
  if (!/^\d{4}-\d\d-\d\d$/u.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
};
const validItem = (item: NewsItem) => {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof item.id !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.sourceId !== 'string' ||
    typeof item.sourceName !== 'string' ||
    typeof item.url !== 'string' ||
    typeof item.fetchedAt !== 'string' ||
    typeof item.excerpt !== 'string' ||
    (item.author !== undefined && typeof item.author !== 'string') ||
    (item.publishedAt !== null && typeof item.publishedAt !== 'string') ||
    !['article_excerpt', 'source_summary'].includes(item.evidenceKind)
  )
    return false;
  try {
    const url = new URL(item.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};
const publishedTime = (value: string | null) =>
  value
    ? Date.parse(
        /^\d{4}-\d\d$/u.test(value)
          ? value + '-01T00:00:00+08:00'
          : /^\d{4}-\d\d-\d\d$/u.test(value)
            ? value + 'T00:00:00+08:00'
            : value,
      )
    : NaN;
const compareResearch = (a: { priority: number; published: number }, b: { priority: number; published: number }) =>
  b.priority - a.priority || b.published - a.published;
export const shanghaiDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
export class NewsError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}
export class NewsService {
  private queue = new SerialQueue();
  private active = new Set<string>();
  private launched = new Map<string, Promise<void>>();
  private pending = new Map<
    string,
    {
      section: Pick<
        NewsSection,
        'status' | 'finishedAt' | 'sources' | 'items' | 'sourceItems' | 'error' | 'shortageReasons' | 'checkMessage'
      >;
      researchOverflow: NewsItem[];
    }
  >();
  private readonly translations: NewsTranslations;
  constructor(
    private deps: {
      root: string;
      clock: () => Date;
      readSources: (
        section: NewsSectionName,
        now: Date,
        exclusions?: SourceExclusions,
        sourceIds?: ReadonlySet<string>,
      ) => Promise<SourceResult>;
      aiEnabled: boolean;
      providerFactory: () => Promise<LlmProvider | undefined>;
      rawStore?: RawStore;
      rawSave?: NewsSaveDependencies;
      stageResearchOverflow?: (edition: NewsEdition) => Promise<unknown>;
    },
  ) {
    this.translations = new NewsTranslations(deps.root, deps.providerFactory);
  }
  private dir() {
    return path.join(this.deps.root, 'state', 'news');
  }
  private file(date: string) {
    if (!validNewsDate(date)) throw new NewsError('日期无效。', 400);
    return path.join(this.dir(), `${date}.json`);
  }
  private async read(date: string): Promise<NewsEdition | null> {
    const file = this.file(date);
    let text: string;
    try {
      if ((await stat(file)).size > 2 * 1024 * 1024) throw new NewsError('资讯记录超过大小限制，原文件已保留。');
      text = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    let x: NewsEdition;
    try {
      x = JSON.parse(text);
    } catch {
      throw new NewsError('资讯记录损坏，原文件已保留。');
    }
    if (
      x?.legacyFmcg &&
      (!Array.isArray(x.legacyFmcg.items) ||
        !x.legacyFmcg.items.every(validItem) ||
        !Array.isArray(x.legacyFmcg.sources) ||
        !Number.isInteger(x.legacyFmcg.attempt) ||
        !['running', 'ready', 'source_only', 'empty', 'failed', 'interrupted'].includes(x.legacyFmcg.status))
    )
      throw new NewsError('旧版资讯结构无效，原文件已保留。');
    if (
      !x ||
      x.schemaVersion !== 1 ||
      x.date !== date ||
      !x.sections ||
      typeof x.sections !== 'object' ||
      names.some(
        (n) =>
          x.sections[n] &&
          (!Array.isArray(x.sections[n]!.items) ||
            !Array.isArray(x.sections[n]!.sources) ||
            !x.sections[n]!.items.every(validItem) ||
            !Number.isInteger(x.sections[n]!.attempt) ||
            !['running', 'ready', 'source_only', 'empty', 'failed', 'interrupted'].includes(x.sections[n]!.status)),
      )
    )
      throw new NewsError('资讯记录结构无效，原文件已保留。');
    if (
      x.researchOverflow !== undefined &&
      (!Array.isArray(x.researchOverflow) || !x.researchOverflow.every(validItem))
    )
      throw new NewsError('研报候选结构无效，原文件已保留。');
    const sourceItems = x.sections.ai?.sourceItems;
    if (sourceItems !== undefined && (!Array.isArray(sourceItems) || !sourceItems.every(validItem)))
      throw new NewsError('AI 来源条目结构无效，原文件已保留。');
    return x;
  }
  private async write(x: NewsEdition) {
    x.updatedAt = this.deps.clock().toISOString();
    if (Buffer.byteLength(JSON.stringify(x, null, 2) + '\n') > 2 * 1024 * 1024)
      throw new NewsError('资讯记录超过大小限制，原文件已保留。');
    await writeJsonAtomic(this.file(x.date), x);
  }
  private project(x: NewsEdition | null) {
    if (!x) return null;
    const copy = structuredClone(x);
    if (copy.date === shanghaiDate(this.deps.clock()) && copy.sections.fmcg && !copy.sections.fmcg.contentVersion) {
      copy.legacyFmcg = copy.sections.fmcg;
      delete copy.sections.fmcg;
    }
    for (const n of names)
      if (copy.sections[n]?.status === 'running' && !this.active.has(`${copy.date}:${n}`))
        copy.sections[n]!.status = 'interrupted';
    return copy;
  }
  private saves?: NewsRawSave;
  rawSaves() {
    if (!this.deps.rawStore) throw new NewsError('资讯保存不可用。', 500);
    return (this.saves ??= new NewsRawSave(
      this.deps.root,
      this.deps.rawStore,
      () => this.deps.clock(),
      this.deps.rawSave,
    ));
  }
  async saveRaw(date: string, section: NewsSectionName, itemId: string, options?: NewsSaveOptions) {
    const edition = await this.edition(date),
      part = edition?.sections[section];
    const current =
      part?.items.find((x) => x.id === itemId) ??
      (section === 'ai' ? part?.sourceItems?.find((x) => x.id === itemId) : undefined);
    const legacy = section === 'fmcg' ? edition?.legacyFmcg : undefined;
    const item = current ?? legacy?.items.find((x) => x.id === itemId);
    if (!item) throw new NewsError('没有找到资讯。', 404);
    if (!current && legacy && !['ready', 'source_only'].includes(legacy.status))
      throw new NewsError('该期资讯当前不能保存。', 409);
    return this.rawSaves().save(date, section, item, undefined, options);
  }
  async savedRaws(date: string) {
    const edition = await this.edition(date);
    if (!edition) throw new NewsError('没有找到这期资讯。', 404);
    return this.rawSaves().projection(edition);
  }
  async translate(date: string, itemIds: string[]) {
    const edition = await this.read(date);
    if (!edition) throw new NewsError('没有找到这期资讯。', 404);
    const section = edition.sections.ai;
    const candidates = [...(section?.items ?? []), ...(section?.sourceItems ?? [])];
    const ids = [...new Set(itemIds)];
    const selected = ids.flatMap((id) => {
      const item = candidates.find((candidate) => candidate.id === id);
      return item && isNewsTranslationSource(item.sourceId) ? [item] : [];
    });
    const items = await this.translations.get(selected);
    const translated = new Set(items.map((item) => item.itemId));
    return { items, failedIds: ids.filter((id) => !translated.has(id)) };
  }
  async edition(date: string) {
    return this.project(await this.read(date));
  }
  async history() {
    let files: string[];
    try {
      files = await readdir(this.dir());
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], errors: [] };
      throw e;
    }
    const items: Array<{ date: string; sections: Partial<Record<NewsSectionName, NewsSection['status']>> }> = [],
      errors: string[] = [];
    for (const file of files
      .filter((x) => /^\d{4}-\d\d-\d\d\.json$/u.test(x))
      .sort()
      .reverse()) {
      const date = file.slice(0, 10);
      try {
        const x = await this.edition(date);
        if (x)
          items.push({
            date,
            sections: Object.fromEntries(names.filter((n) => x.sections[n]).map((n) => [n, x.sections[n]!.status])),
          });
      } catch {
        errors.push(`${date} 的记录不可读取，原文件已保留。`);
      }
    }
    return { items, errors };
  }
  async today() {
    const date = shanghaiDate(this.deps.clock()),
      edition = await this.edition(date);
    const fallbacks: Partial<Record<NewsSectionName, { date: string; section: NewsSection }>> = {};
    const history = await this.history();
    for (const row of history.items.filter((x) => x.date < date)) {
      for (const n of names) {
        if (
          fallbacks[n] ||
          edition?.sections[n]?.items.length ||
          edition?.sections[n]?.sourceItems?.length ||
          !['failed', 'interrupted'].includes(edition?.sections[n]?.status || '')
        )
          continue;
        const s = (await this.edition(row.date))?.sections[n];
        if (
          s &&
          (n === 'ai' ? s.items.length || s.sourceItems?.length : s.items.length && s.contentVersion === 'research-v1')
        )
          fallbacks[n] = { date: row.date, section: s };
      }
      if (names.every((n) => fallbacks[n] || ['ready', 'source_only'].includes(edition?.sections[n]?.status || '')))
        break;
    }
    const current = edition?.sections.fmcg,
      todayItems = current?.contentVersion === 'research-v1' ? current.items.slice(0, 5) : [];
    const recentFmcg: Array<{ date: string; item: NewsItem }> = [];
    if (todayItems.length < 5) {
      const seen = new Set(todayItems.map((x) => normalizedUrl(x.url))),
        titles = new Set(todayItems.map((x) => normalizedTitle(x.title)));
      const pdfs = new Set(todayItems.flatMap((x) => (x.research?.pdfUrl ? [normalizedUrl(x.research.pdfUrl)] : [])));
      const counts = new Map<string, number>();
      for (const item of todayItems) counts.set(item.sourceId, (counts.get(item.sourceId) || 0) + 1);
      const earliest = new Date(Date.parse(date + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
      const now = this.deps.clock().getTime(),
        cutoff = Date.parse(date + 'T00:00:00+08:00') - 364 * 86400000;
      const candidates: Array<{ date: string; item: NewsItem; priority: number; published: number }> = [];
      for (const row of history.items.filter((x) => x.date < date && x.date >= earliest)) {
        const section = (await this.edition(row.date))?.sections.fmcg;
        if (section?.contentVersion !== 'research-v1') continue;
        for (const item of section.items) {
          const published = publishedTime(item.publishedAt);
          if (!Number.isFinite(published) || published < cutoff || published > now) continue;
          const value = evaluateResearchValue(item);
          if (!value.eligible) continue;
          candidates.push({ date: row.date, item, priority: value.priority, published });
        }
      }
      for (const { date: originalDate, item } of candidates.sort(compareResearch)) {
        if (recentFmcg.length >= 5 - todayItems.length) break;
        const url = normalizedUrl(item.url),
          title = normalizedTitle(item.title);
        const pdf = item.research?.pdfUrl ? normalizedUrl(item.research.pdfUrl) : undefined;
        if (seen.has(url) || titles.has(title) || (pdf && pdfs.has(pdf)) || (counts.get(item.sourceId) || 0) >= 2)
          continue;
        seen.add(url);
        titles.add(title);
        if (pdf) pdfs.add(pdf);
        counts.set(item.sourceId, (counts.get(item.sourceId) || 0) + 1);
        recentFmcg.push({ date: originalDate, item });
      }
    }
    return { date, aiEnabled: this.deps.aiEnabled, edition, fallbacks, recentFmcg };
  }
  async ensure(): ReturnType<NewsService['today']>;
  async ensure(waitForSources: true): Promise<NewsEdition | null>;
  async ensure(waitForSources?: true) {
    const date = shanghaiDate(this.deps.clock());
    await this.startEdition(date, waitForSources ? false : this.deps.aiEnabled);
    if (!waitForSources) return this.today();
    await Promise.all(names.map((section) => this.launched.get(`${date}:${section}`)));
    return this.edition(date);
  }
  private async startEdition(date: string, analyze: boolean) {
    await this.queue.run(async () => {
      const edition = (await this.read(date)) ?? this.newEdition(date);
      const started: NewsSectionName[] = [];
      for (const section of names) {
        const previous = edition.sections[section];
        if (previous && (section !== 'fmcg' || previous.contentVersion)) continue;
        if (section === 'fmcg' && previous) edition.legacyFmcg ??= previous;
        edition.sections[section] = this.runningSection(section, 1);
        started.push(section);
      }
      if (!started.length) return;
      await this.write(edition);
      for (const section of started) this.launch(date, section, analyze);
    });
  }

  private newEdition(date: string): NewsEdition {
    return { schemaVersion: 1, date, updatedAt: this.deps.clock().toISOString(), sections: {} };
  }

  private runningSection(section: NewsSectionName, attempt: number, previous?: NewsSection): NewsSection {
    return {
      ...(section === 'fmcg' ? { contentVersion: 'research-v1' } : {}),
      status: 'running',
      attempt,
      startedAt: this.deps.clock().toISOString(),
      sources: previous?.sources ?? [],
      items: previous?.items ?? [],
      ...(previous?.sourceItems ? { sourceItems: previous.sourceItems } : {}),
    };
  }

  async check(section: NewsSectionName, mode: NewsCheckMode, attempt: number) {
    if (mode === 'failed' && section !== 'fmcg') throw new NewsError('仅快消研报支持失败来源补抓。', 400);
    return this.startCheck(section, mode, attempt, false);
  }

  async retry(section: NewsSectionName, attempt: number) {
    return this.startCheck(section, section === 'fmcg' ? 'failed' : 'all', attempt, true);
  }

  private async startCheck(section: NewsSectionName, mode: NewsCheckMode, attempt: number, legacyRetry: boolean) {
    const date = shanghaiDate(this.deps.clock()),
      key = date + ':' + section;
    const notice = await this.queue.run(async () => {
      const edition = (await this.read(date)) ?? this.newEdition(date);
      const stored = edition.sections[section];
      const previous = section === 'fmcg' && !stored?.contentVersion ? undefined : stored;
      if (
        (previous?.attempt ?? 0) !== attempt ||
        this.active.has(key) ||
        (legacyRetry && (!previous || !['failed', 'interrupted', 'running'].includes(previous.status)))
      ) {
        throw new NewsError('该栏状态已变化，请刷新后重试。', 409);
      }
      let selected: ReadonlySet<string> | undefined, scopeNotice: string | undefined;
      if (mode === 'failed' && !this.pending.has(key)) {
        const failed = previous?.sources.filter(sourceNeedsRetry) ?? [];
        const ids = failed.map((source) => enabledSourceId(section, source)).filter((id): id is string => !!id);
        const unknown = ids.length < failed.length;
        scopeNotice = unknown ? '无法定位部分旧记录中的失败来源，可用检查更新读取全部启用来源。' : undefined;
        if (ids.length) selected = new Set(ids);
        else if (!legacyRetry || unknown) return scopeNotice ?? '没有需要补抓的失败来源。';
        else scopeNotice = '上次尝试没有可用的失败来源诊断，本次检查全部启用来源。';
      }
      if (section === 'fmcg' && stored && !previous) edition.legacyFmcg ??= stored;
      edition.sections[section] = this.runningSection(section, attempt + 1, previous);
      await this.write(edition);
      this.launch(date, section, legacyRetry && section === 'ai' && this.deps.aiEnabled, selected, true, scopeNotice);
      return undefined;
    });
    return { ...(await this.today()), ...(notice ? { checkNotice: { section, message: notice } } : {}) };
  }

  private launch(
    date: string,
    section: NewsSectionName,
    analyze: boolean,
    sourceIds?: ReadonlySet<string>,
    manual = false,
    scopeNotice?: string,
  ) {
    const key = date + ':' + section;
    this.active.add(key);
    this.launched.set(
      key,
      this.run(date, section, analyze, sourceIds, manual, scopeNotice)
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(key);
          this.launched.delete(key);
        }),
    );
  }

  private async persistResult(date: string, section: NewsSectionName) {
    const key = date + ':' + section;
    await this.queue.run(async () => {
      const edition = await this.read(date),
        current = edition?.sections[section],
        result = this.pending.get(key);
      if (!edition || !current || !result) return;
      edition.sections[section] = { ...current, ...result.section };
      if (result.researchOverflow.length) {
        edition.researchOverflow = [...(edition.researchOverflow ?? []), ...result.researchOverflow];
        // Keep the running result retryable until the inbox has accepted its candidates.
        await this.deps.stageResearchOverflow?.(edition);
      }
      await this.write(edition);
      this.pending.delete(key);
    });
  }

  private async run(
    date: string,
    section: NewsSectionName,
    analyze: boolean,
    sourceIds?: ReadonlySet<string>,
    manual = false,
    scopeNotice?: string,
  ) {
    const key = date + ':' + section;
    if (this.pending.has(key)) return this.persistResult(date, section);
    const edition = await this.read(date),
      previous = edition?.sections[section];
    if (!previous) return;
    const retained = previous.items;
    const sourceItems = section === 'ai' ? [...(previous.sourceItems ?? [])] : [];
    const retainedSourceCount = sourceItems.length;
    const now = new Date(previous.startedAt);
    let status: NewsSection['status'] = 'failed',
      items = retained,
      sources = previous.sources,
      error: string | undefined,
      checkMessage: string | undefined;
    let shortageReasons: string[] = [];
    const researchOverflow: NewsItem[] = [];
    try {
      const urls = new Set<string>(),
        titles = new Set<string>(),
        pdfs = new Set<string>();
      const counts = new Map<string, number>(),
        ids = new Set<string>();
      for (const item of [...retained, ...sourceItems]) {
        ids.add(item.id);
        urls.add(normalizedUrl(item.url));
        titles.add(normalizedTitle(item.title));
        if (item.research?.pdfUrl) pdfs.add(normalizedUrl(item.research.pdfUrl));
        counts.set(item.sourceId, (counts.get(item.sourceId) || 0) + 1);
      }
      if (section === 'fmcg') {
        for (const item of edition?.researchOverflow ?? []) {
          ids.add(item.id);
          urls.add(normalizedUrl(item.url));
          titles.add(normalizedTitle(item.title));
          if (item.research?.pdfUrl) pdfs.add(normalizedUrl(item.research.pdfUrl));
        }
        const history = await this.history();
        const earliest = new Date(Date.parse(date + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
        for (const row of history.items.filter((row) => row.date < date && row.date >= earliest)) {
          const oldEdition = await this.read(row.date),
            past = oldEdition?.sections.fmcg;
          const pastItems = past?.contentVersion === 'research-v1' ? past.items : [];
          for (const item of [...pastItems, ...(oldEdition?.researchOverflow ?? [])]) {
            urls.add(normalizedUrl(item.url));
            titles.add(normalizedTitle(item.title));
            if (item.research?.pdfUrl) pdfs.add(normalizedUrl(item.research.pdfUrl));
          }
        }
      }
      const result = await this.deps.readSources(section, now, { urls, titles, pdfs }, sourceIds);
      shortageReasons = [...(result.shortageReasons || [])];
      const attempted = result.sources.map((source) => {
        const id = enabledSourceId(section, source);
        const old = previous.sources.find((old) =>
          id ? enabledSourceId(section, old) === id : old.name === source.name,
        );
        const lastSuccessAt = old?.diagnosis?.lastSuccessAt;
        return source.diagnosis && !source.diagnosis.lastSuccessAt && lastSuccessAt
          ? { ...source, diagnosis: { ...source.diagnosis, lastSuccessAt } }
          : source;
      });
      const slots = Math.max(0, 5 - retained.length);
      let duplicates = 0,
        limited = 0;
      const claim = (item: NewsItem, allowDuplicate = false) => {
        const url = normalizedUrl(item.url),
          title = normalizedTitle(item.title),
          pdf = item.research?.pdfUrl ? normalizedUrl(item.research.pdfUrl) : undefined;
        if (!allowDuplicate && (ids.has(item.id) || urls.has(url) || titles.has(title) || (pdf && pdfs.has(pdf)))) {
          duplicates++;
          const index = attempted.findIndex((source) => source.sourceId === item.sourceId);
          const source = attempted[index],
            diagnosis = source?.diagnosis;
          if (diagnosis)
            attempted[index] = {
              ...source,
              diagnosis: { ...diagnosis, counts: { ...diagnosis.counts, duplicates: diagnosis.counts.duplicates + 1 } },
            };
          return false;
        }
        ids.add(item.id);
        urls.add(url);
        titles.add(title);
        if (pdf) pdfs.add(pdf);
        return true;
      };
      const fresh: NewsItem[] = [];
      if (section === 'ai') {
        for (const item of result.items) {
          // Preserve AIHOT's initial selection, including duplicates supplied by AIHOT.
          if (!claim(item, !manual && item.sourceId === 'aihot' && fresh.length < slots)) continue;
          if (fresh.length < slots) fresh.push(item);
          else sourceItems.push(item);
        }
      } else {
        const cutoff = Date.parse(date + 'T00:00:00+08:00') - 364 * 86400000;
        let outsideFocus = 0;
        const candidates = result.items
          .flatMap((item) => {
            const published = publishedTime(item.publishedAt);
            if (!Number.isFinite(published) || published < cutoff || published > now.getTime()) return [];
            const value = evaluateResearchValue(item);
            if (!value.eligible) {
              outsideFocus++;
              return [];
            }
            return [{ item, published, priority: value.priority }];
          })
          .sort(
            (a, b) =>
              compareResearch(a, b) ||
              normalizedUrl(a.item.url).localeCompare(normalizedUrl(b.item.url)) ||
              a.item.sourceId.localeCompare(b.item.sourceId) ||
              a.item.id.localeCompare(b.item.id) ||
              a.item.url.localeCompare(b.item.url) ||
              a.item.title.localeCompare(b.item.title) ||
              a.item.excerpt.localeCompare(b.item.excerpt),
          )
          .map((row) => row.item);
        if (outsideFocus && candidates.length < slots) shortageReasons.push('部分候选缺少符合经营问题的研究依据。');
        const unplaced: NewsItem[] = [];
        for (const item of candidates) {
          const sourceCount = counts.get(item.sourceId) || 0;
          if (fresh.length >= slots || sourceCount >= 2) unplaced.push(item);
          else if (claim(item)) {
            fresh.push(item);
            counts.set(item.sourceId, sourceCount + 1);
          }
        }
        for (const item of unplaced) {
          if (!claim(item)) continue;
          researchOverflow.push(item);
          if ((counts.get(item.sourceId) || 0) >= 2) limited++;
        }
      }
      if (fresh.length < slots && duplicates) shortageReasons.push('历史或重复条目已排除。');
      if (fresh.length < slots && limited) shortageReasons.push('单一来源最多展示两条，其他合格来源不足。');
      sources = [...previous.sources];
      for (const source of attempted) {
        const id = enabledSourceId(section, source);
        const index = sources.findIndex((old) =>
          id ? enabledSourceId(section, old) === id : !old.sourceId && old.name === source.name,
        );
        if (index < 0) sources.push(source);
        else sources[index] = source;
      }
      const allFailed = attempted.every((source) => source.status === 'failed');
      const incomplete = attempted.some(sourceNeedsRetry);
      if (allFailed && !fresh.length && !researchOverflow.length) {
        status = 'failed';
        error = retained.length || retainedSourceCount ? '本次检查失败，保留上次内容。' : '所有来源读取失败。';
      } else if (!fresh.length) {
        status = retained.length
          ? retained.every((item) => item.analysis)
            ? 'ready'
            : 'source_only'
          : sourceItems.length
            ? 'source_only'
            : 'empty';
      } else if (section === 'fmcg' || !analyze) {
        items = [...retained, ...fresh];
        status = 'source_only';
      } else {
        // The normal preparation path and the legacy AI retry can still analyze fresh items.
        items = fresh.map((item) => ({ ...item }));
        const provider = await this.deps.providerFactory();
        if (!provider) throw Error('资讯 AI 未配置。');
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error('分析超时'));
          }, 60000);
        });
        const reply = await Promise.race([
          provider.complete({
            signal: controller.signal,
            system: '仅根据给定材料输出 JSON。不得补充未提供的事实、链接或日期。来源摘要并非原文。',
            user: JSON.stringify({
              items,
              format: {
                items: [
                  { id: '原条目id', fact: '事实', whyItMatters: '值得关注的原因', possibleImpact: '可能影响（推断）' },
                ],
              },
            }),
            timeoutMs: 60000,
            maxOutputBytes: 30000,
          }),
          timeout,
        ]).finally(() => clearTimeout(timer));
        if (reply.finishReason !== null && reply.finishReason !== 'stop') throw Error('分析响应未正常结束');
        if (Buffer.byteLength(reply.text) > 30000) throw Error('分析响应过大');
        const output = JSON.parse(reply.text);
        assertNoKnownSecret(output, provider.secrets);
        if (
          !output ||
          typeof output !== 'object' ||
          Object.keys(output).some((k) => k !== 'items') ||
          !Array.isArray(output.items) ||
          !output.items.length ||
          output.items.length > items.length
        )
          throw Error('分析结构无效');
        const ids = new Set<string>();
        for (const row of output.items) {
          const item = items.find((x) => x.id === row.id);
          if (
            !row ||
            typeof row !== 'object' ||
            Object.keys(row).some((k) => !['id', 'fact', 'whyItMatters', 'possibleImpact'].includes(k)) ||
            !item ||
            ids.has(row.id) ||
            !['fact', 'whyItMatters', 'possibleImpact'].every(
              (k) => typeof row[k] === 'string' && row[k].trim() && row[k].length <= 1500,
            )
          )
            throw Error('分析结构无效');
          ids.add(row.id);
          item.analysis = { fact: row.fact, whyItMatters: row.whyItMatters, possibleImpact: row.possibleImpact };
        }
        items = items.filter((x) => ids.has(x.id));
        status = 'ready';
        items = [...retained, ...items];
      }
      if (researchOverflow.length && this.deps.stageResearchOverflow) {
        const added = fresh.length
          ? `本次新增 ${fresh.length} 条。`
          : !slots
            ? '已检查，本期已满5条，保留已收录内容。'
            : '';
        checkMessage = `${added}${researchOverflow.length} 条合格研报已送至自动化的资讯候选收件箱。`;
      } else if (manual && status !== 'failed') {
        const added = fresh.length + sourceItems.length - retainedSourceCount;
        if (section === 'fmcg' && !slots) checkMessage = '已检查，本期已满5条，保留已收录内容。';
        else if (added) checkMessage = '本次新增 ' + added + ' 条。';
        else if (incomplete) checkMessage = '部分来源未能完整读取。';
        else if (
          shortageReasons.some((reason) => reason.includes('重复')) ||
          attempted.some((source) => source.diagnosis?.counts.duplicates)
        )
          checkMessage = '本次检查已排除重复条目。';
        else if (attempted.some((source) => source.diagnosis?.counts.rejected))
          checkMessage = '本次检查没有达到正文要求的新增条目。';
        else checkMessage = '本次检查未找到新增。';
      }
    } catch {
      status = 'failed';
      error = retained.length || retainedSourceCount ? '本次检查失败，保留上次内容。' : '资讯读取或分析失败，请重试。';
      items = retained;
      researchOverflow.length = 0;
    }
    if (items.length < 5 && !shortageReasons.length) {
      shortageReasons = [
        section === 'ai' ? '本次来源或分析最终提供 ' + items.length + ' 条可展示内容。' : '合格候选不足。',
      ];
    }
    if (scopeNotice) checkMessage = [scopeNotice, checkMessage].filter(Boolean).join(' ');
    this.pending.set(key, {
      section: {
        shortageReasons,
        status,
        finishedAt: this.deps.clock().toISOString(),
        sources,
        items,
        ...(sourceItems.length ? { sourceItems } : {}),
        error,
        checkMessage,
      },
      researchOverflow,
    });
    return this.persistResult(date, section);
  }
}
