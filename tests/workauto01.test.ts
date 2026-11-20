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
import { createDesktopNotifier, desktopToastXml, sendDesktopNotice, type DesktopNotice, type DesktopNotifier } from '../services/automation/desktop-notify.ts';
import { defaultReminderSettings, isQuietHours, REMINDER_DAY, RemindersStore } from '../services/automation/reminders.ts';
import { AutomationScheduler } from '../services/automation/scheduler.ts';
import { createWorkReminders, workRemindersType } from '../services/automation/tasks/work-reminders.ts';
import type { AutomationInstance } from '../services/automation/types.ts';
import { RawStore, type RawRecord } from '../services/raw/store.ts';
import { WorkAnalysisRuns } from '../services/work-items/analysis-runs.ts';
import { WorkItemStore } from '../services/work-items/store.ts';
import type { WorkAnalysisRun, WorkItem, WorkItemUpdate } from '../services/work-items/types.ts';

const daytime = Date.parse('2026-12-01T01:00:00.000Z');
const iso = (value: number) => new Date(value).toISOString();
const instance: AutomationInstance = { pid: process.pid, port: 0, mode: 'development', startedAt: iso(daytime), hostname: os.hostname() };

async function fixture(t: TestContext) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'workauto01-'));
  const root = path.join(temp, 'source');
  const raws = new RawStore(root);
  await raws.initialize();
  const work = new WorkItemStore(root, raws);
  const analysis = new WorkAnalysisRuns(root, id => work.get(id), raws, async () => {
    assert.fail('Reminder scanning must never resolve a Provider or start analysis');
  });
  let now = daytime;
  const notices: DesktopNotice[] = [];
  let send: DesktopNotifier['send'] = async () => ({ deliveryStatus: 'delivered' });
  const reminders = new RemindersStore(root, { send: (notice, signal) => {
    notices.push(notice);
    return send(notice, signal);
  } }, () => now, 200);
  const scheduler = new AutomationScheduler({ root, instance, clock: () => now,
    tasks: [createWorkReminders({ root, items: work, analysis, raws }, reminders)],
    withProvider: async () => { assert.fail('Reminder scheduling must use zero Provider calls'); },
  });
  await scheduler.initialize();
  t.after(async () => {
    await scheduler.stop();
    await rm(temp, { recursive: true, force: true });
  });
  const reminderFile = path.join(root, 'state', 'automation', 'reminders.json');
  const itemFile = (id: string) => path.join(root, 'work-items', id + '.json');
  const run = async () => {
    const queued = await scheduler.runNow(workRemindersType);
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await scheduler.getRun(queued.id);
      if (result.endedAt !== null) return result;
      await sleep(10);
    }
    assert.fail('Reminder run did not finish');
  };
  const item = async (title: string, patch: Omit<WorkItemUpdate, 'baseRevision'> = {}, updatedAt?: string) => {
    const created = await work.create({ title, feedback: 'CUSTOMER_FEEDBACK_SENTINEL' });
    const stored = Object.keys(patch).length ? await work.update(created.id, { baseRevision: created.revision, ...patch }) : created;
    const next = updatedAt ? { ...stored, updatedAt } : stored;
    if (updatedAt) await writeFile(itemFile(next.id), JSON.stringify(next));
    return next;
  };
  const raw = (title: string) => raws.create({ title, sourceName: 'Synthetic', sourceType: 'note', body: 'RAW_BODY_SENTINEL', tags: [] });
  const completed = async (product: WorkItem, selected: RawRecord[], covered?: string[], startedAt = '2026-11-30T01:00:00.000Z') => {
    const saved: WorkAnalysisRun = { id: randomUUID(), itemId: product.id, baseRevision: product.revision, status: 'completed',
      startedAt, finishedAt: startedAt, provider: { name: 'synthetic', model: 'offline' },
      input: { goal: 'Synthetic goal', sources: selected.map(entry => ({ rawId: entry.id, title: entry.title, body: entry.body })) },
      output: covered
        ? { observations: [], suggestions: [], openQuestions: [], roundSummary: 'Synthetic fixture', themes: [{
          title: 'Scope', conclusion: null, evidence: [], counterEvidence: [], openQuestions: ['未决'], nextSteps: [], confirmedConflict: null,
        }] }
        : { observations: [], suggestions: [], openQuestions: ['未决'] },
      ...(covered ? { outputVersion: 2, sourceRawIds: covered } : {}),
    };
    const dir = path.join(root, 'work-items', 'analysis-runs', product.id);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, saved.id + '.json');
    await writeFile(file, JSON.stringify(saved));
    return file;
  };
  return { root, temp, raws, work, analysis, scheduler, reminders, notices, reminderFile, itemFile, item, raw, run, completed,
    time: (value: number) => { now = value; }, notifier: (handler: DesktopNotifier['send']) => { send = handler; } };
}

