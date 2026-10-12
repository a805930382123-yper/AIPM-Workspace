// B03: retained original files. The original bytes are stored verbatim under
// knowledge/raw/assets/; the file name is metadata only and never becomes a path.
// A stored original is written and verified before any parsing is attempted, so a
// failed parse can always be explained ("原件已保留，正文未入库") after a restart.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_BY_FORMAT, type StoredFormat } from './parse.ts';

export type AssetStatus = 'stored' | 'parsed' | 'parse_failed' | 'detached';

export type AssetRecord = {
  id: string;
  /** Original client file name. Metadata only: never used to build a path. */
  fileName: string;
  /** Actual format, updated to the detected format once the content has been inspected. */
  format: StoredFormat;
  declaredExtension: string;
  byteSize: number;
  sha256: string;
  /** Basename of the retained original inside knowledge/raw/assets/. */
  storedFile: string;
  createdAt: string;
  status: AssetStatus;
  rawId?: string;
  parser?: string;
  extractionNote?: string;
  failure?: { code: string; message: string; at: string };
  detachedAt?: string;
};

export class AssetStore {
  constructor(public readonly root: string) {}

  private directory() { return path.join(this.root, 'knowledge', 'raw', 'assets'); }
  private recordPath(id: string) { return path.join(this.directory(), `${id}.json`); }

  async initialize() { await mkdir(this.directory(), { recursive: true }); }

  async list(): Promise<AssetRecord[]> {
    const names = (await readdir(this.directory()).catch(() => [])).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name));
    const records: AssetRecord[] = [];
    for (const name of names) {
      // A record path blocked by a directory or a corrupt record must not break the whole
      // list: the retained original is still on disk and reconcile() can still repair the rest.
      try { records.push(JSON.parse(await readFile(path.join(this.directory(), name), 'utf8')) as AssetRecord); }
      catch { continue; }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<AssetRecord | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    try { return JSON.parse(await readFile(this.recordPath(id), 'utf8')) as AssetRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }

  private async writeRecord(record: AssetRecord): Promise<void> {
    const target = this.recordPath(record.id);
    const temp = path.join(this.directory(), `.${record.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private static hash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }

  /**
   * Persist the original bytes verbatim and verify the stored file before returning.
   * Throws (with no record left behind) when the write or the verification fails.
   */
  async store(bytes: Buffer, input: { fileName: string; format: StoredFormat; declaredExtension: string }): Promise<AssetRecord> {
    await this.initialize();
    const id = randomUUID();
    const storedFile = `${id}${EXTENSION_BY_FORMAT[input.format]}`;
    const target = path.join(this.directory(), storedFile);
    const temp = path.join(this.directory(), `.${storedFile}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, bytes, { flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    let sha256: string;
    try {
      const stored = await readFile(target);
      if (!stored.equals(bytes)) throw new Error('stored bytes differ from the received bytes');
      sha256 = AssetStore.hash(stored);
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
    const record: AssetRecord = {
      id, fileName: input.fileName, format: input.format, declaredExtension: input.declaredExtension,
      byteSize: bytes.length, sha256, storedFile, createdAt: new Date().toISOString(), status: 'stored',
    };
    try { await this.writeRecord(record); }
    catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
    return record;
  }

  async markParsed(id: string, patch: { format?: StoredFormat; rawId: string; parser: string; extractionNote: string }): Promise<AssetRecord | undefined> {
    return this.update(id, record => ({ ...record, ...patch, status: 'parsed' }));
  }

  async markFailed(id: string, patch: { format?: StoredFormat; code: string; message: string }): Promise<AssetRecord | undefined> {
    return this.update(id, record => ({
      ...record, format: patch.format ?? record.format, status: 'parse_failed',
      failure: { code: patch.code, message: patch.message, at: new Date().toISOString() },
    }));
  }

  async markDetached(id: string, rawId: string): Promise<AssetRecord | undefined> {
    return this.update(id, record => ({ ...record, rawId, status: 'detached', detachedAt: new Date().toISOString() }));
  }

  /**
   * F03-01: start-up reconciliation of the Raw ↔ original-file linkage.
   *  - `stored` + a committed Raw that points at this asset  → complete the link (`parsed`).
   *  - `stored` without such a Raw (import was interrupted)  → safe compensation (`parse_failed`,
   *    code IMPORT_INTERRUPTED): the original is kept and no Raw exists, which is explainable.
   *  - `parsed` whose Raw no longer exists                    → mark `detached` (stale link).
   * Per-record failures are collected, never thrown, so one blocked record cannot stop the rest.
   */
  async reconcile(raws: Array<{ id: string; assetId?: string; assetFormat?: string; extractionParser?: string; extractionNote?: string }>): Promise<{
    linked: string[]; compensated: string[]; detached: string[]; failed: string[];
  }> {
    const byAssetId = new Map<string, typeof raws[number]>();
    const rawIds = new Set<string>();
    for (const raw of raws) {
      rawIds.add(raw.id);
      if (raw.assetId) byAssetId.set(raw.assetId, raw);
    }
    const result = { linked: [] as string[], compensated: [] as string[], detached: [] as string[], failed: [] as string[] };
    for (const record of await this.list()) {
      try {
        if (record.status === 'stored') {
          const raw = byAssetId.get(record.id);
          if (raw) {
            await this.markParsed(record.id, {
              format: (raw.assetFormat as StoredFormat | undefined) ?? record.format,
              rawId: raw.id,
              parser: raw.extractionParser ?? record.parser ?? '未知解析器',
              extractionNote: raw.extractionNote ?? record.extractionNote ?? '',
            });
            result.linked.push(record.id);
          } else {
            await this.markFailed(record.id, {
              code: 'IMPORT_INTERRUPTED',
              message: '上一次导入在创建正式 Raw 之前中断；原件已保留、未创建 Raw，可重新导入该文件。',
            });
            result.compensated.push(record.id);
          }
        } else if (record.status === 'parsed' && record.rawId && !rawIds.has(record.rawId)) {
          await this.markDetached(record.id, record.rawId);
          result.detached.push(record.id);
        }
      } catch { result.failed.push(record.id); }
    }
    return result;
  }

  private async update(id: string, change: (record: AssetRecord) => AssetRecord): Promise<AssetRecord | undefined> {
    const current = await this.get(id);
    if (!current) return undefined;
    const next = change(current);
    await this.writeRecord(next);
    return next;
  }
}
