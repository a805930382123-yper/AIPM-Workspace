import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { build, preview } from 'vite';
import { RawStore } from '../../services/raw/store.ts';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';

const cache = path.resolve('node_modules/.cache/work02-review');
await mkdir(cache, { recursive: true });
const runRoot = await mkdtemp(path.join(cache, 'run-'));
const dataRoot = path.join(runRoot, 'data');
const envDir = path.join(runRoot, 'empty-env');
const config = path.join(runRoot, 'isolated.env');
await mkdir(envDir);
await writeFile(config, '');
console.log(`WORK02 isolated evidence: ${runRoot}`);

const rawStore = new RawStore(dataRoot);
const createRaw = (title, body) => rawStore.create({ title, body, sourceType: 'note', sourceName: 'WORK02 独验合成输入', tags: [] });
const first = await createRaw('智能参谋提问样本 第一批', '为什么北区上月销量下降？\n如何对比门店的毛利变化？');
const second = await createRaw('智能参谋提问样本 补充批', '能按促销活动拆分毛利变化吗？\n新增样本只覆盖促销分析。');
const unselected = await createRaw('未选择的合成样本', '此材料的内容不得发送给 Provider。');
const missing = await createRaw('稍后失效的合成样本', '失效样本的原文。');
const { record: restricted } = await rawStore.createMeetingRegistration({
  id: randomUUID(), title: '本机专用会议样本', sourceName: 'WORK02 独验合成输入', body: '会议内容不得发送给 Provider。',
  tags: [], importedAt: new Date().toISOString(), origin: {
    kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: '0'.repeat(64),
    registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only',
  },
});

const legacyId = randomUUID();
const screenshotId = randomUUID();
const now = new Date().toISOString();
const legacy = {
  id: legacyId, revision: 3, createdAt: now, updatedAt: now, title: '既有客户事项', feedback: '原反馈保留。',
  status: 'retest', rawIds: [first.id], history: [{ kind: 'reproduction', body: '原复现记录保留。', at: now }],
  screenshots: [{ id: screenshotId, type: 'image/png', note: '旧附件说明', uploadedAt: now }],
};
const legacyPath = path.join(dataRoot, 'work-items', `${legacyId}.json`);
const imagePath = path.join(dataRoot, 'work-items', 'screenshots', legacyId, `${screenshotId}.png`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6S8AAAAASUVORK5CYII=', 'base64');
await mkdir(path.dirname(imagePath), { recursive: true });
await writeFile(legacyPath, JSON.stringify(legacy));
await writeFile(imagePath, png);
const legacyBytes = await readFile(legacyPath);

const fakeSecret = 'work02-test-only-synthetic-key';
const fakeCalls = [];
const fakeErrors = [];
let responseMode = 'success';
let gate = Promise.resolve();
let releaseGate = () => {};
const fake = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, `Bearer ${fakeSecret}`);
    let text = '';
    for await (const part of req) text += part;
    const { messages, model } = JSON.parse(text);
    assert.equal(model, 'work02-local-fake');
    const input = messages.find(message => message.role === 'user').content;
    const mode = responseMode;
    const waitForRelease = gate;
    fakeCalls.push(input);
    await waitForRelease;
    if (mode === 'error') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Fake Provider 故障 ${fakeSecret}` } }));
      return;
    }
    const source = input.includes(second.id) ? second : first;
    const quote = mode === 'invalid' ? '本轮原文不存在的引文' : source.body.split('\n')[0];
    const result = {
      observations: [{ rawId: source.id, quote, observation: '样本显示用户希望解释指标变化。' }],
      suggestions: ['建议补齐归因能力，范围待确认。'],
      openQuestions: ['样本是否覆盖所有使用场景？'],
    };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  } catch (error) {
    fakeErrors.push(error.message);
    res.writeHead(500);
    res.end('合成测试服务请求异常');
  }
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
async function poll(read, done) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (done(value)) return value;
    await wait(100);
  }
  assert.fail('等待隔离服务状态超时');
}

async function startApi(root, withFake = true) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    windowsHide: true,
    env: {
      ...cleanEnv, FMCG_DATA_DIR: root, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config,
      ...(withFake ? {
        FMCG_LLM_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`,
        FMCG_LLM_MODEL: 'work02-local-fake', FMCG_LLM_API_KEY: fakeSecret,
      } : {}),
    },
  });
  const stopped = once(child, 'close');
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
    await writeFile(path.join(runRoot, `api-${port}.log`), logs);
  };
  try {
    await poll(() => fetch(`${base}/api/health`).then(response => response.ok).catch(() => false), Boolean);
    assert.ok(logs.includes(`(data: ${root})`), 'API must use its assigned isolated data root');
    return { base, close };
  } catch (error) {
    await close();
    throw new Error(`${error.message}\n${logs}`);
  }
}

