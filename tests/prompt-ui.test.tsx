// B07 (E07-11 UI 部分): the Prompt Library page driven through a real DOM in jsdom.
// Only `fetch` and the clipboard are stubbed; the same endpoints are exercised over real HTTP by
// tests/b07-prompt-http.mjs. A stubbed clipboard is NOT real-browser evidence for E07-06.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Prompt, PromptInput, PromptVersion } from '../app/api';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
  Event: window.Event, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
  Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PromptLibraryPage } = await import('../app/pages/PromptLibraryPage.tsx');
const { renderTemplate } = await import('../services/prompt/variables.ts');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: A, name: '模板甲', category: 'customer', scenario: '用浏览器整理资料', body: '请总结 {{甲变量}}。',
    variables: ['甲变量'], inputRequirements: '输入要求甲', outputRequirements: '输出要求甲',
    relatedWikiIds: [], examples: '', tags: ['甲'], favorite: false,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', version: 1, source: 'manual',
    ...overrides,
  };
}
const promptA = makePrompt();
const promptB = makePrompt({
  id: B, name: '模板乙', category: 'office', scenario: '场景乙', body: '没有变量的正文。', variables: [],
  inputRequirements: '', outputRequirements: '', tags: [], version: 3,
});

const versionOf = (prompt: Prompt): PromptVersion => ({ version: prompt.version, savedAt: prompt.updatedAt, changeSource: 'manual', snapshot: prompt });
// 甲: one version. 乙: two versions with distinct names and bodies, so a history response that crossed
// into the wrong template would be visible as another name/body rather than as an empty pane.
const versionHistory: Record<string, PromptVersion[]> = {
  [A]: [versionOf(promptA)],
  [B]: [
    { ...versionOf(promptB), version: 2, savedAt: '2026-10-02T00:00:00.000Z', changeSource: 'ai_optimized', snapshot: { ...promptB, version: 2, name: '模板乙（旧版）', body: '乙的旧版正文。' } },
    versionOf(promptB),
  ],
};
const reply = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data),
}) as unknown as Response;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async (ms = 140) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };
const byText = (text: string, root: ParentNode = window.document) =>
  [...root.querySelectorAll('button')].find(button => (button.textContent ?? '').includes(text)) as HTMLButtonElement | undefined;
const required = <T,>(value: T | null | undefined, what = '目标元素'): T => { assert.ok(value, `找不到${what}`); return value; };
async function click(target: HTMLElement) {
  await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(); });
}
async function type(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = target instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  assert.ok(setter, 'value setter');
  await act(async () => { setter.call(target, value); target.dispatchEvent(new window.Event('input', { bubbles: true })); await tick(); });
}
async function submit() {
  const form = required(window.document.querySelector('form') as HTMLFormElement | null, '编辑表单');
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick(); });
}
async function mount() {
  const container = window.document.getElementById('root') as HTMLElement;
  const root = createRoot(container);
  await act(async () => { root.render(<PromptLibraryPage onChanged={() => undefined} onOpenWiki={() => undefined} />); await tick(); });
  return { root, unmount: async () => { await act(async () => { root.unmount(); }); } };
}

const listNames = () => [...window.document.querySelectorAll('.prompt-list-item b')].map(node => (node.textContent ?? '').trim());
/** Code-unit sort puts 乙 before 甲, so both sides are sorted with the same comparator. */
const bothNames = () => ['模板甲', '模板乙'].sort();
const versionRow = (text: string) =>
  [...window.document.querySelectorAll('.prompt-version-row')].find(row => (row.textContent ?? '').includes(text)) as HTMLElement | undefined;
const searchBox = () => required(window.document.querySelector('input[aria-label="搜索 Prompt"]') as HTMLInputElement | null, '搜索框');
const variableField = () => required(window.document.querySelector('.prompt-fields input') as HTMLInputElement | null, '变量输入');
const renderedBody = () => window.document.querySelector('[data-testid="prompt-final"]');
const detailTitle = () => required(window.document.querySelector('.prompt-detail h2'), '详情标题').textContent ?? '';
const isEnabled = (text: string) => !required(byText(text), `${text}按钮`).disabled;
/** Clicks a text button whatever its disabled state; jsdom+React drop clicks on disabled buttons. */
const clickIfEnabled = async (text: string) => { const button = required(byText(text), `${text}按钮`); if (!button.disabled) await click(button); };

type Call = { url: string; method: string; body: unknown; status: number };
/**
 * A controlled-ordering gate: every request matching `test` hangs until `release(gate)` is called, so a
 * test can deliver a *real* response (same body, same status) long after the user has moved on. This is
 * what the acceptance run used to reproduce F07-02…F07-06 in the browser.
 */
