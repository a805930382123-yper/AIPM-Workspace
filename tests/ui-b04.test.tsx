// B04 DOM interaction tests (jsdom, real components, stubbed fetch):
// settings masking, Raw AI actions and status, review editing/merge/discard/confirm and the
// partial-commit panel. Real HTTP behaviour of the same endpoints is covered in llm-http.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { DraftView, Raw } from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, MouseEvent: window.MouseEvent,
  FormData: window.FormData, File: window.File, Blob: window.Blob, Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawPage } = await import('../app/pages/RawPage.tsx');
const { SettingsPage } = await import('../app/pages/SettingsPage.tsx');
const { DraftReviewPage } = await import('../app/pages/DraftReviewPage.tsx');

const KEY = 'sk-live-should-never-be-rendered';
const reply = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }) as unknown as Response;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const byText = (text: string, root: ParentNode = window.document) =>
  [...root.querySelectorAll('button')].find(button => (button.textContent ?? '').includes(text)) as HTMLButtonElement | undefined;
const required = <T,>(value: T | null | undefined, what: string): T => { assert.ok(value, `找不到${what}`); return value; };
/** The per-page "写入" checkboxes, in card order. */
const writeBoxes = (root: ParentNode) =>
  [...root.querySelectorAll('input[type="checkbox"]')].filter(input => (input.closest('label')?.textContent ?? '').includes('写入'));
async function click(target: HTMLElement) {
  await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(); });
}
async function setChecked(target: HTMLInputElement, checked: boolean) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
    setter?.call(target, checked);
    target.dispatchEvent(new window.Event('click', { bubbles: true }));
    target.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
}
async function mount(element: React.ReactElement) {
  const container = window.document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  await act(async () => { root.render(element); await tick(); await tick(); });
  return { root, container, unmount: async () => { await act(async () => { root.unmount(); }); } };
}

