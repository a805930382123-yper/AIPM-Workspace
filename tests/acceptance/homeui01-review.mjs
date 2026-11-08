import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const output = path.resolve('docs/reports/HOMEUI01-20261108-evidence');
const cache = path.resolve('node_modules/.cache/homeui01-review');
const visualOnly = process.argv.includes('--visual');
await Promise.all([mkdir(output, { recursive: true }), mkdir(cache, { recursive: true })]);
const root = await mkdtemp(path.join(cache, 'run-'));
const envDir = path.join(root, 'empty-env');
await mkdir(envDir);
const evidence = { success: false, checks: [], layouts: [], requests: [], pageErrors: [], blockedRequests: [], screenshots: [] };

const date = '2026-11-08', timestamp = date + 'T01:00:00.000Z';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const raw = { id: id(1), title: '合成原文：巡店路线核对', sourceType: 'note', sourceName: '隔离资料', tags: [], body: '只用于首页 UI 验收。', bodySha256: '0'.repeat(64), importedAt: timestamp, status: 'unprocessed' };
const wiki = { id: id(2), title: '合成知识：陈列核对口径', type: 'concept', domain: 'fmcg', category: 'industry_basics', created: date, updated: timestamp, sources: [raw.id], tags: [], knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'unreviewed', aliases: [], revision: 1, body: '隔离知识内容。', links: [] };
const dueItem = { id: id(3), kind: 'customer_issue', title: '合成到期跟进：试点门店覆盖', createdAt: timestamp, updatedAt: timestamp, status: 'triage', revision: 1, feedback: '用户反馈待核。', followUpOn: date, rawIds: [], history: [], screenshots: [] };
const auditItem = { id: id(4), wikiId: wiki.id, scope: 'page', severity: 'warning', comment: '合成纠错：确认当前口径', anchor: { before: '', text: '', after: '' }, pageBodySha256: '0'.repeat(64), createdRevision: 1, revision: 1, createdAt: timestamp, status: 'open', location: { status: 'located', start: 0, end: 0, method: 'page' }, decisionHistory: [] };
const common = { result: '合成已保存进度。', updatedAt: timestamp, priority: 1 };
const running = { ...common, id: id(5), kind: 'raw-task', title: visualOnly ? '合成整理：核对试点门店巡店路线' : '合成整理：' + 'LongUnbrokenTitle'.repeat(13), status: 'running', problem: '正在准备整理成果', action: '查看整理进度', target: { rawId: raw.id }, versionToken: 'test-token' };
const draft = { ...common, id: id(6), kind: 'draft', title: '合成待审：巡店问题清单', status: 'review', problem: '待审核', action: '继续审核', target: { draftId: id(7) }, versionToken: 'test-draft' };
const audit = { ...common, id: auditItem.id, kind: 'audit', title: auditItem.comment, problem: '待核验来源', action: '查看纠错', target: { wikiId: wiki.id, auditId: auditItem.id, revision: 1, wikiRevision: 1 }, versionToken: 'test-audit' };
const deferred = { ...draft, id: id(8), title: '合成稍后：促销活动复盘', status: 'deferred', action: '继续处理', versionToken: 'test-deferred' };
const okSources = Object.fromEntries(['raw-task', 'draft', 'workflow', 'audit'].map(name => [name, { status: 'ok' }]));
const longError = '某来源读取失败：' + 'UnbrokenErrorText'.repeat(15);
const actions = { items: [running, draft, audit, deferred], sources: okSources };
const empty = { items: [], sources: okSources };
const news = { date, aiEnabled: false, fallbacks: {}, edition: { date, updatedAt: timestamp, sections: Object.fromEntries(['fmcg', 'ai'].map(key => [key, { status: 'source_only', items: [], sources: [], attempt: 1 }])) } };
const schema = { domain: 'fmcg', types: [{ id: 'concept', label: '概念', description: '合成' }], categories: [{ id: 'industry_basics', label: '行业基础' }], enums: { knowledge_status: ['needs_verification'], confidence: ['low'], source_level: ['D'], review_status: ['unreviewed'] }, pageTemplates: {}, sourcePolicy: { levels: [], guidance: '' } };
const counts = { rawCount: 1, wikiCount: 1, thisWeekNewCount: 2, pendingConfirmationCount: 1, openAuditCount: 1, promptCount: 0, weekStartsOn: '2026-11-02', recentChanges: [{ time: timestamp, action: 'update', id: wiki.id, title: wiki.title, type: wiki.type, revision: 1 }] };
let actionMode = 'loaded', dueMode = 'loaded', stale = true;
const routes = new Map([
  ['/api/raw', { items: [raw] }], [`/api/raw/${raw.id}`, raw], [`/api/raw/${raw.id}/translation`, { translation: null }],
  ['/api/stats', counts], ['/api/recovery-issues', { items: [], overflow: false }], ['/api/raw-processing', { items: [] }],
  ['/api/wiki', { items: [wiki], categoryCounts: { industry_basics: 1 } }], [`/api/wiki/${wiki.id}`, wiki], ['/api/wiki/schema', schema],
  ['/api/wiki-lint', { generatedAt: timestamp, findings: [], summary: {} }], ['/api/knowledge/workflows', { items: [] }], ['/api/drafts', { items: [] }],
  ['/api/audits', { items: [auditItem] }], [`/api/audits/${auditItem.id}`, { audit: auditItem, draft: null, conflicts: [] }],
  [`/api/work-items/${dueItem.id}`, dueItem], [`/api/work-items/${dueItem.id}/suggestions`, { revision: 1, suggestions: [] }],
  ['/api/news/today', news], ['/api/news/today/ensure', news], ['/api/news/history', { items: [], errors: [] }], [`/api/news/editions/${date}/saved-raws`, { items: [] }],
  ['/api/meeting-catalog', { schema_version: 1, revision: 1, types: [{ id: id(9), name: '对接', active: true }], tags: [] }], ['/api/meetings', { items: [] }],
  ['/api/prompts', { items: [], categoryCounts: {} }], ['/api/prompts/schema', { categories: [{ id: 'customer', label: '客户' }] }], ['/api/prompt-ai/drafts', { items: [] }], ['/api/prompt-ai/records', { items: [] }],
  ['/api/llm/config', { configured: false, keyConfigured: false, source: 'none' }],
  ['/api/home/review', { period: { start: date, end: date }, snapshotAt: timestamp, knowledge: { status: 'ok', count: 0, items: [], undated: [] }, pending: empty, feedback: { status: 'ok', items: [], counts: {} } }],
]);
const vite = await createServer({
  configFile: false, root: process.cwd(), envDir, cacheDir: path.join(root, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [react(), { name: 'homeui01-isolated-responses', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const { pathname: route, search } = new URL(req.url, 'http://127.0.0.1');
      if (!route.startsWith('/api/')) return next();
      let data = routes.get(route), status = 200;
      if (route === '/api/home/actions') {
        if (actionMode === 'fail') { status = 503; data = { error: { message: '合成首页请求失败' } }; }
        else if (actionMode === 'partial') data = { items: [running], sources: { ...okSources, audit: { status: 'error', message: longError } } };
        else data = actionMode === 'empty' ? empty : actions;
      } else if (route === '/api/work-items') data = { items: dueMode === 'empty' ? [] : [dueItem] };
      else if (route === `/api/home/actions/raw-task/${running.id}`) {
        if (stale) { status = 409; data = { error: { message: '事项已变化，请刷新' } }; }
        else data = running;
      } else if (route === `/api/home/actions/audit/${audit.id}`) data = audit;
      if (data === undefined) { status = 404; data = { error: { message: '隔离测试路由没有匹配响应' } }; }
      if (req.method !== 'GET' && !(route === '/api/news/today/ensure' && req.method === 'POST')) status = 405;
      evidence.requests.push({ route, search, method: req.method, status });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
  } }],
});

