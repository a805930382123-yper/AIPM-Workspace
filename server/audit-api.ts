import type express from 'express';
import type { LlmProvider } from '../services/llm/provider.ts';
import type { RawStore } from '../services/raw/store.ts';
import { AuditError, AuditService, locateAnchor } from '../services/audit/service.ts';
import { WikiLint } from '../services/audit/lint.ts';
import type { WikiStore } from '../services/wiki/store.ts';

export function registerAuditRoutes(
  app: express.Express,
  deps: {
    root: string;
    audits: AuditService;
    wiki: WikiStore;
    raws: RawStore;
    provider: () => LlmProvider | undefined;
  },
) {
  const lint = new WikiLint(deps.root, deps.raws, deps.audits, deps.wiki);
  app.post('/api/audits', async (req, res, next) => {
    try {
      res.status(201).json(await deps.audits.create(req.body));
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/audits', async (req, res, next) => {
    try {
      res.json({
        items: await deps.audits.list({
          wikiId: typeof req.query.wikiId === 'string' ? req.query.wikiId : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
        }),
      });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/audits/:id', async (req, res, next) => {
    try {
      const audit = await deps.audits.get(req.params.id);
      if (!audit) throw new AuditError('AUDIT_NOT_FOUND', '没有找到这条 Audit。', 404);
      const page = await deps.wiki.get(audit.wikiId);
      const result = page
        ? locateAnchor(page.body, audit.anchor, audit.scope, audit.scope === 'page' ? audit.pageBodySha256 : undefined)
        : { status: 'uncertain' as const, start: -1, end: -1, method: 'target-deleted' };
      const location = {
        ...result,
        status:
          result.status === 'located'
            ? 'found'
            : result.method === 'ambiguous'
              ? 'ambiguous'
              : result.method === 'missing' || result.method === 'target-deleted'
                ? 'missing'
                : 'stale',
        reason: result.method,
      };
      res.json({
        audit: { ...audit, location },
        draft: audit.pendingDraftId ? ((await deps.audits.getDraft(audit.pendingDraftId)) ?? null) : null,
        conflicts: await deps.audits.conflictsForAudit(audit.id),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/audits/:id/relocate', async (req, res, next) => {
    try {
      if (!Number.isInteger(req.body?.baseAuditRevision))
        throw new AuditError('INVALID_REVISION', 'baseAuditRevision 必须是整数。');
      res.json({ audit: await deps.audits.relocate(req.params.id, req.body.baseAuditRevision, req.body.anchor) });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/audits/:id/propose', async (req, res, next) => {
    try {
      res.status(201).json(await deps.audits.propose(req.params.id, deps.provider()));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/audits/:id/resolve', async (req, res, next) => {
    try {
      if (!Number.isInteger(req.body?.baseAuditRevision))
        throw new AuditError('INVALID_REVISION', 'baseAuditRevision 必须是整数。');
      res.json(await deps.audits.withLock(() => deps.audits.resolve(req.params.id, req.body)));
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/audit-drafts/:id', async (req, res, next) => {
    try {
      const draft = await deps.audits.getDraft(req.params.id);
      if (!draft) throw new AuditError('DRAFT_NOT_FOUND', '没有找到建议草稿。', 404);
      res.json({ draft });
    } catch (e) {
      next(e);
    }
  });
  app.patch('/api/audit-drafts/:id', async (req, res, next) => {
    try {
      if (!Number.isInteger(req.body?.baseRevision) || typeof req.body?.replacement !== 'string')
        throw new AuditError('INVALID_DRAFT', '需要 baseRevision 和 replacement。');
      res.json({
        draft: await deps.audits.editDraft(
          req.params.id,
          req.body.baseRevision,
          req.body.replacement,
          req.body.rationale,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  app.delete('/api/audit-drafts/:id', async (req, res, next) => {
    try {
      res.json({ draft: await deps.audits.discardDraft(req.params.id) });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/wiki-lint', async (_req, res, next) => {
    try {
      res.json(await lint.inspect());
    } catch (e) {
      next(e);
    }
  });
}
