import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { build, preview } from 'vite';
import { lwFixture } from '../lw01-fixture.ts';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';
import { WorkItemStore } from '../../services/work-items/store.ts';
import { RawTranslationService } from '../../services/raw/translations.ts';

const evidenceDir = path.resolve('node_modules/.cache/work01-review');
await mkdir(evidenceDir, { recursive: true });
const root = await mkdtemp(path.join(evidenceDir, 'run-'));
console.log(`WORK01 review evidence: ${root}`);
const data = path.join(root, 'data');
const restored = path.join(root, 'restored');
const envDir = path.join(root, 'empty-env');
const config = path.join(root, 'unused-isolated.env');
await mkdir(envDir);
await writeFile(config, '');
const childEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));

async function startApi(dataRoot) {
  const reservation = createServer();
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    windowsHide: true,
    env: withoutInheritedEmbeddings({ ...childEnv, FMCG_DATA_DIR: dataRoot, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config }),
  });
  const stopped = new Promise(resolve => child.once('close', resolve));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
    await writeFile(path.join(root, `api-${path.basename(dataRoot)}.log`), stdout + stderr);
  };
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let n = 0; n < 150; n++) {
      if (stdout.includes(`API: ${base} (data: ${dataRoot})`)) return { base, close };
      if (child.exitCode !== null) break;
      await wait(100);
    }
    assert.fail(`Isolated API failed to start\n${stdout}\n${stderr}`);
  } catch (error) {
    await close();
    throw error;
  }
}

function shanghaiDay(offset = 0) {
  return new Date(Date.now() + (8 + offset * 24) * 3_600_000).toISOString().slice(0, 10);
}

async function request(base, url, { method = 'GET', body, expected = 200 } = {}) {
  const init = body instanceof FormData ? { method, body } : {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  };
  const response = await fetch(base + url, init);
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expected, `${method} ${url}\n${JSON.stringify(payload)}`);
  return payload;
}

const fixture = await lwFixture(data);
const rawUrl = 'https://example.invalid/customer-note';
const translatedBody = '合成客户邮件译文：商品详情页库存与门店页不一致。';
const linkedRaw = await fixture.rawStore.create({
  title: '客户工单合成原始材料', body: 'The product detail page has a different inventory count than the store page.',
  tags: [], sourceType: 'customer', sourceName: 'WORK01 独验合成输入',
  url: rawUrl, urlImport: { finalUrl: rawUrl, fetchedAt: new Date().toISOString() },
});
const translationService = new RawTranslationService({ root: data, raws: fixture.rawStore, provider: async () => ({
  name: 'fake', model: 'work01-offline-fixture', complete: async () => {
    const text = JSON.stringify({ translation: translatedBody });
    return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
  },
}) });
await translationService.start(linkedRaw.id);
for (let n = 0; n < 100 && ['queued', 'running'].includes((await translationService.get(linkedRaw.id)).status); n++) await wait(20);
assert.equal((await translationService.get(linkedRaw.id)).body, translatedBody);
const legacyRaw = await fixture.rawStore.create({
  title: '旧首页合成整理草稿', body: '渠道覆盖12家。\n\n回访周期7天。',
  tags: [], sourceType: 'report', sourceName: 'WORK01 独验旧流程夹具',
});
const removedRaw = await fixture.rawStore.create({
  title: '稍后删除的合成原始材料', body: '独验删除关联时使用的临时原句。',
  tags: [], sourceType: 'customer', sourceName: 'WORK01 独验合成输入',
});
const legacyDraft = await fixture.generate(legacyRaw.id, 'standard');
const rawFile = path.join(data, 'knowledge', 'raw', 'customer', `${linkedRaw.id}.md`);
const rawBytesBefore = await readFile(rawFile);
const translationFile = path.join(data, 'state', 'raw-translations', `${linkedRaw.id}.json`);
const translationBytesBefore = await readFile(translationFile);
const oldArchive = path.join(root, 'before-work-items.json');
const restoredOld = path.join(root, 'restored-without-work-items');
await exportWorkspace(data, oldArchive);
await restoreWorkspace(oldArchive, restoredOld);
assert.equal(await readFile(path.join(restoredOld, 'work-items', 'none.json')).catch(error => error.code), 'ENOENT');

