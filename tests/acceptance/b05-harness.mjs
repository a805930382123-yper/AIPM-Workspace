import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const digest = data => createHash('sha256').update(data).digest('hex');
export async function filesUnder(root) {
  const items = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) items.push(...await filesUnder(file));
    else items.push(file);
  }
  return items;
}
export async function fileSnapshot(root) {
  return Object.fromEntries(await Promise.all((await filesUnder(root)).sort().map(async file => [path.relative(root, file), digest(await readFile(file))])));
}
export async function port() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const value = socket.address().port; await new Promise(resolve => socket.close(resolve)); return value;
}
export async function createHarness(reply, reuseDataRoot) {
  const dataRoot = reuseDataRoot ?? await mkdtemp(path.join(os.tmpdir(), 'fmcg-b05-independent-'));
  const requests = [], services = []; const fakeKey = 'b05-public-fake-test-key';
  let responder = reply;
  const fake = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    try {
      const input = JSON.parse(Buffer.concat(chunks));
      requests.push({ at: new Date().toISOString(), input, authCorrect: req.headers.authorization === `Bearer ${fakeKey}` });
      const output = await responder(input);
      res.writeHead(output?.httpStatus ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(output?.httpStatus ? { error: { message: 'Explicit independent fake failure' } } : { choices: [{ message: { content: typeof output === 'string' ? output : JSON.stringify(output) }, finish_reason: 'stop' }] }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Independent fake fixture invalid' } }));
    }
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}/v1`;
  async function start(dir = dataRoot, configured = true, fixedPort) {
    const apiPort = fixedPort ?? await port();
    const child = spawn(process.execPath, ['--import', './tests/acceptance/b05-fault-hook.mjs', '--import', 'tsx', 'server/index.ts'], {
      cwd: process.cwd(), env: withoutInheritedEmbeddings({ ...process.env, FMCG_DATA_DIR: dir, FMCG_PORT: String(apiPort), FMCG_LLM_BASE_URL: configured ? fakeUrl : '', FMCG_LLM_MODEL: configured ? 'independent-b05-fake' : '', FMCG_LLM_API_KEY: configured ? fakeKey : '' }), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const service = { child, dir, base: `http://127.0.0.1:${apiPort}`, port: apiPort, logs: '' };
    child.stdout.on('data', chunk => service.logs += chunk); child.stderr.on('data', chunk => service.logs += chunk); services.push(service);
    for (let n = 0; n < 120; n++) {
      if (child.exitCode !== null) throw new Error('Product start failed: ' + service.logs);
      try { if ((await fetch(service.base + '/api/health', { signal: AbortSignal.timeout(250) })).ok) return service; } catch {}
      await delay(100);
    }
    await stop(service); throw new Error('Product startup timeout: ' + service.logs);
  }
  async function stop(service) {
    if (service.child.exitCode === null && service.child.signalCode === null) { const done = once(service.child, 'exit'); service.child.kill(); await done; }
  }
  async function close() { for (const service of services) await stop(service); await new Promise(resolve => fake.close(resolve)); }
  return { dataRoot, fakeUrl, requests, services, setReply: fn => { responder = fn; }, start, stop, close };
}
export async function request(service, url, method = 'GET', body) {
  const response = await fetch(service.base + url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const text = await response.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}
export async function expect(service, url, method, body, status = 200) {
  const result = await request(service, url, method, body); assert.equal(result.status, status, result.text); return result.json;
}
export const rawInput = (title, body, tags = []) => ({ title: `验收资料 ${title}`, sourceType: 'report', sourceName: `隔离样本 ${title}`, author: '验收样本', publishedAt: '2026-10-01', url: 'https://example.com/b05-fixture', tags, body });
export const wikiInput = (title, sources, body, extra = {}) => ({ title, type: 'metric', category: 'metric', sources, tags: [], aliases: [], body, knowledge_status: 'source_supported', confidence: 'medium', source_level: 'B', review_status: 'reviewed', ...extra });
export async function extract(service, rawId) {
  const started = await expect(service, `/api/raw/${rawId}/extract`, 'POST', {}, 202);
  for (let n = 0; n < 160; n++) {
    const job = await expect(service, `/api/extraction-jobs/${started.jobId}`, 'GET');
    if (job.status === 'failed') throw new Error(JSON.stringify(job.error));
    if (job.status === 'completed') return expect(service, `/api/drafts/${job.draftId}`, 'GET');
    await delay(80);
  }
  throw new Error('Extraction timeout');
}