type Gate = { test: (url: string, method: string) => boolean; waiting: Array<() => void> };
type Harness = {
  calls: Call[];
  writeText: (value: string) => Promise<void>;
  clipboard: string[];
  /** Detail responses for these ids hang until `release(id)` is called. */
  hold: Set<string>;
  releases: Map<string, () => void>;
  failures: Map<string, { status: number; code: string; message: string }>;
  gate: (test: (url: string, method: string) => boolean) => Gate;
  release: (gate: Gate) => void;
  waiting: (gate: Gate) => number;
};
function stubFetch(): Harness {
  const gates: Gate[] = [];
  const harness: Harness = {
    calls: [], clipboard: [], hold: new Set(), releases: new Map(), failures: new Map(),
    writeText: async () => undefined,
    gate: test => { const entry: Gate = { test, waiting: [] }; gates.push(entry); return entry; },
    release: target => { const next = target.waiting.shift(); assert.ok(next, '没有等待中的请求可以释放'); next(); },
    waiting: target => target.waiting.length,
  };
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => { harness.clipboard.push(value); return harness.writeText(value); } },
  });
  // Records the create stub has really committed, so a "saved but ignored by the UI" record still
  // shows up in the list exactly like it does on the server.
  const extra: Prompt[] = [];
  const createSessions = new Map<string, string>();
  const items = () => [promptA, promptB, ...extra];
  const fail = (url: string) => {
    const rule = [...harness.failures.entries()].find(([key]) => url === key);
    if (!rule) return undefined;
    const [, value] = rule;
    return value;
  };
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    const forced = fail(url);
    harness.calls.push({ url, method, body, status: forced?.status ?? 200 });
    // A gated request still runs the real stub logic below — it is only delayed, never replaced.
    // The most recently registered matching gate wins, so a test can re-arm the same URL later.
    let gate: Gate | undefined;
    for (const entry of gates) if (entry.test(url, method)) gate = entry;
    if (gate) await new Promise<void>(resolve => { gate.waiting.push(resolve); });
    if (forced) return reply({ error: { code: forced.code, message: forced.message } }, forced.status);
    if (url === '/api/prompts/schema') return reply({ categories: [
      { id: 'industry_learning', label: '行业学习' }, { id: 'business_analysis', label: '业务分析' },
      { id: 'customer', label: '客户' }, { id: 'product', label: '产品' }, { id: 'ai', label: 'AI' }, { id: 'office', label: '日常办公' },
    ] });
    if (url === '/api/wiki') return reply({ items: [] });
    if (method === 'GET' && /^\/api\/prompts\/[^/]+\/feedback\?version=\d+$/.test(url)) return reply({ items: [] });
    // GET only: a POST to the same path is a create, handled further down. Without the method guard
    // the list branch swallowed creates and answered them with a list payload.
    if (method === 'GET' && (url.startsWith('/api/prompts?') || url === '/api/prompts')) {
      const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
      const category = query.get('category');
      const tag = query.get('tag');
      const favorite = query.get('favorite');
      const q = query.get('q');
      const list = items().filter(item =>
        (!category || item.category === category)
        && (!tag || item.tags.includes(tag))
        && (favorite !== 'true' || item.favorite)
        // Same searchable fields as the server (name, tags, body, scenario, category label).
        && (!q || [item.name, ...item.tags, item.body, item.scenario].some(field => field.includes(q))));
      return reply({ items: list, categoryCounts: { industry_learning: 0, business_analysis: 0, customer: 1, product: 0, ai: 0, office: 1 } });
    }
    const detail = /^\/api\/prompts\/([0-9a-f-]{36})$/.exec(url);
    if (detail && method === 'GET') {
      const id = detail[1];
      const send = () => reply({ prompt: id === A ? promptA : promptB, wikiLinks: [] });
      if (harness.hold.has(id)) return await new Promise<Response>(resolve => harness.releases.set(id, () => resolve(send())));
      return send();
    }
    const render = /^\/api\/prompts\/([0-9a-f-]{36})\/render$/.exec(url);
    if (render && method === 'POST') {
      const target = render[1] === A ? promptA : promptB;
      const values = (body as { values: Record<string, string> }).values ?? {};
      // The real server-side rule, reused here so the stub cannot invent a friendlier behaviour.
      const result = renderTemplate(target.body, values);
      if (result.missingVariables.length) return reply({ error: { code: 'MISSING_VARIABLES', message: `还有未填写的变量：${result.missingVariables.join('、')}。`, details: { missingVariables: result.missingVariables } } }, 422);
      return reply({ id: target.id, version: target.version, body: result.body, missingVariables: [] });
    }
    const versions = /^\/api\/prompts\/([0-9a-f-]{36})\/versions$/.exec(url);
    if (versions) return reply({ items: versionHistory[versions[1]] ?? [] });
    const one = /^\/api\/prompts\/([0-9a-f-]{36})\/versions\/(\d+)$/.exec(url);
    if (one) {
      const found = (versionHistory[one[1]] ?? []).find(item => item.version === Number(one[2]));
      if (found) return reply({ version: found });
      return reply({ error: { code: 'NOT_FOUND', message: `这条 Prompt 没有第 ${one[2]} 版。` } }, 404);
    }
    if (url === '/api/prompts' && method === 'POST') {
      // The real server uses the client's requestId as the record id and dedupes retries by it:
      // same payload → `reused`, different payload → 409 REQUEST_ID_CONFLICT. Modelling that here is
      // what makes a reused requestId visible instead of silently succeeding.
      const payload = body as Record<string, unknown>;
      const requestId = String(payload.requestId);
      const { requestId: _requestId, ...rest } = payload;
      const input = rest as unknown as PromptInput;
      const claimed = createSessions.get(requestId);
      if (claimed !== undefined) {
        if (claimed === JSON.stringify(input)) return reply({ prompt: { ...promptA, ...input, id: requestId }, reused: true });
        return reply({ error: { code: 'REQUEST_ID_CONFLICT', message: `同一个 requestId 已用于另一组初始内容，本次未写入；请重新发起一次新建。`, details: { id: requestId } } }, 409);
      }
      createSessions.set(requestId, JSON.stringify(input));
      const saved: Prompt = { ...promptA, ...input, id: requestId };
      extra.push(saved);
      return reply({ prompt: saved, reused: false }, 201);
    }
    if (method === 'PUT') return reply({ prompt: { ...(url.includes(A) ? promptA : promptB), ...body, version: 2 } });
    if (method === 'DELETE') return reply({ id: url.split('/').pop(), deleted: true });
    return reply({ error: { code: 'NOT_FOUND', message: `unstubbed ${method} ${url}` } }, 404);
  }) as unknown as typeof fetch;
  return harness;
}

