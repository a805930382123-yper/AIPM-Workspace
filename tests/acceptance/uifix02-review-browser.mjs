import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
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
import { AuditService } from '../../services/audit/service.ts';
import { NewsRawSave } from '../../services/news/raw-save.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'uifix02-review-'));
const data = path.join(run, 'data');
const envDir = path.join(run, 'empty-env');
const outDir = path.join(run, 'dist');
const config = path.join(run, 'provider.env');
const requestLog = path.join(run, 'external-requests.ndjson');
const preloadFile = path.join(run, 'server-preload.mjs');

const now = new Date();
const stamp = now.toISOString();
const month = stamp.slice(0, 7);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const published = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(+now - 2 * 86400000));

await Promise.all([
  mkdir(envDir, { recursive: true }),
  mkdir(path.join(data, 'drafts', 'knowledge-workflows'), { recursive: true }),
  mkdir(path.join(data, 'state', 'news'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'news-candidates'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'runs', month), { recursive: true }),
]);
await writeFile(requestLog, '');
await writeFile(config, [
  'FMCG_LLM_BASE_URL=https://uifix02-fake.invalid/v1',
  'FMCG_LLM_MODEL=uifix02-synthetic-model',
  'FMCG_LLM_API_KEY=uifix02-synthetic-key-only',
].join('\n') + '\n');

await writeFile(preloadFile, `
import { appendFile } from 'node:fs/promises';
const logFile = process.env.UIFIX02_REQUEST_LOG;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(...args);
  await appendFile(logFile, JSON.stringify({ url: url.href, method: args[1]?.method ?? 'GET' }) + '\\n');
  throw new Error('Blocked unexpected external request in UIFIX02 isolation: ' + url.href);
};
`);

// Seed isolated data stores.
const rawStore = new RawStore(data);
const wikiStore = new WikiStore(data, rawStore);
const promptStore = new PromptStore(data, wikiStore);
const auditService = new AuditService(data, wikiStore, rawStore);
await rawStore.initialize();
await wikiStore.initialize();
await promptStore.initialize();
await auditService.initialize();

const raw1 = await rawStore.create({
  title: 'UIFIX02 原始资料甲',
  body: '快消渠道调研原文甲。用于构造工作流与暂缓草稿。',
  tags: ['渠道'],
  sourceType: 'report',
  sourceName: '测试研报甲',
});
const raw2 = await rawStore.create({
  title: 'UIFIX02 原始资料乙',
  body: '快消渠道调研原文乙。用于构造多来源综合工作流。',
  tags: ['零售'],
  sourceType: 'article',
  sourceName: '测试文章乙',
});

// U2-02: Create an active Wiki page and a deleted Wiki page (with strict timestamp separation).
const activeWiki = await wikiStore.create({
  title: 'UIFIX02 正常保留概念页',
  type: 'concept',
  category: 'industry_basics',
  body: '## 定义\n这是一个保留在正式知识库中的概念页，用于验证正常条目可点击打开且关联 Open Audit。',
  sources: [raw1.id],
  aliases: [],
  tags: ['渠道'],
  knowledge_status: 'source_supported',
  confidence: 'medium',
  source_level: 'B',
  review_status: 'unreviewed',
});
await delay(25);
const deletedWiki = await wikiStore.create({
  title: 'UIFIX02 已删除概念页',
  type: 'concept',
  category: 'industry_basics',
  body: '## 定义\n即将被移至回收区的 Wiki 页面，用于验证首页最近更新禁用态。',
  sources: [raw1.id],
  aliases: [],
  tags: [],
  knowledge_status: 'source_supported',
  confidence: 'low',
  source_level: 'C',
  review_status: 'unreviewed',
});
await delay(25);
await wikiStore.delete(deletedWiki.id, deletedWiki.revision);

// Open Audit for U2-01 (filtered out when clicking "待审核" stat card).
await auditService.create({
  wikiId: activeWiki.id,
  scope: 'page',
  severity: 'suggestion',
  comment: 'UIFIX02 需补充最新渠道渗透率样本说明',
});

// Prompt + Feedback in an earlier period (2026-10-05) to verify PeriodReview refresh loads real period data.
const { prompt: promptRecord } = await promptStore.create(randomUUID(), {
  name: 'UIFIX02 周期反馈测试模板',
  category: 'office',
  scenario: '验证周期回顾切换日期并刷新后加载新周期反馈记录',
  body: '请分析 {{品类}} 的渠道结构变化。',
  inputRequirements: '',
  outputRequirements: '',
  relatedWikiIds: [activeWiki.id],
  examples: '',
  tags: [],
  favorite: false,
});
await promptStore.createFeedback(promptRecord.id, {
  id: randomUUID(),
  promptVersion: promptRecord.version,
  usedOn: '2026-10-05',
  scenario: '2026年10月复盘测试',
  outcome: 'helpful',
  observation: 'UIFIX02 历史周期反馈命中测试观测。',
  nextImprovement: '补充区域下沉数据',
});

