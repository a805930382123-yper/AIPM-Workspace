import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

export const SOURCE_TYPES = ['wechat', 'article', 'report', 'company', 'customer', 'meeting', 'note', 'other'] as const;
export type SourceType = typeof SOURCE_TYPES[number];
const folderFor: Record<SourceType, string> = {
  wechat: 'articles', article: 'articles', report: 'reports', company: 'company',
  customer: 'customer', meeting: 'meetings', note: 'notes', other: 'other',
};
const frontmatterStart = /^---\r?\n/;

export type RawAssetMetadata = {
  /** B03: retained original file, recorded as metadata only. Absent for pasted text. */
  assetId?: string; assetFileName?: string; assetFormat?: string; assetByteSize?: number;
  assetSha256?: string; extractionParser?: string; extractionNote?: string;
};
export type RawInput = RawAssetMetadata & {
  title: string; sourceType: SourceType; sourceName: string; author?: string;
  publishedAt?: string; url?: string; tags: string[]; body: string;
  /** Server-generated trace for a successful URL import. */
  urlImport?: { finalUrl: string; fetchedAt: string };
};
export type RawMeetingOrigin = {
  kind: 'meeting'; meeting_id: string; import_id: string; original_sha256: string;
  registered_confidentiality: 'Public' | 'Internal' | 'Sensitive' | 'Restricted'; processing_policy: 'meeting_local_only';
};
export type RawRecord = RawInput & {
  id: string; importedAt: string; status: 'unprocessed'; bodySha256: string;
  isDemo?: boolean; origin?: RawMeetingOrigin;
};
export type MeetingRawRegistration = {
  id: string; title: string; sourceName: string; tags: string[]; body: string;
  importedAt: string; origin: RawMeetingOrigin;
};
/** Everything the user supplies except the body; file import takes the body from a parser. */
export type RawMetadata = Omit<RawInput, 'body'>;

const rawIdPattern = /^[0-9a-f-]{36}$/i;
const bodyShaPattern = /^[0-9a-f]{64}$/i;
function rawDirectory(root: string, type: SourceType) { return path.join(root, 'knowledge', 'raw', folderFor[type]); }
function serialize(record: RawRecord): string {
  const { body, ...metadata } = record;
  return `---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true }).trimEnd()}\n---\n${body}`;
}
function parse(file: string): RawRecord {
  if (!frontmatterStart.test(file)) throw new Error('Raw Markdown 缺少 frontmatter');
  const rest = file.replace(frontmatterStart, '');
  const close = rest.search(/^---\r?\n/m);
  if (close < 0) throw new Error('Raw Markdown frontmatter 未闭合');
  const after = rest.slice(close).replace(/^---\r?\n/, '');
  const metadata = yaml.load(rest.slice(0, close)) as Omit<RawRecord, 'body'>;
  return { ...metadata, body: after } as RawRecord;
}

export class RawIntegrityError extends Error {
  readonly code = 'RAW_INTEGRITY_ERROR';
  readonly status = 409;
  constructor() { super('Raw 正文完整性校验失败，已拒绝读取。恢复原文件后可以重试。'); }
}

function verifyIntegrity(record: RawRecord): RawRecord {
  if (typeof record.body !== 'string' || typeof record.bodySha256 !== 'string' || !bodyShaPattern.test(record.bodySha256) ||
      createHash('sha256').update(record.body, 'utf8').digest('hex') !== record.bodySha256.toLowerCase()) {
    throw new RawIntegrityError();
  }
  return record;
}

export class RawStore {
  constructor(public readonly root: string) {}

  async initialize() {
    for (const dir of new Set([...Object.values(folderFor), 'assets'])) await mkdir(path.join(this.root, 'knowledge', 'raw', dir), { recursive: true });
    await Promise.all(['knowledge/wiki', 'knowledge/audit', 'knowledge/logs', 'prompts', 'drafts'].map(p => mkdir(path.join(this.root, p), { recursive: true })));
  }

  async create(input: RawInput): Promise<RawRecord> {
    return this.createWithId(randomUUID(), input, false);
  }

  async createDemo(id: string, input: RawInput): Promise<RawRecord> {
    return this.createWithId(id, input, true);
  }

