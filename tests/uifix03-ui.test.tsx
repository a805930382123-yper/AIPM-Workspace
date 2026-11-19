import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { DraftView, Raw, RawDraftView, WorkItem, WorkItemSummary } from '../app/api.ts';

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
window.scrollTo = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RawPage, ImportDialog } = await import('../app/pages/RawPage.tsx');
const { RawOutcomeReview } = await import('../app/pages/RawOutcomeReview.tsx');
const { KnowledgeMaintenanceReview } = await import('../app/pages/KnowledgeMaintenanceReview.tsx');
const { WorkItemsPage } = await import('../app/pages/WorkItemsPage.tsx');

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (check()) return;
    await act(async () => { await tick(10); });
  }
  assert.fail(`等待超时：${label}`);
}
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function findButton(container: ParentNode, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => (item.textContent ?? '').trim() === text || (item.textContent ?? '').includes(text));
  assert.ok(found, `找不到按钮：${text}`);
  return found as HTMLButtonElement;
}
function maybeButton(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(item => (item.textContent ?? '').includes(text)) as HTMLButtonElement | undefined;
}
async function click(target: HTMLElement) {
  await act(async () => {
    target.click();
    await tick();
  });
}
async function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    assert.ok(setter);
    setter.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
}
async function setSelectValue(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    assert.ok(setter);
    setter.call(select, value);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
}

