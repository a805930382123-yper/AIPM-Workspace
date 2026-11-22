import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Raw, RawDraftView } from '../app/api';

const { window } = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
const { document } = window;
const container = document.getElementById('root')!;
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../app/App');
const { deriveQuickCaptureTitle, QuickCaptureDialog } = await import('../app/components/QuickCaptureDialog');
const { RawOutcomeReview } = await import('../app/pages/RawOutcomeReview');

const query = <T extends HTMLElement = HTMLElement>(selector: string, region: ParentNode = container) => {
  const element = region.querySelector<T>(selector);
  assert.ok(element, selector);
  return element;
};
const button = (name: string, region: ParentNode = container) => {
  const element = [...region.querySelectorAll('button')].find((item) => item.textContent?.trim() === name);
  assert.ok(element, name);
  return element;
};
const click = (element: HTMLElement) =>
  act(async () => {
    element.focus();
    element.click();
  });
const key = (element: EventTarget, keyName: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }),
    );
  });
const type = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });

const titleNames = ['Channel Alpha', 'Channel Beta', '独立观察', '候选摘要', '另一条主题', '已经入库'];
const fixture = (id: string): RawDraftView => ({
  id,
  rawId: 'raw',
  rawTitle: '合成资料',
  status: 'pending_confirmation',
  revision: 1,
  outcomeDigest: 'digest',
  jobId: 'job',
  createdAt: '2026-11-20',
  updatedAt: '2026-11-20',
  rulesVersion: 'fixture',
  raw: null,
  document: { title: '合成资料', main_topic: '主题', summary: '' },
  source: {
    title: '来源',
    body: '来源正文',
    category: 'other',
    summary: '',
    key_takeaways: [],
    knowledge_status: 'ai_organized',
    confidence: 'medium',
    source_level: 'D',
  },
  pages: titleNames.map((title, index) => ({
    pageId: `topic-${index}`,
    title,
    type: 'concept',
    category: 'other',
    one_line_definition: index === 4 ? 'DefinitionKey' : '主题定义',
    source_facts: [],
    ai_organized: [],
    ai_inferences: [],
    related_pages: [],
    open_questions: [],
    source_evidence: [],
    knowledge_status: 'ai_organized',
    confidence: 'medium',
    source_level: 'D',
    selected: index === 2,
    provenance: [],
  })),
  maintenance: {
    version: 1,
    context: [],
    changes: titleNames.map((title, pageIndex) => ({
      changeId: `change-${pageIndex}`,
      pageIndex,
      action: pageIndex === 4 ? 'link' : 'create',
      decision: 'defer',
      reason: pageIndex === 1 ? 'ReasonKey' : '合成理由',
      candidate: {
        title,
        body: pageIndex === 3 ? '## 摘要\n\nExcerptKey 正文' : '合成正文',
        type: 'concept',
        category: 'other',
        aliases: [],
        tags: [],
        sources: [],
        knowledge_status: 'ai_organized',
        confidence: 'medium',
        source_level: 'D',
      },
      summary: [],
      questions: [],
      dependsOn: [],
      committedOperationId: pageIndex === 5 ? 'commit-5' : undefined,
    })),
  },
  provider: { name: 'fake', model: 'fixture' },
  warnings: [],
  extraction: { callCount: 0, chunkCount: 1, pagesFound: titleNames.length },
  preview: {
    rawExists: true,
    rawSha256Matches: true,
    titleConflicts: [],
    sourceReuse: null,
    sourceAmbiguous: null,
    batchDuplicateTitles: [],
  },
});
const outcome = (view: RawDraftView) => (
  <RawOutcomeReview
    view={view}
    body="合成原文"
    onView={() => {}}
    onBack={() => {}}
    onOpenRaw={() => {}}
    onCommitted={async () => {}}
    advanced={null}
    advancedDirty={false}
    advancedBusy={false}
  />
);
const visibleTitles = () => [...container.querySelectorAll('.outcome-card h3')].map((item) => item.textContent);
const card = (title: string) => query(`article[aria-label="成果 ${title}"]`);
const checked = (title: string) => query<HTMLInputElement>('input[type="checkbox"]', card(title)).checked;
const mockCommit = (operationId: string) => Response.json({ operationId, status: 'completed', changeResults: {} });

