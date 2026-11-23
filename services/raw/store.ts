import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { PdfTextMap } from './parse.ts';
import { identifyWebImages, webImageRelativePath, type RawWebImage } from './web-material.ts';
import type { MediaArtifact, MediaArtifactResult } from './media-artifact.ts';
import { buildRawContentForAI, inspectRawMedia, type RawMediaSource } from './media-context.ts';
import { readJsonFile, SerialQueue, writeFileAtomic, writeJsonAtomic } from '../storage/files.ts';

export const SOURCE_TYPES = ['wechat', 'article', 'report', 'company', 'customer', 'meeting', 'note', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
const folderFor: Record<SourceType, string> = {
  wechat: 'articles',
  article: 'articles',
  report: 'reports',
  company: 'company',
  customer: 'customer',
  meeting: 'meetings',
  note: 'notes',
  other: 'other',
};
const frontmatterStart = /^---\r?\n/;

export type RawAssetMetadata = {
  /** B03: retained original file, recorded as metadata only. Absent for pasted text. */
  assetId?: string;
  assetFileName?: string;
  assetFormat?: string;
  assetByteSize?: number;
  assetSha256?: string;
  extractionParser?: string;
  extractionNote?: string;
};
export type RawInput = RawAssetMetadata & {
  title: string;
  sourceType: SourceType;
  sourceName: string;
  author?: string;
  publishedAt?: string;
  url?: string;
  tags: string[];
  body: string;
  /** Server-generated trace for a successful URL import. */
  urlImport?: { finalUrl: string; fetchedAt: string };
  pdf?: PdfTextMap;
  webImages?: RawWebImage[];
  /** Server-only import input. Never serialized into a Raw or returned publicly. */
  webImageArtifacts?: MediaArtifactResult[];
  newsMaterial?: { kind: 'article' | 'report_pdf' | 'report_page'; issue?: string; revision: number };
};
export type RawMeetingOrigin = {
  kind: 'meeting';
  meeting_id: string;
  import_id: string;
  original_sha256: string;
  registered_confidentiality: 'Public' | 'Internal' | 'Sensitive' | 'Restricted';
  processing_policy: 'meeting_local_only';
};
export type RawRecord = Omit<RawInput, 'webImageArtifacts'> & {
  id: string;
  importedAt: string;
  status: 'unprocessed';
  bodySha256: string;
  isDemo?: boolean;
  origin?: RawMeetingOrigin;
  bodyRevision?: number;
  bodyEditedAt?: string;
};
export type RawBodyUpdate = { body: string; expectedBodySha256: string; expectedBodyRevision: number };
export const hasEditedPdfBody = (raw: Pick<RawRecord, 'bodyRevision' | 'newsMaterial'>) =>
  (raw.bodyRevision ?? 0) !== (raw.newsMaterial?.kind === 'report_pdf' ? raw.newsMaterial.revision : 0);
export type MeetingRawRegistration = {
  id: string;
  title: string;
  sourceName: string;
  tags: string[];
  body: string;
  importedAt: string;
  origin: RawMeetingOrigin;
};
/** Everything the user supplies except the body; file import takes the body from a parser. */
export type RawMetadata = Omit<RawInput, 'body' | 'webImageArtifacts'>;

export class RawMediaImportError extends Error {
  readonly code = 'RAW_MEDIA_IMPORT_INCOMPLETE';
  readonly status = 500;
  readonly details: { committed: true; rawId: string; raw: RawRecord };
  constructor(raw: RawRecord) {
    super('原文已保存，但图片解析记录未全部保存。请打开已保存的资料核对，不要重复导入。');
    this.details = { committed: true, rawId: raw.id, raw };
  }
}

const rawIdPattern = /^[0-9a-f-]{36}$/i;
const bodyShaPattern = /^[0-9a-f]{64}$/i;
function rawDirectory(root: string, type: SourceType) {
  return path.join(root, 'knowledge', 'raw', folderFor[type]);
}
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
  constructor() {
    super('Raw 正文完整性校验失败，已拒绝读取。恢复原文件后可以重试。');
  }
}

function verifyIntegrity(record: RawRecord): RawRecord {
  if (
    typeof record.body !== 'string' ||
    typeof record.bodySha256 !== 'string' ||
    !bodyShaPattern.test(record.bodySha256) ||
    createHash('sha256').update(record.body, 'utf8').digest('hex') !== record.bodySha256.toLowerCase()
  ) {
    throw new RawIntegrityError();
  }
  return record;
}

export class RawStore {
  private readonly mediaWrites = new SerialQueue();

  constructor(public readonly root: string) {}

