import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
const out = path.resolve(process.argv[3] ?? 'docs/reports/PDF01-R1-20261109-evidence');
await mkdir(out, {recursive:true});
const {chromium} = createRequire(import.meta.url)(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await chromium.launch({executablePath:path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'), args:['--no-proxy-server'], headless:true});
const page = await browser.newPage({viewport:{width:1536,height:1050}});
page.setDefaultTimeout(15000);
const evidence = {success:false, url:session.url, checks:[], screenshots:[], pageErrors:[], outside:[], posts:[]};
page.on('pageerror', error => evidence.pageErrors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  if (['http:','https:'].includes(url.protocol) && url.origin !== session.url) evidence.outside.push(url.origin);
  if (request.method() === 'POST' && url.pathname !== '/api/news/today/ensure') evidence.posts.push(url.pathname);
});
const api = async route => {
  const response = await fetch(session.api + route);
  assert(response.ok, await response.clone().text());
  return response;
};
const json = async route => (await api(route)).json();
const bytes = async route => Buffer.from(await (await api(route)).arrayBuffer());
const counters = () => json('/__control/counters');
const hash = data => createHash('sha256').update(data).digest('hex');
const button = name => page.getByRole('button', {name, exact:typeof name === 'string'});
const panel = () => page.getByRole('region', {name:'PDF 逐页阅读'});
const pdfBase = raw => `/api/raw/${encodeURIComponent(raw.id)}/pdf`;
const rawNav = () => page.locator('.nav-item').filter({hasText:'Raw 原始资料'}).click();
const shot = async (name, section) => {
  if (section) await section.scrollIntoViewIfNeeded();
  const target = path.join(out, `builder-${name}.png`);
  await page.screenshot({path:target});
  evidence.screenshots.push(target);
};
const post = async (route, name, accepted) => {
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === route);
  await button(name).click();
  const response = await pending;
  const data = await response.json();
  assert(accepted.includes(response.status()), JSON.stringify(data));
  return data;
};
const upload = async (file, saveLabel, screenshot) => {
  await button(/导入资料/).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', {name:/上传文件/}).click();
  await dialog.locator('input[type=file]').setInputFiles(file);
  if (screenshot) await shot(screenshot);
  const response = await post('/api/raw/import', saveLabel, [201]);
  assert.equal(response.kind, 'file');
  return response.raw;
};
const image = async number => {
  const image = panel().getByRole('img', {name:`PDF 第 ${number} 页`,exact:true});
  await image.waitFor();
  await image.evaluate(element => element.decode());
  assert(await image.evaluate(element => element.naturalWidth > 100 && element.naturalHeight > 100));
  assert.equal(await panel().locator('img').count(), 1);
};

try {
  await page.goto(session.url, {waitUntil:'domcontentloaded'});
  await page.locator('.home-entry-grid').waitFor();
  await rawNav();
  const scan = await upload(session.fixtures.scan, '保存并生成 Wiki 草稿', '01-import-scan');
  assert.equal(scan.body, '');
  assert.equal(scan.pdf.hasTextLayer, false);
  await page.getByText('导入成功：扫描 PDF 原件已保存', {exact:true}).waitFor();
  await shot('02-scan-saved');
  await button('查看 PDF 页面').click();
  await image(1);
  await panel().getByText('本页没有可提取的文字层。', {exact:true}).waitFor();
  await page.getByText('此 PDF 没有文字层，无法从正文生成 Wiki 草稿。', {exact:true}).waitFor();
  assert.equal(await button('整理到知识库').count(), 0);
  const scanPdf = await json(pdfBase(scan));
  assert.equal(scanPdf.job, null);
  assert.deepEqual(await bytes(scanPdf.originalUrl), await readFile(session.fixtures.scan));
  await shot('03-scan-page-original', panel());
  assert.deepEqual(await counters(), {modelCalls:[],legacyCalls:[],realProviderCalls:0});
  evidence.checks.push('扫描件保存原始字节，正文空，原页可读，旧整理和模型调用均为零');

  const mixed = await upload(session.fixtures.mixed, '仅保存 Raw');
  assert.equal(mixed.pdf.pageCount, 3);
  assert.match(mixed.body, /Signed stores: 56/);
  await button('查看这条资料').click();
  await image(1);
  await panel().getByRole('region', {name:'本页文字层'}).getByText(/Signed stores: 56/).waitFor();
  await button('下一页').click();
  await image(2);
  await panel().getByText('本页没有可提取的文字层。', {exact:true}).waitFor();
  await shot('04-mixed-raster-page', panel());
  await panel().getByRole('combobox', {name:'PDF 页码'}).selectOption('3');
  await image(3);
  await panel().getByRole('region', {name:'本页文字层'}).getByText('Vector channel chart', {exact:true}).waitFor();
  assert.equal((await counters()).modelCalls.length, 0);
  const mixedBase = pdfBase(mixed);
  const before = await json(mixedBase);
  assert.equal(before.assetSha256, hash(await readFile(session.fixtures.mixed)));
  assert.deepEqual(await bytes(before.originalUrl), await readFile(session.fixtures.mixed));
  await shot('05-vector-before-ai', panel());
  evidence.checks.push('混合 PDF 单页切换可读原生文字、扫描像素和真实矢量图，浏览不请求模型');

  const submitted = await post(`${mixedBase}/understand`, '开始 AI 页理解', [202]);
  assert(['queued','running'].includes(submitted.job.status));
  await panel().getByRole('status').filter({hasText:/等待理解|正在理解/}).waitFor();
  await shot('06-running', panel());
  await panel().getByRole('status').filter({hasText:'页理解未完成 · 1/3 页'}).waitFor();
  await panel().getByRole('alert').filter({hasText:'第 2 页'}).waitFor();
  await panel().getByRole('combobox', {name:'PDF 页码'}).selectOption('1');
  await panel().getByText('第 1 页合成内容', {exact:true}).waitFor();
  await shot('07-failed-retained', panel());
  assert.deepEqual((await counters()).modelCalls.map(item => item.page), [1,2]);

  await page.reload({waitUntil:'domcontentloaded'});
  await rawNav();
  if (!(await panel().isVisible())) await page.locator('.raw-list-item').filter({hasText:mixed.title}).click();
  await panel().getByRole('status').filter({hasText:'页理解未完成 · 1/3 页'}).waitFor();
  await panel().getByText('第 1 页合成内容', {exact:true}).waitFor();
  assert.deepEqual((await counters()).modelCalls.map(item => item.page), [1,2]);
  await post(`${mixedBase}/understand`, '继续 AI 页理解', [202]);
  await panel().getByRole('status').filter({hasText:'整份 PDF 已完成页理解 · 3/3 页'}).waitFor();
  await panel().getByRole('combobox', {name:'PDF 页码'}).selectOption('3');
  await image(3);
  const result = panel().getByRole('region', {name:'本页 AI 理解'});
  await result.getByText('三根彩色柱形，显示合成矢量图。', {exact:true}).waitFor();
  await result.getByRole('heading', {name:'推断',exact:true}).waitFor();
  const originalLink = panel().getByRole('link', {name:'在原 PDF 中打开第 3 页'});
  assert.equal(await originalLink.getAttribute('href'), `${before.originalUrl}#page=3`);
  await shot('08-complete-vector-and-ai', panel());
  const originalResponse = page.context().waitForEvent('response', response => new URL(response.url()).pathname === before.originalUrl);
  const originalPopup = page.waitForEvent('popup');
  await originalLink.click();
  const [opened, response] = await Promise.all([originalPopup, originalResponse]);
  assert.match(response.headers()['content-type'], /^application\/pdf/);
  assert.match(response.headers()['content-disposition'], /^inline\b/);
  assert.equal(new URL(opened.url()).hash, '#page=3');
  await opened.close();
  const after = await json(mixedBase);
  const finalCounters = await counters();
  assert.deepEqual(finalCounters.modelCalls.map(item => item.page), [1,2,2,3]);
  assert.equal(finalCounters.modelCalls[1].text, '');
  assert.match(finalCounters.modelCalls[3].text, /Vector channel chart/);
  for (const call of finalCounters.modelCalls) {
    assert.equal(call.imageSha, hash(await bytes(after.pages.find(item => item.page === call.page).imageUrl)));
  }
  assert.deepEqual(finalCounters.legacyCalls, []);
  assert.equal(finalCounters.realProviderCalls, 0);
  assert.equal(after.assetSha256, before.assetSha256);
  assert.deepEqual(await bytes(after.originalUrl), await readFile(session.fixtures.mixed));
  const rawAfter = await json(`/api/raw/${encodeURIComponent(mixed.id)}`);
  assert.equal(rawAfter.body, mixed.body);
  assert.deepEqual(evidence.posts, ['/api/raw/import','/api/raw/import',`${mixedBase}/understand`,`${mixedBase}/understand`]);
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.outside, []);
  evidence.checks.push('第 2 页失败后重载零调用，显式继续只请求剩余两页，三页全部完成');
  evidence.checks.push('模型收到同一页的真实 PNG 和文字，图表与推断独立展示，原文和原件保持原样');
  evidence.raws = {scan:scan.id,mixed:mixed.id};
  evidence.counters = finalCounters;
  evidence.success = true;
} catch (error) {
  evidence.failure = error.stack ?? String(error);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, 'builder-browser-result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
}
