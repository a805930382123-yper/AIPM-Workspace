import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';
import { meterAutomationProvider, runInAutomationContext } from '../services/automation/context.ts';
import { acquireInstanceLock } from '../services/automation/instance-lock.ts';
import { AutomationLedger } from '../services/automation/ledger.ts';
import { firstDueAfter } from '../services/automation/schedule.ts';
import { AutomationScheduler, type TaskDefinition } from '../services/automation/scheduler.ts';
import type { AutomationInstance, AutomationRun } from '../services/automation/types.ts';
import { LlmError, type LlmProvider } from '../services/llm/provider.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';

const minute = 60_000;
const initial = Date.parse('2026-11-15T11:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();
const instance: AutomationInstance = {
  pid: process.pid,
  port: 0,
  mode: 'development',
  startedAt: iso(initial),
  hostname: os.hostname(),
};
const type = 'test.fixture';
const defaultTask: TaskDefinition = {
  type,
  name: 'Isolated test task',
  defaultPlan: { kind: 'interval', minutes: 1 },
  allowsCatchUp: true,
  mayCallModel: false,
  execute: async ({ step }) => {
    await step('fixture', () => 'done');
  },
};
const emptyUsage = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 });
const emptyArtifacts = () => ({ rawIds: [], jobIds: [], draftIds: [] });

async function temp(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run01-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fixtureRun(time: number, status: AutomationRun['status'] = 'succeeded'): AutomationRun {
  return {
    id: randomUUID(),
    type,
    trigger: 'manual',
    scheduledAt: iso(time),
    startedAt: status === 'queued' ? null : iso(time),
    endedAt: status === 'queued' || status === 'running' ? null : iso(time),
    status,
    steps: [],
    usage: emptyUsage(),
    artifacts: emptyArtifacts(),
    budget: null,
  };
}

async function end(scheduler: AutomationScheduler, id: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const run = await scheduler.getRun(id);
    if (run.endedAt !== null) return run;
    await sleep(10);
  }
  assert.fail(`Run ${id} did not end`);
}

test('RUN01 schedule uses Shanghai days and a persisted interval anchor', async (t) => {
  const midnight = { kind: 'daily', time: '00:00', timezone: 'Asia/Shanghai' } as const;
  const before = Date.parse('2026-11-15T15:59:59.999Z');
  assert.equal(iso(firstDueAfter(midnight, before)), '2026-11-15T16:00:00.000Z');
  assert.equal(iso(firstDueAfter(midnight, before + 1)), '2026-11-16T16:00:00.000Z');
  let now = initial;
  const root = await temp(t);
  const scheduler = new AutomationScheduler({ root, instance, tasks: [defaultTask], clock: () => now });
  await scheduler.initialize();
  assert.equal(scheduler.status().nextRunAt, iso(initial + minute));
  assert.deepEqual((await scheduler.listRuns({ limit: 10 })).items, []);
  now += 20_000;
  const same = await scheduler.patchSchedule(type, { revision: 1, plan: { kind: 'interval', minutes: 1 } });
  assert.equal(same.nextRunAt, iso(initial + minute));
  const changed = await scheduler.patchSchedule(type, { revision: 2, plan: { kind: 'interval', minutes: 2 } });
  assert.equal(changed.nextRunAt, iso(now + 2 * minute));
  const persisted = await readFile(path.join(root, 'state', 'automation', 'schedules.json'), 'utf8');
  await assert.rejects(scheduler.patchSchedule(type, { revision: 2, enabled: false }), { status: 409 });
  assert.equal(await readFile(path.join(root, 'state', 'automation', 'schedules.json'), 'utf8'), persisted);
  assert.equal((await scheduler.patchSchedule(type, { revision: 3, enabled: false })).nextRunAt, null);
  now = before;
  const enabled = await scheduler.patchSchedule(type, { revision: 4, enabled: true, plan: midnight });
  assert.equal(enabled.nextRunAt, '2026-11-15T16:00:00.000Z');
  now++;
  await scheduler.tick();
  const [daily] = (await scheduler.listRuns({ limit: 10 })).items;
  assert.equal((await end(scheduler, daily!.id)).status, 'succeeded');
  assert.equal(daily!.scheduledAt, '2026-11-15T16:00:00.000Z');
  assert.equal(scheduler.status().nextRunAt, '2026-11-16T16:00:00.000Z');
  assert.equal(scheduler.schedules().items[0]?.revision, 5);
});

