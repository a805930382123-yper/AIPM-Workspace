import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { build, preview } from 'vite';
import { lwFixture } from '../lw01-fixture.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'auto02-independent-browser-'));
const data = path.join(root, 'data');
const envDir = path.join(root, 'env');
await mkdir(envDir);
const config = path.join(envDir, 'fake.env');
await writeFile(config, '');
const f = await lwFixture(data);
const createRaw = (title, body) => f.rawStore.create({ title, body, tags: [], sourceType: 'report', sourceName: 'AUTO02 浏览器独验' });
const raw = await createRaw('零售试点整理 · 2026年10月', '渠道覆盖10家。\n\n回访周期7天。');
const discardedRaw = await createRaw('结束整理的独立合成资料', '渠道覆盖20家。\n\n回访周期14天。');
f.setTopics(['渠道覆盖', '回访周期']);
let releaseModel;
const pause = new Promise(resolve => { releaseModel = resolve; });
let modelCalls = 0;
const fake = createServer(async (req, res) => {
  try {
    let input = '';
    for await (const part of req) input += part;
    const { messages } = JSON.parse(input);
    modelCalls++;
    await pause;
    const reply = await f.provider.complete({ purpose: 'knowledge', system: messages[0].content, user: messages[1].content, timeoutMs: 10000 });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: reply.text }, finish_reason: 'stop' }] }));
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FMCG_|proxy|^NODE_OPTIONS$/i.test(key)));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  windowsHide: true, stdio: 'inherit',
  env: {
    ...childEnv, FMCG_DATA_DIR: data, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: config,
    FMCG_LLM_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`,
    FMCG_LLM_MODEL: 'auto02-fake', FMCG_LLM_API_KEY: 'auto02-isolated-synthetic-key',
  },
});
const stopped = once(child, 'exit');
const request = async (url, body, expected = 200) => {
  const response = await fetch(base + url, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, JSON.stringify(payload));
  return payload;
};
const poll = async (read, done) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await read();
    if (done(result)) return result;
    await wait(100);
  }
  assert.fail('Timed out waiting for isolated product state');
};

let ui, browser;
try {
  await poll(() => request('/api/health').catch(() => null), Boolean);
  const vite = { envDir, build: { outDir: path.join(root, 'dist') } };
  await build(vite);
  ui = await preview({ ...vite, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': base } } });
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.AUTO02_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({
    executablePath: process.env.AUTO02_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-proxy-server'], headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const heading = name => page.getByRole('heading', { name, exact: true });
  const nav = name => button(name, page.getByRole('navigation', { name: '主导航' })).click();
  const status = value => page.getByRole('status').filter({ hasText: value });
  const outcome = title => page.getByRole('article', { name: `成果 ${title}`, exact: true });
  const task = title => page.getByRole('article', { name: title, exact: true });
  const later = page.getByRole('region', { name: '稍后处理', exact: true });
  const snapshot = name => page.screenshot({ path: path.join(root, name + '.png') });
  const fromRaw = async title => {
    await nav('Raw 原始资料');
    await page.locator('.raw-list-item').filter({ hasText: title }).click();
  };
  const begin = async title => {
    await fromRaw(title);
    await page.getByLabel('整理模式', { exact: true }).selectOption('standard');
    const started = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/extract'));
    await button('整理到知识库').click();
    return (await started).json();
  };
  const navigateDraft = async (control, expectedDraftId) => {
    const opened = page.waitForResponse(res => res.request().method() === 'GET' && res.url().endsWith('/api/drafts/' + expectedDraftId));
    await control.click();
    assert.equal((await (await opened).json()).id, expectedDraftId);
    await heading('整理成果').waitFor();
  };
  await page.goto(`http://127.0.0.1:${ui.httpServer.address().port}`, { waitUntil: 'domcontentloaded' });
  const job = await begin(raw.title);
  await nav('首页');
  await task(raw.title).getByText('整理中', { exact: true }).waitFor();
  assert.equal(await task(raw.title).count(), 1);
  await snapshot('01-running-desktop');
  releaseModel();
  const finishedJob = await poll(() => request('/api/extraction-jobs/' + job.jobId), value => value.status !== 'running');
  assert.equal(finishedJob.status, 'completed', JSON.stringify(finishedJob));
  const draftId = finishedJob.draftId;
  const draftUrl = '/api/drafts/' + draftId;
  await button('继续审核', task(raw.title)).waitFor();
  assert.equal(await task(raw.title).count(), 1);
  await navigateDraft(button('继续审核', task(raw.title)), draftId);
  const firstDraft = await request(draftUrl);
  const [firstChange, secondChange] = firstDraft.maintenance.changes;
  const second = outcome(secondChange.candidate.title);
  const editable = second.locator('details[name="raw-outcome-topic"]');
  if (await editable.getAttribute('open') === null) await editable.locator(':scope > summary').click();
  await button('编辑主题成果', second).click();
  assert.equal(await button('稍后处理').isDisabled(), true);
  const editedBody = secondChange.candidate.body + '\n\n浏览器独验保存的说明。';
  await second.getByLabel('成果正文').fill(editedBody);
  await button('保存成果编辑', second).click();
  await status('草稿已保存').waitFor();
  await outcome(firstChange.candidate.title).getByRole('checkbox').check();
  await button(/确认所选成果入库/).click();
  await page.getByRole('region', { name: '已入库成果' }).waitFor();
  const partial = await request(draftUrl);
  const firstOperation = await request('/api/wiki-commits/' + partial.commitOperationId);
  const firstWiki = await f.wiki.get(firstOperation.wikiIds[0]);
  const callsAfterGeneration = modelCalls;
  const recordsBefore = await f.wiki.allRecords();
  const rawStateBefore = await readFile(path.join(data, 'state', 'raw-processing', raw.id + '.json'));

  await page.route('**/api/drafts/*/defer', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '隔离注入：暂缓保存失败' } }),
  }), { times: 1 });
  await button('稍后处理').click();
  await page.getByRole('alert').filter({ hasText: '暂缓保存失败' }).waitFor();
  assert.equal((await request(draftUrl)).deferredAt, undefined);
  await button('稍后处理').click();
  await status('已移到首页').waitFor();
  const persisted = JSON.parse(await readFile(path.join(data, 'drafts', draftId + '.json'), 'utf8'));
  assert(persisted.deferredAt);
  assert.equal(persisted.maintenance.changes[1].candidate.body, editedBody);
  await nav('首页');
  await button('查看暂缓成果', later).waitFor();
  assert.equal(await task(raw.title).count(), 1);
  await heading('工作台').scrollIntoViewIfNeeded();
  await snapshot('02-later-desktop');
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await button('查看暂缓成果', later).waitFor();
  await later.scrollIntoViewIfNeeded();
  await snapshot('03-later-narrow');
  await navigateDraft(button('查看暂缓成果', later), draftId);
  await button('继续处理').waitFor();
  await snapshot('04-draft-narrow');
  assert.equal(await button(/确认所选成果入库/).count(), 0);
  assert.equal((await request(draftUrl)).deferredAt, persisted.deferredAt);
  await fromRaw(raw.title);
  await button('查看暂缓成果').scrollIntoViewIfNeeded();
  await snapshot('05-raw-narrow');
  await navigateDraft(button('查看暂缓成果'), draftId);
  await button('继续处理').click();
  await status('已恢复处理').waitFor();
  assert.equal((await request(draftUrl)).deferredAt, undefined);
  assert.equal(modelCalls, callsAfterGeneration);
  assert.deepEqual(await f.wiki.allRecords(), recordsBefore);
  assert.deepEqual(await readFile(path.join(data, 'state', 'raw-processing', raw.id + '.json')), rawStateBefore);
  await nav('首页');
  await button('继续审核', task(raw.title)).waitFor();
  assert.equal(await later.getByRole('article').count(), 0);
  await navigateDraft(button('继续审核', task(raw.title)), draftId);
  await second.getByRole('checkbox').check();
  await button(/确认所选成果入库/).click();
  await status('已确认入库').waitFor();
  const finalDraft = await request(draftUrl);
  assert.equal(finalDraft.status, 'confirmed');
  assert.equal(finalDraft.maintenance.changes[0].committedOperationId, firstOperation.operationId);
  assert.deepEqual(await f.wiki.get(firstOperation.wikiIds[0]), firstWiki);
  await button('打开正式主题', second).click();
  await page.getByText(/正在读取知识库/).waitFor({ state: 'hidden' });
  await page.getByText('浏览器独验保存的说明。', { exact: true }).scrollIntoViewIfNeeded();
  await snapshot('06-readback-narrow');
  assert.equal(modelCalls, callsAfterGeneration);
  assert.equal((await f.rawStore.get(raw.id)).bodySha256, raw.bodySha256);

  const discardedJob = await request(`/api/raw/${discardedRaw.id}/extract`, { mode: 'standard' }, 202);
  const discardedReady = await poll(() => request('/api/extraction-jobs/' + discardedJob.jobId), value => value.status !== 'running');
  assert.equal(discardedReady.status, 'completed', JSON.stringify(discardedReady));
  const wikiBeforeDiscard = await f.wiki.allRecords();
  await fromRaw(discardedRaw.title);
  await navigateDraft(button('继续审核'), discardedReady.draftId);
  await button('全部不采纳').click();
  await button('确认全部不采纳').click();
  await status('已保留整理历史').waitFor();
  await nav('首页');
  await later.getByText('暂时没有稍后处理的整理成果。').waitFor();
  assert.equal(await task(raw.title).count() + await task(discardedRaw.title).count(), 0);
  assert.deepEqual(await f.wiki.allRecords(), wikiBeforeDiscard);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ ok: true, root, screenshots: 6, rawId: raw.id, draftId, firstOperation: firstOperation.operationId, finalOperation: finalDraft.commitOperationId, modelCalls }));
} finally {
  releaseModel();
  await browser?.close();
  if (ui) await new Promise(resolve => ui.httpServer.close(resolve));
  if (child.exitCode === null) child.kill();
  await stopped;
  await new Promise(resolve => { fake.close(resolve); fake.closeAllConnections(); });
}