  /** M04 server-only bridge. Never exposed through the ordinary Raw HTTP create/import path. */
  async createMeetingRegistration(input: MeetingRawRegistration): Promise<{ record: RawRecord; created: boolean }> {
    const expected: RawRecord = {
      title: input.title, sourceType: 'meeting', sourceName: input.sourceName, tags: [...input.tags], body: input.body,
      id: input.id, importedAt: input.importedAt, status: 'unprocessed',
      bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'), origin: { ...input.origin },
    };
    const existing = await this.get(input.id);
    if (existing) {
      const same = existing.title === expected.title && existing.sourceType === expected.sourceType
        && existing.sourceName === expected.sourceName && existing.body === expected.body
        && existing.bodySha256 === expected.bodySha256
        && JSON.stringify(existing.tags ?? []) === JSON.stringify(expected.tags)
        && JSON.stringify(existing.origin ?? null) === JSON.stringify(expected.origin);
      if (!same) throw new RawIntegrityError();
      return { record: existing, created: false };
    }
    const dir = rawDirectory(this.root, 'meeting');
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `${input.id}.md`);
    const temp = path.join(dir, `.${input.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, serialize(expected), { encoding: 'utf8', flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    const written = await this.get(input.id);
    if (!written || written.body !== input.body || JSON.stringify(written.origin ?? null) !== JSON.stringify(expected.origin)) throw new RawIntegrityError();
    return { record: written, created: true };
  }

  /** Server-only news bridge; fixed identity is never accepted from a Raw client. */
  async createNewsRegistration(id: string, input: RawInput): Promise<RawRecord> {
    const record = await this.createWithId(id, input, false);
    if (record.title !== input.title || record.sourceType !== input.sourceType || record.sourceName !== input.sourceName ||
        record.url !== input.url || record.publishedAt !== input.publishedAt || record.extractionNote !== input.extractionNote ||
        record.body !== input.body || JSON.stringify(record.tags) !== JSON.stringify(input.tags)) throw new RawIntegrityError();
    return record;
  }

  private async createWithId(id: string, input: RawInput, isDemo: boolean): Promise<RawRecord> {
    const existing = await this.get(id);
    if (existing) return existing;
    const record: RawRecord = {
      ...input, id, importedAt: new Date().toISOString(), status: 'unprocessed',
      bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'),
      ...(isDemo ? { isDemo: true } : {}),
    };
    const dir = rawDirectory(this.root, input.sourceType);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `${id}.md`);
    const temp = path.join(dir, `.${id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, serialize(record), { encoding: 'utf8', flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    return record;
  }

  async list(): Promise<RawRecord[]> {
    const items: RawRecord[] = [];
    for (const folder of new Set(Object.values(folderFor))) {
      const dir = path.join(this.root, 'knowledge', 'raw', folder);
      for (const name of await readdir(dir).catch(() => [])) {
        if (!/^[0-9a-f-]{36}\.md$/i.test(name)) continue;
        items.push(verifyIntegrity(parse(await readFile(path.join(dir, name), 'utf8'))));
      }
    }
    return items.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async get(id: string): Promise<RawRecord | undefined> {
    if (!rawIdPattern.test(id)) return undefined;
    for (const folder of new Set(Object.values(folderFor))) {
      try { return verifyIntegrity(parse(await readFile(path.join(this.root, 'knowledge', 'raw', folder, `${id}.md`), 'utf8'))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return undefined;
  }

  /**
   * B03: explicit user deletion of one Raw. Reads and parses the record first so a
   * corrupt file is never silently removed, then unlinks that single file. The
   * retained original in knowledge/raw/assets/ is intentionally kept.
   */
  async delete(id: string): Promise<RawRecord | undefined> {
    if (!rawIdPattern.test(id)) return undefined;
    for (const folder of new Set(Object.values(folderFor))) {
      const file = path.join(this.root, 'knowledge', 'raw', folder, `${id}.md`);
      let record: RawRecord;
      try { record = verifyIntegrity(parse(await readFile(file, 'utf8'))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
      await rm(file);
      return record;
    }
    return undefined;
  }
}
