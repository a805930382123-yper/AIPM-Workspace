import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { build, preview } from 'vite';

const report = new URL('../../docs/reports/WORK05-SIM-20261108/', import.meta.url);
const batches = await Promise.all(['week-2026-10-19.json', 'week-2026-10-26.json'].map(async file =>
  JSON.parse(await readFile(new URL(file, report), 'utf8'))));
assert.deepEqual(batches.map(batch => [batch.synthetic, batch.events.length]), [[true, 6], [true, 6]]);
assert.equal(new Set(batches.flatMap(batch => batch.events.map(event => event.eventId))).size, 12);

const cache = path.resolve('node_modules/.cache/work05-sim');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'run-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'env');
const config = path.join(root, 'isolated.env');
await mkdir(envDir);
console.log('WORK05 isolated evidence:', root);

const checks = [];
const raws = [];
const associationResponses = [];
const fixtureCalls = [];
const browserWrites = [];
const stubbedNewsRequests = [];
const blockedBrowserRequests = [];
const pageErrors = [];
const logs = [];
const ports = {};
const sha = input => createHash('sha256').update(input, 'utf8').digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const apiUrl = () => 'http://127.0.0.1:' + ports.api;
const pass = message => { checks.push(message); console.log('PASS', message); };
const evidence = { head, node: process.version, checks, ports, fixtureCalls, raws, associationResponses,
  browserWrites, stubbedNewsRequests, blockedBrowserRequests, pageErrors, realModelCalls: 0 };

const fake = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  const input = JSON.parse(payload.messages.find(message => message.role === 'user').content);
  fixtureCalls.push({ method: request.method, route: request.url, model: payload.model, rawIds: input.sources.map(source => source.rawId) });
  if (request.url !== '/v1/chat/completions' || payload.model !== 'work05-sim-fake' || fixtureCalls.length > 1) {
    response.writeHead(503).end('unexpected fixture model call');
    return;
  }
  const source = input.sources[0];
  const output = {
    observations: [{ rawId: source.rawId, quote: source.body, observation: '合成首轮夹具仅确认已记录排查范围。' }],
    suggestions: ['补充两周的原始问答。'],
    openQuestions: ['是否出现能复跑的报表失败？'],
  };
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
  }));
});

async function listen(server) {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  return server.address().port;
}

