import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { containsKnownSecret, envValue, safeBaseUrl, validateApiKey, validateModel } from '../llm/config.ts';

export interface EmbeddingConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number;
  indexTimeoutMs: number;
  queryTimeoutMs: number;
  batchSize: number;
}

export interface EmbeddingUsageMeta {
  provider: string;
  model: string;
  inputCount: number;
  promptTokens?: number;
  totalTokens?: number;
  durationMs: number;
}

export interface EmbeddingBatchResult {
  vectors: Float32Array[];
  dimensions: number;
  usage: EmbeddingUsageMeta;
}

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  dispatch?: (send: () => Promise<Response>) => Promise<Response>;
};

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly identity: string;
  readonly configuredDimensions?: number;
  readonly batchSize: number;
  getVersionKey(actualDimensions: number): string;
  embedTexts(texts: string[], options?: RequestOptions): Promise<EmbeddingBatchResult>;
  embedQuery(
    query: string,
    options?: RequestOptions,
  ): Promise<{ vector: Float32Array; dimensions: number; usage: EmbeddingUsageMeta }>;
}

export class EmbeddingError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(code);
  }
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function resolveEmbeddingConfig(
  env: NodeJS.ProcessEnv,
  main?: { baseUrl: string; apiKey: string; knownSecrets?: string[] },
): EmbeddingConfig | null {
  const provider = envValue(env, 'EMBEDDING_PROVIDER') || 'openai-compatible';
  const model = envValue(env, 'EMBEDDING_MODEL');
  const urlOverride = envValue(env, 'EMBEDDING_BASE_URL');
  const keyOverride = envValue(env, 'EMBEDDING_API_KEY');
  if (!model || provider !== 'openai-compatible' || !(urlOverride || main?.baseUrl) || !(keyOverride || main?.apiKey))
    return null;
  try {
    const baseUrl = safeBaseUrl(urlOverride || main!.baseUrl);
    // An independently configured endpoint must never inherit a key for a different endpoint.
    if (!keyOverride && urlOverride && (!main?.baseUrl || safeBaseUrl(main.baseUrl) !== baseUrl)) return null;
    const apiKey = validateApiKey(keyOverride || main!.apiKey);
    const secrets = [apiKey, main?.apiKey ?? '', ...(main?.knownSecrets ?? [])];
    if (containsKnownSecret(baseUrl, secrets) || containsKnownSecret(model, secrets)) return null;
    const dimensions = envValue(env, 'EMBEDDING_DIMENSIONS');
    if (dimensions && !positiveInteger(Number(dimensions))) return null;
    return {
      enabled: true,
      provider,
      baseUrl,
      apiKey,
      model: validateModel(model),
      dimensions: positiveInteger(Number(dimensions)),
      batchSize: positiveInteger(Number(envValue(env, 'EMBEDDING_BATCH_SIZE'))) ?? 32,
      indexTimeoutMs: positiveInteger(Number(envValue(env, 'EMBEDDING_INDEX_TIMEOUT_MS'))) ?? 15_000,
      queryTimeoutMs: positiveInteger(Number(envValue(env, 'EMBEDDING_QUERY_TIMEOUT_MS'))) ?? 4_000,
    };
  } catch {
    return null;
  }
}

