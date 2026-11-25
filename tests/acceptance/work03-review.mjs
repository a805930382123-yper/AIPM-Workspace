import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
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

const cache = path.resolve(process.env.WORK03_REVIEW_CACHE ?? 'node_modules/.cache/work03-review');
await mkdir(cache, { recursive: true });
const runRoot = await mkdtemp(path.join(cache, 'run-'));
const dataRoot = path.join(runRoot, 'data');
const envDir = path.join(runRoot, 'empty-env');
const config = path.join(runRoot, 'isolated.env');
await mkdir(envDir);
await writeFile(config, '');
console.log('WORK03 isolated evidence:', runRoot);

const raws = new RawStore(dataRoot);
const sourceName = 'WORK03 独验合成资料';
const createRaw = (title, body) => raws.create({ title, body, sourceType: 'note', sourceName, tags: [] });
const first = await createRaw('独验第一批提问', '能否按北区拆解促销销量变化？\nFIRST-SOURCE-ONLY。');
const next = await createRaw('独验补充提问', '南区也有用户要求按活动拆分销量。\n北区已经可以按单店查看销量。\n仅记录两条独验合成提问。');
const unselected = await createRaw('独验不发送资料', 'UNSELECTED-SOURCE-ONLY。');
const later = await createRaw('独验再次补充', '最新合成提问要求区分活动期和基准期。');
const registerRestricted = (store, id) => store.createMeetingRegistration({
  id, title: '独验会议受限原文', sourceName, body: 'MEETING-LOCAL-ONLY。',
  tags: [], importedAt: new Date().toISOString(), origin: {
    kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: '0'.repeat(64),
    registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only',
  },
});
const { record: restricted } = await registerRestricted(raws, randomUUID());

const legacyId = randomUUID();
const screenshotId = randomUUID();
const now = new Date().toISOString();
const legacy = {
  id: legacyId, revision: 3, createdAt: now, updatedAt: now, title: '独验既有客户事项', feedback: '历史客户反馈。',
  status: 'retest', rawIds: [], history: [{ kind: 'reproduction', body: '历史复现记录。', at: now }],
  screenshots: [{ id: screenshotId, type: 'image/png', note: '历史附件', uploadedAt: now }],
};
const legacyFile = path.join(dataRoot, 'work-items', legacyId + '.json');
const screenshotFile = path.join(dataRoot, 'work-items', 'screenshots', legacyId, screenshotId + '.png');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6S8AAAAASUVORK5CYII=', 'base64');
await mkdir(path.dirname(screenshotFile), { recursive: true });
await writeFile(legacyFile, JSON.stringify(legacy));
await writeFile(screenshotFile, png);
const legacyBytes = await readFile(legacyFile);

