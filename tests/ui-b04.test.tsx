// B04 DOM interaction tests (jsdom, real components, stubbed fetch):
// settings masking, Raw AI actions and status, review editing/merge/discard/confirm and the
// partial-commit panel. Real HTTP behaviour of the same endpoints is covered in llm-http.test.ts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { RawDraftView as DraftView, Raw } from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const [name, value] of Object.entries({
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  FormData: window.FormData,
  File: window.File,
  Blob: window.Blob,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawPage } = await import('../app/pages/RawPage.tsx');
const { SettingsPage } = await import('../app/pages/SettingsPage.tsx');
const { DraftReviewPage } = await import('../app/pages/DraftReviewPage.tsx');

const KEY = 'sk-live-should-never-be-rendered';
const reply = (data: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }) as unknown as Response;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const byText = (text: string, root: ParentNode = window.document) =>
  [...root.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(text)) as
    HTMLButtonElement | undefined;
const required = <T,>(value: T | null | undefined, what: string): T => {
  assert.ok(value, `找不到${what}`);
  return value;
};
/** The per-page "写入" checkboxes, in card order. */
const writeBoxes = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((input) =>
    (input.closest('label')?.textContent ?? '').includes('写入'),
  );
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
  });
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
  await act(async () => {
    root.render(element);
    await tick();
    await tick();
  });
  return {
    root,
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function makeRaw(overrides: Partial<Raw> = {}): Raw {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: '渠道动销资料',
    sourceType: 'article',
    sourceName: '来源',
    tags: ['渠道'],
    body: '渠道动销分析：动销率衡量门店销售速度。\n经销商库存周转。',
    importedAt: '2026-10-05T00:00:00.000Z',
    status: 'unprocessed',
    bodySha256: 'a'.repeat(64),
    ...overrides,
  };
}
function makeDraft(overrides: Partial<DraftView> = {}): DraftView {
  const evidence = { id: 'e1', rawId: makeRaw().id, quote: '动销率衡量门店销售速度', start: 8, end: 20, chunkIndex: 0 };
  return {
    id: '22222222-2222-4222-8222-222222222222',
    rawId: makeRaw().id,
    rawTitle: '渠道动销资料',
    status: 'pending_confirmation',
    revision: 3,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    rulesVersion: 'b04-b04-1-abcdef123456',
    provider: { name: 'openai-compatible', model: 'fake-model' },
    jobId: 'job-1',
    document: { title: '渠道动销资料', main_topic: '动销', summary: '摘要' },
    pages: [
      {
        pageId: 'page-1',
        title: '动销率',
        type: 'metric',
        category: 'metric',
        one_line_definition: '衡量门店动销的指标',
        source_facts: [{ text: '动销率衡量门店销售速度', evidenceIds: ['e1'] }],
        ai_organized: ['整理'],
        ai_inferences: ['推断'],
        related_pages: [],
        open_questions: ['口径待确认'],
        source_evidence: [evidence],
        knowledge_status: 'ai_organized',
        confidence: 'medium',
        source_level: 'C',
        selected: false,
        provenance: [{ chunkIndex: 0, start: 0, end: 40 }],
      },
      {
        pageId: 'page-2',
        title: '库存周转',
        type: 'concept',
        category: 'supply_chain',
        one_line_definition: '库存周转说明',
        source_facts: [{ text: '经销商库存周转', evidenceIds: ['e1'] }],
        ai_organized: [],
        ai_inferences: [],
        related_pages: [],
        open_questions: [],
        source_evidence: [evidence],
        knowledge_status: 'source_supported',
        confidence: 'medium',
        source_level: 'C',
        selected: true,
        provenance: [{ chunkIndex: 0, start: 0, end: 40 }],
      },
    ],
    source: {
      title: '渠道动销资料',
      category: 'other',
      summary: '摘要',
      key_takeaways: ['要点'],
      body: '## 摘要\n\n摘要\n',
      knowledge_status: 'source_supported',
      confidence: 'medium',
      source_level: 'C',
    },
    warnings: [],
    extraction: { callCount: 1, chunkCount: 1, pagesFound: 2 },
    preview: {
      rawExists: true,
      rawSha256Matches: true,
      sourceReuse: null,
      sourceAmbiguous: null,
      titleConflicts: [],
      batchDuplicateTitles: [],
    },
    raw: {
      id: makeRaw().id,
      title: '渠道动销资料',
      sourceType: 'article',
      sourceName: '来源',
      author: null,
      publishedAt: null,
      url: null,
      importedAt: '2026-10-05T00:00:00.000Z',
      bodySha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

// This is an HTTP stub, not an approval shortcut: each page needs a separate UI
// request, tied to the server's current content digest and optimistic revision.
const stubDigest = (draft: DraftView) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        {
          id: draft.id,
          rawSha256: draft.raw?.bodySha256,
          document: draft.document,
          source: draft.source,
          pages: draft.pages.map((page) => ({
            ...page,
            source_evidence: page.source_evidence.map(({ chunkIndex: _chunk, ...evidence }) => evidence),
          })),
          basisDigest: draft.humanReview?.basisDigest,
          assignments: draft.humanReview?.assignments,
        },
        function (_key, value: unknown) {
          return value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
            : value;
        },
      ),
    )
    .digest('hex');

async function reviewPages(container: HTMLElement) {
  const start = byText('开始主题与归属审查', container);
  if (start) await click(start);
  const cards = [...container.querySelectorAll<HTMLElement>('.draft-card')];
  assert.ok(cards.length, '必须逐页显示审查对象');
  for (const [index, card] of cards.entries()) {
    if (index < cards.length - 1)
      assert.equal(
        required(byText('确认写入 Wiki', container), '最终确认').disabled,
        true,
        '缺少任一页确认时阻止正式写入',
      );
    await click(required(byText('确认本页主题与归属', card), '本页主题与归属确认'));
    assert.match(card.textContent ?? '', /本页主题与完整归属已确认/);
  }
}

async function saveAndReview(container: HTMLElement) {
  await click(required(byText('保存草稿', container), '保存按钮'));
  await reviewPages(container);
}

type Stub = {
  calls: Array<{ url: string; method: string; body: string | null }>;
  setDraft: (draft: DraftView) => void;
  setConfig: (config: unknown) => void;
  setDuplicateResponse: (handler: () => Response | Promise<Response>) => void;
};
function stubFetch(
  options: {
    draft?: DraftView;
    config?: unknown;
    confirmResponse?: () => Response;
    duplicateResponse?: () => Response | Promise<Response>;
    semanticResponse?: () => Response | Promise<Response>;
  } = {},
): Stub {
  let draft = options.draft ?? makeDraft();
  let duplicateResponse: () => Response | Promise<Response> =
    options.duplicateResponse ??
    (() =>
      reply({
        draftId: draft.id,
        pageId: 'page-1',
        draftRevision: draft.revision,
        decision: null,
        targetWikiId: null,
        candidates: [],
      }));
  let config = options.config ?? {
    provider: 'openai-compatible',
    baseUrlHost: 'llm.example.com',
    model: 'fake-model',
    keyConfigured: true,
    keyMask: '••••••••••••',
    configured: true,
    source: 'env',
    missing: [],
    configFile: 'E:/x/.env.local',
    envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' },
  };
  const calls: Stub['calls'] = [];
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init.body === undefined ? null : String(init.body) });
    if (url === '/api/llm/config') return reply(config);
    if (url === '/api/raw') return reply({ items: [makeRaw()] });
    if (url === '/api/raw-processing') return reply({ items: [] });
    if (url === '/api/stats')
      return reply({
        rawCount: 1,
        wikiCount: 0,
        thisWeekNewCount: 1,
        pendingConfirmationCount: 1,
        openAuditCount: 0,
        promptCount: 0,
        weekStartsOn: '2026-10-05',
      });
    if (url === '/api/wiki/schema')
      return reply({
        domain: 'fmcg',
        types: [
          { id: 'source', label: '来源摘要', description: '' },
          { id: 'concept', label: '概念', description: '' },
          { id: 'entity', label: '业务实体', description: '' },
          { id: 'business_process', label: '业务流程', description: '' },
          { id: 'metric', label: '业务指标', description: '' },
          { id: 'synthesis', label: '综合整理', description: '' },
        ],
        categories: [
          { id: 'industry_basics', label: '行业基础' },
          { id: 'metric', label: '数据指标' },
          { id: 'supply_chain', label: '供应链' },
        ],
        enums: {
          knowledge_status: ['source_supported', 'ai_organized', 'inferred', 'needs_verification', 'verified'],
          confidence: ['high', 'medium', 'low'],
          source_level: ['A', 'B', 'C', 'D'],
          review_status: ['reviewed', 'unreviewed'],
        },
        pageTemplates: {
          concept: { sections: [] },
          entity: { sections: [] },
          business_process: { sections: [] },
          metric: { sections: [] },
          source: { sections: [] },
          synthesis: { sections: [] },
        },
        sourcePolicy: {
          levels: [
            { id: 'A', label: 'A 级', description: '' },
            { id: 'B', label: 'B 级', description: '' },
            { id: 'C', label: 'C 级', description: '' },
            { id: 'D', label: 'D 级', description: '' },
          ],
          guidance: 'g',
        },
      });
    if (url.endsWith('/extract') && method === 'POST')
      return reply(
        {
          jobId: 'job-1',
          rawId: makeRaw().id,
          status: 'running',
          stage: 'extracting',
          progress: { chunksTotal: 2, chunksDone: 0, pagesFound: 0 },
          draftId: null,
          error: null,
          provider: { name: 'openai-compatible', model: 'fake-model' },
          callCount: 0,
          startedAt: '2026-10-05T00:00:00.000Z',
          finishedAt: null,
          cancelRequested: false,
          reused: false,
        },
        202,
      );
    if (url.includes('/api/extraction-jobs/') && url.endsWith('/cancel'))
      return reply({ jobId: 'job-1', status: 'cancelled', cancelled: true });
    if (url.startsWith('/api/extraction-jobs/'))
      return reply({
        jobId: 'job-1',
        rawId: makeRaw().id,
        status: 'running',
        stage: 'extracting',
        progress: { chunksTotal: 2, chunksDone: 1, pagesFound: 1 },
        draftId: null,
        error: null,
        provider: { name: 'openai-compatible', model: 'fake-model' },
        callCount: 1,
        startedAt: '2026-10-05T00:00:00.000Z',
        finishedAt: null,
        cancelRequested: false,
      });
    if (url.startsWith('/api/drafts/') && url.includes('/review/') && method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        baseRevision: number;
        reviewContentDigest?: string;
        confirmed?: boolean;
      };
      if (body.baseRevision !== draft.revision)
        return reply({ error: { code: 'REVISION_CONFLICT', message: '草稿版本已变化' } }, 409);
      if (url.endsWith('/review/start')) {
        if (!draft.humanReview) {
          const units = draft.pages.flatMap((page) =>
            [
              ...page.source_facts.map((fact, index) => ({
                id: `legacy-${page.pageId}-fact-${index}`,
                kind: 'fact' as const,
                origin: 'legacy' as const,
                text: fact.text,
                memberIds: [],
                records: [{ id: `fact-${index}`, text: fact.text, evidenceIds: fact.evidenceIds }],
                evidence: page.source_evidence.filter((e) => fact.evidenceIds.includes(e.id)),
                sourceLabel: '旧草稿来源事实',
              })),
              ...page.open_questions.map((text, index) => ({
                id: `legacy-${page.pageId}-question-${index}`,
                kind: 'question' as const,
                origin: 'legacy' as const,
                text,
                memberIds: [],
                records: [],
                evidence: [],
                sourceLabel: '旧草稿问题（无原文定位）',
              })),
            ].map((unit) => ({ unit, pageId: page.pageId })),
          );
          draft = {
            ...draft,
            humanReview: {
              version: 1,
              units: units.map((item) => item.unit),
              basisDigest: createHash('sha256')
                .update(JSON.stringify(units.map((item) => item.unit)))
                .digest('hex'),
              assignments: Object.fromEntries(units.map((item) => [item.unit.id, item.pageId])),
              approvals: [],
            },
          };
        }
      } else if (url.includes('/review/pages/')) {
        const pageId = decodeURIComponent(url.split('/').at(-1) ?? '');
        if (
          !draft.humanReview ||
          !draft.pages.some((page) => page.pageId === pageId) ||
          body.reviewContentDigest !== stubDigest(draft)
        )
          return reply({ error: { code: 'REVIEW_CONTENT_CHANGED', message: '请重新审查当前内容' } }, 409);
        const approvals = draft.humanReview.approvals.filter((item) => item.pageId !== pageId);
        if (body.confirmed) approvals.push({ pageId, digest: stubDigest(draft), at: '2026-10-23T00:00:00.000Z' });
        draft = { ...draft, humanReview: { ...draft.humanReview, approvals } };
      } else return reply({}, 404);
      draft = { ...draft, revision: draft.revision + 1, reviewContentDigest: stubDigest(draft) };
      return reply(draft);
    }
    if (url.startsWith('/api/drafts/') && url.endsWith('/confirm') && method === 'POST') {
      const body = JSON.parse(String(init.body)) as { baseRevision: number };
      const digest = stubDigest(draft);
      if (
        body.baseRevision !== draft.revision ||
        !draft.humanReview ||
        Object.values(draft.humanReview.assignments).some((id) => id === null) ||
        draft.pages.some(
          (page) => !draft.humanReview!.approvals.some((item) => item.pageId === page.pageId && item.digest === digest),
        )
      )
        return reply({ error: { code: 'HUMAN_REVIEW_INCOMPLETE', message: '必须逐页确认当前主题与归属' } }, 409);
      return options.confirmResponse
        ? options.confirmResponse()
        : reply(
            {
              operationId: '33333333-3333-4333-8333-333333333333',
              status: 'completed',
              reused: false,
              sourceReused: false,
              sourceId: 'source-1',
              wikiIds: ['wiki-1'],
              writtenWikiIds: ['source-1', 'wiki-1'],
              warnings: [],
              phases: [],
            },
            201,
          );
    }
    if (url.startsWith('/api/drafts/') && url.endsWith('/discard') && method === 'POST')
      return reply({ id: draft.id, status: 'discarded', rawId: draft.rawId });
    if (url.includes('/duplicates') && method === 'GET') return duplicateResponse();
    if (url.includes('/duplicates') && method === 'POST' && options.semanticResponse) return options.semanticResponse();
    if (url.includes('/decision') && method === 'PATCH') {
      const pageId = url.split('/').at(-2) ?? '';
      const body = JSON.parse(String(init.body)) as { decision: 'update' | 'create' | 'defer'; targetWikiId?: string };
      draft = {
        ...draft,
        revision: draft.revision + 1,
        pages: draft.pages.map((page) =>
          page.pageId === pageId
            ? { ...page, reviewDecision: body.decision, updateTargetWikiId: body.targetWikiId }
            : page,
        ),
      };
      if (draft.humanReview)
        draft = {
          ...draft,
          humanReview: { ...draft.humanReview, approvals: [] },
          reviewContentDigest: stubDigest(draft),
        };
      return reply({
        draftId: draft.id,
        revision: draft.revision,
        page: draft.pages.find((page) => page.pageId === pageId),
      });
    }
    if (url.startsWith('/api/drafts/') && method === 'PATCH') {
      const previousDigest = stubDigest(draft);
      const body = JSON.parse(String(init.body)) as {
        document?: DraftView['document'];
        source?: DraftView['source'];
        pages?: Array<{ pageId: string; title?: string; selected?: boolean }>;
        deletePageIds?: string[];
        merge?: { pageIds: string[] };
      };
      if (body.deletePageIds?.length)
        draft = {
          ...draft,
          revision: draft.revision + 1,
          pages: draft.pages.filter((page) => !body.deletePageIds?.includes(page.pageId)),
        };
      else if (body.merge)
        draft = {
          ...draft,
          revision: draft.revision + 1,
          pages: [
            { ...draft.pages[0], pageId: 'merged-1', title: '合并后的知识页', mergedFrom: ['动销率', '库存周转'] },
          ],
        };
      else if (body.pages)
        draft = {
          ...draft,
          revision: draft.revision + 1,
          pages: draft.pages.map((page) => ({
            ...page,
            ...(body.pages?.find((item) => item.pageId === page.pageId) ?? {}),
          })),
        };
      draft = { ...draft, document: body.document ?? draft.document, source: { ...draft.source, ...body.source } };
      if (draft.humanReview) {
        if (previousDigest !== stubDigest(draft))
          draft = { ...draft, humanReview: { ...draft.humanReview, approvals: [] } };
        draft = { ...draft, reviewContentDigest: stubDigest(draft) };
      }
      return reply(draft);
    }
    if (url.startsWith('/api/drafts/')) return reply(draft);
    if (url.startsWith('/api/raw/')) return reply(makeRaw());
    if (url.startsWith('/api/wiki-commits/'))
      return reply({
        operationId: '33333333-3333-4333-8333-333333333333',
        draftId: draft.id,
        rawId: draft.rawId,
        status: 'failed',
        createdAt: '',
        updatedAt: '',
        completedAt: null,
        phases: [
          { name: 'source', status: 'done' },
          { name: 'pages', status: 'done' },
          { name: 'index', status: 'failed', error: 'EISDIR' },
          { name: 'log', status: 'pending' },
          { name: 'state', status: 'pending' },
        ],
        writtenWikiIds: ['source-1'],
        sourceId: 'source-1',
        wikiIds: ['wiki-1'],
        selectedPageIds: [],
        error: { code: 'COMMIT_FAILED', message: 'index 写入失败' },
        recoveryHint: '解除磁盘故障后重启工作台会自动继续这个 operationId。',
        warnings: [],
      });
    return reply({}, 404);
  }) as unknown as typeof fetch;
  return {
    calls,
    setDraft: (next: DraftView) => {
      draft = next;
    },
    setConfig: (next: unknown) => {
      config = next as typeof config;
    },
    setDuplicateResponse: (handler: () => Response | Promise<Response>) => {
      duplicateResponse = handler;
    },
  };
}

