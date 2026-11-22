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
  PipelineSettings,
  ReminderSettings,
  ReminderView,
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
  MouseEvent: browser.MouseEvent,
  KeyboardEvent: browser.KeyboardEvent,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
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

const ts = '2026-11-21T02:00:00.000Z';
const day = '2026-11-21';
const token = 'autoux02-test-token';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const btn = [...scope.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(text));
  assert.ok(btn, `找不到按钮：${text}`);
  return btn;
};

const click = async (target: HTMLElement) => {
  await act(async () => {
    target.click();
    await tick(0);
  });
};

const pressKey = async (target: EventTarget, key: string, shiftKey = false) => {
  await act(async () => {
    target.dispatchEvent(new browser.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    await tick(0);
  });
};

const setControlValue = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const proto =
      el instanceof browser.HTMLTextAreaElement
        ? browser.HTMLTextAreaElement.prototype
        : el instanceof browser.HTMLSelectElement
          ? browser.HTMLSelectElement.prototype
          : browser.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new browser.Event('input', { bubbles: true }));
    el.dispatchEvent(new browser.Event('change', { bubbles: true }));
    await tick(0);
  });
};

const baseStatus = (): AutomationStatus => ({
  paused: false,
  scheduler: { healthy: true, lastTickAt: ts },
  instance: { pid: 9012, port: 4317, mode: 'production', startedAt: ts, hostname: 'localhost' },
  nextRunAt: ts,
  failuresLast24Hours: 0,
  writeToken: token,
});

const makeSchedules = (includeNews = true, includeReminders = true): AutomationSchedule[] => {
  const items: AutomationSchedule[] = [
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
  ];
  if (includeNews) {
    items.push({
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
    });
  }
  if (includeReminders) {
    items.push({
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
    });
  }
  return items;
};

const makeCandidate = (
  id: string,
  title: string,
  opts: {
    relevance?: 0 | 1 | 2 | 3;
    screenError?: string;
    phase?: NonNullable<CandidateView['execution']>['phase'];
    draftPending?: boolean;
    disposition?: CandidateView['disposition'];
    runId?: string;
  } = {},
): CandidateView => ({
  id: `${day}/fmcg/${id}`,
  section: 'fmcg',
  disposition: opts.disposition ?? 'inbox',
  draftPending: opts.draftPending,
  ...(opts.phase || opts.runId
    ? {
        confirmation: {
          requestId: '11111111-1111-4111-8111-111111111111',
          registrationId: '22222222-2222-4222-8222-222222222222',
          grantedAt: ts,
          organize: true,
          mode: 'standard',
        },
        execution: {
          runId: opts.runId ?? 'run-cand-1',
          phase: opts.phase ?? 'draft_ready',
          draftId: opts.draftPending ? `draft-${id}` : undefined,
          error: opts.phase === 'organize_failed' ? '整理失败示例' : undefined,
        },
      }
    : {}),
  item: {
    id,
    title,
    sourceId: 'src',
    sourceName: '测试源',
    url: `https://example.test/${id}`,
    publishedAt: day,
    fetchedAt: ts,
    excerpt: '测试摘录。',
    evidenceKind: 'article_excerpt',
  },
  ...(opts.screenError
    ? { screening: { error: opts.screenError } }
    : opts.relevance !== undefined
      ? {
          screening: {
            score: {
              candidateId: `${day}/fmcg/${id}`,
              relevance: opts.relevance,
              reason: `相关性 ${opts.relevance} 分理由`,
              categories: ['渠道'],
              suggestedMode: opts.relevance === 3 ? 'deep' : 'standard',
            },
          },
        }
      : {}),
});

