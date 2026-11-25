import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
import { RawStateStore } from '../../services/raw/state.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { PromptStore } from '../../services/prompt/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { questionHash } from '../../services/wiki/question-input.ts';
import { WorkItemStore } from '../../services/work-items/store.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'uifix03-review-'));
const data = path.join(run, 'data');
const envDir = path.join(run, 'empty-env');
const outDir = path.join(run, 'dist');
const config = path.join(run, 'provider.env');
const requestLog = path.join(run, 'external-requests.ndjson');
const preloadFile = path.join(run, 'server-preload.mjs');

const now = new Date();
const stamp = now.toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const published = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(+now - 2 * 86400000));

await Promise.all([
  mkdir(envDir, { recursive: true }),
  mkdir(path.join(data, 'state', 'extraction-jobs'), { recursive: true }),
  mkdir(path.join(data, 'state', 'knowledge-answers'), { recursive: true }),
  mkdir(path.join(data, 'state', 'news'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'news-candidates'), { recursive: true }),
]);
await writeFile(requestLog, '');
await writeFile(config, [
  'FMCG_LLM_BASE_URL=https://uifix03-fake.invalid/v1',
  'FMCG_LLM_MODEL=uifix03-synthetic-model',
  'FMCG_LLM_API_KEY=uifix03-synthetic-key-only',
].join('\n') + '\n');

await writeFile(preloadFile, `
import { appendFile } from 'node:fs/promises';
const logFile = process.env.UIFIX03_REQUEST_LOG;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(...args);
  await appendFile(logFile, JSON.stringify({ url: url.href, method: args[1]?.method ?? 'GET' }) + '\\n');
  throw new Error('Blocked unexpected external request in UIFIX03 isolation: ' + url.href);
};
`);

// Seed isolated stores using real product modules.
const rawStore = new RawStore(data);
const rawStateStore = new RawStateStore(data);
const wikiStore = new WikiStore(data, rawStore);
const promptStore = new PromptStore(data, wikiStore);
const draftStore = new DraftStore(data);
const workItemStore = new WorkItemStore(data, rawStore);

await rawStore.initialize();
await rawStateStore.initialize();
await wikiStore.initialize();
await promptStore.initialize();
await draftStore.initialize();

const seededRaws = [];
for (let i = 1; i <= 10; i += 1) {
  const spec = i === 1
    ? { title: 'UIFIX03 华东渠道调研样本', body: '华东KA门店月度动销增长15%，冰饮复购率稳定。', tags: ['渠道', 'FMCG'], sourceType: 'report', sourceName: '尼尔森周报' }
    : i === 2
      ? { title: 'UIFIX03 待审目标便利店观察', body: '便利店冷饮与即饮咖啡陈列对比，夜间消费占比提高。', tags: ['便利店', '冷链'], sourceType: 'article', sourceName: '行业观察站' }
      : i === 3
        ? { title: 'UIFIX03 已入库品牌白皮书', body: '快消品牌下沉市场铺货与经销商激励方案梳理。', tags: ['下沉市场'], sourceType: 'company', sourceName: '公司内部资料' }
        : i === 4
          ? { title: 'UIFIX03 失败状态测试资料', body: '待重试提取的经销商库存周转记录。', tags: ['库存'], sourceType: 'note', sourceName: '个人整理' }
          : { title: `UIFIX03 列表滚动填充样本 ${String(i).padStart(2, '0')}`, body: `用于测试左栏独立滚动高度上限的填充原始资料第 ${i} 条。`, tags: ['样本'], sourceType: 'wechat', sourceName: `公众号样本${i}` };
  const raw = await rawStore.create(spec);
  seededRaws.push(raw);
}
const [rawSelected, rawPending, rawGenerated, rawFailed] = seededRaws;

// Seed Wiki page backed by rawGenerated so Q&A draft citations & generated Raw state are 100% consistent.
const baseWiki = await wikiStore.create({
  title: 'UIFIX03 华东渠道基准页',
  type: 'concept',
  category: 'channel',
  body: '## 定义\n华东KA门店月度动销持续提升，冷链SKU复购保持稳健。',
  sources: [rawGenerated.id],
  aliases: [],
  tags: ['渠道'],
  knowledge_status: 'source_supported',
  confidence: 'medium',
  source_level: 'B',
  review_status: 'unreviewed',
});

// Seed Raw states: pending_confirmation (with completed job + draft), generated, failed, processing (without active jobId).
const outcomeDraftId = randomUUID();
const outcomeJobId = randomUUID();
await rawStateStore.set(rawPending.id, { status: 'pending_confirmation', reason: '草稿已生成', jobId: outcomeJobId, draftId: outcomeDraftId });
await rawStateStore.set(rawGenerated.id, { status: 'generated', reason: '已确认入库', generatedWikiIds: [baseWiki.id] });
await rawStateStore.set(rawFailed.id, {
  status: 'failed',
  reason: '模拟解析失败',
  lastError: { code: 'LLM_TIMEOUT', message: '隔离测试模拟超时', at: stamp, retryable: true },
});
await rawStateStore.set(seededRaws[4].id, { status: 'processing', reason: '上次保存的处理中状态' });

await writeFile(path.join(data, 'state', 'extraction-jobs', `${outcomeJobId}.json`), JSON.stringify({
  id: outcomeJobId,
  rawId: rawPending.id,
  status: 'completed',
  stage: 'done',
  chunksTotal: 1,
  chunksDone: 1,
  pagesFound: 3,
  draftId: outcomeDraftId,
  provider: { name: 'synthetic', model: 'uifix03-test' },
  cancelRequested: false,
  callCount: 1,
  startedAt: stamp,
  updatedAt: stamp,
  finishedAt: stamp,
}, null, 2));

