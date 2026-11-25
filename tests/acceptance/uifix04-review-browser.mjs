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
import { MeetingStore } from '../../services/meeting/store.ts';

const run = await mkdtemp(path.join(os.tmpdir(), 'uifix04-review-'));
const data = path.join(run, 'data');
const envDir = path.join(run, 'empty-env');
const outDir = path.join(run, 'dist');
const config = path.join(run, 'provider.env');
const requestLog = path.join(run, 'external-requests.ndjson');
const stubbedLlmLog = path.join(run, 'stubbed-llm.ndjson');
const preloadFile = path.join(run, 'server-preload.mjs');

const now = new Date();
const stamp = now.toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const published = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(+now - 2 * 86400000));

await Promise.all([
  mkdir(envDir, { recursive: true }),
  mkdir(path.join(data, 'drafts', 'knowledge-workflows'), { recursive: true }),
  mkdir(path.join(data, 'state', 'news'), { recursive: true }),
  mkdir(path.join(data, 'state', 'automation', 'news-candidates'), { recursive: true }),
]);
await writeFile(requestLog, '');
await writeFile(stubbedLlmLog, '');
await writeFile(config, [
  'FMCG_LLM_BASE_URL=https://uifix04-fake.invalid/v1',
  'FMCG_LLM_MODEL=uifix04-synthetic-model',
  'FMCG_LLM_API_KEY=uifix04-synthetic-key-only',
].join('\n') + '\n');

// Preload injected into isolated server/index.ts:
// 1. Allows loopback requests (127.0.0.1 / localhost).
// 2. Stubs synthetic fake LLM provider https://uifix04-fake.invalid/v1/chat/completions in-process (zero network).
// 3. Logs & blocks any unexpected external host.
await writeFile(preloadFile, `
import { appendFile } from 'node:fs/promises';
const logFile = process.env.UIFIX04_REQUEST_LOG;
const llmLogFile = process.env.UIFIX04_LLM_LOG;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const reqObj = args[0] instanceof Request ? args[0] : null;
  const url = new URL(reqObj ? reqObj.url : String(args[0]));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(...args);
  if (url.hostname === 'uifix04-fake.invalid' && url.pathname.endsWith('/chat/completions')) {
    const rawBody = args[1]?.body ? String(args[1].body) : (reqObj ? await reqObj.text() : '{}');
    let chosenCategory = 'customer';
    try {
      const payload = JSON.parse(rawBody);
      const userRaw = payload?.messages?.[1]?.content;
      const userParsed = typeof userRaw === 'string' ? JSON.parse(userRaw) : {};
      if (Array.isArray(userParsed?.categories) && userParsed.categories.length) {
        chosenCategory = userParsed.categories.includes('business_analysis')
          ? 'business_analysis'
          : String(userParsed.categories[0]);
      }
    } catch {}
    await appendFile(llmLogFile, JSON.stringify({ url: url.href, chosenCategory }) + '\\n');
    const generated = {
      version: 1,
      name: 'UIFIX04 渠道动销洞察 Prompt',
      category: chosenCategory,
      scenario: '华东商超渠道动销与复购异常诊断',
      sections: [
        { heading: '角色与目标', content: '你是快消行业产品分析助手，负责结合 {{区域}} 动销台账分析异常原因。' },
        { heading: '事实与推断边界', content: '严格区分引用事实、整理归纳与分析建议；未知项标记待用户补充。' },
      ],
      inputRequirements: '区域月度动销台账与终端反馈摘要',
      outputRequirements: '输出结论、依据与待确认问题列表',
      examples: '',
      tags: ['渠道', '动销'],
    };
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(generated) } }],
      usage: { prompt_tokens: 120, completion_tokens: 180 },
    });
  }
  await appendFile(logFile, JSON.stringify({ url: url.href, method: args[1]?.method ?? 'GET' }) + '\\n');
  throw new Error('Blocked unexpected external request in UIFIX04 isolation: ' + url.href);
};
`);

// Seed isolated stores using real product modules.
const rawStore = new RawStore(data);
const wikiStore = new WikiStore(data, rawStore);
const promptStore = new PromptStore(data, wikiStore);
const meetingStore = new MeetingStore(data);

await rawStore.initialize();
await wikiStore.initialize();
await promptStore.initialize();
await meetingStore.initialize();

const raw1 = await rawStore.create({
  title: 'UIFIX04 渠道动销原始资料',
  body: '华东商超冰饮品类月度复购增长明显，便利店夜间销售提升。',
  tags: ['渠道', '动销'],
  sourceType: 'report',
  sourceName: '渠道调研周报',
});
const raw2 = await rawStore.create({
  title: 'UIFIX04 便利店冷柜调研资料',
  body: '便利店冷柜陈列位增加后即饮饮品周转加快。',
  tags: ['便利店', '冷柜'],
  sourceType: 'article',
  sourceName: '终端调研简报',
});

