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
import { meterAutomationProvider, runInAutomationContext } from '../services/automation/context.ts';
import { AutomationLedger } from '../services/automation/ledger.ts';
import { AutomationScheduler } from '../services/automation/scheduler.ts';
import {
  emptyWeeklyReviewUsage,
  WeeklyReviewStore,
  type WeeklyReviewDraft,
} from '../services/automation/weekly-review-store.ts';
import {
  buildWeeklyReviewSnapshot,
  validWeekKey,
  weeklyReviewPeriod,
  type WeeklyReviewSources,
} from '../services/automation/weekly-review-snapshot.ts';
import { createWeeklyReview, weeklyReviewType } from '../services/automation/tasks/weekly-review.ts';
import { WikiLintSnapshots } from '../services/automation/tasks/wiki-lint.ts';
import type { AutomationRun } from '../services/automation/types.ts';
import type { ExtractionRunner } from '../services/llm/jobs.ts';
import { KnowledgeInspectionService } from '../services/llm/knowledge-inspections.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { NewsService } from '../services/news/service.ts';
import type { NewsItem } from '../services/news/types.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { RawStore } from '../services/raw/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiStore, type WikiInput } from '../services/wiki/store.ts';
import { WorkItemStore } from '../services/work-items/store.ts';

const startClock = Date.parse('2026-11-23T01:00:00.000Z');
const inside = '2026-11-18T01:00:00.000Z';
const weekKey = '2026-W47';
const sensitive = [
  'RAW_BODY_SENTINEL',
  'RESTRICTED_MEETING_TITLE',
  'RESTRICTED_WIKI_TITLE',
  'WORK_FEEDBACK_SENTINEL',
  'WORK_HISTORY_SENTINEL',
  'PROMPT_SCENARIO_SENTINEL',
  'PROMPT_FEEDBACK_SENTINEL',
  'NEWS_EXCERPT_SENTINEL',
  'RUN_ERROR_SENTINEL',
];
const wikiInput = (title: string): WikiInput => ({
  title,
  type: 'concept',
  category: 'industry_basics',
  sources: [],
  tags: [],
  aliases: [],
  knowledge_status: 'needs_verification',
  confidence: 'low',
  source_level: 'D',
  review_status: 'unreviewed',
  body: '仅测试的 Wiki 原文',
});
const response = (text: string) => ({
  text,
  bytes: Buffer.byteLength(text),
  finishReason: 'stop',
  usage: { promptTokens: 80, completionTokens: 24 },
});
const structured = (ref: string): WeeklyReviewDraft => ({
  executiveSummary: 'AI 整理：已记录本周合成事项。',
  highlights: [{ text: '合成工作事项可核对。', refs: [ref] }],
  risksAndBlockers: [],
  nextWeekFocus: [{ text: '建议核对合成事项的后续安排', reason: '等待确认' }],
  openQuestions: [],
});

