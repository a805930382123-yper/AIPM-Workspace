import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { newHumanReview } from '../services/wiki/human-review.ts';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { confirmFixture } from './support/kb03-confirm-fixture.ts';
import { deepFixture } from './support/kb03-deep-fixture.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';
import { lwFixture } from './lw01-fixture.ts';
import { lw03Fixture } from './lw03-fixture.ts';

const draftPath = (root: string, id: string) => path.join(root, 'drafts', `${id}.json`);
const requestBody = (view: {revision: number; outcomeDigest: string}, selectedPageIds: string[], idempotencyKey = randomUUID()) => ({
  baseRevision: view.revision, outcomeDigest: view.outcomeDigest, selectedPageIds, idempotencyKey,
});

test('Raw outcome HTTP writes ten selected legacy deep cards with 32 units, only two historical approvals and no note approval', async () => {
  const f = await confirmFixture();
  try {
    const draft = structuredClone(f.d);
    assert.equal(draft.maintenance, undefined);
    while (draft.pages.length < 11) {
      draft.pages.push({ ...structuredClone(draft.pages[0]), pageId: randomUUID(), title: `独立虚构主题 ${draft.pages.length + 1}` });
    }
    const sourceUnits = draft.humanReview!.units;
    const units = [...sourceUnits];
    while (units.length < 32) {
      const id = `legacy-unit-${units.length}`;
      units.push({ id, kind: 'question', origin: 'legacy', text: '旧目录中待核问题', memberIds: [], records: [{ id, text: '旧目录中待核问题', evidenceIds: [] }], evidence: [] });
    }
    draft.humanReview = newHumanReview(units, Object.fromEntries(units.map((unit, index) => [unit.id, draft.humanReview!.assignments[unit.id] ?? (index % 2 ? null : draft.pages[index % 10].pageId)])));
    draft.humanReview.approvals = draft.pages.slice(0, 2).map(page => ({ pageId: page.pageId, digest: f.drafts.contentDigest(draft), at: draft.updatedAt }));
    draft.pages[10].source_evidence[0].quote = '未选候选的坏引用';
    await writeFile(draftPath(f.root, draft.id), JSON.stringify(draft));
    const original = await readFile(draftPath(f.root, draft.id));
    const url = `/api/drafts/${draft.id}`;
    const view = await f.http.request(url);
    assert.equal(view.status, 200, JSON.stringify(view));
    assert.match(view.json.outcomeDigest, /^[a-f0-9]{64}$/);
    assert.equal(view.json.humanReview.units.length, 32);
    assert(view.json.noteCoverage.some((entry: {status: string}) => entry.status === 'uncovered'));
    assert.deepEqual(await readFile(draftPath(f.root, draft.id)), original);
    const selected = draft.pages.slice(0, 10).map(page => page.pageId);
    const beforeCalls = f.requests.length;
    const body = requestBody(view.json, selected);
    const bad = await f.http.request(`${url}/confirm`, { ...body, selectedPageIds: [draft.pages[10].pageId] });
    assert.equal(bad.json.error.code, 'EVIDENCE_STALE');
    assert.equal((await f.wiki.allRecords()).length, 0);
    const committed = await f.http.request(`${url}/confirm`, body);
    assert.equal(committed.status, 201, JSON.stringify(committed));
    const records = await f.wiki.allRecords();
    assert.equal(records.length, 11);
    const source = records.find(page => page.type === 'source')!;
    assert.match(source.body, /已进行成果审核/);
    assert.doesNotMatch(source.body, /人工已明确查看报告|\[\[独立虚构主题 11\]\]/);
    assert(!records.some(page => page.title === draft.pages[10].title));
    assert.deepEqual((await f.drafts.get(draft.id))!.humanReview!.approvals, draft.humanReview.approvals);
    assert.equal((await f.drafts.get(draft.id))!.noteApproval, undefined);
    const manifest = (await f.commits.get(committed.json.operationId))!;
    assert.equal(manifest.snapshot.outcomeReview?.digest, body.outcomeDigest);
    assert.equal(manifest.humanReviewDigest, undefined);
    assert.equal(manifest.snapshot.deepNote, undefined);
    assert.deepEqual(manifest.snapshot.selectedPageIds, selected);
    const repeated = await f.http.request(`${url}/confirm`, body);
    assert.equal(repeated.json.operationId, committed.json.operationId);
    assert.equal(repeated.json.reused, true);
    assert.equal((await f.http.request(`${url}/confirm`, { ...body, selectedPageIds: selected.slice(1) })).json.error.code, 'IDEMPOTENCY_KEY_MISMATCH');
    assert.equal(f.requests.length, beforeCalls);
    assert.equal((await f.rawStore.get(f.raw.id))!.bodySha256, f.raw.bodySha256);
  } finally { await f.clean(); }
});

