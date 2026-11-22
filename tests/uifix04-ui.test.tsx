import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Audit, Meeting, MeetingCatalog, Prompt, Wiki } from '../app/api.ts';

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
  HTMLDetailsElement: window.HTMLDetailsElement,
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

const scrollCalls: Array<{ tag: string; className: string; arg: unknown }> = [];
window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: unknown) {
  scrollCalls.push({ tag: this.tagName, className: this.className, arg });
};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../app/App.tsx');
const { WikiPage } = await import('../app/pages/WikiPage.tsx');
const { WikiInspectionPanel } = await import('../app/components/WikiInspectionPanel.tsx');
const { MeetingPage } = await import('../app/pages/MeetingPage.tsx');
const { MeetingMinutes } = await import('../app/MeetingMinutes.tsx');
const { PromptLibraryPage } = await import('../app/pages/PromptLibraryPage.tsx');
const { PromptAiWorkbench } = await import('../app/pages/PromptAiWorkbench.tsx');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await tick(10);
    });
  }
  assert.fail(`等待超时：${label}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function maybeButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(label)) as
    HTMLButtonElement | undefined;
}
function findButton(container: ParentNode, label: string): HTMLButtonElement {
  const found =
    [...container.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === label) ??
    maybeButton(container, label);
  assert.ok(found, `找不到按钮：${label}`);
  return found as HTMLButtonElement;
}
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
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
async function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto =
      el instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    assert.ok(setter);
    setter.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
}

test('U4-01 & U4-02: Wiki 待审核前置、选段无反馈展开聚焦绑定/改整页/提交后清除、主动检查范围搜索与清空', async () => {
  const longSnippet =
    '这是一段明确超过八十个字符长度的虚构测试段落文本，专门用来验证界面截取展示省略号效果以及选段绑定之后是否能正确截断并完整保存原始锚点文本到服务端进行精确定位核验与处理。';
  const wikiA: Wiki = {
    id: 'wiki-u4-a',
    title: '动销率复盘',
    type: 'metric',
    domain: 'fmcg',
    category: 'industry_basics',
    aliases: [],
    tags: [],
    sources: [],
    body: `前缀文本。${longSnippet}后缀文本。`,
    revision: 1,
    created: '2026-11-19',
    updated: '2026-11-19',
    knowledge_status: 'needs_verification',
    review_status: 'unreviewed',
    confidence: 'low',
    source_level: 'D',
    links: [],
  };
  const wikiB: Wiki = { ...wikiA, id: 'wiki-u4-b', title: 'Beta 渠道分析' };
  const schema = {
    domain: 'fmcg',
    types: [{ id: 'metric', label: '指标', description: '' }],
    categories: [{ id: 'industry_basics', label: '行业基础' }],
    enums: { knowledge_status: ['needs_verification'], confidence: ['low'], source_level: ['D'] },
    pageTemplates: {},
    sourcePolicy: { levels: [{ id: 'D', label: 'D', description: '' }], guidance: '' },
  };

  const postedAudits: Array<Record<string, unknown>> = [];
  const auditsList: Audit[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/wiki/schema') return jsonResponse(schema);
    if (url.startsWith('/api/raw?')) return jsonResponse({ items: [] });
    if (url.startsWith('/api/wiki?'))
      return jsonResponse({ items: [wikiA, wikiB], categoryCounts: { industry_basics: 2 } });
    if (url === `/api/wiki/${wikiA.id}`) return jsonResponse(wikiA);
    if (url === `/api/wiki/${wikiB.id}`) return jsonResponse(wikiB);
    if (url === '/api/knowledge/workflows') {
      return jsonResponse({
        items: [
          {
            id: 'wf-u4-1',
            kind: 'update',
            status: 'pending_confirmation',
            title: '待审工作流一',
            revision: 1,
            createdAt: '2026-11-19T00:00:00Z',
            updatedAt: '2026-11-19T00:00:00Z',
            targetWikiId: wikiA.id,
            lastCommitError: null,
            commitOperationId: null,
          },
        ],
      });
    }
    if (url.startsWith('/api/drafts?')) {
      return jsonResponse({
        items: [
          {
            id: 'draft-u4-1',
            rawId: 'raw-1',
            rawTitle: '来源甲',
            title: '待审草稿一',
            updatedAt: '2026-11-19T00:00:00Z',
          },
        ],
      });
    }
    if (url.startsWith('/api/audits?')) return jsonResponse({ items: auditsList });
    if (url === '/api/audits' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      postedAudits.push(body);
      const created: Audit = {
        id: `audit-${postedAudits.length}`,
        wikiId: String(body.wikiId),
        scope: body.scope as 'page' | 'paragraph',
        severity: body.severity as Audit['severity'],
        comment: String(body.comment),
        status: 'open',
        revision: 1,
        createdRevision: 1,
        pageBodySha256: 'a'.repeat(64),
        createdAt: '2026-11-19T00:00:00Z',
        anchor: (body.anchor as Audit['anchor']) ?? { before: '', text: '', after: '' },
        location: { status: 'found', start: 0, end: 10, method: 'exact' },
        decisionHistory: [],
      };
      auditsList.push(created);
      return jsonResponse(created, 201);
    }
    if (url.startsWith('/api/audits/audit-')) {
      const id = url.split('/').pop()!;
      const found = auditsList.find((item) => item.id === id);
      return jsonResponse({ audit: found, draft: null, conflicts: [] });
    }
    if (url === '/api/knowledge/inspections/current') return jsonResponse(null);
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(WikiPage, { onOpenRaw: () => {}, onChanged: () => {} }));
      await tick();
    });

    await waitFor(
      () => !!container.querySelector('.wiki-detail h2') && !!container.querySelector('.pending-wiki-drafts'),
      'Wiki 详情与待审核提示加载完成',
    );

    // U4-02: 待审核更新与综合、待审核草稿必须位于 .wiki-workspace 上方
    const overviewPanel = container.querySelector('#wiki-view-overview')!;
    const wfSection = overviewPanel.querySelector('.pending-knowledge-workflows')!;
    const draftSection = overviewPanel.querySelector('.pending-wiki-drafts')!;
    const workspace = overviewPanel.querySelector('.wiki-workspace')!;
    assert.ok(
      wfSection.compareDocumentPosition(workspace) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      '待审核工作流必须在 .wiki-workspace 上方',
    );
    assert.ok(
      draftSection.compareDocumentPosition(workspace) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      '待审核草稿必须在 .wiki-workspace 上方',
    );

    // U4-01: 切到 Markdown原文 并模拟选段
    const selectParagraph = async () => {
      const pre = container.querySelector('.wiki-body-view') as HTMLPreElement;
      const textNode = pre.firstChild!;
      const start = (textNode.textContent ?? '').indexOf(longSnippet);
      assert.ok(start >= 0);
      const range = window.document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + longSnippet.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      await act(async () => {
        pre.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
        await tick();
      });
    };

    await click(findButton(container, 'Markdown原文'));
    await selectParagraph();
    assert.ok(container.querySelector('.audit-selection'), '选中段落后出现选段操作条');

    // 空反馈下点击「对选中段落提交 Audit」：不报错、展开面板、显示绑定提示、scrollIntoView + 聚焦反馈框
    scrollCalls.length = 0;
    await click(findButton(container.querySelector('.audit-selection')!, '对选中段落提交 Audit'));
    assert.equal(container.querySelector('.audit-error'), null, '空反馈点击对选中段落提交不应直接报错');
    assert.equal(container.querySelector('.audit-toggle')?.getAttribute('aria-expanded'), 'true');
    const boundBanner = container.querySelector('.audit-bound-anchor[role="status"]')!;
    assert.ok(boundBanner, '应展示绑定选中段落提示');
    assert.match(boundBanner.textContent ?? '', new RegExp(`已绑定选中段落：「${longSnippet.slice(0, 80)}…`));
    const commentBox = container.querySelector('.audit-create textarea') as HTMLTextAreaElement;
    assert.equal(window.document.activeElement, commentBox, '展开后应自动聚焦反馈文本框');
    assert.ok(
      scrollCalls.some(
        (call) => call.tag === 'TEXTAREA' && JSON.stringify(call.arg) === JSON.stringify({ block: 'nearest' }),
      ),
      '展开后应对反馈文本框调用 scrollIntoView',
    );
    assert.ok(
      maybeButton(container.querySelector('.audit-create-actions')!, '提交选中段落 Audit')?.disabled,
      '空反馈时提交选中段落 Audit 禁用',
    );
    assert.ok(
      maybeButton(container.querySelector('.audit-create-actions')!, '提交整页 Audit')?.disabled,
      '空反馈时提交整页 Audit 禁用',
    );

    // 点击「改为整页 Audit」解除绑定并恢复单按钮
    await click(findButton(boundBanner, '改为整页 Audit'));
    assert.equal(container.querySelector('.audit-bound-anchor'), null);
    assert.equal(container.querySelector('.audit-selection'), null);
    assert.equal(maybeButton(container.querySelector('.audit-create-actions')!, '提交选中段落 Audit'), undefined);
    assert.ok(findButton(container.querySelector('.audit-create-actions')!, '提交整页 Audit'));

    // 重新选段 -> 点击「对选中段落提交 Audit」-> 补填反馈 -> 点击「提交选中段落 Audit」提交并清空锚点
    await selectParagraph();
    await click(findButton(container.querySelector('.audit-selection')!, '对选中段落提交 Audit'));
    await setInputValue(
      container.querySelector('.audit-create textarea') as HTMLTextAreaElement,
      '段落口径需补充原始出处',
    );
    const submitParagraphBtn = findButton(container.querySelector('.audit-create-actions')!, '提交选中段落 Audit');
    assert.equal(submitParagraphBtn.disabled, false);
    await click(submitParagraphBtn);

    await waitFor(() => postedAudits.length === 1, '段落 Audit 提交完成');
    assert.equal(postedAudits[0].scope, 'paragraph');
    assert.equal(postedAudits[0].comment, '段落口径需补充原始出处');
    assert.equal((postedAudits[0].anchor as { text: string }).text, longSnippet);
    assert.equal(container.querySelector('.audit-bound-anchor'), null, '提交成功后清理绑定锚点提示');
    assert.equal(container.querySelector('.audit-selection'), null, '提交成功后清理选中段落栏');
    assert.equal(maybeButton(container.querySelector('.audit-create-actions')!, '提交选中段落 Audit'), undefined);

    // 已有反馈时点击「对选中段落提交 Audit」直接提交并清除锚点
    await setInputValue(container.querySelector('.audit-create textarea') as HTMLTextAreaElement, '预先填好的选段反馈');
    await selectParagraph();
    await click(findButton(container.querySelector('.audit-selection')!, '对选中段落提交 Audit'));
    await waitFor(() => postedAudits.length === 2, '已有反馈时直接提交段落 Audit');
    assert.equal(postedAudits[1].scope, 'paragraph');
    assert.equal(postedAudits[1].comment, '预先填好的选段反馈');
    assert.equal(container.querySelector('.audit-bound-anchor'), null);
    assert.equal(container.querySelector('.audit-selection'), null);

    // U4-02: WikiInspectionPanel 范围搜索、无匹配提示与清空已选
    await act(async () => {
      root.unmount();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const inspectionContainer = window.document.createElement('div');
  container.appendChild(inspectionContainer);
  const inspectionRoot = createRoot(inspectionContainer);
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/knowledge/inspections/current') return jsonResponse(null);
    return jsonResponse({});
  }) as typeof fetch;
  try {
    await act(async () => {
      inspectionRoot.render(
        createElement(WikiInspectionPanel, {
          items: [wikiA, wikiB],
          currentWikiId: wikiA.id,
          onOpenWiki: () => {},
          onOpenRaw: () => {},
          onOpenDraft: () => {},
        }),
      );
      await tick();
    });
    await waitFor(
      () => !(inspectionContainer.querySelector('fieldset') as HTMLFieldSetElement).disabled,
      'Inspection 面板就绪',
    );

    const scopeSearch = inspectionContainer.querySelector(
      'input[type="search"][aria-label="搜索检查范围知识页"]',
    ) as HTMLInputElement;
    assert.ok(scopeSearch, '应渲染检查范围搜索框');
    assert.ok(findButton(inspectionContainer, '清空已选（1）'), '已有默认选中时应展示清空已选按钮');

    // 不区分大小写搜索匹配 wikiB，同时保留隐藏的 wikiA 选中计数
    await setInputValue(scopeSearch, 'beta');
    const visibleBoxes = [
      ...inspectionContainer.querySelectorAll('.inspection-scope-picker input[type="checkbox"]'),
    ] as HTMLInputElement[];
    assert.equal(visibleBoxes.length, 1);
    assert.match(visibleBoxes[0].closest('label')?.textContent ?? '', /Beta 渠道分析/);
    assert.match(inspectionContainer.textContent ?? '', /已选 1 页/);
    await click(visibleBoxes[0]);
    assert.ok(findButton(inspectionContainer, '清空已选（2）'));

    // 无匹配提示
    await setInputValue(scopeSearch, '绝对不会命中的关键词');
    assert.equal(inspectionContainer.querySelectorAll('.inspection-scope-picker input[type="checkbox"]').length, 0);
    assert.equal(
      inspectionContainer.querySelector('fieldset p.muted-copy[role="status"]')?.textContent,
      '没有匹配该关键词的知识页。',
    );

    // 清空搜索恢复 2 个选项并保持 2 项选中
    await setInputValue(scopeSearch, '');
    assert.equal(inspectionContainer.querySelectorAll('.inspection-scope-picker input[type="checkbox"]').length, 2);
    await click(findButton(inspectionContainer, '清空已选（2）'));
    assert.equal(maybeButton(inspectionContainer, '清空已选'), undefined);
    assert.match(inspectionContainer.textContent ?? '', /已选 0 页/);
    assert.equal(findButton(inspectionContainer, '开始本次检查').disabled, true);
  } finally {
    await act(async () => {
      inspectionRoot.unmount();
    });
    inspectionContainer.remove();
    globalThis.fetch = originalFetch;
  }
});

test('U4-03 & U4-04: 会议本地纪要默认展开、弹窗焦点与 Escape/遮罩关闭、工作副本就近保存、App 切页清理会议参数', async () => {
  const typeId = '11111111-1111-4111-8111-111111111111';
  const mEmptyId = '22222222-2222-4222-8222-222222222221';
  const mHasId = '22222222-2222-4222-8222-222222222222';
  const catalog: MeetingCatalog = {
    schema_version: 1,
    revision: 1,
    types: [{ id: typeId, name: '需求对接', active: true }],
    tags: [],
  };
  const makeMeeting = (id: string, title: string, withImport: boolean): Meeting => ({
    schema_version: 1,
    meeting_id: id,
    revision: 1,
    created_at: '2026-11-19T00:00:00Z',
    updated_at: '2026-11-19T00:00:00Z',
    title,
    meeting_date: '2026-11-19',
    meeting_time: null,
    meeting_type: typeId,
    tags: [],
    customer: null,
    project: null,
    description: null,
    recording_url: null,
    minutes_url: null,
    confidentiality: 'Internal',
    storage_mode: 'local_archive',
    local_storage_authorized: true,
    external_ai_authorized: false,
    raw_transfer_authorized: false,
    policy_updated_at: '2026-11-19T00:00:00Z',
    imports: withImport
      ? [
          {
            import_id: 'imp-1',
            imported_at: '2026-11-19T01:00:00Z',
            imported_minutes: '原始纪要正文',
            editable_minutes: '初始工作副本',
            original_filename: null,
            original_sha256: 'a'.repeat(64),
          },
        ]
      : [],
    active_import_id: withImport ? 'imp-1' : null,
    raw_links: [],
    raw_source_id: null,
    capabilities: {
      canImportMinutes: true,
      canRegisterRaw: false,
      canUseAi: false,
      importReason: '',
      rawReason: '',
      aiReason: '',
    },
  });
  const mEmpty = makeMeeting(mEmptyId, '无纪要会议', false);
  const mHas = makeMeeting(mHasId, '含纪要会议', true);
  const toSummary = (m: Meeting) => {
    const { imports: _i, active_import_id: _a, raw_links: _r, raw_source_id: _rs, capabilities: _c, ...rest } = m;
    return rest;
  };

  const patchGate = deferred<Response>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/meeting-catalog') return jsonResponse(catalog);
    if (url === '/api/meetings' && method === 'GET')
      return jsonResponse({ items: [toSummary(mHas), toSummary(mEmpty)] });
    if (url === `/api/meetings/${mEmptyId}`) return jsonResponse(mEmpty);
    if (url === `/api/meetings/${mHasId}`) return jsonResponse(mHas);
    if (url === `/api/meetings/${mHasId}/minutes/imp-1` && method === 'PATCH') return patchGate.promise;
    if (url === '/api/meeting-catalog/types' && method === 'POST') return deferred<Response>().promise;
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const meetingContainer = window.document.createElement('div');
  container.appendChild(meetingContainer);
  const root = createRoot(meetingContainer);
  try {
    await act(async () => {
      root.render(createElement(MeetingPage));
      await tick();
    });
    await waitFor(() => meetingContainer.querySelectorAll('.meeting-row').length === 2, '会议列表加载完成');

    const minutesGroup = () =>
      [...meetingContainer.querySelectorAll('details.meeting-group')].find((d) =>
        d.textContent?.includes('本地会议纪要'),
      ) as HTMLDetailsElement;

    // 选中有本地纪要版本的会议 -> 默认展开
    await click(findButton(meetingContainer, '含纪要会议'));
    await waitFor(
      () => meetingContainer.querySelector('.meeting-detail h2')?.textContent === '含纪要会议',
      '含纪要会议详情加载',
    );
    assert.equal(minutesGroup().open, true, 'imports.length > 0 时本地会议纪要应默认展开');

    // 切换到无本地纪要版本的会议 -> 默认折叠
    await click(findButton(meetingContainer, '无纪要会议'));
    await waitFor(
      () => meetingContainer.querySelector('.meeting-detail h2')?.textContent === '无纪要会议',
      '无纪要会议详情加载',
    );
    assert.equal(minutesGroup().open, false, 'imports.length === 0 时本地会议纪要默认折叠');

    // 再切回含纪要会议 -> 重新默认展开
    await click(findButton(meetingContainer, '含纪要会议'));
    await waitFor(
      () => meetingContainer.querySelector('.meeting-detail h2')?.textContent === '含纪要会议',
      '切回含纪要会议',
    );
    assert.equal(minutesGroup().open, true);

    // 验证 MeetingEditor / PolicyDialog / CatalogDialog 焦点捕获、Escape 与遮罩关闭
    const newBtn = findButton(meetingContainer, '新建会议');
    newBtn.focus();
    await click(newBtn);
    const editorDialog = meetingContainer.querySelector(
      'section.meeting-dialog[aria-labelledby="meeting-editor-title"]',
    ) as HTMLElement;
    assert.ok(editorDialog && editorDialog.contains(window.document.activeElement), 'MeetingEditor 应捕获焦点');
    await pressEscape(window.document.activeElement);
    assert.equal(meetingContainer.querySelector('[role="dialog"]'), null, 'Escape 应关闭 MeetingEditor');
    assert.equal(window.document.activeElement, newBtn, '关闭后焦点还原到触发按钮');

    const policyBtn = findButton(meetingContainer.querySelector('.meeting-detail')!, '安全策略');
    policyBtn.focus();
    await click(policyBtn);
    const policyDialog = meetingContainer.querySelector(
      'section.meeting-dialog[aria-labelledby="policy-title"]',
    ) as HTMLElement;
    assert.ok(policyDialog && policyDialog.contains(window.document.activeElement), 'PolicyDialog 应捕获焦点');
    await pressEscape(window.document.activeElement);
    assert.equal(meetingContainer.querySelector('[role="dialog"]'), null, 'Escape 应关闭 PolicyDialog');
    assert.equal(window.document.activeElement, policyBtn);

    await click(policyBtn);
    await act(async () => {
      (meetingContainer.querySelector('.modal-scrim') as HTMLElement).dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true }),
      );
      await tick();
    });
    assert.equal(meetingContainer.querySelector('[role="dialog"]'), null, '点击遮罩应关闭 PolicyDialog');

    const manageTypesBtn = findButton(meetingContainer.querySelector('.meeting-toolbar')!, '管理类型');
    manageTypesBtn.focus();
    await click(manageTypesBtn);
    const catalogDialog = meetingContainer.querySelector(
      'section.meeting-dialog[aria-labelledby="catalog-title"]',
    ) as HTMLElement;
    assert.ok(catalogDialog && catalogDialog.contains(window.document.activeElement), 'CatalogDialog 应捕获焦点');
    // 提交中（busy）期间 Escape 与遮罩点击均不可关闭弹窗
    await setInputValue(catalogDialog.querySelector('input') as HTMLInputElement, '新类型');
    await click(findButton(catalogDialog, '新增'));
    await pressEscape(window.document.activeElement);
    await act(async () => {
      (meetingContainer.querySelector('.modal-scrim') as HTMLElement).dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true }),
      );
      await tick();
    });
    assert.ok(
      meetingContainer.querySelector('section.meeting-dialog[aria-labelledby="catalog-title"]'),
      'busy 期间 Escape 与遮罩不得关闭弹窗',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    meetingContainer.remove();
    globalThis.fetch = originalFetch;
  }

  // 重新验证空闲状态下 Escape 与遮罩均可关闭 CatalogDialog，并完成工作副本就近保存
  const busyFreeContainer = window.document.createElement('div');
  container.appendChild(busyFreeContainer);
  const busyFreeRoot = createRoot(busyFreeContainer);
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/meeting-catalog') return jsonResponse(catalog);
    if (url === '/api/meetings' && method === 'GET')
      return jsonResponse({ items: [toSummary(mHas), toSummary(mEmpty)] });
    if (url === `/api/meetings/${mHasId}`) return jsonResponse(mHas);
    if (url === `/api/meetings/${mHasId}/minutes/imp-1` && method === 'PATCH') return patchGate.promise;
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;
  try {
    await act(async () => {
      busyFreeRoot.render(createElement(MeetingPage));
      await tick();
    });
    await waitFor(() => busyFreeContainer.querySelectorAll('.meeting-row').length === 2, '会议列表再次加载');
    const manageTypesBtn = findButton(busyFreeContainer.querySelector('.meeting-toolbar')!, '管理类型');
    manageTypesBtn.focus();
    await click(manageTypesBtn);
    await pressEscape(window.document.activeElement);
    assert.equal(busyFreeContainer.querySelector('[role="dialog"]'), null, 'Escape 应关闭 CatalogDialog');
    assert.equal(window.document.activeElement, manageTypesBtn);

    await click(manageTypesBtn);
    await act(async () => {
      (busyFreeContainer.querySelector('.modal-scrim') as HTMLElement).dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true }),
      );
      await tick();
    });
    assert.equal(busyFreeContainer.querySelector('[role="dialog"]'), null, '点击遮罩应关闭 CatalogDialog');

    await click(findButton(busyFreeContainer, '含纪要会议'));
    await waitFor(
      () => busyFreeContainer.querySelector('.meeting-detail h2')?.textContent === '含纪要会议',
      '选中含纪要会议',
    );

    // U4-04: MeetingMinutes 编辑态就近「保存工作副本」按钮与底部「保存会议档案」并存
    await click(findButton(busyFreeContainer, '编辑工作副本'));
    const actionsBar = busyFreeContainer.querySelector('.meeting-minute-actions')!;
    const buttonsInActions = [...actionsBar.querySelectorAll('button')].map((b) => b.textContent);
    assert.deepEqual(buttonsInActions, ['保存工作副本', '取消编辑'], '保存工作副本应位于取消编辑左侧');
    const nearbySave = findButton(actionsBar, '保存工作副本');
    const bottomSave = findButton(busyFreeContainer.querySelector('.meeting-minute-save')!, '保存会议档案');
    assert.equal(nearbySave.disabled, true, '未改动前保存工作副本禁用');
    assert.equal(bottomSave.disabled, true);

    await setInputValue(
      busyFreeContainer.querySelector('textarea[aria-label="编辑纪要工作副本"]') as HTMLTextAreaElement,
      '就近保存的新工作副本',
    );
    assert.equal(nearbySave.disabled, false);
    assert.equal(bottomSave.disabled, false);

    await click(nearbySave);
    assert.equal(findButton(actionsBar, '正在保存…').disabled, true, '保存中按钮显示正在保存…并禁用');
    assert.equal(bottomSave.disabled, true);
    patchGate.resolve(
      jsonResponse({
        ...mHas,
        revision: 2,
        imports: [{ ...mHas.imports[0], editable_minutes: '就近保存的新工作副本' }],
      }),
    );
    await waitFor(
      () => busyFreeContainer.querySelector('.meeting-minute-save [role="status"]')?.textContent === '纪要已保存。',
      '就近保存完成',
    );
  } finally {
    await act(async () => {
      busyFreeRoot.unmount();
    });
    busyFreeContainer.remove();
    globalThis.fetch = originalFetch;
  }

  // U4-04 独立组件验证（确保 standalone MeetingMinutes 也通过）
  const calls: Array<{ url: string; body: unknown }> = [];
  let refreshed = 0;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), body: init.body ? JSON.parse(String(init.body)) : null });
    return jsonResponse({ ...mHas, revision: 2 });
  }) as typeof fetch;
  const minutesContainer = window.document.createElement('div');
  container.appendChild(minutesContainer);
  const minutesRoot = createRoot(minutesContainer);
  try {
    await act(async () => {
      minutesRoot.render(
        createElement(MeetingMinutes, {
          meeting: mHas,
          onRefresh: () => {
            refreshed += 1;
          },
        }),
      );
      await tick();
    });
    await click(findButton(minutesContainer, '编辑工作副本'));
    await setInputValue(
      minutesContainer.querySelector('textarea[aria-label="编辑纪要工作副本"]') as HTMLTextAreaElement,
      '独立验证工作副本',
    );
    await click(findButton(minutesContainer.querySelector('.meeting-minute-actions')!, '保存工作副本'));
    await waitFor(() => calls.length === 1 && refreshed === 1, 'MeetingMinutes 就近保存请求与回调完成');
    assert.deepEqual(calls[0].body, { baseRevision: 1, editable_minutes: '独立验证工作副本' });
  } finally {
    await act(async () => {
      minutesRoot.unmount();
    });
    minutesContainer.remove();
    globalThis.fetch = originalFetch;
  }

  // U4-03: App.tsx 切出会议页清理会议参数并保留无关参数与哈希
  window.history.replaceState(
    {},
    '',
    `/?meeting=${mHasId}&mq=test&mt=t1&mg=g1&mc=c1&mp=p1&ml=Internal&mo=asc&keep=yes#sec`,
  );
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/raw') return jsonResponse({ items: [] });
    if (url === '/api/stats')
      return jsonResponse({
        rawCount: 0,
        wikiCount: 0,
        thisWeekNewCount: 0,
        pendingConfirmationCount: 0,
        openAuditCount: 0,
        promptCount: 0,
        weekStartsOn: '',
      });
    if (url === '/api/raw-processing') return jsonResponse({ items: [] });
    if (url === '/api/home/actions') return jsonResponse({ items: [], sources: { draft: { status: 'ok' } } });
    if (url.startsWith('/api/automation/candidates'))
      return jsonResponse({
        date: '2026-11-19',
        dates: ['2026-11-19'],
        items: [],
        counts: { fetched: 0, pending: 0, organizing: 0, drafts: 0, failed: 0 },
      });
    if (url === '/api/automation/status')
      return jsonResponse({
        paused: false,
        scheduler: { healthy: true, lastTickAt: null },
        instance: { pid: 1, port: 4317, mode: 'development', startedAt: '', hostname: 'localhost' },
        nextRunAt: null,
        failuresLast24Hours: 0,
        writeToken: 't',
      });
    if (url.startsWith('/api/news/today'))
      return jsonResponse({
        date: '2026-11-19',
        aiEnabled: false,
        edition: { schemaVersion: 1, date: '2026-11-19', updatedAt: '2026-11-19T00:00:00Z', sections: {} },
        fallbacks: {},
      });
    if (url.startsWith('/api/work-items')) return jsonResponse({ items: [] });
    if (url === '/api/wiki/schema')
      return jsonResponse({
        types: [],
        categories: [],
        pageTemplates: {},
        enums: { knowledge_status: [], confidence: [], source_level: [] },
        sourcePolicy: { levels: [], guidance: '' },
      });
    if (url.startsWith('/api/wiki')) return jsonResponse({ items: [], categoryCounts: {} });
    if (url.startsWith('/api/drafts')) return jsonResponse({ items: [] });
    if (url === '/api/knowledge/workflows') return jsonResponse({ items: [] });
    if (url === '/api/meeting-catalog') return jsonResponse(catalog);
    if (url === '/api/meetings') return jsonResponse({ items: [toSummary(mHas)] });
    if (url === `/api/meetings/${mHasId}`) return jsonResponse(mHas);
    return jsonResponse({ items: [] });
  }) as typeof fetch;

  const appContainer = window.document.createElement('div');
  container.appendChild(appContainer);
  const appRoot = createRoot(appContainer);
  try {
    await act(async () => {
      appRoot.render(createElement(App));
      await tick();
    });
    await click(findButton(appContainer.querySelector('.sidebar')!, '会议档案'));
    await waitFor(
      () => appContainer.querySelector('.meeting-detail h2')?.textContent === '含纪要会议',
      '会议档案页加载完成',
    );
    assert.ok(window.location.search.includes(`meeting=${mHasId}`), '切入会议档案页时应保留会议查询参数');

    await click(findButton(appContainer.querySelector('.sidebar')!, '知识库'));
    assert.equal(window.location.search, '?keep=yes', '切出会议档案页应精准移除 8 个会议查询参数并保留其他参数');
    assert.equal(window.location.hash, '#sec', '切出会议档案页应保留 URL 哈希');

    // 无其他参数时彻底清空 search
    window.history.replaceState({}, '', '/?meeting=m2&mq=only');
    await click(findButton(appContainer.querySelector('.sidebar')!, '首页'));
    assert.equal(window.location.search, '');
  } finally {
    await act(async () => {
      appRoot.unmount();
    });
    appContainer.remove();
    window.history.replaceState({}, '', '/');
    globalThis.fetch = originalFetch;
  }
});