let browser, page;
try {
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { chromium } = createRequire(import.meta.url)(process.env.HOMEUI01_PLAYWRIGHT ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({ executablePath: process.env.HOMEUI01_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-proxy-server'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12_000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    evidence.blockedRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  const home = page.locator('.home-page');
  const main = page.locator('#home-actions');
  const due = page.locator('.work-due');
  const newsCard = page.locator('.news-home');
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const heading = (name, scope = page) => scope.getByRole('heading', { name, exact: typeof name === 'string' });
  const article = (item, scope = main) => scope.getByRole('article', { name: item.title, exact: true });
  const goHome = async () => {
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible()) await button(/^(关闭|取消)$/, dialog).first().click();
    await button('首页', page.getByRole('navigation', { name: '主导航' })).click();
  };
  const count = route => evidence.requests.filter(request => request.route === route).length;
  async function resize(width) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function shot(name) {
    const filename = `review-${name}.png`;
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
    evidence.screenshots.push(filename);
  }
  async function layout(width) {
    await resize(width);
    const bounds = await home.evaluate(node => {
      const box = selector => {
        const target = node.querySelector(selector), r = target.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, scroll: target.scrollWidth, client: target.clientWidth };
      };
      return { pageWidth: document.documentElement.scrollWidth, entries: box('.home-entry-grid'), tasks: box('#home-actions'), due: box('.work-due'), news: box('.news-home') };
    });
    evidence.layouts.push({ width, ...bounds });
    assert.ok(bounds.pageWidth <= width);
    for (const [name, rect] of Object.entries(bounds).slice(1)) assert.ok(rect.scroll <= rect.client + 1, `${width}px ${name} overflows`);
    assert.ok(bounds.tasks.y >= bounds.entries.y + bounds.entries.h - 1);
    if (width >= 1440) {
      assert.ok(bounds.tasks.w > bounds.due.w * 1.4);
      assert.ok(Math.abs(bounds.tasks.y - bounds.due.y) <= 3, 'desktop top edges align');
      assert.ok(bounds.tasks.x + bounds.tasks.w <= bounds.due.x + 1);
      assert.ok(Math.abs(bounds.news.x - bounds.due.x) <= 3);
      assert.ok(bounds.news.y >= bounds.due.y + bounds.due.h - 1);
    } else if (width === 390) {
      assert.ok(bounds.tasks.y + bounds.tasks.h <= bounds.due.y + 1);
      assert.ok(bounds.news.y >= bounds.due.y + bounds.due.h - 1);
      assert.ok(bounds.tasks.w > 330 && bounds.due.w > 330 && bounds.news.w > 330);
    } else {
      assert.ok(bounds.due.y >= bounds.tasks.y + bounds.tasks.h - 1);
      assert.ok(bounds.news.y >= bounds.tasks.y + bounds.tasks.h - 1);
    }
  }
  async function focusVisible(locator) {
    assert.equal(await locator.evaluate(node => document.activeElement === node && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'), true);
  }
  const toolNames = ['从 Raw 生成 Wiki 草稿', '手动创建 Wiki', '新建 Prompt', '检查知识库'];
  const openTools = async () => {
    if (!(await button(toolNames[0], home).isVisible())) await home.getByText('更多工具', { exact: true }).click();
    await button(toolNames[0], home).waitFor();
  };

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await article(running).waitFor();
  await article(dueItem, due).waitFor();
  await newsCard.getByText(/来源摘录可阅读/).first().waitFor();
  assert.equal(await newsCard.count(), 1);
  if (visualOnly) {
    await layout(1440);
    await shot('desktop');
    await layout(390);
    const filename = 'review-mobile-workspace.png';
    await home.locator('.home-workspace').screenshot({ path: path.join(output, filename), animations: 'disabled' });
    evidence.screenshots.push(filename);
    evidence.checks.push('Normal-length synthetic task screenshot at 1440 and 390');
  } else {
  for (const width of [1440, 1024, 390]) { await layout(width); await shot(`populated-${width}`); }
  evidence.checks.push('H01/H02 populated desktop and two narrow widths; task-first order, long title without overflow');

  await button('周期回顾', home).focus();
  for (const name of [/^导入资料/, /^审核草稿/, /^生成 Prompt/, /^新建会议/]) {
    await page.keyboard.press('Tab');
    await focusVisible(button(name, home.locator('.home-entry-grid')));
  }
  await openTools();
  await button(toolNames[0], home).focus();
  await page.keyboard.press('Shift+Tab');
  for (const name of toolNames) {
    await page.keyboard.press('Tab');
    await focusVisible(button(name, home));
  }
  assert.equal(await button('仅保存 Raw', home).count(), 0);
  assert.equal(await button(/^生成 Prompt/, home).count(), 1);
  await resize(1440);
  await button(/^审核草稿/, home.locator('.home-entry-grid')).click();
  await article(draft).waitFor();
  assert.equal(await article(audit).count(), 0);
  await button(/显示全部事项|显示全部/, main).click();
  await article(audit).waitFor();
  await button(/^审核草稿/, home.locator('.home-entry-grid')).click();
  await button(/Open Audit|待纠错/, home.locator('.stats-grid')).click();
  await article(audit).waitFor();
  await article(deferred).waitFor();
  await button(running.action, article(running)).click();
  await main.getByRole('alert').filter({ hasText: '事项已变化' }).waitFor();
  assert.match(evidence.requests.find(request => request.status === 409).search, /versionToken=test-token/u);
  stale = false;
  await button(running.action, article(running)).click();
  await page.locator('.raw-detail-panel').getByText(raw.title, { exact: true }).waitFor();
  await goHome();
  await article(dueItem, due).waitFor();
  const priorDue = count('/api/work-items');
  const dueRefresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/work-items' && new URL(response.url()).searchParams.has('due'));
  await button(/刷新/, due).click();
  await dueRefresh;
  await article(dueItem, due).waitFor();
  assert.ok(count('/api/work-items') > priorDue);
  await button('查看事项', article(dueItem, due)).click();
  await heading(dueItem.title).waitFor();
  assert.ok(count(`/api/work-items/${dueItem.id}`) > 0);
  evidence.checks.push('H04 filter, reset, deferred visibility, stale action preflight and real UI routes to Raw and due item');

  await goHome();
  await button('周期回顾', home).click();
  await page.getByRole('region', { name: '周期回顾' }).getByText('本周期无记录。').waitFor();
  await button('关闭回顾', home).click();
  await button(/^导入资料/, home.locator('.home-entry-grid')).click();
  await page.getByRole('dialog', { name: '导入原始资料' }).waitFor();
  await goHome();
  await button(/^生成 Prompt/, home.locator('.home-entry-grid')).click();
  await page.locator('.prompt-ai-workbench').waitFor();
  await goHome();
  await button(/^新建会议/, home.locator('.home-entry-grid')).click();
  await page.getByRole('dialog', { name: '新建会议' }).waitFor();
  for (const [name, destination] of [
    [toolNames[0], () => page.getByRole('dialog', { name: '选择一条 Raw' })],
    [toolNames[1], () => heading('新建 Wiki')],
    [toolNames[2], () => heading('新建 Prompt')],
    [toolNames[3], () => page.locator('.lint-findings')],
  ]) {
    await goHome();
    await openTools();
    await button(name, home).click();
    await destination().waitFor();
  }
  await goHome();
  await button('阅读资讯', newsCard).click();
  await heading('每日资讯').waitFor();
  await page.getByText(/AI 分析未启用/).waitFor();
  evidence.checks.push('H02/H03 keyboard focus, no duplicated top actions, eight routes and independent news entry/status');

  actionMode = 'fail';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await main.getByRole('alert').filter({ hasText: /读取失败/ }).waitFor();
  assert.equal(await main.getByText('正在读取事项…', { exact: true }).count(), 0);
  assert.equal(await main.getByText('当前没有需要处理的事项。', { exact: true }).count(), 0);
  const previous = count('/api/home/actions');
  actionMode = 'partial';
  await button(/刷新/, main).click();
  await main.getByRole('alert').filter({ hasText: longError }).waitFor();
  await article(running).waitFor();
  assert.equal(count('/api/home/actions'), previous + 1);
  await layout(390);
  await shot('partial-error-390');
  actionMode = 'empty';
  dueMode = 'empty';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await main.getByText('当前没有需要处理的事项。', { exact: true }).waitFor();
  await due.getByText(/暂无到期/).waitFor();
  await layout(1440);
  await shot('empty-1440');
  evidence.checks.push('H04/H05 first failure exits loading, explicit refresh and partial failure with long text, true empty state');
  }
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.blockedRequests, []);
  assert.ok(evidence.requests.every(request => request.method === 'GET' || (request.route === '/api/news/today/ensure' && request.method === 'POST')));
  evidence.success = true;
  console.log(JSON.stringify({ checks: evidence.checks, layouts: evidence.layouts, chrome: browser.version() }, null, 2));
} catch (error) {
  evidence.failure = error.stack;
  if (page) await page.screenshot({ path: path.join(output, 'review-failure.png'), animations: 'disabled' });
  throw error;
} finally {
  if (browser) { evidence.chrome = browser.version(); await browser.close(); }
  await vite.close();
  await writeFile(path.join(output, visualOnly ? 'review-visual.json' : 'review-browser.json'), JSON.stringify(evidence, null, 2));
}
