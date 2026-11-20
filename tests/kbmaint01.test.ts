import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';
import { registerAutomationRoutes } from '../server/automation-api.ts';
import { WikiLint } from '../services/audit/lint.ts';
import { AuditService } from '../services/audit/service.ts';
import { meterAutomationProvider, runInAutomationContext } from '../services/automation/context.ts';
import { firstDueAfter, isAutomationPlan, planWindow, samePlan } from '../services/automation/schedule.ts';
import { AutomationScheduler, type TaskDefinition } from '../services/automation/scheduler.ts';
import { createWikiInspect, selectInspectionPages, wikiInspectType } from '../services/automation/tasks/wiki-inspect.ts';
import { createWikiLint, wikiLintType, WikiLintSnapshots, type WikiLintSnapshot } from '../services/automation/tasks/wiki-lint.ts';
import type { AutomationInstance, AutomationPlan } from '../services/automation/types.ts';
import { WikiHealth } from '../services/automation/wiki-health.ts';
import { KnowledgeInspectionService } from '../services/llm/knowledge-inspections.ts';
import { OpenAiCompatibleProvider, type LlmProvider } from '../services/llm/provider.ts';
import { RawStore } from '../services/raw/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiStore, type WikiInput, type WikiRecord } from '../services/wiki/store.ts';

const iso = (time: number) => new Date(time).toISOString();
const instance: AutomationInstance = { pid: process.pid, port: 0, mode: 'development', startedAt: iso(Date.now()), hostname: os.hostname() };
const weekly = { kind: 'weekly', weekday: 1, time: '08:30', timezone: 'Asia/Shanghai' } as const;
const draftNames = (root: string) => readdir(path.join(root, 'drafts'));
const pageInput = (title: string, body: string, sources: string[] = []): WikiInput => ({
  title, body, sources, type: 'concept', category: 'channel', aliases: [], tags: [],
  knowledge_status: 'ai_organized', confidence: 'low', source_level: 'D', review_status: 'unreviewed',
});

async function temporary(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kbmaint01-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function run(scheduler: AutomationScheduler, type: string) {
  const start = await scheduler.runNow(type);
  for (let tries = 0; tries < 300; tries++) {
    const record = await scheduler.getRun(start.id);
    if (record.endedAt !== null) return record;
    await sleep(10);
  }
  assert.fail(`Timed out waiting for ${type}`);
}

async function fixture(t: TestContext) {
  const root = path.join(await temporary(t), 'data');
  let now = Date.now();
  let provider: LlmProvider | undefined;
  const raws = new RawStore(root);
  const wiki = new WikiStore(root, raws);
  const drafts = new DraftStore(root);
  const audits = new AuditService(root, wiki, raws);
  const inspections = new KnowledgeInspectionService({ root, wiki, raws, drafts, provider: () => provider });
  const snapshots = new WikiLintSnapshots(root);
  const health = new WikiHealth(root, snapshots, inspections);
  const scheduler: AutomationScheduler = new AutomationScheduler({ root, instance, clock: () => now,
    tasks: [createWikiLint(new WikiLint(root, raws, audits), snapshots, () => scheduler.successfulRuns(wikiLintType)), createWikiInspect(wiki, raws, inspections)],
    withProvider: execute => execute(() => provider), pruneArtifacts: time => snapshots.prune(time),
  });
  await raws.initialize();
  await wiki.initialize();
  await drafts.initialize();
  await inspections.initialize();
  await scheduler.initialize();
  t.after(() => scheduler.stop());
  const hashWiki = async () => {
    const dir = path.join(root, 'knowledge', 'wiki');
    return Object.fromEntries(await Promise.all((await readdir(dir)).filter(file => file.endsWith('.md')).sort().map(async file =>
      [file, createHash('sha256').update(await readFile(path.join(dir, file))).digest('hex')])));
  };
  return { root, raws, wiki, drafts, inspections, snapshots, health, scheduler, hashWiki,
    advance: () => { now += 1000; }, provider: (complete?: LlmProvider['complete']) => {
      provider = complete ? meterAutomationProvider({ name: 'fake', model: 'fixture', complete }) : undefined;
    } };
}

test('KBM-01 validates weekly plans and Shanghai boundaries, including strictly future due times', () => {
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) assert(isAutomationPlan({ ...weekly, weekday }));
  for (const weekday of [undefined, -1, 0, 8, 1.1, '1']) assert(!isAutomationPlan({ ...weekly, weekday }));
  for (const time of ['8:30', '24:00', '08:60', '08:30\n']) assert(!isAutomationPlan({ ...weekly, time }));
  assert(!isAutomationPlan({ ...weekly, timezone: 'UTC' }));
  assert(!isAutomationPlan({ ...weekly, minutes: 2 }));
  const sunday = { ...weekly, weekday: 7, time: '00:00' } as const;
  const cases: [AutomationPlan, string, string][] = [
    [weekly, '2026-11-29T23:59:59.999Z', '2026-11-30T00:30:00.000Z'],
    [weekly, '2026-11-30T00:29:59.999Z', '2026-11-30T00:30:00.000Z'],
    [weekly, '2026-11-30T00:30:00.000Z', '2026-12-07T00:30:00.000Z'],
    [weekly, '2026-11-30T00:30:00.001Z', '2026-12-07T00:30:00.000Z'],
    [weekly, '2026-12-31T16:00:01.000Z', '2027-01-04T00:30:00.000Z'],
    [sunday, '2026-12-26T15:59:59.999Z', '2026-12-26T16:00:00.000Z'],
    [sunday, '2026-12-26T16:00:00.000Z', '2027-01-02T16:00:00.000Z'],
  ];
  for (const [plan, now, expected] of cases) assert.equal(iso(firstDueAfter(plan, Date.parse(now))), expected);
  const window = planWindow(weekly, Date.parse('2026-12-07T00:30:00.000Z'), Date.parse('2027-01-09T00:30:00.000Z'));
  assert.deepEqual([iso(window.latest), iso(window.next)], ['2027-01-04T00:30:00.000Z', '2027-01-11T00:30:00.000Z']);
  assert(samePlan(weekly, { ...weekly }));
  assert(!samePlan(weekly, { ...weekly, weekday: 2 }));
  assert(!samePlan(weekly, { kind: 'daily', time: weekly.time, timezone: weekly.timezone }));
});

