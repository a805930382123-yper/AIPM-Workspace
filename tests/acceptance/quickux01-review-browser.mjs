import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, preview } from 'vite';
import { lwFixture } from '../lw01-fixture.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'quickux01-browser-'));
const data = path.join(run, 'data');
const envDir = path.join(run, 'vite-env');
const config = path.join(run, 'empty-provider.env');
const outDir = path.join(run, 'dist');
const guard = path.join(run, 'deny-external.mjs');
const evidence = { run, screens: [], pageErrors: [], external: [], captures: [], backdropFocus: [] };
console.log('Evidence directory', run);
await mkdir(envDir);
await writeFile(config, '');
await writeFile(guard, `
import { appendFile } from 'node:fs/promises';
const native = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === '127.0.0.1') return native(input, options);
  await appendFile(process.env.QUICKUX_EXTERNAL_LOG, url.origin + '\\n');
  throw Error('Unexpected external request during QUICKUX01');
};
`);
const externalLog = path.join(run, 'external.txt');
await writeFile(externalLog, '');
const fixture = await lwFixture(data);
// The home page requests today's edition on mount. Seed both sections to keep it offline.
const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai'}).format(now);
const cached = {status:'source_only', attempt:1, startedAt:now.toISOString(), finishedAt:now.toISOString(), items:[], sources:[]};
await mkdir(path.join(data,'state','news'), {recursive:true});
await writeFile(path.join(data,'state','news',today + '.json'), JSON.stringify({
  schemaVersion:1, date:today, updatedAt:now.toISOString(),
  sections:{ai:cached, fmcg:{...cached, contentVersion:'research-v1'}},
}));
const topics = ['渠道甲', '渠道乙', '铺货', '门店', '补货', '包装', '销售'];
fixture.setTopics(topics);
const raw = await fixture.rawStore.create({
  title: 'QUICKUX01 本机样例', sourceType: 'report', sourceName: '隔离验收', tags: [],
  body: topics.map((name, i) => name + '样例本月数字为' + (i + 10) + '。').join('\n'),
});
const draft = await fixture.generate(raw.id);
assert.equal(draft.maintenance.changes.length, topics.length);
await fixture.confirm(await fixture.accept(draft, [draft.maintenance.changes.at(-1).changeId]));

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  assert(![4317, 5151, 5173].includes(port));
  return port;
}

await build({ configFile: false, plugins: [react()], envDir, build: { outDir } });
const apiPort = await freePort();
const uiPort = await freePort();
assert.notEqual(apiPort, uiPort);
const apiBase = 'http://127.0.0.1:' + apiPort;
const uiBase = 'http://127.0.0.1:' + uiPort;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|NODE_OPTIONS$)/i.test(key)));
Object.assign(env, { FMCG_DATA_DIR: data, FMCG_PORT: String(apiPort), FMCG_UI_ORIGIN: uiBase,
  FMCG_LLM_CONFIG_FILE: config, FMCG_NEWS_AI_ENABLED: 'false', QUICKUX_EXTERNAL_LOG: externalLog });
