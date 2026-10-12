// B07: the Prompt Library HTTP surface. Registered before the global error handler in
// server/index.ts, so every failure here keeps the frozen `{error:{code,message,details?}}` shape.
import type express from 'express';
import { PromptError } from '../services/prompt/errors.ts';
import type { PromptStore } from '../services/prompt/store.ts';
import { normalizeVariableValues, requireBaseVersion, requireUuid } from '../services/prompt/validate.ts';

export type PromptRouteDeps = { store: PromptStore };

/** `favorite=true|false` — anything else is a client bug and must not be silently ignored. */
function parseFavorite(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new PromptError('INVALID_FILTER', 'favorite 只支持 true 或 false。', 400, { favorite: value });
}

function queryText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new PromptError('INVALID_FILTER', `${field} 必须是文本。`, 400, { field });
  return value;
}

export function registerPromptRoutes(app: express.Express, deps: PromptRouteDeps): void {
  const { store } = deps;

  // Static paths are registered before `:id` so `/api/prompts/schema` is never read as an id.
  app.get('/api/prompts/schema', async (_req, res, next) => {
    try { res.json(await store.schema()); } catch (error) { next(error); }
  });

  app.get('/api/prompts', async (req, res, next) => {
    try {
      const schema = await store.schema();
      const category = queryText(req.query.category, 'category');
      if (category && !schema.categories.some(item => item.id === category)) throw new PromptError('INVALID_CATEGORY', 'Prompt 分类无效。', 400, { category });
      const q = queryText(req.query.q, 'q');
      const tag = queryText(req.query.tag, 'tag');
      const favorite = parseFavorite(req.query.favorite);
      const [items, categoryCounts] = await Promise.all([
        store.list({ q, category, tag, favorite }),
        store.categoryCounts(),
      ]);
      res.json({ items, categoryCounts });
    } catch (error) { next(error); }
  });

  app.post('/api/prompts', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const requestId = requireUuid(body?.requestId, 'INVALID_REQUEST_ID', 'requestId 必须是有效的 UUID。');
      const result = await store.create(requestId, body);
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });

  app.get('/api/prompts/:id/versions/:version', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      const raw = req.params.version;
      if (!/^[1-9]\d*$/.test(raw)) throw new PromptError('INVALID_VERSION', '版本号必须是大于 0 的整数。', 400);
      res.json({ version: await store.getVersion(id, Number(raw)) });
    } catch (error) { next(error); }
  });

  app.get('/api/prompts/:id/versions', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      res.json({ items: await store.getVersions(id) });
    } catch (error) { next(error); }
  });

  app.post('/api/prompts/:id/render', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      const body = req.body as Record<string, unknown> | undefined;
      const baseVersion = requireBaseVersion(body?.baseVersion);
      res.json(await store.renderVariables(id, baseVersion, normalizeVariableValues(body?.values)));
    } catch (error) { next(error); }
  });

  app.get('/api/prompts/:id/export', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      const result = await store.exportMarkdown(id);
      if (!result) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条 Prompt。' } }); return; }
      // The file name is derived from the id only, so no user text can reach the header.
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="prompt-${result.prompt.id}.md"`);
      res.send(result.markdown);
    } catch (error) { next(error); }
  });

  app.get('/api/prompts/:id', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      const prompt = await store.get(id);
      if (!prompt) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '没有找到这条 Prompt。' } }); return; }
      res.json({ prompt, wikiLinks: await store.wikiLinks(prompt) });
    } catch (error) { next(error); }
  });

  app.put('/api/prompts/:id', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      const body = req.body as Record<string, unknown> | undefined;
      const baseVersion = requireBaseVersion(body?.baseVersion);
      res.json({ prompt: await store.update(id, baseVersion, body) });
    } catch (error) { next(error); }
  });

  app.delete('/api/prompts/:id', async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, 'INVALID_ID', 'Prompt ID 必须是有效的 UUID。');
      res.json(await store.delete(id, requireBaseVersion((req.body as Record<string, unknown> | undefined)?.baseVersion)));
    } catch (error) { next(error); }
  });
}