// Pending draft + Deferred draft + Pending workflow for U2-01.
const makeDraft = (id, title, raw, opts = {}) => ({
  id,
  rawId: raw.id,
  rawSha256: raw.bodySha256,
  rawTitle: title,
  rawMeta: {
    rawId: raw.id,
    title: raw.title,
    sourceType: raw.sourceType,
    sourceName: raw.sourceName,
    importedAt: raw.importedAt,
  },
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  rulesVersion: 'locator-v2-test',
  provider: { name: 'synthetic', model: 'uifix02-test' },
  jobId: randomUUID(),
  document: { title, main_topic: '渠道样本', summary: '摘要' },
  source: {
    title: raw.title,
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
    title: `${title}-概念`,
    type: 'concept',
    category: 'industry_basics',
    one_line_definition: '测试概念定义',
    source_facts: [{ text: raw.body, evidenceIds: ['e1'] }],
    ai_organized: [],
    ai_inferences: [],
    related_pages: [],
    open_questions: [],
    source_evidence: [{ id: 'e1', rawId: raw.id, quote: raw.body, start: 0, end: raw.body.length, chunkIndex: 0 }],
    knowledge_status: 'source_supported',
    confidence: 'low',
    source_level: 'C',
    selected: true,
    provenance: [{ chunkIndex: 0, start: 0, end: raw.body.length }],
  }],
  warnings: [],
  extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
  ...(opts.deferred ? {
    deferredAt: stamp,
    maintenance: {
      version: 1,
      context: [],
      changes: [{
        changeId: 'chg-1',
        pageIndex: 0,
        action: 'create',
        candidate: {
          title: `${title}-概念`,
          type: 'concept',
          category: 'industry_basics',
          body: '稍后处理概念正文',
          aliases: [],
          tags: [],
          sources: [raw.id],
          knowledge_status: 'source_supported',
          confidence: 'low',
          source_level: 'C',
        },
        reason: '待人工核实',
        summary: ['待确认变更'],
        questions: [],
        dependsOn: [],
        decision: 'defer',
      }],
    },
  } : {}),
});

// Seed candidate-backed pending draft + saved candidate (non-confirmable) with runId for U2-04 & U2-05.
const savedCandItem = {
  id: 'uifix02-cand-saved',
  title: 'UIFIX02 已入库关联运行候选',
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: 'https://example.invalid/uifix02/cand-saved',
  publishedAt: published,
  fetchedAt: stamp,
  excerpt: '已入库并关联运行记录的候选摘录，用于测试非可确认项排除与「查看运行」焦点定位/恢复。',
  evidenceKind: 'article_excerpt',
};
const savedCandRegId = randomUUID();
const savedCandResult = await new NewsRawSave(data, rawStore, () => now).save(today, 'fmcg', savedCandItem, savedCandRegId);
const rawSavedCand = await rawStore.get(savedCandResult.rawId);
assert.ok(rawSavedCand);

const draftPendingId = randomUUID();
const draftPendingObj = makeDraft(draftPendingId, 'UIFIX02 待审核草稿甲', rawSavedCand);
await writeFile(path.join(data, 'drafts', `${draftPendingId}.json`), JSON.stringify(draftPendingObj, null, 2));

const draftDeferredId = randomUUID();
await writeFile(
  path.join(data, 'drafts', `${draftDeferredId}.json`),
  JSON.stringify(makeDraft(draftDeferredId, 'UIFIX02 稍后处理草稿乙', raw2, { deferred: true }), null, 2),
);

