import type { RawStatus } from '../api';
import { dateText, rawStatusLabels, sourceLabels } from '../api';
import { useRawSelection } from './raw/useRawSelection';
import type { RawPageProps } from './raw/useRawSelection';
import { RawDetail } from './raw/RawDetail';
import { SynthesisDialog } from './raw/SynthesisDialog';
import { ImportDialog } from './raw/ImportDialog';
import { DeleteDialog } from './raw/DeleteDialog';
export function RawPage({
  initialOriginal,
  initialCitation,
  items,
  selectedId,
  onSelected,
  onOpenImport,
  onCommitted,
  onBodySaved,
  openImport,
  onCloseImport,
  onDeleted,
  processing,
  job,
  onJobStarted,
  navigationGeneration = 0,
  selectionGeneration = 0,
  onOpenDraft,
  onOpenWorkflow,
  onRefresh,
}: RawPageProps) {
  const {
    modelDisabled,
    selected,
    rawQuery,
    setRawQuery,
    rawStatusFilter,
    setRawStatusFilter,
    hasRawFilter,
    filteredItems,
    reimport,
    setReimport,
    deletingItem,
    setDeletingItem,
    aiError,
    aiBusy,
    importTranslation,
    synthesisOpen,
    setSynthesisOpen,
    sourcePages,
    pendingWorkflows,
    openSynthesis,
    dialogOpen,
    closeDialogs,
    openCommitted,
    handleDeleted,
    startAi,
    selectedState,
    generateImported,
  } = useRawSelection({
    initialOriginal,
    initialCitation,
    items,
    selectedId,
    onSelected,
    onOpenImport,
    onCommitted,
    onBodySaved,
    openImport,
    onCloseImport,
    onDeleted,
    processing,
    job,
    onJobStarted,
    navigationGeneration,
    selectionGeneration,
    onOpenDraft,
    onOpenWorkflow,
    onRefresh,
  });
  return (
    <div className="page raw-page">
      <div className="page-heading raw-heading">
        <div>
          <h1>Raw 原始资料</h1>
          <p className="subheading">保存文章、报告与业务记录的原文。保存后不会被 AI 改写。</p>
        </div>
        <div className="action-group">
          <button
            className="secondary-button"
            disabled={items.length < 2 || !!modelDisabled}
            title={modelDisabled}
            onClick={openSynthesis}
          >
            多来源综合
          </button>
          <button className="primary-button" onClick={onOpenImport}>
            <span>＋</span> 导入资料
          </button>
        </div>
      </div>
      {pendingWorkflows.length > 0 && (
        <section className="panel pending-knowledge-workflows">
          <div className="panel-heading">
            <div>
              <h2>待审核知识草稿</h2>
              <p>保存后可以刷新或重启，再从这里继续审核。</p>
            </div>
          </div>
          <div className="raw-list">
            {pendingWorkflows.map((item) => (
              <button className="raw-list-item" key={item.id} onClick={() => onOpenWorkflow?.(item.id)}>
                <span className="file-icon">{item.kind === 'update' ? '更' : '综'}</span>
                <span className="recent-copy">
                  <b>{item.title}</b>
                  <small>
                    {item.kind === 'update' ? '旧 Wiki 更新' : '多来源综合'} · v{item.revision} ·{' '}
                    {item.status === 'conflict' ? '提交冲突' : '待确认'}
                  </small>
                  {item.lastCommitError && <small className="form-error">{item.lastCommitError}</small>}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="raw-workspace">
        <section className="panel raw-list-panel">
          <div className="list-title">
            <div>
              <h2>所有资料</h2>
              <span>
                {filteredItems.length === items.length
                  ? `${items.length} 条`
                  : `${filteredItems.length} / ${items.length} 条`}
              </span>
            </div>
          </div>
          {items.length > 0 && (
            <div className="raw-list-filters">
              <input
                type="search"
                aria-label="搜索原始资料"
                placeholder="搜索标题、来源或标签…"
                value={rawQuery}
                onChange={(event) => setRawQuery(event.target.value)}
              />
              <div className="raw-list-filter-row">
                <select
                  aria-label="筛选资料处理状态"
                  value={rawStatusFilter}
                  onChange={(event) => setRawStatusFilter(event.target.value as 'all' | RawStatus)}
                >
                  <option value="all">全部状态</option>
                  <option value="unprocessed">未处理</option>
                  <option value="processing">AI 处理中</option>
                  <option value="pending_confirmation">待确认草稿</option>
                  <option value="generated">已入库</option>
                  <option value="failed">处理失败</option>
                </select>
                {hasRawFilter && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setRawQuery('');
                      setRawStatusFilter('all');
                    }}
                  >
                    重置筛选
                  </button>
                )}
              </div>
            </div>
          )}
          {items.length === 0 ? (
            <div className="list-empty">
              <div className="empty-symbol">▧</div>
              <b>还没有原始资料</b>
              <span>导入第一份文章或业务记录。</span>
              <button className="secondary-button" onClick={onOpenImport}>
                导入资料
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="raw-filter-empty" role="status">
              没有匹配的原始资料。
            </p>
          ) : (
            <div className="raw-list">
              {filteredItems.map((item) => {
                const state = processing[item.id];
                return (
                  <button
                    key={item.id}
                    className={`raw-list-item ${selected?.id === item.id ? 'selected' : ''}`}
                    onClick={() => onSelected(item.id)}
                  >
                    <span className="file-icon">文</span>
                    <span className="recent-copy">
                      <b>
                        {item.title}
                        {item.isDemo && <span className="demo-badge">演示数据</span>}
                      </b>
                      <small>
                        {sourceLabels[item.sourceType]} · {item.sourceName}
                        {item.origin ? ' · 本机专用' : ''}
                      </small>
                      <small>
                        {dateText(item.importedAt)}
                        {state && state.status !== 'unprocessed'
                          ? ` · ${state.status === 'processing' ? '上次保存状态：' : ''}${rawStatusLabels[state.status]}`
                          : ''}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel raw-detail-panel">
          {selected ? (
            <RawDetail
              initialOriginal={initialOriginal}
              initialCitation={initialCitation}
              initialTranslation={importTranslation?.rawId === selected.id ? importTranslation : null}
              key={selected.id}
              item={selected}
              state={selectedState}
              job={job}
              onStorageReconciled={(value) => {
                onJobStarted(value, navigationGeneration, selectionGeneration);
                void onRefresh();
              }}
              busy={aiBusy}
              error={aiError}
              onStartAi={(restart, planningRetry, mode) => void startAi(selected.id, restart, planningRetry, mode)}
              onReimport={() => setReimport(selected)}
              onDelete={() => setDeletingItem(selected)}
              onOpenDraft={onOpenDraft}
              onBodySaved={
                onBodySaved ??
                (() => {
                  void onRefresh();
                })
              }
            />
          ) : selectedId ? (
            <div className="detail-empty" role="status">
              <span className="empty-symbol">▤</span>
              <b>所选 Raw 不存在或已删除</b>
              <span>服务端未返回 ID {selectedId} 对应的资料。请选择列表中的其他 Raw。</span>
            </div>
          ) : (
            <div className="detail-empty">
              <span className="empty-symbol">▤</span>
              <b>选择一条资料开始阅读</b>
              <span>导入后，正文和来源信息会显示在这里。</span>
            </div>
          )}
        </section>
      </div>
      {dialogOpen && (
        <ImportDialog
          prefill={reimport}
          onClose={closeDialogs}
          onCommitted={onCommitted}
          onOpen={openCommitted}
          onGenerate={generateImported}
        />
      )}
      {deletingItem && (
        <DeleteDialog item={deletingItem} onClose={() => setDeletingItem(null)} onDeleted={handleDeleted} />
      )}
      {synthesisOpen && (
        <SynthesisDialog
          items={items}
          sourcePages={sourcePages}
          onClose={() => setSynthesisOpen(false)}
          onCreated={(workflowId) => {
            setSynthesisOpen(false);
            onOpenWorkflow?.(workflowId);
          }}
        />
      )}
    </div>
  );
}
export { ImportDialog } from './raw/ImportDialog';
export { DeleteDialog } from './raw/DeleteDialog';
