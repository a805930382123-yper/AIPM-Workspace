import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { fetchNewsSource, meterAutomationProvider } from '../services/automation/context.ts';
import { NewsPipeline, organizeType } from '../services/automation/pipeline/service.ts';
import { screenNews, type ScreenInput } from '../services/automation/pipeline/screen.ts';
import { AutomationScheduler } from '../services/automation/scheduler.ts';
import { createDailyNews, dailyNewsType } from '../services/automation/tasks/news-daily.ts';
import type { AutomationRun } from '../services/automation/types.ts';
import { ExtractionJobStore, ExtractionRunner, type ExtractionJob } from '../services/llm/jobs.ts';
import { LLMService } from '../services/llm/service.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { OpenAiCompatibleProvider, type LlmProvider } from '../services/llm/provider.ts';
import { NewsService } from '../services/news/service.ts';
import type { NewsItem, NewsSectionName } from '../services/news/types.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { RawStore } from '../services/raw/store.ts';
import { SerialQueue, StorageError } from '../services/storage/files.ts';
import { DraftStore, type DraftRecord } from '../services/wiki/drafts.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { registerAutomationRoutes } from '../server/automation-api.ts';
import { answerExtraction, startFakeProvider } from './support/fake-llm.ts';
import { homeActions } from '../services/home/actions.ts';

const start = '2026-11-16T07:29:00+08:00';
const day = '2026-11-16';
const duration = 20;
const fixtureNews = (section: NewsSectionName, n: number, overrides?: Partial<NewsItem>): NewsItem => ({
  id: section + '-' + n,
  title: section + ' 测试资讯 ' + n,
  sourceId: section + n,
  sourceName: '夹具来源 ' + n,
  url: `https://news.example.test/${section}/${n}?utm_medium=pipe-fixture`,
  publishedAt: '2026-11-14',
  fetchedAt: new Date(start).toISOString(),
  excerpt: `【合成资讯 ${n}】\n${section === 'fmcg' ? '快消零售门店调研显示，新增常温饮料陈列位后，该品类销量增长 12%。' : '零售门店新增常温饮料陈列位。'}\n来源第二行保持原样。`,
  evidenceKind: section === 'ai' ? 'source_summary' : 'article_excerpt',
  ...overrides,
});
const reply = (payload: unknown) => {
  const text = JSON.stringify(payload);
  return {
    text,
    bytes: Buffer.byteLength(text),
    finishReason: 'stop',
    usage: { promptTokens: 7, completionTokens: 11 },
  };
};
const score = (candidateId: string) => ({
  candidateId,
  relevance: 2,
  reason: '陈列方式与渠道直接相关。',
  categories: ['渠道'],
  suggestedMode: 'standard',
});

async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(15);
  }
  return assert.fail('状态未在时限内更新');
}