const fakeSecret = 'work03-test-only-synthetic-key';
const fakeCalls = [];
const fakeErrors = [];
const summary = '本轮发现活动拆分需求也出现在南区，单店销量已有入口，覆盖范围仍需补核。';
const oldSuggestion = '仅第一轮输出的归因方向 OLD-OUTPUT-ONLY。';
const themeName = '活动拆分覆盖范围';
const hypothesis = '活动期与基准期的比较可能也是缺口。';
const openQuestion = '还需要哪些分区样本？';
const revisionSuggestion = '将目前范围改为同时观察北区和南区，再确认覆盖。';
let responseMode = 'v2';
let gate = Promise.resolve();
let releaseGate = () => {};
const fake = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer ' + fakeSecret);
    let text = '';
    for await (const part of req) text += part;
    const { messages, model } = JSON.parse(text);
    assert.equal(model, 'work03-local-fake');
    const input = JSON.parse(messages.find(message => message.role === 'user').content);
    const mode = responseMode;
    fakeCalls.push(input);
    await gate;
    const source = input.sources[0];
    const lines = source.body.split('\n');
    const result = {
      observations: [{
        rawId: source.rawId,
        quote: lines[0],
        observation: mode === 'v1' ? '首轮只见北区的活动拆分提问。' : '补充样本出现了不同分区的活动拆分提问。',
      }],
      suggestions: [mode === 'v1' ? oldSuggestion : '先核对活动拆分已有覆盖。'],
      openQuestions: [openQuestion],
    };
    if (mode !== 'v1') {
      if (lines[1]) result.observations.push({ rawId: source.rawId, quote: lines[1], observation: '已有单店查看入口，不能把所有销量查看都列为缺口。' });
      result.roundSummary = summary;
      result.themes = [{
        title: themeName,
        conclusion: { kind: 'evidence_supported', text: '活动拆分需求不止一个分区。' },
        evidence: [0], counterEvidence: lines[1] ? [1] : [],
        openQuestions: [openQuestion], nextSteps: ['再补充地区对照样本。'],
        confirmedConflict: input.confirmedConclusions ? {
          confirmedQuote: input.confirmedConclusions, observationIndexes: [0], suggestedRevision: revisionSuggestion,
        } : null,
      }, {
        title: '待验证的比较口径',
        conclusion: { kind: 'hypothesis', text: hypothesis },
        evidence: [], counterEvidence: [],
        openQuestions: ['能否补到同一活动的两个时间段？'], nextSteps: [], confirmedConflict: null,
      }, {
        title: '活动成本尚无依据', conclusion: null, evidence: [], counterEvidence: [],
        openQuestions: ['是否有活动投入和费用口径？'], nextSteps: [], confirmedConflict: null,
      }];
      if (mode === 'index') result.themes[0].evidence = [2];
      if (mode === 'overlap') result.themes[0].counterEvidence = [0];
      if (mode === 'unsupported') result.themes[0].evidence = [];
      if (mode === 'quote') result.observations[0].quote = '不存在的精确引文。';
      if (mode === 'conflict') result.themes[0].confirmedConflict = {
        confirmedQuote: '未被用户确认过的文字', observationIndexes: [0], suggestedRevision: revisionSuggestion,
      };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: mode === 'truncated' ? 'length' : 'stop' }] }));
  } catch (error) {
    fakeErrors.push(error.message);
    res.writeHead(500);
    res.end('合成测试服务请求异常');
  }
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const ports = { fake: fake.address().port, api: [] };
async function poll(read, done) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (done(value)) return value;
    await wait(100);
  }
  assert.fail('等待独立验收隔离服务状态超时');
}

async function startApi(root, withFake = true) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    windowsHide: true,
    env: withoutInheritedEmbeddings({
      ...cleanEnv, FMCG_DATA_DIR: root, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config,
      ...(withFake ? {
        FMCG_LLM_BASE_URL: 'http://127.0.0.1:' + ports.fake + '/v1',
        FMCG_LLM_MODEL: 'work03-local-fake', FMCG_LLM_API_KEY: fakeSecret,
      } : {}),
    }),
  });
  const stopped = once(child, 'close');
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const base = 'http://127.0.0.1:' + port;
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
    await writeFile(path.join(runRoot, 'api-' + port + '.log'), logs);
  };
  try {
    await poll(() => fetch(base + '/api/health').then(response => response.ok).catch(() => false), Boolean);
    assert.ok(logs.includes('(data: ' + root + ')'), 'API must use its assigned isolated data root');
    ports.api.push(port);
    return { base, close };
  } catch (error) {
    await close();
    throw new Error(error.message + '\n' + logs);
  }
}

