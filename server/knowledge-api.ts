import { KnowledgeInspectionService } from '../services/llm/knowledge-inspections.ts';
import { KnowledgeAnswerService, type KnowledgeAnswer } from '../services/llm/knowledge-answers.ts';
import type express from 'express';
import type { RawStore } from '../services/raw/store.ts';
import type { DraftStore } from '../services/wiki/drafts.ts';
import { WikiError, type WikiRecord, type WikiStore } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import type { LlmProvider } from '../services/llm/provider.ts';
import { findDuplicateCandidates } from '../services/search/duplicates.ts';
import { validateHumanReview } from './llm-validation.ts';
import { validateBaseRevision } from './wiki-validation.ts';
import { wikiFreshnessEnabled } from '../services/wiki/freshness.ts';
import { readWikiFreshness } from '../services/wiki/review-service.ts';
import { questionHash, type AnswerCitation } from '../services/wiki/question-input.ts';
import { assertWikiSourcesAllowed } from '../services/wiki/source-lineage.ts';

export function registerKnowledgeRoutes(
  app: express.Express,
  deps: {
    root: string;
    raws: RawStore;
    drafts: DraftStore;
    wiki: WikiStore;
    provider: () => LlmProvider | undefined;
    inspections?: KnowledgeInspectionService;
  },
) {
  const workflows = new KnowledgeWorkflowStore(deps.root, deps.wiki, deps.raws);
  const answers = new KnowledgeAnswerService({
    root: deps.root,
    raws: deps.raws,
    wiki: deps.wiki,
    drafts: deps.drafts,
    provider: deps.provider,
  });
  const inspections =
    deps.inspections ??
    new KnowledgeInspectionService({
      root: deps.root,
      wiki: deps.wiki,
      raws: deps.raws,
      drafts: deps.drafts,
      provider: deps.provider,
    });
  const ready = Promise.all([
    workflows.initialize(),
    answers.initialize(),
    deps.inspections ? undefined : inspections.initialize(),
  ]);
  const displayCitations = async (citations: AnswerCitation[]) => {
    if (!wikiFreshnessEnabled()) return citations;
    const ids = new Set(citations.filter(({ kind }) => kind === 'wiki').map(({ recordId }) => recordId));
    const pages = (await Promise.all([...ids].map((id) => deps.wiki.get(id)))).filter(
      (page): page is WikiRecord => page !== undefined,
    );
    for (const page of pages) await assertWikiSourcesAllowed(deps.wiki, deps.raws, page);
    const freshness = await readWikiFreshness(deps.wiki, deps.raws, pages);
    const pagesById = new Map(pages.map((page) => [page.id, page]));
    return citations.map((citation) => {
      const page = pagesById.get(citation.recordId);
      const status =
        citation.kind === 'wiki' && page && questionHash(page.body) === citation.bodySha256
          ? freshness?.[citation.recordId]
          : undefined;
      return status && page ? { ...citation, freshness: status, reviewRevision: page.revision } : citation;
    });
  };
  const displayAnswer = async (answer: KnowledgeAnswer) => {
    if (!wikiFreshnessEnabled()) return answer;
    const eligible = await answers.reviewableWikiCitations(answer);
    const annotated = await displayCitations(answer.citations.filter(({ id }) => eligible.has(id)));
    const byId = new Map(annotated.map((citation) => [citation.id, citation]));
    return { ...answer, citations: answer.citations.map((citation) => byId.get(citation.id) ?? citation) };
  };
  app.post('/api/knowledge/inspections', async (req, res, next) => {
    try {
      await ready;
      res.status(202).json(await inspections.start(req.body));
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/knowledge/inspections/current', async (_req, res, next) => {
    try {
      await ready;
      res.json(await inspections.current());
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/knowledge/inspections/:id', async (req, res, next) => {
    try {
      await ready;
      const r = await inspections.read(String(req.params.id));
      if (!r) throw new WikiError('INSPECTION_MISSING', '检查不存在。', 404);
      res.json(r);
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/knowledge/inspections/:id/findings/:findingId/evidence/:evidenceId', async (req, res, next) => {
    try {
      await ready;
      res.json(
        await inspections.evidence(String(req.params.id), String(req.params.findingId), String(req.params.evidenceId)),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/knowledge/inspections/:id/findings/:findingId/decision', async (req, res, next) => {
    try {
      await ready;
      res.json(await inspections.decision(String(req.params.id), String(req.params.findingId), req.body));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/knowledge/inspections/:id/draft', async (req, res, next) => {
    try {
      await ready;
      res.json(await inspections.draft(String(req.params.id), req.body));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/knowledge/answers', async (req, res, next) => {
    try {
      await ready;
      res.json(await displayAnswer(await answers.ask(req.body)));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/answers/current', async (_req, res, next) => {
    try {
      await ready;
      const answer = await answers.current();
      res.json(answer ? await displayAnswer(answer) : null);
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/answers/:id', async (req, res, next) => {
    try {
      await ready;
      const result = await answers.read(String(req.params.id));
      if (!result) throw new WikiError('ANSWER_MISSING', '回答不存在。', 404);
      res.json(await displayAnswer(result));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/answers/:id/citations/:citationId', async (req, res, next) => {
    try {
      await ready;
      const citation = await answers.citation(String(req.params.id), String(req.params.citationId));
      res.json((await displayCitations([citation]))[0]);
    } catch (error) {
      next(error);
    }
  });
  if (wikiFreshnessEnabled()) {
    app.post('/api/knowledge/answers/:id/citations/:citationId/review', async (req, res, next) => {
      try {
        await ready;
        const page = await answers.confirmWikiCitation(
          String(req.params.id),
          String(req.params.citationId),
          validateBaseRevision(req.body?.baseRevision),
        );
        const freshness = await readWikiFreshness(deps.wiki, deps.raws, [page]);
        res.json({ ...page, freshness: freshness?.[page.id] });
      } catch (error) {
        next(error);
      }
    });
  }
  app.post('/api/knowledge/answers/:id/save', async (req, res, next) => {
    try {
      await ready;
      res.json(await answers.save(String(req.params.id), req.body));
    } catch (error) {
      next(error);
    }
  });
  const requireProvider = () => {
    const provider = deps.provider();
    if (!provider)
      throw new WikiError(
        'LLM_NOT_CONFIGURED',
        '产品 Provider 未配置，无法生成知识草稿。请在设置中配置服务端 Provider 后重试。',
        503,
      );
    return provider;
  };
  const duplicateResponse = async (req: express.Request, res: express.Response) => {
    await ready;
    const draftId = Array.isArray(req.params.draftId) ? req.params.draftId[0] : req.params.draftId;
    const pageId = Array.isArray(req.params.pageId) ? req.params.pageId[0] : req.params.pageId;
    const draft = await deps.drafts.get(draftId);
    if (!draft) throw new WikiError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
    const storedPage = draft.pages.find((item) => item.pageId === pageId);
    if (!storedPage) throw new WikiError('PAGE_NOT_FOUND', '没有找到这条知识建议。', 404);
    const pageTitle = typeof req.query.title === 'string' ? req.query.title : storedPage.title;
    const pageCategory = typeof req.query.category === 'string' ? req.query.category : storedPage.category;
    const pageContent =
      typeof req.query.content === 'string'
        ? req.query.content
        : [
            storedPage.one_line_definition,
            ...storedPage.source_facts.map((item) => item.text),
            ...storedPage.ai_organized,
          ].join('\n');
    const raw = await deps.raws.get(draft.rawId);
    const candidates = findDuplicateCandidates(
      { title: pageTitle, category: pageCategory, tags: raw?.tags ?? [], content: pageContent },
      await deps.wiki.allRecords(),
    );
    res.json({
      draftId: draft.id,
      pageId: storedPage.pageId,
      draftRevision: draft.revision,
      decision: storedPage.reviewDecision ?? null,
      targetWikiId: storedPage.updateTargetWikiId ?? null,
      candidates: candidates.map((item) => ({ wiki: item.wiki, score: item.score, matches: item.matches })),
    });
  };
  app.post('/api/knowledge/drafts/:draftId/changes/review', async (req, res, next) => {
    try {
      const record = await deps.drafts.reviewKnowledgeChange(String(req.params.draftId), req.body);
      res.json(deps.drafts.view(record));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/drafts/:draftId/pages/:pageId/duplicates', async (req, res, next) => {
    try {
      await duplicateResponse(req, res);
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/knowledge/drafts/:draftId/pages/:pageId/decision', async (req, res, next) => {
    try {
      await ready;
      const { baseRevision, decision, targetWikiId } = req.body ?? {};
      if (!Number.isInteger(baseRevision) || !['update', 'create', 'defer'].includes(decision))
        throw new WikiError('INVALID_DECISION', '请求必须包含有效草稿版本和处理决策。');
      if (decision === 'update') {
        const target = await deps.wiki.get(targetWikiId);
        if (!target) throw new WikiError('TARGET_NOT_FOUND', '选择的目标 Wiki 不存在。', 404);
      }
      const draft = await deps.drafts.setDecision(req.params.draftId, req.params.pageId, {
        baseRevision,
        decision,
        targetWikiId,
      });
      res.json({
        draftId: draft.id,
        revision: draft.revision,
        page: draft.pages.find((page) => page.pageId === req.params.pageId),
      });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/knowledge/updates', async (req, res, next) => {
    try {
      await ready;
      const { draftId, pageId, targetWikiId, baseRevision } = req.body ?? {};
      const draft = await deps.drafts.get(draftId);
      if (!draft) throw new WikiError('DRAFT_NOT_FOUND', '没有找到这份草稿。', 404);
      const page = draft.pages.find((item) => item.pageId === pageId);
      if (!page || page.reviewDecision !== 'update' || page.updateTargetWikiId !== targetWikiId)
        throw new WikiError('DECISION_REQUIRED', '必须先在草稿中保存“更新已有 Wiki”决策和目标页面。', 409);
      const target = await deps.wiki.get(targetWikiId);
      if (!target) throw new WikiError('TARGET_NOT_FOUND', '选择的目标 Wiki 不存在。', 404);
      const raw = await deps.raws.get(draft.rawId);
      const result = await workflows.createUpdate({
        draftId,
        pageId,
        baseRevision,
        targetWikiId,
        draft,
        raw,
        target,
        provider: requireProvider(),
      });
      res.status(201).json(workflows.view(result));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/knowledge/syntheses', async (req, res, next) => {
    try {
      await ready;
      const rawIds = Array.isArray(req.body?.rawIds)
        ? req.body.rawIds.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const sourceIds = Array.isArray(req.body?.sourceIds)
        ? req.body.sourceIds.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const pages = await deps.wiki.allRecords();
      for (const sourceId of sourceIds) {
        const source = pages.find((item) => item.id === sourceId && item.type === 'source');
        if (!source || source.sources.length !== 1)
          throw new WikiError('INVALID_SOURCE', `Source ${sourceId} 未映射到唯一 Raw。`, 422);
        rawIds.push(source.sources[0]);
      }
      const result = await workflows.createSynthesis({ rawIds, provider: requireProvider() });
      res.status(201).json(workflows.view(result));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/workflows', async (req, res, next) => {
    try {
      await ready;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const items = (await workflows.list())
        .filter((value) => !status || value.status === status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.json({
        items: items.map(
          ({
            id,
            kind,
            status: itemStatus,
            title,
            revision,
            createdAt,
            updatedAt,
            targetWikiId,
            lastCommitError,
            commitOperationId,
          }) => ({
            id,
            kind,
            status: itemStatus,
            title,
            revision,
            createdAt,
            updatedAt,
            targetWikiId: targetWikiId ?? null,
            lastCommitError: lastCommitError ?? null,
            commitOperationId: commitOperationId ?? null,
          }),
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/workflows/:workflowId', async (req, res, next) => {
    try {
      await ready;
      const value = await workflows.get(req.params.workflowId);
      if (!value) throw new WikiError('WORKFLOW_NOT_FOUND', '没有找到这份知识草稿。', 404);
      res.json(workflows.view(value));
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/knowledge/workflows/:workflowId', async (req, res, next) => {
    try {
      await ready;
      const { baseRevision, sections, title, source_level } = req.body ?? {};
      if (
        !Number.isInteger(baseRevision) ||
        !sections ||
        !Array.isArray(sections.suggestedAdditions) ||
        !Array.isArray(sections.conflicts) ||
        !Array.isArray(sections.inferences) ||
        !Array.isArray(sections.openQuestions) ||
        !Array.isArray(sections.agreement) ||
        !Array.isArray(sections.sourceList)
      )
        throw new WikiError('INVALID_WORKFLOW', '草稿更新内容不符合结构要求。');
      if (Object.keys(req.body ?? {}).some((k) => !['baseRevision', 'sections', 'title', 'source_level'].includes(k)))
        throw new WikiError('INVALID_PATCH', '工作流请求包含受保护或未知字段。');
      if (sections.sourceList.some((source: unknown) => !source || typeof source !== 'object' || Array.isArray(source)))
        throw new WikiError('INVALID_WORKFLOW', '来源清单格式无效。');
      res.json(
        workflows.view(await workflows.patch(req.params.workflowId, baseRevision, sections, title, source_level)),
      );
    } catch (error) {
      next(error);
    }
  });
  for (const action of ['start', 'move', 'page'] as const) {
    const route =
      action === 'page'
        ? '/api/knowledge/workflows/:workflowId/review/pages/:pageId'
        : `/api/knowledge/workflows/:workflowId/review/${action}`;
    app.post(route, async (req, res, next) => {
      try {
        await ready;
        const input = validateHumanReview(req.body, action, String(req.params.pageId));
        res.json(workflows.view(await workflows.reviewOperation(String(req.params.workflowId), input)));
      } catch (error) {
        next(error);
      }
    });
  }
  app.delete('/api/knowledge/workflows/:workflowId', async (req, res, next) => {
    try {
      await ready;
      const value = await workflows.discard(req.params.workflowId, req.body?.baseRevision);
      res.json({ id: value.id, status: value.status, revision: value.revision });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/knowledge/workflows/:workflowId/confirm', async (req, res, next) => {
    try {
      await ready;
      const result = await deps.wiki.withLock(() =>
        workflows.confirm(req.params.workflowId, req.body?.baseRevision, req.body?.idempotencyKey),
      );
      res.status(result.reused ? 200 : 201).json({
        workflow: result.workflow,
        wikiId: result.wikiId,
        reused: result.reused,
        operationId: result.workflow.commitOperationId,
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/knowledge/commits/:operationId', async (req, res, next) => {
    try {
      await ready;
      const item = await workflows.getCommit(req.params.operationId);
      if (!item) throw new WikiError('COMMIT_NOT_FOUND', '没有找到这条提交记录。', 404);
      res.json({
        operationId: item.operationId,
        status: item.status,
        wikiId: item.records.find((record) => record.type === 'synthesis')?.id ?? item.updateTargetId ?? null,
        workflowId: item.workflowId,
        writtenIds: item.writtenIds,
        error: item.error ?? null,
        recoverable: ['prepared', 'committing'].includes(item.status),
      });
    } catch (error) {
      next(error);
    }
  });
}