const workflowId = randomUUID();
await writeFile(path.join(data, 'drafts', 'knowledge-workflows', `${workflowId}.json`), JSON.stringify({
  id: workflowId,
  kind: 'synthesis',
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  provider: { name: 'synthetic', model: 'uifix02-test' },
  rawSnapshots: [
    { id: raw1.id, title: raw1.title, bodySha256: raw1.bodySha256 },
    { id: raw2.id, title: raw2.title, bodySha256: raw2.bodySha256 },
  ],
  sources: [raw1.id, raw2.id],
  title: 'UIFIX02 待审综合工作流',
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

// Seed Automation Runs (2 history runs + 1 candidate-linked run).
const candRunId = randomUUID();
const histRun1Id = randomUUID();
const histRun2Id = randomUUID();
const runStart1 = new Date(+now - 120_000).toISOString();
const runEnd1 = new Date(+now - 115_000).toISOString();
const runStart2 = new Date(+now - 60_000).toISOString();
const runEnd2 = new Date(+now - 55_000).toISOString();
const runStartCand = new Date(+now - 30_000).toISOString();
const runEndCand = new Date(+now - 25_000).toISOString();

const writeRun = async (runRecord) => {
  const m = runRecord.scheduledAt.slice(0, 7);
  await mkdir(path.join(data, 'state', 'automation', 'runs', m), { recursive: true });
  await writeFile(path.join(data, 'state', 'automation', 'runs', m, `${runRecord.id}.json`), JSON.stringify(runRecord, null, 2));
};

await writeRun({
  id: histRun1Id,
  type: 'system.selfcheck',
  trigger: 'manual',
  scheduledAt: runStart1,
  startedAt: runStart1,
  endedAt: runEnd1,
  status: 'succeeded',
  steps: [{ name: '数据目录检查', status: 'succeeded', startedAt: runStart1, endedAt: runEnd1, durationMs: 18, summary: '隔离目录校验通过' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [], jobIds: [], draftIds: [] },
  budget: null,
});

await writeRun({
  id: histRun2Id,
  type: 'news.daily',
  trigger: 'schedule',
  scheduledAt: runStart2,
  startedAt: runStart2,
  endedAt: runEnd2,
  status: 'failed',
  error: '隔离测试模拟来源失败',
  steps: [{ name: '抓取来源', status: 'failed', startedAt: runStart2, endedAt: runEnd2, durationMs: 42, summary: '来源返回错误', error: '隔离测试模拟来源失败' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  sourceRequests: 1,
  artifacts: { rawIds: [], jobIds: [], draftIds: [] },
  budget: null,
});

await writeRun({
  id: candRunId,
  type: 'pipeline.organize',
  trigger: 'manual',
  scheduledAt: runStartCand,
  startedAt: runStartCand,
  endedAt: runEndCand,
  status: 'succeeded',
  candidateId: `${today}/fmcg/uifix02-cand-saved`,
  steps: [{ name: '保存 Raw', status: 'succeeded', startedAt: runStartCand, endedAt: runEndCand, durationMs: 14, summary: '已保存来源材料' }],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [rawSavedCand.id], jobIds: [], draftIds: [draftPendingId] },
  budget: null,
});

// Seed News Candidates for U2-04 & U2-05.
const makeNewsItem = (itemId, title, excerpt) => ({
  id: itemId,
  title,
  sourceId: 'worldpanel',
  sourceName: 'Worldpanel by Numerator',
  url: `https://example.invalid/uifix02/${itemId}`,
  publishedAt: published,
  fetchedAt: stamp,
  excerpt,
  evidenceKind: 'article_excerpt',
});

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
        id: 'uifix02-fmcg-1',
        title: 'UIFIX02 快消渠道研究示例',
        sourceId: 'worldpanel',
        sourceName: 'Worldpanel by Numerator',
        url: 'https://example.invalid/uifix02/fmcg-1',
        publishedAt: published,
        fetchedAt: stamp,
        excerpt: '隔离测试快消资讯条目，防止首页自动发起外部新闻抓取。',
        evidenceKind: 'article_excerpt',
      }],
      sources: [],
    },
    ai: {
      status: 'source_only',
      attempt: 1,
      startedAt: stamp,
      finishedAt: stamp,
      items: [{
        id: 'uifix02-ai-1',
        title: 'UIFIX02 AI 前沿示例条目',
        sourceId: 'aihot',
        sourceName: 'AIHOT',
        url: 'https://example.invalid/uifix02/ai-1',
        publishedAt: published,
        fetchedAt: stamp,
        excerpt: '隔离测试 AI 资讯条目。',
        evidenceKind: 'source_summary',
      }],
      sources: [],
    },
  },
}, null, 2));

