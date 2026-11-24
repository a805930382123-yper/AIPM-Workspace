import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  assertNoKnownSecret,
  LlmError,
  llmNetworkCauses,
  type LlmCompletionRequest,
  type LlmProvider,
} from '../llm/provider.ts';
import { validateSchema, type JsonSchemaNode } from '../llm/schema-validator.ts';
import { assertRawNotMeeting } from '../meeting/source-policy.ts';
import { rawMediaContext } from './media-context.ts';
import type {
  MediaArtifact,
  MediaArtifactResult,
  MediaFailure,
  VlmConfidence,
  VlmImageType,
} from './media-artifact.ts';
import type { RawStore } from './store.ts';
import { identifyWebImages, readWebImage } from './web-material.ts';

const types = [
  'flowchart',
  'comparison_table',
  'chart_or_ranking',
  'ui_screenshot',
  'text_excerpt',
  'mixed',
  'decorative',
];
const schema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['should_skip', 'image_type', 'summary', 'markdown', 'confidence', 'warnings'],
  properties: {
    should_skip: { type: 'boolean', description: '无实质信息增量时为 true。' },
    image_type: { type: 'string', enum: types },
    summary: { type: 'string', description: '不超过 40 字的单行中文摘要。' },
    markdown: { type: 'string', description: '干净紧凑的结构正文，无外层围栏。' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};
const structuredOutput = { name: 'media_vlm_extraction', schema };
const system = [
  '你是知识库的视觉信息结构化提取引擎。只取原图可见事实，不猜测、不补造数据。局部模糊写作[模糊不可辨]，在 warnings 说明。保留术语、代码标识、指标单位、大小写和语言。只输出 JSON 对象。summary 是不超过40字的中文一句话，markdown 无开场白和外层代码围栏。上下文仅供识别术语，禁止把图中没有的上下文写入结果。',
  'flowchart：用有序及嵌套列表，标明节点角色、->方向、分支条件和输入输出。comparison_table：还原 Markdown 行列和表头，按行展开合并单元格，用<br>保留格内换行。chart_or_ranking：先列坐标轴、单位和口径，再列可读数据；只陈述相对趋势或明确用“约”标注估算，不捏造精确数值。',
  'ui_screenshot：略去标签栏、状态栏、点赞等外壳，只留焦点配置、提示词与回复、日志或代码；保留内部代码围栏。text_excerpt：保留文字重点、自然段和列表层级。mixed：按信息主次组合。decorative：氛围配图、表情包、关注引导或无增量令 should_skip=true，summary、markdown 为空。',
].join('\n');

const concurrency = 3;
const sizeLimit = 5 * 1024 * 1024;
const providerErrors: Readonly<Record<string, string>> = {
  LLM_NETWORK_ERROR: '无法连接 Provider。请检查运行工作台的进程是否能访问 Provider，或是否需要代理。',
  LLM_TIMEOUT: '连接 Provider 或等待返回超时。请检查网络后重试。',
  LLM_AUTH_FAILED: 'Provider 拒绝鉴权。请检查 API Key 和模型权限。',
  LLM_CONFIGURATION_INVALID: 'Provider 配置无效。请检查模型设置。',
  LLM_NOT_CONFIGURED: '尚未配置图片精读的 Provider。',
  LLM_RATE_LIMITED: 'Provider 触发限流，请稍后重试。',
  LLM_IMAGE_REJECTED: 'Provider 拒绝图像输入。请检查当前模型是否支持 PNG 或 JPEG 的多模态请求。',
  LLM_IMAGE_INVALID: '待发送图像未通过 PNG 或 JPEG 大小校验。',
  LLM_PROVIDER_ERROR: 'Provider 返回错误。请检查模型、接口和服务状态后重试。',
  MEDIA_PROVIDER_FAILED: 'Provider 请求未完成，请重试。',
};
const responseErrors: Readonly<Record<string, string>> = {
  MEDIA_JSON_INVALID: '模型输出不是可解析的 JSON 对象。',
  MEDIA_SCHEMA_INVALID: '模型输出字段不满足图片精读结构。',
  LLM_EMPTY_RESULT: '模型没有返回可用内容。',
  LLM_OUTPUT_TRUNCATED: '模型输出被截断。',
  LLM_RESPONSE_TOO_LARGE: '模型响应超过大小限制。',
  LLM_OUTPUT_CONTAINS_SECRET: '模型结果未通过凭证检查。',
  LLM_REFUSAL: '模型拒绝生成图片精读结果。',
};

async function prepareImage(bytes: Buffer) {
  const image = await loadImage(bytes);
  if (!image.width || !image.height) return;
  const longEdge = Math.max(image.width, image.height);
  const scale = longEdge > 2048 ? 1800 / longEdge : 1;
  const canvas = createCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (!bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    const png = canvas.toBuffer('image/png');
    if (png.length <= sizeLimit) return png;
  }
  const jpeg = canvas.toBuffer('image/jpeg', 85);
  if (jpeg.length <= sizeLimit) return jpeg;
}

type ParseOptions = { provider?: LlmProvider; force?: boolean; signal?: AbortSignal };
type BatchResult = { mediaId: string; artifact?: MediaArtifact; error?: string };

export function publicMediaArtifact(artifact: MediaArtifact): Omit<MediaArtifact, 'ocrRawText'> {
  const { ocrRawText: _raw, ...publicArtifact } = artifact;
  return publicArtifact;
}

export class MediaVlmParserService {
  private readonly pending = new Map<string, Promise<MediaArtifact>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly raws: RawStore,
    private readonly saveLocked: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(),
  ) {}

  private async getRaw(rawId: string) {
    const raw = await this.raws.get(rawId);
    if (!raw) throw new LlmError('RAW_NOT_FOUND', '没有找到这条原始资料。', 404);
    assertRawNotMeeting(raw);
    return raw;
  }

  async batch(rawId: string, options: ParseOptions & { mediaIds?: string[] }): Promise<BatchResult[]> {
    const raw = await this.getRaw(rawId);
    const ids =
      options.mediaIds ??
      (await this.raws.getAnchoredMediaArtifacts(raw))
        .filter((item) => item.routeStatus === 'needs_vlm')
        .map((item) => item.mediaId);
    return Promise.all(
      ids.map(async (mediaId) => {
        try {
          return { mediaId, artifact: await this.parse(rawId, mediaId, options) };
        } catch (error) {
          return { mediaId, error: error instanceof LlmError ? error.code : 'MEDIA_STORAGE_FAILED' };
        }
      }),
    );
  }

  parse(rawId: string, mediaId: string, options: ParseOptions): Promise<MediaArtifact> {
    const key = `${rawId}/${mediaId}`;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const work = (async () => {
      if (this.active >= concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
      else this.active++;
      try {
        return await this.parseOnce(rawId, mediaId, options);
      } finally {
        const next = this.waiting.shift();
        if (next) next();
        else this.active--;
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  private async parseOnce(
    rawId: string,
    mediaId: string,
    { provider, force, signal }: ParseOptions,
  ): Promise<MediaArtifact> {
    const raw = await this.getRaw(rawId);
    const occurrence = identifyWebImages(raw.id, raw.webImages).find((image) => image.mediaId === mediaId);
    const existing = (await this.raws.getMediaArtifacts(raw.id)).find((item) => item.mediaId === mediaId);
    if (!occurrence || !existing) throw new LlmError('RAW_MEDIA_NOT_FOUND', '没有找到该图片位置的解析记录。', 404);
    const ensureAnchored = async (current: typeof raw) => {
      if (
        current !== raw &&
        !identifyWebImages(current.id, current.webImages).some((image) => image.mediaId === mediaId)
      )
        throw new LlmError('RAW_MEDIA_NOT_FOUND', '图片位置已移除。', 404);
      const source = await this.raws.mediaSource(current);
      if (!source.markers.some(({ imageIndex }) => imageIndex === occurrence.imageIndex))
        throw new LlmError('RAW_MEDIA_NOT_ANCHORED', '当前正文缺少可唯一定位的图片标记。', 409);
      return source;
    };
    await ensureAnchored(raw);
    if (!force && !['needs_vlm', 'failed'].includes(existing.routeStatus)) return existing;
    if (!provider) throw new LlmError('LLM_NOT_CONFIGURED', '尚未配置产品 LLM Provider，无法精读图片。', 400);
    const attempts: string[] = [];
    const save = (result: MediaArtifactResult) =>
      this.saveLocked(async () => {
        await ensureAnchored(await this.getRaw(rawId));
        const saved = await this.raws.saveMediaArtifact(rawId, mediaId, { ...result, vlmAttempts: attempts });
        if (!saved) throw new LlmError('RAW_MEDIA_NOT_FOUND', '图片位置已移除。', 404);
        return saved;
      });
    const { width, height, metrics, ocrRawText, ocrError, routeReasons } = existing;
    const base = {
      width,
      height,
      metrics,
      ocrRawText,
      ocrError,
      routeReasons,
      vlmModel: provider.model,
      vlmParsedAt: new Date().toISOString(),
    };
    const fail = (mediaFailure: MediaFailure, vlmError: string) => {
      console.warn('[raw-media] 精读失败', { rawId, mediaId, ...mediaFailure });
      return save({ ...base, routeStatus: 'failed', mediaFailure, vlmError });
    };
    if (!occurrence.sha256)
      return fail(
        existing.mediaFailure?.stage === 'download'
          ? existing.mediaFailure
          : { stage: 'download', code: 'MEDIA_DOWNLOAD_UNAVAILABLE' },
        existing.mediaFailure?.stage === 'download' && existing.vlmError
          ? existing.vlmError
          : '原图未保留在本机。请核对原网页或重新导入。',
      );
    const retained = await readWebImage(this.raws.root, occurrence).catch(() => undefined);
    if (!retained)
      return fail(
        { stage: 'original', code: 'MEDIA_ORIGINAL_UNAVAILABLE' },
        '无法读取本地原图，或本地字节与采集校验值不符。',
      );
    const image = await prepareImage(retained).catch(() => undefined);
    if (!image)
      return fail(
        { stage: 'image', code: 'MEDIA_IMAGE_PREPARE_FAILED' },
        '无法将原图转换为符合大小限制的 PNG 或 JPEG。',
      );
    const media: NonNullable<LlmCompletionRequest['media']> = { format: 'json_schema' };
    let transientRetry = false;
    let invalidRetry = false;
    let retryingJson = false;
    let tokenFieldRetried = false;
    for (;;) {
      if (signal?.aborted) throw new LlmError('LLM_CANCELLED', '图片精读已取消。', 409);
      const current = await this.getRaw(rawId);
      const source = await ensureAnchored(current);
      const user = JSON.stringify({
        stage: 'media_vlm_extraction',
        article_title: current.title,
        image_index: occurrence.imageIndex,
        ...rawMediaContext(current, occurrence.imageIndex, source),
      });
      let result: unknown;
      try {
        assertNoKnownSecret(user, provider.secrets);
        const completion = await provider.complete({
          image,
          timeoutMs: 45_000,
          maxOutputBytes: 64 * 1024,
          signal,
          media: { ...media },
          structuredOutput,
          system:
            system +
            (media.format === 'json_object' ? `\n字段须满足：${JSON.stringify(schema)}` : '') +
            (retryingJson ? '\n上次结果结构无效。请重新输出完整 JSON 对象。' : ''),
          user,
        });
        result = JSON.parse(completion.text);
        if (validateSchema(result, schema).length) throw new LlmError('MEDIA_SCHEMA_INVALID', '图片结构输出字段无效。');
        assertNoKnownSecret(result, provider.secrets);
      } catch (error) {
        if (signal?.aborted) throw error;
        const reportedCode =
          error instanceof LlmError
            ? error.code
            : error instanceof SyntaxError
              ? 'MEDIA_JSON_INVALID'
              : 'MEDIA_PROVIDER_FAILED';
        const code =
          Object.hasOwn(providerErrors, reportedCode) || Object.hasOwn(responseErrors, reportedCode)
            ? reportedCode
            : 'MEDIA_PROVIDER_FAILED';
        const details =
          error instanceof LlmError
            ? (error.details as
                { parameter?: string; upstreamStatus?: number; category?: string; networkCause?: string } | undefined)
            : undefined;
        attempts.push(`${media.format}:${code}`);
        if ([400, 422].includes(details?.upstreamStatus ?? 0)) {
          if (details?.parameter === 'response_format' && media.format === 'json_schema') {
            media.format = 'json_object';
            continue;
          }
          if (details?.parameter === 'temperature' && !media.omitTemperature) {
            media.omitTemperature = true;
            continue;
          }
          if (details?.parameter === 'max_tokens' && !tokenFieldRetried) {
            media.completionTokenField = true;
            tokenFieldRetried = true;
            continue;
          }
        }
        if (
          !transientRetry &&
          (['LLM_RATE_LIMITED', 'LLM_NETWORK_ERROR', 'LLM_TIMEOUT'].includes(code) ||
            (details?.upstreamStatus ?? 0) >= 500)
        ) {
          transientRetry = true;
          continue;
        }
        if (
          !invalidRetry &&
          (['MEDIA_JSON_INVALID', 'MEDIA_SCHEMA_INVALID', 'LLM_EMPTY_RESULT'].includes(code) ||
            (code === 'LLM_PROVIDER_ERROR' && details?.category === 'response_invalid'))
        ) {
          invalidRetry = true;
          retryingJson = true;
          continue;
        }
        const invalidEnvelope = code === 'LLM_PROVIDER_ERROR' && details?.category === 'response_invalid';
        const responseError = invalidEnvelope ? 'Provider 响应不符合预期的模型结果格式。' : responseErrors[code];
        const networkCause = llmNetworkCauses.find((cause) => cause === details?.networkCause);
        const httpStatus = details?.upstreamStatus;
        return fail(
          {
            stage: code === 'LLM_IMAGE_INVALID' ? 'image' : responseError ? 'response' : 'provider',
            code,
            ...(httpStatus && Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599
              ? { httpStatus }
              : {}),
            ...(networkCause ? { networkCause } : {}),
          },
          responseError ?? providerErrors[code],
        );
      }
      if (signal?.aborted) throw new LlmError('LLM_CANCELLED', '图片精读已取消。', 409);
      attempts.push(`${media.format}:ok`);
      const value = result as {
        should_skip: boolean;
        image_type: VlmImageType;
        summary: string;
        markdown: string;
        confidence: VlmConfidence;
        warnings: string[];
      };
      const markdown = value.markdown
        .trim()
        .replace(/^```(?:markdown)?[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?```$/iu, '$1')
        .trim();
      const skip = value.should_skip || value.image_type === 'decorative' || !markdown;
      return save({
        ...base,
        routeStatus: skip ? 'skipped' : 'vlm_done',
        vlmImageType: value.should_skip ? 'decorative' : value.image_type,
        vlmConfidence: value.confidence,
        vlmWarnings: value.warnings,
        ...(skip
          ? {}
          : {
              vlmSummary: [...value.summary.trim().replace(/\s*[\r\n\u2028\u2029]+\s*/gu, ' ')].slice(0, 40).join(''),
              vlmMarkdown: markdown,
            }),
      });
    }
  }
}
