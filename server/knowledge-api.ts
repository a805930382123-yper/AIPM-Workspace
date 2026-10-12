import type express from 'express';
import type { RawStore } from '../services/raw/store.ts';
import type { DraftStore } from '../services/wiki/drafts.ts';
import { WikiError, type WikiStore } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { findDuplicateCandidates } from '../services/search/duplicates.ts';

export function registerKnowledgeRoutes(app: express.Express, deps: {
  root: string; raws: RawStore; drafts: DraftStore; wiki: WikiStore; provider: () => LlmProvider | undefined;
}) {
  const workflows = new KnowledgeWorkflowStore(deps.root, deps.wiki, deps.raws);
  const ready = workflows.initialize();
  const requireProvider = () => {
    const provider = deps.provider();
    if (!provider) throw new WikiError('LLM_NOT_CONFIGURED', '产品 Provider 未配置，无法生成知识草稿。请在设置中配置服务端 Provider 后重试。', 503);
    return provider;
  };
  const duplicateResponse = async (req: express.Request, res: express.Response) => {
    await ready;
    const draftId = Array.isArray(req.params.draftId) ? req.params.draftId[0] : req.params.draftId;
    const pageId = Array.isArray(req.params.pageId) ? req.params.pageId[0] : req.params.pageId;
    const draft = await deps.drafts.get(draftId);
    if (!draft) throw new WikiError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
    const storedPage = draft.pages.find(item => item.pageId === pageId);
    if (!storedPage) throw new WikiError('PAGE_NOT_FOUND', '没有找到这条知识建议。', 404);
    const pageTitle = typeof req.query.title === 'string' ? req.query.title : storedPage.title;
    const pageCategory = typeof req.query.category === 'string' ? req.query.category : storedPage.category;
    const pageContent = typeof req.query.content === 'string' ? req.query.content : [storedPage.one_line_definition, ...storedPage.source_facts.map(item => item.text), ...storedPage.ai_organized].join('\n');
    const raw = await deps.raws.get(draft.rawId);
    const candidates = findDuplicateCandidates({ title: pageTitle, category: pageCategory, tags: raw?.tags ?? [], content: pageContent }, await deps.wiki.allRecords());
    res.json({ draftId: draft.id, pageId: storedPage.pageId, draftRevision: draft.revision, decision: storedPage.reviewDecision ?? null, targetWikiId: storedPage.updateTargetWikiId ?? null, candidates: candidates.map(item => ({ wiki: item.wiki, score: item.score, matches: item.matches })) });
  };
  app.get('/api/knowledge/drafts/:draftId/pages/:pageId/duplicates', async (req, res, next) => {
    try {
      await duplicateResponse(req, res);
    } catch (error) { next(error); }
  });
  app.patch('/api/knowledge/drafts/:draftId/pages/:pageId/decision', async (req, res, next) => {
    try {
      await ready;
      const { baseRevision, decision, targetWikiId } = req.body ?? {};
      if (!Number.isInteger(baseRevision) || !['update', 'create', 'defer'].includes(decision)) throw new WikiError('INVALID_DECISION', '请求必须包含有效草稿版本和处理决策。');
      if (decision === 'update') {
        const target = await deps.wiki.get(targetWikiId);
        if (!target) throw new WikiError('TARGET_NOT_FOUND', '选择的目标 Wiki 不存在。', 404);
      }
      const draft = await deps.drafts.setDecision(req.params.draftId, req.params.pageId, { baseRevision, decision, targetWikiId });
      res.json({ draftId: draft.id, revision: draft.revision, page: draft.pages.find(page => page.pageId === req.params.pageId) });
    } catch (error) { next(error); }
  });
  app.post('/api/knowledge/updates', async (req, res, next) => {
    try {
      await ready;
      const { draftId, pageId, targetWikiId, baseRevision } = req.body ?? {};
      const draft = await deps.drafts.get(draftId);
      if (!draft) throw new WikiError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
      const page = draft.pages.find(item => item.pageId === pageId);
      if (!page || page.reviewDecision !== 'update' || page.updateTargetWikiId !== targetWikiId) throw new WikiError('DECISION_REQUIRED', '必须先在草稿中保存“更新已有 Wiki”决策和目标页面。', 409);
      const target = await deps.wiki.get(targetWikiId);
      if (!target) throw new WikiError('TARGET_NOT_FOUND', '选择的目标 Wiki 不存在。', 404);
      const raw = await deps.raws.get(draft.rawId);
      const result = await workflows.createUpdate({ draftId, pageId, baseRevision, targetWikiId, draft, raw, target, provider: requireProvider() });
      res.status(201).json(result);
    } catch (error) { next(error); }
  });
  app.post('/api/knowledge/syntheses', async (req, res, next) => {
    try {
      await ready;
      const rawIds = Array.isArray(req.body?.rawIds) ? req.body.rawIds.filter((x: unknown): x is string => typeof x === 'string') : [];
      const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds.filter((x: unknown): x is string => typeof x === 'string') : [];
      const pages = await deps.wiki.allRecords();
      for (const sourceId of sourceIds) {
        const source = pages.find(item => item.id === sourceId && item.type === 'source');
        if (!source || source.sources.length !== 1) throw new WikiError('INVALID_SOURCE', `Source ${sourceId} 未映射到唯一 Raw。`, 422);
        rawIds.push(source.sources[0]);
      }
      const result = await workflows.createSynthesis({ rawIds, provider: requireProvider() });
      res.status(201).json(result);
    } catch (error) { next(error); }
  });
  app.get('/api/knowledge/workflows', async (req, res, next) => {
    try {
      await ready;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const items = (await workflows.list()).filter(value => !status || value.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.json({ items: items.map(({ id, kind, status: itemStatus, title, revision, createdAt, updatedAt, targetWikiId, lastCommitError, commitOperationId }) => ({ id, kind, status: itemStatus, title, revision, createdAt, updatedAt, targetWikiId: targetWikiId ?? null, lastCommitError: lastCommitError ?? null, commitOperationId: commitOperationId ?? null })) });
    } catch (error) { next(error); }
  });
  app.get('/api/knowledge/workflows/:workflowId', async (req, res, next) => {
    try { await ready; const value = await workflows.get(req.params.workflowId); if (!value) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404); res.json(value); }
    catch (error) { next(error); }
  });
  app.patch('/api/knowledge/workflows/:workflowId', async (req, res, next) => {
    try {
      await ready;
      const { baseRevision, sections, title } = req.body ?? {};
      if (!Number.isInteger(baseRevision) || !sections || !Array.isArray(sections.suggestedAdditions) || !Array.isArray(sections.conflicts) || !Array.isArray(sections.inferences) || !Array.isArray(sections.openQuestions) || !Array.isArray(sections.agreement) || !Array.isArray(sections.sourceList)) throw new WikiError('INVALID_WORKFLOW', '草稿更新内容不符合结构要求。');
      res.json(await workflows.patch(req.params.workflowId, baseRevision, sections, title));
    } catch (error) { next(error); }
  });
  app.delete('/api/knowledge/workflows/:workflowId', async (req, res, next) => {
    try { await ready; const value = await workflows.discard(req.params.workflowId, req.body?.baseRevision); res.json({ id: value.id, status: value.status, revision: value.revision }); }
    catch (error) { next(error); }
  });
  app.post('/api/knowledge/workflows/:workflowId/confirm', async (req, res, next) => {
    try {
      await ready;
      const result = await deps.wiki.withLock(() => workflows.confirm(req.params.workflowId, req.body?.baseRevision, req.body?.idempotencyKey));
      res.status(result.reused ? 200 : 201).json({ workflow: result.workflow, wikiId: result.wikiId, reused: result.reused, operationId: result.workflow.commitOperationId });
    } catch (error) { next(error); }
  });
  app.get('/api/knowledge/commits/:operationId', async (req, res, next) => {
    try { await ready; const item = await workflows.getCommit(req.params.operationId); if (!item) throw new WikiError('COMMIT_NOT_FOUND', '没有找到这条提交记录。', 404); res.json({ operationId: item.operationId, status: item.status, wikiId: item.records.find(record => record.type === 'synthesis')?.id ?? item.updateTargetId ?? null, workflowId: item.workflowId, writtenIds: item.writtenIds, error: item.error ?? null, recoverable: ['prepared', 'committing'].includes(item.status) }); }
    catch (error) { next(error); }
  });
}
