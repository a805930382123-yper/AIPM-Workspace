import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanJsonRecords, SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { RawIntegrityError, type RawInput, type RawRecord, type RawStore } from '../raw/store.ts';
import { AssetStore } from '../raw/assets.ts';
import { NewsError, normalizedUrl } from './service.ts';
import { acquireNewsMaterial } from './raw-material.ts';
import type {
  NewsEdition,
  NewsItem,
  NewsMaterialView,
  NewsSaveResult,
  NewsSavedRaw,
  NewsSectionName,
} from './types.ts';

export type NewsSaveOptions = { supplement?: boolean; keepPartial?: boolean };
export type NewsSaveDependencies = {
  acquire?: (item: NewsItem, keepPartial: boolean) => ReturnType<typeof acquireNewsMaterial>;
  withRawLock?: <T>(operation: () => Promise<T>) => Promise<T>;
  ensureIdle?: (raw: RawRecord) => Promise<void>;
};

type Receipt = {
  schemaVersion: 1;
  date: string;
  section: NewsSectionName;
  itemId: string;
  sourceId: string;
  fetchedAt: string;
  evidenceKind: NewsItem['evidenceKind'];
  normalizedUrl: string;
  rawId: string;
  input: RawInput;
  status: 'pending' | 'linked';
  createdAt: string;
  updatedAt: string;
  registrationId?: string;
};
function validReceipt(value: unknown, url: string): value is Receipt {
  const x = value as Receipt | null;
  return (
    !!x &&
    x.schemaVersion === 1 &&
    x.normalizedUrl === url &&
    /^[-a-f0-9]{36}$/i.test(x.rawId) &&
    ['pending', 'linked'].includes(x.status) &&
    !!x.input &&
    typeof x.input.body === 'string' &&
    typeof x.input.title === 'string' &&
    Array.isArray(x.input.tags) &&
    ['fmcg', 'ai'].includes(x.section) &&
    ['article_excerpt', 'source_summary'].includes(x.evidenceKind) &&
    typeof x.date === 'string' &&
    typeof x.itemId === 'string' &&
    typeof x.sourceId === 'string' &&
    typeof x.fetchedAt === 'string'
  );
}
export class NewsRawSave {
  private queue = new SerialQueue();
  constructor(
    private root: string,
    private raws: RawStore,
    private clock: () => Date,
    private deps: NewsSaveDependencies = {},
  ) {}
  private directory() {
    return path.join(this.root, 'state', 'news-saves');
  }
  private file(url: string) {
    return path.join(this.directory(), createHash('sha256').update(url).digest('hex') + '.json');
  }
  private async read(url: string): Promise<Receipt | null> {
    let data: string;
    try {
      data = await readFile(this.file(url), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    let x: Receipt;
    try {
      x = JSON.parse(data);
    } catch {
      throw new NewsError('保存收据损坏，原文件已保留。', 409);
    }
    if (!validReceipt(x, url)) throw new NewsError('保存收据无效，原文件已保留。', 409);
    return x;
  }
  private async check(receipt: Receipt) {
    const raw = await this.raws.get(receipt.rawId);
    if (!raw) return;
    // Linked receipts keep the original registration even after a user edits the Raw.
    if (receipt.status === 'linked') return raw;
    const input = receipt.input;
    if (
      raw.body !== input.body ||
      raw.title !== input.title ||
      raw.sourceType !== input.sourceType ||
      raw.sourceName !== input.sourceName ||
      raw.url !== input.url ||
      raw.publishedAt !== input.publishedAt ||
      raw.assetId !== input.assetId ||
      raw.extractionNote !== input.extractionNote ||
      JSON.stringify(raw.tags) !== JSON.stringify(input.tags)
    )
      throw new RawIntegrityError();
    return raw;
  }
  private material(raw: RawRecord, receipt: Receipt): NewsMaterialView {
    const source = raw.newsMaterial;
    return {
      kind: source?.kind ?? 'excerpt',
      issue: source ? source.issue : '此条 Raw 保存的是旧资讯摘录。',
      canSupplement:
        (!source || !!source.issue) &&
        (raw.bodyRevision ?? 0) === (source?.revision ?? 0) &&
        (source !== undefined || raw.body === receipt.input.body),
    };
  }
  private async input(item: NewsItem, section: NewsSectionName, keepPartial: boolean): Promise<RawInput> {
    const material = await (this.deps.acquire?.(item, keepPartial) ??
      acquireNewsMaterial(this.root, item, keepPartial));
    return {
      ...material,
      title: item.title,
      sourceType: material.assetFormat === 'pdf' || item.research ? 'report' : 'article',
      sourceName: item.sourceName,
      url: item.url,
      ...(item.author ? { author: item.author } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      tags: ['每日资讯', section === 'fmcg' ? '快消行业' : 'AI 前沿'],
    };
  }
  private async linkPdf(raw: RawRecord) {
    if (!raw.assetId || raw.assetFormat !== 'pdf') return;
    const assets = new AssetStore(this.root);
    const asset = await assets.get(raw.assetId);
    if (!asset) throw new RawIntegrityError();
    if (asset.status === 'parsed' && asset.rawId === raw.id) return;
    if (asset.rawId && asset.rawId !== raw.id) throw new RawIntegrityError();
    await assets.markParsed(raw.assetId, {
      format: 'pdf',
      rawId: raw.id,
      parser: raw.extractionParser ?? '',
      extractionNote: raw.extractionNote ?? '',
    });
  }
  async save(
    date: string,
    section: NewsSectionName,
    item: NewsItem,
    registrationId?: string,
    options: NewsSaveOptions = {},
  ): Promise<NewsSaveResult & { owned?: boolean }> {
    return this.queue.run(async () => {
      const url = normalizedUrl(item.url);
      let receipt = await this.read(url);
      let created = false;
      let raw = receipt ? await this.check(receipt) : undefined;
      if (!receipt) {
        if (options.supplement) throw new NewsError('没有找到可以补采的 Raw。', 404);
        const input = await this.input(item, section, options.keepPartial ?? false);
        const now = this.clock().toISOString();
        receipt = {
          schemaVersion: 1,
          date,
          section,
          itemId: item.id,
          sourceId: item.sourceId,
          fetchedAt: item.fetchedAt,
          evidenceKind: item.evidenceKind,
          normalizedUrl: url,
          rawId: randomUUID(),
          input,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          ...(registrationId ? { registrationId } : {}),
        };
        await writeJsonAtomic(this.file(url), receipt);
        try {
          raw = await this.raws.createNewsRegistration(receipt.rawId, input);
        } catch {
          throw new NewsError('保存状态待核对，请重试。', 409);
        }
        created = true;
      } else if (!raw) {
        const recoverable =
          receipt.status === 'pending' &&
          receipt.registrationId === registrationId &&
          (receipt.input.newsMaterial || registrationId);
        if (!recoverable)
          throw new NewsError(
            receipt.status === 'linked' ? '原 Raw 已删除。' : '保存未完成且未找到 Raw，请核对保存收据。',
            409,
          );
        raw = await this.raws.createNewsRegistration(receipt.rawId, receipt.input);
        created = true;
      }
      if (options.supplement && !this.material(raw, receipt).canSupplement) {
        if (!raw.newsMaterial || raw.newsMaterial.issue || (raw.bodyRevision ?? 0) !== raw.newsMaterial.revision)
          throw new NewsError('此 Raw 已有人工作业或不符合补采条件，保留当前原文。', 409);
      } else if (options.supplement) {
        const input = { urlImport: undefined, webImages: undefined, ...(await this.input(item, section, false)) };
        if (raw.assetId && !input.assetId) throw new NewsError('请补采原报告 PDF。当前原件及正文已保留。', 409);
        input.title = raw.title;
        input.url = raw.url;
        input.publishedAt = raw.publishedAt ?? input.publishedAt;
        input.author = raw.author ?? input.author;
        input.tags = raw.newsMaterial
          ? raw.tags
          : raw.tags.filter((tag) => !receipt!.input.sourceName.endsWith(`（${tag}）`));
        const revision = raw.bodyRevision ?? 0;
        if (input.newsMaterial) input.newsMaterial.revision = revision + 1;
        const expectedBodySha256 = raw.bodySha256;
        const replace = () =>
          this.raws.updateBody(
            receipt.rawId,
            {
              body: input.body,
              expectedBodySha256,
              expectedBodyRevision: revision,
            },
            this.deps.ensureIdle ?? (async () => undefined),
            input,
          );
        const updated = await (this.deps.withRawLock?.(replace) ?? replace());
        if (!updated) throw new NewsError('原 Raw 已删除。', 409);
        raw = updated;
      }
      await this.linkPdf(raw);
      if (receipt.status === 'pending') {
        receipt.status = 'linked';
        receipt.updatedAt = this.clock().toISOString();
        try {
          await writeJsonAtomic(this.file(url), receipt);
        } catch {
          throw new NewsError('保存状态待核对，请重试。', 409);
        }
      }
      return {
        rawId: receipt.rawId,
        status: 'saved' as const,
        created,
        material: this.material(raw, receipt),
        ...(registrationId ? { owned: receipt.registrationId === registrationId } : {}),
      };
    });
  }
  async savedRawId(item: NewsItem) {
    return (await this.savedRaw(item))?.rawId;
  }
  async savedRaw(item: NewsItem) {
    const receipt = await this.read(normalizedUrl(item.url));
    if (!receipt) return;
    const raw = await this.check(receipt);
    if (raw) return { rawId: receipt.rawId, material: this.material(raw, receipt) };
  }
  async confirmedBetween(from: string, until: string) {
    const scan = await scanJsonRecords(
      this.directory(),
      (value, file): value is Receipt => {
        const url = (value as Partial<Receipt> | null)?.normalizedUrl;
        return (
          typeof url === 'string' &&
          this.file(url) === file &&
          validReceipt(value, url) &&
          typeof value.updatedAt === 'string' &&
          Number.isFinite(Date.parse(value.updatedAt)) &&
          new Date(value.updatedAt).toISOString() === value.updatedAt
        );
      },
      this.root,
    );
    if (scan.issues.length) throw new NewsError('无法核实部分资讯保存收据。', 409);
    return new Set(
      scan.records.flatMap(({ value }) =>
        value.status === 'linked' && value.updatedAt >= from && value.updatedAt < until ? [value.rawId] : [],
      ),
    ).size;
  }
  async projection(edition: NewsEdition) {
    const items: NewsSavedRaw[] = [];
    for (const section of ['fmcg', 'ai'] as const) {
      const part = edition.sections[section];
      const additional = section === 'fmcg' ? edition.legacyFmcg?.items : part?.sourceItems;
      for (const item of [...(part?.items ?? []), ...(additional ?? [])]) {
        try {
          const receipt = await this.read(normalizedUrl(item.url));
          if (!receipt) continue;
          const exists = await this.check(receipt);
          items.push({
            section,
            itemId: item.id,
            rawId: receipt.rawId,
            status: receipt.status === 'pending' ? 'pending' : exists ? 'saved' : 'missing',
            ...(exists && receipt.status === 'linked' ? { material: this.material(exists, receipt) } : {}),
          });
        } catch (error) {
          const message =
            error instanceof NewsError || error instanceof RawIntegrityError
              ? error.message
              : '这条资讯的保存状态无法读取。';
          items.push({ section, itemId: item.id, status: 'error', message });
        }
      }
    }
    return { items };
  }
}
