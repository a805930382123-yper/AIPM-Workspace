import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DraftPage,
  ExtractionJob,
  PdfCleanupView,
  Raw,
  RawDraftView,
  RawPdf,
  RawProcessingState,
} from '../app/api';

const { window } = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
const { document } = window;
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PdfPages } = await import('../app/PdfPages');
const { RawPage } = await import('../app/pages/RawPage');
const { FormalNoteReader } = await import('../app/components/FormalNoteReader');
const { RawOutcomeReview } = await import('../app/pages/RawOutcomeReview');
const base = '/api/raw/pdf-test/pdf';
const cleanup = `${base}/cleanup`;
const pdf: RawPdf = {
  rawId: 'pdf-test',
  assetId: 'asset',
  assetSha256: 'a'.repeat(64),
  pageCount: 3,
  hasTextLayer: true,
  originalUrl: `${base}/original`,
  job: null,
  pages: [1, 2, 3].map((page) => ({
    page,
    textStart: null,
    textEnd: null,
    imageUrl: `${base}/pages/${page}/image`,
    status: page < 3 ? 'completed' : 'pending',
  })),
};
const fixture: PdfCleanupView = { rawId: pdf.rawId, pageCount: pdf.pageCount, completedPages: [1, 2], job: null };
const completed: NonNullable<PdfCleanupView['job']> = {
  startPage: 1,
  endPage: 2,
  status: 'completed',
  stage: 'done',
  attempts: 2,
  completedBatches: 1,
  totalBatches: 1,
  counts: { kept: 1, merged: 0, skipped: 1 },
  topics: [{ title: '研究方法', unitCount: 1 }],
  decisions: [
    {
      id: 'one',
      page: 1,
      origin: 'text',
      kind: 'content',
      text: '样本为 320 家门店',
      decision: 'keep',
      reason: '保留研究方法与样本',
      topic: '研究方法',
    },
    {
      id: 'two',
      page: 2,
      origin: 'image',
      kind: 'visuals',
      text: '主办方标识',
      decision: 'skip',
      reason: '装饰标识，无研究信息',
    },
  ],
};
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
const text = () => document.getElementById('root')!.textContent!;
const click = (label: string) =>
  act(async () => {
    assert(button(label), label);
    button(label).click();
  });
const wait = async (check: () => boolean) => {
  for (let step = 0; step < 100; step++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check()) return;
  }
  assert.fail('PDF cleanup UI did not settle');
};

