import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
import { RawStore } from '../services/raw/store.ts';
import * as workflowExports from '../services/wiki/knowledge-workflows.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { approveWorkflow } from './support/human-review.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-be03-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root);
  await raws.initialize();
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  await workflows.initialize();
  const sources = await Promise.all(
    ['甲渠道只报告本周门店情况。', '乙渠道尚未实施下一期计划。'].map((body, index) =>
      raws.create({ title: `合成来源${index + 1}`, body, sourceType: 'report', sourceName: '合成测试', tags: [] }),
    ),
  );
  const requests: LlmCompletionRequest[] = [];
  const provider: LlmProvider = {
    name: 'fake',
    model: 'be03-offline',
    complete: async (request) => {
      requests.push(request);
      const input = JSON.parse(request.user) as {
        raws: Array<{ id: string; locators: Array<{ id: string; text: string }> }>;
      };
      const text = JSON.stringify({
        synthesis_format_version: 1,
        title: '合成渠道工作流',
        category: 'metric',
        sourceLevels: input.raws.map((raw) => ({ rawId: raw.id, source_level: 'D' })),
        suggestedAdditions: input.raws.map((raw) => ({
          text: raw.locators[0].text,
          rawId: raw.id,
          locatorId: raw.locators[0].id,
        })),
        conflicts: [],
        agreement: [],
        inferences: [],
        openQuestions: [],
      });
      return { text, finishReason: 'stop', bytes: Buffer.byteLength(text) };
    },
  };
  const workflow = await workflows.createSynthesis({ rawIds: sources.map((raw) => raw.id), provider });
  assert.equal(requests.length, 1);
  const reviewed = await approveWorkflow(workflows, workflow.id);
  return { root, raws, wiki, workflows, reviewed, requests };
}

test('BE03 facade keeps its runtime export and bounded LF modules form an acyclic internal graph', async () => {
  assert.deepEqual(Object.keys(workflowExports), ['KnowledgeWorkflowStore']);
  const directory = fileURLToPath(new URL('../services/wiki/', import.meta.url));
  const files = [
    'knowledge-workflows.ts',
    ...(await readdir(directory)).filter((name) => /^workflow-.*\.ts$/.test(name)),
  ];
  const graph = new Map<string, string[]>();
  for (const name of files) {
    const source = await readFile(path.join(directory, name), 'utf8');
    assert(Buffer.byteLength(source) < 40_960, `${name} size`);
    assert(source.split('\n').length < 800, `${name} lines`);
    assert(!source.includes('\r'), `${name} LF`);
    const imports = [...source.matchAll(/from '\.\/(workflow-[^']+\.ts|knowledge-workflows\.ts)'/g)].map((m) => m[1]);
    if (name !== 'knowledge-workflows.ts') assert(!imports.includes('knowledge-workflows.ts'), `${name} points inward`);
    graph.set(name, imports);
  }
  const visited = new Set<string>();
  const visit = (name: string, ancestors: string[]) => {
    assert(!ancestors.includes(name), `module cycle: ${[...ancestors, name].join(' -> ')}`);
    if (visited.has(name)) return;
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...ancestors, name]);
    visited.add(name);
  };
  visit('knowledge-workflows.ts', []);
  assert.equal(visited.size, files.length, 'all split modules belong to the facade dependency graph');
});

