import { useEffect, useMemo, useState, useRef } from 'react';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import type { DraftPatch, DraftView, Raw, WikiCommitStatus, WikiSchema, DuplicateResult } from '../../api';
import {
  hasTemplateFields,
  type TemplateFieldKey,
  type TemplateFieldContent,
} from '../../../services/wiki/template-fields';
import {
  ApiError,
  api,
  confirmDraft,
  discardDraft,
  draftView,
  patchDraft,
  wikiCommit,
  duplicateCandidates,
  savePageDecision,
  startUpdateWorkflow,
  startDraftReview,
  moveDraftUnits,
  reviewDraftPage,
  markDraftQuestions,
} from '../../api';

import {
  duplicateInput,
  reviewFingerprint,
  conflictText,
  editedTemplateFields,
  type PageDraft,
  type DraftReviewPageProps,
} from './draftReviewModel';

export function useDraftReviewState({ draftId, onBack, onCommitted, onOpenWorkflow }: DraftReviewPageProps) {
  const [noteDirty, setNoteDirty] = useState(false),
    [showCards, setShowCards] = useState(false);
  const loadGeneration = useRef(0);
  const mountedRef = useRef(true);
  const [view, setView] = useState<DraftView | null>(null);
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [body, setBody] = useState('');
  const { data: schema = null } = useScopedQuery<WikiSchema>(
    ['wiki', 'schema'],
    ({ signal }) => api<WikiSchema>('/api/wiki/schema', { signal }),
    { cache: false },
  );
  const [mergePick, setMergePick] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [commit, setCommit] = useState<WikiCommitStatus | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [result, setResult] = useState<{
    operationId: string;
    sourceId: string | null;
    wikiIds: string[];
    sourceReused: boolean;
    warnings: string[];
  } | null>(null);
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}`);
  const [duplicateViews, setDuplicateViews] = useState<Record<string, DuplicateResult>>({});
  const [duplicateErrors, setDuplicateErrors] = useState<Record<string, string>>({});
  const [savedFingerprint, setSavedFingerprint] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const generation = ++loadGeneration.current;
    draftView(draftId)
      .then((next) => {
        if (!active || generation !== loadGeneration.current) return;
        setView(next);
        setSavedFingerprint(reviewFingerprint(next));
        setPages(next.pages.map((page) => ({ ...page })));
        if (next.input) return null;
        return api<Raw>(`/api/raw/${encodeURIComponent(next.rawId)}`).catch(() => null);
      })
      .then((raw) => {
        if (active && generation === loadGeneration.current && raw !== undefined) {
          setBody(raw?.body ?? '');
        }
      })
      .catch((problem) => {
        if (active && generation === loadGeneration.current) {
          setError(problem instanceof Error ? problem.message : '无法读取这份草稿。');
        }
      });
    return () => {
      active = false;
    };
  }, [draftId]);

  const typeOptions = useMemo(
    () => (schema?.types ?? []).filter((type) => type.id !== 'source' && type.id !== 'synthesis'),
    [schema],
  );
  const selectedIds = pages.filter((page) => page.selected).map((page) => page.pageId);
  const conflicts = view ? conflictText(view) : [];
  const readOnly = !view || view.status !== 'pending_confirmation' || (!view.input && !!view.deferredAt);
  const legacyDirty = !!view && reviewFingerprint(view, pages) !== savedFingerprint;
  const dirty = legacyDirty || noteDirty;
  const reviewComplete =
    !!view?.humanReview &&
    Object.values(view.humanReview.assignments).every((id) => id !== null) &&
    pages.every((p) =>
      view.humanReview!.approvals.some((a) => a.pageId === p.pageId && a.digest === view.reviewContentDigest),
    );
  const canCheckDuplicates = Boolean(view && !view.input && !view.outcomeDigest && !readOnly && pages.length > 0);

  useEffect(() => {
    if (!canCheckDuplicates) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const results = await Promise.all(
        pages.map(async (page) => {
          try {
            return [page.pageId, await duplicateCandidates(draftId, page.pageId, duplicateInput(page)), null] as const;
          } catch (problem) {
            return [page.pageId, null, problem instanceof Error ? problem.message : '候选查询失败。'] as const;
          }
        }),
      );
      if (!active) return;
      setDuplicateViews((current) => ({
        ...current,
        ...Object.fromEntries(
          results
            .filter((item): item is readonly [string, DuplicateResult, null] => item[1] !== null)
            .map(([id, value]) => [id, value]),
        ),
      }));
      setDuplicateErrors((current) => {
        const next = { ...current };
        for (const [id, value] of results) if (value !== null) delete next[id];
        for (const [id, , errorMessage] of results) if (errorMessage !== null) next[id] = errorMessage;
        return next;
      });
    }, 100);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draftId, canCheckDuplicates, view?.revision, pages]);
  const updatePage = (pageId: string, patch: Partial<PageDraft>) => {
    const currentPage = pages.find((page) => page.pageId === pageId);
    if (
      patch.type &&
      currentPage &&
      patch.type !== currentPage.type &&
      (hasTemplateFields(currentPage.templateFields) || currentPage.mergedTemplateFields?.length)
    ) {
      setError('本批不支持带字段归位的类型切换，原内容已保留。');
      return;
    }
    setDuplicateViews((current) => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    setDuplicateErrors((current) => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    const basis = [
      'title',
      'type',
      'category',
      'one_line_definition',
      'source_facts',
      'ai_organized',
      'templateFields',
      'mergedTemplateFields',
    ] as const;
    const invalidatesDecision = basis.some((key) => key in patch);
    setPages((current) =>
      current.map((page) =>
        page.pageId === pageId
          ? {
              ...page,
              ...patch,
              ...(invalidatesDecision ? { reviewDecision: undefined, updateTargetWikiId: undefined } : {}),
            }
          : page,
      ),
    );
  };
  const updateTemplateField = (page: PageDraft, key: TemplateFieldKey, patch: Partial<TemplateFieldContent>) => {
    updatePage(page.pageId, { templateFields: editedTemplateFields(page.templateFields, key, patch) });
  };
  const updateMergedField = (
    page: PageDraft,
    index: number,
    key: TemplateFieldKey,
    patch: Partial<TemplateFieldContent>,
  ) =>
    updatePage(page.pageId, {
      mergedTemplateFields: page.mergedTemplateFields!.map((group, i) =>
        i === index ? { ...group, fields: editedTemplateFields(group.fields, key, patch) } : group,
      ),
    });
  const run = async (label: string, work: () => Promise<void>) => {
    if (noteDirty) {
      setError('请先保存笔记编辑，再操作知识卡片。');
      return;
    }
    setBusy(label);
    setError('');
    try {
      await work();
    } catch (problem) {
      if (!mountedRef.current) return;
      if (problem instanceof ApiError && problem.code === 'DRAFT_CONFIRM_PARTIAL') setError(problem.message);
      else if (problem instanceof ApiError && (problem.details as { operationId?: string } | undefined)?.operationId) {
        const operationId = (problem.details as { operationId?: string }).operationId as string;
        setError(problem.message);
        const status = await wikiCommit(operationId).catch(() => null);
        if (!mountedRef.current) return;
        if (status) setCommit(status);
        setResult({
          operationId,
          sourceId: status?.sourceId ?? null,
          wikiIds: status?.wikiIds ?? [],
          sourceReused: false,
          warnings: status?.warnings ?? [],
        });
        await onCommitted();
      } else setError(problem instanceof Error ? problem.message : '操作失败，请重试。');
    } finally {
      if (mountedRef.current) setBusy('');
    }
  };
  /** F04-01: one snapshot carrying every editable field (Source, document and pages). */
  const snapshot = (sourceView: DraftView | null = view, sourcePages: PageDraft[] = pages): DraftPatch => ({
    baseRevision: sourceView?.revision ?? 0,
    document: sourceView
      ? {
          title: sourceView.document.title,
          main_topic: sourceView.document.main_topic,
          summary: sourceView.document.summary,
        }
      : undefined,
    source:
      sourceView && !sourceView.input
        ? {
            title: sourceView.source.title,
            summary: sourceView.source.summary,
            body: sourceView.source.body,
            category: sourceView.source.category,
            knowledge_status: sourceView.source.knowledge_status,
            confidence: sourceView.source.confidence,
            source_level: sourceView.source.source_level,
            key_takeaways: sourceView.source.key_takeaways,
          }
        : undefined,
    pages: sourcePages.map((page) => ({
      pageId: page.pageId,
      selected: page.selected,
      title: page.title,
      type: page.type,
      category: page.category,
      one_line_definition: page.one_line_definition,
      source_facts: page.source_facts,
      ai_organized: page.ai_organized,
      ai_inferences: page.ai_inferences,
      related_pages: page.related_pages,
      open_questions: page.open_questions,
      ...(page.templateFields !== undefined ? { templateFields: page.templateFields } : {}),
      ...(page.mergedTemplateFields !== undefined ? { mergedTemplateFields: page.mergedTemplateFields } : {}),
      source_evidence: page.source_evidence.map((evidence) => ({
        id: evidence.id,
        rawId: evidence.rawId,
        quote: evidence.quote,
        start: evidence.start,
        end: evidence.end,
      })),
      knowledge_status: page.knowledge_status,
      confidence: page.confidence,
      source_level: page.source_level,
    })),
  });
  const applyView = (updated: DraftView) => {
    setView(updated);
    setPages(updated.pages.map((page) => ({ ...page })));
    setSavedFingerprint(reviewFingerprint(updated));
  };
  const startReview = () =>
    run('review:start', async () => {
      if (!view || dirty) throw new Error('请先保存当前编辑，再开始审查。');
      applyView(await startDraftReview(draftId, view.revision));
    });
  const moveUnit = (unitId: string, pageId: string | null) =>
    run('review:move', async () => {
      if (!view || dirty) throw new Error('请先保存编辑。');
      applyView(await moveDraftUnits(draftId, view.revision, [unitId], pageId));
    });
  const markQuestion = (unitId: string, marked: boolean) =>
    run('review:questions', async () => {
      if (!view || dirty) throw new Error('请先保存编辑。');
      applyView(await markDraftQuestions(draftId, view.revision, [unitId], marked));
    });
  const confirmPage = (pageId: string, confirmed: boolean) =>
    run('review:page', async () => {
      if (!view?.reviewContentDigest || dirty) throw new Error('请先保存编辑，并重新审查当前内容。');
      applyView(await reviewDraftPage(draftId, pageId, view.revision, view.reviewContentDigest, confirmed));
    });
  const checkDuplicates = (pageId: string) =>
    run(`duplicates:${pageId}`, async () => {
      const page = pages.find((item) => item.pageId === pageId);
      if (!page) throw new ApiError('没有找到这条建议。', 'PAGE_NOT_FOUND', 404);
      const result = await duplicateCandidates(draftId, pageId, duplicateInput(page));
      setDuplicateViews((current) => ({ ...current, [pageId]: result }));
      setDuplicateErrors((current) => {
        const next = { ...current };
        delete next[pageId];
        return next;
      });
    });
  const decide = (pageId: string, decision: 'update' | 'create' | 'defer', targetWikiId?: string) =>
    run(`decision:${pageId}`, async () => {
      const saved = await patchDraft(draftId, snapshot());
      applyView(saved);
      await savePageDecision(draftId, pageId, { baseRevision: saved.revision, decision, targetWikiId });
      applyView(await draftView(draftId));
      setDuplicateViews((current) => ({
        ...current,
        [pageId]: { ...current[pageId], decision, targetWikiId: targetWikiId ?? null },
      }));
    });
  const makeUpdate = (pageId: string, targetWikiId: string) =>
    run(`update:${pageId}`, async () => {
      if (view?.structuredNote)
        throw new Error('深度笔记需先保存，逐页审核知识卡片，并明确核对笔记后才可正式确认；旧Wiki更新暂不开放。');
      const saved = await patchDraft(draftId, snapshot());
      if (!mountedRef.current) return;
      applyView(saved);
      const workflow = await startUpdateWorkflow({ draftId, pageId, targetWikiId, baseRevision: saved.revision });
      if (!mountedRef.current) return;
      setError('更新预览已生成。');
      onOpenWorkflow?.(workflow.id);
    });
  const saveEdits = () =>
    run('save', async () => {
      const updated = await patchDraft(draftId, snapshot());
      applyView(updated);
      if (!updated.input && updated.outcomeDigest) return;
      const results = await Promise.all(
        updated.pages.map(
          async (page) => [page.pageId, await duplicateCandidates(draftId, page.pageId, duplicateInput(page))] as const,
        ),
      );
      setDuplicateViews(Object.fromEntries(results));
    });
  const removePage = (pageId: string) =>
    run('delete', async () => {
      const updated = await patchDraft(draftId, {
        ...snapshot(),
        pages: snapshot().pages?.filter((item) => item.pageId !== pageId),
        deletePageIds: [pageId],
      });
      applyView(updated);
      setMergePick((current) => current.filter((id) => id !== pageId));
    });
  const mergePages = () =>
    run('merge', async () => {
      applyView(await patchDraft(draftId, { ...snapshot(), merge: { pageIds: mergePick } }));
      setMergePick([]);
    });
  const discard = () =>
    run('discard', async () => {
      await discardDraft(draftId, view?.revision);
      await onCommitted();
      if (!mountedRef.current) return;
      onBack();
    });
  // F04-02: confirming first persists the current review snapshot, then commits that exact
  // revision — the formal pages can never differ from what the user sees on screen.
  const confirm = () =>
    run('confirm', async () => {
      if (dirty || !reviewComplete)
        throw new ApiError('请保存编辑并逐页确认全部主题与归属，解决所有未解决项。', 'HUMAN_REVIEW_INCOMPLETE', 409);
      const refreshedDuplicates = await Promise.all(
        pages
          .filter((p) => !view?.structuredNote || p.selected)
          .map(
            async (page) =>
              [
                page.pageId,
                await duplicateCandidates(draftId, page.pageId, duplicateInput(page)).catch(() => null),
              ] as const,
          ),
      );
      if (refreshedDuplicates.some(([, result]) => result === null)) {
        setDuplicateErrors(
          Object.fromEntries(
            refreshedDuplicates.filter((item) => item[1] === null).map(([id]) => [id, '候选查询失败，请重试。']),
          ),
        );
        throw new ApiError(
          '候选查询失败，已阻止确认写入；请重试后再决定新增、更新或暂不处理。',
          'DUPLICATE_QUERY_FAILED',
          503,
        );
      }
      setDuplicateViews(
        Object.fromEntries(
          refreshedDuplicates.filter((item): item is readonly [string, DuplicateResult] => Boolean(item[1])),
        ),
      );
      setDuplicateErrors({});
      const chosen = pages.filter((page) => page.selected).map((page) => page.pageId);
      if (!chosen.length && !view?.structuredNote)
        throw new ApiError('至少勾选一条知识建议，再确认写入。', 'NO_SELECTION', 400, { selectedPageIds: [] });
      const unresolved = pages.filter(
        (page) =>
          page.selected &&
          refreshedDuplicates
            .find(([id]) => id === page.pageId)?.[1]
            ?.candidates.some((candidate) => candidate.score >= 0.35) &&
          page.reviewDecision !== 'create',
      );
      if (unresolved.length)
        throw new ApiError(
          `请先对可能重复的建议明确选择更新、新建或暂不处理：${unresolved.map((page) => page.title).join('、')}`,
          'DUPLICATE_DECISION_REQUIRED',
          409,
        );
      const saved = await patchDraft(draftId, snapshot());
      applyView(saved);
      const outcome = await confirmDraft(draftId, {
        baseRevision: saved.revision,
        selectedPageIds: chosen,
        idempotencyKey,
      });
      setResult({
        operationId: outcome.operationId,
        sourceId: outcome.sourceId,
        wikiIds: outcome.wikiIds,
        sourceReused: outcome.sourceReused,
        warnings: outcome.warnings,
      });
      const status = await wikiCommit(outcome.operationId).catch(() => null);
      setCommit(status);
      if (outcome.status === 'completed') applyView({ ...saved, status: 'confirmed' });
      applyView(await draftView(draftId));
      await onCommitted();
    });

  return {
    noteDirty,
    setNoteDirty,
    showCards,
    setShowCards,
    view,
    setView,
    pages,
    setPages,
    body,
    schema,
    mergePick,
    setMergePick,
    error,
    busy,
    commit,
    confirmingDiscard,
    setConfirmingDiscard,
    result,
    typeOptions,
    selectedIds,
    conflicts,
    readOnly,
    legacyDirty,
    dirty,
    reviewComplete,
    duplicateViews,
    duplicateErrors,
    updatePage,
    updateTemplateField,
    updateMergedField,
    applyView,
    startReview,
    moveUnit,
    markQuestion,
    confirmPage,
    checkDuplicates,
    decide,
    makeUpdate,
    saveEdits,
    removePage,
    mergePages,
    discard,
    confirm,
  };
}

export type DraftReviewState = ReturnType<typeof useDraftReviewState>;