const rawPageProps = (overrides: Record<string, unknown> = {}) => ({
  items: [makeRaw()],
  selectedId: makeRaw().id,
  onSelected: () => undefined,
  onOpenImport: () => undefined,
  onCommitted: async () => undefined,
  openImport: false,
  onCloseImport: () => undefined,
  onDeleted: async () => undefined,
  processing: {},
  job: null,
  onJobStarted: () => undefined,
  onOpenDraft: () => undefined,
  onRefresh: async () => undefined,
  ...overrides,
});

test('B04 设置页：显示 Provider/模型/掩码，绝不显示 Key', async () => {
  // The extra field simulates a leaky response: the UI must still not render it.
  const leakyConfig = {
    provider: 'openai-compatible',
    baseUrlHost: 'llm.example.com',
    model: 'fake-model',
    keyConfigured: true,
    keyMask: '••••••••••••',
    configured: true,
    source: 'env',
    missing: [],
    configFile: 'E:/x/.env.local',
    envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' },
    injectedKey: KEY,
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
  } finally {
    await mounted.unmount();
  }
});

test('B04 设置页：未配置时给出缺失项与手动链路提示', async () => {
  stubFetch({
    config: {
      provider: 'openai-compatible',
      baseUrlHost: null,
      model: null,
      keyConfigured: false,
      keyMask: '••••••••••••',
      configured: false,
      source: 'none',
      missing: ['FMCG_LLM_BASE_URL', 'FMCG_LLM_MODEL', 'FMCG_LLM_API_KEY'],
      configFile: 'E:/x/.env.local',
      envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' },
    },
  });
  const mounted = await mount(<SettingsPage />);
  try {
    assert.match(mounted.container.innerHTML, /未配置/);
    assert.match(mounted.container.innerHTML, /FMCG_LLM_BASE_URL/);
    assert.match(mounted.container.innerHTML, /导入、手动 Wiki、搜索与导出仍可用/);
  } finally {
    await mounted.unmount();
  }
});

