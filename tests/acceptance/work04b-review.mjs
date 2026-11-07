import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { build, preview } from 'vite';
import { RawStore } from '../../services/raw/store.ts';

const cache = path.resolve('node_modules/.cache/work04b-review');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'run-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'env');
const config = path.join(root, 'isolated.env');
await mkdir(envDir);
console.log('WORK04B independent evidence:', root);

const rawStore = new RawStore(data);
const addRaw = (title, body) => rawStore.create({ title, body, sourceType: 'note', sourceName: 'WORK04B 合成独验', tags: [] });
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const key = 'work04b-local-fake-test-key';
const checks = [];
const calls = [];
const fakeErrors = [];
const pageErrors = [];
const puts = [];
const analysisPosts = [];
const logs = [];
const ports = {};
const pass = label => { checks.push(label); console.log('PASS', label); };
const apiUrl = () => `http://127.0.0.1:${ports.api}`;
const itemPath = ({ id }) => `/api/work-items/${id}`;
const runPath = item => `${itemPath(item)}/analysis-runs`;
const itemFile = ({ id }) => path.join(data, 'work-items', `${id}.json`);
const runFile = (item, run) => path.join(data, 'work-items', 'analysis-runs', item.id, `${run.id}.json`);
let fakeHold, putHold, failAnalysis = false;

const fake = createServer(async (req, res) => {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    const request = JSON.parse(body);
    assert.equal(request.model, 'work04b-fake');
    const input = JSON.parse(request.messages.find(message => message.role === 'user').content);
    const isReview = 'output' in input;
    const source = (isReview ? input.input : input).sources[0];
    calls.push({ kind: isReview ? 'review' : 'analysis', rawIds: (isReview ? input.input : input).sources.map(entry => entry.rawId), question: input.roundQuestion });
    if (fakeHold) await fakeHold.promise;
    res.setHeader('content-type', 'application/json');
    if (failAnalysis && !isReview) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: { message: '合成分析失败' } }));
      return;
    }
    const quote = source.body.split('\n')[0];
    const v2 = 'roundQuestion' in (isReview ? input.input : input) || 'roundSummary' in (input.output ?? {});
    const targets = ['observations.0', ...(v2 ? ['roundSummary', 'themes.0.conclusion'] : []), 'scope'];
    const output = isReview ? {
      checks: targets.map(target => ({ target, decision: 'supported', reason: '合成材料与本轮陈述一致。', evidence: [{ rawId: source.rawId, quote }] })),
    } : {
      observations: [{ rawId: source.rawId, quote, observation: '材料记录了本轮报告口径。' }],
      suggestions: ['核对同口径样本。'], openQuestions: ['是否有可比较样本？'],
      ...(v2 ? { roundSummary: '合成摘要只描述此材料中的报告口径。', themes: [
        { title: '本轮口径', conclusion: { kind: 'evidence_supported', text: '当前材料列出本轮报告口径。' },
          evidence: [0], counterEvidence: [], openQuestions: ['是否有可比较样本？'], nextSteps: [], confirmedConflict: null },
      ] } : {}),
    };
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
  } catch (error) {
    fakeErrors.push(String(error));
    res.statusCode = 500;
    res.end('fixture assertion failed');
  }
});

