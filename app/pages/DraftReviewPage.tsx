import { useEffect, useMemo, useState } from 'react';
import type { DraftPatch, DraftPage, DraftView, Raw, WikiCommitStatus, WikiSchema, DuplicateResult } from '../api';
import { ApiError, api, confirmDraft, discardDraft, draftView, patchDraft, sourceLabels, wikiCommit, duplicateCandidates, savePageDecision, startUpdateWorkflow } from '../api';

type PageDraft = DraftPage & { renderedBody?: string };

const conflictText = (view: DraftView) => {
  const preview = view.preview;
  if (!preview) return [];
  const lines: string[] = [];
  if (!preview.rawExists) lines.push('对应的原始资料已不存在，不能确认写入。');
  if (preview.rawExists && !preview.rawSha256Matches) lines.push('原始正文校验值已变化，已停止写入以避免产生坏来源。');
  if (preview.sourceAmbiguous) lines.push(`这条 Raw 已有 ${preview.sourceAmbiguous.length} 个 Source 页面，归属不明；本批不自动合并或更新旧 Source，请人工处理。`);
  if (preview.sourceReuse) lines.push(`将复用既有 Source「${preview.sourceReuse.title}」（${preview.sourceReuse.id}）：本次不修改它。`);
  for (const conflict of preview.titleConflicts) {
    lines.push(`${conflict.kind === 'alias' ? '别名' : '标题'}冲突：「${conflict.title}」已被「${conflict.existingTitle}」（${conflict.existingId}）占用；请改名，或对该建议选择“更新已有页”“仍创建新页”或“暂不处理”。显式新建会生成独立页面，关联链接可能产生歧义。`);
  }
  if (preview.batchDuplicateTitles.length) lines.push(`本次选择里有重复标题：${preview.batchDuplicateTitles.join('、')}；请改名或合并。`);
  return lines;
};
const duplicateDimension: Record<string, string> = { title: '标题', aliases: '别名', category: '分类', tags: '标签', content: '内容相似' };

