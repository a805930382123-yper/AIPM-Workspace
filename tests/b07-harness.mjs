import { withoutInheritedEmbeddings } from './support/isolated-embedding-env.mjs';
// B07 construction self-test helpers. Standalone (not part of `npm test`): these scripts boot a
// throwaway product server against a temporary FMCG_DATA_DIR on a free port, so nothing here ever
// touches the formal workspace or the user's running 4317/5173 services.
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const digest = (data) => createHash('sha256').update(data).digest('hex');
export const uuid = () => randomUUID();

export async function filesUnder(root) {
  const items = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) items.push(...(await filesUnder(file)));
    else items.push(file);
  }
  return items;
}

export async function fileSnapshot(root) {
  const files = (await filesUnder(root)).sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [path.relative(root, file).replaceAll('\\', '/'), digest(await readFile(file))]),
    ),
  );
}

export async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const value = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return value;
}

export async function request(service, url, method = 'GET', body) {
  const response = await fetch(service.base + url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON bodies (markdown export) are read as text */
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** Asserts the status code and returns the parsed JSON body. Every failure prints the raw body. */
export async function expectJson(service, url, method, body, status = 200) {
  const result = await request(service, url, method, body);
  assert.equal(result.status, status, `${method} ${url} -> ${result.status} body=${result.text}`);
  return result.json;
}

/** Asserts the frozen error envelope `{error:{code,message}}` and returns the error object. */
export async function expectError(service, url, method, body, status, code) {
  const result = await request(service, url, method, body);
  assert.equal(result.status, status, `${method} ${url} -> ${result.status} body=${result.text}`);
  assert.ok(result.json?.error, `expected an {error:{...}} envelope, got ${result.text}`);
  assert.equal(
    result.json.error.code,
    code,
    `expected error code ${code}, got ${result.json.error.code} (${result.text})`,
  );
  assert.equal(typeof result.json.error.message, 'string');
  assert.ok(result.json.error.message.length > 0, 'error message must be readable');
  return result.json.error;
}

/** The ten editable fields of a stored Prompt, ready to send back as an update payload. */
export function toEditInput(prompt) {
  return {
    name: prompt.name,
    category: prompt.category,
    scenario: prompt.scenario,
    body: prompt.body,
    inputRequirements: prompt.inputRequirements,
    outputRequirements: prompt.outputRequirements,
    relatedWikiIds: prompt.relatedWikiIds,
    examples: prompt.examples,
    tags: prompt.tags,
    favorite: prompt.favorite,
  };
}

export function promptInput(overrides = {}) {
  return {
    name: '客户访谈提纲',
    category: 'customer',
    scenario: '拜访重点客户前准备问题清单',
    body: '请围绕 {{客户名称}} 的 {{访谈主题}} 输出访谈提纲。',
    inputRequirements: '客户名称、访谈主题',
    outputRequirements: '三段式提纲，每段不超过 5 条',
    relatedWikiIds: [],
    examples: '示例：客户名称=华东某连锁商超',
    tags: ['访谈', '客户'],
    favorite: false,
    ...overrides,
  };
}

/**
 * Boots one product server. `faultHook` (optional) is an absolute path to a preloaded module that
 * patches fs only inside this data root; `dataRoot` lets a test reuse a directory across restarts.
 */
export async function createHarness({ dataRoot, faultHook } = {}) {
  const root = dataRoot ?? (await mkdtemp(path.join(os.tmpdir(), 'fmcg-b07-builder-')));
  const services = [];
  async function start(dir = root) {
    const apiPort = await freePort();
    const imports = [];
    // `--import` needs a file:// URL on Windows, not a drive-letter path.
    if (faultHook) imports.push('--import', pathToFileURL(faultHook).href);
    imports.push('--import', 'tsx', 'server/index.ts');
    const child = spawn(process.execPath, imports, {
      cwd: process.cwd(),
      // No LLM configuration at all: the manual Prompt Library must work with zero provider.
      env: withoutInheritedEmbeddings({
        ...process.env,
        FMCG_DATA_DIR: dir,
        FMCG_PORT: String(apiPort),
        FMCG_LLM_BASE_URL: '',
        FMCG_LLM_MODEL: '',
        FMCG_LLM_API_KEY: '',
      }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const service = { child, dir, base: `http://127.0.0.1:${apiPort}`, port: apiPort, logs: '' };
    child.stdout.on('data', (chunk) => (service.logs += chunk));
    child.stderr.on('data', (chunk) => (service.logs += chunk));
    services.push(service);
    for (let n = 0; n < 200; n++) {
      if (child.exitCode !== null) throw new Error(`product start failed (exit ${child.exitCode}): ${service.logs}`);
      try {
        if ((await fetch(`${service.base}/api/health`, { signal: AbortSignal.timeout(250) })).ok) return service;
      } catch {
        /* still booting */
      }
      await delay(100);
    }
    await stop(service);
    throw new Error(`product startup timeout: ${service.logs}`);
  }
  async function stop(service) {
    if (service && service.child.exitCode === null && service.child.signalCode === null) {
      const done = once(service.child, 'exit');
      service.child.kill();
      await done;
    }
  }
  async function close() {
    for (const service of services) await stop(service);
  }
  return { root, services, start, stop, close };
}

/** Collects per-item results so the report can quote exactly what ran. */
export function createRecorder() {
  const items = [];
  return {
    items,
    async test(id, title, fn, options = {}) {
      const started = Date.now();
      const item = { id, title, status: 'PASS', evidence: '', detail: '', durationMs: 0, ...options };
      try {
        const evidence = await fn();
        item.evidence = typeof evidence === 'string' ? evidence : JSON.stringify(evidence ?? {});
      } catch (error) {
        item.status = 'FAIL';
        item.detail = error instanceof Error ? `${error.message}` : String(error);
      }
      item.durationMs = Date.now() - started;
      items.push(item);
      const mark = item.status === 'PASS' ? 'PASS' : 'FAIL';
      console.log(
        `[${mark}] ${id} ${title} (${item.durationMs}ms)${item.status === 'FAIL' ? `\n      ${item.detail}` : ''}`,
      );
      return item;
    },
    skip(id, title, detail) {
      const item = { id, title, status: 'NOT_RUN', evidence: '', detail, durationMs: 0 };
      items.push(item);
      console.log(`[NOT_RUN] ${id} ${title}\n      ${detail}`);
      return item;
    },
  };
}