test('KBM-01 upgrades old settings losslessly and applies weekly catch-up, opt-out and pause', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'state', 'automation', 'schedules.json');
  await mkdir(path.dirname(file), { recursive: true });
  let now = Date.parse('2026-12-04T12:00:00.000Z');
  const task = (type: string, defaultPlan: AutomationPlan): TaskDefinition => ({ type, name: type, defaultPlan,
    allowsCatchUp: true, mayCallModel: false, async execute() {},
  });
  const interval = { kind: 'interval', minutes: 17 } as const;
  const daily = { kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' } as const;
  const old = [
    { type: 'old.interval', enabled: false, plan: interval, catchUp: false, revision: 8, budget: null, nextRunAt: null },
    { type: 'old.daily', enabled: true, plan: daily, catchUp: false, revision: 3, budget: null, nextRunAt: '2026-12-05T00:00:00.000Z' },
  ];
  await writeFile(file, JSON.stringify({ paused: false, schedules: old }));
  const tasks = [task('old.interval', interval), task('old.daily', daily), task(wikiLintType, daily), task(wikiInspectType, weekly), task('weekly.opt-out', weekly)];
  const start = () => new AutomationScheduler({ root, instance, tasks, clock: () => now });
  const first = start();
  await first.initialize();
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).schedules.slice(0, 2), old);
  assert.deepEqual(first.schedules().items.find(schedule => schedule.type === wikiInspectType)?.plan, weekly);
  assert.equal(first.schedules().items.find(schedule => schedule.type === wikiLintType)?.enabled, true);
  await first.patchSchedule('weekly.opt-out', { revision: 1, catchUp: false });
  await first.stop();
  now = Date.parse('2027-01-09T03:00:00.000Z');
  const restarted = start();
  await restarted.initialize();
  await restarted.tick();
  const caught = (await restarted.listRuns({ type: wikiInspectType, limit: 10 })).items;
  assert.deepEqual(caught.map(item => [item.trigger, item.scheduledAt]), [['catch-up', '2027-01-04T00:30:00.000Z']]);
  assert.deepEqual((await restarted.listRuns({ type: 'weekly.opt-out', limit: 10 })).items, []);
  await restarted.setPaused(true);
  now = Date.parse('2027-01-11T00:30:00.000Z');
  await restarted.tick();
  assert.equal((await restarted.listRuns({ type: wikiInspectType, status: 'skipped', limit: 10 })).items[0]?.error, 'paused');
  await restarted.stop();
});

