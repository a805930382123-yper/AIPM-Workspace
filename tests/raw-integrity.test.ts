import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { RawIntegrityError, RawStore } from '../services/raw/store.ts';
import { ExtractionRunner } from '../services/llm/jobs.ts';

test('Raw get/list reject missing, malformed, or mismatched bodySha256; restored bytes remain readable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-raw-integrity-'));
  try {
    const store = new RawStore(root);
    await store.initialize();
    const body = '  原文🙂\r\n第二行\n---\n尾部空格  ';
    const raw = await store.create({ title: 'Integrity', sourceType: 'note', sourceName: 'fixture', tags: [], body });
    const file = path.join(root, 'knowledge', 'raw', 'notes', `${raw.id}.md`);
    const original = await readFile(file);
    const variants = [
      original.toString('utf8').replace(/^bodySha256:.*\r?\n/m, ''),
      original.toString('utf8').replace(/^bodySha256:.*\r?\n/m, 'bodySha256: invalid\n'),
      original.toString('utf8').replace('第二行', '被外部修改的正文'),
    ];
    for (const damaged of variants) {
      await writeFile(file, damaged, 'utf8');
      for (const read of [() => store.get(raw.id), () => store.list()]) {
        await assert.rejects(
          read,
          (error) => error instanceof RawIntegrityError && error.code === 'RAW_INTEGRITY_ERROR' && error.status === 409,
        );
      }
    }
    await writeFile(file, original);
    const recovered = await store.get(raw.id);
    assert.equal(recovered?.body, body);
    assert.deepEqual(await readFile(file), original);
    assert.equal((await store.list())[0]?.body, body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('first extraction rejects a corrupt Raw before reading state, jobs, drafts, or Provider', async () => {
  const calls: string[] = [];
  const runner = new ExtractionRunner({
    root: 'unused',
    llm: {} as never,
    jobs: {
      get: async () => {
        calls.push('jobs');
      },
    } as never,
    drafts: {
      findActiveForRaw: async () => {
        calls.push('drafts');
      },
    } as never,
    rawStates: {
      get: async () => {
        calls.push('state');
      },
    } as never,
    rawStore: {
      get: async () => {
        calls.push('raw');
        throw new RawIntegrityError();
      },
    } as never,
    provider: () => {
      calls.push('provider');
      return undefined;
    },
    draftRules: async () => ({}) as never,
    rulesDir: 'unused',
  });
  await assert.rejects(
    () =>
      runner.start('11111111-1111-4111-8111-111111111111', {
        newJobId: '22222222-2222-4222-8222-222222222222',
        now: new Date().toISOString(),
      }),
    (error) => error instanceof RawIntegrityError && error.code === 'RAW_INTEGRITY_ERROR' && error.status === 409,
  );
  assert.deepEqual(calls, ['raw']);
});