const longSnippet = '这是一段长度明确超过八十个字符的真实浏览器验收测试段落文本，专门用来验证知识库阅读页切换原文并选段之后在底部栏显示截断省略号以及自动展开并聚焦反馈输入框且能正确提交完整原始文本。';
const wikiMain = await wikiStore.create({
  title: 'UIFIX04 渠道动销基线页',
  type: 'metric',
  category: 'metric',
  body: `## 指标定义\n\n前缀文本。${longSnippet}后缀文本。\n\n## 口径说明\n\n按门店实际零售扫描口径统计。`,
  sources: [raw1.id],
  aliases: ['动销基线'],
  tags: ['渠道', '指标'],
  knowledge_status: 'source_supported',
  confidence: 'medium',
  source_level: 'B',
  review_status: 'unreviewed',
});
await wikiStore.create({
  title: 'Beta 渠道终端洞察',
  type: 'concept',
  category: 'channel',
  body: '## 定义\n便利店终端冷柜陈列与复购观察。',
  sources: [],
  aliases: [],
  tags: ['便利店'],
  knowledge_status: 'needs_verification',
  confidence: 'low',
  source_level: 'D',
  review_status: 'unreviewed',
});
await wikiStore.create({
  title: 'Gamma 库存周转规则',
  type: 'concept',
  category: 'channel',
  body: '## 定义\n区域仓配安全库存周期标准。',
  sources: [],
  aliases: [],
  tags: ['库存'],
  knowledge_status: 'needs_verification',
  confidence: 'low',
  source_level: 'D',
  review_status: 'unreviewed',
});

// Seed 1 pending Wiki Draft (DraftStore) and 1 pending workflow so both pending sections render above .wiki-workspace.
const draftId = randomUUID();
const jobId = randomUUID();
await writeFile(path.join(data, 'drafts', `${draftId}.json`), JSON.stringify({
  id: draftId,
  rawId: raw1.id,
  rawSha256: raw1.bodySha256,
  rawTitle: raw1.title,
  rawMeta: {
    rawId: raw1.id,
    title: raw1.title,
    sourceType: raw1.sourceType,
    sourceName: raw1.sourceName,
    importedAt: raw1.importedAt,
  },
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  rulesVersion: 'locator-v2-test',
  provider: { name: 'synthetic', model: 'uifix04-test' },
  jobId,
  document: { title: 'UIFIX04 待审知识草稿', main_topic: '渠道动销', summary: '草稿摘要' },
  source: {
    title: raw1.title,
    category: 'channel',
    summary: '渠道调研摘要',
    key_takeaways: [],
    body: '来源正文',
    knowledge_status: 'source_supported',
    confidence: 'low',
    source_level: 'C',
  },
  pages: [{
    pageId: randomUUID(),
    title: 'UIFIX04 草稿候选页',
    type: 'concept',
    category: 'channel',
    one_line_definition: '待审核草稿候选页',
    source_facts: [{ text: raw1.body, evidenceIds: ['e1'] }],
    ai_organized: [],
    ai_inferences: [],
    related_pages: [],
    open_questions: [],
    source_evidence: [{ id: 'e1', rawId: raw1.id, quote: raw1.body, start: 0, end: raw1.body.length, chunkIndex: 0 }],
    knowledge_status: 'source_supported',
    confidence: 'low',
    source_level: 'C',
    selected: true,
    provenance: [{ chunkIndex: 0, start: 0, end: raw1.body.length }],
  }],
  warnings: [],
  extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
}, null, 2));