function makeRaw(overrides: Partial<Raw> = {}): Raw {
  return {
    id: '11111111-1111-4111-8111-111111111111', title: '渠道动销资料', sourceType: 'article', sourceName: '来源',
    tags: ['渠道'], body: '渠道动销分析：动销率衡量门店销售速度。\n经销商库存周转。', importedAt: '2026-10-05T00:00:00.000Z',
    status: 'unprocessed', bodySha256: 'a'.repeat(64), ...overrides,
  };
}
function makeDraft(overrides: Partial<DraftView> = {}): DraftView {
  const evidence = { id: 'e1', rawId: makeRaw().id, quote: '动销率衡量门店销售速度', start: 8, end: 20, chunkIndex: 0 };
  return {
    id: '22222222-2222-4222-8222-222222222222', rawId: makeRaw().id, rawTitle: '渠道动销资料',
    status: 'pending_confirmation', revision: 3, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z',
    rulesVersion: 'b04-b04-1-abcdef123456', provider: { name: 'openai-compatible', model: 'fake-model' }, jobId: 'job-1',
    document: { title: '渠道动销资料', main_topic: '动销', summary: '摘要' },
    pages: [
      {
        pageId: 'page-1', title: '动销率', type: 'metric', category: 'metric', one_line_definition: '衡量门店动销的指标',
        source_facts: [{ text: '动销率衡量门店销售速度', evidenceIds: ['e1'] }], ai_organized: ['整理'], ai_inferences: ['推断'],
        related_pages: [], open_questions: ['口径待确认'], source_evidence: [evidence],
        knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'C', selected: false, provenance: [{ chunkIndex: 0, start: 0, end: 40 }],
      },
      {
        pageId: 'page-2', title: '库存周转', type: 'concept', category: 'supply_chain', one_line_definition: '库存周转说明',
        source_facts: [{ text: '经销商库存周转', evidenceIds: ['e1'] }], ai_organized: [], ai_inferences: [], related_pages: [],
        open_questions: [], source_evidence: [evidence], knowledge_status: 'source_supported', confidence: 'medium',
        source_level: 'C', selected: true, provenance: [{ chunkIndex: 0, start: 0, end: 40 }],
      },
    ],
    source: { title: '渠道动销资料', category: 'other', summary: '摘要', key_takeaways: ['要点'], body: '## 摘要\n\n摘要\n', knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C' },
    warnings: [], extraction: { callCount: 1, chunkCount: 1, pagesFound: 2 },
    preview: { rawExists: true, rawSha256Matches: true, sourceReuse: null, sourceAmbiguous: null, titleConflicts: [], batchDuplicateTitles: [] },
    raw: { id: makeRaw().id, title: '渠道动销资料', sourceType: 'article', sourceName: '来源', author: null, publishedAt: null, url: null, importedAt: '2026-10-05T00:00:00.000Z', bodySha256: 'a'.repeat(64) },
    ...overrides,
  };
}

type Stub = { calls: Array<{ url: string; method: string; body: string | null }>; setDraft: (draft: DraftView) => void; setConfig: (config: unknown) => void };
function stubFetch(options: { draft?: DraftView; config?: unknown; confirmResponse?: () => Response } = {}): Stub {
  let draft = options.draft ?? makeDraft();
  let config = options.config ?? { provider: 'openai-compatible', baseUrlHost: 'llm.example.com', model: 'fake-model', keyConfigured: true, keyMask: '••••••••••••', configured: true, source: 'env', missing: [], configFile: 'E:/x/.env.local', envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' } };
  const calls: Stub['calls'] = [];
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init.body === undefined ? null : String(init.body) });
    if (url === '/api/llm/config') return reply(config);
    if (url === '/api/raw') return reply({ items: [makeRaw()] });
    if (url === '/api/raw-processing') return reply({ items: [] });
    if (url === '/api/stats') return reply({ rawCount: 1, wikiCount: 0, thisWeekNewCount: 1, pendingConfirmationCount: 1, openAuditCount: 0, promptCount: 0, weekStartsOn: '2026-10-05' });
    if (url === '/api/wiki/schema') return reply({
      domain: 'fmcg',
      types: [{ id: 'source', label: '来源摘要', description: '' }, { id: 'concept', label: '概念', description: '' }, { id: 'entity', label: '业务实体', description: '' }, { id: 'business_process', label: '业务流程', description: '' }, { id: 'metric', label: '业务指标', description: '' }, { id: 'synthesis', label: '综合整理', description: '' }],
      categories: [{ id: 'industry_basics', label: '行业基础' }, { id: 'metric', label: '数据指标' }, { id: 'supply_chain', label: '供应链' }],
      enums: { knowledge_status: ['source_supported', 'ai_organized', 'inferred', 'needs_verification', 'verified'], confidence: ['high', 'medium', 'low'], source_level: ['A', 'B', 'C', 'D'], review_status: ['reviewed', 'unreviewed'] },
      pageTemplates: { concept: { sections: [] }, entity: { sections: [] }, business_process: { sections: [] }, metric: { sections: [] }, source: { sections: [] }, synthesis: { sections: [] } },
      sourcePolicy: { levels: [{ id: 'A', label: 'A 级', description: '' }, { id: 'B', label: 'B 级', description: '' }, { id: 'C', label: 'C 级', description: '' }, { id: 'D', label: 'D 级', description: '' }], guidance: 'g' },
    });
    if (url.endsWith('/extract') && method === 'POST') return reply({ jobId: 'job-1', rawId: makeRaw().id, status: 'running', stage: 'extracting', progress: { chunksTotal: 2, chunksDone: 0, pagesFound: 0 }, draftId: null, error: null, provider: { name: 'openai-compatible', model: 'fake-model' }, callCount: 0, startedAt: '2026-10-05T00:00:00.000Z', finishedAt: null, cancelRequested: false, reused: false }, 202);
    if (url.includes('/api/extraction-jobs/') && url.endsWith('/cancel')) return reply({ jobId: 'job-1', status: 'cancelled', cancelled: true });
    if (url.startsWith('/api/extraction-jobs/')) return reply({ jobId: 'job-1', rawId: makeRaw().id, status: 'running', stage: 'extracting', progress: { chunksTotal: 2, chunksDone: 1, pagesFound: 1 }, draftId: null, error: null, provider: { name: 'openai-compatible', model: 'fake-model' }, callCount: 1, startedAt: '2026-10-05T00:00:00.000Z', finishedAt: null, cancelRequested: false });
    if (url.startsWith('/api/drafts/') && url.endsWith('/confirm') && method === 'POST') return (options.confirmResponse ? options.confirmResponse() : reply({ operationId: '33333333-3333-4333-8333-333333333333', status: 'completed', reused: false, sourceReused: false, sourceId: 'source-1', wikiIds: ['wiki-1'], writtenWikiIds: ['source-1', 'wiki-1'], warnings: [], phases: [] }, 201));
    if (url.startsWith('/api/drafts/') && url.endsWith('/discard') && method === 'POST') return reply({ id: draft.id, status: 'discarded', rawId: draft.rawId });
    if (url.startsWith('/api/drafts/') && method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { pages?: Array<{ pageId: string; title?: string; selected?: boolean }>; deletePageIds?: string[]; merge?: { pageIds: string[] } };
      if (body.deletePageIds?.length) draft = { ...draft, revision: draft.revision + 1, pages: draft.pages.filter(page => !body.deletePageIds?.includes(page.pageId)) };
      else if (body.merge) draft = { ...draft, revision: draft.revision + 1, pages: [{ ...draft.pages[0], pageId: 'merged-1', title: '合并后的知识页', mergedFrom: ['动销率', '库存周转'] }] };
      else if (body.pages) draft = { ...draft, revision: draft.revision + 1, pages: draft.pages.map(page => ({ ...page, ...(body.pages?.find(item => item.pageId === page.pageId) ?? {}) })) };
      return reply(draft);
    }
    if (url.startsWith('/api/drafts/')) return reply(draft);
    if (url.startsWith('/api/raw/')) return reply(makeRaw());
    if (url.startsWith('/api/wiki-commits/')) return reply({ operationId: '33333333-3333-4333-8333-333333333333', draftId: draft.id, rawId: draft.rawId, status: 'failed', createdAt: '', updatedAt: '', completedAt: null, phases: [{ name: 'source', status: 'done' }, { name: 'pages', status: 'done' }, { name: 'index', status: 'failed', error: 'EISDIR' }, { name: 'log', status: 'pending' }, { name: 'state', status: 'pending' }], writtenWikiIds: ['source-1'], sourceId: 'source-1', wikiIds: ['wiki-1'], selectedPageIds: [], error: { code: 'COMMIT_FAILED', message: 'index 写入失败' }, recoveryHint: '解除磁盘故障后重启工作台会自动继续这个 operationId。', warnings: [] });
    return reply({}, 404);
  }) as unknown as typeof fetch;
  return { calls, setDraft: (next: DraftView) => { draft = next; }, setConfig: (next: unknown) => { config = next as typeof config; } };
}

