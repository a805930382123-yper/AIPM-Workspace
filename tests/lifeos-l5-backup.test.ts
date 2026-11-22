import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';
test('L5真实v1归档保全active/recycle反馈和旧无字段记录，恢复不复活', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'l5-backup-'));
  const root = path.join(parent, 'source');
  try {
    const raw = new RawStore(root);
    await raw.initialize();
    const wiki = new WikiStore(root, raw);
    await wiki.initialize();
    const store = new PromptStore(root, wiki);
    await store.initialize();
    const input = {
      name: 'active',
      category: 'customer',
      scenario: '虚构',
      body: '原正文',
      inputRequirements: '',
      outputRequirements: '',
      relatedWikiIds: [],
      examples: '',
      tags: [],
      favorite: false,
    };
    const active = (await store.create(randomUUID(), input)).prompt,
      legacy = (await store.create(randomUUID(), { ...input, name: 'legacy' })).prompt,
      recycled = (await store.create(randomUUID(), { ...input, name: 'recycle' })).prompt;
    const oldArchive = path.join(parent, 'old-archive.json');
    await exportWorkspace(root, oldArchive);
    const note = {
      usedOn: '2026-10-31',
      scenario: '使用',
      outcome: 'helpful' as const,
      observation: '反馈文本',
      nextImprovement: '',
    };
    const v1 = await store.createFeedback(active.id, { ...note, id: randomUUID(), promptVersion: 1 });
    await store.update(active.id, 1, { ...input, body: '新正文' });
    const v2 = await store.createFeedback(active.id, { ...note, id: randomUUID(), promptVersion: 2 });
    await store.createFeedback(recycled.id, { ...note, id: randomUUID(), promptVersion: 1 });
    await store.delete(recycled.id, 1);
    const files = [`prompts/${active.id}.json`, `prompts/${legacy.id}.json`, `prompts/recycle/${recycled.id}.json`];
    const before = await Promise.all(files.map((file) => readFile(path.join(root, file))));
    const archive = path.join(parent, 'archive.json'),
      target = path.join(parent, 'restored');
    await exportWorkspace(root, archive);
    await restoreWorkspace(archive, target);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(path.join(target, files[i])), before[i]);
    const raw2 = new RawStore(target),
      wiki2 = new WikiStore(target, raw2),
      next = new PromptStore(target, wiki2);
    assert.deepEqual(
      (await next.getFeedback(active.id)).map((x) => x.id).sort(),
      [v1.feedback.id, v2.feedback.id].sort(),
    );
    assert.equal(await next.get(recycled.id), undefined);
    await assert.rejects(next.getFeedback(recycled.id));
    const oldFile = path.join(target, 'prompts', legacy.id + '.json'),
      oldBytes = await readFile(oldFile);
    assert.deepEqual(await next.getFeedback(legacy.id), []);
    assert.deepEqual(await readFile(oldFile), oldBytes);
    await next.createFeedback(legacy.id, { ...note, id: randomUUID(), promptVersion: 1 });
    assert.equal((await next.getFeedback(legacy.id)).length, 1);
    // An old archive with no feedback remains the same v1 format, without migration-on-read.
    const old = JSON.parse(await readFile(oldArchive, 'utf8'));
    assert.equal(old.version, 1);
    const oldTarget = path.join(parent, 'old-restored');
    await restoreWorkspace(oldArchive, oldTarget);
    const oldRaw = new RawStore(oldTarget),
      oldWiki = new WikiStore(oldTarget, oldRaw),
      oldStore = new PromptStore(oldTarget, oldWiki);
    const oldPath = path.join(oldTarget, 'prompts', active.id + '.json'),
      beforeOld = await readFile(oldPath);
    assert.deepEqual(await oldStore.getFeedback(active.id), []);
    assert.deepEqual(await readFile(oldPath), beforeOld);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