// Seed RawOutcomeReview draft (3 pages: 2 selectable, 1 marked reviewDecision='update' so non-selectable).
const makeDraftPage = (title, reviewDecision, updateTargetWikiId) => ({
  pageId: randomUUID(),
  title,
  type: 'concept',
  category: 'channel',
  one_line_definition: `${title}一句话说明`,
  source_facts: [{ text: rawPending.body, evidenceIds: ['e1'] }],
  ai_organized: [`${title}：整理要点与渠道表现说明。`],
  ai_inferences: [],
  related_pages: [],
  open_questions: [],
  source_evidence: [{ id: 'e1', rawId: rawPending.id, quote: rawPending.body, start: 0, end: rawPending.body.length, chunkIndex: 0 }],
  knowledge_status: 'source_supported',
  confidence: 'medium',
  source_level: 'B',
  selected: false,
  ...(reviewDecision ? { reviewDecision } : {}),
  ...(updateTargetWikiId ? { updateTargetWikiId } : {}),
  provenance: [{ chunkIndex: 0, start: 0, end: rawPending.body.length }],
});
await writeFile(path.join(data, 'drafts', `${outcomeDraftId}.json`), JSON.stringify({
  id: outcomeDraftId,
  rawId: rawPending.id,
  rawSha256: rawPending.bodySha256,
  rawTitle: rawPending.title,
  rawMeta: {
    rawId: rawPending.id,
    title: rawPending.title,
    sourceType: rawPending.sourceType,
    sourceName: rawPending.sourceName,
    importedAt: rawPending.importedAt,
  },
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  rulesVersion: 'locator-v2-test',
  provider: { name: 'synthetic', model: 'uifix03-test' },
  jobId: outcomeJobId,
  document: { title: rawPending.title, main_topic: '便利店冷饮与咖啡陈列', summary: '便利店渠道整理摘要' },
  source: {
    title: rawPending.title,
    category: 'channel',
    summary: '便利店陈列与夜间消费趋势整理',
    key_takeaways: ['便利店夜间冷饮消费增长'],
    body: '来源笔记正文。',
    knowledge_status: 'source_supported',
    confidence: 'medium',
    source_level: 'B',
  },
  pages: [
    makeDraftPage('UIFIX03 可选主题甲'),
    makeDraftPage('UIFIX03 可选主题乙'),
    makeDraftPage('UIFIX03 已标更新主题丙', 'update', baseWiki.id),
  ],
  warnings: [],
  extraction: { callCount: 1, chunkCount: 1, pagesFound: 3 },
}, null, 2));

// Seed QuestionAnswer + QuestionDraftRecord for KnowledgeMaintenanceReview (without outcomeDigest).
const answerId = randomUUID();
const qaDraftId = randomUUID();
const wikiBodySha = createHash('sha256').update(baseWiki.body).digest('hex');
const qaCitations = [{
  id: 'cit-1',
  kind: 'wiki',
  recordId: baseWiki.id,
  title: baseWiki.title,
  revision: baseWiki.revision,
  bodySha256: wikiBodySha,
  start: 0,
  end: baseWiki.body.length,
  quote: baseWiki.body,
  rawIds: [rawGenerated.id],
  manualWikiIds: [],
}];
const qaSections = [{
  id: 'section-0',
  kind: 'fact',
  text: '华东KA门店月度动销持续提升，冷链SKU复购稳健。',
  citationIds: ['cit-1'],
}];
const qaQuestion = '华东KA门店冷链复购与动销情况如何？';
const qaAnswerBase = {
  version: 1,
  id: answerId,
  revision: 1,
  question: qaQuestion,
  status: 'completed',
  stage: 'completed',
  createdAt: stamp,
  updatedAt: stamp,
  provider: { name: 'synthetic', model: 'uifix03-test' },
  attempts: 1,
  candidateWikiIds: [baseWiki.id],
  readWiki: [baseWiki],
  readRaw: [],
  rawSnapshots: [{ id: rawGenerated.id, bodySha256: rawGenerated.bodySha256 }],
  sections: qaSections,
  citations: qaCitations,
  usedWikiIds: [baseWiki.id],
  usedRawIds: [],
  independentRawIds: [rawGenerated.id],
  manualWikiIds: [],
  draftId: qaDraftId,
};
const qaAnswerDigest = questionHash({
  question: qaAnswerBase.question,
  sections: qaAnswerBase.sections,
  citations: qaAnswerBase.citations,
  readWiki: qaAnswerBase.readWiki,
  readRaw: qaAnswerBase.readRaw,
});
const qaPreview = {
  title: '问答整理：华东冷链动销复盘',
  conclusion: '华东KA门店月度动销持续提升，冷链SKU复购稳健。',
  inferences: '',
  tags: ['渠道'],
  selectedSectionIds: ['section-0'],
  selectedText: '华东KA门店月度动销持续提升，冷链SKU复购稳健。',
  citationIds: ['cit-1'],
};
const qaInput = {
  kind: 'question_answer',
  resultId: answerId,
  resultRevision: 1,
  question: qaQuestion,
  answerDigest: qaAnswerDigest,
  preview: qaPreview,
  wikiSnapshots: [baseWiki],
  rawSnapshots: [{ id: rawGenerated.id, bodySha256: rawGenerated.bodySha256 }],
  citations: qaCitations,
  sections: qaSections,
};
await writeFile(path.join(data, 'state', 'knowledge-answers', `${answerId}.json`), JSON.stringify({
  ...qaAnswerBase,
  saves: [{
    key: 'uifix03-qa-save-key',
    digest: questionHash({ resultRevision: 1, preview: qaPreview }),
    attempts: 1,
    status: 'draft',
    input: qaInput,
    draftId: qaDraftId,
  }],
}, null, 2));