test('B04 Raw 详情：五种状态与 AI 整理/取消/继续审核入口', async () => {
  const stub = stubFetch();
  let startedJobId: string | undefined;
  const mounted = await mount(
    <RawPage
      {...rawPageProps({
        onJobStarted: (job: { jobId: string }) => {
          startedJobId = job.jobId;
        },
      })}
    />,
  );
  try {
    assert.match(mounted.container.innerHTML, /未处理/);
    await click(required(byText('整理到知识库', mounted.container), 'Raw 整理入口'));
    const extract = stub.calls.find((call) => call.url.endsWith('/extract'));
    assert.ok(extract, '必须调用 POST /api/raw/:id/extract');
    assert.equal(extract?.method, 'POST');
    assert.deepEqual(JSON.parse(extract.body!), { mode: 'deep' });
    assert.equal(startedJobId, 'job-1');
  } finally {
    await mounted.unmount();
  }

  const stopped = await mount(
    <RawPage
      {...rawPageProps({
        processing: { [makeRaw().id]: { rawId: makeRaw().id, status: 'processing', updatedAt: '', jobId: 'job-1' } },
        job: {
          jobId: 'job-1',
          rawId: makeRaw().id,
          status: 'running',
          stage: 'extracting',
          progress: { chunksTotal: 3, chunksDone: 1, pagesFound: 2 },
          checkpoint: {
            stage: 'extracting',
            validatedChunks: 1,
            totalChunks: 3,
            attempts: 1,
            reusedChunks: 0,
            resumable: true,
          },
          draftId: null,
          error: null,
          provider: { name: 'openai-compatible', model: 'fake-model' },
          callCount: 1,
          startedAt: '',
          finishedAt: null,
          cancelRequested: false,
        },
      })}
    />,
  );
  try {
    assert.match(stopped.container.innerHTML, /AI 处理中/);
    assert.match(stopped.container.innerHTML, /提取精简事实/);
    assert.match(stopped.container.innerHTML, /已验证 1\/3 提取段/);
    assert.ok(byText('取消整理', stopped.container));
    await click(required(byText('取消整理', stopped.container), '取消按钮'));
    assert.ok(
      stub.calls.some((call) => call.url.endsWith('/cancel')),
      '取消必须调用 cancel 接口',
    );
  } finally {
    await stopped.unmount();
  }

  stub.setDraft(makeDraft({ id: 'draft-1' }));
  let openedDraftId: string | undefined;
  const pending = await mount(
    <RawPage
      {...rawPageProps({
        onOpenDraft: (id: string) => {
          openedDraftId = id;
        },
        processing: {
          [makeRaw().id]: {
            rawId: makeRaw().id,
            status: 'pending_confirmation',
            updatedAt: '',
            jobId: 'job-1',
            draftId: 'draft-1',
          },
        },
      })}
    />,
  );
  try {
    assert.match(pending.container.innerHTML, /待人工确认/);
    await click(required(byText('继续审核', pending.container), '继续审核按钮'));
    assert.equal(openedDraftId, 'draft-1');
  } finally {
    await pending.unmount();
  }

  const failed = await mount(
    <RawPage
      {...rawPageProps({
        processing: {
          [makeRaw().id]: {
            rawId: makeRaw().id,
            status: 'failed',
            updatedAt: '',
            lastError: { code: 'LLM_TIMEOUT', message: '调用超时', at: '', retryable: true },
          },
        },
      })}
    />,
  );
  try {
    assert.match(failed.container.innerHTML, /处理失败/);
    assert.match(failed.container.innerHTML, /LLM_TIMEOUT/);
    assert.match(failed.container.innerHTML, /可以重试/);
    assert.ok(byText('重试 AI 整理', failed.container));
  } finally {
    await failed.unmount();
  }

  const generated = await mount(
    <RawPage
      {...rawPageProps({
        processing: {
          [makeRaw().id]: {
            rawId: makeRaw().id,
            status: 'generated',
            updatedAt: '',
            generatedWikiIds: ['wiki-1', 'wiki-2'],
          },
        },
      })}
    />,
  );
  try {
    assert.match(generated.container.innerHTML, /已生成知识/);
    assert.match(generated.container.innerHTML, /wiki-1/);
  } finally {
    await generated.unmount();
  }
});