test('B07 UI：切换模板时身份、变量、预览与消息互不串页，迟到的旧响应不会覆盖当前选择', async () => {
  const harness = stubFetch();
  harness.hold.add(A); // the first detail read for 甲 never resolves until we say so
  const { unmount } = await mount();
  try {
    await settle();
    // 甲 is auto-selected even though its detail is still in flight
    assert.ok(required(window.document.querySelector('.prompt-list-item.selected')).textContent?.includes('模板甲'));
    assert.equal(window.document.querySelector('.prompt-detail'), null, '详情还没返回时不应显示别的记录');

    // switch to 乙 and fill something in
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    assert.ok(required(window.document.querySelector('.prompt-detail h2')).textContent?.includes('模板乙'));
    assert.equal(window.document.querySelectorAll('.prompt-fields input').length, 0, '乙没有变量');

    // now the stale 甲 detail arrives: it must be dropped
    harness.hold.delete(A);
    harness.releases.get(A)?.();
    await settle(60);
    assert.ok(required(window.document.querySelector('.prompt-detail h2')).textContent?.includes('模板乙'), '迟到的旧详情不得覆盖当前选择');

    // back to 甲: variables are empty again (nothing leaked from the previous visit)
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(40);
    const fields = [...window.document.querySelectorAll('.prompt-fields input')] as HTMLInputElement[];
    assert.deepEqual(fields.map(field => field.value), [''], '换回来时变量是空的');
    assert.equal(window.document.querySelector('[data-testid="prompt-final"]'), null, '没有预览残留');
    await type(fields[0], '华东商超');
    assert.equal((window.document.querySelector('.prompt-fields input') as HTMLInputElement).value, '华东商超');
    // switching away and back clears it again
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(40);
    assert.equal((window.document.querySelector('.prompt-fields input') as HTMLInputElement).value, '');
  } finally { await unmount(); }
});

test('B07 UI：未填变量时不能复制、不出现成功提示，剪贴板失败时给出可手动选择的最终正文', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    // 未填变量：复制按钮禁用，剪贴板一次都没被调用
    const copy = required(byText('复制最终正文'), '复制按钮');
    assert.equal(copy.disabled, true, '没有生成最终正文时不能复制');
    await click(copy);
    assert.deepEqual(harness.clipboard, [], '未填变量时不得调用剪贴板');
    assert.equal(window.document.querySelector('.prompt-copy-ok'), null, '不得出现复制成功提示');
    assert.ok(required(window.document.querySelector('.prompt-missing-note')).textContent?.includes('甲变量'));

    // 填写后生成
    const field = required(window.document.querySelector('.prompt-fields input')) as HTMLInputElement;
    await type(field, '华东商超');
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(30);
    const final = required(window.document.querySelector('[data-testid="prompt-final"]'));
    assert.equal(final.textContent, '请总结 华东商超。');

    // 剪贴板失败：显示失败原因 + 可手动选取的文本，绝不显示成功
    harness.writeText = async () => { throw new Error('浏览器拒绝了剪贴板写入'); };
    await click(required(byText('复制最终正文'), '复制按钮'));
    await settle(30);
    assert.equal(window.document.querySelector('.prompt-copy-ok'), null, '失败时不得显示成功提示');
    const alert = required(window.document.querySelector('.prompt-copy-failed'), '复制失败提示');
    assert.ok(alert.textContent?.includes('复制失败'));
    const fallback = required(alert.querySelector('textarea')) as HTMLTextAreaElement;
    assert.equal(fallback.value, '请总结 华东商超。');
    assert.equal(fallback.readOnly, true);

    // 剪贴板成功：先真实调用 writeText，成功后才提示
    harness.writeText = async () => undefined;
    const attemptsBefore = harness.clipboard.length;
    const mutationsBefore = harness.calls.filter(call => call.method === 'PUT' || call.method === 'POST').length;
    await click(required(byText('复制最终正文'), '复制按钮'));
    await settle(30);
    assert.deepEqual(harness.clipboard.slice(attemptsBefore), ['请总结 华东商超。'], '复制的是这一次生成的最终正文');
    assert.ok(required(window.document.querySelector('.prompt-copy-ok')).textContent?.includes('已复制'));
    // 复制不改变模板：不产生任何新的写请求
    assert.equal(harness.calls.filter(call => call.method === 'PUT' || call.method === 'POST').length, mutationsBefore, '复制不得写入任何内容');
    assert.ok(required(window.document.querySelector('.prompt-detail h2')).textContent?.includes('模板甲'));
  } finally { await unmount(); }
});

test('B07 UI：无变量模板可直接复制；查看历史版本为只读，且不请求当前版本的渲染', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    harness.writeText = async () => undefined;
    await click(required(byText('复制最终正文'), '复制按钮'));
    await settle(20);
    assert.deepEqual(harness.clipboard, ['没有变量的正文。'], '没有变量时直接复制模板正文');
    assert.ok(required(window.document.querySelector('.prompt-copy-ok')).textContent?.includes('已复制'));

    // 历史版本：只读横幅、没有变量输入、没有渲染请求
    const before = harness.calls.filter(call => call.url.endsWith('/render')).length;
    const versionRow = [...window.document.querySelectorAll('.prompt-version-row')].find(row => (row.textContent ?? '').includes('第 3 版'));
    await click(required(versionRow as HTMLElement | undefined, '版本历史行'));
    await settle(30);
    const banner = required(window.document.querySelector('.history-banner'));
    assert.ok(banner.textContent?.includes('正在查看第 3 版'), '必须明确当前查看的是哪一版');
    assert.equal(window.document.querySelector('.prompt-fields'), null, '历史版本只读，不提供变量填写');
    assert.equal(byText('生成最终正文'), undefined);
    assert.equal(harness.calls.filter(call => call.url.endsWith('/render')).length, before, '查看旧版不得调用当前版本的渲染');
    // 返回当前版本
    await click(required(byText('返回当前版本'), '返回按钮'));
    await settle(30);
    assert.equal(window.document.querySelector('.history-banner'), null);
    assert.ok(required(window.document.querySelector('.prompt-detail h2')).textContent?.includes('模板乙'));
  } finally { await unmount(); }
});

test('B07 UI：保存冲突时保留用户输入并提示刷新；删除必须二次确认目标', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    // 编辑并触发 409
    await click(required(byText('编辑'), '编辑按钮'));
    await settle(20);
    const nameField = required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement;
    await type(nameField, '我改过的名字');
    harness.failures.set(`/api/prompts/${A}`, { status: 409, code: 'VERSION_CONFLICT', message: '这条 Prompt 已经被保存为第 2 版，请刷新后重新编辑；你刚才的输入没有被覆盖。' });
    await submit();
    await settle(30);
    const message = required(window.document.querySelector('.error-message'));
    assert.ok(message.textContent?.includes('第 2 版'));
    assert.equal((required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement).value, '我改过的名字', '冲突后用户输入必须保留');
    harness.failures.clear();

    // 删除确认
    await click(required(byText('取消'), '取消按钮'));
    await settle(20);
    await click(required(byText('删除'), '删除按钮'));
    await settle(20);
    const dialog = required(window.document.querySelector('[role="dialog"]'));
    assert.ok(dialog.textContent?.includes('模板甲'), '删除对话框必须显示目标名称');
    assert.equal(harness.calls.filter(call => call.method === 'DELETE').length, 0, '确认之前不得删除');
    await click(required(byText('确认删除'), '确认删除'));
    await settle(30);
    const deleted = harness.calls.filter(call => call.method === 'DELETE');
    assert.deepEqual(deleted.map(call => call.url), [`/api/prompts/${A}`]);
    assert.deepEqual((deleted[0].body as { baseVersion: number }).baseVersion, 1);
  } finally { await unmount(); }
});

