import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { RawStore } from '../../services/raw/store.ts';
import { wikiReviewDate } from '../../services/wiki/freshness.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { startFakeProvider } from '../support/fake-llm.ts';
import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';

const run = await mkdtemp(path.join(os.tmpdir(), 'aipm-2a3-edge-'));
const root = path.join(run, 'data');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isolated = withoutInheritedEmbeddings(
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(FMCG_LLM_|SEARCH_|WIKI_FRESHNESS_)/i.test(name))),
);
const preload = path.join(run, 'loopback-only.mjs');
const deniedRequests = path.join(run, 'blocked.ndjson');
await writeFile(deniedRequests, '');
await writeFile(preload, `
  import { appendFile } from 'node:fs/promises';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    void appendFile(process.env.AIPM_2A3_DENIED, JSON.stringify({ origin: url.origin }) + '\\n');
    throw new Error('Unexpected outbound request');
  };
`);
const raws = new RawStore(root);
const wiki = new WikiStore(root, raws);
await raws.initialize();
await wiki.initialize();
const automationPath = path.join(root, 'state', 'automation');
await mkdir(automationPath, { recursive: true });
await writeFile(path.join(automationPath, 'schedules.json'), JSON.stringify({ paused: true, schedules: [] }));
const newsPath = path.join(root, 'state', 'news');
await mkdir(newsPath, { recursive: true });
const date = wikiReviewDate();
const now = new Date().toISOString();
const emptyNews = { status: 'empty', attempt: 1, startedAt: now, sources: [], items: [] };
await writeFile(path.join(newsPath, date + '.json'), JSON.stringify({
  schemaVersion: 1, date, updatedAt: now, sections: { ai: emptyNews, fmcg: { ...emptyNews, contentVersion: 'research-v1' } },
}));
const raw = await raws.create({ title: '端架佐证原始记录', body: '端架佐证原稿。', tags: [], sourceType: 'note', sourceName: '隔离测试' });
const inputs = (title, body, sources = []) => ({
  title, body, sources, type: 'concept', category: 'channel', tags: [], aliases: [],
  knowledge_status: 'inferred', confidence: 'low', source_level: 'D', review_status: 'unreviewed',
});
const quote = '补货📦频次每日一次。';
const subject = await wiki.create(inputs('银杏窗端架补货口径', `## 补货记录\n\n前缀🧺保留。\n${quote}`, [raw.id]));
const unchanged = await wiki.create(inputs('无触发历史页', '仅用于核对浏览期间文件未改写。'));
for (let i = 1; i <= 6; i++) await wiki.create(inputs(`历史观察 ${i}`, '历史记录未提交人工核验。'));
const due = await wiki.create(inputs('近期到期页', '核对周期列表独立筛选。'));
await wiki.withLock(() => wiki.writePageLocked({
  ...due,
  last_verified_at: wikiReviewDate(new Date(Date.now() - 10 * 86_400_000)),
  review_cycle_days: 30,
}));
const restrictedTitle = '不应输出的隔离来源页';
const hidden = await wiki.create(inputs(restrictedTitle, '保密合成正文。'));
const { record: restricted } = await raws.createMeetingRegistration({
  title: '受限原文', body: '保密合成来源。', tags: [], sourceType: 'note', sourceName: '隔离测试',
  id: randomUUID(), importedAt: new Date().toISOString(),
  origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: 'a'.repeat(64),
    registered_confidentiality: 'Restricted', processing_policy: 'meeting_local_only' },
});
await wiki.withLock(() => wiki.writePageLocked({ ...hidden, sources: [restricted.id] }));
const wikiFile = (id) => path.join(root, 'knowledge', 'wiki', id + '.md');
const subjectBefore = await readFile(wikiFile(subject.id));
const untouchedBefore = await readFile(wikiFile(unchanged.id));
const stateFile = path.join(root, 'state', 'review-triggers.json');
let calls = 0;
const fake = await startFakeProvider((request) => {
  calls++;
  const payload = JSON.parse(request.user);
  const page = payload.wiki.find((item) => item.id === subject.id);
  assert(page);
  assert(!Object.hasOwn(page, 'freshness'));
  assert(!request.user.includes(restrictedTitle));
  const chunk = page.chunks.find((item) => item.rawText.includes(quote));
  const start = chunk.startOffset + chunk.rawText.indexOf(quote);
  return { kind: 'content', content: JSON.stringify({
    version: 1, needsRaw: [],
    sections: [{ kind: 'fact', text: '隔离端架补货记录。', citationIds: ['fixture'] }],
    citations: [{ id: 'fixture', kind: 'wiki', recordId: subject.id, start, end: start + quote.length, quote }],
  }) };
});
const portProbe = createServer().listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const { port } = portProbe.address();
await new Promise((resolve) => portProbe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const request = (route, body, method = 'POST') =>
  fetch(base + route, { signal: AbortSignal.timeout(3000), ...(body === undefined ? {} : {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) });
const json = async (route, body, method) => {
  const response = await request(route, body, method);
  assert(response.ok, `${response.status} ${route}: ${response.ok ? '' : await response.text()}`);
  return response.json();
};
const until = async (read) => {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (value) return value;
    await delay(60);
  }
  throw new Error('Timed out waiting for fixture state');
};
let server;
let exit;
let browser;
const stop = async () => {
  if (!server) return;
  server.kill();
  await exit;
  server = undefined;
};
const start = async (enabled) => {
  let errors = '';
  server = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, 'server/index.ts', '--production'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...isolated, FMCG_DATA_DIR: root, FMCG_PORT: String(port), FMCG_LLM_CONFIG_FILE: path.join(run, 'missing.env'),
      FMCG_LLM_BASE_URL: fake.url, FMCG_LLM_MODEL: '2a3-fixture', FMCG_LLM_API_KEY: 'isolated-synthetic-key',
      SEARCH_ENGINE: 'sqlite_fts', WIKI_FRESHNESS_ENABLED: enabled ? '1' : '0', AIPM_2A3_DENIED: deniedRequests,
      FMCG_NEWS_AI_ENABLED: 'false',
    },
  });
  exit = once(server, 'exit');
  server.stderr.on('data', (data) => { errors += data; });
  await until(async () => {
    if (server.exitCode !== null) throw new Error(errors);
    return (await request('/api/health').catch(() => undefined))?.ok;
  });
};

