import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { getAutomationContext, meterAutomationCall } from '../automation/context.ts';
import { SerialQueue } from '../storage/files.ts';
import {
  LLM_BACKUP_KEY_ENV,
  containsKnownSecret,
  envValue,
  getRoutingSecrets,
  safeBaseUrl,
  validateApiKey,
  validateModel,
  type LlmConfig,
} from './config.ts';
import {
  DEFAULT_LLM_TIMEOUT_MS,
  assertNoKnownSecret,
  LlmError,
  OpenAiCompatibleProvider,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
} from './provider.ts';

type Tier = NonNullable<LlmCompletionRequest['tier']>;
type Endpoint = 'primary' | 'backup' | 'embedding';
export type ChatEndpoint = Exclude<Endpoint, 'embedding'>;
export type ChatTier = Tier;
type Usage = NonNullable<LlmCompletion['usage']>;
export type LlmRouteAttempt = {
  endpoint: Endpoint;
  label: string;
  provider: string;
  model: string;
  startedAt: string;
  latencyMs: number;
  timeoutMs?: number;
  outcome: 'success' | 'failure';
  errorCode?: string;
  upstreamStatus?: number;
  usage?: Usage;
};
export type LlmRouteEvidence = {
  callId: string;
  tier: Tier;
  fallback: boolean;
  attempts: LlmRouteAttempt[];
};
type AttemptRecord = LlmRouteAttempt & {
  callId: string;
  fallback: boolean;
  requestId?: string;
  runId?: string;
  tier: Tier | 'embedding';
  purpose?: LlmCompletionRequest['purpose'];
  fallbackFrom?: { errorCode?: string; upstreamStatus?: number };
};

export const llmRequestContext = new AsyncLocalStorage<string>();
const optionNames = {
  enabled: 'FMCG_LLM_ENABLED',
  label: 'FMCG_LLM_LABEL',
  lightModel: 'FMCG_LLM_LIGHT_MODEL',
  backupEnabled: 'FMCG_LLM_BACKUP_ENABLED',
  backupLabel: 'FMCG_LLM_BACKUP_LABEL',
  backupBaseUrl: 'FMCG_LLM_BACKUP_BASE_URL',
  backupKey: LLM_BACKUP_KEY_ENV,
  backupModel: 'FMCG_LLM_BACKUP_MODEL',
  backupLightModel: 'FMCG_LLM_BACKUP_LIGHT_MODEL',
  timeoutMs: 'FMCG_LLM_TIMEOUT_MS',
  backupTimeoutMs: 'FMCG_LLM_BACKUP_TIMEOUT_MS',
} as const;

type RouteEndpoint = Record<Tier, OpenAiCompatibleProvider> & {
  id: ChatEndpoint;
  label: string;
  timeoutMs: number;
};
type RouterConfig = {
  primary?: RouteEndpoint;
  backup?: RouteEndpoint;
  preferred: RouteEndpoint;
};

export function loadRouterConfig(
  main: LlmConfig,
  env: NodeJS.ProcessEnv,
  local: Record<string, string>,
): RouterConfig | undefined {
  return resolveRouterConfig(main, env, local).routing;
}

export function resolveRouterConfig(main: LlmConfig, env: NodeJS.ProcessEnv, local: Record<string, string>) {
  const get = (name: string) => envValue(env, name) || local[name] || '';
  const knownSecrets = [
    ...new Set([main.apiKey, ...(main.knownSecrets ?? []), ...getRoutingSecrets(env, local)].filter(Boolean)),
  ];
  const endpoint = (
    id: RouteEndpoint['id'],
    config: LlmConfig,
    lightModel: string,
    label: string,
    timeout: number,
  ): RouteEndpoint | undefined => {
    if (!config.baseUrl || !config.apiKey || !config.model) return undefined;
    try {
      const baseUrl = safeBaseUrl(config.baseUrl);
      const apiKey = validateApiKey(config.apiKey);
      const model = validateModel(config.model);
      const light = lightModel ? validateModel(lightModel) : model;
      if ([config.baseUrl, baseUrl, model, light].some((value) => containsKnownSecret(value, knownSecrets)))
        return undefined;
      const heavy = new OpenAiCompatibleProvider({ ...config, baseUrl, apiKey, model, knownSecrets });
      const defaultLabel = id === 'primary' ? '主 Provider' : '备用 Provider';
      return {
        id,
        label:
          label &&
          label.length <= 80 &&
          [...label].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) &&
          !containsKnownSecret(label, knownSecrets)
            ? label
            : defaultLabel,
        timeoutMs:
          Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2_147_483_647 ? timeout : DEFAULT_LLM_TIMEOUT_MS,
        heavy,
        light:
          light === model
            ? heavy
            : new OpenAiCompatibleProvider({ ...config, baseUrl, apiKey, model: light, knownSecrets }),
      };
    } catch {
      return undefined;
    }
  };
  const primaryEnabled = get(optionNames.enabled).toLowerCase() !== 'false';
  const backupEnabled = get(optionNames.backupEnabled).toLowerCase() === 'true';
  const primary = primaryEnabled
    ? endpoint('primary', main, get(optionNames.lightModel), get(optionNames.label), Number(get(optionNames.timeoutMs)))
    : undefined;
  const backup = backupEnabled
    ? endpoint(
        'backup',
        {
          ...main,
          baseUrl: get(optionNames.backupBaseUrl),
          apiKey: get(optionNames.backupKey),
          model: get(optionNames.backupModel),
        },
        get(optionNames.backupLightModel),
        get(optionNames.backupLabel),
        Number(get(optionNames.backupTimeoutMs)),
      )
    : undefined;
  const preferred = primary ?? backup;
  return { primaryEnabled, backupEnabled, routing: preferred ? { primary, backup, preferred } : undefined };
}