test('B07/B08 UI：Generator 与 Optimizer 入口已开放，Library 新建仍走 requestId 且只提交可编辑字段', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    const navigation = required(window.document.querySelector('nav[aria-label="Prompt 工作台功能"]'), '工作台导航');
    const aiActions = [...navigation.querySelectorAll('button')];
    assert.deepEqual(aiActions.map(button => button.textContent?.trim()), ['模板库','生成','优化']);
    assert.equal(aiActions[0].getAttribute('aria-current'), 'page');
    assert.ok(aiActions.every(button => !button.disabled), 'B08 入口已开放');

    await click(required(byText('手动新建'), '新建按钮'));
    await settle(20);
    const form = required(window.document.querySelector('.prompt-editor'), '编辑器');
    const inputs = [...form.querySelectorAll('input')] as HTMLInputElement[];
    await type(required(inputs.find(input => input.getAttribute('placeholder')?.includes('经销商访谈提纲')) as HTMLInputElement, '名称输入'), '新的模板');
    await type(required(form.querySelector('.prompt-body-field textarea') as HTMLTextAreaElement | null, '正文输入'), '请处理 {{输入项}}。');
    assert.ok(required(window.document.querySelector('.field-hint')).textContent?.includes('{{输入项}}'), '编辑器实时显示识别到的变量');
    await submit();
    await settle(40);
    const created = harness.calls.find(call => call.method === 'POST');
    assert.ok(created, '必须发出创建请求');
    const payload = created.body as Record<string, unknown>;
    assert.match(String(payload.requestId), /^[0-9a-f-]{36}$/, 'requestId 必须是 UUID');
    assert.deepEqual(Object.keys(payload).sort(), ['body', 'category', 'examples', 'favorite', 'inputRequirements', 'name', 'outputRequirements', 'relatedWikiIds', 'requestId', 'scenario', 'tags'].sort(), '只能提交可编辑字段与 requestId');
    assert.equal(payload.variables, undefined, '变量由服务端提取');
    assert.equal(payload.version, undefined);
  } finally { await unmount(); }
});

// ------------------------------------------------------------------------------------------------
// B07 返修：F07-02…F07-06。Each test reproduces the acceptance defect with controlled async order:
// the real stub response is held and delivered after the user has already moved on.
// ------------------------------------------------------------------------------------------------

test('返修 F07-02：变量改动后旧渲染结果不能再作为本次结果复制', async () => {
  const harness = stubFetch();
  harness.writeText = async () => undefined;
  const { unmount } = await mount();
  try {
    await settle();
    await type(variableField(), '华东 $& $1 {{业务流程}}');
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(30);
    const first = '请总结 华东 $& $1 {{业务流程}}。';
    assert.equal(required(renderedBody()).textContent, first, '字面 $&、$1 与 {{}} 必须原样保留');
    await click(required(byText('复制最终正文'), '复制按钮'));
    await settle(20);
    assert.deepEqual(harness.clipboard, [first]);

    // 改值：旧结果立即失效，既不能显示也不能复制
    const writesBefore = harness.clipboard.length;
    await type(variableField(), '华南新客户');
    assert.ok(renderedBody() === null, '改值后旧的本次最终正文必须消失');
    assert.equal(required(byText('复制最终正文'), '复制按钮').disabled, true, '改值后复制必须被禁用');
    await clickIfEnabled('复制最终正文');
    await settle(20);
    assert.deepEqual(harness.clipboard.slice(writesBefore), [], '不得把旧值写进剪贴板');
    assert.ok(window.document.querySelector('.prompt-copy-ok') === null, '不得提示复制成功');

    // 清空变量同样失效
    await type(variableField(), '');
    assert.equal(required(byText('复制最终正文'), '复制按钮').disabled, true, '清空变量后同样不能复制旧结果');

    // 重新生成后实际复制到的是最新值
    await type(variableField(), '华南新客户');
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(30);
    assert.equal(required(renderedBody()).textContent, '请总结 华南新客户。');
    await click(required(byText('复制最终正文'), '复制按钮'));
    await settle(20);
    assert.deepEqual(harness.clipboard.slice(writesBefore), ['请总结 华南新客户。'], '重新生成后必须复制最新值');

    // render 期间改值：旧响应不得重新变成可复制结果
    const gate = harness.gate((url, method) => method === 'POST' && url.endsWith('/render'));
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(20);
    assert.equal(harness.waiting(gate), 1, 'render 请求仍在途中');
    await type(variableField(), '华北客户');
    harness.release(gate);
    await settle(30);
    assert.ok(renderedBody() === null, '请求途中改值后，旧响应的正文不得成为可复制结果');
    assert.equal(required(byText('复制最终正文'), '复制按钮').disabled, true);

    // 模板与版本不因填值/生成/复制而改变
    assert.deepEqual(harness.calls.filter(call => call.method === 'PUT' || (call.method === 'POST' && !call.url.endsWith('/render'))), [],
      '填值、生成与复制不得产生任何写请求');
    assert.ok(detailTitle().includes('模板甲'));
  } finally { await unmount(); }
});