async function request(url, method = 'GET', body, expected = 200) {
  const response = await fetch(apiUrl() + url, { method, signal: AbortSignal.timeout(15_000),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.equal(response.status, expected, method + ' ' + url + ': ' + JSON.stringify(result).slice(0, 650));
  return result;
}

let api, apiExit, ui, browser, page;
try {
  ports.fake = await listen(fake);
  const reserve = createServer();
  ports.api = await listen(reserve);
  await new Promise(resolve => reserve.close(resolve));
  await writeFile(config, 'FMCG_LLM_BASE_URL=http://127.0.0.1:' + ports.fake +
    '/v1\nFMCG_LLM_MODEL=work05-sim-fake\nFMCG_LLM_API_KEY=work05-local-fixture-key\n');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
  api = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: withoutInheritedEmbeddings({ ...cleanEnv, FMCG_DATA_DIR: data, FMCG_PORT: String(ports.api), FMCG_LLM_CONFIG_FILE: config }),
    windowsHide: true,
  });
  apiExit = once(api, 'close');
  api.stdout.on('data', chunk => logs.push(String(chunk)));
  api.stderr.on('data', chunk => logs.push(String(chunk)));
  for (let i = 0; i < 150; i++) {
    if (await fetch(apiUrl() + '/api/health', { signal: AbortSignal.timeout(2000) }).then(r => r.ok, () => false)) break;
    await wait(80);
  }
  assert.ok(logs.join('').includes('(data: ' + data + ')'), logs.join(''));

  const vite = { envDir, build: { outDir: path.join(root, 'dist') } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': apiUrl() } } });
  ports.ui = ui.httpServer.address().port;
  const uiUrl = 'http://127.0.0.1:' + ports.ui;
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.WORK05_PLAYWRIGHT ??
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.WORK05_CHROME ??
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  evidence.chrome = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', req => {
    const route = new URL(req.url()).pathname;
    if (route.startsWith('/api/') && !route.startsWith('/api/news/') && !['GET', 'HEAD'].includes(req.method())) {
      browserWrites.push({ method: req.method(), route, payload: req.postDataJSON() });
    }
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== uiUrl) {
      blockedBrowserRequests.push(url.origin + url.pathname);
      return route.abort();
    }
    // Keep the home page's unrelated automatic news refresh out of this offline run.
    if (url.pathname.startsWith('/api/news/')) {
      stubbedNewsRequests.push({ method: route.request().method(), route: url.pathname });
      return route.fulfill({ json: { date: '2026-11-08', aiEnabled: false, edition: null, fallbacks: {} } });
    }
    return route.continue();
  });

  const sourceName = batches[0].source;
  const baseline = await request('/api/raw', 'POST', { title: '【合成夹具】能力缺口排查范围', body: '排查范围为智能参谋周度问答中的报表生成、数据时点与口径。',
    sourceType: 'note', sourceName, tags: ['合成夹具'] }, 201);
  let product = await request('/api/work-items', 'POST', { kind: 'product_analysis', title: '【合成】智能参谋能力缺口',
    goal: '核对报表失败、数据时点、口径差异与提问歧义，定位可复跑问题。' }, 201);
  const itemUrl = '/api/work-items/' + product.id;
  const runUrl = itemUrl + '/analysis-runs';
  product = await request(itemUrl, 'PUT', { baseRevision: product.revision, rawIds: [baseline.id] });
  const priorRun = await request(runUrl, 'POST', { baseRevision: product.revision, rawIds: [baseline.id] }, 201);
  assert.equal(priorRun.status, 'completed');
  assert.deepEqual(fixtureCalls.map(call => call.rawIds), [[baseline.id]]);
  const priorRunFile = path.join(data, 'work-items', 'analysis-runs', product.id, priorRun.id + '.json');
  const priorHash = sha(await readFile(priorRunFile));
  const books = async () => {
    const [wiki, prompts] = await Promise.all([request('/api/wiki'), request('/api/prompts')]);
    return { wiki: wiki.items.map(item => item.id), prompts: prompts.items.map(item => item.id) };
  };
  evidence.baseline = { rawId: baseline.id, itemId: product.id, runId: priorRun.id, status: priorRun.status, runFileSha256: priorHash,
    wikiAndPromptIds: await books() };
  pass('以一次回环 fake 请求建立合成首轮夹具');

  const button = (name, within = page) => within.getByRole('button', { name, exact: true });
  const nav = name => button(name, page.getByRole('navigation', { name: '主导航' })).click();
  const openItem = async () => {
    await nav('工作事项');
    await page.getByRole('button', { name: /智能参谋能力缺口/ }).click();
    await page.getByRole('heading', { name: product.title, exact: true }).waitFor();
  };
  const responseFor = (url, method) => page.waitForResponse(response =>
    new URL(response.url()).pathname === url && response.request().method() === method);
  const suggestion = button('带新资料继续分析');
  const picker = page.locator('fieldset.work-source-picker');
  const checkbox = title => picker.getByRole('checkbox', { name: title, exact: true });
  const verifyRaw = async (event, raw) => {
    const rawPath = path.join(data, 'knowledge', 'raw', 'notes', raw.id + '.md');
    const savedFile = await readFile(rawPath, 'utf8');
    const savedBody = savedFile.replace(/^---\n[\s\S]*?\n---\n/, '');
    const reread = await request('/api/raw/' + raw.id);
    assert.deepEqual(reread, raw);
    assert.equal(reread.title, event.title);
    assert.equal(reread.sourceName, sourceName);
    assert.equal(reread.body, event.body);
    assert.equal(savedBody, event.body);
    assert.equal(reread.bodySha256, sha(event.body));
    return { eventId: event.eventId, rawId: raw.id, title: raw.title, bodyBytes: Buffer.byteLength(event.body),
      bodySha256: sha(event.body), diskBodySha256: sha(savedBody), apiBodySha256: sha(reread.body),
      diskFileSha256: sha(savedFile), rawPath: path.relative(root, rawPath), importStatus: 201, readStatus: 200 };
  };

  await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
  await openItem();
  await page.locator('button[aria-controls="analysis-' + priorRun.id + '"]').waitFor();
  assert.equal(await suggestion.isVisible(), false);
  const fixtureCount = fixtureCalls.length;
  const rawIds = [baseline.id];
  evidence.weeklySuggestionCounts = [];

  for (const batch of batches) {
    await nav('Raw 原始资料');
    const dialog = page.getByRole('dialog', { name: '导入原始资料' });
    for (const event of batch.events) {
      await page.getByRole('button', { name: /导入资料/ }).first().click();
      await dialog.locator('input[data-autofocus]').fill(event.title);
      await dialog.getByLabel(/来源类型/).selectOption('note');
      await dialog.getByLabel(/来源名称/).fill(sourceName);
      await dialog.getByLabel(/原始正文/).fill(event.body);
      const imported = responseFor('/api/raw', 'POST');
      await button('仅保存 Raw', dialog).click();
      const response = await imported;
      assert.equal(response.status(), 201);
      const raw = await response.json();
      await dialog.waitFor({ state: 'hidden' });
      raws.push(await verifyRaw(event, raw));
    }

    assert.deepEqual((await request(itemUrl)).rawIds, rawIds);
    await openItem();
    for (const raw of raws.slice(-batch.events.length)) {
      await page.getByLabel('选择已有 Raw', { exact: true }).selectOption(raw.rawId);
      const updated = responseFor(itemUrl, 'PUT');
      await button('添加关联').click();
      const response = await updated;
      assert.equal(response.status(), 200);
      product = await response.json();
      rawIds.push(raw.rawId);
      assert.deepEqual(product.rawIds, rawIds);
      associationResponses.push({ eventId: raw.eventId, rawId: raw.rawId, itemId: product.id, status: response.status(),
        revision: product.revision, rawIds: [...product.rawIds] });
      await button(raw.title + ' · 查看原文').waitFor();
    }
    const count = raws.length;
    const label = '有 ' + count + ' 条关联资料尚未用于已完成的分析。';
    await page.getByText(label, { exact: true }).waitFor();
    evidence.weeklySuggestionCounts.push(count);
    pass(batch.week + ' 六条经 Chrome 导入、原文/散列回读、人工关联，建议计数 ' + count);
    await suggestion.locator('..').screenshot({ path: path.join(root, 'suggestion-' + count + '-1440.png') });
  }

  const beforeNavigation = browserWrites.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!await page.getByRole('heading', { name: product.title, exact: true }).isVisible()) await openItem();
  await page.getByText('有 12 条关联资料尚未用于已完成的分析。', { exact: true }).waitFor();
  await checkbox(baseline.title).check();
  await page.getByLabel('本轮问题（选填）', { exact: true }).fill('仅核对合成样本的报表失败记录');
  await page.setViewportSize({ width: 390, height: 950 });
  await suggestion.locator('..').screenshot({ path: path.join(root, 'suggestion-12-390.png') });
  await suggestion.click();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '本轮资料');
  assert.equal(await checkbox(baseline.title).isChecked(), true);
  for (const raw of raws) assert.equal(await checkbox(raw.title).isChecked(), false);
  assert.equal(await page.getByLabel('本轮问题（选填）', { exact: true }).inputValue(), '仅核对合成样本的报表失败记录');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(browserWrites.length, beforeNavigation);
  pass('刷新后 390px 点击建议只聚焦本轮资料，保留已选和问题，12 条新增均未勾选，零新增写请求');

  assert.deepEqual(await request(itemUrl), product);
  assert.deepEqual((await request('/api/raw')).items.map(item => item.id).sort(), rawIds.toSorted());
  const runs = (await request(runUrl)).items;
  assert.deepEqual(runs.map(run => [run.id, run.status]), [[priorRun.id, 'completed']]);
  assert.equal(sha(await readFile(priorRunFile)), priorHash);
  for (const raw of raws) assert.equal(sha(await readFile(path.join(root, raw.rawPath))), raw.diskFileSha256);
  const finalBooks = await books();
  assert.deepEqual(finalBooks, evidence.baseline.wikiAndPromptIds);
  assert.deepEqual(browserWrites.map(write => [write.method, write.route]).sort(),
    [...Array(12).fill(['POST', '/api/raw']), ...Array(12).fill(['PUT', itemUrl])].sort());
  assert.equal(fixtureCalls.length, fixtureCount);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(blockedBrowserRequests, []);
  evidence.final = { rawCount: rawIds.length, attachedRawCount: product.rawIds.length, imported: raws.length, itemId: product.id,
    itemPath: path.relative(root, path.join(data, 'work-items', product.id + '.json')), runCount: runs.length,
    trialModelCalls: fixtureCalls.length - fixtureCount, writesOnSuggestion: browserWrites.length - beforeNavigation,
    wikiAndPromptIds: finalBooks };
  pass('总计 13 条 Raw 和 13 个关联含首轮夹具，演练阶段模型请求 0，历史首轮与 Wiki/Prompt 清单未变');
} catch (error) {
  evidence.failure = String(error.stack ?? error);
  await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await ui?.close();
  if (api) {
    api.kill();
    await apiExit;
  }
  if (fake.listening) {
    fake.closeAllConnections();
    await new Promise(resolve => fake.close(resolve));
  }
  await writeFile(path.join(root, 'api.log'), logs.join(''));
  await writeFile(path.join(root, 'summary.json'), JSON.stringify(evidence, null, 2) + '\n');
}

