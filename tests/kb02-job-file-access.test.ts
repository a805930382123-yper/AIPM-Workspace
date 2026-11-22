import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { ExtractionJobStore, type ExtractionJob } from '../services/llm/jobs.ts';
import { readJsonFile, writeJsonAtomic } from '../services/storage/files.ts';
import { RecoveryRegistry } from '../services/storage/recovery.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { atomicFault } from './support/kb02-storage-fault.ts';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function sample(rawId: string): ExtractionJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    rawId,
    status: 'running',
    stage: 'extracting',
    chunksTotal: 1,
    chunksDone: 0,
    pagesFound: 0,
    provider: { name: 'fake', model: 'file-access' },
    callCount: 0,
    cancelRequested: false,
    startedAt: now,
    updatedAt: now,
  };
}
const same = (a: unknown, b: string) => path.resolve(String(a)).toLowerCase() === path.resolve(b).toLowerCase();

for (const operation of ['update', 'insert'] as const)
  test(
    `job file held get excludes ${operation} from another store but not another job`,
    { timeout: 15000 },
    async () => {
      const f = await storageFixture(),
        job = sample(f.raw.id),
        held = gate(),
        entered = gate();
      const file = path.join(f.root, 'state/extraction-jobs', job.id + '.json');
      const originalRead = fs.readFile,
        originalOpen = fs.open,
        originalRename = fs.rename;
      let armed = true,
        renames = 0,
        reader: Promise<unknown> | undefined,
        writer: Promise<unknown> | undefined;
      try {
        await f.jobs.insert(job);
        fs.readFile = (async (target: any, options?: any) => {
          if (!same(target, file) || !armed) return originalRead(target, options);
          armed = false;
          const handle = await originalOpen(target, 'r');
          try {
            const bytes = await handle.readFile(options);
            entered.release();
            await held.promise;
            return bytes;
          } finally {
            await handle.close();
          }
        }) as typeof fs.readFile;
        fs.rename = async (from, to) => {
          if (same(to, file)) renames++;
          return originalRename(from, to);
        };
        syncBuiltinESMExports();
        reader = f.jobs.get(job.id);
        await entered.promise;
        const other = new ExtractionJobStore(path.join(f.root, '.'));
        writer =
          operation === 'update' ? other.update(job.id, { callCount: 1 }) : other.insert({ ...job, callCount: 1 });
        await other.insert(sample(f.raw.id));
        await turn();
        assert.equal(renames, 0, 'No atomic replacement may begin while its reader holds the file');
        held.release();
        await Promise.all([reader, writer]);
        assert.equal((await other.get(job.id))?.callCount, 1);
        assert.equal(renames, 1);
      } finally {
        held.release();
        await Promise.allSettled([reader, writer]);
        fs.readFile = originalRead;
        fs.rename = originalRename;
        syncBuiltinESMExports();
        await f.clean();
      }
    },
  );

test(
  'job atomic replacement excludes get, list, generic JSON read and recovery scan across instances',
  { timeout: 15000 },
  async () => {
    const f = await storageFixture(),
      job = sample(f.raw.id),
      held = gate(),
      entered = gate();
    const file = path.join(f.root, 'state/extraction-jobs', job.id + '.json');
    const originalRead = fs.readFile,
      originalOpen = fs.open,
      originalRename = fs.rename;
    let watched = false,
      reads = 0,
      armed = true,
      writer: Promise<unknown> | undefined;
    const consumers: Promise<unknown>[] = [];
    try {
      await f.jobs.insert(job);
      fs.rename = async (from, to) => {
        if (same(to, file) && armed) {
          armed = false;
          entered.release();
          await held.promise;
        }
        return originalRename(from, to);
      };
      fs.readFile = (async (target: any, options?: any) => {
        if (watched && same(target, file)) reads++;
        return originalRead(target, options);
      }) as typeof fs.readFile;
      fs.open = (async (target: any, flags: any, mode?: any) => {
        if (watched && same(target, file)) reads++;
        return originalOpen(target, flags, mode);
      }) as typeof fs.open;
      syncBuiltinESMExports();
      writer = f.jobs.update(job.id, { callCount: 1 });
      await entered.promise;
      watched = true;
      const other = new ExtractionJobStore(f.root);
      consumers.push(other.get(job.id), other.list(), readJsonFile(file), new RecoveryRegistry(f.root).scan());
      await other.insert(sample(f.raw.id));
      await turn();
      assert.equal(reads, 0, 'Consumers must not open the target before atomic replacement completes');
      held.release();
      const [, results] = await Promise.all([writer, Promise.all(consumers)]);
      assert.equal((results[0] as ExtractionJob).callCount, 1);
      assert.equal((results[1] as ExtractionJob[]).find((item) => item.id === job.id)?.callCount, 1);
      assert.equal((results[2] as ExtractionJob).callCount, 1);
      assert.equal((results[3] as Awaited<ReturnType<RecoveryRegistry['scan']>>).totalIssues, 0);
    } finally {
      held.release();
      await Promise.allSettled([writer, ...consumers]);
      fs.readFile = originalRead;
      fs.open = originalOpen;
      fs.rename = originalRename;
      syncBuiltinESMExports();
      await f.clean();
    }
  },
);