test('A2-01/A2-02: 收件箱子区切换、5 阶段可点击漏斗双向同步、紧凑胶囊与提醒分类过滤/语义色条', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.getElementById('root')!);

  const candidatesPayload: CandidateList = {
    date: day,
    dates: [day],
    items: [
      makeCandidate('cand-pending-3', '高分待确认资讯', { relevance: 3 }),
      makeCandidate('cand-unscreened', '未预筛待确认资讯', { screenError: '本批读取失败。' }),
      makeCandidate('cand-org-2', '整理中资讯', { relevance: 2, phase: 'organizing', runId: 'run-org-1' }),
      makeCandidate('cand-draft-2', '待审草稿资讯', {
        relevance: 2,
        phase: 'draft_ready',
        draftPending: true,
        runId: 'run-draft-1',
      }),
      makeCandidate('cand-fail-1', '整理失败资讯', { relevance: 1, phase: 'organize_failed', runId: 'run-fail-1' }),
      makeCandidate('cand-low-0', '低分折叠资讯', { relevance: 0 }),
      makeCandidate('cand-ignored', '已忽略资讯', { relevance: 2, disposition: 'ignored' }),
    ],
    counts: { fetched: 7, pending: 3, organizing: 1, drafts: 1, failed: 1 },
  };

  let remindersState: ReminderView = {
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
        id: 'rem-due-1',
        dedupeKey: 'k-due',
        itemId: 'work-1',
        itemTitle: '华东重点客户拜访到期',
        itemKind: 'customer_issue',
        kind: 'due_follow_up',
        summary: '今日到期跟进',
        status: 'unread',
        firstDetectedAt: ts,
        lastDetectedAt: ts,
        deliveryStatus: 'delivered',
      },
      {
        id: 'rem-stale-1',
        dedupeKey: 'k-stale',
        itemId: 'work-2',
        itemTitle: '渠道调研久未推进',
        itemKind: 'product_analysis',
        kind: 'stale_item',
        summary: '已 10 天无新进展',
        status: 'acknowledged',
        firstDetectedAt: ts,
        lastDetectedAt: ts,
        deliveryStatus: 'delivered',
      },
    ],
    unreadCount: 1,
    issues: [],
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(baseStatus());
    if (path === '/api/automation/schedules') return json({ items: makeSchedules(true, true) });
    if (path === '/api/automation/reminders' && !init?.method) return json(remindersState);
    if (path === '/api/automation/reminders/rem-due-1/ack' && init?.method === 'POST') {
      remindersState = {
        ...remindersState,
        revision: 2,
        unreadCount: 0,
        items: remindersState.items.map((item) =>
          item.id === 'rem-due-1' ? { ...item, status: 'acknowledged' } : item,
        ),
      };
      return json(remindersState);
    }
    if (path === '/api/automation/candidates') return json(candidatesPayload);
    if (path === '/api/automation/pipeline/settings') {
      return json({ revision: 1, preScreenEnabled: true, topics: ['渠道'], concurrency: 2 });
    }
    if (path === '/api/automation/runs') return json({ items: [] });
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        createElement(AutomationPage, {
          onOpenRaw: () => {},
          onOpenDraft: () => {},
          onOpenWorkItem: () => {},
        }),
      );
      await tick(0);
    });
    await waitFor(() => document.querySelectorAll('.automation-workflow-card').length === 3, '流程卡就绪');

    // 进入待处理收件箱：同时存在 pipeline 与 reminders 时展示子区切换栏
    await click(findButton('待处理收件箱'));
    await waitFor(() => document.querySelector('.automation-subtabs'), '等待子区切换栏');
    const subtabs = document.querySelector<HTMLElement>('.automation-subtabs[role="tablist"]')!;
    const subCandidates = document.querySelector<HTMLButtonElement>('#automation-subtab-candidates')!;
    const subReminders = document.querySelector<HTMLButtonElement>('#automation-subtab-reminders')!;
    assert.equal(subCandidates.getAttribute('aria-selected'), 'true');
    assert.match(subCandidates.textContent ?? '', /待确认 3/);
    assert.match(subReminders.textContent ?? '', /未读 1/);

    // 5 阶段可点击漏斗条与 <select> 双向同步
    const funnel = document.querySelector<HTMLElement>('.automation-funnel')!;
    const stages = [...funnel.querySelectorAll<HTMLButtonElement>('.automation-funnel-stage')];
    assert.equal(stages.length, 5);
    assert.equal(stages[1]!.dataset.tone, 'review'); // 待确认
    assert.equal(stages[3]!.dataset.tone, 'review'); // 待审草稿
    assert.equal(stages[4]!.dataset.tone, 'danger'); // 失败

    const candidateSelect = [...document.querySelectorAll<HTMLSelectElement>('#news-candidates select')][1]!;
    await click(stages[3]!); // 点击待审草稿
    assert.equal(stages[3]!.getAttribute('aria-pressed'), 'true');
    assert.equal(candidateSelect.value, 'drafts');
    assert.equal(document.querySelectorAll('#news-candidates .news-candidate').length, 1);
    assert.ok(document.querySelector('#news-candidates [aria-label="待审草稿资讯"]'));

    // 二次点击已激活阶段恢复 'all'
    await click(stages[3]!);
    assert.equal(stages[3]!.getAttribute('aria-pressed'), 'false');
    assert.equal(candidateSelect.value, 'all');
    assert.equal(findButton('收件箱（全部未忽略）', funnel).getAttribute('aria-pressed'), 'true');

    // 下拉切换回 failed 同步高亮漏斗「失败」阶段
    await setControlValue(candidateSelect, 'failed');
    assert.equal(stages[4]!.getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelectorAll('#news-candidates .news-candidate').length, 1);
    assert.ok(document.querySelector('#news-candidates [aria-label="整理失败资讯"]'));

    // 切回全量并验证紧凑胶囊与低分默认折叠
    await click(findButton('收件箱（全部未忽略）', funnel));
    const unscreened = document.querySelector<HTMLElement>('[aria-label="未预筛待确认资讯"]')!;
    assert.match(unscreened.querySelector('.automation-candidate-pills')?.textContent ?? '', /未预筛.*本批读取失败/u);
    const highCard = document.querySelector<HTMLElement>('[aria-label="高分待确认资讯"]')!;
    const highPill = highCard.querySelector<HTMLElement>('.automation-candidate-pills .automation-pill')!;
    assert.equal(highPill.dataset.tone, 'accent');
    assert.equal(document.querySelector<HTMLDetailsElement>('.candidate-low')?.open, false);

    // 子区键盘导航切至「事项提醒」
    subCandidates.focus();
    await pressKey(subtabs, 'ArrowRight');
    assert.equal(subReminders.getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement, subReminders);

    // 验证 A2-02 分类过滤芯片与空分类提示、未读语义色条
    const chips = [...document.querySelectorAll<HTMLButtonElement>('.automation-filter-chips .automation-filter-chip')];
    assert.equal(chips.length, 4);
    assert.equal(chips[0]!.getAttribute('aria-pressed'), 'true');

    const dueItem = document.querySelector<HTMLElement>(
      '.automation-reminder-list li[aria-label="华东重点客户拜访到期"]',
    )!;
    const staleItem = document.querySelector<HTMLElement>(
      '.automation-reminder-list li[aria-label="渠道调研久未推进"]',
    )!;
    assert.equal(dueItem.dataset.status, 'unread');
    assert.equal(dueItem.dataset.tone, 'danger');
    assert.equal(staleItem.dataset.status, 'acknowledged');
    assert.equal(staleItem.dataset.tone, 'muted');

    // 筛选「新资料待分析」（0 条） -> 空分类提示 -> 点击「显示全部提醒」恢复
    await click(chips[3]!);
    assert.match(
      document.querySelector('[aria-labelledby="automation-reminders"]')?.textContent ?? '',
      /当前分类暂无提醒/,
    );
    await click(findButton('显示全部提醒'));
    assert.equal(document.querySelectorAll('.automation-reminder-list li').length, 2);

    // 标为已读后，色条与状态同步变为 muted / acknowledged
    const dueItemFresh = document.querySelector<HTMLElement>(
      '.automation-reminder-list li[aria-label="华东重点客户拜访到期"]',
    )!;
    await click(findButton('已读', dueItemFresh));
    await waitFor(
      () =>
        document.querySelector<HTMLElement>('.automation-reminder-list li[aria-label="华东重点客户拜访到期"]')?.dataset
          .tone === 'muted',
      '已读后色条降噪为 muted',
    );
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test('A2-01 单源守卫：仅存在单一收件箱来源时不渲染 .automation-subtabs', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.getElementById('root')!);
  let pipelineSettingsCalls = 0;
  let candidateCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(baseStatus());
    if (path === '/api/automation/schedules') return json({ items: makeSchedules(false, true) }); // 无 news.daily
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
    if (path === '/api/automation/runs') return json({ items: [] });
    if (path === '/api/automation/pipeline/settings') {
      pipelineSettingsCalls += 1;
      return json({});
    }
    if (path === '/api/automation/candidates') {
      candidateCalls += 1;
      return json({});
    }
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        createElement(AutomationPage, {
          onOpenRaw: () => {},
          onOpenDraft: () => {},
          onOpenWorkItem: () => {},
        }),
      );
      await tick(0);
    });
    await waitFor(() => document.querySelectorAll('.automation-workflow-card').length === 2, '无资讯流水线流程卡');
    await click(findButton('待处理收件箱'));
    await waitFor(() => document.querySelector('#automation-reminders'), '直接渲染事项提醒');
    assert.equal(document.querySelector('.automation-subtabs'), null);
    assert.equal(pipelineSettingsCalls, 0);
    assert.equal(candidateCalls, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test('A2-03: 流水线设置与提醒设置双入口模态弹窗、409 冲突处理、测试通知与 Escape 焦点恢复', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.getElementById('root')!);

  let serverPipeline: PipelineSettings = {
    revision: 1,
    preScreenEnabled: true,
    topics: ['原始主题'],
    concurrency: 2,
  };
  let pipelineConflictOnce = true;

  let serverReminders: ReminderView = {
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
  };
  let reminderConflictOnce = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(baseStatus());
    if (path === '/api/automation/schedules') return json({ items: makeSchedules(true, true) });
    if (path === '/api/automation/candidates') {
      return json({
        date: day,
        dates: [day],
        items: [],
        counts: { fetched: 0, pending: 0, organizing: 0, drafts: 0, failed: 0 },
      } satisfies CandidateList);
    }
    if (path === '/api/automation/pipeline/settings') {
      if (init?.method === 'PATCH') {
        assert.equal(new Headers(init.headers).get('X-FMCG-Automation-Token'), token);
        const body = JSON.parse(String(init.body)) as PipelineSettings;
        if (pipelineConflictOnce) {
          pipelineConflictOnce = false;
          serverPipeline = { ...serverPipeline, revision: 2, topics: ['服务端最新主题'] };
          return json({ error: { code: 'PIPELINE_CONFLICT', message: '版本冲突' } }, 409);
        }
        serverPipeline = { ...body, revision: body.revision + 1 };
        return json(serverPipeline);
      }
      return json(serverPipeline);
    }
    if (path === '/api/automation/reminders') return json(serverReminders);
    if (path === '/api/automation/reminders/settings' && init?.method === 'PATCH') {
      assert.equal(new Headers(init.headers).get('X-FMCG-Automation-Token'), token);
      const body = JSON.parse(String(init.body)) as ReminderSettings & { revision: number };
      if (reminderConflictOnce) {
        reminderConflictOnce = false;
        serverReminders = {
          ...serverReminders,
          revision: 2,
          settings: { ...serverReminders.settings, staleDays: 14 },
        };
        return json({ error: { code: 'REMINDER_CONFLICT', message: '版本冲突' } }, 409);
      }
      serverReminders = {
        ...serverReminders,
        revision: body.revision + 1,
        settings: {
          desktopNotificationsEnabled: body.desktopNotificationsEnabled,
          quietHoursStart: body.quietHoursStart,
          quietHoursEnd: body.quietHoursEnd,
          staleDays: body.staleDays,
          maxToastsPerRun: body.maxToastsPerRun,
        },
      };
      return json(serverReminders);
    }
    if (path === '/api/automation/reminders/test-notification' && init?.method === 'POST') {
      return json({ deliveryStatus: 'delivered' });
    }
    if (path === '/api/automation/runs') return json({ items: [] });
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        createElement(AutomationPage, {
          onOpenRaw: () => {},
          onOpenDraft: () => {},
          onOpenWorkItem: () => {},
        }),
      );
      await tick(0);
    });
    await waitFor(() => document.querySelectorAll('.automation-workflow-card').length === 3, '等待流程卡');

    // 1. Tab 1 资讯卡点击「流水线设置」弹窗 + 409 冲突处理 + Escape 关闭焦点恢复
    const pipelineBtnTab1 = findButton('流水线设置');
    await waitFor(() => !pipelineBtnTab1.disabled, '等待流水线设置就绪');
    pipelineBtnTab1.focus();
    await click(pipelineBtnTab1);
    const pipelineForm = document.querySelector<HTMLFormElement>('form[aria-label="流水线设置"]')!;
    assert.ok(pipelineForm.closest('.automation-dialog[role="dialog"][aria-modal="true"]'));
    const topicsArea = pipelineForm.querySelector<HTMLTextAreaElement>('textarea')!;
    await setControlValue(topicsArea, '我的保留主题');
    await click(findButton('保存流水线设置', pipelineForm));
    await waitFor(() => pipelineForm.textContent?.includes('加载最新设置'), '显示流水线设置 409 冲突');
    assert.equal(topicsArea.value, '我的保留主题');
    await click(findButton('加载最新设置', pipelineForm));
    assert.equal(topicsArea.value, '服务端最新主题');
    await setControlValue(topicsArea, '新保存主题');
    await click(findButton('保存流水线设置', pipelineForm));
    await waitFor(() => document.querySelector('form[aria-label="流水线设置"]') === null, '保存后关闭弹窗');
    assert.equal(document.activeElement, pipelineBtnTab1, '关闭后焦点恢复到 Tab 1 流水线设置按钮');

    // Tab 1 再次打开验证已保存值并用 Escape 关闭
    await click(pipelineBtnTab1);
    assert.equal(
      document.querySelector<HTMLTextAreaElement>('form[aria-label="流水线设置"] textarea')?.value,
      '新保存主题',
    );
    await pressKey(document.activeElement!, 'Escape');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, pipelineBtnTab1);

    // 2. Tab 1 提醒卡点击「通知设置」弹窗 + 409 + 测试通知 + 保存
    const notifyBtnTab1 = findButton('通知设置');
    await waitFor(() => !notifyBtnTab1.disabled, '等待提醒设置就绪');
    notifyBtnTab1.focus();
    await click(notifyBtnTab1);
    const reminderForm = document.querySelector<HTMLFormElement>('form[aria-label="提醒与通知设置"]')!;
    await click(findButton('发送测试通知', reminderForm));
    await waitFor(() => reminderForm.textContent?.includes('测试通知 · 已投递'), '显示测试通知结果');
    await click(findButton('保存提醒设置', reminderForm));
    await waitFor(() => reminderForm.textContent?.includes('读取最新设置'), '显示提醒设置 409 冲突');
    await click(findButton('读取最新设置', reminderForm));
    const staleInput = reminderForm.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]!;
    assert.equal(staleInput.value, '14');
    await setControlValue(staleInput, '10');
    await click(findButton('保存提醒设置', reminderForm));
    await waitFor(() => document.querySelector('form[aria-label="提醒与通知设置"]') === null, '保存提醒后关闭弹窗');
    assert.equal(document.activeElement, notifyBtnTab1);

    // 3. Tab 2 双入口打开验证，且不再存在内联 details.automation-reminder-settings
    await click(findButton('待处理收件箱'));
    await waitFor(() => document.querySelector('#news-candidates'), '等待收件箱');
    const pipelineBtnTab2 = findButton('流水线设置', document.querySelector('#news-candidates')!);
    await click(pipelineBtnTab2);
    assert.ok(document.querySelector('form[aria-label="流水线设置"]'));
    await pressKey(document.activeElement!, 'Escape');

    await click(document.querySelector('#automation-subtab-reminders')!);
    assert.equal(document.querySelector('details.automation-reminder-settings'), null);
    const reminderBtnTab2 = findButton('提醒与通知设置');
    await click(reminderBtnTab2);
    assert.equal(
      document.querySelectorAll<HTMLInputElement>('form[aria-label="提醒与通知设置"] input[type="number"]')[0]!.value,
      '10',
    );
    await pressKey(document.activeElement!, 'Escape');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test('A2-04/A2-05: 运行记录主从双栏、垂直时间线 Stepper、用量网格、产物芯片与跨 Tab 右侧抽屉闭环', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.getElementById('root')!);

  const runSelf: AutomationRun = {
    id: 'run-self-1',
    type: 'system.selfcheck',
    trigger: 'schedule',
    scheduledAt: ts,
    startedAt: ts,
    endedAt: ts,
    status: 'succeeded',
    steps: [
      {
        name: '目录与配置检查',
        status: 'succeeded',
        startedAt: ts,
        endedAt: ts,
        durationMs: 14,
        summary: '工作区目录正常',
      },
      {
        name: '健康快照写入',
        status: 'failed',
        startedAt: ts,
        endedAt: ts,
        durationMs: 8,
        summary: '示例告警',
        error: '模拟步骤错误',
      },
    ],
    sourceRequests: 4,
    usage: { requests: 1, inputTokens: 120, outputTokens: 45, unknownUsageCount: 0 },
    artifacts: { rawIds: ['raw-1'], jobIds: ['job-1'], draftIds: ['draft-1'], weeklyReviewWeekKey: '2026-W46' },
    budget: null,
  };
  const runCand: AutomationRun = {
    id: 'run-cand-1',
    type: 'pipeline.organize',
    trigger: 'manual',
    scheduledAt: ts,
    startedAt: ts,
    endedAt: ts,
    status: 'succeeded',
    candidateId: `${day}/fmcg/c1`,
    steps: [
      { name: '整理入库', status: 'succeeded', startedAt: ts, endedAt: ts, durationMs: 25, summary: '已生成草稿' },
    ],
    usage: { requests: 1, inputTokens: 80, outputTokens: 30, unknownUsageCount: 0 },
    artifacts: { rawIds: ['raw-2'], jobIds: [], draftIds: ['draft-2'] },
    budget: null,
  };

  const healthPayload: KnowledgeHealth = {
    lint: null,
    inspection: null,
    issues: [],
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1/');
    const path = url.pathname;
    if (path === '/api/automation/status') return json(baseStatus());
    if (path === '/api/automation/schedules') return json({ items: makeSchedules(true, false) });
    if (path === '/api/automation/knowledge-health') return json(healthPayload);
    if (path === '/api/automation/candidates') {
      return json({
        date: day,
        dates: [day],
        items: [
          makeCandidate('c1', '关联运行候选', {
            relevance: 3,
            phase: 'draft_ready',
            draftPending: true,
            runId: 'run-cand-1',
          }),
        ],
        counts: { fetched: 1, pending: 0, organizing: 0, drafts: 1, failed: 0 },
      } satisfies CandidateList);
    }
    if (path === '/api/automation/pipeline/settings') {
      return json({ revision: 1, preScreenEnabled: true, topics: [], concurrency: 2 });
    }
    if (path === '/api/automation/runs') return json({ items: [runSelf, runCand] });
    if (path === '/api/automation/runs/run-self-1') return json(runSelf);
    if (path === '/api/automation/runs/run-cand-1') return json(runCand);
    assert.fail(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        createElement(AutomationPage, {
          onOpenRaw: () => {},
          onOpenDraft: () => {},
        }),
      );
      await tick(0);
    });
    await waitFor(() => document.querySelectorAll('.automation-workflow-card').length === 2, '等待流程卡');

    // 1. 在「流程与计划」点击「最近结果」弹出右侧 RunDetailDrawer
    const selfCard = document.querySelector('[aria-label="工作台自检"]')!;
    const lastRunBtn = selfCard.querySelector<HTMLButtonElement>('dd button')!;
    lastRunBtn.focus();
    await click(lastRunBtn);

    const drawer = document.querySelector<HTMLElement>('aside.automation-drawer[role="dialog"][aria-modal="true"]')!;
    assert.ok(drawer);
    assert.ok(document.querySelector('.automation-drawer-backdrop'));
    assert.equal(document.activeElement, document.querySelector('#automation-run-detail'));
    assert.equal(document.querySelectorAll('#automation-run-detail').length, 1);

    // 验证 Stepper、用量网格、产物芯片
    const stepItems = [...drawer.querySelectorAll<HTMLElement>('.automation-stepper .automation-stepper-item')];
    assert.equal(stepItems.length, 2);
    assert.equal(stepItems[0]!.dataset.tone, 'ok');
    assert.equal(stepItems[1]!.dataset.tone, 'danger');
    assert.match(drawer.querySelector('.automation-usage-grid')?.textContent ?? '', /来源 HTTP 请求.*4/);
    assert.equal(drawer.querySelectorAll('.automation-artifact-chips .automation-artifact-chip').length, 4);

    // 抽屉内 Tab / Shift+Tab 焦点循环 & Escape 关闭恢复焦点
    await pressKey(drawer, 'Tab', true);
    const drawerFocusable = [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
    assert.equal(document.activeElement, drawerFocusable.at(-1));
    await pressKey(drawer, 'Tab', false);
    assert.equal(document.activeElement, drawerFocusable[0]);

    await pressKey(drawer, 'Escape');
    assert.equal(document.querySelector('.automation-drawer'), null);
    assert.equal(document.querySelector('#automation-run-detail'), null);
    assert.equal(document.activeElement, lastRunBtn);

    // 2. 在收件箱点击「查看运行」打开抽屉 -> 点击「在运行记录中查看」无缝切入 Tab 3 主从视图
    await click(findButton('待处理收件箱'));
    await waitFor(() => document.querySelector('#news-candidates'), '等待收件箱');
    await click(findButton('查看运行', document.querySelector('#news-candidates')!));
    const drawer2 = document.querySelector('aside.automation-drawer')!;
    assert.ok(drawer2);
    await click(findButton('在运行记录中查看', drawer2));

    assert.equal(document.querySelector('#automation-tab-runs')?.getAttribute('aria-selected'), 'true');
    assert.equal(document.querySelector('aside.automation-drawer'), null);
    assert.equal(document.querySelectorAll('#automation-run-detail').length, 1);
    assert.ok(document.querySelector('.automation-runs-layout .automation-run-detail-panel'));
    assert.ok(document.querySelector('.automation-runs-list li.is-selected'));
    assert.equal(document.activeElement, document.querySelector('#automation-run-detail'));

    // 3. 在 Tab 3 点击「关闭详情」恢复占位卡片，DOM 中无 #automation-run-detail 且焦点安全连接
    await click(findButton('关闭详情'));
    assert.equal(document.querySelector('#automation-run-detail'), null);
    assert.ok(document.querySelector('.automation-run-placeholder'));
    assert.equal(document.activeElement?.isConnected, true);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});
