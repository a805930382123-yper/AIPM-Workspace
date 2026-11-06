import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { HomeAction } from '../services/home/actions.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, MouseEvent: window.MouseEvent,
  FormData: window.FormData, File: window.File, Blob: window.Blob, Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../app/App.tsx');

const rawId = '11111111-1111-4111-8111-111111111111';
const draftId = '22222222-2222-4222-8222-222222222222';
const workflowId = '33333333-3333-4333-8333-333333333333';
const raw = {
  id: rawId, title: '导航测试 Raw', sourceType: 'note', sourceName: '内存夹具', tags: [], body: '虚构来源事实。',
  importedAt: '2026-10-14T00:00:00.000Z', status: 'unprocessed', bodySha256: 'a'.repeat(64),
};
const draft = {
  id: draftId, rawId, rawTitle: raw.title, title: '导航测试草稿', status: 'pending_confirmation', revision: 1,
  provider: { name: 'memory', model: 'fixture' }, rulesVersion: 'locator-v2-test',
  document: { title: '导航测试草稿', main_topic: '导航', summary: '测试摘要' },
  source: { title: raw.title, summary: '摘要', body: '摘要', key_takeaways: [], category: 'other', knowledge_status: 'source_supported', confidence: 'low', source_level: 'C' },
  pages: [{ pageId: 'page-1', title: '导航测试建议', type: 'concept', category: 'industry_basics', one_line_definition: '虚构定义',
    source_facts: [{ text: '虚构来源事实', evidenceIds: ['e1'] }], ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [],
    source_evidence: [{ id: 'e1', rawId, quote: '虚构来源事实。', start: 0, end: 8, chunkIndex: 0 }], selected: true, knowledge_status: 'source_supported', confidence: 'low', source_level: 'C' }],
  warnings: [], extraction: { callCount: 1, chunkCount: 1, pagesFound: 1 },
  preview: { rawExists: true, rawSha256Matches: true, sourceReuse: null, sourceAmbiguous: null, titleConflicts: [], batchDuplicateTitles: [] },
  raw: { id: rawId, title: raw.title, sourceType: 'note', sourceName: '内存夹具', author: null, publishedAt: null, url: null, importedAt: raw.importedAt, bodySha256: raw.bodySha256 },
};
const workflowSummary = { id: workflowId, kind: 'update', status: 'pending_confirmation', title: '导航测试更新工作流', revision: 1, createdAt: '', updatedAt: '', targetWikiId: 'wiki-fixture', lastCommitError: null, commitOperationId: null };
const workflowAction: HomeAction = {
  kind: 'workflow', id: workflowId, title: workflowSummary.title, problem: '待确认', result: '草稿已保存，待审核',
  action: '查看工作流', updatedAt: raw.importedAt, priority: 1, target: { workflowId, revision: 1 }, versionToken: 'test-workflow-v1',
};
const workflow = {
  id: workflowId, kind: 'update', status: 'pending_confirmation', revision: 1, title: '导航测试更新工作流', category: 'industry_basics',
  provider: { name: 'memory', model: 'fixture' }, rawSnapshots: [], targetWikiId: 'wiki-fixture', baseRevision: 1,
  sections: { existing: '旧内容', newSource: '新来源', suggestedAdditions: ['建议'], conflicts: [], inferences: [], openQuestions: [], agreement: [], sourceList: [] },
  sources: [], evidence: [],
};
const schema = { domain: 'fmcg', types: [{ id: 'concept', label: '概念', description: '' }], categories: [{ id: 'industry_basics', label: '行业基础' }],
  enums: { knowledge_status: ['source_supported'], confidence: ['low'], source_level: ['C'] }, pageTemplates: {}, sourcePolicy: { levels: [{ id: 'C', label: 'C', description: '' }], guidance: '' } };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function installFetch() {
  const actionReads: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/raw') return response({ items: [raw] });
    if (url === '/api/wiki') return response({ items: [] });
    if (url === '/api/home/actions') return response({ items: [workflowAction], sources: { workflow: { status: 'ok' } } });
    if (url.startsWith('/api/home/actions/workflow/')) {
      actionReads.push(url);
      if (url === `/api/home/actions/workflow/${workflowId}?versionToken=${workflowAction.versionToken}`) return response(workflowAction);
    }
    if (url === '/api/stats') return response({ rawCount: 1, wikiCount: 0, thisWeekNewCount: 0, pendingConfirmationCount: 1, openAuditCount: 0, promptCount: 0, weekStartsOn: '' });
    if (url === '/api/raw-processing') return response({ items: [{ rawId, status: 'pending_confirmation', updatedAt: '', draftId }] });
    if (url === '/api/knowledge/workflows') return response({ items: [workflowSummary] });
    if (url === `/api/knowledge/workflows/${workflowId}`) return response(workflow);
    if (url === `/api/raw/${rawId}/references`) return response({ items: [] });
    if (url === `/api/raw/${rawId}`) return response(raw);
    if (url === `/api/drafts/${draftId}`) return response(draft);
    if (url === `/api/knowledge/drafts/${draftId}/pages/page-1/duplicates`) return response({ draftId, pageId: 'page-1', draftRevision: 1, decision: null, targetWikiId: null, candidates: [] });
    if (url === '/api/wiki/schema') return response(schema);
    if (url.startsWith('/api/wiki?')) return response({ items: [], categoryCounts: {} });
    if (url.startsWith('/api/drafts?')) return response({ items: [{ id: draftId, rawId, rawTitle: raw.title, title: draft.title, updatedAt: '' }] });
    return response({ error: { code: 'NOT_FOUND', message: `Unexpected test route ${url}` } }, 404);
  }) as typeof fetch;
  return actionReads;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail(`等待超时：${label}`);
}
function button(container: ParentNode, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => (item.textContent ?? '').includes(label));
  assert.ok(found, `找不到按钮：${label}`);
  return found as HTMLButtonElement;
}
async function click(element: HTMLElement) {
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(); });
}
async function mountApp() {
  const actionReads = installFetch();
  const container = window.document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  await act(async () => { root.render(createElement(App)); await tick(); });
  return { container, actionReads, unmount: async () => { await act(async () => root.unmount()); } };
}