test('六张主题按标题、摘要、定义、理由及动作匹配，筛选全选和取消保留其他已选主题', async () => {
  const root = createRoot(container);
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return mockCommit('commit-5');
  };
  try {
    const view = fixture('filters');
    await act(async () => root.render(outcome(view)));
    assert.deepEqual(visibleTitles(), titleNames);
    assert.ok(query('.outcome-cards').firstElementChild?.querySelector('.outcome-cards-filters'));
    const search = query<HTMLInputElement>('[aria-label="搜索主题成果"]');
    const status = query<HTMLSelectElement>('[aria-label="筛选主题状态"]');
    assert.equal(status.value, 'all');
    assert.equal(status.options.length, 5);
    assert.equal(checked('独立观察'), true);
    for (const [keyword, title] of [
      ['reasonkey', 'Channel Beta'],
      ['excerptkey', '候选摘要'],
      ['DEFINITIONKEY', '另一条主题'],
      ['补充来源', '另一条主题'],
    ]) {
      await type(search, keyword);
      assert.deepEqual(visibleTitles(), [title]);
    }
    await type(search, '  cHaNnEl  ');
    assert.deepEqual(visibleTitles(), ['Channel Alpha', 'Channel Beta']);
    await click(button('全选当前筛选（2 项）'));
    assert.match(query('.outcome-confirm strong').textContent!, /3 项/);
    await click(button('取消当前筛选全选'));
    assert.match(query('.outcome-confirm strong').textContent!, /1 项/);
    await type(search, '无结果');
    assert.equal(query('.outcome-filter-empty').getAttribute('role'), 'status');
    assert.deepEqual(visibleTitles(), []);
    await click(button('重置筛选'));
    await click(button('暂不采纳', card('Channel Alpha')));
    assert.ok(card('Channel Alpha').classList.contains('dismissed'));
    assert.equal(card('Channel Alpha').querySelector('.outcome-excerpt, details, input'), null);
    await type(status, 'pending');
    assert.deepEqual(visibleTitles(), titleNames.slice(1, 5));
    await type(status, 'selected');
    assert.deepEqual(visibleTitles(), ['独立观察']);
    await type(status, 'committed');
    assert.deepEqual(visibleTitles(), ['已经入库']);
    await type(status, 'dismissed');
    assert.deepEqual(visibleTitles(), ['Channel Alpha']);
    await click(button('重置筛选'));
    await click(button('全选可选主题（4 项）'));
    assert.match(query('.outcome-confirm strong').textContent!, /4 项/);
    assert.equal(card('Channel Alpha').querySelector('input'), null);
    assert.deepEqual(calls, ['/api/wiki-commits/commit-5']);
    assert.equal(view.outcomeDigest, 'digest');
    assert.equal(view.revision, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
    window.localStorage.clear();
  }
});

test('忽略状态跨重新进入保留、按草稿隔离，恢复不勾选，同一主题入库后清理当地记录', async () => {
  const root = createRoot(container);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => mockCommit(String(url).split('/').at(-1)!);
  const view = fixture('stored');
  const storageKey = 'aipm.outcome.dismissed.v1:stored';
  window.localStorage.setItem(storageKey, JSON.stringify(['stale', 'topic-5', 42]));
  try {
    await act(async () => root.render(outcome(view)));
    assert.equal(window.localStorage.getItem(storageKey), null);
    await click(button('暂不采纳', card('独立观察')));
    assert.match(query('.outcome-confirm strong').textContent!, /0 项/);
    assert.equal(window.localStorage.getItem(storageKey), '["topic-2"]');
    await act(async () => root.render(null));
    await act(async () => root.render(outcome(view)));
    assert.ok(card('独立观察').classList.contains('dismissed'));
    window.localStorage.setItem('aipm.outcome.dismissed.v1:other', '{invalid');
    await act(async () => root.render(outcome(fixture('other'))));
    assert.equal(checked('独立观察'), true);
    await act(async () => root.render(outcome(view)));
    await click(button('恢复待选', card('独立观察')));
    assert.equal(checked('独立观察'), false);
    assert.equal(window.localStorage.getItem(storageKey), null);
    await click(button('暂不采纳', card('独立观察')));
    const maintenance = view.maintenance!;
    const changes = maintenance.changes.map((change) =>
      change.pageIndex === 2 ? { ...change, committedOperationId: 'commit-2' } : change,
    );
    await act(async () => root.render(outcome({ ...view, maintenance: { ...maintenance, changes } })));
    assert.equal(window.localStorage.getItem(storageKey), null);
    assert.ok(!card('独立观察').classList.contains('dismissed'));
    assert.equal(card('独立观察').querySelector('input'), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
    window.localStorage.clear();
  }
});

test('localStorage 不可用时继续使用当前内存中的忽略状态', async () => {
  const root = createRoot(container);
  const original = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage is disabled');
    },
  });
  globalThis.fetch = async () => mockCommit('commit-5');
  try {
    await act(async () => root.render(outcome(fixture('memory'))));
    await click(button('暂不采纳', card('独立观察')));
    assert.ok(card('独立观察').classList.contains('dismissed'));
    await click(button('恢复待选', card('独立观察')));
    assert.equal(checked('独立观察'), false);
  } finally {
    await act(async () => root.unmount());
    Object.defineProperty(window, 'localStorage', descriptor);
    globalThis.fetch = original;
  }
});

