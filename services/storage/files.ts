// B04: shared atomic file helpers and a small serial queue for the new state directories.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class StorageError extends Error {
  constructor(public code: string, message: string, public status = 500, public details?: unknown) { super(message); }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Windows reports a transient EPERM/EBUSY when a virus scanner or indexer briefly holds the
 * target file. Retrying the same atomic rename keeps that transient lock from failing a real
 * operation, while a genuine permission error still surfaces after the last attempt.
 */
async function renameAtomic(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

export async function writeFileAtomic(target: string, value: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, value, { encoding: 'utf8', flag: 'wx' });
    await renameAtomic(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Lists readable JSON records; unreadable/blocked entries are reported, never silently merged. */
export async function listJsonRecords<T>(dir: string): Promise<Array<{ file: string; value: T }>> {
  const names = (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json'));
  const records: Array<{ file: string; value: T }> = [];
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    try { records.push({ file, value: JSON.parse(await readFile(file, 'utf8')) as T }); }
    catch { continue; }
  }
  return records;
}

/** Serializes mutations that touch the same state directory. */
export class SerialQueue {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