test('Raw outcome HTTP supports Source-only legacy deep and rejects forged digest or approval', async () => {
  const f = await confirmFixture();
  try {
    const url = `/api/drafts/${f.d.id}`;
    const view = await f.http.request(url);
    const body = requestBody(view.json, []);
    assert.equal((await f.http.request(`${url}/confirm`, { ...body, outcomeDigest: 'a'.repeat(64) })).json.error.code, 'REVIEW_CONTENT_CHANGED');
    assert.equal((await f.http.request(`${url}/confirm`, { ...body, outcomeReview: { version: 1 } })).status, 400);
    assert.equal((await f.wiki.allRecords()).length, 0);
    const result = await f.http.request(`${url}/confirm`, body);
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.deepEqual(result.json.wikiIds, []);
    const pages = await f.wiki.allRecords();
    assert.equal(pages.length, 1);
    assert.equal(pages[0].type, 'source');
    assert.match(pages[0].body, /## 深度整理笔记/);
  } finally { await f.clean(); }
});

test('Raw outcome HTTP confirms a legacy standard without a historical review catalog', async () => {
  const f = await storageFixture();
  const http = await storageHttp(f);
  try {
    f.succeed();
    const start = await http.request(`/api/raw/${f.raw.id}/extract`, { mode: 'standard' });
    await f.runner.waitForSettlement(start.json.jobId);
    const job = (await f.jobs.get(start.json.jobId))!;
    const draft = (await f.drafts.get(job.draftId!))!;
    delete draft.humanReview;
    delete draft.maintenance;
    draft.source.title = '虚构标准来源笔记';
    draft.pages[0].reviewDecision = 'defer';
    draft.pages.push(
      { ...structuredClone(draft.pages[0]), pageId: randomUUID(), title: '未选且无正式页' },
      { ...structuredClone(draft.pages[0]), pageId: randomUUID(), title: '未选但已有正式页' },
    );
    const wiki = new WikiStore(f.root, f.rawStore);
    await wiki.create({
      title: '未选但已有正式页', body: '独立人工页面。', type: 'concept', category: 'other', sources: [], tags: [], aliases: [],
      knowledge_status: 'ai_organized', confidence: 'high', source_level: 'D', review_status: 'unreviewed',
    });
    draft.source.body = '保留人工补充。[[未选且无正式页]]，继续参阅[[未选但已有正式页]]。';
    draft.source.bodyEditedByUser = true;
    await writeFile(draftPath(f.root, draft.id), JSON.stringify(draft));
    const url = `/api/drafts/${draft.id}`;
    const view = await http.request(url);
    assert.equal(view.status, 200, JSON.stringify(view));
    const body = requestBody(view.json, [draft.pages[0].pageId]);
    const { outcomeDigest: _outcomeDigest, ...legacy } = body;
    assert.equal((await http.request(`${url}/confirm`, legacy)).json.error.code, 'HUMAN_REVIEW_REQUIRED');
    const done = await http.request(`${url}/confirm`, body);
    assert.equal(done.status, 201, JSON.stringify(done));
    assert.equal(done.json.wikiIds.length, 1);
    assert.equal((await f.drafts.get(draft.id))!.humanReview, undefined);
    const source = (await wiki.get(done.json.sourceId))!;
    assert.match(source.body, /保留人工补充/);
    assert.match(source.body, /未选且无正式页/);
    assert.doesNotMatch(source.body, /\[\[未选且无正式页\]\]/);
    assert.match(source.body, /\[\[未选但已有正式页\]\]/);
  } finally { await http.close(); await f.clean(); }
});

test('Raw maintenance HTTP uses the explicit selection, preserves a deferred candidate, and supports a later confirmation', async () => {
  const f = await lwFixture();
  const http = await storageHttp(f, f.runner, { knowledge: true });
  try {
    f.setTopics(['渠道覆盖', '回访周期']);
    const raw = await f.rawStore.create({ title: '虚构维护样本', sourceType: 'report', sourceName: '测试', tags: [], body: '渠道覆盖10家。\n回访周期7天。' });
    const draft = await f.generate(raw.id);
    assert.equal(draft.maintenance!.changes.length, 2);
    assert(draft.maintenance!.changes.every(change => change.decision === 'defer' && !change.approval));
    const url = `/api/drafts/${draft.id}`;
    const initial = await http.request(url);
    const change = draft.maintenance!.changes[0];
    const edited = await http.request(`/api/knowledge/drafts/${draft.id}/changes/review`, {
      baseRevision: draft.revision, changeId: change.changeId, body: change.candidate.body + '\n已人工修改候选正文。',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited));
    const firstId = draft.pages[change.pageIndex].pageId;
    const secondId = draft.pages[draft.maintenance!.changes[1].pageIndex].pageId;
    const stale = await http.request(`${url}/confirm`, requestBody(initial.json, [firstId]));
    assert.equal(stale.json.error.code, 'DRAFT_REVISION_CONFLICT');
    const current = await http.request(url);
    assert.notEqual(current.json.outcomeDigest, initial.json.outcomeDigest);
    assert.equal(current.json.outcomeDigest, edited.json.outcomeDigest);
    const staleDigest = await http.request(`${url}/confirm`, requestBody({ ...current.json, outcomeDigest: initial.json.outcomeDigest }, [firstId]));
    assert.equal(staleDigest.json.error.code, 'REVIEW_CONTENT_CHANGED');
    assert.equal((await f.wiki.allRecords()).length, 0);
    const confirmation = requestBody(current.json, [firstId]);
    const [first, doubleClick] = await Promise.all([http.request(`${url}/confirm`, confirmation), http.request(`${url}/confirm`, confirmation)]);
    assert.equal(first.status, 201, JSON.stringify(first));
    assert.equal(doubleClick.status, 201, JSON.stringify(doubleClick));
    assert.equal(first.json.operationId, doubleClick.json.operationId);
    assert.notEqual(first.json.reused, doubleClick.json.reused);
    const afterFirst = await http.request(url);
    assert.equal(afterFirst.json.status, 'pending_confirmation');
    assert(afterFirst.json.maintenance.changes[0].committedOperationId);
    assert.equal(afterFirst.json.maintenance.changes[1].committedOperationId, undefined);
    assert(afterFirst.json.maintenance.changes.every((item: {approval?: unknown}) => !item.approval));
    const firstPages = await f.wiki.allRecords();
    assert.equal(firstPages.length, 2);
    assert(firstPages.some(page => page.body.includes('已人工修改候选正文')));
    assert.doesNotMatch(firstPages.find(page => page.type === 'source')!.body, /\[\[回访周期\]\]/);
    const second = await http.request(`${url}/confirm`, requestBody(afterFirst.json, [secondId]));
    assert.equal(second.status, 201, JSON.stringify(second));
    assert.equal(second.json.sourceId, first.json.sourceId);
    assert.equal((await http.request(url)).json.status, 'confirmed');
    assert.equal((await f.wiki.allRecords()).length, 3);
  } finally { await http.close(); }
});

test('Raw outcome checks selected maintenance dependencies and a changed Wiki target before writing', async () => {
  const f = await lwFixture();
  const http = await storageHttp(f);
  try {
    const makeRaw = (title: string, body: string) => f.rawStore.create({ title, body, sourceType: 'report', sourceName: '隔离测试', tags: ['渠道覆盖'] });
    const firstRaw = await makeRaw('虚构旧资料', '2025年渠道覆盖10家。');
    const firstDraft = await f.generate(firstRaw.id);
    const firstUrl = `/api/drafts/${firstDraft.id}`;
    const firstView = await http.request(firstUrl);
    const first = await http.request(`${firstUrl}/confirm`, requestBody(firstView.json, [firstDraft.pages[0].pageId]));
    assert.equal(first.status, 201, JSON.stringify(first));
    const target = (await f.wiki.get(first.json.wikiIds[0]))!;

    const nextRaw = await makeRaw('虚构新增资料', '2026年渠道覆盖20家。\n回访周期7天。');
    f.setTopics(['渠道覆盖', '回访周期']);
    const draft = await f.generate(nextRaw.id);
    const [update, create] = draft.maintenance!.changes;
    assert.equal(update.targetWikiId, target.id);
    update.dependsOn = [create.changeId];
    await writeFile(draftPath(f.root, draft.id), JSON.stringify(draft));
    const url = `/api/drafts/${draft.id}`;
    const view = await http.request(url);
    const onlyUpdate = requestBody(view.json, [draft.pages[update.pageIndex].pageId]);
    assert.equal((await http.request(`${url}/confirm`, onlyUpdate)).json.error.code, 'CHANGE_DEPENDENCY_REQUIRED');
    await f.wiki.update(target.id, target.revision, { ...target, body: target.body + '\n外部人工先改。' });
    const both = requestBody(view.json, draft.pages.map(page => page.pageId));
    const stale = await http.request(`${url}/confirm`, both);
    assert.equal(stale.json.error.code, 'WIKI_REVISION_CONFLICT');
    assert.equal((await f.commits.list()).length, 1);
    assert.equal((await f.wiki.allRecords()).length, 2);
    assert.match((await f.wiki.get(target.id))!.body, /外部人工先改。$/);
  } finally { await http.close(); }
});

test('Raw outcome partial write restarts from the frozen selection in a fresh Node process', async () => {
  const f = await confirmFixture();
  try {
    const url = `/api/drafts/${f.d.id}`;
    const view = await f.http.request(url);
    const body = requestBody(view.json, [f.d.pages[0].pageId]);
    const operationId = randomUUID();
    const write = f.wiki.writePageLocked.bind(f.wiki);
    f.wiki.writePageLocked = async record => {
      if (record.type !== 'source') throw Error('controlled write failure after the Source reached disk');
      return write(record);
    };
    await assert.rejects(f.wiki.withLock(() => f.commits.confirm({ ...body, draftId: f.d.id, operationId, now: new Date().toISOString() })), { code: 'COMMIT_FAILED' });
    const pending = (await f.commits.get(operationId))!;
    assert.equal(pending.status, 'failed');
    assert.equal((await f.wiki.allRecords()).length, 1);
    assert.equal((await f.http.request(url)).json.status, 'committing');
    const recovered = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tests/support/kb03-confirm-restart.ts', f.root]);
    const result = JSON.parse(recovered.stdout);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.resumed[0].operationId, operationId);
    assert.equal(result.resumed[0].status, 'completed');
    const done = await f.http.request(`${url}/confirm`, { ...body, idempotencyKey: randomUUID() });
    assert.equal(done.status, 201);
    assert.equal(done.json.operationId, operationId);
    assert.equal(done.json.reused, true);
    assert.deepEqual(done.json.writtenWikiIds, [pending.snapshot.sourceRecord!.id, pending.snapshot.pageRecords[0].id]);
    assert.equal((await f.http.request(url)).json.status, 'confirmed');
    const log = await readFile(path.join(f.root, 'knowledge/logs/wiki.jsonl'), 'utf8');
    assert.equal(log.trim().split('\n').filter(line => JSON.parse(line).operationId === operationId).length, 2);
  } finally { await f.clean(); }
});

