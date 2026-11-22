// B07: strict, whitelisted input validation for the Prompt Library.
//
// Frozen rules:
//   * only the documented fields are accepted; any other key is rejected instead of ignored;
//   * system fields (id / variables / createdAt / updatedAt / version / source) are maintained by
//     the server and can never be supplied by a client;
//   * the body is only checked with `trim()` for emptiness — the original string, including
//     leading/trailing whitespace, newlines and special characters, is what gets stored.
import { PromptError } from './errors.ts';
import {
  MAX_BODY_CHARS,
  MAX_EXAMPLES_CHARS,
  MAX_NAME_CHARS,
  MAX_RELATED_WIKI,
  MAX_REQUIREMENT_CHARS,
  MAX_SCENARIO_CHARS,
  MAX_TAG_CHARS,
  MAX_TAGS,
} from './limits.ts';

export type PromptInput = {
  name: string;
  category: string;
  scenario: string;
  body: string;
  inputRequirements: string;
  outputRequirements: string;
  relatedWikiIds: string[];
  examples: string;
  tags: string[];
  favorite: boolean;
};

export const EDITABLE_FIELDS: Array<keyof PromptInput> = [
  'name',
  'category',
  'scenario',
  'body',
  'inputRequirements',
  'outputRequirements',
  'relatedWikiIds',
  'examples',
  'tags',
  'favorite',
];
/** System fields a client must never send; listing them gives a precise error instead of a silent drop. */
export const SYSTEM_FIELDS = ['id', 'variables', 'createdAt', 'updatedAt', 'version', 'source'] as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

/** Rejects anything that is not a path-safe UUID before it can reach a file name. */
export function requireUuid(value: unknown, code: string, message: string): string {
  if (!isUuid(value)) throw new PromptError(code, message, 400);
  return value;
}

export function requireBaseVersion(value: unknown, code = 'INVALID_BASE_VERSION'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new PromptError(code, 'baseVersion 必须是大于 0 的整数版本号。', 400);
  }
  return value;
}

/**
 * `preserve` keeps the original string (used for the body and the examples block, where leading
 * or trailing whitespace is content). Everything else is stored trimmed.
 */
function text(
  value: unknown,
  field: string,
  label: string,
  limit: number,
  allowEmpty: boolean,
  allowNewline = true,
  preserve = false,
): string {
  if (typeof value !== 'string') throw new PromptError('INVALID_FIELD', `${label}必须是文本。`, 400, { field });
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new PromptError('REQUIRED_FIELD', `${label}不能为空。`, 400, { field });
  if (!allowNewline && /[\r\n]/.test(value))
    throw new PromptError('INVALID_FIELD', `${label}不能包含换行。`, 400, { field });
  if (value.length > limit)
    throw new PromptError('FIELD_TOO_LARGE', `${label}超过 ${limit.toLocaleString('en-US')} 字符上限。`, 400, {
      field,
      limit,
      length: value.length,
    });
  return preserve ? value : trimmed;
}

function stringList(value: unknown, field: string, label: string, itemLimit: number, countLimit: number): string[] {
  if (!Array.isArray(value)) throw new PromptError('INVALID_FIELD', `${label}必须是文本列表。`, 400, { field });
  if (value.length > countLimit)
    throw new PromptError('FIELD_TOO_LARGE', `${label}最多 ${countLimit} 项。`, 400, {
      field,
      limit: countLimit,
      length: value.length,
    });
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string')
      throw new PromptError('INVALID_FIELD', `${label}的每一项都必须是文本。`, 400, { field });
    const item = entry.trim();
    if (!item) continue;
    if (item.length > itemLimit)
      throw new PromptError('FIELD_TOO_LARGE', `${label}的单项超过 ${itemLimit} 字符上限。`, 400, {
        field,
        limit: itemLimit,
        length: item.length,
      });
    if (seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
}

/**
 * Validates one create/update payload. `allowedExtra` carries the request-scoped fields
 * (`requestId` on create, `baseVersion` on update) so unknown keys still fail loudly.
 */
export function normalizePromptInput(value: unknown, categories: string[], allowedExtra: string[] = []): PromptInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PromptError('INVALID_BODY', '请求内容格式不正确。', 400);
  const source = value as Record<string, unknown>;
  const known = new Set<string>([...EDITABLE_FIELDS, ...allowedExtra]);
  for (const key of Object.keys(source)) {
    if (known.has(key)) continue;
    if ((SYSTEM_FIELDS as readonly string[]).includes(key)) {
      throw new PromptError('SYSTEM_FIELD_NOT_ALLOWED', `${key} 由服务端维护，不能由客户端提交。`, 400, { field: key });
    }
    throw new PromptError('UNKNOWN_FIELD', `请求包含不支持的字段：${key}。`, 400, { field: key });
  }
  for (const field of EDITABLE_FIELDS) {
    if (source[field] === undefined) throw new PromptError('REQUIRED_FIELD', `缺少字段：${field}。`, 400, { field });
  }
  const category = text(source.category, 'category', '分类', 100, false, false);
  if (!categories.includes(category)) throw new PromptError('INVALID_CATEGORY', 'Prompt 分类无效。', 400, { category });
  const related = stringList(source.relatedWikiIds, 'relatedWikiIds', '相关 Wiki', 64, MAX_RELATED_WIKI);
  for (const id of related) {
    if (!isUuid(id)) throw new PromptError('INVALID_WIKI_ID', '相关 Wiki 只能使用有效的 UUID。', 400, { id });
  }
  return {
    name: text(source.name, 'name', '名称', MAX_NAME_CHARS, false, false),
    category,
    scenario: text(source.scenario, 'scenario', '场景', MAX_SCENARIO_CHARS, true),
    body: text(source.body, 'body', '正文', MAX_BODY_CHARS, false, true, true),
    inputRequirements: text(source.inputRequirements, 'inputRequirements', '输入要求', MAX_REQUIREMENT_CHARS, true),
    outputRequirements: text(source.outputRequirements, 'outputRequirements', '输出要求', MAX_REQUIREMENT_CHARS, true),
    relatedWikiIds: related,
    examples: text(source.examples, 'examples', '示例', MAX_EXAMPLES_CHARS, true, true, true),
    tags: stringList(source.tags, 'tags', '标签', MAX_TAG_CHARS, MAX_TAGS),
    favorite: requireBoolean(source.favorite, 'favorite', '收藏'),
  };
}

export function requireBoolean(value: unknown, field: string, label: string): boolean {
  if (typeof value !== 'boolean') throw new PromptError('INVALID_FIELD', `${label}必须是布尔值。`, 400, { field });
  return value;
}

/** Canonical form used for "same content" comparisons (create retry, no-op update). */
export function canonicalInput(input: Pick<PromptInput, keyof PromptInput>): string {
  return JSON.stringify({
    name: input.name,
    category: input.category,
    scenario: input.scenario,
    body: input.body,
    inputRequirements: input.inputRequirements,
    outputRequirements: input.outputRequirements,
    relatedWikiIds: input.relatedWikiIds,
    examples: input.examples,
    tags: input.tags,
    favorite: input.favorite,
  });
}

/** Values map for `render`/`renderVariables`: own enumerable string keys with string values only. */
export function normalizeVariableValues(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new PromptError('INVALID_VALUES', '变量值必须是对象。', 400);
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string')
      throw new PromptError('INVALID_VALUES', `变量“${key}”的值必须是文本。`, 400, { variable: key });
    // Own-key read into a null-prototype map: `__proto__`/`constructor` can never walk the prototype.
    Object.defineProperty(out, key, { value: entry, enumerable: true, writable: true, configurable: true });
  }
  return out;
}