test('B04 审核页：分栏预览、选择与确认只提交选中项', async () => {
  const stub = stubFetch();
  const mounted = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
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
    assert.equal(
      required(byText('确认写入 Wiki', mounted.container), '确认按钮').disabled,
      true,
      '勾选页面不能代替逐页审查',
    );
    await saveAndReview(mounted.container);
    await click(required(byText('确认写入 Wiki', mounted.container), '确认按钮'));
    // F04-02: confirming first persists the on-screen snapshot, then commits that revision.
    const callsBeforeConfirm = stub.calls.map((call) => call.method + ' ' + call.url);
    const confirmIndex = stub.calls.findIndex((call) => call.url.endsWith('/confirm'));
    assert.ok(confirmIndex > 0, '必须调用确认接口');
    const saveBefore = stub.calls[confirmIndex - 1];
    assert.equal(saveBefore.method, 'PATCH', '确认之前必须先保存当前编辑快照');
    assert.ok(callsBeforeConfirm[confirmIndex].endsWith('/confirm'));
    const saved = JSON.parse(String(saveBefore.body)) as {
      source?: { title?: string };
      pages?: Array<{ pageId: string; selected: boolean }>;
    };
    assert.ok(saved.source, '保存必须带上 Source 的编辑');
    assert.equal(saved.pages?.find((page) => page.pageId === 'page-1')?.selected, true);
    const confirm = stub.calls[confirmIndex];
    const body = JSON.parse(String(confirm.body)) as {
      selectedPageIds: string[];
      idempotencyKey: string;
      baseRevision: number;
    };
    assert.deepEqual(body.selectedPageIds.sort(), ['page-1', 'page-2']);
    const lastPageReview = stub.calls.filter((call) => call.url.includes('/review/pages/')).at(-1);
    assert.ok(lastPageReview);
    assert.equal(
      body.baseRevision,
      JSON.parse(String(lastPageReview.body)).baseRevision + 2,
      '确认使用逐页审查及最后保存后的 revision',
    );
    assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/i);
  } finally {
    await mounted.unmount();
  }
});