test('Deep job continues after a persisted attempt count above its former limit and never auto-retries at initialization', async () => {
  const f = await deepFixture();
  try {
    f.hook(async stage => { if (stage === 'maintenance') throw Error('fake maintenance failure'); });
    const first = await f.start();
    assert.equal(first.status, 202);
    const jobId = first.json.jobId;
    for (let attempts = 6; attempts <= 11; attempts++) {
      const failed = (await f.wait(jobId)).job!;
      assert.equal(failed.status, 'failed');
      assert.equal(failed.callCount, attempts);
      assert.equal(f.requests.length, attempts);
      if (attempts < 11) assert.equal((await f.start()).json.jobId, jobId);
    }
    const old = (await f.checkpoint(jobId))!;
    assert.equal(old.chunks.length, 1);
    assert.equal(old.attempts, 11);
    assert(old.deep?.qualityReport);
    assert.equal(old.maintenance?.proposal, undefined);
    const formerLimit = { code: 'LLM_ATTEMPT_LIMIT', message: '历史任务累计调用已达上限。', at: new Date().toISOString() };
    await new ExtractionCheckpointStore(f.root).save({ ...old, lastError: formerLimit });
    const job = (await f.jobs.get(jobId))!;
    await f.jobs.update(jobId, { error: { ...job.error!, ...formerLimit } });
    const runner = f.newRunner();
    await runner.reconcile();
    assert.equal(f.requests.length, 11);
    assert.equal((await runner.readJob(jobId)).job?.callCount, 11);
    assert.equal((await runner.readJob(jobId)).job?.error?.code, 'LLM_ATTEMPT_LIMIT');
    f.hook(undefined);
    const result = await runner.start(f.raw.id, { newJobId: randomUUID(), now: new Date().toISOString(), mode: 'deep' });
    assert.equal(result.job.id, jobId);
    const finished = (await runner.waitForSettlement(jobId)).job!;
    assert.equal(finished.status, 'completed');
    assert.equal(finished.callCount, 12);
    assert.equal(f.requests.length, 12);
    assert.match(f.requests[11].system, /^知识维护提议/);
    const final = (await f.checkpoint(jobId))!;
    assert.equal(final.attempts, 12);
    assert.equal(final.stage, 'done');
    assert.deepEqual(final.completedChunks, old.completedChunks);
    assert.deepEqual(final.deep, old.deep);
  } finally { await f.clean(); }
});

