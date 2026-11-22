import type express from 'express';
import { LlmConfigManager } from '../services/llm/config-manager.ts';
import { ConfigError } from '../services/llm/config.ts';
import { assertNoKnownSecret, LlmError, type LlmProvider } from '../services/llm/provider.ts';

const fail = (res: express.Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });
function fields(body: unknown, allowed: string[], res: express.Response): body is Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    fail(res, 400, 'INVALID_CONFIG_REQUEST', '配置请求包含无效或不支持的字段。');
    return false;
  }
  return true;
}
function localHost(value: string | undefined): boolean {
  if (!value || /[\s/@\\]/u.test(value)) return false;
  try {
    const url = new URL(`http://${value}`);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) && url.host === value.toLowerCase();
  } catch {
    return false;
  }
}
function allowedOrigin(req: express.Request): boolean {
  const origin = req.get('origin');
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  const allowed = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', `http://${req.get('host')}`]);
  if (process.env.FMCG_UI_ORIGIN) allowed.add(process.env.FMCG_UI_ORIGIN.replace(/\/$/u, ''));
  return allowed.has(origin.replace(/\/$/u, ''));
}
export function registerLlmConfigRoutes(
  app: express.Express,
  manager: LlmConfigManager,
  provider: () => LlmProvider | undefined | Promise<LlmProvider | undefined>,
): void {
  app.get('/api/llm/config', async (req, res, next) => {
    if (!localHost(req.get('host')) || !allowedOrigin(req) || req.get('sec-fetch-site') === 'cross-site') {
      fail(res, 403, 'CONFIG_ORIGIN_FORBIDDEN', '仅允许本机可信页面读取配置摘要。');
      return;
    }
    try {
      res.json(await manager.get());
    } catch (error) {
      next(error);
    }
  });
  const guard: express.RequestHandler = async (req, res, next) => {
    if (!localHost(req.get('host')) || !allowedOrigin(req) || req.get('sec-fetch-site') === 'cross-site') {
      fail(res, 403, 'CONFIG_ORIGIN_FORBIDDEN', '仅允许本机可信页面操作配置。');
      return;
    }
    if (!req.is('application/json')) {
      fail(res, 415, 'CONFIG_JSON_REQUIRED', '配置操作需要 application/json 请求。');
      return;
    }
    try {
      const summary = await manager.get();
      if (req.get('x-fmcg-config-token') !== summary.writeToken) {
        fail(res, 403, 'CONFIG_TOKEN_INVALID', '配置操作令牌无效，请重新读取页面后重试。');
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  app.put('/api/llm/config', guard, async (req, res, next) => {
    if (!fields(req.body, ['revision', 'baseUrl', 'model', 'apiKey'], res)) return;
    try {
      res.json(
        await manager.save({
          revision: req.body.revision,
          baseUrl: req.body.baseUrl,
          model: req.body.model,
          ...(Object.hasOwn(req.body, 'apiKey') ? { apiKey: req.body.apiKey } : {}),
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  app.delete('/api/llm/config', guard, async (req, res, next) => {
    if (!fields(req.body, ['revision', 'confirm'], res)) return;
    try {
      if (req.body.confirm !== true) throw new ConfigError('CONFIRM_REQUIRED', '请明确确认清除本机配置。');
      res.json(await manager.clear(req.body.revision));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/llm/config/test', guard, async (req, res, next) => {
    if (!fields(req.body, ['revision', 'confirm'], res)) return;
    const started = Date.now();
    try {
      if (req.body.confirm !== true) throw new ConfigError('CONFIRM_REQUIRED', '请明确确认发送固定连接测试消息。');
      await manager.assertRevision(req.body.revision);
      const target = await provider();
      if (!target) throw new LlmError('LLM_NOT_CONFIGURED', '尚未保存完整有效的 Provider 配置。', 409);
      const completion = await target.complete({
        system: 'You are a connectivity check. Return only the word OK.',
        user: 'Reply with OK.',
        timeoutMs: 15000,
        maxOutputBytes: 4096,
      });
      let inspected: unknown = completion.text;
      try {
        inspected = JSON.parse(completion.text) as unknown;
      } catch {
        /* plain text response */
      }
      assertNoKnownSecret(inspected, target.secrets ?? []);
      if (!completion.text.trim()) throw new LlmError('LLM_EMPTY_RESULT', 'Provider 返回空响应。');
      res.json({ ok: true, message: 'Provider 已返回有效响应。', elapsedMs: Date.now() - started });
    } catch (error) {
      if (error instanceof LlmError) {
        res
          .status(error.status)
          .json({ ok: false, error: { code: error.code, message: error.message }, elapsedMs: Date.now() - started });
        return;
      }
      next(error);
    }
  });
}
