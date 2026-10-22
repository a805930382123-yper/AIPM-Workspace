import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LLM_ENV, ConfigError, hasEnvironmentOverride, loadLlmConfig, llmConfigSummary, parseLocalEnvText, safeBaseUrl, validateApiKey, validateModel, type LlmConfigSummary } from './config.ts';

const keys = Object.values(LLM_ENV);
export class LlmConfigManager {
  private readonly secret = randomBytes(32);
  readonly writeToken = randomBytes(24).toString('base64url');
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly filePath: string, private readonly env: NodeJS.ProcessEnv = process.env) {}
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  private async bytes(): Promise<Buffer> {
    try { return await readFile(this.filePath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.from('');
      throw new ConfigError('CONFIG_READ_FAILED', '读取本机 Provider 配置失败，未修改文件。', 500);
    }
  }
  private revision(bytes: Buffer): string { return createHmac('sha256', this.secret).update(bytes).update(JSON.stringify(keys.map(key => this.env[key] ?? ''))).digest('base64url'); }
  async get(): Promise<LlmConfigSummary> {
    const bytes = await this.bytes(); const config = await loadLlmConfig({ env: this.env, filePath: this.filePath });
    const local = parseLocalEnvText(bytes.toString('utf8'));
    const knownSecrets = [this.env[LLM_ENV.apiKey]?.trim() ?? '', local[LLM_ENV.apiKey] ?? ''].filter(Boolean);
    return llmConfigSummary(config, this.filePath, { revision: this.revision(bytes), writeToken: this.writeToken, environmentLocked: hasEnvironmentOverride(this.env), knownSecrets });
  }
  private async checkRevision(revision: unknown): Promise<Buffer> {
    const snapshot = await this.bytes();
    if (typeof revision !== 'string' || revision !== this.revision(snapshot)) throw new ConfigError('CONFIG_REVISION_CONFLICT', '配置已变化，请重新读取后再操作。', 409);
    return snapshot;
  }
  private async checkWritable(revision: unknown): Promise<Buffer> {
    const snapshot = await this.checkRevision(revision);
    if (hasEnvironmentOverride(this.env)) throw new ConfigError('CONFIG_ENVIRONMENT_LOCKED', '启动环境变量覆盖了产品配置；请先在启动终端移除 FMCG_LLM_* 覆盖并重启服务端。', 409);
    return snapshot;
  }
  private async write(revision: unknown, values: Record<string, string | null>) {
    return this.serialized(async () => {
      const old = await this.checkWritable(revision); const text = old.toString('utf8'); const lines = text ? text.split(/(?<=\n)/u) : [];
      const found = new Set<string>(); const output = lines.map(line => {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (!match || !(match[1] in values)) return line;
        const key = match[1]!; found.add(key); const value = values[key]; return value === null ? '' : `${key}=${this.encodeValue(key, value)}${line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : ''}`;
      }).filter(line => line !== '');
      for (const key of keys) if (key in values && !found.has(key) && values[key] !== null) {
        if (output.length && !output.at(-1)!.endsWith('\n')) output[output.length - 1] += '\n';
        output.push(`${key}=${this.encodeValue(key, values[key]!)}\n`);
      }
      const next = Buffer.from(output.join(''));
      const dir = path.dirname(this.filePath); const temp = path.join(dir, `.${path.basename(this.filePath)}.${randomBytes(12).toString('hex')}.tmp`);
      try {
        await mkdir(dir, { recursive: true }); await writeFile(temp, next, { flag: 'wx', mode: 0o600 });
        const beforeRename = await this.bytes();
        if (!beforeRename.equals(old)) throw new ConfigError('CONFIG_REVISION_CONFLICT', '配置文件在保存期间被外部修改；外部更改已保留，请重新读取。', 409);
        await rename(temp, this.filePath);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        if (error instanceof ConfigError) throw error;
        throw new ConfigError('CONFIG_WRITE_FAILED', '保存本机配置失败，原配置保持不变。', 500);
      }
      return this.get();
    });
  }
  async save(input: { revision: unknown; baseUrl: unknown; model: unknown; apiKey?: unknown }): Promise<LlmConfigSummary> {
    const rawBaseUrl = String(input.baseUrl ?? ''); const rawModel = String(input.model ?? '');
    if (input.apiKey !== undefined && input.apiKey === '') throw new ConfigError('INVALID_API_KEY', 'API Key 不能为空；留空表示保留已保存的 Key。');
    const existing = await loadLlmConfig({ env: this.env, filePath: this.filePath });
    if (input.apiKey === undefined && !existing.apiKey) throw new ConfigError('API_KEY_REQUIRED', '首次保存配置时必须填写 API Key。');
    const apiKey = input.apiKey === undefined ? existing.apiKey : validateApiKey(input.apiKey);
    const secrets = [...new Set([apiKey, ...(existing.knownSecrets ?? []), this.env[LLM_ENV.apiKey]?.trim() ?? ''].filter(Boolean))];
    const containsSecret = (value: string) => secrets.some(secret => [value, decodeUrlValue(value)].some(candidate => candidate.includes(secret) || candidate.includes(encodeURIComponent(secret))));
    if ([rawBaseUrl, rawModel].some(containsSecret)) throw new ConfigError('CONFIG_SECRET_IN_PUBLIC_FIELD', 'Base URL 和模型 ID 不能包含 API Key。');
    const baseUrl = safeBaseUrl(rawBaseUrl); const model = validateModel(rawModel);
    if ([baseUrl, model].some(containsSecret)) throw new ConfigError('CONFIG_SECRET_IN_PUBLIC_FIELD', 'Base URL 和模型 ID 不能包含 API Key。');
    return this.write(input.revision, { [LLM_ENV.baseUrl]: baseUrl, [LLM_ENV.model]: model, [LLM_ENV.apiKey]: apiKey });
  }
  private encodeValue(key: string, value: string): string { return key === LLM_ENV.apiKey ? JSON.stringify(value) : value.replace(/[\r\n]/gu, ''); }
  async clear(revision: unknown): Promise<LlmConfigSummary> {
    return this.write(revision, { [LLM_ENV.baseUrl]: null, [LLM_ENV.model]: null, [LLM_ENV.apiKey]: null });
  }
  async assertRevision(revision: unknown) { await this.checkRevision(revision); }
}
function decodeUrlValue(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
