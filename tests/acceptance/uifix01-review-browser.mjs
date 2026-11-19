import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, preview } from 'vite';
import { RawStore } from '../../services/raw/store.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { PromptStore } from '../../services/prompt/store.ts';
import { NewsRawSave } from '../../services/news/raw-save.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'uifix01-review-'));
const data = path.join(run, 'data');
const envDir = path.join(run, 'empty-env');
const outDir = path.join(run, 'dist');
const config = path.join(run, 'provider.env');
const requestLog = path.join(run, 'external-requests.ndjson');
const preloadFile = path.join(run, 'server-preload.mjs');
await Promise.all([
  mkdir(envDir, { recursive: true }),
  mkdir(path.join(data, 'drafts', 'knowledge-workflows'), { recursive: true }),
  mkdir(path.join(data, 'state', 'news'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'news-candidates'), { recursive: true }),
]);
await writeFile(requestLog, '');
await writeFile(config, [
  'FMCG_LLM_BASE_URL=https://uifix01-fake.invalid/v1',
  'FMCG_LLM_MODEL=uifix01-synthetic-model',
  'FMCG_LLM_API_KEY=uifix01-synthetic-key-only',
].join('\n') + '\n');

// Preload injected into isolated server/index.ts to stub all external HTTP requests cleanly.
await writeFile(preloadFile, `
import { appendFile } from 'node:fs/promises';
const logFile = process.env.UIFIX01_REQUEST_LOG;
const allowedNewsHosts = new Set([
  'worldpanelbynumerator.com', 'nielseniq.cn', 'www.stats.gov.cn',
  'www.pwccn.com', 'kpmg.com', 'china.mintel.com', 'aihot.news',
]);
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(...args);
  await appendFile(logFile, JSON.stringify({ url: url.href, method: args[1]?.method ?? 'GET' }) + '\\n');
  if (!allowedNewsHosts.has(url.hostname)) {
    throw new Error('Blocked unexpected external request in UIFIX01 isolation: ' + url.href);
  }
  if (url.hostname === 'worldpanelbynumerator.com') {
    return new Response('stubbed unavailable', { status: 503 });
  }
  if (url.hostname === 'aihot.news') {
    return Response.json({ items: [] });
  }
  if (url.hostname === 'china.mintel.com') {
    return url.pathname.endsWith('feed/')
      ? new Response('<rss><channel/></rss>', { headers: { 'content-type': 'application/rss+xml' } })
      : new Response('<link rel="alternate" type="application/rss+xml" href="/press-centre/feed/">', { headers: { 'content-type': 'text/html' } });
  }
  return new Response('<main></main>', { headers: { 'content-type': 'text/html' } });
};
`);

// Seed isolated data stores using product store modules.
const rawStore = new RawStore(data);
const wikiStore = new WikiStore(data, rawStore);
const promptStore = new PromptStore(data, wikiStore);
await rawStore.initialize();
await wikiStore.initialize();
await promptStore.initialize();

const raw1 = await rawStore.create({
  title: 'UIFIX01 原始资料甲',
  body: '快消渠道调研原文甲。覆盖华东线下商超样本。',
  tags: ['渠道'],
  sourceType: 'report',
  sourceName: '测试研报甲',
});
const raw2 = await rawStore.create({
  title: 'UIFIX01 原始资料乙',
  body: '快消渠道调研原文乙。覆盖便利店与折扣店样本。',
  tags: ['零售'],
  sourceType: 'article',
  sourceName: '测试文章乙',
});

await wikiStore.create({
  title: 'UIFIX01 独立概念页',
  type: 'concept',
  category: 'industry_basics',
  body: '## 定义\n用于验收弹窗 Escape 关闭与焦点还原的概念页。',
  sources: [],
  aliases: [],
  tags: [],
  knowledge_status: 'needs_verification',
  confidence: 'low',
  source_level: 'D',
  review_status: 'unreviewed',
});

await promptStore.create(randomUUID(), {
  name: 'UIFIX01 测试模板',
  category: 'office',
  scenario: '用于验证删除弹窗 Escape 与焦点还原',
  body: '请整理 {{对象}} 的渠道现状。',
  inputRequirements: '',
  outputRequirements: '',
  relatedWikiIds: [],
  examples: '',
  tags: [],
  favorite: false,
});