async function request(api, url, { method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(api.base + url, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (status === 'error') assert.ok(response.status >= 400, `${method} ${url} unexpectedly succeeded`);
  else assert.equal(response.status, status, `${method} ${url}\n${JSON.stringify(payload)}`);
  return payload;
}

const itemPath = id => `/api/work-items/${id}`;
const runPath = id => `${itemPath(id)}/analysis-runs`;
const update = (api, item, patch, status) => request(api, itemPath(item.id), { method: 'PUT', body: { baseRevision: item.revision, ...patch }, status });
const runAnalysis = (api, item, rawIds, status = 201) => request(api, runPath(item.id), { method: 'POST', body: { baseRevision: item.revision, rawIds }, status });
const date = offset => new Date(Date.now() + 3_600_000 * (8 + 24 * offset)).toISOString().slice(0, 10);

let api, ui, browser;
try {
  api = await startApi(dataRoot);
  const wikiBefore = await request(api, '/api/wiki');
  const rawStateBefore = await request(api, '/api/raw-processing');
  const originalFiles = await Promise.all([first, second, unselected].map(raw => readFile(path.join(dataRoot, 'knowledge/raw/notes', `${raw.id}.md`))));
  const vite = { envDir, build: { outDir: path.join(runRoot, 'dist') } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': api.base } } });
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.WORK02_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.WORK02_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const uiBase = `http://127.0.0.1:${ui.httpServer.address().port}`;
  const button = name => page.getByRole('button', { name, exact: true });
  const label = name => page.getByLabel(name, { exact: true });
  const nextResponse = (method, url) => page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === url);
  const saveFromPage = async (action, method, url, status = 200) => {
    const responsePromise = nextResponse(method, url);
    await action();
    const response = await responsePromise;
    assert.equal(response.status(), status, await response.text());
    return response.json();
  };
  const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
  const read = id => request(api, itemPath(id));
  const due = () => request(api, '/api/work-items?due=1').then(response => response.items);
  const runs = id => request(api, runPath(id)).then(response => response.items);
  const title = '智能参谋用户提问能力缺口分析';
  const confirmed = '已确认：第一批材料仅有两条提问。';
  const unresolved = '仍需获取按活动拆分的追问。';

  await page.goto(uiBase, { waitUntil: 'domcontentloaded' });
  await nav('工作事项');
  await button('新建产品分析').click();
  await label('事项标题').fill(title);
  await label('分析目标').fill('找出智能参谋尚未满足的用户提问。');
  let item = await saveFromPage(() => button('创建事项').click(), 'POST', '/api/work-items', 201);
  assert.equal(item.kind, 'product_analysis');
  assert.equal(item.status, 'triage');
  const id = item.id;
  const detailUrl = itemPath(id);
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.getByText(/分区保存|各区独立保存/).first().waitFor();
  await label('数据范围与口径').fill('第一批只覆盖北区两条合成提问。');
  await label('已确认结论').fill(confirmed);
  await label('未解问题').fill(unresolved);
  const saveCurrent = () => saveFromPage(() => button('保存当前情况').click(), 'PUT', detailUrl);
  const stageEditor = label('阶段成果正文');
  await label('状态').selectOption({ label: '等待补充' });
  await label('等谁／等什么（选填）').fill('等待促销分析样本');
  await label('下一步（选填）').fill('先整理第一批提问，补充材料后继续');
  item = await saveCurrent();
  assert.equal(item.status, 'waiting');
  assert.equal(item.analysis.confirmedConclusions, confirmed);
  assert.equal(item.analysis.openQuestions, unresolved);
  assert.ok(!(await due()).some(row => row.id === id));
  await label('跟进日期（选填）').fill(date(0));
  item = await saveCurrent();
  await stageEditor.fill('阶段成果：已制定按提问目标归类的分析口径。');
  item = await saveFromPage(() => button('保存阶段成果').click(), 'PUT', detailUrl);
  assert.ok(item.history.some(entry => entry.kind === 'stage_result' && entry.body.includes('分析口径')));
  await nav('首页');
  const dueRow = page.getByRole('article', { name: title, exact: true });
  await dueRow.getByText('产品分析', { exact: false }).waitFor();
  const reopened = await saveFromPage(() => dueRow.getByRole('button', { name: '查看事项' }).click(), 'GET', detailUrl);
  assert.equal(reopened.id, id);
  await page.getByText('阶段成果：已制定按提问目标归类的分析口径。', { exact: true }).waitFor();
  assert.equal(await label('已确认结论').inputValue(), confirmed);
  console.log('P01 Chrome create, manual stage, waiting and same-ID return from due list passed');

  const addRaw = async source => {
    await label('选择已有 Raw').selectOption(source.id);
    item = await saveFromPage(() => button('添加关联').click(), 'PUT', detailUrl);
    assert.ok(item.rawIds.includes(source.id));
  };
  await addRaw(first);
  await addRaw(unselected);
  const selectSource = source => page.getByRole('checkbox', { name: new RegExp(source.title) }).check();
  const trigger = () => saveFromPage(() => button('发起分析').click(), 'POST', runPath(id), 201);
  await selectSource(first);
  const beforeFirstRun = await read(id);
  gate = new Promise(resolve => { releaseGate = resolve; });
  const firstRequest = trigger();
  try {
    await poll(() => Promise.resolve(fakeCalls.length), count => count === 1);
    await nav('首页');
  } finally {
    releaseGate();
  }
  const firstRun = await firstRequest;
  await saveFromPage(() => dueRow.getByRole('button', { name: '查看事项' }).click(), 'GET', detailUrl);
  assert.equal(firstRun.status, 'completed');
  assert.deepEqual(firstRun.input.sources.map(source => [source.rawId, source.body]), [[first.id, first.body]]);
  assert.deepEqual(JSON.parse(fakeCalls[0]).sources.map(source => [source.rawId, source.body]), [[first.id, first.body]]);
  assert.equal(fakeCalls.length, 1);
  assert.deepEqual(await read(id), beforeFirstRun, 'AI execution must not write an item conclusion or stage result');
  await page.locator(`button[aria-controls="analysis-${firstRun.id}"]`).click();
  await page.getByText(first.body.split('\n')[0], { exact: true }).waitFor();
  await page.getByText('建议补齐归因能力，范围待确认。', { exact: false }).first().waitFor();
  await page.getByText('样本是否覆盖所有使用场景？', { exact: false }).first().waitFor();
  await button('带入阶段成果').click();
  assert.deepEqual(await read(id), beforeFirstRun, 'Filling the editor must not persist a stage result');
  const editedStage = '第一轮阶段成果：人工复核后先保留指标变化归因这个方向。';
  await stageEditor.fill(editedStage);
  item = await saveFromPage(() => button('保存阶段成果').click(), 'PUT', detailUrl);
  assert.deepEqual(item.history.filter(entry => entry.body === editedStage).map(entry => entry.analysisRunId), [firstRun.id]);
  assert.equal(item.analysis.confirmedConclusions, confirmed);

  await nav('首页');
  await saveFromPage(() => dueRow.getByRole('button', { name: '查看事项' }).click(), 'GET', detailUrl);
  await addRaw(second);
  await label('状态').selectOption({ label: '进行中' });
  await label('数据范围与口径').fill('第二批补充促销分析提问，仅用于本轮观察。');
  await label('跟进日期（选填）').fill(date(1));
  item = await saveCurrent();
  assert.ok(!(await due()).some(row => row.id === id));
  await selectSource(second);
  const secondRun = await trigger();
  assert.equal(secondRun.status, 'completed');
  assert.notEqual(secondRun.id, firstRun.id);
  assert.equal(fakeCalls.length, 2);
  assert.deepEqual(JSON.parse(fakeCalls[1]).sources.map(source => [source.rawId, source.body]), [[second.id, second.body]]);
  assert.equal(JSON.parse(fakeCalls[1]).confirmedConclusions, confirmed);
  assert.equal(secondRun.input.dataScope, '第二批补充促销分析提问，仅用于本轮观察。');
  const completed = await runs(id);
  assert.deepEqual(new Set(completed.map(run => run.id)), new Set([firstRun.id, secondRun.id]));
  assert.ok(completed.some(run => run.id === firstRun.id && run.input.sources[0].body === first.body));
  assert.ok((await read(id)).history.some(entry => entry.body === editedStage && entry.analysisRunId === firstRun.id));
  await page.getByText(second.body.split('\n')[0], { exact: true }).waitFor();
  await page.screenshot({ path: path.join(runRoot, 'product-analysis-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await button('发起分析').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(runRoot, 'product-analysis-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('P02 Chrome select, two real HTTP fake runs, evidence, explicit edited stage and prior-run retention passed');

  item = await update(api, await read(id), { status: 'closed', closureReason: '已完成两轮合成分析', followUpOn: date(0) });
  assert.equal(item.status, 'closed');
  assert.ok(!(await due()).some(row => row.id === id));
  assert.deepEqual(await runs(id), completed);

  await nav('工作事项');
  await page.getByRole('button', { name: /既有客户事项/ }).click();
  await page.getByRole('heading', { name: legacy.title, exact: true }).waitFor();
  await page.getByText(/分区保存|各区独立保存/).first().waitFor();
  assert.deepEqual(await readFile(legacyPath), legacyBytes, 'Reading must not migrate a missing-kind customer item');
  await page.getByText(legacy.feedback, { exact: true }).waitFor();
  await label('记录类型').selectOption({ label: '复测记录' });
  await label('复测结果').selectOption({ label: '未通过' });
  await label('记录内容').fill('旧客户问题复测行为仍可用。');
  const customer = await saveFromPage(() => button('保存处理记录').click(), 'PUT', itemPath(legacyId));
  assert.equal(customer.feedback, legacy.feedback);
  assert.deepEqual(customer.history[0], legacy.history[0]);
  assert.equal(customer.history[1].outcome, 'failed');
  assert.deepEqual(customer.screenshots, legacy.screenshots);
  const oldImageUrl = `${itemPath(legacyId)}/screenshots/${screenshotId}`;
  assert.deepEqual(await request(api, oldImageUrl), png);
  assert.deepEqual(pageErrors, []);

  const negative = await request(api, '/api/work-items', {
    method: 'POST', status: 201, body: { kind: 'product_analysis', title: '独立执行失败测试', goal: '核对选择与恢复边界' },
  });
  await runAnalysis(api, negative, [first.id], 'error');
  let boundary = await update(api, negative, { rawIds: [first.id, restricted.id, missing.id] });
  await rawStore.delete(missing.id);
  await runAnalysis(api, boundary, [missing.id], 'error');
  await runAnalysis(api, boundary, [restricted.id], 'error');
  await runAnalysis(api, negative, [first.id], 409);
  assert.equal(fakeCalls.length, 2, 'Validation errors must not call the configured model');

  responseMode = 'invalid';
  const invalid = await runAnalysis(api, boundary, [first.id]);
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.output, undefined);
  assert.equal(fakeCalls.length, 3);
  responseMode = 'error';
  const providerError = await runAnalysis(api, boundary, [first.id]);
  assert.equal(providerError.status, 'failed');
  assert.equal(providerError.output, undefined);
  assert.ok(!JSON.stringify(providerError).includes(fakeSecret));
  assert.equal(fakeCalls.length, 4);
  assert.deepEqual(await read(boundary.id), boundary);

  responseMode = 'success';
  gate = new Promise(resolve => { releaseGate = resolve; });
  const continuing = runAnalysis(api, boundary, [first.id]);
  await poll(() => Promise.resolve(fakeCalls.length), count => count === 5);
  const pending = (await runs(boundary.id)).find(run => run.status === 'running');
  assert.ok(pending);
  try {
    boundary = await update(api, boundary, { status: 'waiting', nextStep: '等数据期间保存了新的安排' });
  } finally {
    releaseGate();
  }
  const continued = await continuing;
  assert.equal(continued.id, pending.id);
  assert.equal(continued.status, 'completed');
  assert.deepEqual(await read(boundary.id), boundary, 'Finishing the run must preserve newer item edits');

  gate = new Promise(resolve => { releaseGate = resolve; });
  const interruptedRequest = runAnalysis(api, boundary, [first.id]).catch(error => error);
  await poll(() => Promise.resolve(fakeCalls.length), count => count === 6);
  const interrupted = (await runs(boundary.id)).find(run => run.status === 'running');
  assert.ok(interrupted);
  await api.close();
  api = undefined;
  releaseGate();
  await interruptedRequest;
  api = await startApi(dataRoot, false);
  const interruptedAfterRestart = (await runs(boundary.id)).find(run => run.id === interrupted.id);
  assert.equal(interruptedAfterRestart.status, 'interrupted');
  await runAnalysis(api, boundary, [first.id], 'error');
  assert.equal(fakeCalls.length, 6, 'Restart, GET and unconfigured request must not send');
  assert.deepEqual(fakeErrors, []);
  assert.deepEqual(await request(api, '/api/wiki'), wikiBefore);
  assert.deepEqual(await request(api, '/api/raw-processing'), rawStateBefore);
  assert.deepEqual(await Promise.all([first, second, unselected].map(raw => readFile(path.join(dataRoot, 'knowledge/raw/notes', `${raw.id}.md`)))), originalFiles);
  console.log('P03 real HTTP preflight, model failures, concurrent item edits and interrupted restart passed');

  await api.close();
  api = undefined;
  const archive = path.join(runRoot, 'backup.json');
  const restored = path.join(runRoot, 'restored');
  await exportWorkspace(dataRoot, archive);
  await restoreWorkspace(archive, restored);
  api = await startApi(restored, false);
  assert.deepEqual(await read(id), item);
  assert.deepEqual(await runs(id), completed);
  assert.deepEqual(await read(legacyId), customer);
  assert.deepEqual(await request(api, oldImageUrl), png);
  assert.equal(fakeCalls.length, 6);
  console.log('P04 Chrome customer compatibility and actual backup/restore round trip passed');
  await writeFile(path.join(runRoot, 'result.json'), JSON.stringify({ checks: ['P01', 'P02', 'P03', 'P04'], providerCalls: fakeCalls.length, chrome: browser.version(), pageErrors }, null, 2));
} finally {
  releaseGate();
  await browser?.close();
  await ui?.close();
  await api?.close();
  fake.closeAllConnections();
  await new Promise(resolve => fake.close(resolve));
}
