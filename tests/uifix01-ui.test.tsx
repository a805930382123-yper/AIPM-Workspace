import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { LlmConfigSummary, Prompt, Raw, RawDraftView, Wiki } from '../app/api.ts';
import type { HomeAction } from '../services/home/actions.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  location: window.location,
  history: window.history,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  FormData: window.FormData,
  File: window.File,
  Blob: window.Blob,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
window.HTMLElement.prototype.scrollIntoView = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../app/App.tsx');
const { DraftReviewPage } = await import('../app/pages/DraftReviewPage.tsx');
const { RawOutcomeReview } = await import('../app/pages/RawOutcomeReview.tsx');
const { RawPage } = await import('../app/pages/RawPage.tsx');
const { WikiPage } = await import('../app/pages/WikiPage.tsx');
const { PromptLibraryPage } = await import('../app/pages/PromptLibraryPage.tsx');
const { NewsPage } = await import('../app/pages/NewsPage.tsx');
const { SettingsPage } = await import('../app/pages/SettingsPage.tsx');

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await act(async () => { await tick(10); });
  }
  assert.fail(`等待超时：${label}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function maybeButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(item => (item.textContent ?? '').includes(label)) as HTMLButtonElement | undefined;
}
function findButton(container: ParentNode, label: string): HTMLButtonElement {
  const found = maybeButton(container, label);
  assert.ok(found, `找不到按钮：${label}`);
  return found;
}
async function click(target: HTMLElement) {
  await act(async () => {
    target.click();
    await tick();
  });
}
async function pressEscape(target: EventTarget | null) {
  assert.ok(target, '缺少 Escape 派发目标');
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await tick();
  });
}
async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    assert.ok(setter);
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
}

test('U1-01 & U1-02: 侧栏图标去重、自动化打开草稿返回自动化、workflow/news 面包屑及返回工作台', async () => {
  const rawId = '11111111-1111-4111-8111-111111111111';
  const draftId = '22222222-2222-4222-8222-222222222222';
  const workflowId = '33333333-3333-4333-8333-333333333333';
  const raw: Raw = {
    id: rawId, title: 'UIFIX01 测试 Raw', sourceType: 'note', sourceName: '测试源', tags: [],
    body: '虚构测试正文。', importedAt: '2026-11-18T00:00:00.000Z', status: 'unprocessed', bodySha256: 'a'.repeat(64),
  };
  const draft = {
    id: draftId, rawId, rawTitle: raw.title, title: '自动化草稿夹具', status: 'pending_confirmation', revision: 1,
    provider: { name: 'memory', model: 'fixture' }, rulesVersion: 'locator-v2-test',
    document: { title: '自动化草稿夹具', main_topic: '测试', summary: '摘要' },
    source: { title: raw.title, summary: '摘要', body: '摘要', key_takeaways: [], category: 'other', knowledge_status: 'source_supported', confidence: 'low', source_level: 'C' },
    pages: [{
      pageId: 'page-1', title: '测试概念', type: 'concept', category: 'industry_basics', one_line_definition: '定义',
      source_facts: [{ text: '虚构测试正文', evidenceIds: ['e1'] }], ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [],
      source_evidence: [{ id: 'e1', rawId, quote: '虚构测试正文。', start: 0, end: 7, chunkIndex: 0 }], selected: true,
      knowledge_status: 'source_supported', confidence: 'low', source_level: 'C',
    }],
    warnings: [], extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
    preview: { rawExists: true, rawSha256Matches: true, sourceReuse: null, sourceAmbiguous: null, titleConflicts: [], batchDuplicateTitles: [] },
    raw: { id: rawId, title: raw.title, sourceType: 'note', sourceName: '测试源', author: null, publishedAt: null, url: null, importedAt: raw.importedAt, bodySha256: raw.bodySha256 },
  };
  const draftAction: HomeAction = {
    kind: 'draft', id: draftId, title: '首页待审草稿', problem: '待确认', result: '待审核',
    action: '查看草稿', updatedAt: raw.importedAt, priority: 0, target: { draftId, revision: 1 }, versionToken: 'draft-v1',
  };
  const workflowAction: HomeAction = {
    kind: 'workflow', id: workflowId, title: '待审综合工作流', problem: '待确认', result: '草稿已保存',
    action: '查看工作流', updatedAt: raw.importedAt, priority: 1, target: { workflowId, revision: 1 }, versionToken: 'wf-v1',
  };
  const workflow = {
    id: workflowId, kind: 'synthesis', status: 'pending_confirmation', revision: 1, title: '待审综合工作流', category: 'industry_basics',
    provider: { name: 'memory', model: 'fixture' }, rawSnapshots: [],
    sections: { newSource: '', suggestedAdditions: [], conflicts: [], inferences: [], openQuestions: [], agreement: [], sourceList: [] },
    sources: [], evidence: [],
  };
  const schema = {
    domain: 'fmcg', types: [{ id: 'concept', label: '概念', description: '' }], categories: [{ id: 'industry_basics', label: '行业基础' }],
    enums: { knowledge_status: ['source_supported'], confidence: ['low'], source_level: ['C'] }, pageTemplates: {},
    sourcePolicy: { levels: [{ id: 'C', label: 'C', description: '' }], guidance: '' },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/raw') return jsonResponse({ items: [raw] });
    if (url === `/api/raw/${rawId}`) return jsonResponse(raw);
    if (url === '/api/stats') return jsonResponse({ rawCount: 1, wikiCount: 0, thisWeekNewCount: 0, pendingConfirmationCount: 1, openAuditCount: 0, promptCount: 0, weekStartsOn: '' });
    if (url === '/api/raw-processing') return jsonResponse({ items: [{ rawId, status: 'pending_confirmation', updatedAt: '', draftId }] });
    if (url === '/api/home/actions') return jsonResponse({ items: [draftAction, workflowAction], sources: { draft: { status: 'ok' }, workflow: { status: 'ok' } } });
    if (url.startsWith(`/api/home/actions/draft/${draftId}`)) return jsonResponse(draftAction);
    if (url.startsWith(`/api/home/actions/workflow/${workflowId}`)) return jsonResponse(workflowAction);
    if (url === '/api/work-items' || url.startsWith('/api/work-items?')) return jsonResponse({ items: [] });
    if (url === '/api/knowledge/workflows') return jsonResponse({ items: [] });
    if (url === `/api/knowledge/workflows/${workflowId}`) return jsonResponse(workflow);
    if (url === `/api/drafts/${draftId}`) return jsonResponse(draft);
    if (url === `/api/knowledge/drafts/${draftId}/pages/page-1/duplicates`) return jsonResponse({ draftId, pageId: 'page-1', draftRevision: 1, decision: null, targetWikiId: null, candidates: [] });
    if (url === '/api/wiki/schema') return jsonResponse(schema);
    if (url === '/api/wiki' || url.startsWith('/api/wiki?')) return jsonResponse({ items: [], categoryCounts: {} });
    if (url.startsWith('/api/drafts?')) return jsonResponse({ items: [] });
    if (url === '/api/news/today' || url === '/api/news/today/ensure') {
      return jsonResponse({ date: '2026-11-18', aiEnabled: false, edition: { schemaVersion: 1, date: '2026-11-18', updatedAt: '2026-11-18T00:00:00Z', sections: {} }, fallbacks: {} });
    }
    if (url === '/api/news/history' || url.includes('/saved-raws')) return jsonResponse({ items: [], errors: [] });
    if (url === '/api/automation/status') {
      return jsonResponse({
        paused: false,
        scheduler: { healthy: true, lastTickAt: null },
        instance: { pid: 1, port: 4317, mode: 'development', startedAt: '2026-11-18T00:00:00Z', hostname: 'localhost' },
        nextRunAt: null,
        failuresLast24Hours: 0,
        writeToken: 'auto-token',
      });
    }
    if (url === '/api/automation/schedules') {
      return jsonResponse({
        items: [{
          type: 'news.daily', name: '每日资讯', enabled: true,
          plan: { kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' },
          catchUp: false, revision: 1, budget: null, nextRunAt: null, lastRun: null, mayCallModel: false, allowsCatchUp: true,
        }],
        issues: [],
      });
    }
    if (url.startsWith('/api/automation/runs')) return jsonResponse({ items: [], issues: [] });
    if (url === '/api/automation/pipeline/settings') return jsonResponse({ revision: 1, preScreenEnabled: false, concurrency: 2, topics: [] });
    if (url.startsWith('/api/automation/candidates')) {
      return jsonResponse({
        date: '2026-11-18',
        dates: ['2026-11-18'],
        items: [{
          id: '2026-11-18/fmcg/news-1',
          section: 'fmcg',
          disposition: 'inbox',
          draftPending: true,
          execution: { runId: 'run-1', draftId, phase: 'draft_ready' },
          item: { id: 'news-1', title: '待审核候选新闻', sourceId: 's', sourceName: '测试来源', url: 'https://example.test/1', publishedAt: '2026-11-18', fetchedAt: '2026-11-18T00:00:00Z', excerpt: '摘录', evidenceKind: 'article_excerpt' },
        }],
        counts: { fetched: 1, pending: 0, organizing: 0, drafts: 1, failed: 0 },
      });
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: `Unexpected ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(App)); await tick(); });
    await waitFor(() => !!container.querySelector('.home-action-row button'), '首页加载完成');

    // U1-02: 侧栏 7 个主导航项图标互不重复（含设置共 8 个不同图标）
    const navIcons = [...container.querySelectorAll('.sidebar nav[aria-label="主导航"] svg')].map(svg => svg.innerHTML);
    assert.equal(navIcons.length, 7);
    assert.equal(new Set(navIcons).size, 7, '主导航 7 个图标不得重复');
    const allSidebarIcons = [...container.querySelectorAll('.sidebar svg.nav-icon')].map(svg => svg.innerHTML);
    assert.equal(new Set(allSidebarIcons).size, 8, '侧边栏全部 8 个图标必须互异');

    // 主导航页的面包屑前缀为纯文本“工作空间”
    assert.equal(container.querySelector('.breadcrumb')?.textContent, '工作空间 / 首页');
    assert.equal(container.querySelector('.breadcrumb-back'), null);

    // U1-01: workflowId 面包屑显示“更新与综合审阅”，点击“工作空间”可返回
    await click(findButton(container, '查看工作流'));
    await waitFor(() => container.querySelector('h1')?.textContent === '审阅综合草稿', '打开 workflow 视图');
    assert.equal(container.querySelector('.breadcrumb')?.textContent, '工作空间 / 更新与综合审阅');
    const wfBreadcrumbBack = container.querySelector('button.breadcrumb-back') as HTMLButtonElement | null;
    assert.ok(wfBreadcrumbBack, 'workflow 覆盖视图下“工作空间”应为可点击返回按钮');
    await click(wfBreadcrumbBack);
    await waitFor(() => container.querySelector('.home-page h1')?.textContent === '工作台', '点击面包屑返回工作台');
    assert.equal(container.querySelector('.breadcrumb')?.textContent, '工作空间 / 首页');

    // U1-01: 首页打开草稿 -> 返回按钮文案为“返回工作台” -> 点击返回回到首页
    await click(findButton(container, '查看草稿'));
    await waitFor(() => container.querySelector('h1')?.textContent?.includes('审核「自动化草稿夹具」') === true, '首页打开草稿审核');
    await click(findButton(container, '返回工作台'));
    await waitFor(() => container.querySelector('.home-page h1')?.textContent === '工作台', '首页草稿点击“返回工作台”回到首页');

    // U1-01: Raw 打开草稿 -> 返回按钮文案为“返回 Raw” -> 点击返回回到 Raw
    await click(findButton(container.querySelector('.sidebar')!, 'Raw 原始资料'));
    await waitFor(() => !!maybeButton(container, '继续审核'), 'Raw 继续审核按钮就绪');
    await click(findButton(container, '继续审核'));
    await waitFor(() => container.querySelector('h1')?.textContent?.includes('审核「自动化草稿夹具」') === true, 'Raw 打开草稿审核');
    await click(findButton(container, '返回 Raw'));
    await waitFor(() => container.querySelector('h1')?.textContent === 'Raw 原始资料', 'Raw 草稿点击“返回 Raw”回到 Raw 页');

    // 回到首页后再进入每日资讯，验证面包屑返回和“返回工作台”按钮
    await click(findButton(container.querySelector('.sidebar')!, '首页'));
    await waitFor(() => container.querySelector('.home-page h1')?.textContent === '工作台', '侧栏回到首页');
    await click(findButton(container, '阅读资讯'));
    await waitFor(() => container.querySelector('h1')?.textContent === '每日资讯', '进入每日资讯');
    assert.equal(container.querySelector('.breadcrumb')?.textContent, '工作空间 / 每日资讯');
    assert.ok(container.querySelector('button.breadcrumb-back'), '每日资讯页应提供可点击面包屑返回');
    await click(findButton(container, '返回工作台'));
    await waitFor(() => container.querySelector('.home-page h1')?.textContent === '工作台', '每日资讯点击返回工作台回到首页');

    // U1-01: 自动化打开草稿 -> 返回按钮文案为“返回自动化” -> 点击返回回到自动化页面
    await click(findButton(container.querySelector('.sidebar')!, '自动化'));
    await waitFor(() => !!maybeButton(container, '审核草稿'), '自动化候选收件箱就绪');
    await click(findButton(container, '审核草稿'));
    await waitFor(() => container.querySelector('h1')?.textContent?.includes('审核「自动化草稿夹具」') === true, '从自动化打开草稿审核');
    assert.equal(container.querySelector('.breadcrumb')?.textContent, '工作空间 / AI 知识整理预览');
    await click(findButton(container, '返回自动化'));
    await waitFor(() => container.querySelector('h1')?.textContent === '自动化', '点击“返回自动化”应回到自动化页面');
    assert.ok(container.querySelector('#news-candidates'), '返回后保持在自动化收件箱上下文');

    // 从自动化再开草稿后点击顶部面包屑“工作空间”也应回到自动化页面
    await waitFor(() => !!maybeButton(container, '审核草稿'), '再次找到审核草稿');
    await click(findButton(container, '审核草稿'));
    await waitFor(() => !!container.querySelector('button.breadcrumb-back'), '草稿下面包屑返回按钮可用');
    await click(container.querySelector('button.breadcrumb-back') as HTMLButtonElement);
    await waitFor(() => container.querySelector('h1')?.textContent === '自动化', '草稿下面包屑返回回到自动化页面');
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U1-01 返修：真实服务端带 outcomeDigest 草稿进入 RawOutcomeReview，KnowledgeMaintenanceReview 与加载兜底均透传 backLabel', async () => {
  const rawId = '11111111-1111-4111-8111-111111111112';
  const outcomeDraftId = '22222222-2222-4222-8222-222222222223';
  const maintenanceDraftId = '22222222-2222-4222-8222-222222222224';
  const inputDraftId = '22222222-2222-4222-8222-222222222225';
  const raw: Raw = {
    id: rawId, title: 'UIFIX01 Outcome 测试 Raw', sourceType: 'note', sourceName: '测试源', tags: [],
    body: '虚构测试正文。', importedAt: '2026-11-18T00:00:00.000Z', status: 'unprocessed', bodySha256: 'b'.repeat(64),
  };
  const outcomeDraft: RawDraftView = {
    id: outcomeDraftId, rawId, rawTitle: raw.title, status: 'pending_confirmation', revision: 1,
    createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z',
    provider: { name: 'memory', model: 'fixture' }, rulesVersion: 'locator-v2-test', jobId: 'job-outcome',
    outcomeDigest: 'outcome-digest-server-fixture',
    document: { title: '带 outcomeDigest 草稿', main_topic: '测试', summary: '摘要' },
    source: { title: raw.title, summary: '摘要', body: '来源正文', key_takeaways: [], category: 'other', knowledge_status: 'source_supported', confidence: 'low', source_level: 'C' },
    pages: [{
      pageId: 'page-1', title: '测试概念', type: 'concept', category: 'industry_basics', one_line_definition: '定义',
      source_facts: [{ text: '虚构测试正文', evidenceIds: ['e1'] }], ai_organized: ['整理段落'], ai_inferences: [], related_pages: [], open_questions: [],
      source_evidence: [{ id: 'e1', rawId, quote: '虚构测试正文。', start: 0, end: 7, chunkIndex: 0 }], selected: true,
      knowledge_status: 'source_supported', confidence: 'low', source_level: 'C', provenance: [],
    }],
    warnings: [], extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
    preview: { rawExists: true, rawSha256Matches: true, sourceReuse: null, sourceAmbiguous: null, titleConflicts: [], batchDuplicateTitles: [] },
    raw: { id: rawId, title: raw.title, sourceType: 'note', sourceName: '测试源', author: null, publishedAt: null, url: null, importedAt: raw.importedAt, bodySha256: raw.bodySha256 },
  };
  const maintenanceDraft: RawDraftView = {
    ...outcomeDraft,
    id: maintenanceDraftId,
    outcomeDigest: undefined,
    maintenance: {
      version: 1,
      context: [],
      changes: [{
        changeId: 'chg-1', pageIndex: 0, action: 'create', decision: 'defer', reason: '维护草稿测试',
        candidate: { title: '测试概念', body: '正文', type: 'concept', category: 'industry_basics', aliases: [], tags: [], sources: [rawId], knowledge_status: 'source_supported', confidence: 'low', source_level: 'C' },
        summary: [], questions: [], dependsOn: [],
      }],
    },
  };
  const inputDraft = {
    id: inputDraftId,
    status: 'pending_confirmation',
    revision: 1,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    rulesVersion: 'locator-v2-test',
    provider: { name: 'memory', model: 'fixture' },
    document: { title: '问答维护草稿', main_topic: '问答', summary: '摘要' },
    pages: outcomeDraft.pages,
    warnings: [],
    extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
    preview: null,
    raw: null,
    maintenance: maintenanceDraft.maintenance,
    input: {
      kind: 'question_answer',
      resultId: '44444444-4444-4444-8444-444444444444',
      resultRevision: 1,
      question: '测试问题',
      answerDigest: 'ans-digest',
      preview: { title: '结论标题', conclusion: '结论内容', inferences: '', tags: [], selectedSectionIds: [], selectedText: '', citationIds: [] },
      wikiSnapshots: [],
      rawSnapshots: [],
      citations: [],
      sections: [],
    },
  };
  const schema = {
    domain: 'fmcg', types: [{ id: 'concept', label: '概念', description: '' }], categories: [{ id: 'industry_basics', label: '行业基础' }],
    enums: { knowledge_status: ['source_supported'], confidence: ['low'], source_level: ['C'] }, pageTemplates: {},
    sourcePolicy: { levels: [{ id: 'C', label: 'C', description: '' }], guidance: '' },
  };
  const pendingRead = deferred<Response>();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/raw') return jsonResponse({ items: [raw] });
    if (url === `/api/raw/${rawId}`) return jsonResponse(raw);
    if (url === '/api/stats') return jsonResponse({ rawCount: 1, wikiCount: 0, thisWeekNewCount: 0, pendingConfirmationCount: 1, openAuditCount: 0, promptCount: 0, weekStartsOn: '' });
    if (url === '/api/raw-processing') return jsonResponse({ items: [] });
    if (url === '/api/home/actions') return jsonResponse({ items: [], sources: { draft: { status: 'ok' }, workflow: { status: 'ok' } } });
    if (url === '/api/work-items' || url.startsWith('/api/work-items?')) return jsonResponse({ items: [] });
    if (url === '/api/knowledge/workflows') return jsonResponse({ items: [] });
    if (url === `/api/drafts/${outcomeDraftId}`) return jsonResponse(outcomeDraft);
    if (url === `/api/drafts/${maintenanceDraftId}`) return jsonResponse(maintenanceDraft);
    if (url === `/api/drafts/${inputDraftId}`) return jsonResponse(inputDraft);
    if (url === '/api/drafts/pending-draft') return pendingRead.promise;
    if (url.includes('/duplicates')) return jsonResponse({ draftId: outcomeDraftId, pageId: 'page-1', draftRevision: 1, decision: null, targetWikiId: null, candidates: [] });
    if (url === '/api/wiki/schema') return jsonResponse(schema);
    if (url === '/api/wiki' || url.startsWith('/api/wiki?')) return jsonResponse({ items: [], categoryCounts: {} });
    if (url.startsWith('/api/drafts?')) return jsonResponse({ items: [] });
    if (url === '/api/news/today' || url === '/api/news/today/ensure') {
      return jsonResponse({ date: '2026-11-18', aiEnabled: false, edition: { schemaVersion: 1, date: '2026-11-18', updatedAt: '2026-11-18T00:00:00Z', sections: {} }, fallbacks: {} });
    }
    if (url === '/api/news/history' || url.includes('/saved-raws')) return jsonResponse({ items: [], errors: [] });
    if (url === '/api/automation/status') {
      return jsonResponse({
        paused: false,
        scheduler: { healthy: true, lastTickAt: null },
        instance: { pid: 1, port: 4317, mode: 'development', startedAt: '2026-11-18T00:00:00Z', hostname: 'localhost' },
        nextRunAt: null,
        failuresLast24Hours: 0,
        writeToken: 'auto-token',
      });
    }
    if (url === '/api/automation/schedules') {
      return jsonResponse({
        items: [{
          type: 'news.daily', name: '每日资讯', enabled: true,
          plan: { kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' },
          catchUp: false, revision: 1, budget: null, nextRunAt: null, lastRun: null, mayCallModel: false, allowsCatchUp: true,
        }],
        issues: [],
      });
    }
    if (url.startsWith('/api/automation/runs')) return jsonResponse({ items: [], issues: [] });
    if (url === '/api/automation/pipeline/settings') return jsonResponse({ revision: 1, preScreenEnabled: false, concurrency: 2, topics: [] });
    if (url.startsWith('/api/automation/candidates')) {
      return jsonResponse({
        date: '2026-11-18',
        dates: ['2026-11-18'],
        items: [{
          id: '2026-11-18/fmcg/news-outcome',
          section: 'fmcg',
          disposition: 'inbox',
          draftPending: true,
          execution: { runId: 'run-outcome', draftId: outcomeDraftId, phase: 'draft_ready' },
          item: { id: 'news-outcome', title: '带 outcomeDigest 候选', sourceId: 's', sourceName: '测试来源', url: 'https://example.test/outcome', publishedAt: '2026-11-18', fetchedAt: '2026-11-18T00:00:00Z', excerpt: '摘录', evidenceKind: 'article_excerpt' },
        }],
        counts: { fetched: 1, pending: 0, organizing: 0, drafts: 1, failed: 0 },
      });
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: `Unexpected ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  let root = createRoot(container);
  try {
    // 1. App 完整路径：自动化收件箱打开含 outcomeDigest 的草稿 -> 实际走入 RawOutcomeReview，返回按钮显示“返回自动化”并回到自动化
    await act(async () => { root.render(createElement(App)); await tick(); });
    await click(findButton(container.querySelector('.sidebar')!, '自动化'));
    await waitFor(() => !!maybeButton(container, '审核草稿'), '自动化收件箱候选就绪');
    await click(findButton(container, '审核草稿'));
    await waitFor(() => container.querySelector('h1')?.textContent === '整理成果', '带 outcomeDigest 草稿必须走入 RawOutcomeReview');
    assert.ok(container.querySelector('.raw-outcome'), '必须渲染 RawOutcomeReview 页面结构');
    assert.equal(container.querySelector('.breadcrumb')?.textContent, '工作空间 / AI 知识整理预览');
    const backBtn = findButton(container.querySelector('.draft-page .heading-actions')!, '返回自动化');
    assert.equal(backBtn.textContent, '返回自动化');
    await click(backBtn);
    await waitFor(() => container.querySelector('h1')?.textContent === '自动化', '点击“返回自动化”回到自动化页面');
    assert.ok(container.querySelector('#news-candidates'));
    await act(async () => { root.unmount(); });

    // 2. DraftReviewPage 加载兜底态 (!view)：显式传 backLabel 时使用 backLabel，未传时保持 '返回'
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(DraftReviewPage, { draftId: 'pending-draft', backLabel: '返回工作台', onBack: () => {}, onCommitted: async () => {}, onOpenRaw: () => {} }));
      await tick();
    });
    assert.equal(findButton(container, '返回工作台').textContent, '返回工作台');
    await act(async () => { root.unmount(); });

    root = createRoot(container);
    await act(async () => {
      root.render(createElement(DraftReviewPage, { draftId: 'pending-draft', onBack: () => {}, onCommitted: async () => {}, onOpenRaw: () => {} }));
      await tick();
    });
    assert.equal(findButton(container, '返回').textContent, '返回');
    await act(async () => { root.unmount(); });

    // 3. KnowledgeMaintenanceReview 透传验证（view.maintenance 显式传 backLabel，view.input 未传保持默认 '返回知识库'）
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(DraftReviewPage, { draftId: maintenanceDraftId, backLabel: '返回自动化', onBack: () => {}, onCommitted: async () => {}, onOpenRaw: () => {} }));
      await tick();
    });
    await waitFor(() => container.querySelector('h1')?.textContent === '审核知识变更', '加载 maintenance 草稿');
    assert.equal(findButton(container.querySelector('.draft-page .heading-actions')!, '返回自动化').textContent, '返回自动化');
    await act(async () => { root.unmount(); });

    root = createRoot(container);
    await act(async () => {
      root.render(createElement(DraftReviewPage, { draftId: inputDraftId, onBack: () => {}, onCommitted: async () => {}, onOpenRaw: () => {} }));
      await tick();
    });
    await waitFor(() => container.querySelector('h1')?.textContent === '审核知识变更', '加载 input 草稿');
    assert.equal(findButton(container.querySelector('.draft-page .heading-actions')!, '返回知识库').textContent, '返回知识库');
    await act(async () => { root.unmount(); });

    // 4. 直接挂载 RawOutcomeReview 不传 backLabel 时默认保持 '返回'
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(RawOutcomeReview, {
        view: outcomeDraft, body: raw.body, onView: () => {}, onBack: () => {}, onOpenRaw: () => {},
        onCommitted: async () => {}, advanced: null, advancedDirty: false, advancedBusy: false,
      }));
      await tick();
    });
    assert.equal(findButton(container.querySelector('.draft-page .heading-actions')!, '返回').textContent, '返回');
  } finally {
    pendingRead.resolve(jsonResponse({ error: { message: 'cleanup' } }, 404));
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U1-03: Raw 多来源综合弹窗使用标准遮罩/焦点/Escape/防重入，Raw 删除弹窗支持 Escape 与焦点还原', async () => {
  const raw1: Raw = {
    id: 'raw-1', title: '来源甲', sourceType: 'article', sourceName: '报刊甲', tags: [],
    body: '甲正文', importedAt: '2026-11-18T00:00:00.000Z', status: 'unprocessed', bodySha256: '1'.repeat(64),
  };
  const raw2: Raw = {
    id: 'raw-2', title: '来源乙', sourceType: 'report', sourceName: '研报乙', tags: [],
    body: '乙正文', importedAt: '2026-11-18T00:00:00.000Z', status: 'unprocessed', bodySha256: '2'.repeat(64),
  };
  const sourceWiki: Wiki = {
    id: 'wiki-src-1', title: '来源摘要甲', type: 'source', domain: 'fmcg', category: 'industry_basics', aliases: [], tags: [],
    sources: ['raw-1'], body: '摘要', revision: 1, created: '2026-11-18', updated: '2026-11-18',
    knowledge_status: 'source_supported', review_status: 'reviewed', confidence: 'low', source_level: 'C',
  };

  const synthesisGate = deferred<Response>();
  const deleteGate = deferred<Response>();
  let synthesisPosts = 0;
  let openedWorkflow = '';
  let deletedId = '';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/knowledge/workflows') return jsonResponse({ items: [] });
    if (url === '/api/wiki') return jsonResponse({ items: [sourceWiki] });
    if (url === '/api/knowledge/syntheses' && method === 'POST') {
      synthesisPosts += 1;
      return synthesisGate.promise;
    }
    if (url === `/api/raw/${raw1.id}/references`) return jsonResponse({ items: [] });
    if (url === `/api/raw/${raw1.id}` && method === 'DELETE') return deleteGate.promise;
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(RawPage, {
        items: [raw1, raw2],
        selectedId: raw1.id,
        onSelected: () => {},
        onOpenImport: () => {},
        onCommitted: async () => {},
        openImport: false,
        onCloseImport: () => {},
        onDeleted: async id => { deletedId = id; },
        processing: {},
        job: null,
        onJobStarted: () => {},
        onOpenDraft: () => {},
        onOpenWorkflow: id => { openedWorkflow = id; },
        onRefresh: async () => {},
      }));
      await tick();
    });

    // 1. SynthesisDialog 遮罩/标准类名/焦点捕获与 Escape 关闭
    const synthesisBtn = findButton(container, '多来源综合');
    synthesisBtn.focus();
    await click(synthesisBtn);
    await waitFor(() => !!container.querySelector('.modal-scrim .synthesis-dialog'), '打开 SynthesisDialog');
    assert.equal(container.querySelector('.modal-backdrop'), null, '不得继续使用未定义 .modal-backdrop');
    assert.equal(container.querySelector('.confirm-dialog'), null, '不得继续使用未定义 .confirm-dialog');
    const synthDialog = container.querySelector('section.panel.import-dialog.synthesis-dialog[role="dialog"][aria-modal="true"]') as HTMLElement;
    assert.ok(synthDialog, 'SynthesisDialog 必须具备标准类名与 ARIA 属性');
    assert.equal(synthDialog.getAttribute('aria-labelledby'), 'synthesis-dialog-title');
    assert.ok(synthDialog.contains(window.document.activeElement), '打开时焦点必须进入 SynthesisDialog');

    await pressEscape(window.document.activeElement);
    assert.equal(container.querySelector('.synthesis-dialog'), null, '非提交中按 Escape 应关闭 SynthesisDialog');
    assert.equal(window.document.activeElement, synthesisBtn, '关闭后焦点应还原到触发按钮');

    // 2. 点击遮罩关闭 & synthesisBusy 防重入
    synthesisBtn.focus();
    await click(synthesisBtn);
    await waitFor(() => !!container.querySelector('.synthesis-dialog'), '再次打开 SynthesisDialog');
    const scrim = container.querySelector('.modal-scrim') as HTMLElement;
    await act(async () => {
      scrim.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await tick();
    });
    assert.equal(container.querySelector('.synthesis-dialog'), null, '非提交中点击遮罩应关闭');

    synthesisBtn.focus();
    await click(synthesisBtn);
    await waitFor(() => !!container.querySelector('.synthesis-dialog'), '第三次打开 SynthesisDialog');
    const checkboxes = [...container.querySelectorAll('.synthesis-dialog input[type="checkbox"]')] as HTMLInputElement[];
    assert.ok(checkboxes.length >= 2);
    const submitBtn = findButton(container, '生成 Synthesis 草稿');
    assert.equal(submitBtn.disabled, true, '少于两条来源时提交按钮禁用');

    await click(checkboxes[0]);
    await click(checkboxes[1]);
    assert.equal(submitBtn.disabled, false, '选满两条不同来源后提交按钮可用');

    await click(submitBtn);
    await waitFor(() => maybeButton(container, '正在生成…')?.disabled === true, '进入 synthesisBusy 防重入态');
    const busySubmit = findButton(container, '正在生成…');
    const cancelBtn = findButton(container.querySelector('.synthesis-dialog')!, '取消');
    const closeBtn = container.querySelector('.synthesis-dialog button[aria-label="关闭"]') as HTMLButtonElement;
    assert.equal(busySubmit.disabled, true);
    assert.equal(cancelBtn.disabled, true);
    assert.equal(closeBtn.disabled, true);

    await pressEscape(window.document.activeElement);
    await act(async () => {
      (container.querySelector('.modal-scrim') as HTMLElement).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      await tick();
    });
    assert.ok(container.querySelector('.synthesis-dialog'), '请求期间 Escape 与遮罩均不可关闭弹窗');
    assert.equal(synthesisPosts, 1, '请求期间重复点击不能重入提交');

    synthesisGate.resolve(jsonResponse({ id: 'wf-synth-1' }));
    await waitFor(() => container.querySelector('.synthesis-dialog') === null, '请求完成后自动关闭 SynthesisDialog');
    assert.equal(openedWorkflow, 'wf-synth-1');

    // 3. Raw DeleteDialog Escape 关闭、焦点还原与 deleting 防重入
    const rawDeleteBtn = findButton(container.querySelector('.raw-detail')!, '删除');
    rawDeleteBtn.focus();
    await click(rawDeleteBtn);
    await waitFor(() => !!container.querySelector('[role="dialog"][aria-labelledby="delete-title"]'), '打开 Raw DeleteDialog');
    const deleteDialog = container.querySelector('[role="dialog"][aria-labelledby="delete-title"]') as HTMLElement;
    assert.ok(deleteDialog.contains(window.document.activeElement), 'Raw DeleteDialog 应捕获焦点');

    await pressEscape(window.document.activeElement);
    assert.equal(container.querySelector('[role="dialog"]'), null, '空闲时 Escape 关闭 Raw DeleteDialog');
    assert.equal(window.document.activeElement, rawDeleteBtn, 'Raw DeleteDialog 关闭后焦点还原');

    // deleting 期间不可 Escape / 遮罩关闭
    rawDeleteBtn.focus();
    await click(rawDeleteBtn);
    await waitFor(() => maybeButton(container, '确认删除')?.disabled === false, 'Raw 引用检查完成');
    await click(findButton(container, '确认删除'));
    await waitFor(() => maybeButton(container, '正在删除…')?.disabled === true, 'Raw 删除请求进行中');
    await pressEscape(window.document.activeElement);
    assert.ok(container.querySelector('[role="dialog"]'), 'deleting 期间 Escape 不应关闭弹窗');
    deleteGate.resolve(jsonResponse({ id: raw1.id, title: raw1.title, assetId: null, assetRetained: false, warnings: [] }));
    await waitFor(() => container.querySelector('[role="dialog"]') === null, 'Raw 删除完成后关闭弹窗');
    assert.equal(deletedId, raw1.id);
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U1-03: WikiPage 与 PromptLibraryPage 删除弹窗支持 Escape 关闭、焦点还原与提交中防关闭', async () => {
  const wikiA: Wiki = {
    id: 'wiki-a', title: '测试概念甲', type: 'concept', domain: 'fmcg', category: 'industry_basics', aliases: [], tags: [], sources: [],
    body: '甲正文', revision: 1, created: '2026-11-18', updated: '2026-11-18',
    knowledge_status: 'needs_verification', review_status: 'unreviewed', confidence: 'low', source_level: 'D', links: [],
  };
  const wikiSchema = {
    types: [{ id: 'concept', label: '概念' }], categories: [{ id: 'industry_basics', label: '行业基础' }], pageTemplates: {},
    enums: { knowledge_status: ['needs_verification'], confidence: ['low'], source_level: ['D'], review_status: ['unreviewed'] },
    sourcePolicy: { levels: [], guidance: '' },
  };
  const wikiDeleteGate = deferred<Response>();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/wiki/schema') return jsonResponse(wikiSchema);
    if (url.startsWith('/api/raw?') || url.startsWith('/api/drafts?') || url === '/api/knowledge/workflows' || url.startsWith('/api/audits?')) return jsonResponse({ items: [] });
    if (url.startsWith('/api/wiki?')) return jsonResponse({ items: [wikiA], categoryCounts: { industry_basics: 1 } });
    if (url === '/api/wiki/wiki-a' && method === 'GET') return jsonResponse(wikiA);
    if (url === '/api/wiki/wiki-a/references') return jsonResponse({ items: [] });
    if (url === '/api/wiki/wiki-a' && method === 'DELETE') return wikiDeleteGate.promise;
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  let root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(WikiPage, { onOpenRaw: () => {}, onChanged: () => {} }));
      await tick();
    });
    await waitFor(() => !!container.querySelector('.wiki-detail button.danger-quiet'), 'Wiki 详情加载完成');
    const wikiDeleteBtn = container.querySelector('.wiki-detail button.danger-quiet') as HTMLButtonElement;
    wikiDeleteBtn.focus();
    await click(wikiDeleteBtn);
    await waitFor(() => !!container.querySelector('section.delete-dialog[role="dialog"]'), '打开 WikiDeleteDialog');
    const wikiDialog = container.querySelector('section.delete-dialog[role="dialog"]') as HTMLElement;
    assert.ok(wikiDialog.contains(window.document.activeElement), 'WikiDeleteDialog 应捕获焦点');

    await pressEscape(window.document.activeElement);
    assert.equal(container.querySelector('section.delete-dialog'), null, 'Escape 应关闭 WikiDeleteDialog');
    assert.equal(window.document.activeElement, wikiDeleteBtn, 'WikiDeleteDialog 关闭后焦点应还原到删除按钮');

    wikiDeleteBtn.focus();
    await click(wikiDeleteBtn);
    await waitFor(() => !!container.querySelector('section.delete-dialog[role="dialog"]'), '再次打开 WikiDeleteDialog');
    await click(findButton(container, '确认删除'));
    await waitFor(() => maybeButton(container, '正在删除…')?.disabled === true, 'Wiki 删除进行中');
    await pressEscape(window.document.activeElement);
    assert.ok(container.querySelector('section.delete-dialog'), 'Wiki busy 期间 Escape 不应关闭');
    wikiDeleteGate.resolve(jsonResponse({ id: 'wiki-a', deleted: true }));
    await waitFor(() => container.querySelector('section.delete-dialog') === null, 'Wiki 删除完成后关闭弹窗');
  } finally {
    await act(async () => { root.unmount(); });
  }

  // PromptLibraryPage PromptDeleteDialog
  const promptA: Prompt = {
    id: '11111111-1111-4111-8111-111111111111', name: '删除测试 Prompt', category: 'office', scenario: '测试',
    body: '请整理内容。', variables: [], inputRequirements: '', outputRequirements: '', relatedWikiIds: [], examples: '',
    tags: [], favorite: false, createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', version: 1, source: 'manual',
  };
  const promptDeleteGate = deferred<Response>();
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/prompts/schema') return jsonResponse({ categories: [{ id: 'office', label: '日常办公', help: '' }] });
    if (url === '/api/wiki') return jsonResponse({ items: [] });
    if (url === '/api/prompts' || url.startsWith('/api/prompts?')) return jsonResponse({ items: [promptA], categoryCounts: { office: 1 } });
    if (url === `/api/prompts/${promptA.id}` && method === 'GET') return jsonResponse({ prompt: promptA, wikiLinks: [] });
    if (url === `/api/prompts/${promptA.id}/versions`) return jsonResponse({ items: [] });
    if (url.includes('/feedback?')) return jsonResponse({ items: [] });
    if (url === `/api/prompts/${promptA.id}` && method === 'DELETE') return promptDeleteGate.promise;
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(PromptLibraryPage, { onChanged: () => {}, onOpenWiki: () => {} }));
      await tick();
    });
    await waitFor(() => !!container.querySelector('.prompt-detail button.danger-quiet'), 'Prompt 详情加载完成');
    const promptDeleteBtn = container.querySelector('.prompt-detail button.danger-quiet') as HTMLButtonElement;
    promptDeleteBtn.focus();
    await click(promptDeleteBtn);
    await waitFor(() => !!container.querySelector('section.delete-dialog[aria-labelledby="prompt-delete-title"]'), '打开 PromptDeleteDialog');
    const promptDialog = container.querySelector('section.delete-dialog[aria-labelledby="prompt-delete-title"]') as HTMLElement;
    assert.ok(promptDialog.contains(window.document.activeElement), 'PromptDeleteDialog 应捕获焦点');

    await pressEscape(window.document.activeElement);
    assert.equal(container.querySelector('section.delete-dialog'), null, 'Escape 应关闭 PromptDeleteDialog');
    assert.equal(window.document.activeElement, promptDeleteBtn, 'PromptDeleteDialog 关闭后焦点应还原到删除按钮');

    promptDeleteBtn.focus();
    await click(promptDeleteBtn);
    await waitFor(() => !!container.querySelector('section.delete-dialog[aria-labelledby="prompt-delete-title"]'), '再次打开 PromptDeleteDialog');
    await click(findButton(container, '确认删除'));
    await waitFor(() => maybeButton(container, '正在删除…')?.disabled === true, 'Prompt 删除进行中');
    await pressEscape(window.document.activeElement);
    assert.ok(container.querySelector('section.delete-dialog'), 'Prompt busy 期间 Escape 不应关闭');
    promptDeleteGate.resolve(jsonResponse({ id: promptA.id, deleted: true }));
    await waitFor(() => container.querySelector('section.delete-dialog') === null, 'Prompt 删除完成后关闭弹窗');
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U1-04: NewsPage 返回工作台、栏目锚点及手动检查更新加载态文案切换', async () => {
  const date = '2026-11-18';
  const view = {
    date,
    aiEnabled: true,
    edition: {
      schemaVersion: 1,
      date,
      updatedAt: '2026-11-18T00:00:00Z',
      sections: {
        fmcg: { contentVersion: 'research-v1', status: 'source_only', attempt: 1, startedAt: '2026-11-18T00:00:00Z', sources: [], items: [] },
        ai: { status: 'source_only', attempt: 1, startedAt: '2026-11-18T00:00:00Z', sources: [], items: [] },
      },
    },
    fallbacks: {},
    recentFmcg: [],
  };

  let checkGate = deferred<Response>();
  let backCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (url === '/api/news/today') return jsonResponse(view);
    if (url === '/api/news/history' || url.includes('/saved-raws')) return jsonResponse({ items: [], errors: [] });
    if (url === '/api/news/today/check' && init.method === 'POST') return checkGate.promise;
    return jsonResponse({ error: { message: `Unexpected ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(NewsPage, { onBack: () => { backCalls += 1; } }));
      await tick();
    });
    await waitFor(() => !!container.querySelector('#news-section-fmcg') && !!container.querySelector('#news-section-ai'), 'NewsPage 渲染完成');

    // 返回工作台按钮
    await click(findButton(container, '返回工作台'));
    assert.equal(backCalls, 1, '点击返回工作台应触发 onBack');

    // 栏目锚点导航
    const jump = container.querySelector('nav.news-jump[aria-label="栏目定位"]');
    assert.ok(jump, '工具栏内必须渲染栏目快速定位导航');
    const links = [...jump.querySelectorAll('a')];
    assert.deepEqual(links.map(a => [a.getAttribute('href'), a.textContent]), [
      ['#news-section-fmcg', '快消研报与洞察'],
      ['#news-section-ai', 'AI 前沿'],
    ]);
    assert.ok(container.querySelector('section#news-section-fmcg.news-section'));
    assert.ok(container.querySelector('section#news-section-ai.news-section'));

    // 检查更新按钮文案切换（all 模式）
    const fmcgSection = container.querySelector('#news-section-fmcg')!;
    const aiSection = container.querySelector('#news-section-ai')!;
    await click(findButton(fmcgSection, '检查更新'));
    await waitFor(() => maybeButton(fmcgSection, '正在检查更新…')?.disabled === true, '点击检查更新后显示“正在检查更新…”并禁用');
    assert.equal(findButton(fmcgSection, '仅补抓失败来源').disabled, true, '同栏目补抓按钮同步禁用');
    assert.equal(findButton(aiSection, '检查更新').disabled, false, '其他栏目不受影响');

    checkGate.resolve(jsonResponse(view));
    await waitFor(() => maybeButton(fmcgSection, '检查更新')?.disabled === false, '检查更新完成后按钮恢复空闲文案');

    // 仅补抓失败来源按钮文案切换（failed 模式）
    checkGate = deferred<Response>();
    await click(findButton(fmcgSection, '仅补抓失败来源'));
    await waitFor(() => maybeButton(fmcgSection, '正在补抓失败来源…')?.disabled === true, '点击仅补抓失败来源后显示“正在补抓失败来源…”并禁用');
    assert.equal(findButton(fmcgSection, '检查更新').textContent, '检查更新');
    assert.equal(findButton(fmcgSection, '检查更新').disabled, true);

    checkGate.resolve(jsonResponse(view));
    await waitFor(() => maybeButton(fmcgSection, '仅补抓失败来源')?.disabled === false, '补抓完成后恢复“仅补抓失败来源”');
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U1-05: SettingsPage 未保存修改时明确展示测试连接禁用原因，保存或还原后消失', async () => {
  let config: LlmConfigSummary = {
    provider: 'openai-compatible',
    baseUrlHost: 'api.example.test',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-a',
    keyConfigured: true,
    keyMask: '••••••••••••',
    configured: true,
    source: 'local-file',
    missing: [],
    configFile: '.env.local',
    envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' },
    revision: 'r1',
    writeToken: 'write-token',
    environmentLocked: false,
  };
  const saveGate = deferred<Response>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/llm/config' && method === 'GET') return jsonResponse(config);
    if (url === '/api/llm/config' && method === 'PUT') return saveGate.promise;
    if (url === '/api/demo') return jsonResponse({ version: 1, imported: false, items: [], exampleTask: { title: '示例', task: '示例任务' } });
    return jsonResponse({});
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(SettingsPage)); await tick(); });
    await waitFor(() => !(container.querySelector('input[aria-label="模型 ID"]') as HTMLInputElement).disabled, '配置读取完成');

    const modelInput = container.querySelector('input[aria-label="模型 ID"]') as HTMLInputElement;
    assert.equal(container.querySelector('.settings-unsaved-hint'), null, '未修改时不应显示未保存提示');
    assert.equal(findButton(container, '测试连接').disabled, false, '未修改且已配置时测试连接可用');

    // 修改模型 ID：显示未保存提示并禁用测试连接
    await changeInput(modelInput, 'model-b');
    const hint = container.querySelector('.settings-unsaved-hint');
    assert.ok(hint, '修改配置后应显示未保存提示');
    assert.equal(hint.getAttribute('role'), 'status');
    assert.equal(hint.textContent, '有未保存的修改，请先点击「保存配置」后再测试连接。');
    assert.equal(findButton(container, '测试连接').disabled, true, '存在未保存修改时禁用测试连接');

    // 还原修改：未保存提示消失，测试连接恢复可用
    await changeInput(modelInput, 'model-a');
    assert.equal(container.querySelector('.settings-unsaved-hint'), null, '还原改动后未保存提示应消失');
    assert.equal(findButton(container, '测试连接').disabled, false);

    // 再次修改并点击保存：保存中隐藏，保存成功后不再出现
    await changeInput(modelInput, 'model-c');
    assert.ok(container.querySelector('.settings-unsaved-hint'));
    await click(findButton(container, '保存配置'));
    await waitFor(() => maybeButton(container, '处理中…')?.disabled === true, '进入保存中状态');
    assert.equal(container.querySelector('.settings-unsaved-hint'), null, '保存请求期间不显示未保存提示');

    config = { ...config, model: 'model-c', revision: 'r2' };
    saveGate.resolve(jsonResponse(config));
    await waitFor(() => container.textContent?.includes('本机配置已保存') === true, '保存完成');
    assert.equal(container.querySelector('.settings-unsaved-hint'), null, '保存成功后未保存提示消失');
    assert.equal(findButton(container, '测试连接').disabled, false, '保存成功后测试连接恢复可用');
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});