test('RUN01 ticks/pause/cancel preserve single-flight, audit slots and terminal idempotency', async (t) => {
  const root = await temp(t);
  let now = initial;
  let executions = 0;
  let entered!: () => void;
  const stepEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const task: TaskDefinition = {
    ...defaultTask,
    async execute({ step, signal }) {
      executions++;
      await step('wait for cancellation', async () => {
        entered();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return 'cancelled after acknowledgement';
      });
    },
  };
  const scheduler = new AutomationScheduler({ root, instance, tasks: [task], clock: () => now });
  await scheduler.initialize();
  t.after(() => scheduler.stop());
  const manual = await scheduler.runNow(type);
  assert.equal(manual.status, 'queued');
  await stepEntered;
  await assert.rejects(scheduler.runNow(type), { code: 'AUTOMATION_TASK_RUNNING', status: 409 });
  now += 4 * minute;
  await scheduler.tick();
  const [overlap] = (await scheduler.listRuns({ status: 'skipped', limit: 10 })).items;
  assert.equal(overlap?.error, 'overlap');
  assert.equal(overlap?.scheduledAt, iso(now));
  await scheduler.setPaused(true);
  assert.equal((await scheduler.getRun(manual.id)).status, 'running');
  assert.equal((await scheduler.runNow(type)).error, 'paused');
  now += minute;
  await scheduler.tick();
  now += minute;
  await scheduler.setPaused(false);
  await scheduler.tick();
  const skipped = (await scheduler.listRuns({ status: 'skipped', limit: 10 })).items;
  assert.equal(skipped.length, 4);
  assert.equal(skipped.filter((run) => run.trigger === 'schedule' && run.error === 'paused').length, 2);
  assert.equal(scheduler.status().nextRunAt, iso(now + minute));
  const cancelled = await scheduler.cancel(manual.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.steps[0]?.status, 'cancelled');
  assert.deepEqual(await scheduler.cancel(manual.id), cancelled);
  assert.equal(executions, 1);
});

test('RUN01 restart marks queued/running once, catches up just the latest missed slot and preserves corrupt files', async (t) => {
  const root = await temp(t);
  let now = initial;
  const noCatchType = 'test.no-catch';
  const tasks = [defaultTask, { ...defaultTask, type: noCatchType }];
  const makeScheduler = () => new AutomationScheduler({ root, instance, tasks, clock: () => now });
  const before = makeScheduler();
  await before.initialize();
  await before.patchSchedule(noCatchType, { revision: 1, catchUp: false });
  const ledger = new AutomationLedger(root);
  const pending = fixtureRun(initial, 'queued');
  const running = fixtureRun(initial, 'running');
  running.steps.push({
    name: 'interrupted fixture',
    status: 'running',
    startedAt: iso(initial),
    endedAt: null,
    durationMs: null,
    summary: '',
  });
  await ledger.save(pending);
  await ledger.save(running);
  const corruptId = randomUUID();
  const corrupt = path.join(root, 'state', 'automation', 'runs', '2026-11', `${corruptId}.json`);
  await writeFile(corrupt, '{broken', 'utf8');
  now += 5 * minute + 3;
  const after = makeScheduler();
  await after.initialize();
  // Wait for the actual execution and its terminal write before opening the run files.
  await after['active'].get(type)?.done;
  const current = await after.listRuns({ limit: 10 });
  assert.equal(current.items.length, 3);
  const catchUp = current.items.find((run) => run.trigger === 'catch-up')!;
  assert.equal(catchUp.scheduledAt, iso(initial + 5 * minute));
  assert.equal(catchUp.type, type);
  assert.equal(catchUp.status, 'succeeded', JSON.stringify({ run: catchUp, scheduler: after.status().scheduler }));
  assert.equal((await after.getRun(pending.id)).status, 'interrupted');
  assert.equal((await after.getRun(running.id)).steps[0]?.status, 'interrupted');
  assert.deepEqual(current.issues, [{ file: `state/automation/runs/2026-11/${corruptId}.json`, reason: 'parse' }]);
  await assert.rejects(after.getRun(corruptId), { code: 'AUTOMATION_RUN_CORRUPT' });
  assert.equal(await readFile(corrupt, 'utf8'), '{broken');
  const restarted = makeScheduler();
  await restarted.initialize();
  assert.equal(restarted.status().scheduler.healthy, true);
  assert.equal((await restarted.listRuns({ limit: 10 })).items.length, 3);
  assert.equal(restarted.status().nextRunAt, iso(initial + 6 * minute));
});

