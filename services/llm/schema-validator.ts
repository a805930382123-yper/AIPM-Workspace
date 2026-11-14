// B04: a small, explicit JSON Schema subset validator so `rules/wiki-extract.schema.json`
// stays the single source of truth for the structured provider output. Any schema keyword
// outside the supported subset makes the rules fail loudly at load time instead of being
// silently ignored.
import { LlmError } from './provider.ts';

export type JsonSchemaNode = {
  $schema?: string; $id?: string; title?: string; description?: string; $comment?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: JsonSchemaNode;
  minItems?: number; maxItems?: number;
  minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number;
};

const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', '$comment', 'type', 'properties', 'required',
  'additionalProperties', 'enum', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength',
  'minimum', 'maximum',
]);

export function assertSupportedSchema(node: unknown, at = '$'): void {
  if (Array.isArray(node)) { throw new LlmError('LLM_RULES_INVALID', `规则 schema 在 ${at} 使用了不支持的数组形式。`, 500); }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!SUPPORTED.has(key)) throw new LlmError('LLM_RULES_INVALID', `规则 schema 在 ${at} 使用了未支持的关键字 ${key}。`, 500);
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) assertSupportedSchema(child, `${at}.properties.${name}`);
    } else if (key === 'items') {
      assertSupportedSchema(value, `${at}.items`);
    }
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return typeName(value) === 'object';
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

/** Returns human-readable error paths; an empty array means the value satisfies the schema. */
export function validateSchema(value: unknown, schema: JsonSchemaNode, at = '$'): string[] {
  const errors: string[] = [];
  if (Array.isArray(schema.type) ? !schema.type.some(type => matchesType(value, type)) : schema.type && !matchesType(value, schema.type)) {
    return [`${at}: 期望 ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}，实际 ${typeName(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(`${at}: 值 ${JSON.stringify(value)} 不在允许的枚举内（${schema.enum.map(item => JSON.stringify(item)).join('、')}）`);
  }
  if (typeof value === 'string' && (schema.minLength !== undefined || schema.maxLength !== undefined)) {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) errors.push(`${at}: 字符串长度 ${length} 小于最小长度 ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength) errors.push(`${at}: 字符串长度 ${length} 超过最大长度 ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: 数值 ${value} 小于最小值 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: 数值 ${value} 大于最大值 ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: 数组元素 ${value.length} 少于最小数量 ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: 数组元素 ${value.length} 超过最大数量 ${schema.maxItems}`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items as JsonSchemaNode, `${at}[${index}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${at}: 缺少必需字段 ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(schema.properties && key in schema.properties)) errors.push(`${at}: 存在未允许的字段 ${key}`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in record) errors.push(...validateSchema(record[key], child, `${at}.${key}`));
    }
  }
  return errors;
}