const step = (name) => console.log(name);
const subjectPath = `/api/wiki/${subject.id}`;
const snapshot = async () => Object.fromEntries(await Promise.all(
  ['pending', 'due_soon', 'unverified', 'snoozed'].map(async (view) => [view, await json(`/api/wiki/review-queue?view=${view}`)]),
));
try {
  await start(true);
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.AIPM_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({
    executablePath: process.env.AIPM_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    errors.push('External browser request: ' + route.request().url());
    return route.abort();
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const button = (name) => page.getByRole('button', { name, exact: true });
  const enterWiki = () => button('知识库').click();
  const drawer = page.getByRole('dialog', { name: 'Wiki 复核工作台' });
  const reviewEntry = button('复核工作台');
  const selectTab = (name) => drawer.getByRole('tab', { name, exact: true });
  const detail = page.locator('article.wiki-detail');
  const row = () => drawer.locator('.wiki-review-list > li').filter({ hasText: subject.title });
  const editRaw = async (body) => {
    await button('Raw 原始资料').click();
    await page.locator('.raw-list-item').filter({ hasText: raw.title }).click();
    await button('编辑原文').click();
    await page.getByRole('textbox', { name: '原文正文', exact: true }).fill(body);
    await button('保存原文').click();
    await page.getByRole('dialog', { name: '编辑原文' }).waitFor({ state: 'hidden' });
  };
  await page.goto(base);
  await editRaw('人工修订后的端架佐证正文。');
  const revised = await until(async () => {
    const p = await json(subjectPath);
    return p.freshness.reminders.some((item) => item.kind === 'source_changed') && p;
  });
  assert.equal(revised.freshness.reminders[0].bodyRevision, 1);
  assert.deepEqual(await readFile(wikiFile(subject.id)), subjectBefore);
  step('Raw 浏览器保存产生提醒，Wiki 原字节不变');

  await enterWiki();
  await reviewEntry.click();
  await row().getByText('系统提醒').first().waitFor();
  assert.equal(await drawer.locator('.wiki-review-list > li').count(), 5);
  assert(!(await drawer.innerText()).includes(restrictedTitle));
  assert.equal(await drawer.getByRole('dialog').count(), 0);
  await selectTab('待复核').focus();
  await page.keyboard.press('ArrowRight');
  await drawer.getByRole('button', { name: due.title, exact: true }).waitFor();
  assert.equal(await selectTab('30天内到期').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  await drawer.locator('.wiki-review-list > li').first().waitFor();
  assert.equal(await drawer.locator('.wiki-review-list > li').count(), 5);
  await page.keyboard.press('End');
  await drawer.getByText('SQLite 全文检索', { exact: true }).waitFor();
  assert.deepEqual(await json('/api/wiki/review-index'), { engine: 'sqlite_fts', sqlite: 'ready' });
  await page.keyboard.press('Home');
  assert.equal(await selectTab('待复核').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Shift+Tab');
  assert(await drawer.getByRole('button', { name: '关闭', exact: true }).evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Tab');
  assert(await selectTab('待复核').evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert(await reviewEntry.evaluate((node) => node === document.activeElement));
  step('四标签、前五、真实索引状态、键盘与返回焦点');

  await page.getByRole('tab', { name: '向知识库提问', exact: true }).click();
  await page.getByRole('textbox', { name: '知识库问题' }).fill(subject.title);
  await button('提问').click();
  const card = page.locator('.answer-citations > li').filter({ hasText: quote });
  await card.getByText('有复核提醒').waitFor();
  const answer = await json('/api/knowledge/answers/current');
  const [citation] = answer.citations;
  assert.equal(citation.quote, revised.body.slice(citation.start, citation.end));
  assert.equal(citation.end - citation.start, quote.length);
  assert.equal(citation.reviewRevision, subject.revision);
  const citationPath = `/api/knowledge/answers/${answer.id}/citations/${citation.id}`;
  assert.equal((await request(citationPath)).status, 200);
  const answerFile = path.join(root, 'state', 'knowledge-answers', answer.id + '.json');
  const answerBytes = await readFile(answerFile);
  await card.getByRole('button', { name: '确认仍有效', exact: true }).click();
  await card.getByText('已确认仍有效。', { exact: true }).waitFor();
  await until(async () => !(await card.getByText('有复核提醒').count()));
  const after = await json(citationPath);
  assert.equal(after.quote, quote);
  assert.deepEqual([after.revision, after.start, after.end, after.bodySha256], [citation.revision, citation.start, citation.end, citation.bodySha256]);
  assert.equal(after.reviewRevision, subject.revision + 1);
  assert.deepEqual(await readFile(answerFile), answerBytes);
  await card.getByRole('button', { name: new RegExp(subject.title) }).click();
  await detail.locator('mark').getByText(quote, { exact: true }).waitFor();
  assert.equal((await json(subjectPath)).body, revised.body);
  step('引用卡点击确认，历史快照与 UTF-16 原句原样保留，点开后定位');

  await stop();
  await start(false);
  await page.reload();
  await enterWiki();
  await page.getByRole('tab', { name: '向知识库提问', exact: true }).click();
  await card.getByRole('button', { name: new RegExp(subject.title) }).click();
  await detail.getByRole('heading', { name: subject.title, exact: true }).waitFor();
  assert.equal((await json(citationPath)).quote, quote);
  assert.equal((await request(citationPath + '/review', { baseRevision: after.reviewRevision })).status, 404);
  await stop();
  await start(true);
  await page.reload();
  await enterWiki();
  await page.getByRole('tab', { name: '向知识库提问', exact: true }).click();
  await card.getByRole('button', { name: new RegExp(subject.title) }).click();
  await detail.locator('mark').getByText(quote, { exact: true }).waitFor();
  step('重启关闭开关后，纯时效更新过的旧 Wiki 引用仍可打开');

  await json(subjectPath + '/review/cycle', { baseRevision: after.reviewRevision, reviewCycleDays: 90 });
  await detail.getByRole('button', { name: '确认仍有效' }).click();
  await detail.getByText('页面已更新，请核对当前版本后再操作。').waitFor();
  await detail.getByRole('button', { name: '确认仍有效' }).click();
  await detail.getByText('已确认仍有效。', { exact: true }).waitFor();
  await detail.getByRole('button', { name: '调整周期' }).click();
  await detail.getByRole('spinbutton').fill('30');
  await detail.getByRole('button', { name: '保存周期' }).click();
  await detail.getByText('已更新复核周期。').waitFor();
  assert.equal((await json(subjectPath)).freshness.cycleDays, 30);
  await page.getByRole('tab', { name: '向知识库提问', exact: true }).click();
  const staleConfirm = card.getByRole('button', { name: '确认仍有效', exact: true });
  await staleConfirm.waitFor();
  const rawPath = '/api/raw/' + raw.id;
  const rawBefore = await json(rawPath);
  const wikiBeforeRejectedReview = await readFile(wikiFile(subject.id));
  await json(rawPath + '/body', {
    body: '第三版端架佐证，测试旧证据失效。',
    expectedBodySha256: rawBefore.bodySha256,
    expectedBodyRevision: rawBefore.bodyRevision,
  }, 'PATCH');
  await until(async () => (await json(subjectPath)).freshness.reminders[0]?.bodyRevision === 2);
  await staleConfirm.click();
  await page.getByText('这条引用的依据已变化，请重新提问核验。').waitFor();
  assert.equal(await staleConfirm.count(), 0);
  assert.equal(await card.getByText(quote, { exact: true }).count(), 1);
  assert.deepEqual(await readFile(wikiFile(subject.id)), wikiBeforeRejectedReview);
  assert.equal((await request(citationPath)).status, 409);
  await enterWiki();
  await page.setViewportSize({ width: 390, height: 844 });
  await reviewEntry.click();
  await row().getByText('已关联的 Raw 正文已更新，请复核受影响的结论。', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(Math.round((await drawer.boundingBox()).width), 390);
  await page.screenshot({ path: path.join(run, 'drawer-390.png') });
  await row().getByRole('button', { name: '暂缓 30 天', exact: true }).click();
  await drawer.getByText(subject.title + ' · 已暂缓 30 天。').waitFor();
  await until(async () => !(await row().count()));
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '结构检查（Lint）' }).click();
  await page.getByRole('region', { name: '时效汇总' }).getByText(/已暂缓 1 页/).waitFor();
  const lint = await json('/api/wiki-lint');
  assert.equal(Object.values(lint.freshness.byStatus).reduce((sum, count) => sum + count, 0), 9);
  assert(!JSON.stringify(lint).includes(restrictedTitle));
  await page.screenshot({ path: path.join(run, 'lint-390.png') });
  step('详情真实冲突与重试、周期、真实底证变化拒绝旧定位、窄屏暂缓及 Lint');

  const beforeRestart = await snapshot();
  assert(beforeRestart.snoozed.items.some((item) => item.pageId === subject.id));
  const verifiedBytes = await readFile(wikiFile(subject.id));
  const reviewBytes = await readFile(stateFile);
  await stop();
  await start(false);
  await page.reload();
  await enterWiki();
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  assert.equal(await reviewEntry.count(), 0);
  assert.equal((await json('/api/wiki/schema')).freshnessEnabled, undefined);
  assert.equal((await json(subjectPath)).freshness, undefined);
  assert.equal((await request(subjectPath + '/export')).status, 200);
  assert.equal((await request('/api/wiki/review-queue')).status, 404);
  assert.equal((await request('/api/wiki/review-index')).status, 404);
  assert.equal((await request(subjectPath + '/review/confirm', { baseRevision: 1 })).status, 404);
  await page.getByRole('tab', { name: '向知识库提问', exact: true }).click();
  await card.getByText(quote, { exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '确认仍有效', exact: true }).count(), 0);
  assert.equal((await json('/api/knowledge/answers/current')).citations[0].freshness, undefined);
  await page.getByRole('tab', { name: '结构检查（Lint）' }).click();
  await page.getByText('Lint 检查完成', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '时效汇总' }).count(), 0);
  assert.deepEqual(await readFile(wikiFile(subject.id)), verifiedBytes);
  assert.deepEqual(await readFile(stateFile), reviewBytes);
  await stop();
  const state = path.join(root, 'state');
  for (const file of (await readdir(state)).filter((name) => /^search-index\.sqlite(?:[-.]|$)/u.test(name))) {
    await rm(path.join(state, file));
  }
  await start(true);
  await page.reload();
  await enterWiki();
  await reviewEntry.waitFor();
  assert.deepEqual(await json('/api/wiki/review-index'), { engine: 'sqlite_fts', sqlite: 'ready' });
  assert.deepEqual(await snapshot(), beforeRestart);
  assert.deepEqual(await readFile(wikiFile(subject.id)), verifiedBytes);
  assert.deepEqual(await readFile(stateFile), reviewBytes);
  assert.deepEqual(await readFile(wikiFile(unchanged.id)), untouchedBefore);
  assert.equal(await readFile(deniedRequests, 'utf8'), '');
  assert.deepEqual(errors, []);
  assert.equal(calls, 1);
  step('关闭开关后刷新旧页面，保留事实；删 SQLite 再启用，四视图与字节一致');
  console.log(JSON.stringify({ edge: browser.version(), width: 390, calls, subjectBefore: sha(subjectBefore),
    verifiedBytes: sha(verifiedBytes), reviewBytes: sha(reviewBytes), answerBytes: sha(answerBytes),
    untouched: sha(untouchedBefore), evidence: run }, null, 2));
} finally {
  await browser?.close();
  await stop();
  await fake.close();
}