test('B04 审核页：Source 编辑与页面编辑一起持久化，且不丢 Raw 元数据', async () => {
  const stub = stubFetch();
  const mounted = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
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
    const patch = stub.calls.find((call) => call.method === 'PATCH');
    const body = JSON.parse(String(patch?.body)) as { source?: { title?: string; body?: string } };
    assert.equal(body.source?.title, '人工写入的 Source 标题', 'Source 标题必须随保存持久化');
    assert.match(String(body.source?.body), /人工改写的 Source 正文/);
    // The PATCH response must keep the Raw metadata so the panel does not go blank (F04-01).
    assert.match(mounted.container.innerHTML, /渠道动销资料/);
    assert.match(mounted.container.innerHTML, /正文/);
  } finally {
    await mounted.unmount();
  }
});

test('B04 审核页：新草稿默认全不选，零选择不能确认', async () => {
  const draft = makeDraft({ pages: makeDraft().pages.map((page) => ({ ...page, selected: false })) });
  const stub = stubFetch({ draft });
  const mounted = await mount(
    <DraftReviewPage
      draftId={draft.id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    assert.match(mounted.container.innerHTML, /已选 0 条/, '默认不选任何建议');
    assert.match(mounted.container.innerHTML, /默认没有选中任何知识建议/);
    assert.equal(
      required(byText('确认写入 Wiki', mounted.container), '确认按钮').disabled,
      true,
      '零选择时确认按钮不可用',
    );
    await click(required(byText('全选', mounted.container), '全选按钮'));
    assert.match(mounted.container.innerHTML, /已选 2 条/);
    await click(required(byText('全不选', mounted.container), '全不选按钮'));
    assert.match(mounted.container.innerHTML, /已选 0 条/);
    writeBoxes(mounted.container)[1] && (await setChecked(writeBoxes(mounted.container)[1] as HTMLInputElement, true));
    assert.match(mounted.container.innerHTML, /已选 1 条/);
    assert.equal(required(byText('确认写入 Wiki', mounted.container), '确认按钮').disabled, true, '仅勾选不能替代审查');
    await saveAndReview(mounted.container);
    assert.equal(required(byText('确认写入 Wiki', mounted.container), '确认按钮').disabled, false);
    assert.equal(
      stub.calls.filter((call) => call.url.includes('/review/pages/')).length,
      2,
      '未选中的候选页也必须逐页确认',
    );
    assert.equal(
      stub.calls.some((call) => call.url.endsWith('/confirm')),
      false,
      '仅勾选不应触发确认',
    );
  } finally {
    await mounted.unmount();
  }
});

test('B04 审核页：保存编辑、删除、合并与放弃都走明确的接口', async () => {
  const stub = stubFetch();
  const mounted = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    await click(required(byText('保存草稿', mounted.container), '保存按钮'));
    const patch = stub.calls.find((call) => call.method === 'PATCH');
    assert.ok(patch, '保存必须调用 PATCH');
    const body = JSON.parse(String(patch?.body)) as {
      baseRevision: number;
      pages: Array<{ pageId: string; source_level: string }>;
    };
    assert.equal(body.baseRevision, 3);
    assert.equal(body.pages.length, 2);
    assert.equal(typeof body.pages[0].source_level, 'string');

    await click(required(byText('删除', mounted.container), '删除按钮'));
    const deleteCall = stub.calls.filter((call) => call.method === 'PATCH').at(-1);
    assert.deepEqual((JSON.parse(String(deleteCall?.body)) as { deletePageIds?: string[] }).deletePageIds, ['page-1']);
    assert.equal([...mounted.container.querySelectorAll('.draft-card')].length, 1, '删除后只剩一条建议');
    assert.equal(byText('删除', mounted.container)?.disabled, true, '最后一条建议不能删除');

    await click(required(byText('放弃草稿', mounted.container), '放弃按钮'));
    assert.match(mounted.container.innerHTML, /放弃这份草稿/);
    await click(required(byText('确认放弃', mounted.container), '确认放弃按钮'));
    assert.ok(
      stub.calls.some((call) => call.url.endsWith('/discard')),
      '放弃必须调用 discard 接口',
    );
  } finally {
    await mounted.unmount();
  }

  // A separate review session for merging (two original suggestions).
  const mergeStub = stubFetch();
  const merging = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    const mergeBoxes = [...merging.container.querySelectorAll('input[type="checkbox"]')].filter((input) =>
      (input.closest('label')?.textContent ?? '').includes('合并'),
    );
    assert.equal(mergeBoxes.length, 2);
    await setChecked(mergeBoxes[0] as HTMLInputElement, true);
    await setChecked(mergeBoxes[1] as HTMLInputElement, true);
    await click(required(byText('合并所选', merging.container), '合并按钮'));
    const mergeCall = mergeStub.calls.filter((call) => call.method === 'PATCH').at(-1);
    assert.equal((JSON.parse(String(mergeCall?.body)) as { merge?: { pageIds: string[] } }).merge?.pageIds.length, 2);
    assert.match(merging.container.innerHTML, /合并后的知识页/, '合并结果必须重新载入草稿');
    assert.match(merging.container.innerHTML, /由合并生成/);
  } finally {
    await merging.unmount();
  }
});