test('RUN01 restart does not re-execute a queued scheduled record written before its cursor', async (t) => {
  const root = await temp(t);
  let now = initial;
  const make = () => new AutomationScheduler({ root, instance, tasks: [defaultTask], clock: () => now });
  await make().initialize();
  now += minute;
  const queued = { ...fixtureRun(now, 'queued'), trigger: 'schedule' as const };
  await new AutomationLedger(root).save(queued);
  const restarted = make();
  await restarted.initialize();
  const records = await restarted.listRuns({ limit: 10 });
  assert.equal(records.items.length, 1);
  assert.equal(records.items[0]?.id, queued.id);
  assert.equal(records.items[0]?.status, 'interrupted');
  assert.equal(restarted.status().nextRunAt, iso(now + minute));
});

test('RUN01 retention keeps the union of newest 2000 and last 90 days and leaves active older runs', async (t) => {
  const root = await temp(t);
  const dir = path.join(root, 'state', 'automation', 'runs');
  const old = Date.parse('2026-11-01T00:00:00.000Z');
  const seed = [
    fixtureRun(old - 4 * 24 * 60 * minute),
    ...Array.from({ length: 2000 }, (_, index) => fixtureRun(old + index)),
  ];
  const active = fixtureRun(old - 40 * 24 * 60 * minute, 'running');
  seed.push(active);
  for (const month of ['2026-09', '2026-10', '2026-11']) await mkdir(path.join(dir, month), { recursive: true });
  for (let from = 0; from < seed.length; from += 100)
    await Promise.all(
      seed
        .slice(from, from + 100)
        .map((run) => writeFile(path.join(dir, run.scheduledAt.slice(0, 7), `${run.id}.json`), JSON.stringify(run))),
    );
  const ledger = new AutomationLedger(root);
  await ledger.initialize();
  await ledger.prune(initial);
  assert.equal([...ledger.values()].length, 2002);
  await ledger.prune(initial + 91 * 24 * 60 * minute);
  assert.equal([...ledger.values()].length, 2001);
  assert.deepEqual((await readdir(dir)).sort(), ['2026-09', '2026-11']);
  assert.equal((await ledger.get(active.id))?.status, 'running');
});

test('RUN01 v1 backup restores exact schedule and run records and never releases a source root lock', async (t) => {
  const parent = await temp(t);
  const root = path.join(parent, 'source');
  const restored = path.join(parent, 'restored');
  const source = await acquireInstanceLock(root, 41011, 'development');
  t.after(() => source.close());
  const scheduler = new AutomationScheduler({
    root,
    instance: source.instance,
    tasks: [defaultTask],
    clock: () => initial,
  });
  await scheduler.initialize();
  const run = await end(scheduler, (await scheduler.runNow(type)).id);
  const archive = path.join(parent, 'backup.json');
  await exportWorkspace(root, archive);
  await restoreWorkspace(archive, restored);
  for (const file of ['state/automation/schedules.json', `state/automation/runs/2026-11/${run.id}.json`]) {
    assert.deepEqual(await readFile(path.join(restored, file)), await readFile(path.join(root, file)));
  }
  const restoredLock = await acquireInstanceLock(restored, 41012, 'production');
  try {
    assert.equal(source.isCurrent(), true);
    assert.equal(restoredLock.isCurrent(), true);
    const restoredScheduler = new AutomationScheduler({
      root: restored,
      instance: restoredLock.instance,
      tasks: [defaultTask],
      clock: () => initial,
    });
    await restoredScheduler.initialize();
    assert.deepEqual(await restoredScheduler.getRun(run.id), run);
  } finally {
    restoredLock.close();
    source.close();
  }
});