for (const consumer of ['list', 'recovery'] as const)
  test(`job ${consumer} keeps coordination until its real file handle closes`, { timeout: 15000 }, async () => {
    const f = await storageFixture(),
      job = sample(f.raw.id),
      held = gate(),
      entered = gate();
    const file = path.join(f.root, 'state/extraction-jobs', job.id + '.json');
    const originalOpen = fs.open,
      originalRename = fs.rename;
    let armed = true,
      renames = 0;
    let reader: Promise<unknown> | undefined, writer: Promise<unknown> | undefined;
    try {
      await f.jobs.insert(job);
      fs.open = (async (target: any, flags: any, mode?: any) => {
        const handle = await originalOpen(target, flags, mode);
        if (same(target, file) && armed) {
          armed = false;
          const close = handle.close.bind(handle);
          handle.close = async () => {
            entered.release();
            await held.promise;
            return close();
          };
        }
        return handle;
      }) as typeof fs.open;
      fs.rename = async (from, to) => {
        if (same(to, file)) renames++;
        return originalRename(from, to);
      };
      syncBuiltinESMExports();
      reader = consumer === 'list' ? new ExtractionJobStore(f.root).list() : new RecoveryRegistry(f.root).scan();
      await entered.promise;
      writer = f.jobs.update(job.id, { callCount: 1 });
      await new ExtractionJobStore(f.root).insert(sample(f.raw.id));
      await turn();
      assert.equal(renames, 0);
      held.release();
      await Promise.all([reader, writer]);
      assert.equal((await f.jobs.get(job.id))?.callCount, 1);
    } finally {
      held.release();
      await Promise.allSettled([reader, writer]);
      fs.open = originalOpen;
      fs.rename = originalRename;
      syncBuiltinESMExports();
      await f.clean();
    }
  });

test(
  'job mutations across instances retain independent fields and release after corrupt reads or persistent rename refusal',
  { timeout: 15000 },
  async () => {
    const f = await storageFixture(),
      job = sample(f.raw.id);
    let fault: ReturnType<typeof atomicFault> | undefined;
    try {
      const other = new ExtractionJobStore(f.root);
      await f.jobs.insert(job);
      await Promise.all([f.jobs.update(job.id, { callCount: 1 }), other.update(job.id, { pagesFound: 7 })]);
      assert.equal((await other.get(job.id))?.callCount, 1);
      assert.equal((await other.get(job.id))?.pagesFound, 7);
      const file = path.join(f.root, 'state/extraction-jobs', job.id + '.json');
      await fs.writeFile(file, '{broken');
      await assert.rejects(other.get(job.id), { code: 'STORAGE_CORRUPT' });
      await writeJsonAtomic(file, { ...job, callCount: 1, pagesFound: 7 });
      const before = await fs.readFile(file);
      fault = atomicFault(f.root, 'failed-job');
      await assert.rejects(other.update(job.id, { status: 'failed' }), { code: 'EPERM' });
      assert.equal(fault.events.length, 6);
      assert.deepEqual(await fs.readFile(file), before);
      fault.release();
      await other.update(job.id, { status: 'failed' });
      assert.equal((await f.jobs.get(job.id))?.status, 'failed');
      assert.equal((await f.jobs.get(job.id))?.callCount, 1);
      assert.equal(f.requests.length, 0);
    } finally {
      fault?.restore();
      await f.clean();
    }
  },
);

test(
  'job polling and independent recovery scans coexist with atomic updates without native rename rejection',
  { timeout: 20000 },
  async () => {
    const f = await storageFixture(),
      job = sample(f.raw.id),
      originalRename = fs.rename;
    let nativeFailures = 0,
      stop = false;
    let polling: Promise<void> | undefined;
    try {
      await f.jobs.insert(job);
      fs.rename = async (from, to) => {
        try {
          return await originalRename(from, to);
        } catch (error) {
          if (String(to).startsWith(f.root)) nativeFailures++;
          throw error;
        }
      };
      syncBuiltinESMExports();
      const other = new ExtractionJobStore(f.root),
        registry = new RecoveryRegistry(f.root);
      polling = (async () => {
        while (!stop) {
          assert.ok(await other.get(job.id));
          await other.list();
          assert.equal((await registry.scan()).totalIssues, 0);
        }
      })();
      for (let calls = 1; calls <= 80; calls++) await f.jobs.update(job.id, { callCount: calls });
      stop = true;
      await polling;
      assert.equal((await other.get(job.id))?.callCount, 80);
      assert.equal(nativeFailures, 0);
    } finally {
      stop = true;
      await polling;
      fs.rename = originalRename;
      syncBuiltinESMExports();
      await f.clean();
    }
  },
);