test('B04 审核页：冲突提示与部分提交面板', async () => {
  const conflict = makeDraft({
    preview: {
      rawExists: true,
      rawSha256Matches: true,
      sourceReuse: null,
      sourceAmbiguous: null,
      titleConflicts: [{ title: '动销率', existingId: 'existing-1', existingTitle: '动销率', kind: 'strong' }],
      batchDuplicateTitles: [],
    },
  });
  stubFetch({ draft: conflict });
  const blocked = await mount(
    <DraftReviewPage
      draftId={conflict.id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    assert.match(blocked.container.innerHTML, /冲突/);
    assert.match(blocked.container.innerHTML, /existing-1/);
    assert.match(blocked.container.innerHTML, /仍创建新页/);
  } finally {
    await blocked.unmount();
  }

  const partial = stubFetch({
    confirmResponse: () =>
      reply(
        {
          error: {
            code: 'COMMIT_FAILED',
            message: 'index 写入失败，已部分提交',
            details: { committed: true, recoverable: true, operationId: '33333333-3333-4333-8333-333333333333' },
          },
        },
        500,
      ),
  });
  const stubbed = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    await saveAndReview(stubbed.container);
    await click(required(byText('确认写入 Wiki', stubbed.container), '确认按钮'));
    const html = stubbed.container.innerHTML;
    assert.match(html, /index 写入失败，已部分提交/);
    assert.match(html, /未完成 \/ 待恢复|完成/);
    assert.match(html, /33333333-3333-4333-8333-333333333333/);
    assert.match(html, /重启工作台会自动继续/);
    assert.match(html, /请勿重复确认同一份草稿/);
    assert.ok(partial.calls.some((call) => call.url.startsWith('/api/wiki-commits/')));
  } finally {
    await stubbed.unmount();
  }
});