const rawPageProps = (overrides: Record<string, unknown> = {}) => ({
  items: [makeRaw()], selectedId: makeRaw().id, onSelected: () => undefined, onOpenImport: () => undefined,
  onCommitted: async () => undefined, openImport: false, onCloseImport: () => undefined, onDeleted: async () => undefined,
  processing: {}, job: null, onJobStarted: () => undefined, onOpenDraft: () => undefined, onRefresh: async () => undefined,
  ...overrides,
});

test('B04 设置页：显示 Provider/模型/掩码，绝不显示 Key', async () => {
  // The extra field simulates a leaky response: the UI must still not render it.
  const leakyConfig = {
    provider: 'openai-compatible', baseUrlHost: 'llm.example.com', model: 'fake-model', keyConfigured: true,
    keyMask: '••••••••••••', configured: true, source: 'env', missing: [], configFile: 'E:/x/.env.local',
    envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' }, injectedKey: KEY,
  };
  stubFetch({ config: leakyConfig });
  const mounted = await mount(<SettingsPage />);
  try {
    const html = mounted.container.innerHTML;
    assert.match(html, /openai-compatible/);
    assert.match(html, /fake-model/);
    assert.match(html, /••••••••/);
    assert.match(html, /已配置/);
    assert.match(html, /FMCG_LLM_API_KEY/);
    assert.equal(html.includes(KEY), false, '设置页绝不能渲染 Key');
    assert.match(html, /重启服务端/);
  } finally { await mounted.unmount(); }
});

