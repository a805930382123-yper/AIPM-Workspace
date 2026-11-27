import { KnowledgeMaintenanceReview } from './KnowledgeMaintenanceReview';
import { RawOutcomeReview } from './RawOutcomeReview';
import { StructuredNoteEditor } from '../components/StructuredNoteEditor';
import { sourceLabels } from '../api';
import type { DraftReviewPageProps } from './draft-review/draftReviewModel';
import { useDraftReviewState } from './draft-review/useDraftReviewState';
import { DraftAssignmentEditor } from './draft-review/DraftAssignmentEditor';
import { DraftPageEditors } from './draft-review/DraftPageEditors';
import { DuplicateCheckSection } from './draft-review/DuplicateCheckSection';

export function DraftReviewPage(props: DraftReviewPageProps) {
  return <DraftReviewPageContent key={props.draftId} {...props} />;
}

function DraftReviewPageContent({
  draftId,
  onBack,
  onCommitted,
  onOpenRaw,
  onOpenWorkflow,
  onOpenWiki,
  backLabel,
}: DraftReviewPageProps) {
  const state = useDraftReviewState({ draftId, onBack, onCommitted, onOpenRaw, onOpenWorkflow, onOpenWiki, backLabel });
  const {
    noteDirty,
    setNoteDirty,
    showCards,
    setShowCards,
    view,
    setView,
    body,
    schema,
    error,
    busy,
    commit,
    confirmingDiscard,
    setConfirmingDiscard,
    result,
    selectedIds,
    conflicts,
    readOnly,
    legacyDirty,
    dirty,
    reviewComplete,
    applyView,
    saveEdits,
    discard,
    confirm,
  } = state;
  if (!view)
    return (
      <div className="page draft-page">
        <div className="page-heading">
          <div>
            <h1>{error ? '无法读取草稿' : '正在读取草稿…'}</h1>
          </div>
          <button className="secondary-button" onClick={onBack}>
            {backLabel ?? '返回'}
          </button>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <p>{error}</p>
          </div>
        )}
      </div>
    );

  if (view.input)
    return (
      <KnowledgeMaintenanceReview
        view={view}
        body={body}
        onView={applyView}
        onBack={onBack}
        backLabel={backLabel}
        onOpenRaw={onOpenRaw}
        onOpenWiki={onOpenWiki}
        onCommitted={onCommitted}
      />
    );
  const outcomeMode = !!view.outcomeDigest;
  const assignmentEditor = <DraftAssignmentEditor state={state} view={view} />;
  const pageEditors = <DraftPageEditors state={state} view={view} onOpenRaw={onOpenRaw} />;
  if (outcomeMode)
    return (
      <RawOutcomeReview
        view={view}
        body={body}
        onView={applyView}
        onBack={onBack}
        backLabel={backLabel}
        onOpenRaw={onOpenRaw}
        onOpenWiki={onOpenWiki}
        onOpenWorkflow={onOpenWorkflow}
        onCommitted={onCommitted}
        advancedDirty={legacyDirty}
        advancedBusy={!!busy}
        duplicateCheck={(page, disabled) => (
          <DuplicateCheckSection
            state={state}
            view={view}
            page={page}
            advisory
            disabled={disabled}
            onOpenWiki={onOpenWiki}
          />
        )}
        advanced={
          <>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!readOnly && assignmentEditor && (
              <details>
                <summary>标注来源问题</summary>
                {assignmentEditor}
              </details>
            )}
            {!view.maintenance && (
              <>
                <button
                  className="secondary-button"
                  disabled={readOnly || !!busy || !legacyDirty}
                  onClick={() => void saveEdits()}
                >
                  保存草稿
                </button>
                {pageEditors}
              </>
            )}
          </>
        }
      />
    );
  if (view.maintenance)
    return (
      <KnowledgeMaintenanceReview
        view={view}
        body={body}
        onView={applyView}
        onBack={onBack}
        backLabel={backLabel}
        onOpenRaw={onOpenRaw}
        onOpenWiki={onOpenWiki}
        onCommitted={onCommitted}
      />
    );

  return (
    <div className="page draft-page">
      <div className="page-heading">
        <div>
          <h1>审核「{view.document.title}」</h1>
          <p className="subheading">
            AI 知识整理预览 · 草稿版本 v{view.revision} ·{' '}
            {(
              {
                pending_confirmation: '待人工确认',
                committing: '提交中',
                confirmed: '已确认',
                discarded: '已放弃',
              } as Record<string, string>
            )[view.status] ?? view.status}
          </p>
          <details className="review-technical">
            <summary>规则与提供方信息</summary>
            <p>
              提供方 {view.provider.name}/{view.provider.model} · 规则 {view.rulesVersion} ·{' '}
              {view.extraction ? `${view.extraction.chunkCount} 段 / ${view.extraction.callCount} 次调用` : ''}
            </p>
          </details>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={onBack}>
            {backLabel ?? '返回 Raw'}
          </button>
          <button
            className="secondary-button"
            disabled={readOnly || busy !== '' || noteDirty}
            onClick={() => void saveEdits()}
          >
            {busy === 'save' ? '正在保存…' : '保存草稿'}
          </button>
          <button
            className="secondary-button danger-quiet"
            disabled={readOnly || busy !== ''}
            onClick={() => setConfirmingDiscard(true)}
          >
            放弃草稿
          </button>
          <button
            className="primary-button"
            disabled={
              (!!view.structuredNote && view.noteApproval?.digest !== view.reviewContentDigest) ||
              readOnly ||
              busy !== '' ||
              (!view.structuredNote && selectedIds.length === 0) ||
              dirty ||
              !reviewComplete
            }
            onClick={() => void confirm()}
          >
            {busy === 'confirm' ? '正在保存并提交…' : `确认写入 Wiki（${selectedIds.length}）`}
          </button>
        </div>
      </div>

      <div className="review-overview" role="status">
        <b>审核状态</b>
        <span>
          {view.status === 'confirmed'
            ? '已确认写入'
            : view.status === 'discarded'
              ? '草稿已放弃'
              : view.status === 'committing'
                ? '正在提交'
                : dirty
                  ? '有未保存修改，需保存后重新审查'
                  : reviewComplete
                    ? '归属审查已完成，正式写入仍需明确确认'
                    : '归属审查尚未完成'}
        </span>
        <span>
          草稿状态：
          {(
            {
              pending_confirmation: '待人工确认',
              committing: '提交中',
              confirmed: '已确认',
              discarded: '已放弃',
            } as Record<string, string>
          )[view.status] ?? view.status}
        </span>
      </div>
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {result && (
        <section className="result-panel partial">
          <div className="result-head warn">
            <span className="result-dot warn" />
            {commit?.status === 'completed' ? '正式保存成功 · ' : ''}提交操作{' '}
            {commit?.status === 'completed' ? '已完成' : '未完成 / 待恢复'}（operationId {result.operationId}）
          </div>
          <ul className="result-list">
            <li>
              <span>Source</span>
              <code>{result.sourceId ?? '复用既有 Source'}</code>
            </li>
            <li>
              <span>知识页</span>
              <code>{result.wikiIds.join('、') || '—'}</code>
            </li>
            <li>
              <span>阶段</span>
              <span>
                {commit ? commit.phases.map((phase) => `${phase.name}:${phase.status}`).join(' · ') : '正在读取'}
              </span>
            </li>
          </ul>
          {commit?.recoveryHint && <p className="notice-warn">{commit.recoveryHint}</p>}
          {commit?.error && (
            <p className="notice-warn">
              {commit.error.code}：{commit.error.message}
            </p>
          )}
          <p className="extract-note">已写入的正式文件已保留；列表与统计以磁盘为准。请勿重复确认同一份草稿。</p>
        </section>
      )}

      {view.structuredNote && (
        <>
          <StructuredNoteEditor
            key={view.id}
            view={view}
            body={body}
            disabled={readOnly || busy !== '' || legacyDirty}
            onSaved={applyView}
            onDirty={setNoteDirty}
          />
          <button className="secondary-button" onClick={() => setShowCards(!showCards)}>
            {showCards ? '收起知识卡片与人审' : '知识卡片与主题归属审查'}
          </button>
          <p className="notice-warn">
            保存并完成全部页面及笔记审核后，可明确确认创建Source与所选知识页；更新已有知识卡片暂不开放。
          </p>
        </>
      )}
      <fieldset className="note-legacy-shell" disabled={noteDirty} hidden={!!view.structuredNote && !showCards}>
        {assignmentEditor}
        {!readOnly && selectedIds.length === 0 && (
          <div className="notice-warn">
            {view.structuredNote
              ? '未选知识卡片时将仅创建Source；仍需完成全部页面与深度笔记审核。'
              : '默认没有选中任何知识建议：勾选要写入正式 Wiki 的条目后，确认按钮才可用。'}
          </div>
        )}
        {view.warnings.length > 0 && (
          <div className="notice-warn">
            {view.warnings.map((warning) => (
              <p key={warning}>
                {view.structuredNote && (warning.includes('只有勾选') || warning.includes('尚未开放正式确认'))
                  ? '保存并完成全部页面及笔记审核后，可明确确认创建Source与所选知识页；更新已有知识卡片暂不开放。'
                  : warning}
              </p>
            ))}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="notice-warn conflict-warn">
            {conflicts.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}

        {confirmingDiscard && (
          <div className="delete-panel">
            <b>放弃这份草稿？</b>
            <div>草稿会标记为已放弃，不会写入任何正式知识；原文与既有 Wiki 不受影响。</div>
            <div className="error-actions">
              <button className="secondary-button" onClick={() => setConfirmingDiscard(false)}>
                取消
              </button>
              <button className="primary-button danger-button" onClick={() => void discard()}>
                确认放弃
              </button>
            </div>
          </div>
        )}

        <div className="draft-columns">
          <section className="panel draft-source-panel">
            <div className="panel-heading">
              <div>
                <h2>原始资料</h2>
                <p>
                  {sourceLabels[view.raw?.sourceType ?? 'other']} · {view.raw?.sourceName ?? ''}
                </p>
              </div>
              <button className="text-button" onClick={() => onOpenRaw(view.rawId)}>
                打开 Raw <span>›</span>
              </button>
            </div>
            <div className="draft-source-body">
              <h3>{view.raw?.title ?? view.rawTitle}</h3>
              {view.raw?.author && (
                <p className="detail-source">
                  作者：{view.raw.author}
                  {view.raw.publishedAt ? ` · ${view.raw.publishedAt}` : ''}
                </p>
              )}
              {view.raw?.url && <p className="detail-source">链接：{view.raw.url}</p>}
              <p className="detail-source">
                正文 {body.length.toLocaleString()} 字符 · 正文校验值{' '}
                <code className="mono">{view.raw?.bodySha256.slice(0, 16)}…</code>
              </p>
              <pre className="draft-raw-preview">
                {body.slice(0, 1200)}
                {body.length > 1200 ? '\n…' : ''}
              </pre>
            </div>
          </section>

          <section className="panel draft-source-summary">
            <div className="panel-heading">
              <div>
                <h2>{view.structuredNote ? 'Source 摘要（草稿预览）' : 'Source 预览（本次提交组成）'}</h2>
                <p>
                  {view.structuredNote
                    ? '审核通过并显式确认后创建Source，保留当前深度笔记。'
                    : view.preview?.sourceReuse
                      ? `将复用既有 Source：${view.preview.sourceReuse.title}`
                      : '将新建 1 个 Source 页面'}
                </p>
              </div>
            </div>
            <div className="draft-card-body">
              <label className="field">
                Source 标题
                <input
                  value={view.source.title}
                  disabled={readOnly || busy !== ''}
                  onChange={(event) => setView({ ...view, source: { ...view.source, title: event.target.value } })}
                  maxLength={300}
                />
              </label>
              <label className="field">
                Source 摘要
                <textarea
                  value={view.source.body}
                  disabled={readOnly || busy !== ''}
                  onChange={(event) => setView({ ...view, source: { ...view.source, body: event.target.value } })}
                  rows={8}
                />
              </label>
              <div className="draft-enum-row">
                <label className="field">
                  来源等级
                  <select
                    value={view.source.source_level}
                    disabled={readOnly || busy !== ''}
                    onChange={(event) =>
                      setView({ ...view, source: { ...view.source, source_level: event.target.value } })
                    }
                  >
                    {(schema?.sourcePolicy.levels ?? []).map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  知识状态
                  <select
                    value={view.source.knowledge_status}
                    disabled={readOnly || busy !== ''}
                    onChange={(event) =>
                      setView({ ...view, source: { ...view.source, knowledge_status: event.target.value } })
                    }
                  >
                    {(schema?.enums.knowledge_status ?? []).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  可信度
                  <select
                    value={view.source.confidence}
                    disabled={readOnly || busy !== ''}
                    onChange={(event) =>
                      setView({ ...view, source: { ...view.source, confidence: event.target.value } })
                    }
                  >
                    {(schema?.enums.confidence ?? []).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="extract-note">
                保存草稿会把 Source 的编辑一起持久化；verified 只能由你明确标记，AI 不会自动设置。
              </p>
            </div>
          </section>
        </div>

        {pageEditors}
        <p className="extract-note">
          {view.structuredNote
            ? '深度笔记经逐页与笔记人工核对后，可明确确认创建Source及所选知识卡片。Raw 正文不会被改写。'
            : '预览中的「来源事实 / AI 整理 / AI 推断 / 待确认问题 / 来源证据」会按同一分节写入正式 Markdown；未选中的建议不会落盘。Raw 正文不会被改写。'}
        </p>
      </fieldset>
    </div>
  );
}