async function harness(t: TestContext, { providerEnabled = true, itemCount = 2 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pipe01-test-'));
  const raws = new RawStore(root);
  const wiki = new WikiStore(root, raws);
  const states = new RawStateStore(root);
  const prompts = new PromptStore(root, wiki, path.resolve('rules'));
  await raws.initialize();
  await wiki.initialize();
  await states.initialize();
  await prompts.initialize();
  const indexFile = path.join(root, 'knowledge/wiki/index.md');
  const indexBefore = await readFile(indexFile);
  const sourceCalls: NewsSectionName[] = [];
  const requests: string[] = [];
  const jobs = new Map<string, ExtractionJob>();
  const drafts = new Map<string, DraftRecord>();
  const runners = new Map<string, Promise<void>>();
  const slotControl = new SerialQueue();
  const started: string[] = [];
  const knobs = {
    sourceCount: itemCount,
    invalidScreen: false,
    invalidFirstBatch: false,
    block: false,
    failRaw: '',
    failOrganize: '',
    maxActive: 0,
  };
  let now = Date.parse(start);
  let origin: string;
  const provider = providerEnabled
    ? meterAutomationProvider({
        name: 'fake',
        model: 'fake',
        secrets: ['this-is-a-test-credential'],
        async complete({ system, user }) {
          requests.push(system === 'pipeline fixture organizer' ? 'organize' : 'screen');
          if (system === 'pipeline fixture organizer') return reply({});
          const { items } = JSON.parse(user) as { items: ScreenInput[] };
          assert.ok(items.length <= 10);
          const invalid = knobs.invalidScreen || (knobs.invalidFirstBatch && requests.length === 1);
          return reply({
            items: items.map((item) =>
              invalid ? { ...score(item.candidateId), leaked: true } : score(item.candidateId),
            ),
          });
        },
      })
    : undefined;
  const news = new NewsService({
    root,
    clock: () => new Date(now),
    rawStore: raws,
    aiEnabled: true,
    providerFactory: async () => provider,
    async readSources(section) {
      sourceCalls.push(section);
      const sourceResponse = await fetchNewsSource(origin + '/fixture-source');
      await sourceResponse.text();
      return {
        items: Array.from({ length: knobs.sourceCount }, (_, n) => fixtureNews(section, n + 1)),
        sources: [{ name: '本地夹具', status: 'ok', checkedAt: new Date(now).toISOString() }],
        shortageReasons: ['夹具仅提供有限条目。'],
      };
    },
  });
  const createRaw = raws.createNewsRegistration.bind(raws);
  raws.createNewsRegistration = async (id, input) => {
    if (knobs.failRaw === input.title) {
      knobs.failRaw = '';
      throw Error('injected create failure');
    }
    return createRaw(id, input);
  };
  const runner = {
    async start(
      rawId: string,
      { newJobId, mode, now: startedAt }: { newJobId: string; mode?: 'standard' | 'deep'; now: string },
    ) {
      const job: ExtractionJob = {
        id: newJobId,
        rawId,
        mode,
        status: 'running',
        stage: 'extracting',
        chunksTotal: 1,
        chunksDone: 0,
        pagesFound: 0,
        provider: { name: 'fake', model: 'fake' },
        cancelRequested: false,
        callCount: 0,
        startedAt,
        updatedAt: startedAt,
      };
      jobs.set(job.id, job);
      started.push(rawId);
      await states.set(rawId, { status: 'processing', jobId: job.id, reason: '测试任务运行中' });
      const done = (async () => {
        const raw = (await raws.get(rawId))!;
        const forbidden = { code: 'AUTOMATION_FORMAL_WRITE_FORBIDDEN', status: 403 };
        await assert.rejects(
          wiki.create({
            type: 'concept',
            title: '后台禁止写入',
            category: 'customer',
            aliases: [],
            tags: [],
            knowledge_status: 'ai_organized',
            confidence: 'low',
            source_level: 'D',
            review_status: 'unreviewed',
            sources: [],
            body: 'Synthetic.',
          }),
          forbidden,
        );
        await assert.rejects(
          prompts.create(randomUUID(), {
            name: '后台禁止写入',
            category: 'customer',
            scenario: 'fictional',
            body: 'Fixture text',
            inputRequirements: '',
            outputRequirements: '',
            relatedWikiIds: [],
            examples: '',
            tags: [],
            favorite: false,
          }),
          forbidden,
        );
        await provider?.complete({
          system: 'pipeline fixture organizer',
          user: raw.body,
          maxOutputBytes: 100,
          timeoutMs: 100,
        });
        job.callCount++;
        while (knobs.block) await delay(duration);
        const error =
          knobs.failOrganize === raw.title
            ? { code: 'FIXTURE_FAILED', message: '模拟整理失败。', at: startedAt, retryable: true }
            : undefined;
        const draftId = error ? undefined : randomUUID();
        await slotControl.run(async () => {
          Object.assign(job, { status: error ? 'failed' : 'completed', error, stage: 'done', draftId });
          if (draftId)
            drafts.set(draftId, { id: draftId, rawId, jobId: job.id, status: 'pending_confirmation' } as DraftRecord);
          await states.set(rawId, {
            status: error ? 'failed' : 'pending_confirmation',
            jobId: job.id,
            draftId,
            reason: '测试任务结束',
          });
        });
      })().finally(() => runners.delete(job.id));
      runners.set(job.id, done);
      knobs.maxActive = Math.max(knobs.maxActive, runners.size);
      return { job, reused: false };
    },
    async readJob(id: string) {
      return {
        job: jobs.get(id),
        execution: runners.has(id) ? ('running' as const) : ('settled' as const),
        recovery: undefined,
      };
    },
    async waitForSettlement(id: string) {
      await runners.get(id);
      return runner.readJob(id);
    },
  };
  const schedulers: AutomationScheduler[] = [];
  const make = async () => {
    const pipeline: NewsPipeline = new NewsPipeline({
      root,
      news,
      runner,
      states,
      wiki,
      drafts: { get: async (id) => drafts.get(id) },
      clock: () => new Date(now),
      scheduler: {
        canStartAuthorized: () => scheduler.canStartAuthorized(),
        runAuthorized: (...args) => scheduler.runAuthorized(...args),
      },
      withProvider: (work) => work(),
    });
    const scheduler = new AutomationScheduler({
      root,
      tasks: [createDailyNews(news, pipeline)],
      authorizedTypes: [organizeType],
      clock: () => now,
      instance: { pid: 1, port: 0, mode: 'development', startedAt: new Date(now).toISOString(), hostname: 'fixture' },
      withProvider: (execute) => execute(() => provider),
    });
    schedulers.push(scheduler);
    await pipeline.initialize();
    await scheduler.initialize();
    return { scheduler, pipeline };
  };
  const original = await make();
  const app = express();
  app.get('/fixture-source', (_req, res) => {
    res.json({ source: 'synthetic' });
  });
  registerAutomationRoutes(app, original.scheduler, original.pipeline);
  app.use((error: StorageError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ code: error.code, message: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  t.after(async () => {
    knobs.block = false;
    await Promise.allSettled(schedulers.map((scheduler) => scheduler.stop()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const http = async (suffix: string, method = 'GET', body?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(origin + '/api/automation/' + suffix, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-fmcg-automation-token': original.scheduler.status().writeToken,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const terminal = (id: string, scheduler = original.scheduler) =>
    eventually(async () => {
      const run = await scheduler.getRun(id);
      return run.endedAt ? run : undefined;
    });
  const runNews = async () => terminal((await original.scheduler.runNow(dailyNewsType)).id);
  return {
    ...original,
    make,
    now: (value: string) => {
      now = Date.parse(value);
    },
    root,
    indexFile,
    indexBefore,
    raws,
    wiki,
    states,
    jobs,
    drafts,
    knobs,
    sourceCalls,
    requests,
    started,
    news,
    terminal,
    runNews,
    http,
  };
}

test('PIPE01-01/08 fake clock executes 07:30, deduplicates fetching, catches up once, and skips while paused', async (t) => {
  const h = await harness(t);
  assert.equal((await h.http('candidates')).data.counts.fetched, 0);
  assert.deepEqual(h.sourceCalls, []);
  assert.deepEqual(h.scheduler.schedules().items[0]?.plan, { kind: 'daily', time: '07:30', timezone: 'Asia/Shanghai' });
  assert.deepEqual((await h.scheduler.listRuns({ limit: 10 })).items, []);
  h.now('2026-11-16T07:30:00+08:00');
  await h.scheduler.tick();
  const scheduled = (await h.scheduler.listRuns({ limit: 10 })).items[0]!;
  const run = await h.terminal(scheduled.id);
  assert.equal(run.trigger, 'schedule');
  assert.equal(run.scheduledAt, '2026-11-15T23:30:00.000Z');
  assert.equal(run.sourceRequests, 2, JSON.stringify(run.steps));
  assert.deepEqual(run.usage, { requests: 1, inputTokens: 7, outputTokens: 11, unknownUsageCount: 0 });
  assert.match(run.steps.map((step) => step.summary).join(' '), /本地夹具 正常.*夹具仅提供有限条目/u);
  assert.equal((await h.runNews()).sourceRequests, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.sourceCalls.length, 2);
  assert.equal((await h.raws.list()).length, 0);
  await h.scheduler.stop();
  h.now('2026-11-19T08:10:00+08:00');
  const restarted = await h.make();
  const caught = (await restarted.scheduler.listRuns({ limit: 10 })).items.filter(
    (item) => item.trigger === 'catch-up',
  );
  assert.equal(caught.length, 1);
  await h.terminal(caught[0]!.id, restarted.scheduler);
  await restarted.scheduler.setPaused(true);
  h.now('2026-11-20T07:30:00+08:00');
  await restarted.scheduler.tick();
  const skipped = (await restarted.scheduler.listRuns({ limit: 10 })).items.find((item) => item.status === 'skipped');
  assert.equal(skipped?.error, 'paused');
  assert.equal(h.sourceCalls.length, 4);
});

test('PIPE01-02 strict response schema, one-to-one IDs, Unicode reason bound and secrets', async () => {
  const a = {
    candidateId: day + '/fmcg/a',
    title: 'A',
    source: '合成来源',
    publishedAt: null,
    evidenceKind: 'article_excerpt',
    excerpt: '常温陈列。',
  };
  const b = { ...a, candidateId: day + '/ai/b' };
  const good = [score(a.candidateId), score(b.candidateId)];
  const read = (output: unknown) =>
    screenNews(
      { name: 'fixture', model: 'fake', secrets: ['fixture-private-key'], complete: async () => reply(output) },
      [],
      [a, b],
    );
  assert.deepEqual(await read({ items: good }), good);
  assert.equal((await read({ items: [{ ...good[0], reason: '😀'.repeat(120) }, good[1]] }))[0]?.reason.length, 240);
  for (const output of [
    { items: good, extra: true },
    { items: [{ ...good[0], extra: true }, good[1]] },
    { items: [good[0], good[0]] },
    { items: [good[0]] },
    { items: [{ ...good[0], candidateId: 'fabricated' }, good[1]] },
    { items: [{ ...good[0], categories: ['渠道', '渠道'] }, good[1]] },
    { items: [{ ...good[0], categories: ['其他人'] }, good[1]] },
    { items: [{ ...good[0], relevance: 4 }, good[1]] },
    { items: [{ ...good[0], reason: '😀'.repeat(121) }, good[1]] },
    { items: [{ ...good[0], reason: 'fixture-private-key' }, good[1]] },
  ])
    await assert.rejects(read(output));
});

test('PIPE01-02 invalid screen result and absent provider retain visible unscored candidates', async (t) => {
  const h = await harness(t);
  h.knobs.invalidScreen = true;
  assert.equal((await h.runNews()).status, 'failed');
  const candidates = await h.pipeline.list();
  assert.equal(candidates.items.length, 4);
  assert.ok(candidates.items.every((item) => item.screening && 'error' in item.screening));
  assert.equal((await h.runNews()).usage.requests, 0);
  assert.equal(h.requests.length, 1);
  const missing = await harness(t, { providerEnabled: false });
  const run = await missing.runNews();
  assert.equal(run.usage.requests, 0);
  assert.equal((await missing.pipeline.list()).counts.pending, 4);
});

test('PIPE01-02 a failed batch leaves every item unscored and later batches continue', async (t) => {
  const h = await harness(t);
  h.knobs.invalidFirstBatch = true;
  await h.pipeline.stageEdition({
    date: day,
    schemaVersion: 1,
    updatedAt: new Date(start).toISOString(),
    sections: {
      fmcg: {
        status: 'source_only',
        attempt: 1,
        sources: [],
        startedAt: new Date(start).toISOString(),
        items: Array.from({ length: 12 }, (_, idx) => fixtureNews('fmcg', idx + 1)),
      },
    },
  });
  const run = await h.runNews();
  assert.equal(run.status, 'failed');
  assert.equal(run.usage.requests, 2);
  const { items } = await h.pipeline.list();
  assert.equal(items.length, 14);
  assert.equal(items.filter((row) => row.screening && 'error' in row.screening).length, 10);
  assert.equal(items.filter((row) => row.screening && 'score' in row.screening).length, 4);
});

test('PIPE01-02/03/04 HTTP requires valid explicit confirmation, preserves dispositions and Source Raw identity', async (t) => {
  const h = await harness(t);
  const settings = (await h.http('pipeline/settings')).data;
  assert.equal(
    (
      await h.http('pipeline/settings', 'PATCH', {
        revision: settings.revision,
        preScreenEnabled: false,
        topics: [' 关注点 '],
      })
    ).status,
    200,
  );
  assert.equal(
    (await h.http('pipeline/settings', 'PATCH', { revision: settings.revision, concurrency: 4 })).status,
    409,
  );
  assert.equal((await h.runNews()).usage.requests, 0);
  const rows = (await h.pipeline.list()).items;
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => !row.screening));
  const [a, b, c] = rows;
  assert.ok(a && b && c);
  const itemRoute = (id: string, action: string) => 'candidates/' + encodeURIComponent(id) + '/' + action;
  assert.equal((await h.http(itemRoute(a.id, 'disposition'), 'POST', { action: 'ignore' })).status, 200);
  assert.equal((await h.http(itemRoute(b.id, 'disposition'), 'POST', { action: 'later' })).status, 200);
  const persisted = (await (await h.make()).pipeline.list()).items;
  assert.equal(persisted.find((row) => row.id === a.id)?.disposition, 'ignored');
  assert.equal(persisted.find((row) => row.id === b.id)?.disposition, 'later');
  const grant = { requestId: randomUUID(), candidateIds: [a.id, b.id], organize: false, mode: 'standard' };
  assert.equal((await h.http('candidates/confirm', 'POST', grant, { origin: 'https://other.test' })).status, 403);
  assert.equal(
    (await h.http('candidates/confirm', 'POST', grant, { 'x-fmcg-automation-token': 'invalid' })).status,
    403,
  );
  assert.equal((await h.http('candidates/confirm', 'POST', { ...grant, excerpt: 'new text' })).status, 400);
  assert.equal(
    (await h.http('candidates/confirm', 'POST', { ...grant, candidateIds: [c.id, day + '/ai/absent'] })).status,
    404,
  );
  assert.equal((await h.http('candidates/confirm', 'POST', grant)).status, 409);
  assert.deepEqual(await h.raws.list(), []);
  assert.equal((await h.http(itemRoute(a.id, 'disposition'), 'POST', { action: 'restore' })).status, 200);
  assert.equal((await h.http('candidates/confirm', 'POST', grant)).status, 202);
  assert.equal((await h.http('candidates/confirm', 'POST', grant)).status, 202);
  await h.pipeline.tick();
  const done = await eventually(async () => {
    const result = (await h.pipeline.list()).items;
    return result.filter((row) => row.execution?.phase === 'saved').length === 2 ? result : undefined;
  });
  const linked = done.find((row) => row.id === a.id)!;
  const raw = (await h.raws.get(linked.savedRawId!))!;
  assert.equal(raw.body, a.item.excerpt);
  assert.equal(raw.publishedAt, a.item.publishedAt);
  assert.equal(raw.url, a.item.url);
  assert.match(raw.sourceName, /来源正文摘录/u);
  assert.equal((await h.news.saveRaw(day, a.section, a.item.id)).rawId, raw.id);
  const replay = await h.http('candidates/confirm', 'POST', { ...grant, requestId: randomUUID(), organize: true });
  assert.equal(replay.status, 202);
  assert.equal(replay.data.items[0].savedRawId, raw.id);
  await h.pipeline.tick();
  assert.equal(h.started.length, 0);
  assert.equal((await h.raws.list()).length, 2);
  assert.equal((await h.pipeline.list()).counts.pending, 2);
});

test('PIPE01-03/05/06/08 bounded queue, isolated failures and per-item retry preserve formal assets', async (t) => {
  const h = await harness(t);
  const daily = await h.runNews();
  assert.equal(daily.status, 'succeeded', JSON.stringify(daily.steps));
  const items = (await h.pipeline.list()).items;
  h.knobs.failRaw = items[0]!.item.title;
  h.knobs.failOrganize = items[1]!.item.title;
  h.knobs.block = true;
  await h.scheduler.setPaused(true);
  await h.pipeline.confirm({
    requestId: randomUUID(),
    candidateIds: items.map((row) => row.id),
    organize: true,
    mode: 'deep',
  });
  await h.pipeline.tick();
  assert.equal((await h.raws.list()).length, 0);
  await h.scheduler.setPaused(false);
  await h.pipeline.tick();
  await eventually(async () =>
    (await h.pipeline.list()).items.some((row) => row.execution?.phase === 'raw_failed') ? true : undefined,
  );
  await eventually(async () => {
    await h.pipeline.tick();
    return h.knobs.maxActive === 2 ? true : undefined;
  });
  assert.equal(h.knobs.maxActive, 2);
  const whileBlocked = await h.scheduler.listRuns({ type: organizeType, limit: 10 });
  assert.equal(whileBlocked.items.filter((run) => run.status === 'running').length, 2);
  assert.ok(whileBlocked.items.every((run) => run.status !== 'succeeded'));
  h.knobs.block = false;
  await eventually(async () =>
    (await h.pipeline.list()).items.some((row) => row.execution?.phase === 'organize_failed') ? true : undefined,
  );
  await eventually(async () => {
    await h.pipeline.tick();
    return (await h.pipeline.list()).counts.drafts === 2 ? true : undefined;
  });
  assert.equal((await h.raws.list()).length, 3);
  assert.equal((await h.pipeline.list()).counts.failed, 2);
  h.knobs.failOrganize = '';
  for (const row of (await h.pipeline.list()).items) {
    await h.terminal(row.execution!.runId);
  }
  await h.pipeline.retry(items[0]!.id, 'raw');
  await h.pipeline.retry(items[1]!.id, 'organize');
  await h.pipeline.tick();
  await eventually(async () => ((await h.pipeline.list()).counts.drafts === 4 ? true : undefined));
  const view = await h.pipeline.list();
  assert.equal(view.counts.failed, 0);
  assert.equal((await h.raws.list()).length, 4);
  assert.equal(h.knobs.maxActive, 2);
  const runs = await Promise.all(view.items.map((row) => h.terminal(row.execution!.runId)));
  for (const run of runs) {
    const candidate = view.items.find((row) => row.id === run.candidateId)!;
    assert.deepEqual(run.artifacts, {
      rawIds: [candidate.savedRawId],
      jobIds: [candidate.execution!.jobId],
      draftIds: [candidate.execution!.draftId],
    });
  }
  const allRuns = (await h.scheduler.listRuns({ type: organizeType, limit: 10 })).items;
  assert.equal(allRuns.length, 6);
  const total = (field: keyof AutomationRun['usage']) => allRuns.reduce((sum, run) => sum + run.usage[field], 0);
  assert.equal(total('requests'), h.requests.filter((request) => request === 'organize').length);
  assert.equal(total('inputTokens'), 5 * 7);
  assert.equal(total('outputTokens'), 5 * 11);
  assert.equal(total('unknownUsageCount'), 0);
  assert.deepEqual(await readFile(h.indexFile), h.indexBefore);
  assert.equal((await readdir(path.join(h.root, 'knowledge/wiki'))).filter((name) => name !== 'index.md').length, 0);
  assert.equal((await readdir(path.join(h.root, 'prompts'))).filter((name) => name.endsWith('.json')).length, 0);
});

test('PIPE01-05 restart resumes waiting authorization and never resends started organization until explicit continue', async (t) => {
  const h = await harness(t, { itemCount: 1 });
  await h.runNews();
  const [a, b] = (await h.pipeline.list()).items;
  assert.ok(a && b);
  await h.scheduler.setPaused(true);
  await h.pipeline.confirm({ requestId: randomUUID(), candidateIds: [a.id, b.id], organize: true, mode: 'standard' });
  const file = path.join(h.root, 'state/automation/news-candidates', day + '.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  const already = await h.news.rawSaves().save(day, a.section, a.item, stored.items[0].confirmation.registrationId);
  const jobId = randomUUID();
  Object.assign(stored.items[0].execution, { phase: 'organizing', rawId: already.rawId, jobId });
  await writeFile(file, JSON.stringify(stored));
  await h.scheduler.stop();
  const restarted = await h.make();
  assert.equal((await restarted.pipeline.list()).items[0]?.execution?.phase, 'interrupted');
  assert.equal((await restarted.pipeline.list()).items[0]?.execution?.jobId, jobId);
  await restarted.scheduler.setPaused(false);
  await restarted.pipeline.tick();
  await eventually(async () => ((await restarted.pipeline.list()).counts.drafts === 1 ? true : undefined));
  assert.equal(h.started.includes(already.rawId), false);
  await restarted.pipeline.retry(a.id, 'organize');
  await restarted.pipeline.tick();
  await eventually(async () => ((await restarted.pipeline.list()).counts.drafts === 2 ? true : undefined));
  assert.equal(h.started.filter((rawId) => rawId === already.rawId).length, 1);
  assert.equal((await h.raws.list()).length, 2);
  assert.equal((await restarted.pipeline.list()).items[0]?.execution?.jobId, jobId);
});

test('PIPE01-05/06/08 real ExtractionRunner with fake Provider generates the existing homepage draft and meters it', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pipe01-runner-'));
  const fake = await startFakeProvider((request) => {
    if (request.system.startsWith('你为快消产品经理预筛资讯。')) {
      const { items } = JSON.parse(request.user) as { items: ScreenInput[] };
      return { kind: 'content', content: JSON.stringify({ items: items.map((row) => score(row.candidateId)) }) };
    }
    return answerExtraction(request, [
      { title: '合成渠道指南', type: 'concept', category: 'customer', quoteMode: 'whole' },
    ]);
  });
  const base = new OpenAiCompatibleProvider({
    baseUrl: fake.url,
    model: 'fixture-pipeline',
    apiKey: 'sk-fixture-pipeline-key',
    source: 'env',
  });
  const provider = meterAutomationProvider(base);
  const providerSlot = new AsyncLocalStorage<LlmProvider>();
  const clock = () => new Date(start);
  const rulesDir = path.resolve('rules');
  const bundle = await loadExtractionRules(rulesDir);
  const raws = new RawStore(root),
    wiki = new WikiStore(root, raws),
    states = new RawStateStore(root),
    drafts = new DraftStore(root),
    jobs = new ExtractionJobStore(root);
  await raws.initialize();
  await wiki.initialize();
  await states.initialize();
  await drafts.initialize();
  await jobs.initialize();
  const runner = new ExtractionRunner({
    root,
    rulesDir,
    llm: new LLMService(rulesDir),
    jobs,
    drafts,
    rawStates: states,
    rawStore: raws,
    provider: () => providerSlot.getStore(),
    draftRules: async () => ({
      types: (bundle.schema.properties?.suggested_pages?.items?.properties?.type?.enum ?? []) as string[],
      categories: (bundle.schema.properties?.suggested_pages?.items?.properties?.category?.enum ?? []) as string[],
      knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [],
      confidence: bundle.fmcg.enums?.confidence ?? [],
      source_level: bundle.fmcg.enums?.source_level ?? [],
      review_status: bundle.fmcg.enums?.review_status ?? [],
    }),
  });
  const excerpt = '快消零售门店调研显示，试点门店将瓶装茶移到常温货架后，瓶装茶销量增长 12%。';
  const article = fixtureNews('fmcg', 1, { excerpt });
  const news = new NewsService({
    root,
    clock,
    rawStore: raws,
    aiEnabled: false,
    providerFactory: async () => provider,
    readSources: async (section) => ({
      items: section === 'fmcg' ? [article] : [],
      sources: [{ name: '合成来源', checkedAt: clock().toISOString(), status: 'ok' }],
    }),
  });
  const pipeline: NewsPipeline = new NewsPipeline({
    root,
    news,
    runner,
    wiki,
    states,
    drafts,
    clock,
    scheduler: {
      canStartAuthorized: () => scheduler.canStartAuthorized(),
      runAuthorized: (...args) => scheduler.runAuthorized(...args),
    },
    withProvider: (work) => providerSlot.run(provider, work),
  });
  const scheduler = new AutomationScheduler({
    root,
    tasks: [createDailyNews(news, pipeline)],
    authorizedTypes: [organizeType],
    clock: () => clock().getTime(),
    instance: { pid: 1, port: 0, mode: 'development', startedAt: start, hostname: 'fixture' },
    withProvider: (execute) => execute(() => provider),
  });
  t.after(async () => {
    await scheduler.stop();
    await fake.close();
    await rm(root, { recursive: true, force: true });
  });
  await pipeline.initialize();
  await scheduler.initialize();
  const newsRun = await scheduler.runNow(dailyNewsType);
  await eventually(async () => ((await scheduler.getRun(newsRun.id)).status === 'succeeded' ? true : undefined));
  const [item] = (await pipeline.list()).items;
  await pipeline.confirm({ requestId: randomUUID(), candidateIds: [item!.id], mode: 'standard', organize: true });
  await pipeline.tick();
  const settled = await eventually(async () => {
    const row = (await pipeline.list()).items[0]!;
    if (row.execution?.phase === 'organize_failed') assert.fail(row.execution.error);
    return row.draftPending ? row : undefined;
  });
  const run = await eventually(async () => {
    const value = await scheduler.getRun(settled.execution!.runId);
    return value.endedAt ? value : undefined;
  });
  assert.equal(run.status, 'succeeded');
  assert.deepEqual(run.usage, { requests: 3, inputTokens: 300, outputTokens: 600, unknownUsageCount: 0 });
  assert.equal(fake.requests.length, 4);
  assert.equal((await raws.get(settled.savedRawId!))?.body, excerpt);
  assert.ok(
    (await homeActions({ root, raws, wiki, runner })).items.some(
      (action) => action.kind === 'draft' && action.target.draftId === settled.execution?.draftId,
    ),
  );
  assert.deepEqual(
    (await readdir(path.join(root, 'knowledge/wiki'))).filter((file) => file.endsWith('.md')),
    ['index.md'],
  );
  assert.deepEqual(await readdir(path.join(root, 'state/wiki-commits')).catch(() => []), []);
});