test('自动标题取首个非空行、压缩空白并截取 60 个 Unicode 字符', () => {
  assert.equal(deriveQuickCaptureTitle('\r\n \t\r\n  市场\t  观察   \r\n 后续'), '市场 观察');
  assert.equal(deriveQuickCaptureTitle('价'.repeat(59) + '🥤更新'), '价'.repeat(59) + '🥤');
  assert.equal(deriveQuickCaptureTitle(' \n\t'), '');
});

const savedRaw: Raw = {
  id: 'captured',
  title: '合成速记',
  sourceType: 'note',
  sourceName: '个人速记',
  tags: [],
  body: '原文',
  importedAt: '2026-11-20T00:00:00Z',
  status: 'unprocessed',
  bodySha256: '1'.repeat(64),
};

test('Ctrl+Enter 原样保存速记，保存期间锁定弹窗，刷新后可继续或打开 Raw', async () => {
  const root = createRoot(container);
  const original = globalThis.fetch;
  let finish!: () => void;
  const refresh = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const requests: unknown[] = [];
  const opened: string[] = [];
  let closes = 0;
  globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method, JSON.parse(String(init?.body))]);
    return Response.json(savedRaw, { status: 201 });
  };
  try {
    await act(async () =>
      root.render(
        <QuickCaptureDialog
          onClose={() => {
            closes++;
          }}
          onOpenRaw={(id) => opened.push(id)}
          onCaptured={async (raw) => {
            assert.deepEqual(raw, savedRaw);
            await refresh;
          }}
        />,
      ),
    );
    const note = query<HTMLTextAreaElement>('[aria-label="速记内容"]');
    assert.equal(document.activeElement, note);
    const body = '\n  合成  速记 \n第二段  \n';
    await type(note, body);
    await key(note, 'Enter', { ctrlKey: true });
    assert.deepEqual(requests, [
      ['/api/raw', 'POST', { title: '合成 速记', sourceType: 'note', sourceName: '个人速记', tags: [], body }],
    ]);
    const modal = query('[role="dialog"]');
    assert.equal(modal.getAttribute('aria-busy'), 'true');
    await key(modal, 'Escape');
    await act(async () => query('.modal-scrim').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })));
    assert.equal(closes, 0);
    await act(async () => finish());
    assert.match(modal.textContent!, /已保存到 Raw/);
    await click(button('继续记一条'));
    const next = query<HTMLTextAreaElement>('[aria-label="速记内容"]');
    assert.equal(next.value, '');
    assert.equal(document.activeElement, next);
    await type(next, '第二条');
    await type(query<HTMLInputElement>('[aria-label="标题（可选）"]'), '  手填标题  ');
    await click(button('保存速记'));
    assert.deepEqual(requests.at(-1), [
      '/api/raw',
      'POST',
      { title: '  手填标题  ', sourceType: 'note', sourceName: '个人速记', tags: [], body: '第二条' },
    ]);
    await click(button('打开这条 Raw'));
    assert.deepEqual(opened, ['captured']);
    assert.equal(closes, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});

test('网页链接提示预填 URL，首次默认不翻译，失败保留所有字段并可重试', async () => {
  const root = createRoot(container);
  const original = globalThis.fetch;
  const requests: unknown[] = [];
  let closes = 0;
  globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method, JSON.parse(String(init?.body))]);
    if (requests.length === 1) return Response.json({ error: { message: '合成请求失败' } }, { status: 500 });
    return Response.json({ kind: 'url', raw: { ...savedRaw, sourceType: 'article', sourceName: 'example.test' } });
  };
  try {
    await act(async () =>
      root.render(
        <QuickCaptureDialog
          onClose={() => {
            closes++;
          }}
          onCaptured={async () => {}}
          onOpenRaw={() => {}}
        />,
      ),
    );
    const link = 'https://example.test/insight';
    await type(query<HTMLTextAreaElement>('[aria-label="速记内容"]'), ` ${link} \n`);
    await click(button('切到网页链接模式'));
    assert.equal(requests.length, 0);
    const url = query<HTMLInputElement>('[aria-label="公开网页链接"]');
    const title = query<HTMLInputElement>('[aria-label="标题（可选）"]');
    const tags = query<HTMLInputElement>('[aria-label="标签（可选）"]');
    const translate = query<HTMLInputElement>('input[type="checkbox"]');
    assert.equal(url.value, link);
    assert.equal(document.activeElement, url);
    assert.equal(translate.checked, false);
    await type(title, '网页原标题');
    await type(tags, '渠道，动销、反馈; 报告；定价');
    await click(button('抓取并保存'));
    assert.deepEqual(requests[0], [
      '/api/raw/import',
      'POST',
      {
        metadata: {
          url: link,
          sourceType: 'article',
          title: '网页原标题',
          tags: ['渠道', '动销', '反馈', '报告', '定价'],
        },
        translateToChinese: false,
      },
    ]);
    assert.equal(query('[role="alert"]').textContent, '合成请求失败');
    assert.deepEqual(
      [url.value, title.value, tags.value, translate.checked],
      [link, '网页原标题', '渠道，动销、反馈; 报告；定价', false],
    );
    await click(translate);
    await click(button('抓取并保存'));
    assert.deepEqual(requests[1], [
      '/api/raw/import',
      'POST',
      {
        metadata: {
          url: link,
          sourceType: 'article',
          title: '网页原标题',
          tags: ['渠道', '动销', '反馈', '报告', '定价'],
        },
        translateToChinese: true,
      },
    ]);
    assert.match(query('[role="dialog"]').textContent!, /已保存到 Raw/);
    await click(button('关闭', query('.quick-capture-result-actions')));
    assert.equal(closes, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
});