const listen = async server => {
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  return server.address().port;
};
async function poll(callback, accept) {
  for (let i = 0; i < 150; i++) {
    const value = await callback();
    if (accept(value)) return value;
    await wait(80);
  }
  assert.fail('timed out waiting for verification state');
}
async function request(url, method = 'GET', body, expected = 200) {
  const response = await fetch(apiUrl() + url, { method, signal: AbortSignal.timeout(15_000),
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(result).slice(0, 650)}`);
  return result;
}
const update = (item, patch) => request(itemPath(item), 'PUT', { baseRevision: item.revision, ...patch });
const current = item => request(itemPath(item));
const createCustomer = title => request('/api/work-items', 'POST', { title, feedback: '保留原客户反馈和处理记录。' }, 201);
const createProduct = title => request('/api/work-items', 'POST', { kind: 'product_analysis', title, goal: '仅对比同口径报告。' }, 201);
const listRuns = item => request(runPath(item)).then(result => result.items);
const analysis = (item, rawIds) => request(runPath(item), 'POST', { baseRevision: item.revision, rawIds }, 201);
const latch = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

let child, childExit, ui, browser;
try {
  ports.fake = await listen(fake);
  const reserve = createServer();
  ports.api = await listen(reserve);
  await new Promise(resolve => reserve.close(resolve));
  await writeFile(config, `FMCG_LLM_BASE_URL=http://127.0.0.1:${ports.fake}/v1\nFMCG_LLM_MODEL=work04b-fake\nFMCG_LLM_API_KEY=${key}\n`);
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true,
    env: { ...cleanEnv, FMCG_DATA_DIR: data, FMCG_PORT: String(ports.api), FMCG_LLM_CONFIG_FILE: config } });
  childExit = once(child, 'close');
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  await poll(() => fetch(apiUrl() + '/api/health').then(response => response.ok, () => false), Boolean);
  assert.ok(logs.join('').includes('(data: ' + data + ')'));

  const vite = { envDir, build: { outDir: process.env.WORK04B_REVIEW_DIST ?? path.join(root, 'dist') } };
  if (!process.env.WORK04B_REVIEW_DIST) await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': apiUrl() } } });
  ports.ui = ui.httpServer.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.WORK04B_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.WORK04B_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', req => {
    const pathname = new URL(req.url()).pathname;
    if (req.method() === 'PUT' && pathname.startsWith('/api/work-items/')) puts.push({ path: pathname, body: req.postDataJSON() });
    if (req.method() === 'POST' && pathname.includes('/analysis-runs')) analysisPosts.push(pathname);
  });
  await page.route('**/api/news/**', route => route.fulfill({ json: { date: '2026-11-07', aiEnabled: false, edition: null, fallbacks: {} } }));
  const uiUrl = `http://127.0.0.1:${ports.ui}`;
  const button = (name, within = page) => within.getByRole('button', { name, exact: true });
  const label = (name, within = page) => within.getByLabel(name, { exact: true });
  const region = name => page.getByRole('region', { name, exact: true });
  const nav = name => button(name, page.getByRole('navigation', { name: '主导航' })).click();
  const heading = name => page.getByRole('heading', { name, exact: true });
  const openItem = async item => {
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await nav('工作事项');
    await page.getByRole('button', { name: new RegExp(item.title) }).click();
    await heading(item.title).waitFor();
  };
  const openRun = async run => {
    const toggle = page.locator(`button[aria-controls="analysis-${run.id}"]`);
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    return page.locator(`#analysis-${run.id}`);
  };
  const responseFor = (url, method) => page.waitForResponse(response => new URL(response.url()).pathname === url && response.request().method() === method);
  const save = async (item, name, within, expected = 200) => {
    const response = responseFor(itemPath(item), 'PUT');
    await button(name, within).click();
    const result = await response;
    assert.equal(result.status(), expected);
    return result.json();
  };
  const atWidth = async (panel, width, name) => {
    await page.setViewportSize({ width, height: 950 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow at ${width}`);
    await panel.screenshot({ path: path.join(root, `${name}-${width}.png`) });
  };

  const customer = await createCustomer('独验客户问题 A');
  // Simulate a WORK01 record predating the kind field.
  const legacy = JSON.parse(await readFile(itemFile(customer), 'utf8'));
  delete legacy.kind;
  await writeFile(itemFile(customer), JSON.stringify(legacy));
  await openItem(customer);
  const context = region('当前情况');
  const suggestion = region('事项推进建议');
  const status = label('状态', context);
  const currentNext = label('下一步（选填）', context);
  const currentWaiting = label('等谁／等什么（选填）', context);
  const currentDate = label('跟进日期（选填）', context);
  const nextField = suggestion.getByLabel(/^下一步/);
  const waitingField = suggestion.getByLabel(/^等待对象/);
  const dateField = suggestion.getByLabel(/^跟进日期/);
  const apply = button('应用建议', suggestion);
  const previewSuggestion = () => button('预览建议', suggestion).click();
  const suggest = async title => {
    await suggestion.getByRole('heading', { name: new RegExp(title) }).waitFor();
    assert.equal(await suggestion.count(), 1);
  };
  const noCustomerSuggestion = () => suggestion.waitFor({ state: 'hidden' });
  const addHistory = async (item, kind, body, outcome) => {
    await label('记录类型').selectOption(kind);
    await label('记录内容').fill(body);
    if (outcome) await label('复测结果').selectOption(outcome);
    return save(item, '保存处理记录');
  };
  const send = async (item, sentAt) => {
    await button('记录已发送').click();
    await label('实际发送时间（上海时间）').fill(sentAt);
    await page.getByLabel(/^已发送正文/).fill('已人工发送的合成技术反馈。');
    return save(item, '确认记录已发送');
  };
  const submitSuggestion = async (item, patch) => {
    const result = await save(item, '应用建议', suggestion);
    assert.deepEqual(puts.at(-1), { path: itemPath(item), body: { baseRevision: item.revision, ...patch } });
    assert.equal(result.status, patch.status);
    await noCustomerSuggestion();
    await poll(() => status.inputValue(), value => value === patch.status);
    return result;
  };

  await page.getByText(customer.feedback, { exact: true }).waitFor();
  await addHistory(customer, 'feedback', '旧客户问题补充记录。');
  await addHistory(customer, 'reproduction', '独验复现说明。');
  await label('技术反馈正文').fill('手工准备正文。');
  await save(customer, '保存正文');
  await noCustomerSuggestion();
  let sent = await send(customer, '2026-11-05T10:10');
  await suggest('转为等待技术');
  assert.equal(sent.status, 'triage');
  const beforePreview = puts.length;
  await previewSuggestion();
  assert.deepEqual(await Promise.all([waitingField.inputValue(), nextField.inputValue(), dateField.inputValue()]), ['技术', '跟进技术回复', '']);
  await atWidth(suggestion, 1440, 'customer-preview');
  await atWidth(suggestion, 390, 'customer-preview');
  await button('取消', suggestion).click();
  assert.equal(puts.length, beforePreview);
  assert.deepEqual(await current(customer), sent);
  await previewSuggestion();
  const dueDate = '2020-01-02';
  await dateField.fill(dueDate);
  sent = await submitSuggestion(sent, { status: 'waiting', waitingFor: '技术', nextStep: '跟进技术回复', followUpOn: dueDate });
  assert.deepEqual(await Promise.all([currentWaiting.inputValue(), currentNext.inputValue(), currentDate.inputValue()]), ['技术', '跟进技术回复', dueDate]);
  await openItem(customer);
  assert.equal(await status.inputValue(), 'waiting');
  assert.deepEqual(await current(customer), sent);
  await noCustomerSuggestion();
  pass('B1 sent: old item read, normal feedback/reproduction/draft do not trigger, preview/cancel no write, accepted defaults and human date in PUT');

  const reply = await addHistory(customer, 'technical_reply', '技术确认修复版本。');
  await suggest('转为待复测');
  assert.equal(reply.status, 'waiting');
  await previewSuggestion();
  assert.deepEqual(await Promise.all([waitingField.inputValue(), nextField.inputValue(), dateField.inputValue()]), ['技术', '跟进技术回复', dueDate]);
  await nextField.fill('');
  const retest = await submitSuggestion(reply, { status: 'retest', nextStep: '' });
  assert.equal(retest.nextStep, undefined);
  assert.equal(retest.waitingFor, '技术');
  assert.equal(retest.followUpOn, dueDate);
  const failed = await addHistory(customer, 'retest', '复测失败，仍观察到问题。', 'failed');
  await suggest('继续处理');
  assert.equal(failed.status, 'retest');
  await previewSuggestion();
  assert.equal(await nextField.inputValue(), '核对失败原因并继续处理');
  const continued = await submitSuggestion(failed, { status: 'in_progress', nextStep: '核对失败原因并继续处理' });
  assert.deepEqual((await current(customer)).history, failed.history);
  assert.equal(continued.followUpOn, dueDate);
  await status.selectOption('retest');
  await save(customer, '保存当前情况', context);
  await suggest('继续处理');
  const passed = await addHistory(customer, 'retest', '复测通过，等待人工确认是否结项。', 'passed');
  await noCustomerSuggestion();
  assert.equal(passed.status, 'retest');
  await openItem(customer);
  assert.equal(await status.inputValue(), 'retest');
  await page.getByText('复测通过，等待人工确认是否结项。', { exact: true }).waitFor();
  pass('B1 reply/retest: preserved values, explicit clear, failure advances only by apply, passed retest blocks previous suggestion, history and status read back');

  let edit = await createCustomer('独验客户问题 B');
  edit = await update(edit, { status: 'in_progress', waitingFor: '原有协调人', followUpOn: '2026-12-01' });
  await openItem(edit);
  await addHistory(edit, 'technical_reply', '追加在先的技术回复。');
  await suggest('转为待复测');
  edit = await send(edit, '2020-01-01T09:00');
  await suggest('转为等待技术');
  assert.ok(Date.parse(edit.history.at(-1).sentAt) < Date.parse(edit.history.at(-2).at));
  await currentNext.fill('先于预览编辑的下一步');
  await label('客户（选填）').fill('未保存客户');
  await previewSuggestion();
  assert.equal(await nextField.isDisabled(), true);
  assert.equal(await waitingField.isDisabled(), false);
  await currentWaiting.fill('后于预览编辑的等待对象');
  await currentDate.fill('2026-12-03');
  await label('项目（选填）').fill('未保存项目');
  assert.ok(await waitingField.isDisabled() && await dateField.isDisabled());
  assert.equal(await suggestion.getByText('当前情况中有未保存修改，保留在原表单，本次不提交。', { exact: true }).count(), 3);
  await status.selectOption('retest');
  assert.equal(await apply.isDisabled(), true);
  await status.selectOption('in_progress');
  assert.equal(await apply.isEnabled(), true);
  const held = latch();
  putHold = latch();
  const putGate = async route => {
    if (route.request().method() === 'PUT') { held.release(); await putHold.promise; }
    await route.continue();
  };
  await page.route(`**${itemPath(edit)}`, putGate);
  await label('技术反馈正文').fill('稍慢的其他区保存。');
  const otherSave = save(edit, '保存正文');
  await held.promise;
  assert.equal(await apply.isDisabled(), true);
  putHold.release();
  edit = await otherSave;
  await page.unroute(`**${itemPath(edit)}`, putGate);
  putHold = undefined;
  if (await button('预览建议', suggestion).isVisible()) await previewSuggestion();
  edit = await submitSuggestion(edit, { status: 'waiting' });
  assert.equal(edit.waitingFor, '原有协调人');
  assert.equal(edit.followUpOn, '2026-12-01');
  assert.equal(edit.nextStep, undefined);
  assert.equal(await currentWaiting.inputValue(), '后于预览编辑的等待对象');
  assert.equal(await currentDate.inputValue(), '2026-12-03');
  assert.equal(await currentNext.inputValue(), '先于预览编辑的下一步');
  assert.equal(await label('客户（选填）').inputValue(), '未保存客户');
  assert.equal(await label('项目（选填）').inputValue(), '未保存项目');
  edit = await save(edit, '保存当前情况', context);
  assert.equal(edit.status, 'waiting');
  assert.equal(edit.nextStep, '先于预览编辑的下一步');
  assert.equal(edit.waitingFor, '后于预览编辑的等待对象');
  assert.equal(edit.followUpOn, '2026-12-03');
  assert.equal(edit.customer, '未保存客户');
  assert.equal(edit.project, '未保存项目');
  pass('B1-edit: append order beats sent time, dirty status and busy disable, all three draft fields excluded, customer/project and saved status persist');

  let conflict = await createCustomer('独验客户问题 C');
  conflict = await update(conflict, { status: 'in_progress', history: { kind: 'sent', body: '待并发测试的已发送记录。', sentAt: '2026-11-05T08:00:00+08:00' } });
  await openItem(conflict);
  await previewSuggestion();
  await waitingField.fill('建议预览里的未提交协调人');
  await currentNext.fill('并发时保护主表下一步');
  const rejectPut = route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, json: { error: { code: 'INDEPENDENT_TEST_503', message: '独验模拟保存失败。' } } })
    : route.continue();
  await page.route(`**${itemPath(conflict)}`, rejectPut);
  await save(conflict, '应用建议', suggestion, 503);
  await page.getByRole('alert').filter({ hasText: '独验模拟保存失败' }).waitFor();
  await page.unroute(`**${itemPath(conflict)}`, rejectPut);
  assert.equal(await waitingField.inputValue(), '建议预览里的未提交协调人');
  assert.equal(await currentNext.inputValue(), '并发时保护主表下一步');
  assert.equal(await page.getByText('建议已应用。', { exact: true }).count(), 0);
  assert.deepEqual(await current(conflict), conflict);
  const latest = await update(conflict, { history: { kind: 'technical_reply', body: '独立 HTTP 写入了更新事件。' }, waitingFor: '外部新协调人' });
  const countBeforeConflict = puts.length;
  await save(conflict, '应用建议', suggestion, 409);
  await button('重新读取最新版本', context).waitFor();
  assert.equal(await waitingField.inputValue(), '建议预览里的未提交协调人');
  assert.equal(await currentNext.inputValue(), '并发时保护主表下一步');
  assert.equal(await apply.isDisabled(), true);
  await button('重新读取最新版本', context).click();
  await suggest('转为待复测');
  await button('预览建议', suggestion).waitFor();
  assert.equal(await currentNext.inputValue(), '并发时保护主表下一步');
  assert.equal(await currentWaiting.inputValue(), '外部新协调人');
  assert.equal(puts.length, countBeforeConflict + 1);
  assert.deepEqual(await current(conflict), latest);
  conflict = await send(conflict, '2020-01-01T09:00');
  await suggest('转为等待技术');
  await status.selectOption('closed');
  await label('关闭原因').fill('人工关闭测试。');
  await save(conflict, '关闭事项', context);
  await noCustomerSuggestion();
  conflict = await save(conflict, '重开事项', context);
  assert.equal(conflict.status, 'triage');
  await noCustomerSuggestion();
  await openItem(conflict);
  await noCustomerSuggestion();
  assert.equal(await currentNext.inputValue(), '并发时保护主表下一步');
  pass('B1-edit failure/conflict: real stale PUT 409, input preserved, latest event recomputed without replay, close/reopen does not replay older sent event');

  const oldRaw = await addRaw('首轮口径合成资料', '原季度汇总采用净额。');
  const addedRaw = await addRaw('新增口径合成资料', '本季度汇总单列返点。');
  const removable = await addRaw('可取消关联的合成资料', '尚未用于分析的阶段数据。');
  const restricted = (await rawStore.createMeetingRegistration({ id: randomUUID(), title: '仅可本机查看的合成资料', body: '禁止选择此合成材料。',
    sourceName: 'WORK04B 独验合成会议', tags: [], importedAt: new Date().toISOString(), origin: { kind: 'meeting', meeting_id: randomUUID(),
      import_id: randomUUID(), original_sha256: 'a'.repeat(64), registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' } })).record;
  let product = await createProduct('独验产品事项');
  product = await update(product, { rawIds: [oldRaw.id] });
  const productSuggestion = button('带新资料继续分析');
  const noProductSuggestion = () => productSuggestion.waitFor({ state: 'hidden' });
  const addAssociation = async raw => {
    await label('选择已有 Raw').selectOption(raw.id);
    return save(product, '添加关联');
  };
  const picker = page.locator('fieldset.work-source-picker');
  const checkbox = raw => picker.getByRole('checkbox', { name: raw.title, exact: true });
  await openItem(product);
  await page.getByText('暂无分析记录。每轮结果都会保存在这条事项中。', { exact: true }).waitFor();
  await noProductSuggestion();
  const firstRun = await analysis(product, [oldRaw.id]);
  assert.equal(firstRun.status, 'completed');
  assert.equal(firstRun.outputVersion, undefined);
  const originalHash = sha(await readFile(runFile(product, firstRun)));
  const priorReview = await request(`${runPath(product)}/${firstRun.id}/basis-review`, 'POST');
  assert.equal(priorReview.status, 'completed');
  product = await update(product, { history: { kind: 'stage_result', body: '既有阶段成果保留。' } });
  await openItem(product);
  const firstPanel = await openRun(firstRun);
  await firstPanel.getByText('材料记录了本轮报告口径。', { exact: false }).first().waitFor();
  await firstPanel.getByText('模型未发现依据问题', { exact: true }).waitFor();
  await noProductSuggestion();
  product = await addAssociation(addedRaw);
  await productSuggestion.waitFor();
  const beforeNav = { puts: puts.length, posts: analysisPosts.length, calls: calls.length };
  await checkbox(oldRaw).check();
  await label('本轮问题（选填）').fill('只核对新增资料里的口径。');
  await label('承接阶段成果（选填）').selectOption('0');
  await atWidth(productSuggestion.locator('..'), 390, 'product-suggestion');
  await productSuggestion.click();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '本轮资料');
  const viewport = await picker.locator('legend').evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, height: innerHeight }));
  assert.ok(viewport.top >= 0 && viewport.bottom <= viewport.height);
  assert.equal(await checkbox(oldRaw).isChecked(), true);
  assert.equal(await checkbox(addedRaw).isChecked(), false);
  assert.equal(await label('本轮问题（选填）').inputValue(), '只核对新增资料里的口径。');
  assert.equal(await label('承接阶段成果（选填）').inputValue(), '0');
  assert.deepEqual(await current(product), product);
  assert.deepEqual({ puts: puts.length, posts: analysisPosts.length, calls: calls.length }, beforeNav);
  pass('B2 navigation: adding a Raw suggests continuation; narrow Chrome focuses original picker, leaves draft selection/question/stage and item intact, sends no PUT/POST/fake');

  await checkbox(oldRaw).uncheck();
  await checkbox(addedRaw).check();
  await button('预览发送内容').click();
  assert.equal(calls.length, beforeNav.calls);
  fakeHold = latch();
  failAnalysis = true;
  let finished = responseFor(runPath(product), 'POST');
  await button('发起分析').click();
  await poll(() => calls.length, count => count === beforeNav.calls + 1);
  await noProductSuggestion();
  assert.equal((await listRuns(product)).filter(run => run.status === 'running').length, 1);
  fakeHold.release();
  const failedRun = await (await finished).json();
  assert.equal(failedRun.status, 'failed');
  fakeHold = undefined;
  failAnalysis = false;
  await productSuggestion.waitFor();
  await checkbox(addedRaw).check();
  await label('本轮问题（选填）').fill('明确重新分析新增口径。');
  await button('预览发送内容').click();
  finished = responseFor(runPath(product), 'POST');
  await button('发起分析').click();
  const done = await (await finished).json();
  assert.equal(done.status, 'completed');
  assert.equal(done.outputVersion, 2);
  assert.equal(calls.length, beforeNav.calls + 2);
  assert.deepEqual(calls.slice(-2).map(call => call.rawIds), [[addedRaw.id], [addedRaw.id]]);
  const newPanel = await openRun(done);
  await newPanel.getByText('AI 标注：有支持材料（待核对）', { exact: true }).waitFor();
  await button('带入阶段成果', newPanel).click();
  const draft = await label('阶段成果正文').inputValue();
  assert.ok(draft.length < 600 && draft.includes('本轮摘要（待确认）') && draft.includes('是否有可比较样本？'));
  assert.ok(!draft.includes(addedRaw.body));
  await noProductSuggestion();
  await openItem(product);
  await openRun(done);
  await noProductSuggestion();
  assert.equal(sha(await readFile(runFile(product, firstRun))), originalHash);
  assert.deepEqual((await listRuns(product)).find(run => run.id === firstRun.id).basisReview, priorReview);
  pass('B2 runs: hidden during active work, failed run retains suggestion, v1 and completed v2 sources excluded after refresh, original A review and WORK03P summary/label remain available');

  product = await addAssociation(restricted);
  await noProductSuggestion();
  assert.ok(await picker.getByRole('checkbox', { name: new RegExp(restricted.title) }).isDisabled());
  product = await addAssociation(removable);
  await productSuggestion.waitFor();
  const linkRow = region('资料与成果').getByRole('listitem').filter({ has: button(`${removable.title} · 查看原文`) });
  product = await save(product, '移除关联', linkRow);
  await noProductSuggestion();
  product = await addAssociation(removable);
  await productSuggestion.waitFor();
  const refuseList = route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { error: { code: 'INDEPENDENT_LIST_503', message: '独验模拟分析记录读取失败。' } } })
    : route.continue();
  await page.route(`**${runPath(product)}`, refuseList);
  await button('刷新分析记录').click();
  await page.getByRole('alert').filter({ hasText: '独验模拟分析记录读取失败' }).waitFor();
  await noProductSuggestion();
  await page.unroute(`**${runPath(product)}`, refuseList);
  await button('刷新分析记录').click();
  await productSuggestion.waitFor();
  await status.selectOption('closed');
  await label('完成说明').fill('独验人工完成产品事项。');
  product = await save(product, '完成事项', context);
  await noProductSuggestion();
  product = await save(product, '重开事项', context);
  await productSuggestion.waitFor();
  await request(`/api/raw/${removable.id}`, 'DELETE');
  await openItem(product);
  assert.ok(await picker.getByRole('checkbox', { name: 'Raw 来源不可用', exact: true }).isDisabled());
  await openRun(done);
  await noProductSuggestion();
  assert.equal(calls.length, beforeNav.calls + 2);
  assert.equal(analysisPosts.length, beforeNav.posts + 2);
  pass('B2 suppression: unlink, unavailable, restricted, closed, no-completion and failed-list cases; only explicit analysis sends');

  const future = await update(await createCustomer('独验未来跟进'), { followUpOn: '2099-01-01' });
  const closedDue = await update(await createCustomer('独验已关闭跟进'), { followUpOn: dueDate, status: 'closed', closureReason: '已人工关闭。' });
  await nav('首页');
  const due = region('到期跟进');
  const dueCard = due.getByRole('article', { name: customer.title, exact: true });
  await dueCard.waitFor();
  for (const title of [future.title, closedDue.title]) assert.equal(await due.getByRole('article', { name: title, exact: true }).count(), 0);
  assert.equal(await productSuggestion.count(), 0);
  const opened = responseFor(itemPath(customer), 'GET');
  await button('查看事项', dueCard).click();
  assert.equal((await (await opened).json()).id, customer.id);
  await heading(customer.title).waitFor();
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(fakeErrors, []);
  assert.equal(calls.length, 4);
  pass('B2 home: existing due/future/closed rule and original item ID link; page errors 0, fake fixture errors 0');
} finally {
  fakeHold?.release();
  putHold?.release();
  await browser?.close();
  await ui?.close();
  if (child) {
    child.kill();
    await childExit;
  }
  if (fake.listening) {
    fake.closeAllConnections();
    await new Promise(resolve => fake.close(resolve));
  }
  await writeFile(path.join(root, 'api.log'), logs.join(''));
  await writeFile(path.join(root, 'summary.json'), JSON.stringify({ checks, ports, calls, puts, analysisPosts, fakeErrors, pageErrors, chrome: browser?.version(), realModelCalls: 0 }, null, 2));
}
