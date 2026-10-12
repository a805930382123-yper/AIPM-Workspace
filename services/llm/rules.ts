// B04: rules loading with integrity checks. The extraction schema, the writing rules and the
// FMCG enums are read at runtime and are used both in the actual provider request and in the
// server-side validation of the response.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { LlmError } from './provider.ts';
import { assertSupportedSchema, type JsonSchemaNode } from './schema-validator.ts';

/** Contract values frozen for B04 (docs/handoffs/B04-deepseek-prompt.md §3). */
export const FROZEN_BUDGETS = {
  maxChunkChars: 8000, chunkOverlap: 400, maxOutputBytesPerCall: 2 * 1024 * 1024,
  maxSuggestedPages: 50, maxConcurrentChunks: 2, callTimeoutMs: 60_000, totalDeadlineMs: 600_000, maxRawChars: 500_000,
} as const;

export type ExtractBudgets = typeof FROZEN_BUDGETS;
export type ExtractionRules = { version?: string; role: string; instructions: string[]; budgets: ExtractBudgets };
export type FmcgSchema = {
  domain: string;
  types: Array<{ id: string; label: string; description: string }>;
  categories: Array<{ id: string; label: string }>;
  enums: Record<string, string[]>;
};
export type ExtractionRulesBundle = {
  schema: JsonSchemaNode; rules: ExtractionRules; fmcg: FmcgSchema;
  rulesVersion: string; systemPrompt: string;
};

function extractEnums(schema: JsonSchemaNode): { types: unknown[]; categories: unknown[] } {
  const page = schema.properties?.suggested_pages?.items;
  return { types: page?.properties?.type?.enum ?? [], categories: page?.properties?.category?.enum ?? [] };
}

export function buildSystemPrompt(rules: ExtractionRules, schema: JsonSchemaNode): string {
  const instructions = rules.instructions.map((line, index) => `${index + 1}. ${line.trim()}`).join('\n');
  return [
    rules.role.trim(),
    '',
    '固定规则：',
    instructions,
    '',
    `单次输出最多 ${rules.budgets.maxSuggestedPages} 条建议；每条建议独立解决一个知识问题。`,
    '必须返回的 JSON 结构（严格遵守，不要增加或缺少任何字段）：',
    JSON.stringify(schema.properties, null, 1),
  ].join('\n');
}

export async function loadExtractionRules(rulesDir: string): Promise<ExtractionRulesBundle> {
  const [schemaText, rulesText, fmcgText] = await Promise.all([
    readFile(path.join(rulesDir, 'wiki-extract.schema.json'), 'utf8'),
    readFile(path.join(rulesDir, 'extraction-rules.yaml'), 'utf8'),
    readFile(path.join(rulesDir, 'fmcg-schema.yaml'), 'utf8'),
  ]);
  let schema: JsonSchemaNode;
  let rules: ExtractionRules;
  try { schema = JSON.parse(schemaText) as JsonSchemaNode; }
  catch { throw new LlmError('LLM_RULES_INVALID', 'rules/wiki-extract.schema.json 不是合法 JSON。', 500); }
  try { rules = yaml.load(rulesText) as ExtractionRules; }
  catch { throw new LlmError('LLM_RULES_INVALID', 'rules/extraction-rules.yaml 不是合法 YAML。', 500); }
  let fmcg: FmcgSchema;
  try { fmcg = yaml.load(fmcgText) as FmcgSchema; }
  catch { throw new LlmError('LLM_RULES_INVALID', 'rules/fmcg-schema.yaml 不是合法 YAML。', 500); }

  assertSupportedSchema(schema);
  if (!rules?.role || !Array.isArray(rules.instructions) || !rules.instructions.length) {
    throw new LlmError('LLM_RULES_INVALID', 'rules/extraction-rules.yaml 缺少 role 或 instructions。', 500);
  }
  for (const [key, value] of Object.entries(FROZEN_BUDGETS)) {
    if ((rules.budgets as Record<string, unknown>)?.[key] !== value) {
      throw new LlmError('LLM_RULES_INVALID', `rules/extraction-rules.yaml 的预算 ${key} 与本批冻结契约不一致。`, 500);
    }
  }
  // The schema's enums must match the FMCG rules: no silent drift between the two files.
  const { types, categories } = extractEnums(schema);
  const allowedTypes = fmcg.types.map(item => item.id).filter(id => id !== 'source' && id !== 'synthesis');
  const allowedCategories = fmcg.categories.map(item => item.id);
  if (JSON.stringify(types) !== JSON.stringify(allowedTypes)) {
    throw new LlmError('LLM_RULES_INVALID', `提取 schema 的 type 枚举 ${JSON.stringify(types)} 与 fmcg-schema.yaml 的可提取类型 ${JSON.stringify(allowedTypes)} 不一致。`, 500);
  }
  if (JSON.stringify(categories) !== JSON.stringify(allowedCategories)) {
    throw new LlmError('LLM_RULES_INVALID', '提取 schema 的 category 枚举与 fmcg-schema.yaml 的分类不一致。', 500);
  }
  const rulesVersion = `b04-${rules.version ?? 'unknown'}-${createHash('sha256').update(`${schemaText}\n${rulesText}`).digest('hex').slice(0, 12)}`;
  return { schema, rules, fmcg, rulesVersion, systemPrompt: buildSystemPrompt(rules, schema) };
}
