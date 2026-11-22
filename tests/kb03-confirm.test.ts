import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { confirmFixture } from './support/kb03-confirm-fixture.ts';
import { approveDraft } from './support/human-review.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { renderStructuredNote, parseNoteGrid } from '../services/wiki/structured-note.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';

test('KB03 confirm HTTP Source-only still requires all pages, explicit note review, warning/report acknowledgment and current digest', async () => {
  const f = await confirmFixture();
  try {
    const commit = async (d = f.d, extra = {}) =>
      f.http.request(`/api/drafts/${d.id}/confirm`, { ...f.input(d), ...extra });
    assert((await commit()).status >= 400);
    assert.equal((await f.wiki.allRecords()).length, 0);
    let d = await approveDraft(f.drafts, f.d.id, f.raw.body);
    assert((await commit(d)).status >= 400);
    const review = {
      baseRevision: d.revision,
      reviewContentDigest: f.drafts.contentDigest(d),
      warningsAcknowledged: true,
      historicalReportAcknowledged: true,
    };
    for (const patch of [
      { warningsAcknowledged: false },
      { historicalReportAcknowledged: false },
      { reviewContentDigest: 'a'.repeat(64) },
      { noteApproval: { approved: true } },
    ]) {
      const r = await f.http.request(`/api/drafts/${d.id}/review/structured-note`, { ...review, ...patch });
      assert(r.status >= 400);
    }
    const response = await f.http.request(`/api/drafts/${d.id}/review/structured-note`, review);
    assert.equal(response.status, 200, JSON.stringify(response));
    d = (await f.drafts.get(d.id))!;
    assert.equal(d.noteApproval!.digest, f.drafts.contentDigest(d));
    assert.equal(d.humanReview!.approvals.length, d.pages.length);
    assert.equal((await commit(d, { noteApproval: { approved: true } })).status, 400);
    const result = await commit(d);
    assert.equal(result.status, 201, JSON.stringify(result));
    const records = await f.wiki.allRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].type, 'source');
    assert.equal((records[0].body.match(/^## 深度整理笔记$/gm) ?? []).length, 1);
    assert(!records[0].body.includes('[['));
    assert(records[0].body.includes('补充知识，未经原文支持'));
    assert(records[0].body.includes('待核实'));
    assert(records[0].body.includes('事实引用'));
    assert.equal((await f.rawStates.get(f.raw.id)).status, 'generated');
    const repeated = await commit(d);
    assert.equal(repeated.status, 201);
    assert(repeated.json.reused);
    assert.equal((await f.wiki.allRecords()).length, 1);
    assert.equal(f.requests.length, 6);
  } finally {
    await f.clean();
  }
});
test('KB03 confirm selected subset, manual text/role/evidence/table special characters retained; all edits invalidate both approvals', async () => {
  const f = await confirmFixture();
  try {
    let d = await f.review([0]);
    const approved = d.noteApproval!.digest;
    const note = structuredClone(d.structuredNote!);
    const table = note.sections[0].blocks.find((b) => b.type === 'table')!;
    assert(table.type === 'table');
    table.rows[0].cells[1] = '竖线 | 换行\nHTML <script>bad()</script> 链接 [[在售口径]] `字面`';
    d = await f.drafts.editStructuredNote(
      d.id,
      { baseRevision: d.revision, structuredNote: note, humanQuestions: ['人工待确认：负责人。'] },
      f.raw.body,
    );
    assert(!d.noteApproval);
    assert.equal(d.humanReview!.approvals.length, 0);
    assert.notEqual(f.drafts.contentDigest(d), approved);
    await assert.rejects(f.wiki.withLock(() => f.commits.confirm(f.input(d))));
    d = await f.review([0]);
    const result = await f.wiki.withLock(() => f.commits.confirm(f.input(d)));
    const source = result.manifest.snapshot.sourceRecord!;
    assert.equal(result.manifest.snapshot.pageRecords.length, 1);
    assert(source.body.includes('[[门店范围]]'));
    assert(!source.body.includes('[[在售口径]]'));
    assert(source.body.includes('人工修改，已人工核对'));
    assert(source.body.includes('历史模型报告，编辑后未复核'));
    assert(source.body.includes('人工待确认：负责人'));
    assert(source.body.includes('&#124;'));
    assert(source.body.includes('&#10;'));
    assert(source.body.includes('&lt;script&gt;'));
    const exportMd = (await f.wiki.exportMarkdown(source.id))!;
    assert.equal(exportMd.markdown, await f.wiki.readPageFile(source.id));
    const snapshot = async () =>
      Promise.all([
        f.wiki.readPageFile(source.id),
        f.wiki.readPageFile(result.manifest.snapshot.pageRecords[0].id),
        readFile(path.join(f.root, 'knowledge/logs/wiki.jsonl'), 'utf8'),
      ]);
    const before = await snapshot(),
      confirmed = (await f.drafts.get(d.id))!;
    const mismatch = { ...f.input(confirmed), selectedPageIds: [] };
    await assert.rejects(
      f.wiki.withLock(() => f.commits.confirm(mismatch)),
      { code: 'CONFIRM_PAYLOAD_CHANGED', status: 409 },
    );
    assert.equal((await f.commits.list()).length, 1);
    assert.deepEqual(await snapshot(), before);
    const manifestFile = path.join(f.root, 'state/wiki-commits', result.manifest.operationId + '.json');
    await rename(manifestFile, manifestFile + '.held');
    await assert.rejects(
      f.wiki.withLock(() => f.commits.confirm(mismatch)),
      { code: 'DRAFT_ALREADY_COMMITTED', status: 409 },
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await f.clean();
  }
});
test('KB03 note review blocks uncovered and validly accepts numeric warning only with explicit acknowledgment; existing same-Raw Source conflicts', async () => {
  const f = await confirmFixture();
  try {
    let d = f.d;
    const note = structuredClone(d.structuredNote!);
    note.sections[0].blocks = note.sections[0].blocks.filter((b) => b.type !== 'paragraph');
    d = await f.drafts.editStructuredNote(d.id, { baseRevision: d.revision, structuredNote: note }, f.raw.body);
    d = await approveDraft(f.drafts, d.id, f.raw.body);
    await assert.rejects(
      f.drafts.reviewStructuredNote(
        d.id,
        {
          baseRevision: d.revision,
          reviewContentDigest: f.drafts.contentDigest(d),
          warningsAcknowledged: true,
          historicalReportAcknowledged: true,
        },
        f.raw.body,
      ),
      { code: 'NOTE_COVERAGE_INCOMPLETE' },
    );
    d = await f.drafts.editStructuredNote(
      d.id,
      { baseRevision: d.revision, structuredNote: f.d.structuredNote },
      f.raw.body,
    );
    d = await f.review();
    await f.wiki.create({
      title: '已有来源',
      type: 'source',
      category: 'metric',
      sources: [f.raw.id],
      body: '旧Source不覆盖',
      tags: [],
      aliases: [],
      knowledge_status: 'source_supported',
      confidence: 'medium',
      source_level: 'D',
      review_status: 'unreviewed',
    } as any);
    await assert.rejects(
      f.wiki.withLock(() => f.commits.confirm(f.input(d))),
      { code: 'DEEP_SOURCE_EXISTS' },
    );
    assert.equal((await f.wiki.allRecords()).length, 1);
  } finally {
    await f.clean();
  }
});
test('KB03 explicit numeric warning acceptance persists warning, and selection/source-level mutations revoke page and note approval', async () => {
  const f = await confirmFixture();
  try {
    let d = await f.review(),
      digest = d.noteApproval!.digest;
    const same = await f.drafts.patch(
      d.id,
      { baseRevision: d.revision, pages: d.pages.map((p) => ({ pageId: p.pageId, selected: p.selected })) },
      { body: f.raw.body, rules: f.rules },
    );
    assert.equal(same.noteApproval?.digest, digest);
    assert.equal(same.revision, d.revision);
    d = await f.drafts.patch(
      d.id,
      { baseRevision: d.revision, source: { source_level: 'C' } },
      { body: f.raw.body, rules: f.rules },
    );
    assert(!d.noteApproval);
    assert.equal(d.humanReview!.approvals.length, 0);
    d = await f.review();
    const note = structuredClone(d.structuredNote!);
    const first = note.sections[0].blocks[0];
    assert(first.type === 'paragraph');
    first.text = '人工改为120家。';
    d = await f.drafts.editStructuredNote(d.id, { baseRevision: d.revision, structuredNote: note }, f.raw.body);
    d = await approveDraft(f.drafts, d.id, f.raw.body);
    let result = await f.http.request(`/api/drafts/${d.id}/review/structured-note`, {
      baseRevision: d.revision,
      reviewContentDigest: f.drafts.contentDigest(d),
      warningsAcknowledged: false,
      historicalReportAcknowledged: true,
    });
    assert.equal(result.status, 400);
    result = await f.http.request(`/api/drafts/${d.id}/review/structured-note`, {
      baseRevision: d.revision,
      reviewContentDigest: f.drafts.contentDigest(d),
      warningsAcknowledged: true,
      historicalReportAcknowledged: true,
    });
    assert.equal(result.status, 200);
    d = (await f.drafts.get(d.id))!;
    const saved = await f.wiki.withLock(() => f.commits.confirm(f.input(d)));
    assert(saved.manifest.snapshot.sourceRecord!.body.includes('确定性警告（人工已知悉）'));
    assert(saved.manifest.snapshot.sourceRecord!.body.includes('120家'));
  } finally {
    await f.clean();
  }
});
for (const phase of ['zero', 'pages', 'index', 'log'] as const)
  test(`KB03 real ${phase} write failure resumes frozen transaction and logs exactly once`, async () => {
    const f = await confirmFixture();
    try {
      const d = await f.review([0]),
        input = f.input(d);
      const write = f.wiki.writePageLocked.bind(f.wiki),
        index = f.wiki.rebuildIndexLocked.bind(f.wiki),
        log = f.wiki.appendLogLocked.bind(f.wiki);
      let calls = 0;
      if (phase === 'zero' || phase === 'pages')
        f.wiki.writePageLocked = async (r) => {
          if (++calls === (phase === 'zero' ? 1 : 2)) throw Error('isolated disk failure');
          return write(r);
        };
      if (phase === 'index')
        f.wiki.rebuildIndexLocked = async () => {
          throw Error('isolated index failure');
        };
      if (phase === 'log')
        f.wiki.appendLogLocked = async () => {
          throw Error('isolated log failure');
        };
      await assert.rejects(f.wiki.withLock(() => f.commits.confirm(input)));
      const manifest = (await f.commits.get(input.operationId))!;
      assert.notEqual(manifest.status, 'completed');
      assert.equal((await f.wiki.allRecords()).length, phase === 'zero' ? 0 : phase === 'pages' ? 1 : 2);
      f.wiki.writePageLocked = write;
      f.wiki.rebuildIndexLocked = index;
      f.wiki.appendLogLocked = log;
      if (phase === 'pages') {
        const file = path.join(f.root, 'drafts', d.id + '.json'),
          current = JSON.parse(await readFile(file, 'utf8'));
        current.structuredNote.orientation = '后来的可变草稿不能重渲染冻结正文';
        await writeFile(file, JSON.stringify(current));
      }
      const recovery =
        phase === 'pages'
          ? JSON.parse(
              (
                await promisify(execFile)(process.execPath, [
                  '--import',
                  'tsx',
                  'tests/support/kb03-confirm-restart.ts',
                  f.root,
                ])
              ).stdout,
            )
          : await f.commits.reconcile();
      assert.equal(recovery.resumed.length, 1, JSON.stringify(recovery));
      assert.equal((await f.wiki.allRecords()).length, 2);
      assert.equal((await f.wiki.get(manifest.snapshot.sourceRecord!.id))!.body, manifest.snapshot.sourceRecord!.body);
      const logs = await readFile(path.join(f.root, 'knowledge/logs/wiki.jsonl'), 'utf8');
      assert.equal(
        logs
          .trim()
          .split('\n')
          .filter((x) => JSON.parse(x).operationId === input.operationId).length,
        2,
      );
      assert.equal((await f.commits.reconcile()).resumed.length, 0);
      assert.equal(f.requests.length, 6);
    } finally {
      await f.clean();
    }
  });
test('KB03 partial recovery rejects changed target bytes and old deep prepared without frozen approval', async () => {
  const f = await confirmFixture();
  try {
    const d = await f.review([0]),
      input = f.input(d),
      write = f.wiki.writePageLocked.bind(f.wiki);
    let calls = 0;
    f.wiki.writePageLocked = async (r) => {
      if (++calls === 2) throw Error('stop');
      return write(r);
    };
    await assert.rejects(f.wiki.withLock(() => f.commits.confirm(input)));
    f.wiki.writePageLocked = write;
    const manifest = (await f.commits.get(input.operationId))!,
      source = manifest.snapshot.sourceRecord!,
      file = path.join(f.root, 'state/wiki-commits', input.operationId + '.json');
    await write({ ...source, body: '外部冲突正文不覆盖' });
    let result = await f.commits.reconcile();
    assert.equal(result.conflicts[0].code, 'COMMIT_TARGET_CONFLICT');
    assert.equal((await f.wiki.get(source.id))!.body, '外部冲突正文不覆盖');
    await write(source);
    delete manifest.snapshot.deepNote;
    await writeFile(file, JSON.stringify(manifest));
    result = await f.commits.reconcile();
    assert.equal(result.resumed.length, 0);
    assert.equal(result.conflicts[0].code, 'NOTE_REVIEW_REQUIRED');
    await rm(path.join(f.root, 'drafts', d.id + '.json'));
    result = await f.commits.reconcile();
    assert.equal(result.resumed.length, 0);
    assert.equal(result.conflicts[0].code, 'NOTE_REVIEW_REQUIRED');
  } finally {
    await f.clean();
  }
});
test('KB03 existing backup restores new TEMP root; Markdown/Raw SHA and idempotent transaction survive without old process', async (t) => {
  const f = await confirmFixture(),
    target = await mkdtemp(path.join(os.tmpdir(), 'kb03-confirm-restored-')),
    archive = path.join(os.tmpdir(), randomUUID() + '.json');
  try {
    const d = await f.review([0]),
      input = f.input(d),
      result = await f.wiki.withLock(() => f.commits.confirm(input));
    const exported = JSON.parse(
      (
        await promisify(execFile)(process.execPath, [
          '--import',
          'tsx',
          'scripts/backup_workspace.ts',
          'export',
          '--data-root',
          f.root,
          '--output',
          archive,
        ])
      ).stdout,
    );
    const restored = JSON.parse(
      (
        await promisify(execFile)(process.execPath, [
          '--import',
          'tsx',
          'scripts/backup_workspace.ts',
          'restore',
          '--input',
          archive,
          '--data-root',
          target,
        ])
      ).stdout,
    );
    t.diagnostic(JSON.stringify({ backupCli: true, files: exported.files, restoredFiles: restored.files }));
    const raws = new RawStore(target),
      drafts = new DraftStore(target),
      states = new RawStateStore(target),
      wiki = new WikiStore(target, raws);
    await Promise.all([raws.initialize(), drafts.initialize(), states.initialize(), wiki.initialize()]);
    const commits = new WikiCommitService({ root: target, rawStore: raws, drafts, rawStates: states, wikiStore: wiki });
    await commits.initialize();
    await commits.reconcile();
    for (const r of [result.manifest.snapshot.sourceRecord!, ...result.manifest.snapshot.pageRecords]) {
      const a = await f.wiki.readPageFile(r.id),
        b = await wiki.readPageFile(r.id);
      assert.equal(createHash('sha256').update(a!).digest('hex'), createHash('sha256').update(b!).digest('hex'));
    }
    assert.equal((await raws.get(f.raw.id))!.body, f.raw.body);
    const rawPath = path.join('knowledge/raw/reports', f.raw.id + '.md');
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(f.root, rawPath)))
        .digest('hex'),
      createHash('sha256')
        .update(await readFile(path.join(target, rawPath)))
        .digest('hex'),
    );
    assert((await drafts.get(d.id))!.structuredNote);
    const retried = await wiki.withLock(() => commits.confirm({ ...input, operationId: randomUUID() }));
    assert(retried.reused);
    assert.equal((await wiki.allRecords()).length, 2);
  } finally {
    await f.clean();
    await rm(target, { recursive: true, force: true });
    await rm(archive, { force: true });
  }
});
test('KB03 restricted formal pipe tables encode all user structure and parse exact cell counts', async () => {
  const f = await confirmFixture();
  try {
    const note = structuredClone(f.d.structuredNote!);
    const table = note.sections[0].blocks.find((b) => b.type === 'table')!;
    assert(table.type === 'table');
    table.rows[0].cells[0] = 'a | b\n中 <img src=x> [链接](x)';
    const lines = renderStructuredNote(note, true).split('\n'),
      start = lines.findIndex((l) => l.startsWith('| ')),
      grid = parseNoteGrid(lines, start)!;
    assert.equal(grid.headings.length, 3);
    assert.equal(grid.rows[0].length, 3);
    assert(grid.rows[0][0].includes('&#124;'));
    assert(grid.rows[0][0].includes('&#10;'));
    assert(!parseNoteGrid(['| a | b |', '| --- | --- |', '| wrong |'], 0));
  } finally {
    await f.clean();
  }
});
test('KB03 formal confirmation retains Meeting source prohibition and deep pipeline rejects known secret output', async () => {
  const f = await confirmFixture();
  try {
    const d = await f.review(),
      restricted = new WikiCommitService({
        root: f.root,
        wikiStore: f.wiki,
        drafts: f.drafts,
        rawStates: f.rawStates,
        rawStore: { get: async () => ({ ...f.raw, origin: {} }) } as any,
      });
    await restricted.initialize();
    await assert.rejects(f.wiki.withLock(() => restricted.confirm(f.input(d))));
    assert.equal((await f.wiki.allRecords()).length, 0);
    const secret = 'sk-kb03-isolated-private-value';
    Object.defineProperty(f.provider, 'secrets', { value: [secret] });
    f.mutate((stage, v) => {
      if (stage === 'writing') v.sections[0].blocks[0].text = secret;
      return v;
    });
    const restart = await f.start('deep', { restart: true }),
      view = await f.wait(restart.json.jobId);
    assert.equal(view.job?.status, 'failed');
    assert.equal(view.job?.error?.code, 'LLM_OUTPUT_CONTAINS_SECRET');
    assert(!JSON.stringify(view).includes(secret));
    assert.equal((await f.wiki.allRecords()).length, 0);
  } finally {
    await f.clean();
  }
});
test('KB03 standard Source-only remains rejected through HTTP and direct commit service', async () => {
  const f = await storageFixture();
  f.succeed();
  const job = await f.wait((await f.start()).job.id),
    d = (await f.drafts.get(job.draftId!))!,
    http = await storageHttp(f),
    wiki = new WikiStore(f.root, f.rawStore);
  await wiki.initialize();
  const commits = new WikiCommitService({
    root: f.root,
    rawStore: f.rawStore,
    rawStates: f.rawStates,
    drafts: f.drafts,
    wikiStore: wiki,
  });
  await commits.initialize();
  try {
    const input = {
      draftId: d.id,
      baseRevision: d.revision,
      selectedPageIds: [],
      operationId: randomUUID(),
      idempotencyKey: 'empty-standard',
      now: new Date().toISOString(),
    };
    assert.equal((await http.request(`/api/drafts/${d.id}/confirm`, input)).status, 400);
    await assert.rejects(
      wiki.withLock(() => commits.confirm(input)),
      { code: 'NO_SELECTION' },
    );
    assert.equal((await wiki.allRecords()).length, 0);
  } finally {
    await http.close();
    await f.clean();
  }
});