test('2B-3 成果卡语义查重由人工触发，等待结果时仍可确认入库', async () => {
  const draft = makeDraft({ outcomeDigest: 'outcome-digest' });
  let complete!: (value: Response) => void;
  const semanticResponse = new Promise<Response>((resolve) => (complete = resolve));
  const stub = stubFetch({ draft, semanticResponse: () => semanticResponse });
  let opened: string | undefined;
  const mounted = await mount(
    <DraftReviewPage
      draftId={draft.id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
      onOpenWiki={(id) => (opened = id)}
    />,
  );
  try {
    const card = required(mounted.container.querySelector('article[aria-label="成果 库存周转"]'), '成果卡');
    const confirm = required(byText('确认所选成果入库', mounted.container), '确认按钮');
    assert.equal(confirm.disabled, false);
    assert(!stub.calls.some(({ method }) => method === 'POST'));
    await click(required(byText('发送本页内容进行语义查重', card), '语义查重'));
    const posts = stub.calls.filter(({ method }) => method === 'POST');
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/pages\/page-2\/duplicates$/);
    assert.deepEqual(JSON.parse(posts[0].body!), { baseRevision: draft.revision, allowEmbedding: true });
    assert.equal(confirm.disabled, false);
    await act(async () => {
      complete(
        reply({
          draftId: draft.id,
          pageId: 'page-2',
          draftRevision: draft.revision,
          decision: null,
          targetWikiId: null,
          semanticStatus: 'checked',
          candidates: [
            {
              wiki: { id: 'semantic-wiki', title: '资金占用周期', sources: [] },
              score: 0,
              matches: [{ dimension: 'semantic', score: 0.91, reason: '系统提示，段落向量相似度 91.0%' }],
            },
          ],
        }),
      );
    });
    assert.match(card.textContent ?? '', /资金占用周期.*语义相似.*系统提示.*91\.0%/);
    assert(!byText('生成旧 Wiki 更新预览', card));
    await click(required(byText('打开 Wiki', card), '候选 Wiki'));
    assert.equal(opened, 'semantic-wiki');
    assert.equal(confirm.disabled, false);
    assert(!stub.calls.some(({ method }) => method === 'PATCH'));
  } finally {
    await mounted.unmount();
  }
});

test('2B-3 PDF 成果卡只提供词法刷新', async () => {
  const draft = makeDraft({
    outcomeDigest: 'pdf-outcome-digest',
    pdfInput: {
      startPage: 1,
      endPage: 1,
      pageCount: 1,
      assetId: makeRaw().id,
      assetSha256: 'b'.repeat(64),
      basisDigest: 'c'.repeat(64),
    },
  });
  const stub = stubFetch({ draft });
  const mounted = await mount(
    <DraftReviewPage
      draftId={draft.id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    const card = required(mounted.container.querySelector('article[aria-label="成果 库存周转"]'), 'PDF 成果卡');
    assert(!byText('发送本页内容进行语义查重', card));
    await click(required(byText('刷新重复候选', card), '词法刷新'));
    assert(stub.calls.some(({ url, method }) => url.includes('/pages/page-2/duplicates') && method === 'GET'));
    assert(!stub.calls.some(({ method }) => method === 'POST'));
  } finally {
    await mounted.unmount();
  }
});

test('B04 审核页：候选查询失败阻断提交，成功恢复后保留显式决策门禁', async () => {
  const stub = stubFetch();
  const mounted = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    await saveAndReview(mounted.container);
    stub.setDuplicateResponse(() => reply({ error: { code: 'CANDIDATE_DOWN', message: '候选服务不可用' } }, 503));
    const callsBeforeFailure = stub.calls.length;
    const confirmButton = required(byText('确认写入 Wiki', mounted.container), '确认按钮');
    await click(confirmButton);
    assert.match(mounted.container.textContent ?? '', /候选查询失败，已阻止确认写入/);
    assert.equal(
      stub.calls.some((call) => call.url.endsWith('/confirm')),
      false,
      '候选失败时不得请求正式确认',
    );
    assert.equal(
      stub.calls.slice(callsBeforeFailure).some((call) => call.method === 'PATCH'),
      false,
      '候选失败时不得把默认创建决定写入草稿',
    );

    stub.setDuplicateResponse(() =>
      reply({
        draftId: makeDraft().id,
        pageId: 'page-1',
        draftRevision: 3,
        decision: null,
        targetWikiId: null,
        candidates: [
          {
            wiki: { id: 'existing-1', title: '既有候选Wiki', sources: ['raw-old'] },
            score: 0.8,
            matches: [{ dimension: 'title', score: 0.9, reason: '标题相似' }],
          },
        ],
      }),
    );
    const cards = [...mounted.container.querySelectorAll('.draft-card')];
    for (const card of cards) await click(required(byText('刷新重复候选', card), '刷新候选按钮'));
    assert.match(mounted.container.textContent ?? '', /既有候选Wiki/, '成功重试应显示服务端候选');
    assert.equal(
      mounted.container.querySelectorAll('.duplicate-review [role="alert"]').length,
      0,
      '成功查询应清除过期错误',
    );

    await click(confirmButton);
    assert.match(mounted.container.textContent ?? '', /先对可能重复的建议明确选择/);
    assert.equal(
      stub.calls.some((call) => call.url.endsWith('/confirm')),
      false,
      '发现候选后仍需用户明确决定',
    );

    await click(required(byText('仍创建新页', cards[1] as ParentNode), '明确新建决定'));
    assert.equal(confirmButton.disabled, true, '处理决定变化使全部页审查失效');
    await reviewPages(mounted.container);
    await click(confirmButton);
    const confirmCall = stub.calls.find((call) => call.url.endsWith('/confirm'));
    assert.ok(confirmCall, '明确选择新建后允许提交');
    assert.deepEqual((JSON.parse(String(confirmCall.body)) as { selectedPageIds: string[] }).selectedPageIds, [
      'page-2',
    ]);
    assert.ok(
      stub.calls.some(
        (call) =>
          call.url.endsWith('/decision') &&
          (JSON.parse(String(call.body)) as { decision?: string }).decision === 'create',
      ),
    );
  } finally {
    await mounted.unmount();
  }
});

