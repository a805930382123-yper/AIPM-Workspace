import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer } from 'vite';
import { RawStore } from '../../services/raw/store.ts';
import { identifyWebImages } from '../../services/raw/web-material.ts';
import { evaluateImageOcr } from '../../services/raw/media-ocr-triage.ts';

// Independent browser acceptance. No production data, provider, or user service.
const root = await mkdtemp(path.join(os.tmpdir(), 'aipm-rawocr04-browser-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'empty-env');
await mkdir(envDir);
const evidence = { checks: [], pageErrors: [], consoleErrors: [], blocked: [], providerCalls: 0 };
const provider = createServer((req, res) => { evidence.providerCalls++; res.writeHead(500); res.end(); });
provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
let child, ui, browser;
const wait = async (label, fn) => {
  for (let i = 0; i < 600; i++) { if (await fn()) return; await delay(100); }
  assert.fail('Timed out: ' + label);
};
try {
  const store = new RawStore(data); await store.initialize();
  const canvas = createCanvas(900, 350), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 900, 350); ctx.fillStyle = 'black'; ctx.font = '32px Arial';
  ctx.fillText('Independent migration source document', 25, 100);
  ctx.fillText('Preserve original image and body bytes', 25, 180);
  const bytes = canvas.toBuffer('image/png');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const imageFile = path.join(data, 'knowledge/raw/web-images', sha256);
  await mkdir(path.dirname(imageFile), { recursive: true }); await writeFile(imageFile, bytes);
  const marker = '【来源图片 1】';
  const oldBody = '图前正文😃。\n' + marker + '\n【图片 OCR 转录（需核对）】\nDIRTY_OLD_SENTINEL\n【转录结束】\n图后正文。';
  async function seed(title, change, body = oldBody) {
    let raw = await store.create({ title, sourceType: 'article', sourceName: 'synthetic browser review', tags: [], body,
      webImages: [{ start: body.indexOf(marker), sourceUrl: 'https://example.invalid/source.png', label: '', status: 'transcribed', mime: 'image/png', sha256 }] });
    if (change) { await store.updateBody(raw.id, { body: change(raw.body), expectedBodySha256: raw.bodySha256, expectedBodyRevision: 0 }, async () => {}); raw = await store.get(raw.id); }
    return raw;
  }
  const normal = await seed('浏览器历史原文');
  const edited = await seed('浏览器人工修订', body => '人工新增前言。\n' + body.replace('DIRTY_OLD_SENTINEL', 'DIRTY_EDITED_SENTINEL'));
  const removed = await seed('浏览器已删图', body => body.replace(marker, ''));
  const duplicate = await seed('浏览器重复图', body => body + '\n' + marker);
  const fenced = await seed('浏览器围栏示例', body => body.replace(marker, '```text\n' + marker + '\n```'));
  const retained = await seed('浏览器保留代码示例', undefined, oldBody + '\n```text\n【图片 OCR 转录（需核对）】\nPRESERVED_CODE_EXAMPLE\n【转录结束】\n```');
  const current = await seed('浏览器现行图片', undefined, '现行正文。\n' + marker + '\n结尾。');
  const media = identifyWebImages(current.id, current.webImages)[0];
  await store.saveMediaArtifact(current.id, media.mediaId, { ...evaluateImageOcr({ width: 900, height: 350, lines: [{ text: 'Current clean independent text' }] }), routeStatus: 'ocr_ready', ocrRawText: 'PRIVATE_CURRENT', ocrCleanText: 'CURRENT_CLEAN_SENTINEL' });
  const raws = [normal, edited, removed, duplicate, fenced, retained, current];
  const baseline = await Promise.all(raws.map(raw => readFile(path.join(data, 'knowledge/raw/articles', raw.id + '.md'))));
  const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r));
  const base = 'http://127.0.0.1:' + port;
  const preload = path.join(root, 'block-external.mjs');
  await writeFile(preload, `const native = globalThis.fetch; globalThis.fetch = (...args) => { const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0])); if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('External request blocked'); return native(...args); };`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|NODE_OPTIONS$)/i.test(key)));
  Object.assign(env, { FMCG_PORT: String(port), FMCG_DATA_DIR: data, FMCG_LLM_CONFIG_FILE: path.join(root, 'missing.env'), FMCG_LLM_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, FMCG_LLM_MODEL: 'synthetic-only', FMCG_LLM_API_KEY: 'synthetic-only', FMCG_NEWS_AI_ENABLED: 'false', NODE_ENV: 'test' });
  if (process.env.FMCG_TESSERACT_PATH) env.FMCG_TESSERACT_PATH = process.env.FMCG_TESSERACT_PATH;
  child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--import', 'tsx', 'server/index.ts'], { env: withoutInheritedEmbeddings(env), windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  await wait('API health', () => fetch(base + '/api/health', { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false));
  const api = async route => { const r = await fetch(base + route); assert.equal(r.status, 200); return r.json(); };
  ui = await createViteServer({ configFile: false, plugins: [react()], envDir, server: { host: '127.0.0.1', port: 0, proxy: { '/api': base } } }); await ui.listen();
  const uiBase = 'http://127.0.0.1:' + ui.httpServer.address().port;
  const { chromium } = createRequire(import.meta.url)(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ channel: 'msedge', args: ['--disable-background-networking', '--no-proxy-server'] }); evidence.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push(message.text()); });
  await page.route('**/*', route => { const url = route.request().url(); if (url.startsWith(uiBase) || url.startsWith('data:')) return route.continue(); evidence.blocked.push(url); return route.abort(); });
  async function open(raw, reload = false) {
    if (reload) { await page.goto(uiBase); await page.getByRole('button', { name: 'Raw 原始资料', exact: true }).click(); }
    await page.locator('.raw-list-panel').getByText(raw.title, { exact: true }).click(); await page.getByRole('heading', { name: raw.title, exact: true }).waitFor();
    await wait('reading projection ready', () => page.locator('.raw-web-content').innerText().then(t => t.includes('图片解析与原始正文分别保存')));
  }
  await open(normal, true);
  assert.doesNotMatch(await page.locator('.raw-web-content').innerText(), /DIRTY_/);
  assert.equal(await page.locator('[data-media-status]').count(), 0);
  evidence.checks.push('Before migration: legacy OCR hidden and no fake derivative');
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, '--import', 'tsx', 'scripts/migrate-raw-media.ts', '--data-dir', data, '--all', '--apply'], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 });
  assert.ifError(run.error); assert.equal(run.status, 0, run.stdout + run.stderr); evidence.cli = run.stdout;
  for (const raw of raws) {
    console.log('Checking ' + raw.title);
    await open(raw, true);
    const text = await page.locator('.raw-web-content').innerText(); assert.doesNotMatch(text, /DIRTY_|PRIVATE_CURRENT/);
    const eligible = [normal, edited, retained, current].some(r => r.id === raw.id);
    assert.equal(await page.locator('figure.raw-image-card').count(), eligible ? 1 : 0, raw.title);
    if (eligible) {
      await page.locator('[data-media-status="ocr_ready"]').waitFor();
      assert.equal(await page.locator('figure img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
      await page.getByText(/查看识别文字/).click();
      assert.match(await page.locator('figure').innerText(), raw.id === current.id ? /CURRENT_CLEAN_SENTINEL/ : /Independent migration/i);
    }
    if (raw.id === retained.id) assert.match(text, /PRESERVED_CODE_EXAMPLE/);
    await page.getByRole('button', { name: '编辑原文', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: '编辑原文', exact: true }).locator('textarea').inputValue(), raw.body);
    await page.getByRole('button', { name: '关闭原文编辑', exact: true }).click();
    evidence.checks.push(raw.title + ': reading, current anchor, editor bytes');
    const json = await api(`/api/raw/${raw.id}/media`); assert.doesNotMatch(JSON.stringify(json), /ocrRawText|DIRTY_|PRIVATE_CURRENT/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  // Exercise the real RawPage citation prop in-browser, without changing product files or mocking APIs.
  const quote = 'DIRTY_OLD_SENTINEL', start = normal.body.indexOf(quote);
  await page.evaluate(async ({ raw, quote, start }) => {
    const React = await import('/node_modules/.vite/deps/react.js');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = client.createRoot ?? client.default.createRoot;
    const { RawPage } = await import('/app/pages/RawPage.tsx');
    document.getElementById('root').style.display = 'none';
    const mount = document.createElement('div'); mount.id = 'citation-probe'; document.body.append(mount);
    const noop = () => {};
    createRoot(mount).render((React.createElement ?? React.default.createElement)(RawPage, { items: [raw], selectedId: raw.id, initialCitation: { rawId: raw.id, quote, start, end: start + quote.length, bodySha256: raw.bodySha256 }, processing: {}, job: null, openImport: false, onSelected: noop, onOpenImport: noop, onCommitted: async () => {}, onCloseImport: noop, onDeleted: async () => {}, onJobStarted: noop, onOpenDraft: noop, onRefresh: async () => {} }));
  }, { raw: normal, quote, start });
  await page.locator('#citation-probe mark').waitFor();
  assert.equal(await page.locator('#citation-probe mark').innerText(), quote);
  assert.equal(await page.locator('#citation-probe mark').getAttribute('data-citation-start'), String(start));
  assert.equal(await page.locator('#citation-probe pre.raw-body').textContent(), normal.body);
  evidence.checks.push('Real RawPage citation mode preserves complete source body and exact original coordinates; narrow layout no overflow');
  for (const [i, raw] of raws.entries()) assert.deepEqual(await readFile(path.join(data, 'knowledge/raw/articles', raw.id + '.md')), baseline[i]);
  assert.deepEqual(await readFile(imageFile), bytes);
  assert.equal(evidence.providerCalls, 0); assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.consoleErrors, []); assert.deepEqual(evidence.blocked, []);
  console.log(JSON.stringify({ result: 'PASS', ...evidence }));
} finally {
  await browser?.close(); await ui?.close();
  if (child && child.exitCode === null) { const stopped = once(child, 'close'); child.kill(); await stopped; }
  await new Promise(resolve => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
