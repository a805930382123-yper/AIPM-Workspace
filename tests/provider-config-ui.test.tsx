import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { LlmConfigSummary } from '../app/api.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, Event: window.Event, MouseEvent: window.MouseEvent, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
const { act } = await import('react'); const { createRoot } = await import('react-dom/client');
const { SettingsPage } = await import('../app/pages/SettingsPage.tsx');
const baseConfig = (): LlmConfigSummary => ({ provider: 'openai-compatible', baseUrlHost: null, baseUrl: '', model: null, keyConfigured: false, keyMask: '••••••••••••', configured: false, source: 'none', missing: ['FMCG_LLM_BASE_URL', 'FMCG_LLM_MODEL', 'FMCG_LLM_API_KEY'], configFile: '.env.local', envNames: { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' }, revision: 'r1', writeToken: 'write-token', environmentLocked: false });
const answer = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) }) as unknown as Response;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('settings saves, clears the password field, tests only after save, and confirms clearing', async () => {
  let config = baseConfig(); const calls: Array<{ url: string; method: string; body?: Record<string, unknown>; token?: string }> = [];
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input); const method = (init.method ?? 'GET').toUpperCase(); const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body, token: new Headers(init.headers).get('X-FMCG-Config-Token') ?? undefined });
    if (url === '/api/llm/config' && method === 'GET') return answer(config);
    if (url === '/api/llm/config' && method === 'PUT') { config = { ...config, revision: 'r2', baseUrl: String(body?.baseUrl), model: String(body?.model), keyConfigured: Boolean(body?.apiKey), configured: true, source: 'local-file', missing: [] }; return answer(config); }
    if (url === '/api/llm/config/test') return answer({ ok: true, message: 'Provider 已返回有效响应。', elapsedMs: 3 });
    if (url === '/api/llm/config' && method === 'DELETE') { config = { ...baseConfig(), revision: 'r3' }; return answer(config); }
    if (url === '/api/demo') return answer({ version: 1, imported: false, items: [], exampleTask: { title: '示例', task: '示例任务' } });
    return answer({});
  }) as unknown as typeof fetch;
  window.confirm = () => true;
  const container = window.document.getElementById('root')!; const root = createRoot(container);
  await act(async () => { root.render(<SettingsPage />); await tick(); await tick(); });
  const field = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  const change = async (name: string, value: string) => act(async () => { const input = field(name); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); input.dispatchEvent(new window.Event('change', { bubbles: true })); await tick(); });
  const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label)) as HTMLButtonElement;
  await change('API Base URL', 'https://api.example.test/v1'); await change('模型 ID', 'model-x'); await change('API Key', 'test-only-secret-value');
  await act(async () => { button('保存配置').click(); await tick(); });
  assert.equal(field('API Key').value, ''); assert.equal(calls.find(call => call.method === 'PUT')?.token, 'write-token');
  assert.equal(JSON.stringify(calls).includes('test-only-secret-value'), true, 'the key may be sent only in the explicit save request');
  await act(async () => { button('测试连接').click(); await tick(); });
  assert.ok(container.textContent?.includes('连接测试成功'));
  await act(async () => { button('清除本机配置').click(); await tick(); });
  assert.equal(field('API Key').value, ''); assert.ok(container.textContent?.includes('本机配置已清除'));
  assert.deepEqual(calls.filter(call => call.url === '/api/llm/config/test').map(call => call.method), ['POST']);
  assert.ok(calls.some(call => call.url === '/api/llm/config' && call.method === 'DELETE'));
  await act(async () => root.unmount());
});

test('initial and reload reads lock editing until the returned configuration is loaded', async () => {
  let config = baseConfig(); let count = 0; let resolveInitial: ((value: Response) => void) | undefined; let resolveReload: ((value: Response) => void) | undefined;
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === '/api/llm/config') {
      count++;
      if (count === 1) return new Promise<Response>(resolve => { resolveInitial = resolve; });
      if (count === 2) return new Promise<Response>(resolve => { resolveReload = resolve; });
      return answer(config);
    }
    if (url === '/api/demo') return answer({ version: 1, imported: false, items: [], exampleTask: { title: '示例', task: '示例任务' } });
    return answer({});
  }) as unknown as typeof fetch;
  const container = window.document.getElementById('root')!; const root = createRoot(container);
  await act(async () => { root.render(<SettingsPage />); await tick(); });
  const field = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label)) as HTMLButtonElement;
  const fields = ['API Base URL', '模型 ID', 'API Key'].map(name => container.querySelector<HTMLInputElement>('input[aria-label="' + name + '"]')!);
  assert.ok(fields.every(input => input.disabled));
  assert.equal(button('保存配置').disabled, true);
  config = { ...baseConfig(), baseUrl: 'https://saved.example/v1', model: 'saved-model' };
  await act(async () => { resolveInitial?.(answer(config)); await tick(); });
  assert.equal(field('模型 ID').value, 'saved-model');
  assert.ok(fields.every(input => !input.disabled));
  assert.equal(button('保存配置').disabled, false);
  await act(async () => { button('重新读取').click(); await tick(); });
  assert.ok(fields.every(input => input.disabled));
  assert.equal(button('保存配置').disabled, true);
  config = { ...baseConfig(), baseUrl: 'https://reload.example/v1', model: 'reload-model' };
  await act(async () => { resolveReload?.(answer(config)); await tick(); });
  assert.equal(field('API Base URL').value, 'https://reload.example/v1');
  assert.equal(field('模型 ID').value, 'reload-model');
  assert.ok(fields.every(input => !input.disabled));
  assert.equal(button('保存配置').disabled, false);
  await act(async () => root.unmount());
});

test('a configuration response arriving after unmount does not update the page', async () => {
  let resolveConfig: ((value: Response) => void) | undefined;
  (globalThis as { fetch?: unknown }).fetch = (async (input: unknown) => {
    if (String(input) === '/api/llm/config') return new Promise<Response>(resolve => { resolveConfig = resolve; });
    if (String(input) === '/api/demo') return answer({ version: 1, imported: false, items: [], exampleTask: { title: '示例', task: '示例任务' } });
    return answer({});
  }) as unknown as typeof fetch;
  const container = window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => { root.render(<SettingsPage />); await tick(); });
  await act(async () => root.unmount());
  await act(async () => { resolveConfig?.(answer({ ...baseConfig(), baseUrl: 'https://late.example/v1', model: 'late-model' })); await tick(); });
  assert.equal(container.innerHTML, '');
});
