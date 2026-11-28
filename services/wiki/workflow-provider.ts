import {
  assertNoKnownSecret,
  LlmError,
  sanitizeDeep,
  sanitizeProviderText,
  type LlmProvider,
} from '../llm/provider.ts';
import { WikiError } from './store.ts';
import { object } from './workflow-types.ts';

export async function call(
  provider: LlmProvider,
  system: string,
  user: string,
  format: 'legacy' | 'evidence-id' | 'synthesis-locator-v1' = 'legacy',
): Promise<any> {
  let result;
  try {
    result = await provider.complete({
      system,
      user,
      timeoutMs: 90000,
      maxOutputBytes: 256_000,
      purpose: 'knowledge',
    });
  } catch (error) {
    const code =
      sanitizeProviderText((error as { code?: unknown }).code ?? 'LLM_PROVIDER_ERROR', provider.secrets) ||
      'LLM_PROVIDER_ERROR';
    const message = sanitizeProviderText(
      error instanceof Error ? error.message : 'Provider 调用失败',
      provider.secrets,
    );
    const details = (error as { details?: unknown }).details;
    throw new LlmError(
      code,
      message,
      (error as { status?: number }).status ?? 502,
      details === undefined ? undefined : sanitizeDeep(details, provider.secrets),
    );
  }
  let parsed: unknown;
  if (format !== 'legacy' && result.finishReason === 'length')
    throw new WikiError('LLM_OUTPUT_TRUNCATED', '知识建议响应被截断，未创建草稿。', 502);
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new WikiError('LLM_INVALID_JSON', 'Provider 返回的内容不是合法 JSON，未创建草稿。', 502);
  }
  assertNoKnownSecret(parsed, provider.secrets);
  if (!object(parsed)) throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回结构无效，未创建草稿。', 502);
  const allowedTopLevel = new Set(
    format === 'evidence-id'
      ? ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement']
      : [
          'title',
          'category',
          'suggestedAdditions',
          'conflicts',
          'inferences',
          'openQuestions',
          'agreement',
          ...(format === 'synthesis-locator-v1' ? ['synthesis_format_version', 'sourceLevels'] : []),
        ],
  );
  if (Object.keys(parsed).some((key) => !allowedTopLevel.has(key)))
    throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回了未定义字段，未创建草稿。', 502);
  if (
    format === 'synthesis-locator-v1' &&
    (parsed.synthesis_format_version !== 1 || Object.keys(parsed).length !== allowedTopLevel.size)
  )
    throw new WikiError('LLM_SCHEMA_INVALID', '综合建议协议版本或必填字段无效，未创建草稿。', 502);
  if (
    format === 'synthesis-locator-v1' &&
    (!Array.isArray(parsed.sourceLevels) ||
      parsed.sourceLevels.some(
        (item) =>
          !object(item) ||
          Object.keys(item).sort().join(',') !== 'rawId,source_level' ||
          typeof item.rawId !== 'string' ||
          typeof item.source_level !== 'string' ||
          !['A', 'B', 'C', 'D'].includes(item.source_level),
      ))
  )
    throw new WikiError('LLM_SCHEMA_INVALID', '综合来源等级无效，未创建草稿。', 502);
  for (const key of ['suggestedAdditions', 'conflicts', 'inferences', 'openQuestions', 'agreement']) {
    const valid =
      Array.isArray(parsed[key]) &&
      (parsed[key] as unknown[]).every((x) => {
        if (['inferences', 'openQuestions'].includes(key)) return typeof x === 'string';
        if (format === 'evidence-id') {
          const fields = key === 'agreement' ? ['text', 'evidenceId', 'existingLocatorId'] : ['text', 'evidenceId'];
          return (
            object(x) &&
            Object.keys(x).length === fields.length &&
            Object.keys(x).every((field) => fields.includes(field)) &&
            typeof x.text === 'string' &&
            !!x.text.trim() &&
            x.text.length <= 4000 &&
            fields
              .slice(1)
              .every(
                (field) =>
                  typeof x[field] === 'string' && (x[field] as string).length > 0 && (x[field] as string).length <= 128,
              )
          );
        }
        if (format === 'synthesis-locator-v1') {
          const fields = ['text', 'rawId', 'locatorId'];
          return (
            object(x) &&
            Object.keys(x).length === fields.length &&
            Object.keys(x).every((field) => fields.includes(field)) &&
            typeof x.text === 'string' &&
            !!x.text.trim() &&
            x.text.length <= 4000 &&
            fields
              .slice(1)
              .every(
                (field) =>
                  typeof x[field] === 'string' && !!(x[field] as string).trim() && (x[field] as string).length <= 128,
              )
          );
        }
        return (
          object(x) &&
          Object.keys(x).every((field) => ['text', 'rawId', 'quote', 'start', 'end'].includes(field)) &&
          typeof x.text === 'string' &&
          x.text.trim().length > 0 &&
          typeof x.rawId === 'string' &&
          typeof x.quote === 'string' &&
          x.quote.length > 0 &&
          Number.isInteger(x.start) &&
          Number.isInteger(x.end)
        );
      });
    if (!valid) throw new WikiError('LLM_SCHEMA_INVALID', `Provider 返回字段 ${key} 无效，未创建草稿。`, 502);
  }
  if (parsed.title !== undefined && typeof parsed.title !== 'string')
    throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回 title 无效。', 502);
  if (parsed.category !== undefined && typeof parsed.category !== 'string')
    throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回 category 无效。', 502);
  return parsed;
}
