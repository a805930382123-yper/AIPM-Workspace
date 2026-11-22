import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type {
  AutomationRun,
  AutomationSchedule,
  AutomationStatus,
  CandidateList,
  CandidateView,
  Stats,
} from '../app/api.ts';
import type { HomeAction } from '../services/home/actions.ts';

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
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLDetailsElement: window.HTMLDetailsElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

const scrollCalls: Array<{ id: string; arg: unknown }> = [];
window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: unknown) {
  scrollCalls.push({ id: this.id, arg });
};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { HomePage } = await import('../app/pages/HomePage.tsx');
const { PeriodReview } = await import('../app/components/PeriodReview.tsx');
const { AutomationPage } = await import('../app/pages/AutomationPage.tsx');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await tick(10);
    });
  }
  assert.fail(`等待超时：${label}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function findButton(container: ParentNode, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes(text));
  assert.ok(found, `找不到按钮：${text}`);
  return found as HTMLButtonElement;
}
async function click(target: HTMLElement) {
  await act(async () => {
    target.click();
    await tick();
  });
}
async function changeDate(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    assert.ok(setter);
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
}

const emptyStats: Stats = {
  rawCount: 2,
  wikiCount: 3,
  thisWeekNewCount: 1,
  pendingConfirmationCount: 2,
  openAuditCount: 1,
  promptCount: 1,
  weekStartsOn: '2026-11-16',
};

const makeAction = (
  kind: HomeAction['kind'],
  id: string,
  title: string,
  status?: HomeAction['status'],
): HomeAction => ({
  kind,
  id,
  title,
  problem: '待处理问题',
  result: '状态说明',
  action: '处理',
  updatedAt: '2026-11-18T10:00:00.000Z',
  priority: 1,
  status,
  target: {},
  versionToken: `${id}-v1`,
});

test('U2-01: 首页「待审核」统计卡统一触发审核筛选并区分 #home-actions 副标题计数文案', async () => {
  const actionsGate = deferred<void>();
  let failActions = false;
  const actionsPayload = {
    items: [
      makeAction('draft', 'd1', '待审草稿一'),
      makeAction('workflow', 'w1', '待审工作流一'),
      makeAction('audit', 'a1', '知识纠错一'),
      makeAction('raw-task', 'r1', '整理失败任务一', 'failed'),
      makeAction('draft', 'd-def', '稍后草稿一', 'deferred'),
    ],
    sources: {
      'raw-task': { status: 'ok' },
      draft: { status: 'ok' },
      workflow: { status: 'ok' },
      audit: { status: 'ok' },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/wiki') return jsonResponse({ items: [] });
    if (url === '/api/home/actions') {
      if (failActions) throw new Error('network down');
      await actionsGate.promise;
      return jsonResponse(actionsPayload);
    }
    if (url.startsWith('/api/automation/candidates')) {
      return jsonResponse({
        date: '2026-11-19',
        dates: ['2026-11-19'],
        items: [
          {
            id: 'c1',
            section: 'fmcg',
            disposition: 'inbox',
            draftPending: true,
            execution: { runId: 'run1', draftId: 'd1', phase: 'draft_ready' },
            item: {
              id: 'n1',
              title: '资讯一',
              sourceId: 's',
              sourceName: '源',
              url: 'https://example.test/1',
              fetchedAt: '2026-11-19T00:00:00Z',
              excerpt: '摘录',
              evidenceKind: 'article_excerpt',
            },
          },
        ],
        counts: { fetched: 1, pending: 0, organizing: 0, drafts: 1, failed: 0 },
      });
    }
    return jsonResponse({});
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  const noop = () => {};
  try {
    scrollCalls.length = 0;
    await act(async () => {
      root.render(
        createElement(HomePage, {
          stats: emptyStats,
          items: [],
          onOpenRaw: noop,
          onOpenWiki: noop,
          onOpenPrompt: noop,
          onImport: noop,
          onCreateWiki: noop,
          onCreatePrompt: noop,
          onGeneratePrompt: noop,
          onLint: noop,
          onOpenPipeline: noop,
        }),
      );
      await tick();
    });

    const homeActions = container.querySelector('#home-actions')!;
    const subheading = () => homeActions.querySelector('.panel-heading p')?.textContent ?? '';
    assert.equal(subheading(), '正在读取事项…');

    actionsGate.resolve();
    await waitFor(() => subheading().includes('当前待处理'), '行动事项加载完成');
    assert.equal(subheading(), '当前待处理 4 项 · 稍后处理 1 项');

    // 先切换到“今日资讯待审草稿”，验证点击「待审核」统计卡会关闭 pipelineReview 并打开 reviewFilter
    const pipelineDraftsBtn = container.querySelector('button[aria-label^="待审草稿"]') as HTMLButtonElement;
    await click(pipelineDraftsBtn);
    assert.equal(subheading(), '今日资讯待审草稿');

    scrollCalls.length = 0;
    const pendingStatCard = [...container.querySelectorAll('.stats-grid .stat-card')].find((btn) =>
      btn.textContent?.includes('待审核'),
    ) as HTMLButtonElement;
    assert.ok(pendingStatCard, '底部「待审核」统计卡应存在');
    await click(pendingStatCard);

    assert.ok(
      scrollCalls.some((call) => call.id === 'home-actions'),
      '点击「待审核」统计卡应滚动到 #home-actions',
    );
    assert.equal(subheading(), '当前筛选待审草稿与工作流 2 项（共 5 项） · 稍后处理 1 项');
    const actionTitles = [...homeActions.querySelectorAll('.home-action-row b')].map((el) => el.textContent);
    assert.deepEqual(actionTitles, ['待审草稿一', '待审工作流一', '稍后草稿一']);

    await click(findButton(homeActions, '显示全部事项'));
    assert.equal(subheading(), '当前待处理 4 项 · 稍后处理 1 项');
  } finally {
    await act(async () => {
      root.unmount();
    });
  }

  // 验证读取失败且 actions 为空时仍显示“事项暂不可用”
  failActions = true;
  const errRoot = createRoot(container);
  try {
    await act(async () => {
      errRoot.render(
        createElement(HomePage, {
          stats: emptyStats,
          items: [],
          onOpenRaw: noop,
          onOpenWiki: noop,
          onOpenPrompt: noop,
          onImport: noop,
          onCreateWiki: noop,
          onCreatePrompt: noop,
          onGeneratePrompt: noop,
          onLint: noop,
        }),
      );
      await tick();
    });
    const subheading = container.querySelector('#home-actions .panel-heading p')?.textContent ?? '';
    assert.equal(subheading, '事项暂不可用');
  } finally {
    await act(async () => {
      errRoot.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});

test('U2-02: 首页「最近更新」已删除 Wiki 条目禁用不可点击且提示已移至回收区', async () => {
  const openedWiki: Array<string | undefined> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/wiki') return jsonResponse({ items: [] });
    if (url === '/api/home/actions') return jsonResponse({ items: [], sources: { draft: { status: 'ok' } } });
    return jsonResponse({});
  }) as typeof fetch;

  const statsWithChanges: Stats = {
    ...emptyStats,
    recentChanges: [
      {
        time: '2026-11-18T10:00:00.000Z',
        action: 'delete',
        id: 'wiki-del-1',
        title: '已删除页面',
        type: 'concept',
        revision: 4,
      },
      {
        time: '2026-11-18T09:00:00.000Z',
        action: 'update',
        id: 'wiki-upd-1',
        title: '正常更新页面',
        type: 'concept',
        revision: 2,
      },
      {
        time: '2026-11-18T08:00:00.000Z',
        action: 'create',
        id: 'wiki-cre-1',
        title: '新建页面',
        type: 'concept',
        revision: 1,
      },
    ],
  };

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  const noop = () => {};
  try {
    await act(async () => {
      root.render(
        createElement(HomePage, {
          stats: statsWithChanges,
          items: [],
          onOpenRaw: noop,
          onOpenWiki: (id?: string) => {
            openedWiki.push(id);
          },
          onOpenPrompt: noop,
          onImport: noop,
          onCreateWiki: noop,
          onCreatePrompt: noop,
          onGeneratePrompt: noop,
          onLint: noop,
        }),
      );
      await tick();
    });

    const rows = [...container.querySelectorAll('.recent-row')] as HTMLButtonElement[];
    const deletedRow = rows.find((row) => row.textContent?.includes('已删除页面'));
    const updatedRow = rows.find((row) => row.textContent?.includes('正常更新页面'));
    assert.ok(deletedRow && updatedRow);

    assert.equal(deletedRow.disabled, true);
    assert.match(deletedRow.textContent ?? '', /删除 Wiki（已移至回收区） · 第 4 版/);
    await click(deletedRow);
    assert.equal(openedWiki.length, 0, '点击已删除条目不得触发 onOpenWiki');

    assert.equal(updatedRow.disabled, false);
    assert.match(updatedRow.textContent ?? '', /更新 Wiki · 第 2 版/);
    await click(updatedRow);
    assert.deepEqual(openedWiki, ['wiki-upd-1']);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});

test('U2-03: 周期回顾修改日期展示提示而非空白、拦截非法区间并在合法区间手动刷新后恢复数据', async () => {
  const pendingFetches: Array<{ url: string; resolve: (res: Response) => void }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown) =>
    new Promise<Response>((resolve) => {
      pendingFetches.push({ url: String(input), resolve });
    })) as typeof fetch;

  const reviewPayload = (start: string, end: string) => ({
    period: { timeZone: 'Asia/Shanghai', start, end },
    snapshotAt: '2026-11-19T00:00:00.000Z',
    knowledge: { status: 'ok', items: [], undated: [], count: 0 },
    pending: { items: [], sources: { draft: { status: 'ok' } } },
    feedback: { status: 'ok', items: [], counts: { helpful: 0, needs_revision: 0, not_applicable: 0, unverified: 0 } },
  });

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(PeriodReview, { onClose: () => {}, onOpenWiki: () => {}, onOpenAction: () => {} }));
      await tick();
    });

    const refreshBtn = () => findButton(container, '刷新回顾');
    const [startInput, endInput] = [...container.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
    assert.equal(pendingFetches.length, 1);
    assert.equal(container.querySelector('.review-status-hint')?.textContent, '正在读取周期回顾…');
    assert.equal(refreshBtn().disabled, false, '加载期间不禁用刷新回顾按钮');

    await act(async () => {
      pendingFetches[0].resolve(jsonResponse(reviewPayload(startInput.value, endInput.value)));
      await tick();
    });
    assert.match(container.textContent ?? '', new RegExp(`覆盖 ${startInput.value}（含）至 ${endInput.value}（不含）`));

    // 修改为合法日期，不得自动发请求，需显示提示
    await changeDate(startInput, '2026-11-01');
    assert.equal(pendingFetches.length, 1, 'change() 不得自动发起请求');
    assert.equal(
      container.querySelector('.review-status-hint')?.textContent,
      `日期范围已调整为 2026-11-01 至 ${endInput.value}，请点击「刷新回顾」加载该周期数据。`,
    );
    assert.equal(refreshBtn().disabled, false);

    // 修改为 start === end 与 start > end，提示错误并禁用刷新按钮
    await changeDate(startInput, endInput.value);
    assert.equal(pendingFetches.length, 1);
    assert.equal(container.querySelector('[role="alert"]')?.textContent, '开始日期需早于结束日期。');
    assert.equal(container.querySelector('.review-status-hint'), null);
    assert.equal(refreshBtn().disabled, true);

    await changeDate(startInput, '2099-12-31');
    assert.equal(container.querySelector('[role="alert"]')?.textContent, '开始日期需早于结束日期。');
    assert.equal(refreshBtn().disabled, true);
    await click(refreshBtn());
    assert.equal(pendingFetches.length, 1, '非法日期区间不得发起请求');

    // 改回合法区间并点击刷新回顾
    await changeDate(startInput, '2026-11-01');
    await changeDate(endInput, '2026-11-10');
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.equal(
      container.querySelector('.review-status-hint')?.textContent,
      '日期范围已调整为 2026-11-01 至 2026-11-10，请点击「刷新回顾」加载该周期数据。',
    );
    await click(refreshBtn());
    assert.equal(pendingFetches.length, 2);
    assert.equal(container.querySelector('.review-status-hint')?.textContent, '正在读取周期回顾…');

    await act(async () => {
      pendingFetches[1].resolve(jsonResponse(reviewPayload('2026-11-01', '2026-11-10')));
      await tick();
    });
    assert.match(container.textContent ?? '', /覆盖 2026-11-01（含）至 2026-11-10（不含）/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});

const date = '2026-11-19';
const ts = '2026-11-19T01:00:00.000Z';
const autoStatus: AutomationStatus = {
  paused: false,
  scheduler: { healthy: true, lastTickAt: ts },
  instance: { pid: 99, port: 4399, mode: 'development', startedAt: ts, hostname: 'localhost' },
  nextRunAt: ts,
  failuresLast24Hours: 0,
  writeToken: 'uifix02-token',
};
const newsSchedule: AutomationSchedule = {
  type: 'news.daily',
  name: '每日资讯准备与预筛',
  enabled: true,
  plan: { kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' },
  catchUp: false,
  revision: 1,
  budget: null,
  nextRunAt: ts,
  lastRun: null,
  mayCallModel: true,
  allowsCatchUp: true,
};

function makeCandidate(
  id: string,
  title: string,
  opts: {
    relevance?: 0 | 1 | 2 | 3;
    savedRawId?: string;
    disposition?: CandidateView['disposition'];
    runId?: string;
  } = {},
): CandidateView {
  return {
    id,
    section: 'fmcg',
    disposition: opts.disposition ?? 'inbox',
    savedRawId: opts.savedRawId,
    execution: opts.runId ? { runId: opts.runId, phase: 'saved' } : undefined,
    item: {
      id,
      title,
      sourceId: 'src',
      sourceName: '测试源',
      url: `https://example.test/${id}`,
      publishedAt: date,
      fetchedAt: ts,
      excerpt: '摘录内容。',
      evidenceKind: 'article_excerpt',
    },
    screening:
      opts.relevance !== undefined
        ? {
            score: {
              candidateId: id,
              relevance: opts.relevance,
              reason: '理由',
              categories: ['渠道'],
              suggestedMode: 'standard',
            },
          }
        : undefined,
  };
}