const child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, '--import', 'tsx', 'server/index.ts'],
  { env: withoutInheritedEmbeddings(env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const exit = once(child, 'close');
let serviceLog = '';
child.stdout.on('data', chunk => { serviceLog += chunk; });
child.stderr.on('data', chunk => { serviceLog += chunk; });
let browser, ui;
try {
  for (let i = 0; i < 120; i++) {
    if (await fetch(apiBase + '/api/health').then(r => r.ok, () => false)) break;
    assert(child.exitCode === null && i < 119, serviceLog);
    await delay(150);
  }
  ui = await preview({ configFile: false, envDir, build: { outDir },
    preview: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': apiBase } } });
  const { chromium } = createRequire(import.meta.url)(path.join(os.homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'] });
  evidence.browser = browser.version();
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(9000);
    page.on('pageerror', e => evidence.pageErrors.push(e.message));
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin === uiBase) return route.continue();
      evidence.external.push(route.request().url());
      return route.abort();
    });
    const btn = (root, name) => root.getByRole('button', { name, exact: true });
    const screen = async (name) => {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(scrollWidth <= width, name + ' overflow ' + scrollWidth);
      const filename = width + '-' + name + '.png';
      await page.screenshot({ path: path.join(run, filename) });
      evidence.screens.push({ filename, width, height, scrollWidth });
    };
    await page.goto(uiBase);
    await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    const rawMetric = page.locator('.stat-card', { hasText: 'Raw 原始资料' });
    const countBefore = (await fixture.rawStore.list()).length;
    await rawMetric.getByText(String(countBefore), { exact: true }).waitFor();
    const home = btn(page.locator('.page-heading'), '快速记一条');
    const top = btn(page.locator('.topbar'), '快速记一条');
    const dialog = page.getByRole('dialog');
    const body = dialog.getByLabel('速记内容');
    const title = dialog.getByLabel('标题（可选）');
    const tags = dialog.getByLabel('标签（可选）');
    await home.click();
    await body.waitFor();
    assert(await body.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Escape');
    assert(await home.evaluate(el => el === document.activeElement));
    await top.click();
    await page.locator('.modal-scrim').click({ position: { x: 2, y: 2 } });
    await dialog.waitFor({state:'detached'});
    evidence.backdropFocus.push(await top.evaluate(el => ({
      viewport: innerWidth, restored: el === document.activeElement, active: document.activeElement?.tagName,
    })));
    await page.keyboard.press('Alt+n');
    await body.waitFor();
    await page.keyboard.press('Alt+n');
    assert.equal(await dialog.count(), 1);
    await screen('quick-capture');
    const bounds = await dialog.boundingBox();
    assert(bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
    const firstLine = '😀'.repeat(59) + ' 好';
    const note = '\n  ' + firstLine + '  \n正文保留  ' + width;
    await body.fill(note);
    const response = page.waitForResponse(r => r.url() === uiBase + '/api/raw' && r.request().method() === 'POST');
    await body.press('Control+Enter');
    const created = await response;
    assert(created.ok(), await created.text());
    const input = created.request().postDataJSON();
    assert.deepEqual(input, { body: note, title: [...firstLine].slice(0,60).join(''), tags: [], sourceType: 'note', sourceName: '个人速记' });
    const saved = await created.json();
    evidence.captures.push({ width, id: saved.id, route: '/api/raw', status: created.status() });
    await dialog.getByText('已保存到 Raw', {exact:true}).waitFor();
    await rawMetric.getByText(String(countBefore + 1), { exact: true }).waitFor();
    await btn(dialog,'继续记一条').click();
    assert.equal(await body.inputValue(), '');
    assert(await body.evaluate(el => el === document.activeElement));
    await body.fill('https://quickux01.invalid/example');
    await btn(dialog,'切到网页链接模式').click();
    assert.equal(await dialog.getByLabel('公开网页链接').inputValue(), 'https://quickux01.invalid/example');
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await title.fill('链接样例');
    await tags.fill('渠道、门店');
    let attempts = 0;
    await page.route('**/api/raw/import', async route => {
      const payload = route.request().postDataJSON();
      assert.deepEqual(payload, { metadata:{ url:'https://quickux01.invalid/example', sourceType:'article', title:'链接样例', tags:['渠道','门店'] }, translateToChinese:false });
      attempts++;
      return route.fulfill({ status: attempts === 1 ? 400 : 200, contentType:'application/json',
        body:JSON.stringify(attempts === 1 ? {error:'验收错误'} : {raw:saved}) });
    });
    const submit = dialog.locator('button[type="submit"]');
    await submit.click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await title.inputValue(),'链接样例');
    assert.equal(await tags.inputValue(),'渠道、门店');
    await submit.click();
    await btn(dialog, '关闭').last().click();
    assert.equal(attempts, 2);
    await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    await home.click();
    await body.fill('验收导航' + width);
    await body.press('Control+Enter');
    await btn(dialog,'打开这条 Raw').click();
    await page.locator('.raw-detail').getByText('验收导航' + width, {exact:true}).first().waitFor();
    await page.getByLabel('搜索原始资料').focus();
    await page.keyboard.press('Alt+n');
    assert.equal(await dialog.count(), 0);
    const openDraft = async () => {
      await page.locator('.raw-list-item', {hasText:raw.title}).click();
      await btn(page.locator('.raw-detail'), '继续审核').click();
      await page.getByRole('heading',{name:'整理成果',exact:true}).waitFor();
    };
    await openDraft();
    const cards = page.locator('.outcome-card');
    const card = name => page.getByRole('article',{name:'成果 ' + name,exact:true});
    const query = page.getByLabel('搜索主题成果');
    const filter = page.getByLabel('筛选主题状态');
    assert.equal(await cards.count(),7);
    assert.equal(await page.locator('.outcome-cards > div:first-child .outcome-cards-filters').count(),1);
    if(width === 1440) {
      const rects = await cards.evaluateAll(els => els.slice(0,2).map(el => el.getBoundingClientRect().toJSON()));
      assert(rects[0].x !== rects[1].x && Math.abs(rects[0].y-rects[1].y)<2);
    }
    await card('铺货').getByRole('checkbox').check();
    await query.fill('渠道甲');
    await btn(page,'全选当前筛选（1 项）').click();
    await btn(page,'取消当前筛选全选').click();
    await btn(page,'重置筛选').click();
    await filter.selectOption('selected');
    assert.equal(await cards.count(),1);
    await card('铺货').waitFor();
    const requests = [];
    const onRequest = req => requests.push(req.url());
    page.on('request', onRequest);
    await btn(card('铺货'),'暂不采纳').click();
    await filter.selectOption('dismissed');
    await card('铺货').getByText('已忽略',{exact:true}).waitFor();
    assert.deepEqual(requests, []);
    page.off('request', onRequest);
    assert.equal(await card('铺货').locator('details').count(),0);
    const key = 'aipm.outcome.dismissed.v1:' + draft.id;
    assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).length,1);
    await screen('dismissed-topic');
    await btn(page,'返回 Raw').click();
    await openDraft();
    await filter.selectOption('dismissed');
    await card('铺货').waitFor();
    await filter.selectOption('committed');
    assert.equal(await cards.count(),1);
    await filter.selectOption('pending');
    assert.equal(await cards.count(),5);
    await query.fill('找不到此主题');
    await page.getByText('没有符合当前筛选条件的主题成果。').waitFor();
    await btn(page,'重置筛选').click();
    await btn(page,'全选可选主题（5 项）').click();
    await filter.selectOption('selected');
    assert.equal(await cards.count(),5);
    await filter.selectOption('dismissed');
    await btn(card('铺货'),'恢复待选').click();
    await filter.selectOption('all');
    assert.equal(await card('铺货').getByRole('checkbox').isChecked(),false);
    await screen('topic-review');
    await page.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
  assert(evidence.backdropFocus.every(item => item.restored), JSON.stringify(evidence.backdropFocus));
  assert.deepEqual(evidence.external, []);
  assert.equal(await readFile(externalLog, 'utf8'), '');
} finally {
  await browser?.close();
  await ui?.close();
  if (child.exitCode === null) child.kill();
  await exit;
  await writeFile(path.join(run, 'evidence.json'), JSON.stringify(evidence,null,2));
}