test('PDF cleanup explicitly selects an understood subset, opens reasons and the source page, then opens a separate draft', async () => {
  const root = createRoot(document.getElementById('root')!);
  const native = globalThis.fetch;
  const posts: Array<[string, unknown]> = [];
  let state = fixture,
    opened = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push([url, JSON.parse(String(init.body))]);
      state = {
        ...fixture,
        job: url.endsWith('/draft')
          ? { ...completed, draftId: 'draft-1', draftStatus: 'pending_confirmation' }
          : completed,
      };
    }
    if (url.startsWith(cleanup)) return Response.json(state);
    if (url === base) return Response.json(pdf);
    return Response.json({ ...pdf.pages[Number(url.split('/').at(-1)) - 1], text: '' });
  };
  try {
    await act(async () =>
      root.render(
        createElement(PdfPages, {
          rawId: pdf.rawId,
          onOpenDraft: (id) => {
            opened = id;
          },
        }),
      ),
    );
    await wait(() => text().includes('第 3 页。请先完成'));
    assert.match(text(), /页理解按整份 PDF 进行/);
    assert.match(text(), /清理和主题写作只处理所选页范围/);
    assert(button('开始内容清理').disabled);
    const range = document.querySelector<HTMLSelectElement>('.pdf-cleanup-range select')!;
    await act(async () => {
      range.value = 'range';
      range.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const last = [...document.querySelectorAll<HTMLInputElement>('.pdf-cleanup-range input')][1];
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(last, '2');
      last.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    assert(!button('开始内容清理').disabled);
    assert.deepEqual(posts, []);
    await click('开始内容清理');
    await wait(() => text().includes('清理与归并完成'));
    assert.match(text(), /第 1–2 页 · 共 3 页/);
    const reasons = document.querySelector<HTMLDetailsElement>('.pdf-cleanup-decisions')!;
    assert.equal(reasons.open, false);
    reasons.open = true;
    assert.match(reasons.textContent!, /装饰标识，无研究信息/);
    const evidenceButton = button('查看第 2 页证据');
    await click('查看第 2 页证据');
    assert(document.querySelector('img[alt="PDF 第 2 页"]'));
    assert.equal(document.activeElement, document.getElementById('pdf-page-navigation'));
    assert.equal(document.querySelector('a[href$="#page=2"]')?.getAttribute('href'), `${base}/original#page=2`);
    await click('返回这条清理依据');
    assert.equal(document.activeElement, evidenceButton);
    assert.equal(reasons.open, true);
    await click('生成知识草稿');
    await wait(() => !!button('打开知识草稿'));
    assert.equal(opened, '');
    await click('打开知识草稿');
    assert.equal(opened, 'draft-1');
    assert.deepEqual(posts, [
      [cleanup, { startPage: 1, endPage: 2 }],
      [`${cleanup}/draft`, { startPage: 1, endPage: 2 }],
    ]);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('failed PDF cleanup preserves its range and reasons, and mounting does not restart it', async () => {
  const root = createRoot(document.getElementById('root')!);
  const native = globalThis.fetch,
    posts: Array<[string, unknown]> = [];
  const failed: PdfCleanupView = {
    ...fixture,
    job: { ...completed, status: 'failed', stage: 'assembling', error: { code: 'FAIL', message: '主题写作失败' } },
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') posts.push([url, JSON.parse(String(init.body))]);
    if (url === cleanup) return Response.json(init?.method === 'POST' ? { ...fixture, job: completed } : failed);
    if (url === base) return Response.json(pdf);
    return Response.json({ ...pdf.pages[0], text: '' });
  };
  try {
    await act(async () => root.render(createElement(PdfPages, { rawId: pdf.rawId, onOpenDraft: () => {} })));
    await wait(() => text().includes('主题写作失败'));
    assert.match(text(), /未完成 · 准备主题成果 · 清理批次 1\/1/);
    assert.match(text(), /继续会沿用已保存结果和这个页范围/);
    assert.match(text(), /保留 1 · 归并 0 · 略过 1/);
    assert.deepEqual(posts, []);
    await click('继续内容清理');
    assert.deepEqual(posts, [[cleanup, { startPage: 1, endPage: 2 }]]);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('Raw PDF prioritizes page processing and saved outcomes while preserving old extraction recovery', async () => {
  const root = createRoot(document.getElementById('root')!);
  const native = globalThis.fetch,
    posts: string[] = [];
  const raw: Raw = {
    id: pdf.rawId,
    title: '合成报告',
    sourceType: 'report',
    sourceName: '合成',
    tags: [],
    body: '原文',
    bodySha256: 'b'.repeat(64),
    importedAt: '2026-11-12T00:00:00Z',
    status: 'unprocessed',
    assetId: pdf.assetId,
    assetFormat: 'pdf',
    assetSha256: pdf.assetSha256,
  };
  const oldJob: ExtractionJob = {
    rawId: raw.id,
    jobId: 'old-job',
    status: 'failed',
    stage: 'extracting',
    progress: { chunksTotal: 2, chunksDone: 1, pagesFound: 0 },
    draftId: null,
    error: null,
    provider: { name: 'fake', model: 'fake' },
    callCount: 1,
    startedAt: raw.importedAt,
    finishedAt: raw.importedAt,
    cancelRequested: false,
    pipelineVersion: 'existing',
    mode: 'standard',
    execution: 'settled',
  };
  let opened = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') posts.push(url);
    if (url === base) return Response.json(pdf);
    if (url === cleanup) return Response.json(fixture);
    if (url === `${base}/pages/1`) return Response.json({ ...pdf.pages[0], text: raw.body });
    if (url === '/api/drafts/pdf-draft')
      return Response.json({
        id: 'pdf-draft',
        rawId: raw.id,
        jobId: 'pdf-cleanup',
        pages: [],
        status: 'pending_confirmation',
        pdfInput: { startPage: 1, endPage: 2 },
      });
    if (url === '/api/extraction-jobs/old-job') return Response.json(oldJob);
    return Response.json({ items: [] });
  };
  const noop = () => {};
  const settled = async () => {};
  const render = (state?: RawProcessingState) =>
    act(async () =>
      root.render(
        createElement(RawPage, {
          items: [raw],
          selectedId: raw.id,
          onSelected: noop,
          onOpenImport: noop,
          onCommitted: settled,
          openImport: false,
          onCloseImport: noop,
          onDeleted: settled,
          processing: state ? { [raw.id]: state } : {},
          job: null,
          onJobStarted: noop,
          onOpenDraft: (id) => {
            opened = id;
          },
          onRefresh: settled,
        }),
      ),
    );
  try {
    await render();
    await wait(() => !!document.querySelector('img[alt="PDF 第 1 页"]'));
    assert.match(text(), /PDF 原件已保存/);
    assert.equal(document.querySelector('.raw-next-actions a')?.getAttribute('href'), '#pdf-pages');
    assert.equal(document.querySelector('select[aria-label="整理模式"]'), null);
    assert.equal(button('打开已保存草稿'), undefined);

    await render({
      rawId: raw.id,
      updatedAt: raw.importedAt,
      status: 'pending_confirmation',
      draftId: 'pdf-draft',
      jobId: 'pdf-cleanup',
    });
    await wait(() => !!button('打开已保存草稿'));
    assert.match(text(), /草稿已保存，待你审核/);
    await click('打开已保存草稿');
    assert.equal(opened, 'pdf-draft');

    await render({ rawId: raw.id, updatedAt: raw.importedAt, status: 'failed', jobId: oldJob.jobId });
    await wait(() => !!button('显式继续提取'));
    assert.match(text(), /已有正文整理任务/);
    assert(!button('显式继续提取').disabled);
    assert.equal(document.querySelector('.raw-next-actions a')?.getAttribute('href'), '#pdf-pages');
    assert.deepEqual(posts, []);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = native;
  }
});

test('PDF table blocks render native rows and page citations while ordinary Markdown retains its rendering', () => {
  const grid =
    '| 地区 | 样本（家） | 原页依据 |\n| --- | --- | --- |\n| 华南 | 120 | [第 2 页](/api/raw/test/pdf/original#page=2) |\n| 华东 | 200 | [第 3 页](/api/raw/test/pdf/original#page=3) |';
  const body = `### 普通示例\n\n${grid}\n\n### 样本（PDF 页图 AI 解读）\n\n#### 同一口径\n\n${grid}\n\n表注：仅统计有效样本。\n\n### 其他正文\n\n${grid}`;
  const result = JSDOM.fragment(renderToStaticMarkup(createElement(FormalNoteReader, { body })));
  assert.equal(result.querySelectorAll('table').length, 1);
  assert.deepEqual(
    [...result.querySelectorAll('thead th')].map((cell) => cell.textContent),
    ['地区', '样本（家）', '原页依据'],
  );
  assert.deepEqual(
    [...result.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    ),
    [
      ['华南', '120', '第 2 页'],
      ['华东', '200', '第 3 页'],
    ],
  );
  assert.equal(
    result.querySelector('tbody tr:last-child a')?.getAttribute('href'),
    '/api/raw/test/pdf/original#page=3',
  );
  assert.match(result.textContent!, /表注：仅统计有效样本。/);
});

test('PDF candidate summaries use their own facts when two topics cite the same original passage', () => {
  const fullPassage = '173 stores in North. New users totalled 875.';
  const sourceLink = '（[第 2 页](/api/raw/pdf-test/pdf/original#page=2)）';
  const writtenSourceLink = '（含 PDF 页图 AI 解读，[第 2 页](/api/raw/pdf-test/pdf/original#page=2)）';
  const pages: DraftPage[] = [
    { title: '覆盖规模', renderedBody: `### PDF 页图 AI 解读\n\n- 【归并展示】173 stores in North\\.${sourceLink}` },
    {
      title: '新增用户',
      renderedBody: `## 人工内容\n\n旧主题内容。\n\n## 本次 PDF 整理\n\n### AI 整理\n\n- **New users** totalled 875\\.${writtenSourceLink}`,
    },
  ].map((page, index) => ({
    ...page,
    pageId: `page-${index}`,
    type: 'concept',
    category: 'other',
    one_line_definition: page.title,
    source_facts: [],
    ai_organized: [],
    ai_inferences: [],
    related_pages: [],
    open_questions: [],
    source_evidence: [],
    pdfEvidence: [{ unitId: 'p2-content-1', page: 2, kind: 'image', text: fullPassage, resultSha256: 'a'.repeat(64) }],
    knowledge_status: 'ai_organized',
    confidence: 'medium',
    source_level: 'D',
    selected: false,
    provenance: [],
  }));
  const view: RawDraftView = {
    id: 'draft-1',
    rawId: 'pdf-test',
    rawTitle: '合成资料',
    status: 'pending_confirmation',
    revision: 1,
    createdAt: '2026-11-12',
    updatedAt: '2026-11-12',
    rulesVersion: 'fixture',
    provider: { name: 'fake', model: 'fixture' },
    jobId: 'job',
    pdfInput: {
      startPage: 1,
      endPage: 2,
      pageCount: 2,
      assetId: 'asset',
      assetSha256: 'a'.repeat(64),
      basisDigest: 'b'.repeat(64),
    },
    document: { title: '合成资料', main_topic: '合成', summary: '' },
    pages,
    source: {
      title: '合成资料',
      category: 'other',
      summary: '',
      key_takeaways: [],
      body: '',
      knowledge_status: 'ai_organized',
      confidence: 'medium',
      source_level: 'D',
    },
    warnings: [],
    extraction: { callCount: 1, chunkCount: 1, pagesFound: 2 },
    raw: null,
    preview: null,
  };
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(RawOutcomeReview, {
      view,
      body: '',
      onView: noop,
      onBack: noop,
      onOpenRaw: noop,
      onCommitted: async () => {},
      advanced: null,
      advancedDirty: false,
      advancedBusy: false,
    }),
  );
  const result = JSDOM.fragment(html);
  assert.deepEqual(
    [...result.querySelectorAll('.outcome-excerpt')].map((item) => item.textContent),
    ['173 stores in North.', 'New users totalled 875.'],
  );
  assert.deepEqual(
    [...result.querySelectorAll('article blockquote')].map((item) => item.textContent),
    [fullPassage, fullPassage],
  );
});