await writeFile(path.join(data, 'state', 'automation', 'news-candidates', `${today}.json`), JSON.stringify({
  schemaVersion: 1,
  date: today,
  items: [
    {
      id: `${today}/fmcg/uifix02-cand-high`,
      section: 'fmcg',
      disposition: 'inbox',
      item: makeNewsItem('uifix02-cand-high', 'UIFIX02 高分可确认候选一', '高分候选一：量贩零食与折扣渠道季度观察。'),
      screening: {
        score: {
          candidateId: `${today}/fmcg/uifix02-cand-high`,
          relevance: 3,
          categories: ['渠道'],
          reason: '与快消渠道高度相关。',
          suggestedMode: 'standard',
        },
      },
    },
    {
      id: `${today}/ai/uifix02-cand-unscreened`,
      section: 'ai',
      disposition: 'inbox',
      item: makeNewsItem('uifix02-cand-unscreened', 'UIFIX02 未预筛可确认候选二', '未预筛候选二：AI 辅助商品洞察实践。'),
    },
    {
      id: `${today}/fmcg/uifix02-cand-saved`,
      section: 'fmcg',
      disposition: 'inbox',
      item: savedCandItem,
      screening: {
        score: {
          candidateId: `${today}/fmcg/uifix02-cand-saved`,
          relevance: 2,
          categories: ['渠道'],
          reason: '已入库非可确认样本。',
          suggestedMode: 'standard',
        },
      },
      confirmation: {
        requestId: randomUUID(),
        registrationId: savedCandRegId,
        grantedAt: stamp,
        organize: true,
        mode: 'standard',
      },
      execution: {
        phase: 'draft_ready',
        runId: candRunId,
        rawId: rawSavedCand.id,
        jobId: draftPendingObj.jobId,
        draftId: draftPendingId,
      },
    },
    {
      id: `${today}/fmcg/uifix02-cand-ignored`,
      section: 'fmcg',
      disposition: 'ignored',
      item: makeNewsItem('uifix02-cand-ignored', 'UIFIX02 已忽略候选四', '已忽略非可确认样本。'),
      screening: {
        score: {
          candidateId: `${today}/fmcg/uifix02-cand-ignored`,
          relevance: 2,
          categories: ['品类'],
          reason: '已忽略条目。',
          suggestedMode: 'standard',
        },
      },
    },
    {
      id: `${today}/fmcg/uifix02-cand-low`,
      section: 'fmcg',
      disposition: 'inbox',
      item: makeNewsItem('uifix02-cand-low', 'UIFIX02 低分折叠候选五', '低分候选五：需展开低相关性折叠区才可见的可确认样本。'),
      screening: {
        score: {
          candidateId: `${today}/fmcg/uifix02-cand-low`,
          relevance: 0,
          categories: ['其他'],
          reason: '相关性较低，默认折叠。',
          suggestedMode: 'standard',
        },
      },
    },
  ],
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
  UIFIX02_REQUEST_LOG: requestLog,
});

const child = spawn(
  process.execPath,
  ['--import', pathToFileURL(preloadFile).href, '--import', 'tsx', 'server/index.ts'],
  { env: withoutInheritedEmbeddings(env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
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
  consoleErrors: [],
  httpErrors: [],
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
  page.on('console', msg => {
    if (msg.type() === 'error') evidence.consoleErrors.push(msg.text());
  });
  page.on('response', res => {
    if (res.status() >= 400) {
      evidence.httpErrors.push({ url: res.url(), status: res.status() });
    }
  });

  const reviewRequests = [];
  page.on('request', req => {
    if (req.url().includes('/api/home/review')) reviewRequests.push(req.url());
  });

  await page.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(`${uiBase}/`)) {
      evidence.blockedBrowserExternalRequests.push(url);
      await route.abort();
      return;
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
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();

  // 1) U2-01: 首页点击底部「待审核」统计卡 -> 筛选视图 & #home-actions 副标题筛选计数 -> 显示全部事项恢复
  const actionsSubheading = page.locator('#home-actions .panel-heading p');
  await waitFor('home actions loaded', async () => {
    const txt = (await actionsSubheading.textContent()) ?? '';
    return txt.includes('当前待处理');
  });
  const initialSubheading = (await actionsSubheading.innerText()).trim();
  assert.equal(initialSubheading, '当前待处理 3 项 · 稍后处理 1 项');
  assert.equal(await page.locator('#home-actions .home-action-row', { hasText: 'UIFIX02 正常保留概念页' }).count(), 1);

  // Also test transitioning from "今日资讯待审草稿" -> clicking bottom "待审核" stat card
  const pipelineDraftBtn = page.locator('button[aria-label^="待审草稿"]');
  await pipelineDraftBtn.click();
  assert.equal((await actionsSubheading.innerText()).trim(), '今日资讯待审草稿');

  const pendingStatCard = page.locator('.stats-grid .stat-card', { hasText: '待审核' });
  await pendingStatCard.click();
  const filteredSubheading = (await actionsSubheading.innerText()).trim();
  assert.equal(filteredSubheading, '当前筛选待审草稿与工作流 2 项（共 4 项） · 稍后处理 1 项');
  assert.equal(await page.locator('#home-actions .home-action-row', { hasText: 'UIFIX02 正常保留概念页' }).count(), 0);

  await page.locator('#home-actions').getByRole('button', { name: '显示全部事项', exact: true }).click();
  const restoredSubheading = (await actionsSubheading.innerText()).trim();
  assert.equal(restoredSubheading, '当前待处理 3 项 · 稍后处理 1 项');
  assert.equal(await page.locator('#home-actions .home-action-row', { hasText: 'UIFIX02 正常保留概念页' }).count(), 1);
  evidence.desktopChecks.push({
    item: 'U2-01',
    initialSubheading,
    filteredSubheading,
    restoredSubheading,
  });

  // 2) U2-02: 首页「最近更新」构造的 Wiki delete 日志呈 disabled、展示「删除 Wiki（已移至回收区）」、强制点击不跳转也不报错
  const recentUpdatePanel = page.locator('.recent-panel', { hasText: '最近更新' });
  const deletedRow = recentUpdatePanel.locator('.recent-row', { hasText: '删除 Wiki' }).filter({ hasText: 'UIFIX02 已删除概念页' });
  await deletedRow.waitFor();
  assert.equal(await deletedRow.isDisabled(), true);
  const deletedRowText = (await deletedRow.innerText()).replace(/\s+/g, ' ').trim();
  assert.match(deletedRowText, /删除 Wiki（已移至回收区）\s*·\s*第 1 版/);
  const deletedStyles = await deletedRow.evaluate(el => ({
    cursor: getComputedStyle(el).cursor,
    opacity: getComputedStyle(el).opacity,
  }));
  assert.equal(deletedStyles.cursor, 'not-allowed');
  await deletedRow.click({ force: true });
  await delay(150);
  // Still on HomePage, no 404 or global error banner
  assert.equal(await page.getByRole('heading', { name: '工作台', exact: true }).count(), 1);
  assert.equal(await page.locator('.global-error').count(), 0);
  assert.equal(evidence.httpErrors.length, 0);

  // Verify normal create entry in recent updates still opens Wiki detail cleanly
  const activeCreateRow = recentUpdatePanel.locator('.recent-row', { hasText: '新建 Wiki' }).filter({ hasText: 'UIFIX02 正常保留概念页' });
  await activeCreateRow.click();
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  evidence.desktopChecks.push({
    item: 'U2-02',
    deletedRowDisabled: true,
    deletedRowText,
    deletedStyles,
    forceClickStayedHome: true,
    normalRowOpenedWiki: true,
  });

  // 3) U2-03: 首页打开「周期回顾」-> 修改日期不空白且不自动发请求 -> start >= end 报错并禁用按钮 -> 合法日期手动刷新加载新数据
  await page.getByRole('button', { name: '周期回顾', exact: true }).click();
  const reviewPanel = page.locator('section.period-review[aria-label="周期回顾"]');
  await reviewPanel.waitFor();
  await waitFor('initial period review loaded', async () => {
    const txt = (await reviewPanel.textContent()) ?? '';
    return txt.includes('覆盖 ') && txt.includes('（不含）');
  });
  const countAfterInitialLoad = reviewRequests.length;
  assert.equal(countAfterInitialLoad, 1);

  const startInput = reviewPanel.locator('input[type="date"]').nth(0);
  const endInput = reviewPanel.locator('input[type="date"]').nth(1);
  const refreshBtn = reviewPanel.getByRole('button', { name: '刷新回顾', exact: true });
  const initialEndVal = await endInput.inputValue();

  // Change start date -> non-blank hint, no automatic request
  await startInput.fill('2026-10-01');
  await delay(100);
  assert.equal(reviewRequests.length, 1, 'Changing date must not auto-request /api/home/review');
  const adjustedHint = (await reviewPanel.locator('.review-status-hint[role="status"]').innerText()).trim();
  assert.equal(adjustedHint, `日期范围已调整为 2026-10-01 至 ${initialEndVal}，请点击「刷新回顾」加载该周期数据。`);
  assert.equal(await refreshBtn.isDisabled(), false);

  // Set start === end -> alert & disabled refresh button
  await startInput.fill(initialEndVal);
  await delay(100);
  assert.equal(reviewRequests.length, 1);
  assert.equal((await reviewPanel.locator('[role="alert"]').innerText()).trim(), '开始日期需早于结束日期。');
  assert.equal(await reviewPanel.locator('.review-status-hint').count(), 0);
  assert.equal(await refreshBtn.isDisabled(), true);

  // Set start > end -> alert & disabled refresh button
  await startInput.fill('2099-12-31');
  await delay(100);
  assert.equal(reviewRequests.length, 1);
  assert.equal((await reviewPanel.locator('[role="alert"]').innerText()).trim(), '开始日期需早于结束日期。');
  assert.equal(await refreshBtn.isDisabled(), true);

  // Restore valid range & click "刷新回顾" -> loads new period including seeded 2026-10-05 feedback
  await startInput.fill('2026-10-01');
  await endInput.fill('2026-10-15');
  assert.equal(await reviewPanel.locator('[role="alert"]').count(), 0);
  const adjustedRangeHint = (await reviewPanel.locator('.review-status-hint[role="status"]').innerText()).trim();
  assert.equal(adjustedRangeHint, '日期范围已调整为 2026-10-01 至 2026-10-15，请点击「刷新回顾」加载该周期数据。');
  assert.equal(await refreshBtn.isDisabled(), false);

  const reviewRefreshResp = page.waitForResponse(r => r.url().includes('/api/home/review') && r.request().method() === 'GET');
  await refreshBtn.click();
  const resp = await reviewRefreshResp;
  assert.equal(resp.status(), 200);
  assert.equal(reviewRequests.length, 2);
  await waitFor('new period review data rendered', async () => {
    const txt = (await reviewPanel.textContent()) ?? '';
    return txt.includes('覆盖 2026-10-01（含）至 2026-10-15（不含）') && txt.includes('UIFIX02 周期反馈测试模板');
  });
  await reviewPanel.getByRole('button', { name: '关闭回顾', exact: true }).click();
  await reviewPanel.waitFor({ state: 'detached' });
  evidence.desktopChecks.push({
    item: 'U2-03',
    adjustedHint,
    adjustedRangeHint,
    requestsAfterDateChanges: 1,
    requestsAfterManualRefresh: reviewRequests.length,
    loadedNewPeriodFeedback: true,
  });

  // 4) & 5) AutomationPage: U2-05 run detail focus/scroll & focus restore + U2-04 select all / deselect all / low fold / batch confirm
  await navClick('自动化');
  await page.getByRole('heading', { name: '自动化', exact: true }).waitFor();
  const inboxSection = page.locator('#news-candidates');
  await inboxSection.waitFor();
  await inboxSection.locator('.candidate-low').waitFor();
  const historySection = page.locator('section[aria-labelledby="automation-history"]');
  await historySection.locator('li button').first().waitFor();

  // U2-05 (a): 运行历史「查看详情」-> 滚动定位并聚焦 #automation-run-detail -> 关闭详情恢复焦点至原按钮
  const historyDetailBtn = historySection.locator('li button', { hasText: '查看详情' }).first();
  await historyDetailBtn.focus();
  await historyDetailBtn.click();
  const detailHeading = page.locator('#automation-run-detail');
  await detailHeading.waitFor();
  const historyFocusIn = await page.evaluate(() => {
    const el = document.getElementById('automation-run-detail');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      activeId: document.activeElement?.id ?? '',
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), vh: window.innerHeight },
    };
  });
  assert.equal(historyFocusIn?.activeId, 'automation-run-detail');
  assert.equal(historyFocusIn?.inViewport, true);

  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await detailHeading.waitFor({ state: 'detached' });
  const historyHandle = await historyDetailBtn.elementHandle();
  const historyFocusRestored = await page.evaluate(el => document.activeElement === el, historyHandle);
  assert.equal(historyFocusRestored, true);

  // U2-05 (b): 资讯收件箱关联运行「查看运行」-> 从页面顶部触发 -> #automation-run-detail 滚动进入视口并聚焦 -> 关闭详情恢复焦点至「查看运行」
  await page.evaluate(() => window.scrollTo(0, 0));
  const viewRunBtn = inboxSection.locator('button', { hasText: '查看运行' }).first();
  await viewRunBtn.focus();
  await viewRunBtn.click();
  await detailHeading.waitFor();
  const candFocusIn = await page.evaluate(() => {
    const el = document.getElementById('automation-run-detail');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      activeId: document.activeElement?.id ?? '',
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), vh: window.innerHeight },
    };
  });
  assert.equal(candFocusIn?.activeId, 'automation-run-detail');
  assert.equal(candFocusIn?.inViewport, true);

  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await detailHeading.waitFor({ state: 'detached' });
  const viewRunHandle = await viewRunBtn.elementHandle();
  const viewRunFocusRestored = await page.evaluate(el => document.activeElement === el, viewRunHandle);
  assert.equal(viewRunFocusRestored, true);
  // U2-05 (c): 任务计划「最近结果」-> 聚焦 #automation-run-detail -> 关闭详情恢复焦点至「最近结果」按钮
  const selfcheckTask = page.locator('article.automation-task[aria-label="工作台自检"]');
  const lastRunBtn = selfcheckTask.locator('dd button').first();
  await lastRunBtn.waitFor();
  await lastRunBtn.focus();
  await lastRunBtn.click();
  await detailHeading.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automation-run-detail');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await detailHeading.waitFor({ state: 'detached' });
  const lastRunHandle = await lastRunBtn.elementHandle();
  const lastRunFocusRestored = await page.evaluate(el => document.activeElement === el, lastRunHandle);
  assert.equal(lastRunFocusRestored, true);

  evidence.desktopChecks.push({
    item: 'U2-05',
    historyFocusIn,
    historyFocusRestored,
    candFocusIn,
    viewRunFocusRestored,
    lastRunFocusRestored,
  });

  // U2-04: 收件箱全选可确认项 / 取消全选 + 低分展开联动 + 批量确认入库（不勾选自动整理，确保无外网与模型调用）
  const filters = inboxSection.locator('.automation-filters');
  const selectAll2Btn = filters.getByRole('button', { name: '全选可确认项（2 条）', exact: true });
  await selectAll2Btn.waitFor();
  assert.equal(await filters.locator('button', { hasText: '批量确认入库' }).count(), 0);

  await selectAll2Btn.click();
  await filters.getByRole('button', { name: '取消全选', exact: true }).waitFor();
  await filters.getByRole('button', { name: '批量确认入库（2 条）', exact: true }).waitFor();
  assert.equal(await inboxSection.getByLabel('选择 UIFIX02 高分可确认候选一', { exact: true }).isChecked(), true);
  assert.equal(await inboxSection.getByLabel('选择 UIFIX02 未预筛可确认候选二', { exact: true }).isChecked(), true);

  // Deselect all
  await filters.getByRole('button', { name: '取消全选', exact: true }).click();
  await filters.getByRole('button', { name: '全选可确认项（2 条）', exact: true }).waitFor();
  assert.equal(await filters.locator('button', { hasText: '批量确认入库' }).count(), 0);
  assert.equal(await inboxSection.getByLabel('选择 UIFIX02 高分可确认候选一', { exact: true }).isChecked(), false);

  // Expand low-relevance fold -> button count becomes 3
  const lowDetails = inboxSection.locator('details.candidate-low');
  const lowSummary = lowDetails.locator('xpath=./summary');
  await lowSummary.click();
  await waitFor('low-score details expanded', () => lowDetails.evaluate(el => el.open));
  const selectAll3Btn = filters.getByRole('button', { name: '全选可确认项（3 条）', exact: true });
  await selectAll3Btn.waitFor();
  await selectAll3Btn.click();
  await filters.getByRole('button', { name: '取消全选', exact: true }).waitFor();
  await filters.getByRole('button', { name: '批量确认入库（3 条）', exact: true }).waitFor();
  assert.equal(await inboxSection.getByLabel('选择 UIFIX02 低分折叠候选五', { exact: true }).isChecked(), true);

  // Collapse low-relevance fold -> batch drops to 2 visible items
  await lowSummary.click();
  await waitFor('low-score details collapsed', async () => !(await lowDetails.evaluate(el => el.open)));
  await filters.getByRole('button', { name: '批量确认入库（2 条）', exact: true }).waitFor();

  // Switch to '已忽略' filter -> no confirmable items -> select-all button hidden, then switch back to 'all'
  const statusSelect = filters.locator('select').nth(1);
  await statusSelect.selectOption('ignored');
  await inboxSection.getByText('UIFIX02 已忽略候选四').waitFor();
  assert.equal(await filters.locator('button', { hasText: '全选' }).count(), 0);
  await statusSelect.selectOption('all');
  await filters.getByRole('button', { name: '全选可确认项（2 条）', exact: true }).waitFor();
  await filters.getByRole('button', { name: '全选可确认项（2 条）', exact: true }).click();

  // Open batch confirmation dialog -> uncheck organize -> submit and verify state refreshes
  await filters.getByRole('button', { name: '批量确认入库（2 条）', exact: true }).click();
  const confirmDialog = page.locator('.candidate-dialog[role="dialog"]');
  await confirmDialog.waitFor();
  assert.equal((await confirmDialog.locator('h2').innerText()).trim(), '确认入库（2 条）');
  const organizeCheckbox = confirmDialog.getByLabel('确认后自动整理', { exact: true });
  await organizeCheckbox.uncheck();
  await confirmDialog.getByRole('button', { name: '确认并入库', exact: true }).click();
  await confirmDialog.waitFor({ state: 'detached' });
  await inboxSection.getByText('入库已排队。可在收件箱查看每条进度。', { exact: true }).waitFor();
  // Wait for background pipeline save (raw-only, no LLM) to settle and confirmableVisible (when collapsed) to drop to 0
  await waitFor('batch saved settled in inbox', async () => {
    const savedBtns = await inboxSection.locator('button', { hasText: '已入库 · 打开 Raw' }).count();
    return savedBtns >= 3;
  });
  // Expand low-score again so mobile test also has an active confirmable candidate button visible
  await lowSummary.click();
  await waitFor('low-score re-expanded', () => lowDetails.evaluate(el => el.open));
  await filters.getByRole('button', { name: '全选可确认项（1 条）', exact: true }).waitFor();
  evidence.desktopChecks.push({
    item: 'U2-04',
    initialCount: 2,
    expandedCount: 3,
    deselectWorked: true,
    batchConfirmOpenedAndSubmitted: true,
    remainingConfirmableAfterBatch: 1,
  });

  // ==================== MOBILE 390x844 ====================
  await page.setViewportSize({ width: 390, height: 844 });

  // Automation mobile: inbox (with 全选可确认项 + 批量确认入库 visible & low expanded) + history + open run detail
  await filters.getByRole('button', { name: '全选可确认项（1 条）', exact: true }).click();
  await filters.getByRole('button', { name: '批量确认入库（1 条）', exact: true }).waitFor();
  evidence.mobileChecks.push(await measureOverflow('automation-inbox-and-history'));

  await historySection.locator('li button', { hasText: '查看详情' }).first().click();
  await detailHeading.waitFor();
  const mobileDetailFocused = await page.evaluate(() => document.activeElement?.id === 'automation-run-detail');
  assert.equal(mobileDetailFocused, true);
  evidence.mobileChecks.push(await measureOverflow('automation-run-detail-open'));
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await detailHeading.waitFor({ state: 'detached' });

  // Home mobile: default + period review open + invalid range + adjusted hint
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  evidence.mobileChecks.push(await measureOverflow('home-default'));

  await page.getByRole('button', { name: '周期回顾', exact: true }).click();
  await reviewPanel.waitFor();
  await waitFor('mobile period review loaded', async () => {
    const txt = (await reviewPanel.textContent()) ?? '';
    return txt.includes('覆盖 ') && txt.includes('（不含）');
  });
  evidence.mobileChecks.push(await measureOverflow('home-period-review-loaded'));

  await reviewPanel.locator('input[type="date"]').nth(0).fill('2026-10-01');
  await reviewPanel.locator('.review-status-hint').waitFor();
  evidence.mobileChecks.push(await measureOverflow('home-period-review-hint'));

  await reviewPanel.locator('input[type="date"]').nth(0).fill('2099-12-31');
  await reviewPanel.locator('[role="alert"]').waitFor();
  evidence.mobileChecks.push(await measureOverflow('home-period-review-error'));

  const rawExternal = (await readFile(requestLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  evidence.serverExternalRequests = rawExternal;

  assert.equal(evidence.blockedBrowserExternalRequests.length, 0);
  assert.equal(evidence.serverExternalRequests.length, 0);
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.consoleErrors, []);
  assert.deepEqual(evidence.httpErrors, []);
  const failedMobile = evidence.mobileChecks.filter(check => check.overflow);
  assert.equal(failedMobile.length, 0, 'Mobile overflow detected: ' + JSON.stringify(failedMobile));
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
  console.log(JSON.stringify({
    run,
    apiPort,
    uiPort,
    browserVersion: evidence.browserVersion,
    desktopChecks: evidence.desktopChecks,
    mobileChecks: evidence.mobileChecks.map(c => ({ page: c.page, innerWidth: c.innerWidth, scrollWidth: c.scrollWidth, overflow: c.overflow })),
    pageErrors: evidence.pageErrors,
    consoleErrors: evidence.consoleErrors,
    httpErrors: evidence.httpErrors,
    blockedBrowserExternalRequests: evidence.blockedBrowserExternalRequests,
    serverExternalRequests: evidence.serverExternalRequests,
    closed: evidence.closed,
  }, null, 2));
}
