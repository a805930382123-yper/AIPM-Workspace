import { promptSourceLabels } from '../api';
import '../prompt.css';
import { PromptAiWorkbench } from './PromptAiWorkbench.tsx';
import { PromptEditor } from './prompt/PromptEditor';
import { PromptDeleteDialog } from './prompt/PromptDeleteDialog';
import { VersionDetail } from './prompt/VersionDetail';
import { PromptDetail } from './prompt/PromptDetail';
import { usePromptLibrary } from './prompt/usePromptLibrary';

export function PromptLibraryPage({
  onChanged,
  onOpenWiki,
}: {
  onChanged: () => void;
  onOpenWiki: (id: string) => void;
}) {
  const {
    workbench,
    setWorkbench,
    taskSeed,
    schema,
    wikis,
    items,
    categoryCounts,
    query,
    setQuery,
    category,
    setCategory,
    tag,
    setTag,
    favoriteOnly,
    setFavoriteOnly,
    selectedId,
    activeDetail,
    form,
    baseVersion,
    versions,
    viewVersion,
    values,
    previewMissing,
    copy,
    deleteTarget,
    setDeleteTarget,
    busy,
    error,
    setError,
    notice,
    setNotice,
    loading,
    copyRef,
    startCreate,
    selectId,
    refreshCommittedPrompt,
    categories,
    categoryLabel,
    variables,
    missingLive,
    finalBody,
    activeCategory,
    shownPrompt,
    startEdit,
    cancelEdit,
    setField,
    save,
    toggleFavorite,
    confirmDelete,
    doRender,
    updateValues,
    copyFinal,
    openVersion,
    backToCurrent,
    linkById,
    wikiTitle,
    openLibrary,
  } = usePromptLibrary(onChanged);

  return (
    <div className="page prompt-page">
      <div className="page-heading">
        <div>
          <h1>Prompt 工作台</h1>
          <p className="subheading">
            把常用的业务提问方式整理成可复用的模板：填写变量、复制最终正文，模板本身保持不变。
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="primary-button"
            onClick={() => {
              setWorkbench('library');
              startCreate();
            }}
            disabled={!schema}
          >
            <span>＋</span> 手动新建
          </button>
        </div>
      </div>
      <nav className="prompt-tabs" aria-label="Prompt 工作台功能">
        {(
          [
            ['library', '模板库'],
            ['generator', '生成'],
            ['optimizer', '优化'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`prompt-tab ${workbench === id ? 'active' : ''}`}
            aria-current={workbench === id ? 'page' : undefined}
            onClick={() => setWorkbench(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {workbench !== 'library' ? (
        <PromptAiWorkbench
          key={`${workbench}-${taskSeed}`}
          mode={workbench}
          initialTask={taskSeed}
          onLibrary={openLibrary}
          onSaved={refreshCommittedPrompt}
          categories={categories}
        />
      ) : (
        <>
          {error && (
            <div className="prompt-message error-message" role="alert">
              {error}
              <button onClick={() => setError('')}>关闭</button>
            </div>
          )}
          {notice && (
            <div className="prompt-message success-message" role="status">
              {notice}
              <button onClick={() => setNotice('')}>关闭</button>
            </div>
          )}
          <div className="prompt-workspace">
            <section className="panel prompt-list-panel">
              <div className="prompt-search">
                <label className="search-box">
                  <span>⌕</span>
                  <input
                    aria-label="搜索 Prompt"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索名称、标签或正文"
                  />
                  {query && (
                    <button aria-label="清空搜索" onClick={() => setQuery('')}>
                      ×
                    </button>
                  )}
                </label>
                <label className="field prompt-tag-filter">
                  标签
                  <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="按标签筛选" />
                </label>
                <label className="prompt-favorite-filter">
                  <input
                    type="checkbox"
                    checked={favoriteOnly}
                    onChange={(event) => setFavoriteOnly(event.target.checked)}
                  />
                  只看收藏
                </label>
                <span className="prompt-count">{items.length} 条</span>
              </div>
              <div className="prompt-map">
                <div className="map-title">
                  <div>
                    <h2>分类</h2>
                    <span>六个默认分类，点击筛选</span>
                  </div>
                  <span className="map-total">
                    {Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)} 条
                  </span>
                </div>
                <div className="category-grid">
                  <button
                    className={`category-chip ${category === '' ? 'chosen' : ''}`}
                    onClick={() => setCategory('')}
                  >
                    全部<span>{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
                  </button>
                  {categories.map((item) => (
                    <button
                      className={`category-chip ${category === item.id ? 'chosen' : ''}`}
                      key={item.id}
                      title={item.help}
                      onClick={() => setCategory(category === item.id ? '' : item.id)}
                    >
                      {item.label}
                      <span>{categoryCounts[item.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
                {category && <p className="category-help">{categories.find((item) => item.id === category)?.help}</p>}
              </div>
              <div className="prompt-list-content">
                {loading ? (
                  <div className="list-empty">正在读取 Prompt Library…</div>
                ) : items.length ? (
                  items.map((item) => (
                    <button
                      key={item.id}
                      className={`prompt-list-item ${selectedId === item.id ? 'selected' : ''}`}
                      onClick={() => selectId(item.id)}
                    >
                      <span className="prompt-list-mark">{item.favorite ? '★' : '✳'}</span>
                      <span className="prompt-list-copy">
                        <b>
                          {item.name}
                          {item.isDemo && <span className="demo-badge">演示数据</span>}
                        </b>
                        <small>
                          {categoryLabel(item.category)} · 第 {item.version} 版
                        </small>
                        <small>
                          {item.tags.length ? `标签：${item.tags.join('、')}` : promptSourceLabels[item.source]}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="list-empty">
                    <span className="empty-symbol">✳</span>
                    <b>{query || tag || category || favoriteOnly ? '没有匹配的 Prompt' : 'Library 还是空的'}</b>
                    <span>
                      {query || tag || category || favoriteOnly
                        ? '换个关键词，或清空筛选条件。'
                        : '创建第一条模板，把常用提问方式固定下来。'}
                    </span>
                    <button className="secondary-button" onClick={startCreate}>
                      新建 Prompt
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="panel prompt-detail-panel">
              {form ? (
                <PromptEditor
                  form={form}
                  schema={schema}
                  wikis={wikis}
                  busy={busy}
                  baseVersion={baseVersion}
                  onField={setField}
                  onCancel={cancelEdit}
                  onSave={save}
                />
              ) : viewVersion ? (
                <VersionDetail
                  version={viewVersion}
                  categoryLabel={categoryLabel(viewVersion.snapshot.category)}
                  wikiTitle={wikiTitle}
                  linkById={linkById}
                  onBack={backToCurrent}
                  onOpenWiki={onOpenWiki}
                />
              ) : shownPrompt ? (
                <PromptDetail
                  prompt={shownPrompt}
                  activeCategory={activeCategory}
                  links={activeDetail?.wikiLinks ?? []}
                  wikiTitle={wikiTitle}
                  versions={versions}
                  busy={busy}
                  variables={variables}
                  values={values}
                  finalBody={finalBody}
                  missingLive={missingLive}
                  shownMissing={previewMissing}
                  copy={copy}
                  copyRef={copyRef}
                  onValues={updateValues}
                  onRender={doRender}
                  onCopy={copyFinal}
                  onFavorite={() => void toggleFavorite(shownPrompt)}
                  onEdit={() => startEdit(shownPrompt)}
                  onDelete={() => {
                    setError('');
                    setDeleteTarget(shownPrompt);
                  }}
                  onOpenVersion={openVersion}
                  onOpenWiki={onOpenWiki}
                />
              ) : (
                <div className="detail-empty">
                  <span className="empty-symbol">✳</span>
                  <b>选择或创建一条 Prompt</b>
                  <span>Library 与知识库分离：这里保存的是工作方法，不会写入 Wiki。</span>
                  <button className="secondary-button" onClick={startCreate}>
                    新建 Prompt
                  </button>
                </div>
              )}
            </section>
          </div>
          {deleteTarget && (
            <PromptDeleteDialog
              item={deleteTarget}
              busy={busy}
              onClose={() => setDeleteTarget(null)}
              onConfirm={() => void confirmDelete()}
            />
          )}
        </>
      )}
    </div>
  );
}