  async initialize() {
    for (const dir of new Set([...Object.values(folderFor), 'assets']))
      await mkdir(path.join(this.root, 'knowledge', 'raw', dir), { recursive: true });
    await Promise.all(
      ['knowledge/wiki', 'knowledge/audit', 'knowledge/logs', 'prompts', 'drafts'].map((p) =>
        mkdir(path.join(this.root, p), { recursive: true }),
      ),
    );
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
      title: input.title,
      sourceType: 'meeting',
      sourceName: input.sourceName,
      tags: [...input.tags],
      body: input.body,
      id: input.id,
      importedAt: input.importedAt,
      status: 'unprocessed',
      bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'),
      origin: { ...input.origin },
    };
    const existing = await this.get(input.id);
    if (existing) {
      const same =
        existing.title === expected.title &&
        existing.sourceType === expected.sourceType &&
        existing.sourceName === expected.sourceName &&
        existing.body === expected.body &&
        existing.bodySha256 === expected.bodySha256 &&
        JSON.stringify(existing.tags ?? []) === JSON.stringify(expected.tags) &&
        JSON.stringify(existing.origin ?? null) === JSON.stringify(expected.origin);
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
    if (
      !written ||
      written.body !== input.body ||
      JSON.stringify(written.origin ?? null) !== JSON.stringify(expected.origin)
    )
      throw new RawIntegrityError();
    return { record: written, created: true };
  }

  /** Server-only news bridge; fixed identity is never accepted from a Raw client. */
  async createNewsRegistration(id: string, input: RawInput): Promise<RawRecord> {
    const record = await this.createWithId(id, input, false);
    if (
      record.title !== input.title ||
      record.sourceType !== input.sourceType ||
      record.sourceName !== input.sourceName ||
      record.url !== input.url ||
      record.publishedAt !== input.publishedAt ||
      record.assetId !== input.assetId ||
      record.extractionNote !== input.extractionNote ||
      record.body !== input.body ||
      JSON.stringify(record.tags) !== JSON.stringify(input.tags)
    )
      throw new RawIntegrityError();
    return record;
  }

