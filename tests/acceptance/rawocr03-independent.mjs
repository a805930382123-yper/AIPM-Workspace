import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer, preview } from 'vite';
import { RawStore } from '../../services/raw/store.ts';
import { identifyWebImages, readWebMaterial } from '../../services/raw/web-material.ts';

// Independent reviewer owns this script. Every record and service is disposable.
// To test a production bundle, build into a fresh directory and set RAWOCR03_BUILD_DIR to it.
const builtUi = process.env.RAWOCR03_BUILD_DIR;
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr03-independent-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'empty-env');
await mkdir(envDir);
const requests = [];
const errors = [];
const evidence = { checks: [], pageErrors: [], consoleErrors: [], httpErrors: [], blocked: [] };
let active = 0;
let maximum = 0;
let failImage = true;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const wire = JSON.parse(Buffer.concat(chunks));
  const text = wire.messages[1].content[0].text;
  const payload = JSON.parse(text.split('\n').at(-1));
  requests.push({ wire, payload });
  active++;
  maximum = Math.max(maximum, active);
  await delay(350);
  active--;
  if (text.includes('DIRTY_')) errors.push('Debug OCR leaked into provider');
  if (payload.article_title === '独立批量文章' && payload.image_index === 3 && failImage) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: '模拟精读暂时失败' } }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    should_skip: false, image_type: 'comparison_table', summary: '独立精读摘要',
    markdown: `独立结果图 ${payload.image_index}\n\n|指标|数值|\n|---|---|\n|门店|42|\n\n1. 先核查\n2. 再登记`,
    confidence: 'medium', warnings: ['右下角模糊'],
  }) }, finish_reason: 'stop' }] }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
let child;
let ui;
let browser;
const wait = async (label, fn) => {
  for (let i = 0; i < 600; i++) {
    if (await fn()) return;
    await delay(100);
  }
  assert.fail(`Timed out: ${label}`);
};