test('U4-05: PromptAiWorkbench 保存后展示「在模板库中查看」并清筛选直达选中新 Prompt', async () => {
  const existingId = '11111111-1111-4111-8111-111111111111';
  const generatedId = '22222222-2222-4222-8222-222222222222';
  const existingPrompt: Prompt = {
    id: existingId,
    name: '已有模板甲',
    category: 'customer',
    scenario: '客户访谈',
    body: '已有正文。',
    variables: [],
    inputRequirements: '',
    outputRequirements: '',
    relatedWikiIds: [],
    examples: '',
    tags: ['旧标签'],
    favorite: false,
    createdAt: '2026-11-18T00:00:00Z',
    updatedAt: '2026-11-18T00:00:00Z',
    version: 1,
    source: 'manual',
  };
  const newPrompt: Prompt = {
    id: generatedId,
    name: '新生成渠道调研模板',
    category: 'business_analysis',
    scenario: '渠道补货诊断',
    body: '请分析 {{区域}} 补货问题。',
    variables: ['区域'],
    inputRequirements: '输入',
    outputRequirements: '输出',
    relatedWikiIds: [],
    examples: '',
    tags: ['渠道'],
    favorite: false,
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
    version: 1,
    source: 'ai_generated',
  };
  const promptsDB = [existingPrompt];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/prompts/schema') {
      return jsonResponse({
        categories: [
          { id: 'customer', label: '客户', help: '' },
          { id: 'business_analysis', label: '业务分析', help: '' },
        ],
      });
    }
    if (url === '/api/wiki') return jsonResponse({ items: [] });
    if (url === '/api/prompt-ai/schema')
      return jsonResponse({ templates: [{ id: 'customer_interview', label: '经销商访谈准备' }] });
    if (url === '/api/prompt-ai/drafts') return jsonResponse({ items: [] });
    if (method === 'GET' && (url === '/api/prompts' || url.startsWith('/api/prompts?'))) {
      const params = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
      const q = params.get('q') ?? '';
      const category = params.get('category') ?? '';
      const tag = params.get('tag') ?? '';
      const favorite = params.get('favorite') ?? '';
      const filtered = promptsDB.filter(
        (item) =>
          (!category || item.category === category) &&
          (!tag || item.tags.includes(tag)) &&
          (favorite !== 'true' || item.favorite) &&
          (!q || item.name.includes(q) || item.body.includes(q)),
      );
      return jsonResponse({
        items: filtered,
        categoryCounts: { customer: 1, business_analysis: promptsDB.length - 1 },
      });
    }
    if (url === '/api/prompt-ai/generate' && method === 'POST') {
      return jsonResponse(
        {
          draftId: 'draft-gen-1',
          preview: {
            name: newPrompt.name,
            category: newPrompt.category,
            scenario: newPrompt.scenario,
            body: newPrompt.body,
            inputRequirements: newPrompt.inputRequirements,
            outputRequirements: newPrompt.outputRequirements,
            relatedWikiIds: [],
            examples: '',
            tags: newPrompt.tags,
            favorite: false,
          },
          relatedWiki: [],
          contextBudget: { used: 0, maxTotal: 12000 },
        },
        201,
      );
    }
    if (url === '/api/prompt-ai/drafts/draft-gen-1/confirm' && method === 'POST') {
      promptsDB.push(newPrompt);
      return jsonResponse({ prompt: newPrompt }, 201);
    }
    if (url === `/api/prompts/${existingId}`) return jsonResponse({ prompt: existingPrompt, wikiLinks: [] });
    if (url === `/api/prompts/${generatedId}`) return jsonResponse({ prompt: newPrompt, wikiLinks: [] });
    if (url.endsWith('/versions')) return jsonResponse({ items: [] });
    if (url.includes('/feedback?')) return jsonResponse({ items: [] });
    return jsonResponse({ error: { message: `Unexpected ${method} ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const libContainer = window.document.createElement('div');
  container.appendChild(libContainer);
  const root = createRoot(libContainer);
  try {
    await act(async () => {
      root.render(createElement(PromptLibraryPage, { onChanged: () => {}, onOpenWiki: () => {} }));
      await tick();
    });
    await waitFor(() => libContainer.querySelectorAll('.prompt-list-item').length === 1, '初始 Prompt 列表加载完成');

    // 先在模板库设置全部四类筛选（制造 0 匹配）
    await setInputValue(
      libContainer.querySelector('input[aria-label="搜索 Prompt"]') as HTMLInputElement,
      '不存在搜索词',
    );
    await setInputValue(libContainer.querySelector('.prompt-tag-filter input') as HTMLInputElement, '不存在标签');
    await click(libContainer.querySelector('.prompt-favorite-filter input[type="checkbox"]') as HTMLInputElement);
    await click(findButton(libContainer.querySelector('.category-grid')!, '业务分析'));
    await waitFor(
      () => (libContainer.querySelector('.prompt-list-panel')?.textContent ?? '').includes('没有匹配的 Prompt'),
      '筛选命中空态',
    );

    // 切换到「生成」工作台并完成生成与保存
    await click(findButton(libContainer.querySelector('.prompt-tabs')!, '生成'));
    await setInputValue(
      libContainer.querySelector('.prompt-ai-workbench textarea') as HTMLTextAreaElement,
      '分析华东补货异常',
    );
    await click(findButton(libContainer, '手动填写 Brief'));
    await click(findButton(libContainer, '生成 Prompt'));
    await waitFor(() => !!maybeButton(libContainer, '保存为新 Prompt'), '生成预览就绪');
    await click(findButton(libContainer, '保存为新 Prompt'));

    await waitFor(
      () => !!libContainer.querySelector('.prompt-message.success-message .prompt-view-library'),
      '保存后展示成功提示内查看按钮',
    );
    const bannerBtn = libContainer.querySelector(
      '.prompt-message.success-message .prompt-view-library',
    ) as HTMLButtonElement;
    const footerBtn = findButton(libContainer.querySelector('.editor-footer')!, '在模板库中查看');
    assert.equal(bannerBtn.textContent, '在模板库中查看');
    assert.equal(footerBtn.textContent, '在模板库中查看');

    // 点击「在模板库中查看」切回模板库、清空筛选并自动选中新建 Prompt
    await click(footerBtn);
    await waitFor(
      () => libContainer.querySelector('.prompt-detail h2')?.textContent === newPrompt.name,
      '切回模板库并显示新 Prompt 详情',
    );
    assert.equal((libContainer.querySelector('input[aria-label="搜索 Prompt"]') as HTMLInputElement).value, '');
    assert.equal((libContainer.querySelector('.prompt-tag-filter input') as HTMLInputElement).value, '');
    assert.equal(
      (libContainer.querySelector('.prompt-favorite-filter input[type="checkbox"]') as HTMLInputElement).checked,
      false,
    );
    assert.ok(libContainer.querySelector('.category-chip.chosen')?.textContent?.includes('全部'));
    assert.ok(libContainer.querySelector('.prompt-list-item.selected')?.textContent?.includes(newPrompt.name));
  } finally {
    await act(async () => {
      root.unmount();
    });
    libContainer.remove();
    globalThis.fetch = originalFetch;
  }

  // 验证「返回模板库」不传 promptId（避免传入 MouseEvent）以及对账分支重置/赋值
  const onLibraryArgs: Array<unknown> = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url === '/api/prompt-ai/schema')
      return jsonResponse({ templates: [{ id: 'customer_interview', label: '经销商访谈准备' }] });
    if (url === '/api/prompts') return jsonResponse({ items: [] });
    if (url === '/api/wiki') return jsonResponse({ items: [] });
    if (url === '/api/prompt-ai/drafts') return jsonResponse({ items: [] });
    if (url === '/api/prompt-ai/optimize/check' && method === 'POST') {
      return jsonResponse(
        { draftId: 'opt-d1', originalBody: '原正文', checks: [], improvements: [], stage: 'checked' },
        201,
      );
    }
    if (url === '/api/prompt-ai/drafts/opt-d1/rewrite' && method === 'POST') {
      return jsonResponse({
        preview: {
          name: '对账后Prompt',
          category: 'office',
          scenario: 's',
          body: '新正文',
          inputRequirements: '',
          outputRequirements: '',
          relatedWikiIds: [],
          examples: '',
          tags: [],
          favorite: false,
        },
        stage: 'ready',
      });
    }
    if (url === '/api/prompt-ai/drafts/opt-d1/confirm' && method === 'POST') {
      return jsonResponse(
        {
          error: {
            code: 'TIMEOUT',
            message: 'timeout',
            details: { committed: true, promptId: 'reconciled-id', version: 1 },
          },
        },
        504,
      );
    }
    if (url === '/api/prompts/reconciled-id/versions/1') {
      return jsonResponse({
        version: {
          version: 1,
          savedAt: '2026-11-19',
          changeSource: 'ai_optimized',
          snapshot: {
            id: 'reconciled-id',
            name: '对账后Prompt',
            category: 'office',
            scenario: 's',
            body: '新正文',
            variables: [],
            inputRequirements: '',
            outputRequirements: '',
            relatedWikiIds: [],
            examples: '',
            tags: [],
            favorite: false,
            createdAt: '2026-11-19',
            updatedAt: '2026-11-19',
            version: 1,
            source: 'ai_optimized',
          },
        },
      });
    }
    return jsonResponse({});
  }) as typeof fetch;

  const wbContainer = window.document.createElement('div');
  container.appendChild(wbContainer);
  const wbRoot = createRoot(wbContainer);
  try {
    await act(async () => {
      wbRoot.render(
        createElement(PromptAiWorkbench, {
          mode: 'optimizer',
          onLibrary: (id) => {
            onLibraryArgs.push(id);
          },
          onSaved: () => {},
          categories: [{ id: 'office', label: '日常办公', help: '' }],
        }),
      );
      await tick();
    });
    await click(findButton(wbContainer, '返回模板库'));
    assert.deepEqual(onLibraryArgs, [undefined], '返回模板库应传 undefined 而非 MouseEvent');

    await setInputValue(wbContainer.querySelector('textarea') as HTMLTextAreaElement, '原正文');
    await click(findButton(wbContainer, '检查 Prompt'));
    await waitFor(() => !!maybeButton(wbContainer, '继续生成优化版'), '优化检查完成');
    await click(findButton(wbContainer, '继续生成优化版'));
    await waitFor(() => !!maybeButton(wbContainer, '保存为新 Prompt'), '优化重写完成');
    await click(findButton(wbContainer, '保存为新 Prompt'));
    await waitFor(() => !!wbContainer.querySelector('.prompt-view-library'), '对账确认后应显示在模板库中查看');
    await click(wbContainer.querySelector('.prompt-view-library') as HTMLButtonElement);
    assert.deepEqual(onLibraryArgs, [undefined, 'reconciled-id']);
  } finally {
    await act(async () => {
      wbRoot.unmount();
    });
    wbContainer.remove();
    globalThis.fetch = originalFetch;
  }

  // 校验 prompt.css 对 .prompt-tag-filter input 拥有高于 styles.css (.field input) 的优先级
  const promptCss = fs.readFileSync(path.resolve(process.cwd(), 'app/prompt.css'), 'utf8');
  assert.match(promptCss, /\.prompt-page\s+\.field\.prompt-tag-filter\s+input\s*\{[^}]*height:\s*36px\s*;/);
});
