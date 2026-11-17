import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import react from '@vitejs/plugin-react';
import { build, preview } from 'vite';
import { titles, worldpanel, worldpanelList } from './news11-review-fixture.mjs';

const base = path.resolve('node_modules/.cache/news11-review');
await mkdir(base, { recursive: true });
const run = await mkdtemp(path.join(base, 'browser-'));
const data = path.join(run, 'data'), news = path.join(data, 'state', 'news');
const envDir = path.join(run, 'empty-env'), outDir = path.join(run, 'dist'), config = path.join(run, 'provider.env');
const fixture = path.join(run, 'fixture.json'), requestLog = path.join(run, 'source-requests.ndjson');
await mkdir(envDir, { recursive: true });
await mkdir(news, { recursive: true });
await writeFile(config, '');
await writeFile(requestLog, '');
const now = new Date(), stamp = now.toISOString();
const day = offset => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(+now - offset * 86400000));
const [today, prior, published] = [0, 1, 9].map(day);
const setFixture = mode => writeFile(fixture, JSON.stringify({ mode, date: published }));
await setFixture('partial');
const item = (id, title, sourceId, url, extra) => ({ id, title, sourceId, sourceName: { mintel: 'Mintel', worldpanel: 'Worldpanel by Numerator', aihot: 'AIHOT' }[sourceId],
  url, publishedAt: published, fetchedAt: stamp, excerpt: `原始正文 ${id}。\n\n第二段原文保留多个  空格。`, evidenceKind: 'article_excerpt', ...extra });
const original = item('old-fmcg', titles.stored, 'mintel', 'https://example.invalid/news11/old-fmcg', {
  analysis: { fact: '既有事实段', whyItMatters: '既有意义段', possibleImpact: '既有推断段' },
});
const oldAi = item('old-ai', titles.ai, 'aihot', 'https://example.invalid/news11/old-ai', { evidenceKind: 'source_summary', analysis: original.analysis });
const historic = item('historic', titles.history, 'worldpanel', worldpanel + '/insights/news11-history');
const part = (items, fmcg = true) => ({ ...(fmcg ? { contentVersion: 'research-v1' } : {}), status: 'source_only',
  attempt: 1, startedAt: stamp, finishedAt: stamp, items, sources: [] });