const now = new Date();
const stamp = now.toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const published = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(+now - 3 * 86400000));

const candItem = {
  id: 'uifix01-cand-1',
  title: 'UIFIX01 自动化候选来源丙',
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: 'https://example.invalid/uifix01/cand-1',
  publishedAt: published,
  fetchedAt: stamp,
  excerpt: '自动化入箱候选测试正文，用于验证从自动化进入草稿审核后的返回按钮与上下文保持。',
  evidenceKind: 'article_excerpt',
};
const candRegId = randomUUID();
const savedCand = await new NewsRawSave(data, rawStore, () => now).save(today, 'fmcg', candItem, candRegId);
const raw3 = await rawStore.get(savedCand.rawId);
assert.ok(raw3);

const draftId = randomUUID();
const jobId = randomUUID();
await writeFile(path.join(data, 'drafts', `${draftId}.json`), JSON.stringify({
  id: draftId,
  rawId: raw3.id,
  rawSha256: raw3.bodySha256,
  rawTitle: raw3.title,
  rawMeta: {
    rawId: raw3.id,
    title: raw3.title,
    sourceType: raw3.sourceType,
    sourceName: raw3.sourceName,
    importedAt: raw3.importedAt,
  },
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  rulesVersion: 'locator-v2-test',
  provider: { name: 'synthetic', model: 'uifix01-test' },
  jobId,
  document: { title: '自动化候选待审草稿', main_topic: '渠道样本', summary: '摘要' },
  source: {
    title: raw3.title,
    category: 'industry_basics',
    summary: '摘要',
    key_takeaways: [],
    body: '来源正文',
    knowledge_status: 'source_supported',
    confidence: 'low',
    source_level: 'C',
  },
  pages: [{
    pageId: randomUUID(),
    title: '自动化测试概念',
    type: 'concept',
    category: 'industry_basics',
    one_line_definition: '测试概念定义',
    source_facts: [{ text: raw3.body, evidenceIds: ['e1'] }],
    ai_organized: [],
    ai_inferences: [],
    related_pages: [],
    open_questions: [],
    source_evidence: [{ id: 'e1', rawId: raw3.id, quote: raw3.body, start: 0, end: raw3.body.length, chunkIndex: 0 }],
    knowledge_status: 'source_supported',
    confidence: 'low',
    source_level: 'C',
    selected: true,
    provenance: [{ chunkIndex: 0, start: 0, end: raw3.body.length }],
  }],
  warnings: [],
  extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
}, null, 2));

await writeFile(path.join(data, 'state', 'automation', 'news-candidates', `${today}.json`), JSON.stringify({
  schemaVersion: 1,
  date: today,
  items: [{
    id: `${today}/fmcg/uifix01-cand-1`,
    section: 'fmcg',
    disposition: 'inbox',
    item: candItem,
    confirmation: {
      requestId: randomUUID(),
      registrationId: candRegId,
      grantedAt: stamp,
      organize: true,
      mode: 'standard',
    },
    execution: {
      phase: 'draft_ready',
      runId: randomUUID(),
      rawId: raw3.id,
      jobId,
      draftId,
    },
  }],
}, null, 2));

const workflowId = randomUUID();
await writeFile(path.join(data, 'drafts', 'knowledge-workflows', `${workflowId}.json`), JSON.stringify({
  id: workflowId,
  kind: 'synthesis',
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  provider: { name: 'synthetic', model: 'uifix01-test' },
  rawSnapshots: [
    { id: raw1.id, title: raw1.title, bodySha256: raw1.bodySha256 },
    { id: raw2.id, title: raw2.title, bodySha256: raw2.bodySha256 },
  ],
  sources: [raw1.id, raw2.id],
  title: 'UIFIX01 综合测试工作流',
  category: 'industry_basics',
  sections: {
    suggestedAdditions: ['综合增量观点'],
    conflicts: [],
    inferences: [],
    openQuestions: [],
    agreement: [],
    sourceList: [
      { id: raw1.id, title: raw1.title },
      { id: raw2.id, title: raw2.title },
    ],
  },
}, null, 2));

