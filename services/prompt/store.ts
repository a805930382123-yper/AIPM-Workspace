// B07: the Prompt Library. One active JSON record per prompt under `<root>/prompts/<id>.json`
// holding both the `current` object and every immutable version snapshot, so "current updated but
// history lost" cannot happen through two separate files. Each effective save appends a full
// snapshot and bumps `version`; a save with no change does not bump the version nor the time.
//
// The library is decoupled from the knowledge base: it only *reads* Wiki titles for the
// "related Wiki" display and never writes to knowledge/, never appends to the knowledge log.
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { readJsonFile, SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import type { WikiStore } from '../wiki/store.ts';
import { PromptError } from './errors.ts';
import { feedbackData, feedbackDto, feedbackInput, feedbackDeleteInput, feedbackHash, type Feedback, type FeedbackDto } from './feedback.ts';
import { canonicalInput, normalizePromptInput, requireUuid, type PromptInput } from './validate.ts';
import { extractVariables, renderTemplate } from './variables.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PromptSource = 'manual' | 'ai_generated' | 'optimized';
export type PromptChangeSource = 'manual' | 'ai_generated' | 'ai_optimized';

export type Prompt = {
  id: string; name: string; category: string; scenario: string;
  body: string; variables: string[];
  inputRequirements: string; outputRequirements: string;
  relatedWikiIds: string[]; examples: string; tags: string[]; favorite: boolean;
  createdAt: string; updatedAt: string; version: number;
  source: PromptSource;
  isDemo?: boolean;
};
export type PromptVersion = { version: number; savedAt: string; changeSource: PromptChangeSource; snapshot: Prompt };
export type PromptCategory = { id: string; label: string; help?: string };

/** Reuse key for one explicit "new prompt" editing session (the UI generates the UUID). */
type CreationRecord = { requestId: string; input: PromptInput; createdAt: string };
type PromptFile = { feedback?:unknown; id: string; current: Prompt; versions: PromptVersion[]; creation: CreationRecord; aiConfirmations?: Record<string, { mode: 'new' | 'version'; payload: string; version: number }> };

export type WikiLinkStatus = { id: string; title: string | null; status: 'resolved' | 'missing' };
export type PromptListOptions = { q?: string; category?: string; tag?: string; favorite?: boolean };

export type PromptRenderResult = { id: string; version: number; body: string; missingVariables: string[] };

/** Same Unicode normalization the Wiki search uses, so Chinese queries behave identically. */
function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim().replace(/\s+/gu, ' ');
}
function clone<T>(value: T): T { return structuredClone(value); }

function promptDir(root: string) { return path.join(root, 'prompts'); }
function recycleDir(root: string) { return path.join(root, 'prompts', 'recycle'); }
function recordPath(root: string, id: string) { return path.join(promptDir(root), `${id}.json`); }
function recycledPath(root: string, id: string) { return path.join(recycleDir(root), `${id}.json`); }

/** Active records only: top-level `<uuid>.json`. Recycled, temporary and unrelated JSON never count. */
async function activeFiles(root: string): Promise<Array<{ id: string; file: string }>> {
  const names = await readdir(promptDir(root)).catch(() => []);
  return names
    .filter(name => name.toLowerCase().endsWith('.json') && idPattern.test(name.slice(0, -5)))
    .sort()
    .map(name => ({ id: name.slice(0, -5), file: path.join(promptDir(root), name) }));
}

// B07 repair (F07-01): a stored file counts as a usable Prompt only when it is structurally complete
// *and* internally consistent. The previous check ("`id` exists and `versions` is an array") let a
// truncated file such as `{id,current:{id},versions:[],creation:{}}` inflate the homepage count and
// then fail later with an unrelated internal error, because `current.relatedWikiIds` was missing.
// Damage is never repaired, rewritten or deleted here — it is simply not counted, and reading it
// directly answers with a controlled `CORRUPT_PROMPT` error.
const PROMPT_SOURCES: readonly string[] = ['manual', 'ai_generated', 'optimized'];
const CHANGE_SOURCES: readonly string[] = ['manual', 'ai_generated', 'ai_optimized'];

function isText(value: unknown): value is string { return typeof value === 'string'; }
function isTextList(value: unknown): value is string[] { return Array.isArray(value) && value.every(isText); }