async function hashes(root: string, directories: string[]) {
  const rows = [];
  for (const dir of directories) {
    const full = path.join(root, dir);
    for (const entry of await readdir(full, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      rows.push([path.relative(root, file), createHash('sha256').update(await readFile(file)).digest('hex')]);
    }
  }
  return rows.sort();
}

test('WKA-01 Shanghai due/stale precedence and latest analysis provenance are read-only and use zero model calls', async t => {
  const f = await fixture(t);
  const due = await f.item('今日到期', { followUpOn: '2026-12-01', status: 'in_progress' }, '2026-11-01T10:00:00.000Z');
  const late = await f.item('逾期跟进', { followUpOn: '2026-11-28' });
  const stale = await f.item('久未推进', { status: 'waiting' }, '2026-11-22T10:00:00.000Z');
  await f.item('-阈值等于七天-', { status: 'retest' }, '2026-11-23T16:00:00.000Z');
  await f.item('未来跟进', { followUpOn: '2026-12-02' }, iso(daytime));
  const closed = await f.item('已关闭', { status: 'closed', closureReason: '已核对', followUpOn: '2026-11-25' });
  const oldCovered = await f.raw('旧轮选择');
  const currentCovered = await f.raw('最新轮选择');
  const inherited = await f.raw('明确继承');
  const newRaw = await f.raw('新资料');
  const restricted = await f.raws.createMeetingRegistration({
    id: randomUUID(), title: '会议来源', sourceName: 'Synthetic', tags: [], body: 'MEETING_RAW_SENTINEL', importedAt: iso(daytime),
    origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: '1'.repeat(64),
      registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' },
  });
  const productInput = await f.work.create({ kind: 'product_analysis', title: '产品事项', goal: 'GOAL_SENTINEL' });
  const product = await f.work.update(productInput.id, { baseRevision: 1, rawIds: [currentCovered.id, restricted.record.id, oldCovered.id, newRaw.id, inherited.id] });
  await f.completed(product, [oldCovered], undefined, '2026-11-02T00:00:00.000Z');
  await f.completed(product, [currentCovered], [currentCovered.id, inherited.id]);
  const alreadyInput = await f.work.create({ kind: 'product_analysis', title: '全部覆盖', goal: 'GOAL_SENTINEL' });
  const already = await f.work.update(alreadyInput.id, { baseRevision: 1, rawIds: [currentCovered.id] });
  await f.completed(already, [currentCovered]);
  const firstInput = await f.work.create({ kind: 'product_analysis', title: '第一轮', goal: 'GOAL_SENTINEL' });
  const first = await f.work.update(firstInput.id, { baseRevision: 1, rawIds: [oldCovered.id] });
  const snapshot = await hashes(f.root, ['work-items', 'knowledge/raw']);
  assert.deepEqual(f.scheduler.schedules().items.map(({ enabled, plan, catchUp, allowsCatchUp, mayCallModel }) =>
    ({ enabled, plan, catchUp, allowsCatchUp, mayCallModel })), [
    { enabled: true, plan: { kind: 'interval', minutes: 60 }, catchUp: false, allowsCatchUp: false, mayCallModel: false },
  ]);
  const finished = await f.run();
  assert.equal(finished.status, 'succeeded', JSON.stringify(finished));
  assert.equal(finished.usage.requests, 0);
  const view = await f.reminders.read();
  const byItem = Object.fromEntries(view.items.map(row => [row.itemId, row]));
  assert.equal(view.unreadCount, 5);
  assert.equal(byItem[due.id]?.summary, '今日到期跟进');
  assert.equal(byItem[late.id]?.summary, '跟进已逾期 3 天');
  assert.equal(byItem[stale.id]?.summary, '已 9 天未推进');
  assert.equal(byItem[product.id]?.summary, '有 2 条新资料待分析');
  assert.equal(byItem[first.id]?.summary, '有 1 条新资料待分析');
  assert.equal(byItem[already.id], undefined);
  assert.equal(byItem[closed.id], undefined);
  assert.deepEqual(f.notices.map(n => n.kind), ['due_follow_up', 'due_follow_up', 'summary']);
  assert.deepEqual(f.notices.at(-1), { kind: 'summary', count: 3 });
  assert.deepEqual(await hashes(f.root, ['work-items', 'knowledge/raw']), snapshot);
});

test('WKA-02 quiet hours, durable daily dedupe, snooze, acknowledgement, and 30-day expiry', async t => {
  const f = await fixture(t);
  const due = await f.item('延后事项', { followUpOn: '2026-11-30' });
  const ack = await f.item('已读事项', { followUpOn: '2026-11-30' });
  const stale = await f.item('待推进', { status: 'in_progress' }, '2026-11-08T09:00:00.000Z');
  f.time(Date.parse('2026-11-30T14:00:00.000Z')); // 22:00 inclusive
  await f.run();
  let view = await f.reminders.read();
  assert.equal(view.unreadCount, 3);
  assert(view.items.every(r => r.deliveryStatus === 'suppressed_quiet_hours'));
  assert.equal(f.notices.length, 0);
  assert(isQuietHours(defaultReminderSettings, Date.parse('2026-11-30T23:59:59.999Z')));
  f.time(Date.parse('2026-12-01T00:00:00.000Z')); // 08:00 exclusive
  await f.run();
  view = await f.reminders.read();
  assert(view.items.every(r => r.deliveryStatus === 'delivered'));
  assert.equal(f.notices.length, 3);
  const ids = Object.fromEntries(view.items.map(row => [row.itemId, row.id]));
  await f.reminders.mark(ids[due.id]!, 'snooze', '2026-12-03');
  await f.reminders.mark(ids[ack.id]!, 'ack');
  await f.run();
  assert.equal(f.notices.length, 3);
  f.time(daytime + REMINDER_DAY);
  await f.run();
  view = await f.reminders.read();
  assert.equal(view.items.find(row => row.itemId === due.id)?.status, 'snoozed');
  assert.equal(view.items.find(row => row.itemId === ack.id)?.status, 'acknowledged');
  assert.equal(f.notices.length, 4); // only still unread, now the next Shanghai date
  f.time(daytime + 2 * REMINDER_DAY);
  await f.run();
  view = await f.reminders.read();
  assert.equal(view.items.find(row => row.itemId === due.id)?.status, 'unread');
  assert.equal(view.items.find(row => row.itemId === due.id)?.id, ids[due.id]);
  await f.work.update(due.id, { baseRevision: due.revision, followUpOn: '2026-12-04' });
  const progressed = await f.work.update(stale.id, { baseRevision: stale.revision, nextStep: '本次已处理' });
  await writeFile(f.itemFile(stale.id), JSON.stringify({ ...progressed, updatedAt: iso(daytime + 2 * REMINDER_DAY) }));
  await f.work.update(ack.id, { baseRevision: ack.revision, status: 'closed', closureReason: '已核对' });
  await f.run();
  const resolved = await f.reminders.read(true);
  assert(resolved.items.every(row => row.status === 'resolved'));
  assert.equal((await f.reminders.read()).items.length, 0);
  await f.work.update(due.id, { baseRevision: due.revision + 1, followUpOn: null });
  f.time(daytime + 33 * REMINDER_DAY);
  await f.reminders.updateSettings(resolved.revision, { staleDays: 0 });
  await f.run();
  assert.equal((await f.reminders.read(true)).items.length, 0);
  assert(!isQuietHours({ ...defaultReminderSettings, quietHoursEnd: '22:00' }, Date.parse('2026-11-30T14:00:00.000Z')));
});

test('WKA-02 new Raw set tracks stable IDs across days and scope changes resolve prior reminders', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.raw('A'), f.raw('B')]);
  const saved = await f.work.create({ kind: 'product_analysis', title: '产品事项', goal: 'GOAL_SENTINEL' });
  let product = await f.work.update(saved.id, { baseRevision: saved.revision, rawIds: [a.id, b.id] });
  await f.run();
  const alert = (await f.reminders.read()).items[0]!;
  assert.deepEqual(f.notices, [{ kind: 'new_raw_ready', itemTitle: '产品事项', count: 2 }]);
  product = await f.work.update(saved.id, { baseRevision: product.revision, rawIds: [b.id, a.id] });
  f.time(daytime + REMINDER_DAY);
  await f.run();
  assert.equal((await f.reminders.read()).items[0]?.id, alert.id);
  assert.equal(f.notices.length, 1);
  await f.completed(product, [a]);
  await f.run();
  const changed = (await f.reminders.read()).items[0]!;
  assert.notEqual(changed.id, alert.id);
  assert.equal(changed.summary, '有 1 条新资料待分析');
  assert.equal(f.notices.length, 2);
  await f.completed(product, [a, b], undefined, '2026-12-02T00:00:00.000Z');
  await f.run();
  assert.equal((await f.reminders.read()).items.length, 0);
  assert((await f.reminders.read(true)).items.every(row => row.status === 'resolved'));
});