  private async createWithId(id: string, input: RawInput, isDemo: boolean): Promise<RawRecord> {
    const existing = await this.get(id);
    if (existing) {
      await this.saveImportedMedia(existing, input.webImageArtifacts);
      return existing;
    }
    const { webImageArtifacts, ...rawInput } = input;
    const record: RawRecord = {
      ...rawInput,
      id,
      importedAt: new Date().toISOString(),
      status: 'unprocessed',
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
    await this.saveImportedMedia(record, webImageArtifacts);
    return record;
  }

  /** News receipts can retry missing derivatives without replacing a completed parse. */
  async saveImportedMedia(raw: RawRecord, artifacts?: MediaArtifactResult[]) {
    if (!artifacts?.length) return;
    try {
      const saved = new Set((await this.getMediaArtifacts(raw.id)).map(({ mediaId }) => mediaId));
      for (const image of identifyWebImages(raw.id, raw.webImages)) {
        if (saved.has(image.mediaId)) continue;
        const result = artifacts[image.imageIndex - 1];
        if (!result || !(await this.saveMediaArtifact(raw.id, image.mediaId, result))) throw new Error('Missing media');
      }
    } catch {
      throw new RawMediaImportError(raw);
    }
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
    return (await this.readCurrent(id))?.record;
  }

  private mediaDirectory(id: string) {
    return path.join(this.root, 'knowledge', 'raw', 'media-artifacts', id);
  }

  /** Internal read. Only current image occurrences are eligible for lookup. */
  async getMediaArtifacts(id: string): Promise<MediaArtifact[]> {
    const raw = await this.get(id);
    if (!raw) return [];
    const artifacts = await Promise.all(
      identifyWebImages(id, raw.webImages).map(({ mediaId }) =>
        readJsonFile<MediaArtifact>(path.join(this.mediaDirectory(id), `${mediaId}.json`)),
      ),
    );
    return artifacts.filter((artifact) => artifact !== undefined);
  }

  async mediaSource(raw: RawRecord): Promise<RawMediaSource> {
    const acquiredRevision = raw.newsMaterial?.revision ?? 0;
    const acquisition =
      raw.webImages?.length && (raw.bodyRevision ?? 0) > acquiredRevision
        ? await this.bodyHistory(raw.id, acquiredRevision)
        : undefined;
    return inspectRawMedia(raw, acquisition);
  }

  async getAnchoredMediaArtifacts(raw: RawRecord, source?: RawMediaSource): Promise<MediaArtifact[]> {
    if (!raw.webImages?.length) return [];
    const { markers } = source ?? (await this.mediaSource(raw));
    if (!markers.length) return [];
    const imageIndexes = new Set(markers.map(({ imageIndex }) => imageIndex));
    return (await this.getMediaArtifacts(raw.id)).filter((item) => imageIndexes.has(item.imageIndex));
  }

  async buildMediaInput(raw: RawRecord, includeImages = true) {
    if (!raw.webImages?.length) return buildRawContentForAI(raw, []);
    const source = await this.mediaSource(raw);
    return buildRawContentForAI(raw, includeImages ? await this.getAnchoredMediaArtifacts(raw, source) : [], source);
  }

  /** Replace the derivative for one occurrence, leaving the Raw Markdown and original image untouched. */
  async saveMediaArtifact(
    id: string,
    mediaId: string,
    result: MediaArtifactResult,
  ): Promise<MediaArtifact | undefined> {
    return this.mediaWrites.run(async () => {
      const raw = await this.get(id);
      const image = raw && identifyWebImages(id, raw.webImages).find((entry) => entry.mediaId === mediaId);
      if (!image) return;
      const { imageIndex, sourceUrl, sha256 } = image;
      const localPath = webImageRelativePath(sha256);
      const artifact: MediaArtifact = {
        ...result,
        mediaId,
        imageIndex,
        sourceUrl,
        ...(localPath ? { localPath } : {}),
        updatedAt: new Date().toISOString(),
      };
      if (artifact.routeStatus !== 'ocr_ready') delete artifact.ocrCleanText;
      await writeJsonAtomic(path.join(this.mediaDirectory(id), `${mediaId}.json`), artifact);
      return artifact;
    });
  }

  private async readCurrent(id: string) {
    if (!rawIdPattern.test(id)) return undefined;
    for (const folder of new Set(Object.values(folderFor))) {
      const file = path.join(this.root, 'knowledge', 'raw', folder, `${id}.md`);
      try {
        const bytes = await readFile(file);
        return { file, bytes, record: verifyIntegrity(parse(bytes.toString('utf8'))) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    return undefined;
  }

  private historyFile(id: string, revision: number) {
    return path.join(this.root, 'knowledge', 'raw', 'history', id, `${revision}.md`);
  }

  async bodyHistory(id: string, revision: number): Promise<RawRecord | undefined> {
    const current = await this.get(id);
    if (!current || !Number.isSafeInteger(revision) || revision < 0 || revision >= (current.bodyRevision ?? 0))
      return undefined;
    const snapshot = verifyIntegrity(parse(await readFile(this.historyFile(id, revision), 'utf8')));
    if (snapshot.id !== id || (snapshot.bodyRevision ?? 0) !== revision) throw new RawIntegrityError();
    return snapshot;
  }

  /** Public edit operations hold the Wiki write lock throughout the version check and replacement. */
  async updateBody(
    id: string,
    input: RawBodyUpdate,
    ensureIdle: (record: RawRecord) => Promise<void>,
    newsInput?: RawInput,
  ): Promise<RawRecord | undefined> {
    const current = await this.readCurrent(id);
    if (!current) return undefined;
    const { file, bytes, record } = current;
    if (record.origin !== undefined) {
      throw new RawBodyEditError(
        'MEETING_RAW_EDIT_FORBIDDEN',
        '请到会议档案编辑纪要工作副本。已登记的 Raw 保留当时的会议原文。',
        403,
      );
    }
    const revision = record.bodyRevision ?? 0;
    if (record.bodySha256.toLowerCase() !== input.expectedBodySha256 || revision !== input.expectedBodyRevision) {
      throw new RawBodyEditError('RAW_BODY_CONFLICT', '原文已被修改。请先读取最新原文并核对，再保存你的编辑。', 409);
    }
    if (record.body === input.body && !newsInput) return record;
    await ensureIdle(record);
    const snapshot = this.historyFile(id, revision);
    const archived = await readFile(snapshot).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    if (archived && !archived.equals(bytes)) throw new RawIntegrityError();
    if (!archived) await writeFileAtomic(snapshot, bytes);
    const { webImageArtifacts, ...newsFields } = newsInput ?? {};
    const updated: RawRecord = {
      ...record,
      ...newsFields,
      sourceType: record.sourceType,
      body: input.body,
      bodySha256: createHash('sha256').update(input.body, 'utf8').digest('hex'),
      bodyRevision: revision + 1,
      bodyEditedAt: new Date().toISOString(),
    };
    if (newsInput && record.webImages?.length) {
      await this.mediaWrites.run(async () => {
        await writeFileAtomic(file, serialize(updated));
        const currentMediaIds = new Set(identifyWebImages(id, updated.webImages).map(({ mediaId }) => mediaId));
        for (const { mediaId } of identifyWebImages(id, record.webImages)) {
          if (!currentMediaIds.has(mediaId))
            await rm(path.join(this.mediaDirectory(id), `${mediaId}.json`), { force: true });
        }
      });
    } else {
      await writeFileAtomic(file, serialize(updated));
    }
    await this.saveImportedMedia(updated, webImageArtifacts);
    return updated;
  }

  /**
   * B03: explicit user deletion of one Raw. Reads and parses the record first so a
   * corrupt file is never silently removed, then unlinks that single file. The
   * retained original in knowledge/raw/assets/ is intentionally kept.
   */
  async delete(id: string): Promise<RawRecord | undefined> {
    return this.mediaWrites.run(async () => {
      const current = await this.readCurrent(id);
      if (!current) return undefined;
      const { file, record } = current;
      await rm(this.mediaDirectory(id), { recursive: true, force: true });
      await rm(file);
      return record;
    });
  }
}

export class RawBodyEditError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
