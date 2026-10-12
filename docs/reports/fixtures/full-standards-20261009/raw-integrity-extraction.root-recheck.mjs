import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RawStore } from '../../../../services/raw/store.ts';
import { RawStateStore } from '../../../../services/raw/state.ts';
import { ExtractionJobStore, ExtractionRunner } from '../../../../services/llm/jobs.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'fmcg-standards-raw-'));
try {
  const raws = new RawStore(root);
  await raws.initialize();
  const original = await raws.create({ title: '隔离Raw', sourceType: 'report', sourceName: 'fixture', tags: [], body: '原始证据 A。' });
  const rawFile = path.join(root, 'knowledge', 'raw', 'reports', `${original.id}.md`);
  const originalFile = await readFile(rawFile, 'utf8');
  const changedBody = '外部改写后的证据 B。';
  await writeFile(rawFile, originalFile.replace('原始证据 A。', changedBody), 'utf8');

  const readBack = await raws.get(original.id);
  assert.ok(readBack);
  const actualHash = createHash('sha256').update(readBack.body, 'utf8').digest('hex');
  const state = new RawStateStore(root);
  const jobs = new ExtractionJobStore(root);
  await state.initialize();
  await jobs.initialize();
  let passedBodyToExtraction;
  const runner = new ExtractionRunner({
    root,
    rawStore: raws,
    rawStates: state,
    jobs,
    drafts: { findActiveForRaw: async () => undefined },
    llm: { wikiExtract: async ({ body }) => { passedBodyToExtraction = body; throw new Error('stop at isolated extraction boundary'); } },
    provider: () => ({ name: 'fixture-provider', model: 'fixture', secrets: [], complete: async () => { throw new Error('must not contact a real provider'); } }),
    draftRules: async () => ({ types: [], categories: [], knowledge_status: [], confidence: [], source_level: [], review_status: [] }),
    rulesDir: path.resolve('rules'),
  });
  const started = await runner.start(original.id, { newJobId: randomUUID(), now: new Date().toISOString() });
  for (let i = 0; i < 100 && (await jobs.get(started.job.id))?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const result = {
    storedFrontmatterHash: readBack.bodySha256,
    actualBodyHash: actualHash,
    hashesDiffer: readBack.bodySha256 !== actualHash,
    rawStoreReturnedChangedBody: readBack.body === changedBody,
    extractionReceivedChangedBody: passedBodyToExtraction === changedBody,
    actualProviderNetworkCall: false,
  };
  assert.equal(result.hashesDiffer, true);
  assert.equal(result.rawStoreReturnedChangedBody, true);
  assert.equal(result.extractionReceivedChangedBody, true);
  await writeFile(new URL('./raw-integrity-extraction.root-recheck.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result));
} finally {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('fmcg-standards-')) throw new Error('Unsafe cleanup path'); await rm(root, { recursive: true, force: true });
}