test('App侧栏导航：草稿→Raw清除审核覆盖，工作流→首页/Raw退出工作流且Raw选择保留', async () => {
  const fromDraft = await mountApp();
  try {
    await click(button(fromDraft.container, 'Raw 原始资料'));
    await waitFor(() => !![...fromDraft.container.querySelectorAll('button')].find(item => item.textContent?.includes('继续审核')), 'Raw继续审核入口');
    await click(button(fromDraft.container, '继续审核'));
    await waitFor(() => fromDraft.container.querySelector('h1')?.textContent?.includes('审核「导航测试草稿」') === true, '打开实际草稿组件');
    await click(button(fromDraft.container, 'Raw 原始资料'));
    await waitFor(() => fromDraft.container.querySelector('h1')?.textContent === 'Raw 原始资料', '侧栏返回Raw');
    assert.equal(fromDraft.container.querySelector('h1')?.textContent, 'Raw 原始资料', '导航必须退出草稿审核覆盖');
    assert.match(fromDraft.container.textContent ?? '', /导航测试 Raw/, 'Raw页应恢复并保留原选择');
    assert.match(fromDraft.container.querySelector('.raw-list-panel button.raw-list-item.selected')?.textContent ?? '', /导航测试 Raw/, '侧栏导航应保留原Raw选择');
    assert.equal(fromDraft.container.textContent?.includes('审核「导航测试草稿」'), false);
  } finally { await fromDraft.unmount(); }

  const workflowToHome = await mountApp();
  try {
    await waitFor(() => !!workflowToHome.container.querySelector('.home-action-row button'), '首页待审核工作流');
    const action = workflowToHome.container.querySelector('.home-action-row')!;
    assert.match(action.textContent ?? '', /导航测试更新工作流/);
    await click(button(action, '查看工作流'));
    await waitFor(() => workflowToHome.container.querySelector('h1')?.textContent === '审阅更新建议', '打开实际工作流组件');
    assert.deepEqual(workflowToHome.actionReads, [`/api/home/actions/workflow/${workflowId}?versionToken=${workflowAction.versionToken}`]);
    await click(button(workflowToHome.container.querySelector('.sidebar')!, '首页'));
    await waitFor(() => workflowToHome.container.querySelector('.home-page h1')?.textContent === '工作台', '侧栏返回首页');
    assert.equal(workflowToHome.container.querySelector('h1')?.textContent, '工作台', '导航必须退出工作流审核覆盖');
  } finally { await workflowToHome.unmount(); }

  const workflowToRaw = await mountApp();
  try {
    await click(button(workflowToRaw.container, 'Raw 原始资料'));
    await waitFor(() => !!workflowToRaw.container.querySelector('.pending-knowledge-workflows button'), 'Raw待审核工作流');
    await click(button(workflowToRaw.container, '导航测试更新工作流'));
    await waitFor(() => workflowToRaw.container.querySelector('h1')?.textContent === '审阅更新建议', 'Raw中打开实际工作流组件');
    await click(button(workflowToRaw.container, 'Raw 原始资料'));
    await waitFor(() => workflowToRaw.container.querySelector('h1')?.textContent === 'Raw 原始资料', '工作流侧栏返回Raw');
    assert.match(workflowToRaw.container.textContent ?? '', /导航测试 Raw/, 'Raw列表与原始选择应恢复');
    assert.match(workflowToRaw.container.querySelector('.raw-list-panel button.raw-list-item.selected')?.textContent ?? '', /导航测试 Raw/, '工作流导航应保留原Raw选择');
    assert.equal(workflowToRaw.container.querySelector('h1')?.textContent?.includes('审阅更新建议'), false);
  } finally { await workflowToRaw.unmount(); }
});