test('U2-04: 自动化收件箱支持当前可见范围「全选可确认项 / 取消全选」并与批量确认入库联动', async () => {
  const candidates: CandidateList = {
    date,
    dates: [date],
    items: [
      makeCandidate('c-high-1', '高分候选甲', { relevance: 3 }),
      makeCandidate('c-unscreened-2', '未预筛候选乙'),
      makeCandidate('c-saved-3', '已入库候选丙', { relevance: 2, savedRawId: 'raw-saved-1' }),
      makeCandidate('c-ignored-4', '已忽略候选丁', { relevance: 2, disposition: 'ignored' }),
      makeCandidate('c-low-5', '低分候选戊', { relevance: 0 }),
    ],
    counts: { fetched: 5, pending: 3, organizing: 0, drafts: 0, failed: 0 },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/status')) return jsonResponse(autoStatus);
    if (url.endsWith('/schedules')) return jsonResponse({ items: [newsSchedule], issues: [] });
    if (url.includes('/runs?')) return jsonResponse({ items: [], issues: [] });
    if (url.endsWith('/pipeline/settings'))
      return jsonResponse({ revision: 1, concurrency: 2, topics: [], preScreenEnabled: true });
    if (url.endsWith('/candidates')) return jsonResponse(candidates);
    return jsonResponse({ error: { message: `Unexpected ${url}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(AutomationPage, { onOpenRaw: () => {}, onOpenDraft: () => {} }));
      await tick();
    });
    await click(findButton(container, '待处理收件箱'));
    await waitFor(() => !!container.querySelector('.candidate-low'), '收件箱渲染完成');

    const filters = container.querySelector('#news-candidates .automation-filters')!;
    assert.ok(findButton(filters, '全选可确认项（2 条）'));
    assert.equal(
      [...filters.querySelectorAll('button')].some((b) => b.textContent?.includes('批量确认入库')),
      false,
    );

    // 全选当前可见的 2 条可确认项（不含已入库与未展开的低分项）
    await click(findButton(filters, '全选可确认项（2 条）'));
    assert.ok(findButton(filters, '取消全选'));
    assert.ok(findButton(filters, '批量确认入库（2 条）'));
    assert.equal((container.querySelector('input[aria-label="选择 高分候选甲"]') as HTMLInputElement).checked, true);
    assert.equal((container.querySelector('input[aria-label="选择 未预筛候选乙"]') as HTMLInputElement).checked, true);

    // 展开低分折叠区后，可确认可见数变为 3，按钮切换为全选 3 条
    const lowDetails = container.querySelector('.candidate-low') as HTMLDetailsElement;
    await act(async () => {
      lowDetails.open = true;
      lowDetails.dispatchEvent(new window.Event('toggle'));
      await tick();
    });
    assert.ok(findButton(filters, '全选可确认项（3 条）'));
    await click(findButton(filters, '全选可确认项（3 条）'));
    assert.ok(findButton(filters, '取消全选'));
    assert.ok(findButton(filters, '批量确认入库（3 条）'));
    assert.equal((container.querySelector('input[aria-label="选择 低分候选戊"]') as HTMLInputElement).checked, true);

    // 取消全选后清空并隐藏批量确认按钮
    await click(findButton(filters, '取消全选'));
    assert.ok(findButton(filters, '全选可确认项（3 条）'));
    assert.equal(
      [...filters.querySelectorAll('button')].some((b) => b.textContent?.includes('批量确认入库')),
      false,
    );

    // 切到「已忽略」视图时无可确认项，全选按钮不渲染
    const filterSelect = [...filters.querySelectorAll('select')][1] as HTMLSelectElement;
    await act(async () => {
      filterSelect.value = 'ignored';
      filterSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    assert.equal(
      [...filters.querySelectorAll('button')].some((b) => /全选/.test(b.textContent ?? '')),
      false,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});

test('U2-05: 自动化运行详情打开时滚动并聚焦标题，关闭后恢复焦点至原触发按钮且保护已卸载元素', async () => {
  const makeRun = (id: string, status: 'succeeded' | 'failed'): AutomationRun => ({
    id,
    type: 'system.selfcheck',
    trigger: 'manual',
    scheduledAt: ts,
    startedAt: ts,
    endedAt: ts,
    status,
    steps: [{ name: '步骤一', status, startedAt: ts, endedAt: ts, durationMs: 12, summary: '完成' }],
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
    artifacts: { rawIds: [], jobIds: [], draftIds: [] },
    budget: null,
  });

  const runLast = makeRun('run-last', 'succeeded');
  const runHist1 = makeRun('run-hist-1', 'succeeded');
  const runHist2 = makeRun('run-hist-2', 'failed');
  const runCand = makeRun('run-cand-1', 'succeeded');
  const runManual = makeRun('run-manual-1', 'succeeded');

  const selfcheckSchedule: AutomationSchedule = {
    type: 'system.selfcheck',
    name: '系统自检',
    enabled: true,
    plan: { kind: 'interval', minutes: 60 },
    catchUp: false,
    revision: 1,
    budget: null,
    nextRunAt: ts,
    lastRun: runLast,
    mayCallModel: false,
    allowsCatchUp: true,
  };
  const allRuns: Record<string, AutomationRun> = {
    [runLast.id]: runLast,
    [runHist1.id]: runHist1,
    [runHist2.id]: runHist2,
    [runCand.id]: runCand,
    [runManual.id]: runManual,
  };
  const candidates: CandidateList = {
    date,
    dates: [date],
    items: [makeCandidate('c-with-run', '已关联运行候选', { relevance: 3, savedRawId: 'raw-1', runId: runCand.id })],
    counts: { fetched: 1, pending: 0, organizing: 0, drafts: 0, failed: 0 },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost/');
    const path = url.pathname;
    if (path.endsWith('/status')) return jsonResponse(autoStatus);
    if (path.endsWith('/schedules')) return jsonResponse({ items: [newsSchedule, selfcheckSchedule], issues: [] });
    if (path.endsWith('/runs') && !init?.method) {
      const statusFilter = url.searchParams.get('status');
      const items = [runHist1, runHist2].filter((run) => !statusFilter || run.status === statusFilter);
      return jsonResponse({ items, issues: [] });
    }
    if (path.endsWith(`/tasks/${selfcheckSchedule.type}/run`) && init?.method === 'POST') {
      return jsonResponse(runManual, 202);
    }
    const runMatch = /\/runs\/([^/]+)$/.exec(path);
    if (runMatch && allRuns[runMatch[1]]) return jsonResponse(allRuns[runMatch[1]]);
    if (path.endsWith('/pipeline/settings'))
      return jsonResponse({ revision: 1, concurrency: 2, topics: [], preScreenEnabled: true });
    if (path.endsWith('/candidates')) return jsonResponse(candidates);
    return jsonResponse({ error: { message: `Unexpected ${path}` } }, 404);
  }) as typeof fetch;

  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    scrollCalls.length = 0;
    await act(async () => {
      root.render(createElement(AutomationPage, { onOpenRaw: () => {}, onOpenDraft: () => {} }));
      await tick();
    });
    await click(findButton(container, '运行记录'));
    await waitFor(
      () => !!container.querySelector('[aria-labelledby="automation-history"] li button'),
      '运行历史渲染完成',
    );

    const historySection = container.querySelector('[aria-labelledby="automation-history"]')!;
    const detailBtn1 = [...historySection.querySelectorAll('li button')][0] as HTMLButtonElement;

    // 1. 运行历史「查看详情」-> 滚动定位并聚焦 #automation-run-detail -> 关闭详情恢复焦点到 detailBtn1
    scrollCalls.length = 0;
    detailBtn1.focus();
    await click(detailBtn1);
    const heading1 = container.querySelector('#automation-run-detail');
    assert.ok(heading1);
    assert.equal(window.document.activeElement, heading1);
    assert.ok(
      scrollCalls.some(
        (call) =>
          call.id === 'automation-run-detail' && JSON.stringify(call.arg) === JSON.stringify({ block: 'nearest' }),
      ),
      '打开运行详情时应对 #automation-run-detail 调用 scrollIntoView({ block: "nearest" })',
    );
    await click(findButton(container, '关闭详情'));
    assert.equal(container.querySelector('#automation-run-detail'), null);
    assert.equal(window.document.activeElement, detailBtn1, '关闭详情后应恢复焦点至「查看详情」按钮');

    // 2. 任务计划「最近结果」-> 聚焦 #automation-run-detail -> 关闭详情恢复焦点到「最近结果」按钮
    await click(findButton(container, '流程与计划'));
    const selfcheckCard = container.querySelector('[aria-label="系统自检"]')!;
    const lastRunBtn = [...selfcheckCard.querySelectorAll('dd button')][0] as HTMLButtonElement;
    await click(lastRunBtn);
    assert.equal(window.document.activeElement, container.querySelector('#automation-run-detail'));
    await click(findButton(container, '关闭详情'));
    assert.equal(window.document.activeElement, lastRunBtn, '关闭详情后应恢复焦点至「最近结果」按钮');

    // 3. 资讯收件箱「查看运行」-> 通过 NewsInbox.onOpenRun 传递 trigger 并聚焦详情 -> 关闭后恢复焦点
    await click(findButton(container, '待处理收件箱'));
    await waitFor(() => !!container.querySelector('#news-candidates'), '收件箱渲染完成');
    const viewRunBtn = findButton(container.querySelector('#news-candidates')!, '查看运行');
    await click(viewRunBtn);
    assert.equal(window.document.activeElement, container.querySelector('#automation-run-detail'));
    await waitFor(
      () => (container.querySelector('[aria-labelledby="automation-run-detail"]')?.textContent ?? '').includes('成功'),
      '加载候选关联运行',
    );
    await click(findButton(container, '关闭详情'));
    assert.equal(window.document.activeElement, viewRunBtn, '关闭详情后应恢复焦点至「查看运行」按钮');

    // 4. 任务计划「立即运行」-> 异步返回后仍记住触发按钮，关闭详情后恢复焦点
    await click(findButton(container, '流程与计划'));
    const runNowBtn = findButton(container.querySelector('[aria-label="系统自检"]')!, '立即运行');
    await click(runNowBtn);
    assert.equal(window.document.activeElement, container.querySelector('#automation-run-detail'));
    await click(findButton(container, '关闭详情'));
    assert.equal(window.document.activeElement, runNowBtn, '关闭详情后应恢复焦点至「立即运行」按钮');

    // 5. 若原触发按钮已从 DOM 卸载（isConnected === false），关闭详情不得报错或聚焦到断连节点
    await click(findButton(container, '运行记录'));
    await waitFor(
      () => !!container.querySelector('[aria-labelledby="automation-history"] li button'),
      '运行历史重新渲染完成',
    );
    const historySectionAfter = container.querySelector('[aria-labelledby="automation-history"]')!;
    const detailBtnAfter = [...historySectionAfter.querySelectorAll('li button')][0] as HTMLButtonElement;
    await click(detailBtnAfter);
    assert.equal(detailBtnAfter.isConnected, true);
    const statusSelect = [
      ...historySectionAfter.querySelectorAll('.automation-filters select'),
    ][1] as HTMLSelectElement;
    await act(async () => {
      statusSelect.value = 'failed';
      statusSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    });
    await waitFor(() => !detailBtnAfter.isConnected, '筛选后原按钮已从 DOM 移除');
    await click(findButton(container, '关闭详情'));
    assert.equal(container.querySelector('#automation-run-detail'), null);
    assert.equal(window.document.activeElement?.isConnected, true, '焦点不得落在已卸载节点上');
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  }
});