test('WKA-02 toast cap includes summary, global pause records skipped and disabled notifications remain in the center', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 4 }, (_, n) => f.item('事项 ' + n, { followUpOn: '2026-12-01' })));
  await f.reminders.updateSettings(1, { maxToastsPerRun: 1, desktopNotificationsEnabled: false });
  await f.run();
  assert.equal((await f.reminders.read()).unreadCount, 4);
  assert((await f.reminders.read()).items.every(row => row.deliveryStatus === 'suppressed_disabled'));
  assert.equal(f.notices.length, 0);
  await f.scheduler.setPaused(true);
  await f.reminders.updateSettings(2, { desktopNotificationsEnabled: true });
  assert.equal((await f.run()).status, 'skipped');
  assert.equal(f.notices.length, 0);
  await f.scheduler.setPaused(false);
  await f.run();
  assert.deepEqual(f.notices, [{ kind: 'summary', count: 4 }]);
  assert((await f.reminders.read()).items.every(row => row.deliveryStatus === 'delivered'));
  await f.run();
  assert.equal(f.notices.length, 1);
});

test('WKA-03 aborts or fails a notifier safely after reserving the attempt and sends only escaped permitted content', async t => {
  const f = await fixture(t);
  const special = await f.item('<客户 A & B> "方案"', { followUpOn: '2026-12-01' });
  await f.work.update(special.id, { baseRevision: 2, history: { kind: 'technical_reply', body: 'CUSTOMER_COMMUNICATION_SENTINEL' } });
  await f.item('另一项', { followUpOn: '2026-12-01' });
  const outcomes: string[] = [];
  f.notifier(async (notice, signal) => {
    const persisted = JSON.parse(await readFile(f.reminderFile, 'utf8'));
    assert.equal(persisted.items.length, 2);
    assert(persisted.items.some((row: { desktopAttemptedAt?: string }) => row.desktopAttemptedAt));
    const text = JSON.stringify(notice);
    for (const secret of ['CUSTOMER_FEEDBACK_SENTINEL', 'CUSTOMER_COMMUNICATION_SENTINEL', 'RAW_BODY_SENTINEL', 'API_KEY_SENTINEL']) {
      assert(!text.includes(secret));
    }
    if (!outcomes.length) { outcomes.push('throws'); throw new Error('API_KEY_SENTINEL'); }
    outcomes.push('waits');
    return new Promise(resolve => signal.addEventListener('abort', () => resolve({ deliveryStatus: 'delivered' }), { once: true }));
  });
  const result = await f.run();
  assert.equal(result.status, 'succeeded');
  assert.equal(outcomes.length, 2);
  const view = await f.reminders.read();
  for (const row of view.items) assert.equal(row.deliveryStatus, 'failed');
  assert(view.items.some(row => row.deliveryError === '桌面通知超时。'));
  assert(!(await readFile(f.reminderFile, 'utf8')).includes('API_KEY_SENTINEL'));
  await f.run();
  assert.equal(f.notices.length, 2);
  const escaped = desktopToastXml({ kind: 'due_follow_up', itemTitle: special.title });
  assert.match(escaped, /&lt;客户 A &amp; B&gt; &quot;方案&quot;/u);
  assert(!desktopToastXml({ kind: 'stale_item', itemTitle: '字'.repeat(120) + 'TRAILING' }).includes('TRAILING'));
  assert.equal((await sendDesktopNotice(createDesktopNotifier('linux'), { kind: 'test' })).deliveryStatus, 'suppressed_non_windows');
  for (const env of [{ CI: 'true' }, { NODE_ENV: 'test' }, { NODE_TEST_CONTEXT: 'child-v8' }]) {
    assert.equal((await sendDesktopNotice(createDesktopNotifier('win32', env), { kind: 'test' })).deliveryStatus, 'suppressed_non_windows');
  }
});