test('Evidence-driven inspection and question drafts reject the Raw outcome intent', async () => {
  const f = await lw03Fixture();
  const http = await storageHttp(f);
  try {
    const inspection = await f.check(f.pages.slice(0, 2).map(page => page.id));
    const saved = await f.inspections.draft(inspection.id, { baseRevision: inspection.revision, selectedFindingIds: [inspection.findings[0].id], key: 'rawux01-inspection' });
    await f.seed('人工渠道知识', '有效门店统计口径需要区分签约与活跃。');
    const answer = await f.ask();
    const question = await f.answers.save(answer.id, { key: 'rawux01-answer', resultRevision: answer.revision, preview: f.preview(answer) });
    for (const id of [saved.draftId!, question.draftId!]) {
      const view = await http.request(`/api/drafts/${id}`);
      assert.equal(view.status, 200, JSON.stringify(view));
      assert.equal(view.json.outcomeDigest, undefined);
      const rejected = await http.request(`/api/drafts/${id}/confirm`, requestBody({ revision: view.json.revision, outcomeDigest: 'a'.repeat(64) }, [view.json.pages[0].pageId]));
      assert.equal(rejected.json.error.code, 'RAW_OUTCOME_ONLY');
    }
    assert.equal((await f.commits.list()).length, 0);
  } finally { await http.close(); }
});
