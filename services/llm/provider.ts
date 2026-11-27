// B04: one backend Provider adapter (OpenAI-compatible Chat Completions, non-streaming).
// Nothing here is provider-specific beyond the documented wire format, and no key or full
// provider response is ever put into an error message, cause or log line.
import { containsKnownSecret, safeBaseUrl, validateApiKey, validateModel, type LlmConfig } from './config.ts';
import type { StructuredOutput } from './openai-structured.ts';
import type { LlmRouteEvidence } from './provider-router.ts';

export const llmNetworkCauses = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
] as const;

export class LlmError extends Error {
  upstreamStatus?: number;

  constructor(
    public code: string,
    message: string,
    public status = 502,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type LlmCompletionRequest = {
  system: string;
  user: string;
  timeoutMs?: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  purpose?: 'knowledge' | 'prompt' | 'diagnostic';
  tier?: 'heavy' | 'light';
  structuredOutput?: StructuredOutput;
  image?: Buffer;
  media?: { format: 'json_schema' | 'json_object'; omitTemperature?: boolean; completionTokenField?: boolean };
};
export type LlmCompletion = {
  text: string;
  finishReason: string | null;
  bytes: number;
  /** text remains the original response; the caller owns wire decoding. */
  structuredOutputApplied?: true;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  route?: LlmRouteEvidence;
};

export const DEFAULT_LLM_TIMEOUT_MS = 45_000;

type WireUsage = { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
function readUsage(value?: WireUsage): LlmCompletion['usage'] {
  const tokens = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined);
  const promptTokens = tokens(value?.prompt_tokens);
  const completionTokens = tokens(value?.completion_tokens);
  const totalTokens = tokens(value?.total_tokens);
  if (promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined)
    return { promptTokens, completionTokens, totalTokens };
}
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Non-secret endpoint identity used only to bind validated extraction checkpoints. */
  readonly cacheIdentity?: string;
  /** Credentials this provider holds; used to guarantee they never reach an error surface. */
  readonly secrets?: readonly string[];
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}

export const REDACTED = '[redacted]';

/** Reject any provider result that contains a credential in a parsed JSON key or value. */
export function assertNoKnownSecret(value: unknown, secrets: readonly string[] = []): void {
  const known = secrets.filter((secret) => typeof secret === 'string' && secret.length > 0);
  if (!known.length) return;
  const contains = (text: string) => known.some((secret) => text.includes(secret));
  const visit = (item: unknown): boolean => {
    if (typeof item === 'string') return contains(item);
    if (Array.isArray(item)) return item.some(visit);
    if (item && typeof item === 'object') {
      return Object.entries(item as Record<string, unknown>).some(([key, child]) => contains(key) || visit(child));
    }
    return false;
  };
  if (visit(value)) {
    throw new LlmError('LLM_OUTPUT_CONTAINS_SECRET', 'Provider 输出包含服务端凭证，已拒绝该结果。', 502);
  }
}

/**
 * F04-10: removes anything key-shaped, header-shaped or equal to a known secret before it reaches
 * a message, an error detail, a persisted job record or a log line. `secrets` are the credentials
 * this process actually holds, so an exact (or long-fragment) echo is always redacted.
 */
export function sanitizeProviderText(value: unknown, secrets: readonly string[] = []): string {
  let text = typeof value === 'string' ? value : String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    text = text.split(secret).join(REDACTED);
    if (secret.length < 6) continue;
    for (const size of [Math.min(32, secret.length), 16, 10]) {
      if (secret.length < size) continue;
      text = text.split(secret.slice(0, size)).join(REDACTED);
      text = text.split(secret.slice(secret.length - size)).join(REDACTED);
    }
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, REDACTED)
    .replace(/\b(sk|rk|pk|api[_-]?key|apikey|key|token|secret|password)[-_:= ]{0,2}[A-Za-z0-9._~+/-]{8,}/gi, REDACTED)
    .replace(/\b[A-Za-z0-9_+/-]{40,}\b/g, REDACTED)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Deep-walks an error payload and sanitizes every string so nothing secret is ever persisted. */
export function sanitizeDeep<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === 'string') return sanitizeProviderText(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, secrets)) as unknown as T;
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const safeKey =
        /authorization|api[-_]?key/i.test(key) ||
        secrets.some((secret) => typeof secret === 'string' && secret.length > 0 && key.includes(secret))
          ? REDACTED
          : sanitizeProviderText(key, secrets);
      result[safeKey] = /authorization|api[-_]?key/i.test(key) ? REDACTED : sanitizeDeep(item, secrets);
    }
    return result as unknown as T;
  }
  return value;
}

