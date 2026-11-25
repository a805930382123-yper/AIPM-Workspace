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
import { build, preview } from 'vite';
import { exportWorkspace, restoreWorkspace } from '../../scripts/backup_workspace.ts';
import { RawStore } from '../../services/raw/store.ts';

const cache = path.resolve('node_modules/.cache/work02-builder');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(path.join(cache, 'check-'));
const data = path.join(root, 'data');
const evidence = path.resolve(process.env.WORK02_BUILDER_EVIDENCE ?? path.join(root, 'evidence'));
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
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { windowsHide: true, stdio: 'inherit', env: withoutInheritedEmbeddings({
    ...cleanEnv, FMCG_DATA_DIR: dataDir, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config,
  }) });
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
let fakeMode = 'success';
let releaseFake;
const fake = createServer(async (req, res) => {
  assert.equal(req.url, '/v1/chat/completions');
  let body = '';
  for await (const part of req) body += part;
  const request = JSON.parse(body);
  const input = JSON.parse(request.messages.find(message => message.role === 'user').content);
  calls.push(input);
  if (fakeMode === 'hold') await new Promise(resolve => { releaseFake = resolve; });
  const source = input.sources[0];
  const output = {
    observations: [{ rawId: source.rawId, quote: fakeMode === 'bad-quote' ? '不存在的逐字依据' : source.body,
      observation: '样本显示用户需要明确的数据范围。' }],
    suggestions: ['先提供数据覆盖范围。'],
    openQuestions: ['需要补充不同地区的提问样本。'],
  };
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
});
const fakePort = await listen(fake);
const configText = `FMCG_LLM_BASE_URL=http://127.0.0.1:${fakePort}/v1\nFMCG_LLM_MODEL=work02-fake\nFMCG_LLM_API_KEY=work02-synthetic-only\n`;
await writeFile(config, configText);

