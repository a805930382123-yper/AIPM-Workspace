import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type {
  AutomationRun,
  AutomationSchedule,
  AutomationStatus,
  CandidateList,
  CandidateView,
  KnowledgeHealth,
  ReminderView,
  WeeklyReviewList,
} from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
});
const browser = dom.window;
for (const [name, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Event: browser.Event,
  KeyboardEvent: browser.KeyboardEvent,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  HTMLDetailsElement: browser.HTMLDetailsElement,
  Node: browser.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
browser.HTMLElement.prototype.scrollIntoView = () => {};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AutomationPage } = await import('../app/pages/AutomationPage');
const { lastCompletedIsoWeek } = await import('../app/components/automation/automationMeta');

const ts = '2026-11-20T02:00:00.000Z';
const day = '2026-11-20';
const token = 'autoux01-test-token';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => unknown, label = 'condition') {
  for (let i = 0; i < 80; i += 1) {
    if (check()) return;
    await act(async () => {
      await tick(10);
    });
  }
  assert.fail(`等待超时：${label}`);
}

const findButton = (text: string, scope: ParentNode = document) => {
  const btn = [...scope.querySelectorAll('button')].find(el => (el.textContent ?? '').includes(text));
  assert.ok(btn, `找不到按钮：${text}`);
  return btn;
};

const click = async (target: HTMLElement) => {
  await act(async () => {
    target.click();
    await tick(0);
  });
};

const baseStatus = (overrides: Partial<AutomationStatus> = {}): AutomationStatus => ({
  paused: false,
  scheduler: { healthy: true, lastTickAt: ts },
  instance: { pid: 8088, port: 4317, mode: 'production', startedAt: ts, hostname: 'localhost' },
  nextRunAt: ts,
  failuresLast24Hours: 0,
  writeToken: token,
  ...overrides,
});

const makeSchedules = (): AutomationSchedule[] => [
  {
    type: 'system.selfcheck',
    name: '工作台自检',
    enabled: true,
    plan: { kind: 'interval', minutes: 60 },
    catchUp: true,
    revision: 1,
    budget: null,
    nextRunAt: ts,
    lastRun: {
      id: 'run-self-1',
      type: 'system.selfcheck',
      trigger: 'schedule',
      scheduledAt: ts,
      startedAt: ts,
      endedAt: ts,
      status: 'succeeded',
    },
    mayCallModel: false,
    allowsCatchUp: true,
  },
  {
    type: 'news.daily',
    name: '每日资讯准备与预筛',
    enabled: true,
    plan: { kind: 'daily', time: '07:30', timezone: 'Asia/Shanghai' },
    catchUp: true,
    revision: 1,
    budget: null,
    nextRunAt: ts,
    lastRun: null,
    mayCallModel: true,
    allowsCatchUp: true,
  },
  {
    type: 'wiki.lint',
    name: '知识库结构巡检',
    enabled: true,
    plan: { kind: 'daily', time: '08:00', timezone: 'Asia/Shanghai' },
    catchUp: true,
    revision: 1,
    budget: null,
    nextRunAt: ts,
    lastRun: null,
    mayCallModel: false,
    allowsCatchUp: true,
  },
  {
    type: 'wiki.inspect',
    name: '知识库主动巡检',
    enabled: false,
    plan: { kind: 'weekly', weekday: 1, time: '08:30', timezone: 'Asia/Shanghai' },
    catchUp: true,
    revision: 1,
    budget: null,
    nextRunAt: null,
    lastRun: null,
    mayCallModel: true,
    allowsCatchUp: true,
  },
  {
    type: 'work.reminders',
    name: '工作事项到期与新资料提醒',
    enabled: true,
    plan: { kind: 'interval', minutes: 60 },
    catchUp: false,
    revision: 1,
    budget: null,
    nextRunAt: ts,
    lastRun: null,
    mayCallModel: false,
    allowsCatchUp: false,
  },
  {
    type: 'review.weekly',
    name: '每周工作回顾草稿',
    enabled: true,
    plan: { kind: 'weekly', weekday: 1, time: '09:00', timezone: 'Asia/Shanghai' },
    catchUp: true,
    revision: 1,
    budget: null,
    nextRunAt: ts,
    lastRun: null,
    mayCallModel: true,
    allowsCatchUp: true,
  },
];