test('B04 设置页：未配置时给出缺失项与手动链路提示', async () => {
  stubFetch({ config: { provider: 'openai-compatible', baseUrlHost: null, model: null, keyConfigured: false, keyMask: '••••••••••••', configured: false, source: 'none', missing: ['FMCG_LLM_BASE_URL', 'FMCG_LLM_MODEL', 'FMCG_LLM_API_KEY'], configFile: 'E:/x/.env.local', envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' } } });
  const mounted = await mount(<SettingsPage />);
  try {
    assert.match(mounted.container.innerHTML, /未配置/);
    assert.match(mounted.container.innerHTML, /FMCG_LLM_BASE_URL/);
    assert.match(mounted.container.innerHTML, /导入、手动 Wiki、搜索与导出仍可用/);
  } finally { await mounted.unmount(); }
});

test('B04 Raw 详情：五种状态与 AI 整理/取消/继续审核入口', async () => {
  const stub = stubFetch();
  const mounted = await mount(<RawPage {...rawPageProps()} />);
  try {
    assert.match(mounted.container.innerHTML, /未处理/);
    assert.ok(byText('AI 整理知识', mounted.container));
    await click(required(byText('AI 整理知识', mounted.container), 'AI 整理按钮'));
    const extract = stub.calls.find(call => call.url.endsWith('/extract'));
    assert.ok(extract, '必须调用 POST /api/raw/:id/extract');
    assert.equal(extract?.method, 'POST');
  } finally { await mounted.unmount(); }

  const stopped = await mount(<RawPage {...rawPageProps({
    processing: { [makeRaw().id]: { rawId: makeRaw().id, status: 'processing', updatedAt: '', jobId: 'job-1' } },
    job: { jobId: 'job-1', rawId: makeRaw().id, status: 'running', stage: 'extracting', progress: { chunksTotal: 3, chunksDone: 1, pagesFound: 2 }, draftId: null, error: null, provider: { name: 'openai-compatible', model: 'fake-model' }, callCount: 1, startedAt: '', finishedAt: null, cancelRequested: false },
  })} />);
  try {
    assert.match(stopped.container.innerHTML, /AI 处理中/);
    assert.match(stopped.container.innerHTML, /调用 Provider 提取/);
    assert.match(stopped.container.innerHTML, /第 2\/3 段/);
    assert.ok(byText('取消整理', stopped.container));
    await click(required(byText('取消整理', stopped.container), '取消按钮'));
    assert.ok(stub.calls.some(call => call.url.endsWith('/cancel')), '取消必须调用 cancel 接口');
  } finally { await stopped.unmount(); }

  const pending = await mount(<RawPage {...rawPageProps({
    processing: { [makeRaw().id]: { rawId: makeRaw().id, status: 'pending_confirmation', updatedAt: '', jobId: 'job-1', draftId: 'draft-1' } },
  })} />);
  try {
    assert.match(pending.container.innerHTML, /待人工确认/);
    await click(required(byText('继续审核', pending.container), '继续审核按钮'));
  } finally { await pending.unmount(); }

  const failed = await mount(<RawPage {...rawPageProps({
    processing: { [makeRaw().id]: { rawId: makeRaw().id, status: 'failed', updatedAt: '', lastError: { code: 'LLM_TIMEOUT', message: '调用超时', at: '', retryable: true } } },
  })} />);
  try {
    assert.match(failed.container.innerHTML, /处理失败/);
    assert.match(failed.container.innerHTML, /LLM_TIMEOUT/);
    assert.match(failed.container.innerHTML, /可以重试/);
    assert.ok(byText('重试 AI 整理', failed.container));
  } finally { await failed.unmount(); }

  const generated = await mount(<RawPage {...rawPageProps({
    processing: { [makeRaw().id]: { rawId: makeRaw().id, status: 'generated', updatedAt: '', generatedWikiIds: ['wiki-1', 'wiki-2'] } },
  })} />);
  try {
    assert.match(generated.container.innerHTML, /已生成知识/);
    assert.match(generated.container.innerHTML, /wiki-1/);
  } finally { await generated.unmount(); }
});

test('B04 审核页：分栏预览、选择与确认只提交选中项', async () => {
  const stub = stubFetch();
  const mounted = await mount(<DraftReviewPage draftId={makeDraft().id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    const html = mounted.container.innerHTML;
    assert.match(html, /AI 知识整理预览/);
    assert.match(html, /来源事实/);
    assert.match(html, /AI 整理/);
    assert.match(html, /AI 推断/);
    assert.match(html, /待确认问题/);
    assert.match(html, /来源证据/);
    assert.match(html, /Source 预览/);
    assert.match(html, /已选 1 条/);
    assert.equal(html.includes(KEY), false);
    // Select the second page too, then confirm: both ids must be sent with an idempotency key.
    const boxes = writeBoxes(mounted.container);
    assert.equal(boxes.length, 2);
    await setChecked(boxes[0] as HTMLInputElement, true);
    assert.match(mounted.container.innerHTML, /已选 2 条/);
    await click(required(byText('确认写入 Wiki', mounted.container), '确认按钮'));
    // F04-02: confirming first persists the on-screen snapshot, then commits that revision.
    const callsBeforeConfirm = stub.calls.map(call => call.method + ' ' + call.url);
    const confirmIndex = stub.calls.findIndex(call => call.url.endsWith('/confirm'));
    assert.ok(confirmIndex > 0, '必须调用确认接口');
    const saveBefore = stub.calls[confirmIndex - 1];
    assert.equal(saveBefore.method, 'PATCH', '确认之前必须先保存当前编辑快照');
    assert.ok(callsBeforeConfirm[confirmIndex].endsWith('/confirm'));
    const saved = JSON.parse(String(saveBefore.body)) as { source?: { title?: string }; pages?: Array<{ pageId: string; selected: boolean }> };
    assert.ok(saved.source, '保存必须带上 Source 的编辑');
    assert.equal(saved.pages?.find(page => page.pageId === 'page-1')?.selected, true);
    const confirm = stub.calls[confirmIndex];
    const body = JSON.parse(String(confirm.body)) as { selectedPageIds: string[]; idempotencyKey: string; baseRevision: number };
    assert.deepEqual(body.selectedPageIds.sort(), ['page-1', 'page-2']);
    assert.equal(body.baseRevision, 4, '确认必须使用保存后的 revision');
    assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/i);
  } finally { await mounted.unmount(); }
});

test('B04 审核页：Source 编辑与页面编辑一起持久化，且不丢 Raw 元数据', async () => {
  const stub = stubFetch();
  const mounted = await mount(<DraftReviewPage draftId={makeDraft().id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    const titleInput = mounted.container.querySelector('.draft-source-summary input') as HTMLInputElement;
    assert.ok(titleInput, '必须存在 Source 标题输入框');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(titleInput, '人工写入的 Source 标题');
      titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      await tick();
    });
    const sourceBody = mounted.container.querySelector('.draft-source-summary textarea') as HTMLTextAreaElement;
    assert.ok(sourceBody, '必须存在 Source 正文输入框');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(sourceBody, '## 摘要\n\n人工改写的 Source 正文。\n');
      sourceBody.dispatchEvent(new window.Event('input', { bubbles: true }));
      await tick();
    });
    await click(required(byText('保存草稿', mounted.container), '保存按钮'));
    const patch = stub.calls.find(call => call.method === 'PATCH');
    const body = JSON.parse(String(patch?.body)) as { source?: { title?: string; body?: string } };
    assert.equal(body.source?.title, '人工写入的 Source 标题', 'Source 标题必须随保存持久化');
    assert.match(String(body.source?.body), /人工改写的 Source 正文/);
    // The PATCH response must keep the Raw metadata so the panel does not go blank (F04-01).
    assert.match(mounted.container.innerHTML, /渠道动销资料/);
    assert.match(mounted.container.innerHTML, /正文/);
  } finally { await mounted.unmount(); }
});