test('返修 F07-03：延迟的历史版本响应不串页，也不覆盖新选择', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    // 乙有两版
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    assert.equal(detailTitle(), '模板乙');
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 2, '乙必须有两版可点');

    // 甲 ← 乙 方向：延迟乙第 2 版，切到甲后释放
    const toA = harness.gate((url, method) => method === 'GET' && url === `/api/prompts/${B}/versions/2`);
    await click(required(versionRow('第 2 版'), '乙第 2 版'));
    await settle(20);
    assert.equal(harness.waiting(toA), 1);
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(40);
    assert.equal(detailTitle(), '模板甲');
    harness.release(toA);
    await settle(40);
    assert.ok(window.document.querySelector('.history-banner') === null, '迟到的历史响应不得打开历史视图');
    assert.equal(detailTitle(), '模板甲', '左侧选中甲时右侧必须还是甲');
    assert.ok(!(window.document.querySelector('.prompt-detail')?.textContent ?? '').includes('乙的旧版正文'), '不得串入乙的正文');
    assert.ok(window.document.querySelector('.prompt-detail-panel .error-message') === null, '成功响应不得带出错误');

    // 同一模板连续点两版：先点的迟到响应不得替换后点的
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    const two = harness.gate((url, method) => method === 'GET' && url === `/api/prompts/${B}/versions/2`);
    await click(required(versionRow('第 2 版'), '乙第 2 版'));
    await settle(20);
    assert.equal(harness.waiting(two), 1);
    await click(required(versionRow('第 3 版'), '乙第 3 版'));
    await settle(30);
    assert.ok(required(window.document.querySelector('.history-banner')).textContent?.includes('正在查看第 3 版'));
    harness.release(two);
    await settle(30);
    assert.ok(required(window.document.querySelector('.history-banner')).textContent?.includes('正在查看第 3 版'), '迟到的第 2 版不得替换已显示的第 3 版');
    assert.ok(!(window.document.querySelector('.prompt-detail')?.textContent ?? '').includes('乙的旧版正文'));

    // 甲 ← 乙 方向的失败响应：迟到的错误不得显示在别的记录上
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(40);
    harness.failures.set(`/api/prompts/${A}/versions/1`, { status: 500, code: 'INTERNAL_ERROR', message: '这一版读取失败。' });
    const failing = harness.gate((url, method) => method === 'GET' && url === `/api/prompts/${A}/versions/1`);
    await click(required(versionRow('第 1 版'), '甲第 1 版'));
    await settle(20);
    assert.equal(harness.waiting(failing), 1);
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    harness.release(failing);
    await settle(40);
    assert.ok(window.document.querySelector('.error-message') === null, '被切走的历史失败不得显示在乙上');
    assert.equal(detailTitle(), '模板乙');
    harness.failures.clear();

    // 请求中新建：迟到响应不得关掉新建表单
    const creating = harness.gate((url, method) => method === 'GET' && url === `/api/prompts/${B}/versions/2`);
    await click(required(versionRow('第 2 版'), '乙第 2 版'));
    await settle(20);
    assert.equal(harness.waiting(creating), 1);
    await click(required(byText('手动新建'), '新建按钮'));
    await settle(20);
    assert.ok(required(window.document.querySelector('.prompt-editor'), '新建表单'));
    harness.release(creating);
    await settle(40);
    assert.ok(required(window.document.querySelector('.prompt-editor')), '迟到的历史响应不得关掉新建表单');
    assert.ok(window.document.querySelector('.history-banner') === null);
  } finally { await unmount(); }
});

test('返修 F07-04：迟到的 render 既不锁死新记录，也不误解锁新记录自己的请求', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    await type(variableField(), '华东');
    const renderGate = harness.gate((url, method) => method === 'POST' && url === `/api/prompts/${A}/render`);
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(20);
    assert.equal(harness.waiting(renderGate), 1, '甲的 render 仍在途中');

    // 生成途中切到乙：乙的操作必须立刻可用，不需要刷新
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(40);
    assert.equal(detailTitle(), '模板乙');
    assert.ok(isEnabled('收藏') && isEnabled('编辑') && isEnabled('删除'), '切换后乙的收藏/编辑/删除必须可用');

    // 乙自己的在途请求：迟到的旧响应不得把它解锁
    const putGate = harness.gate((url, method) => method === 'PUT' && url === `/api/prompts/${B}`);
    await click(required(byText('收藏'), '收藏按钮'));
    await settle(20);
    assert.equal(harness.waiting(putGate), 1);
    assert.equal(required(byText('编辑'), '编辑按钮').disabled, true, '乙自己的请求在途时应保持忙碌');
    harness.release(renderGate);
    await settle(40);
    assert.equal(required(byText('编辑'), '编辑按钮').disabled, true, '迟到的旧 finally 不得误解锁乙的在途操作');
    assert.equal(required(renderedBody()).textContent, '没有变量的正文。', '甲的迟到结果不得出现在乙身上');
    assert.ok(window.document.querySelector('.error-message') === null);

    harness.release(putGate);
    await settle(40);
    assert.equal(required(byText('编辑'), '编辑按钮').disabled, false, '自己的请求结束后必须恢复可用');
    harness.writeText = async () => undefined;
    await click(required(byText('复制最终正文'), '复制按钮'));
    await settle(20);
    assert.deepEqual(harness.clipboard, ['没有变量的正文。'], '乙仍能继续复制自己的正文');
  } finally { await unmount(); }
});