/** Key-order independent serialization, so `current` can be compared with its own snapshot. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Every field the server itself maintains must be present and of the documented type. */
function isPromptShape(value: unknown, id: string): value is Prompt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prompt = value as Prompt;
  return prompt.id === id
    && isText(prompt.name) && isText(prompt.category) && isText(prompt.scenario) && isText(prompt.body)
    && isTextList(prompt.variables) && isText(prompt.inputRequirements) && isText(prompt.outputRequirements)
    && isTextList(prompt.relatedWikiIds) && isText(prompt.examples) && isTextList(prompt.tags)
    && typeof prompt.favorite === 'boolean' && isText(prompt.createdAt) && isText(prompt.updatedAt)
    && Number.isInteger(prompt.version) && prompt.version >= 1
    && PROMPT_SOURCES.includes(prompt.source)
    && (prompt.isDemo === undefined || typeof prompt.isDemo === 'boolean');
}

function isVersionShape(value: unknown, id: string): value is PromptVersion {
  if (!value || typeof value !== 'object') return false;
  const version = value as PromptVersion;
  return Number.isInteger(version.version) && version.version >= 1
    && isText(version.savedAt) && CHANGE_SOURCES.includes(version.changeSource)
    && isPromptShape(version.snapshot, id);
}

/** The initial payload kept for create-retry comparison; a damaged one cannot be compared at all. */
function isStoredInput(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isText(item.name) && isText(item.category) && isText(item.scenario) && isText(item.body)
    && isText(item.inputRequirements) && isText(item.outputRequirements) && isTextList(item.relatedWikiIds)
    && isText(item.examples) && isTextList(item.tags) && typeof item.favorite === 'boolean';
}

/**
 * `id` is the id implied by the file name, so a file whose name and internal id disagree is damage.
 * `current` must be exactly the highest snapshot: a record whose current was edited without appending
 * a version has lost its history and is not a valid record either.
 */
function isRecord(value: unknown, id: string): value is PromptFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as PromptFile;
  if (file.id !== id || !isPromptShape(file.current, id)) return false;
  if (!Array.isArray(file.versions) || !file.versions.length) return false;
  if (!file.versions.every(version => isVersionShape(version, id))) return false;
  const numbers = file.versions.map(version => version.version);
  if (new Set(numbers).size !== numbers.length) return false;
  const latest = file.versions.reduce((best, version) => (version.version > best.version ? version : best));
  if (latest.version !== file.current.version || stable(latest.snapshot) !== stable(file.current)) return false;
  const creation = file.creation;
  return !!creation && typeof creation === 'object'
    && creation.requestId === id && isText(creation.createdAt) && isStoredInput(creation.input);
}

function toInput(prompt: Prompt): PromptInput {
  return {
    name: prompt.name, category: prompt.category, scenario: prompt.scenario, body: prompt.body,
    inputRequirements: prompt.inputRequirements, outputRequirements: prompt.outputRequirements,
    relatedWikiIds: prompt.relatedWikiIds, examples: prompt.examples, tags: prompt.tags, favorite: prompt.favorite,
  };
}

function buildPrompt(input: PromptInput, meta: { id: string; createdAt: string; updatedAt: string; version: number; source: PromptSource }): Prompt {
  return {
    id: meta.id, name: input.name, category: input.category, scenario: input.scenario,
    body: input.body, variables: extractVariables(input.body),
    inputRequirements: input.inputRequirements, outputRequirements: input.outputRequirements,
    relatedWikiIds: [...input.relatedWikiIds], examples: input.examples, tags: [...input.tags],
    favorite: input.favorite, createdAt: meta.createdAt, updatedAt: meta.updatedAt,
    version: meta.version, source: meta.source,
  };
}

/** Count used by the homepage; shares the active-record rule with `PromptStore.list`. */
export async function countActivePrompts(root: string): Promise<number> {
  let count = 0;
  for (const { id, file } of await activeFiles(root)) {
    const record = await readJsonFile<PromptFile>(file).catch(() => undefined);
    if (isRecord(record, id)) count += 1;
  }
  return count;
}

export class PromptStore {
  private readonly queue = new SerialQueue();
  private readonly rulesDir: string;

