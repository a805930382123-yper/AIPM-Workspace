import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { DemoService } from '../services/demo/service.ts';
import { exportWorkspace, restoreWorkspace } from './backup_workspace.ts';

const base = await mkdtemp(path.join(process.cwd(), '.b09-selfcheck-'));
const root = path.join(base, 'demo-root');
const backupRoot = path.join(base, 'backup-source');
const archiveFile = path.join(base, 'workspace-backup.json');
const restored = path.join(base, 'restored');
try {
  const raw = new RawStore(root);
  const wiki = new WikiStore(root, raw);
  const prompt = new PromptStore(root, wiki);
  await raw.initialize();
  await wiki.initialize();
  await prompt.initialize();
  const demo = new DemoService(root, raw, wiki, prompt);
  assert.equal((await demo.get()).imported, false, 'startup/read must not seed demo content');
  const createRaw = raw.createDemo.bind(raw);
  let failOnce = true;
  raw.createDemo = async (id, input) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('B09 injected one-time raw write fault');
    }
    return createRaw(id, input);
  };
  const partial = await demo.import(true);
  assert.equal(partial.complete, false);
  assert.ok(partial.conflicts.length > 0);
  assert.equal((await demo.get()).items.length, 10);
  const results = await Promise.all([demo.import(true), demo.import(true)]);
  assert.ok(results.every((result) => result.complete));
  assert.equal((await raw.list()).filter((item) => item.isDemo).length, 1);
  assert.equal((await wiki.list()).filter((item) => item.isDemo).length, 5);
  assert.equal((await prompt.list()).filter((item) => item.isDemo).length, 4);
  const currentWiki = (await wiki.list()).find((item) => item.isDemo)!;
  const editedWiki = await wiki.update(currentWiki.id, currentWiki.revision, {
    title: currentWiki.title,
    type: currentWiki.type,
    category: currentWiki.category,
    sources: currentWiki.sources,
    tags: currentWiki.tags,
    aliases: currentWiki.aliases,
    knowledge_status: currentWiki.knowledge_status,
    confidence: currentWiki.confidence,
    source_level: currentWiki.source_level,
    review_status: currentWiki.review_status,
    body: `${currentWiki.body}\n用户编辑标记`,
  });
  const currentPrompt = (await prompt.list()).find((item) => item.isDemo)!;
  await prompt.update(currentPrompt.id, currentPrompt.version, {
    name: currentPrompt.name,
    category: currentPrompt.category,
    scenario: currentPrompt.scenario,
    body: `${currentPrompt.body}\n用户编辑标记`,
    inputRequirements: currentPrompt.inputRequirements,
    outputRequirements: currentPrompt.outputRequirements,
    relatedWikiIds: currentPrompt.relatedWikiIds,
    examples: currentPrompt.examples,
    tags: currentPrompt.tags,
    favorite: currentPrompt.favorite,
  });
  const deletedWiki = (await wiki.list()).find((item) => item.isDemo && item.id !== editedWiki.id)!;
  await wiki.delete(deletedWiki.id, deletedWiki.revision);
  const reused = await demo.import(true);
  assert.equal(reused.complete, true);
  assert.equal(reused.reused.length, 9);
  assert.equal(reused.deleted.length, 1);
  assert.equal((await wiki.get(editedWiki.id))?.isDemo, true);
  assert.match((await wiki.get(editedWiki.id))?.body ?? '', /用户编辑标记/);
  assert.equal((await prompt.get(currentPrompt.id))?.isDemo, true);
  assert.match((await prompt.get(currentPrompt.id))?.body ?? '', /用户编辑标记/);
  assert.equal(await wiki.get(deletedWiki.id), undefined, 'deleted demo Wiki must not be revived');

  await mkdir(path.join(backupRoot, 'knowledge', 'raw', 'assets'), { recursive: true });
  await mkdir(path.join(backupRoot, 'prompts', 'recycle'), { recursive: true });
  await mkdir(path.join(backupRoot, 'drafts'), { recursive: true });
  await mkdir(path.join(backupRoot, 'state', 'raw-processing'), { recursive: true });
  await writeFile(
    path.join(backupRoot, 'knowledge', 'raw', 'assets', 'binary.png'),
    Buffer.from([0, 1, 127, 128, 255]),
  );
  await writeFile(path.join(backupRoot, 'prompts', 'recycle', 'history.json'), '{"version":3}\n');
  await writeFile(path.join(backupRoot, 'drafts', 'draft.json'), '{"status":"pending_confirmation"}\n');
  await writeFile(path.join(backupRoot, 'state', 'raw-processing', 'item.json'), '{"status":"failed"}\n');
  await assert.rejects(
    () => exportWorkspace(path.join(base, 'missing-source'), path.join(base, 'missing-source.json')),
    /数据根目录不存在/,
  );
  const exported = await exportWorkspace(backupRoot, archiveFile);
  assert.equal(exported.files, 4);
  const restoredResult = await restoreWorkspace(archiveFile, restored);
  assert.equal(restoredResult.files, 4);
  for (const relative of [
    'knowledge/raw/assets/binary.png',
    'prompts/recycle/history.json',
    'drafts/draft.json',
    'state/raw-processing/item.json',
  ]) {
    assert.deepEqual(
      await readFile(path.join(restored, ...relative.split('/'))),
      await readFile(path.join(backupRoot, ...relative.split('/'))),
    );
  }
  await assert.rejects(() => restoreWorkspace(archiveFile, restored), /必须不存在或为空目录/);
  const archive = JSON.parse(await readFile(archiveFile, 'utf8')) as { files: Array<Record<string, unknown>> };
  const originalPath = archive.files[0].path;
  archive.files[0].path = '../escape';
  const hostile = path.join(base, 'hostile.json');
  await writeFile(hostile, JSON.stringify(archive));
  await assert.rejects(() => restoreWorkspace(hostile, path.join(base, 'hostile-target')), /非法路径/);
  archive.files[0].path = originalPath;
  const duplicate = path.join(base, 'duplicate.json');
  archive.files.push({ ...archive.files[0] });
  await writeFile(duplicate, JSON.stringify(archive));
  await assert.rejects(() => restoreWorkspace(duplicate, path.join(base, 'duplicate-target')), /重复路径/);
  console.log(
    JSON.stringify({
      demo: 'pass',
      injectedFault: 'partial and retry pass',
      concurrentImport: 'pass',
      editPreservation: 'pass',
      deletedNotRevived: 'pass',
      backupRestore: 'pass',
      missingSourceRejected: 'pass',
      badTargetAndPaths: 'pass',
      files: 4,
    }),
  );
} finally {
  await rm(base, { recursive: true, force: true });
}