test('B04 审核页：新草稿默认全不选，零选择不能确认', async () => {
  const draft = makeDraft({ pages: makeDraft().pages.map(page => ({ ...page, selected: false })) });
  const stub = stubFetch({ draft });
  const mounted = await mount(<DraftReviewPage draftId={draft.id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    assert.match(mounted.container.innerHTML, /已选 0 条/, '默认不选任何建议');
    assert.match(mounted.container.innerHTML, /默认没有选中任何知识建议/);
    assert.equal(required(byText('确认写入 Wiki', mounted.container), '确认按钮').disabled, true, '零选择时确认按钮不可用');
    await click(required(byText('全选', mounted.container), '全选按钮'));
    assert.match(mounted.container.innerHTML, /已选 2 条/);
    await click(required(byText('全不选', mounted.container), '全不选按钮'));
    assert.match(mounted.container.innerHTML, /已选 0 条/);
    writeBoxes(mounted.container)[1] && await setChecked(writeBoxes(mounted.container)[1] as HTMLInputElement, true);
    assert.match(mounted.container.innerHTML, /已选 1 条/);
    assert.equal(required(byText('确认写入 Wiki', mounted.container), '确认按钮').disabled, false);
    assert.equal(stub.calls.some(call => call.url.endsWith('/confirm')), false, '仅勾选不应触发确认');
  } finally { await mounted.unmount(); }
});

test('B04 审核页：保存编辑、删除、合并与放弃都走明确的接口', async () => {
  const stub = stubFetch();
  const mounted = await mount(<DraftReviewPage draftId={makeDraft().id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    await click(required(byText('保存草稿', mounted.container), '保存按钮'));
    const patch = stub.calls.find(call => call.method === 'PATCH');
    assert.ok(patch, '保存必须调用 PATCH');
    const body = JSON.parse(String(patch?.body)) as { baseRevision: number; pages: Array<{ pageId: string; source_level: string }> };
    assert.equal(body.baseRevision, 3);
    assert.equal(body.pages.length, 2);
    assert.equal(typeof body.pages[0].source_level, 'string');

    await click(required(byText('删除', mounted.container), '删除按钮'));
    const deleteCall = stub.calls.filter(call => call.method === 'PATCH').at(-1);
    assert.deepEqual((JSON.parse(String(deleteCall?.body)) as { deletePageIds?: string[] }).deletePageIds, ['page-1']);
    assert.equal([...mounted.container.querySelectorAll('.draft-card')].length, 1, '删除后只剩一条建议');
    assert.equal(byText('删除', mounted.container)?.disabled, true, '最后一条建议不能删除');

    await click(required(byText('放弃草稿', mounted.container), '放弃按钮'));
    assert.match(mounted.container.innerHTML, /放弃这份草稿/);
    await click(required(byText('确认放弃', mounted.container), '确认放弃按钮'));
    assert.ok(stub.calls.some(call => call.url.endsWith('/discard')), '放弃必须调用 discard 接口');
  } finally { await mounted.unmount(); }

  // A separate review session for merging (two original suggestions).
  const mergeStub = stubFetch();
  const merging = await mount(<DraftReviewPage draftId={makeDraft().id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    const mergeBoxes = [...merging.container.querySelectorAll('input[type="checkbox"]')].filter(input => (input.closest('label')?.textContent ?? '').includes('合并'));
    assert.equal(mergeBoxes.length, 2);
    await setChecked(mergeBoxes[0] as HTMLInputElement, true);
    await setChecked(mergeBoxes[1] as HTMLInputElement, true);
    await click(required(byText('合并所选', merging.container), '合并按钮'));
    const mergeCall = mergeStub.calls.filter(call => call.method === 'PATCH').at(-1);
    assert.equal((JSON.parse(String(mergeCall?.body)) as { merge?: { pageIds: string[] } }).merge?.pageIds.length, 2);
    assert.match(merging.container.innerHTML, /合并后的知识页/, '合并结果必须重新载入草稿');
    assert.match(merging.container.innerHTML, /由合并生成/);
  } finally { await merging.unmount(); }
});

test('B04 审核页：冲突提示与部分提交面板', async () => {
  const conflict = makeDraft({ preview: { rawExists: true, rawSha256Matches: true, sourceReuse: null, sourceAmbiguous: null, titleConflicts: [{ title: '动销率', existingId: 'existing-1', existingTitle: '动销率', kind: 'strong' }], batchDuplicateTitles: [] } });
  stubFetch({ draft: conflict });
  const blocked = await mount(<DraftReviewPage draftId={conflict.id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    assert.match(blocked.container.innerHTML, /冲突/);
    assert.match(blocked.container.innerHTML, /existing-1/);
    assert.match(blocked.container.innerHTML, /仍创建新页/);
  } finally { await blocked.unmount(); }

  const partial = stubFetch({ confirmResponse: () => reply({ error: { code: 'COMMIT_FAILED', message: 'index 写入失败，已部分提交', details: { committed: true, recoverable: true, operationId: '33333333-3333-4333-8333-333333333333' } } }, 500) });
  const stubbed = await mount(<DraftReviewPage draftId={makeDraft().id} onBack={() => undefined} onCommitted={async () => undefined} onOpenRaw={() => undefined} />);
  try {
    await click(required(byText('确认写入 Wiki', stubbed.container), '确认按钮'));
    const html = stubbed.container.innerHTML;
    assert.match(html, /index 写入失败，已部分提交/);
    assert.match(html, /未完成 \/ 待恢复|完成/);
    assert.match(html, /33333333-3333-4333-8333-333333333333/);
    assert.match(html, /重启工作台会自动继续/);
    assert.match(html, /请勿重复确认同一份草稿/);
    assert.ok(partial.calls.some(call => call.url.startsWith('/api/wiki-commits/')));
  } finally { await stubbed.unmount(); }
});

