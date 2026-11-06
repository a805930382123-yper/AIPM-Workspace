import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { build, preview } from 'vite';
import { RawStore } from '../../services/raw/store.ts';

const cache = path.resolve('node_modules/.cache/work01-builder');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'chrome-'));
const evidence = path.resolve(process.env.WORK01_BUILDER_EVIDENCE ?? path.join(root, 'evidence'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'empty-env');
const config = path.join(root, 'empty.env');
await Promise.all([mkdir(envDir), mkdir(evidence, { recursive: true }), writeFile(config, '')]);

const raws = new RawStore(data);
await raws.initialize();
const raw = await raws.create({ title: '合成 · 巡店问题来源', sourceType: 'customer', sourceName: 'WORK01 合成资料', tags: [],
  body: 'The customer reports that the route filter clears after refresh.',
  url: 'https://example.invalid/work01', urlImport: { finalUrl: 'https://example.invalid/work01', fetchedAt: '2026-11-06T01:00:00Z', parser: 'html', note: '合成测试资料' } });
await raws.create({ title: '合成 · 另一份 Raw', sourceType: 'note', sourceName: 'WORK01 合成资料', tags: [], body: '不能误跳到这条资料。' });

const freePort = async () => {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const apiPort = await freePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const apiChild = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true, stdio: 'inherit',
  env: { ...cleanEnv, FMCG_DATA_DIR: data, FMCG_PORT: String(apiPort), FMCG_LLM_CONFIG_FILE: config } });