type Observation = {
  status: 'ready' | 'unavailable';
  at: string;
  errorCode?: string;
  upstreamStatus?: number;
};
type TargetStatus = Observation | { status: 'unverified' };
type ObservedTarget = { target: OpenAiCompatibleProvider; result: Observation; sequence: number };
type EndpointStatus =
  | { configuration: 'disabled' | 'unconfigured' }
  | {
      configuration: 'configured';
      label: string;
      heavyModel: string;
      lightModel: string;
      timeoutMs: number;
      heavy: TargetStatus;
      light: TargetStatus;
    };

export type LlmAvailability = {
  primary: EndpointStatus;
  backup: EndpointStatus;
  heavy: { available: boolean; reason?: 'disabled' | 'unconfigured' | 'unavailable' | 'authentication' };
  light: { available: boolean; reason?: 'disabled' | 'unconfigured' | 'unavailable' | 'authentication' };
};

const canFailOver = ({ errorCode, upstreamStatus }: Pick<LlmRouteAttempt, 'errorCode' | 'upstreamStatus'>) =>
  upstreamStatus === undefined
    ? errorCode === 'LLM_TIMEOUT' || errorCode === 'LLM_NETWORK_ERROR'
    : upstreamStatus === 408 || upstreamStatus === 429 || upstreamStatus >= 500;

export class LlmAttemptLedger {
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private writeErrors = 0;
  private readonly observations: Record<ChatEndpoint, Partial<Record<Tier | 'connection', ObservedTarget>>> = {
    primary: {},
    backup: {},
  };
  private observationSequence = 0;

  constructor(root: string) {
    this.file = path.join(root, 'state', 'llm-routing', 'attempts.jsonl');
  }

  observe(endpoint: RouteEndpoint, tier: Tier, attempt: LlmRouteAttempt): void {
    const { outcome, errorCode, upstreamStatus } = attempt;
    if (errorCode === 'LLM_CANCELLED') return;
    const target = endpoint[tier];
    const observations = this.observations[endpoint.id];
    if (outcome === 'failure' && !canFailOver(attempt) && errorCode !== 'LLM_AUTH_FAILED') return;
    const result: Observation = {
      status: outcome === 'success' ? 'ready' : 'unavailable',
      at: new Date().toISOString(),
      errorCode,
      upstreamStatus,
    };
    const observation = { target, result, sequence: ++this.observationSequence };
    observations[tier] = observation;
    const otherTier = tier === 'light' ? 'heavy' : 'light';
    if (endpoint[otherTier].matchesTarget(target)) observations[otherTier] = observation;
    if ((errorCode === 'LLM_NETWORK_ERROR' && upstreamStatus === undefined) || upstreamStatus === 401) {
      observations.connection = observation;
    } else if (outcome === 'success' || upstreamStatus) {
      for (const tracked of Object.values(this.observations)) {
        if (tracked.connection?.target.matchesConnection(target)) delete tracked.connection;
      }
    }
  }

