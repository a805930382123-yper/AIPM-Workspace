import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ApiError,
  api,
  cancelDraftPreparation,
  confirmDraft,
  discardDraft,
  draftView,
  finishDraftReview,
  patchDraft,
  pdfOriginalPageUrl,
  prepareDraftChange,
  savePageDecision,
  setDraftDeferred,
  startUpdateWorkflow,
  wikiCommit,
} from '../api';
import type { DraftPage, DraftView, RawDraftView, Wiki, WikiCommitStatus } from '../api';
import { FormalNoteReader } from '../components/FormalNoteReader';
import { StructuredNoteEditor } from '../components/StructuredNoteEditor';
import type { RawCitationTarget } from '../components/WikiQuestionPanel';
import { mediaEvidenceHref } from '../../services/raw/media-artifact';
import { parseNoteGrid, renderStructuredNote } from '../../services/wiki/structured-note';
import type { KnowledgeChange } from '../../services/wiki/maintenance';
import { lineDifference } from './KnowledgeMaintenanceReview';

type Props = {
  view: RawDraftView;
  body: string;
  onView: (view: DraftView) => void;
  onBack: () => void;
  backLabel?: string;
  onOpenRaw: (id: string, target?: RawCitationTarget) => void;
  onOpenWiki?: (id: string) => void;
  onOpenWorkflow?: (id: string) => void;
  onCommitted: () => Promise<void>;
  advanced: ReactNode;
  advancedDirty: boolean;
  advancedBusy: boolean;
  duplicateCheck?: (page: DraftPage, disabled: boolean) => ReactNode;
};
type Edit = { id: string; title: string; text: string; description?: string };
type Duplicate = { pageId: string; candidates: Array<{ id: string; title: string }> };
type Adjustment = { changeId: string; action: KnowledgeChange['action']; targetWikiId: string };
type TopicFilter = 'all' | 'pending' | 'selected' | 'committed' | 'dismissed';
const actions = { create: '新建主题', update: '更新主题', link: '补充来源', noop: '主题无需改动' };
const statusLabels = {
  pending_confirmation: '待确认',
  committing: '正在处理上次确认',
  confirmed: '已确认入库',
  discarded: '已放弃',
};