  constructor(public readonly root: string, private readonly wiki: WikiStore, rulesDir = path.resolve(here, '..', '..', 'rules')) {
    this.rulesDir = rulesDir;
  }

  async initialize(): Promise<void> {
    await mkdir(promptDir(this.root), { recursive: true });
    await mkdir(recycleDir(this.root), { recursive: true });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> { return this.queue.run(work); }

  async schema(): Promise<{ categories: PromptCategory[] }> {
    const parsed = yaml.load(await readFile(path.join(this.rulesDir, 'prompt-rules.yaml'), 'utf8')) as { categories?: PromptCategory[] };
    const categories = (parsed?.categories ?? []).map(item => ({ id: item.id, label: item.label, help: item.help }));
    if (!categories.length) throw new PromptError('PROMPT_RULES_MISSING', '未找到 Prompt 分类规则。', 500);
    return { categories };
  }

  private async categoryIds(): Promise<string[]> { return (await this.schema()).categories.map(item => item.id); }

  private async read(id: string): Promise<PromptFile | undefined> {
    if (!idPattern.test(id)) return undefined;
    let record: PromptFile | undefined;
    try {
      record = await readJsonFile<PromptFile>(recordPath(this.root, id));
    } catch {
      // The file exists but is not readable JSON: that is damage, not a missing record.
      throw new PromptError('CORRUPT_PROMPT', `Prompt 文件 ${id} 不是可读取的 JSON，已保留原文件，请人工检查。`, 500, { id });
    }
    if (record === undefined) return undefined;
    if (!isRecord(record, id)) throw new PromptError('CORRUPT_PROMPT', `Prompt 文件 ${id} 内容不完整或与文件名不一致，已保留原文件，请人工检查。`, 500, { id });
    return record;
  }

  /**
   * Every write is atomic (temp file + rename), so a disk failure leaves the previous `current`
   * and all previous versions exactly as they were. The error is reported as a readable Prompt
   * failure instead of a bare I/O error, so the UI can say what happened and offer a retry.
   */
  private async write(record: PromptFile): Promise<void> {
    try {
      await writeJsonAtomic(recordPath(this.root, record.id), record);
    } catch (error) {
      throw new PromptError('PROMPT_WRITE_FAILED', '保存失败：Prompt 文件没有写入，原有内容和版本记录都没有改变，请重试。', 500, {
        id: record.id, cause: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  private async existingRecords(): Promise<PromptFile[]> {
    const records: PromptFile[] = [];
    for (const { id, file } of await activeFiles(this.root)) {
      try {
        const record = await readJsonFile<PromptFile>(file);
        if (isRecord(record, id)) records.push(record);
      } catch { /* an unreadable file is not a usable prompt; `get` on its id still reports the problem */ }
    }
    return records;
  }

  async list(options: PromptListOptions = {}): Promise<Prompt[]> {
    const rules = await this.schema();
    const labels = new Map(rules.categories.map(item => [item.id, item.label]));
    const terms = options.q ? normalize(options.q).split(' ').filter(Boolean) : [];
    const tagTerm = options.tag ? normalize(options.tag) : '';
    const items = (await this.existingRecords()).map(record => record.current).filter(prompt => {
      if (options.category && prompt.category !== options.category) return false;
      if (tagTerm && !prompt.tags.some(tag => normalize(tag) === tagTerm)) return false;
      // A boolean filter means exactly that value: `favorite=false` is "not favourited",
      // never "ignore the filter".
      if (options.favorite !== undefined && prompt.favorite !== options.favorite) return false;
      if (!terms.length) return true;
      const fields = [prompt.name, ...prompt.tags, prompt.body, prompt.scenario, labels.get(prompt.category) ?? prompt.category].map(normalize);
      return terms.every(term => fields.some(field => field.includes(term)));
    });
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** Counts over the whole active library, independent of the current filters. */
  async categoryCounts(): Promise<Record<string, number>> {
    const rules = await this.schema();
    const counts = Object.fromEntries(rules.categories.map(item => [item.id, 0]));
    for (const record of await this.existingRecords()) {
      if (record.current.category in counts) counts[record.current.category] += 1;
    }
    return counts;
  }

  async count(): Promise<number> { return countActivePrompts(this.root); }

  async get(id: string): Promise<Prompt | undefined> {
    const record = await this.read(id);
    return record ? clone(record.current) : undefined;
  }

  async getVersions(id: string): Promise<PromptVersion[]> {
    const record = await this.read(id);
    if (!record) throw new PromptError('NOT_FOUND', '没有找到这条 Prompt。', 404);
    return clone(record.versions).sort((a, b) => a.version - b.version);
  }

  async getVersion(id: string, version: number): Promise<PromptVersion> {
    const versions = await this.getVersions(id);
    const found = versions.find(item => item.version === version);
    if (!found) throw new PromptError('NOT_FOUND', `这条 Prompt 没有第 ${version} 版。`, 404);
    return found;
  }

  /** Wiki titles are resolved live on every read and never written back into the record. */
  async wikiLinks(prompt: Prompt): Promise<WikiLinkStatus[]> {
    const links: WikiLinkStatus[] = [];
    for (const id of prompt.relatedWikiIds) {
      const page = await this.wiki.get(id).catch(() => undefined);
      links.push({ id, title: page?.title ?? null, status: page ? 'resolved' : 'missing' });
    }
    return links;
  }

  private async assertWikiLinksExist(ids: string[]): Promise<void> {
    for (const id of ids) {
      const page = await this.wiki.get(id);
      if (!page) throw new PromptError('INVALID_WIKI_LINK', `找不到要关联的 Wiki（${id}），关联已取消。`, 400, { id });
      await this.wiki.assertRecordSourcesAllowed(page);
    }
  }

  /** Resolved links are checked again before every version-mode write; broken links may be preserved. */
  private async assertExistingWikiLinksAllowed(record: PromptFile): Promise<void> {
    await this.assertWikiLinksAllowed(record.current.relatedWikiIds);
  }

  private async assertWikiLinksAllowed(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const page = await this.wiki.get(id);
      // Preserve the established broken-Wiki-link behavior; resolved Wiki pages still
      // must validate every declared Raw source and fail closed when one is missing.
      if (page) await this.wiki.assertRecordSourcesAllowed(page);
    }
  }

  private async assertSubmittedWikiLinksAllowed(input: PromptInput): Promise<void> {
    await this.assertWikiLinksAllowed(input.relatedWikiIds);
  }

  private async validate(input: unknown, extra: string[] = []): Promise<PromptInput> {
    return normalizePromptInput(input, await this.categoryIds(), extra);
  }

  /**
   * Create with the client's validated `requestId` as the stable id. A retry of the same explicit
   * "new prompt" session returns the current object (so edits made in between are never clobbered);
   * a different initial payload for the same requestId is a conflict; a recycled id is never revived.
   */
  async create(requestId: string, input: unknown): Promise<{ prompt: Prompt; reused: boolean }> {
    return this.serialized(async () => {
      const id = requireUuid(requestId, 'INVALID_REQUEST_ID', 'requestId 必须是有效的 UUID。');
      const clean = await this.validate(input, ['requestId']);
      await mkdir(recycleDir(this.root), { recursive: true });
      if (await readFile(recycledPath(this.root, id), 'utf8').then(() => true, () => false)) {
        throw new PromptError('PROMPT_RECYCLED', '这条新建请求对应的 Prompt 已被删除，不能再次创建；请重新发起一次新建。', 409, { id });
      }
      const existing = await this.read(id);
      if (existing) {
        if (canonicalInput(existing.creation.input) === canonicalInput(clean)) return { prompt: clone(existing.current), reused: true };
        throw new PromptError('REQUEST_ID_CONFLICT', '同一个 requestId 已用于另一组初始内容，本次未写入；请重新发起一次新建。', 409, { id });
      }
      await this.assertWikiLinksExist(clean.relatedWikiIds);
      const now = new Date().toISOString();
      const prompt = buildPrompt(clean, { id, createdAt: now, updatedAt: now, version: 1, source: 'manual' });
      const record: PromptFile = {
        id, current: prompt,
        versions: [{ version: 1, savedAt: now, changeSource: 'manual', snapshot: clone(prompt) }],
        creation: { requestId: id, input: { ...clean }, createdAt: now },
      };
      await this.write(record);
      return { prompt: clone(prompt), reused: false };
    });
  }

  /** Create a first-party demo record with a manifest-owned stable ID. */
  async createDemo(id: string, input: unknown): Promise<{ prompt: Prompt; reused: boolean }> {
    return this.serialized(async () => {
      const clean = await this.validate(input);
      const existing = await this.read(id);
      if (existing) return { prompt: clone(existing.current), reused: true };
      await mkdir(recycleDir(this.root), { recursive: true });
      if (await readFile(recycledPath(this.root, id), 'utf8').then(() => true, () => false)) {
        throw new PromptError('PROMPT_RECYCLED', '该演示 Prompt 已删除，本次不会自动恢复。', 409, { id });
      }
      await this.assertWikiLinksExist(clean.relatedWikiIds);
      const now = new Date().toISOString();
      const prompt = { ...buildPrompt(clean, { id, createdAt: now, updatedAt: now, version: 1, source: 'manual' }), isDemo: true };
      const record: PromptFile = { id, current: prompt, versions: [{ version: 1, savedAt: now, changeSource: 'manual', snapshot: clone(prompt) }], creation: { requestId: id, input: { ...clean }, createdAt: now } };
      await this.write(record);
      return { prompt: clone(prompt), reused: false };
    });
  }

  /** B08 controlled AI confirmation. The caller owns the draft and supplies only its user-edited B07 fields. */
  async confirmAi(input: { requestId: string; mode: 'new' | 'version'; promptInput: unknown; targetPromptId?: string; baseVersion?: number; source: 'ai_generated' | 'optimized' }): Promise<{ prompt: Prompt; reused: boolean }> {
    return this.serialized(async () => {
      const requestId = requireUuid(input.requestId, 'INVALID_REQUEST_ID', 'requestId 必须是有效的 UUID。');
      const clean = await this.validate(input.promptInput);
      const payload = JSON.stringify({ mode: input.mode, source: input.source, targetPromptId: input.targetPromptId ?? null, baseVersion: input.baseVersion ?? null, input: clean });
      if (input.mode === 'new') {
        if (input.targetPromptId || input.baseVersion !== undefined) throw new PromptError('INVALID_CONFIRM_MODE', '新建模式不能指定已有 Prompt 或版本。', 400);
        await mkdir(recycleDir(this.root), { recursive: true });
        if (await readFile(recycledPath(this.root, requestId), 'utf8').then(() => true, () => false)) throw new PromptError('PROMPT_RECYCLED', '这条保存请求对应的 Prompt 已被删除，请重新发起保存。', 409);
        const existing = await this.read(requestId);
        if (existing) {
          const prior = existing.aiConfirmations?.[requestId];
          if (prior?.mode === 'new' && prior.payload === payload) {
            const saved = existing.versions.find(version => version.version === prior.version);
            if (!saved) throw new PromptError('AI_CONFIRMATION_CORRUPT', '已确认的新 Prompt 版本记录缺失，未重复写入。', 500);
            return { prompt: clone(saved.snapshot), reused: true };
          }
          throw new PromptError('REQUEST_ID_CONFLICT', '这个 requestId 已用于其他 Prompt 保存内容，本次没有写入。', 409);
        }
        await this.assertWikiLinksExist(clean.relatedWikiIds);
        const now = new Date().toISOString();
        const source: PromptSource = input.source;
        const prompt = buildPrompt(clean, { id: requestId, createdAt: now, updatedAt: now, version: 1, source });
        const record: PromptFile = {
          id: requestId, current: prompt,
          versions: [{ version: 1, savedAt: now, changeSource: input.source === 'optimized' ? 'ai_optimized' : 'ai_generated', snapshot: clone(prompt) }],
          creation: { requestId, input: { ...clean }, createdAt: now },
          aiConfirmations: { [requestId]: { mode: 'new', payload, version: 1 } },
        };
        await this.write(record);
        return { prompt: clone(prompt), reused: false };
      }
      if (!input.targetPromptId || typeof input.baseVersion !== 'number' || !Number.isInteger(input.baseVersion) || input.baseVersion < 1) throw new PromptError('INVALID_CONFIRM_MODE', '版本模式必须指定目标 Prompt 和 baseVersion。', 400);
      const record = await this.read(input.targetPromptId);
      if (!record) throw new PromptError('NOT_FOUND', '没有找到要追加版本的 Prompt。', 404);
      const prior = record.aiConfirmations?.[requestId];
      if (prior) {
        if (prior.mode !== 'version' || prior.payload !== payload) throw new PromptError('REQUEST_ID_CONFLICT', '这个 requestId 已用于其他保存操作，本次没有写入。', 409);
        const saved = record.versions.find(version => version.version === prior.version);
        if (!saved) throw new PromptError('AI_CONFIRMATION_CORRUPT', '已确认的版本记录缺失，未重复写入。', 500);
        return { prompt: clone(saved.snapshot), reused: true };
      }
      if (record.current.version !== input.baseVersion) throw new PromptError('VERSION_CONFLICT', `Prompt 已更新到第 ${record.current.version} 版；请重新打开优化流程。`, 409, { currentVersion: record.current.version });
      await this.assertExistingWikiLinksAllowed(record);
      const added = clean.relatedWikiIds.filter(id => !record.current.relatedWikiIds.includes(id));
      await this.assertSubmittedWikiLinksAllowed(clean);
      await this.assertWikiLinksExist(added);
      const now = new Date().toISOString();
      const version = record.current.version + 1;
      const prompt = { ...buildPrompt(clean, { id: record.current.id, createdAt: record.current.createdAt, updatedAt: now, version, source: record.current.source }), ...(record.current.isDemo ? { isDemo: true } : {}) };
      const next: PromptFile = {
        ...record, current: prompt,
        versions: [...record.versions, { version, savedAt: now, changeSource: 'ai_optimized', snapshot: clone(prompt) }],
        aiConfirmations: { ...(record.aiConfirmations ?? {}), [requestId]: { mode: 'version', payload, version } },
      };
      await this.write(next);
      return { prompt: clone(prompt), reused: false };
    });
  }

  async update(id: string, baseVersion: number, input: unknown): Promise<Prompt> {
    return this.serialized(async () => {
      const record = await this.read(id);
      if (!record) throw new PromptError('NOT_FOUND', '没有找到这条 Prompt。', 404);
      if (baseVersion !== record.current.version) {
        throw new PromptError('VERSION_CONFLICT', `这条 Prompt 已经被保存为第 ${record.current.version} 版，请刷新后重新编辑；你刚才的输入没有被覆盖。`, 409, { currentVersion: record.current.version });
      }
      const clean = await this.validate(input, ['baseVersion']);
      await this.assertExistingWikiLinksAllowed(record);
      const added = clean.relatedWikiIds.filter(link => !record.current.relatedWikiIds.includes(link));
      await this.assertSubmittedWikiLinksAllowed(clean);
      await this.assertWikiLinksExist(added);
      if (canonicalInput(clean) === canonicalInput(toInput(record.current))) return clone(record.current);
      const now = new Date().toISOString();
      const version = record.current.version + 1;
      const prompt = { ...buildPrompt(clean, { id: record.current.id, createdAt: record.current.createdAt, updatedAt: now, version, source: record.current.source }), ...(record.current.isDemo ? { isDemo: true } : {}) };
      const next: PromptFile = {
        ...record, current: prompt,
        versions: [...record.versions, { version, savedAt: now, changeSource: 'manual', snapshot: clone(prompt) }],
      };
      await this.write(next);
      return clone(prompt);
    });
  }

  async getFeedback(id:string,version?:number):Promise<FeedbackDto[]> {
    const record=await this.read(id);if(!record)throw new PromptError('NOT_FOUND','没有找到这条Prompt，可能已移入回收区。',404);
    return feedbackData(record.feedback,id,record.versions.map(v=>v.version)).items.filter(item=>version===undefined||item.promptVersion===version).map(feedbackDto).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
  }
  async createFeedback(id:string,input:unknown):Promise<{feedback:FeedbackDto;reused:boolean}> {
    return this.serialized(async()=>{
      const clean=feedbackInput(input,'create');const record=await this.read(id);if(!record)throw new PromptError('NOT_FOUND','没有找到这条Prompt，可能已移入回收区。',404);
      const data=feedbackData(record.feedback,id,record.versions.map(v=>v.version));const feedbackId=clean.id!,version=clean.promptVersion!;
      if(data.deletedIds.includes(feedbackId))throw new PromptError('FEEDBACK_DELETED','这条反馈已删除，旧请求不能恢复它；请重新记录。',410);
      const hash=feedbackHash(id,version,clean),existing=data.items.find(item=>item.id===feedbackId);
      if(existing){if(existing.creationHash!==hash)throw new PromptError('FEEDBACK_ID_CONFLICT','同一反馈ID已用于其他内容，本次未写入。',409);return {feedback:feedbackDto(existing),reused:true};}
      if(!record.versions.some(v=>v.version===version))throw new PromptError('INVALID_FEEDBACK_VERSION','要记录反馈的Prompt版本不存在。',400);
      const now=new Date().toISOString();const item:Feedback={id:feedbackId,promptId:id,promptVersion:version,usedOn:clean.usedOn,scenario:clean.scenario,outcome:clean.outcome,observation:clean.observation,nextImprovement:clean.nextImprovement,revision:1,createdAt:now,updatedAt:now,creationHash:hash};
      await this.write({...record,feedback:{...data,items:[...data.items,item]}});return {feedback:feedbackDto(item),reused:false};
    });
  }
  async updateFeedback(id:string,feedbackId:string,input:unknown):Promise<FeedbackDto> {
    return this.serialized(async()=>{
      const clean=feedbackInput(input,'update');const record=await this.read(id);if(!record)throw new PromptError('NOT_FOUND','没有找到这条Prompt，可能已移入回收区。',404);
      const data=feedbackData(record.feedback,id,record.versions.map(v=>v.version)),item=data.items.find(entry=>entry.id===feedbackId);
      if(!item)throw new PromptError(data.deletedIds.includes(feedbackId)?'FEEDBACK_DELETED':'FEEDBACK_NOT_FOUND','没有找到这条反馈，可能已删除；请刷新。',data.deletedIds.includes(feedbackId)?410:404);
      if(item.revision!==clean.baseRevision)throw new PromptError('FEEDBACK_VERSION_CONFLICT','反馈已被其他操作更新，请刷新后重新编辑；当前输入未被覆盖。',409,{currentRevision:item.revision});
      const {baseRevision:_base,...editable}=clean;
      if(['usedOn','scenario','outcome','observation','nextImprovement'].every(key=>item[key as keyof Feedback]===editable[key as keyof typeof editable]))return feedbackDto(item);
      const next:Feedback={...item,...editable,revision:item.revision+1,updatedAt:new Date().toISOString()};
      await this.write({...record,feedback:{...data,items:data.items.map(entry=>entry.id===feedbackId?next:entry)}});return feedbackDto(next);
    });
  }
  async deleteFeedback(id:string,feedbackId:string,input:unknown):Promise<{id:string;deleted:true;reused:boolean}> {
    return this.serialized(async()=>{
      const baseRevision=feedbackDeleteInput(input);const record=await this.read(id);if(!record)throw new PromptError('NOT_FOUND','没有找到这条Prompt，可能已移入回收区。',404);
      const data=feedbackData(record.feedback,id,record.versions.map(v=>v.version)),item=data.items.find(entry=>entry.id===feedbackId);
      if(!item)return {id:feedbackId,deleted:true,reused:true};
      if(item.revision!==baseRevision)throw new PromptError('FEEDBACK_VERSION_CONFLICT','反馈已被更新，请刷新后重新确认删除。',409,{currentRevision:item.revision});
      await this.write({...record,feedback:{...data,items:data.items.filter(entry=>entry.id!==feedbackId),deletedIds:[...data.deletedIds,feedbackId]}});return {id:feedbackId,deleted:true,reused:false};
    });
  }
  async exportFeedback(id:string) {return {schemaVersion:1 as const,promptId:id,items:await this.getFeedback(id)};}
  async delete(id: string, baseVersion: number): Promise<{ id: string; deleted: true }> {
    return this.serialized(async () => {
      const record = await this.read(id);
      if (!record) throw new PromptError('NOT_FOUND', '没有找到这条 Prompt。', 404);
      if (baseVersion !== record.current.version) {
        throw new PromptError('VERSION_CONFLICT', `这条 Prompt 已经被保存为第 ${record.current.version} 版，请刷新后重新确认删除。`, 409, { currentVersion: record.current.version });
      }
      await mkdir(recycleDir(this.root), { recursive: true });
      try {
        await rename(recordPath(this.root, id), recycledPath(this.root, id));
      } catch (error) {
        // The active record is left untouched: a failed move must never look like a deletion.
        throw new PromptError('PROMPT_DELETE_FAILED', '删除失败：Prompt 文件没有被移动到回收区，记录仍然保留，请重试。', 500, { id, cause: error instanceof Error ? error.message : 'unknown' });
      }
      return { id, deleted: true };
    });
  }

  /**
   * Pure computation for one saved version. Values are matched by own key only, unknown keys are
   * rejected, and a template with unfilled variables returns 422 with the missing names.
   */
  async renderVariables(id: string, baseVersion: number, values: Record<string, string>): Promise<PromptRenderResult> {
    const prompt = await this.get(id);
    if (!prompt) throw new PromptError('NOT_FOUND', '没有找到这条 Prompt。', 404);
    if (baseVersion !== prompt.version) {
      throw new PromptError('VERSION_CONFLICT', `这条 Prompt 已经保存为第 ${prompt.version} 版，请刷新后再填写变量。`, 409, { currentVersion: prompt.version });
    }
    const names = extractVariables(prompt.body);
    const unknown = Object.keys(values).filter(key => !names.includes(key));
    if (unknown.length) throw new PromptError('UNKNOWN_VARIABLE', `变量值里包含模板中不存在的变量：${unknown.join('、')}。`, 400, { unknownVariables: unknown });
    const result = renderTemplate(prompt.body, values);
    if (result.missingVariables.length) {
      throw new PromptError('MISSING_VARIABLES', `还有未填写的变量：${result.missingVariables.join('、')}。请填写后再生成最终正文。`, 422, { missingVariables: result.missingVariables });
    }
    return { id: prompt.id, version: prompt.version, body: result.body, missingVariables: [] };
  }

  /** Standalone Markdown of the stored template: metadata, then the body verbatim. */
  async exportMarkdown(id: string): Promise<{ prompt: Prompt; markdown: string } | undefined> {
    const prompt = await this.get(id);
    if (!prompt) return undefined;
    const links = await this.wikiLinks(prompt);
    const labels = new Map((await this.schema()).categories.map(item => [item.id, item.label]));
    const meta = {
      id: prompt.id, name: prompt.name, category: prompt.category,
      categoryLabel: labels.get(prompt.category) ?? null, scenario: prompt.scenario,
      variables: prompt.variables, tags: prompt.tags, favorite: prompt.favorite,
      source: prompt.source, isDemo: prompt.isDemo === true, version: prompt.version, createdAt: prompt.createdAt, updatedAt: prompt.updatedAt,
      relatedWiki: links.map(link => ({ id: link.id, title: link.title, status: link.status })),
    };
    const yamlHeader = yaml.dump(meta, { lineWidth: -1, noRefs: true }).trimEnd();
    // Sections are pushed with an explicit blank line in front, so an empty field simply
    // disappears instead of leaving a stray heading. The body is always the last block and is
    // written exactly as stored — fences and backticks in it can never break the layout.
    const parts: string[] = ['---', yamlHeader, '---', '', `# ${prompt.name}`, ...(prompt.isDemo ? ['', '> 【演示数据】虚构教学示例，不代表真实公司或业务结论。'] : [])];
    const section = (title: string, value: string) => {
      if (value.trim()) parts.push('', `## ${title}`, '', value.trimEnd());
    };
    section('场景', prompt.scenario);
    section('输入要求', prompt.inputRequirements);
    section('输出要求', prompt.outputRequirements);
    section('示例', prompt.examples);
    if (links.length) parts.push('', '## 相关 Wiki', '', links.map(link => `- ${link.title ?? '（关联已失效）'} — ${link.id}（${link.status}）`).join('\n'));
    parts.push('', '## Prompt 正文', '', prompt.body);
    return { prompt, markdown: `${parts.join('\n')}\n` };
  }
}
