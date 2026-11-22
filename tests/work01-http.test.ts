import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import type { WorkItem, WorkItemSummary } from '../services/work-items/types.ts';
import { WorkItemStore } from '../services/work-items/store.ts';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';

const cache = path.resolve('node_modules/.cache/work01-builder');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkZsAAAAASUVORK5CYII=',
  'base64',
);
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwB//9k=',
  'base64',
);
const pngAtLimit = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)),
);

async function isolatedDirectory() {
  await mkdir(cache, { recursive: true });
  return mkdtemp(path.join(cache, 'http-'));
}

async function startApi(t: TestContext, dataRoot: string, config: string, faultFile?: string) {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const faultHook = `import fs from 'node:fs/promises';
    import { existsSync, readFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import path from 'node:path';
    const rename = fs.rename;
    fs.rename = (from, to) => {
      const flag = process.env.WORK01_FAULT_FILE;
      if (path.dirname(to) === path.join(process.env.FMCG_DATA_DIR, 'work-items') && existsSync(flag)
        && path.basename(to) === readFileSync(flag, 'utf8') + '.json') {
        return Promise.reject(Object.assign(new Error('WORK01 isolated write fault'), { code: 'EIO' }));
      }
      return rename(from, to);
    };
    syncBuiltinESMExports();`;
  const args = ['--import', 'tsx'];
  if (faultFile) args.push('--import', `data:text/javascript,${encodeURIComponent(faultHook)}`);
  const proc = spawn(process.execPath, [...args, 'server/index.ts'], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...cleanEnv,
      FMCG_DATA_DIR: dataRoot,
      FMCG_PORT: String(port),
      FMCG_LLM_CONFIG_FILE: config,
      WORK01_FAULT_FILE: faultFile ?? '',
    },
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exited = once(proc, 'exit');
  const stop = async () => {
    if (proc.exitCode === null && !proc.killed) proc.kill();
    await exited;
  };
  t.after(stop);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) assert.fail(stderr || 'Isolated API stopped before readiness');
    if (
      await fetch(`${base}/api/health`).then(
        (response) => response.ok,
        () => false,
      )
    )
      return { base, stop };
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return assert.fail(`Isolated API did not start: ${stderr}`);
}