export function DraftReviewPage({ draftId, onBack, onCommitted, onOpenRaw, onOpenWorkflow }: {
  draftId: string; onBack: () => void; onCommitted: () => Promise<void>; onOpenRaw: (id: string) => void; onOpenWorkflow?: (id: string) => void;
}) {
  const [view, setView] = useState<DraftView | null>(null);
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [body, setBody] = useState('');
  const [schema, setSchema] = useState<WikiSchema | null>(null);
  const [mergePick, setMergePick] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [commit, setCommit] = useState<WikiCommitStatus | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [result, setResult] = useState<{ operationId: string; sourceId: string | null; wikiIds: string[]; sourceReused: boolean; warnings: string[] } | null>(null);
  const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}`);
  const [duplicateViews, setDuplicateViews] = useState<Record<string, DuplicateResult>>({});
  const [duplicateErrors, setDuplicateErrors] = useState<Record<string, string>>({});

  const load = async () => {
    setError('');
    try {
      const next = await draftView(draftId);
      setView(next);
      setPages(next.pages.map(page => ({ ...page })));
      const raw = await api<Raw>(`/api/raw/${encodeURIComponent(next.rawId)}`).catch(() => null);
      setBody(raw?.body ?? '');
    } catch (problem) { setError(problem instanceof Error ? problem.message : '无法读取这份草稿。'); }
  };
  useEffect(() => { void load(); }, [draftId]);
  useEffect(() => {
    let active = true;
    api<WikiSchema>('/api/wiki/schema').then(value => { if (active) setSchema(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const typeOptions = useMemo(() => (schema?.types ?? []).filter(type => type.id !== 'source' && type.id !== 'synthesis'), [schema]);
  const selectedIds = pages.filter(page => page.selected).map(page => page.pageId);
  const conflicts = view ? conflictText(view) : [];
  const readOnly = view ? view.status !== 'pending_confirmation' : true;

  useEffect(() => {
    if (!view || readOnly || pages.length === 0) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const results = await Promise.all(pages.map(async page => {
        try { return [page.pageId, await duplicateCandidates(draftId, page.pageId, duplicateInput(page)), null] as const; }
        catch (problem) { return [page.pageId, null, problem instanceof Error ? problem.message : '候选查询失败。'] as const; }
      }));
      if (!active) return;
      setDuplicateViews(current => ({ ...current, ...Object.fromEntries(results.filter((item): item is readonly [string, DuplicateResult, null] => item[1] !== null).map(([id, value]) => [id, value])) }));
      setDuplicateErrors(current => {
        const next = { ...current };
        for (const [id, value] of results) if (value !== null) delete next[id];
        for (const [id, _value, error] of results) if (error !== null) next[id] = error;
        return next;
      });
    }, 100);
    return () => { active = false; window.clearTimeout(timer); };
  }, [draftId, view?.revision, readOnly, pages]);
  const updatePage = (pageId: string, patch: Partial<PageDraft>) => {
    setDuplicateViews(current => { const next = { ...current }; delete next[pageId]; return next; });
    setDuplicateErrors(current => { const next = { ...current }; delete next[pageId]; return next; });
    const basis = ['title', 'type', 'category', 'one_line_definition', 'source_facts', 'ai_organized'] as const;
    const invalidatesDecision = basis.some(key => key in patch);
    setPages(current => current.map(page => page.pageId === pageId ? { ...page, ...patch, ...(invalidatesDecision ? { reviewDecision: undefined, updateTargetWikiId: undefined } : {}) } : page));
  };
  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await work(); }
    catch (problem) {
      if (problem instanceof ApiError && problem.code === 'DRAFT_CONFIRM_PARTIAL') setError(problem.message);
      else if (problem instanceof ApiError && (problem.details as { operationId?: string } | undefined)?.operationId) {
        const operationId = (problem.details as { operationId?: string }).operationId as string;
        setError(problem.message);
        const status = await wikiCommit(operationId).catch(() => null);
        if (status) setCommit(status);
        setResult({ operationId, sourceId: status?.sourceId ?? null, wikiIds: status?.wikiIds ?? [], sourceReused: false, warnings: status?.warnings ?? [] });
        await onCommitted();
      } else setError(problem instanceof Error ? problem.message : '操作失败，请重试。');
    }
    finally { setBusy(''); }
  };
  /** F04-01: one snapshot carrying every editable field (Source, document and pages). */
  const snapshot = (sourceView: DraftView | null = view, sourcePages: PageDraft[] = pages): DraftPatch => ({
    baseRevision: sourceView?.revision ?? 0,
    document: sourceView ? { title: sourceView.document.title, main_topic: sourceView.document.main_topic, summary: sourceView.document.summary } : undefined,
    source: sourceView ? {
      title: sourceView.source.title, summary: sourceView.source.summary, body: sourceView.source.body,
      category: sourceView.source.category, knowledge_status: sourceView.source.knowledge_status,
      confidence: sourceView.source.confidence, source_level: sourceView.source.source_level,
      key_takeaways: sourceView.source.key_takeaways,
    } : undefined,
    pages: sourcePages.map(page => ({
      pageId: page.pageId, selected: page.selected, title: page.title, type: page.type, category: page.category,
      one_line_definition: page.one_line_definition, source_facts: page.source_facts, ai_organized: page.ai_organized,
      ai_inferences: page.ai_inferences, related_pages: page.related_pages, open_questions: page.open_questions,
      source_evidence: page.source_evidence.map(evidence => ({ id: evidence.id, rawId: evidence.rawId, quote: evidence.quote, start: evidence.start, end: evidence.end })),
      knowledge_status: page.knowledge_status, confidence: page.confidence, source_level: page.source_level,
    })),
  });
  const applyView = (updated: DraftView) => { setView(updated); setPages(updated.pages.map(page => ({ ...page }))); };
  const duplicateInput = (page: PageDraft) => ({ title: page.title, category: page.category, content: [page.one_line_definition, ...page.source_facts.map(item => item.text), ...page.ai_organized].join('\n') });
  const checkDuplicates = (pageId: string) => run(`duplicates:${pageId}`, async () => {
    const page = pages.find(item => item.pageId === pageId);
    if (!page) throw new ApiError('没有找到这条建议。', 'PAGE_NOT_FOUND', 404);
    const result = await duplicateCandidates(draftId, pageId, duplicateInput(page));
    setDuplicateViews(current => ({ ...current, [pageId]: result }));
    setDuplicateErrors(current => { const next = { ...current }; delete next[pageId]; return next; });
  });
  const decide = (pageId: string, decision: 'update' | 'create' | 'defer', targetWikiId?: string) => run(`decision:${pageId}`, async () => {
    const saved = await patchDraft(draftId, snapshot()); applyView(saved);
    await savePageDecision(draftId, pageId, { baseRevision: saved.revision, decision, targetWikiId });
    applyView(await draftView(draftId));
    setDuplicateViews(current => ({ ...current, [pageId]: { ...current[pageId], decision, targetWikiId: targetWikiId ?? null } }));
  });
  const makeUpdate = (pageId: string, targetWikiId: string) => run(`update:${pageId}`, async () => {
    const saved = await patchDraft(draftId, snapshot());
    applyView(saved);
    const workflow = await startUpdateWorkflow({ draftId, pageId, targetWikiId, baseRevision: saved.revision });
    setError('更新预览已生成。'); onOpenWorkflow?.(workflow.id);
  });
  const saveEdits = () => run('save', async () => {
    const updated = await patchDraft(draftId, snapshot()); applyView(updated);
    const results = await Promise.all(updated.pages.map(async page => [page.pageId, await duplicateCandidates(draftId, page.pageId, duplicateInput(page))] as const));
    setDuplicateViews(Object.fromEntries(results));
  });
  const removePage = (pageId: string) => run('delete', async () => {
    const updated = await patchDraft(draftId, { ...snapshot(), pages: snapshot().pages?.filter(item => item.pageId !== pageId), deletePageIds: [pageId] });
    applyView(updated); setMergePick(current => current.filter(id => id !== pageId));
  });
  const mergePages = () => run('merge', async () => {
    applyView(await patchDraft(draftId, { ...snapshot(), merge: { pageIds: mergePick } }));
    setMergePick([]);
  });
  const discard = () => run('discard', async () => {
    await discardDraft(draftId, view?.revision);
    await onCommitted();
    onBack();
  });
  // F04-02: confirming first persists the current review snapshot, then commits that exact
  // revision — the formal pages can never differ from what the user sees on screen.
  const confirm = () => run('confirm', async () => {
    const refreshedDuplicates = await Promise.all(pages.map(async page => [page.pageId, await duplicateCandidates(draftId, page.pageId, duplicateInput(page)).catch(() => null)] as const));
    if (refreshedDuplicates.some(([, result]) => result === null)) {
      setDuplicateErrors(Object.fromEntries(refreshedDuplicates.filter(item => item[1] === null).map(([id]) => [id, '候选查询失败，请重试。'])));
      throw new ApiError('候选查询失败，已阻止确认写入；请重试后再决定新增、更新或暂不处理。', 'DUPLICATE_QUERY_FAILED', 503);
    }
    setDuplicateViews(Object.fromEntries(refreshedDuplicates.filter((item): item is readonly [string, DuplicateResult] => Boolean(item[1]))));
    setDuplicateErrors({});
    const chosen = pages.filter(page => page.selected).map(page => page.pageId);
    if (!chosen.length) throw new ApiError('至少勾选一条知识建议，再确认写入。', 'NO_SELECTION', 400, { selectedPageIds: [] });
    const unresolved = pages.filter(page => page.selected && (refreshedDuplicates.find(([id]) => id === page.pageId)?.[1]?.candidates.some(candidate => candidate.score >= 0.35)) && page.reviewDecision !== 'create');
    if (unresolved.length) throw new ApiError(`请先对可能重复的建议明确选择更新、新建或暂不处理：${unresolved.map(page => page.title).join('、')}`, 'DUPLICATE_DECISION_REQUIRED', 409);
    const saved = await patchDraft(draftId, snapshot());
    applyView(saved);
    const outcome = await confirmDraft(draftId, { baseRevision: saved.revision, selectedPageIds: chosen, idempotencyKey });
    setResult({ operationId: outcome.operationId, sourceId: outcome.sourceId, wikiIds: outcome.wikiIds, sourceReused: outcome.sourceReused, warnings: outcome.warnings });
    const status = await wikiCommit(outcome.operationId).catch(() => null);
    setCommit(status);
    await onCommitted();
  });

  if (!view) return <div className="page draft-page"><div className="page-heading"><div><p className="eyebrow">AI 知识整理预览</p><h1>正在读取草稿…</h1></div><button className="secondary-button" onClick={onBack}>返回</button></div>
    {error && <div className="form-error" role="alert"><p>{error}</p></div>}</div>;

  return <div className="page draft-page">
    <div className="page-heading">
      <div>
        <p className="eyebrow">AI 知识整理预览 · 人工审核</p>
        <h1>审核「{view.document.title}」</h1>
        <p className="subheading">
          草稿版本 v{view.revision} · 状态 {view.status} · 提供方 {view.provider.name}/{view.provider.model} ·
          规则 {view.rulesVersion} · {view.extraction ? `${view.extraction.chunkCount} 段 / ${view.extraction.callCount} 次调用` : ''}
        </p>
      </div>
      <div className="heading-actions">
        <button className="secondary-button" onClick={onBack}>返回 Raw</button>
        <button className="secondary-button" disabled={readOnly || busy !== ''} onClick={() => void saveEdits()}>{busy === 'save' ? '正在保存…' : '保存草稿'}</button>
        <button className="secondary-button danger-quiet" disabled={readOnly || busy !== ''} onClick={() => setConfirmingDiscard(true)}>放弃草稿</button>
        <button className="primary-button" disabled={readOnly || busy !== '' || selectedIds.length === 0} onClick={() => void confirm()}>{busy === 'confirm' ? '正在保存并提交…' : `确认写入 Wiki（${selectedIds.length}）`}</button>
      </div>
    </div>

    {error && <div className="form-error" role="alert"><p>{error}</p></div>}
    {!readOnly && selectedIds.length === 0 && <div className="notice-warn">默认没有选中任何知识建议：勾选要写入正式 Wiki 的条目后，确认按钮才可用。</div>}
    {view.warnings.length > 0 && <div className="notice-warn">{view.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    {conflicts.length > 0 && <div className="notice-warn conflict-warn">{conflicts.map(line => <p key={line}>{line}</p>)}</div>}

    {result && <section className="result-panel partial">
      <div className="result-head warn"><span className="result-dot warn" />提交操作 {commit?.status === 'completed' ? '已完成' : '未完成 / 待恢复'}（operationId {result.operationId}）</div>
      <ul className="result-list">
        <li><span>Source</span><code>{result.sourceId ?? '复用既有 Source'}</code></li>
        <li><span>知识页</span><code>{result.wikiIds.join('、') || '—'}</code></li>
        <li><span>阶段</span><span>{commit ? commit.phases.map(phase => `${phase.name}:${phase.status}`).join(' · ') : '正在读取'}</span></li>
      </ul>
      {commit?.recoveryHint && <p className="notice-warn">{commit.recoveryHint}</p>}
      {commit?.error && <p className="notice-warn">{commit.error.code}：{commit.error.message}</p>}
      <p className="extract-note">已写入的正式文件已保留；列表与统计以磁盘为准。请勿重复确认同一份草稿。</p>
    </section>}

    {confirmingDiscard && <div className="delete-panel"><b>放弃这份草稿？</b><div>草稿会标记为已放弃，不会写入任何正式知识；原文与既有 Wiki 不受影响。</div>
      <div className="error-actions"><button className="secondary-button" onClick={() => setConfirmingDiscard(false)}>取消</button><button className="primary-button danger-button" onClick={() => void discard()}>确认放弃</button></div></div>}

    <div className="draft-columns">
      <section className="panel draft-source-panel">
        <div className="panel-heading"><div><h2>原始资料</h2><p>{sourceLabels[view.raw?.sourceType ?? 'other']} · {view.raw?.sourceName ?? ''}</p></div><button className="text-button" onClick={() => onOpenRaw(view.rawId)}>打开 Raw <span>›</span></button></div>
        <div className="draft-source-body">
          <h3>{view.raw?.title ?? view.rawTitle}</h3>
          {view.raw?.author && <p className="detail-source">作者：{view.raw.author}{view.raw.publishedAt ? ` · ${view.raw.publishedAt}` : ''}</p>}
          {view.raw?.url && <p className="detail-source">链接：{view.raw.url}</p>}
          <p className="detail-source">正文 {body.length.toLocaleString()} 字符 · 正文校验值 <code className="mono">{view.raw?.bodySha256.slice(0, 16)}…</code></p>
          <pre className="draft-raw-preview">{body.slice(0, 1200)}{body.length > 1200 ? '\n…' : ''}</pre>
        </div>
      </section>

      <section className="panel draft-source-summary">
        <div className="panel-heading"><div><h2>Source 预览（本次提交组成）</h2><p>{view.preview?.sourceReuse ? `将复用既有 Source：${view.preview.sourceReuse.title}` : '将新建 1 个 Source 页面'}</p></div></div>
        <div className="draft-card-body">
          <label className="field">Source 标题<input value={view.source.title} disabled={readOnly || busy !== ''} onChange={event => setView({ ...view, source: { ...view.source, title: event.target.value } })} maxLength={300} /></label>
          <label className="field">Source 摘要<textarea value={view.source.body} disabled={readOnly || busy !== ''} onChange={event => setView({ ...view, source: { ...view.source, body: event.target.value } })} rows={8} /></label>
          <div className="draft-enum-row">
            <label className="field">来源等级<select value={view.source.source_level} disabled={readOnly || busy !== ''} onChange={event => setView({ ...view, source: { ...view.source, source_level: event.target.value } })}>{(schema?.sourcePolicy.levels ?? []).map(level => <option key={level.id} value={level.id}>{level.label}</option>)}</select></label>
            <label className="field">知识状态<select value={view.source.knowledge_status} disabled={readOnly || busy !== ''} onChange={event => setView({ ...view, source: { ...view.source, knowledge_status: event.target.value } })}>{(schema?.enums.knowledge_status ?? []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="field">可信度<select value={view.source.confidence} disabled={readOnly || busy !== ''} onChange={event => setView({ ...view, source: { ...view.source, confidence: event.target.value } })}>{(schema?.enums.confidence ?? []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <p className="extract-note">保存草稿会把 Source 的编辑一起持久化；verified 只能由你明确标记，AI 不会自动设置。</p>
        </div>
      </section>
    </div>

    <section className="panel draft-pages-panel">
      <div className="panel-heading">
        <div><h2>知识建议（{pages.length} 条，已选 {selectedIds.length} 条）</h2><p>默认全部未选中的建议不会被写入；只有勾选的条目会创建为正式 Wiki。</p></div>
        <div className="action-group">
          <button className="secondary-button" disabled={readOnly || busy !== ''} onClick={() => setPages(current => current.map(page => ({ ...page, selected: true })))}>全选</button>
          <button className="secondary-button" disabled={readOnly || busy !== ''} onClick={() => setPages(current => current.map(page => ({ ...page, selected: false })))}>全不选</button>
          <button className="secondary-button" disabled={readOnly || mergePick.length < 2 || busy !== ''} onClick={() => void mergePages()}>{busy === 'merge' ? '正在合并…' : `合并所选（${mergePick.length}）`}</button>
        </div>
      </div>
      {pages.map((page, index) => <article className={`draft-card ${page.selected ? 'selected' : ''}`} key={page.pageId}>
        <div className="draft-card-head">
          <label className="draft-select"><input type="checkbox" checked={page.selected} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { selected: event.target.checked })} /><span>写入</span></label>
          <label className="draft-select"><input type="checkbox" checked={mergePick.includes(page.pageId)} disabled={readOnly || busy !== ''} onChange={event => setMergePick(current => event.target.checked ? [...current, page.pageId] : current.filter(id => id !== page.pageId))} /><span>合并</span></label>
          <span className="draft-index">#{index + 1}</span>
          <input className="draft-title" value={page.title} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { title: event.target.value })} maxLength={300} aria-label="建议标题" />
          <button className="text-button danger" disabled={readOnly || busy !== '' || pages.length <= 1} onClick={() => void removePage(page.pageId)}>删除</button>
        </div>
        <div className="draft-enum-row">
          <label className="field">类型<select value={page.type} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { type: event.target.value })}>{typeOptions.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
          <label className="field">分类<select value={page.category} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { category: event.target.value })}>{(schema?.categories ?? []).map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
          <label className="field">来源等级<select value={page.source_level} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { source_level: event.target.value })}>{(schema?.sourcePolicy.levels ?? []).map(level => <option key={level.id} value={level.id}>{level.label}</option>)}</select></label>
          <label className="field">知识状态<select value={page.knowledge_status} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { knowledge_status: event.target.value })}>{(schema?.enums.knowledge_status ?? []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="field">可信度<select value={page.confidence} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { confidence: event.target.value })}>{(schema?.enums.confidence ?? []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <div className="duplicate-review">
          <button className="secondary-button" disabled={readOnly || busy !== ''} onClick={() => void checkDuplicates(page.pageId)}>刷新重复候选</button>
          {duplicateErrors[page.pageId] && <div className="form-error" role="alert">候选查询失败：{duplicateErrors[page.pageId]}。为避免漏掉已有知识，确认写入会被阻止。</div>}
          {duplicateViews[page.pageId] && <div className="duplicate-results">
            <p>以下是启发式候选，供人工选择，不代表事实判定。</p>
            {duplicateViews[page.pageId].candidates.length === 0 ? <span>未发现候选。</span> : duplicateViews[page.pageId].candidates.map(candidate => <div className="duplicate-candidate" key={candidate.wiki.id}>
              <strong>{candidate.wiki.title}</strong><small>Wiki {candidate.wiki.id} · 来源 Raw：{candidate.wiki.sources.join('、') || '无'}</small><span>建议相似度 {(candidate.score * 100).toFixed(0)}%</span>
              <p>{candidate.matches.map(match => `${duplicateDimension[match.dimension] ?? match.dimension}：${match.reason}`).join('；')}</p>
              <button className="text-button" disabled={readOnly || busy !== ''} onClick={() => void decide(page.pageId, 'update', candidate.wiki.id)}>选择更新</button>
              <button className="text-button" disabled={readOnly || busy !== ''} onClick={() => void decide(page.pageId, 'create')}>仍创建新页</button>
            </div>)}
            <button className="text-button" disabled={readOnly || busy !== ''} onClick={() => void decide(page.pageId, 'defer')}>暂不处理</button>
            {page.reviewDecision === 'update' && page.updateTargetWikiId && <button className="text-button" disabled={busy !== ''} onClick={() => void makeUpdate(page.pageId, page.updateTargetWikiId!)}>生成旧 Wiki 更新预览</button>}
          </div>}
        </div>
        <label className="field">一句话说明<input value={page.one_line_definition} disabled={readOnly || busy !== ''} onChange={event => updatePage(page.pageId, { one_line_definition: event.target.value })} maxLength={300} /></label>
        <div className="draft-split">
          <div className="draft-block"><h4>来源事实（原文支持，逐条带证据）</h4>
            {page.source_facts.map((fact, factIndex) => <div className="draft-line" key={`${page.pageId}-fact-${factIndex}`}>
              <textarea value={fact.text} disabled={readOnly || busy !== ''} rows={2} onChange={event => {
                const source_facts = page.source_facts.map((item, itemIndex) => itemIndex === factIndex ? { ...item, text: event.target.value } : item);
                updatePage(page.pageId, { source_facts });
              }} />
              <span className="draft-evidence-ref">证据 {fact.evidenceIds.join('、')}</span>
            </div>)}
            {!page.source_facts.length && <p className="extract-note">没有原文支持的事实。</p>}
          </div>
          <div className="draft-block"><h4>AI 整理</h4>
            {page.ai_organized.map((item, itemIndex) => <div className="draft-line" key={`${page.pageId}-org-${itemIndex}`}><textarea value={item} disabled={readOnly || busy !== ''} rows={2} onChange={event => {
              const ai_organized = page.ai_organized.map((value, valueIndex) => valueIndex === itemIndex ? event.target.value : value);
              updatePage(page.pageId, { ai_organized });
            }} /></div>)}
            {!page.ai_organized.length && <p className="extract-note">暂无</p>}
          </div>
          <div className="draft-block"><h4>AI 推断</h4>
            {page.ai_inferences.map((item, itemIndex) => <div className="draft-line" key={`${page.pageId}-inf-${itemIndex}`}><textarea value={item} disabled={readOnly || busy !== ''} rows={2} onChange={event => {
              const ai_inferences = page.ai_inferences.map((value, valueIndex) => valueIndex === itemIndex ? event.target.value : value);
              updatePage(page.pageId, { ai_inferences });
            }} /></div>)}
            {!page.ai_inferences.length && <p className="extract-note">暂无</p>}
          </div>
          <div className="draft-block"><h4>待确认问题</h4>
            {page.open_questions.map((item, itemIndex) => <div className="draft-line" key={`${page.pageId}-q-${itemIndex}`}><textarea value={item} disabled={readOnly || busy !== ''} rows={2} onChange={event => {
              const open_questions = page.open_questions.map((value, valueIndex) => valueIndex === itemIndex ? event.target.value : value);
              updatePage(page.pageId, { open_questions });
            }} /></div>)}
            {page.open_questions.length === 0 && <p className="extract-note">暂无</p>}
          </div>
        </div>
        <div className="draft-evidence">
          <h4>来源证据（全局位置已按完整 Raw 校验）</h4>
          {page.source_evidence.map(evidence => <div className="draft-evidence-row" key={evidence.id}>
            <code className="mono">{evidence.id}</code>
            <span className="draft-evidence-quote">{evidence.quote}</span>
            <span className="draft-evidence-pos">[{evidence.start}, {evidence.end}) · 第 {evidence.chunkIndex + 1} 段</span>
            <button className="text-button" onClick={() => onOpenRaw(view.rawId)}>查看原文</button>
          </div>)}
        </div>
        {page.notes && page.notes.length > 0 && <p className="notice-warn">{page.notes.map(note => <span key={note}>{note}</span>)}</p>}
        {(page.mergedFrom?.length ?? 0) > 0 && <p className="extract-note">由合并生成：{page.mergedFrom?.join('、')}</p>}
      </article>)}
    </section>
    <p className="extract-note">预览中的「来源事实 / AI 整理 / AI 推断 / 待确认问题 / 来源证据」会按同一分节写入正式 Markdown；未选中的建议不会落盘。Raw 正文不会被改写。</p>
  </div>;
}
