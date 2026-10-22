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
  schema: JsonSchemaNode; kb02FactsSchema: JsonSchemaNode; kb02PlanningSchema: JsonSchemaNode; rules: ExtractionRules; fmcg: FmcgSchema;
  rulesVersion: string; systemPrompt: string;
};

const TOP_LEVEL_RULE = 'JSON 顶层只有 document 与 suggested_pages 两个字段，不要增加其它字段。';
const EVIDENCE_RULE = 'source_evidence 的 quote 必须是从资料中原样复制的连续片段（不要改写、不要拼接），并给出该片段的 id 与 rawId；同一页面内 id 唯一。';
export const EXTRACTION_PROVIDER_FORMAT = 'locator-v2';
export const KB02_PROMPT_REVISION = 'kb02-atoms-planning-8';

function extractEnums(schema: JsonSchemaNode): { types: unknown[]; categories: unknown[] } {
  const page = schema.properties?.suggested_pages?.items;
  return { types: page?.properties?.type?.enum ?? [], categories: page?.properties?.category?.enum ?? [] };
}

export function buildSystemPrompt(rules: ExtractionRules, schema: JsonSchemaNode, overrides: Record<string, string> = {}): string {
  const unresolved = new Set(Object.keys(overrides));
  const instructions = rules.instructions.map((line, index) => {
    const replacement = overrides[line];
    if (replacement !== undefined) unresolved.delete(line);
    return `${index + 1}. ${(replacement ?? line).trim()}`;
  }).join('\n');
  if (unresolved.size) throw new LlmError('LLM_RULES_INVALID', `构造专用system prompt时找不到固定规则：${[...unresolved].join('；')}`, 500);
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

/** Uses the versioned chunk locator contract while retaining every unrelated safety rule. */
export function buildLocatorSystemPrompt(rules: ExtractionRules, schema: JsonSchemaNode): string {
  return buildSystemPrompt(rules, schema, {
    [TOP_LEVEL_RULE]: '本次chunk提取顶层必须包含 evidence_format_version: 2、document 与 suggested_pages；字段结构严格遵守下方locator v2 schema，不要增加其它字段。',
    [EVIDENCE_RULE]: '本次chunk提取的每条 source_evidence 只含 id 与 locatorId；locatorId 必须来自当前chunk随请求提供的locator目录。服务端从当前不可变Raw绑定来源并派生quote和全局偏移。',
  });
}

/** The separate merge call remains document-only and consumes normalized, server-verified evidence. */
export function buildDocumentMergeSystemPrompt(rules: ExtractionRules, schema: JsonSchemaNode): string {
  return buildSystemPrompt(rules, schema, {
    [TOP_LEVEL_RULE]: '本次document merge输出顶层仅包含 document；严格遵守下方document-only schema，不输出suggested_pages或source_evidence。',
    [EVIDENCE_RULE]: '本次document merge只综合输入里已经规范化并校验的证据，不输出或更改source_evidence、Raw来源或证据位置。',
  });
}

export async function loadExtractionRules(rulesDir: string): Promise<ExtractionRulesBundle> {
  const [schemaText, rulesText, fmcgText, kb02FactsText, kb02PlanningText] = await Promise.all([
    readFile(path.join(rulesDir, 'wiki-extract.schema.json'), 'utf8'),
    readFile(path.join(rulesDir, 'extraction-rules.yaml'), 'utf8'),
    readFile(path.join(rulesDir, 'fmcg-schema.yaml'), 'utf8'),
    readFile(path.join(rulesDir, 'kb02-facts.schema.json'), 'utf8'),
    readFile(path.join(rulesDir, 'kb02-planning.schema.json'), 'utf8'),
  ]);
  let schema: JsonSchemaNode; let kb02FactsSchema: JsonSchemaNode; let kb02PlanningSchema: JsonSchemaNode;
  let rules: ExtractionRules;
  try { schema = JSON.parse(schemaText) as JsonSchemaNode; kb02FactsSchema = JSON.parse(kb02FactsText) as JsonSchemaNode; kb02PlanningSchema = JSON.parse(kb02PlanningText) as JsonSchemaNode; }
  catch { throw new LlmError('LLM_RULES_INVALID', '提取或KB02 schema文件不是合法JSON。', 500); }
  try { rules = yaml.load(rulesText) as ExtractionRules; }
  catch { throw new LlmError('LLM_RULES_INVALID', 'rules/extraction-rules.yaml 不是合法 YAML。', 500); }
  let fmcg: FmcgSchema;
  try { fmcg = yaml.load(fmcgText) as FmcgSchema; }
  catch { throw new LlmError('LLM_RULES_INVALID', 'rules/fmcg-schema.yaml 不是合法 YAML。', 500); }

  assertSupportedSchema(schema); assertSupportedSchema(kb02FactsSchema); assertSupportedSchema(kb02PlanningSchema);
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
  const kb02Types = kb02PlanningSchema.properties?.pages?.items?.properties?.type?.enum ?? [];
  const kb02Categories = kb02PlanningSchema.properties?.pages?.items?.properties?.category?.enum ?? [];
  if (JSON.stringify(kb02Types) !== JSON.stringify(allowedTypes) || JSON.stringify(kb02Categories) !== JSON.stringify(allowedCategories)) throw new LlmError('LLM_RULES_INVALID', 'KB02规划schema枚举与FMCG schema不一致。', 500);
  const rulesVersion = `b04-${rules.version ?? 'unknown'}-${EXTRACTION_PROVIDER_FORMAT}-${KB02_PROMPT_REVISION}-${createHash('sha256').update(`${schemaText}\n${rulesText}\n${EXTRACTION_PROVIDER_FORMAT}\n${KB02_PROMPT_REVISION}\n${kb02FactsText}\n${kb02PlanningText}`).digest('hex').slice(0, 12)}`;
  return { schema, kb02FactsSchema, kb02PlanningSchema, rules, fmcg, rulesVersion, systemPrompt: buildSystemPrompt(rules, schema) };
}