async function request(api, url, { method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(api.base + url, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const payload = response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (status === 'error') assert.ok(response.status >= 400, method + ' ' + url + ' unexpectedly succeeded');
  else assert.equal(response.status, status, method + ' ' + url + '\n' + JSON.stringify(payload));
  return payload;
}

const itemPath = id => '/api/work-items/' + id;
const runPath = id => itemPath(id) + '/analysis-runs';
const update = (api, item, patch) => request(api, itemPath(item.id), { method: 'PUT', body: { baseRevision: item.revision, ...patch } });
const runAnalysis = (api, item, body, status = 201) => request(api, runPath(item.id), { method: 'POST', body: { baseRevision: item.revision, ...body }, status });
const runFile = (itemId, runId) => path.join(dataRoot, 'work-items', 'analysis-runs', itemId, runId + '.json');
const date = offset => new Date(Date.now() + 3_600_000 * (8 + 24 * offset)).toISOString().slice(0, 10);
const confirmed = '已确认：活动拆分提问目前只观察到北区。';
const unresolved = '南区尚未补样本。';
const goal = '找出不同地区活动销量分析的能力缺口。';
const dataScope = '只观察已收集的地区提问，不推断总体频次。';
const manualStage = '人工阶段成果：先按活动及地区整理问题 MANUAL-STAGE-ONLY。';
const editedStage = '人工修订首轮草稿：继续核对活动拆分的地区覆盖 EDITED-STAGE-ONLY。';
const pendingStage = '正在编辑未保存阶段成果 UNSAVED-STAGE-ONLY。';
const pendingScope = '正在编辑未保存口径 UNSAVED-SCOPE-ONLY。';
const question = '补充提问是否推翻首轮对地区覆盖的判断？';
const finalStage = '复核后保留本轮待核问题 SECOND-EDITED-STAGE-ONLY。';
const title = '独验智能参谋提问能力缺口分析';
const evidenceFiles = [first, next, unselected, later].map(raw => path.join(dataRoot, 'knowledge', 'raw', 'notes', raw.id + '.md'));

let api, ui, browser;
try {
  api = await startApi(dataRoot);
  const read = id => request(api, itemPath(id));
  const runs = id => request(api, runPath(id)).then(response => response.items);
  const wikiBefore = await request(api, '/api/wiki');
  const rawStateBefore = await request(api, '/api/raw-processing');
  const originalFiles = await Promise.all(evidenceFiles.map(file => readFile(file)));
  let item = await request(api, '/api/work-items', { method: 'POST', status: 201, body: { kind: 'product_analysis', title, goal } });
  const id = item.id;
  item = await update(api, item, {
    analysis: { dataScope, confirmedConclusions: confirmed, openQuestions: unresolved },
    rawIds: [first.id, unselected.id],
    status: 'waiting', nextStep: '补充样本后续轮', followUpOn: date(0),
  });
  responseMode = 'v1';
  const firstRun = await runAnalysis(api, item, { rawIds: [first.id] });
  assert.equal(firstRun.status, 'completed');
  assert.deepEqual(Object.keys(firstRun.output).sort(), ['observations', 'openQuestions', 'suggestions']);
  assert.equal(firstRun.outputVersion ?? 1, 1);
  assert.deepEqual(fakeCalls[0], {
    goal, dataScope, confirmedConclusions: confirmed, openQuestions: unresolved,
    sources: [{ rawId: first.id, title: first.title, body: first.body }],
  });
  // Freeze the old on-disk shape so the browser and restore assertions exercise a real legacy read.
  delete firstRun.outputVersion;
  delete firstRun.sourceRawIds;
  await writeFile(runFile(id, firstRun.id), JSON.stringify(firstRun));
  assert.deepEqual(await runs(id), [firstRun]);
  const oldRunBytes = await readFile(runFile(id, firstRun.id));

  const vite = { envDir, build: { outDir: path.join(runRoot, 'dist') } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': api.base } } });
  ports.ui = ui.httpServer.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.WORK03_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.WORK03_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
  const label = name => page.getByLabel(name, { exact: typeof name === 'string' });
  const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
  const waitResponse = (method, url) => page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === url);
  const saveFromPage = async (action, method, url, status = 200) => {
    const pending = waitResponse(method, url);
    await action();
    const response = await pending;
    assert.equal(response.status(), status, await response.text());
    return response.json();
  };
  const runPanel = runId => page.locator('#analysis-' + runId);
  const openRun = async runId => {
    const toggle = page.locator('button[aria-controls="analysis-' + runId + '"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    return runPanel(runId);
  };
  const stageEditor = label('阶段成果正文');
  const saveStage = () => saveFromPage(() => button('保存阶段成果').click(), 'PUT', itemPath(id));
  const dueRow = page.getByRole('article', { name: title, exact: true });
  await page.goto('http://127.0.0.1:' + ports.ui, { waitUntil: 'domcontentloaded' });
  const same = await saveFromPage(() => dueRow.getByRole('button', { name: '查看事项' }).click(), 'GET', itemPath(id));
  assert.equal(same.id, id);
  const oldPanel = await openRun(firstRun.id);
  await oldPanel.getByText(oldSuggestion, { exact: true }).waitFor();

  await stageEditor.fill(manualStage);
  item = await saveStage();
  await oldPanel.getByRole('button', { name: '带入阶段成果', exact: true }).click();
  assert.ok((await stageEditor.inputValue()).includes(oldSuggestion));
  assert.deepEqual(await read(id), item, 'Carrying output into the editor must not save the item');
  await stageEditor.fill(editedStage);
  item = await saveStage();
  const historyIndex = item.history.findIndex(entry => entry.body === editedStage);
  assert.equal(item.history[historyIndex].analysisRunId, firstRun.id);
  assert.equal(item.history.find(entry => entry.body === manualStage).analysisRunId, undefined);

  await label('选择已有 Raw').selectOption(next.id);
  item = await saveFromPage(() => button('添加关联').click(), 'PUT', itemPath(id));
  await label('数据范围与口径').fill(pendingScope);
  await stageEditor.fill(pendingStage);
  const stageSelect = label(/承接.*阶段成果|阶段成果.*承接/);
  assert.equal(await stageSelect.inputValue(), '', 'A prior stage result must not be selected automatically');
  await stageSelect.selectOption(String(historyIndex));
  await label(/本轮问题/).fill(question);
  await page.getByRole('checkbox', { name: new RegExp(next.title) }).check();
  await button('预览发送内容').click();
  const sendPreview = page.getByRole('region', { name: '发送预览' });
  await sendPreview.locator('summary').filter({ hasText: /带入 AI 草稿后保存/ }).click();
  await sendPreview.locator('summary').filter({ hasText: next.title }).click();
  await sendPreview.getByText(editedStage, { exact: true }).waitFor();
  await sendPreview.getByText(next.body.split('\n')[2], { exact: false }).waitFor();
  assert.equal(await sendPreview.getByText(manualStage, { exact: true }).count(), 0);
  assert.equal(await sendPreview.getByText(pendingScope, { exact: true }).count(), 0);
  assert.equal(fakeCalls.length, 1, 'Opening the send preview must not call the model');
  await sendPreview.screenshot({ path: path.join(runRoot, 'desktop-send-preview.png') });

  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await sendPreview.screenshot({ path: path.join(runRoot, 'mobile-send-preview.png') });
  responseMode = 'v2';
  const secondRun = await saveFromPage(() => button('发起分析').click(), 'POST', runPath(id), 201);
  assert.equal(secondRun.status, 'completed');
  assert.notEqual(secondRun.id, firstRun.id);
  assert.equal(secondRun.outputVersion, 2);
  assert.equal(fakeCalls.length, 2);
  const outbound = fakeCalls[1];
  assert.deepEqual(outbound, {
    goal, dataScope, confirmedConclusions: confirmed, openQuestions: unresolved, roundQuestion: question,
    stageContext: { body: editedStage, source: 'ai_assisted' },
    sources: [{ rawId: next.id, title: next.title, body: next.body }],
  });
  assert.deepEqual(secondRun.input.stageContext, {
    historyIndex, at: item.history[historyIndex].at, body: editedStage, source: 'ai_assisted', analysisRunId: firstRun.id,
  });
  assert.deepEqual(new Set(secondRun.sourceRawIds), new Set([first.id, next.id]));
  assert.deepEqual(await read(id), item);
  assert.deepEqual(await readFile(runFile(id, firstRun.id)), oldRunBytes);
  assert.equal(await label('数据范围与口径').inputValue(), pendingScope);
  assert.equal(await stageEditor.inputValue(), pendingStage);
  console.log('W03-01 Chrome old run, two stage types, explicit preview and isolated v2 continuation passed');

  const secondPanel = await openRun(secondRun.id);
  await secondPanel.getByText(summary, { exact: true }).waitFor();
  await secondPanel.getByText(themeName, { exact: true }).waitFor();
  await secondPanel.getByText(hypothesis, { exact: false }).waitFor();
  await secondPanel.getByText('现有资料不足以形成结论', { exact: false }).waitFor();
  await secondPanel.getByText(revisionSuggestion, { exact: false }).waitFor();
  const quotes = next.body.split('\n');
  const theme = secondPanel.getByRole('region', { name: themeName, exact: true });
  const evidence = theme.getByRole('link', { name: '观察 1', exact: true }).first();
  const evidenceId = await evidence.getAttribute('href');
  assert.match(evidenceId, /^#observation-/);
  await evidence.click();
  assert.equal(new URL(page.url()).hash, evidenceId);
  await secondPanel.locator(evidenceId).getByText(quotes[0], { exact: true }).waitFor();
  for (const quote of quotes.slice(0, 2)) {
    await secondPanel.locator('blockquote').filter({ hasText: quote }).first().waitFor();
  }
  await secondPanel.locator(evidenceId).getByRole('button', { name: '查看本轮原文', exact: true }).click();
  await secondPanel.getByText(quotes[2], { exact: false }).waitFor();
  await secondPanel.screenshot({ path: path.join(runRoot, 'mobile-theme-and-evidence.png') });
  const bring = secondPanel.getByRole('button', { name: '带入阶段成果', exact: true });
  assert.equal(await bring.isDisabled(), true, 'Existing stage editor text must not be overwritten');
  await stageEditor.fill('');
  await bring.click();
  const proposal = await stageEditor.inputValue();
  for (const needle of [themeName, quotes[0], openQuestion]) assert.ok(proposal.includes(needle), 'Stage draft lost ' + needle);
  assert.deepEqual(await read(id), item);
  await stageEditor.fill(finalStage);
  item = await saveStage();
  const finalIndex = item.history.findIndex(entry => entry.body === finalStage);
  assert.equal(item.history[finalIndex].analysisRunId, secondRun.id);
  assert.equal(item.history.length, 3);
  assert.deepEqual(item.analysis, { goal, dataScope, confirmedConclusions: confirmed, openQuestions: unresolved });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await secondPanel.screenshot({ path: path.join(runRoot, 'desktop-theme-and-evidence.png') });
  const mainRuns = await runs(id);

  await stageSelect.selectOption(String(finalIndex));
  const nextSourceBox = page.getByRole('checkbox', { name: new RegExp(next.title) });
  await nextSourceBox.check();
  await button('预览发送内容').click();
  item = await update(api, item, { nextStep: '另一处已保存最新安排。' });
  const stale = await saveFromPage(() => button('发起分析').click(), 'POST', runPath(id), 409);
  assert.match(JSON.stringify(stale), /REVISION_CONFLICT/);
  await page.getByText(/重新选择/).first().waitFor();
  assert.equal(await stageSelect.inputValue(), '');
  assert.equal(await nextSourceBox.isChecked(), false);
  assert.equal(await label('数据范围与口径').inputValue(), pendingScope);
  assert.equal(fakeCalls.length, 2, 'An outdated browser preview must not send');

  await nav('工作事项');
  await page.getByRole('button', { name: new RegExp(legacy.title) }).click();
  await page.getByRole('heading', { name: legacy.title, exact: true }).waitFor();
  await page.getByText(legacy.feedback, { exact: true }).waitFor();
  assert.deepEqual(await readFile(legacyFile), legacyBytes);
  await label('记录类型').selectOption({ label: '复测记录' });
  await label('复测结果').selectOption({ label: '未通过' });
  await label('记录内容').fill('旧事项可以记录新的复测。');
  const customer = await saveFromPage(() => button('保存处理记录').click(), 'PUT', itemPath(legacy.id));
  assert.deepEqual(customer.history[0], legacy.history[0]);
  assert.equal(customer.history[1].outcome, 'failed');
  assert.deepEqual(customer.screenshots, legacy.screenshots);
  const oldImageUrl = itemPath(legacyId) + '/screenshots/' + screenshotId;
  assert.deepEqual(await request(api, oldImageUrl), png);
  await nav('首页');
  const sameAgain = await saveFromPage(() => dueRow.getByRole('button', { name: '查看事项' }).click(), 'GET', itemPath(id));
  assert.equal(sameAgain.id, id);
  const finalHistory = page.locator('li').filter({ hasText: finalStage });
  await finalHistory.getByRole('button', { name: '查看该轮分析' }).click();
  await runPanel(secondRun.id).getByText(summary, { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);

  let boundary = await request(api, '/api/work-items', {
    method: 'POST', status: 201, body: { kind: 'product_analysis', title: '独验发送边界', goal: '保持本轮发送边界' },
  });
  boundary = await update(api, boundary, {
    rawIds: [next.id, restricted.id], status: 'closed', closureReason: '构造非成果历史项',
    analysis: { confirmedConclusions: confirmed },
  });
  boundary = await update(api, boundary, { reopen: true, history: { kind: 'stage_result', body: fakeSecret } });
  const secretIndex = boundary.history.findIndex(entry => entry.kind === 'stage_result');
  const good = { outputVersion: 2, rawIds: [next.id] };
  const deny = [
    { stageHistoryIndex: 999 }, { stageHistoryIndex: 0 }, { stageHistoryIndex: 1.5 },
    { stageContext: { body: 'FORGED-STAGE' } }, { runId: firstRun.id },
    { stageHistoryIndex: secretIndex }, { roundQuestion: fakeSecret }, { roundQuestion: '问'.repeat(2001) },
    { rawIds: [restricted.id] }, { rawIds: [unselected.id] },
    { outputVersion: 1, roundQuestion: question },
  ];
  const beforeDenials = fakeCalls.length;
  for (const patch of deny) {
    const failure = await runAnalysis(api, boundary, { ...good, ...patch }, 'error');
    assert.ok(!JSON.stringify(failure).includes(fakeSecret));
  }
  await runAnalysis(api, boundary, { ...good, baseRevision: boundary.revision - 1 }, 409);
  assert.equal(fakeCalls.length, beforeDenials, 'Invalid inputs must be refused before sending anything');
  assert.deepEqual(await runs(boundary.id), []);

  for (const invalid of ['index', 'overlap', 'unsupported', 'quote', 'conflict', 'truncated']) {
    responseMode = invalid;
    const failed = await runAnalysis(api, boundary, good);
    assert.equal(failed.status, 'failed', invalid + ' must fail');
    assert.equal(failed.output, undefined, invalid + ' must not expose a draft');
  }
  assert.equal(fakeCalls.length, beforeDenials + 6);
  console.log('W03-03 valid topic UI and six malformed or truncated response cases passed');

  responseMode = 'v2';
  gate = new Promise(resolve => { releaseGate = resolve; });
  const beforeEdit = boundary;
  const concurrent = runAnalysis(api, beforeEdit, good);
  const expectedConcurrent = fakeCalls.length + 1;
  await poll(() => Promise.resolve(fakeCalls.length), count => count === expectedConcurrent);
  const running = (await runs(boundary.id)).find(run => run.status === 'running');
  assert.ok(running);
  try {
    await runAnalysis(api, beforeEdit, good, 409);
    boundary = await update(api, beforeEdit, { nextStep: '运行中保存的新安排', analysis: { confirmedConclusions: '运行中人工更新的结论。' } });
  } finally {
    releaseGate();
  }
  const finished = await concurrent;
  assert.equal(finished.id, running.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.input.confirmedConclusions, confirmed);
  assert.deepEqual(await read(boundary.id), boundary, 'Finishing the run must preserve new item edits');
  assert.equal(fakeCalls.length, expectedConcurrent);

  gate = new Promise(resolve => { releaseGate = resolve; });
  const expectedInterrupt = fakeCalls.length + 1;
  const lost = runAnalysis(api, boundary, good).catch(error => error);
  await poll(() => Promise.resolve(fakeCalls.length), count => count === expectedInterrupt);
  const interrupted = (await runs(boundary.id)).find(run => run.status === 'running');
  assert.ok(interrupted);
  const chromeVersion = browser.version();
  await browser.close();
  browser = undefined;
  await ui.close();
  ui = undefined;
  await api.close();
  api = undefined;
  releaseGate();
  await lost;
  api = await startApi(dataRoot);
  assert.equal((await runs(boundary.id)).find(run => run.id === interrupted.id).status, 'interrupted');
  assert.equal(fakeCalls.length, expectedInterrupt, 'Restart and history read must not send');
  assert.deepEqual(await request(api, '/api/wiki'), wikiBefore);
  assert.deepEqual(await request(api, '/api/raw-processing'), rawStateBefore);
  assert.deepEqual(await Promise.all(evidenceFiles.map(file => readFile(file))), originalFiles);
  assert.deepEqual(await read(id), item);
  await api.close();
  api = undefined;

  const archive = path.join(runRoot, 'backup.json');
  const restored = path.join(runRoot, 'restored');
  await exportWorkspace(dataRoot, archive);
  await restoreWorkspace(archive, restored);
  api = await startApi(restored);
  assert.deepEqual(await read(id), item);
  assert.deepEqual(await runs(id), mainRuns);
  assert.deepEqual(await read(legacyId), customer);
  assert.deepEqual(await request(api, oldImageUrl), png);
  console.log('W03-04 actual Chrome old customer and same-ID due navigation plus mixed v1/v2 backup/restore passed');

  // Remove or restrict the ancestor only in the restored copy. The v2 stage being carried
  // uses another Raw directly, so checking only its direct sources would miss this gate.
  const restoredRaws = new RawStore(restored);
  await restoredRaws.delete(first.id);
  item = await update(api, item, { rawIds: [...item.rawIds, later.id] });
  const inherit = { outputVersion: 2, rawIds: [later.id], stageHistoryIndex: finalIndex };
  await runAnalysis(api, item, inherit, 'error');
  await registerRestricted(restoredRaws, first.id);
  await runAnalysis(api, item, inherit, 'error');
  assert.deepEqual(await runs(id), mainRuns, 'Old drafts remain readable after ancestor gate refusal');
  assert.equal(fakeCalls.length, expectedInterrupt, 'Neither missing nor restricted inherited sources may send');
  assert.deepEqual(fakeErrors, []);
  console.log('W03-02 real HTTP preflight, inherited source gate, concurrent edit and interruption passed');
  await writeFile(path.join(runRoot, 'result.json'), JSON.stringify({
    checks: ['W03-01', 'W03-02', 'W03-03', 'W03-04'], fakeCalls: fakeCalls.length, ports, chrome: chromeVersion, pageErrors,
    outputFailures: ['index', 'overlap', 'unsupported', 'quote', 'conflict', 'truncated'],
  }, null, 2));
} finally {
  releaseGate();
  await browser?.close();
  await ui?.close();
  await api?.close();
  fake.closeAllConnections();
  await new Promise(resolve => fake.close(resolve));
}
