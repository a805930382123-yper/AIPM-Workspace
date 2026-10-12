// B04: product-side LLM configuration. One provider (OpenAI-compatible Chat Completions).
// The key comes only from the server environment or an ignored local file; it is never
// returned by any API, never written to logs, drafts, Raw or Wiki.
import { readFile } from 'node:fs/promises';

export const LLM_ENV = {
  baseUrl: 'FMCG_LLM_BASE_URL',
  model: 'FMCG_LLM_MODEL',
  apiKey: 'FMCG_LLM_API_KEY',
} as const;
export const LLM_PROVIDER_NAME = 'openai-compatible';
/** Fixed placeholder: the API never returns anything derived from the real key. */
export const KEY_MASK = '••••••••••••';

export type LlmConfigSource = 'env' | 'local-file' | 'none';
export type LlmConfig = { baseUrl: string; model: string; apiKey: string; source: LlmConfigSource };
export type LlmConfigSummary = {
  provider: string; baseUrlHost: string | null; model: string | null; keyConfigured: boolean;
  keyMask: string; configured: boolean; source: LlmConfigSource; missing: string[];
  configFile: string; envNames: Record<string, string>;
};

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}
/** Minimal explicit parser for an ignored local file: KEY=VALUE, # comments, optional quotes. */
export async function readLocalEnvFile(file: string): Promise<Record<string, string>> {
  const text = await readFile(file, 'utf8').catch(() => '');
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Precedence: process environment first, then the ignored local file (never overriding an
 * existing env value). Node does not load .env automatically, so this read is explicit.
 */
export async function loadLlmConfig(options: { env?: NodeJS.ProcessEnv; filePath: string }): Promise<LlmConfig> {
  const env = options.env ?? process.env;
  let baseUrl = envValue(env, LLM_ENV.baseUrl);
  let model = envValue(env, LLM_ENV.model);
  let apiKey = envValue(env, LLM_ENV.apiKey);
  const fromEnv = Boolean(baseUrl || model || apiKey);
  let source: LlmConfigSource = fromEnv ? 'env' : 'none';
  if (!baseUrl || !model || !apiKey) {
    const file = await readLocalEnvFile(options.filePath);
    if (file[LLM_ENV.baseUrl] || file[LLM_ENV.model] || file[LLM_ENV.apiKey]) {
      baseUrl = baseUrl || (file[LLM_ENV.baseUrl] ?? '');
      model = model || (file[LLM_ENV.model] ?? '');
      apiKey = apiKey || (file[LLM_ENV.apiKey] ?? '');
      source = fromEnv ? 'env' : 'local-file';
    }
  }
  return { baseUrl, model, apiKey, source };
}

export function llmConfigSummary(config: LlmConfig, filePath: string): LlmConfigSummary {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push(LLM_ENV.baseUrl);
  if (!config.model) missing.push(LLM_ENV.model);
  if (!config.apiKey) missing.push(LLM_ENV.apiKey);
  let baseUrlHost: string | null = null;
  if (config.baseUrl) {
    try { baseUrlHost = new URL(config.baseUrl).host; } catch { baseUrlHost = null; }
  }
  return {
    provider: LLM_PROVIDER_NAME,
    baseUrlHost,
    model: config.model ? config.model : null,
    keyConfigured: Boolean(config.apiKey),
    keyMask: KEY_MASK,
    configured: missing.length === 0 && baseUrlHost !== null,
    source: config.source,
    missing,
    configFile: filePath,
    envNames: { ...LLM_ENV },
  };
}
