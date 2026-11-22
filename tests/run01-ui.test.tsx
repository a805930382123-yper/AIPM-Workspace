import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { AutomationRun, AutomationSchedule, AutomationStatus } from '../services/automation/types';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/', pretendToBeVisual: true });
const browser = dom.window;
for (const [name, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Event: browser.Event,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AutomationPage } = await import('../app/pages/AutomationPage');
const { HomePage } = await import('../app/pages/HomePage');

const due = '2026-11-15T02:00:00.000Z';
const status: AutomationStatus = {
  paused: false,
  scheduler: { healthy: true, lastTickAt: due },
  instance: { pid: 42, port: 16431, mode: 'production', startedAt: due, hostname: 'fixture' },
  nextRunAt: due,
  failuresLast24Hours: 3,
  writeToken: 'fixture-automation-token',
};
const task: AutomationSchedule = {
  type: 'system.selfcheck',
  name: '系统自检',
  enabled: true,
  plan: { kind: 'interval', minutes: 60 },
  catchUp: false,
  revision: 1,
  budget: null,
  nextRunAt: due,
  lastRun: null,
  mayCallModel: false,
  allowsCatchUp: true,
};
const running: AutomationRun = {
  id: 'run1',
  type: task.type,
  trigger: 'manual',
  scheduledAt: due,
  startedAt: due,
  endedAt: null,
  status: 'running',
  steps: [
    { name: '数据目录', status: 'running', startedAt: due, endedAt: null, durationMs: null, summary: '正在检查' },
  ],
  usage: { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 },
  artifacts: { rawIds: [], jobIds: [], draftIds: [] },
  budget: null,
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find((item) => item.textContent === label);
  assert.ok(found, `Button ${label} should exist`);
  return found;
};
const click = (label: string) => act(async () => button(label).click());
const waitFor = async (check: () => unknown) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.fail('Expected UI state did not appear');
};
const hasText = (value: string) => document.body.textContent?.includes(value) ?? false;
const changeInput = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new browser.Event('input', { bubbles: true }));
  });

test('RUN01 UI confirms pauses, retains edits on revision conflict, filters and cancels an active run', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.querySelector('#root')!);
  const writes: Array<{ path: string; body: unknown }> = [];
  const readQueries: string[] = [];
  let service = status;
  let schedule = task;
  let active: AutomationRun | null = null;
  globalThis.fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(String(url), 'http://fixture/');
    const path = pathname.replace('/api/automation', '');
    if (init?.method) {
      assert.equal(new Headers(init.headers).get('X-FMCG-Automation-Token'), status.writeToken);
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path === '/pause' || path === '/resume') {
        service = { ...service, paused: path === '/pause' };
        return json(service);
      }
      if (path === `/schedules/${task.type}`) {
        if (schedule.revision === 1) {
          schedule = { ...schedule, revision: 2, plan: { kind: 'interval', minutes: 35 } };
          return json({ error: { code: 'REVISION_CONFLICT', message: '计划已更改' } }, 409);
        }
        schedule = { ...schedule, ...body, revision: 3 };
        return json(schedule);
      }
      if (path === `/tasks/${task.type}/run`) {
        active = running;
        return json(active, 202);
      }
      if (path === '/runs/run1/cancel') {
        active = {
          ...running,
          status: 'cancelled',
          endedAt: due,
          steps: [{ ...running.steps[0], status: 'cancelled' }],
        };
        return json(active);
      }
    }
    if (path === '/status') return json(service);
    if (path === '/schedules') return json({ items: [schedule] });
    if (path === '/runs/run1') return json(active);
    if (path === '/runs') {
      readQueries.push(String(searchParams));
      const filter = searchParams.get('status');
      return json({ items: active && (!filter || active.status === filter) ? [active] : [] });
    }
    assert.fail(`Unexpected request to ${url}`);
  };

  try {
    await act(async () => root.render(createElement(AutomationPage, { onOpenRaw: () => {}, onOpenDraft: () => {} })));
    await waitFor(() => hasText('系统自检'));
    await click('暂停全部自动化');
    assert.equal(writes.length, 0);
    await click('取消');
    assert.equal(writes.length, 0);
    await click('暂停全部自动化');
    await click('确认暂停');
    await click('恢复全部自动化');
    await click('确认恢复');
    assert.deepEqual(writes.slice(0, 2), [
      { path: '/pause', body: { confirm: true } },
      { path: '/resume', body: { confirm: true } },
    ]);

    await click('编辑计划');
    const minutes = document.querySelector<HTMLInputElement>('input[type=number]')!;
    await changeInput(minutes, '5');
    await click('保存计划');
    assert.deepEqual(writes.at(-1)?.body, {
      revision: 1,
      enabled: true,
      catchUp: false,
      plan: { kind: 'interval', minutes: 5 },
    });
    assert.equal(minutes.value, '5');
    assert.ok(hasText('你的输入已保留'));
    await click('读取最新版本');
    assert.equal(minutes.value, '35');
    await changeInput(minutes, '2');
    await click('保存计划');
    assert.deepEqual(writes.at(-1)?.body, {
      revision: 2,
      enabled: true,
      catchUp: false,
      plan: { kind: 'interval', minutes: 2 },
    });
    await waitFor(() => hasText('每 2 分钟'));

    await click('立即运行');
    assert.ok(hasText('运行详情'));
    assert.ok(hasText('数据目录'));
    assert.ok(hasText('用量未知的请求'));
    await click('取消运行');
    assert.equal(writes.at(-1)?.path, '/runs/run1/cancel');
    await click('关闭详情');
    await click('运行记录');
    const filter = [...document.querySelectorAll('select')].find((item) =>
      item.parentElement?.textContent?.startsWith('运行状态'),
    )!;
    await act(async () => {
      filter.value = 'cancelled';
      filter.dispatchEvent(new browser.Event('change', { bubbles: true }));
    });
    assert.ok(readQueries.includes('limit=50&status=cancelled'));
    await click('查看详情');
    assert.ok(document.querySelector('[aria-labelledby=automation-run-detail]')?.textContent?.includes('已取消'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test('RUN01 home card reads failure count and next run in Shanghai and navigates to automation', async () => {
  const nativeFetch = globalThis.fetch;
  const root = createRoot(document.querySelector('#root')!);
  let opened = 0;
  globalThis.fetch = async (url) =>
    String(url).endsWith('/automation/status') ? json(status) : json({ items: [], sources: {} });
  const noop = () => {};
  try {
    await act(async () =>
      root.render(
        createElement(HomePage, {
          stats: {
            rawCount: 0,
            wikiCount: 0,
            thisWeekNewCount: 0,
            pendingConfirmationCount: 0,
            openAuditCount: 0,
            promptCount: 0,
            weekStartsOn: '',
          },
          items: [],
          onOpenRaw: noop,
          onOpenWiki: noop,
          onOpenPrompt: noop,
          onImport: noop,
          onCreateWiki: noop,
          onCreatePrompt: noop,
          onGeneratePrompt: noop,
          onLint: noop,
          onOpenAutomation: () => {
            opened += 1;
          },
        }),
      ),
    );
    assert.ok(hasText('3 次'));
    assert.ok(hasText('10:00'));
    await click('查看自动化 ›');
    assert.equal(opened, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});
