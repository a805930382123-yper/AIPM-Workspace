import type { InspectionDerivation } from './inspection-input.ts';
import type { AnswerDerivation } from './question-input.ts';
import type { PdfDerivation } from './pdf-input.ts';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { assertFormalWriteAllowed } from '../automation/context.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { RawStore } from '../raw/store.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import type { WikiSearchIndexer } from '../search/indexer.ts';
import { civilDate, readReviewCycleDays, wikiReviewDate, type WikiFreshnessFields } from './freshness.ts';
import { ReviewTriggerStore } from './review-triggers.ts';
import { assertWikiSourcesAllowed } from './source-lineage.ts';

const sourceFileStart = /^---\r?\n/;
const idPattern = /^[0-9a-f-]{36}$/i;
const here = path.dirname(fileURLToPath(import.meta.url));
// Keep js-yaml's existing value semantics for all other metadata, including unknown timestamp fields.
const defaultTimestamp = (yaml as typeof yaml & { types: { timestamp: yaml.Type } }).types.timestamp;
const timestampLiteral = new WeakMap<Date, string>();
const wikiYamlSchema = yaml.DEFAULT_SCHEMA.extend({
  implicit: [
    new yaml.Type('tag:yaml.org,2002:timestamp', {
      kind: 'scalar',
      resolve: defaultTimestamp.resolve,
      instanceOf: Date,
      represent(value) {
        const date = value as Date;
        return timestampLiteral.get(date) ?? date.toISOString();
      },
      construct(value: string) {
        const date: Date = defaultTimestamp.construct(value);
        timestampLiteral.set(date, value);
        return date;
      },
    }),
  ],
});

export type WikiType = 'source' | 'concept' | 'entity' | 'business_process' | 'metric' | 'synthesis';
export type KnowledgeStatus = 'verified' | 'source_supported' | 'ai_organized' | 'inferred' | 'needs_verification';
export type Confidence = 'high' | 'medium' | 'low';
export type SourceLevel = 'A' | 'B' | 'C' | 'D';
export type ReviewStatus = 'unreviewed' | 'reviewed';
export type WikiRecord = WikiFreshnessFields & {
  pdfDerivations?: PdfDerivation[];
  inspectionDerivations?: InspectionDerivation[];
  answerDerivations?: AnswerDerivation[];
  id: string;
  title: string;
  type: WikiType;
  domain: 'fmcg';
  category: string;
  created: string;
  updated: string;
  sources: string[];
  tags: string[];
  knowledge_status: KnowledgeStatus;
  confidence: Confidence;
  source_level: SourceLevel;
  review_status: ReviewStatus;
  aliases: string[];
  revision: number;
  body: string;
  isDemo?: boolean;
};
export type WikiInput = Omit<
  WikiRecord,
  keyof WikiFreshnessFields | 'id' | 'domain' | 'created' | 'updated' | 'revision'
>;
type Schema = {
  domain: string;
  types: Array<{ id: WikiType; label: string; description: string }>;
  categories: Array<{ id: string; label: string }>;
  enums: Record<string, string[]>;
};
type PageTemplates = {
  templates: Record<WikiType, { sections: Array<{ key: string; label: string; hint?: string }> }>;
};
type SourcePolicy = { levels: Array<{ id: SourceLevel; label: string; description: string }>; guidance: string };
export type WikiSchema = Schema & { pageTemplates: PageTemplates['templates']; sourcePolicy: SourcePolicy };
export type WikiLink = {
  text: string;
  status: 'found' | 'missing' | 'ambiguous';
  candidates: Array<{ id: string; title: string }>;
};
export type WikiReference = {
  pageId: string;
  title: string;
  text: string;
  status: 'found' | 'ambiguous';
  candidates: string[];
};
type ChangeAction = 'create' | 'update' | 'delete' | 'audit';
type PendingChange = {
  operationId: string;
  action: ChangeAction;
  id: string;
  title: string;
  type: WikiType;
  revision: number;
  isDemo?: boolean;
  phase: 'prepared' | 'committed';
};

