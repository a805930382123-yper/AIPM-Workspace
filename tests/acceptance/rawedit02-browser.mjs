import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { setup, listen, close, sha, rawPath, draftPath } from './rawedit02-fixture.mjs';

const out = path.resolve(process.argv[2] ?? 'docs/reports/RAWEDIT02-20261114-builder-evidence');
await mkdir(out, { recursive: true });
const report = { success: false, steps: [], screenshots: [], external: [], pageErrors: [], writes: [] };
const pass = name => { report.steps.push(name); console.log('PASS ' + name); };
let fixture, frontend, browser, page;
try {
  fixture = await setup(report);
  const { root, envDir, apiOrigin, api, request, edit, rawFile, snapshot,
    standard, standardDraft, formal, deferredRaw, deferredDraft, url: urlRaw, translated, rawPdf, pdfBytes, bridged, meeting } = fixture;
  const dist = path.join(root, 'dist');
  await build({ configFile: false, root: process.cwd(), envDir, plugins: [react()], build: { outDir: dist, emptyOutDir: true } });
  report.emptyEnvBuild = true;
  const config = await api('/api/llm/config');
  assert(!config.configured && !config.keyConfigured);
  report.providerConfigured = false;
  const app = express();
  app.use('/api/news', (_req, res) => res.sendStatus(503));
  const upstreamPort = new URL(apiOrigin).port;
  app.use('/api', (req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.originalUrl,
      method: req.method, headers: { ...req.headers, host: '127.0.0.1:' + upstreamPort } }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => res.sendStatus(502));
    req.pipe(upstream);
  });
  app.use(express.static(dist));
  frontend = http.createServer(app);
  const origin = 'http://127.0.0.1:' + await listen(frontend);
  report.services.uiOrigin = origin;
  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const executablePath = [path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')].find(existsSync);
  assert(executablePath, 'Chrome installation required');
  browser = await chromium.launch({ executablePath, args: ['--no-proxy-server'], headless: true });
  page = await browser.newPage({ viewport: { width: 1536, height: 1050 } });
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (/^https?:$/u.test(url.protocol) && url.origin !== origin) {
      report.external.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith('/api') && !url.pathname.startsWith('/api/news/') && !['GET', 'HEAD'].includes(request.method())) {
      report.writes.push([request.method(), url.pathname]);
    }
    return route.continue();
  });
  const button = (name, root = page) => root.getByRole('button', { name, exact: true });
  const editor = () => page.getByRole('dialog', { name: '编辑原文', exact: true });
  const history = () => page.getByRole('dialog', { name: '原文修改历史', exact: true });
  const field = () => editor().getByRole('textbox', { name: '原文正文', exact: true });
  const save = () => button('保存原文', editor()).click();
  const read = raw => api(rawPath(raw));
  const open = async raw => {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').getByRole('button', { name: /Raw/u }).click();
    await page.locator('.raw-list-panel').getByRole('button', { name: new RegExp(raw.title) }).click();
    await page.getByRole('heading', { name: raw.title, exact: true }).waitFor();
  };
  const screenshot = async (name, target) => {
    await target.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, name + '.png') });
    report.screenshots.push(name + '.png');
  };
  const wikiBefore = await api('/api/wiki');

  await open(standard);
  const bytesBefore = await readFile(rawFile(standard));
  await button('编辑原文').click();
  assert.equal(await field().inputValue(), standard.body);
  await field().fill('未提交的取消内容。');
  await button('取消', editor()).click();
  assert.deepEqual(await readFile(rawFile(standard)), bytesBefore);
  await assert.rejects(readFile(snapshot(standard, 0)), { code: 'ENOENT' });
  assert.deepEqual(report.writes, []);
  pass('App edit prefilled; cancel makes zero HTTP mutations and zero writes');

  const revised = '人工校订：覆盖 16 家门店。\n新增审核记录。';
  await button('编辑原文').click();
  await field().fill(revised);
  await screenshot('01-original-editor', editor());
  await page.route('**' + rawPath(standard) + '/body', route => route.fulfill({
    status: 503, json: { error: { code: 'FIXTURE_SAVE', message: '模拟保存失败，请重试。' } },
  }), { times: 1 });
  await save();
  await editor().getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
  assert.equal(await field().inputValue(), revised);
  assert.deepEqual(await readFile(rawFile(standard)), bytesBefore);
  await page.route('**/api/raw', route => route.fulfill({
    status: 503, json: { error: { code: 'FIXTURE_READ', message: '模拟父列表刷新失败。' } },
  }), { times: 1 });
  await save();
  await page.getByText('原文已保存，修改前的版本已保留。', { exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: '模拟父列表刷新失败。' }).waitFor();
  assert.equal(await page.locator('.raw-body').textContent(), revised);
  await button('编辑原文').click();
  assert.equal(await field().inputValue(), revised);
  await button('取消', editor()).click();
  await open(standard);
  assert.equal(await page.locator('.raw-body').textContent(), revised);
  await button('查看原文修改历史').click();
  await history().getByRole('heading', { name: '导入时的原文' }).waitFor();
  await history().locator('.raw-body').waitFor();
  assert.equal(await history().locator('.raw-body').textContent(), standard.body);
  await screenshot('02-original-history', history());
  await button('关闭修改历史', history()).click();
  pass('503 preserves edited input; retry updates parent immediately despite GET 503; reload and history match disk');

  const base = await read(standard);
  await button('编辑原文').click();
  const currentDraft = standard.body + '\n我在冲突后保留的编辑。';
  const concurrently = '另一个会话已保存的新正文。';
  await field().fill(currentDraft);
  await edit(base, concurrently);
  const conflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(rawPath(standard) + '/body'));
  await save();
  assert.equal((await conflict).status(), 409);
  await editor().getByRole('alert').filter({ hasText: '原文已被修改' }).waitFor();
  assert.equal(await field().inputValue(), currentDraft);
  assert(await button('保存原文', editor()).isDisabled());
  await button('读取最新原文', editor()).click();
  const latest = editor().getByRole('textbox', { name: '最新原文正文', exact: true });
  await latest.waitFor();
  assert.equal(await latest.inputValue(), concurrently);
  await screenshot('03-conflict-preserves-text', editor());
  await button('已核对，保留我的编辑', editor()).click();
  await save();
  await page.getByText('原文已保存，修改前的版本已保留。', { exact: true }).waitFor();
  assert.equal((await read(standard)).body, currentDraft);
  await button('查看旧草稿').click();
  await page.getByRole('heading', { name: '整理成果', exact: true }).waitFor();
  await page.getByText('原始正文已变化，请根据当前资料重新整理。', { exact: true }).waitFor();
  assert.equal((await api(draftPath(standardDraft))).preview.rawSha256Matches, false);
  assert(await page.getByRole('button', { name: /确认.*入库/u }).first().isDisabled());
  const card = page.getByRole('article', {name:'成果 ' + standardDraft.pages[0].title,exact:true});
  await card.getByText(/阅读完整主题成果/u).click();
  await card.getByText('原文引用与位置', {exact:true}).click();
  await card.getByRole('button', {name:/打开原句/u}).first().click();
  await page.getByText('引用位置或原文版本已变化，未标记旧位置。', {exact:true}).waitFor();
  assert.equal(await page.locator('.raw-body mark').count(), 0);
  pass('Real 409 preserves input; explicit latest review permits retry; old draft cannot confirm or falsely mark matching text');

  await open(deferredRaw);
  await button('编辑原文').click();
  await field().fill('暂缓后人工校订。');
  await save();
  await button('查看旧草稿').click();
  await page.getByText('原始正文已变化，请根据当前资料重新整理。', { exact: true }).waitFor();
  assert.equal(await button('继续处理').count(), 0);
  await button('全部不采纳').click();
  await button('取消').click();
  assert.equal((await api(draftPath(deferredDraft))).status, 'pending_confirmation');
  await button('全部不采纳').click();
  await button('确认全部不采纳').click();
  await page.getByText('本次成果全部不采纳，已保留整理历史。', {exact:true}).waitFor();
  assert.equal((await api(draftPath(deferredDraft))).status, 'discarded');
  await button('返回').click();
  await button('整理到知识库').waitFor();
  pass('Invalid deferred result can be explicitly dismissed; cancel keeps it; normal text processing is then available');

  await open(rawPdf);
  await page.getByRole('heading', { name: 'PDF 逐页阅读', exact: true }).waitFor();
  await button('编辑原文').click();
  await editor().getByText(/编辑的是提取文字，PDF 原件未改/u).waitFor();
  await field().fill('人工订正 PDF 文字，原文件继续保留。');
  await save();
  await page.getByText(/PDF 提取文字已人工修改，PDF 原件未改/u).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'PDF 逐页阅读', exact: true }).count(), 0);
  const originalLink = page.getByRole('link', { name: '打开 PDF 原件', exact: true });
  const href = await originalLink.getAttribute('href');
  assert.equal(href, rawPath(rawPdf) + '/pdf/original#page=1');
  const original = await request(href.split('#')[0]);
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), pdfBytes);
  await screenshot('04-pdf-original-remains-readable', page.getByRole('region', { name: 'PDF 原件', exact: true }));
  report.pdfOriginalSha256 = sha(pdfBytes);
  pass('PDF text clearly distinguished; stale page UI removed; original link returns unchanged PDF');

  await open(urlRaw);
  await page.getByText('AI 中文译文', { exact: true }).waitFor();
  assert.equal(await page.locator('.raw-body').textContent(), translated.body);
  await button('编辑原文').click();
  assert.equal(await field().inputValue(), urlRaw.body);
  await field().fill('人工修改后的链接原文。');
  await save();
  await page.getByText(/译文对应的原文版本已变化/u).waitFor();
  assert.equal(await page.getByText('AI 中文译文', { exact: true }).count(), 0);
  assert.equal(await page.locator('.raw-body').textContent(), '人工修改后的链接原文。');
  await open(bridged);
  assert.equal(await button('编辑原文').count(), 0);
  await page.getByText(/请在会议档案编辑纪要工作副本/u).waitFor();
  await open(meeting);
  await button('编辑原文').click();
  await field().fill('人工修改普通会议记录。');
  await save();
  await page.getByText('人工修改普通会议记录。', { exact: true }).waitFor();
  assert.equal((await read(formal)).body, formal.body);
  assert.deepEqual(await api('/api/wiki'), wikiBefore);
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.fakeHttpCalls, []);
  assert.equal(report.writes.filter(([method,url]) => method === 'POST' && url === draftPath(deferredDraft) + '/finish').length, 1);
  assert(report.writes.every(([method, url]) => (method === 'PATCH' && url.endsWith('/body')) || (method === 'POST' && url === draftPath(deferredDraft) + '/finish')));
  pass('Prior translation hidden; linked meeting edit unavailable; ordinary meeting editable; no AI, Wiki or external writes');
  report.success = true;
} catch (error) {
  report.error = error.stack;
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  try {
    const cleanup = await Promise.allSettled([browser?.close(), frontend?.listening ? close(frontend) : undefined, fixture?.stop()]);
    report.cleanup = { ...report.cleanup, browserClosed: !browser?.isConnected(), frontendClosed: !frontend?.listening };
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
  } finally { await writeFile(path.join(out, 'browser-result.json'), JSON.stringify(report, null, 2)); }
}