/** Shape description of provider text that failed to parse — never the raw text (F04-10). */
export function describeUnparsable(
  text: string,
  secrets: readonly string[] = [],
): { length: number; startsWith: string; preview: string } {
  const trimmed = text.trim();
  const sanitized = sanitizeProviderText(trimmed, secrets);
  return {
    length: text.length,
    startsWith: sanitized.slice(0, 8).replace(/[^\x20-\x7e]/gu, '?'),
    preview: sanitized.slice(0, 120) || '(空白)',
  };
}

/** Reads a response body while enforcing the byte budget, so an over-limit answer fails loudly. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new LlmError(
      'LLM_RESPONSE_TOO_LARGE',
      `Provider 响应 ${declared} 字节，超过单次输出上限 ${maxBytes} 字节。`,
      502,
    );
  }
  // A body-less Fetch response has no bytes to consume. Avoid response.text(), which offers
  // no incremental byte control if a nonstandard adapter supplies it without a stream.
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new LlmError(
        'LLM_RESPONSE_TOO_LARGE',
        `Provider 响应超过单次输出上限 ${maxBytes} 字节（已读取 ${total} 字节）。`,
        502,
      );
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString('utf8');
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  constructor(private readonly config: LlmConfig) {}
  get model() {
    return this.config.model;
  }
  get cacheIdentity() {
    try {
      const url = new URL(this.config.baseUrl);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/u, '')}`;
    } catch {
      return this.name;
    }
  }
  get secrets(): readonly string[] {
    return [...new Set([this.config.apiKey, ...(this.config.knownSecrets ?? [])].filter(Boolean))];
  }
  matchesTarget(other: OpenAiCompatibleProvider): boolean {
    return (
      this.cacheIdentity === other.cacheIdentity &&
      this.model === other.model &&
      this.config.apiKey === other.config.apiKey
    );
  }

  private async httpError(response: Response, maxBytes: number, media: boolean): Promise<LlmError> {
    const body = await readCapped(response, maxBytes);
    let detail = sanitizeProviderText(body, this.secrets);
    let parameter: string | undefined;
    let errorCode: string | undefined;
    let usage: LlmCompletion['usage'];
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: unknown; param?: unknown; code?: unknown };
        usage?: WireUsage;
      };
      usage = readUsage(parsed?.usage);
      const message = parsed?.error?.message;
      if (message !== undefined) detail = sanitizeProviderText(message, this.secrets);
      if (typeof parsed?.error?.param === 'string') parameter = parsed.error.param;
      if (typeof parsed?.error?.code === 'string') errorCode = parsed.error.code;
    } catch {
      /* keep the sanitized raw snippet */
    }
    const suffix = detail && !media ? `（Provider 说明：${detail}）` : '';
    const upstream =
      media || usage
        ? { ...(media ? { upstreamStatus: response.status } : {}), ...(usage ? { usage } : {}) }
        : undefined;
    if (response.status === 401 || response.status === 403) {
      return new LlmError(
        'LLM_AUTH_FAILED',
        `Provider 拒绝鉴权（HTTP ${response.status}）。请检查服务端 API Key 配置。${suffix}`,
        response.status,
        upstream,
      );
    }
    if (response.status === 429) {
      return new LlmError('LLM_RATE_LIMITED', `Provider 限流（HTTP 429），请稍后重试。${suffix}`, 429, upstream);
    }
    if (response.status >= 500) {
      return new LlmError(
        'LLM_PROVIDER_ERROR',
        `Provider 服务错误（HTTP ${response.status}）。${suffix}`,
        502,
        upstream,
      );
    }
    const recognizedParameter = /response_format|json_schema/iu.test(parameter ?? detail)
      ? 'response_format'
      : /temperature/iu.test(parameter ?? detail)
        ? 'temperature'
        : /max_tokens|max_completion_tokens/iu.test(parameter ?? detail)
          ? 'max_tokens'
          : undefined;
    if (media && [400, 415, 422].includes(response.status)) {
      const imageInputRejected =
        /^(?:invalid_image(?:_url|_format|_mode|_size)?|unsupported_image(?:_format)?|image_(?:too_large|parse_error)|invalid_base64_image)$/iu.test(
          errorCode ?? '',
        ) ||
        /\bimage_url\b|\bimage (?:input|format|type)\b|\bvision (?:input|is not supported)\b/iu.test(
          `${parameter ?? ''} ${detail}`,
        );
      if (!recognizedParameter && imageInputRejected)
        return new LlmError('LLM_IMAGE_REJECTED', 'Provider 拒绝本次图像输入。', 422, upstream);
    }
    return new LlmError(
      'LLM_PROVIDER_ERROR',
      `Provider 请求失败（HTTP ${response.status}）。${suffix}`,
      502,
      media
        ? {
            ...upstream,
            parameter: recognizedParameter,
          }
        : upstream,
    );
  }

  async complete(
    request: LlmCompletionRequest,
    dispatch?: (send: () => Promise<LlmCompletion>) => Promise<LlmCompletion>,
  ): Promise<LlmCompletion> {
    if (!this.config.baseUrl || !this.config.model || !this.config.apiKey) {
      throw new LlmError(
        'LLM_NOT_CONFIGURED',
        '尚未配置产品 LLM Provider（FMCG_LLM_BASE_URL / FMCG_LLM_MODEL / FMCG_LLM_API_KEY）。',
        400,
      );
    }
    let baseUrl: string;
    let model: string;
    try {
      baseUrl = safeBaseUrl(this.config.baseUrl);
      model = validateModel(this.config.model);
      validateApiKey(this.config.apiKey);
    } catch {
      throw new LlmError('LLM_CONFIGURATION_INVALID', 'Provider 配置无效，已拒绝请求。', 400);
    }
    const secrets = this.secrets;
    if ([this.config.baseUrl, baseUrl, this.config.model, model].some((value) => containsKnownSecret(value, secrets))) {
      throw new LlmError('LLM_CONFIGURATION_INVALID', 'Provider 地址或模型包含 API Key，已拒绝请求。', 400);
    }
    const host = new URL(baseUrl).hostname.toLowerCase();
    const defaultTemperature = host === 'api.openai.com' && model === 'gpt-6.1-terra';
    const structured = defaultTemperature && request.purpose === 'knowledge' && request.structuredOutput;
    const media = request.media;
    const mediaSchema = media?.format === 'json_schema' && request.structuredOutput;
    const officialReasoning = host === 'api.openai.com' && /^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/iu.test(model);
    const constrainedFlash =
      (request.purpose === 'knowledge' || request.purpose === 'prompt') &&
      ['open.bigmodel.cn', 'api.z.ai'].includes(host) &&
      model.trim().toLowerCase() === 'glm-5.3-flash';
    const url = baseUrl + '/chat/completions';
    let userContent:
      string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = request.user;
    if (request.image !== undefined) {
      const signature = Buffer.isBuffer(request.image) ? request.image.subarray(0, 8).toString('hex') : '';
      const mime =
        signature === '89504e470d0a1a0a'
          ? 'image/png'
          : media && signature.startsWith('ffd8ff')
            ? 'image/jpeg'
            : undefined;
      if (!Buffer.isBuffer(request.image) || request.image.length > 5 * 1024 * 1024 || !mime) {
        throw new LlmError(
          'LLM_IMAGE_INVALID',
          media ? '精读图像需为不超过 5 MiB 的本地 PNG 或 JPEG。' : '图像请求只接受大小有界的本地 PNG 页面。',
          422,
        );
      }
      userContent = [
        { type: 'text', text: request.user },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${request.image.toString('base64')}` } },
      ];
    }
    if (request.signal?.aborted) throw new LlmError('LLM_CANCELLED', '调用已被取消。', 409);
    const send = () =>
      this.send(request, url, model, userContent, {
        defaultTemperature,
        structured,
        media,
        mediaSchema,
        officialReasoning,
        constrainedFlash,
      });
    return dispatch ? dispatch(send) : send();
  }

  private async send(
    request: LlmCompletionRequest,
    url: string,
    model: string,
    userContent: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>,
    {
      defaultTemperature,
      structured,
      media,
      mediaSchema,
      officialReasoning,
      constrainedFlash,
    }: {
      defaultTemperature: boolean;
      structured: false | StructuredOutput | undefined;
      media: LlmCompletionRequest['media'];
      mediaSchema: false | StructuredOutput | undefined;
      officialReasoning: boolean;
      constrainedFlash: boolean;
    },
  ) {
    const timeoutMs = request.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    if (request.signal?.aborted) throw new LlmError('LLM_CANCELLED', '调用已被取消。', 409);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    let upstreamStatus: number | undefined;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model,
          stream: false,
          ...(media
            ? {
                ...(media.omitTemperature || officialReasoning ? {} : { temperature: 0.1 }),
                ...(media.completionTokenField || officialReasoning
                  ? { max_completion_tokens: 1536 }
                  : { max_tokens: 1536 }),
              }
            : defaultTemperature
              ? {}
              : { temperature: 0 }),
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: userContent },
          ],
          ...(constrainedFlash ? { reasoning_effort: 'low', response_format: { type: 'json_object' } } : {}),
          ...(structured
            ? { response_format: { type: 'json_schema', json_schema: { ...structured, strict: true } } }
            : {}),
          ...(mediaSchema
            ? { response_format: { type: 'json_schema', json_schema: { ...mediaSchema, strict: true } } }
            : media
              ? { response_format: { type: 'json_object' } }
              : {}),
        }),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok) {
        upstreamStatus = response.status;
        throw await this.httpError(response, request.maxOutputBytes, !!media);
      }
      const text = await readCapped(response, request.maxOutputBytes);
      let payload: {
        choices?: Array<{ message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }>;
        usage?: WireUsage;
        error?: { message?: unknown };
      };
      try {
        payload = JSON.parse(text) as typeof payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SyntaxError();
      } catch {
        throw new LlmError('LLM_PROVIDER_ERROR', 'Provider 返回的不是合法 JSON 响应。', 502, {
          category: 'response_invalid',
          bytes: Buffer.byteLength(text, 'utf8'),
          finishReason: null,
        });
      }
      const usage = readUsage(payload.usage);
      if (payload.error)
        throw new LlmError(
          'LLM_PROVIDER_ERROR',
          media
            ? 'Provider 返回错误。'
            : `Provider 返回错误：${sanitizeProviderText(payload.error.message, this.secrets)}`,
          502,
          usage ? { usage } : undefined,
        );
      const choice = payload.choices?.[0];
      const finishReason =
        typeof choice?.finish_reason === 'string' &&
        ['stop', 'length', 'content_filter', 'tool_calls'].includes(choice.finish_reason)
          ? choice.finish_reason
          : null;
      const content = choice?.message?.content;
      const responseDetails = {
        category: 'response_invalid',
        finishReason,
        bytes: typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : 0,
        usage,
      };
      if ((structured || mediaSchema) && choice?.message?.refusal != null)
        throw new LlmError('LLM_REFUSAL', 'Provider 拒绝本次结构化输出，未产生草稿。', 502, responseDetails);
      if ((structured || mediaSchema) && finishReason !== 'stop' && finishReason !== 'length')
        throw new LlmError('LLM_PROVIDER_ERROR', 'Provider 未正常完成结构化输出，未产生草稿。', 502, responseDetails);
      if (finishReason === 'length') {
        throw new LlmError(
          'LLM_OUTPUT_TRUNCATED',
          'Provider 输出被截断（finish_reason=length），已拒绝当作完整结果。',
          502,
          responseDetails,
        );
      }
      if (typeof content !== 'string' || !content.trim()) {
        throw new LlmError('LLM_EMPTY_RESULT', 'Provider 返回了空结果，未产生任何知识建议。', 502, responseDetails);
      }
      return {
        text: content,
        finishReason,
        bytes: Buffer.byteLength(content, 'utf8'),
        usage,
        ...(structured || mediaSchema ? { structuredOutputApplied: true as const } : {}),
      };
    } catch (error) {
      let failure: LlmError;
      if (request.signal?.aborted) failure = new LlmError('LLM_CANCELLED', '调用已被取消。', 409);
      else if (error instanceof LlmError) failure = error;
      else if (timedOut)
        failure = new LlmError('LLM_TIMEOUT', `调用 Provider 超过 ${timeoutMs} ms 超时上限，未产生草稿。`, 504);
      else if (media) {
        const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
        const networkCause = llmNetworkCauses.find((code) => code === cause?.code);
        failure = new LlmError('LLM_NETWORK_ERROR', 'Provider 网络请求失败。', 502, { networkCause });
      } else {
        failure = new LlmError(
          'LLM_NETWORK_ERROR',
          `调用 Provider 失败：${sanitizeProviderText(error instanceof Error ? error.message : error, this.secrets)}`,
          502,
        );
      }
      failure.upstreamStatus = upstreamStatus;
      throw failure;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
  }
}