const workflowId = randomUUID();
await writeFile(path.join(data, 'drafts', 'knowledge-workflows', `${workflowId}.json`), JSON.stringify({
  id: workflowId,
  kind: 'synthesis',
  status: 'pending_confirmation',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  provider: { name: 'synthetic', model: 'uifix04-test' },
  rawSnapshots: [
    { id: raw1.id, title: raw1.title, bodySha256: raw1.bodySha256 },
    { id: raw2.id, title: raw2.title, bodySha256: raw2.bodySha256 },
  ],
  sources: [raw1.id, raw2.id],
  title: 'UIFIX04 待审工作流综合',
  category: 'metric',
  sections: {
    suggestedAdditions: ['补充冷柜扫码复购口径'],
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

// Seed Meetings: 1 with local minutes, 1 without local minutes, plus 10 filler meetings so desktop .meeting-list overflows 680px.
const catalog = await meetingStore.getCatalog();
const defaultTypeId = catalog.types[0].id;
const mHasCreated = (await meetingStore.create({
  requestId: randomUUID(),
  title: 'UIFIX04 含纪要基准会议',
  meeting_date: today,
  meeting_type: defaultTypeId,
  confidentiality: 'Internal',
})).meeting;
const mHasPolicy = await meetingStore.updatePolicy(mHasCreated.meeting_id, {
  baseRevision: mHasCreated.revision,
  confidentiality: 'Internal',
  storage_mode: 'local_archive',
  local_storage_authorized: true,
  raw_transfer_authorized: false,
  external_ai_authorized: false,
  confirm_local_storage: true,
});
const mHas = (await meetingStore.importMinutes(mHasPolicy.meeting_id, {
  baseRevision: mHasPolicy.revision,
  requestId: randomUUID(),
  text: '# 初始会议纪要\n\n华东区域周度复盘初始工作副本。',
})).meeting;

const mEmpty = (await meetingStore.create({
  requestId: randomUUID(),
  title: 'UIFIX04 无纪要基准会议',
  meeting_date: today,
  meeting_type: defaultTypeId,
  confidentiality: 'Internal',
})).meeting;

for (let i = 1; i <= 10; i += 1) {
  await meetingStore.create({
    requestId: randomUUID(),
    title: `UIFIX04 滚动填充会议 ${String(i).padStart(2, '0')}`,
    meeting_date: published,
    meeting_type: defaultTypeId,
    confidentiality: 'Internal',
  });
}

// Seed PromptStore with 1 existing template so library filter & jump-back behavior are verifiable.
const promptSchema = await promptStore.schema();
const firstCatId = promptSchema.categories[0]?.id ?? 'customer';
const nonFirstCat = promptSchema.categories.find(c => c.id !== firstCatId) ?? promptSchema.categories[0];
await promptStore.create(randomUUID(), {
  name: 'UIFIX04 已有对照模板',
  category: firstCatId,
  scenario: '既有模板对照组',
  body: '请整理 {{对象}} 核心信息。',
  inputRequirements: '',
  outputRequirements: '',
  relatedWikiIds: [],
  examples: '',
  tags: ['已有标签'],
  favorite: false,
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
        id: 'uifix04-fmcg-1',
        title: 'UIFIX04 快消渠道示例研报',
        sourceId: 'worldpanel',
        sourceName: 'Worldpanel by Numerator',
        url: 'https://example.invalid/uifix04/fmcg-1',
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
        id: 'uifix04-ai-1',
        title: 'UIFIX04 AI 前沿示例条目',
        sourceId: 'aihot',
        sourceName: 'AIHOT',
        url: 'https://example.invalid/uifix04/ai-1',
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
  UIFIX04_REQUEST_LOG: requestLog,
  UIFIX04_LLM_LOG: stubbedLlmLog,
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
  stubbedLlmCalls: [],
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

  // -------------------- 1) U4-01 & U4-02: Wiki Page --------------------
  await navClick('知识库');
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  await page.locator('.pending-wiki-drafts').waitFor();
  await page.locator('.pending-knowledge-workflows').waitFor();
  await waitFor('3 wiki items loaded', async () => (await page.locator('.wiki-list-item').count()) === 3);
  await page.locator('.wiki-list-item', { hasText: 'UIFIX04 渠道动销基线页' }).click();
  await waitFor('wikiMain detail loaded initially', async () => (await page.locator('.wiki-detail > h2').textContent())?.trim() === 'UIFIX04 渠道动销基线页');

  const pendingPosition = await page.evaluate(() => {
    const overview = document.querySelector('#wiki-view-overview');
    const wf = overview?.querySelector('.pending-knowledge-workflows');
    const draft = overview?.querySelector('.pending-wiki-drafts');
    const ws = overview?.querySelector('.wiki-workspace');
    if (!wf || !draft || !ws) return null;
    const wfRect = wf.getBoundingClientRect();
    const draftRect = draft.getBoundingClientRect();
    const wsRect = ws.getBoundingClientRect();
    return {
      wfBeforeWs: Boolean(wf.compareDocumentPosition(ws) & Node.DOCUMENT_POSITION_FOLLOWING),
      draftBeforeWs: Boolean(draft.compareDocumentPosition(ws) & Node.DOCUMENT_POSITION_FOLLOWING),
      wfBottom: Math.round(wfRect.bottom),
      draftBottom: Math.round(draftRect.bottom),
      wsTop: Math.round(wsRect.top),
      visuallyAbove: wfRect.bottom <= wsRect.top + 1 && draftRect.bottom <= wsRect.top + 1,
    };
  });
  assert.ok(pendingPosition?.wfBeforeWs && pendingPosition?.draftBeforeWs && pendingPosition?.visuallyAbove,
    'Pending workflows & drafts must render above .wiki-workspace: ' + JSON.stringify(pendingPosition));

  // U4-02: Active Knowledge Inspection search & clear selected
  await page.getByRole('tab', { name: '主动知识检查', exact: true }).click();
  const inspectionSection = page.locator('section.wiki-inspection');
  await inspectionSection.waitFor();
  await waitFor('inspection fieldset enabled', async () => !(await inspectionSection.locator('fieldset').isDisabled()));
  const scopeSearch = inspectionSection.getByLabel('搜索检查范围知识页', { exact: true });
  await scopeSearch.waitFor();
  await inspectionSection.getByRole('button', { name: '清空已选（1）', exact: true }).waitFor();

  await scopeSearch.fill('beta');
  assert.equal(await inspectionSection.locator('.inspection-scope-picker input[type="checkbox"]').count(), 1);
  assert.match((await inspectionSection.locator('.inspection-scope-picker label').first().textContent()) ?? '', /Beta 渠道终端洞察/);
  assert.match((await inspectionSection.locator('fieldset').textContent()) ?? '', /已选 1 页/);
  await inspectionSection.locator('.inspection-scope-picker input[type="checkbox"]').first().check();
  await inspectionSection.getByRole('button', { name: '清空已选（2）', exact: true }).waitFor();

  await scopeSearch.fill('绝不会命中关键词XYZ');
  assert.equal(await inspectionSection.locator('.inspection-scope-picker input[type="checkbox"]').count(), 0);
  assert.equal(
    (await inspectionSection.locator('fieldset p.muted-copy[role="status"]').textContent())?.trim(),
    '没有匹配该关键词的知识页。',
  );

  await scopeSearch.fill('');
  assert.equal(await inspectionSection.locator('.inspection-scope-picker input[type="checkbox"]').count(), 3);
  await inspectionSection.getByRole('button', { name: '清空已选（2）', exact: true }).click();
  assert.equal(await inspectionSection.locator('button', { hasText: '清空已选' }).count(), 0);
  assert.match((await inspectionSection.locator('fieldset').textContent()) ?? '', /已选 0 页/);
  assert.equal(await inspectionSection.getByRole('button', { name: '开始本次检查', exact: true }).isDisabled(), true);

  // U4-01: Markdown原文 Selection/Range -> collapsed empty feedback click -> auto-expand + focus + bound banner -> submit & clear
  await page.getByRole('tab', { name: '知识总览', exact: true }).click();
  await page.locator('.wiki-list-item', { hasText: 'UIFIX04 渠道动销基线页' }).click();
  await waitFor('wikiMain detail loaded', async () => (await page.locator('.wiki-detail > h2').textContent())?.trim() === 'UIFIX04 渠道动销基线页');

  await page.getByRole('button', { name: 'Markdown原文', exact: true }).click();
  await page.locator('pre.wiki-body-view').waitFor();

  const selectSnippetInBrowser = async (snippet) => {
    const selectedText = await page.evaluate((target) => {
      const pre = document.querySelector('pre.wiki-body-view');
      if (!pre || !pre.firstChild) return '';
      const node = pre.firstChild;
      const content = node.textContent ?? '';
      const start = content.indexOf(target);
      if (start < 0) return '';
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + target.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      pre.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return sel.toString();
    }, snippet);
    assert.equal(selectedText, snippet);
    await page.locator('.audit-selection').waitFor();
  };

  assert.equal(await page.locator('.audit-toggle').getAttribute('aria-expanded'), 'false');
  await selectSnippetInBrowser(longSnippet);

  // Click "对选中段落提交 Audit" while AuditPanel collapsed and feedback empty -> no error, expand, bound banner, focus textarea
  await page.locator('.audit-selection').getByRole('button', { name: '对选中段落提交 Audit', exact: true }).click();
  assert.equal(await page.locator('.audit-error').count(), 0);
  assert.equal(await page.locator('.audit-toggle').getAttribute('aria-expanded'), 'true');
  const boundBanner = page.locator('.audit-bound-anchor[role="status"]');
  await boundBanner.waitFor();
  assert.match((await boundBanner.textContent()) ?? '', new RegExp(`已绑定选中段落：「${longSnippet.slice(0, 80)}…`));

  const focusCheck = await page.evaluate(() => {
    const ta = document.querySelector('.audit-create textarea');
    return Boolean(ta && document.activeElement === ta);
  });
  assert.equal(focusCheck, true, 'Feedback textarea must receive focus automatically after auto-expand');

  // Fill feedback and submit paragraph audit
  const commentArea = page.locator('.audit-create textarea');
  await commentArea.fill('UIFIX04 真实浏览器段落纠错验证反馈');
  const createParagraphReqPromise = page.waitForRequest(req => req.url().endsWith('/api/audits') && req.method() === 'POST');
  const createParagraphRespPromise = page.waitForResponse(res => res.url().endsWith('/api/audits') && res.request().method() === 'POST');
  await page.locator('.audit-create-actions').getByRole('button', { name: '提交选中段落 Audit', exact: true }).click();
  const createParagraphReq = await createParagraphReqPromise;
  const createParagraphResp = await createParagraphRespPromise;
  assert.equal(createParagraphResp.status(), 201);
  const postedParagraph = JSON.parse(createParagraphReq.postData() ?? '{}');
  assert.equal(postedParagraph.scope, 'paragraph');
  assert.equal(postedParagraph.anchor?.text, longSnippet);
  assert.equal(postedParagraph.comment, 'UIFIX04 真实浏览器段落纠错验证反馈');

  await waitFor('bound anchor and selection cleared after paragraph submit', async () => {
    return (await boundBanner.count()) === 0 && (await page.locator('.audit-selection').count()) === 0;
  });

  // Select snippet again -> bind -> click "改为整页 Audit" -> submit page audit
  await selectSnippetInBrowser(longSnippet);
  await page.locator('.audit-selection').getByRole('button', { name: '对选中段落提交 Audit', exact: true }).click();
  await boundBanner.waitFor();
  await boundBanner.getByRole('button', { name: '改为整页 Audit', exact: true }).click();
  assert.equal(await boundBanner.count(), 0);
  assert.equal(await page.locator('.audit-create-actions').getByRole('button', { name: '提交选中段落 Audit', exact: true }).count(), 0);
  await commentArea.fill('UIFIX04 真实浏览器整页纠错验证反馈');
  const createPageReqPromise = page.waitForRequest(req => req.url().endsWith('/api/audits') && req.method() === 'POST');
  const createPageRespPromise = page.waitForResponse(res => res.url().endsWith('/api/audits') && res.request().method() === 'POST');
  await page.locator('.audit-create-actions').getByRole('button', { name: '提交整页 Audit', exact: true }).click();
  const createPageReq = await createPageReqPromise;
  const createPageResp = await createPageRespPromise;
  assert.equal(createPageResp.status(), 201);
  const postedPage = JSON.parse(createPageReq.postData() ?? '{}');
  assert.equal(postedPage.scope, 'page');
  assert.equal(postedPage.anchor, undefined);

  evidence.desktopChecks.push({
    item: 'U4-01_U4-02',
    pendingPosition,
    inspectionSearchAndClearVerified: true,
    paragraphAuditSubmit: { status: createParagraphResp.status(), scope: postedParagraph.scope, anchorLen: postedParagraph.anchor?.text?.length },
    switchToPageAuditVerified: true,
  });

  // -------------------- 2) U4-03 & U4-04: Meeting Page --------------------
  await navClick('会议档案');
  await page.getByRole('heading', { name: '会议档案', exact: true }).waitFor();
  const meetingCountEl = page.locator('.meeting-list-panel .list-title span');
  await waitFor('12 meetings loaded', async () => (await meetingCountEl.textContent()) === '12 条');

  const meetingListMetrics = await page.locator('.meeting-page .meeting-list-panel > .meeting-list').evaluate(el => {
    const st = getComputedStyle(el);
    return {
      maxHeight: st.maxHeight,
      overflowY: st.overflowY,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    };
  });
  assert.equal(meetingListMetrics.maxHeight, '680px');
  assert.equal(meetingListMetrics.overflowY, 'auto');
  assert.ok(meetingListMetrics.scrollHeight > meetingListMetrics.clientHeight, 'Expected 12 meetings to scroll vertically');

  const minutesDetails = page.locator('details.meeting-group', { hasText: '本地会议纪要' });

  // Select meeting with minutes -> default open
  await page.locator('.meeting-row', { hasText: 'UIFIX04 含纪要基准会议' }).click();
  await waitFor('mHas detail loaded', async () => (await page.locator('.meeting-detail h2').textContent())?.trim() === 'UIFIX04 含纪要基准会议');
  assert.equal(await minutesDetails.evaluate(el => el.open), true, 'Minutes <details> must default to open when imports > 0');

  // Switch to meeting without minutes -> default collapsed
  await page.locator('.meeting-row', { hasText: 'UIFIX04 无纪要基准会议' }).click();
  await waitFor('mEmpty detail loaded', async () => (await page.locator('.meeting-detail h2').textContent())?.trim() === 'UIFIX04 无纪要基准会议');
  assert.equal(await minutesDetails.evaluate(el => el.open), false, 'Minutes <details> must default to closed when imports === 0');

  // Switch back to meeting with minutes -> default open again
  await page.locator('.meeting-row', { hasText: 'UIFIX04 含纪要基准会议' }).click();
  await waitFor('mHas detail reloaded', async () => (await page.locator('.meeting-detail h2').textContent())?.trim() === 'UIFIX04 含纪要基准会议');
  assert.equal(await minutesDetails.evaluate(el => el.open), true);

  // U4-04: Edit working copy -> nearby "保存工作副本" + bottom "保存会议档案"
  await minutesDetails.getByRole('button', { name: '编辑工作副本', exact: true }).click();
  const minuteActions = minutesDetails.locator('.meeting-minute-actions');
  const nearbySaveBtn = minuteActions.getByRole('button', { name: '保存工作副本', exact: true });
  const cancelEditBtn = minuteActions.getByRole('button', { name: '取消编辑', exact: true });
  const bottomArchiveBtn = minutesDetails.locator('.meeting-minute-save').getByRole('button', { name: '保存会议档案', exact: true });
  await nearbySaveBtn.waitFor();
  await cancelEditBtn.waitFor();
  await bottomArchiveBtn.waitFor();
  assert.equal(await nearbySaveBtn.isDisabled(), true);

  await minutesDetails.getByLabel('编辑纪要工作副本', { exact: true }).fill('# 更新后的工作副本\n\nUIFIX04 真实浏览器就近保存修改成功。');
  assert.equal(await nearbySaveBtn.isDisabled(), false);

  const patchMinutesPromise = page.waitForResponse(
    res => res.url().includes(`/api/meetings/${mHas.meeting_id}/minutes/`) && res.request().method() === 'PATCH',
  );
  await nearbySaveBtn.click();
  const patchMinutesResp = await patchMinutesPromise;
  assert.equal(patchMinutesResp.status(), 200);
  await waitFor('working copy saved and rendered', async () => {
    const readerText = await minutesDetails.locator('.meeting-minute-reader').textContent().catch(() => '');
    const statusText = await minutesDetails.locator('.meeting-minute-save [role="status"]').textContent().catch(() => '');
    return Boolean(readerText?.includes('UIFIX04 真实浏览器就近保存修改成功。') && statusText?.trim() === '纪要已保存。');
  });

  // U4-03: 3 dialogs (MeetingEditor, PolicyDialog, CatalogDialog) focus trap, Escape close, focus restore & backdrop click close
  const verifyDialogClose = async (triggerLocator, dialogSelector, label) => {
    await triggerLocator.focus();
    await triggerLocator.click();
    const dlg = page.locator(dialogSelector);
    await dlg.waitFor();
    assert.equal(await dlg.evaluate(el => el.contains(document.activeElement)), true, `${label} must trap initial focus`);
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    assert.equal(await triggerLocator.evaluate(el => document.activeElement === el), true, `${label} must restore focus after Escape`);

    // Also test backdrop mousedown click closes the dialog
    await triggerLocator.click();
    await dlg.waitFor();
    await page.mouse.click(10, 10);
    await dlg.waitFor({ state: 'detached' });
  };

  await verifyDialogClose(
    page.locator('.meeting-page .page-heading button.primary-button', { hasText: '新建会议' }),
    'section.meeting-dialog[aria-labelledby="meeting-editor-title"]',
    'MeetingEditor',
  );
  await verifyDialogClose(
    page.locator('.meeting-detail').getByRole('button', { name: '安全策略', exact: true }),
    'section.meeting-dialog[aria-labelledby="policy-title"]',
    'PolicyDialog',
  );
  await verifyDialogClose(
    page.locator('.meeting-toolbar').getByRole('button', { name: '管理类型', exact: true }),
    'section.meeting-dialog[aria-labelledby="catalog-title"]',
    'CatalogDialog',
  );

  // U4-03: App.tsx cleans meeting query params (?meeting= / mq= / etc.) when navigating away, preserving non-meeting params & hash
  const meetingSearchBox = page.getByLabel('搜索会议标题、标签、客户或项目', { exact: true });
  await meetingSearchBox.fill('含纪要');
  await waitFor('mq param set', async () => (await page.evaluate(() => window.location.search)).includes('mq='));
  await page.locator('.meeting-row', { hasText: 'UIFIX04 含纪要基准会议' }).click();
  await waitFor('meeting param set', async () => (await page.evaluate(() => window.location.search)).includes(`meeting=${mHas.meeting_id}`));

  await page.evaluate(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('custom_keep', '1');
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}#uifix04hash`);
  });

  await navClick('知识库');
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  const afterLeaveSearch = await page.evaluate(() => ({ search: window.location.search, hash: window.location.hash }));
  assert.equal(afterLeaveSearch.search, '?custom_keep=1');
  assert.equal(afterLeaveSearch.hash, '#uifix04hash');

  // Also verify complete search cleanup when no custom params remain
  await navClick('会议档案');
  await page.getByRole('heading', { name: '会议档案', exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.locator('.meeting-row', { hasText: 'UIFIX04 含纪要基准会议' }).click();
  await page.evaluate(() => {
    const p = new URLSearchParams(window.location.search);
    p.delete('custom_keep');
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
  });
  await navClick('首页');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.location.search), '');

  evidence.desktopChecks.push({
    item: 'U4-03_U4-04',
    meetingListMetrics,
    minutesDefaultToggleVerified: true,
    nearbyWorkingCopySaved: true,
    dialogsEscapeAndBackdropVerified: ['MeetingEditor', 'PolicyDialog', 'CatalogDialog'],
    urlCleanupVerified: afterLeaveSearch,
  });

  // -------------------- 3) U4-05: Prompt Workbench --------------------
  await navClick('Prompt 工作台');
  await page.getByRole('heading', { name: 'Prompt 工作台', exact: true }).waitFor();
  await waitFor('initial prompt selected', async () => (await page.locator('.prompt-list-item').count()) >= 1);

  const tagInputHeight = await page.locator('.prompt-tag-filter input').evaluate(el => getComputedStyle(el).height);
  const tagInputHeightPassed = tagInputHeight === '36px';

  // Deliberately apply filters yielding 0 matches before jumping to Generator
  await page.getByLabel('搜索 Prompt', { exact: true }).fill('绝不命中的筛选搜索词');
  await page.locator('.prompt-tag-filter input').fill('不存在标签');
  await page.locator('.prompt-favorite-filter input[type="checkbox"]').check();
  if (nonFirstCat && nonFirstCat.id !== firstCatId) {
    await page.locator('.category-grid button.category-chip', { hasText: nonFirstCat.label }).click();
  }
  await waitFor('prompt empty filter state', async () => ((await page.locator('.prompt-list-panel').textContent()) ?? '').includes('没有匹配的 Prompt'));

  // Open 生成 tab -> manual brief -> generate (real backend -> stubbed LLM) -> confirm save -> click "在模板库中查看"
  await page.locator('.prompt-tabs').getByRole('button', { name: '生成', exact: true }).click();
  await page.locator('.prompt-ai-workbench textarea').first().fill('分析华东商超渠道动销与复购异常');
  await page.getByRole('button', { name: '手动填写 Brief', exact: true }).click();
  const genRespPromise = page.waitForResponse(res => res.url().endsWith('/api/prompt-ai/generate') && res.request().method() === 'POST');
  await page.getByRole('button', { name: '生成 Prompt', exact: true }).click();
  const genResp = await genRespPromise;
  assert.equal(genResp.status(), 201);

  const saveNewPromptBtn = page.getByRole('button', { name: '保存为新 Prompt', exact: true });
  await saveNewPromptBtn.waitFor();
  const confirmRespPromise = page.waitForResponse(res => res.url().includes('/api/prompt-ai/drafts/') && res.url().endsWith('/confirm') && res.request().method() === 'POST');
  await saveNewPromptBtn.click();
  const confirmResp = await confirmRespPromise;
  assert.equal(confirmResp.status(), 201);

  const bannerViewBtn = page.locator('.prompt-message.success-message .prompt-view-library');
  const footerViewBtn = page.locator('.editor-footer').getByRole('button', { name: '在模板库中查看', exact: true });
  await bannerViewBtn.waitFor();
  await footerViewBtn.waitFor();
  assert.equal((await bannerViewBtn.textContent())?.trim(), '在模板库中查看');

  await bannerViewBtn.click();
  await waitFor('switched to library and selected saved prompt', async () => {
    const h2 = (await page.locator('.prompt-detail h2').textContent().catch(() => ''))?.trim();
    const selectedName = (await page.locator('.prompt-list-item.selected').textContent().catch(() => '')) ?? '';
    return h2 === 'UIFIX04 渠道动销洞察 Prompt' && selectedName.includes('UIFIX04 渠道动销洞察 Prompt');
  });
  assert.equal(await page.getByLabel('搜索 Prompt', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('.prompt-tag-filter input').inputValue(), '');
  assert.equal(await page.locator('.prompt-favorite-filter input[type="checkbox"]').isChecked(), false);
  assert.match((await page.locator('.category-chip.chosen').textContent()) ?? '', /^全部/);

  evidence.desktopChecks.push({
    item: 'U4-05',
    tagInputHeight,
    tagInputHeightPassed,
    generatedAndSavedPrompt: 'UIFIX04 渠道动销洞察 Prompt',
    filtersClearedAndSelectedInLibrary: true,
    passed: tagInputHeightPassed,
  });

  // ==================== MOBILE 390x844 ====================
  await page.setViewportSize({ width: 390, height: 844 });

  // M1: Wiki Overview (with pending cards + Markdown原文 selection + expanded AuditPanel bound banner)
  await navClick('知识库');
  await page.getByRole('tab', { name: '知识总览', exact: true }).click();
  await page.locator('.wiki-list-item', { hasText: 'UIFIX04 渠道动销基线页' }).click();
  await waitFor('mobile wiki detail ready', async () => (await page.locator('.wiki-detail > h2').textContent())?.trim() === 'UIFIX04 渠道动销基线页');
  await page.getByRole('button', { name: 'Markdown原文', exact: true }).click();
  await selectSnippetInBrowser(longSnippet);
  await page.locator('.audit-selection').getByRole('button', { name: '对选中段落提交 Audit', exact: true }).click();
  await page.locator('.audit-bound-anchor').waitFor();
  evidence.mobileChecks.push(await measureOverflow('wiki-overview-bound-audit'));
  await page.locator('.audit-bound-anchor').getByRole('button', { name: '改为整页 Audit', exact: true }).click();

  // M2: Wiki Active Knowledge Inspection
  await page.getByRole('tab', { name: '主动知识检查', exact: true }).click();
  await page.locator('.inspection-scope-toolbar').waitFor();
  evidence.mobileChecks.push(await measureOverflow('wiki-active-check'));

  // M3: Meeting Archive (with expanded local minutes + 3 dialogs)
  await navClick('会议档案');
  await page.getByRole('heading', { name: '会议档案', exact: true }).waitFor();
  await page.locator('.meeting-row', { hasText: 'UIFIX04 含纪要基准会议' }).click();
  await waitFor('mobile mHas open minutes', async () => await minutesDetails.evaluate(el => el.open));
  evidence.mobileChecks.push(await measureOverflow('meeting-overview-expanded-minutes'));

  for (const [label, trigger, sel] of [
    ['meeting-editor-dialog', page.locator('.meeting-page .page-heading button.primary-button', { hasText: '新建会议' }), 'section.meeting-dialog[aria-labelledby="meeting-editor-title"]'],
    ['meeting-policy-dialog', page.locator('.meeting-detail').getByRole('button', { name: '安全策略', exact: true }), 'section.meeting-dialog[aria-labelledby="policy-title"]'],
    ['meeting-catalog-dialog', page.locator('.meeting-toolbar').getByRole('button', { name: '管理类型', exact: true }), 'section.meeting-dialog[aria-labelledby="catalog-title"]'],
  ]) {
    await trigger.click();
    const dlg = page.locator(sel);
    await dlg.waitFor();
    const box = await dlg.boundingBox();
    const metrics = await measureOverflow(label);
    const fitsViewport = Boolean(box && box.x >= 0 && box.x + box.width <= 390.5 && box.y >= 0 && box.y + box.height <= 844.5);
    evidence.mobileChecks.push({ ...metrics, dialogBox: box, dialogFitsViewport: fitsViewport });
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
  }

  // M4: Prompt Library + Workbench saved view
  await navClick('Prompt 工作台');
  await page.locator('.prompt-tag-filter input').waitFor();
  evidence.mobileChecks.push(await measureOverflow('prompt-library'));

  await page.locator('.prompt-tabs').getByRole('button', { name: '生成', exact: true }).click();
  await page.locator('.prompt-ai-workbench textarea').first().fill('移动端宽度测试任务');
  await page.getByRole('button', { name: '手动填写 Brief', exact: true }).click();
  await page.getByRole('button', { name: '生成 Prompt', exact: true }).click();
  await page.getByRole('button', { name: '保存为新 Prompt', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存为新 Prompt', exact: true }).click();
  await page.locator('.prompt-message.success-message .prompt-view-library').waitFor();
  evidence.mobileChecks.push(await measureOverflow('prompt-ai-workbench-saved'));

  const rawExternal = (await readFile(requestLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const rawStubbedLlm = (await readFile(stubbedLlmLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  evidence.serverExternalRequests = rawExternal;
  evidence.stubbedLlmCalls = rawStubbedLlm;

  assert.equal(evidence.blockedBrowserExternalRequests.length, 0);
  assert.equal(evidence.serverExternalRequests.length, 0);
  assert.ok(evidence.stubbedLlmCalls.length >= 2, 'Expected in-process stubbed fake LLM calls during desktop & mobile prompt generation');
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.consoleErrors, []);
  assert.deepEqual(evidence.httpErrors, []);
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
  console.log(JSON.stringify({
    run,
    apiPort,
    uiPort,
    browserVersion: evidence.browserVersion,
    desktopChecks: evidence.desktopChecks,
    mobileChecks: evidence.mobileChecks.map(c => ({
      page: c.page,
      innerWidth: c.innerWidth,
      scrollWidth: c.scrollWidth,
      overflow: c.overflow,
      dialogFitsViewport: c.dialogFitsViewport,
      offenderCount: c.offenders.length,
    })),
    pageErrors: evidence.pageErrors,
    consoleErrors: evidence.consoleErrors,
    httpErrors: evidence.httpErrors,
    blockedBrowserExternalRequests: evidence.blockedBrowserExternalRequests,
    serverExternalRequests: evidence.serverExternalRequests,
    stubbedLlmCallCount: evidence.stubbedLlmCalls.length,
    closed: evidence.closed,
  }, null, 2));
}
