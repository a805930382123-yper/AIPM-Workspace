import type express from 'express';
import { PromptError } from '../services/prompt/errors.ts';
import type { PromptAiService } from '../services/prompt-ai/service.ts';

export function registerPromptAiRoutes(app: express.Express, service: PromptAiService): void {
  app.get('/api/prompt-ai/schema', (_req, res) => res.json(service.schema()));
  app.post('/api/prompt-ai/brief', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      for (const key of Object.keys(body ?? {})) if (!['task', 'template'].includes(key)) throw new PromptError('UNKNOWN_FIELD', `请求包含不支持的字段：${key}。`, 400);
      res.status(201).json(await service.brief(body?.task, body?.template));
    } catch (error) { next(error); }
  });
  app.post('/api/prompt-ai/generate', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      for (const key of Object.keys(body ?? {})) if (!['brief', 'relatedWikiIds'].includes(key)) throw new PromptError('UNKNOWN_FIELD', `请求包含不支持的字段：${key}。`, 400);
      res.status(201).json(await service.generate(body?.brief, body?.relatedWikiIds));
    } catch (error) { next(error); }
  });
  app.post('/api/prompt-ai/optimize', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      for (const key of Object.keys(body ?? {})) if (!['body', 'supplement', 'targetPromptId', 'baseVersion'].includes(key)) throw new PromptError('UNKNOWN_FIELD', `请求包含不支持的字段：${key}。`, 400);
      res.status(201).json(await service.optimize(body?.body, body?.supplement, body?.targetPromptId, body?.baseVersion));
    } catch (error) { next(error); }
  });
  app.get('/api/prompt-ai/drafts/:id', async (req, res, next) => {
    try { const draft = await service.get(req.params.id); if (!draft) throw new PromptError('DRAFT_NOT_FOUND', '没有找到这份 Prompt 草稿。', 404); res.json(draft); }
    catch (error) { next(error); }
  });
  app.post('/api/prompt-ai/drafts/:id/confirm', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      for (const key of Object.keys(body ?? {})) if (!['requestId', 'mode', 'input'].includes(key)) throw new PromptError('UNKNOWN_FIELD', `请求包含不支持的字段：${key}。`, 400);
      const result = await service.confirm(req.params.id, body?.requestId, body?.mode, body?.input);
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
}