await writeFile(path.join(data, 'state', 'news', `${today}.json`), JSON.stringify({
  schemaVersion: 1,
  date: today,
  updatedAt: stamp,
  sections: {
    fmcg: {
      contentVersion: 'research-v1',
      status: 'source_only',
      attempt: 1,
      startedAt: stamp,
      finishedAt: stamp,
      items: [{
        id: 'uifix01-fmcg-1',
        title: 'UIFIX01 快消渠道研究示例',
        sourceId: 'worldpanel',
        sourceName: 'Worldpanel by Numerator',
        url: 'https://example.invalid/uifix01/fmcg-1',
        publishedAt: published,
        fetchedAt: stamp,
        excerpt: '这是用于验收每日资讯页面的测试快消研报摘录内容，包含长标题与正常换行检查。',
        evidenceKind: 'article_excerpt',
      }],
      sources: [{
        name: 'Worldpanel by Numerator',
        sourceId: 'worldpanel',
        checkedAt: stamp,
        status: 'failed',
        error: '隔离测试失败来源标记',
        diagnosis: {
          startedAt: stamp,
          finishedAt: stamp,
          elapsedMs: 12,
          outcome: 'failed',
          counts: { candidates: 0, qualified: 0, duplicates: 0, rejected: 0, failed: 1 },
          error: { type: 'network', stage: 'list', message: '隔离测试失败来源标记' },
        },
      }],
    },
    ai: {
      status: 'source_only',
      attempt: 1,
      startedAt: stamp,
      finishedAt: stamp,
      items: [{
        id: 'uifix01-ai-1',
        title: 'UIFIX01 AI 前沿示例条目',
        sourceId: 'aihot',
        sourceName: 'AIHOT',
        url: 'https://example.invalid/uifix01/ai-1',
        publishedAt: published,
        fetchedAt: stamp,
        excerpt: '这是用于验收 AI 前沿栏目锚点跳转与移动端布局的测试摘录。',
        evidenceKind: 'source_summary',
      }],
      sources: [],
    },
  },
}, null, 2));

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  assert.ok(![4317, 5151, 5173].includes(port), `Reserved port chosen: ${port}`);
  return port;
}

await build({ configFile: false, plugins: [react()], envDir, build: { outDir, emptyOutDir: false } });
const apiPort = await freePort();
const uiPort = await freePort();
assert.notEqual(apiPort, uiPort);
const apiBase = `http://127.0.0.1:${apiPort}`;
const uiBase = `http://127.0.0.1:${uiPort}`;

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|NODE_OPTIONS$)/i.test(key)));
Object.assign(env, {
  FMCG_DATA_DIR: data,
  FMCG_PORT: String(apiPort),
  FMCG_UI_ORIGIN: uiBase,
  FMCG_LLM_CONFIG_FILE: config,
  FMCG_NEWS_AI_ENABLED: 'false',
  UIFIX01_REQUEST_LOG: requestLog,
});