test('WKA-03 a persisted notification claim interrupted before completion does not resend in the same window', async t => {
  const f = await fixture(t);
  await f.item('待确认已投递事项', { followUpOn: '2026-12-01' });
  await f.run();
  const state = JSON.parse(await readFile(f.reminderFile, 'utf8'));
  state.items[0].deliveryStatus = 'pending';
  delete state.items[0].desktopNotifiedAt;
  await writeFile(f.reminderFile, JSON.stringify(state));
  const result = await f.run();
  assert.equal(result.status, 'succeeded');
  assert.equal(f.notices.length, 1);
  const [record] = (await f.reminders.read()).items;
  assert.equal(record?.deliveryStatus, 'failed');
  assert.match(record!.deliveryError!, /结果未确认/u);
});

test('WKA-04 corrupted item and analysis are isolated and backup restores exact reminders', async t => {
  const f = await fixture(t);
  const corrupt = await f.item('会损坏的事项', { followUpOn: '2026-12-01' });
  const other = await f.item('正常事项', { followUpOn: '2026-12-01' });
  const raw = await f.raw('关联资料');
  const saved = await f.work.create({ kind: 'product_analysis', title: '会损坏分析依据', goal: 'GOAL_SENTINEL' });
  const product = await f.work.update(saved.id, { baseRevision: 1, rawIds: [raw.id] });
  await f.run();
  await writeFile(f.itemFile(corrupt.id), '{broken');
  const runFile = await f.completed(product, [raw]);
  const runBytes = await readFile(runFile);
  await writeFile(runFile, '{broken');
  const result = await f.run();
  assert.equal(result.status, 'succeeded');
  assert.match(result.steps[0]!.summary, /读取问题 2 项/u);
  const view = await f.reminders.read();
  assert.equal(view.issues.length, 2);
  assert(view.items.some(item => item.itemId === corrupt.id && item.status !== 'resolved'));
  assert(view.items.some(item => item.itemId === product.id && item.status !== 'resolved'));
  assert(view.items.some(item => item.itemId === other.id && item.status !== 'resolved'));
  assert.equal(await readFile(f.itemFile(corrupt.id), 'utf8'), '{broken');
  await writeFile(f.itemFile(corrupt.id), JSON.stringify(corrupt));
  await writeFile(runFile, runBytes);
  await f.run();
  assert.equal((await f.reminders.read()).issues.length, 0);
  assert((await f.reminders.read(true)).items.some(item => item.itemId === product.id && item.status === 'resolved'));
  const backup = path.join(f.temp, 'backup.json');
  const restored = path.join(f.temp, 'restored');
  await exportWorkspace(f.root, backup);
  await restoreWorkspace(backup, restored);
  const relative = path.relative(f.root, f.reminderFile);
  assert.deepEqual(await readFile(path.join(restored, relative)), await readFile(f.reminderFile));
});

