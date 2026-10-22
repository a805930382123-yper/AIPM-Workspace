// Product-side LLM configuration. Secrets stay on the server and are never returned.
import { readFile } from 'node:fs/promises';

export const LLM_ENV = { baseUrl: 'FMCG_LLM_BASE_URL', model: 'FMCG_LLM_MODEL', apiKey: 'FMCG_LLM_API_KEY' } as const;
export const LLM_PROVIDER_NAME = 'openai-compatible';
export const KEY_MASK = '••••••••••••';
export type LlmConfigSource = 'env' | 'local-file' | 'none';
export type LlmConfig = { baseUrl: string; model: string; apiKey: string; source: LlmConfigSource; knownSecrets?: string[] };
export type LlmConfigSummary = {
  provider: string; baseUrlHost: string | null; baseUrl: string; model: string | null; keyConfigured: boolean;
  keyMask: string; configured: boolean; source: LlmConfigSource; missing: string[]; configFile: string;
  envNames: Record<string, string>; revision: string; writeToken: string; environmentLocked: boolean;
};
export class ConfigError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export function envValue(env: NodeJS.ProcessEnv, name: string): string { return typeof env[name] === 'string' ? env[name]!.trim() : ''; }
export async function readLocalEnvFile(file: string): Promise<Record<string, string>> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ConfigError('CONFIG_READ_FAILED', '读取本机 Provider 配置失败，未修改文件。', 500);
  }
  return parseLocalEnvText(text);
}
export function parseLocalEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('='); if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim(); let value = trimmed.slice(at + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\(["\\])/gu, '$1');
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (key) result[key] = value;
  }
  return result;
}
export async function loadLlmConfig(options: { env?: NodeJS.ProcessEnv; filePath: string }): Promise<LlmConfig> {
  const env = options.env ?? process.env;
  const names = [LLM_ENV.baseUrl, LLM_ENV.model, LLM_ENV.apiKey];
  const envValues = names.map(name => envValue(env, name));
  const fileValues = ['', '', ''];
  if (!envValues.every(Boolean)) {
    const local = await readLocalEnvFile(options.filePath);
    for (let i = 0; i < names.length; i++) fileValues[i] = local[names[i]!] ?? '';
  }
  const values = envValues.map((value, i) => value || fileValues[i]!);
  const source: LlmConfigSource = envValues.some(Boolean) ? 'env' : fileValues.some(Boolean) ? 'local-file' : 'none';
  return { baseUrl: values[0]!, model: values[1]!, apiKey: values[2]!, source,
    knownSecrets: [...new Set([envValues[2], fileValues[2]].filter(value => Boolean(value)))] };
}
export function hasEnvironmentOverride(env: NodeJS.ProcessEnv = process.env): boolean { return Object.values(LLM_ENV).some(name => Boolean(envValue(env, name))); }
export function safeBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\u007f]/u.test(raw)) throw new ConfigError('INVALID_BASE_URL', 'Base URL 格式无效。');
  if (raw.includes('?') || raw.includes('#')) throw new ConfigError('INVALID_BASE_URL', 'Base URL 不能包含 query 或 fragment。');
  let url: URL; try { url = new URL(raw); } catch { throw new ConfigError('INVALID_BASE_URL', '请输入完整的 HTTPS 地址或本机 HTTP 地址。'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || /\/chat\/completions\/?$/iu.test(url.pathname) || /(?:sk|rk|pk)[-_][A-Za-z0-9._~-]{8,}/iu.test(raw)) throw new ConfigError('INVALID_BASE_URL', '仅支持 HTTPS 地址；HTTP 仅用于本机回环地址，且不能填写 chat/completions 路径或凭证。');
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
}
export function validateModel(value: unknown): string {
  if (typeof value !== 'string') throw new ConfigError('INVALID_MODEL', '模型 ID 无效。');
  const model = value.trim(); if (!model || model.length > 200 || /[\r\n\u0000]/u.test(model) || /(?:sk|rk|pk)[-_][A-Za-z0-9._~-]{8,}/iu.test(model)) throw new ConfigError('INVALID_MODEL', '模型 ID 为空、过长或包含不允许的内容。');
  return model;
}
export function validateApiKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 4096 || /[\r\n\u0000]/u.test(value)) throw new ConfigError('INVALID_API_KEY', 'API Key 必须是非空单行文本且不超过 4096 字符。');
  return value.trim();
}
export function llmConfigSummary(config: LlmConfig, filePath: string, extra: { revision: string; writeToken: string; environmentLocked?: boolean; knownSecrets?: string[] } = { revision: '', writeToken: '' }): LlmConfigSummary {
  const secrets = [...new Set([config.apiKey, ...(config.knownSecrets ?? []), ...(extra.knownSecrets ?? [])].filter(Boolean))];
  const leaksKey = (value: string) => secrets.some(secret => value.includes(secret) || decodeUrlValue(value).includes(secret) || value.includes(encodeURIComponent(secret)));
  let baseUrl = ''; try { baseUrl = safeBaseUrl(config.baseUrl); } catch { /* malformed configuration remains unreadable in the UI */ }
  let model = ''; try { model = validateModel(config.model); } catch { /* malformed configuration remains unreadable in the UI */ }
  if (leaksKey(baseUrl)) baseUrl = '';
  if (leaksKey(model)) model = '';
  let keyValid = Boolean(config.apiKey); try { if (config.apiKey) validateApiKey(config.apiKey); } catch { keyValid = false; }
  const missing: string[] = []; if (!baseUrl) missing.push(LLM_ENV.baseUrl); if (!model) missing.push(LLM_ENV.model); if (!keyValid) missing.push(LLM_ENV.apiKey);
  let baseUrlHost: string | null = null; try { if (baseUrl) baseUrlHost = new URL(baseUrl).host; } catch { /* safe summary */ }
  return { provider: LLM_PROVIDER_NAME, baseUrlHost, baseUrl, model: model || null, keyConfigured: Boolean(config.apiKey), keyMask: KEY_MASK,
    configured: missing.length === 0 && baseUrlHost !== null, source: config.source, missing, configFile: filePath, envNames: { ...LLM_ENV },
    revision: extra.revision, writeToken: extra.writeToken, environmentLocked: extra.environmentLocked ?? config.source === 'env' };
}
function decodeUrlValue(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