await draftStore.createQuestion({
  id: qaDraftId,
  input: qaInput,
  maintenance: {
    version: 1,
    context: [],
    changes: [
      {
        changeId: 'chg-1',
        pageIndex: 0,
        action: 'create',
        candidate: {
          title: 'UIFIX03 问答派生主题主项',
          type: 'concept',
          category: 'channel',
          body: '## 定义\n依赖基础项成立后的华东KA冷链复购总结。',
          aliases: [],
          tags: ['渠道'],
          sources: [rawGenerated.id],
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'B',
        },
        reason: '沉淀华东冷链复购洞察',
        summary: ['新增主洞察页（依赖基础指标项）'],
        questions: [],
        dependsOn: ['chg-2'],
        decision: 'defer',
      },
      {
        changeId: 'chg-2',
        pageIndex: 1,
        action: 'create',
        candidate: {
          title: 'UIFIX03 问答派生基础指标项',
          type: 'metric',
          category: 'metric',
          body: '## 定义\n冷链SKU复购率口径与基础观察。',
          aliases: [],
          tags: ['指标'],
          sources: [rawGenerated.id],
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'B',
        },
        reason: '先沉淀复购基础口径',
        summary: ['新增基础指标页'],
        questions: [],
        dependsOn: [],
        decision: 'defer',
      },
    ],
  },
  provider: { name: 'synthetic', model: 'uifix03-test' },
  callCount: 1,
});

// Seed WorkItems (2 customer_issue + 2 product_analysis, active + closed).
const wiCustActive = await workItemStore.create({
  title: 'UIFIX03 华东门店开票异常',
  feedback: '部分华东门店反映本月专票抬头与系统不一致，需要财务核对。',
});
const wiCustClosed = await workItemStore.create({
  title: 'UIFIX03 华南物流延迟已解决',
  feedback: '冷链干线周二到货延迟 4 小时。',
});
await workItemStore.update(wiCustClosed.id, {
  baseRevision: wiCustClosed.revision,
  status: 'closed',
  closureReason: '已调整调度班次并确认恢复准点。',
});
const wiProdActive = await workItemStore.create({
  kind: 'product_analysis',
  title: 'UIFIX03 新品铺货率分析',
  goal: '评估Q4华东新品在KA与便利店渠道的铺货率差异。',
});
const wiProdClosed = await workItemStore.create({
  kind: 'product_analysis',
  title: 'UIFIX03 渠道毛利结构复盘',
  goal: '复盘便利店渠道高毛利单品结构变化。',
});
await workItemStore.update(wiProdClosed.id, {
  baseRevision: wiProdClosed.revision,
  status: 'closed',
  closureReason: '阶段复盘已完成归档。',
});