const candidateRow = (id: string, title: string, phase?: NonNullable<CandidateView['execution']>['phase']): CandidateView => ({
  id: `${day}/fmcg/${id}`,
  section: 'fmcg',
  disposition: 'inbox',
  ...(phase
    ? {
        confirmation: {
          requestId: '11111111-1111-4111-8111-111111111111',
          registrationId: '22222222-2222-4222-8222-222222222222',
          grantedAt: ts,
          organize: true,
          mode: 'standard',
        },
        execution: {
          runId: '33333333-3333-4333-8333-333333333333',
          phase,
          error: phase === 'organize_failed' ? '整理失败示例' : undefined,
        },
      }
    : {}),
  item: {
    id,
    title,
    sourceId: 'src',
    sourceName: '合成渠道',
    url: `https://example.test/${id}`,
    publishedAt: day,
    fetchedAt: ts,
    excerpt: '测试摘录。',
    evidenceKind: 'article_excerpt',
  },
  screening: {
    score: {
      candidateId: `${day}/fmcg/${id}`,
      relevance: 3,
      reason: '相关性高',
      categories: ['渠道'],
      suggestedMode: 'standard',
    },
  },
});

test('A1-01/A1-02/A1-03: 顶部紧凑横幅色标、折叠进程信息、3-Tab 键盘导航、5 组流程卡与跨 Tab 跳转', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.getElementById('root')!);

  let currentStatus = baseStatus();
  const candidatesPayload: CandidateList = {
    date: day,
    dates: [day],
    items: [
      candidateRow('cand-pending', '待确认资讯条目'),
      candidateRow('cand-org', '整理中资讯条目', 'organizing'),
      candidateRow('cand-fail', '整理失败资讯条目', 'organize_failed'),
    ],
    counts: { fetched: 3, pending: 1, organizing: 1, drafts: 0, failed: 1 },
  };
  const remindersPayload: ReminderView = {
    revision: 1,
    settings: {
      desktopNotificationsEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      staleDays: 7,
      maxToastsPerRun: 3,
    },
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        dedupeKey: 'k1',
        itemId: '55555555-5555-4555-8555-555555555555',
        itemTitle: '重点客户回访到期',
        itemKind: 'customer_issue',
        kind: 'due_follow_up',
        summary: '今日到期跟进',
        status: 'unread',
        firstDetectedAt: ts,
        lastDetectedAt: ts,
        deliveryStatus: 'delivered',
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        dedupeKey: 'k2',
        itemId: '77777777-7777-4777-8777-777777777777',
        itemTitle: '已读跟进事项',
        itemKind: 'customer_issue',
        kind: 'stale_item',
        summary: '已 8 天未推进',
        status: 'acknowledged',
        firstDetectedAt: ts,
        lastDetectedAt: ts,
        deliveryStatus: 'delivered',
      },
    ],
    unreadCount: 2,
    issues: [],
  };
  const healthPayload: KnowledgeHealth = {
    lint: { runId: 'run-lint-1', checkedAt: ts, total: 5, isBaseline: false, addedCount: 2, resolvedCount: 1 },
    inspection: { inspectionId: 'insp-1', checkedAt: ts, readCount: 6, pendingCount: 4 },
    issues: [],
  };
  const weeklyPayload: WeeklyReviewList = {
    items: [
      {
        weekKey: '2026-W46',
        period: {
          weekKey: '2026-W46',
          start: '2026-11-09',
          end: '2026-11-16',
          from: '2026-11-08T16:00:00.000Z',
          until: '2026-11-15T16:00:00.000Z',
          partialWeek: false,
        },
        revision: 1,
        status: 'reviewed',
        aiStatus: 'ready',
        updatedAt: ts,
      },
    ],
    settings: { revision: 1, aiSummaryEnabled: true },
    issues: [],
  };

  let candidatesFetches = 0;
  let lintOpened = 0;
  const inspectionOpened: Array<string | undefined> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(currentStatus);
    if (path === '/api/automation/schedules') {
      return json({
        items: [
          ...makeSchedules(),
          {
            type: 'custom.unknown',
            name: '自定义拓展检查',
            enabled: true,
            plan: { kind: 'interval', minutes: 120 },
            catchUp: false,
            revision: 1,
            budget: null,
            nextRunAt: ts,
            lastRun: null,
            mayCallModel: false,
            allowsCatchUp: false,
          },
        ],
      });
    }
    if (path === '/api/automation/knowledge-health') return json(healthPayload);
    if (path === '/api/automation/reminders') return json(remindersPayload);
    if (path === '/api/automation/candidates') {
      candidatesFetches += 1;
      return json(candidatesPayload);
    }
    if (path === '/api/automation/pipeline/settings') {
      return json({ revision: 1, preScreenEnabled: true, topics: ['渠道'], concurrency: 2 });
    }
    if (path === '/api/automation/weekly-reviews') return json(weeklyPayload);
    if (path === '/api/automation/runs') return json({ items: [] });
    if (path === '/api/automation/pause' && init?.method === 'POST') {
      assert.equal(new Headers(init.headers).get('X-FMCG-Automation-Token'), token);
      currentStatus = { ...currentStatus, paused: true };
      return json(currentStatus);
    }
    if (path === '/api/automation/resume' && init?.method === 'POST') {
      assert.equal(new Headers(init.headers).get('X-FMCG-Automation-Token'), token);
      currentStatus = { ...currentStatus, paused: false, failuresLast24Hours: 2 };
      return json(currentStatus);
    }
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        createElement(AutomationPage, {
          onOpenRaw: () => {},
          onOpenDraft: () => {},
          onOpenLint: () => {
            lintOpened += 1;
          },
          onOpenInspection: id => {
            inspectionOpened.push(id);
          },
          onOpenWorkItem: () => {},
          onOpenWeeklyReview: () => {},
        }),
      );
      await tick(0);
    });

    await waitFor(() => document.querySelectorAll('.automation-workflow-card').length === 6, '等待 5 组 + 1 兜底流程卡');

    // A1-01 顶部横幅初始 ok 色标、待处理计数（1 + 2 = 3 项）、折叠进程信息
    const banner = document.querySelector<HTMLElement>('.automation-banner')!;
    assert.equal(banner.dataset.tone, 'ok');
    assert.match(banner.textContent ?? '', /当前待处理3 项|当前待处理.*3 项/u);
    const processInfo = banner.querySelector<HTMLDetailsElement>('.automation-process-info')!;
    assert.equal(processInfo.open, false);
    assert.match(processInfo.textContent ?? '', /生产 · PID 8088 · 端口 4317/);

    // 暂停 -> warning，恢复（带 failures=2）-> danger
    await click(findButton('暂停全部自动化', banner));
    await click(findButton('确认暂停', banner));
    assert.equal(banner.dataset.tone, 'warning');
    assert.match(banner.textContent ?? '', /全局暂停/);
    await click(findButton('恢复全部自动化', banner));
    await click(findButton('确认恢复', banner));
    assert.equal(banner.dataset.tone, 'danger');

    // A1-02 默认落在「流程与计划」，收件箱 Tab 角标为 3
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!;
    const wfTab = document.querySelector<HTMLButtonElement>('#automation-tab-workflows')!;
    const inboxTab = document.querySelector<HTMLButtonElement>('#automation-tab-inbox')!;
    const runsTab = document.querySelector<HTMLButtonElement>('#automation-tab-runs')!;
    assert.equal(wfTab.getAttribute('aria-selected'), 'true');
    assert.equal(inboxTab.querySelector('.automation-tab-badge')?.textContent, '3');

    // 键盘方向键、End、Home 切换 Tab 并移动焦点
    wfTab.focus();
    await act(async () => {
      tablist.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await tick(0);
    });
    assert.equal(inboxTab.getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement, inboxTab);
    await act(async () => {
      tablist.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await tick(0);
    });
    assert.equal(runsTab.getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement, runsTab);
    await act(async () => {
      tablist.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await tick(0);
    });
    assert.equal(wfTab.getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement, wfTab);

    // A1-03 5 组流程卡结构、知识库合并与跳转回调
    assert.ok(document.querySelector('[aria-label="每日资讯准备与预筛"]'));
    assert.ok(document.querySelector('[aria-label="知识库定时巡检"]'));
    assert.ok(document.querySelector('[aria-label="知识库结构巡检"]'));
    assert.ok(document.querySelector('[aria-label="知识库主动巡检"]'));
    assert.ok(document.querySelector('[aria-label="工作事项到期与新资料提醒"]'));
    assert.ok(document.querySelector('[aria-label="每周工作回顾草稿"]'));
    assert.ok(document.querySelector('[aria-label="工作台自检"]'));
    assert.ok(document.querySelector('[aria-label="自定义拓展检查"]'));

    // 不应渲染独立的「知识库巡检摘要」面板
    assert.equal(document.querySelector('#automation-knowledge-health'), null);

    await click(findButton('查看结构检查'));
    await click(findButton('查看主动检查'));
    assert.equal(lintOpened, 1);
    assert.deepEqual(inspectionOpened, ['insp-1']);

    // 点击资讯流程卡「人工确认入库」节点 -> 切至收件箱并筛选 pending（且不重复拉取 /candidates）
    const fetchesBeforeSwitch = candidatesFetches;
    const newsCard = document.querySelector<HTMLElement>('[aria-label="每日资讯准备与预筛"]')!;
    assert.equal(newsCard.querySelectorAll('.automation-flow-step').length, 3);
    await click(findButton('人工确认入库', newsCard));
    assert.equal(inboxTab.getAttribute('aria-selected'), 'true');
    assert.equal(candidatesFetches, fetchesBeforeSwitch, '切换到收件箱不应重复轮询 /candidates');
    const candidateSelect = [...document.querySelectorAll<HTMLSelectElement>('#news-candidates select')][1]!;
    assert.equal(candidateSelect.value, 'pending');
    assert.equal(document.activeElement, document.querySelector('#news-candidate-title'));

    // 切回流程卡点击「自动整理待审草稿」节点 -> 切至收件箱并筛选 organizing
    await click(wfTab);
    await click(findButton('自动整理待审草稿', document.querySelector('[aria-label="每日资讯准备与预筛"]')!));
    assert.equal(inboxTab.getAttribute('aria-selected'), 'true');
    const candidateSelect2 = [...document.querySelectorAll<HTMLSelectElement>('#news-candidates select')][1]!;
    assert.equal(candidateSelect2.value, 'organizing');

    // 切回流程卡点击工作事项提醒「事项提醒列表」节点 -> 聚焦 #automation-reminders
    await click(wfTab);
    await click(findButton('事项提醒列表', document.querySelector('[aria-label="工作事项到期与新资料提醒"]')!));
    assert.equal(inboxTab.getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement, document.querySelector('#automation-reminders'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test('A1-04: 每周工作回顾直达周报（有归档 / 无归档回退 lastCompletedIsoWeek）、AI 总结开关与 409 版本冲突处理', async () => {
  // 校验上海时区上一完整自然周计算（含跨年与周一 00:00 边界）
  assert.equal(lastCompletedIsoWeek(Date.parse('2026-01-04T16:00:00.000Z')), '2026-W01');
  assert.equal(lastCompletedIsoWeek(Date.parse('2026-01-04T15:59:59.999Z')), '2025-W52');
  assert.equal(lastCompletedIsoWeek(Date.parse('2026-11-23T01:00:00.000Z')), '2026-W47');

  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.getElementById('root')!);
  const openedWeeks: string[] = [];
  const patchBodies: Array<{ revision: number; aiSummaryEnabled: boolean }> = [];

  let weeklyItems: WeeklyReviewList['items'] = [];
  let serverSettings = { revision: 1, aiSummaryEnabled: true };
  let forceConflictOnce = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(baseStatus());
    if (path === '/api/automation/schedules') {
      return json({ items: makeSchedules().filter(item => item.type === 'review.weekly') });
    }
    if (path === '/api/automation/runs') return json({ items: [] });
    if (path === '/api/automation/weekly-reviews') {
      return json({ items: weeklyItems, settings: serverSettings, issues: [] } satisfies WeeklyReviewList);
    }
    if (path === '/api/automation/weekly-reviews/settings' && init?.method === 'PATCH') {
      assert.equal(new Headers(init.headers).get('X-FMCG-Automation-Token'), token);
      const body = JSON.parse(String(init.body)) as { revision: number; aiSummaryEnabled: boolean };
      patchBodies.push(body);
      if (forceConflictOnce) {
        forceConflictOnce = false;
        serverSettings = { revision: 2, aiSummaryEnabled: true };
        return json({ error: { code: 'WEEKLY_REVIEW_REVISION_CONFLICT', message: '版本冲突' } }, 409);
      }
      serverSettings = { revision: body.revision + 1, aiSummaryEnabled: body.aiSummaryEnabled };
      return json(serverSettings);
    }
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    // 场景 1：无历史归档，显示「前往自动周报」并回退 lastCompletedIsoWeek()
    await act(async () => {
      root.render(
        createElement(AutomationPage, {
          onOpenRaw: () => {},
          onOpenDraft: () => {},
          onOpenWeeklyReview: weekKey => {
            openedWeeks.push(weekKey);
          },
        }),
      );
      await tick(0);
    });

    await waitFor(() => document.querySelector('.automation-weekly-setting input[type="checkbox"]'), '等待周报卡加载');
    const weeklyCard = document.querySelector<HTMLElement>('[aria-label="每周工作回顾草稿"]')!;
    assert.match(weeklyCard.textContent ?? '', /暂无归档/);
    await click(findButton('前往自动周报', weeklyCard));
    assert.deepEqual(openedWeeks, [lastCompletedIsoWeek()]);

    // 场景 2：切换 AI 总结开关成功保存（rev 1 -> rev 2）
    const checkbox = weeklyCard.querySelector<HTMLInputElement>('.automation-weekly-setting input[type="checkbox"]')!;
    assert.equal(checkbox.checked, true);
    await act(async () => {
      checkbox.click();
      await tick(0);
    });
    await waitFor(() => checkbox.checked === false, 'AI 开关保存为 false');
    assert.deepEqual(patchBodies[0], { revision: 1, aiSummaryEnabled: false });

    // 场景 3：模拟 409 冲突 -> 展示冲突提示与「重新读取设置」按钮 -> 重读后成功保存
    forceConflictOnce = true;
    await act(async () => {
      checkbox.click();
      await tick(0);
    });
    await waitFor(() => (weeklyCard.textContent ?? '').includes('409 版本冲突'), '显示 409 冲突提示');
    const reloadBtn = findButton('重新读取设置', weeklyCard);

    weeklyItems = [
      {
        weekKey: '2026-W45',
        period: {
          weekKey: '2026-W45',
          start: '2026-11-02',
          end: '2026-11-09',
          from: '2026-11-01T16:00:00.000Z',
          until: '2026-11-08T16:00:00.000Z',
          partialWeek: false,
        },
        revision: 1,
        status: 'draft',
        aiStatus: 'facts_only',
        updatedAt: ts,
      },
    ];
    await click(reloadBtn);
    await waitFor(() => (weeklyCard.textContent ?? '').includes('2026-W45'), '重新读取后显示最新归档');
    assert.equal(checkbox.checked, true);

    await act(async () => {
      checkbox.click();
      await tick(0);
    });
    await waitFor(() => checkbox.checked === false, '重读后再次切换成功');
    assert.deepEqual(patchBodies.at(-1), { revision: 2, aiSummaryEnabled: false });

    await click(findButton('查看最近周报（2026-W45）', weeklyCard));
    assert.equal(openedWeeks.at(-1), '2026-W45');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test('A1-02: 跨页深链 candidateFilter / focusReminders / initialRunId 自动路由到对应 Tab 并恢复焦点/筛选', async () => {
  const nativeFetch = globalThis.fetch;
  const runDetail: AutomationRun = {
    id: 'run-deep-1',
    type: 'system.selfcheck',
    trigger: 'manual',
    scheduledAt: ts,
    startedAt: ts,
    endedAt: ts,
    status: 'succeeded',
    steps: [{ name: '本地检查', status: 'succeeded', startedAt: ts, endedAt: ts, durationMs: 5, summary: '正常' }],
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
    artifacts: { rawIds: [], jobIds: [], draftIds: [] },
    budget: null,
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(baseStatus());
    if (path === '/api/automation/schedules') return json({ items: makeSchedules() });
    if (path === '/api/automation/knowledge-health') return json({ lint: null, inspection: null, issues: [] });
    if (path === '/api/automation/reminders') {
      return json({
        revision: 1,
        settings: {
          desktopNotificationsEnabled: true,
          quietHoursStart: '22:00',
          quietHoursEnd: '08:00',
          staleDays: 7,
          maxToastsPerRun: 3,
        },
        items: [],
        unreadCount: 0,
        issues: [],
      } satisfies ReminderView);
    }
    if (path === '/api/automation/candidates') {
      return json({
        date: day,
        dates: [day],
        items: [candidateRow('c-fail', '失败候选', 'organize_failed')],
        counts: { fetched: 1, pending: 0, organizing: 0, drafts: 0, failed: 1 },
      } satisfies CandidateList);
    }
    if (path === '/api/automation/pipeline/settings') {
      return json({ revision: 1, preScreenEnabled: true, topics: ['渠道'], concurrency: 2 });
    }
    if (path === '/api/automation/weekly-reviews') {
      return json({ items: [], settings: { revision: 1, aiSummaryEnabled: true }, issues: [] });
    }
    if (path === '/api/automation/runs') return json({ items: [runDetail] });
    if (path === '/api/automation/runs/run-deep-1') return json(runDetail);
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    // 1. candidateFilter="failed" -> 自动切到「待处理收件箱」并筛选 failed
    {
      const root = createRoot(document.getElementById('root')!);
      await act(async () => {
        root.render(
          createElement(AutomationPage, {
            onOpenRaw: () => {},
            onOpenDraft: () => {},
            candidateFilter: 'failed',
          }),
        );
        await tick(0);
      });
      await waitFor(() => document.querySelector('#news-candidates'), '等待收件箱渲染');
      assert.equal(document.querySelector('#automation-tab-inbox')?.getAttribute('aria-selected'), 'true');
      const select = [...document.querySelectorAll<HTMLSelectElement>('#news-candidates select')][1]!;
      assert.equal(select.value, 'failed');
      assert.match(document.querySelector('#news-candidates')?.textContent ?? '', /失败候选/);
      await act(async () => root.unmount());
    }

    // 2. focusReminders=true -> 自动切到「待处理收件箱」并聚焦 #automation-reminders
    {
      const root = createRoot(document.getElementById('root')!);
      await act(async () => {
        root.render(
          createElement(AutomationPage, {
            onOpenRaw: () => {},
            onOpenDraft: () => {},
            onOpenWorkItem: () => {},
            focusReminders: true,
          }),
        );
        await tick(0);
      });
      await waitFor(() => document.querySelector('#automation-reminders'), '等待提醒区渲染');
      assert.equal(document.querySelector('#automation-tab-inbox')?.getAttribute('aria-selected'), 'true');
      assert.equal(document.activeElement, document.querySelector('#automation-reminders'));
      await act(async () => root.unmount());
    }

    // 3. initialRunId="run-deep-1" -> 自动切到「运行记录」并打开运行详情
    {
      const root = createRoot(document.getElementById('root')!);
      await act(async () => {
        root.render(
          createElement(AutomationPage, {
            onOpenRaw: () => {},
            onOpenDraft: () => {},
            initialRunId: 'run-deep-1',
          }),
        );
        await tick(0);
      });
      await waitFor(() => document.querySelector('#automation-run-detail'), '等待运行详情渲染');
      assert.equal(document.querySelector('#automation-tab-runs')?.getAttribute('aria-selected'), 'true');
      assert.equal(document.activeElement, document.querySelector('#automation-run-detail'));
      assert.match(document.querySelector('[aria-labelledby="automation-run-detail"]')?.textContent ?? '', /本地检查/);
      await act(async () => root.unmount());
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
