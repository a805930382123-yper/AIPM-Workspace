import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DraftStore } from '../services/wiki/drafts.ts';
import { RecoveryRegistry } from '../services/storage/recovery.ts';

test('PA01 strict draft reads preserve corrupt bytes and return a healthy neighbor including manual evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-pa01-sol-drafts-'));
  try {
    const store = new DraftStore(root);
    await store.initialize();
    const id = randomUUID(),
      rawId = randomUUID(),
      now = new Date().toISOString();
    const healthy = {
      id,
      rawId,
      rawSha256: 'a'.repeat(64),
      rawTitle: '虚构资料',
      rawMeta: { rawId, title: '虚构资料', sourceType: 'article', sourceName: '虚构来源' },
      status: 'pending_confirmation',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      rulesVersion: 'test',
      provider: { name: 'local', model: 'fake' },
      jobId: randomUUID(),
      document: { title: '资料', main_topic: '主题', summary: '摘要' },
      pages: [
        {
          pageId: randomUUID(),
          title: '概念',
          type: 'concept',
          category: 'other',
          one_line_definition: '定义',
          source_facts: [{ text: '事实', evidenceIds: ['manual'] }],
          ai_organized: [],
          ai_inferences: [],
          related_pages: [],
          open_questions: [],
          source_evidence: [{ id: 'manual', rawId, quote: '资料', start: 0, end: 2, chunkIndex: -1 }],
          knowledge_status: 'source_supported',
          confidence: 'low',
          source_level: 'D',
          selected: false,
          provenance: [],
        },
      ],
      source: {
        title: '来源',
        category: 'other',
        summary: '摘要',
        key_takeaways: [],
        body: '资料',
        knowledge_status: 'source_supported',
        confidence: 'low',
        source_level: 'D',
      },
      warnings: [],
      extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
    };
    await writeFile(path.join(root, 'drafts', id + '.json'), JSON.stringify(healthy));
    const badId = randomUUID(),
      file = path.join(root, 'drafts', badId + '.json'),
      bytes = JSON.stringify({ ...healthy, id: badId, pages: [{}] });
    await writeFile(file, bytes);
    await assert.rejects(() => store.get(badId), { code: 'STORAGE_CORRUPT' });
    assert.deepEqual(
      (await store.list()).map((x) => x.id),
      [id],
    );
    assert.equal((await store.get(id))?.pages[0].source_evidence[0].chunkIndex, -1);
    const registry = new RecoveryRegistry(root),
      first = await registry.scan(),
      second = await registry.scan();
    assert.equal(first.items.length, 1);
    assert.deepEqual(second.items, first.items);
    assert.equal(await readFile(file, 'utf8'), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PA01 recovery reuses full Prompt draft validation and retains deep shape problems', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-pa01-sol-prompt-'));
  try {
    const dir = path.join(root, 'drafts', 'prompts');
    await mkdir(dir, { recursive: true });
    const id = randomUUID(),
      file = path.join(dir, id + '.json'),
      bytes = JSON.stringify({
        id,
        kind: 'optimizer',
        status: 'pending',
        createdAt: new Date().toISOString(),
        schemaVersion: 2,
        checks: [],
      });
    await writeFile(file, bytes);
    const registry = new RecoveryRegistry(root);
    const a = await registry.scan(),
      b = await registry.scan();
    assert.equal(a.items.length, 1);
    assert.equal(a.items[0].reason, 'shape');
    assert.deepEqual(a.items, b.items);
    assert.equal(await readFile(file, 'utf8'), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PA01 recovery clears an observed missing draft only after rescanning', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '.test-pa01-sol-deleted-'));
  try {
    const store = new DraftStore(root);
    await store.initialize();
    const id = randomUUID(),
      file = path.join(root, 'drafts', id + '.json');
    await writeFile(file, '{broken');
    await assert.rejects(() => store.get(id), { code: 'STORAGE_CORRUPT' });
    const registry = new RecoveryRegistry(root);
    assert.equal((await registry.scan()).items.length, 1);
    await rm(file);
    assert.equal((await registry.scan()).items.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
