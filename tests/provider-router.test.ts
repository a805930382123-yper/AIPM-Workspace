import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInAutomationContext } from '../services/automation/context.ts';
import { LlmError, type LlmCompletionRequest } from '../services/llm/provider.ts';
import {
  LlmAttemptLedger,
  llmRequestContext,
  loadRouterConfig,
  resolveRouterConfig,
  ProviderRouter,
} from '../services/llm/provider-router.ts';
import { startFakeProvider } from './support/fake-llm.ts';

test('routes real HTTP attempts once per endpoint and persists only diagnostic metadata', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aipm-3-1-router-'));
  const response = { kind: 'content', content: 'result', usage: { prompt_tokens: 11, completion_tokens: 7 } } as const;
  const primary = await startFakeProvider(() => response);
  const backup = await startFakeProvider(() => response);
  t.after(async () => {
    await Promise.all([primary.close(), backup.close()]);
    await rm(dir, { recursive: true, force: true });
  });
  const primaryConfig = {
    baseUrl: primary.url,
    apiKey: 'loopback-primary-secret',
    model: 'main-heavy',
    source: 'env',
  } as const;
  const env = {
    FMCG_LLM_LABEL: '主测试模型',
    FMCG_LLM_LIGHT_MODEL: 'main-light',
    FMCG_LLM_BACKUP_ENABLED: 'true',
    FMCG_LLM_BACKUP_LABEL: '备测试模型',
    FMCG_LLM_BACKUP_BASE_URL: backup.url,
    FMCG_LLM_BACKUP_API_KEY: 'loopback-backup-secret',
    FMCG_LLM_BACKUP_MODEL: 'reserve-heavy',
    FMCG_LLM_BACKUP_LIGHT_MODEL: 'reserve-light',
    FMCG_LLM_TIMEOUT_MS: '200',
    FMCG_LLM_BACKUP_TIMEOUT_MS: '500',
  };
  const ledger = new LlmAttemptLedger(dir);
  const config = loadRouterConfig(primaryConfig, env, {});
  assert(config);
  const provider = new ProviderRouter(config, ledger);
  const request = { system: 'synthetic-system', user: 'synthetic-private-user-text', maxOutputBytes: 4096 };
  const availability = (key: string = primaryConfig.apiKey) =>
    ledger.availability(resolveRouterConfig({ ...primaryConfig, apiKey: key }, env, {}));
  assert.equal(loadRouterConfig(primaryConfig, {}, {})?.primary?.timeoutMs, 45_000);
  assert.equal((await provider.complete(request)).route?.attempts[0]?.model, 'main-heavy');
  assert.equal((await provider.complete({ ...request, tier: 'light' })).route?.attempts[0]?.model, 'main-light');
  assert.equal(backup.requests.length, 0);
  assert.equal((await new LlmAttemptLedger(path.join(dir, 'empty')).read()).endpoints.primary.failureRate, null);

  const requestId = randomUUID();
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 };
  primary.setHandler(() => ({
    kind: 'status',
    status: 429,
    body: { error: { message: request.user }, usage: { total_tokens: 0 } },
  }));
  const light = await llmRequestContext.run(requestId, () =>
    runInAutomationContext({ runId: randomUUID(), usage }, () => provider.complete({ ...request, tier: 'light' })),
  );
  assert.equal(light.route?.fallback, true);
  assert.deepEqual(
    light.route?.attempts.map(({ label, timeoutMs }) => [label, timeoutMs]),
    [
      ['主测试模型', 200],
      ['备测试模型', 500],
    ],
  );
  assert.deepEqual(
    light.route?.attempts.map(({ endpoint, model, outcome, errorCode, upstreamStatus }) => [
      endpoint,
      model,
      outcome,
      errorCode,
      upstreamStatus,
    ]),
    [
      ['primary', 'main-light', 'failure', 'LLM_RATE_LIMITED', 429],
      ['backup', 'reserve-light', 'success', undefined, undefined],
    ],
  );
  assert.equal(backup.requests[0]?.authorization, 'Bearer ' + env.FMCG_LLM_BACKUP_API_KEY);
  assert.equal(primary.requests.at(-1)?.authorization, 'Bearer ' + primaryConfig.apiKey);
  assert.deepEqual(usage, { requests: 2, inputTokens: 11, outputTokens: 7, unknownUsageCount: 1 });
  const restarted = await new LlmAttemptLedger(dir).read(requestId);
  assert.equal(restarted.endpoints.primary.failureRate, 1);
  assert.equal(restarted.endpoints.backup.failureRate, 0);
  assert.equal(restarted.endpoints.primary.usage.promptTokens, null);
  assert.equal(restarted.endpoints.primary.usage.totalTokens, 0);
  assert.equal(restarted.endpoints.primary.knownUsage.totalTokens, 1);
  assert.equal(restarted.endpoints.primary.errors.LLM_RATE_LIMITED, 1);
  assert.equal(restarted.endpoints.backup.usage.promptTokens, 11);
  assert.equal(restarted.endpoints.backup.knownUsage.completionTokens, 1);
  assert.equal(restarted.endpoints.backup.averageLatencyMs, restarted.attempts[0]?.latencyMs);
  assert.equal(restarted.attempts[0]?.model, 'reserve-light');
  assert.equal(restarted.attempts[0]?.fallback, true);
  assert.deepEqual(restarted.attempts[0]?.usage, { promptTokens: 11, completionTokens: 7 });
  assert(restarted.attempts.every((attempt) => attempt.latencyMs >= 0 && attempt.callId === light.route?.callId));

  primary.setHandler(() => ({ kind: 'delay', ms: 650, content: 'late' }));
  const timeout = await provider.complete(request);
  assert.equal(timeout.route?.attempts[0]?.errorCode, 'LLM_TIMEOUT');
  assert.equal(timeout.route?.attempts[1]?.model, 'reserve-heavy');
  const overridden = await provider.complete({ ...request, timeoutMs: 2000 });
  assert.equal(overridden.route?.fallback, false);

  const backupAttempts = backup.requests.length;
  const rejectsWithoutBackup = async (code: string, overrides?: Partial<LlmCompletionRequest>) => {
    await assert.rejects(
      provider.complete({ ...request, ...overrides }),
      (error: unknown) => error instanceof LlmError && error.code === code,
    );
    assert.equal(backup.requests.length, backupAttempts);
  };
  for (const status of [401, 403, 400]) {
    primary.setHandler(() => ({ kind: 'status', status }));
    await rejectsWithoutBackup(status === 400 ? 'LLM_PROVIDER_ERROR' : 'LLM_AUTH_FAILED');
  }
  primary.setHandler(() => ({ kind: 'raw', body: '{invalid-json' }));
  await rejectsWithoutBackup('LLM_PROVIDER_ERROR');
  primary.setHandler(() => ({
    kind: 'raw',
    body: JSON.stringify({
      usage: { total_tokens: 31 },
      choices: [{ message: { content: 'total-only response' } }],
    }),
  }));
  assert.equal((await provider.complete(request)).route?.attempts[0]?.usage?.totalTokens, 31);
  primary.setHandler(() => ({ kind: 'raw', body: JSON.stringify({ usage: { total_tokens: 7 }, choices: [] }) }));
  await assert.rejects(provider.complete(request), (error: unknown) => {
    const { route } = (error as LlmError).details as { route: { attempts: Array<{ usage: { totalTokens: number } }> } };
    return route.attempts.length === 1 && route.attempts[0]?.usage.totalTokens === 7;
  });
  const beforeCancel = primary.requests.length;
  await rejectsWithoutBackup('LLM_CANCELLED', { signal: AbortSignal.abort() });
  assert.equal(primary.requests.length, beforeCancel);
  const duringSave = new AbortController();
  const cancelledUsage = { requests: 0, inputTokens: 0, outputTokens: 0, unknownUsageCount: 0 };
  await runInAutomationContext(
    { runId: randomUUID(), usage: cancelledUsage, save: async () => duringSave.abort() },
    () => rejectsWithoutBackup('LLM_CANCELLED', { signal: duringSave.signal }),
  );
  assert.equal(cancelledUsage.requests, 0);
  assert.equal(primary.requests.length, beforeCancel);

  primary.setHandler(() => ({ kind: 'delay', ms: 650 }));
  const abort = new AbortController();
  const cancelled = provider.complete({ ...request, timeoutMs: 2000, signal: abort.signal });
  const checked = assert.rejects(
    cancelled,
    (error: unknown) => error instanceof LlmError && error.code === 'LLM_CANCELLED',
  );
  while (primary.requests.length === beforeCancel) await new Promise((resolve) => setTimeout(resolve, 10));
  abort.abort();
  await checked;
  assert.equal(backup.requests.length, backupAttempts);
  assert.equal((await ledger.read()).endpoints.primary.cancellations, 1);

  primary.setHandler(() => ({ kind: 'status', status: 503 }));
  backup.setHandler(() => ({ kind: 'status', status: 502 }));
  await assert.rejects(provider.complete(request), (error: unknown) => {
    const { route } = (error as LlmError).details as { route: { attempts: Array<{ upstreamStatus: number }> } };
    return route.attempts.map(({ upstreamStatus }) => upstreamStatus).join() === '503,502';
  });
  assert.equal(backup.requests.length, backupAttempts + 1);
  assert.deepEqual(availability().heavy, { available: false, reason: 'unavailable' });
  const changedKey = availability('replacement-key');
  assert.equal(changedKey.heavy.available, true);
  assert.equal(changedKey.primary.configuration, 'configured');
  if (changedKey.primary.configuration === 'configured') assert.equal(changedKey.primary.heavy.status, 'unverified');
  const saved = await readFile(path.join(dir, 'state', 'llm-routing', 'attempts.jsonl'), 'utf8');
  for (const secret of [request.user, request.system, primaryConfig.apiKey, env.FMCG_LLM_BACKUP_API_KEY])
    assert(!saved.includes(secret));
  const disabled = new ProviderRouter(
    loadRouterConfig(primaryConfig, { ...env, FMCG_LLM_BACKUP_ENABLED: 'false' }, {})!,
    ledger,
  );
  await assert.rejects(disabled.complete(request), LlmError);
  assert.equal(backup.requests.length, backupAttempts + 1);
  assert.equal(loadRouterConfig(primaryConfig, {}, {})?.primary?.light.model, 'main-heavy');
  assert.equal(
    loadRouterConfig(primaryConfig, { ...env, FMCG_LLM_BACKUP_LIGHT_MODEL: '' }, {})?.backup?.light.model,
    'reserve-heavy',
  );
  assert.equal(
    loadRouterConfig(primaryConfig, { ...env, FMCG_LLM_BACKUP_BASE_URL: 'incorrect' }, {})?.backup,
    undefined,
  );
  assert.equal(loadRouterConfig(primaryConfig, { FMCG_LLM_ENABLED: 'false' }, {}), undefined);
  assert.equal(loadRouterConfig({ ...primaryConfig, apiKey: '' }, {}, {}), undefined);
  const backupOnly = new ProviderRouter(
    loadRouterConfig({ ...primaryConfig, apiKey: '' }, { ...env, FMCG_LLM_ENABLED: 'false' }, {})!,
    ledger,
  );
  backup.setHandler(() => response);
  const primaryCount = primary.requests.length;
  const direct = await backupOnly.complete({ ...request, timeoutMs: 1200 });
  assert.equal(direct.route?.fallback, false);
  assert.equal(direct.route?.attempts[0]?.endpoint, 'backup');
  assert.equal(direct.route?.attempts[0]?.timeoutMs, 1200);
  assert.equal(primary.requests.length, primaryCount);

  primary.setHandler((call) =>
    call.authorization === 'Bearer ' + env.FMCG_LLM_BACKUP_API_KEY ? response : { kind: 'status', status: 429 },
  );
  const sameGateway = {
    ...env,
    FMCG_LLM_BACKUP_BASE_URL: primary.url,
    FMCG_LLM_BACKUP_MODEL: primaryConfig.model,
  };
  const switched = await new ProviderRouter(loadRouterConfig(primaryConfig, sameGateway, {})!, ledger).complete(
    request,
  );
  assert.equal(switched.route?.fallback, true);
  assert.deepEqual(
    primary.requests.slice(-2).map((call) => call.authorization),
    ['Bearer ' + primaryConfig.apiKey, 'Bearer ' + env.FMCG_LLM_BACKUP_API_KEY],
  );
  const identical = loadRouterConfig(
    primaryConfig,
    { ...sameGateway, FMCG_LLM_BACKUP_API_KEY: primaryConfig.apiKey },
    {},
  )!;
  await assert.rejects(new ProviderRouter(identical, ledger).complete(request), LlmError);
  assert.equal(primary.requests.length, primaryCount + 3);
});

test('endpoint totals include attempts older than the recent list', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aipm-3-1-totals-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = new LlmAttemptLedger(dir);
  for (let index = 0; index < 102; index++) {
    await ledger.append({
      callId: randomUUID(),
      tier: 'heavy',
      endpoint: 'primary',
      label: '主 Provider',
      provider: 'openai-compatible',
      model: 'test',
      startedAt: new Date().toISOString(),
      latencyMs: 10,
      fallback: false,
      outcome: index === 0 ? 'failure' : 'success',
      ...(index === 0 ? { errorCode: 'LLM_RATE_LIMITED' } : { usage: { totalTokens: 2 } }),
    });
  }
  const report = await new LlmAttemptLedger(dir).read();
  assert.equal(report.attempts.length, 100);
  assert.equal(report.endpoints.primary.attempts, 102);
  assert.equal(report.endpoints.primary.averageLatencyMs, 10);
  assert.equal(report.endpoints.primary.failureRate, 1 / 102);
  assert.equal(report.endpoints.primary.errors.LLM_RATE_LIMITED, 1);
  assert.equal(report.endpoints.primary.usage.totalTokens, 202);
});