test('BE03 equivalent resolved roots serialize edits across instances and invalidate approval only once', async (t) => {
  const f = await fixture(t);
  const second = new KnowledgeWorkflowStore(`${f.root}${path.sep}.`, f.wiki, f.raws);
  const sections = structuredClone(f.reviewed.sections);
  sections.inferences.push('由人工修改的推断。');
  let release!: () => void;
  let entered!: () => void;
  let saved = false;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  const save = f.workflows.save.bind(f.workflows);
  f.workflows.save = async (record) => {
    entered();
    await waiting;
    const stored = await save(record);
    saved = true;
    return stored;
  };
  const get = second.get.bind(second);
  second.get = async (id) => {
    assert(saved, 'the second instance must read only after the first queued save completes');
    return get(id);
  };
  const firstPatch = f.workflows.patch(f.reviewed.id, f.reviewed.revision, sections);
  await started;
  const secondPatch = second.patch(f.reviewed.id, f.reviewed.revision, sections);
  release();
  const results = await Promise.allSettled([firstPatch, secondPatch]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.equal(failure?.reason.code, 'WORKFLOW_REVISION_CONFLICT');
  const stored = (await second.get(f.reviewed.id))!;
  assert.equal(stored.revision, f.reviewed.revision + 1);
  assert.deepEqual(stored.humanReview!.approvals, []);
  assert.deepEqual(stored.humanEditedSections, ['inferences']);
  const noOp = await second.patch(stored.id, stored.revision, stored.sections);
  assert.deepEqual(noOp, stored);
  assert.equal(f.requests.length, 1);
});

test('BE03 failed manifest replacement retains the actually written page and restart completes without rewriting it', async (t) => {
  const f = await fixture(t);
  const operations = path.join(f.root, 'state', 'knowledge-commits');
  const write = f.wiki.writePageLocked.bind(f.wiki);
  let blockedFile = '';
  let writtenId = '';
  f.wiki.writePageLocked = async (record) => {
    await write(record);
    writtenId = record.id;
    const [name] = await readdir(operations);
    blockedFile = path.join(operations, name);
    await rename(blockedFile, `${blockedFile}.held`);
    await mkdir(blockedFile);
  };
  let operationId = '';
  await assert.rejects(
    f.wiki.withLock(() => f.workflows.confirm(f.reviewed.id, f.reviewed.revision, 'be03-manifest-failure')),
    (error: unknown) => {
      const pending = error as {
        code: string;
        details: { operationId: string; writtenIds: string[]; recoverable: boolean };
      };
      assert.equal(pending.code, 'WORKFLOW_COMMIT_PENDING');
      assert.deepEqual(pending.details.writtenIds, [writtenId]);
      assert.equal(pending.details.recoverable, true);
      operationId = pending.details.operationId;
      return true;
    },
  );
  const diskManifest = JSON.parse(await readFile(`${blockedFile}.held`, 'utf8'));
  assert.equal(diskManifest.status, 'committing');
  assert.deepEqual(diskManifest.writtenIds, []);
  assert(await f.wiki.get(writtenId));
  await rm(blockedFile, { recursive: true });
  await rename(`${blockedFile}.held`, blockedFile);
  const resumedWrites: string[] = [];
  const order: string[] = [];
  f.wiki.writePageLocked = async (record) => {
    resumedWrites.push(record.id);
    order.push('page');
    await write(record);
  };
  const index = f.wiki.rebuildIndexLocked.bind(f.wiki);
  const log = f.wiki.appendLogLocked.bind(f.wiki);
  f.wiki.rebuildIndexLocked = async () => {
    assert.equal(JSON.parse(await readFile(blockedFile, 'utf8')).status, 'committing');
    order.push('index');
    await index();
  };
  f.wiki.appendLogLocked = async (entries) => {
    assert.equal(JSON.parse(await readFile(blockedFile, 'utf8')).status, 'committing');
    order.push('log');
    await log(entries);
  };
  const restarted = new KnowledgeWorkflowStore(f.root, f.wiki, f.raws);
  await restarted.initialize();
  const completed = (await restarted.getCommit(operationId))!;
  assert.equal(completed.status, 'completed');
  assert.deepEqual(
    completed.writtenIds,
    completed.records.map((record) => record.id),
  );
  assert(!resumedWrites.includes(writtenId));
  assert.equal(resumedWrites.length, completed.records.length - 1);
  assert.deepEqual(order, [...resumedWrites.map(() => 'page'), 'index', 'log']);
  assert.equal((await restarted.get(f.reviewed.id))!.status, 'confirmed');
  assert.equal(f.requests.length, 1);
});

test('BE03 completed transaction repairs a failed workflow finalization while preserving later human page edits', async (t) => {
  const f = await fixture(t);
  f.workflows.save = async () => {
    throw new Error('synthetic terminal workflow save failure');
  };
  await assert.rejects(
    f.wiki.withLock(() => f.workflows.confirm(f.reviewed.id, f.reviewed.revision, 'be03-finalize-failure')),
    /synthetic terminal workflow save failure/,
  );
  assert.equal((await f.workflows.get(f.reviewed.id))!.status, 'pending_confirmation');
  const operations = path.join(f.root, 'state', 'knowledge-commits');
  const [name] = await readdir(operations);
  const operationId = path.basename(name, '.json');
  const completed = (await f.workflows.getCommit(operationId))!;
  assert.equal(completed.status, 'completed');
  const synthesis = completed.records.find((record) => record.type === 'synthesis')!;
  const edited = { ...synthesis, body: '提交完成后的人工编辑，必须原样保留。', revision: synthesis.revision + 1 };
  await f.wiki.withLock(() => f.wiki.writePageLocked(edited));
  f.wiki.writePageLocked = async () => {
    assert.fail('completed reconciliation must not replay page writes');
  };
  f.wiki.rebuildIndexLocked = async () => {
    assert.fail('completed reconciliation must not rebuild the transaction index');
  };
  f.wiki.appendLogLocked = async () => {
    assert.fail('completed reconciliation must not append another transaction log');
  };
  const restarted = new KnowledgeWorkflowStore(f.root, f.wiki, f.raws);
  await restarted.initialize();
  const finalized = (await restarted.get(f.reviewed.id))!;
  assert.equal(finalized.status, 'confirmed');
  assert.equal(finalized.commitOperationId, operationId);
  assert.equal(finalized.committedWikiId, synthesis.id);
  assert.equal(finalized.revision, f.reviewed.revision + 1);
  assert.equal((await f.wiki.get(synthesis.id))!.body, edited.body);
  const reused = await f.wiki.withLock(() => restarted.confirm(finalized.id, finalized.revision, 'be03-after-restart'));
  assert.equal(reused.reused, true);
  assert.deepEqual(reused.workflow, finalized);
  assert.equal(f.requests.length, 1);
});