test('返修 F07-05：迟到的保存响应不得清空之后新建的表单', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    // 甲：编辑并提交，响应被扣住
    await click(required(byText('编辑'), '编辑按钮'));
    await settle(20);
    await type(required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement, '甲的新名字');
    const putGate = harness.gate((url, method) => method === 'PUT' && url === `/api/prompts/${A}`);
    await submit();
    await settle(20);
    assert.equal(harness.waiting(putGate), 1, '甲的 PUT 仍在途中');

    // 响应在途时开始新建人工内容
    await click(required(byText('手动新建'), '新建按钮'));
    await settle(20);
    const form = required(window.document.querySelector('.prompt-editor'), '新建编辑器');
    await type(required(form.querySelector('.prompt-editor input') as HTMLInputElement, '名称输入'), '新模板未保存内容');
    await type(required(form.querySelector('.prompt-body-field textarea') as HTMLTextAreaElement, '正文输入'), '新的正文 {{新变量}}。');

    harness.release(putGate);
    await settle(40);
    assert.equal((required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement).value, '新模板未保存内容', '人工输入必须保留');
    assert.equal((required(window.document.querySelector('.prompt-body-field textarea')) as HTMLTextAreaElement).value, '新的正文 {{新变量}}。');
    assert.ok(window.document.querySelector('.success-message') === null, '旧保存的提示不得串到新表单');
    assert.ok(window.document.querySelector('.error-message') === null);
    assert.equal(harness.calls.filter(call => call.method === 'PUT').length, 1, '已提交的旧操作不得重复提交');
    assert.ok(harness.calls.filter(call => call.method === 'GET' && call.url.startsWith('/api/prompts')).length >= 2, '列表统计仍然刷新');

    // 新表单继续可用，且用的是新的 requestId
    await submit();
    await settle(40);
    const posts = harness.calls.filter(call => call.method === 'POST');
    assert.equal(posts.length, 1, '只应发生一次创建请求');
    assert.equal((posts[0].body as { name: string }).name, '新模板未保存内容');
  } finally { await unmount(); }
});

test('返修 F07-05：迟到的冲突响应不得把错误串到新表单', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    await click(required(byText('编辑'), '编辑按钮'));
    await settle(20);
    const gate = harness.gate((url, method) => method === 'PUT' && url === `/api/prompts/${A}`);
    harness.failures.set(`/api/prompts/${A}`, { status: 409, code: 'VERSION_CONFLICT', message: '这条 Prompt 已经被保存为第 2 版，请刷新后重新编辑；你刚才的输入没有被覆盖。' });
    await submit();
    await settle(20);
    assert.equal(harness.waiting(gate), 1);

    await click(required(byText('手动新建'), '新建按钮'));
    await settle(20);
    await type(required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement, '另一个新模板');
    harness.release(gate);
    await settle(40);
    assert.ok(window.document.querySelector('.error-message') === null, '迟到的冲突提示不得显示在新表单上');
    assert.equal((required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement).value, '另一个新模板');
  } finally { await unmount(); }
});

test('返修 F07-06：迟到的旧查询响应不覆盖当前筛选，也不误清新建表单', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    assert.deepEqual(listNames().sort(), bothNames());

    // 延迟 q=B07模板乙 的真实响应，随后改成“浏览器”（只匹配甲）
    const stale = harness.gate((url, method) => method === 'GET' && url.includes('q=') && decodeURIComponent(url).includes('B07模板乙'));
    await type(searchBox(), 'B07模板乙');
    await settle(130);
    assert.equal(harness.waiting(stale), 1, '旧查询仍在途中');
    await type(searchBox(), '浏览器');
    await settle(150);
    assert.deepEqual(listNames(), ['模板甲'], '当前条件应显示甲');

    harness.release(stale);
    await settle(80);
    assert.equal(searchBox().value, '浏览器', '搜索框保持当前条件');
    assert.deepEqual(listNames(), ['模板甲'], '迟到的旧查询不得覆盖当前列表');

    // 清空查询恢复
    await click(required(window.document.querySelector('button[aria-label="清空搜索"]') as HTMLButtonElement | null, '清空搜索'));
    await settle(150);
    assert.deepEqual(listNames().sort(), bothNames());

    // 分类筛选的迟到响应同样不得覆盖最新条件
    const grid = window.document.querySelector('.category-grid') as ParentNode;
    const chip = (label: string) => required(byText(label, grid), `${label}分类`);
    const categoryGate = harness.gate((url, method) => method === 'GET' && url.includes('category=office'));
    await click(chip('日常办公'));
    await settle(130);
    assert.equal(harness.waiting(categoryGate), 1, '日常办公的响应仍在途中');
    await click(chip('客户'));
    await settle(150);
    assert.deepEqual(listNames(), ['模板甲'], '当前分类只应显示甲');
    harness.release(categoryGate);
    await settle(80);
    assert.deepEqual(listNames(), ['模板甲'], '迟到的分类响应不得覆盖当前分类');
    await click(chip('全部'));
    await settle(150);
    assert.deepEqual(listNames().sort(), bothNames());
    // 分类数量仍是全库真实有效计数（不随筛选变化）
    assert.ok(required(window.document.querySelector('.map-total')).textContent?.includes('2'), '分类总数是全库计数');
    assert.ok(chip('日常办公').textContent?.includes('1'), '分类计数不随筛选变化');

    // 连续筛选不得误清当前新建表单
    await click(required(byText('手动新建'), '新建按钮'));
    await settle(20);
    await type(required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement, '筛选期间的新模板');
    await type(searchBox(), '模板');
    await settle(150);
    assert.equal((required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement).value, '筛选期间的新模板', '筛选不得清掉新建表单');
    await type(searchBox(), '');
    await settle(150);
    assert.equal((required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement).value, '筛选期间的新模板');
  } finally { await unmount(); }
});

