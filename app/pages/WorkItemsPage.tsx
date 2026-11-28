import type { Raw, WorkItemKind } from '../api';
import { WorkItemDetail } from './work-items/WorkItemDetail';
import { WorkItemForm } from './work-items/WorkItemForm';
import { useWorkItemsState } from './work-items/useWorkItemsState';
import { Status, workKindLabel } from './work-items/workItemShared';
export { workKindLabel, workStatusLabel } from './work-items/workItemShared';

export function WorkItemsPage({
  initialId,
  initialFocusMaterials = false,
  raws,
  onOpenRaw,
  onChanged,
}: {
  initialId: string | null;
  initialFocusMaterials?: boolean;
  raws: Raw[];
  onOpenRaw: (id: string) => void;
  onChanged: () => void;
}) {
  const state = useWorkItemsState({ initialId, initialFocusMaterials, onChanged });
  const {
    mode,
    id,
    focusMaterials,
    items,
    item,
    loadError,
    setReload,
    createKind,
    creating,
    searchQuery,
    setSearchQuery,
    kindFilter,
    setKindFilter,
    statusFilter,
    setStatusFilter,
    back,
    open,
    beginCreate,
    hasFilters,
    filteredItems,
  } = state;
  if (mode === 'detail' && item?.id === id && item) {
    return (
      <WorkItemDetail
        key={item.id}
        item={item}
        focusMaterials={focusMaterials}
        raws={raws}
        onBack={back}
        onOpenRaw={onOpenRaw}
        onChanged={onChanged}
      />
    );
  }
  return (
    <div className="page work-page">
      <div className="page-heading">
        <div>
          <h1>{mode === 'create' ? `新建${workKindLabel(createKind)}` : '工作事项'}</h1>
          {mode === 'list' && <p className="subheading">跟进客户问题和产品分析，保留每一步进展。</p>}
        </div>
        {mode === 'list' ? (
          <div className="work-buttons">
            <button className="primary-button" onClick={() => beginCreate('customer_issue')}>
              新建客户问题
            </button>
            <button className="secondary-button" onClick={() => beginCreate('product_analysis')}>
              新建产品分析
            </button>
          </div>
        ) : (
          <button className="secondary-button" disabled={creating} onClick={back}>
            返回工作事项
          </button>
        )}
      </div>
      {mode === 'create' && <WorkItemForm state={state} />}
      {mode !== 'create' &&
        (loadError ? (
          <div className="panel work-section">
            <p className="form-error" role="alert">
              {loadError}
            </p>
            <button className="secondary-button" onClick={() => setReload((value) => value + 1)}>
              重新读取
            </button>
          </div>
        ) : mode === 'detail' || items === null || filteredItems === null ? (
          <p role="status">正在读取工作事项…</p>
        ) : (
          <section className="panel work-section" aria-labelledby="work-list-heading">
            <div className="work-section-heading">
              <h2 id="work-list-heading">事项列表</h2>
              <span className="work-note">
                {filteredItems.length === items.length
                  ? `${items.length} 项`
                  : `${filteredItems.length} / ${items.length} 项`}
              </span>
            </div>
            {items.length > 0 && (
              <div className="work-list-filters">
                <input
                  type="search"
                  aria-label="搜索工作事项"
                  placeholder="搜索事项标题…"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <select
                  aria-label="筛选事项类型"
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value as 'all' | WorkItemKind)}
                >
                  <option value="all">全部类型</option>
                  <option value="customer_issue">客户问题</option>
                  <option value="product_analysis">产品分析</option>
                </select>
                <select
                  aria-label="筛选进展状态"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'closed')}
                >
                  <option value="all">全部状态</option>
                  <option value="active">进行中（未关闭）</option>
                  <option value="closed">已解决或已完成</option>
                </select>
                {hasFilters && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setSearchQuery('');
                      setKindFilter('all');
                      setStatusFilter('all');
                    }}
                  >
                    重置筛选
                  </button>
                )}
              </div>
            )}
            {items.length === 0 ? (
              <p className="work-note">还没有工作事项。可先记录一条客户反馈或产品分析目标。</p>
            ) : filteredItems.length === 0 ? (
              <p className="work-note" role="status">
                没有匹配筛选条件的工作事项。
              </p>
            ) : (
              <ul className="work-list">
                {filteredItems.map((entry) => (
                  <li key={entry.id}>
                    <button className="work-list-row" onClick={() => open(entry.id)}>
                      <span className="work-list-title">{entry.title}</span>
                      <span className="work-note">{workKindLabel(entry.kind)}</span>
                      {entry.followUpOn && (
                        <span className="work-note">
                          跟进 <time dateTime={entry.followUpOn}>{entry.followUpOn}</time>
                        </span>
                      )}
                      <Status kind={entry.kind} value={entry.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}
