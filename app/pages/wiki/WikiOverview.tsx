import type { RawCitationTarget } from '../../components/WikiQuestionPanel';
import type { WikiWorkspace } from './useWikiWorkspace';
import { WikiEditor } from './WikiEditor';
import { WikiDetail } from './WikiDetail';
import { statusLabels, typeLabel } from './wikiShared';

export function WikiOverview({
  workspace,
  onOpenWorkflow,
  onOpenDraft,
  onOpenRaw,
  onChanged,
  initialAudit,
}: {
  workspace: WikiWorkspace;
  onOpenWorkflow?: (id: string) => void;
  onOpenDraft?: (id: string) => void;
  onOpenRaw: (id: string, target?: RawCitationTarget) => void;
  onChanged: () => void;
  initialAudit?: { wikiId: string; auditId: string; revision: number; wikiRevision: number } | null;
}) {
  const {
    error,
    setError,
    notice,
    setNotice,
    pendingWorkflows,
    pendingDrafts,
    query,
    updateQuery,
    items,
    categoryCounts,
    category,
    updateCategory,
    schema,
    loading,
    selectedId,
    chooseItem,
    startCreate,
    detailPanel,
    form,
    raws,
    busy,
    baseRevision,
    activeTemplate,
    setField,
    setForm,
    save,
    detailTarget,
    selected,
    inspectionCitation,
    startEdit,
    requestDelete,
    openWiki,
    applyReview,
    refreshReviewPage,
    setActiveSubView,
  } = workspace;
  return (
    <>
      {error && (
        <div className="wiki-message error-message" role="alert">
          {error}
          <button onClick={() => setError('')}>关闭</button>
        </div>
      )}
      {notice && (
        <div className="wiki-message success-message" role="status">
          {notice}
          <button onClick={() => setNotice('')}>关闭</button>
        </div>
      )}
      {pendingWorkflows.length > 0 && (
        <section className="panel pending-knowledge-workflows">
          <div className="panel-heading">
            <div>
              <h2>待审核更新与综合 · {pendingWorkflows.length}</h2>
              <p>包括旧 Wiki 更新与多来源综合草稿。</p>
            </div>
          </div>
          <div className="raw-list">
            {pendingWorkflows.map((item) => (
              <button className="raw-list-item" key={item.id} onClick={() => onOpenWorkflow?.(item.id)}>
                <span className="file-icon">{item.kind === 'update' ? '更' : '综'}</span>
                <span className="recent-copy">
                  <b>{item.title}</b>
                  <small>
                    {item.kind === 'update' ? '旧 Wiki 更新' : '多来源综合'} ·{' '}
                    {item.status === 'conflict' ? '提交冲突' : '待确认'} · v{item.revision}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {pendingDrafts.length > 0 && (
        <section className="panel pending-wiki-drafts">
          <div className="panel-heading">
            <div>
              <h2>待审核草稿 · {pendingDrafts.length}</h2>
              <p>刷新或重启后仍可继续审核；确认前不会写入 Wiki。</p>
            </div>
          </div>
          <div className="raw-list">
            {pendingDrafts.map((item) => (
              <button className="raw-list-item" key={item.id} onClick={() => onOpenDraft?.(item.id)}>
                <span className="file-icon">审</span>
                <span className="recent-copy">
                  <b>{item.title}</b>
                  <small>{item.rawTitle} · 草稿待审核</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="wiki-workspace">
        <section className="panel wiki-list-panel">
          <div className="wiki-search">
            <label className="search-box">
              <span>⌕</span>
              <input
                aria-label="搜索 Wiki"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                placeholder="搜索标题、别名、标签、正文或分类"
              />
              {query && (
                <button aria-label="清空搜索" onClick={() => updateQuery('')}>
                  ×
                </button>
              )}
            </label>
            <span className="wiki-count">{items.length} 页</span>
          </div>
          <div className="wiki-map">
            <div className="map-title">
              <div>
                <h2>学习地图</h2>
                <span>按业务主题浏览</span>
              </div>
              <span className="map-total">
                {Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)} 页
              </span>
            </div>
            <div className="category-grid">
              <button className={`category-chip ${category === '' ? 'chosen' : ''}`} onClick={() => updateCategory('')}>
                全部<span>{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
              </button>
              {schema?.categories.map((item) => (
                <button
                  className={`category-chip ${category === item.id ? 'chosen' : ''}`}
                  key={item.id}
                  onClick={() => updateCategory(category === item.id ? '' : item.id)}
                >
                  {item.label}
                  <span>{categoryCounts[item.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="wiki-list-content">
            {loading ? (
              <div className="list-empty">正在读取知识库…</div>
            ) : items.length ? (
              items.map((item) => (
                <button
                  key={item.id}
                  className={`wiki-list-item ${selectedId === item.id ? 'selected' : ''}`}
                  onClick={() => chooseItem(item.id)}
                >
                  <span className="wiki-type-mark">{typeLabel(schema, item.type).slice(0, 1)}</span>
                  <span className="wiki-list-copy">
                    <b>
                      {item.title}
                      {item.isDemo && <span className="demo-badge">演示数据</span>}
                    </b>
                    <small>
                      {typeLabel(schema, item.type)} ·{' '}
                      {schema?.categories.find((value) => value.id === item.category)?.label ?? item.category}
                    </small>
                    <small>
                      {item.aliases.length
                        ? `别名：${item.aliases.join('、')}`
                        : (statusLabels[item.knowledge_status] ?? item.knowledge_status)}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <div className="list-empty">
                <span className="empty-symbol">▤</span>
                <b>没有匹配的知识页</b>
                <span>换个关键词，或为当前主题创建一页。</span>
                <button className="secondary-button" onClick={startCreate}>
                  新建 Wiki
                </button>
              </div>
            )}
          </div>
        </section>
        <section className="panel wiki-detail-panel" ref={detailPanel} tabIndex={-1}>
          {form ? (
            <WikiEditor
              schema={schema}
              raws={raws}
              form={form}
              busy={busy}
              baseRevision={baseRevision}
              template={activeTemplate}
              onField={setField}
              onCancel={() => {
                setForm(null);
                setError('');
              }}
              onSave={save}
              onOpenRaw={onOpenRaw}
            />
          ) : detailTarget?.edit ? (
            <div className="detail-empty" role="status">
              正在打开 Wiki 编辑器…
            </div>
          ) : selected ? (
            <WikiDetail
              citation={inspectionCitation}
              key={selected.id}
              initialAudit={initialAudit?.wikiId === selected.id ? initialAudit : null}
              item={selected}
              schema={schema}
              raws={raws}
              busy={busy}
              onEdit={() => startEdit(selected)}
              onDelete={() => void requestDelete(selected)}
              onOpenRaw={onOpenRaw}
              onOpenWiki={openWiki}
              onChanged={onChanged}
              onReviewed={applyReview}
              onReviewOutdated={() => refreshReviewPage(selected.id)}
            />
          ) : (
            <div className="detail-empty">
              <span className="empty-symbol">▤</span>
              <b>从学习地图开始整理知识</b>
              <span>创建六类 Wiki 页面，并关联保存过的 Raw 来源。</span>
              <button className="primary-button" onClick={() => setActiveSubView('raw-to-wiki')}>
                从 Raw 生成 Wiki 草稿
              </button>
              <button className="secondary-button" onClick={startCreate}>
                手动创建 Wiki
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