// Prevent HomePage from attempting external news fetch.
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
        id: 'uifix03-fmcg-1',
        title: 'UIFIX03 快消渠道示例研报',
        sourceId: 'worldpanel',
        sourceName: 'Worldpanel by Numerator',
        url: 'https://example.invalid/uifix03/fmcg-1',
        publishedAt: published,
        fetchedAt: stamp,
        excerpt: '隔离测试快消资讯条目，防止首页自动发起外部请求。',
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
        id: 'uifix03-ai-1',
        title: 'UIFIX03 AI 前沿示例条目',
        sourceId: 'aihot',
        sourceName: 'AIHOT',
        url: 'https://example.invalid/uifix03/ai-1',
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
  items: [],
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
  UIFIX03_REQUEST_LOG: requestLog,
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

  // -------------------- 1) U3-01: RawPage list search, status filter, empty state, reset, scroll cap, selected preserved --------------------
  await navClick('Raw 原始资料');
  await page.getByRole('heading', { name: 'Raw 原始资料', exact: true }).waitFor();
  const rawPanel = page.locator('.raw-list-panel');
  const rawCountEl = rawPanel.locator('.list-title span');
  await waitFor('10 raws loaded', async () => (await rawCountEl.textContent()) === '10 条');

  // Verify independent scroll container cap & actual scroll overflow
  const rawListMetrics = await rawPanel.locator('> .raw-list').evaluate(el => {
    const st = getComputedStyle(el);
    return {
      maxHeight: st.maxHeight,
      overflowY: st.overflowY,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    };
  });
  assert.equal(rawListMetrics.maxHeight, '680px');
  assert.equal(rawListMetrics.overflowY, 'auto');
  assert.ok(rawListMetrics.clientHeight <= 680, `Expected clientHeight <= 680, got ${rawListMetrics.clientHeight}`);
  assert.ok(rawListMetrics.scrollHeight > rawListMetrics.clientHeight, 'Expected 10 items to exceed 680px list height');

  // Select rawSelected first so we can verify selected detail remains intact while filtered out of left list
  await rawPanel.locator('.raw-list-item', { hasText: 'UIFIX03 华东渠道调研样本' }).click();
  assert.equal((await page.locator('.raw-detail h2').textContent())?.trim(), 'UIFIX03 华东渠道调研样本');

  const rawSearch = rawPanel.getByLabel('搜索原始资料', { exact: true });
  const rawStatusSelect = rawPanel.getByLabel('筛选资料处理状态', { exact: true });

  // Search matching another item ("待审目标") -> left list filters to 1 / 10, right detail preserves rawSelected
  await rawSearch.fill('待审目标');
  assert.equal((await rawCountEl.textContent())?.trim(), '1 / 10 条');
  assert.equal(await rawPanel.locator('.raw-list-item').count(), 1);
  assert.equal((await page.locator('.raw-detail h2').textContent())?.trim(), 'UIFIX03 华东渠道调研样本');
  await rawPanel.getByRole('button', { name: '重置筛选', exact: true }).waitFor();

  // Clear search + filter by status pending_confirmation & unprocessed
  await rawSearch.fill('');
  await rawStatusSelect.selectOption('pending_confirmation');
  assert.equal((await rawCountEl.textContent())?.trim(), '1 / 10 条');
  assert.equal(await rawPanel.locator('.raw-list-item', { hasText: 'UIFIX03 待审目标便利店观察' }).count(), 1);

  await rawStatusSelect.selectOption('unprocessed');
  assert.equal((await rawCountEl.textContent())?.trim(), '6 / 10 条');

  // Search non-existent -> empty state & no .raw-list, right detail still preserved
  await rawSearch.fill('绝不存在的测试关键词XYZ');
  assert.equal((await rawCountEl.textContent())?.trim(), '0 / 10 条');
  assert.equal(await rawPanel.locator('.raw-list').count(), 0);
  assert.equal((await rawPanel.locator('.raw-filter-empty[role="status"]').textContent())?.trim(), '没有匹配的原始资料。');
  assert.equal((await page.locator('.raw-detail h2').textContent())?.trim(), 'UIFIX03 华东渠道调研样本');

  // Reset filters
  await rawPanel.getByRole('button', { name: '重置筛选', exact: true }).click();
  assert.equal((await rawCountEl.textContent())?.trim(), '10 条');
  assert.equal(await rawPanel.locator('.raw-list-item').count(), 10);
  assert.equal(await rawPanel.getByRole('button', { name: '重置筛选', exact: true }).count(), 0);

  evidence.desktopChecks.push({ item: 'U3-01', rawListMetrics, selectedPreservedAcrossFilterAndEmpty: true, resetWorked: true });

  // -------------------- 2) U3-02: ImportDialog 3 tabs, URL hides body/file, preserves URL on return & submits paste --------------------
  await page.locator('.raw-heading').getByRole('button', { name: '导入资料' }).click();
  const importDialog = page.locator('.import-dialog[role="dialog"]');
  await importDialog.waitFor();
  const tabs = importDialog.locator('[role="tab"]');
  assert.equal(await tabs.count(), 3);
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
  assert.equal(await importDialog.locator('.body-field').count(), 1);
  assert.equal(await importDialog.locator('.file-picker').count(), 0);

  // Switch to 上传文件 and pick a temporary buffer file
  await tabs.nth(1).click();
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  assert.equal(await importDialog.locator('.file-picker').count(), 1);
  assert.equal(await importDialog.locator('.body-field').count(), 0);
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: 'u302-sample.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('U3-02 文件切换清理测试内容', 'utf8'),
  });
  await importDialog.locator('.file-picked', { hasText: 'u302-sample.txt' }).waitFor();

  // Switch to 网页链接 -> hides body & file picker, clears picked file, marks URL required, shows translate checkbox & primary URL button
  await tabs.nth(2).click();
  assert.equal(await tabs.nth(2).getAttribute('aria-selected'), 'true');
  assert.equal(await importDialog.locator('.body-field').count(), 0);
  assert.equal(await importDialog.locator('.file-picker').count(), 0);
  assert.equal(await importDialog.locator('.file-picked').count(), 0);

  const urlInput = importDialog.locator('input[type="url"]');
  const urlFieldProps = await urlInput.evaluate(el => ({
    required: el.required,
    placeholder: el.placeholder,
    labelText: el.closest('label')?.textContent ?? '',
  }));
  assert.equal(urlFieldProps.required, true);
  assert.equal(urlFieldProps.placeholder, 'https://…');
  assert.match(urlFieldProps.labelText, /原始链接 \*/);
  assert.equal(await importDialog.locator('.raw-translate-choice input[type="checkbox"]').isVisible(), true);
  assert.equal(await importDialog.getByRole('button', { name: '从网页导入 Raw', exact: true }).isVisible(), true);
  assert.equal(await importDialog.getByRole('button', { name: '保存并生成 Wiki 草稿', exact: true }).count(), 0);

  // Fill URL -> switch back to 粘贴文本 -> URL preserved & body field restored
  await urlInput.fill('https://uifix03-fixture.invalid/article');
  await tabs.nth(0).click();
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
  assert.equal(await urlInput.inputValue(), 'https://uifix03-fixture.invalid/article');
  assert.equal(await urlInput.evaluate(el => el.required), false);
  assert.equal(await urlInput.evaluate(el => el.placeholder), 'https://…（可选）');
  await importDialog.locator('.body-field textarea').waitFor();

  // Submit actual paste Raw via ImportDialog
  await importDialog.locator('input[data-autofocus]').fill('UIFIX03 浏览器导入测试资料');
  await importDialog.locator('label.field', { hasText: '来源名称' }).locator('input').fill('独立验收手记');
  await importDialog.locator('.body-field textarea').fill('这是 U3-02 从网页切回粘贴文本后实际保存的测试正文。');
  const saveRawBtn = importDialog.getByRole('button', { name: '仅保存 Raw', exact: true });
  await saveRawBtn.waitFor();
  const createRawRespPromise = page.waitForResponse(r => r.url().endsWith('/api/raw') && r.request().method() === 'POST');
  await saveRawBtn.click();
  const createRawResp = await createRawRespPromise;
  assert.equal(createRawResp.status(), 201);
  await importDialog.waitFor({ state: 'detached' });
  await waitFor('11 raws after import', async () => (await rawCountEl.textContent()) === '11 条');
  assert.equal((await page.locator('.raw-detail h2').textContent())?.trim(), 'UIFIX03 浏览器导入测试资料');

  evidence.desktopChecks.push({ item: 'U3-02', urlFieldProps, urlPreservedAcrossTabSwitch: true, importedRawSavedAndListed: true });

  // -------------------- 3) U3-03a: RawOutcomeReview sticky confirm, 2-col heading span, select-all / deselect-all --------------------
  await rawPanel.locator('.raw-list-item', { hasText: 'UIFIX03 待审目标便利店观察' }).click();
  await page.locator('.raw-detail').getByRole('button', { name: '继续审核', exact: true }).click();
  await page.getByRole('heading', { name: '整理成果', exact: true }).waitFor();

  const confirmSection = page.locator('.draft-page .outcome-confirm');
  await confirmSection.waitFor();
  const outcomeStickyStyles = await confirmSection.evaluate(el => {
    const st = getComputedStyle(el);
    return { position: st.position, top: st.top, padding: st.padding, boxShadow: st.boxShadow };
  });
  assert.equal(outcomeStickyStyles.position, 'sticky');
  assert.equal(outcomeStickyStyles.top, '8px');
  assert.equal(outcomeStickyStyles.padding, '12px 16px');
  assert.notEqual(outcomeStickyStyles.boxShadow, 'none');

  // Check .outcome-cards > div:first-child spans full 2-column width
  const outcomeHeadingLayout = await page.locator('section.outcome-cards').evaluate(section => {
    const first = section.firstElementChild;
    const card = section.querySelector('.outcome-card');
    if (!first || !card) return null;
    const sr = section.getBoundingClientRect();
    const fr = first.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      firstHasHeadingClass: first.classList.contains('outcome-cards-heading'),
      sectionWidth: Math.round(sr.width),
      headingWidth: Math.round(fr.width),
      singleCardWidth: Math.round(cr.width),
      spansFullColumns: fr.width > cr.width * 1.5 && Math.abs(sr.width - fr.width) <= 4,
    };
  });
  assert.equal(outcomeHeadingLayout?.firstHasHeadingClass, true);
  assert.equal(outcomeHeadingLayout?.spansFullColumns, true);

  const selectAllTopicsBtn = page.locator('section.outcome-cards .outcome-cards-heading button');
  assert.equal((await selectAllTopicsBtn.textContent())?.trim(), '全选可选主题（2 项）');
  const submitOutcomeBtn = confirmSection.locator('.primary-button');
  assert.equal(await submitOutcomeBtn.isDisabled(), true);

  await selectAllTopicsBtn.click();
  assert.equal((await selectAllTopicsBtn.textContent())?.trim(), '取消全选主题');
  assert.equal((await submitOutcomeBtn.textContent())?.trim(), '确认所选成果入库（2）');
  assert.equal(await submitOutcomeBtn.isDisabled(), false);
  assert.equal(await page.getByLabel('选择入库 UIFIX03 可选主题甲', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('选择入库 UIFIX03 可选主题乙', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('选择入库 UIFIX03 已标更新主题丙', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('选择入库 UIFIX03 已标更新主题丙', { exact: true }).isChecked(), false);

  await selectAllTopicsBtn.click();
  assert.equal((await selectAllTopicsBtn.textContent())?.trim(), '全选可选主题（2 项）');
  assert.equal(await submitOutcomeBtn.isDisabled(), true);
  assert.equal(await page.getByLabel('选择入库 UIFIX03 可选主题甲', { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('选择入库 UIFIX03 可选主题乙', { exact: true }).isChecked(), false);

  await page.locator('.draft-page .page-heading').getByRole('button', { name: '返回 Raw', exact: true }).click();
  await page.getByRole('heading', { name: 'Raw 原始资料', exact: true }).waitFor();

  evidence.desktopChecks.push({ item: 'U3-03a', outcomeStickyStyles, outcomeHeadingLayout, selectAllAndDeselectVerified: true });

  // -------------------- 4) U3-03b: KnowledgeMaintenanceReview gateHint branches & unlock --------------------
  await navClick('知识库');
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  await page.getByRole('tab', { name: '向知识库提问', exact: true }).click();
  await page.getByRole('button', { name: '查看对应草稿', exact: true }).click();
  await page.getByRole('heading', { name: '审核知识变更', exact: true }).waitFor();

  const gateHintEl = page.locator('.maintenance-gate-hint');
  const confirmMaintBtn = page.locator('.draft-page .page-heading .primary-button');

  // State 1: 0 accepted -> gateHint asks to accept at least 1 change
  await gateHintEl.waitFor();
  assert.equal((await gateHintEl.textContent())?.trim(), '请至少接受 1 项知识变更后再确认写入。');
  assert.equal(await confirmMaintBtn.isDisabled(), true);

  // State 2: unresolved > 0 -> gateHint hides to avoid duplicating unresolved alert
  const assignSelect = page.getByLabel('归属 reference-0', { exact: true });
  await page.locator('details summary', { hasText: '来源事实与问题归属' }).click();
  await assignSelect.selectOption('');
  await page.locator('[role="alert"]', { hasText: '来源事实或问题未归属' }).waitFor();
  assert.equal(await gateHintEl.count(), 0);
  assert.equal(await confirmMaintBtn.isDisabled(), true);

  // Restore assignment -> gateHint returns
  await assignSelect.selectOption({ index: 1 });
  await gateHintEl.waitFor();
  assert.equal((await gateHintEl.textContent())?.trim(), '请至少接受 1 项知识变更后再确认写入。');

  // State 3: accept chg-1 (which dependsOn chg-2) -> missingDeps gateHint
  const card1 = page.locator('section#chg-1');
  const card2 = page.locator('section#chg-2');
  await card1.getByRole('button', { name: '接受此项', exact: true }).click();
  await waitFor('missingDeps hint', async () => ((await gateHintEl.textContent()) ?? '').includes('依赖项'));
  assert.equal((await gateHintEl.textContent())?.trim(), '已接受变更存在未一并接受的依赖项，请先接受对应依赖项。');
  assert.equal(await confirmMaintBtn.isDisabled(), true);

  // State 4: accept chg-2 -> 2 unapproved accepted items
  await card2.getByRole('button', { name: '接受此项', exact: true }).click();
  await waitFor('2 unapproved hint', async () => ((await gateHintEl.textContent()) ?? '').includes('尚有 2 项'));
  assert.equal((await gateHintEl.textContent())?.trim(), '尚有 2 项已接受变更未勾选底部「我已核对」复选框。');
  assert.equal(await confirmMaintBtn.isDisabled(), true);

  // State 5: approve chg-1 -> 1 unapproved
  await card1.locator('input[type="checkbox"]').click();
  await waitFor('chg-1 approved and 1 unapproved hint', async () => (await card1.locator('input[type="checkbox"]').isChecked()) && ((await gateHintEl.textContent()) ?? '').includes('尚有 1 项'));
  assert.equal((await gateHintEl.textContent())?.trim(), '尚有 1 项已接受变更未勾选底部「我已核对」复选框。');

  // State 6: edit chg-2 candidate body -> editingCount hint takes priority
  await card2.getByRole('button', { name: '编辑候选正文', exact: true }).click();
  await waitFor('editing hint', async () => ((await gateHintEl.textContent()) ?? '').includes('正在编辑中'));
  assert.equal((await gateHintEl.textContent())?.trim(), '有 1 项候选正文正在编辑中，请先保存编辑并重新审核。');
  assert.equal(await confirmMaintBtn.isDisabled(), true);
  await card2.getByRole('button', { name: '保存编辑并重新审核', exact: true }).click();
  await waitFor('back to 1 unapproved hint', async () => ((await gateHintEl.textContent()) ?? '').includes('尚有 1 项'));

  // State 7: approve chg-2 -> gateHint disappears & button unlocks!
  await card2.locator('input[type="checkbox"]').click();
  await waitFor('gateHint cleared and confirm unlocked', async () => (await gateHintEl.count()) === 0 && !(await confirmMaintBtn.isDisabled()));

  // Confirm write to Wiki on real backend!
  const confirmMaintResp = page.waitForResponse(r => r.url().includes(`/api/drafts/${qaDraftId}/confirm`) && r.request().method() === 'POST');
  await confirmMaintBtn.click();
  const maintRes = await confirmMaintResp;
  assert.ok([200, 201].includes(maintRes.status()), `Expected 200/201 on confirm, got ${maintRes.status()}`);
  await page.locator('.notice-success', { hasText: '已保存本次 2 项变更' }).waitFor();
  await page.locator('.draft-page .page-heading').getByRole('button', { name: '返回知识库', exact: true }).click();
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();

  evidence.desktopChecks.push({ item: 'U3-03b', gateHintTransitionsVerified: true, unlockedAndCommitted: true });

  // -------------------- 5) U3-04 & U3-05: WorkItemsPage filters + WorkItemDetail delete collapse & leave guard --------------------
  await navClick('工作事项');
  await page.getByRole('heading', { name: '工作事项', exact: true }).waitFor();
  const workCountEl = page.locator('.work-section-heading .work-note');
  await waitFor('4 work items loaded', async () => (await workCountEl.textContent()) === '4 项');
  assert.equal(await page.getByRole('button', { name: '重置筛选', exact: true }).count(), 0);

  const workSearch = page.getByLabel('搜索工作事项', { exact: true });
  const workKindSelect = page.getByLabel('筛选事项类型', { exact: true });
  const workStatusSelect = page.getByLabel('筛选进展状态', { exact: true });

  await workSearch.fill('分析');
  assert.equal((await workCountEl.textContent())?.trim(), '1 / 4 项');
  assert.equal(await page.locator('.work-list-title', { hasText: 'UIFIX03 新品铺货率分析' }).count(), 1);
  await page.getByRole('button', { name: '重置筛选', exact: true }).waitFor();

  await workSearch.fill('');
  await workKindSelect.selectOption('customer_issue');
  assert.equal((await workCountEl.textContent())?.trim(), '2 / 4 项');
  await workStatusSelect.selectOption('closed');
  assert.equal((await workCountEl.textContent())?.trim(), '1 / 4 项');
  assert.equal((await page.locator('.work-list-title').textContent())?.trim(), 'UIFIX03 华南物流延迟已解决');

  await workSearch.fill('不存在的工作事项XYZ');
  assert.equal((await workCountEl.textContent())?.trim(), '0 / 4 项');
  assert.equal(await page.locator('.work-list').count(), 0);
  assert.equal((await page.locator('p.work-note[role="status"]').textContent())?.trim(), '没有匹配筛选条件的工作事项。');

  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  assert.equal((await workCountEl.textContent())?.trim(), '4 项');
  assert.equal(await page.locator('.work-list-row').count(), 4);
  assert.equal(await page.getByRole('button', { name: '重置筛选', exact: true }).count(), 0);

  // Open customer_issue detail -> no initial delete panel, header has 删除事项
  await page.locator('.work-list-row', { hasText: 'UIFIX03 华东门店开票异常' }).click();
  await page.locator('.work-detail h1', { hasText: 'UIFIX03 华东门店开票异常' }).waitFor();
  assert.equal(await page.locator('section[aria-label="删除工作事项"]').count(), 0);
  assert.equal(await page.locator('.page-heading .work-buttons').getByRole('button', { name: '删除事项', exact: true }).count(), 1);
  assert.equal(await page.locator('.work-dirty-badge').count(), 0);

  // Expand delete panel from header & cancel
  await page.locator('.page-heading .work-buttons').getByRole('button', { name: '删除事项', exact: true }).click();
  const deletePanel = page.locator('section[aria-label="删除工作事项"]');
  await deletePanel.waitFor();
  await deletePanel.getByRole('button', { name: '取消删除', exact: true }).click();
  assert.equal(await deletePanel.count(), 0);

  // Clean return goes directly back to list
  await page.getByRole('button', { name: '返回工作事项', exact: true }).click();
  await waitFor('clean return to work list', async () => (await page.locator('.work-list-row').count()) === 4);

  // Re-open customer_issue -> edit #work-current -> badge + leave confirm ("继续编辑" preserves, saving auto-clears leaveConfirm)
  await page.locator('.work-list-row', { hasText: 'UIFIX03 华东门店开票异常' }).click();
  await page.locator('.work-detail h1', { hasText: 'UIFIX03 华东门店开票异常' }).waitFor();
  const nextStepInput = page.locator('label.field', { hasText: '下一步' }).locator('input');
  await nextStepInput.fill('联系财务补开专票');
  assert.equal(await page.locator('section[aria-labelledby="work-current"] .work-dirty-badge').textContent(), '有未保存修改');

  await page.getByRole('button', { name: '返回工作事项', exact: true }).click();
  const leavePanel = page.locator('section.work-leave-confirm[role="alert"][aria-label="未保存修改确认"]');
  await leavePanel.waitFor();
  await leavePanel.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await leavePanel.count(), 0);
  assert.equal(await nextStepInput.inputValue(), '联系财务补开专票');

  // Open leaveConfirm again, then save current section -> auto-resets leaveConfirm & dirty badge
  await page.getByRole('button', { name: '返回工作事项', exact: true }).click();
  await leavePanel.waitFor();
  await page.getByRole('button', { name: '保存当前情况', exact: true }).click();
  await waitFor('save auto clears leaveConfirm and dirty badge', async () => (await leavePanel.count()) === 0 && (await page.locator('.work-dirty-badge').count()) === 0);

  // Edit #work-history -> badge on #work-history -> leave confirm -> 放弃修改并返回
  const historyTextarea = page.locator('section[aria-labelledby="work-history"] textarea').first();
  await historyTextarea.fill('未保存的处理记录草稿');
  assert.equal(await page.locator('section[aria-labelledby="work-history"] .work-dirty-badge').textContent(), '有未保存修改');
  await page.getByRole('button', { name: '返回工作事项', exact: true }).click();
  await leavePanel.waitFor();
  await leavePanel.getByRole('button', { name: '放弃修改并返回', exact: true }).click();
  await waitFor('discarded and returned to work list', async () => (await page.locator('.work-list-row').count()) === 4);

  // Open product_analysis -> test analysisDirty revert + real delete from header trigger
  await page.locator('.work-list-row', { hasText: 'UIFIX03 渠道毛利结构复盘' }).click();
  await page.locator('.work-detail h1', { hasText: 'UIFIX03 渠道毛利结构复盘' }).waitFor();
  assert.equal(await page.locator('section[aria-label="删除工作事项"]').count(), 0);
  const goalInput = page.locator('#work-goal');
  const origGoal = await goalInput.inputValue();
  await goalInput.fill('临时修改目标');
  assert.equal(await page.locator('section[aria-labelledby="work-current"] .work-dirty-badge').textContent(), '有未保存修改');
  await goalInput.fill(origGoal);
  assert.equal(await page.locator('.work-dirty-badge').count(), 0);

  // Delete via header button
  await page.locator('.page-heading .work-buttons').getByRole('button', { name: '删除事项', exact: true }).click();
  await deletePanel.waitFor();
  const deleteRespPromise = page.waitForResponse(r => r.url().includes('/api/work-items/') && r.request().method() === 'DELETE');
  await deletePanel.getByRole('button', { name: '确认删除事项', exact: true }).click();
  const delRes = await deleteRespPromise;
  assert.equal(delRes.status(), 200);
  await waitFor('3 work items after delete', async () => (await page.locator('.work-list-row').count()) === 3);

  evidence.desktopChecks.push({ item: 'U3-04 & U3-05', filtersAndEmptyVerified: true, deleteCollapsedAndConfirmed: true, leaveGuardVerified: true });

  // ==================== MOBILE 390x844 ====================
  await page.setViewportSize({ width: 390, height: 844 });

  // M1 & M2: WorkItemsPage list with filters + WorkItemDetail with dirty badge & leaveConfirm open
  await workSearch.fill('UIFIX03');
  evidence.mobileChecks.push(await measureOverflow('work-items-list-filters'));
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();

  await page.locator('.work-list-row', { hasText: 'UIFIX03 华东门店开票异常' }).click();
  await page.locator('.work-detail h1', { hasText: 'UIFIX03 华东门店开票异常' }).waitFor();
  await page.locator('label.field', { hasText: '下一步' }).locator('input').fill('移动端未保存输入测试');
  await page.getByRole('button', { name: '返回工作事项', exact: true }).click();
  await page.locator('section.work-leave-confirm[role="alert"]').waitFor();
  evidence.mobileChecks.push(await measureOverflow('work-item-detail-dirty-leave'));
  await page.locator('section.work-leave-confirm').getByRole('button', { name: '放弃修改并返回', exact: true }).click();
  await waitFor('mobile returned to work list', async () => (await page.locator('.work-list-row').count()) === 3);

  // M3, M4, M5, M6, M7: RawPage list + empty + ImportDialog 3 tabs + RawOutcomeReview
  await navClick('Raw 原始资料');
  await page.getByRole('heading', { name: 'Raw 原始资料', exact: true }).waitFor();
  await rawPanel.getByLabel('搜索原始资料', { exact: true }).fill('UIFIX03');
  evidence.mobileChecks.push(await measureOverflow('raw-list-with-filters'));

  await rawPanel.getByLabel('搜索原始资料', { exact: true }).fill('移动端无匹配');
  await rawPanel.locator('.raw-filter-empty').waitFor();
  evidence.mobileChecks.push(await measureOverflow('raw-list-filter-empty'));
  await rawPanel.getByRole('button', { name: '重置筛选', exact: true }).click();

  await page.locator('.raw-heading').getByRole('button', { name: '导入资料' }).click();
  await importDialog.waitFor();
  evidence.mobileChecks.push(await measureOverflow('raw-import-dialog-paste'));
  await tabs.nth(1).click();
  evidence.mobileChecks.push(await measureOverflow('raw-import-dialog-file'));
  await tabs.nth(2).click();
  evidence.mobileChecks.push(await measureOverflow('raw-import-dialog-url'));
  await importDialog.getByRole('button', { name: '取消', exact: true }).click();
  await importDialog.waitFor({ state: 'detached' });

  await rawPanel.locator('.raw-list-item', { hasText: 'UIFIX03 待审目标便利店观察' }).click();
  await page.locator('.raw-detail').getByRole('button', { name: '继续审核', exact: true }).click();
  await page.getByRole('heading', { name: '整理成果', exact: true }).waitFor();
  evidence.mobileChecks.push(await measureOverflow('raw-outcome-review'));
  await page.locator('.draft-page .page-heading').getByRole('button', { name: '返回 Raw', exact: true }).click();
  await page.getByRole('heading', { name: 'Raw 原始资料', exact: true }).waitFor();

  // M8: KnowledgeMaintenanceReview (seed a second active pending Q&A draft so gateHint is visible on mobile!)
  const qaDraftId2 = randomUUID();
  const answerId2 = randomUUID();
  const qaPreview2 = { ...qaPreview, title: '问答整理：移动端门禁布局测试' };
  const qaInput2 = { ...qaInput, resultId: answerId2, preview: qaPreview2 };
  await writeFile(path.join(data, 'state', 'knowledge-answers', `${answerId2}.json`), JSON.stringify({
    ...qaAnswerBase,
    id: answerId2,
    draftId: qaDraftId2,
    saves: [{ key: 'uifix03-qa-save-key-2', digest: questionHash({ resultRevision: 1, preview: qaPreview2 }), attempts: 1, status: 'draft', input: qaInput2, draftId: qaDraftId2 }],
  }, null, 2));
  await draftStore.createQuestion({
    id: qaDraftId2,
    input: qaInput2,
    maintenance: {
      version: 1,
      context: [],
      changes: [{
        changeId: 'chg-mobile-1',
        pageIndex: 0,
        action: 'create',
        candidate: {
          title: 'UIFIX03 移动端门禁展示检查项',
          type: 'concept',
          category: 'channel',
          body: '## 定义\n用于移动端核对门禁提示条无横向溢出。',
          aliases: [],
          tags: [],
          sources: [rawGenerated.id],
          knowledge_status: 'ai_organized',
          confidence: 'medium',
          source_level: 'B',
        },
        reason: '验证移动端审核布局',
        summary: ['新增验证页'],
        questions: [],
        dependsOn: [],
        decision: 'defer',
      }],
    },
    provider: { name: 'synthetic', model: 'uifix03-test' },
    callCount: 1,
  });
  await navClick('知识库');
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  await page.getByRole('tab', { name: '知识总览', exact: true }).click();
  await page.locator('.pending-wiki-drafts .raw-list-item', { hasText: '问答整理：移动端门禁布局测试' }).click();
  await page.getByRole('heading', { name: '审核知识变更', exact: true }).waitFor();
  await gateHintEl.waitFor();
  evidence.mobileChecks.push(await measureOverflow('knowledge-maintenance-review'));

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
    mobileChecks: evidence.mobileChecks.map(c => ({ page: c.page, innerWidth: c.innerWidth, scrollWidth: c.scrollWidth, overflow: c.overflow, offenderCount: c.offenders.length })),
    pageErrors: evidence.pageErrors,
    consoleErrors: evidence.consoleErrors,
    httpErrors: evidence.httpErrors,
    blockedBrowserExternalRequests: evidence.blockedBrowserExternalRequests,
    serverExternalRequests: evidence.serverExternalRequests,
    closed: evidence.closed,
  }, null, 2));
}
