import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AutomationRun, AutomationSchedule, AutomationStatus } from '../services/automation/types.ts';

async function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await sleep(25);
  }
  assert.fail('Timed out waiting for ' + label);
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'run01-api-'));
  const config = path.join(root, 'empty-provider.env');
  await writeFile(config, '', 'utf8');
  const cleanup: Array<() => Promise<void>> = [];
  t.after(async () => {
    for (const stop of cleanup.reverse()) await stop();
    await rm(root, { recursive: true, force: true });
  });
  return { root, spawn: (args: string[], isolatedEnv: NodeJS.ProcessEnv) => {
    const env: NodeJS.ProcessEnv = { ...process.env, FMCG_DATA_DIR: root, FMCG_LLM_CONFIG_FILE: config, ...isolatedEnv };
    for (const key of ['NODE_TEST_CONTEXT', 'FMCG_NEWS_AI_ENABLED', 'FMCG_LLM_BASE_URL', 'FMCG_LLM_MODEL', 'FMCG_LLM_API_KEY']) delete env[key];
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { env, windowsHide: true, stdio: 'pipe' });
    let output = '';
    let stopped = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => { stopped = true; resolve(code); });
    });
    const stop = async () => { if (!stopped) child.kill('SIGKILL'); await closed; };
    cleanup.push(stop);
    return { child, closed, stop, output: () => output, stopped: () => stopped };
  } };
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as net.AddressInfo;
  await new Promise<void>(resolve => { server.close(() => resolve()); });
  return address.port;
}