function client(base: string) {
  return async <T>(route: string, method = 'GET', body?: unknown, expected = 200) => {
    const multipart = body instanceof FormData;
    const response = await fetch(`${base}${route}`, {
      method,
      body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined || multipart ? undefined : { 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${route}: ${text}`);
    return JSON.parse(text) as T;
  };
}

function attachment(revision: number, bytes: Buffer, type: string, note = '') {
  const form = new FormData();
  form.set('baseRevision', String(revision));
  form.set('file', new Blob([Uint8Array.from(bytes)], { type }), 'untrusted-client-name');
  form.set('note', note);
  return form;
}

test('WORK01 actual HTTP preserves manual history, revision, local screenshots and v1 restore', async (t) => {
  const base = await isolatedDirectory();
  const data = path.join(base, 'source');
  const config = path.join(base, 'empty.env');
  const fault = path.join(base, 'fail-work-record');
  await writeFile(config, '');
  const running = await startApi(t, data, config, fault);
  const request = client(running.base);
  const route = '/api/work-items';
  assert.deepEqual(await request(route), { items: [] });
  for (const invalid of [{ title: '缺反馈' }, { feedback: '缺标题' }, { title: ' ', feedback: '空标题' }]) {
    await request(route, 'POST', invalid, 400);
  }
  const raw = await request<{ id: string }>(
    '/api/raw',
    'POST',
    { title: '合成反馈材料', sourceType: 'customer', sourceName: 'WORK01 测试', body: '原始材料只供阅读。', tags: [] },
    201,
  );
  const rawRoute = `/api/raw/${raw.id}`;
  const rawBefore = await request(rawRoute);
  const stateBefore = await request('/api/raw-processing');
  const oldArchive = path.join(base, 'before-work-items.json');
  await exportWorkspace(data, oldArchive);

  const created = await request<WorkItem>(
    route,
    'POST',
    { title: '合成客户问题', feedback: '客户原话\n第二行。' },
    201,
  );
  const itemRoute = `${route}/${created.id}`;
  let item = created;
  const update = async (patch: Record<string, unknown>) => {
    item = await request(itemRoute, 'PUT', { baseRevision: item.revision, ...patch });
  };
  assert.equal(created.status, 'triage');
  await request(itemRoute, 'PUT', { baseRevision: 1, followUpOn: '2026-02-29' }, 400);
  await request(itemRoute, 'PUT', { baseRevision: 1, occurredAt: '2026-02-29T14:00:00+08:00' }, 400);
  await request(itemRoute, 'PUT', { baseRevision: 1, status: 'closed' }, 400);
  assert.deepEqual(await request(itemRoute), created);
  await update({
    status: 'waiting',
    customer: '合成客户',
    project: '合成项目',
    occurredAt: '2026-11-06T10:15:23+08:00',
    waitingFor: '客户截图',
    nextStep: '收齐后复现',
  });
  assert.equal(item.occurredAt, '2026-11-06T02:15:23.000Z');
  assert.equal(item.followUpOn, undefined);
  assert.equal(item.customer, '合成客户');
  await request(itemRoute, 'PUT', { baseRevision: 1, nextStep: '旧改动' }, 409);
  await update({
    customer: '',
    project: null,
    occurredAt: '',
    status: 'in_progress',
    followUpOn: '2000-01-01',
    rawIds: [raw.id, raw.id],
  });
  assert.deepEqual(item.rawIds, [raw.id]);
  assert.equal(item.customer, undefined);
  assert.equal(item.project, undefined);
  assert.equal(item.occurredAt, undefined);
  await update({ reportDraft: '待发送正文' });
  assert.equal(item.history.length, 0);
  for (const history of [
    { kind: 'feedback', body: '追加反馈' },
    { kind: 'reproduction', body: '复现步骤' },
    { kind: 'sent', body: '实际反馈', sentAt: '2026-11-06T10:20:00+08:00' },
    { kind: 'technical_reply', body: '技术回复' },
  ])
    await update({ history });
  assert.equal(
    item.history.some((entry) => entry.kind === 'retest'),
    false,
  );
  await update({ history: { kind: 'retest', body: '第二轮仍能复现', outcome: 'failed' } });
  await update({ history: { kind: 'retest', body: '第三轮恢复', outcome: 'passed' } });
  await update({ status: 'closed', closureReason: '客户确认恢复。' });
  assert.deepEqual(await request(`${route}?due=1`), { items: [] });
  await request(itemRoute, 'PUT', { baseRevision: item.revision, status: 'retest' }, 400);
  await update({ reopen: true });
  assert.equal(item.status, 'triage');
  assert.deepEqual(
    item.history.map((entry) => entry.kind),
    ['feedback', 'reproduction', 'sent', 'technical_reply', 'retest', 'retest', 'closed', 'reopened'],
  );
  assert.equal((await request<{ items: WorkItemSummary[] }>(`${route}?due=1`)).items[0].id, created.id);

  const images = `${itemRoute}/screenshots`;
  await request(images, 'POST', attachment(item.revision, png, 'image/jpeg'), 400);
  await request(images, 'POST', attachment(item.revision, Buffer.alloc(0), 'image/png'), 400);
  await request(images, 'POST', attachment(item.revision, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'), 413);
  await request(images, 'POST', attachment(item.revision - 1, png, 'image/png'), 409);
  assert.deepEqual(await request(itemRoute), item);
  item = await request(images, 'POST', attachment(item.revision, png, 'image/png', '人工截图说明'), 201);
  item = await request(images, 'POST', attachment(item.revision, jpeg, 'image/jpeg'), 201);
  item = await request(images, 'POST', attachment(item.revision, pngAtLimit, 'image/png'), 201);
  const other = await request<WorkItem>(route, 'POST', { title: '合成第二条问题', feedback: '另一个事项。' }, 201);
  await request(`${route}/${other.id}/screenshots/${item.screenshots[0].id}`, 'GET', undefined, 404);
  for (const [index, expected] of [png, jpeg, pngAtLimit].entries()) {
    const response = await fetch(`${running.base}${images}/${item.screenshots[index].id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), item.screenshots[index].type);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  }

  const recordPath = path.join(data, 'work-items', `${item.id}.json`);
  const diskBeforeFault = await readFile(recordPath);
  await writeFile(fault, item.id);
  await request(itemRoute, 'PUT', { baseRevision: item.revision, nextStep: '模拟保存失败' }, 500);
  await request(images, 'POST', attachment(item.revision, png, 'image/png'), 500);
  await rm(fault);
  assert.deepEqual(await readFile(recordPath), diskBeforeFault);
  assert.equal((await readdir(path.join(data, 'work-items', 'screenshots', item.id))).length, 3);
  assert.deepEqual(await request(itemRoute), item);
  assert.deepEqual(await request(rawRoute), rawBefore);
  assert.deepEqual(await request('/api/raw-processing'), stateBefore);

  const archive = path.join(base, 'work-items-v1.json');
  const restored = path.join(base, 'restored');
  await running.stop();
  await exportWorkspace(data, archive);
  await restoreWorkspace(archive, restored);
  const restarted = await startApi(t, restored, config);
  const restoredRequest = client(restarted.base);
  assert.deepEqual(await restoredRequest(itemRoute), item);
  assert.deepEqual(await restoredRequest(rawRoute), rawBefore);
  for (const [index, expected] of [png, jpeg, pngAtLimit].entries()) {
    const image = await fetch(`${restarted.base}${images}/${item.screenshots[index].id}`);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), expected);
  }
  await restarted.stop();

  const legacy = path.join(base, 'legacy');
  await restoreWorkspace(oldArchive, legacy);
  const legacyApi = await startApi(t, legacy, config);
  assert.deepEqual(await client(legacyApi.base)(route), { items: [] });
  assert.deepEqual(await client(legacyApi.base)(rawRoute), rawBefore);
});

test('WORK01 Shanghai midnight, clearing and corrupted records preserve the correct list result', async () => {
  const root = await isolatedDirectory();
  const store = new WorkItemStore(root, { get: async () => undefined });
  const a = await store.create({ title: '午夜用例', feedback: '合成反馈' });
  const b = await store.create({ title: '次日事项', feedback: '合成反馈' });
  await store.update(a.id, { baseRevision: 1, followUpOn: '2026-11-07' });
  await store.update(b.id, { baseRevision: 1, followUpOn: '2026-11-08' });
  assert.deepEqual(await store.list(true, new Date('2026-11-06T15:59:59.999Z')), []);
  assert.deepEqual(
    (await store.list(true, new Date('2026-11-06T16:00:00.000Z'))).map((item) => item.id),
    [a.id],
  );
  await store.update(a.id, { baseRevision: 2, followUpOn: null });
  assert.deepEqual(await store.list(true, new Date('2026-11-06T16:00:00.000Z')), []);
  const bad = path.join(root, 'work-items', `${a.id}.json`);
  await writeFile(bad, '{ invalid json');
  await assert.rejects(store.list(true), /本机记录损坏/);
  assert.equal(await readFile(bad, 'utf8'), '{ invalid json');
});