export class WikiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim().replace(/\s+/gu, ' ');
}
function wikiDir(root: string) {
  return path.join(root, 'knowledge', 'wiki');
}
export function wikiPageIdFromFilename(name: string): string | undefined {
  const id = name.replace(/\.md$/i, '');
  return name.toLowerCase().endsWith('.md') && idPattern.test(id) ? id : undefined;
}
function recordPath(root: string, id: string) {
  return path.join(wikiDir(root), `${id}.md`);
}
function frontmatter(record: WikiRecord) {
  const { body, ...metadata } = record;
  const content =
    record.isDemo && !body.startsWith('> 【演示数据】') ? `> 【演示数据】虚构教学内容，尚未核验。\n\n${body}` : body;
  return `---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true }).trimEnd()}\n---\n# ${metadata.title}\n\n${content}`;
}
function splitWikiMarkdown(markdown: string) {
  if (!sourceFileStart.test(markdown)) throw new WikiError('CORRUPT_WIKI', 'Wiki 文件缺少 YAML Frontmatter。', 500);
  const rest = markdown.replace(sourceFileStart, '');
  const close = rest.search(/^---\r?\n/m);
  if (close < 0) throw new WikiError('CORRUPT_WIKI', 'Wiki 文件 Frontmatter 未闭合。', 500);
  const delimiter = sourceFileStart.exec(rest.slice(close))![0];
  return {
    yamlText: rest.slice(0, close),
    suffix: rest.slice(close + delimiter.length),
    delimiter,
  };
}
export function parseWikiMarkdown(markdown: string): WikiRecord {
  const { yamlText, suffix } = splitWikiMarkdown(markdown);
  const metadata = yaml.load(yamlText, { schema: wikiYamlSchema }) as Record<string, unknown> | undefined;
  if (metadata) {
    for (const key of ['last_verified_at', 'source_published_at']) {
      if (!Object.hasOwn(metadata, key)) continue;
      const value = metadata[key];
      metadata[key] = civilDate(value instanceof Date ? timestampLiteral.get(value) : value);
    }
    if (Object.hasOwn(metadata, 'review_cycle_days'))
      metadata.review_cycle_days = readReviewCycleDays(metadata.review_cycle_days);
    if (Object.hasOwn(metadata, 'review_trigger_checkpoint')) {
      metadata.review_trigger_checkpoint = readReviewCycleDays(metadata.review_trigger_checkpoint) ?? undefined;
    }
  }
  const body = suffix.replace(/^# [^\r\n]*(?:\r?\n){2}/, '');
  return { ...metadata, body } as WikiRecord;
}
async function writeAtomic(target: string, value: string) {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, value, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
function mdCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export class WikiStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly rulesDir: string;
  private readonly recycleDir: string;
  private readonly logFile: string;
  private readonly pendingDir: string;
  readonly reviewTriggers: ReviewTriggerStore;

  constructor(
    public readonly root: string,
    private readonly rawStore: RawStore,
    rulesDir = path.resolve(here, '..', '..', 'rules'),
    public readonly searchIndex?: WikiSearchIndexer,
  ) {
    this.rulesDir = rulesDir;
    this.recycleDir = path.join(root, 'knowledge', 'recycle', 'wiki');
    this.logFile = path.join(root, 'knowledge', 'logs', 'wiki.jsonl');
    this.pendingDir = path.join(root, 'state', 'wiki-operations');
    this.reviewTriggers = searchIndex?.reviewTriggers ?? new ReviewTriggerStore(root);
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async initialize() {
    assertFormalWriteAllowed();
    await mkdir(wikiDir(this.root), { recursive: true });
    await mkdir(this.recycleDir, { recursive: true });
    await mkdir(path.dirname(this.logFile), { recursive: true });
    await mkdir(this.pendingDir, { recursive: true });
    await this.recoverPending();
    await this.rebuildIndex();
  }

  async schema(): Promise<WikiSchema> {
    const [schemaText, templateText, policyText] = await Promise.all([
      readFile(path.join(this.rulesDir, 'fmcg-schema.yaml'), 'utf8'),
      readFile(path.join(this.rulesDir, 'page-templates.yaml'), 'utf8'),
      readFile(path.join(this.rulesDir, 'source-policy.yaml'), 'utf8'),
    ]);
    const schema = yaml.load(schemaText) as Schema;
    const templates = yaml.load(templateText) as PageTemplates;
    const sourcePolicy = yaml.load(policyText) as SourcePolicy;
    return { ...schema, pageTemplates: templates.templates, sourcePolicy };
  }

  private async files(): Promise<string[]> {
    return (await readdir(wikiDir(this.root)).catch(() => []))
      .filter(wikiPageIdFromFilename)
      .map((name) => path.join(wikiDir(this.root), name));
  }
  private async records(): Promise<WikiRecord[]> {
    const records = await Promise.all(
      (await this.files()).map(async (file) => parseWikiMarkdown(await readFile(file, 'utf8'))),
    );
    return records.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, 'zh-CN'));
  }
  async list(
    options: { q?: string; category?: string } = {},
    pages?: WikiRecord[],
    schema?: WikiSchema,
  ): Promise<WikiRecord[]> {
    const records = pages ?? (await this.records());
    const terms = options.q ? normalize(options.q).split(' ').filter(Boolean) : [];
    const categoryLabels = new Map(
      (schema ?? (await this.schema())).categories.map((category) => [category.id, category.label]),
    );
    return records.filter((record) => {
      if (options.category && record.category !== options.category) return false;
      if (!terms.length) return true;
      const categoryLabel = categoryLabels.get(record.category) ?? record.category;
      const fields = [record.title, ...record.aliases, ...record.tags, record.category, categoryLabel, record.body].map(
        normalize,
      );
      return terms.every((term) => fields.some((field) => field.includes(term)));
    });
  }
  async categoryCounts(records?: WikiRecord[], schema?: WikiSchema): Promise<Record<string, number>> {
    const [pages, rules] = await Promise.all([records ?? this.records(), schema ?? this.schema()]);
    const counts = Object.fromEntries(rules.categories.map((category) => [category.id, 0]));
    for (const page of pages) if (page.category in counts) counts[page.category]++;
    return counts;
  }
  async get(id: string): Promise<WikiRecord | undefined> {
    if (!idPattern.test(id)) return undefined;
    try {
      return parseWikiMarkdown(await readFile(recordPath(this.root, id), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private async validateSources(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const raw = await this.rawStore.get(id);
      if (!raw) throw new WikiError(`INVALID_SOURCE`, `Raw source not found: ${id}`);
      assertRawNotMeeting(raw);
    }
    return unique;
  }
  async assertRecordSourcesAllowed(record: WikiRecord): Promise<void> {
    for (const id of record.sources) assertRawNotMeeting(await this.rawStore.get(id));
    for (const { rawId } of record.pdfDerivations ?? []) {
      const raw = await this.rawStore.get(rawId);
      if (!raw) throw new WikiError('KNOWLEDGE_SOURCE_MISSING', 'PDF 依据的原始资料已缺失。', 409);
      assertRawNotMeeting(raw);
    }
  }
  private async validateRecord(input: WikiInput): Promise<WikiInput> {
    const rules = await this.schema();
    if (!rules.types.some((type) => type.id === input.type)) throw new WikiError('INVALID_TYPE', 'Wiki 类型无效。');
    if (!rules.categories.some((category) => category.id === input.category))
      throw new WikiError('INVALID_CATEGORY', 'Wiki 分类无效。');
    if (!rules.enums.knowledge_status.includes(input.knowledge_status))
      throw new WikiError('INVALID_KNOWLEDGE_STATUS', '知识状态无效。');
    if (!rules.enums.confidence.includes(input.confidence)) throw new WikiError('INVALID_CONFIDENCE', '可信度无效。');
    if (!rules.enums.source_level.includes(input.source_level))
      throw new WikiError('INVALID_SOURCE_LEVEL', '来源等级无效。');
    if (!rules.enums.review_status.includes(input.review_status))
      throw new WikiError('INVALID_REVIEW_STATUS', '审核状态无效。');
    const title = input.title.trim();
    if (!title || title.length > 300 || /[\r\n]/.test(title))
      throw new WikiError('INVALID_TITLE', '标题不能为空、不能换行且最多 300 字符。');
    if (typeof input.body !== 'string' || !input.body.trim())
      throw new WikiError('EMPTY_CONTENT', 'Wiki 正文不能为空。');
    if (!Array.isArray(input.sources) || !Array.isArray(input.tags) || !Array.isArray(input.aliases))
      throw new WikiError('INVALID_FIELDS', '来源、标签和别名必须为列表。');
    const sources = await this.validateSources(input.sources);
    if (input.type === 'source' && sources.length !== 1)
      throw new WikiError('SOURCE_REQUIRES_ONE_RAW', '来源摘要必须关联且只关联一条 Raw。');
    if (input.knowledge_status === 'verified' && (!sources.length || input.review_status !== 'reviewed')) {
      throw new WikiError('STATUS_REQUIRES_REVIEWED_SOURCE', 'verified 必须关联有效 Raw 来源且审核状态为 reviewed。');
    }
    if (input.knowledge_status === 'source_supported' && !sources.length) {
      throw new WikiError('STATUS_REQUIRES_SOURCE', 'source_supported 必须关联有效 Raw 来源。');
    }
    const { pdfDerivations: _protectedPdfDerivations, ...editable } = input;
    return {
      ...editable,
      title,
      sources,
      aliases: [...new Set(input.aliases.map((v) => v.trim()).filter(Boolean))],
      tags: [...new Set(input.tags.map((v) => v.trim()).filter(Boolean))],
    };
  }

  async create(input: WikiInput): Promise<WikiRecord> {
    return this.createWithId(input, randomUUID(), false);
  }

  async createDemo(input: WikiInput, id: string): Promise<WikiRecord> {
    return this.createWithId(input, id, true);
  }

  private async createWithId(input: WikiInput, id: string, isDemo: boolean): Promise<WikiRecord> {
    return this.serialized(async () => {
      const existing = await this.get(id);
      if (existing) return existing;
      const clean = await this.validateRecord(input);
      const now = new Date().toISOString();
      const record: WikiRecord = {
        ...clean,
        id,
        domain: 'fmcg',
        created: now,
        updated: now,
        revision: 1,
        ...(isDemo ? { isDemo: true } : {}),
      };
      await this.commitChange('create', record, () =>
        writeAtomic(recordPath(this.root, record.id), frontmatter(record)),
      );
      return record;
    });
  }

  async update(id: string, baseRevision: number, input: WikiInput): Promise<WikiRecord> {
    return this.serialized(async () => {
      const current = await this.get(id);
      if (!current) throw new WikiError('NOT_FOUND', '没有找到这条 Wiki。', 404);
      await this.assertRecordSourcesAllowed(current);
      if (baseRevision !== current.revision)
        throw new WikiError('REVISION_CONFLICT', '页面已经被修改，请刷新后重新编辑。', 409, {
          currentRevision: current.revision,
        });
      const clean = await this.validateRecord(input);
      const aliases = [...clean.aliases];
      if (
        normalize(current.title) !== normalize(clean.title) &&
        !aliases.some((alias) => normalize(alias) === normalize(current.title))
      )
        aliases.push(current.title);
      const updated: WikiRecord = {
        ...current,
        ...clean,
        ...(current.inspectionDerivations
          ? { inspectionDerivations: structuredClone(current.inspectionDerivations) }
          : {}),
        id: current.id,
        domain: 'fmcg',
        created: current.created,
        updated: new Date().toISOString(),
        revision: current.revision + 1,
        aliases,
        ...(current.isDemo ? { isDemo: true } : {}),
      };
      if (current.pdfDerivations) {
        updated.pdfDerivations = current.pdfDerivations;
        updated.sources = [...new Set([...updated.sources, ...current.pdfDerivations.map((item) => item.rawId)])];
      }
      await this.commitChange('update', updated, () => writeAtomic(recordPath(this.root, id), frontmatter(updated)));
      return updated;
    });
  }

  async review(
    id: string,
    baseRevision: number,
    action: { kind: 'confirm' } | { kind: 'snooze' } | { kind: 'cycle'; days: number | null },
    verify?: () => Promise<void>,
  ): Promise<WikiRecord> {
    return this.withLock(async () => {
      const markdown = await this.readPageFile(id);
      if (markdown === undefined) throw new WikiError('NOT_FOUND', '没有找到这条 Wiki。', 404);
      const current = parseWikiMarkdown(markdown);
      await assertWikiSourcesAllowed(this, this.rawStore, current);
      if (baseRevision !== current.revision)
        throw new WikiError('REVISION_CONFLICT', '页面已经被修改，请刷新后重新复核。', 409, {
          currentRevision: current.revision,
        });
      await verify?.();
      const now = new Date();
      const date = wikiReviewDate(now);
      if (action.kind === 'snooze') {
        assertFormalWriteAllowed();
        await this.reviewTriggers.appendEvent([id], { kind: 'snooze', date }, current.review_trigger_checkpoint);
        return current;
      }
      const patch =
        action.kind === 'confirm'
          ? {
              last_verified_at: date,
              review_trigger_checkpoint: (await this.reviewTriggers.read())[id]?.events?.length ?? 0,
            }
          : { review_cycle_days: action.days };
      const { yamlText, suffix, delimiter } = splitWikiMarkdown(markdown);
      const metadata = yaml.load(yamlText, { schema: wikiYamlSchema }) as Record<string, unknown>;
      const changed = Object.assign(metadata, patch, { updated: now.toISOString(), revision: current.revision + 1 });
      const newline = delimiter.slice(3);
      const yamlOutput = yaml.dump(changed, { schema: wikiYamlSchema, lineWidth: -1 }).replace(/\n/gu, newline);
      const next = delimiter + yamlOutput + delimiter + suffix;
      const updated = parseWikiMarkdown(next);
      await this.commitChange('update', updated, () => writeAtomic(recordPath(this.root, id), next));
      return updated;
    });
  }

  async delete(id: string, baseRevision: number): Promise<{ id: string; title: string; references: WikiReference[] }> {
    return this.serialized(async () => {
      const current = await this.get(id);
      if (!current) throw new WikiError('NOT_FOUND', '没有找到这条 Wiki。', 404);
      await this.assertRecordSourcesAllowed(current);
      if (baseRevision !== current.revision)
        throw new WikiError('REVISION_CONFLICT', '页面已经被修改，请刷新后重新确认删除。', 409, {
          currentRevision: current.revision,
        });
      const references = await this.references(id);
      await mkdir(this.recycleDir, { recursive: true });
      const target = path.join(this.recycleDir, `${id}.md`);
      await this.commitChange('delete', current, () => rename(recordPath(this.root, id), target));
      return { id, title: current.title, references };
    });
  }

  /**
   * B03: formal Wiki pages whose `sources` point at this Raw. Only pages inside the
   * formal Wiki directory count; recycled pages and index.md are not references.
   */
  async referencesToRaw(rawId: string): Promise<Array<{ id: string; title: string; type: WikiType }>> {
    const pages = await this.records();
    return pages
      .filter((page) => page.sources.includes(rawId))
      .map((page) => ({ id: page.id, title: page.title, type: page.type }));
  }

  /**
   * B03: run work on the same queue as Wiki writes. Raw deletion uses this so a Raw can
   * never be removed while a Wiki save that still validates it as a source is in flight.
   */
  async withLock<T>(work: () => Promise<T>): Promise<T> {
    return this.serialized(work);
  }

  /**
   * B04: helpers for the confirmed AI-commit path. They never take the write queue, so they
   * are safe to call from inside `withLock` (calling the public create there would deadlock).
   */
  async allRecords(): Promise<WikiRecord[]> {
    return this.records();
  }

  async allVisibleRecords(): Promise<WikiRecord[]> {
    const records = await this.records();
    const allowed = await Promise.all(
      records.map((page) =>
        assertWikiSourcesAllowed(this, this.rawStore, page).then(
          () => true,
          () => false,
        ),
      ),
    );
    return records.filter((_, index) => allowed[index]);
  }

  /** The exact Markdown that will be written for a record; used for snapshot digests. */
  pageContent(record: WikiRecord): string {
    return frontmatter(record);
  }

  /** Raw file text of a page (undefined when it does not exist) — used for write verification. */
  async readPageFile(id: string): Promise<string | undefined> {
    if (!idPattern.test(id)) return undefined;
    try {
      return await readFile(recordPath(this.root, id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Writes one formal page atomically without touching the Index or the Log. */
  async writePageLocked(record: WikiRecord): Promise<void> {
    assertFormalWriteAllowed();
    const target = recordPath(this.root, record.id);
    await writeAtomic(target, frontmatter(record));
    await this.searchIndex?.syncPage(target);
  }

  /** Appends knowledge-log entries for one committed operation, deduplicated by operationId+id. */
  async appendLogLocked(
    entries: Array<{
      operationId: string;
      action: ChangeAction;
      id: string;
      title: string;
      type: WikiType;
      revision: number;
      isDemo?: boolean;
    }>,
  ): Promise<void> {
    assertFormalWriteAllowed();
    if (!entries.length) return;
    const seen = new Set<string>();
    for (const line of (await readFile(this.logFile, 'utf8').catch(() => '')).split(/\r?\n/)) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { operationId?: string; id?: string; action?: string };
        seen.add(`${parsed.operationId ?? ''}|${parsed.id ?? ''}|${parsed.action ?? ''}`);
      } catch {
        continue;
      }
    }
    const lines = entries
      .filter((entry) => !seen.has(`${entry.operationId}|${entry.id}|${entry.action}`))
      .map((entry) => JSON.stringify({ ...entry, isDemo: entry.isDemo === true, time: new Date().toISOString() }));
    if (!lines.length) return;
    await mkdir(path.dirname(this.logFile), { recursive: true });
    await appendFile(this.logFile, `${lines.join('\n')}\n`, 'utf8');
  }

  async rebuildIndexLocked(): Promise<void> {
    await this.rebuildIndex();
  }

  async references(id: string, visibleOnly = false): Promise<WikiReference[]> {
    const target = await this.get(id);
    if (!target) return [];
    const pages = visibleOnly ? await this.allVisibleRecords() : await this.records();
    const aliases = new Set([normalize(target.title), ...target.aliases.map(normalize)]);
    const incoming: WikiReference[] = [];
    for (const page of pages) {
      if (page.id === id) continue;
      for (const [, rawText] of page.body.matchAll(/\[\[([^\]]+)\]\]/gu)) {
        const text = rawText.trim();
        if (!aliases.has(normalize(text))) continue;
        const candidates = pages.filter((candidate) =>
          [candidate.title, ...candidate.aliases].some((name) => normalize(name) === normalize(text)),
        );
        incoming.push({
          pageId: page.id,
          title: page.title,
          text,
          status: candidates.length > 1 ? 'ambiguous' : 'found',
          candidates: candidates.map((candidate) => candidate.id),
        });
      }
    }
    return incoming;
  }
  async links(id: string, visibleOnly = false): Promise<WikiLink[]> {
    const record = await this.get(id);
    if (!record) return [];
    const matches = [...record.body.matchAll(/\[\[([^\]]+)\]\]/gu)];
    if (!matches.length) return [];
    const pages = visibleOnly ? await this.allVisibleRecords() : await this.records();
    const links = new Map<string, WikiLink>();
    for (const [, rawText] of matches) {
      const text = rawText.trim();
      const candidates = pages.filter((page) =>
        [page.title, ...page.aliases].some((name) => normalize(name) === normalize(text)),
      );
      links.set(text, {
        text,
        status: candidates.length === 1 ? 'found' : candidates.length ? 'ambiguous' : 'missing',
        candidates: candidates.map((page) => ({ id: page.id, title: page.title })),
      });
    }
    return [...links.values()];
  }
  async exportMarkdown(id: string): Promise<{ record: WikiRecord; markdown: string } | undefined> {
    const record = await this.get(id);
    if (!record) return undefined;
    return { record, markdown: frontmatter(record) };
  }

  async rebuildIndex(): Promise<void> {
    assertFormalWriteAllowed();
    const records = await this.records();
    const lines = [
      '# FMCG Wiki Index',
      '',
      '> 此文件由工作台根据正式 Wiki Markdown 重建；请编辑原始页面。',
      '',
      '| ID | 标题 | 类型 | 分类 | 别名 |',
      '|---|---|---|---|---|',
    ];
    for (const record of records)
      lines.push(
        `| ${record.id} | [[${mdCell(record.title)}]] | ${record.type} | ${mdCell(record.category)} | ${mdCell(record.aliases.join('、'))} |`,
      );
    await writeAtomic(path.join(wikiDir(this.root), 'index.md'), `${lines.join('\n')}\n`);
  }

  private pendingPath(operationId: string) {
    return path.join(this.pendingDir, `${operationId}.json`);
  }

  private async commitChange(action: ChangeAction, record: WikiRecord, writeAsset: () => Promise<void>) {
    assertFormalWriteAllowed();
    const operationId = randomUUID();
    const { body: _body, ...metadata } = record;
    const pending: PendingChange = {
      operationId,
      action,
      id: record.id,
      title: record.title,
      type: record.type,
      revision: record.revision,
      isDemo: record.isDemo === true,
      phase: 'prepared',
    };
    const pendingPath = this.pendingPath(operationId);
    await writeAtomic(pendingPath, JSON.stringify({ ...pending, record: metadata }));
    try {
      await writeAsset();
    } catch (error) {
      await rm(pendingPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (action === 'delete') await this.searchIndex?.removePage(record.id);
    else await this.searchIndex?.syncPage(recordPath(this.root, record.id));
    try {
      await writeAtomic(pendingPath, JSON.stringify({ ...pending, record: metadata, phase: 'committed' }));
      await this.ensureLog(pending);
      await this.rebuildIndex();
      await rm(pendingPath, { force: true });
    } catch (error) {
      throw new WikiError(
        'DERIVED_FILES_PENDING',
        `Wiki 已保存（${record.id}，第 ${record.revision} 版），但 Index 或 Log 尚未完成。记录已保存在本机待恢复队列，重新启动工作台会自动修复；请先刷新列表，不要重复创建。`,
        500,
        {
          committed: true,
          id: record.id,
          revision: record.revision,
          operationId,
          recoverable: true,
          cause: error instanceof Error ? error.message : 'unknown',
        },
      );
    }
  }

  private async ensureLog(change: PendingChange) {
    const oldLog = await readFile(this.logFile, 'utf8').catch(() => '');
    if (
      oldLog.split(/\r?\n/).some((line) => {
        if (!line) return false;
        try {
          return (JSON.parse(line) as { operationId?: string }).operationId === change.operationId;
        } catch {
          return false;
        }
      })
    )
      return;
    await appendFile(
      this.logFile,
      `${JSON.stringify({ operationId: change.operationId, time: new Date().toISOString(), action: change.action, id: change.id, title: change.title, type: change.type, revision: change.revision, isDemo: change.isDemo === true })}\n`,
      'utf8',
    );
  }

  private async changeApplied(change: PendingChange): Promise<boolean> {
    if (change.action === 'delete') {
      try {
        await readFile(path.join(this.recycleDir, `${change.id}.md`), 'utf8');
        return true;
      } catch {
        return false;
      }
    }
    const record = await this.get(change.id);
    return !!record && record.revision >= change.revision;
  }

  private async recoverPending() {
    const names = await readdir(this.pendingDir).catch(() => []);
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      const pendingPath = path.join(this.pendingDir, name);
      const pending = JSON.parse(await readFile(pendingPath, 'utf8')) as PendingChange;
      if (!(await this.changeApplied(pending))) {
        await rm(pendingPath, { force: true });
        continue;
      }
      await this.ensureLog(pending);
    }
    await this.rebuildIndex();
    for (const name of names.filter((item) => item.endsWith('.json')))
      await rm(path.join(this.pendingDir, name), { force: true });
  }
}
