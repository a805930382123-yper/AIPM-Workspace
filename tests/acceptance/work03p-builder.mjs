import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { build, preview } from 'vite';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';
import { RawStore } from '../../services/raw/store.ts';

const cache = path.resolve('node_modules/.cache/work03p-builder');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'check-'));
const data = path.join(root, 'data');
const evidence = path.resolve(process.env.WORK03_BUILDER_EVIDENCE ?? path.join(root, 'evidence'));
const envDir = path.join(root, 'env');
const config = path.join(root, 'test.env');
await Promise.all([mkdir(evidence, { recursive: true }), mkdir(envDir)]);
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const addresses = [];
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function poll(fn, message) {
  for (let index = 0; index < 100; index++) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return assert.fail(message);
}
async function startApi(dataDir) {
  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise(resolve => portProbe.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true, stdio: 'inherit', env: {
    ...cleanEnv, FMCG_DATA_DIR: dataDir, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config,
  } });
  const exit = once(child, 'exit');
  const stop = async () => { if (child.exitCode === null && !child.killed) child.kill(); await exit; };
  addresses.push(stop);
  const base = `http://127.0.0.1:${port}`;
  await poll(() => fetch(`${base}/api/health`).then(result => result.ok, () => false), '隔离 API 未就绪');
  return {
    base, stop, request: async (route, method = 'GET', body, expected = 200) => {
      const multipart = body instanceof FormData;
      const response = await fetch(`${base}${route}`, { method, body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined || multipart ? undefined : { 'Content-Type': 'application/json' } });
      const text = await response.text();
      assert.equal(response.status, expected, `${method} ${route}: ${text}`);
      return JSON.parse(text);
    },
  };
}

const calls = [];
const secret = 'work03-local-fake-token-only';
let mode = 'success';
let releaseFake;
const fake = createServer(async (req, res) => {
  assert.equal(req.url, '/v1/chat/completions');
  let body = '';
  for await (const part of req) body += part;
  const request = JSON.parse(body);
  const input = JSON.parse(request.messages.find(message => message.role === 'user').content);
  const prompt = request.messages.find(message => message.role === 'system').content;
  const schema = prompt.includes('roundSummary') ? 'work_product_analysis_v2' : 'work_product_analysis';
  calls.push({ input, schema, prompt });
  if (schema === 'work_product_analysis_v2') {
    assert.match(prompt, /不能因至少一个支持观察推断主题下所有案例均有证据/u);
    assert.match(prompt, /conclusion 与 openQuestions 逐项点明/u);
    assert.match(prompt, /保留关键不确定性、反例限制及与已确认结论的冲突/u);
  }
  const selectedMode = mode;
  if (selectedMode === 'hold') await new Promise(resolve => { releaseFake = resolve; });
  const { rawId, body: source } = input.sources[0];
  const [support, exception = support] = source.split('\n');
  const output = {
    observations: [{ rawId, quote: support, observation: '样本明确提出渠道拆分需求。' }],
    suggestions: [schema === 'work_product_analysis' ? '旧轮输出专用标记' : '补齐分渠道的覆盖范围。'],
    openQuestions: ['不同地区是否采用相同口径？'],
  };
  if (schema === 'work_product_analysis_v2') {
    output.observations.push({ rawId, quote: exception, observation: '另一个样本没有渠道拆分需求。' });
    output.roundSummary = '新增渠道拆分需求；样本中也存在只看汇总的情况。';
    output.themes = [{
      title: '渠道拆分的需求边界',
      conclusion: { kind: 'evidence_supported', text: '部分样本明确需要按渠道拆分。' },
      evidence: [0], counterEvidence: [1], openQuestions: ['哪些渠道应单列？' + '长'.repeat(130), '重复待核问题'], nextSteps: ['对齐渠道分类。'],
      confirmedConflict: input.confirmedConclusions ? {
        confirmedQuote: input.confirmedConclusions, observationIndexes: [0], suggestedRevision: '将范围改为部分样本需要渠道拆分。' + '修'.repeat(170),
      } : null,
    }, {
      title: '不同地区的口径',
      conclusion: { kind: 'hypothesis', text: '地区可能采用不同渠道分类。' },
      evidence: [], counterEvidence: [], openQuestions: ['各地区渠道分类是否一致？'], nextSteps: [], confirmedConflict: null,
    }, {
      title: '可用数据范围', conclusion: null,
      evidence: [], counterEvidence: [], openQuestions: ['是否有新增历史数据？'], nextSteps: [], confirmedConflict: null,
    }];
    if (selectedMode === 'cross-index') output.themes[0].counterEvidence = [0];
    if (selectedMode === 'duplicate-index') output.themes[0].evidence = [0, 0];
    if (selectedMode === 'bad-index') output.themes[0].evidence = [2];
    if (selectedMode === 'missing-support') output.themes[0].evidence = [];
    if (selectedMode === 'missing-question') output.themes[1].openQuestions = [];
    if (selectedMode === 'bad-conflict') output.themes[0].confirmedConflict.confirmedQuote = '不属于已确认结论的文本';
    if (selectedMode === 'bad-conflict-index') output.themes[0].confirmedConflict.observationIndexes = [2];
    if (selectedMode === 'bad-quote') output.observations[0].quote = '没有出现在 Raw 中的引文';
    if (selectedMode === 'blank-summary') output.roundSummary = '  ';
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{
    finish_reason: selectedMode === 'truncated' ? 'length' : 'stop', message: { content: JSON.stringify(output) },
  }] }));
});
const fakePort = await listen(fake);
await writeFile(config, `FMCG_LLM_BASE_URL=http://127.0.0.1:${fakePort}/v1\nFMCG_LLM_MODEL=work03-fake\nFMCG_LLM_API_KEY=${secret}\n`);