async function fixture(t: TestContext, seedRuns = false) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'review01-'));
  const root = path.join(temp, 'data');
  let now = startClock;
  let provider: LlmProvider | undefined;
  const raws = new RawStore(root);
  const rawState = new RawStateStore(root);
  const wiki = new WikiStore(root, raws);
  const prompts = new PromptStore(root, wiki);
  const drafts = new DraftStore(root);
  const workItems = new WorkItemStore(root, raws);
  const runner = { recoveryJobs: () => [] } as unknown as ExtractionRunner;
  const inspections = new KnowledgeInspectionService({ root, wiki, raws, drafts, provider: () => undefined });
  const lint = new WikiLintSnapshots(root);
  const news = new NewsService({
    root,
    clock: () => new Date(now),
    readSources: async () => assert.fail('Review must not fetch live news'),
    aiEnabled: false,
    providerFactory: async () => undefined,
    rawStore: raws,
  });
  const store = new WeeklyReviewStore(root, () => now);
  await raws.initialize();
  await wiki.initialize();
  await prompts.initialize();
  await drafts.initialize();
  await rawState.initialize();
  if (seedRuns) {
    const ledger = new AutomationLedger(root);
    const add = async (
      type: string,
      status: AutomationRun['status'],
      artifacts: Partial<AutomationRun['artifacts']> = {},
      id = randomUUID(),
      at = inside,
    ) => {
      await ledger.save({
        id,
        type,
        status,
        trigger: 'manual',
        scheduledAt: at,
        startedAt: at,
        endedAt: at,
        steps: [],
        error: status === 'failed' ? 'RUN_ERROR_SENTINEL' : undefined,
        usage:
          status === 'failed'
            ? { requests: 1, inputTokens: 0, outputTokens: 0, unknownUsageCount: 1 }
            : emptyWeeklyReviewUsage(),
        artifacts: { rawIds: [], jobIds: [], draftIds: [], ...artifacts },
        budget: null,
      });
    };
    await add('news.daily', 'failed');
    const lintId = randomUUID();
    await lint.save({
      runId: lintId,
      checkedAt: inside,
      total: 0,
      findings: [],
      byCode: {},
      diff: {
        isBaseline: true,
        previousRunId: null,
        addedCount: 0,
        resolvedCount: 0,
        unchangedCount: 0,
        added: [],
        resolved: [],
      },
    });
    await add('wiki.lint', 'succeeded', { lintSnapshotId: lintId }, lintId);
    const currentLint = randomUUID(),
      currentTime = '2026-11-23T00:00:00.000Z';
    const added = [
      {
        code: 'BROKEN_WIKI_LINK' as const,
        objectId: null,
        pageTitle: null,
        file: 'index.md',
        message: 'RESTRICTED_WIKI_TITLE',
        location: { scope: 'page' as const, line: 1 },
        fingerprint: 'f'.repeat(64),
      },
    ];
    await lint.save({
      runId: currentLint,
      checkedAt: currentTime,
      total: 1,
      findings: added,
      byCode: { BROKEN_WIKI_LINK: 1 },
      diff: {
        isBaseline: false,
        previousRunId: lintId,
        addedCount: 1,
        resolvedCount: 0,
        unchangedCount: 0,
        added,
        resolved: [],
      },
    });
    await add('wiki.lint', 'succeeded', { lintSnapshotId: currentLint }, currentLint, currentTime);
    const inspectionId = randomUUID();
    const directory = path.join(root, 'state', 'knowledge-inspections');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, inspectionId + '.json'),
      JSON.stringify({
        id: inspectionId,
        revision: 1,
        status: 'completed',
        createdAt: inside,
        updatedAt: inside,
        readWiki: [],
        drafts: [],
        scope: {},
        findings: [{ status: 'pending' }, { status: 'viewed' }],
      }),
    );
    await add('wiki.inspect', 'succeeded', { inspectionIds: [inspectionId] });
  }
  const sources: WeeklyReviewSources = {
    root,
    raws,
    wiki,
    prompts,
    runner,
    workItems,
    news,
    lint,
    inspections,
    get automation() {
      return scheduler;
    },
  };
  const task = createWeeklyReview(store, sources, () => now);
  const scheduler: AutomationScheduler = new AutomationScheduler({
    root,
    instance: {
      pid: process.pid,
      port: 0,
      mode: 'development',
      hostname: os.hostname(),
      startedAt: new Date(now).toISOString(),
    },
    tasks: [task.task],
    clock: () => now,
    withProvider: (execute) => execute(() => provider),
  });
  await scheduler.initialize();
  t.after(async () => {
    await scheduler.stop();
    await rm(temp, { recursive: true, force: true });
  });
  const wait = async (id: string) => {
    for (let i = 0; i < 300; i++) {
      const run = await scheduler.getRun(id);
      if (run.endedAt) return run;
      await sleep(10);
    }
    assert.fail('weekly review did not settle');
  };
  const run = async () => wait((await scheduler.runNow(weeklyReviewType)).id);
  const addWiki = async (title: string, at = inside) => {
    const page = await wiki.create(wikiInput(title));
    await wiki.writePageLocked({ ...page, created: at });
    return page;
  };
  return {
    root,
    temp,
    raws,
    rawState,
    wiki,
    prompts,
    workItems,
    news,
    sources,
    task,
    scheduler,
    store,
    run,
    wait,
    addWiki,
    time(value: number) {
      now = value;
    },
    provider(complete?: LlmProvider['complete'], secrets?: string[]) {
      provider = complete ? meterAutomationProvider({ name: 'fake', model: 'replay', complete, secrets }) : undefined;
    },
  };
}