  availability({ primaryEnabled, backupEnabled, routing }: ReturnType<typeof resolveRouterConfig>): LlmAvailability {
    const view = (enabled: boolean, endpoint?: RouteEndpoint, identicalTo?: RouteEndpoint): EndpointStatus => {
      if (!enabled) return { configuration: 'disabled' };
      if (!endpoint) return { configuration: 'unconfigured' };
      const health = (tier: Tier): TargetStatus => {
        const target = endpoint[tier];
        const direct = this.observations[endpoint.id];
        const shared =
          identicalTo && target.matchesConnection(identicalTo[tier]) ? this.observations[identicalTo.id] : {};
        return (
          [direct.connection, shared.connection, direct[tier], shared[tier]]
            .filter(
              (item, index): item is ObservedTarget =>
                !!item && (index < 2 ? target.matchesConnection(item.target) : target.matchesTarget(item.target)),
            )
            .sort((a, b) => b.sequence - a.sequence)[0]?.result ?? { status: 'unverified' }
        );
      };
      return {
        configuration: 'configured',
        label: endpoint.label,
        heavyModel: endpoint.heavy.model,
        lightModel: endpoint.light.model,
        timeoutMs: endpoint.timeoutMs,
        heavy: health('heavy'),
        light: health('light'),
      };
    };
    const primary = view(primaryEnabled, routing?.primary, routing?.backup);
    const backup = view(backupEnabled, routing?.backup, routing?.primary);
    const capability = (tier: Tier): LlmAvailability[Tier] => {
      const main = primary.configuration === 'configured' ? primary[tier] : undefined;
      const reserve = backup.configuration === 'configured' ? backup[tier] : undefined;
      if (!main && !reserve)
        return { available: false, reason: primaryEnabled || backupEnabled ? 'unconfigured' : 'disabled' };
      if (main?.status === 'unavailable' && main.errorCode === 'LLM_AUTH_FAILED')
        return { available: false, reason: 'authentication' };
      if ([main, reserve].some((health) => health && health.status !== 'unavailable')) return { available: true };
      return {
        available: false,
        reason:
          reserve?.status === 'unavailable' && reserve.errorCode === 'LLM_AUTH_FAILED'
            ? 'authentication'
            : 'unavailable',
      };
    };
    return { primary, backup, heavy: capability('heavy'), light: capability('light') };
  }

  async append(record: Omit<AttemptRecord, 'requestId' | 'runId'>): Promise<void> {
    const item: AttemptRecord = {
      ...record,
      requestId: llmRequestContext.getStore(),
      runId: getAutomationContext()?.runId,
    };
    await this.queue.run(async () => {
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await appendFile(this.file, '\n' + JSON.stringify(item), 'utf8');
      } catch {
        this.writeErrors++;
      }
    });
  }

  async read(requestId?: string) {
    return this.queue.run(async () => {
      const empty = () => ({
        attempts: 0,
        failures: 0,
        cancellations: 0,
        failureRate: null as number | null,
        totalLatencyMs: 0,
        averageLatencyMs: null as number | null,
        errors: Object.create(null) as Record<string, number>,
        usage: { promptTokens: null, completionTokens: null, totalTokens: null } as Record<keyof Usage, number | null>,
        knownUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
      const endpoints = { primary: empty(), backup: empty(), embedding: empty() };
      const recent: AttemptRecord[] = [];
      const switches: Array<{
        at: string;
        tier: AttemptRecord['tier'];
        errorCode?: string;
        upstreamStatus?: number;
        outcome: AttemptRecord['outcome'];
      }> = [];
      let unreadableRecords = 0;
      const lines = createInterface({ input: createReadStream(this.file, { encoding: 'utf8' }), crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line) continue;
          let item: AttemptRecord;
          try {
            item = JSON.parse(line) as AttemptRecord;
            if (
              !item ||
              !Object.hasOwn(endpoints, item.endpoint) ||
              !['success', 'failure'].includes(item.outcome) ||
              !Number.isFinite(item.latencyMs) ||
              item.latencyMs < 0
            ) {
              unreadableRecords++;
              continue;
            }
          } catch {
            unreadableRecords++;
            continue;
          }
          if (requestId && item.requestId !== requestId && item.runId !== requestId) continue;
          const endpoint = endpoints[item.endpoint];
          endpoint.attempts++;
          endpoint.totalLatencyMs += item.latencyMs;
          if (item.errorCode) endpoint.errors[item.errorCode] = (endpoint.errors[item.errorCode] ?? 0) + 1;
          if (item.errorCode === 'LLM_CANCELLED' || item.errorCode === 'EMBEDDING_ABORTED') endpoint.cancellations++;
          else if (item.outcome === 'failure') endpoint.failures++;
          for (const field of ['promptTokens', 'completionTokens', 'totalTokens'] as const) {
            const tokens = item.usage?.[field];
            if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) continue;
            endpoint.usage[field] = (endpoint.usage[field] ?? 0) + tokens;
            endpoint.knownUsage[field]++;
          }
          if (item.endpoint === 'backup' && item.fallback) {
            const origin =
              item.fallbackFrom ??
              recent.find((attempt) => attempt.callId === item.callId && attempt.endpoint === 'primary');
            switches.push({
              at: item.startedAt,
              tier: item.tier,
              errorCode: origin?.errorCode,
              upstreamStatus: origin?.upstreamStatus,
              outcome: item.outcome,
            });
            if (switches.length > 5) switches.shift();
          }
          recent.push(item);
          if (recent.length > 100) recent.shift();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      } finally {
        lines.close();
      }
      for (const endpoint of Object.values(endpoints)) {
        const completed = endpoint.attempts - endpoint.cancellations;
        if (completed) endpoint.failureRate = endpoint.failures / completed;
        if (endpoint.attempts) endpoint.averageLatencyMs = endpoint.totalLatencyMs / endpoint.attempts;
      }
      return {
        endpoints,
        attempts: recent.reverse(),
        switches: switches.reverse(),
        unreadableRecords,
        writeErrors: this.writeErrors,
      };
    });
  }
}

