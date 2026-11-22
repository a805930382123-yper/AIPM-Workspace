import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  ConfigError,
  loadLlmConfig,
  llmConfigSummary,
  parseLocalEnvText,
  safeBaseUrl,
} from '../services/llm/config.ts';
import { LlmConfigManager } from '../services/llm/config-manager.ts';
import { registerLlmConfigRoutes } from '../server/llm-config-api.ts';
import { OpenAiCompatibleProvider } from '../services/llm/provider.ts';

async function fixture(body = '') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cfg01-'));
  const file = path.join(dir, '.env.local');
  if (body) await writeFile(file, body);
  const manager = new LlmConfigManager(file, {});
  return { dir, file, manager, close: () => rm(dir, { recursive: true, force: true }) };
}

test('configuration reader distinguishes missing files from read failures and honors per-field environment precedence', async () => {
  const f = await fixture('# retained\nFMCG_LLM_MODEL=file-model\n');
  try {
    const loaded = await loadLlmConfig({ filePath: f.file, env: { FMCG_LLM_BASE_URL: 'https://env.example/v1' } });
    assert.equal(loaded.baseUrl, 'https://env.example/v1');
    assert.equal(loaded.model, 'file-model');
    assert.equal(loaded.source, 'env');
    const completeEnv = await loadLlmConfig({
      filePath: f.dir,
      env: { FMCG_LLM_BASE_URL: 'https://env.example/v1', FMCG_LLM_MODEL: 'env-model', FMCG_LLM_API_KEY: 'env-key' },
    });
    assert.equal(completeEnv.source, 'env');
    assert.equal(completeEnv.model, 'env-model');
    assert.equal((await loadLlmConfig({ filePath: path.join(f.dir, 'missing'), env: {} })).source, 'none');
    await assert.rejects(
      loadLlmConfig({ filePath: f.dir, env: {} }),
      (error) => error instanceof ConfigError && error.code === 'CONFIG_READ_FAILED',
    );
    const malformed = llmConfigSummary(
      {
        baseUrl: 'https://user:secret@bad.example/v1?api=secret',
        model: 'model',
        apiKey: 'other-secret',
        source: 'local-file',
      },
      f.file,
    );
    assert.equal(malformed.configured, false);
    assert.equal(malformed.baseUrl, '');
    assert.equal(JSON.stringify(malformed).includes('secret'), false);
    assert.equal(safeBaseUrl('http://127.0.0.1:1234/v1/'), 'http://127.0.0.1:1234/v1');
    for (const bad of [
      'http://api.example/v1',
      'https://user:pass@example.com/v1',
      'https://api.example/v1?x=1',
      'https://api.example/v1?',
      'https://api.example/v1#',
      'https://api.example/v1/chat/completions',
      'https://api.example/sk-live-12345678',
    ])
      assert.throws(() => safeBaseUrl(bad), ConfigError);
  } finally {
    await f.close();
  }
});