test('KBM-02/04 real Lint diff has stable fingerprints, unchanged Wiki files, backup and corruption fallback', async t => {
  const f = await fixture(t);
  const raw = await f.raws.create({ title: '结构巡检来源', sourceType: 'note', sourceName: 'Fixture', body: 'Synthetic source', tags: [] });
  const pageA = pageInput('星桥渠道甲', '[[星桥渠道乙]]\n[[旧链接]]\n[[仍缺失链接]]', [raw.id]);
  await f.wiki.create(pageInput('星桥渠道乙', '[[星桥渠道甲]]', [raw.id]));
  const a = await f.wiki.create(pageA);
  const before = await f.hashWiki();
  const first = await run(f.scheduler, wikiLintType);
  assert.equal(first.status, 'succeeded');
  assert.equal(first.usage.requests, 0);
  const baseline = await f.snapshots.get(first.artifacts.lintSnapshotId!);
  assert.equal(baseline.total, 2);
  assert.equal(baseline.diff.isBaseline, true);
  assert.equal(baseline.diff.addedCount, 0);
  assert.deepEqual(await f.hashWiki(), before);
  const body = '新增普通行\n[[星桥渠道乙]]\n[[仍缺失链接]]\n[[新链接]]';
  await f.wiki.update(a.id, a.revision, { ...pageA, body });
  const edited = await f.hashWiki();
  f.advance();
  const second = await run(f.scheduler, wikiLintType);
  const delta = await f.snapshots.get(second.id);
  assert.equal(delta.diff.previousRunId, first.id);
  assert.deepEqual([delta.diff.addedCount, delta.diff.resolvedCount, delta.diff.unchangedCount], [1, 1, 1]);
  assert.match(delta.diff.added[0]!.message, /新链接/u);
  assert.match(delta.diff.resolved[0]!.message, /旧链接/u);
  assert.equal(second.usage.requests, 0);
  assert.deepEqual(await f.hashWiki(), edited);
  const relative = path.join('state', 'automation', 'wiki-lint', `${second.id}.json`);
  const backup = path.join(path.dirname(f.root), 'backup.json');
  const restored = path.join(path.dirname(f.root), 'restored');
  await exportWorkspace(f.root, backup);
  await restoreWorkspace(backup, restored);
  assert.deepEqual(await readFile(path.join(restored, relative)), await readFile(path.join(f.root, relative)));
  await writeFile(path.join(f.root, relative), '{damaged');
  const fallback = await f.health.read(f.scheduler);
  assert.equal(fallback.lint?.runId, first.id);
  assert(fallback.issues.some(issue => issue.file.endsWith(`${second.id}.json`) && issue.reason === 'parse'));
  f.advance();
  const third = await run(f.scheduler, wikiLintType);
  assert.equal(third.status, 'succeeded');
  assert.equal((await f.snapshots.get(third.id)).diff.previousRunId, first.id);
  assert.equal(await readFile(path.join(f.root, relative), 'utf8'), '{damaged');
  assert.deepEqual(await f.hashWiki(), edited);

  const app = express();
  registerAutomationRoutes(app, f.scheduler, undefined, f.health);
  app.use((error: {status?: number}, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.status ?? 500).json({}); });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/automation`;
  assert.equal((await (await fetch(`${url}/knowledge-health`)).json()).lint.runId, third.id);
  assert.equal((await (await fetch(`${url}/wiki-lint/${third.id}`)).json()).diff.addedCount, 1);
  assert.equal((await fetch(`${url}/wiki-lint/${randomUUID()}`)).status, 404);
  assert.equal((await fetch(`${url}/wiki-lint/not-an-id`)).status, 400);
  assert.equal((await fetch(`${url}/knowledge-health`, { headers: { Origin: 'https://example.invalid' } })).status, 403);
});

test('KBM-02 retention keeps the 90-day and 200-snapshot union and reports corrupt entries', async t => {
  const root = await temporary(t);
  const snapshots = new WikiLintSnapshots(root);
  const now = Date.parse('2026-12-01T08:00:00.000Z');
  const old = Date.parse('2026-07-01T08:00:00.000Z');
  const dir = path.join(root, 'state', 'automation', 'wiki-lint');
  await mkdir(dir, { recursive: true });
  const seed = (checkedAt: number): WikiLintSnapshot => ({ runId: randomUUID(), checkedAt: iso(checkedAt), total: 0,
    byCode: {}, findings: [], diff: { isBaseline: true, previousRunId: null, addedCount: 0, resolvedCount: 0, unchangedCount: 0, added: [], resolved: [] },
  });
  const oldFiles = Array.from({ length: 201 }, (_, idx) => seed(old + idx));
  const recent = Array.from({ length: 202 }, (_, idx) => seed(now - idx));
  const corrupt = path.join(dir, `${randomUUID()}.json`);
  await writeFile(corrupt, '{invalid');
  await Promise.all([...oldFiles, recent[0]!].map(snapshot => writeFile(path.join(dir, `${snapshot.runId}.json`), JSON.stringify(snapshot))));
  await snapshots.prune(now);
  assert.equal((await readdir(dir)).length, 201);
  await assert.rejects(snapshots.get(oldFiles[1]!.runId), { status: 404 });
  await snapshots.get(oldFiles[2]!.runId);
  await Promise.all(recent.slice(1).map(snapshot => writeFile(path.join(dir, `${snapshot.runId}.json`), JSON.stringify(snapshot))));
  await snapshots.prune(now);
  assert.equal((await readdir(dir)).length, 203);
  assert.equal(await readFile(corrupt, 'utf8'), '{invalid');
  assert(snapshots.issues().some(issue => issue.file === corrupt && issue.reason === 'parse'));
});

test('KBM-03 deterministic selection prioritizes derived and changed pages then recency and stable ID; budgets the full JSON array', async t => {
  const f = await fixture(t);
  const base = await f.wiki.create(pageInput('基准', '文字'));
  const make = (id: string, updated: string, revision = 1, body = '文字'): WikiRecord => ({ ...base, id, updated, revision, body });
  const when = '2026-11-12T00:00:00.000Z';
  const recent = '2026-11-19T00:00:00.000Z';
  const smaller = [make('c', recent), make('b', recent), make('a', recent)];
  const fallback = Array.from({ length: 8 }, (_, i) => make(`fallback-${i}`, when));
  const ranked = [make('too-big', recent, 2, '"'.repeat(48_000)), ...smaller, ...fallback, make('derived', when), make('changed', when, 2)];
  const result = selectInspectionPages(ranked, { createdAt: recent, readWiki: [make('changed', when)] }, new Set(['derived']));
  assert.deepEqual(result.wikiIds, ['derived', 'changed', 'a', 'b', 'c', 'fallback-0', 'fallback-1', 'fallback-2']);
  assert.match(result.skipped.find(item => item.id === 'too-big')!.reason, /48,000/u);
  assert.equal(result.skipped.filter(item => item.reason.includes('8 页')).length, 5);
  const edge = make('edge', recent, 1, '');
  edge.body = '界'.repeat(48_000 - JSON.stringify([edge]).length);
  assert.equal(JSON.stringify([edge]).length, 48_000);
  assert.deepEqual(selectInspectionPages([edge, ...smaller], undefined, new Set(['edge'])).wikiIds, ['edge']);
});

test('KBM-03 derives ranking from a saved source snapshot and the previous inspection without losing exact source evidence', async t => {
  const f = await fixture(t);
  const resultText = '{"version":1,"findings":[]}';
  const result = { text: resultText, bytes: Buffer.byteLength(resultText), finishReason: 'stop' };
  f.provider(async () => result);
  const sourceInput = pageInput('渠道口径原页', '适用范围甲。');
  const source = await f.wiki.create(sourceInput);
  const answerId = randomUUID();
  const answerDir = path.join(f.root, 'state', 'knowledge-answers');
  await mkdir(answerDir, { recursive: true });
  await writeFile(path.join(answerDir, `${answerId}.json`), JSON.stringify({ readWiki: [source] }));
  const derived = await f.wiki.create(pageInput('派生渠道口径', '根据当时口径整理。'));
  const oldDate = '2026-01-01T00:00:00.000Z';
  await f.wiki.writePageLocked({ ...derived, created: oldDate, updated: oldDate, answerDerivations: [{
    answerId, answerRevision: 1, wikiIds: [source.id], rawIds: [], manualWikiIds: [source.id], containsInference: false,
  }] });
  for (let idx = 0; idx < 8; idx++) await f.wiki.create(pageInput(`近期主题 ${idx}`, `补充内容 ${idx}`));
  const previous = randomUUID();
  await f.inspections.start({ requestId: previous, wikiIds: [source.id], includeRelated: false });
  assert.equal((await f.inspections.wait(previous))?.status, 'completed');
  const changed = await f.wiki.update(source.id, source.revision, { ...sourceInput, body: '适用范围乙。' });
  f.provider(async request => {
    const { wiki } = JSON.parse(request.user) as { wiki: WikiRecord[] };
    assert.equal(wiki[0]?.id, derived.id);
    assert.equal(wiki.length, 8);
    assert(wiki.some(page => page.id === changed.id && page.revision === changed.revision));
    return result;
  });
  const selected = await run(f.scheduler, wikiInspectType);
  assert.equal(selected.status, 'succeeded', JSON.stringify(selected));
  const record = await f.inspections.read(selected.artifacts.inspectionIds![0]!);
  assert.equal(record?.findings[0]?.type, 'source_impact');
  assert.equal(record?.findings[0]?.evidence[0]?.quote, changed.body);
  assert.equal(record?.findings[0]?.comparison?.beforeRevision, source.revision);
});

test('KBM-03 partial automated checks meter usage and persist only eligible full Wiki evidence and review records', async t => {
  const f = await fixture(t);
  let requests = 0;
  assert.deepEqual(await f.health.read(f.scheduler), { lint: null, inspection: null, issues: [] });
  f.provider(async () => { requests++; throw Error('Unreachable'); });
  const empty = await run(f.scheduler, wikiInspectType);
  assert.equal(empty.status, 'succeeded');
  assert.match(empty.steps[0]!.summary, /知识库为空/u);
  assert.equal(requests, 0);
  const left = await f.wiki.create(pageInput('星桥门店方案甲', '星桥门店年度目标为 30 家。'));
  const right = await f.wiki.create(pageInput('星桥门店方案乙', '星桥门店年度目标为 45 家。'));
  const source = await f.raws.create({ title: 'Source fixture', sourceName: 'Fixture', sourceType: 'note', tags: [], body: 'Source fixture' });
  await f.wiki.create({ ...pageInput('Source fixture', 'Source-only sentinel', [source.id]), type: 'source' });
  const meeting = await f.raws.createMeetingRegistration({ id: randomUUID(), title: '受限会议', sourceName: 'Fixture', tags: [], body: 'Meeting Raw sentinel', importedAt: iso(Date.now()),
    origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: '1'.repeat(64), registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' },
  });
  const restricted = await f.wiki.create(pageInput('星桥门店受限页', 'Confidential Wiki sentinel'));
  await f.wiki.writePageLocked({ ...restricted, sources: [meeting.record.id] });
  const missing = await f.wiki.create(pageInput('星桥门店缺底源', 'Missing source Wiki sentinel'));
  await f.wiki.writePageLocked({ ...missing, sources: [randomUUID()] });
  const oversized = await f.wiki.create(pageInput('星桥门店过长内容', '长'.repeat(48_001)));
  const before = await f.hashWiki();
  const drafts = await draftNames(f.root);
  f.provider(async request => {
    requests++;
    assert.match(request.user, /knowledge_inspection/u);
    for (const excluded of [restricted.id, missing.id, oversized.id, 'Confidential Wiki sentinel', 'Missing source Wiki sentinel', 'Source-only sentinel']) {
      assert(!request.user.includes(excluded));
    }
    const input = JSON.parse(request.user) as { wiki: WikiRecord[] };
    assert.equal(input.wiki.length, 2);
    assert(JSON.stringify(input.wiki).length <= 48_000);
    for (const page of [left, right]) assert(input.wiki.some(item => item.id === page.id && item.body === page.body));
    const finding = { type: 'conflict', wikiIds: [left.id, right.id], summary: '目标家数有冲突', reason: '两页采用同一目标口径',
      differences: '30 家对 45 家', nextStep: 'preserve_differences', evidence: [left, right].map(page => ({ wikiId: page.id, quote: page.body, start: 0, end: page.body.length })),
    };
    const text = JSON.stringify({ version: 1, findings: [finding] });
    return { text, bytes: Buffer.byteLength(text), finishReason: 'stop', usage: { promptTokens: 59, completionTokens: 22 } };
  });
  f.advance();
  const done = await run(f.scheduler, wikiInspectType);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.deepEqual(done.usage, { requests: 1, inputTokens: 59, outputTokens: 22, unknownUsageCount: 0 });
  const [id] = done.artifacts.inspectionIds!;
  const inspection = await f.inspections.read(id!);
  assert.equal(inspection?.status, 'partial');
  assert.deepEqual(new Set(inspection?.scope.skipped.map(item => item.id)), new Set([restricted.id, missing.id, oversized.id]));
  assert.equal(inspection!.scope.gaps.filter(gap => /会议来源受限|缺失|48,000/u.test(gap)).length, 3);
  assert.equal((await f.health.read(f.scheduler)).inspection?.pendingCount, 1);
  const finding = inspection!.findings[0]!;
  assert.equal((await f.inspections.evidence(id!, finding.id, finding.evidence[0]!.id)).quote, left.body);
  await f.inspections.decision(id!, finding.id, { baseRevision: inspection!.revision, reason: '已核对', status: 'viewed' });
  assert.equal((await f.health.read(f.scheduler)).inspection?.pendingCount, 0);
  f.advance();
  const repeated = await run(f.scheduler, wikiInspectType);
  assert.equal(requests, 2);
  assert.match(repeated.steps[1]!.summary, /待核 0 项，复用已处理 1 项/u);
  f.provider(async () => { throw new Error('fake rejected the request'); });
  f.advance();
  const failed = await run(f.scheduler, wikiInspectType);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.usage.requests, 1);
  assert.equal((await f.inspections.get(failed.artifacts.inspectionIds![0]!))?.status, 'failed');
  assert.equal((await f.health.read(f.scheduler)).inspection?.inspectionId, repeated.artifacts.inspectionIds![0]);
  f.provider();
  f.advance();
  const unconfigured = await run(f.scheduler, wikiInspectType);
  assert.equal(unconfigured.status, 'failed');
  assert.match(unconfigured.error!, /未配置.*Provider/u);
  assert.equal(unconfigured.usage.requests, 0);
  assert.deepEqual(await f.hashWiki(), before);
  assert.deepEqual(await draftNames(f.root), drafts);
  await runInAutomationContext({ runId: randomUUID(), usage: done.usage }, async () => {
    await assert.rejects(f.wiki.create(pageInput('禁止写入', '自动化禁止')), { status: 403, code: 'AUTOMATION_FORMAL_WRITE_FORBIDDEN' });
  });
  const damagedId = repeated.artifacts.inspectionIds![0]!;
  await writeFile(path.join(f.root, 'state', 'knowledge-inspections', `${damagedId}.json`), '{damaged');
  const fallback = await f.health.read(f.scheduler);
  assert.equal(fallback.inspection?.inspectionId, id);
  assert(fallback.issues.some(issue => issue.file.endsWith(`${damagedId}.json`) && issue.reason === 'parse'));
});

test('KBM-03 cancellation propagates to the provider and preserves the atomic inspection record even with a slow provider', async t => {
  const f = await fixture(t);
  await f.wiki.create(pageInput('星桥门店', '星桥门店年度目标为 30 家。'));
  let entered!: (signal: AbortSignal) => void;
  let release!: () => void;
  const providerEntered = new Promise<AbortSignal>(resolve => { entered = resolve; });
  const providerRelease = new Promise<void>(resolve => { release = resolve; });
  f.provider(async request => {
    entered(request.signal!);
    await providerRelease;
    return { text: '{"version":1,"findings":[]}', finishReason: 'stop', bytes: 27 };
  });
  const queued = await f.scheduler.runNow(wikiInspectType);
  const signal = await providerEntered;
  try {
    const cancelled = await f.scheduler.cancel(queued.id);
    assert(signal.aborted);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.usage.requests, 1);
    assert.equal(cancelled.artifacts.inspectionIds, undefined);
    const [record] = await f.inspections.list();
    assert.equal(record?.status, 'failed');
    assert.equal(record?.error?.code, 'INSPECTION_CANCELLED');
  } finally { release(); await sleep(50); }
});

test('KBM-03 an abort during the metering write prevents the provider from calling fetch', async t => {
  const controller = new AbortController();
  const fetchSpy = t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected network request'); });
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 };
  const provider = meterAutomationProvider(new OpenAiCompatibleProvider({ source: 'env', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture', apiKey: 'synthetic-only' }));
  await runInAutomationContext({ runId: randomUUID(), usage, save: async () => controller.abort() }, async () => {
    await assert.rejects(provider.complete({ system: 'synthetic', user: 'synthetic', timeoutMs: 1000, maxOutputBytes: 1000, signal: controller.signal }), { code: 'LLM_CANCELLED' });
  });
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.deepEqual(usage, { requests: 1, inputTokens: 0, outputTokens: 0, unknownUsageCount: 1 });
});
