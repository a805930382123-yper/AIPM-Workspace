// Independent B01 acceptance. Public HTTP + persisted files; no product internals imported.
// Run after a frozen handoff: node tests/acceptance/b01-http.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, mkdir, rename, writeFile, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidencePath = path.join(root, 'docs/reports/B01-api-evidence.json');
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'fmcg-b01-acceptance-'));
const report = { startedAt: new Date().toISOString(), dataRoot, evidencePath, version: {}, checks: [], notes: ['API/file evidence only; browser evidence supplied independently by main agent.', 'Temporary fixture directories retained for inspection; no user data changed.'] };
const fingerprintPaths = ['package.json', 'package-lock.json', 'server/index.ts', 'server/validation.ts', 'services/raw/store.ts', 'services/stats/index.ts'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
for (const rel of fingerprintPaths) {
  try { report.version[rel] = hash(await readFile(path.join(root, rel))); }
  catch { report.version[rel] = 'MISSING'; }
}
let service;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function runCheck(id, fn) {
  const started = Date.now();
  try { const evidence = await fn(); report.checks.push({ id, status: 'PASS', elapsedMs: Date.now() - started, evidence }); console.log(`PASS ${id}`); }
  catch (error) { report.checks.push({ id, status: 'FAIL', elapsedMs: Date.now() - started, error: String(error.stack || error).slice(0, 4000) }); console.log(`FAIL ${id}: ${error.message}`); }
}
async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function start(dir) {
  const port = await allocatePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root, env: { ...process.env, FMCG_DATA_DIR: dir, FMCG_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const result = { child, base: `http://127.0.0.1:${port}`, logs: '', dir };
  child.stdout.on('data', chunk => { result.logs += chunk.toString(); });
  child.stderr.on('data', chunk => { result.logs += chunk.toString(); });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  for (let i = 0; i < 100; i++) {
    if (spawnError || child.exitCode !== null) throw new Error(`Server failed to start: ${spawnError || result.logs}`);
    try { const response = await fetch(`${result.base}/api/health`, { signal: AbortSignal.timeout(500) }); if (response.ok && (await response.json()).ok === true) return result; } catch {}
    await delay(100);
  }
  child.kill();
  throw new Error(`Server readiness timeout: ${result.logs}`);
}
async function stop() {
  if (!service) return;
  const current = service;
  service = undefined;
  if (current.child.exitCode === null) {
    const done = once(current.child, 'exit');
    current.child.kill();
    await Promise.race([done, delay(5000).then(() => { if (current.child.exitCode === null) throw new Error('Server did not stop'); })]);
  }
}
async function request(url, options = {}) {
  const response = await fetch(`${service.base}${url}`, { ...options, signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${url} returned non-JSON status ${response.status}`); }
  return { status: response.status, json };
}
const input = (sourceType = 'note', body = '验收资料：中文原始正文。') => ({ title: '验收资料', sourceType, sourceName: '独立验收', author: '验收人员', publishedAt: '2026-09-27', url: 'https://example.com/acceptance', tags: ['验收资料', '中文'], body });
const post = (value) => request('/api/raw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
async function list() { const response = await request('/api/raw'); assert.equal(response.status, 200); assert.ok(Array.isArray(response.json.items)); return response.json.items; }
async function diskFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await diskFiles(full)); else files.push(full);
  }
  return files;
}
function parseRaw(text) {
  assert.ok(text.startsWith('---\n') || text.startsWith('---\r\n'));
  const firstLineEnd = text.indexOf('\n') + 1;
  const rest = text.slice(firstLineEnd);
  const close = /^---\r?\n/m.exec(rest);
  assert.ok(close, 'Raw frontmatter needs a closing delimiter');
  return { metadata: yaml.load(rest.slice(0, close.index)), body: rest.slice(close.index + close[0].length) };
}
const folderMap = { wechat: 'articles', article: 'articles', report: 'reports', company: 'company', customer: 'customer', meeting: 'meetings', note: 'notes', other: 'other' };
let longRecord;
let initialFileHashes;

try {
  await runCheck('B01-01-init-health-empty-stats', async () => {
    const dir = path.join(dataRoot, 'main');
    service = await start(dir);
    const items = await list();
    assert.equal(items.length, 0);
    for (const folder of new Set(Object.values(folderMap))) assert.ok((await stat(path.join(dir, 'knowledge/raw', folder))).isDirectory());
    const stats = await request('/api/stats');
    assert.equal(stats.status, 200);
    for (const field of ['rawCount', 'wikiCount', 'thisWeekNewCount', 'pendingConfirmationCount', 'openAuditCount', 'promptCount']) assert.equal(stats.json[field], 0, field);
    return { base: service.base, initializedAt: dir, stats: stats.json };
  });
  if (!service) throw new Error('Prerequisite server startup failed; remaining HTTP cases cannot run');

  await runCheck('B01-02-100k-exact-body-frontmatter', async () => {
    const prefix = ' \r\n验收资料\r\n---\nstatus: resolved\nbody: 不得当作元数据\n中文标点“原文”，emoji😀\r\n';
    const suffix = '\r\n---\n \t\r\n';
    const body = prefix + '正文中文甲乙丙丁'.repeat(20000).slice(0, 100000 - prefix.length - suffix.length) + suffix;
    assert.equal(body.length, 100000);
    const value = input('note', body);
    value.title = '../验收资料\\C:\\outside\\<script>\n标题';
    value.path = '../../must-not-write.md';
    const response = await post(value);
    assert.equal(response.status, 201);
    longRecord = response.json;
    assert.match(longRecord.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(longRecord.body, body);
    const read = await request(`/api/raw/${longRecord.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.json.body, body);
    assert.equal(read.json.status, 'unprocessed');
    assert.equal(read.json.bodySha256, hash(body));
    const file = path.join(service.dir, 'knowledge/raw/notes', `${longRecord.id}.md`);
    const stored = parseRaw(await readFile(file, 'utf8'));
    assert.equal(stored.body, body);
    assert.equal(stored.metadata.title, value.title);
    assert.equal(stored.metadata.bodySha256, hash(body));
    assert.deepEqual(stored.metadata.tags, value.tags);
    assert.ok(!Object.hasOwn(stored.metadata, 'path'));
    return { id: longRecord.id, file, bodyChars: body.length, bodyBytes: Buffer.byteLength(body), bodySha256: hash(body), importedAt: read.json.importedAt, exactEqual: true };
  });
  await runCheck('B01-03-eight-source-directories-metadata', async () => {
    const records = [];
    for (const [type, folder] of Object.entries(folderMap)) {
      const response = await post({ ...input(type), title: `验收资料-${type}`, author: '', publishedAt: '', url: '' });
      assert.equal(response.status, 201, type);
      const file = path.join(service.dir, 'knowledge/raw', folder, `${response.json.id}.md`);
      const parsed = parseRaw(await readFile(file, 'utf8'));
      assert.equal(parsed.body, input(type).body);
      assert.equal(parsed.metadata.sourceType, type);
      assert.equal(parsed.metadata.sourceName, '独立验收');
      records.push({ sourceType: type, folder, id: response.json.id });
    }
    return { records, listCount: (await list()).length };
  });
  await runCheck('B01-04-invalid-input-no-files', async () => {
    const before = (await diskFiles(service.dir)).sort();
    const baseline = (await list()).length;
    const cases = [['empty-title', { title: '' }], ['blank-title', { title: ' \n ' }], ['empty-body', { body: '' }], ['blank-body', { body: '\r\n \t' }], ['invalid-type', { sourceType: '../outside' }], ['invalid-url', { url: 'javascript:alert(1)' }], ['invalid-tags', { tags: '中文' }], ['body-limit', { body: '甲'.repeat(500001) }]];
    const errors = [];
    for (const [name, changes] of cases) {
      const response = await post({ ...input(), ...changes });
      assert.ok(response.status >= 400 && response.status < 500, name);
      assert.equal(typeof response.json.error?.code, 'string', name);
      assert.ok(response.json.error.message, name);
      assert.equal((await list()).length, baseline, name);
      errors.push({ name, status: response.status, error: response.json.error });
    }
    const invalidJson = await request('/api/raw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(invalidJson.status, 400);
    assert.ok(invalidJson.json.error?.code);
    const tooLarge = await request('/api/raw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input('note', 'x'.repeat(3 * 1024 * 1024))) });
    assert.equal(tooLarge.status, 413);
    assert.ok(tooLarge.json.error?.code);
    const missing = await request('/api/raw/00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404);
    assert.deepEqual((await diskFiles(service.dir)).sort(), before);
    return { errors, invalidJsonStatus: invalidJson.status, transportLimitStatus: tooLarge.status, missingStatus: missing.status, unchangedFileCount: before.length };
  });
  await runCheck('B01-05-real-write-failure-no-success', async () => {
    const dir = path.join(service.dir, 'knowledge/raw/notes');
    const saved = `${dir}.acceptance-backup`;
    const before = (await diskFiles(service.dir)).sort();
    await rename(dir, saved);
    await writeFile(dir, '验收故障注入：目录位置为普通文件');
    let response;
    try { response = await post(input('note', '验收失败请求，不得落盘')); }
    finally { const blocker = `${dir}.acceptance-blocker`; await rename(dir, blocker); await rename(saved, dir); await rename(blocker, path.join(dataRoot, 'write-failure-blocker.txt')); }
    assert.equal(response.status, 500);
    assert.ok(response.json.error?.code);
    assert.deepEqual((await diskFiles(service.dir)).sort(), before);
    assert.ok(!(await diskFiles(service.dir)).some(file => file.endsWith('.tmp')));
    const recovery = await post(input('note', '验收故障解除后恢复保存'));
    assert.equal(recovery.status, 201);
    return { injectedFailure: 'ENOTDIR: source directory replaced by file in isolated fixture', status: response.status, error: response.json.error, recoveryId: recovery.json.id };
  });
  await runCheck('B01-06-restart-immutable-files', async () => {
    const beforeItems = await list();
    initialFileHashes = {};
    for (const file of await diskFiles(service.dir)) initialFileHashes[file] = hash(await readFile(file));
    const currentDir = service.dir;
    await stop();
    service = await start(currentDir);
    assert.deepEqual(await list(), beforeItems);
    for (const [file, expected] of Object.entries(initialFileHashes)) assert.equal(hash(await readFile(file)), expected, file);
    assert.deepEqual((await request(`/api/raw/${longRecord.id}`)).json, longRecord);
    const stats = await request('/api/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.rawCount, beforeItems.length);
    assert.equal(stats.json.thisWeekNewCount, beforeItems.length);
    for (const field of ['wikiCount', 'pendingConfirmationCount', 'openAuditCount', 'promptCount']) assert.equal(stats.json[field], 0, field);
    const update = await request(`/api/raw/${longRecord.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: '不得改变' }) }).catch(error => ({ status: 'non-JSON rejection', error: error.message }));
    assert.ok(update.status === 'non-JSON rejection' || update.status >= 400);
    assert.equal((await request(`/api/raw/${longRecord.id}`)).json.body, longRecord.body);
    return { fileHashes: initialFileHashes, rawCount: beforeItems.length, stats: stats.json, updateRoute: update.status };
  });
  await runCheck('B01-07-shanghai-week-boundaries', async () => {
    await stop();
    service = await start(path.join(dataRoot, 'week-boundaries'));
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const localDay = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    const weekStartUtc = localDay - ((shifted.getUTCDay() + 6) % 7) * 86400000 - 8 * 3600000;
    const dates = [weekStartUtc - 1000, weekStartUtc, weekStartUtc + 1000, weekStartUtc + 7 * 86400000];
    const samples = [];
    for (const milliseconds of dates) {
      const response = await post(input('note', '验收周界统计资料'));
      assert.equal(response.status, 201);
      const file = path.join(service.dir, 'knowledge/raw/notes', `${response.json.id}.md`);
      const text = await readFile(file, 'utf8');
      const date = new Date(milliseconds).toISOString();
      assert.match(text, /^importedAt:.*$/m);
      await writeFile(file, text.replace(/^importedAt:.*$/m, `importedAt: '${date}'`), 'utf8');
      samples.push({ id: response.json.id, importedAt: date });
    }
    const stats = await request('/api/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.rawCount, 4);
    assert.equal(stats.json.thisWeekNewCount, 2, 'Only this Shanghai week counts; previous Sunday and next Monday excluded');
    assert.equal(stats.json.weekStartsOn, new Date(weekStartUtc + 8 * 3600000).toISOString().slice(0, 10));
    return { samples, stats: stats.json };
  });
} catch (error) {
  report.checks.push({ id: 'HARNESS-PREREQUISITE', status: 'BLOCKED', error: String(error.stack || error).slice(0, 4000) });
} finally {
  try { await stop(); } catch (error) { report.notes.push(`Stop failure: ${error.message}`); }
  const changed = [];
  for (const rel of fingerprintPaths) {
    let current;
    try { current = hash(await readFile(path.join(root, rel))); } catch { current = 'MISSING'; }
    if (current !== report.version[rel]) changed.push(rel);
  }
  if (changed.length) report.checks.push({ id: 'FROZEN-VERSION', status: 'BLOCKED', changed });
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map(status => [status, report.checks.filter(check => check.status === status).length]));
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, evidencePath, dataRoot }));
  process.exitCode = report.summary.FAIL || report.summary.BLOCKED ? 1 : 0;
}