let api, ui, browser, restoredApi, oldApi;
try {
  api = await startApi(data);
  assert.deepEqual(await request(api.base, '/api/work-items'), { items: [] });
  const rawBefore = await request(api.base, `/api/raw/${linkedRaw.id}`);
  const stateBefore = await request(api.base, '/api/raw-processing');
  const vite = { envDir, build: { outDir: path.join(root, 'dist') } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': api.base } } });
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.WORK01_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({
    executablePath: process.env.WORK01_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-proxy-server'], headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${ui.httpServer.address().port}`, { waitUntil: 'domcontentloaded' });
  const [png, jpeg] = (await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4f5fb';
    ctx.fillRect(0, 0, 400, 140);
    ctx.fillStyle = '#172033';
    ctx.font = '18px sans-serif';
    ctx.fillText('Synthetic inventory screenshot', 22, 38);
    ctx.fillText('Store: 14     Item page: 0', 22, 96);
    return ['image/png', 'image/jpeg'].map(type => canvas.toDataURL(type).split(',')[1]);
  })).map(data => Buffer.from(data, 'base64'));
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const heading = name => page.getByRole('heading', { name, exact: true });
  const nav = name => button(name, page.getByRole('navigation', { name: '主导航' })).click();
  const snapshot = name => page.screenshot({ path: path.join(root, `${name}.png`), fullPage: true });
  const json = (url, options) => request(api.base, url, options);
  const responseAfter = (method, url) => page.waitForResponse(response => {
    const parsed = new URL(response.url());
    return response.request().method() === method && parsed.pathname + parsed.search === url;
  });
  const itemsPath = '/api/work-items';
  const itemPath = item => `${itemsPath}/${item.id}`;
  const followUps = () => json(`${itemsPath}?due=1`);
  const create = title => json(itemsPath, { method: 'POST', expected: 201, body: { title, feedback: '合成客户反馈。' } });
  const update = (item, body, expected = 200) => json(itemPath(item), { method: 'PUT', expected, body: { baseRevision: item.revision, ...body } });
  const upload = (item, bytes, type, expected, name = 'synthetic-image', note = '独验说明') => {
    const form = new FormData();
    form.set('file', new Blob([bytes], { type }), name);
    form.set('baseRevision', String(item.revision));
    form.set('note', note);
    return json(`${itemPath(item)}/screenshots`, { method: 'POST', body: form, expected });
  };

  const today = shanghaiDay();
  const yesterday = shanghaiDay(-1);
  const tomorrow = shanghaiDay(1);
  const caseTitle = '商品详情页库存显示异常';
  const feedback = '客户反馈：门店页显示可售，商品详情页显示库存为零。';
  await nav('工作事项');
  await heading('客户问题').waitFor();
  await button('新建客户问题').click();
  await page.getByLabel('问题标题', { exact: true }).fill(caseTitle);
  await page.getByLabel('客户反馈', { exact: true }).fill(feedback);
  const createdResponse = responseAfter('POST', itemsPath);
  await button('创建事项').click();
  assert.equal((await createdResponse).status(), 201);
  let current = await (await createdResponse).json();
  const currentPath = itemPath(current);
  await heading(caseTitle).waitFor();
  assert.equal(current.status, 'triage');
  assert.equal(current.feedback, feedback);
  await snapshot('01-created-desktop');

  const openCaseFromList = async () => {
    if (await heading(caseTitle).isVisible()) await button('返回工作事项').click();
    else await nav('工作事项');
    const loaded = responseAfter('GET', currentPath);
    await button(new RegExp(caseTitle)).click();
    assert.equal((await (await loaded).json()).id, current.id);
    await heading(caseTitle).waitFor();
  };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openCaseFromList();
  await page.getByText(feedback, { exact: true }).waitFor();
  const getLabel = name => page.getByLabel(name, { exact: typeof name === 'string' });
  const status = getLabel('状态');
  const followUp = getLabel(/跟进日期（选填）/);
  const customer = getLabel('客户（选填）');
  const project = getLabel('项目（选填）');
  const occurredAt = getLabel(/发生时间（选填/);
  const nextStep = getLabel('下一步（选填）');
  const waitingFor = getLabel('等谁／等什么（选填）');
  const save = async (name, expected = 200, method = 'PUT', url = currentPath) => {
    const observed = responseAfter(method, url);
    await button(name).click();
    const response = await observed;
    assert.equal(response.status(), expected, await response.text());
    const result = await response.json();
    if (expected === 200 || expected === 201) current = result;
    return result;
  };
  await status.selectOption('waiting');
  await page.getByText(/可以设置跟进日期.*留空/).waitFor();
  assert.equal(await followUp.inputValue(), '');
  await customer.fill('北区合成客户');
  await project.fill('库存同步试点');
  await occurredAt.fill(`${today}T09:35`);
  await waitingFor.fill('等库存接口团队的差异日志');
  await nextStep.fill('拿到日志后复现商品详情页');
  await save('保存当前情况');
  assert.equal(current.status, 'waiting');
  assert.equal(current.followUpOn, undefined);
  assert.equal(current.occurredAt, `${today}T01:35:00.000Z`);
  await openCaseFromList();
  assert.equal(await customer.inputValue(), '北区合成客户');
  assert.equal(await project.inputValue(), '库存同步试点');
  assert.match(await occurredAt.inputValue(), new RegExp(`^${today}T09:35`));
  assert.equal(await waitingFor.inputValue(), '等库存接口团队的差异日志');
  assert.equal(await nextStep.inputValue(), '拿到日志后复现商品详情页');
  await customer.fill('');
  await project.fill('');
  await occurredAt.fill('');
  await status.selectOption('in_progress');
  await save('保存当前情况');
  assert.deepEqual([current.customer, current.project, current.occurredAt], [undefined, undefined, undefined]);
  await openCaseFromList();
  for (const input of [customer, project, occurredAt]) assert.equal(await input.inputValue(), '');
  await nextStep.fill('另一个标签页变化时保留本输入');
  await update(current, { project: '另一个标签页保存的项目' });
  await save('保存当前情况', 409);
  await page.getByRole('alert').filter({ hasText: '已有更新' }).waitFor();
  assert.equal(await nextStep.inputValue(), '另一个标签页变化时保留本输入');
  const latest = responseAfter('GET', currentPath);
  await button('重新读取最新版本').click();
  await latest;
  await page.getByRole('status').filter({ hasText: '已读取最新版本' }).waitFor();
  assert.equal(await project.inputValue(), '另一个标签页保存的项目');
  assert.equal(await nextStep.inputValue(), '另一个标签页变化时保留本输入');
  await save('保存当前情况');
  console.log('W01 Chrome minimal create, re-entry, optional fields, waiting without due date and conflict recovery passed');

  const addHistory = async (kind, text, outcome) => {
    await getLabel('记录类型').selectOption(kind);
    await getLabel('记录内容').fill(text);
    if (outcome) await getLabel('复测结果').selectOption(outcome);
    await save('保存处理记录');
  };
  await addHistory('feedback', '补充反馈：门店页只有北区受到影响。');
  await addHistory('reproduction', '复现：打开同一 SKU 的详情页和门店页，库存数字不同。');
  const report = '请核对同一 SKU 在门店页和详情页返回的库存口径。';
  await getLabel('技术反馈正文').fill(report);
  await save('保存正文');
  await button('复制正文').click();
  await page.getByRole('status').filter({ hasText: '正文已复制' }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), report);
  assert(!(await json(currentPath)).history.some(record => record.kind === 'sent'));
  await button('记录已发送').click();
  const sentText = `${report}\n附上北区和门店页复现步骤。`;
  await getLabel(/已发送正文/).fill(sentText);
  await getLabel(/实际发送时间（上海时间）/).fill(`${today}T10:20`);
  await save('确认记录已发送');
  assert.deepEqual(current.history.map(record => record.kind), ['feedback', 'reproduction', 'sent']);
  assert.equal(current.history.at(-1).sentAt, `${today}T02:20:00.000Z`);
  assert.equal(current.history.at(-1).body, sentText);
  await addHistory('technical_reply', '技术回复：已调整库存缓存，请复测。');
  assert.equal(current.status, 'in_progress');
  assert(!current.history.some(record => record.kind === 'retest'));
  await status.selectOption('retest');
  await save('保存当前情况');
  await addHistory('retest', '第一次复测：详情页库存仍为零。', 'failed');
  await addHistory('retest', '第二次复测：库存与门店页相同。', 'passed');
  assert.deepEqual(current.history.filter(record => record.kind === 'retest').map(record => record.outcome), ['failed', 'passed']);
  await status.selectOption('closed');
  await getLabel('关闭原因').fill('两页库存对齐，客户确认可关闭。');
  await save('关闭事项');
  assert.equal(current.status, 'closed');
  await openCaseFromList();
  await page.getByText('两页库存对齐，客户确认可关闭。', { exact: true }).waitFor();
  await save('重开事项');
  assert.equal(current.status, 'triage');
  assert.deepEqual(current.history.slice(-2).map(record => record.kind), ['closed', 'reopened']);
  console.log('W02 Chrome feedback/reproduction/copy/explicit send/reply/retest/close and reopen passed');

  for (const raw of [linkedRaw, removedRaw]) {
    await getLabel('选择已有 Raw').selectOption(raw.id);
    await save('添加关联');
  }
  const note = '合成截图：门店库存 14，详情库存 0。';
  await getLabel('截图文件').setInputFiles({ name: 'inventory.png', mimeType: 'image/png', buffer: png });
  await getLabel('截图说明（选填）').fill(note);
  await save('上传截图', 201, 'POST', `${currentPath}/screenshots`);
  const mainImagePath = `${currentPath}/screenshots/${current.screenshots[0].id}`;
  const previewImage = page.getByRole('img', { name: `截图：${note}`, exact: true });
  await previewImage.waitFor();
  await page.waitForFunction(image => document.querySelector(`img[src="${image}"]`)?.naturalWidth === 400, mainImagePath);
  assert.equal(current.screenshots[0].note, note);
  assert.deepEqual(await json(mainImagePath), png);
  await openCaseFromList();
  await previewImage.waitFor();
  const popupOpening = page.waitForEvent('popup');
  await page.getByRole('link', { name: /打开截图/ }).click();
  const popup = await popupOpening;
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).pathname, mainImagePath);
  await popup.close();
  const translated = responseAfter('GET', `/api/raw/${linkedRaw.id}/translation`);
  await button(`${linkedRaw.title} · 查看原文`).click();
  const translation = (await (await translated).json()).translation;
  assert.equal(translation.rawId, linkedRaw.id);
  assert.equal(translation.body, translatedBody);
  const language = page.getByRole('group', { name: '正文语言' });
  await language.waitFor();
  assert.equal(await button('原文', language).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.raw-body').innerText(), linkedRaw.body);
  await snapshot('02-linked-raw-original');
  await json(`/api/raw/${removedRaw.id}`, { method: 'DELETE' });
  await nav('首页');
  await openCaseFromList();
  await page.getByText(/Raw 来源不可用/).waitFor();
  assert.equal(await button(`${removedRaw.title} · 查看原文`).count(), 0);
  await page.setViewportSize({ width: 768, height: 1000 });
  await snapshot('03-detail-narrow');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('W03 Chrome PNG preview, saved image, original translated Raw by ID, and missing Raw passed');

  const todayItem = await update(await create('当天到期合成事项'), { followUpOn: today });
  const late = await update(await create('已经逾期合成事项'), { followUpOn: yesterday });
  const future = await update(await create('未来到期合成事项'), { followUpOn: tomorrow });
  const noDate = await create('无日期合成事项');
  const closed = await update(await create('已关闭合成事项'), { status: 'closed', closureReason: '现场已完成', followUpOn: today });
  const dueIds = (await followUps()).items.map(item => item.id);
  assert(dueIds.includes(todayItem.id));
  assert(dueIds.includes(late.id));
  assert(![future.id, noDate.id, closed.id].some(id => dueIds.includes(id)));
  const midpoint = new Date(`${today}T16:00:00.000Z`);
  const store = new WorkItemStore(data, fixture.rawStore);
  assert(!(await store.list(true, new Date(midpoint.getTime() - 1))).some(item => item.id === future.id));
  assert((await store.list(true, midpoint)).some(item => item.id === future.id));
  await followUp.fill(today);
  await save('保存当前情况');
  await nav('首页');
  const followUpRegion = page.getByRole('region', { name: '到期跟进', exact: true });
  const dueCard = title => followUpRegion.getByRole('article', { name: title, exact: true });
  const verifyDue = async (mainIsDue) => {
    await dueCard(todayItem.title).waitFor();
    assert.equal(await dueCard(late.title).count(), 1);
    for (const excluded of [future, noDate, closed]) assert.equal(await dueCard(excluded.title).count(), 0);
    assert.equal(await dueCard(caseTitle).count(), Number(mainIsDue));
  };
  await verifyDue(true);
  await snapshot('04-home-due-desktop');
  const openedFromHome = responseAfter('GET', currentPath);
  await button('查看事项', dueCard(caseTitle)).click();
  assert.equal((await (await openedFromHome).json()).id, current.id);
  await heading(caseTitle).waitFor();
  await followUp.fill(tomorrow);
  await save('保存当前情况');
  await nav('首页');
  await verifyDue(false);
  current = await update(current, { followUpOn: today });
  const refreshed = responseAfter('GET', `${itemsPath}?due=1`);
  await button('刷新到期跟进').click();
  await refreshed;
  await dueCard(caseTitle).waitFor();
  await verifyDue(true);
  const openedAgain = responseAfter('GET', currentPath);
  await button('查看事项', dueCard(caseTitle)).click();
  assert.equal((await (await openedAgain).json()).id, current.id);
  await status.selectOption('closed');
  await getLabel('关闭原因').fill('跟进完成，验证首页排除。');
  await save('关闭事项');
  await nav('首页');
  await verifyDue(false);
  await openCaseFromList();
  await save('重开事项');
  await nav('首页');
  await verifyDue(true);
  await openCaseFromList();
  await followUp.fill('');
  await save('保存当前情况');
  await nav('首页');
  await verifyDue(false);
  const corrupt = path.join(data, 'work-items', `${randomUUID()}.json`);
  await writeFile(corrupt, '{isolated broken work record');
  await button('刷新到期跟进').click();
  await followUpRegion.getByRole('alert').filter({ hasText: '到期跟进读取失败' }).waitFor();
  assert.equal(await readFile(corrupt, 'utf8'), '{isolated broken work record');
  await page.getByRole('article', { name: legacyRaw.title, exact: true }).waitFor();
  await unlink(corrupt);

  await json(itemsPath, { method: 'POST', expected: 400, body: { feedback: '缺标题' } });
  await json(itemsPath, { method: 'POST', expected: 400, body: { title: '缺反馈' } });
  await update(noDate, { followUpOn: '2026-02-29' }, 400);
  await update(noDate, { occurredAt: '2026-02-29T09:00:00+08:00' }, 400);
  const successful = await update(noDate, { nextStep: '当前版本应保留' });
  await update(noDate, { nextStep: '陈旧版本不得覆盖' }, 409);
  assert.deepEqual(await json(itemPath(noDate)), successful);

  await upload(todayItem, Buffer.from('<svg/>'), 'image/png', 400, 'fake.png');
  await upload(todayItem, png, 'image/svg+xml', 400, 'fake.svg');
  await upload(todayItem, Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), 'image/png', 413, 'oversize.png');
  assert.deepEqual(await json(itemPath(todayItem)), todayItem);
  const jpegItem = await upload(todayItem, jpeg, 'image/jpeg', 201, 'real.jpg');
  const jpegPath = `${itemPath(jpegItem)}/screenshots/${jpegItem.screenshots[0].id}`;
  const jpegResponse = await fetch(`${api.base}${jpegPath}`);
  assert.equal(jpegResponse.status, 200);
  assert.equal(jpegResponse.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await jpegResponse.arrayBuffer()), jpeg);
  await json(`${itemPath(late)}/screenshots/${jpegItem.screenshots[0].id}`, { expected: 404 });

  // A file in place of this issue's attachment directory forces the actual filesystem write to fail.
  const screenshotRoot = path.join(data, 'work-items', 'screenshots');
  await mkdir(screenshotRoot, { recursive: true });
  const obstruction = path.join(screenshotRoot, noDate.id);
  await writeFile(obstruction, 'synthetic filesystem obstruction');
  await upload(successful, png, 'image/png', 500, 'blocked.png');
  assert.deepEqual(await json(itemPath(noDate)), successful);
  await unlink(obstruction);
  console.log('W04 HTTP Shanghai midnight/qualification and W05 invalid inputs/conflicts/write failure passed');

  assert.deepEqual(await json(`/api/raw/${linkedRaw.id}`), rawBefore);
  assert.deepEqual(await json('/api/raw-processing'), stateBefore);
  assert.deepEqual(await readFile(rawFile), rawBytesBefore);
  assert.deepEqual(await readFile(translationFile), translationBytesBefore);

  await nav('首页');
  const legacyTask = page.getByRole('article', { name: legacyRaw.title, exact: true });
  const reviewPath = `/api/drafts/${legacyDraft.id}`;
  const opened = responseAfter('GET', reviewPath);
  await button('继续审核', legacyTask).click();
  assert.equal((await (await opened).json()).id, legacyDraft.id);
  await heading('整理成果').waitFor();
  const deferredResponse = responseAfter('POST', `${reviewPath}/defer`);
  await button('稍后处理').click();
  assert.equal((await deferredResponse).status(), 200);
  await nav('首页');
  const later = page.getByRole('region', { name: '稍后处理', exact: true });
  await later.getByRole('article', { name: legacyRaw.title, exact: true }).waitFor();
  const reopenDraft = responseAfter('GET', reviewPath);
  await later.getByRole('article', { name: legacyRaw.title, exact: true }).getByRole('button').click();
  assert.equal((await (await reopenDraft).json()).id, legacyDraft.id);
  const resumed = responseAfter('POST', `${reviewPath}/defer`);
  await button('继续处理').click();
  assert.equal((await resumed).status(), 200);
  await nav('首页');
  await button('继续审核', legacyTask).waitFor();
  assert.equal(await later.getByRole('article', { name: legacyRaw.title, exact: true }).count(), 0);
  assert.equal(fixture.requests.length, 3, 'The fixture generation supplies all three synthetic requests');
  assert.deepEqual(pageErrors, []);
  console.log('W04 Chrome existing draft, defer, open same draft and explicit resume passed');

  await api.close();
  api = undefined;
  const archive = path.join(root, 'with-work-items.json');
  await exportWorkspace(data, archive);
  await restoreWorkspace(archive, restored);
  restoredApi = await startApi(restored);
  assert.deepEqual(await request(restoredApi.base, currentPath), current);
  assert.deepEqual(await request(restoredApi.base, mainImagePath), png);
  assert.deepEqual(await request(restoredApi.base, itemPath(jpegItem)), jpegItem);
  assert.deepEqual(await request(restoredApi.base, jpegPath), jpeg);
  assert.equal((await request(restoredApi.base, `/api/raw/${linkedRaw.id}`)).body, linkedRaw.body);
  oldApi = await startApi(restoredOld);
  assert.deepEqual(await request(oldApi.base, itemsPath), { items: [] });
  assert.equal((await request(oldApi.base, `/api/raw/${linkedRaw.id}`)).body, linkedRaw.body);
  console.log('W05 real backup/restore and restored server old/new archive reads passed');
  await writeFile(path.join(root, 'result.json'), JSON.stringify({
    chrome: browser.version(), viewports: [[1440, 1000], [768, 1000]], legacyDraftId: legacyDraft.id,
    linkedRawId: linkedRaw.id, restoredMainItemId: current.id, restoredJpegItemId: jpegItem.id, pageErrors,
  }, null, 2));
} finally {
  await browser?.close();
  if (ui) await new Promise(resolve => ui.httpServer.close(resolve));
  await restoredApi?.close();
  await oldApi?.close();
  await api?.close();
}