try {
  const store = new RawStore(data);
  await store.initialize();
  const canvas = createCanvas(640, 320);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 640, 320);
  context.fillStyle = '#123';
  context.font = '30px Arial';
  context.fillText('INDEPENDENT IMAGE 42', 30, 120);
  const bytes = canvas.toBuffer('image/png');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const imageFile = path.join(data, 'knowledge', 'raw', 'web-images', sha256);
  await mkdir(path.dirname(imageFile), { recursive: true });
  await writeFile(imageFile, bytes);
  if (process.argv.includes('--native-ocr')) {
    const material = await readWebMaterial(data, 'https://native-ocr.test/story', {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async url => ({ status: 200,
        headers: { 'content-type': url.pathname === '/story' ? 'text/html' : 'image/png' },
        body: Readable.from([url.pathname === '/story'
          ? '<article><p>原网页正文。</p><img src="/source.png"><p>原网页结束。</p></article>' : bytes]),
      }),
    });
    assert.equal(material.artifacts.length, 1);
    assert.equal(material.artifacts[0].routeStatus, 'ocr_ready', JSON.stringify(material.artifacts[0]));
    assert.match(material.artifacts[0].ocrCleanText, /INDEPENDENT IMAGE 42/u);
    assert.doesNotMatch(material.body, /INDEPENDENT IMAGE|OCR/u);
    evidence.checks.push('native Tesseract integrated webpage triage produces clean derivative without changing body');
  }
  const metrics = { effectiveCharCount: 30, nonEmptyLineCount: 2, shortLineRatio: 0, gibberishRatio: 0,
    layoutDispersion: 0, chartSignalScore: 0, avgConfidence: 0.95, qualityScore: 100 };
  const skipReason = '文末推广区截断，已跳过此图。';
  async function seed(title, states, legacy = false) {
    const body = '独立正文开头😃。\n' + states.map((_, i) => `【来源图片 ${i + 1}】\n`).join('') + '独立正文结尾。';
    const raw = await store.create({ title, sourceType: 'article', sourceName: '合成来源', tags: [], body,
      webImages: states.map((_, i) => ({ start: body.indexOf(`【来源图片 ${i + 1}】`),
        sourceUrl: 'https://example.invalid/original.png', label: '', status: 'transcribed', mime: 'image/png', sha256 })) });
    const images = identifyWebImages(raw.id, raw.webImages);
    if (!legacy) for (const [i, image] of images.entries()) {
      const routeStatus = states[i];
      await store.saveMediaArtifact(raw.id, image.mediaId, {
        routeStatus, routeReasons: [routeStatus === 'skipped' ? 'promotion_tail' : 'independent_fixture'], metrics,
        ocrRawText: `DIRTY_${i}`, ...(routeStatus === 'ocr_ready' ? { ocrCleanText: '清洗文字独立哨兵。' } : {}),
        ...(routeStatus === 'skipped' ? { decisionReason: skipReason } : {}),
        ...(routeStatus === 'vlm_done' ? { vlmSummary: '已保存摘要', vlmMarkdown: '已有解析正文。',
          vlmConfidence: 'medium', vlmWarnings: ['原图模糊'], vlmModel: 'synthetic', vlmParsedAt: new Date().toISOString() } : {}),
        ...(routeStatus === 'failed' ? { vlmError: '模拟已有失败' } : {}) });
    }
    return { raw, images, file: path.join(data, 'knowledge', 'raw', 'articles', `${raw.id}.md`) };
  }
  const main = await seed('独立五态文章', ['skipped', 'ocr_ready', 'needs_vlm', 'vlm_done', 'failed']);
  const batch = await seed('独立批量文章', Array(5).fill('needs_vlm'));
  const legacy = await seed('独立历史文章', ['needs_vlm'], true);
  const unconfigured = await seed('独立未配置文章', ['needs_vlm']);
  const before = await readFile(main.file);
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const preload = path.join(root, 'block-external.mjs');
  await writeFile(preload, `const native = globalThis.fetch; globalThis.fetch = (...args) => {
    const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('External request blocked');
    return native(...args); };`);
  const uiOptions = { host: '127.0.0.1', port: 0, proxy: { '/api': base } };
  if (builtUi) {
    await readFile(path.join(builtUi, 'index.html'));
    ui = await preview({ configFile: false, envDir, build: { outDir: builtUi }, preview: uiOptions });
  } else {
    ui = await createViteServer({ configFile: false, plugins: [react()], envDir, server: uiOptions });
    await ui.listen();
  }
  evidence.frontend = builtUi ? 'production bundle' : 'development source';
  const uiBase = `http://127.0.0.1:${ui.httpServer.address().port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|NODE_OPTIONS$)/i.test(key)));
  Object.assign(env, { FMCG_PORT: String(port), FMCG_UI_ORIGIN: uiBase, FMCG_DATA_DIR: data, FMCG_LLM_CONFIG_FILE: path.join(root, 'missing.env'),
    FMCG_LLM_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, FMCG_LLM_MODEL: 'independent-fake',
    FMCG_LLM_API_KEY: 'synthetic-only', FMCG_NEWS_AI_ENABLED: 'false', NODE_ENV: 'test' });
  child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--import', 'tsx', 'server/index.ts'],
    { env: withoutInheritedEmbeddings(env), windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  await wait('API healthy', () => fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false));
  const api = async route => {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.doesNotMatch(JSON.stringify(await api(`/api/raw/${main.raw.id}/media`)), /DIRTY_|ocrRawText/u);
  const { chromium } = createRequire(import.meta.url)(path.join(os.homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ channel: 'msedge', args: ['--disable-background-networking', '--no-proxy-server'] });
  evidence.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400) evidence.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(uiBase) || url.startsWith('data:')) return route.continue();
    evidence.blocked.push(url);
    return route.abort();
  });
  await page.goto(uiBase);
  await page.getByRole('button', { name: 'Raw 原始资料', exact: true }).click();
  await page.getByText(main.raw.title, { exact: true }).click();
  await page.getByRole('heading', { name: main.raw.title, exact: true }).waitFor();
  const card = index => page.locator(`figure.raw-image-card[data-image-index="${index}"]`);
  const state = async (index, expected) => {
    await card(index).locator(`[data-media-status="${expected}"]`).waitFor();
  };
  await state(1, 'skipped');
  await state(2, 'ocr_ready');
  await state(3, 'needs_vlm');
  await state(4, 'vlm_done');
  await state(5, 'failed');
  assert.doesNotMatch(await page.locator('body').innerText(), /DIRTY_/u);
  assert.equal(requests.length, 0, 'Opening a page never calls a paid model');
  evidence.checks.push('read-only page and public API hide diagnostics');
  await card(2).getByText(/查看识别文字/u).click();
  assert.match(await card(2).innerText(), /清洗文字独立哨兵/u);
  await card(3).getByRole('button', { name: '精读此图', exact: true }).click();
  await card(3).getByRole('button', { name: '正在精读…', exact: true }).waitFor();
  assert.equal(await card(3).getByRole('button', { name: '正在精读…', exact: true }).isDisabled(), true);
  await state(3, 'vlm_done');
  assert.equal(requests.length, 1);
  await card(3).getByText('查看精读正文', { exact: true }).click();
  assert.equal(await card(3).locator('table').count(), 1);
  assert.equal(await card(3).locator('ol li').count(), 2);
  await card(3).getByText('置信度与警告', { exact: true }).click();
  assert.match(await card(3).innerText(), /右下角模糊/u);
  await card(5).getByRole('button', { name: '重试精读', exact: true }).click();
  await state(5, 'vlm_done');
  assert.equal(requests.length, 2);
  await card(4).getByRole('button', { name: '重新精读（重新调用模型）', exact: true }).click();
  await wait('force result', () => card(4).innerText().then(text => text.includes('独立精读摘要')));
  assert.equal(requests.length, 3);
  evidence.checks.push('single parse, disabled pending state, retry, force, rendered table/list/warnings');
  await card(1).getByText(skipReason, { exact: false }).waitFor();
  const manualUrl = `/api/raw/${main.raw.id}/media/${main.images[0].mediaId}`;
  const manualRequest = page.waitForRequest(request =>
    request.method() === 'POST' && request.url() === `${uiBase}${manualUrl}/parse-vlm`,
  );
  await card(1).getByRole('button', { name: '手动精读', exact: true }).click();
  assert.deepEqual((await manualRequest).postDataJSON(), { force: true });
  await state(1, 'vlm_done');
  assert.equal(requests.length, 4);
  assert.equal(requests[3].payload.image_index, 1);
  assert.equal(requests[3].payload.article_title, main.raw.title);
  assert.match(requests[3].wire.messages[0].content, /用户要求手动精读/u);
  assert.equal((await api(manualUrl)).decisionReason, skipReason);
  await card(1).getByText('查看精读正文', { exact: true }).click();
  assert.match(await card(1).innerText(), /独立结果图 1/u);
  evidence.checks.push('skipped card displays reason and explicit force sends one request for that image');
  const mainCount = requests.length;
  await page.reload();
  await page.getByRole('button', { name: 'Raw 原始资料', exact: true }).click();
  await page.getByText(main.raw.title, { exact: true }).click();
  await state(1, 'vlm_done');
  await state(3, 'vlm_done');
  await card(1).getByText(skipReason, { exact: false }).waitFor();
  await card(1).getByText('查看精读正文', { exact: true }).click();
  assert.match(await card(1).innerText(), /独立结果图 1/u);
  assert.equal(requests.length, mainCount);
  evidence.checks.push('refresh reloads manual result and original routing reason without model call');
  await page.getByText(batch.raw.title, { exact: true }).click();
  await page.getByRole('heading', { name: batch.raw.title, exact: true }).waitFor();
  await page.getByRole('button', { name: '批量精读待解析图片（5）', exact: true }).click();
  await state(1, 'vlm_done');
  await state(2, 'vlm_done');
  await state(3, 'failed');
  await state(4, 'vlm_done');
  await state(5, 'vlm_done');
  assert.ok(maximum >= 2 && maximum <= 3, `maximum concurrency ${maximum}`);
  assert.match(await card(3).innerText(), /失败|未完成/u);
  failImage = false;
  await card(3).getByRole('button', { name: '重试精读', exact: true }).click();
  await state(3, 'vlm_done');
  evidence.checks.push('5-image batch partial failure, max 3 parallel requests, successful retry');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  evidence.checks.push('390px viewport has no document overflow');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText(main.raw.title, { exact: true }).click();
  await state(3, 'vlm_done');
  await card(3).getByRole('button', { name: '重新精读（重新调用模型）', exact: true }).click();
  await page.getByText(legacy.raw.title, { exact: true }).click();
  await page.getByRole('heading', { name: legacy.raw.title, exact: true }).waitFor();
  await delay(800);
  assert.equal(await page.locator('[data-media-status]').count(), 0);
  assert.doesNotMatch(await page.locator('.raw-web-content').innerText(), /独立精读摘要|独立结果图/u);
  evidence.checks.push('switching Raw while request is pending never renders stale result');
  const stopped = once(child, 'close');
  child.kill();
  await stopped;
  delete env.FMCG_LLM_BASE_URL;
  delete env.FMCG_LLM_MODEL;
  delete env.FMCG_LLM_API_KEY;
  child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--import', 'tsx', 'server/index.ts'],
    { env: withoutInheritedEmbeddings(env), windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  await wait('unconfigured API healthy', () => fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false));
  const beforeNoConfig = requests.length;
  await page.getByText(unconfigured.raw.title, { exact: true }).click();
  await state(1, 'needs_vlm');
  await card(1).getByRole('button', { name: '精读此图', exact: true }).click();
  await wait('visible missing configuration', () => card(1).innerText().then(text => /未配置|尚未配置/u.test(text)));
  assert.equal(requests.length, beforeNoConfig);
  assert.equal((await api(`/api/raw/${unconfigured.raw.id}/media`)).items[0].routeStatus, 'needs_vlm');
  evidence.checks.push('missing provider configuration is visible and does not fake parsed success');
  assert.deepEqual(await readFile(main.file), before);
  assert.deepEqual(await readFile(imageFile), bytes);
  assert.equal((await store.getMediaArtifacts(legacy.raw.id)).length, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.httpErrors,
    [{ path: `/api/raw/${unconfigured.raw.id}/media/${unconfigured.images[0].mediaId}/parse-vlm`, status: 400 }]);
  assert.deepEqual(evidence.consoleErrors, ['Failed to load resource: the server responded with a status of 400 (Bad Request)']);
  evidence.checks.push('Raw and original image bytes unchanged; historical records not migrated');
  evidence.maximumConcurrent = maximum;
  evidence.requestCount = requests.length;
  evidence.preparedFixtures = [main.raw.title, batch.raw.title, legacy.raw.title];
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await ui?.close();
  if (child && child.exitCode === null) {
    const stopped = once(child, 'close');
    child.kill();
    await stopped;
  }
  await new Promise(resolve => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