test('U3-01: RawPage 左侧列表搜索、状态筛选、计数、空态与重置，且保持 selected 从完整 items 解析', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/knowledge/workflows') return jsonResponse({ items: [] });
    if (url.startsWith('/api/drafts/')) return jsonResponse({ error: { message: 'none' } }, 404);
    return jsonResponse({ items: [] });
  }) as typeof fetch;

  const raws: Raw[] = [
    {
      id: 'raw-1', title: '华南经销商库存纪要', sourceType: 'meeting', sourceName: '拜访笔记',
      tags: ['渠道', 'FMCG'], body: '第一条原文', importedAt: '2026-11-18T00:00:00Z', status: 'unprocessed', bodySha256: '1'.repeat(64),
    },
    {
      id: 'raw-2', title: '便利店动销调研报告', sourceType: 'report', sourceName: '尼尔森周报',
      tags: ['零售'], body: '第二条原文', importedAt: '2026-11-18T01:00:00Z', status: 'unprocessed', bodySha256: '2'.repeat(64),
    },
    {
      id: 'raw-3', title: '公众号冷饮观察', sourceType: 'wechat', sourceName: '快消观察号',
      tags: ['冷链'], body: '第三条原文', importedAt: '2026-11-18T02:00:00Z', status: 'unprocessed', bodySha256: '3'.repeat(64),
    },
    {
      id: 'raw-4', title: '年度复盘文章', sourceType: 'article', sourceName: '行业网站',
      tags: ['复盘'], body: '第四条原文', importedAt: '2026-11-18T03:00:00Z', status: 'unprocessed', bodySha256: '4'.repeat(64),
    },
  ];
  const processing = {
    'raw-2': { rawId: 'raw-2', status: 'pending_confirmation' as const, updatedAt: '2026-11-18T01:00:00Z' },
    'raw-3': { rawId: 'raw-3', status: 'generated' as const, updatedAt: '2026-11-18T02:00:00Z' },
    'raw-4': { rawId: 'raw-4', status: 'failed' as const, updatedAt: '2026-11-18T03:00:00Z' },
  };

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(RawPage, {
        items: raws,
        selectedId: 'raw-1',
        onSelected: () => {},
        onOpenImport: () => {},
        onCommitted: async () => {},
        openImport: false,
        onCloseImport: () => {},
        onDeleted: async () => {},
        processing,
        job: null,
        onJobStarted: () => {},
        onOpenDraft: () => {},
        onRefresh: async () => {},
      }));
      await tick();
    });

    const listTitleCount = () => container.querySelector('.raw-list-panel .list-title span')?.textContent;
    const listedTitles = () => [...container.querySelectorAll('.raw-list-panel .raw-list-item b')].map(el => el.textContent);
    const searchInput = () => container.querySelector('input[aria-label="搜索原始资料"]') as HTMLInputElement;
    const statusSelect = () => container.querySelector('select[aria-label="筛选资料处理状态"]') as HTMLSelectElement;

    assert.equal(listTitleCount(), '4 条');
    assert.equal(listedTitles().length, 4);
    assert.equal(maybeButton(container.querySelector('.raw-list-panel')!, '重置筛选'), undefined);

    // 按标签不区分大小写搜索（匹配 raw-1）
    await setInputValue(searchInput(), 'fmcg');
    assert.deepEqual(listedTitles(), ['华南经销商库存纪要']);
    assert.equal(listTitleCount(), '1 / 4 条');
    assert.ok(maybeButton(container.querySelector('.raw-list-panel')!, '重置筛选'));

    // 按来源类型显示标签搜索（匹配“行业报告” -> raw-2），同时右栏仍保留已选中的 raw-1！
    await setInputValue(searchInput(), '行业报告');
    assert.deepEqual(listedTitles(), ['便利店动销调研报告']);
    assert.equal(container.querySelector('.raw-detail h2')?.textContent, '华南经销商库存纪要');

    // 按状态筛选（待确认草稿）+ 清空关键词
    await setInputValue(searchInput(), '');
    await setSelectValue(statusSelect(), 'pending_confirmation');
    assert.deepEqual(listedTitles(), ['便利店动销调研报告']);
    assert.equal(listTitleCount(), '1 / 4 条');

    // 组合条件导致 0 匹配 -> 展示空态文案，不渲染空 .raw-list
    await setInputValue(searchInput(), '不存在的关键词');
    assert.equal(container.querySelector('.raw-list-panel .raw-list'), null);
    assert.equal(container.querySelector('.raw-filter-empty')?.textContent, '没有匹配的原始资料。');
    assert.equal(listTitleCount(), '0 / 4 条');
    // selected 仍不丢失
    assert.equal(container.querySelector('.raw-detail h2')?.textContent, '华南经销商库存纪要');

    // 点击重置筛选恢复全部列表
    await click(findButton(container.querySelector('.raw-list-panel')!, '重置筛选'));
    assert.equal(listTitleCount(), '4 条');
    assert.equal(listedTitles().length, 4);
    assert.equal(searchInput().value, '');
    assert.equal(statusSelect().value, 'all');
    assert.equal(maybeButton(container.querySelector('.raw-list-panel')!, '重置筛选'), undefined);
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U3-02: ImportDialog 新增「网页链接」Tab，隐藏正文/文件并保留必填链接与既有粘贴/文件兼容性', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown }> = [];
  const createdRaw: Raw = {
    id: 'raw-url-1', title: '网页文章', sourceType: 'article', sourceName: '示例站点',
    tags: [], body: '网页正文', importedAt: '2026-11-19T00:00:00Z', status: 'unprocessed', bodySha256: 'a'.repeat(64),
  };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return jsonResponse({ kind: 'url', raw: createdRaw, extraction: { parser: 'html', note: '测试', bodyChars: 4 } }, 201);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  const opened: Raw[] = [];
  const committed: Raw[] = [];
  try {
    await act(async () => {
      root.render(createElement(ImportDialog, {
        onClose: () => {},
        onCommitted: async raw => { committed.push(raw); },
        onOpen: raw => { opened.push(raw); },
        onGenerate: async () => {},
      }));
      await tick();
    });

    const tabs = () => [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    assert.equal(tabs().length, 3);
    assert.ok(tabs()[2].textContent?.includes('网页链接'));
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');

    // 先在粘贴文本输入正文，再在上传文件选一个文件
    await setInputValue(container.querySelector('.body-field textarea') as HTMLTextAreaElement, '保留的粘贴正文');
    await click(tabs()[1]);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pickedFile = new window.File(['文件'], 'sample.txt');
    Object.defineProperty(fileInput, 'files', { value: [pickedFile], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    assert.match(container.querySelector('.file-picked')?.textContent ?? '', /sample\.txt/);

    // 切到「网页链接」Tab：移除隐藏中的文件、隐藏正文框和文件选择器，链接标为必填
    await click(tabs()[2]);
    assert.equal(tabs()[2].getAttribute('aria-selected'), 'true');
    assert.equal(container.querySelector('.body-field'), null);
    assert.equal(container.querySelector('.file-picker'), null);
    assert.equal(container.querySelector('.file-picked'), null);

    const urlField = container.querySelector('input[type="url"]') as HTMLInputElement;
    assert.equal(urlField.required, true);
    assert.equal(urlField.placeholder, 'https://…');
    assert.match(urlField.closest('label')?.textContent ?? '', /原始链接 \*/);
    assert.equal((container.querySelector('input[data-autofocus]') as HTMLInputElement).required, false);
    assert.ok(container.querySelector('.raw-translate-choice input[type="checkbox"]'));
    assert.ok(findButton(container, '从网页导入 Raw'));
    assert.equal(maybeButton(container, '保存并生成 Wiki 草稿'), undefined);

    // 切回「粘贴文本」仍保留之前粘贴的正文，且链接恢复可选
    await click(tabs()[0]);
    assert.equal((container.querySelector('.body-field textarea') as HTMLTextAreaElement).value, '保留的粘贴正文');
    assert.equal((container.querySelector('input[type="url"]') as HTMLInputElement).required, false);
    assert.equal((container.querySelector('input[type="url"]') as HTMLInputElement).placeholder, 'https://…（可选）');

    // 再切回「网页链接」并提交 URL 导入
    await click(tabs()[2]);
    await setInputValue(container.querySelector('input[type="url"]') as HTMLInputElement, 'https://fixture.example/u3-02');
    await click(findButton(container, '从网页导入 Raw'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/raw/import');
    assert.deepEqual(requests[0].body, {
      metadata: { title: '', sourceType: 'article', sourceName: '', url: 'https://fixture.example/u3-02', tags: [] },
      translateToChinese: true,
    });
    assert.deepEqual(committed, [createdRaw]);
    assert.deepEqual(opened, [createdRaw]);
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});

test('U3-03a: RawOutcomeReview 支持全选可选主题/取消全选主题并保持首子元素结构', async () => {
  const makePage = (pageId: string, title: string, selected: boolean, reviewDecision?: 'update' | 'create' | 'defer') => ({
    pageId, title, type: 'concept', category: 'other', one_line_definition: '说明',
    source_facts: [], ai_organized: [`${title} 正文`], ai_inferences: [], related_pages: [], open_questions: [],
    source_evidence: [], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D',
    selected, reviewDecision, provenance: [],
  });
  const view: RawDraftView = {
    id: 'draft-u3-03a', rawId: 'raw-1', rawTitle: '合成资料', status: 'pending_confirmation', revision: 1,
    outcomeDigest: 'digest-1', jobId: 'job-1', createdAt: '2026-11-19', updatedAt: '2026-11-19', rulesVersion: 'fixture',
    document: { title: '合成资料', main_topic: '主题', summary: '' },
    pages: [makePage('p1', '可选主题甲', true), makePage('p2', '可选主题乙', false), makePage('p3', '已标更新丙', false, 'update')],
    source: { title: '来源', body: '来源正文', category: 'other', summary: '', key_takeaways: [], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D' },
    provider: { name: 'fake', model: 'fixture' }, warnings: [], extraction: { callCount: 1, chunkCount: 1, pagesFound: 3 },
    preview: { rawExists: true, rawSha256Matches: true, sourceReuse: null, sourceAmbiguous: null, titleConflicts: [], batchDuplicateTitles: [] },
    raw: null,
  };

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(RawOutcomeReview, {
        view, body: '原文', onView: () => {}, onBack: () => {}, onOpenRaw: () => {},
        onCommitted: async () => {}, advanced: null, advancedDirty: false, advancedBusy: false,
      }));
      await tick();
    });

    const cardsSection = container.querySelector('section.outcome-cards')!;
    assert.ok(cardsSection.firstElementChild?.classList.contains('outcome-cards-heading'));

    const toggleBtn = () => findButton(cardsSection, '全选');
    assert.equal(toggleBtn().textContent, '全选可选主题（2 项）');
    await click(toggleBtn());
    assert.equal(toggleBtn().textContent, '取消全选主题');
    assert.match(container.querySelector('.outcome-confirm .primary-button')?.textContent ?? '', /确认所选成果入库（2）/);
    assert.equal((container.querySelector('input[aria-label="选择入库 可选主题甲"]') as HTMLInputElement).checked, true);
    assert.equal((container.querySelector('input[aria-label="选择入库 可选主题乙"]') as HTMLInputElement).checked, true);

    await click(toggleBtn());
    assert.equal(toggleBtn().textContent, '全选可选主题（2 项）');
    assert.equal((container.querySelector('input[aria-label="选择入库 可选主题甲"]') as HTMLInputElement).checked, false);
    assert.equal((container.querySelector('input[aria-label="选择入库 可选主题乙"]') as HTMLInputElement).checked, false);

    // 进入编辑模式时隐藏全选按钮，取消后恢复
    await click(findButton(cardsSection, '编辑主题成果'));
    assert.equal(maybeButton(cardsSection, '全选'), undefined);
    await click(findButton(cardsSection, '取消编辑'));
    assert.equal(toggleBtn().textContent, '全选可选主题（2 项）');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('U3-03b: KnowledgeMaintenanceReview 顶部渲染准确门禁原因提示并在条件满足时解锁', async () => {
  const baseView: DraftView = {
    id: 'draft-maint', rawId: 'raw-1', rawTitle: '维护资料', status: 'pending_confirmation', revision: 1,
    createdAt: '2026-11-19', updatedAt: '2026-11-19', rulesVersion: 'fixture', jobId: 'job-1',
    document: { title: '维护资料', main_topic: '主题', summary: '' },
    pages: [
      {
        pageId: 'p1', title: '主题甲', type: 'concept', category: 'other', one_line_definition: '说明',
        source_facts: [], ai_organized: ['甲'], ai_inferences: [], related_pages: [], open_questions: [],
        source_evidence: [], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D', selected: true, provenance: [],
      },
      {
        pageId: 'p2', title: '主题乙', type: 'concept', category: 'other', one_line_definition: '说明',
        source_facts: [], ai_organized: ['乙'], ai_inferences: [], related_pages: [], open_questions: [],
        source_evidence: [], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D', selected: true, provenance: [],
      },
    ],
    source: { title: '来源', body: '来源正文', category: 'other', summary: '', key_takeaways: [], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D' },
    provider: { name: 'fake', model: 'fixture' }, warnings: [], extraction: { callCount: 1, chunkCount: 1, pagesFound: 2 },
    preview: null, raw: null,
    changeDigests: { c1: 'dig-1', c2: 'dig-2' },
    reviewContentDigest: 'note-dig-1',
    structuredNote: { version: 1, orientation: '定位', sections: [] },
    noteApproval: { version: 1, digest: 'note-dig-1', at: '2026-11-19', warningsAcknowledged: true, historicalReportAcknowledged: true },
    humanReview: { version: 1, basisDigest: 'b1', units: [], assignments: {}, approvals: [] },
    maintenance: {
      version: 1, context: [],
      changes: [
        {
          changeId: 'c1', pageIndex: 0, action: 'create', decision: 'defer', reason: '理由1',
          candidate: { title: '主题甲', body: '正文甲', type: 'concept', category: 'other', aliases: [], tags: [], sources: ['raw-1'], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D' },
          summary: [], questions: [], dependsOn: ['c2'],
        },
        {
          changeId: 'c2', pageIndex: 1, action: 'create', decision: 'defer', reason: '理由2',
          candidate: { title: '主题乙', body: '正文乙', type: 'concept', category: 'other', aliases: [], tags: [], sources: ['raw-1'], knowledge_status: 'ai_organized', confidence: 'medium', source_level: 'D' },
          summary: [], questions: [], dependsOn: [],
        },
      ],
    },
  };

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  const renderView = async (view: DraftView) => {
    await act(async () => {
      root.render(createElement(KnowledgeMaintenanceReview, {
        view, body: '原文', onView: () => {}, onBack: () => {}, onOpenRaw: () => {}, onCommitted: async () => {},
      }));
      await tick();
    });
  };
  const gateText = () => container.querySelector('.maintenance-gate-hint')?.textContent ?? null;
  const submitBtn = () => findButton(container, '确认写入 Wiki');

  try {
    // 1. 未接受任何项
    await renderView(baseView);
    assert.equal(gateText(), '请至少接受 1 项知识变更后再确认写入。');
    assert.equal(submitBtn().disabled, true);

    // 2. 存在未归属项（unresolved > 0）时不重复显示顶部 gateHint
    await renderView({
      ...baseView,
      humanReview: {
        version: 1, basisDigest: 'b1',
        units: [{ id: 'u1', kind: 'fact', origin: 'kb02', text: '未归属事实', memberIds: [], records: [], evidence: [] }],
        assignments: { u1: null },
        approvals: [],
      },
    });
    assert.equal(gateText(), null);
    assert.equal(submitBtn().disabled, true);

    // 3. 深度整理笔记未核对确认
    await renderView({ ...baseView, noteApproval: undefined });
    assert.equal(gateText(), '请先在下方深度整理笔记区域勾选核对确认。');
    assert.equal(submitBtn().disabled, true);

    // 4. 接受 c1 但未接受其依赖 c2
    await renderView({
      ...baseView,
      maintenance: {
        ...baseView.maintenance!,
        changes: [
          { ...baseView.maintenance!.changes[0], decision: 'accept', approval: { digest: 'dig-1', at: '2026-11-19' } },
          baseView.maintenance!.changes[1],
        ],
      },
    });
    assert.equal(gateText(), '已接受变更存在未一并接受的依赖项，请先接受对应依赖项。');
    assert.equal(submitBtn().disabled, true);

    // 5. 依赖项均已接受，但 c2 未勾选“我已核对”
    await renderView({
      ...baseView,
      maintenance: {
        ...baseView.maintenance!,
        changes: [
          { ...baseView.maintenance!.changes[0], decision: 'accept', approval: { digest: 'dig-1', at: '2026-11-19' } },
          { ...baseView.maintenance!.changes[1], decision: 'accept' },
        ],
      },
    });
    assert.equal(gateText(), '尚有 1 项已接受变更未勾选底部「我已核对」复选框。');
    assert.equal(submitBtn().disabled, true);

    // 6. 正在编辑候选正文时优先提示编辑中，以及 noteDirty 时提示笔记未保存
    await click(findButton(container, '编辑候选正文'));
    assert.equal(gateText(), '有 1 项候选正文正在编辑中，请先保存编辑并重新审核。');
    await renderView({
      ...baseView,
      maintenance: {
        ...baseView.maintenance!,
        changes: [
          { ...baseView.maintenance!.changes[0], decision: 'accept', approval: { digest: 'dig-1', at: '2026-11-19' } },
          { ...baseView.maintenance!.changes[1], decision: 'accept', approval: { digest: 'dig-2', at: '2026-11-19' } },
        ],
      },
    });
    // 所有门禁全部通过后提示消失、按钮解锁
    // 先清理上一步残留的组件内 editing state，使用独立挂载验证干净状态与 noteDirty 状态
    await act(async () => { root.unmount(); });
    const cleanRoot = createRoot(container);
    try {
      const readyView: DraftView = {
        ...baseView,
        maintenance: {
          ...baseView.maintenance!,
          changes: [
            { ...baseView.maintenance!.changes[0], decision: 'accept', approval: { digest: 'dig-1', at: '2026-11-19' } },
            { ...baseView.maintenance!.changes[1], decision: 'accept', approval: { digest: 'dig-2', at: '2026-11-19' } },
          ],
        },
      };
      await act(async () => {
        cleanRoot.render(createElement(KnowledgeMaintenanceReview, {
          view: readyView, body: '原文', onView: () => {}, onBack: () => {}, onOpenRaw: () => {}, onCommitted: async () => {},
        }));
        await tick();
      });
      assert.equal(gateText(), null);
      assert.equal(submitBtn().disabled, false);

      // 触发深度整理笔记未保存状态
      await click(findButton(container, '编辑笔记'));
      const noteTextarea = container.querySelector('.structured-note textarea') as HTMLTextAreaElement;
      await setInputValue(noteTextarea, '修改后的笔记定位');
      assert.equal(gateText(), '深度整理笔记有未保存修改，请先保存。');
      assert.equal(submitBtn().disabled, true);
    } finally {
      await act(async () => { cleanRoot.unmount(); });
    }
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('U3-04 & U3-05: WorkItemsPage 列表筛选空态重置、详情删除入口收拢与未保存返回防丢确认', async () => {
  const summaries: WorkItemSummary[] = [
    { id: 'w-c-1', revision: 1, title: '华东开票异常问题', kind: 'customer_issue', status: 'triage', updatedAt: '2026-11-19T01:00:00Z' },
    { id: 'w-c-2', revision: 1, title: '华南物流延迟已结案', kind: 'customer_issue', status: 'closed', updatedAt: '2026-11-19T02:00:00Z' },
    { id: 'w-p-1', revision: 1, title: '新品铺货率分析', kind: 'product_analysis', status: 'in_progress', updatedAt: '2026-11-19T03:00:00Z' },
    { id: 'w-p-2', revision: 1, title: '渠道毛利结构分析', kind: 'product_analysis', status: 'closed', updatedAt: '2026-11-19T04:00:00Z' },
  ];
  let customerDetail: WorkItem = {
    id: 'w-c-1', revision: 1, createdAt: '2026-11-19T01:00:00Z', updatedAt: '2026-11-19T01:00:00Z',
    title: '华东开票异常问题', kind: 'customer_issue', status: 'triage', feedback: '客户无法开具专票',
    rawIds: [], history: [], screenshots: [], nextStep: '核查税号', reportDraft: '',
  };
  const productDetail: WorkItem = {
    id: 'w-p-1', revision: 1, createdAt: '2026-11-19T03:00:00Z', updatedAt: '2026-11-19T03:00:00Z',
    title: '新品铺货率分析', kind: 'product_analysis', status: 'in_progress',
    analysis: { goal: '评估Q4新品铺货率', dataScope: '华东门店', confirmedConclusions: '', openQuestions: '' },
    rawIds: [], history: [], screenshots: [],
  };

  let deleteCalls = 0;
  let putCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/work-items' && method === 'GET') return jsonResponse({ items: summaries });
    if (url === '/api/work-items/w-c-1' && method === 'GET') return jsonResponse(customerDetail);
    if (url === '/api/work-items/w-p-1' && method === 'GET') return jsonResponse(productDetail);
    if (url === '/api/work-items/w-p-1/analysis-runs' && method === 'GET') return jsonResponse({ items: [] });
    if (url === '/api/work-items/w-c-1' && method === 'PUT') {
      putCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}'));
      customerDetail = { ...customerDetail, ...body, revision: customerDetail.revision + 1, updatedAt: '2026-11-19T05:00:00Z' };
      return jsonResponse(customerDetail);
    }
    if (url === '/api/work-items/w-c-1' && method === 'DELETE') {
      deleteCalls += 1;
      return jsonResponse({ id: 'w-c-1', deleted: true });
    }
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  let changedCount = 0;
  try {
    await act(async () => {
      root.render(createElement(WorkItemsPage, {
        initialId: null, raws: [], onOpenRaw: () => {}, onChanged: () => { changedCount += 1; },
      }));
      await tick();
    });
    await waitFor(() => container.querySelectorAll('.work-list-row').length === 4, '工作事项列表加载完成');

    const countText = () => container.querySelector('.work-section-heading .work-note')?.textContent;
    const rowTitles = () => [...container.querySelectorAll('.work-list-title')].map(el => el.textContent);
    const searchInput = () => container.querySelector('input[aria-label="搜索工作事项"]') as HTMLInputElement;
    const kindSelect = () => container.querySelector('select[aria-label="筛选事项类型"]') as HTMLSelectElement;
    const statusSelect = () => container.querySelector('select[aria-label="筛选进展状态"]') as HTMLSelectElement;

    assert.equal(countText(), '4 项');
    assert.equal(maybeButton(container, '重置筛选'), undefined);

    // 类型与进展状态筛选
    await setSelectValue(kindSelect(), 'product_analysis');
    assert.deepEqual(rowTitles(), ['新品铺货率分析', '渠道毛利结构分析']);
    assert.equal(countText(), '2 / 4 项');

    await setSelectValue(statusSelect(), 'closed');
    assert.deepEqual(rowTitles(), ['渠道毛利结构分析']);
    assert.equal(countText(), '1 / 4 项');

    // 搜索关键词导致空态
    await setInputValue(searchInput(), '不存在');
    assert.equal(container.querySelector('.work-list'), null);
    assert.equal(container.querySelector('p.work-note[role="status"]')?.textContent, '没有匹配筛选条件的工作事项。');
    assert.equal(countText(), '0 / 4 项');

    // 重置筛选
    await click(findButton(container, '重置筛选'));
    assert.equal(rowTitles().length, 4);
    assert.equal(countText(), '4 项');
    assert.equal(maybeButton(container, '重置筛选'), undefined);

    // 打开客户问题详情 -> 首屏不显示删除大面板，删除按钮在头部操作区
    await click(findButton(container, '华东开票异常问题'));
    await waitFor(() => container.querySelector('.work-detail h1')?.textContent === '华东开票异常问题', '进入客户问题详情');
    assert.equal(container.querySelector('section[aria-label="删除工作事项"]'), null);
    assert.ok(findButton(container.querySelector('.page-heading .work-buttons')!, '删除事项'));
    assert.equal(container.querySelectorAll('.work-dirty-badge').length, 0);

    // 无未保存修改时点击返回直接回到列表
    await click(findButton(container, '返回工作事项'));
    await waitFor(() => container.querySelectorAll('.work-list-row').length === 4, '无修改直接返回列表');

    // 再次进入详情 -> 修改「当前情况」字段触发脏标记与返回确认，保存后自动复位确认面板
    await click(findButton(container, '华东开票异常问题'));
    await waitFor(() => container.querySelector('.work-detail h1')?.textContent === '华东开票异常问题', '重新进入客户问题详情');
    const nextStepInput = [...container.querySelectorAll('label.field')]
      .find(label => label.textContent?.includes('下一步'))?.querySelector('input') as HTMLInputElement;
    await setInputValue(nextStepInput, '联系财务核实');
    assert.equal(container.querySelector('#work-current')?.parentElement?.querySelector('.work-dirty-badge')?.textContent, '有未保存修改');

    await click(findButton(container, '返回工作事项'));
    const leavePanel = () => container.querySelector('section.work-leave-confirm[role="alert"][aria-label="未保存修改确认"]');
    assert.ok(leavePanel());
    await click(findButton(leavePanel()!, '继续编辑'));
    assert.equal(leavePanel(), null);
    assert.equal(nextStepInput.value, '联系财务核实');

    // 再次触发 leaveConfirm 并直接保存「当前情况」，保存后自动隐藏 leaveConfirm 与脏标记
    await click(findButton(container, '返回工作事项'));
    assert.ok(leavePanel());
    await click(findButton(container, '保存当前情况'));
    await waitFor(() => putCalls === 1 && leavePanel() === null, '保存后自动收起离开确认');
    assert.equal(container.querySelectorAll('.work-dirty-badge').length, 0);

    // 在「处理记录」与「手工技术反馈」输入触发 #work-history 脏标记，再点放弃修改并返回
    const reportTextarea = [...container.querySelectorAll('label.field')]
      .find(label => label.textContent?.includes('技术反馈正文'))?.querySelector('textarea') as HTMLTextAreaElement;
    await setInputValue(reportTextarea, '草稿正文未保存');
    assert.equal(container.querySelector('#work-history')?.parentElement?.querySelector('.work-dirty-badge')?.textContent, '有未保存修改');
    await click(findButton(container, '返回工作事项'));
    assert.ok(leavePanel());
    await click(findButton(leavePanel()!, '放弃修改并返回'));
    await waitFor(() => container.querySelectorAll('.work-list-row').length === 4, '放弃修改后返回列表');

    // 打开「产品分析」详情验证 analysisDirty 与删除面板收拢
    await click(findButton(container, '新品铺货率分析'));
    await waitFor(() => container.querySelector('.work-detail h1')?.textContent === '新品铺货率分析', '进入产品分析详情');
    const goalTextarea = container.querySelector('#work-goal') as HTMLTextAreaElement;
    await setInputValue(goalTextarea, '变更后的分析目标');
    assert.equal(container.querySelector('#work-current')?.parentElement?.querySelector('.work-dirty-badge')?.textContent, '有未保存修改');
    // 撤销修改使 anyDirty 恢复 false
    await setInputValue(goalTextarea, '评估Q4新品铺货率');
    assert.equal(container.querySelectorAll('.work-dirty-badge').length, 0);
    await click(findButton(container, '返回工作事项'));
    await waitFor(() => container.querySelectorAll('.work-list-row').length === 4, '撤销修改后可直接返回列表');

    // 验证删除面板点击展开/取消收起及确认删除后直接返回
    await click(findButton(container, '华东开票异常问题'));
    await waitFor(() => container.querySelector('.work-detail h1')?.textContent === '华东开票异常问题', '进入客户问题验证删除');
    await click(findButton(container.querySelector('.page-heading .work-buttons')!, '删除事项'));
    const delPanel = () => container.querySelector('section[aria-label="删除工作事项"]');
    assert.ok(delPanel());
    await click(findButton(delPanel()!, '取消删除'));
    assert.equal(delPanel(), null);

    await click(findButton(container.querySelector('.page-heading .work-buttons')!, '删除事项'));
    await click(findButton(delPanel()!, '确认删除事项'));
    await waitFor(() => deleteCalls === 1 && container.querySelectorAll('.work-list-row').length === 4, '确认删除后直接返回列表');
    assert.ok(changedCount >= 2);
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
  }
});