test('返修 F07-04 残留：同模板打开历史/返回当前都作废在途 render，错误与缺值不得回灌', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    /** One-shot gate: the flag stops it from also swallowing the render requests that come later. */
    const holdRender = () => {
      const state = { armed: true };
      return {
        gate: harness.gate((url, method) => state.armed && method === 'POST' && url === `/api/prompts/${A}/render`),
        disarm: () => { state.armed = false; },
      };
    };
    // 甲当前版缺变量：真实 422 被扣住，随后打开同一模板的第 1 版（selectionVersion 不变）
    const first = holdRender();
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(20);
    assert.equal(harness.waiting(first.gate), 1, '甲的 render 仍在途中');
    first.disarm();
    await click(required(versionRow('第 1 版'), '甲第 1 版'));
    await settle(40);
    assert.ok(required(window.document.querySelector('.history-banner')).textContent?.includes('正在查看第 1 版'));

    harness.release(first.gate);
    await settle(40);
    assert.ok(window.document.querySelector('.error-message') === null, '迟到的生成错误不得盖到历史只读页上');
    assert.equal(window.document.querySelectorAll('.prompt-missing-note').length, 0, '历史页不得出现缺变量提示');
    assert.ok(required(window.document.querySelector('.history-banner')).textContent?.includes('正在查看第 1 版'), '历史视图必须保持不变');

    // 返回当前：旧错误与旧服务端缺值状态都不得回灌
    await click(required(byText('返回当前版本'), '返回当前版本'));
    await settle(40);
    assert.ok(window.document.querySelector('.error-message') === null, '返回当前后旧的生成错误不得保留');
    assert.ok(window.document.querySelector('.prompt-missing-note[role="alert"]') === null, '返回当前后旧的服务端缺值状态不得保留');
    assert.ok(required(window.document.querySelector('.prompt-missing-note[role="status"]')).textContent?.includes('还缺少：甲变量'),
      '缺变量提示只能由当前填写状态实时决定');

    // 在途 render 期间打开历史再返回当前，释放后同样不得回灌
    const second = holdRender();
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(20);
    assert.equal(harness.waiting(second.gate), 1);
    second.disarm();
    await click(required(versionRow('第 1 版'), '甲第 1 版'));
    await settle(40);
    await click(required(byText('返回当前版本'), '返回当前版本'));
    await settle(40);
    harness.release(second.gate);
    await settle(40);
    assert.ok(window.document.querySelector('.error-message') === null, '返回当前后释放的旧错误不得显示');
    assert.ok(window.document.querySelector('.prompt-missing-note[role="alert"]') === null, '返回当前后释放的旧缺值状态不得显示');

    // 新上下文必须能正常工作
    await type(variableField(), '华东');
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(40);
    assert.equal(required(renderedBody()).textContent, '请总结 华东。', '返回后的新生成必须正常');

    // 进入新建后释放旧 render：新表单不得被污染
    const third = holdRender();
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(20);
    assert.equal(harness.waiting(third.gate), 1);
    third.disarm();
    await click(required(byText('手动新建'), '新建按钮'));
    await settle(20);
    await type(required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement, '生成期间的新模板');
    harness.release(third.gate);
    await settle(40);
    assert.equal((required(window.document.querySelector('.prompt-editor input')) as HTMLInputElement).value, '生成期间的新模板', '旧 render 不得清掉新表单');
    assert.ok(window.document.querySelector('.error-message') === null, '旧 render 的错误不得串到新表单');
  } finally { await unmount(); }
});

test('返修 F07-05 残留：重叠新建各有独立 requestId，旧 finally 不得清掉后一张表单的占用', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    const editorInput = () => required(window.document.querySelector('.prompt-editor input') as HTMLInputElement | null, '名称输入');
    const openForm = async (name: string) => {
      await click(required(byText('手动新建'), '新建按钮'));
      await settle(20);
      await type(editorInput(), name);
      await type(required(window.document.querySelector('.prompt-body-field textarea') as HTMLTextAreaElement | null, '正文输入'), `${name}的正文。`);
    };
    /** One-shot gate: the flag stops it from also swallowing the requests that come after it. */
    const holdCreate = () => {
      const state = { armed: true };
      return {
        gate: harness.gate((url, method) => state.armed && method === 'POST' && url === '/api/prompts'),
        disarm: () => { state.armed = false; },
      };
    };
    const requestIds = () => harness.calls
      .filter(call => call.method === 'POST' && call.url === '/api/prompts')
      .map(call => String((call.body as { requestId?: string }).requestId));

    // 丁：创建提交后响应被扣住
    const ding = holdCreate();
    await openForm('丁模板');
    await submit();
    await settle(20);
    assert.equal(harness.waiting(ding.gate), 1, '丁的创建仍在途中');
    ding.disarm();

    // 戊：第二张新表单同样提交并被扣住
    const wu = holdCreate();
    await openForm('戊模板');
    await submit();
    await settle(20);
    assert.equal(harness.waiting(wu.gate), 1, '戊的创建仍在途中');
    wu.disarm();
    const [dingId, wuId] = requestIds();
    assert.notEqual(dingId, wuId, '两张新表单必须各自分配 requestId');

    // 只释放丁，戊仍在途
    harness.release(ding.gate);
    await settle(40);

    // 己：必须拿到第三个 requestId 并真正保存成功，而不是复用戊的在途 id 撞 409
    await openForm('己模板');
    await submit();
    await settle(60);
    const ids = requestIds();
    assert.equal(ids.length, 3, '三次创建请求');
    assert.notEqual(ids[2], dingId, '己不得复用丁的 requestId');
    assert.notEqual(ids[2], wuId, '己不得复用戊仍在途的 requestId');
    assert.ok(window.document.querySelector('.error-message') === null,
      `己不得保存失败（复用戊的 requestId 会得到 409）—— 实际提示：${window.document.querySelector('.error-message')?.textContent ?? '（无）'}`);
    assert.ok(window.document.querySelector('.prompt-editor') === null, '己保存成功后表单正常关闭');

    // 戊的迟到成功：不报错、不重复提交，被 UI 忽略的记录仍出现在列表里
    harness.release(wu.gate);
    await settle(40);
    assert.ok(window.document.querySelector('.error-message') === null, '戊的迟到成功不得报错');
    assert.equal(requestIds().length, 3, '已提交的操作不得重复提交');
    const listed = listNames();
    for (const name of ['丁模板', '戊模板', '己模板']) assert.ok(listed.includes(name), `${name} 已保存，必须出现在列表里`);
  } finally { await unmount(); }
});