test('全局及首页入口、Alt+N 门禁、焦点还原和保存后首页刷新', async () => {
  const root = createRoot(container);
  const original = globalThis.fetch;
  const items: Raw[] = [];
  const external = document.createElement('input');
  document.body.appendChild(external);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === '/api/raw' && init?.method === 'POST') {
      items.push(savedRaw);
      return Response.json(savedRaw, { status: 201 });
    }
    if (url === '/api/raw') return Response.json({ items });
    if (url === '/api/stats')
      return Response.json({
        rawCount: items.length,
        wikiCount: 0,
        thisWeekNewCount: items.length,
        pendingConfirmationCount: 0,
        openAuditCount: 0,
        promptCount: 0,
      });
    if (url === '/api/home/actions') return Response.json({ items: [], sources: { draft: { status: 'ok' } } });
    if (url.startsWith('/api/automation/candidates'))
      return Response.json({ items: [], counts: { fetched: 0, pending: 0, organizing: 0, drafts: 0, failed: 0 } });
    if (url === '/api/automation/status')
      return Response.json({ paused: false, scheduler: { healthy: true }, instance: {}, failuresLast24Hours: 0 });
    if (url.startsWith('/api/news/today')) return Response.json({ edition: { sections: {} }, fallbacks: {} });
    return Response.json({ items: [] });
  };
  try {
    await act(async () => root.render(<App />));
    const trigger = query<HTMLButtonElement>('.topbar-capture-btn');
    await click(trigger);
    await key(query('[aria-label="速记内容"]'), 'Escape');
    assert.equal(container.querySelector('.quick-capture-dialog'), null);
    assert.equal(document.activeElement, trigger);
    await click(trigger);
    const backdropPress = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => query('.modal-scrim').dispatchEvent(backdropPress));
    assert.equal(
      backdropPress.defaultPrevented,
      true,
      'The backdrop must suppress the browser focus change after close.',
    );
    assert.equal(container.querySelector('.quick-capture-dialog'), null);
    assert.equal(document.activeElement, trigger);
    external.focus();
    await key(external, 'n', { altKey: true });
    assert.equal(container.querySelector('.quick-capture-dialog'), null);
    trigger.focus();
    await key(trigger, 'N', { altKey: true, shiftKey: true });
    assert.equal(container.querySelector('.quick-capture-dialog'), null);
    await key(trigger, 'n', { altKey: true });
    assert.ok(query('.quick-capture-dialog'));
    await key(query('[aria-label="速记内容"]'), 'Escape');
    assert.equal(document.activeElement, trigger);
    await click(query('.home-entry-grid button'));
    const importDialog = query('[aria-labelledby="import-title"]');
    await key(importDialog, 'n', { altKey: true });
    assert.equal(container.querySelector('.quick-capture-dialog'), null);
    await click(query<HTMLButtonElement>('button[aria-label="关闭"]', importDialog));
    await click(button('首页', query('.sidebar')));
    const homeHeading = query('.home-heading-actions');
    const homeTrigger = button('快速记一条', homeHeading);
    await click(homeTrigger);
    await type(query<HTMLTextAreaElement>('[aria-label="速记内容"]'), '合成速记');
    await click(button('保存速记'));
    assert.match(query('.quick-capture-result').textContent!, /合成速记/);
    assert.match(query('.stat-card[title="持续积累的来源材料"] strong').textContent!, /1/);
    assert.match(query('#home-panel-最近导入').textContent!, /合成速记/);
    await click(button('关闭', query('.quick-capture-result-actions')));
    assert.equal(document.activeElement, homeTrigger);
    assert.ok(container.querySelector('.home-page'));
  } finally {
    await act(async () => root.unmount());
    external.remove();
    globalThis.fetch = original;
  }
});