function readDismissedIds(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function pdfOutcomeExcerpt(body: string) {
  const lines = body.split(/\r?\n/u);
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#10;': ' ' };
  const plain = (line: string) =>
    line
      .replace(/^[-*+]\s+/u, '')
      .replace(/^【归并展示】/u, '')
      .replace(/（(?:(?:含 PDF 页图 AI 解读|依据原文字层)，)?\[第 \d+ 页\]\(\/api\/raw\/.*$/u, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/(?<!\\)(\*\*|__|`)(.+?)\1/gu, '$2')
      .replace(/\\([\\`*_{}\[\]()#+.!|~\-])/gu, '$1')
      .replace(/&(?:amp|lt|gt|#10);/gu, (entity) => entities[entity])
      .trim();
  // Updates place the new PDF material after the existing Wiki text.
  for (let index = lines.lastIndexOf('## 本次 PDF 整理') + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^### (?:AI 推断|待核问题)$/u.test(line)) break;
    if (!line || /^(?:#|>|```|- (?:表头依据|表注|表列|列关系待核)[：:]|不同列口径，单独列示。)/u.test(line)) continue;
    if (line.startsWith('| ')) {
      const grid = parseNoteGrid(lines, index);
      if (grid) return grid.rows[0].slice(0, -1).map(plain).join(' · ');
      continue;
    }
    const excerpt = plain(line);
    if (excerpt) return excerpt;
  }
}

export function RawOutcomeReview(props: Props) {
  return <RawOutcomeReviewContent key={props.view.id} {...props} />;
}

function RawOutcomeReviewContent({
  view,
  body,
  onView,
  onBack,
  backLabel,
  onOpenRaw,
  onOpenWiki,
  onOpenWorkflow,
  onCommitted,
  advanced,
  advancedDirty,
  advancedBusy,
  duplicateCheck,
}: Props) {
  const dismissedKey = `aipm.outcome.dismissed.v1:${view.id}`;
  const [dismissedIds, setDismissedIds] = useState(() => readDismissedIds(dismissedKey));
  const [topicQuery, setTopicQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState<TopicFilter>('all');
  const [selection, setSelection] = useState(() => {
    if (view.deferredAt) return [];
    const remaining = view.maintenance?.changes.filter((c) => !c.committedOperationId);
    const initial = remaining?.every((c) => c.action === 'noop')
      ? remaining.map((c) => view.pages[c.pageIndex].pageId)
      : view.pages.filter((p) => p.selected && p.reviewDecision !== 'defer').map((p) => p.pageId);
    return initial.filter((id) => !dismissedIds.includes(id));
  });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pendingRead, setPendingRead] = useState(false);
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [operation, setOperation] = useState<WikiCommitStatus | null>(null);
  const [results, setResults] = useState<Record<string, WikiCommitStatus>>({});
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [targets, setTargets] = useState<Array<Pick<Wiki, 'id' | 'title'>>>([]);
  const preparation = useRef<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate | null>(null);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (preparation.current) void cancelDraftPreparation(view.id, preparation.current).catch(() => undefined);
    };
  }, [view.id]);
  const operationId = view.pendingCommitOperationId ?? view.commitOperationId;
  const operationIds = [
    ...new Set(
      [operationId, ...(view.maintenance?.changes.map((c) => c.committedOperationId) ?? [])].filter(
        (id): id is string => !!id,
      ),
    ),
  ].join(',');
  useEffect(() => {
    if (!operationIds) return;
    let active = true;
    Promise.all(operationIds.split(',').map(wikiCommit))
      .then((values) => {
        if (active) {
          setResults(Object.fromEntries(values.map((value) => [value.operationId, value])));
          setOperation(values.find((value) => value.operationId === operationId) ?? null);
        }
      })
      .catch((problem) => {
        if (active) setError(problem instanceof Error ? problem.message : '无法读取提交状态。');
      });
    return () => {
      active = false;
    };
  }, [operationIds, operationId]);

  const pdf = view.pdfInput;
  const { maintenance, pages } = view;
  const cards = useMemo(() => {
    const entries = maintenance
      ? maintenance.changes.map((change) => ({
          page: pages[change.pageIndex],
          change,
          topics: (change.pageIndexes ?? [change.pageIndex]).map((i) => pages[i]),
        }))
      : pages.map((page) => ({ page, change: undefined, topics: [page] }));
    return entries.map(({ page, change, topics }) => {
      const title = change?.candidate.title ?? page.title;
      const actionLabel = change ? actions[change.action] : '新建主题';
      const fullBody = change?.candidate.body ?? page.renderedBody ?? page.ai_organized.join('\n');
      const excerpt = pdf
        ? (pdfOutcomeExcerpt(fullBody) ?? page.one_line_definition)
        : (change?.candidate.body.split('\n').find((line) => line.trim() && !line.trimStart().startsWith('#')) ??
          page.ai_organized[0] ??
          page.source_facts[0]?.text ??
          page.one_line_definition);
      return { page, change, topics, title, actionLabel, fullBody, excerpt, committed: !!change?.committedOperationId };
    });
  }, [maintenance, pages, pdf]);
  useEffect(() => {
    const activeIds = dismissedIds.filter((id) =>
      cards.some(({ page, committed }) => page.pageId === id && !committed),
    );
    if (activeIds.length !== dismissedIds.length) setDismissedIds(activeIds);
    try {
      if (activeIds.length) window.localStorage.setItem(dismissedKey, JSON.stringify(activeIds));
      else window.localStorage.removeItem(dismissedKey);
    } catch {
      /* Keep the current dismissals in memory when browser storage is unavailable. */
    }
  }, [cards, dismissedIds, dismissedKey]);
  const readOnly = view.status !== 'pending_confirmation';
  const deferred = !!view.deferredAt && !readOnly;
  const recovering = operation && operation.status !== 'completed';
  const pendingRecovery = !!view.pendingCommitOperationId && operation?.operationId !== view.pendingCommitOperationId;
  const chosen = recovering
    ? operation.selectedPageIds
    : cards
        .filter(
          ({ page, change }) =>
            !change?.committedOperationId &&
            !dismissedIds.includes(page.pageId) &&
            (change || page.reviewDecision !== 'update') &&
            selection.includes(page.pageId),
        )
        .map(({ page }) => page.pageId);
  const committedCount = cards.filter((card) => card.committed).length;
  const dismissedCount = cards.filter(({ page, committed }) => !committed && dismissedIds.includes(page.pageId)).length;
  const pendingCount = cards.length - committedCount - dismissedCount;
  const query = topicQuery.trim().toLowerCase();
  const filtering = Boolean(query) || topicFilter !== 'all';
  const filteredCards = cards.filter(({ page, change, title, actionLabel, excerpt, committed }) => {
    const dismissed = !committed && dismissedIds.includes(page.pageId);
    if (topicFilter === 'pending' && (committed || dismissed)) return false;
    if (topicFilter === 'selected' && !chosen.includes(page.pageId)) return false;
    if (topicFilter === 'committed' && !committed) return false;
    if (topicFilter === 'dismissed' && !dismissed) return false;
    return (
      !query ||
      [title, excerpt, page.one_line_definition, change?.reason, actionLabel].some((value) =>
        value?.toLowerCase().includes(query),
      )
    );
  });
  const allowsSourceOnly = !!view.structuredNote;
  const sourceReuse = view.preview?.sourceReuse;
  const noChanges =
    chosen.length > 0 &&
    cards.filter(({ page }) => chosen.includes(page.pageId)).every(({ change }) => change?.action === 'noop');
  const staleDeferred =
    deferred && view.preview?.rawSha256Matches === false && !view.deferAvailable && !pendingRecovery && !recovering;
  const blockedSource =
    !view.preview?.rawExists || !view.preview.rawSha256Matches || (!noChanges && !!view.preview.sourceAmbiguous);
  const disabled =
    !!busy || readOnly || !!recovering || pendingRecovery || deferred || advancedDirty || advancedBusy || noteSaving;
  const editing = !!edit || noteDirty;
  const selectablePageIds = filteredCards
    .filter(
      ({ page, change, committed }) =>
        !disabled &&
        !editing &&
        !adjustment &&
        !committed &&
        !dismissedIds.includes(page.pageId) &&
        (change || page.reviewDecision !== 'update'),
    )
    .map(({ page }) => page.pageId);
  const allSelectableChosen = selectablePageIds.length > 0 && selectablePageIds.every((id) => chosen.includes(id));
  const navigationDisabled = !!busy || editing || noteSaving;
  const missingDependencies = cards.filter(
    ({ page, change }) =>
      chosen.includes(page.pageId) &&
      change?.dependsOn.some((id) =>
        cards.some(
          (other) =>
            other.change?.changeId === id && !other.change.committedOperationId && !chosen.includes(other.page.pageId),
        ),
      ),
  );
  const canConfirm =
    !busy &&
    !editing &&
    !adjustment &&
    !noteSaving &&
    !advancedDirty &&
    !advancedBusy &&
    !blockedSource &&
    !pendingRecovery &&
    !deferred &&
    (recovering || (!readOnly && !missingDependencies.length && (chosen.length > 0 || allowsSourceOnly)));
  const canDefer = view.deferAvailable && !disabled && !editing && !adjustment && !discarding;
  const selectedTitles = cards
    .filter(({ page }) => chosen.includes(page.pageId))
    .map(({ page, change }) => change?.candidate.title ?? page.title);
  const selectedQuestions = cards
    .filter(({ page }) => chosen.includes(page.pageId))
    .flatMap(({ page, change }) => change?.questions ?? page.open_questions);
  const sourceBody = view.structuredNote
    ? `## 深度整理笔记\n\n${renderStructuredNote(view.structuredNote)}`
    : (view.sourceRenderedBody ?? view.source.body);
  const modeLabel = pdf
    ? `PDF 内容清理 · ${pdf.startPage === 1 && pdf.endPage === pdf.pageCount ? '整份 PDF' : pdf.startPage === pdf.endPage ? `第 ${pdf.startPage} 页` : `第 ${pdf.startPage}–${pdf.endPage} 页`}`
    : view.structuredNote
      ? '深度整理'
      : '标准整理';

  const run = async (label: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (problem) {
      if (!mounted.current) return;
      setError(
        pdf && problem instanceof ApiError && problem.code === 'WIKI_REVISION_CONFLICT'
          ? `${problem.message} 可以先复制已保存的编辑，再结束本次选择，返回 PDF 重新生成草稿并审阅。`
          : problem instanceof Error
            ? problem.message
            : '操作失败，请重试。',
      );
      if (problem instanceof ApiError) {
        const details = problem.details as
          { operationId?: string; pageId?: string; candidates?: Duplicate['candidates'] } | undefined;
        if (details?.pageId && details.candidates)
          setDuplicates({ pageId: details.pageId, candidates: details.candidates });
        if (details?.operationId) {
          const current = await wikiCommit(details.operationId).catch(() => null);
          if (mounted.current && current) setOperation(current);
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy('');
    }
  };

  const applySavedEdit = (next: DraftView, topicId?: string) => {
    const changed = next.outcomeDigest !== view.outcomeDigest;
    if (changed) {
      setSelection((ids) => (topicId ? ids.filter((id) => id !== topicId) : []));
      request.current = null;
      setDuplicates(null);
    }
    onView(next);
    setNotice(
      changed
        ? `草稿已保存，请查看更新后的成果。${topicId ? '如需入库，请重新选择此主题。' : '如需入库，请重新选择本次成果。'}`
        : '草稿内容未变化。',
    );
  };

  const readSavedEdit = async () => {
    try {
      return await draftView(view.id);
    } catch {
      throw new Error('草稿已保存，暂时无法读取最新内容。请重新读取已保存草稿。');
    }
  };

  const save = () =>
    run('save', async () => {
      if (!edit) return;
      const card = cards.find(({ page }) => page.pageId === edit.id);
      let next: DraftView;
      if (pendingRead) {
        next = await readSavedEdit();
      } else if (card?.change) {
        await api(`/api/knowledge/drafts/${encodeURIComponent(view.id)}/changes/review`, {
          method: 'POST',
          body: JSON.stringify({
            baseRevision: view.revision,
            changeId: card.change.changeId,
            title: edit.title,
            body: edit.text,
          }),
        });
        if (!mounted.current) return;
        setPendingRead(true);
        next = await readSavedEdit();
      } else if (card) {
        next = await patchDraft(view.id, {
          baseRevision: view.revision,
          pages: [
            {
              pageId: edit.id,
              title: edit.title,
              one_line_definition: edit.description,
              ai_organized: edit.text.split('\n').filter((line) => line.trim()),
            },
          ],
        });
      } else {
        next = await patchDraft(view.id, {
          baseRevision: view.revision,
          source: { title: edit.title, body: edit.text },
        });
      }
      if (!mounted.current) return;
      applySavedEdit(next, card?.page.pageId);
      setPendingRead(false);
      setEdit(null);
    });

  const confirm = () =>
    run('confirm', async () => {
      if (!canConfirm || !view.outcomeDigest) return;
      const frozen = recovering ? operation.confirmation : undefined;
      const baseRevision = frozen?.baseRevision ?? view.revision,
        outcomeDigest = frozen?.outcomeDigest ?? view.outcomeDigest;
      const input = { baseRevision, selectedPageIds: chosen, outcomeDigest };
      const signature = JSON.stringify(input);
      if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
      const result = await confirmDraft(view.id, {
        ...input,
        idempotencyKey: frozen?.idempotencyKey ?? request.current.key,
      });
      if (!mounted.current) return;
      const next = await draftView(view.id);
      if (!mounted.current) return;
      onView(next);
      const committed = await wikiCommit(result.operationId);
      if (!mounted.current) return;
      setOperation(committed);
      setSelection((ids) => ids.filter((id) => !chosen.includes(id)));
      setNotice(
        result.status === 'completed'
          ? committed.noChanges
            ? '已检查，无需变更。'
            : '本次所选成果已确认入库。'
          : '已收到本次提交状态。',
      );
      await onCommitted();
    });

  const openAdjustment = (change: KnowledgeChange) =>
    run('targets', async () => {
      const { items } = await api<{ items: Wiki[] }>('/api/wiki');
      if (!mounted.current) return;
      setTargets(items.filter((wiki) => wiki.type !== 'source').map(({ id, title }) => ({ id, title })));
      setAdjustment({ changeId: change.changeId, action: change.action, targetWikiId: change.targetWikiId ?? '' });
    });

  const saveAdjustment = () =>
    run('prepare', async () => {
      if (!adjustment) return;
      const preparationId = crypto.randomUUID();
      preparation.current = preparationId;
      try {
        const { changeId, action, targetWikiId } = adjustment;
        const next = await prepareDraftChange(view.id, {
          baseRevision: view.revision,
          changeId,
          action,
          preparationId,
          ...(action === 'create' ? {} : { targetWikiId }),
        });
        if (!mounted.current) return;
        const changed = cards.filter(
          ({ change }) => change && (change.changeId === changeId || change.targetWikiId === targetWikiId),
        );
        setSelection((ids) => ids.filter((id) => !changed.some((card) => card.page.pageId === id)));
        request.current = null;
        onView(next);
        setAdjustment(null);
        setNotice('成果已准备，请查看新的实际差异后再选择确认。');
      } catch (problem) {
        if (!(problem instanceof ApiError) || problem.code !== 'LLM_CANCELLED') throw problem;
        if (mounted.current) setNotice('已取消准备，原成果保留。');
      } finally {
        preparation.current = null;
      }
    });
  const cancelPreparation = async () => {
    if (!preparation.current) return;
    try {
      await cancelDraftPreparation(view.id, preparation.current);
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : '无法取消准备。');
    }
  };

  const finish = () =>
    run('finish', async () => {
      if (!view.maintenance) {
        await discardDraft(view.id, view.revision);
        await onCommitted();
        if (mounted.current) onBack();
        return;
      }
      const next = await finishDraftReview(view.id, view.revision);
      if (!mounted.current) return;
      onView(next);
      setSelection([]);
      setDiscarding(false);
      setNotice(
        next.status === 'discarded' ? '本次成果全部不采纳，已保留整理历史。' : '选择已结束，未选成果保留在整理历史。',
      );
      await onCommitted();
    });

  const changeDeferred = (value: boolean) =>
    run(value ? 'defer' : 'resume', async () => {
      const next = await setDraftDeferred(view.id, view.revision, value);
      if (!mounted.current) return;
      onView(next);
      if (value) setSelection([]);
      request.current = null;
      setNotice(value ? '已移到首页的稍后处理。' : '已恢复处理，可以重新选择待确认的成果。');
      await onCommitted();
    });

  const resolveDuplicate = (pageId: string, targetWikiId?: string) =>
    run('duplicate', async () => {
      if (targetWikiId) {
        const result = await startUpdateWorkflow({
          draftId: view.id,
          pageId,
          targetWikiId,
          baseRevision: view.revision,
        });
        if (mounted.current) onOpenWorkflow?.(result.id);
      } else {
        await savePageDecision(view.id, pageId, { baseRevision: view.revision, decision: 'create' });
        if (mounted.current) onView(await draftView(view.id));
        setDuplicates(null);
      }
    });

  const editFields = edit && (
    <fieldset className="outcome-edit" disabled={disabled}>
      <legend>编辑成果</legend>
      {edit.description !== undefined && (
        <p className="extract-note">可修改标题、说明和整理内容。原文事实与引用可在下方完整成果中查看。</p>
      )}
      <label className="field">
        成果标题
        <input
          readOnly={pendingRead}
          value={edit.title}
          maxLength={300}
          onChange={(event) => setEdit({ ...edit, title: event.target.value })}
        />
      </label>
      {edit.description !== undefined && (
        <label className="field">
          一句话说明
          <input value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} />
        </label>
      )}
      <label className="field">
        {edit.description !== undefined ? '整理内容（每行一项）' : '成果正文'}
        <textarea
          rows={8}
          readOnly={pendingRead}
          value={edit.text}
          onChange={(event) => setEdit({ ...edit, text: event.target.value })}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="heading-actions">
        <button className="secondary-button" onClick={() => void save()}>
          {busy === 'save'
            ? pendingRead
              ? '正在读取草稿…'
              : '正在保存…'
            : pendingRead
              ? '重新读取已保存草稿'
              : '保存成果编辑'}
        </button>
        {!pendingRead && (
          <button
            className="text-button"
            onClick={() => {
              setEdit(null);
              setError('');
            }}
          >
            取消编辑
          </button>
        )}
      </div>
    </fieldset>
  );

  return (
    <div className="page draft-page raw-outcome" aria-busy={!!busy || advancedBusy || noteSaving}>
      <div className="page-heading">
        <div>
          <h1>整理成果</h1>
          <p className="subheading">
            {view.rawTitle} · {modeLabel} ·{' '}
            {view.maintenance && view.discardedAt
              ? view.status === 'discarded'
                ? '全部不采纳'
                : '选择已结束'
              : deferred
                ? '稍后处理'
                : recovering || pendingRecovery
                  ? statusLabels.committing
                  : operation?.noChanges && readOnly
                    ? '已检查，无需变更'
                    : statusLabels[view.status]}{' '}
            · 草稿 v{view.revision}
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={onBack} disabled={navigationDisabled}>
            {backLabel ?? '返回'}
          </button>
          <button className="text-button" onClick={() => onOpenRaw(view.rawId)} disabled={navigationDisabled}>
            查看原始资料
          </button>
        </div>
      </div>
      {error && !edit && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice-success" role="status">
          {notice}
        </div>
      )}
      {deferred && (
        <section className="panel draft-card-body" aria-labelledby="outcome-deferred-heading">
          <h2 id="outcome-deferred-heading">稍后处理</h2>
          <p>
            {staleDeferred
              ? '可以结束这次选择，再按当前原文重新整理。'
              : '已保存的成果仍在这里。继续处理后，可以选择剩余成果并确认入库。'}
          </p>
          {!view.deferAvailable && !staleDeferred && (
            <p className="notice-warn">请从原始资料核对当前整理状态后再继续。</p>
          )}
          {staleDeferred ? (
            <div className="heading-actions">
              {discarding ? (
                <>
                  <button className="secondary-button" disabled={!!busy} onClick={() => setDiscarding(false)}>
                    取消
                  </button>
                  <button className="danger-quiet" disabled={!!busy} onClick={() => void finish()}>
                    {view.commitOperationId ? '确认结束' : '确认全部不采纳'}
                  </button>
                </>
              ) : (
                <button className="text-button danger" disabled={!!busy} onClick={() => setDiscarding(true)}>
                  {view.commitOperationId ? '结束本次选择' : '全部不采纳'}
                </button>
              )}
            </div>
          ) : (
            <button
              className="primary-button"
              disabled={!!busy || !view.deferAvailable}
              onClick={() => void changeDeferred(false)}
            >
              {busy === 'resume' ? '正在恢复…' : '继续处理'}
            </button>
          )}
        </section>
      )}
      {blockedSource && (
        <p className="notice-warn" role="alert">
          {!view.preview?.rawExists
            ? '原始资料已不可读，请核实资料后再入库。'
            : !view.preview.rawSha256Matches
              ? '原始正文已变化，请根据当前资料重新整理。'
              : '有多个既有来源笔记与本资料关联，请先解决来源归属。'}
        </p>
      )}
      {operation?.status === 'completed' && (
        <section className="panel draft-card-body" aria-label={operation.noChanges ? '无需变更' : '已入库成果'}>
          <h2>{operation.noChanges ? '已检查，无需变更' : '已入库成果'}</h2>
          <p>
            {deferred
              ? '本次选择已完成，剩余成果已保存。'
              : view.status === 'pending_confirmation'
                ? '本次选择已完成，其他成果仍可继续选择。'
                : operation.noChanges
                  ? '所选主题的正文和来源均已涵盖本次资料。'
                  : '本次选择已写入知识库。'}
          </p>
          <div className="heading-actions">
            {operation.sourceId && (
              <button
                className="text-button"
                disabled={navigationDisabled}
                onClick={() => onOpenWiki?.(operation.sourceId!)}
              >
                打开正式来源笔记
              </button>
            )}
            {operation.wikiIds.map((id, index) => (
              <button className="text-button" disabled={navigationDisabled} key={id} onClick={() => onOpenWiki?.(id)}>
                打开正式主题{operation.wikiIds.length > 1 ? ` ${index + 1}` : ''}
              </button>
            ))}
          </div>
          {operation.warnings.map((warning, index) => (
            <p className="notice-warn" key={index}>
              {warning}
            </p>
          ))}
        </section>
      )}
      {recovering && (
        <section className="panel draft-card-body" aria-label="提交恢复">
          <h2>上次确认待完成</h2>
          <p>{operation.error?.message ?? '可继续完成已确认的选集。'}</p>
          <p>已落盘 {operation.writtenWikiIds.length} 项。继续时复用上次确认的成果。</p>
          {operation.writtenWikiIds.map((id, index) => (
            <button key={id} className="text-button" disabled={navigationDisabled} onClick={() => onOpenWiki?.(id)}>
              打开已落盘记录 {index + 1}
            </button>
          ))}
        </section>
      )}
      {!deferred && !pendingRecovery && (!readOnly || recovering) && (
        <section className="panel draft-card-body outcome-confirm" aria-label="整体确认入库">
          <h2>整体检查与确认</h2>
          <p>核对所选成果的价值、重大遗漏、明显错误和统计口径，再确认入库。</p>
          <p>
            <strong>本次主题 {chosen.length} 项</strong>
            {selectedTitles.length
              ? ` · ${selectedTitles.slice(0, 3).join('、')}${selectedTitles.length > 3 ? '等' : ''}`
              : ''}
          </p>
          <p>
            {noChanges
              ? '所选成果无需修改正文或来源。'
              : sourceReuse
                ? `复用来源笔记「${sourceReuse.title}」`
                : `写入来源笔记「${view.source.title}」`}
          </p>
          {selectedQuestions.length > 0 && (
            <details>
              <summary>所选主题有 {selectedQuestions.length} 项待核对</summary>
              <ul>
                {selectedQuestions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </details>
          )}
          {(editing || advancedDirty) && (
            <p className="notice-warn">
              {pendingRead
                ? '请先重新读取已保存草稿，再继续审核。'
                : editing
                  ? '请先保存或取消编辑，再离开整理成果或确认入库。'
                  : '请先保存编辑，再确认入库。'}
            </p>
          )}
          {missingDependencies.length > 0 && !recovering && (
            <p className="notice-warn">
              所选成果「{missingDependencies.map(({ change }) => change?.candidate.title).join('、')}
              」还有依赖成果未选，请一并选择。
            </p>
          )}
          <div className="heading-actions">
            <button className="primary-button" disabled={!canConfirm} onClick={() => void confirm()}>
              {busy === 'confirm'
                ? '正在确认…'
                : recovering
                  ? '继续上次确认'
                  : noChanges
                    ? '确认检查完成（无需变更）'
                    : chosen.length
                      ? `确认所选成果入库（${chosen.length}）`
                      : allowsSourceOnly
                        ? '仅确认来源笔记入库'
                        : '确认所选成果入库'}
            </button>
            {view.deferAvailable && !recovering && (
              <button
                className="secondary-button"
                disabled={!canDefer}
                aria-describedby="outcome-defer-help"
                onClick={() => void changeDeferred(true)}
              >
                {busy === 'defer' ? '正在保存…' : '稍后处理'}
              </button>
            )}
            {!recovering && (
              <button
                className="text-button danger"
                disabled={disabled || !!edit || !!adjustment || noteDirty}
                onClick={() => setDiscarding(true)}
              >
                {view.maintenance ? (view.commitOperationId ? '结束本次选择' : '全部不采纳') : '放弃草稿'}
              </button>
            )}
          </div>
          {view.deferAvailable && !recovering && (
            <p id="outcome-defer-help" className="extract-note">
              稍后处理会保留已保存的成果。继续时可重新选择，再确认入库。
            </p>
          )}
          {discarding && (
            <div className="delete-panel">
              <p>{view.maintenance ? '未提交的成果将仅保留在整理历史。' : '确定放弃当前草稿及其待入库成果？'}</p>
              <button className="secondary-button" disabled={!!busy} onClick={() => setDiscarding(false)}>
                取消
              </button>
              <button
                className="danger-quiet"
                disabled={disabled || editing || !!adjustment}
                onClick={() => void finish()}
              >
                {view.maintenance ? (view.commitOperationId ? '确认结束' : '确认全部不采纳') : '确认放弃'}
              </button>
            </div>
          )}
        </section>
      )}
      <section className="panel draft-card-body" aria-label="来源笔记成果">
        <h2>{sourceReuse ? '复用来源笔记' : '来源笔记'}</h2>
        <p>{sourceReuse?.title ?? view.source.title}</p>
        {!sourceReuse && (
          <>
            {view.source.summary && (
              <p>{view.source.summary.length > 140 ? view.source.summary.slice(0, 140) + '…' : view.source.summary}</p>
            )}
            <details>
              <summary>阅读来源笔记草稿</summary>
              <p>正式关联会按本次所选主题生成。</p>
              <FormalNoteReader body={sourceBody} />
            </details>
            {!view.structuredNote && !edit && (
              <button
                className="text-button"
                disabled={disabled || !!adjustment}
                onClick={() => setEdit({ id: 'source', title: view.source.title, text: view.source.body })}
              >
                编辑来源笔记
              </button>
            )}
            {edit?.id === 'source' && editFields}
            {view.noteWarnings?.map((warning, index) => (
              <p className="notice-warn" key={index}>
                {warning}
              </p>
            ))}
            {view.structuredNote && (
              <details className="outcome-note-edit">
                <summary>查看或编辑深度笔记</summary>
                <StructuredNoteEditor
                  view={view}
                  body={body}
                  disabled={disabled || !!edit || !!adjustment}
                  onSaved={applySavedEdit}
                  onDirty={setNoteDirty}
                  onSaving={setNoteSaving}
                  outcomeReview
                />
              </details>
            )}
          </>
        )}
      </section>
      <section className="outcome-cards" aria-label="选择入库成果">
        <div className="outcome-cards-heading">
          <div className="outcome-cards-heading-row">
            <div>
              <h2>知识主题</h2>
              <p>
                {filtering || dismissedCount
                  ? `显示 ${filteredCards.length} / 共 ${cards.length} 项 · 已入库 ${committedCount} · 已忽略 ${dismissedCount}`
                  : '阅读整理结果，选择值得加入知识库的主题。'}
              </p>
            </div>
            {selectablePageIds.length > 0 && !(view.maintenance && view.discardedAt) && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setSelection((ids) =>
                    allSelectableChosen
                      ? ids.filter((id) => !selectablePageIds.includes(id))
                      : [...new Set([...ids, ...selectablePageIds])],
                  )
                }
              >
                {filtering
                  ? allSelectableChosen
                    ? '取消当前筛选全选'
                    : `全选当前筛选（${selectablePageIds.length} 项）`
                  : allSelectableChosen
                    ? '取消全选主题'
                    : `全选可选主题（${selectablePageIds.length} 项）`}
              </button>
            )}
          </div>
          {cards.length > 0 && (
            <div className="outcome-cards-filters">
              <input
                type="search"
                aria-label="搜索主题成果"
                placeholder="搜索主题标题、摘要或理由…"
                value={topicQuery}
                disabled={editing || !!adjustment}
                onChange={(event) => setTopicQuery(event.target.value)}
              />
              <select
                aria-label="筛选主题状态"
                value={topicFilter}
                disabled={editing || !!adjustment}
                onChange={(event) => setTopicFilter(event.target.value as TopicFilter)}
              >
                <option value="all">全部主题（{cards.length}）</option>
                <option value="pending">待处理（{pendingCount}）</option>
                <option value="selected">已勾选（{chosen.length}）</option>
                <option value="committed">已入库（{committedCount}）</option>
                <option value="dismissed">已忽略（{dismissedCount}）</option>
              </select>
              {filtering && (
                <button
                  type="button"
                  className="text-button"
                  disabled={editing || !!adjustment}
                  onClick={() => {
                    setTopicQuery('');
                    setTopicFilter('all');
                  }}
                >
                  重置筛选
                </button>
              )}
            </div>
          )}
        </div>
        {cards.length > 0 && filteredCards.length === 0 && (
          <p className="outcome-filter-empty" role="status">
            没有符合当前筛选条件的主题成果。
          </p>
        )}
        {filteredCards.map(({ page, change, topics, title, actionLabel, fullBody, excerpt, committed }) => {
          const dismissible =
            !readOnly && !committed && !recovering && !deferred && !(view.maintenance && view.discardedAt);
          const dismissDisabled = disabled || editing || !!adjustment;
          if (!committed && dismissedIds.includes(page.pageId)) {
            return (
              <article
                className="panel draft-card-body outcome-card dismissed"
                key={page.pageId}
                aria-label={`成果 ${title}`}
              >
                <div className="outcome-card-heading">
                  <div>
                    <span className="tag">{actionLabel}</span>
                    <h3>{title}</h3>
                    <span className="tag outcome-dismissed-tag">已忽略</span>
                  </div>
                  {dismissible && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={dismissDisabled}
                      onClick={() => setDismissedIds((ids) => ids.filter((id) => id !== page.pageId))}
                    >
                      恢复待选
                    </button>
                  )}
                </div>
              </article>
            );
          }
          const target = view.maintenance?.context.find((wiki) => wiki.id === change?.targetWikiId);
          const conflicts = change
            ? []
            : (view.preview?.titleConflicts.filter((item) => item.title === page.title) ?? []);
          const existing =
            duplicates?.pageId === page.pageId
              ? duplicates.candidates
              : conflicts.map((c) => ({ id: c.existingId, title: c.existingTitle }));
          const canSelect =
            !disabled && !adjustment && !change?.committedOperationId && (change || page.reviewDecision !== 'update');
          const result = change?.committedOperationId ? results[change.committedOperationId] : undefined;
          const resultId =
            change && result?.status === 'completed' ? result.changeResults?.[change.changeId] : undefined;
          const evidence = [
            ...new Map(topics.flatMap((topic) => topic.source_evidence).map((ref) => [ref.id, ref])).values(),
          ];
          const pdfEvidence = [
            ...new Map(topics.flatMap((topic) => topic.pdfEvidence ?? []).map((ref) => [ref.unitId, ref])).values(),
          ];
          return (
            <article className="panel draft-card-body outcome-card" key={page.pageId} aria-label={`成果 ${title}`}>
              <div className="outcome-card-heading">
                <div>
                  <span className="tag">{actionLabel}</span>
                  <h3>{title}</h3>
                </div>
                <div className="outcome-card-actions">
                  {change?.committedOperationId ? (
                    <span>
                      {change.action === 'noop' ? '已检查，无需变更' : '已入库'}
                      {resultId && (
                        <button
                          className="text-button"
                          disabled={navigationDisabled}
                          onClick={() => onOpenWiki?.(resultId)}
                        >
                          打开正式主题
                        </button>
                      )}
                    </span>
                  ) : view.maintenance && view.discardedAt ? (
                    <span>未采纳</span>
                  ) : (
                    <label className="draft-select">
                      <input
                        type="checkbox"
                        aria-label={`选择入库 ${title}`}
                        checked={chosen.includes(page.pageId)}
                        disabled={!canSelect || editing}
                        onChange={(event) =>
                          setSelection((ids) =>
                            event.target.checked ? [...ids, page.pageId] : ids.filter((id) => id !== page.pageId),
                          )
                        }
                      />
                      {change?.action === 'noop' ? '确认检查' : '选择入库'}
                    </label>
                  )}
                  {dismissible && (
                    <button
                      type="button"
                      className="text-button outcome-dismiss-btn"
                      disabled={dismissDisabled}
                      onClick={() => {
                        setDismissedIds((ids) => [...ids, page.pageId]);
                        setSelection((ids) => ids.filter((id) => id !== page.pageId));
                      }}
                    >
                      暂不采纳
                    </button>
                  )}
                </div>
              </div>
              {target && (
                <p>
                  目标{' '}
                  <button className="text-button" disabled={navigationDisabled} onClick={() => onOpenWiki?.(target.id)}>
                    {target.title}
                  </button>{' '}
                  · v{change?.baseRevision}
                </p>
              )}
              {dismissible && duplicateCheck?.(page, disabled || editing || !!adjustment || noteDirty)}
              {!!existing.length && page.reviewDecision !== 'create' && (
                <div className="notice-warn">
                  <p>可能与已有主题重复。请选择保留独立主题、更新已有主题，或取消本次选择。</p>
                  {existing.map((candidate) => (
                    <div key={candidate.id} className="heading-actions">
                      <button
                        className="text-button"
                        disabled={navigationDisabled}
                        onClick={() => onOpenWiki?.(candidate.id)}
                      >
                        {candidate.title}
                      </button>
                      {!view.structuredNote && onOpenWorkflow && (
                        <button
                          className="text-button"
                          disabled={disabled || editing}
                          onClick={() => void resolveDuplicate(page.pageId, candidate.id)}
                        >
                          生成更新预览
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="secondary-button"
                    disabled={disabled || editing}
                    onClick={() => void resolveDuplicate(page.pageId)}
                  >
                    保留为独立主题
                  </button>
                </div>
              )}
              {!change && page.reviewDecision === 'update' && (
                <div className="notice-warn">
                  <p>此前选择了更新已有主题。可以继续更新，也可以改为独立主题。</p>
                  <div className="heading-actions">
                    {page.updateTargetWikiId && !view.structuredNote && onOpenWorkflow && (
                      <button
                        className="secondary-button"
                        disabled={disabled || editing}
                        onClick={() => void resolveDuplicate(page.pageId, page.updateTargetWikiId)}
                      >
                        继续已有主题更新
                      </button>
                    )}
                    <button
                      className="secondary-button"
                      disabled={disabled || editing}
                      onClick={() => void resolveDuplicate(page.pageId)}
                    >
                      改为独立主题
                    </button>
                  </div>
                </div>
              )}
              {!pdf && change && !change.committedOperationId && !readOnly && (
                <div className="heading-actions">
                  {!adjustment && (
                    <button
                      className="text-button"
                      disabled={disabled || !!edit || noteDirty}
                      onClick={() => void openAdjustment(change)}
                    >
                      调整动作或目标
                    </button>
                  )}
                  {adjustment?.changeId === change.changeId && (
                    <div className="outcome-edit">
                      <label className="field">
                        成果动作
                        <select
                          value={adjustment.action}
                          disabled={disabled}
                          onChange={(event) =>
                            setAdjustment({ ...adjustment, action: event.target.value as KnowledgeChange['action'] })
                          }
                        >
                          {Object.entries(actions).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {adjustment.action !== 'create' && (
                        <label className="field">
                          正式目标
                          <select
                            value={adjustment.targetWikiId}
                            disabled={disabled}
                            onChange={(event) => setAdjustment({ ...adjustment, targetWikiId: event.target.value })}
                          >
                            <option value="">选择正式知识页</option>
                            {targets.map((wiki) => (
                              <option key={wiki.id} value={wiki.id}>
                                {wiki.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p className="extract-note">
                        {adjustment.action === 'update' || adjustment.action === 'create'
                          ? '根据原文依据重新准备完整候选，保存后需要重新选择确认。'
                          : '正文保持原样，按实际来源检查变化。'}
                      </p>
                      <button
                        className="secondary-button"
                        disabled={disabled || (adjustment.action !== 'create' && !adjustment.targetWikiId)}
                        onClick={() => void saveAdjustment()}
                      >
                        {busy === 'prepare' ? '正在准备成果…' : '准备新成果'}
                      </button>
                      <button
                        className="text-button"
                        disabled={disabled && busy !== 'prepare'}
                        onClick={() => (busy === 'prepare' ? void cancelPreparation() : setAdjustment(null))}
                      >
                        {busy === 'prepare' ? '取消准备' : '取消调整'}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <p className="outcome-excerpt">
                {(excerpt || page.one_line_definition).slice(0, 100)}
                {excerpt.length > 100 ? '…' : ''}
              </p>
              {change?.reason && <p className="extract-note">{change.reason}</p>}
              {!readOnly &&
                !editing &&
                !adjustment &&
                !change?.committedOperationId &&
                (!change || change.action === 'create' || change.action === 'update') && (
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      setError('');
                      setNotice('');
                      setEdit({
                        id: page.pageId,
                        title,
                        text: change?.candidate.body ?? page.ai_organized.join('\n'),
                        description: change ? undefined : page.one_line_definition,
                      });
                    }}
                  >
                    编辑主题成果
                  </button>
                )}
              {edit?.id === page.pageId && editFields}
              <details name="raw-outcome-topic">
                <summary>
                  阅读完整主题成果
                  {(change?.questions ?? page.open_questions).length
                    ? ` · ${(change?.questions ?? page.open_questions).length} 项待核对`
                    : ''}
                </summary>
                {topics.length > 1 && (
                  <p>
                    汇总 {topics.length} 个输入主题 · {topics.map((topic) => topic.title).join('、')}
                  </p>
                )}
                {!!change?.summary.length && (
                  <ul>
                    {change.summary.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
                {target && change?.action === 'update' && (
                  <details>
                    <summary>查看新旧正文差异</summary>
                    <p className="extract-note">按完整行比较，同时可阅读下方完整候选。</p>
                    <h4>移除的旧行</h4>
                    <pre className="draft-rendered">{lineDifference(target.body, fullBody) || '无'}</pre>
                    <h4>新增的行</h4>
                    <pre className="draft-rendered">{lineDifference(fullBody, target.body) || '无'}</pre>
                  </details>
                )}
                <FormalNoteReader body={fullBody} />
                {(change?.questions ?? page.open_questions).map((question, index) => (
                  <p className="notice-warn" key={index}>
                    待核对 · {question}
                  </p>
                ))}
                {!!evidence.length && (
                  <details>
                    <summary>{evidence.some((ref) => ref.media) ? '来源引用与位置' : '原文引用与位置'}</summary>
                    <ul>
                      {evidence.map((ref) => (
                        <li key={ref.id}>
                          <blockquote>{ref.quote}</blockquote>
                          {ref.media ? (
                            <a
                              className="text-button"
                              href={mediaEvidenceHref(ref.rawId, ref.media)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              打开来源图片 {ref.media.imageIndex} 的解析引用 [{ref.start}, {ref.end})
                            </a>
                          ) : (
                            <button
                              className="text-button"
                              disabled={navigationDisabled || !view.rawSha256}
                              onClick={() =>
                                view.rawSha256 &&
                                onOpenRaw(view.rawId, {
                                  rawId: view.rawId,
                                  start: ref.start,
                                  end: ref.end,
                                  quote: ref.quote,
                                  bodySha256: view.rawSha256,
                                })
                              }
                            >
                              打开原句 [{ref.start}, {ref.end})
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {!!pdfEvidence.length && (
                  <details>
                    <summary>PDF 原页依据（{pdfEvidence.length} 项）</summary>
                    <ul>
                      {pdfEvidence.map((ref) => (
                        <li key={ref.unitId}>
                          <b>
                            {ref.kind === 'image' ? '页图 AI 解读' : '原文字层'} · 第 {ref.page} 页
                          </b>
                          <blockquote>{ref.text}</blockquote>
                          <a
                            className="text-button"
                            href={pdfOriginalPageUrl(view.rawId, ref.page)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            打开原 PDF 第 {ref.page} 页
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </details>
            </article>
          );
        })}
      </section>
      <details className="panel draft-card-body">
        <summary>整理依据与生成记录</summary>
        <details>
          <summary>阅读只读原文</summary>
          <pre className="draft-raw-preview">{body}</pre>
        </details>
        <p>
          {view.provider.name}/{view.provider.model} · {view.extraction.callCount} 次调用 · {view.extraction.chunkCount}{' '}
          段
        </p>
        {view.warnings.map((warning, index) => (
          <p key={index}>{warning}</p>
        ))}
        {view.humanReview?.units.map((unit) => (
          <p key={unit.id}>{unit.text}</p>
        ))}
      </details>
      {!pdf && (
        <details className="panel draft-card-body">
          <summary>高级草稿编辑</summary>
          <fieldset
            className="note-legacy-shell"
            disabled={navigationDisabled || !!adjustment || !!recovering || readOnly}
          >
            {advanced}
          </fieldset>
        </details>
      )}
    </div>
  );
}
