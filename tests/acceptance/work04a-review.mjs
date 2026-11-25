import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { build, preview } from 'vite';
import { RawStore } from '../../services/raw/store.ts';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';

const cache = path.resolve('node_modules/.cache/work04a-review');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'run-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'env');
const config = path.join(root, 'isolated.env');
await mkdir(envDir);
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const checks = [];
const pass = label => { checks.push(label); console.log('PASS', label); };
const sha = value => createHash('sha256').update(value).digest('hex');
const shaFile = async file => sha(await readFile(file));
console.log('WORK04A independent evidence:', root);

const rawStore = new RawStore(data);
const addRaw = (title, body) => rawStore.create({ title, body, sourceType: 'note', sourceName: 'WORK04A 合成独验', tags: [] });
const earlier = await addRaw('首轮旧材料', '首轮材料仅用于追溯。');
const quote = '北区反馈：本次活动复盘漏掉一个返利条目。';
const counter = '南区同口径复盘含该返利条目，未发现同样问题。';
const current = await addRaw('本轮原材料', `${quote}\n${counter}`);
const omitted = await addRaw('未选择资料', '不应发送到复核的其他来源。');
const keyA = 'work04a-isolated-provider-original-key';
const keyB = 'work04a-isolated-provider-current-key';
const calls = [];
const providerFailures = [];
let mode = 'mixed', gate;
const summary = '北区一条反馈与南区对照表现不同；未证明各区均有异常。';
const details = { supported: '本条引文准确支持观察。', unsupported: '此结论比可见地区样本覆盖更广。', uncertain: '旧口径不能证实本轮事件总数。' };
function reviewOutput(input, output, all = false) {
  const source = input.sources[0];
  const firstLine = source.body.split('\n')[0];
  const targets = [...output.observations.map((_, i) => `observations.${i}`), ...(output.roundSummary ? ['roundSummary', ...output.themes.flatMap((theme, i) => theme.conclusion ? [`themes.${i}.conclusion`] : [])] : []), 'scope'];
  return { checks: targets.map(target => {
    const decision = all || target.startsWith('observations.') || target === 'roundSummary' ? 'supported' : target.startsWith('themes.') ? 'unsupported' : 'uncertain';
    return { target, decision, reason: details[decision] + ' ' + target, evidence: [{ rawId: source.rawId, quote: firstLine }] };
  }) };
}
const fake = createServer(async (req, res) => {
  try {
    let data = '';
    for await (const chunk of req) data += chunk;
    const payload = JSON.parse(data);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, `Bearer ${payload.model === 'original-model' ? keyA : keyB}`);
    const input = JSON.parse(payload.messages.find(message => message.role === 'user').content);
    const activeMode = mode;
    calls.push({ model: payload.model, path: req.url, input, system: payload.messages.find(message => message.role === 'system').content, mode: activeMode });
    const hold = gate;
    if (hold) await hold.promise;
    let result;
    if ('output' in input) {
      result = reviewOutput(input.input, input.output, activeMode === 'all');
      if (activeMode === 'omitted') result.checks.pop();
      if (activeMode === 'duplicate') result.checks[1].target = result.checks[0].target;
      if (activeMode === 'out-of-range') result.checks[0].target = 'observations.99';
      if (activeMode === 'empty-reason') result.checks[0].reason = '   ';
      if (activeMode === 'missing-evidence') result.checks[0].evidence = [];
      if (activeMode === 'theme-without-evidence') Object.assign(result.checks.find(check => check.target === 'themes.0.conclusion'), { decision: 'supported', evidence: [] });
      if (activeMode === 'forged-quote') result.checks[0].evidence[0].quote = '从未出现的引文。';
      if (activeMode === 'cross-source') result.checks[0].evidence[0].rawId = earlier.id;
      if (activeMode === 'echo-output') result.checks[0].reason = keyB;
      if (activeMode === 'provider-error') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `合成错误 Bearer ${keyB}` } }));
        return;
      }
    } else {
      const source = input.sources[0];
      result = { observations: source.body.split('\n').map((text, i) => ({ rawId: source.rawId, quote: text, observation: `合成观察 ${i + 1}：${text}` })), suggestions: ['核对样本边界'], openQuestions: ['同口径样本是否足够？'] };
      if (input.roundQuestion) Object.assign(result, { roundSummary: summary, themes: [
        { title: '地区样本', conclusion: { kind: 'evidence_supported', text: '北区样本报告遗漏，南区对照未复现。' }, evidence: [0], counterEvidence: [1], openQuestions: [], nextSteps: [], confirmedConflict: null },
        { title: '来源覆盖', conclusion: null, evidence: [], counterEvidence: [], openQuestions: ['需要更多样本。'], nextSteps: [], confirmedConflict: null },
      ] });
    }
    res.setHeader('content-type', 'application/json');
    const content = activeMode === 'invalid-json' ? '{invalid' : activeMode === 'large-response' ? '大'.repeat(48_000) : JSON.stringify(result);
    res.end(JSON.stringify({ choices: [{ finish_reason: activeMode === 'truncated' ? 'length' : 'stop', message: { content } }] }));
  } catch (error) {
    providerFailures.push(String(error));
    res.statusCode = 500;
    res.end('fixture assertion failure');
  }
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');
const fakeBase = `http://127.0.0.1:${fake.address().port}/v1`;
const setConfig = (model, key) => writeFile(config, `FMCG_LLM_BASE_URL=${fakeBase}\nFMCG_LLM_MODEL=${model}\nFMCG_LLM_API_KEY=${key}\n`);
const reserve = createServer();
reserve.listen(0, '127.0.0.1');
await once(reserve, 'listening');
const apiPort = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${apiPort}`;
let child, childExit, ui, browser;
const logs = [];
const ports = { fake: fake.address().port, api: apiPort };
async function poll(callback, accept) {
  for (let i = 0; i < 140; i++) {
    const value = await callback();
    if (accept(value)) return value;
    await wait(75);
  }
  assert.fail('timed out waiting for verification state');
}
async function startApi(dataRoot = data) {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true, env: withoutInheritedEmbeddings({ ...cleanEnv, FMCG_DATA_DIR: dataRoot, FMCG_PORT: String(apiPort), FMCG_LLM_CONFIG_FILE: config }) });
  childExit = once(child, 'close');
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  await poll(() => fetch(base + '/api/health').then(response => response.ok, () => false), Boolean);
  assert.ok(logs.join('').includes('(data: ' + dataRoot + ')'));
}
async function stopApi() {
  if (!child) return;
  child.kill();
  await childExit;
  child = undefined;
}
async function request(url, method = 'GET', body, status = 200) {
  const response = await fetch(base + url, { method, signal: AbortSignal.timeout(18_000), ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(status === 'error' ? response.status >= 400 : [].concat(status).includes(response.status), `${method} ${url} returned ${response.status}, expected ${status}: ${JSON.stringify(result).slice(0, 700)}`);
  return result;
}
const itemPath = item => `/api/work-items/${item.id}`;
const runPath = item => `${itemPath(item)}/analysis-runs`;
const reviewPath = (item, run) => `${runPath(item)}/${run.id}/basis-review`;
const runsDir = item => path.join(data, 'work-items', 'analysis-runs', item.id);
const reviewDir = (item, run) => path.join(runsDir(item), 'reviews', run.id);
const runFile = (item, run) => path.join(runsDir(item), run.id + '.json');
const rawFile = raw => path.join(data, 'knowledge', 'raw', 'notes', raw.id + '.md');
const list = item => request(runPath(item)).then(response => response.items);
const reviewState = async (item, run) => (await list(item)).find(entry => entry.id === run.id)?.basisReview;
const update = (item, patch) => request(itemPath(item), 'PUT', { baseRevision: item.revision, ...patch });
const runAnalysis = (item, body) => request(runPath(item), 'POST', { baseRevision: item.revision, ...body }, 201);
const post = (item, run, body, status = 200) => request(reviewPath(item, run), 'POST', body, status);
const createItem = title => request('/api/work-items', 'POST', { kind: 'product_analysis', title, goal: '检查各区活动复盘口径。' }, 201);
const holdProvider = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return gate = { release, promise }; };
const dismissHold = () => { const previous = gate; gate = undefined; previous?.release(); };

// Independent scenario assertions run only after the builder has handed off a frozen version.
try {
  await setConfig('original-model', keyA);
  await startApi();
  const title = 'WORK04A 独验活动复盘';
  const stageBody = '承接首轮人工复盘说明：下一步核对不同地区口径。';
  const laterScope = '仅用户后来保存的新口径，不允许外发给原轮复核。';
  let item = await createItem(title);
  item = await update(item, { rawIds: [earlier.id, current.id, omitted.id], analysis: { dataScope: '本轮仅按已收集资料判断。', confirmedConclusions: '人工确认过既有样本来自北区。', openQuestions: '更多地区资料仍缺。' } });
  const oldRun = await runAnalysis(item, { rawIds: [earlier.id] });
  assert.equal(oldRun.status, 'completed');
  item = await update(item, { history: { kind: 'stage_result', body: stageBody, analysisRunId: oldRun.id } });
  const newRun = await runAnalysis(item, { outputVersion: 2, rawIds: [current.id], roundQuestion: '对照地区活动复盘口径。', stageHistoryIndex: item.history.length - 1 });
  assert.equal(newRun.status, 'completed');
  assert.equal(newRun.outputVersion, 2);
  assert.deepEqual(new Set(newRun.sourceRawIds), new Set([earlier.id, current.id]));
  const originalSend = structuredClone(calls[1].input);
  const v1Send = structuredClone(calls[0].input);
  assert.deepEqual(originalSend.stageContext, { body: stageBody, source: 'ai_assisted' });
  const originalFiles = await Promise.all([oldRun, newRun].map(run => shaFile(runFile(item, run))));
  const originalRaw = await Promise.all([earlier, current, omitted].map(raw => readFile(rawFile(raw))));
  const initialWiki = await request('/api/wiki');
  item = await update(item, { nextStep: '用户后来安排的下一步', analysis: { dataScope: laterScope } });
  assert.equal(await reviewState(item, newRun), undefined);
  assert.equal(calls.length, 2);
  await setConfig('current-review-model', keyB);

  const seedRun = async (template = newRun, patch) => {
    const next = { ...structuredClone(template), id: randomUUID(), startedAt: new Date().toISOString() };
    patch?.(next);
    await writeFile(runFile(item, next), JSON.stringify(next));
    return next;
  };

  const unrelated = await createItem('独验跨事项轮次');
  const unfinished = await seedRun(newRun, run => { run.status = 'running'; delete run.output; delete run.finishedAt; });
  const tooLarge = await seedRun(newRun, run => { run.input.goal = '大'.repeat(180_000); });
  const secretRun = await seedRun(newRun, run => { run.input.openQuestions = keyB; });
  const noSendCount = calls.length;
  for (const [targetItem, targetRun, body] of [
    [unrelated, newRun], [item, { id: randomUUID() }], [item, { id: 'not-a-run' }], [item, unfinished], [item, tooLarge], [item, secretRun],
    [item, newRun, { input: { sources: [] } }], [item, newRun, { output: {} }], [item, newRun, { retryFromReviewId: randomUUID() }],
  ]) {
    const denied = await post(targetItem, targetRun, body, 'error');
    assert.ok(!JSON.stringify(denied).includes(keyB));
  }
  for (const raw of [earlier, current]) {
    const gone = rawFile(raw) + '.temporarily-hidden';
    await rename(rawFile(raw), gone);
    try { await post(item, newRun, undefined, 'error'); }
    finally { await rename(gone, rawFile(raw)); }
  }
  const restrict = bytes => bytes.toString('utf8').replace('\n---\n', `\norigin:\n  kind: meeting\n  meeting_id: ${randomUUID()}\n  import_id: ${randomUUID()}\n  original_sha256: ${'f'.repeat(64)}\n  registered_confidentiality: Restricted\n  processing_policy: meeting_local_only\n---\n`);
  for (const [i, raw] of [earlier, current].entries()) {
    await writeFile(rawFile(raw), restrict(originalRaw[i]));
    try { await post(item, newRun, undefined, 403); }
    finally { await writeFile(rawFile(raw), originalRaw[i]); }
  }
  for (const invalid of ['', 'FMCG_LLM_BASE_URL=not-a-url\nFMCG_LLM_MODEL=invalid-test\nFMCG_LLM_API_KEY=synthetic-invalid-key\n']) {
    await writeFile(config, invalid);
    await post(item, newRun, undefined, 'error');
    assert.equal(await reviewState(item, newRun), undefined);
    item = await update(item, { nextStep: '离线配置时仍可保存的人工下一步' });
  }
  assert.equal(calls.length, noSendCount, 'Rejected review requests must not call fake');
  assert.equal(await reviewState(item, newRun), undefined);
  await setConfig('current-review-model', keyB);
  pass('A2/A3: POST input/target/state/provenance/secret/size/configuration gates; denied calls 0 and read/save available');

  const replacement = '当前 Raw 的合成替换文本，不属于历史轮次。';
  const currentRawChanged = originalRaw[1].toString('utf8').replace(sha(current.body), sha(replacement)).replace(current.body, replacement);
  assert.notEqual(currentRawChanged, originalRaw[1].toString('utf8'));
  await writeFile(rawFile(current), currentRawChanged);
  assert.equal((await rawStore.get(current.id)).body, replacement);
  const vite = { envDir, build: { outDir: path.join(root, 'dist') } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': base } } });
  ports.ui = ui.httpServer.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.WORK04A_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.WORK04A_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  // The shared worktree has parallel NEWS01 UI. It is outside this check and must not fetch public sources.
  await page.route('**/api/news/**', route => route.fulfill({ json: { date: '2026-11-07', aiEnabled: false, edition: null, fallbacks: {} } }));
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const openItem = async () => {
    await page.goto('http://127.0.0.1:' + ports.ui, { waitUntil: 'domcontentloaded' });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '工作事项', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(title) }).click();
  };
  const openRun = async run => {
    const toggle = page.locator('button[aria-controls="analysis-' + run.id + '"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    return page.locator('#analysis-' + run.id);
  };
  const atWidths = async (panel, name) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: viewport overflow at ${width}`);
      await panel.screenshot({ path: path.join(root, `${name}-${width}.png`) });
    }
  };
  const waitResponse = (method, pathname) => page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname);
  await openItem();
  const stage = page.getByLabel('阶段成果正文', { exact: true });
  const unsaved = '未保存的阶段成果编辑不能被复核覆盖。';
  await stage.fill(unsaved);
  const unsavedScope = '未保存的事项分析口径不能被复核覆盖。';
  const scope = page.getByLabel('数据范围与口径', { exact: true });
  await scope.fill(unsavedScope);
  let panel = await openRun(newRun);
  await panel.getByRole('button', { name: '检查分析依据', exact: true }).click();
  const confirm = panel.getByRole('button', { name: '开始检查', exact: true });
  await confirm.waitFor();
  const previewPanel = panel.getByRole('region', { name: /依据检查发送预览 · 第 \d+ 轮/ });
  const originalLink = previewPanel.getByRole('link', { name: '原分析草稿', exact: true });
  await originalLink.click();
  assert.equal(new URL(page.url()).hash, await originalLink.getAttribute('href'));
  await panel.getByText(summary, { exact: true }).waitFor();
  await previewPanel.locator('summary').filter({ hasText: '原承接阶段成果' }).click();
  await previewPanel.locator('summary').filter({ hasText: current.title }).click();
  await previewPanel.getByText(quote, { exact: false }).waitFor();
  await previewPanel.getByText(stageBody, { exact: true }).waitFor();
  const previewText = await previewPanel.textContent();
  for (const text of [quote, stageBody, originalSend.dataScope]) assert.ok(previewText.includes(text), 'preview missing ' + text);
  for (const text of [replacement, laterScope, unsaved, unsavedScope, omitted.body]) assert.ok(!previewText.includes(text), 'preview contains unrelated ' + text);
  assert.equal(calls.length, noSendCount);
  await atWidths(previewPanel, 'v2-preview');
  const beforeReview = await request(itemPath(item));
  const reviewResponse = waitResponse('POST', reviewPath(item, newRun));
  await confirm.click();
  const response = await reviewResponse;
  assert.equal(response.status(), 200, await response.text());
  const mixed = await response.json();
  assert.equal(mixed.status, 'completed');
  assert.equal(mixed.provider.model, 'current-review-model');
  assert.equal(calls.length, noSendCount + 1);
  assert.deepEqual(calls.at(-1).input, { input: originalSend, output: newRun.output });
  assert.equal(calls.at(-1).model, 'current-review-model');
  assert.notEqual(calls.at(-1).model, newRun.provider.model);
  assert.deepEqual(mixed.result, reviewOutput(originalSend, newRun.output));
  const opinion = panel.getByRole('region', { name: '模型复核', exact: true });
  for (const reason of Object.values(details)) await opinion.getByText(reason, { exact: false }).first().waitFor();
  assert.equal(await panel.getByText('模型未发现依据问题', { exact: true }).count(), 0);
  await opinion.getByText(quote, { exact: true }).first().waitFor();
  await opinion.getByRole('button', { name: /查看本轮原文/ }).first().click();
  await panel.locator(`#work-source-${newRun.id}-${current.id}`).getByText(current.body, { exact: true }).waitFor();
  await panel.getByText('AI 标注：有支持材料（待核对）', { exact: true }).waitFor();
  await atWidths(panel, 'v2-result');
  assert.equal(await stage.inputValue(), unsaved);
  assert.equal(await scope.inputValue(), unsavedScope);
  assert.deepEqual(await request(itemPath(item)), beforeReview);
  assert.equal(await readFile(rawFile(current), 'utf8'), currentRawChanged);
  assert.deepEqual(await Promise.all([oldRun, newRun].map(run => shaFile(runFile(item, run)))), originalFiles);
  await writeFile(rawFile(current), originalRaw[1]);
  await stage.fill('');
  await panel.getByRole('button', { name: '带入阶段成果', exact: true }).click();
  const carried = await stage.inputValue();
  assert.ok(carried.includes(summary) && carried.length <= 1200 && !carried.includes(quote) && !carried.includes(details.unsupported));
  const edited = `${carried}\n人工独立编辑后的阶段成果。`;
  await stage.fill(edited);
  const savedResponse = waitResponse('PUT', itemPath(item));
  await page.getByRole('button', { name: '保存阶段成果', exact: true }).click();
  item = await (await savedResponse).json();
  assert.equal(item.history.at(-1).body, edited);
  assert.equal(item.history.at(-1).analysisRunId, newRun.id);
  assert.deepEqual(item.analysis, beforeReview.analysis);
  assert.equal((await request(itemPath(item))).history.at(-1).body, edited);
  await openItem();
  panel = await openRun(newRun);
  await panel.getByText(details.unsupported, { exact: false }).first().waitFor();
  assert.equal(calls.length, noSendCount + 1, 'Rereading the review must not call fake');
  pass('A1/A3: real Chrome 1440/390 preview/confirm/snapshot/three decisions/readback/WORK03P manual draft and current-model HTTP');

  mode = 'all';
  const legacy = await post(item, oldRun);
  assert.equal(legacy.status, 'completed');
  assert.deepEqual(legacy.result, reviewOutput(v1Send, oldRun.output, true));
  assert.deepEqual(calls.at(-1).input, { input: v1Send, output: oldRun.output });
  assert.equal(calls.length, noSendCount + 2);
  await openItem();
  const legacyPanel = await openRun(oldRun);
  await legacyPanel.getByText('模型未发现依据问题', { exact: true }).waitFor();
  assert.equal(await legacyPanel.getByRole('button', { name: '检查分析依据', exact: true }).count(), 0);
  assert.deepEqual(await post(item, oldRun), legacy);
  assert.equal(calls.length, noSendCount + 2);
  pass('A1: legacy v1 review plus all-supported label and no resend on repeat');

  const bad = await seedRun();
  mode = 'provider-error';
  let before = calls.length;
  const failed = await post(item, bad);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result, undefined);
  assert.ok(failed.error && !JSON.stringify(failed).includes(keyB));
  assert.equal(calls.length, before + 1);
  assert.deepEqual(await post(item, bad), failed);
  assert.equal(calls.length, before + 1, 'A fast failure cannot start another no-argument call');
  let previous = failed;
  for (const invalid of ['omitted', 'duplicate', 'out-of-range', 'empty-reason', 'missing-evidence', 'theme-without-evidence', 'forged-quote', 'cross-source', 'echo-output', 'invalid-json', 'truncated', 'large-response']) {
    mode = invalid;
    before = calls.length;
    const invalidReview = await post(item, bad, { retryFromReviewId: previous.reviewId });
    assert.equal(invalidReview.status, 'failed', invalid);
    assert.equal(invalidReview.result, undefined, invalid);
    assert.ok(!JSON.stringify(invalidReview).includes(keyB), invalid);
    assert.notEqual(invalidReview.reviewId, previous.reviewId, invalid);
    assert.equal(invalidReview.attempt, previous.attempt + 1, invalid);
    assert.equal(calls.length, before + 1, invalid);
    previous = invalidReview;
  }
  pass('A2: provider error/secret echo, 8 invalid structured results, malformed JSON, truncation, output cap rejected with saved failures');

  mode = 'all';
  before = calls.length;
  holdProvider();
  const pending = post(item, bad, { retryFromReviewId: previous.reviewId });
  pending.catch(() => undefined);
  await poll(() => calls.length, count => count === before + 1);
  const inProgress = await reviewState(item, bad);
  assert.equal(inProgress.status, 'running');
  assert.equal(inProgress.attempt, previous.attempt + 1);
  await post(item, bad, { retryFromReviewId: previous.reviewId }, 409);
  await post(item, bad, undefined, 409);
  assert.equal(calls.length, before + 1);
  dismissHold();
  const afterRetry = await pending;
  assert.equal(afterRetry.status, 'completed');
  assert.equal(afterRetry.reviewId, inProgress.reviewId);
  await post(item, bad, { retryFromReviewId: previous.reviewId }, 409);
  assert.equal(calls.length, before + 1);
  const badReviewFiles = await readdir(reviewDir(item, bad));
  assert.equal(badReviewFiles.length, afterRetry.attempt);
  const firstFailurePath = path.join(reviewDir(item, bad), failed.reviewId + '.json');
  assert.deepEqual(JSON.parse(await readFile(firstFailurePath, 'utf8')), failed);
  const latestPath = path.join(reviewDir(item, bad), afterRetry.reviewId + '.json');
  const latestBytes = await readFile(latestPath);
  await writeFile(latestPath, '{bad review file');
  assert.equal((await reviewState(item, bad)).status, 'unavailable');
  assert.deepEqual((await list(item)).find(run => run.id === bad.id).output, bad.output);
  assert.deepEqual(await reviewState(item, newRun), mixed);
  await post(item, bad, undefined, 'error');
  await post(item, bad, { retryFromReviewId: previous.reviewId }, 'error');
  assert.equal(calls.length, before + 1);
  await writeFile(latestPath, latestBytes);
  assert.deepEqual(await reviewState(item, bad), afterRetry);
  pass('A2: retry/active duplicate/stale ID/corruption; saved draft and other review remain readable');

  const interruptRun = await seedRun();
  before = calls.length;
  holdProvider();
  const lost = post(item, interruptRun).catch(error => error);
  await poll(() => calls.length, count => count === before + 1);
  const wasRunning = await reviewState(item, interruptRun);
  assert.equal(wasRunning.status, 'running');
  await openItem();
  const runningPanel = await openRun(interruptRun);
  await runningPanel.getByText(/正在检查|检查中|复核中/).first().waitFor();
  assert.equal(await runningPanel.getByRole('button', { name: '开始检查', exact: true }).count(), 0);
  assert.equal(calls.length, before + 1, 'Opening a running review in Chrome must not send');
  await stopApi();
  dismissHold();
  assert.ok(await lost instanceof Error);
  await startApi();
  const interrupted = await reviewState(item, interruptRun);
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.reviewId, wasRunning.reviewId);
  assert.equal(calls.length, before + 1, 'Restart must not call fake');
  assert.deepEqual(await post(item, interruptRun), interrupted);
  await openItem();
  const interruptionPanel = await openRun(interruptRun);
  await interruptionPanel.getByRole('button', { name: '重新检查', exact: true }).click();
  assert.equal(calls.length, before + 1, 'Retry preview must not call fake');
  const retryResponse = waitResponse('POST', reviewPath(item, interruptRun));
  await interruptionPanel.getByRole('button', { name: '开始检查', exact: true }).click();
  const retryHttp = await retryResponse;
  assert.deepEqual(retryHttp.request().postDataJSON(), { retryFromReviewId: interrupted.reviewId });
  assert.equal(retryHttp.status(), 200);
  const retried = await retryHttp.json();
  assert.equal(retried.status, 'completed');
  assert.notEqual(retried.reviewId, interrupted.reviewId);
  assert.equal(calls.length, before + 2);
  assert.deepEqual(pageErrors, []);
  console.log('Chrome', browser.version(), 'page errors', pageErrors.length);
  pass('A2: process kill/restart maps running to interrupted without send; explicit Chrome retry sends exactly once');

  assert.deepEqual(await request('/api/wiki'), initialWiki);
  assert.deepEqual(await Promise.all([earlier, current, omitted].map(raw => readFile(rawFile(raw)))), originalRaw);
  assert.deepEqual(await Promise.all([oldRun, newRun].map(run => shaFile(runFile(item, run)))), originalFiles);
  const archive = path.join(root, 'backup.json');
  const restored = path.join(root, 'restored');
  const beforeBackup = calls.length;
  await stopApi();
  await exportWorkspace(data, archive);
  await restoreWorkspace(archive, restored);
  await startApi(restored);
  assert.deepEqual(await request(itemPath(item)), item);
  assert.deepEqual(await reviewState(item, oldRun), legacy);
  assert.deepEqual(await reviewState(item, newRun), mixed);
  assert.deepEqual(await reviewState(item, interruptRun), retried);
  assert.deepEqual(await reviewState(item, bad), afterRetry);
  for (const file of [...badReviewFiles.map(name => path.join(reviewDir(item, bad), name)), ...[oldRun, newRun].map(run => runFile(item, run))]) {
    assert.deepEqual(await readFile(file), await readFile(path.join(restored, path.relative(data, file))));
  }
  assert.equal(calls.length, beforeBackup);
  assert.deepEqual(providerFailures, []);
  assert.ok(!logs.join('').includes(keyB));
  pass('A2: recursive backup/restore preserves earlier failed attempts and old original runs; no send on startup/read');

} finally {
  dismissHold();
  await browser?.close();
  await ui?.close();
  await stopApi();
  fake.closeAllConnections();
  await new Promise(resolve => fake.close(resolve));
  await writeFile(path.join(root, 'api.log'), logs.join(''));
  await writeFile(path.join(root, 'summary.json'), JSON.stringify({ checks, ports, providerFailures, calls, realModelCalls: 0 }, null, 2));
}