let browser;
let ui;
try {
  const raws = new RawStore(data);
  await raws.initialize();
  const newRaw = (title, body) => raws.create({ title, body, sourceType: 'note', sourceName: 'WORK03 合成样本', tags: [] });
  const first = await newRaw('合成 · 初始提问', '这是旧轮唯一使用的原文。');
  const second = await newRaw('合成 · 本轮补充', '希望查看渠道拆分结果。\n只需要汇总，不用渠道拆分。');
  const third = await newRaw('合成 · 其他材料', '这是不能混进第二轮的其他原文。');
  const origin = { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: 'a'.repeat(64),
    registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' };
  const restricted = (await raws.createMeetingRegistration({ id: randomUUID(), title: '仅本机会议', body: '不得发送。', sourceName: 'WORK03 合成样本',
    tags: [], importedAt: new Date().toISOString(), origin })).record;
  const itemsRoute = '/api/work-items';
  const now = new Date();
  const legacy = { id: randomUUID(), title: '合成 · 旧客户问题', feedback: '旧客户反馈仍可读。', revision: 1, status: 'in_progress',
    createdAt: now.toISOString(), updatedAt: now.toISOString(), rawIds: [], screenshots: [],
    history: [{ kind: 'reproduction', body: '原来的复现步骤。', at: now.toISOString() }] };
  const legacyRoute = `${itemsRoute}/${legacy.id}`;
  const legacyFile = path.join(data, 'work-items', `${legacy.id}.json`);
  await mkdir(path.dirname(legacyFile), { recursive: true });
  await writeFile(legacyFile, JSON.stringify(legacy));
  let api = await startApi(data);
  assert.equal((await api.request(legacyRoute)).kind, 'customer_issue');
  assert.equal(await readFile(legacyFile, 'utf8'), JSON.stringify(legacy));

  const title = '合成 · 产品能力缺口续轮';
  const goal = '分析样本中反映的渠道需求。';
  const confirmedConclusions = '样本只需要汇总。';
  const openQuestions = '仍需补充其他地区。';
  const dataScope = '仅统计明确表达的样本需求。';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const { id } = await api.request(itemsRoute, 'POST', { kind: 'product_analysis', title, goal }, 201);
  const itemRoute = `${itemsRoute}/${id}`;
  const runRoute = `${itemRoute}/analysis-runs`;
  const saved = () => api.request(itemRoute);
  const patch = async value => api.request(itemRoute, 'PUT', { baseRevision: (await saved()).revision, ...value });
  const post = async (value, status = 201) => api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, ...value }, status);
  const runs = async () => (await api.request(runRoute)).items;
  await patch({ rawIds: [first.id, third.id, restricted.id], analysis: { dataScope, confirmedConclusions, openQuestions },
    status: 'waiting', nextStep: '等待补充渠道样本。', followUpOn: today });
  const legacyRun = await post({ rawIds: [first.id] });
  assert.equal(legacyRun.outputVersion, undefined);
  assert.equal(legacyRun.sourceRawIds, undefined);
  assert.deepEqual(Object.keys(legacyRun.output).sort(), ['observations', 'openQuestions', 'suggestions']);
  assert.equal(calls[0].schema, 'work_product_analysis');
  assert.deepEqual(calls[0].input, legacyRun.input);
  const rawBefore = await api.request('/api/raw');
  const wikiBefore = await api.request('/api/wiki');
  const processingBefore = await api.request('/api/raw-processing');

  const vite = { envDir, build: { outDir: path.join(root, 'dist') }, server: { proxy: { '/api': api.base } } };
  await build(vite);
  const portProbe = createServer();
  const uiPort = await listen(portProbe);
  await new Promise(resolve => portProbe.close(resolve));
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: uiPort, strictPort: true } });
  const playwright = createRequire(import.meta.url)(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await playwright.chromium.launch({ executablePath: path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    args: ['--no-proxy-server'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(12_000);
  const btn = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const txt = (name, scope = page) => scope.getByText(name, { exact: typeof name === 'string' });
  const field = (name, scope = page) => scope.getByLabel(name, { exact: true });
  const section = name => page.getByRole('region', { name, exact: true });
  const nav = name => btn(name, page.getByRole('navigation', { name: '主导航' })).click();
  const analysis = section('AI 分析');
  const stage = section('阶段成果');
  const current = section('当前情况');
  const materials = section('资料与成果');
  const sendPreview = section('发送预览');
  const stagePicker = field('承接阶段成果（选填）', analysis);
  const questionField = field('本轮问题（选填）', analysis);
  const editor = field('阶段成果正文', stage);
  const saveStage = () => btn('保存阶段成果', stage).click();
  const selectRaw = raw => field(raw.title, analysis).check();
  const previewSend = () => btn('预览发送内容', analysis).click();
  const launch = () => btn('发起分析', sendPreview).click();
  const capture = name => page.screenshot({ path: path.join(evidence, `${name}.png`) });

  await page.goto(`http://127.0.0.1:${uiPort}`, { waitUntil: 'domcontentloaded' });
  const dueItem = section('到期跟进').getByRole('article', { name: title });
  await btn('查看事项', dueItem).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await btn(/第 1 轮/u, analysis).click();
  await analysis.getByRole('blockquote').filter({ hasText: first.body }).waitFor();
  await btn('查看本轮原文', analysis).click();
  assert.equal(await analysis.locator('details[open] details[open]').count(), 1);
  const manualBody = '人工成果：先核对数据覆盖范围。';
  await editor.fill(manualBody);
  await saveStage();
  await txt(manualBody, stage).waitFor();
  await btn('带入阶段成果', analysis).click();
  assert.match(await editor.inputValue(), /旧轮输出专用标记/u);
  const savedBody = 'AI 草稿后人工修订：优先核对渠道需求的差异。';
  await editor.fill(savedBody);
  await saveStage();
  await txt(savedBody, stage).waitFor();
  const stageItem = await saved();
  assert.equal(stageItem.history[1].analysisRunId, legacyRun.id);
  assert.equal(await stagePicker.inputValue(), '');
  assert.match(await stagePicker.locator('option[value="0"]').innerText(), /人工填写/u);
  assert.match(await stagePicker.locator('option[value="1"]').innerText(), /带入 AI 草稿后保存/u);
  await field('选择已有 Raw', materials).selectOption(second.id);
  await btn('添加关联', materials).click();
  await txt('已关联 Raw。', materials).waitFor();
  await field('分析目标', current).fill('这段目标尚未保存，不应发送。');
  await editor.fill('这段阶段成果未保存，不应发送。');
  await stagePicker.selectOption('1');
  await txt(/查看所选成果/u, analysis).click();
  await txt(savedBody, analysis).waitFor();
  await btn('查看该轮分析', analysis).click();
  assert.equal(await btn(/第 1 轮/u, analysis).getAttribute('aria-expanded'), 'true');
  const roundQuestion = '本轮是否出现了渠道拆分的需求？';
  await questionField.fill(`  ${roundQuestion}  `);
  await selectRaw(second);
  await previewSend();
  await txt(goal, sendPreview).waitFor();
  await txt(roundQuestion, sendPreview).waitFor();
  await txt(/带入 AI 草稿后保存/u, sendPreview).click();
  await txt(savedBody, sendPreview).waitFor();
  await txt(`${second.title} · 全部原文`, sendPreview).click();
  await txt(second.body, sendPreview).waitFor();
  assert.doesNotMatch(await sendPreview.innerText(), /未保存，不应发送|旧轮唯一使用|不能混进|人工成果：/u);
  assert.equal(calls.length, 1);
  await capture('send-preview-desktop');

  // External edit invalidates the exact preview; refresh must preserve local edits and request reselection.
  await patch({ nextStep: '另一窗口已更新下一步。' });
  await launch();
  await txt('已读取最新版本。请重新选择本轮资料和阶段成果。', analysis).waitFor();
  assert.equal(calls.length, 1);
  assert.equal(await stagePicker.inputValue(), '');
  assert.equal(await field(second.title, analysis).isChecked(), false);
  assert.equal(await questionField.inputValue(), `  ${roundQuestion}  `);
  assert.equal(await field('分析目标', current).inputValue(), '这段目标尚未保存，不应发送。');
  assert.equal(await editor.inputValue(), '这段阶段成果未保存，不应发送。');

  await page.setViewportSize({ width: 390, height: 844 });
  await stagePicker.selectOption('1');
  await selectRaw(second);
  await previewSend();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await capture('send-preview-mobile');
  const beforeV2 = await saved();
  await launch();
  await txt('新增渠道拆分需求；样本中也存在只看汇总的情况。', analysis).waitFor();
  assert.equal(await txt('已读取最新版本。请重新选择本轮资料和阶段成果。', analysis).count(), 0);
  const v2 = (await runs()).find(run => run.outputVersion === 2);
  assert.equal(calls[1].schema, 'work_product_analysis_v2');
  assert.deepEqual(calls[1].input, { goal, dataScope, confirmedConclusions, openQuestions, roundQuestion,
    sources: [{ rawId: second.id, title: second.title, body: second.body }], stageContext: { body: savedBody, source: 'ai_assisted' } });
  assert.deepEqual(v2.sourceRawIds, [second.id, first.id]);
  assert.deepEqual(v2.input.stageContext, { historyIndex: 1, at: stageItem.history[1].at, body: savedBody, source: 'ai_assisted', analysisRunId: legacyRun.id });
  assert.deepEqual(await saved(), beforeV2);
  const theme = section('渠道拆分的需求边界');
  await txt(/建议修订：将范围改为部分样本需要渠道拆分。/u, theme).waitFor();
  await txt('AI 标注：有支持材料（待核对）', theme).waitFor();
  await txt('支持材料不代表同主题每个案例均已证实；证据不足的判断仍待核实。', theme).waitFor();
  await txt('各地区渠道分类是否一致？', section('不同地区的口径')).waitFor();
  await txt('是否有新增历史数据？', section('可用数据范围')).waitFor();
  await page.getByRole('link', { name: '观察 2', exact: true }).click();
  const counter = analysis.locator(`#observation-${v2.id}-1`);
  await txt('只需要汇总，不用渠道拆分。', counter).waitFor();
  await btn('查看本轮原文', counter).click();
  await txt(second.body, analysis.locator(`#work-source-${v2.id}-${second.id}`)).waitFor();
  await theme.scrollIntoViewIfNeeded();
  await capture('themes-mobile');

  await page.setViewportSize({ width: 1440, height: 960 });
  await theme.scrollIntoViewIfNeeded();
  await capture('themes-desktop');
  assert.equal(await btn('带入阶段成果', analysis).isDisabled(), true);
  await editor.fill('');
  await btn('带入阶段成果', analysis).click();
  const draft = await editor.inputValue();
  assert.ok(draft.length <= 1200);
  assert.match(draft, /AI 草稿，待确认/u);
  assert.match(draft, /新增渠道拆分需求/u);
  assert.match(draft, /长{110,}…/u);
  assert.match(draft, /其余 3 条待核问题见原分析/u);
  assert.match(draft, /存在 1 处冲突/u);
  assert.match(draft, /修{100,}…/u);
  assert.match(draft, /完整证据、反例与其他建议见原分析/u);
  assert.doesNotMatch(draft, /只需要汇总，不用渠道拆分|观察 1|有证据支持/u);
  const editedBody = `${draft}\n\n人工补充：先确认采样规则。`;
  await editor.fill(editedBody);
  await saveStage();
  await txt('阶段成果已保存。', stage).waitFor();
  const afterStage = await saved();
  assert.deepEqual(afterStage.analysis, beforeV2.analysis);
  assert.deepEqual(afterStage.history.slice(0, -1), beforeV2.history);
  assert.equal(afterStage.history.at(-1).analysisRunId, v2.id);
  assert.equal(afterStage.history.at(-1).body, editedBody);
  assert.deepEqual(await api.request('/api/raw'), rawBefore);
  assert.deepEqual(await api.request('/api/wiki'), wikiBefore);
  assert.deepEqual(await api.request('/api/raw-processing'), processingBefore);
  await nav('工作事项');
  await btn(/合成 · 旧客户问题/u).click();
  await txt('原来的复现步骤。', section('处理记录')).waitFor();

  // Malformed HTTP input and inherited source changes must not reach the model.
  await patch({ status: 'closed', closureReason: '关闭并保留记录供边界检查。' });
  const nonStageIndex = (await saved()).history.length - 1;
  await patch({ reopen: true });
  const requestV2 = { outputVersion: 2, rawIds: [third.id] };
  for (const bad of [
    { stageHistoryIndex: -1 }, { stageHistoryIndex: 1.5 }, { stageHistoryIndex: 99 }, { stageHistoryIndex: nonStageIndex },
    { stageContext: { body: '客户端伪造', source: 'manual' } }, { runId: legacyRun.id }, { analysisRunId: legacyRun.id },
    { roundQuestion: 'x'.repeat(2001) }, { roundQuestion: 1 }, { outputVersion: 3 },
  ]) await post({ ...requestV2, ...bad }, 400);
  await post({ rawIds: [third.id], stageHistoryIndex: 0 }, 400);
  assert.equal((await post({ ...requestV2, baseRevision: 1, stageHistoryIndex: 0 }, 409)).error.code, 'REVISION_CONFLICT');
  assert.equal((await post({ ...requestV2, rawIds: [restricted.id] }, 403)).error.code, 'MEETING_SOURCE_RESTRICTED');
  assert.equal((await post({ ...requestV2, roundQuestion: secret }, 502)).error.code, 'LLM_OUTPUT_CONTAINS_SECRET');
  const withSecret = await patch({ history: { kind: 'stage_result', body: `测试密钥 ${secret}` } });
  await post({ ...requestV2, stageHistoryIndex: withSecret.history.length - 1 }, 502);
  const itemFile = path.join(data, 'work-items', `${id}.json`);
  const originalItem = await readFile(itemFile, 'utf8');
  for (const body of ['   ', 'x'.repeat(20_001)]) {
    const invalidItem = JSON.parse(originalItem);
    invalidItem.history[0].body = body;
    await writeFile(itemFile, JSON.stringify(invalidItem));
    await post({ ...requestV2, stageHistoryIndex: 0 }, 400);
  }
  await writeFile(itemFile, originalItem);

  const rawFile = path.join(data, 'knowledge', 'raw', 'notes', `${first.id}.md`);
  const originalRaw = await readFile(rawFile, 'utf8');
  await raws.delete(first.id);
  assert.match((await post({ ...requestV2, stageHistoryIndex: 2 }, 409)).error.message, /重新选择阶段成果/u);
  await writeFile(rawFile, originalRaw.replace('\n---\n', `\n${yaml.dump({ origin }).trimEnd()}\n---\n`));
  assert.equal((await post({ ...requestV2, stageHistoryIndex: 2 }, 403)).error.code, 'MEETING_SOURCE_RESTRICTED');
  await writeFile(rawFile, originalRaw);
  assert.equal(calls.length, 2);

  const carried = await post({ ...requestV2, stageHistoryIndex: 2, roundQuestion: '  ' });
  assert.deepEqual(carried.sourceRawIds, [third.id, second.id, first.id]);
  assert.equal(carried.input.roundQuestion, undefined);
  assert.deepEqual(calls.at(-1).input.stageContext, { body: editedBody, source: 'ai_assisted' });
  assert.deepEqual(calls.at(-1).input.sources.map(source => source.rawId), [third.id]);
  const manual = await post({ ...requestV2, stageHistoryIndex: 0 });
  assert.deepEqual(calls.at(-1).input.stageContext, { body: manualBody, source: 'manual' });
  assert.deepEqual(manual.sourceRawIds, [third.id]);

  const invalidModes = ['cross-index', 'duplicate-index', 'bad-index', 'missing-support', 'missing-question', 'bad-conflict',
    'bad-conflict-index', 'bad-quote', 'blank-summary', 'truncated'];
  for (mode of invalidModes) {
    const failure = await post(requestV2);
    assert.equal(failure.status, 'failed', mode);
    assert.equal(failure.error.code, mode === 'truncated' ? 'LLM_OUTPUT_TRUNCATED' : 'WORK_ANALYSIS_OUTPUT_INVALID', mode);
    assert.equal(failure.output, undefined, mode);
  }
  mode = 'hold';
  const inProgress = post({ ...requestV2, roundQuestion: '运行中保留已保存快照。' });
  await poll(() => releaseFake, '模型假服务未收到调用');
  const running = (await runs()).find(run => run.status === 'running');
  await post(requestV2, 409);
  const changed = await patch({ analysis: { dataScope: '分析运行期间另存的口径。' } });
  releaseFake();
  const finished = await inProgress;
  assert.equal(finished.id, running.id);
  assert.equal(finished.input.dataScope, dataScope);
  assert.deepEqual(await saved(), changed);
  releaseFake = undefined;
  const interrupted = post(requestV2).then(() => assert.fail('停服请求不应完成'), () => undefined);
  await poll(() => releaseFake, '模型假服务未收到中断场景调用');
  const interruptedId = (await runs()).find(run => run.status === 'running').id;
  await api.stop();
  releaseFake();
  await interrupted;
  const beforeRestoreCount = calls.length;
  const archive = path.join(root, 'work03-backup.json');
  const restored = path.join(root, 'restored');
  await exportWorkspace(data, archive);
  await restoreWorkspace(archive, restored);
  api = await startApi(restored);
  assert.deepEqual(await saved(), changed);
  assert.deepEqual((await api.request(legacyRoute)).history, legacy.history);
  const restoredRuns = await runs();
  assert.equal(restoredRuns.find(run => run.id === interruptedId).status, 'interrupted');
  assert.deepEqual(restoredRuns.find(run => run.id === legacyRun.id), legacyRun);
  assert.deepEqual(restoredRuns.find(run => run.id === v2.id), v2);
  assert.deepEqual(restoredRuns.find(run => run.id === carried.id), carried);
  assert.equal(calls.length, beforeRestoreCount);
  assert.deepEqual(pageErrors, []);
  await writeFile(path.join(evidence, 'builder-checks.json'), JSON.stringify({ fakeCalls: calls.length, realCalls: 0, pageErrors,
    chrome: browser.version(), viewports: [1440, 390], invalidModes, interruptedId, baseRevision: v2.baseRevision,
    verified: ['W03-01 预览及发送范围', 'W03-02 发送门禁、来源继承及重启', 'W03-03 主题、定位与编辑保存', 'W03-04 兼容及备份'] }, null, 2));
  console.log('WORK03 施工自查完成。', evidence);
} finally {
  releaseFake?.();
  await browser?.close();
  if (ui) await new Promise(resolve => ui.httpServer.close(resolve));
  await Promise.all(addresses.map(stop => stop()));
  await new Promise(resolve => fake.close(resolve));
}