test('B04 审核页：确认刷新候选期间锁定选择和编辑，提交仍使用可见快照', async () => {
  const stub = stubFetch();
  const mounted = await mount(
    <DraftReviewPage
      draftId={makeDraft().id}
      onBack={() => undefined}
      onCommitted={async () => undefined}
      onOpenRaw={() => undefined}
    />,
  );
  try {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const boxes = writeBoxes(mounted.container);
    await setChecked(boxes[0], true);
    await setChecked(boxes[1], false);
    await saveAndReview(mounted.container);
    // Drain the normal debounced lookup before installing the deliberately pending
    // confirm lookup, so the two requests below belong only to final confirmation.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    let release!: (response: Response) => void;
    let pending = 0;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stub.setDuplicateResponse(() => {
      pending += 1;
      return waiting;
    });
    await click(required(byText('确认写入 Wiki', mounted.container), '确认按钮'));
    await act(async () => {
      await tick();
    });
    assert.equal(pending, 2, '确认需等待每条建议的最新候选');
    assert.ok(
      boxes.every((box) => box.disabled),
      '确认请求期间锁定所有写入勾选框',
    );
    assert.ok(
      [
        ...mounted.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          'input, textarea, select',
        ),
      ]
        .filter((element) => !element.closest('.draft-evidence'))
        .every((element) => element.disabled || ('readOnly' in element && element.readOnly)),
      '确认请求期间锁定全部可编辑字段（原文事实/问题保持只读）',
    );
    const immutableInputs = [
      ...mounted.container.querySelectorAll<HTMLTextAreaElement>('.draft-block textarea'),
    ].filter((element) =>
      /来源事实|待确认问题/.test(element.closest('.draft-block')?.querySelector('h4')?.textContent ?? ''),
    );
    assert.equal(immutableInputs.length, 3, '两页来源事实及原问题均保留展示');
    assert.ok(
      immutableInputs.every((element) => element.readOnly),
      '原文事实及原问题始终不能被编辑',
    );
    assert.equal(boxes[0].checked, true);
    assert.equal(boxes[1].checked, false);
    const available = {
      draftId: makeDraft().id,
      pageId: 'page-1',
      draftRevision: 3,
      decision: null,
      targetWikiId: null,
      candidates: [],
    };
    await act(async () => {
      release(reply(available));
      await tick();
      await tick();
    });
    const patch = stub.calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/drafts/' + makeDraft().id));
    assert.ok(patch, '确认前必须持久化锁定时的审核快照');
    const saved = JSON.parse(String(patch.body)) as { pages: Array<{ pageId: string; selected: boolean }> };
    assert.equal(saved.pages.find((page) => page.pageId === 'page-1')?.selected, true);
    assert.equal(saved.pages.find((page) => page.pageId === 'page-2')?.selected, false);
    const confirmCall = stub.calls.find((call) => call.url.endsWith('/confirm'));
    assert.ok(confirmCall, '候选成功后应继续确认');
    assert.deepEqual((JSON.parse(String(confirmCall.body)) as { selectedPageIds: string[] }).selectedPageIds, [
      'page-1',
    ]);
  } finally {
    await mounted.unmount();
  }
});

for (const type of ['concept', 'business_process'] as const)
  test(`B09 template ${type}: update click reaches service, preserves fields and displays review rejection before navigation`, async () => {
    const original = makeDraft(),
      targetWikiId = 'existing-template-target';
    const templateFields = {
      [type === 'concept' ? 'definition' : 'steps']: { evidenceIds: ['e1'], humanText: '人工说明保持原样。' },
    };
    const page = {
      ...original.pages[0],
      type,
      templateFields,
      reviewDecision: 'update' as const,
      updateTargetWikiId: targetWikiId,
    };
    const draft = makeDraft({ pages: [page] });
    const stub = stubFetch({ draft }),
      stubbedFetch = globalThis.fetch;
    const updateRequests: Array<Record<string, unknown>> = [];
    let allow = false,
      opened = '';
    globalThis.fetch = (async (input, init) => {
      if (String(input) === '/api/knowledge/updates') {
        updateRequests.push(JSON.parse(String(init?.body)));
        return allow
          ? reply({ id: 'reviewed-update-workflow' }, 201)
          : reply({ error: { code: 'HUMAN_REVIEW_INCOMPLETE', message: '必须先确认全部输入页。' } }, 409);
      }
      return stubbedFetch(input, init);
    }) as typeof fetch;
    const mounted = await mount(
      <DraftReviewPage
        draftId={draft.id}
        onBack={() => undefined}
        onCommitted={async () => undefined}
        onOpenRaw={() => undefined}
        onOpenWorkflow={(id) => {
          opened = id;
        }}
      />,
    );
    try {
      await click(required(byText('刷新重复候选', mounted.container), '刷新候选按钮'));
      assert.match(mounted.container.textContent ?? '', /旧 Wiki 更新保留已审字段快照/);
      await click(required(byText('生成旧 Wiki 更新预览', mounted.container), '更新预览按钮'));
      assert.equal(updateRequests.length, 1, '服务拒绝后没有自动重试');
      assert.equal(opened, '');
      assert.match(mounted.container.textContent ?? '', /必须先确认全部输入页/);
      const saved = stub.calls
        .filter((call) => call.method === 'PATCH' && call.url === `/api/drafts/${draft.id}`)
        .at(-1)!;
      assert.deepEqual(JSON.parse(saved.body!).pages[0].templateFields, templateFields);
      assert.deepEqual(updateRequests[0], {
        draftId: draft.id,
        pageId: page.pageId,
        targetWikiId,
        baseRevision: draft.revision + 1,
      });
      allow = true;
      await click(required(byText('生成旧 Wiki 更新预览', mounted.container), '重新明确点击预览'));
      assert.equal(updateRequests.length, 2);
      assert.equal(opened, 'reviewed-update-workflow', '成功生成后打开独立审核页');
      assert.equal(
        stub.calls.some((call) => call.url.endsWith('/confirm')),
        false,
        '生成预览不正式写入',
      );
    } finally {
      await mounted.unmount();
      globalThis.fetch = stubbedFetch;
    }
  });