test('返修 F07-07：重复点击当前模板仍能看到完整历史，重复选择不得清空版本列表', async () => {
  const harness = stubFetch();
  const first = await mount();
  try {
    await settle();
    const rows = () => window.document.querySelectorAll('.prompt-version-row').length;
    const historyCount = () => {
      const header = [...window.document.querySelectorAll('.prompt-section h3')].find(node => (node.textContent ?? '').startsWith('版本历史'));
      return header ? Number((header.textContent ?? '').replace(/[^0-9]/g, '')) : -1;
    };
    const loadingHistory = () => (window.document.querySelector('.prompt-version-list')?.textContent ?? '').includes('正在读取版本');
    // 自动选中甲的初次读取：历史正常
    assert.equal(detailTitle(), '模板甲');
    assert.equal(rows(), 1, '甲的初次历史必须加载');
    assert.equal(loadingHistory(), false);

    // 独立验收的最小复现：乙→甲，再点已经选中的甲
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(detailTitle(), '模板乙');
    assert.equal(rows(), 2, '乙有两版可看');
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(60);
    assert.equal(detailTitle(), '模板甲');
    assert.equal(rows(), 1);
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(60);
    assert.equal(detailTitle(), '模板甲', '重复点击不得把详情切走');
    assert.equal(rows(), 1, '重复点击当前行后，甲的历史必须仍然完整（此前会清成 0 并卡在“正在读取版本…”）');
    assert.equal(historyCount(), 1, '版本历史计数必须与真实版本数一致');
    assert.equal(loadingHistory(), false, '不得停留在假的加载状态');
    assert.ok(window.document.querySelector('.error-message') === null, '重复点击不得报错');

    // 生成上下文里的同 id 点击：清理与重新读取必须同时发生——不是只隐藏加载文字，也不是保留旧结果
    await type(variableField(), '华东');
    await click(required(byText('生成最终正文'), '生成按钮'));
    await settle(60);
    assert.equal(required(renderedBody()).textContent, '请总结 华东。');
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(60);
    assert.equal(variableField().value, '', '同 id 重复选择仍然清空填写内容');
    assert.ok(renderedBody() === null, '同 id 重复选择不得保留旧的生成结果');
    assert.equal(isEnabled('复制最终正文'), false, '旧结果清掉后复制必须重新禁用');
    assert.equal(rows(), 1, '同 id 重复选择后历史必须重新读出来');
    assert.equal(loadingHistory(), false);

    // 已有 2 版的模板：重复点击当前行仍然完整
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(rows(), 2);
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(rows(), 2, '2 版模板重复点击后历史必须完整');
    assert.equal(historyCount(), 2);
    assert.equal(loadingHistory(), false);
    assert.equal(detailTitle(), '模板乙');
    assert.ok((window.document.querySelector('.prompt-detail')?.textContent ?? '').includes('没有变量的正文。'), '不得串入别的模板正文');
    assert.ok(!(window.document.querySelector('.prompt-detail')?.textContent ?? '').includes('请总结'), '不得串入甲的正文');

    // 版本查看只读；历史页点该模板返回当前，且返回后历史照常
    const rendersBefore = harness.calls.filter(call => call.url.endsWith('/render')).length;
    await click(required(versionRow('第 2 版'), '乙第 2 版'));
    await settle(40);
    assert.ok(required(window.document.querySelector('.history-banner')).textContent?.includes('正在查看第 2 版'));
    assert.equal(window.document.querySelector('.prompt-fields'), null, '历史版本只读');
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.ok(window.document.querySelector('.history-banner') === null, '点当前模板必须回到当前视图');
    assert.equal(detailTitle(), '模板乙');
    assert.equal(rows(), 2, '返回当前后历史必须仍然完整');
    assert.equal(harness.calls.filter(call => call.url.endsWith('/render')).length, rendersBefore, '查看版本与返回都不得触发生成');

    // 编辑页选择同一模板：回到当前视图，历史照常
    await click(required(byText('编辑'), '编辑按钮'));
    await settle(20);
    assert.ok(required(window.document.querySelector('.prompt-editor'), '编辑表单'));
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(window.document.querySelector('.prompt-editor'), null, '选择当前模板必须退出编辑上下文');
    assert.equal(detailTitle(), '模板乙');
    assert.equal(rows(), 2, '退出编辑后历史必须仍然完整');

    // 甲乙往返
    await click(required(byText('模板甲'), '模板甲列表项'));
    await settle(60);
    assert.equal(rows(), 1);
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(rows(), 2);
    assert.ok(window.document.querySelector('.error-message') === null);
  } finally { await first.unmount(); }

  // 刷新（重新挂载）：历史仍然完整，重复点击仍然有效
  const refreshed = await mount();
  try {
    await settle();
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 2, '刷新后乙的历史仍完整');
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(60);
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 2, '刷新后重复点击当前行仍然有效');
  } finally { await refreshed.unmount(); }
});

test('返修 F07-07：初次历史仍在途中时重复点当前行，必须重新读取并最终加载完整历史', async () => {
  const harness = stubFetch();
  const { unmount } = await mount();
  try {
    await settle();
    // 乙的版本读取整体扣住：第一次读取一直不返回
    const versionsGate = harness.gate((url, method) => method === 'GET' && url === `/api/prompts/${B}/versions`);
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(20);
    assert.equal(detailTitle(), '模板乙', '详情先返回');
    assert.equal(harness.waiting(versionsGate), 1, '乙的版本读取仍在途中');
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 0);

    // 在途时重复点击同一行：清理必须与读取触发一致，也就是真的再读一次
    await click(required(byText('模板乙'), '模板乙列表项'));
    await settle(20);
    assert.equal(harness.waiting(versionsGate), 2, '重复点击同一模板必须重新触发读取，而不是只清空');
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 0);

    // 先释放已被作废的第一次读取：代次已过期，不得写入当前选择
    harness.release(versionsGate);
    await settle(40);
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 0, '被作废的旧读取不得写入当前选择');

    // 再释放这次的读取：历史必须最终加载出来
    harness.release(versionsGate);
    await settle(40);
    assert.equal(window.document.querySelectorAll('.prompt-version-row').length, 2, '重复点击后历史必须最终加载完整');
    assert.ok(!(window.document.querySelector('.prompt-version-list')?.textContent ?? '').includes('正在读取版本'), '不得停留在假的加载状态');
    assert.equal(detailTitle(), '模板乙');
    // 加载出来的历史必须真的可用：第 2 版能打开并显示它自己的旧正文
    await click(required(versionRow('第 2 版'), '乙第 2 版'));
    await settle(40);
    assert.ok(required(window.document.querySelector('.history-banner')).textContent?.includes('正在查看第 2 版'));
    assert.ok((window.document.querySelector('.prompt-detail')?.textContent ?? '').includes('乙的旧版正文。'), '第 2 版内容必须可查');
    assert.ok(window.document.querySelector('.error-message') === null, '重复点击不得带出错误');
  } finally { await unmount(); }
});