export function embeddingInput(title: string, heading: string, kind: string, text: string): string {
  return `标题: ${title}\n章节: ${heading}\n属性: ${kind}\n${text}`.slice(0, 3000).replace(/[\ud800-\udbff]$/u, '');
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly identity: string;
  readonly configuredDimensions?: number;
  readonly batchSize: number;

  constructor(
    private readonly config: EmbeddingConfig,
    private readonly recordUsage?: (usage: EmbeddingUsageMeta, error?: string) => void,
  ) {
    this.providerName = config.provider;
    this.modelName = config.model;
    this.configuredDimensions = config.dimensions;
    this.batchSize = config.batchSize;
    this.identity = createHash('sha256')
      .update(`${config.provider}\n${config.baseUrl.replace(/\/+$/u, '')}`)
      .digest('hex');
  }

  getVersionKey(actualDimensions: number) {
    return `${this.providerName}:${this.modelName}:${actualDimensions}`;
  }

  async embedTexts(texts: string[], options: RequestOptions = {}): Promise<EmbeddingBatchResult> {
    if (!texts.length) throw new EmbeddingError('EMBEDDING_EMPTY_INPUT');
    const started = performance.now();
    let dimensions = 0;
    let promptTokens: number | undefined = 0;
    let totalTokens: number | undefined = 0;
    const vectors: Float32Array[] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const timeout = options.timeoutMs ?? this.config.indexTimeoutMs;
      const result = await this.request(batch, timeout, options).catch(async (error: unknown) => {
        if (!(error instanceof EmbeddingError) || !error.retryable) throw error;
        await setTimeout(600, undefined, { signal: options.signal });
        return this.request(batch, timeout, options);
      });
      if (dimensions && dimensions !== result.dimensions) throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
      dimensions = result.dimensions;
      vectors.push(...result.vectors);
      const { usage } = result;
      promptTokens =
        promptTokens === undefined || usage.promptTokens === undefined ? undefined : promptTokens + usage.promptTokens;
      totalTokens =
        totalTokens === undefined || usage.totalTokens === undefined ? undefined : totalTokens + usage.totalTokens;
    }
    return {
      vectors,
      dimensions,
      usage: {
        provider: this.providerName,
        model: this.modelName,
        inputCount: texts.length,
        promptTokens,
        totalTokens,
        durationMs: performance.now() - started,
      },
    };
  }

  async embedQuery(query: string, options: RequestOptions = {}) {
    const { vectors, dimensions, usage } = await this.request(
      [query],
      options.timeoutMs ?? this.config.queryTimeoutMs,
      options,
    );
    return { vector: vectors[0], dimensions, usage };
  }

  private async request(texts: string[], timeoutMs: number, options: RequestOptions): Promise<EmbeddingBatchResult> {
    let timeout: AbortSignal | undefined;
    let started = 0;
    const usage: EmbeddingUsageMeta = {
      provider: this.providerName,
      model: this.modelName,
      inputCount: texts.length,
      durationMs: 0,
    };
    let errorCode: string | undefined;
    const send = () => {
      if (options.signal?.aborted) throw new EmbeddingError('EMBEDDING_ABORTED');
      timeout = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
      started = performance.now();
      return fetch(`${this.config.baseUrl.replace(/\/+$/u, '')}/embeddings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          input: texts,
          encoding_format: 'float',
          dimensions: this.configuredDimensions,
        }),
        redirect: 'manual',
        signal,
      });
    };
    try {
      const response = await (options.dispatch ? options.dispatch(send) : send());
      if (!response.ok) {
        // Let fetch release the failed response stream without reading potentially sensitive diagnostics.
        await response.body?.cancel();
        throw new EmbeddingError(
          `EMBEDDING_HTTP_${response.status}`,
          response.status === 429 || response.status >= 500,
        );
      }
      const payload = (await response.json()) as {
        data?: Array<{ index?: unknown; embedding?: unknown }>;
        usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
      } | null;
      const { data } = payload ?? {};
      const { prompt_tokens: promptTokens, total_tokens: totalTokens } = payload?.usage ?? {};
      usage.promptTokens = positiveInteger(promptTokens) ?? (promptTokens === 0 ? 0 : undefined);
      usage.totalTokens = positiveInteger(totalTokens) ?? (totalTokens === 0 ? 0 : undefined);
      if (!Array.isArray(data) || data.length !== texts.length) throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
      const vectors = new Array<Float32Array>(texts.length);
      let dimensions = this.configuredDimensions;
      for (const entry of data) {
        const { index, embedding } = entry ?? {};
        if (
          typeof index !== 'number' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= texts.length ||
          vectors[index] ||
          !Array.isArray(embedding) ||
          !embedding.length ||
          !embedding.every(Number.isFinite)
        )
          throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
        dimensions ??= embedding.length;
        if (dimensions !== embedding.length) throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
        const scale = embedding.reduce((largest: number, value: number) => Math.max(largest, Math.abs(value)), 0);
        if (!scale) throw new EmbeddingError('EMBEDDING_INVALID_RESPONSE');
        const scaled = embedding.map((value: number) => value / scale);
        const norm = Math.sqrt(scaled.reduce((sum: number, value: number) => sum + value * value, 0));
        vectors[index] = Float32Array.from(scaled, (value) => value / norm);
      }
      return { vectors, dimensions: dimensions!, usage };
    } catch (error) {
      const failure = options.signal?.aborted
        ? new EmbeddingError('EMBEDDING_ABORTED')
        : timeout?.aborted
          ? new EmbeddingError('EMBEDDING_TIMEOUT')
          : error instanceof EmbeddingError
            ? error
            : error instanceof SyntaxError
              ? new EmbeddingError('EMBEDDING_INVALID_RESPONSE')
              : new EmbeddingError('EMBEDDING_NETWORK', true);
      errorCode = failure.code;
      throw failure;
    } finally {
      if (timeout) {
        usage.durationMs = performance.now() - started;
        this.recordUsage?.(usage, errorCode);
      }
    }
  }
}