let browser;
let ui;
try {
  const raws = new RawStore(data);
  await raws.initialize();
  const newRaw = (title, body) => raws.create({ title, body, sourceType: 'note', sourceName: 'WORK02 合成样本', tags: [] });
  const first = await newRaw('合成 · 第一批提问', '是否能查看指定地区和日期内的销量？');
  const second = await newRaw('合成 · 补充提问', '只看华南大区，能按渠道拆开吗？');
  const unavailable = await newRaw('合成 · 后来删除', '这份材料随后移除。');
  const restricted = (await raws.createMeetingRegistration({
    id: randomUUID(), title: '合成 · 仅本机会议', body: '这份资料不能发送给模型。', sourceName: 'WORK02 合成样本', tags: [],
    importedAt: new Date().toISOString(), origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(),
      original_sha256: 'a'.repeat(64), registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' },
  })).record;
  const itemsRoute = '/api/work-items';
  const legacy = { id: randomUUID(), title: '合成 · 旧客户问题', feedback: '旧客户反馈仍可读。', revision: 1, status: 'in_progress',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rawIds: [], screenshots: [],
    history: [{ kind: 'reproduction', body: '原来的复现步骤。', at: new Date().toISOString() }] };
  const legacyRoute = `${itemsRoute}/${legacy.id}`;
  const legacyFile = path.join(data, 'work-items', `${legacy.id}.json`);
  await mkdir(path.dirname(legacyFile), { recursive: true });
  await writeFile(legacyFile, JSON.stringify(legacy));
  let api = await startApi(data);
  const oldItem = await api.request(legacyRoute);
  assert.equal(oldItem.kind, 'customer_issue');
  assert.deepEqual(oldItem.history, legacy.history);
  assert.equal(await readFile(legacyFile, 'utf8'), JSON.stringify(legacy));
  const rawBefore = await api.request(`/api/raw/${first.id}`);
  const statesBefore = await api.request('/api/raw-processing');
  const wikiBefore = await api.request('/api/wiki');

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
  const btn = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const text = (value, scope = page) => scope.getByText(value, { exact: true });
  const field = (name, scope = page) => scope.getByLabel(name, { exact: true });
  const section = name => page.getByRole('region', { name, exact: true });
  const nav = name => btn(name, page.getByRole('navigation', { name: '主导航' })).click();
  const capture = name => page.screenshot({ path: path.join(evidence, `${name}.png`) });
  await page.goto(`http://127.0.0.1:${uiPort}`, { waitUntil: 'domcontentloaded' });
  await nav('工作事项');
  await btn('新建产品分析').click();
  const title = '分析智能参谋用户提问中的能力缺口';
  const goal = '识别智能参谋目前无法完整回答的问题。';
  await field('事项标题').fill(title);
  await field('分析目标').fill(goal);
  await btn('创建事项').click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  const { id } = (await api.request(itemsRoute)).items.find(item => item.title === title);
  const itemRoute = `${itemsRoute}/${id}`;
  const runRoute = `${itemRoute}/analysis-runs`;
  const current = section('当前情况');
  const analysis = section('AI 分析');
  const stages = section('阶段成果');
  const materials = section('资料与成果');
  const due = section('到期跟进');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const saved = () => api.request(itemRoute);
  const patch = async value => api.request(itemRoute, 'PUT', { baseRevision: (await saved()).revision, ...value });
  const saveCurrent = async () => {
    await btn('保存当前情况', current).click();
    await text('当前情况已保存。', current).waitFor();
  };
  const link = async raw => {
    await field('选择已有 Raw', materials).selectOption(raw.id);
    await btn('添加关联', materials).click();
    await text('已关联 Raw。', materials).waitFor();
  };
  const run = async rawIds => api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, rawIds }, 201);
  await field('数据范围与口径', current).fill('第一批仅统计样本中明确提出的需求。');
  await field('已确认结论', current).fill('当前只能描述样本范围。');
  await field('未解问题', current).fill('缺少不同地区的数据。');
  await saveCurrent();
  await field('阶段成果正文', stages).fill('人工首轮记录：先梳理提问类型。');
  await btn('保存阶段成果', stages).click();
  await text('阶段成果已保存。', stages).waitFor();
  await link(first);
  await field(first.title, analysis).check();
  await btn('发起分析', analysis).click();
  await text('建议', analysis).waitFor();
  await analysis.getByRole('blockquote').filter({ hasText: first.body }).waitFor();
  await text('待核问题', analysis).waitFor();
  const [firstRun] = (await api.request(runRoute)).items;
  assert.deepEqual(calls[0], firstRun.input);
  assert.deepEqual(firstRun.input.sources, [{ rawId: first.id, title: first.title, body: first.body }]);
  assert.equal((await saved()).history.length, 1);
  assert.equal((await saved()).analysis.confirmedConclusions, '当前只能描述样本范围。');
  await btn('带入阶段成果', analysis).click();
  assert.match(await field('阶段成果正文', stages).inputValue(), /先提供数据覆盖范围/u);
  await field('阶段成果正文', stages).fill('人工修订：优先明确提问涉及的数据覆盖范围。');
  await btn('保存阶段成果', stages).click();
  await text('人工修订：优先明确提问涉及的数据覆盖范围。', stages.getByRole('list')).waitFor();
  assert.equal((await saved()).history[1].analysisRunId, firstRun.id);
  await field('状态', current).selectOption('waiting');
  await field('跟进日期（选填）', current).fill(today);
  await field('下一步（选填）', current).fill('等地区样本后继续分析。');
  await saveCurrent();
  await nav('首页');
  const dueItem = due.getByRole('article', { name: title });
  await dueItem.getByText(/产品分析.*等待补充/u).waitFor();
  await btn('查看事项', dueItem).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await link(second);
  await field('数据范围与口径', current).fill('本轮核对补充的地区与渠道提问。');
  await field('状态', current).selectOption('in_progress');
  await saveCurrent();
  await field(second.title, analysis).check();
  await btn('发起分析', analysis).click();
  await analysis.getByRole('blockquote').filter({ hasText: second.body }).waitFor();
  const completed = (await api.request(runRoute)).items;
  assert.equal(completed.length, 2);
  assert.notEqual(completed[0].id, firstRun.id);
  assert.deepEqual(completed[1], firstRun);
  assert.deepEqual(calls.map(call => call.sources.map(source => source.rawId)), [[first.id], [second.id]]);
  assert.equal((await saved()).analysis.openQuestions, '缺少不同地区的数据。');
  await analysis.scrollIntoViewIfNeeded();
  await capture('product-analysis-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await current.scrollIntoViewIfNeeded();
  await capture('product-analysis-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await nav('工作事项');
  await page.getByRole('button', { name: /合成 · 旧客户问题/u }).click();
  await text('各区独立保存。修改后，请使用该区的保存按钮。').waitFor();
  const history = section('处理记录');
  await field('记录类型', history).selectOption('retest');
  await field('复测结果', history).selectOption('passed');
  await field('记录内容', history).fill('旧事项继续保存复测。');
  await btn('保存处理记录', history).click();
  await text('旧事项继续保存复测。', history.getByRole('list')).waitFor();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkZsAAAAASUVORK5CYII=', 'base64');
  const image = new FormData();
  image.set('baseRevision', String((await api.request(legacyRoute)).revision));
  image.set('file', new Blob([png], { type: 'image/png' }), 'sample.png');
  const customer = await api.request(`${legacyRoute}/screenshots`, 'POST', image, 201);
  assert.equal(customer.history.length, 2);
  assert.deepEqual(await api.request(`/api/raw/${first.id}`), rawBefore);
  assert.deepEqual(await api.request('/api/raw-processing'), statesBefore);
  assert.deepEqual(await api.request('/api/wiki'), wikiBefore);
  assert.deepEqual(pageErrors, []);

  await writeFile(config, '');
  await api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, rawIds: [first.id] }, 400);
  await writeFile(config, configText);
  await api.request(runRoute, 'POST', { baseRevision: 1, rawIds: [first.id] }, 409);
  await api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, rawIds: [unavailable.id] }, 400);
  await patch({ rawIds: [first.id, second.id, unavailable.id, restricted.id] });
  await raws.delete(unavailable.id);
  await api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, rawIds: [unavailable.id] }, 409);
  await api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, rawIds: [restricted.id] }, 403);
  assert.equal(calls.length, 2);
  fakeMode = 'bad-quote';
  const failure = await run([first.id]);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.output, undefined);
  assert.equal(calls.length, 3);
  fakeMode = 'hold';
  const inProgress = run([first.id]);
  await poll(() => releaseFake, '模型假服务未收到调用');
  const running = (await api.request(runRoute)).items[0];
  assert.equal(running.status, 'running');
  await api.request(runRoute, 'POST', { baseRevision: (await saved()).revision, rawIds: [first.id] }, 409);
  const edited = await patch({ nextStep: '分析运行期间保存的下一步。' });
  releaseFake();
  assert.equal((await inProgress).id, running.id);
  assert.deepEqual(await saved(), edited);
  releaseFake = undefined;
  const interrupted = run([first.id]).then(() => assert.fail('停服请求不应成功完成'), () => undefined);
  await poll(() => releaseFake, '模型假服务未收到中断场景调用');
  const interruptedId = (await api.request(runRoute)).items[0].id;
  await api.stop();
  releaseFake();
  await interrupted;
  const archive = path.join(root, 'work02-backup.json');
  const restored = path.join(root, 'restored');
  await exportWorkspace(data, archive);
  await restoreWorkspace(archive, restored);
  api = await startApi(restored);
  assert.deepEqual(await saved(), edited);
  assert.deepEqual(await api.request(legacyRoute), customer);
  const imageResponse = await fetch(`${api.base}${legacyRoute}/screenshots/${customer.screenshots[0].id}`);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  const restoredRuns = (await api.request(runRoute)).items;
  assert.equal(restoredRuns.find(value => value.id === interruptedId).status, 'interrupted');
  assert.deepEqual(restoredRuns.find(value => value.id === firstRun.id), firstRun);
  assert.deepEqual(restoredRuns.find(value => value.id === completed[0].id), completed[0]);
  assert.equal(calls.length, 5);
  await writeFile(path.join(evidence, 'builder-checks.json'), JSON.stringify({ fakeCalls: calls.length, pageErrors,
    chrome: browser.version(), viewports: [1440, 390], verified: ['同事项两轮', '阶段成果', '到期返回', '旧客户记录', '前置拒绝', '失败与中断', '隔离备份恢复'] }, null, 2));
  console.log('WORK02 施工自查完成。', evidence);
} finally {
  releaseFake?.();
  await browser?.close();
  if (ui) await new Promise(resolve => ui.httpServer.close(resolve));
  await Promise.all(addresses.map(stop => stop()));
  await new Promise(resolve => fake.close(resolve));
}