const section = (review: { snapshot: Awaited<ReturnType<typeof buildWeeklyReviewSnapshot>> }, key: string) =>
  review.snapshot.sections.find((section) => section.key === key)!;
const metric = (review: Parameters<typeof section>[0], key: string, name: string) =>
  section(review, key).metrics.find((metric) => metric.ref === 'metric:' + key + ':' + name)?.count;

async function formalHashes(root: string) {
  const output = [];
  for (const directory of ['knowledge/wiki', 'knowledge/raw', 'prompts', 'work-items']) {
    for (const entry of await readdir(path.join(root, directory), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      output.push([
        path.relative(root, file),
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]);
    }
  }
  return output.sort();
}

test('RV-01 ISO Shanghai weeks have inclusive local Monday, exclusive next Monday, and stable catch-up targets', () => {
  const monday = Date.parse('2026-01-04T16:00:00.000Z');
  assert.deepEqual(weeklyReviewPeriod(monday), {
    weekKey: '2026-W01',
    start: '2025-12-29',
    end: '2026-01-05',
    from: '2025-12-28T16:00:00.000Z',
    until: '2026-01-04T16:00:00.000Z',
    partialWeek: false,
  });
  assert.equal(weeklyReviewPeriod(monday - 1).weekKey, '2025-W52');
  const partial = weeklyReviewPeriod(monday + 12345, '2026-W02');
  assert.equal(partial.partialWeek, true);
  assert.equal(partial.until, new Date(monday + 12345).toISOString());
  assert.throws(() => weeklyReviewPeriod(monday, '2026-W03'), { code: 'WEEKLY_REVIEW_FUTURE_WEEK' });
  assert(validWeekKey('2020-W53'));
  assert(!validWeekKey('2021-W53'));
  assert(!validWeekKey('../2026-W02'));
  assert.equal(weeklyReviewPeriod(monday, undefined, monday - 1).weekKey, '2025-W52');
});

test('RV-01/03 snapshot aggregation validates real sources and sends no private content or writes formal assets', async (t) => {
  const f = await fixture(t, true);
  const openWiki = await f.addWiki('合成知识指南', '2026-11-15T16:00:00.000Z');
  await f.addWiki('周末结束后的记录', '2026-11-22T16:00:00.000Z');
  const { record: restricted } = await f.raws.createMeetingRegistration({
    id: randomUUID(),
    title: 'RESTRICTED_MEETING_TITLE',
    sourceName: 'Fixture',
    body: 'RAW_BODY_SENTINEL',
    tags: [],
    importedAt: inside,
    origin: {
      kind: 'meeting',
      meeting_id: randomUUID(),
      import_id: randomUUID(),
      original_sha256: '1'.repeat(64),
      registered_confidentiality: 'Restricted',
      processing_policy: 'meeting_local_only',
    },
  });
  const privateWiki = await f.addWiki('RESTRICTED_WIKI_TITLE');
  await f.wiki.writePageLocked({ ...privateWiki, created: inside, sources: [restricted.id] });
  await f.rawState.set(restricted.id, { status: 'failed', reason: 'test' });
  const prompt = (
    await f.prompts.create(randomUUID(), {
      name: '合成 Prompt',
      category: 'customer',
      scenario: 'PROMPT_SCENARIO_SENTINEL',
      body: '不外发的 Prompt 指令',
      inputRequirements: '',
      outputRequirements: '',
      relatedWikiIds: [],
      examples: '',
      tags: [],
      favorite: false,
    })
  ).prompt;
  await f.prompts.createFeedback(prompt.id, {
    id: randomUUID(),
    promptVersion: 1,
    usedOn: '2026-11-20',
    outcome: 'helpful',
    scenario: 'PROMPT_SCENARIO_SENTINEL',
    observation: 'PROMPT_FEEDBACK_SENTINEL',
    nextImprovement: '',
  });
  const work = await f.workItems.create({ title: '合成跟进事项', feedback: 'WORK_FEEDBACK_SENTINEL' });
  const edited = await f.workItems.update(work.id, {
    baseRevision: work.revision,
    followUpOn: '2026-11-19',
    history: { kind: 'customer_reply', body: 'WORK_HISTORY_SENTINEL' },
  });
  await writeFile(path.join(f.root, 'work-items', work.id + '.json'), JSON.stringify({ ...edited, createdAt: inside }));
  const product = await f.workItems.create({ kind: 'product_analysis', title: '合成产品事项', goal: '内部目标' });
  const closed = await f.workItems.update(product.id, {
    baseRevision: 1,
    status: 'closed',
    closureReason: 'WORK_HISTORY_SENTINEL',
  });
  await writeFile(
    path.join(f.root, 'work-items', product.id + '.json'),
    JSON.stringify({
      ...closed,
      createdAt: inside,
      history: closed.history.map((event) => ({ ...event, at: inside })),
    }),
  );
  const item: NewsItem = {
    id: 'weekly-entry',
    title: '合成资讯',
    sourceId: 'fixture',
    sourceName: 'Fixture',
    url: 'https://example.com/weekly-test',
    fetchedAt: inside,
    publishedAt: null,
    excerpt: 'NEWS_EXCERPT_SENTINEL',
    evidenceKind: 'article_excerpt',
  };
  const newsDir = path.join(f.root, 'state', 'news');
  await mkdir(newsDir, { recursive: true });
  await writeFile(
    path.join(newsDir, '2026-11-18.json'),
    JSON.stringify({
      schemaVersion: 1,
      date: '2026-11-18',
      updatedAt: inside,
      sections: { ai: { status: 'source_only', attempt: 1, startedAt: inside, items: [item], sources: [] } },
    }),
  );
  f.time(Date.parse(inside));
  await f.news.rawSaves().save('2026-11-10', 'ai', item);
  f.time(startClock);
  const before = await formalHashes(f.root);
  f.provider(async (request) => {
    for (const needle of sensitive) assert(!request.user.includes(needle), needle);
    assert(!request.user.includes('"target"'));
    assert(request.user.includes(openWiki.id));
    assert(request.user.includes('metric:news-saves:confirmed'));
    await assert.rejects(f.wiki.create(wikiInput('禁止的自动写入')), {
      status: 403,
      code: 'AUTOMATION_FORMAL_WRITE_FORBIDDEN',
    });
    return response(JSON.stringify(structured('wiki:' + openWiki.id)));
  });
  const run = await f.run();
  assert.equal(run.status, 'succeeded', JSON.stringify(run));
  assert.equal(run.artifacts.weeklyReviewWeekKey, weekKey);
  assert.deepEqual(run.usage, { requests: 1, inputTokens: 80, outputTokens: 24, unknownUsageCount: 0 });
  const review = await f.store.get(weekKey);
  assert.equal(review.aiStatus, 'ready');
  assert.deepEqual(review.usage, run.usage);
  for (const needle of sensitive) assert(!JSON.stringify(review.snapshot).includes(needle), needle);
  assert.equal(metric(review, 'knowledge', 'created'), 2);
  assert.deepEqual(
    section(review, 'knowledge').entries.map((row) => row.ref),
    ['wiki:' + openWiki.id],
  );
  assert.equal(metric(review, 'feedback', 'feedback'), 1);
  assert.equal(metric(review, 'work', 'created'), 2);
  assert.equal(metric(review, 'work', 'closed'), 1);
  assert.equal(metric(review, 'work-active', 'due'), 1);
  assert.equal(metric(review, 'news', 'fetched'), 1);
  assert.equal(metric(review, 'news-saves', 'confirmed'), 1);
  assert.equal(metric(review, 'lint-current', 'total'), 1);
  assert.equal(metric(review, 'lint', 'net'), 0);
  assert.equal(metric(review, 'inspection', 'pending'), 1);
  assert.equal(metric(review, 'automation', 'failed'), 1);
  assert.equal(metric(review, 'automation', 'unknownUsageCount'), 1);
  const regenerate = await f.scheduler.runNow(weeklyReviewType, (context) =>
    f.task.execute(context, {
      weekKey,
      baseRevision: review.revision,
      overwriteEdited: false,
    }),
  );
  assert.equal((await f.wait(regenerate.id)).status, 'succeeded');
  assert.deepEqual(await formalHashes(f.root), before);
  await runInAutomationContext({ runId: run.id, usage: run.usage }, async () => {
    await assert.rejects(f.wiki.create(wikiInput('仍受保护')), { status: 403 });
  });
});

test('RV-01 reads broken sources independently and retains facts for the rest', async (t) => {
  const f = await fixture(t);
  const page = await f.addWiki('损坏来源');
  await writeFile(path.join(f.root, 'knowledge', 'wiki', page.id + '.md'), '{broken');
  assert.equal((await f.run()).status, 'succeeded');
  const record = await f.store.get(weekKey);
  assert.equal(record.aiStatus, 'facts_only');
  assert.equal(section(record, 'knowledge').status, 'error');
  assert.deepEqual(section(record, 'knowledge').metrics, []);
  assert.equal(section(record, 'feedback').status, 'ok');
});

test('RV-02 rejects forged refs, invalid JSON, missing fields, and secrets with facts intact', async (t) => {
  const f = await fixture(t);
  const page = await f.addWiki('合成知识');
  const cases = [
    JSON.stringify(structured('wiki:' + randomUUID())),
    'no JSON',
    JSON.stringify({ highlights: [] }),
    JSON.stringify({ ...structured('wiki:' + page.id), executiveSummary: 'SYNTHETIC_PRIVATE_KEY_SENTINEL' }),
  ];
  for (const output of cases) {
    f.provider(async () => response(output), ['SYNTHETIC_PRIVATE_KEY_SENTINEL']);
    const run = await f.run();
    assert.equal(run.status, 'failed');
    assert.equal(run.usage.requests, 1);
    const record = await f.store.get(weekKey);
    assert.equal(record.aiStatus, 'ai_failed');
    assert.equal(record.draft, null);
    assert.equal(metric(record, 'knowledge', 'created'), 1);
    assert(!JSON.stringify(record).includes('SYNTHETIC_PRIVATE_KEY_SENTINEL'));
  }
  await f.store.updateSettings(1, false);
  f.provider(async () => assert.fail('AI off must not invoke model'));
  const off = await f.run();
  assert.equal(off.usage.requests, 0);
  assert.equal((await f.store.get(weekKey)).aiStatus, 'facts_only');
  await f.store.updateSettings(2, true);
  f.provider();
  assert.equal((await f.run()).usage.requests, 0);
  assert.equal((await f.store.get(weekKey)).aiStatus, 'facts_only');
});

test('RV-02 persists facts before model, protects edits during generation and protects archived reports on recurring runs', async (t) => {
  const f = await fixture(t);
  const page = await f.addWiki('合成知识');
  let entered!: () => void, release!: () => void;
  const atProvider = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const providerRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.provider(async () => {
    entered();
    await providerRelease;
    return response(JSON.stringify(structured('wiki:' + page.id)));
  });
  const started = await f.scheduler.runNow(weeklyReviewType);
  await atProvider;
  try {
    const facts = await f.store.get(weekKey);
    assert.equal(facts.aiStatus, 'facts_only');
    const edited = await f.store.patch(weekKey, facts.revision, { userMarkdown: '人工编辑保留', status: 'reviewed' });
    await assert.rejects(f.store.patch(weekKey, facts.revision, { userMarkdown: '陈旧写入' }), { status: 409 });
    await assert.rejects(f.store.prepare(weekKey, { weekKey, baseRevision: edited.revision, overwriteEdited: false }), {
      status: 409,
    });
  } finally {
    release();
  }
  const finished = await f.wait(started.id);
  assert.equal(finished.status, 'succeeded');
  const record = await f.store.get(weekKey);
  assert.equal(record.userMarkdown, '人工编辑保留');
  assert.equal(record.draft, null);
  assert.equal(record.status, 'reviewed');
  const recurring = await f.run();
  assert.equal(recurring.usage.requests, 0);
  assert.deepEqual(await f.store.get(weekKey), record);
  const backup = path.join(f.temp, 'backup.json'),
    restore = path.join(f.temp, 'restored');
  await exportWorkspace(f.root, backup);
  await restoreWorkspace(backup, restore);
  assert.deepEqual(await new WeeklyReviewStore(restore).get(weekKey), record);
});

test('RV-02/05 HTTP API uses a versioned explicit regeneration and Markdown export', async (t) => {
  const f = await fixture(t);
  f.provider(async () => assert.fail('Empty current week must not request AI'));
  const app = express();
  registerAutomationRoutes(app, f.scheduler, undefined, undefined, undefined, { store: f.store, task: f.task });
  app.use(
    (
      error: { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ error: { code: error.code } });
    },
  );
  const appServer = app.listen(0, '127.0.0.1');
  t.after(() => appServer.close());
  await new Promise<void>((resolve) => appServer.once('listening', resolve));
  const address = appServer.address();
  assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api/automation/weekly-reviews';
  const headers = { 'Content-Type': 'application/json', 'x-fmcg-automation-token': f.scheduler.status().writeToken };
  const change = (route: string, method: string, body: unknown) =>
    fetch(base + route, { headers, method, body: JSON.stringify(body) });
  const current = '/2026-W48';
  assert.equal((await fetch(base + current)).status, 404);
  assert.equal((await change('/2026-W49/regenerate', 'POST', { baseRevision: 0, overwriteEdited: false })).status, 400);
  const start = await change(current + '/regenerate', 'POST', { baseRevision: 0, overwriteEdited: false });
  assert.equal(start.status, 202);
  const run = await f.wait((await start.json()).id);
  assert.equal(run.usage.requests, 0);
  assert.equal(run.artifacts.weeklyReviewWeekKey, '2026-W48');
  const record = await (await fetch(base + current)).json();
  assert.equal(record.period.partialWeek, true);
  assert.equal((await change(current, 'PATCH', { baseRevision: 13, userMarkdown: 'stale' })).status, 409);
  const amended = await change(current, 'PATCH', {
    baseRevision: record.revision,
    userMarkdown: '人工 Markdown',
    status: 'reviewed',
  });
  assert.equal(amended.status, 200);
  const exportFile = await fetch(base + current + '/export');
  assert.match(exportFile.headers.get('content-disposition')!, /weekly-review-2026-W48.md/u);
  const markdown = await exportFile.text();
  assert.match(markdown, /本周事实快照.*AI 整理与建议.*人工审阅备注.*人工 Markdown/su);
  const revision = (await amended.json()).revision;
  assert.equal(
    (await change(current + '/regenerate', 'POST', { baseRevision: revision, overwriteEdited: false })).status,
    409,
  );
  const overwrite = await change(current + '/regenerate', 'POST', { baseRevision: revision, overwriteEdited: true });
  assert.equal(overwrite.status, 202);
  assert.equal((await f.wait((await overwrite.json()).id)).status, 'succeeded');
  assert.equal((await f.store.get('2026-W48')).userMarkdown, '');
  assert.equal((await change('/settings', 'PATCH', { revision: 1, aiSummaryEnabled: false })).status, 200);
  assert.equal((await change('/settings', 'PATCH', { revision: 1, aiSummaryEnabled: true })).status, 409);
});
