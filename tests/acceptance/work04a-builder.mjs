import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { build, preview } from 'vite';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';
import { RawStore } from '../../services/raw/store.ts';

const cache = path.resolve('node_modules/.cache/work04a-builder');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'check-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'empty-env');
const config = path.join(root, 'test.env');
await mkdir(envDir);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const key = 'work04-builder-synthetic-only';
const sha = data => createHash('sha256').update(data).digest('hex');
const calls = [];
let mode = 'normal';
let release;

async function listen(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function unusedPort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function poll(read) {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  assert.fail('等待隔离验证服务或模型调用超时');
}

const fake = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { model, messages } = JSON.parse(body);
  const payload = JSON.parse(messages.find(message => message.role === 'user').content);
  const selectedMode = mode;
  calls.push({ url: req.url, model, payload });
  if (selectedMode === 'hold') await new Promise(resolve => { release = resolve; });
  if (selectedMode === 'provider-error') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Bearer ${key}` } }));
    return;
  }
  const input = payload.input ?? payload;
  const source = input.sources[0];
  const quote = source.body.split('\n')[0];
  const evidence = [{ rawId: source.rawId, quote }];
  let output;
  if (payload.output) {
    const checks = payload.output.observations.map((_, index) => ({ target: `observations.${index}`, decision: 'supported', reason: '可逐字核对。', evidence }));
    if (payload.output.themes) {
      checks.push({ target: 'roundSummary', decision: 'uncertain', reason: '样本不足以推广。', evidence: [] });
      payload.output.themes.forEach(({ conclusion }, index) => {
        if (conclusion) checks.push({ target: `themes.${index}.conclusion`, decision: 'unsupported', reason: '存在只看汇总的反例。', evidence });
      });
    }
    checks.push({ target: 'scope', decision: 'supported', reason: '限定为本轮样本。', evidence: [] });
    if (selectedMode === 'duplicate') checks[checks.length - 1] = checks[0];
    if (selectedMode === 'missing-evidence') checks[0].evidence = [];
    if (selectedMode === 'invented-evidence') checks[0].evidence = [{ rawId: source.rawId, quote: '不存在的内容' }];
    output = { checks };
  } else {
    output = { observations: [{ rawId: source.rawId, quote, observation: '样本明确提出渠道拆分需求。' }], suggestions: [], openQuestions: ['其他渠道是否也需要？'] };
    if (input.roundQuestion) Object.assign(output, {
      roundSummary: '渠道拆分在部分样本中出现。',
      themes: [{ title: '渠道拆分', conclusion: { kind: 'evidence_supported', text: '样本有渠道拆分需求。' },
        evidence: [0], counterEvidence: [], openQuestions: ['哪些渠道应单列？'], nextSteps: [], confirmedConflict: null }],
    });
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ finish_reason: selectedMode === 'truncated' ? 'length' : 'stop',
    message: { content: selectedMode === 'invalid-json' ? '{' : JSON.stringify(output) } }] }));
});
const fakePort = await listen(fake);
const modelConfig = (model, host = `http://127.0.0.1:${fakePort}/v1`) =>
  writeFile(config, `FMCG_LLM_BASE_URL=${host}\nFMCG_LLM_MODEL=${model}\nFMCG_LLM_API_KEY=${key}\n`);

const stops = [];
async function startApi(dataDir) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true, stdio: 'inherit',
    env: { ...env, FMCG_DATA_DIR: dataDir, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config } });
  const exited = once(child, 'exit');
  const stop = async () => { if (child.exitCode === null && !child.killed) child.kill(); await exited; };
  stops.push(stop);
  const base = `http://127.0.0.1:${port}`;
  await poll(() => fetch(`${base}/api/health`).then(res => res.ok, () => false));
  return { base, stop, request: async (url, method = 'GET', body, expected = 200) => {
    const res = await fetch(`${base}${url}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const text = await res.text();
    assert.equal(res.status, expected, `${method} ${url} ${text.slice(0, 250)}`);
    return JSON.parse(text);
  } };
}

let browser;
let ui;
try {
  await modelConfig('work04-original');
  let api = await startApi(data);
  const raws = new RawStore(data);
  const first = await raws.create({ title: '合成旧轮原文', body: '门店一要求拆分渠道。', sourceType: 'note', sourceName: 'WORK04A', tags: [] });
  const second = await raws.create({ title: '合成本轮原文', body: '门店二要求拆分渠道。\n门店三只看汇总。', sourceType: 'note', sourceName: 'WORK04A', tags: [] });
  const rawFile = raw => path.join(data, 'knowledge', 'raw', 'notes', `${raw.id}.md`);
  const create = (title, goal) => api.request('/api/work-items', 'POST', { kind: 'product_analysis', title, goal }, 201);
  const title = '合成 · 分析依据复核';
  const goal = '按门店样本核对渠道需求';
  const item = await create(title, goal);
  const other = await create('其他事项', goal);
  const itemUrl = `/api/work-items/${item.id}`;
  const runUrl = `${itemUrl}/analysis-runs`;
  const itemDir = path.join(data, 'work-items', 'analysis-runs', item.id);
  const runFile = id => path.join(itemDir, `${id}.json`);
  const reviewFile = (run, reviewId) => path.join(itemDir, 'reviews', run, `${reviewId}.json`);
  const saved = () => api.request(itemUrl);
  const update = async value => api.request(itemUrl, 'PUT', { baseRevision: (await saved()).revision, ...value });
  const start = async input => api.request(runUrl, 'POST', { baseRevision: (await saved()).revision, ...input }, 201);
  const check = (id, body, status) => api.request(`${runUrl}/${id}/basis-review`, 'POST', body, status);
  const runs = async () => (await api.request(runUrl)).items;
  const latest = async id => (await runs()).find(run => run.id === id).basisReview;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await update({ rawIds: [first.id, second.id], analysis: { dataScope: '只计明确提问的样本。' }, status: 'waiting', followUpOn: today });
  const v1 = await start({ rawIds: [first.id] });
  const stageBody = '已保存成果：先核对口径。';
  await update({ history: { kind: 'stage_result', body: stageBody, analysisRunId: v1.id } });
  const v2 = await start({ outputVersion: 2, rawIds: [second.id], roundQuestion: '新增样本的渠道需求是什么？', stageHistoryIndex: 0 });
  const otherRound = await start({ rawIds: [second.id] });
  const originalBytes = await readFile(runFile(v2.id));
  assert.equal(v2.status, 'completed');
  assert.deepEqual(v2.sourceRawIds, [second.id, first.id]);
  const originalRequest = calls[1].payload;
  await update({ analysis: { goal: '此项是后来保存的新目标。' } });
  const before = await saved();
  assert.equal(await latest(v2.id), undefined);

  const requestsBeforeGates = calls.length;
  await check(randomUUID(), {}, 404);
  await api.request(`/api/work-items/${other.id}/analysis-runs/${v2.id}/basis-review`, 'POST', {}, 404);
  await check(v2.id, { output: v1.output }, 400);
  const firstFile = rawFile(first);
  await rename(firstFile, `${firstFile}.held`);
  await check(v2.id, undefined, 409);
  await rename(`${firstFile}.held`, firstFile);
  const firstBytes = await readFile(firstFile, 'utf8');
  const origin = { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: 'a'.repeat(64), registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' };
  await writeFile(firstFile, firstBytes.replace('\n---\n', `\n${yaml.dump({ origin })}---\n`));
  await check(v2.id, undefined, 403);
  await writeFile(firstFile, 'unreadable raw');
  assert.equal((await check(v2.id, undefined, 409)).error.code, 'WORK_BASIS_REVIEW_SOURCE_UNAVAILABLE');
  await writeFile(firstFile, firstBytes);
  const seedRun = async input => {
    const id = randomUUID();
    await writeFile(runFile(id), JSON.stringify({ ...v2, id, ...input }));
    return id;
  };
  await check(await seedRun({ status: 'running', output: undefined, finishedAt: undefined }), {}, 409);
  await check(await seedRun({ input: { ...v2.input, dataScope: '大'.repeat(180_000) } }), {}, 413);
  await writeFile(config, '');
  await check(v2.id, {}, 400);
  await modelConfig('work04-review', 'invalid-base');
  await check(v2.id, {}, 400);
  assert.deepEqual(await saved(), before);
  const malformed = reviewFile(v2.id, randomUUID());
  await mkdir(path.dirname(malformed), { recursive: true });
  await writeFile(malformed, '{broken');
  assert.equal((await latest(v2.id)).status, 'unavailable');
  assert.deepEqual((await runs()).find(run => run.id === v2.id).output, v2.output);
  await check(v2.id, {}, 500);
  await rm(malformed);
  await modelConfig('work04-review');
  const secretRun = await seedRun({ input: { ...v2.input, dataScope: key } });
  await check(secretRun, {}, 502);
  assert.equal(calls.length, requestsBeforeGates);

  const secondFile = rawFile(second);
  const secondBytes = await readFile(secondFile, 'utf8');
  const editedBody = 'Raw 的当前正文。';
  await writeFile(secondFile, secondBytes.replace(second.bodySha256, sha(editedBody)).replace(second.body, editedBody));
  const currentRaw = await readFile(secondFile);
  const vite = { envDir, build: { outDir: path.join(root, 'dist') }, server: { proxy: { '/api': api.base } } };
  await build(vite);
  const uiPort = await unusedPort();
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: uiPort, strictPort: true } });
  const playwright = createRequire(import.meta.url)(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await playwright.chromium.launch({ executablePath: path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    args: ['--no-proxy-server'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' });
  // A parallel home-page change can start news collection. Keep it out of this test.
  await page.route('**/api/news/**', route => route.fulfill({ json: { date: today, aiEnabled: false, edition: null, fallbacks: {} } }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(12_000);
  const btn = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const text = (value, scope = page) => scope.getByText(value, { exact: true });
  const goToRun = async () => {
    await page.goto(`http://127.0.0.1:${uiPort}`);
    await btn('查看事项', page.getByRole('article', { name: title })).click();
    await page.locator(`#work-run-button-${v2.id}`).click();
  };
  const snapshot = page.locator(`#analysis-${v2.id}`);
  await goToRun();
  const stage = page.getByLabel('阶段成果正文', { exact: true });
  const goalField = page.getByRole('region', { name: '当前情况' }).getByLabel('分析目标', { exact: true });
  await stage.fill('这段未保存编辑应保留。');
  await goalField.fill('未保存目标。');
  await btn('检查分析依据', snapshot).click();
  const send = snapshot.getByRole('region', { name: /依据检查发送预览/u });
  await text(goal, send).waitFor();
  await send.getByRole('link', { name: '原分析草稿' }).click();
  await text(v2.output.roundSummary, snapshot).waitFor();
  assert.equal(await page.evaluate(() => location.hash), `#work-original-output-${v2.id}`);
  await text('合成本轮原文 · 原输入全文', send).click();
  await text(second.body.replace('\n', ' '), send).waitFor();
  assert.equal(calls.length, requestsBeforeGates);
  await page.screenshot({ path: path.join(root, 'preview-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await btn('开始检查', send).click();
  await text('模型发现依据问题或仍需核对的判断', snapshot).waitFor();
  for (const label of ['依据不支持', '证据不足', '模型复核', 'AI 标注：有支持材料（待核对）']) await text(label, snapshot).waitFor();
  assert.equal(calls.length, requestsBeforeGates + 1);
  assert.deepEqual(calls.at(-1), { url: '/v1/chat/completions', model: 'work04-review', payload: { input: originalRequest, output: v2.output } });
  assert.deepEqual(await readFile(runFile(v2.id)), originalBytes);
  assert.equal(await readFile(firstFile, 'utf8'), firstBytes);
  assert.deepEqual(await readFile(secondFile), currentRaw);
  assert.deepEqual(await saved(), before);
  assert.equal(await stage.inputValue(), '这段未保存编辑应保留。');
  assert.equal(await goalField.inputValue(), '未保存目标。');
  await page.screenshot({ path: path.join(root, 'result-mobile.png') });
  await stage.fill('');
  await btn('带入阶段成果', snapshot).click();
  assert.match(await stage.inputValue(), /本轮摘要（待确认）/u);
  await btn('保存阶段成果').click();
  await poll(async () => (await saved()).history.length === 2);
  await goToRun();
  await text('模型发现依据问题或仍需核对的判断', snapshot).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(calls.length, requestsBeforeGates + 1);
  console.log('PASS Chrome 1440/390, immutable original, one exact v2 review request and readback');

  mode = 'provider-error';
  const failed = await check(v1.id);
  assert.equal(failed.status, 'failed');
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(key));
  const afterFailure = calls.length;
  assert.deepEqual(await check(v1.id, {}), failed);
  assert.equal(calls.length, afterFailure);
  mode = 'hold';
  const pending = check(v1.id, { retryFromReviewId: failed.reviewId });
  await poll(() => calls.length === afterFailure + 1);
  assert.equal((await latest(v1.id)).status, 'running');
  await check(v1.id, {}, 409);
  release();
  const completed = await pending;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.attempt, 2);
  assert(completed.result.checks.every(check => check.decision === 'supported'));
  assert.notEqual(completed.reviewId, failed.reviewId);
  await check(v1.id, { retryFromReviewId: failed.reviewId }, 409);
  assert.equal(calls.length, afterFailure + 1);

  mode = 'hold';
  const lastBeforeRestart = calls.length;
  const pendingOnStop = check(otherRound.id).catch(() => undefined);
  await poll(() => calls.length === lastBeforeRestart + 1);
  await api.stop();
  await pendingOnStop;
  release();
  api = await startApi(data);
  const interrupted = await latest(otherRound.id);
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(await check(otherRound.id), interrupted);
  assert.equal(calls.length, lastBeforeRestart + 1);
  const archive = path.join(root, 'backup.json');
  const restored = path.join(root, 'restored');
  await exportWorkspace(data, archive);
  await restoreWorkspace(archive, restored);
  for (const id of [failed.reviewId, completed.reviewId]) {
    const file = reviewFile(v1.id, id);
    assert.deepEqual(await readFile(path.join(restored, path.relative(data, file))), await readFile(file));
  }
  await api.stop();
  api = await startApi(restored);
  assert.deepEqual(await latest(v1.id), completed);
  assert.equal((await latest(otherRound.id)).status, 'interrupted');
  const invalidCases = ['duplicate', 'missing-evidence', 'invented-evidence', 'truncated', 'invalid-json'];
  let retry = interrupted.reviewId;
  for (const invalid of invalidCases) {
    mode = invalid;
    const attempt = await check(otherRound.id, { retryFromReviewId: retry });
    assert.equal(attempt.status, 'failed', invalid);
    assert.equal(attempt.result, undefined);
    retry = attempt.reviewId;
  }
  console.log(`PASS real server entry and model switch, gates, retry, concurrent POST, restart, backup and rejected results; ${calls.length} local calls, 0 real; artifacts ${root}`);
} finally {
  release?.();
  await browser?.close();
  if (ui) await new Promise(resolve => ui.httpServer.close(resolve));
  await Promise.all(stops.map(stop => stop()));
  fake.closeAllConnections();
  await new Promise(resolve => fake.close(resolve));
}
