import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAiCompatibleProvider } from '../services/llm/provider.ts';

const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
async function wire(baseUrl: string, model: string, purpose?: 'knowledge' | 'prompt') {
  const prior = globalThis.fetch;
  let sent: Record<string, unknown> | undefined;
  try {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return reply(); }) as typeof fetch;
    await new OpenAiCompatibleProvider({ baseUrl, model, apiKey: 'fixture-key', source: 'env' }).complete({ system: 'fixture system', user: 'fixture user', timeoutMs: 1000, maxOutputBytes: 4096, ...(purpose ? { purpose } : {}) });
    return sent!;
  } finally { globalThis.fetch = prior; }
}

test('knowledge and prompt GLM-5.3-Flash on exact official hosts receive low reasoning and JSON mode', async () => {
  for (const host of ['open.bigmodel.cn', 'OPEN.BIGMODEL.CN', 'api.z.ai']) {
    for (const purpose of ['knowledge','prompt'] as const) {
    const body = await wire(`https://${host}/v1`, 'GLM-5.3-FLASH', purpose);
    assert.equal(body.reasoning_effort, 'low');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.temperature, 0);
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, [{ role: 'system', content: 'fixture system' }, { role: 'user', content: 'fixture user' }]);
    }
  }
});

test('no reasoning hint for spoofed hosts, other models, or calls without knowledge purpose', async () => {
  const cases: Array<[string, string, 'knowledge' | 'prompt' | undefined]> = [
    ['https://open.bigmodel.cn.attacker.example/v1', 'glm-5.3-flash', 'knowledge'],
    ['https://evil.open.bigmodel.cn/v1', 'glm-5.3-flash', 'knowledge'],
    ['https://api.z.ai.attacker.example/v1', 'glm-5.3-flash', 'knowledge'],
    ['https://open.bigmodel.cn/v1', 'glm-5.3-flash-preview', 'knowledge'],
    ['https://api.z.ai/v1', 'glm-5.1-flash', 'knowledge'],
    ['https://open.bigmodel.cn/v1', 'glm-5.3-flash', undefined],
    ['https://open.bigmodel.cn.attacker.example/v1', 'glm-5.3-flash', 'prompt'],
    ['https://api.z.ai/v1', 'glm-5.1-flash', 'prompt'],
  ];
  for (const [host, model, purpose] of cases) {
    const body = await wire(host, model, purpose);
    assert.equal('reasoning_effort' in body, false, `${host} / ${model} / ${purpose}`);
    assert.equal('response_format' in body, false, `${host} / ${model} / ${purpose}`);
    assert.equal(body.temperature, 0);
  }
});

test('exact official OpenAI Terra uses default temperature for every purpose', async () => {
  for (const host of ['api.openai.com', 'API.OPENAI.COM']) {
    for (const purpose of ['knowledge', 'prompt', undefined] as const) {
      const body = await wire(`https://${host}/v1`, 'gpt-6.1-terra', purpose);
      assert.equal('temperature' in body, false);
      assert.equal('reasoning_effort' in body, false);
      assert.equal('response_format' in body, false);
      assert.equal(body.stream, false);
    }
  }
});

test('OpenAI temperature exception does not extend to other hosts or model IDs', async () => {
  for (const [baseUrl, model] of [
    ['https://api.openai.com.attacker.example/v1', 'gpt-6.1-terra'],
    ['https://evil.api.openai.com/v1', 'gpt-6.1-terra'],
    ['https://compatible.example/v1', 'gpt-6.1-terra'],
    ['https://api.openai.com/v1', 'gpt-6.1-terra-preview'],
    ['https://api.openai.com/v1', 'GPT-6.1-TERRA'],
    ['https://api.openai.com/v1', 'gpt-4.1'],
  ]) {
    for (const purpose of ['knowledge', 'prompt', undefined] as const) {
      const body = await wire(baseUrl, model, purpose);
      assert.equal(body.temperature, 0, `${baseUrl} / ${model} / ${purpose}`);
      assert.equal('reasoning_effort' in body, false);
    }
  }
});

test('knowledge purpose does not extend the configured timeout budget', async () => {
  const prior = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  })) as typeof fetch;
  const started = Date.now();
  try {
    await assert.rejects(
      new OpenAiCompatibleProvider({ baseUrl: 'https://api.z.ai/v1', model: 'glm-5.3-flash', apiKey: 'fixture-key', source: 'env' })
        .complete({ system: 'fixture', user: 'fixture', timeoutMs: 20, maxOutputBytes: 4096, purpose: 'knowledge' }),
      error => (error as { code?: string }).code === 'LLM_TIMEOUT',
    );
    assert.equal(aborted, true);
    assert.ok(Date.now() - started < 500);
  } finally { globalThis.fetch = prior; }
});
test('knowledge purpose preserves caller cancellation within the existing request budget', async () => {
  const prior = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  })) as typeof fetch;
  const controller = new AbortController();
  const started = Date.now();
  try {
    const pending = new OpenAiCompatibleProvider({ baseUrl: 'https://open.bigmodel.cn/v1', model: 'glm-5.3-flash', apiKey: 'fixture-key', source: 'env' })
      .complete({ system: 'fixture', user: 'fixture', timeoutMs: 1000, maxOutputBytes: 4096, purpose: 'knowledge', signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, error => (error as { code?: string }).code === 'LLM_CANCELLED');
    assert.equal(aborted, true);
    assert.ok(Date.now() - started < 500);
  } finally { globalThis.fetch = prior; }
});