const stopped = once(apiChild, 'exit');
const request = async (route, { method = 'GET', body } = {}) => {
  const response = await fetch(`${apiBase}${route}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' } });
  assert.ok(response.ok, `${method} ${route}: ${response.status}`);
  return response.json();
};
const poll = async (fn, message) => {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  assert.fail(message);
};

const playwright = createRequire(import.meta.url)(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const executablePath = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe');
let ui, browser;
try {
  await poll(() => request('/api/health').catch(() => null), 'API did not start');
  const vite = { envDir, build: { outDir: path.join(root, 'dist') }, server: { proxy: { '/api': apiBase } } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: await freePort(), strictPort: true } });
  const base = `http://127.0.0.1:${ui.httpServer.address().port}`;
  browser = await playwright.chromium.launch({ executablePath, args: ['--no-proxy-server'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const heading = (name, scope = page) => scope.getByRole('heading', { name, exact: true });
  const nav = name => button(name, page.getByRole('navigation', { name: '主导航' })).click();
  const capture = name => page.screenshot({ path: path.join(evidence, `${name}.png`) });
  const due = page.getByRole('region', { name: '到期跟进', exact: true });
  const current = page.getByRole('region', { name: '当前情况', exact: true });
  const history = page.getByRole('region', { name: '处理记录', exact: true });
  const materials = page.getByRole('region', { name: '资料与成果', exact: true });
  const title = '合成 · 巡店路线筛选重置';
  const original = '客户反馈，巡店页面刷新后已选路线消失。';
  const draft = '在合成账号中选中华东路线并刷新，筛选恢复为空。请排查筛选持久化。';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const followUp = current.getByLabel('跟进日期（选填）');
  const saveCurrent = async () => {
    await button('保存当前情况', current).click();
    await current.getByText('当前情况已保存。', { exact: true }).waitFor();
  };
  const addRecord = async (kind, body, outcome) => {
    await history.getByLabel('记录类型').selectOption(kind);
    if (outcome) await history.getByLabel('复测结果', { exact: true }).selectOption(outcome);
    await history.getByLabel('记录内容').fill(body);
    await button('保存处理记录', history).click();
    await history.getByText(body, { exact: true }).waitFor();
  };
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await due.getByText('暂无到期的工作事项。').waitFor();
  await nav('工作事项');
  await page.getByText('还没有工作事项。', { exact: false }).waitFor();
  await button('新建客户问题').click();
  await page.getByLabel('问题标题').fill(title);
  await page.getByLabel('客户反馈').fill(original);
  await button('创建事项').click();
  await heading(title).waitFor();
  assert.equal(await current.getByLabel('状态', { exact: true }).inputValue(), 'triage');
  const [created] = (await request('/api/work-items')).items;
  const itemRoute = `/api/work-items/${created.id}`;

  await current.getByLabel('状态', { exact: true }).selectOption('waiting');
  await current.getByText('可以设置跟进日期', { exact: false }).waitFor();
  await current.getByLabel('等谁／等什么（选填）').fill('等技术同事回传修复版本');
  await current.getByLabel('下一步（选填）').fill('收到版本后按客户路线复测');
  await current.getByLabel('客户（选填）').fill('合成客户 · 华东门店');
  await current.getByLabel('项目（选填）').fill('合成项目 · 巡店助手');
  await current.getByLabel('发生时间（选填，上海时间）').fill('2026-11-06T09:30');
  await saveCurrent();
  assert.equal((await request(itemRoute)).followUpOn, undefined);
  assert.equal((await request(itemRoute)).occurredAt, '2026-11-06T01:30:00.000Z');
  await followUp.fill(today);
  await saveCurrent();
  await capture('01-current-desktop');
  await nav('首页');
  const action = due.getByRole('article', { name: title, exact: true });
  await action.getByText(today, { exact: true }).waitFor();
  await capture('02-home-due-desktop');
  await button('查看事项', action).click();
  await heading(title).waitFor();
  assert.equal(await current.getByLabel('下一步（选填）').inputValue(), '收到版本后按客户路线复测');
  assert.equal(await current.getByLabel('客户（选填）').inputValue(), '合成客户 · 华东门店');
  assert.equal(await current.getByLabel('项目（选填）').inputValue(), '合成项目 · 巡店助手');
  await history.getByText(original, { exact: true }).waitFor();
  await addRecord('feedback', '客户补充，切换门店后也会清空。');
  await addRecord('reproduction', '选择路线，刷新列表后筛选消失。');
  await history.getByLabel('技术反馈正文', { exact: true }).fill(draft);
  await button('保存正文', history).click();
  await history.getByText('技术反馈正文已保存。').waitFor();
  await button('复制正文', history).click();
  await history.getByText('正文已复制。').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), draft);
  assert.equal((await request(itemRoute)).history.some(entry => entry.kind === 'sent'), false);
  await button('记录已发送', history).click();
  await history.getByLabel('实际发送时间（上海时间）').fill('2026-11-06T11:15');
  await button('确认记录已发送', history).click();
  await heading('已发送技术反馈', history).waitFor();
  await addRecord('technical_reply', '技术同事已给出测试版本，待客户现场验证。');
  assert.equal((await request(itemRoute)).history.some(entry => entry.kind === 'retest'), false);
  await addRecord('retest', '新版刷新后保留路线筛选。', 'passed');
  await heading('复测记录 通过', history).waitFor();
  await heading('处理记录').scrollIntoViewIfNeeded();
  await capture('03-history-desktop');

  await materials.getByLabel('选择已有 Raw').selectOption(raw.id);
  await button('添加关联', materials).click();
  await materials.getByText('已关联 Raw。').waitFor();
  const sample = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F6F7FB';
    ctx.fillRect(0, 0, 640, 240);
    ctx.fillStyle = '#172033';
    ctx.font = '28px sans-serif';
    ctx.fillText('合成 · 巡店筛选复测', 28, 70);
    ctx.font = '20px sans-serif';
    ctx.fillText('刷新后保留「华东路线」筛选', 28, 122);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await materials.getByLabel('截图文件').setInputFiles({ name: 'synthetic-route.png', mimeType: 'image/png', buffer: Buffer.from(sample, 'base64') });
  await materials.getByLabel('截图说明（选填）').fill('合成截图：复测环境中刷新后筛选仍保留。');
  await button('上传截图', materials).click();
  await materials.getByText('截图已保存。').waitFor();
  const screenshot = materials.getByRole('img');
  await poll(() => screenshot.evaluate(image => image.complete && image.naturalWidth === 640), 'saved screenshot did not render');
  const popupPromise = page.waitForEvent('popup');
  await materials.getByRole('link', { name: /打开截图/ }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.match(popup.url(), /\/screenshots\//);
  await popup.close();
  await heading('资料与成果').scrollIntoViewIfNeeded();
  await capture('04-materials-desktop');

  const translationPath = `**/api/raw/${raw.id}/translation`;
  await page.route(translationPath, route => route.fulfill({ json: { translation: { rawId: raw.id, rawSha256: raw.bodySha256, status: 'completed', body: '合成中文译文。' } } }));
  await button(`${raw.title} · 查看原文`, materials).click();
  await page.locator('.raw-body').filter({ hasText: raw.body }).waitFor();
  await button('中文译文').waitFor();
  await nav('首页');
  await button('查看事项', action).click();
  await heading(title).waitFor();
  await materials.getByRole('img').waitFor();
  await current.getByLabel('状态', { exact: true }).selectOption('closed');
  await current.getByLabel('关闭原因').fill('合成回访确认，路线筛选正常。');
  await button('关闭事项', current).click();
  await current.getByText('事项已关闭。').waitFor();
  await nav('首页');
  await due.getByText('暂无到期的工作事项。').waitFor();
  await nav('工作事项');
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await button('重开事项', current).click();
  await current.getByText('事项已重开。').waitFor();
  await history.getByText('合成回访确认，路线筛选正常。').waitFor();
  await nav('首页');
  await action.waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await action.waitFor();
  await button('查看事项', action).click();
  await history.getByText(original, { exact: true }).waitFor();
  await heading('重开事项', history).waitFor();
  assert.equal((await request(itemRoute)).id, created.id);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture('05-detail-mobile');
  await heading('资料与成果').scrollIntoViewIfNeeded();
  await capture('06-materials-mobile');
  await followUp.fill('2099-01-01');
  await saveCurrent();
  await nav('首页');
  await due.getByText('暂无到期的工作事项。').waitFor();
  await request(itemRoute, { method: 'PUT', body: { baseRevision: (await request(itemRoute)).revision, followUpOn: '2000-01-01' } });
  await button('刷新到期跟进', due).click();
  await action.getByText('2000-01-01', { exact: true }).waitFor();
  await capture('07-home-due-mobile');

  const duePath = url => url.pathname === '/api/work-items' && url.searchParams.get('due') === '1';
  await page.route(duePath, route => route.fulfill({ status: 500, json: { error: { message: '合成读取失败' } } }));
  await button('刷新到期跟进', due).click();
  await due.getByRole('alert').getByText('到期跟进读取失败，请刷新后重试。').waitFor();
  await heading('需要你处理').waitFor();
  await button('周期回顾').click();
  await heading('周期回顾').waitFor();
  await page.unroute(duePath);
  await request(`/api/raw/${raw.id}`, { method: 'DELETE' });
  await nav('工作事项');
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await materials.getByText('Raw 来源不可用', { exact: false }).waitFor();
  assert.equal(await materials.getByRole('button', { name: /查看原文/ }).count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'browser-result.json'), `${JSON.stringify({ id: created.id, evidence, errors, viewports: [1440, 390] }, null, 2)}\n`);
  console.log(`WORK01 Chrome lifecycle and ${evidence} screenshots complete`);
} finally {
  await browser?.close();
  if (ui) await new Promise((resolve, reject) => ui.httpServer.close(error => error ? reject(error) : resolve()));
  if (apiChild.exitCode === null) apiChild.kill();
  await stopped;
}