export class ProviderRouter implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly secrets: readonly string[];
  readonly cacheIdentity: string;

  constructor(
    private readonly config: RouterConfig,
    private readonly ledger: LlmAttemptLedger,
  ) {
    const { preferred, primary, backup } = config;
    this.name = preferred.heavy.name;
    this.model = preferred.heavy.model;
    this.secrets = preferred.heavy.secrets;
    this.cacheIdentity =
      primary && backup && !primary.heavy.matchesTarget(backup.heavy)
        ? 'route:' +
          createHash('sha256')
            .update(JSON.stringify([primary.heavy.cacheIdentity, backup.heavy.cacheIdentity, backup.heavy.model]))
            .digest('hex')
        : preferred.heavy.cacheIdentity;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    assertNoKnownSecret([request.system, request.user], this.secrets);
    const tier = request.tier ?? 'heavy';
    const { preferred, primary, backup } = this.config;
    const route: LlmRouteEvidence = { callId: randomUUID(), tier, fallback: false, attempts: [] };
    const attempt = (endpoint: RouteEndpoint) => {
      const target = endpoint[tier];
      const timeoutMs = request.timeoutMs ?? endpoint.timeoutMs;
      return target.complete({ ...request, timeoutMs }, (send) =>
        meterAutomationCall(async () => {
          const startedAt = new Date().toISOString();
          const start = performance.now();
          const record: LlmRouteAttempt = {
            endpoint: endpoint.id,
            label: endpoint.label,
            provider: target.name,
            model: target.model,
            startedAt,
            latencyMs: 0,
            timeoutMs,
            outcome: 'failure',
          };
          try {
            const result = await send();
            record.usage = result.usage;
            assertNoKnownSecret(result.text, this.secrets);
            record.outcome = 'success';
            return result;
          } catch (error) {
            record.errorCode = 'LLM_NETWORK_ERROR';
            if (error instanceof LlmError) {
              const details = error.details as { usage?: Usage } | undefined;
              record.errorCode = error.code;
              record.upstreamStatus = error.upstreamStatus;
              record.usage ??= details?.usage;
            }
            throw error;
          } finally {
            record.latencyMs = Math.round(performance.now() - start);
            route.attempts.push(record);
            route.fallback = route.attempts.length === 2;
            const origin = route.fallback ? route.attempts[0] : undefined;
            this.ledger.observe(endpoint, tier, record);
            await this.ledger.append({
              callId: route.callId,
              tier,
              fallback: route.fallback,
              purpose: request.purpose,
              fallbackFrom: origin && { errorCode: origin.errorCode, upstreamStatus: origin.upstreamStatus },
              ...record,
            });
          }
        }, request.signal),
      );
    };
    try {
      let completion: LlmCompletion;
      try {
        completion = await attempt(preferred);
      } catch (error) {
        const failed = route.attempts[0];
        if (
          !primary ||
          !backup ||
          primary[tier].matchesTarget(backup[tier]) ||
          request.signal?.aborted ||
          !failed ||
          failed.outcome !== 'failure' ||
          !canFailOver(failed)
        )
          throw error;
        completion = await attempt(backup);
      }
      return { ...completion, route };
    } catch (error) {
      if (error instanceof LlmError && route.attempts.length)
        error.details = { ...(error.details as object | undefined), route };
      throw error;
    }
  }
}