test('manager saves atomically, preserves unrelated bytes, retains or replaces Key, and rejects stale revisions', async () => {
  const f = await fixture('# custom comment\r\nOTHER=value-without-newline');
  const secret = 'cfg01-new-secret-value-987654321';
  try {
    const initial = await f.manager.get();
    const saved = await f.manager.save({
      revision: initial.revision,
      baseUrl: 'https://provider.example/custom/v1/',
      model: 'model-a',
      apiKey: secret,
    });
    assert.equal(saved.baseUrl, 'https://provider.example/custom/v1');
    assert.equal(saved.keyConfigured, true);
    assert.equal(JSON.stringify(saved).includes(secret), false);
    const text = await readFile(f.file, 'utf8');
    assert.match(text, /OTHER=value-without-newline\r?\nFMCG_LLM_BASE_URL=/u);
    assert.match(text, /# custom comment\r?\n/u);
    const retained = await f.manager.save({
      revision: saved.revision,
      baseUrl: 'https://provider.example/other',
      model: 'model-b',
    });
    assert.equal((await loadLlmConfig({ filePath: f.file, env: {} })).apiKey, secret);
    const retainedBytes = await readFile(f.file);
    await assert.rejects(
      f.manager.save({ revision: retained.revision, baseUrl: 'https://provider.example/v1', model: secret }),
      ConfigError,
    );
    assert.deepEqual(await readFile(f.file), retainedBytes);
    await assert.rejects(
      f.manager.save({ revision: saved.revision, baseUrl: 'https://provider.example/stale', model: 'x' }),
      (error) => error instanceof ConfigError && error.status === 409,
    );
    const rotated = await f.manager.save({
      revision: retained.revision,
      baseUrl: retained.baseUrl,
      model: retained.model!,
      apiKey: 'different-key-1234567890',
    });
    assert.equal(rotated.keyConfigured, true);
    await assert.rejects(
      f.manager.save({
        revision: rotated.revision,
        baseUrl: `https://provider.example/${'different-key-1234567890'}`,
        model: 'unsafe',
      }),
      ConfigError,
    );
    const cleared = await f.manager.clear(rotated.revision);
    assert.equal(cleared.configured, false);
    assert.equal(cleared.keyConfigured, false);
    const after = await readFile(f.file, 'utf8');
    assert.match(after, /OTHER=value-without-newline/u);
    assert.doesNotMatch(after, /FMCG_LLM_(?:BASE_URL|MODEL|API_KEY)=/u);
    assert.equal(after.includes(secret), false);
    assert.equal(after.includes('different-key-1234567890'), false);
  } finally {
    await f.close();
  }
});

test('old local keys are protected under environment overrides and quoted keys round-trip unchanged into adapter auth', async () => {
  const oldSecret = 'old-local-secret-0123456789';
  const f = await fixture(
    `FMCG_LLM_BASE_URL=https://provider.example/${oldSecret}\nFMCG_LLM_MODEL=model-old\nFMCG_LLM_API_KEY=${oldSecret}\n`,
  );
  try {
    const locked = new LlmConfigManager(f.file, { FMCG_LLM_API_KEY: 'environment-key-987654321' });
    const summary = await locked.get();
    assert.equal(summary.baseUrl, '');
    assert.equal(JSON.stringify(summary).includes(oldSecret), false);
    await assert.rejects(
      locked.save({
        revision: summary.revision,
        baseUrl: `https://provider.example/${encodeURIComponent(oldSecret)}`,
        model: 'model',
        apiKey: 'new-secret-1234567890',
      }),
      (error) => error instanceof ConfigError && error.code === 'CONFIG_SECRET_IN_PUBLIC_FIELD',
    );
    const manager = f.manager;
    const current = await manager.get();
    const quotedKey = '"slash\\and\\"quote"';
    const saved = await manager.save({
      revision: current.revision,
      baseUrl: 'https://provider.example/v1',
      model: 'quoted-model',
      apiKey: quotedKey,
    });
    assert.equal(saved.configured, true);
    assert.equal((await loadLlmConfig({ filePath: f.file, env: {} })).apiKey, quotedKey);
    let authorization = '';
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await new OpenAiCompatibleProvider(await loadLlmConfig({ filePath: f.file, env: {} })).complete({
        system: 'test',
        user: 'fixed',
        timeoutMs: 1000,
        maxOutputBytes: 4096,
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
    assert.equal(authorization, `Bearer ${quotedKey}`);
  } finally {
    await f.close();
  }
});

test('environment overrides lock mutations but permit an explicit connection test; API enforces token, origin, content type and fields', async () => {
  const f = await fixture(
    'FMCG_LLM_BASE_URL=https://provider.example/v1\nFMCG_LLM_MODEL=model\nFMCG_LLM_API_KEY=short-secret\n',
  );
  const envManager = new LlmConfigManager(f.file, { FMCG_LLM_API_KEY: 'environment-secret' });
  const app = express();
  app.use(express.json());
  let called = 0;
  let requestText = '';
  let responseText = 'OK';
  registerLlmConfigRoutes(app, envManager, () => ({
    name: 'fake',
    model: 'model',
    secrets: ['environment-secret'],
    async complete(request) {
      called++;
      requestText = request.user;
      return { text: responseText, finishReason: 'stop', bytes: Buffer.byteLength(responseText) };
    },
  }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const shaped = error as { status?: number; code?: string; message?: string };
    res
      .status(shaped.status ?? 500)
      .json({ error: { code: shaped.code ?? 'INTERNAL', message: shaped.message ?? 'failed' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const get = await fetch(`${base}/api/llm/config`);
    const config = (await get.json()) as { revision: string; writeToken: string; environmentLocked: boolean };
    assert.equal(config.environmentLocked, true);
    assert.equal(JSON.stringify(config).includes('environment-secret'), false);
    const headers = { 'content-type': 'application/json', 'x-fmcg-config-token': config.writeToken };
    const auth = async (body: unknown, init: RequestInit = {}) =>
      fetch(`${base}/api/llm/config`, { method: 'PUT', headers, body: JSON.stringify(body), ...init });
    assert.equal(
      (await auth({ revision: config.revision, baseUrl: 'https://x/v1', model: 'x', apiKey: 'k' })).status,
      409,
    );
    assert.equal(
      (
        await fetch(`${base}/api/llm/config`, {
          method: 'PUT',
          headers: { ...headers, 'x-fmcg-config-token': 'wrong' },
          body: JSON.stringify({}),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/llm/config`, {
          method: 'PUT',
          headers: { ...headers, origin: 'https://attacker.example' },
          body: JSON.stringify({}),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/llm/config`, {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
      415,
    );
    const extra = await fetch(`${base}/api/llm/config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ revision: config.revision, baseUrl: 'https://x/v1', model: 'x', rogue: true }),
    });
    assert.equal(extra.status, 400);
    const probe = await fetch(`${base}/api/llm/config/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ revision: config.revision, confirm: true }),
    });
    assert.equal(probe.status, 200);
    assert.equal(called, 1);
    assert.equal(requestText, 'Reply with OK.');
    responseText = '{"message":"environment-secret"}';
    const leaked = await fetch(`${base}/api/llm/config/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ revision: config.revision, confirm: true }),
    });
    assert.equal(leaked.status, 502);
    assert.equal((await leaked.text()).includes('environment-secret'), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});

test('provider caps non-success response bodies without Content-Length and keeps ordinary auth errors safe', async () => {
  const token = 'provider-secret-for-budget';
  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'https://provider.example/v1',
    model: 'model',
    apiKey: token,
    source: 'local-file',
  });
  const previousFetch = globalThis.fetch;
  let cancelled = false;
  try {
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(8192).fill(65));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 401 },
      )) as typeof fetch;
    await assert.rejects(
      provider.complete({ system: 'check', user: 'fixed', timeoutMs: 1000, maxOutputBytes: 4096 }),
      (error) => {
        assert.equal((error as { code?: string }).code, 'LLM_RESPONSE_TOO_LARGE');
        return true;
      },
    );
    assert.equal(cancelled, true);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: `bad token ${token}` } }), { status: 401 })) as typeof fetch;
    await assert.rejects(
      provider.complete({ system: 'check', user: 'fixed', timeoutMs: 1000, maxOutputBytes: 4096 }),
      (error) => {
        assert.equal((error as { code?: string }).code, 'LLM_AUTH_FAILED');
        assert.equal((error as Error).message.includes(token), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('tagged UTF-8/base64url configuration values round-trip exactly and legacy manual escapes remain literal', async () => {
  const marker = '@fmcg-config-utf8-base64url-v1@';
  assert.equal(parseLocalEnvText('FMCG_LLM_API_KEY="legacy\\\\manual"\n').FMCG_LLM_API_KEY, 'legacy\\\\manual');
  assert.equal(parseLocalEnvText('OTHER=' + marker + 'YWJj\n').OTHER, marker + 'YWJj');
  assert.throws(
    () => parseLocalEnvText('FMCG_LLM_MODEL=' + marker + '_w\n'),
    (error) => error instanceof ConfigError && error.code === 'CONFIG_VALUE_INVALID',
  );

  const f = await fixture('# retained\n');
  const exactKey = 'fixture-key/with+percent%2F"quotes"\\tail';
  const exactModel = 'model "quoted"\\identifier';
  const previousFetch = globalThis.fetch;
  let authorization = '';
  let sentModel = '';
  try {
    const initial = await f.manager.get();
    const saved = await f.manager.save({
      revision: initial.revision,
      baseUrl: 'https://provider.example/v1',
      model: exactModel,
      apiKey: exactKey,
    });
    const persisted = await readFile(f.file, 'utf8');
    assert.match(persisted, /^FMCG_LLM_API_KEY=@fmcg-config-utf8-base64url-v1@/mu);
    const loaded = await loadLlmConfig({ filePath: f.file, env: {} });
    assert.equal(loaded.apiKey, exactKey);
    assert.equal(loaded.model, exactModel);
    assert.equal(saved.model, exactModel);

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      sentModel = JSON.parse(String(init?.body)).model;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await new OpenAiCompatibleProvider(loaded).complete({
      system: 'test',
      user: 'fixed',
      timeoutMs: 1000,
      maxOutputBytes: 4096,
    });
    assert.equal(authorization, 'Bearer ' + exactKey);
    assert.equal(sentModel, exactModel);
  } finally {
    globalThis.fetch = previousFetch;
    await f.close();
  }
});

test('manager rejects unpaired surrogates before any file write', async () => {
  const f = await fixture('# unchanged\nOTHER=preserved\n');
  try {
    const initial = await f.manager.get();
    const before = await readFile(f.file);
    await assert.rejects(
      f.manager.save({
        revision: initial.revision,
        baseUrl: 'https://provider.example/v1',
        model: 'fixture-\ud800',
        apiKey: 'valid-fixture-key',
      }),
      (error) => error instanceof ConfigError && error.code === 'INVALID_MODEL',
    );
    assert.deepEqual(await readFile(f.file), before);
    await assert.rejects(
      f.manager.save({
        revision: initial.revision,
        baseUrl: 'https://provider.example/v1',
        model: 'valid-model',
        apiKey: 'fixture-\ud800',
      }),
      (error) => error instanceof ConfigError && error.code === 'INVALID_API_KEY',
    );
    assert.deepEqual(await readFile(f.file), before);
  } finally {
    await f.close();
  }
});

test('shared secret guard rejects mixed, partial, malformed, deep-encoded and environment credentials without writing or fetching', async () => {
  const secret = 'a/b';
  let deep = secret;
  for (let index = 0; index < 10; index++) deep = encodeURIComponent(deep);
  const candidates = [
    'https://provider.example/%61%2f%62',
    'https://provider.example/a%2fb',
    'https://provider.example/' + deep,
    'https://provider.example/%61%2f%62%ff',
    'https://provider.example/' + secret + '%zz',
  ];
  const f = await fixture('# preserved\n');
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    const initial = await f.manager.get();
    const before = await readFile(f.file);
    for (const baseUrl of candidates) {
      await assert.rejects(
        f.manager.save({ revision: initial.revision, baseUrl, model: 'safe-model', apiKey: secret }),
        (error) => error instanceof ConfigError && error.code === 'CONFIG_SECRET_IN_PUBLIC_FIELD',
      );
      assert.deepEqual(await readFile(f.file), before);
    }

    const summary = llmConfigSummary(
      {
        baseUrl: 'https://provider.example/%61%2f%62',
        model: '%61%2f%62',
        apiKey: 'other-key',
        source: 'local-file',
        knownSecrets: [secret],
      },
      f.file,
    );
    assert.equal(summary.baseUrl, '');
    assert.equal(summary.model, null);

    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'unexpected' }, finish_reason: 'stop' }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    for (const baseUrl of candidates) {
      const provider = new OpenAiCompatibleProvider({
        baseUrl,
        model: 'safe-model',
        apiKey: secret,
        source: 'local-file',
      });
      await assert.rejects(
        provider.complete({ system: 'test', user: 'fixed', timeoutMs: 1000, maxOutputBytes: 4096 }),
        (error) => (error as { code?: string }).code === 'LLM_CONFIGURATION_INVALID',
      );
    }
    assert.equal(fetchCalls, 0);

    const envFile = await fixture(
      'FMCG_LLM_BASE_URL=https://provider.example/v1\nFMCG_LLM_MODEL=old-model\nFMCG_LLM_API_KEY=old-file-key\n',
    );
    try {
      const envSecret = new LlmConfigManager(envFile.file, { FMCG_LLM_API_KEY: secret });
      const envConfig = await envSecret.get();
      const envBefore = await readFile(envFile.file);
      await assert.rejects(
        envSecret.save({
          revision: envConfig.revision,
          baseUrl: 'https://provider.example/%61%2f%62',
          model: 'safe-model',
        }),
        (error) => error instanceof ConfigError && error.code === 'CONFIG_SECRET_IN_PUBLIC_FIELD',
      );
      assert.deepEqual(await readFile(envFile.file), envBefore);
    } finally {
      await envFile.close();
    }
  } finally {
    globalThis.fetch = previousFetch;
    await f.close();
  }
});