function request(port: number, route: string, method = 'GET', headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, response => {
      let text = '';
      response.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });
      response.on('end', () => {
        try {
          const data = response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text;
          resolve({ status: response.statusCode!, data });
        }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Isolated HTTP request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

test('RUN01 real development server preserves local guards, revision edits and no-model selfcheck', async t => {
  const env = await fixture(t);
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const explicitOrigin = 'http://localhost:41819';
  const app = env.spawn(['server/index.ts'], { FMCG_PORT: String(port), FMCG_UI_ORIGIN: explicitOrigin });
  await waitFor(async () => {
    if (app.stopped()) assert.fail(app.output());
    return await request(port, '/api/health').then(res => res.data.ok === true ? true : undefined, () => undefined);
  }, 'the isolated development server');
  const statusRoute = '/api/automation/status';
  assert.equal((await request(port, statusRoute, 'GET', { Host: 'invalid.example:' + port })).status, 403);
  assert.equal((await request(port, statusRoute, 'GET', { Origin: 'null' })).status, 403);
  assert.equal((await request(port, statusRoute, 'GET', { Origin: 'http://invalid.example' })).status, 403);
  assert.equal((await request(port, statusRoute, 'GET', { 'Sec-Fetch-Site': 'cross-site', Origin: origin })).status, 403);
  assert.equal((await request(port, statusRoute, 'GET', { Origin: explicitOrigin })).status, 200);
  assert.equal((await request(port, statusRoute, 'GET', { Origin: 'http://127.0.0.1:5173' })).status, 200);
  const snapshot = await request(port, statusRoute, 'GET', { Origin: origin });
  assert.equal(snapshot.status, 200);
  const status: AutomationStatus = snapshot.data;
  assert.equal(status.instance.mode, 'development');
  assert.equal(status.instance.pid, app.child.pid);
  assert.equal(status.instance.port, port);
  assert.equal(status.scheduler.healthy, true);
  assert.equal(typeof status.writeToken, 'string');
  const conf = await request(port, '/api/llm/config', 'GET', { Origin: origin });
  assert.equal(conf.status, 200);
  assert.equal(conf.data.configured, false);
  assert.notEqual(conf.data.writeToken, status.writeToken);
  assert.equal((await request(port, '/api/llm/config', 'PUT', { Origin: origin, 'Content-Type': 'application/json', 'x-fmcg-config-token': status.writeToken }, '{}')).status, 403);
  const route = '/api/automation/pause';
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'x-fmcg-automation-token': status.writeToken };
  assert.equal((await request(port, route, 'POST', { ...headers, Host: 'not.local:' + port }, '{')).status, 403);
  assert.equal((await request(port, route, 'POST', { ...headers, Origin: 'http://elsewhere.invalid' }, '{')).status, 403);
  assert.equal((await request(port, route, 'POST', { ...headers, 'Content-Type': 'text/plain' }, '{}')).status, 415);
  assert.equal((await request(port, route, 'POST', { ...headers, 'x-fmcg-automation-token': conf.data.writeToken }, '{}')).status, 403);
  assert.equal((await request(port, route, 'POST', headers, JSON.stringify({ confirm: false }))).status, 400);
  assert.equal((await request(port, route, 'POST', headers, JSON.stringify({ confirm: true }))).data.paused, true);
  const schedules = await request(port, '/api/automation/schedules');
  const [task]: AutomationSchedule[] = schedules.data.items;
  assert.equal(task?.type, 'system.selfcheck');
  assert.deepEqual(task.plan, { kind: 'interval', minutes: 60 });
  assert.equal(task.mayCallModel, false);
  assert.equal(task.budget, null);
  const edit = '/api/automation/schedules/' + task.type;
  const editBody = JSON.stringify({ revision: task.revision, plan: { kind: 'interval', minutes: 2 } });
  const revisions = await Promise.all([request(port, edit, 'PATCH', headers, editBody), request(port, edit, 'PATCH', headers, editBody)]);
  assert.deepEqual(revisions.map(result => result.status).sort(), [200, 409]);
  assert.equal((await request(port, edit, 'PATCH', headers, JSON.stringify({ revision: task.revision + 1, plan: { kind: 'daily', time: '24:00', timezone: 'Asia/Shanghai' } }))).status, 400);
  const manual = '/api/automation/tasks/' + task.type + '/run';
  const paused = await request(port, manual, 'POST', headers, '{}');
  assert.equal(paused.status, 202);
  assert.equal(paused.data.error, 'paused');
  assert.equal((await request(port, '/api/automation/resume', 'POST', headers, JSON.stringify({ confirm: true }))).data.paused, false);
  const accepted = await request(port, manual, 'POST', headers, '{}');
  assert.equal(accepted.status, 202);
  const runRoute = '/api/automation/runs/' + accepted.data.id;
  const final = await waitFor<AutomationRun>(async () => {
    const { data } = await request(port, runRoute);
    return data.endedAt ? data as AutomationRun : undefined;
  }, 'the no-model selfcheck');
  assert.equal(final.status, 'succeeded', JSON.stringify(final.steps));
  assert.equal(final.steps.length, 5);
  assert.match(final.steps[3]!.summary, /尚未配置/u);
  assert.deepEqual(final.usage, { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 });
  assert.deepEqual(final.artifacts, { rawIds: [], jobIds: [], draftIds: [] });
  assert.equal((await request(port, '/api/automation/runs?status=succeeded&limit=1')).data.items[0].id, final.id);
  assert.deepEqual((await request(port, runRoute + '/cancel', 'POST', headers, '{}')).data, final);
  assert.equal((await request(port, '/api/automation/runs?status=bogus')).status, 400);
  assert.equal((await request(port, '/api/automation/runs/23ee6837-ef24-4fcf-831b-4ae17f6f38d1')).status, 404);
});

test('RUN01 production SPA fallback works from a checkout with a hidden parent directory', async t => {
  const env = await fixture(t);
  const checkout = path.join(env.root, '.hidden-worktree', 'checkout');
  const dist = path.join(checkout, 'dist');
  await mkdir(dist, { recursive: true });
  await cp('server', path.join(checkout, 'server'), { recursive: true });
  await cp('package.json', path.join(checkout, 'package.json'));
  for (const dir of ['node_modules', 'rules', 'services']) await symlink(path.resolve(dir), path.join(checkout, dir), 'junction');
  const html = '<html><body>RUN01 production fixture</body></html>';
  await writeFile(path.join(dist, 'index.html'), html, 'utf8');
  const port = await freePort();
  const app = env.spawn([path.join(checkout, 'server', 'index.ts'), '--production'], { FMCG_PORT: String(port), FMCG_UI_ORIGIN: '' });
  await waitFor(async () => {
    if (app.stopped()) assert.fail(app.output());
    return await request(port, '/api/health').then(res => res.data.ok === true ? true : undefined, () => undefined);
  }, 'the hidden-path production server');
  assert.deepEqual(await request(port, '/'), { status: 200, data: html });
  assert.deepEqual(await request(port, '/automation/deep/link'), { status: 200, data: html });
  assert.equal((await request(port, '/api/automation/status')).data.instance.mode, 'production');
  assert.deepEqual(await request(port, '/api/no-such-route'), { status: 404, data: { error: { code: 'NOT_FOUND', message: '没有找到这个 API。' } } });
});

test('RUN01 separate processes reject a live root and allow just one concurrent stale-lock takeover', async t => {
  const env = await fixture(t);
  const script = [
    "import { acquireInstanceLock } from './services/automation/instance-lock.ts';",
    'const lock = await acquireInstanceLock(process.env.FMCG_DATA_DIR, Number(process.env.FMCG_PORT), process.env.RUN01_MODE);',
    "process.once('exit', lock.releaseMetadata);",
    "process.stdin.once('data', () => { lock.close(); process.stdin.destroy(); });",
    "console.log('RUN01_ACQUIRED');",
  ].join('\n');
  const create = (mode: string, port: number, dataRoot = env.root) => env.spawn(['--input-type=module', '-e', script], { RUN01_MODE: mode, FMCG_PORT: String(port), FMCG_DATA_DIR: dataRoot });
  const ready = (process: ReturnType<typeof create>) => waitFor(() => {
    if (process.stopped() && !process.output().includes('RUN01_ACQUIRED')) assert.fail(process.output());
    return process.output().includes('RUN01_ACQUIRED') ? true : undefined;
  }, 'lock probe readiness');
  const owner = create('production', 41021);
  await ready(owner);
  const lockFile = path.join(env.root, 'state', 'runtime', 'instance.lock');
  const liveBytes = await readFile(lockFile);
  const denied = create('development', 41022);
  assert.notEqual(await denied.closed, 0);
  assert.match(denied.output(), /RUNTIME_INSTANCE_IN_USE.*41021.*production/u);
  assert.deepEqual(await readFile(lockFile), liveBytes);

  const separate = create('development', 41023, path.join(env.root, 'separate-root'));
  await ready(separate);
  separate.child.stdin.end('stop');
  assert.equal(await separate.closed, 0);
  await assert.rejects(readFile(path.join(env.root, 'separate-root', 'state', 'runtime', 'instance.lock')), { code: 'ENOENT' });

  await owner.stop();
  assert.deepEqual(await readFile(lockFile), liveBytes);
  const a = create('development', 41024);
  const b = create('production', 41025);
  const contenders = [a, b];
  const outcome = await waitFor<typeof contenders>(() => {
    if (!contenders.every(process => process.stopped() || process.output().includes('RUN01_ACQUIRED'))) return undefined;
    return contenders.filter(process => process.output().includes('RUN01_ACQUIRED'));
  }, 'the concurrent stale-lock takeover');
  assert.equal(outcome.length, 1, contenders.map(process => process.output()).join('\n'));
  const [winner] = outcome;
  const loser = contenders.find(process => process !== winner)!;
  const persisted = JSON.parse(await readFile(lockFile, 'utf8'));
  assert.equal(persisted.pid, winner!.child.pid);
  assert.match(winner!.output(), /已接管退出进程/u);
  assert.match(loser.output(), new RegExp('RUNTIME_INSTANCE_IN_USE.*' + persisted.port + '.*' + persisted.mode, 'u'));
  winner!.child.stdin.end('stop');
  assert.equal(await winner!.closed, 0);
  await assert.rejects(readFile(lockFile), { code: 'ENOENT' });

  await writeFile(lockFile, '{invalid-lock', 'utf8');
  const corrupt = create('development', 41026);
  assert.notEqual(await corrupt.closed, 0);
  assert.match(corrupt.output(), /RUNTIME_LOCK_UNREADABLE/u);
  assert.equal(await readFile(lockFile, 'utf8'), '{invalid-lock');
});