test('WKA-04 HTTP reminder routes guard writes and settings revision and test only fixed content', async t => {
  const f = await fixture(t);
  await f.item('请求测试事项', { followUpOn: '2026-12-01' });
  await f.run();
  const app = express();
  registerAutomationRoutes(app, f.scheduler, undefined, undefined, f.reminders);
  app.use((error: { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ code: error.code });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api/automation/reminders';
  const headers = { 'Content-Type': 'application/json', 'x-fmcg-automation-token': f.scheduler.status().writeToken };
  const post = (route: string, data: unknown) => fetch(base + route, { headers, method: 'POST', body: JSON.stringify(data) });
  const patch = (data: unknown) => fetch(base + '/settings', { headers, method: 'PATCH', body: JSON.stringify(data) });
  const start = await (await fetch(base + '?status=active')).json();
  const id = start.items[0].id;
  assert.equal((await fetch(base + '?status=bad')).status, 400);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  assert.equal((await fetch(base + '/test-notification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await patch({ revision: 1, quietHoursStart: '24:00' })).status, 400);
  const competing = await Promise.all([patch({ revision: 1, maxToastsPerRun: 2 }), patch({ revision: 1, staleDays: 9 })]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  assert.equal((await post('/' + id + '/snooze', { until: '2026-12-01' })).status, 400);
  assert.equal((await post('/' + id + '/snooze', {})).status, 200);
  assert.equal((await f.reminders.read()).items[0]?.snoozedUntil, '2026-12-02');
  assert.equal((await post('/' + id + '/ack', {})).status, 200);
  assert.equal((await f.reminders.read()).unreadCount, 0);
  assert.equal((await post('/test-notification', { itemTitle: 'arbitrary' })).status, 400);
  assert.deepEqual(await (await post('/test-notification', {})).json(), { deliveryStatus: 'delivered' });
  assert.deepEqual(f.notices.at(-1), { kind: 'test' });
});