const child = spawn(
  process.execPath,
  ['--import', pathToFileURL(preloadFile).href, '--import', 'tsx', 'server/index.ts'],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
const exited = once(child, 'close');
let apiLog = '';
child.stdout.on('data', chunk => { apiLog += chunk; });
child.stderr.on('data', chunk => { apiLog += chunk; });

const evidence = {
  run,
  today,
  apiPort,
  uiPort,
  desktopChecks: [],
  mobileChecks: [],
  pageErrors: [],
  blockedBrowserExternalRequests: [],
  serverExternalRequests: [],
  closed: {},
};

const waitFor = async (label, fn) => {
  for (let i = 0; i < 120; i += 1) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  assert.fail(`Timeout waiting for ${label}`);
};

let ui;
let browser;
try {
  await waitFor('isolated API', () => fetch(`${apiBase}/api/health`).then(r => r.ok, () => false));
  ui = await preview({
    configFile: false,
    envDir,
    build: { outDir },
    preview: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': apiBase } },
  });

  const { chromium } = createRequire(import.meta.url)(
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
  );
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'],
  });
  evidence.browserVersion = browser.version();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12000);
  page.on('pageerror', err => evidence.pageErrors.push(err.message));

  let newsCheckGate = null;
  await page.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    if (!url.startsWith(`${uiBase}/`)) {
      evidence.blockedBrowserExternalRequests.push(url);
      await route.abort();
      return;
    }
    if (req.method() === 'POST' && url.endsWith('/api/news/today/check') && newsCheckGate) {
      const gate = newsCheckGate;
      gate.arrived();
      await gate.promise;
    }
    await route.continue();
  });

  const navClick = label => page.locator('.sidebar button.nav-item').filter({ hasText: label }).click();
  const measureOverflow = async (label) => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => {
      const vw = window.innerWidth;
      const sw = document.documentElement.scrollWidth;
      const offenders = [...document.querySelectorAll('body *')]
        .map(el => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || st.display === 'none') return null;
          if (r.right > vw + 1 || el.scrollWidth > el.clientWidth + 1) {
            return {
              tag: el.tagName.toLowerCase(),
              cls: typeof el.className === 'string' ? el.className : '',
              right: Math.round(r.right),
              width: Math.round(r.width),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              text: (el.textContent ?? '').trim().slice(0, 40),
            };
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 15);
      return { innerWidth: vw, scrollWidth: sw, overflow: sw > vw, offenders };
    });
    return { page: label, ...metrics };
  };

  // ==================== DESKTOP 1440x900 ====================
  await page.goto(uiBase, { waitUntil: 'domcontentloaded' });
  await page.locator('#home-actions .home-action-row').first().waitFor();

  // U1-02: 侧栏所有导航 SVG 路径互不重复
  const iconAudit = await page.evaluate(() => {
    const mainSvgs = [...document.querySelectorAll('.sidebar nav[aria-label="主导航"] svg.nav-icon')].map(el => el.innerHTML);
    const allSvgs = [...document.querySelectorAll('.sidebar svg.nav-icon')].map(el => el.innerHTML);
    const labels = [...document.querySelectorAll('.sidebar button.nav-item')].map(el => el.textContent?.trim() ?? '');
    return {
      mainCount: mainSvgs.length,
      mainUniqueCount: new Set(mainSvgs).size,
      allCount: allSvgs.length,
      allUniqueCount: new Set(allSvgs).size,
      labels,
    };
  });
  assert.equal(iconAudit.mainCount, 7);
  assert.equal(iconAudit.mainUniqueCount, 7);
  assert.equal(iconAudit.allCount, 8);
  assert.equal(iconAudit.allUniqueCount, 8);
  evidence.desktopChecks.push({ item: 'U1-02', iconAudit });

  // U1-01 (part 1): 首页打开 workflowId -> 顶部面包屑显示 "工作空间 / 更新与综合审阅" -> 点击 "工作空间" 退回工作台
  assert.equal((await page.locator('.breadcrumb').innerText()).replace(/\s+/g, ' ').trim(), '工作空间 / 首页');
  assert.equal(await page.locator('button.breadcrumb-back').count(), 0);
  await page.locator('#home-actions .home-action-row').filter({ hasText: 'UIFIX01 综合测试工作流' }).getByRole('button', { name: '查看工作流', exact: true }).click();
  await page.getByRole('heading', { name: '审阅综合草稿', exact: true }).waitFor();
  const wfBreadcrumb = (await page.locator('.breadcrumb').innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(wfBreadcrumb, '工作空间 / 更新与综合审阅');
  const wfBackBtn = page.locator('button.breadcrumb-back');
  assert.equal((await wfBackBtn.innerText()).trim(), '工作空间');
  await wfBackBtn.click();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  assert.equal((await page.locator('.breadcrumb').innerText()).replace(/\s+/g, ' ').trim(), '工作空间 / 首页');
  evidence.desktopChecks.push({ item: 'U1-01-workflow', wfBreadcrumb });

  // U1-01 (part 2): Automation 收件箱打开草稿 -> 检查真实后端返回视图中的返回按钮文案与返回路径
  await navClick('自动化');
  await page.locator('#news-candidates').waitFor();
  const draftRespPromise = page.waitForResponse(r => r.url().endsWith(`/api/drafts/${draftId}`) && r.request().method() === 'GET');
  await page.locator('#news-candidates').getByRole('button', { name: '审核草稿', exact: true }).click();
  const draftJson = await (await draftRespPromise).json();
  await waitFor('draft heading settled', async () => {
    const h = await page.locator('.draft-page h1').textContent().catch(() => null);
    return Boolean(h && !h.includes('正在读取草稿'));
  });
  const autoDraftHeading = (await page.locator('.draft-page h1').innerText()).trim();
  const autoDraftBreadcrumb = (await page.locator('.breadcrumb').innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(autoDraftBreadcrumb, '工作空间 / AI 知识整理预览');
  const autoDraftBackBtn = page.locator('.draft-page .heading-actions button.secondary-button').first();
  const actualAutoBackLabel = (await autoDraftBackBtn.innerText()).trim();
  const autoDraftHasExpectedLabel = await page.getByRole('button', { name: '返回自动化', exact: true }).count() > 0;
  await autoDraftBackBtn.click();
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();
  await page.locator('#news-candidates').waitFor();
  // Re-open draft from Automation and verify breadcrumb "工作空间" back also keeps Automation context
  await page.locator('#news-candidates').getByRole('button', { name: '审核草稿', exact: true }).click();
  await waitFor('draft heading settled again', async () => {
    const h = await page.locator('.draft-page h1').textContent().catch(() => null);
    return Boolean(h && !h.includes('正在读取草稿'));
  });
  await page.locator('button.breadcrumb-back').click();
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();
  await page.locator('#news-candidates').waitFor();
  evidence.desktopChecks.push({
    item: 'U1-01-automation-draft',
    expectedBackLabel: '返回自动化',
    hasOutcomeDigestFromServer: Boolean(draftJson?.outcomeDigest),
    actualHeading: autoDraftHeading,
    actualBackLabel: actualAutoBackLabel,
    hasExpectedBackLabel: autoDraftHasExpectedLabel,
    backActionReturnedToAutomation: true,
    breadcrumbBackToAutomation: true,
    passed: autoDraftHasExpectedLabel,
  });

  // U1-04: 每日资讯返回工作台、栏目锚点、手动检查更新加载态
  await navClick('首页');
  await page.getByRole('button', { name: '阅读资讯', exact: true }).click();
  await page.getByRole('heading', { name: '每日资讯', exact: true }).waitFor();
  assert.equal((await page.locator('.breadcrumb').innerText()).replace(/\s+/g, ' ').trim(), '工作空间 / 每日资讯');
  const newsBackBtn = page.getByRole('button', { name: '返回工作台', exact: true });
  await newsBackBtn.waitFor();
  const jumpNav = page.locator('nav.news-jump[aria-label="栏目定位"]');
  await jumpNav.waitFor();
  const jumpHrefs = await jumpNav.locator('a').evaluateAll(els => els.map(el => ({ href: el.getAttribute('href'), text: el.textContent })));
  assert.deepEqual(jumpHrefs, [
    { href: '#news-section-fmcg', text: '快消研报与洞察' },
    { href: '#news-section-ai', text: 'AI 前沿' },
  ]);
  await page.locator('#news-section-fmcg').waitFor();
  await page.locator('#news-section-ai').waitFor();
  await jumpNav.locator('a[href="#news-section-ai"]').click();
  assert.equal(await page.evaluate(() => window.location.hash), '#news-section-ai');

  const fmcgSection = page.locator('#news-section-fmcg');
  const aiSection = page.locator('#news-section-ai');

  // Trigger "检查更新" and verify in-flight label "正在检查更新…"
  const makeGate = () => {
    let release, arrived;
    const promise = new Promise(r => { release = r; });
    const arrivedPromise = new Promise(r => { arrived = r; });
    return { promise, release, arrived, arrivedPromise };
  };
  newsCheckGate = makeGate();
  await fmcgSection.getByRole('button', { name: '检查更新', exact: true }).click();
  await newsCheckGate.arrivedPromise;
  const checkingAllBtn = fmcgSection.getByRole('button', { name: '正在检查更新…', exact: true });
  await checkingAllBtn.waitFor();
  assert.equal(await checkingAllBtn.isDisabled(), true);
  assert.equal(await fmcgSection.getByRole('button', { name: '仅补抓失败来源', exact: true }).isDisabled(), true);
  assert.equal(await aiSection.getByRole('button', { name: '检查更新', exact: true }).isDisabled(), false);
  newsCheckGate.release();
  newsCheckGate = null;
  await waitFor('fmcg check all settled', async () => {
    const btn = fmcgSection.getByRole('button', { name: '检查更新', exact: true });
    return (await btn.count()) > 0 && !(await btn.isDisabled());
  });

  // Trigger "仅补抓失败来源" and verify in-flight label "正在补抓失败来源…"
  newsCheckGate = makeGate();
  await fmcgSection.getByRole('button', { name: '仅补抓失败来源', exact: true }).click();
  await newsCheckGate.arrivedPromise;
  const checkingRetryBtn = fmcgSection.getByRole('button', { name: '正在补抓失败来源…', exact: true });
  await checkingRetryBtn.waitFor();
  assert.equal(await checkingRetryBtn.isDisabled(), true);
  assert.equal(await fmcgSection.getByRole('button', { name: '检查更新', exact: true }).isDisabled(), true);
  newsCheckGate.release();
  newsCheckGate = null;
  await waitFor('fmcg retry settled', async () => {
    const btn = fmcgSection.getByRole('button', { name: '仅补抓失败来源', exact: true });
    return (await btn.count()) > 0 && !(await btn.isDisabled());
  });

  await newsBackBtn.click();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  evidence.desktopChecks.push({ item: 'U1-04', jumpHrefs, inFlightLabels: ['正在检查更新…', '正在补抓失败来源…'], backToHome: true });

  // U1-03 (part 1): Raw 多来源综合居中模态框、Escape 关闭与焦点还原 + Raw 删除弹窗 Escape 关闭与焦点还原
  await navClick('Raw 原始资料');
  const synthTrigger = page.getByRole('button', { name: '多来源综合', exact: true });
  await synthTrigger.waitFor();
  await synthTrigger.focus();
  await synthTrigger.click();
  const synthDialog = page.locator('section.synthesis-dialog[role="dialog"][aria-modal="true"]');
  await synthDialog.waitFor();
  assert.equal(await page.locator('.modal-backdrop').count(), 0);
  assert.equal(await page.locator('.confirm-dialog').count(), 0);

  const synthLayout = await page.evaluate(() => {
    const scrim = document.querySelector('.modal-scrim');
    const dialog = document.querySelector('section.synthesis-dialog');
    const scrimStyle = getComputedStyle(scrim);
    const dialogRect = dialog.getBoundingClientRect();
    const scrimRect = scrim.getBoundingClientRect();
    return {
      scrimPosition: scrimStyle.position,
      scrimZIndex: scrimStyle.zIndex,
      scrimRect: { left: scrimRect.left, top: scrimRect.top, width: scrimRect.width, height: scrimRect.height },
      dialogRect: { left: dialogRect.left, top: dialogRect.top, width: dialogRect.width, height: dialogRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      focusInsideDialog: dialog.contains(document.activeElement),
    };
  });
  assert.equal(synthLayout.scrimPosition, 'fixed');
  assert.ok(synthLayout.focusInsideDialog, 'Focus must enter SynthesisDialog');
  const centerX = synthLayout.dialogRect.left + synthLayout.dialogRect.width / 2;
  const centerY = synthLayout.dialogRect.top + synthLayout.dialogRect.height / 2;
  assert.ok(Math.abs(centerX - synthLayout.viewport.width / 2) <= 2, `Expected horizontal centering, got centerX=${centerX}`);
  assert.ok(Math.abs(centerY - synthLayout.viewport.height / 2) <= 2, `Expected vertical centering, got centerY=${centerY}`);
  assert.ok(synthLayout.dialogRect.left >= 0 && synthLayout.dialogRect.left + synthLayout.dialogRect.width <= synthLayout.viewport.width);
  assert.ok(synthLayout.dialogRect.top >= 0 && synthLayout.dialogRect.top + synthLayout.dialogRect.height <= synthLayout.viewport.height);

  // Selecting <2 vs >=2 sources toggles submit button disabled state
  const synthSubmit = synthDialog.getByRole('button', { name: '生成 Synthesis 草稿', exact: true });
  assert.equal(await synthSubmit.isDisabled(), true);
  const synthBoxes = synthDialog.locator('input[type="checkbox"]');
  await synthBoxes.nth(0).check();
  assert.equal(await synthSubmit.isDisabled(), true);
  await synthBoxes.nth(1).check();
  assert.equal(await synthSubmit.isDisabled(), false);

  await page.keyboard.press('Escape');
  await synthDialog.waitFor({ state: 'detached' });
  assert.equal(await synthTrigger.evaluate(el => document.activeElement === el), true, 'Focus must restore to 多来源综合 trigger');

  // Raw DeleteDialog
  await page.locator('.raw-list-item').filter({ hasText: 'UIFIX01 原始资料甲' }).click();
  const rawDeleteTrigger = page.locator('.raw-detail').getByRole('button', { name: '删除', exact: true });
  await rawDeleteTrigger.waitFor();
  await rawDeleteTrigger.focus();
  await rawDeleteTrigger.click();
  const rawDeleteDialog = page.locator('[role="dialog"][aria-labelledby="delete-title"]');
  await rawDeleteDialog.waitFor();
  await rawDeleteDialog.getByRole('button', { name: '确认删除', exact: true }).waitFor();
  assert.equal(await rawDeleteDialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await rawDeleteDialog.waitFor({ state: 'detached' });
  assert.equal(await rawDeleteTrigger.evaluate(el => document.activeElement === el), true, 'Focus must restore to Raw delete trigger');
  evidence.desktopChecks.push({ item: 'U1-03-raw', synthLayout });

  // U1-03 (part 2): Wiki 删除弹窗 Escape 关闭与焦点还原
  await navClick('知识库');
  await page.locator('.wiki-list-item').filter({ hasText: 'UIFIX01 独立概念页' }).click();
  const wikiDeleteTrigger = page.locator('.wiki-detail button.danger-quiet');
  await wikiDeleteTrigger.waitFor();
  await wikiDeleteTrigger.focus();
  await wikiDeleteTrigger.click();
  const wikiDeleteDialog = page.locator('section.delete-dialog[role="dialog"]');
  await wikiDeleteDialog.waitFor();
  assert.equal(await wikiDeleteDialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await wikiDeleteDialog.waitFor({ state: 'detached' });
  assert.equal(await wikiDeleteTrigger.evaluate(el => document.activeElement === el), true, 'Focus must restore to Wiki delete trigger');
  evidence.desktopChecks.push({ item: 'U1-03-wiki', escapeRestoredFocus: true });

  // U1-03 (part 3): Prompt 删除弹窗 Escape 关闭与焦点还原
  await navClick('Prompt 工作台');
  await page.locator('.prompt-list-item').filter({ hasText: 'UIFIX01 测试模板' }).click();
  const promptDeleteTrigger = page.locator('.prompt-detail button.danger-quiet');
  await promptDeleteTrigger.waitFor();
  await promptDeleteTrigger.focus();
  await promptDeleteTrigger.click();
  const promptDeleteDialog = page.locator('section.delete-dialog[aria-labelledby="prompt-delete-title"]');
  await promptDeleteDialog.waitFor();
  assert.equal(await promptDeleteDialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await promptDeleteDialog.waitFor({ state: 'detached' });
  assert.equal(await promptDeleteTrigger.evaluate(el => document.activeElement === el), true, 'Focus must restore to Prompt delete trigger');
  evidence.desktopChecks.push({ item: 'U1-03-prompt', escapeRestoredFocus: true });

  // U1-05: 设置页编辑 Base URL/Model/Key 但未保存时，“测试连接”禁用且显示明确提示
  await navClick('设置');
  const baseUrlInput = page.getByLabel('API Base URL', { exact: true });
  const modelInput = page.getByLabel('模型 ID', { exact: true });
  const keyInput = page.getByLabel('API Key', { exact: true });
  const testConnBtn = page.getByRole('button', { name: '测试连接', exact: true });
  await waitFor('settings enabled', async () => !(await baseUrlInput.isDisabled()));
  assert.equal(await testConnBtn.isDisabled(), false);
  assert.equal(await page.locator('.settings-unsaved-hint').count(), 0);

  // Edit Base URL
  await baseUrlInput.fill('https://uifix01-edited.invalid/v1');
  assert.equal(await testConnBtn.isDisabled(), true);
  assert.equal(
    (await page.locator('.settings-unsaved-hint[role="status"]').innerText()).trim(),
    '有未保存的修改，请先点击「保存配置」后再测试连接。',
  );
  await baseUrlInput.fill('https://uifix01-fake.invalid/v1');
  assert.equal(await page.locator('.settings-unsaved-hint').count(), 0);
  assert.equal(await testConnBtn.isDisabled(), false);

  // Edit API Key
  await keyInput.fill('unsaved-key-draft');
  assert.equal(await testConnBtn.isDisabled(), true);
  assert.equal(
    (await page.locator('.settings-unsaved-hint[role="status"]').innerText()).trim(),
    '有未保存的修改，请先点击「保存配置」后再测试连接。',
  );
  await keyInput.fill('');
  assert.equal(await page.locator('.settings-unsaved-hint').count(), 0);

  // Edit Model ID (leave unsaved for mobile layout check too)
  await modelInput.fill('uifix01-unsaved-model');
  assert.equal(await testConnBtn.isDisabled(), true);
  assert.equal(
    (await page.locator('.settings-unsaved-hint[role="status"]').innerText()).trim(),
    '有未保存的修改，请先点击「保存配置」后再测试连接。',
  );
  evidence.desktopChecks.push({ item: 'U1-05', verifiedFields: ['baseUrl', 'apiKey', 'model'] });

  // ==================== MOBILE 390x844 ====================
  await page.setViewportSize({ width: 390, height: 844 });

  // Settings mobile (with unsaved hint visible)
  await page.locator('.settings-unsaved-hint').waitFor();
  evidence.mobileChecks.push(await measureOverflow('settings'));

  // Home mobile
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  evidence.mobileChecks.push(await measureOverflow('home'));

  // News mobile
  await page.getByRole('button', { name: '阅读资讯', exact: true }).click();
  await page.getByRole('heading', { name: '每日资讯', exact: true }).waitFor();
  await page.locator('#news-section-fmcg').waitFor();
  evidence.mobileChecks.push(await measureOverflow('news'));

  // Raw mobile + SynthesisDialog mobile
  await navClick('Raw 原始资料');
  await page.getByRole('heading', { name: 'Raw 原始资料', exact: true }).waitFor();
  evidence.mobileChecks.push(await measureOverflow('raw'));

  await page.getByRole('button', { name: '多来源综合', exact: true }).click();
  await synthDialog.waitFor();
  const mobileSynthBox = await synthDialog.boundingBox();
  const synthMetrics = await measureOverflow('raw-synthesis-dialog');
  const synthFitsViewport = Boolean(
    mobileSynthBox
    && mobileSynthBox.x >= 0
    && mobileSynthBox.x + mobileSynthBox.width <= 390
    && mobileSynthBox.y >= 0
    && mobileSynthBox.y + mobileSynthBox.height <= 844,
  );
  evidence.mobileChecks.push({
    ...synthMetrics,
    dialogBox: mobileSynthBox,
    dialogFitsViewport: synthFitsViewport,
  });
  await page.keyboard.press('Escape');
  await synthDialog.waitFor({ state: 'detached' });

  const rawExternal = (await readFile(requestLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  evidence.serverExternalRequests = rawExternal;
  assert.equal(evidence.blockedBrowserExternalRequests.length, 0);
  assert.deepEqual(evidence.pageErrors, []);
  const failedDesktop = evidence.desktopChecks.filter(check => check.passed === false);
  const failedMobile = evidence.mobileChecks.filter(check => check.overflow || check.dialogFitsViewport === false);
  assert.equal(
    failedDesktop.length + failedMobile.length,
    0,
    'Real browser acceptance failures: ' + JSON.stringify({ failedDesktop, failedMobile }),
  );
} finally {
  if (browser) {
    await browser.close();
    evidence.closed.browser = true;
  }
  if (ui) {
    await ui.close();
    evidence.closed.ui = true;
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  await exited;
  evidence.closed.api = true;
  evidence.apiLog = apiLog;
  await writeFile(path.join(run, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ run, desktopChecks: evidence.desktopChecks.length, mobileChecks: evidence.mobileChecks.length, pageErrors: evidence.pageErrors, closed: evidence.closed }, null, 2));
}