test('RUN01 meters fake Provider attempts per asynchronous run and keeps ordinary calls uncounted', async (t) => {
  const root = await temp(t);
  const completion = { text: 'fake', finishReason: 'stop', bytes: 4 };
  let attempts = 0;
  const provider = meterAutomationProvider({
    name: 'fake',
    model: 'fake-test',
    cacheIdentity: 'identity',
    async complete(request) {
      attempts++;
      await sleep(1);
      if (request.user === 'throw')
        throw new LlmError('FAKE', 'fixture error', 502, { usage: { completionTokens: 4 } });
      if (request.user === 'full') return { ...completion, usage: { promptTokens: 10, completionTokens: 5 } };
      if (request.user === 'partial') return { ...completion, usage: { promptTokens: 2 } };
      return completion;
    },
  });
  const send = (target: LlmProvider, user: string) =>
    target.complete({ system: 'fixture', user, timeoutMs: 10, maxOutputBytes: 64 });
  const model: TaskDefinition = {
    ...defaultTask,
    mayCallModel: true,
    async execute({ provider }) {
      assert.equal(provider()?.cacheIdentity, 'identity');
      await Promise.all([send(provider()!, 'full'), send(provider()!, 'partial'), send(provider()!, 'no-usage')]);
      await assert.rejects(send(provider()!, 'throw'), { code: 'FAKE' });
    },
  };
  const other: TaskDefinition = {
    ...model,
    type: 'test.other',
    async execute({ provider }) {
      await send(provider()!, 'full');
    },
  };
  const scheduler = new AutomationScheduler({
    root,
    instance,
    tasks: [model, other],
    clock: () => initial,
    withProvider: (execute) => execute(() => provider),
  });
  await scheduler.initialize();
  const a = await scheduler.runNow(type);
  const b = await scheduler.runNow(other.type);
  await send(provider, 'full');
  const endA = await end(scheduler, a.id);
  const endB = await end(scheduler, b.id);
  assert.equal(attempts, 6);
  assert.equal(endA.status, 'succeeded');
  assert.deepEqual(endA.usage, { requests: 4, inputTokens: 12, outputTokens: 9, unknownUsageCount: 3 });
  assert.deepEqual(endB.usage, { requests: 1, inputTokens: 10, outputTokens: 5, unknownUsageCount: 0 });
});

test('RUN01 rejects formal Wiki/Prompt persistence in the automation context and preserves outside writes', async (t) => {
  const root = await temp(t);
  const raws = new RawStore(root);
  await raws.initialize();
  const wiki = new WikiStore(root, raws);
  const prompts = new PromptStore(root, wiki);
  await wiki.initialize();
  await prompts.initialize();
  const pageData = {
    type: 'concept',
    title: 'RUN01 fixture',
    category: 'customer',
    aliases: [],
    tags: [],
    knowledge_status: 'ai_organized',
    confidence: 'low',
    source_level: 'D',
    review_status: 'unreviewed',
    sources: [],
    body: 'Test grounding.',
  } as const;
  const wikiInput = { ...pageData, aliases: [], tags: [], sources: [] };
  const promptInput = {
    name: 'RUN01 guarded fixture',
    category: 'customer',
    scenario: 'fictional',
    body: 'Fixture text',
    inputRequirements: '',
    outputRequirements: '',
    relatedWikiIds: [],
    examples: '',
    tags: [],
    favorite: false,
  };
  const wikiPage = await wiki.create(wikiInput);
  const prompt = (await prompts.create(randomUUID(), promptInput)).prompt;
  const beforeWiki = await wiki.readPageFile(wikiPage.id);
  const forbidden = { code: 'AUTOMATION_FORMAL_WRITE_FORBIDDEN', status: 403 };
  await runInAutomationContext({ runId: randomUUID(), usage: emptyUsage() }, async () => {
    await assert.rejects(wiki.create(wikiInput), forbidden);
    await assert.rejects(wiki.update(wikiPage.id, 1, { ...wikiInput, body: 'Never saved' }), forbidden);
    await assert.rejects(wiki.delete(wikiPage.id, 1), forbidden);
    await assert.rejects(wiki.writePageLocked(wikiPage), forbidden);
    await assert.rejects(wiki.appendLogLocked([]), forbidden);
    await assert.rejects(wiki.rebuildIndexLocked(), forbidden);
    await assert.rejects(prompts.create(randomUUID(), promptInput), forbidden);
    await assert.rejects(prompts.update(prompt.id, 1, { ...promptInput, body: 'Never saved' }), forbidden);
    await assert.rejects(prompts.delete(prompt.id, 1), forbidden);
  });
  assert.equal(await wiki.readPageFile(wikiPage.id), beforeWiki);
  assert.equal((await prompts.get(prompt.id))?.body, promptInput.body);
  assert.equal((await wiki.update(wikiPage.id, 1, { ...wikiInput, body: 'Manual edit' })).revision, 2);
  assert.equal((await prompts.update(prompt.id, 1, { ...promptInput, body: 'Manual edit' })).version, 2);
});