const seed = (date, sections) => writeFile(path.join(news, date + '.json'), JSON.stringify({ schemaVersion: 1, date, updatedAt: stamp, sections }));
await seed(today, { fmcg: part([original]), ai: part([oldAi], false) });
await seed(prior, { fmcg: part([historic]) });

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  assert.notEqual(port, 4317);
  return port;
}
await build({ configFile: false, plugins: [react()], envDir, build: { outDir, emptyOutDir: false } });
const apiPort = await freePort(), uiPort = await freePort();
assert.notEqual(apiPort, uiPort);
const apiBase = `http://127.0.0.1:${apiPort}`, uiBase = `http://127.0.0.1:${uiPort}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|NODE_OPTIONS$)/i.test(key)));
Object.assign(env, { FMCG_DATA_DIR: data, FMCG_PORT: String(apiPort), FMCG_UI_ORIGIN: uiBase,
  FMCG_LLM_CONFIG_FILE: config, FMCG_NEWS_AI_ENABLED: 'true', NEWS11_REVIEW_DIR: run });
const child = spawn(process.execPath, ['--import', './tests/acceptance/news11-review-fixture.mjs', '--import', 'tsx', 'server/index.ts'],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const exited = once(child, 'close');
let apiLog = '', ui, browser;
child.stdout.on('data', data => { apiLog += data; });
child.stderr.on('data', data => { apiLog += data; });
const evidence = { run, today, prior, apiPort, uiPort, cases: [], pageErrors: [], closed: {} };
const get = route => fetch(apiBase + route).then(async r => { assert.ok(r.ok, route + ': ' + r.status); return r.json(); });
const post = (route, body, headers = {}) => fetch(apiBase + route, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const attempts = () => readFile(requestLog, 'utf8').then(x => x.trim().split('\n').filter(Boolean).map(JSON.parse));
const waitFor = async (label, fn) => {
  for (let i = 0; i < 100; i++) { const x = await fn(); if (x) return x; await delay(150); }
  assert.fail(label + ' not observed');
};
const checkPath = '/api/news/today/check';
const findSection = async section => (await get('/api/news/today')).edition.sections[section];
try {
  await waitFor('isolated API', () => fetch(apiBase + '/api/health').then(r => r.ok, () => false));
  const bad = [
    await post(checkPath, { section: 'fmcg', mode: 'all', attempt: 1 }, { origin: 'https://untrusted.example' }),
    await post(checkPath, { section: 'fmcg', mode: 'all', attempt: 1 }, { 'content-type': 'text/plain' }),
    ...await Promise.all([{ section: 'ai', mode: 'failed', attempt: 1 }, { section: 'fmcg', mode: 'all', attempt: '1' },
      { section: 'fmcg', mode: 'all', attempt: 1, sourceIds: ['ccfa'] }].map(body => post(checkPath, body))),
  ];
  assert.deepEqual(bad.map(x => x.status), [403, 415, 400, 400, 400]);
  assert.deepEqual(await attempts(), []);
  evidence.cases.push('Express trusted Origin, JSON and field boundaries; rejects caused zero source requests');

  ui = await preview({ configFile: false, envDir, build: { outDir }, preview: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': apiBase } } });
  const { chromium } = createRequire(import.meta.url)(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'] });
  evidence.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(9000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(uiBase + '/') ? route.continue() : route.abort());
  await page.goto(uiBase, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '阅读资讯', exact: true }).click();
  const section = name => page.locator('section.news-section').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const fmcg = section('快消研报与洞察'), ai = section('AI 前沿');
  const heading = (scope, name) => scope.getByRole('heading', { name, exact: true });
  const check = scope => scope.getByRole('button', { name: '检查更新', exact: true });
  const card = (scope, itemTitle) => scope.locator('article').filter({ has: page.getByRole('heading', { name: itemTitle, exact: true }) });
  await heading(fmcg, titles.stored).waitFor();
  await check(fmcg).click();
  await waitFor('paused Worldpanel fetch', async () => (await attempts()).some(x => x.url === worldpanelList));
  const running = await findSection('fmcg');
  assert.equal(running.status, 'running');
  assert.deepEqual(running.items, [original]);
  await fmcg.getByText(/正在.{0,8}(?:检查|更新|抓取)|(?:检查|更新|抓取)中/).first().waitFor();
  await heading(fmcg, titles.stored).waitFor();
  const savePath = `/api/news/editions/${today}/items/save-raw`;
  const savedResponse = page.waitForResponse(r => r.url().endsWith(savePath) && r.request().method() === 'POST');
  await card(fmcg, titles.stored).getByRole('button', { name: '保存来源摘录到 Raw' }).click();
  const saved = await (await savedResponse).json();
  assert.equal(saved.created, true);
  await card(fmcg, titles.stored).getByRole('button', { name: '查看 Raw' }).waitFor();
  assert.equal((await get('/api/raw/' + encodeURIComponent(saved.rawId))).body, original.excerpt);
  assert.equal((await post(savePath, { section: 'fmcg', itemId: 'not-in-edition' })).status, 404);
  await writeFile(path.join(run, 'release-partial'), '');
  await heading(fmcg, titles.first).waitFor();
  const partial = await findSection('fmcg');
  assert.deepEqual(partial.items.map(x => x.title), [titles.stored, titles.first]);
  assert.deepEqual([...new Set((await attempts()).map(x => new URL(x.url).hostname))].sort(),
    ['china.mintel.com', 'kpmg.com', 'nielseniq.cn', 'worldpanelbynumerator.com', 'www.pwccn.com', 'www.stats.gov.cn']);
  assert.ok(!(await attempts()).some(x => x.url.includes('news11-history')), 'history should deduplicate before detail requests');
  const diagnostics = fmcg.locator('summary').filter({ hasText: /来源|诊断/ });
  if (await diagnostics.count()) await diagnostics.first().click();
  await fmcg.getByText(/(?:部分失败|部分读取失败|部分成功|覆盖不完整)/).first().waitFor();
  await fmcg.getByText(/最近读取成功/).first().waitFor();
  evidence.cases.push('1440px desktop: pending check keeps cards readable/saveable, byte-identical Raw, partial result and time visible');

  await page.setViewportSize({ width: 390, height: 844 });
  await setFixture('retry');
  await fmcg.getByRole('button', { name: '仅补抓失败来源', exact: true }).click();
  await heading(fmcg, titles.second).waitFor();
  const recovered = await findSection('fmcg');
  assert.deepEqual(recovered.items.slice(0, 2), partial.items);
  const retryRequests = (await attempts()).filter(x => x.mode === 'retry').map(x => x.url);
  assert.deepEqual(retryRequests.sort(), [worldpanelList, worldpanel + '/insights/news11-second', worldpanel + '/insights/news11-tiny'].sort());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const rawAgain = await (await post(savePath, { section: 'fmcg', itemId: original.id })).json();
  assert.deepEqual([rawAgain.created, rawAgain.rawId], [false, saved.rawId]);
  evidence.cases.push('390px mobile: only partial Worldpanel retried; accepted content not fetched again; new card and same Raw receipt');

  await check(ai).click();
  await heading(ai, titles.freshAi).waitFor();
  const updatedAi = await findSection('ai');
  assert.deepEqual(updatedAi.items[0], oldAi);
  assert.equal(updatedAi.items[1].analysis, undefined);
  assert.deepEqual((await attempts()).filter(x => x.url.includes('aihot.news')).map(x => new URL(x.url).search), ['?mode=selected&window=24h&limit=5']);
  await setFixture('all-fail');
  await check(fmcg).click();
  await fmcg.getByText(/(?:检查|更新)失败.{0,10}保留/).first().waitFor();
  const failed = await findSection('fmcg');
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.items, recovered.items);
  const lastRead = section => section.sources.find(x => x.sourceId === 'worldpanel').diagnosis.lastSuccessAt;
  assert.ok(Number.isFinite(Date.parse(lastRead(recovered))));
  assert.equal(lastRead(failed), lastRead(recovered));
  await heading(fmcg, titles.second).waitFor();
  await page.getByLabel('阅读日期').selectOption(prior);
  await heading(fmcg, titles.history).waitFor();
  assert.equal(await page.getByRole('button', { name: /检查更新|仅补抓失败来源/ }).count(), 0);
  const historySavePath = `/api/news/editions/${prior}/items/save-raw`;
  const historicResponse = page.waitForResponse(r => r.url().endsWith(historySavePath) && r.request().method() === 'POST');
  await card(fmcg, titles.history).getByRole('button', { name: '保存来源摘录到 Raw' }).click();
  const historicalRaw = await (await historicResponse).json();
  assert.equal(historicalRaw.created, true);
  assert.equal((await get('/api/raw/' + encodeURIComponent(historicalRaw.rawId))).body, historic.excerpt);
  assert.deepEqual(evidence.pageErrors, []);
  evidence.cases.push('AIHOT preserves original card and analysis; failed FMCG check retains all cards; historical save uses original date and there are no refresh controls');
  evidence.requests = await attempts();
  assert.ok(evidence.requests.every(x => /^(?:worldpanelbynumerator\.com|nielseniq\.cn|www\.stats\.gov\.cn|www\.pwccn\.com|kpmg\.com|china\.mintel\.com|aihot\.news)$/.test(new URL(x.url).hostname)));
  evidence.rawId = saved.rawId;
} finally {
  if (browser) { await browser.close(); evidence.closed.browser = true; }
  if (ui) { await ui.close(); evidence.closed.ui = true; }
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await exited;
  evidence.closed.api = true;
  evidence.apiLog = apiLog;
  await writeFile(path.join(run, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log('NEWS11 isolated browser evidence: ' + run);
}
