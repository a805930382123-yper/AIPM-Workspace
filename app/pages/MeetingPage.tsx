import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Meeting, type MeetingCatalog, type MeetingSummary } from '../api';
import { MeetingMinutes } from '../MeetingMinutes';
import { MeetingRawLinks } from '../MeetingRawLinks';
import { readQueryParams } from '../router/routes';
import { subscribePopState } from '../router/useAppRoute';
import { CatalogDialog } from './meeting/CatalogDialog';
import { MeetingEditor } from './meeting/MeetingEditor';
import { PolicyDialog } from './meeting/PolicyDialog';
import {
  DEFAULT_MEETING_FILTERS,
  filterAndSortMeetings,
  formatMeetingError,
  MEETING_LEVELS,
  type MeetingFilters,
  readMeetingFilters,
  safeMeetingHref,
  saveMeetingFilters,
} from './meeting/meetingFilters';
import '../meeting.css';

export function MeetingPage({
  onRawChanged,
  onOpenRaw,
  initialCreate = false,
}: { onRawChanged?: () => Promise<void>; onOpenRaw?: (id: string) => void; initialCreate?: boolean } = {}) {
  const [catalog, setCatalog] = useState<MeetingCatalog | null>(null),
    [items, setItems] = useState<MeetingSummary[]>([]),
    [selectedId, setSelectedId] = useState<string | null>(() => readQueryParams().get('meeting'));
  const [detail, setDetail] = useState<Meeting | null>(null),
    [filters, setFilters] = useState<MeetingFilters>(readMeetingFilters),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState<'create' | 'edit' | null>(initialCreate ? 'create' : null),
    [policy, setPolicy] = useState(false),
    [manage, setManage] = useState<'types' | 'tags' | null>(null),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [deleteLocalConfirm, setDeleteLocalConfirm] = useState(false),
    [deleteRawConfirm, setDeleteRawConfirm] = useState(false);
  const [modalToken, setModalToken] = useState(0);
  const epoch = useRef(0);
  const detailEpoch = useRef(0);
  const modalTokenRef = useRef(0);
  const mounted = useRef(false);
  const deleteLock = useRef(false);
  const initialSelectedIdRef = useRef(selectedId);
  const bumpModalToken = useCallback(() => {
    modalTokenRef.current += 1;
    setModalToken(modalTokenRef.current);
    return modalTokenRef.current;
  }, []);
  const fetchDirectoryAndDetail = useCallback(async (target: string | null, token: number) => {
    const [c, l] = await Promise.all([
      api<MeetingCatalog>('/api/meeting-catalog'),
      api<{ items: MeetingSummary[] }>('/api/meetings'),
    ]);
    if (token !== epoch.current) return;
    setCatalog(c);
    setItems(l.items);
    if (target && l.items.some((x) => x.meeting_id === target)) {
      setSelectedId(target);
      const current = ++detailEpoch.current;
      try {
        const d = await api<Meeting>(`/api/meetings/${encodeURIComponent(target)}`);
        if (token === epoch.current && current === detailEpoch.current) setDetail(d);
      } catch (e) {
        if (token === epoch.current && current === detailEpoch.current) setError(formatMeetingError(e));
      }
    } else {
      setSelectedId(null);
      setDetail(null);
      saveMeetingFilters(readMeetingFilters(), null);
    }
  }, []);
  const load = useCallback(
    async (target: string | null) => {
      const token = ++epoch.current;
      setLoading(true);
      setError('');
      try {
        await fetchDirectoryAndDetail(target, token);
      } catch (e) {
        if (token === epoch.current) setError(formatMeetingError(e));
      } finally {
        if (token === epoch.current) setLoading(false);
      }
    },
    [fetchDirectoryAndDetail],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const token = ++epoch.current;
    void fetchDirectoryAndDetail(initialSelectedIdRef.current, token)
      .catch((e) => {
        if (active && token === epoch.current) setError(formatMeetingError(e));
      })
      .finally(() => {
        if (active && token === epoch.current) setLoading(false);
      });
    const unsubscribe = subscribePopState(() => {
      bumpModalToken();
      setNotice('');
      setForm(null);
      setPolicy(false);
      setManage(null);
      setDeleteConfirm(false);
      const f = readMeetingFilters();
      setFilters(f);
      const id = readQueryParams().get('meeting');
      setSelectedId(id);
      void load(id);
    });
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
    };
  }, [bumpModalToken, fetchDirectoryAndDetail, load]);
  const select = async (id: string | null) => {
    epoch.current++;
    bumpModalToken();
    setLoading(false);
    setBusy(false);
    setNotice('');
    setForm(null);
    setPolicy(false);
    setManage(null);
    setSelectedId(id);
    setDetail(null);
    setDeleteConfirm(false);
    saveMeetingFilters(filters, id, true);
    const token = ++detailEpoch.current;
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const d = await api<Meeting>(`/api/meetings/${encodeURIComponent(id)}`);
      if (token === detailEpoch.current) setDetail(d);
    } catch (e) {
      if (token === detailEpoch.current) setError(formatMeetingError(e));
    } finally {
      if (token === detailEpoch.current) setBusy(false);
    }
  };
  const catalogName = useCallback(
    (kind: 'types' | 'tags', id: string) => catalog?.[kind].find((x) => x.id === id)?.name ?? '已停用目录项',
    [catalog],
  );
  const filtered = useMemo(
    () => filterAndSortMeetings(items, filters, (tagId) => catalogName('tags', tagId)),
    [items, filters, catalogName],
  );
  const updateFilter = (key: keyof MeetingFilters, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    saveMeetingFilters(next, selectedId);
  };
  const afterMutation = async (id: string | null, dialogToken: number) => {
    if (!mounted.current || dialogToken !== modalTokenRef.current) return;
    bumpModalToken();
    setBusy(false);
    setForm(null);
    setPolicy(false);
    setManage(null);
    setDeleteConfirm(false);
    await load(id);
  };
  const openEditor = (value: 'create' | 'edit') => {
    bumpModalToken();
    setNotice('');
    setForm(value);
  };
  const closeEditor = () => {
    bumpModalToken();
    setForm(null);
  };
  const openPolicy = () => {
    bumpModalToken();
    setPolicy(true);
  };
  const closePolicy = () => {
    bumpModalToken();
    setPolicy(false);
  };
  const openCatalog = (value: 'types' | 'tags') => {
    bumpModalToken();
    setManage(value);
  };
  const closeCatalog = () => {
    bumpModalToken();
    setManage(null);
  };
  return (
    <section className="page meeting-page">
      <div className="page-heading">
        <div>
          <h1>会议档案</h1>
          <p className="subheading">按标题、业务标签与参会背景管理会议云端索引。</p>
        </div>
        <button className="primary-button" onClick={() => openEditor('create')}>
          <span>＋</span>新建会议
        </button>
      </div>
      {error && (
        <div className="meeting-error" role="alert">
          {error}
          <button className="text-button" onClick={() => void load(selectedId)}>
            重新读取
          </button>
        </div>
      )}
      {notice && (
        <p className="meeting-save-notice" role="status">
          {notice}
        </p>
      )}
      <div className="meeting-toolbar panel">
        <label className="field meeting-search">
          搜索
          <input
            aria-label="搜索会议标题、标签、客户或项目"
            value={filters.q}
            onChange={(e) => updateFilter('q', e.target.value)}
            placeholder="标题、标签、客户或项目"
          />
        </label>
        <label className="field">
          主类型
          <select aria-label="按主类型筛选" value={filters.type} onChange={(e) => updateFilter('type', e.target.value)}>
            <option value="">全部类型</option>
            {catalog?.types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {!x.active ? '（已停用）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          标签
          <select aria-label="按标签筛选" value={filters.tag} onChange={(e) => updateFilter('tag', e.target.value)}>
            <option value="">全部标签</option>
            {catalog?.tags.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {!x.active ? '（已停用）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          客户
          <select
            aria-label="按客户筛选"
            value={filters.customer}
            onChange={(e) => updateFilter('customer', e.target.value)}
          >
            <option value="">全部客户</option>
            {distinct(items.map((x) => x.customer))}
          </select>
        </label>
        <label className="field">
          项目
          <select
            aria-label="按项目筛选"
            value={filters.project}
            onChange={(e) => updateFilter('project', e.target.value)}
          >
            <option value="">全部项目</option>
            {distinct(items.map((x) => x.project))}
          </select>
        </label>
        <label className="field">
          保密等级
          <select
            aria-label="按保密等级筛选"
            value={filters.level}
            onChange={(e) => updateFilter('level', e.target.value)}
          >
            <option value="">全部等级</option>
            {MEETING_LEVELS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button meeting-sort"
          onClick={() => updateFilter('order', filters.order === 'desc' ? 'asc' : 'desc')}
          aria-label="切换日期排序"
        >
          日期 {filters.order === 'desc' ? '↓' : '↑'}
        </button>
        <button
          className="text-button"
          onClick={() => {
            setFilters(DEFAULT_MEETING_FILTERS);
            saveMeetingFilters(DEFAULT_MEETING_FILTERS, selectedId);
          }}
        >
          清除筛选
        </button>
        <button className="text-button" onClick={() => openCatalog('types')}>
          管理类型
        </button>
        <button className="text-button" onClick={() => openCatalog('tags')}>
          管理标签
        </button>
      </div>
      <div className="meeting-workspace">
        <section className="panel meeting-list-panel">
          <div className="list-title">
            <div>
              <h2>会议列表</h2>
              <span>{filtered.length} 条</span>
            </div>
            {loading && <small>读取中…</small>}
          </div>
          {!loading && filtered.length === 0 ? (
            <div className="list-empty">
              <b>{items.length ? '没有匹配的会议' : '还没有会议档案'}</b>
              <span>{items.length ? '清除筛选条件后查看其他会议。' : '新建会议后即可在此管理云端索引。'}</span>
              {items.length > 0 && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setFilters(DEFAULT_MEETING_FILTERS);
                    saveMeetingFilters(DEFAULT_MEETING_FILTERS, selectedId);
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          ) : (
            <div className="meeting-list">
              {filtered.map((m) => (
                <button
                  key={m.meeting_id}
                  className={`meeting-row ${selectedId === m.meeting_id ? 'selected' : ''}`}
                  onClick={() => void select(m.meeting_id)}
                >
                  <b>{m.title}</b>
                  <span>
                    {m.meeting_date}
                    {m.meeting_time ? ` · ${m.meeting_time}` : ''} · {catalogName('types', m.meeting_type)}
                  </span>
                  <small>
                    {m.confidentiality} · {m.tags.map((t) => catalogName('tags', t)).join('、') || '无标签'}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="panel meeting-detail-panel">
          {!detail ? (
            <div className="detail-empty">
              <b>{selectedId ? '正在读取会议详情' : '选择一场会议'}</b>
              <span>{selectedId ? '请稍候，正在读取服务端记录。' : '列表只展示由会议服务返回的登记元数据。'}</span>
            </div>
          ) : (
            <div className="meeting-detail">
              <div className="meeting-detail-top">
                <span className="meeting-level">{detail.confidentiality}</span>
                <span className="meeting-mode">{detail.storage_mode === 'cloud_index' ? '云端索引' : '本地归档'}</span>
                <div className="meeting-actions">
                  <button className="secondary-button" onClick={openPolicy}>
                    安全策略
                  </button>
                  <button className="secondary-button" onClick={() => openEditor('edit')}>
                    编辑
                  </button>
                  <button
                    className="secondary-button danger-button"
                    onClick={() => {
                      setDeleteLocalConfirm(false);
                      setDeleteRawConfirm(false);
                      setDeleteConfirm(true);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              <h2>{detail.title}</h2>
              <p className="meeting-subtitle">
                {detail.meeting_date}
                {detail.meeting_time ? ` · ${detail.meeting_time}` : ''} · {catalogName('types', detail.meeting_type)} ·
                版本 {detail.revision}
              </p>
              <section className="meeting-policy-summary">
                <h3>安全状态</h3>
                <p>
                  本地保存：{detail.local_storage_authorized ? '已授权' : '未授权'}；Raw：
                  {detail.raw_transfer_authorized ? '已授权' : '未授权'}；外部 AI：始终禁用。
                </p>
                <p>纪要仅保存在本地会议记录中；Raw 使用独立的本机登记入口，外部 AI 始终不可用。</p>
              </section>
              <div className="meeting-meta-grid">
                <Meta label="主类型" value={catalogName('types', detail.meeting_type)} />
                <Meta label="标签" value={detail.tags.map((x) => catalogName('tags', x)).join('、') || '无标签'} />
                <Meta label="客户" value={detail.customer || '未填写'} />
                <Meta label="项目" value={detail.project || '未填写'} />
                <Meta label="保密等级" value={detail.confidentiality} />
                <Meta label="存储模式" value={detail.storage_mode === 'cloud_index' ? '云端索引' : '本地归档'} />
              </div>
              {detail.description && (
                <div className="meeting-description">
                  <b>备注</b>
                  <p>{detail.description}</p>
                </div>
              )}
              <details className="meeting-sources">
                <summary>飞书来源</summary>
                <div className="meeting-source-line">
                  <span>录音</span>
                  {detail.recording_url ? (
                    <a href={safeMeetingHref(detail.recording_url)} target="_blank" rel="noopener noreferrer">
                      打开录音链接 ↗
                    </a>
                  ) : (
                    <span className="muted">未添加</span>
                  )}
                </div>
                <div className="meeting-source-line">
                  <span>纪要</span>
                  {detail.minutes_url ? (
                    <a href={safeMeetingHref(detail.minutes_url)} target="_blank" rel="noopener noreferrer">
                      打开纪要链接 ↗
                    </a>
                  ) : (
                    <span className="muted">未添加</span>
                  )}
                </div>
                <p>链接仅在点击后由新标签页打开；本页面不会预览或抓取来源内容。</p>
              </details>
              <details
                className="meeting-group"
                key={`minutes-group:${detail.meeting_id}:${detail.imports.length > 0 ? 'has' : 'empty'}`}
                open={detail.imports.length > 0}
              >
                <summary>本地会议纪要 · {detail.imports.length} 个版本</summary>
                <MeetingMinutes
                  key={detail.meeting_id}
                  meeting={detail}
                  onRefresh={() => void load(detail.meeting_id)}
                />
              </details>
              <details className="meeting-group">
                <summary>Raw 本机登记 · {detail.raw_links.length} 条</summary>
                <MeetingRawLinks
                  key={`raw:${detail.meeting_id}`}
                  meeting={detail}
                  onRefresh={() => void load(detail.meeting_id)}
                  onRawChanged={onRawChanged}
                  onOpenRaw={onOpenRaw}
                />
              </details>
              {deleteConfirm && (
                <div className="meeting-confirm" role="alertdialog" aria-label="确认删除会议">
                  <b>确认删除“{detail.title}”？</b>
                  <span>
                    将删除会议档案及 {detail.imports.length} 个本地纪要版本（原件与工作副本）；飞书资料不受影响。关联
                    Raw 共 {detail.raw_links.filter((link) => link.status !== 'raw_deleted').length}{' '}
                    条，删除会议不会删除 Raw 或解除其本机处理限制。
                  </span>
                  {detail.imports.length > 0 && (
                    <label className="meeting-check">
                      <input
                        type="checkbox"
                        checked={deleteLocalConfirm}
                        onChange={(e) => setDeleteLocalConfirm(e.target.checked)}
                      />
                      我确认一并删除全部本地纪要
                    </label>
                  )}
                  {detail.raw_links.some((link) => link.status !== 'raw_deleted') && (
                    <label className="meeting-check">
                      <input
                        type="checkbox"
                        checked={deleteRawConfirm}
                        onChange={(e) => setDeleteRawConfirm(e.target.checked)}
                      />
                      我确认保留以上 Raw 及其来源限制
                    </label>
                  )}
                  <div>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setDeleteConfirm(false);
                        setDeleteLocalConfirm(false);
                        setDeleteRawConfirm(false);
                      }}
                    >
                      取消
                    </button>
                    <button
                      className="primary-button danger-fill"
                      disabled={
                        busy ||
                        (detail.imports.length > 0 && !deleteLocalConfirm) ||
                        (detail.raw_links.some((link) => link.status !== 'raw_deleted') && !deleteRawConfirm)
                      }
                      onClick={() =>
                        void (async () => {
                          if (deleteLock.current) return;
                          deleteLock.current = true;
                          const actionToken = modalTokenRef.current;
                          const actionDetail = detail;
                          setBusy(true);
                          setError('');
                          try {
                            await api(`/api/meetings/${encodeURIComponent(actionDetail.meeting_id)}`, {
                              method: 'DELETE',
                              body: JSON.stringify({
                                baseRevision: actionDetail.revision,
                                confirm: true,
                                ...(actionDetail.imports.length ? { confirmLocalMinutes: true } : {}),
                                ...(actionDetail.raw_links.some((link) => link.status !== 'raw_deleted')
                                  ? { confirmRawReferences: true }
                                  : {}),
                              }),
                            });
                            deleteLock.current = false;
                            if (mounted.current && actionToken === modalTokenRef.current)
                              await afterMutation(null, actionToken);
                          } catch (e) {
                            deleteLock.current = false;
                            if (mounted.current && actionToken === modalTokenRef.current) {
                              setError(`${formatMeetingError(e)} 会议记录未确认删除；请重新读取后再操作。`);
                              setBusy(false);
                            }
                          }
                        })()
                      }
                    >
                      确认删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {form && detailOrNull(form, detail) && (
        <MeetingEditor
          mode={form}
          item={form === 'edit' ? detail! : null}
          catalog={catalog}
          token={modalToken}
          onClose={closeEditor}
          onReload={() => void load(selectedId)}
          onSaved={async (id, token, upload) => {
            if (!mounted.current || token !== modalTokenRef.current) return;
            setNotice('会议信息已保存。');
            await afterMutation(id, token);
            if (upload) {
              setTimeout(() => {
                const section = document.querySelector('.meeting-minutes');
                const group = section?.closest('details');
                if (group) group.open = true;
                section?.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }
          }}
        />
      )}
      {policy && detail && (
        <PolicyDialog
          meeting={detail}
          token={modalToken}
          onClose={closePolicy}
          onReload={() => void load(selectedId)}
          onSaved={(id, token) => afterMutation(id, token)}
        />
      )}
      {manage && catalog && (
        <CatalogDialog
          kind={manage}
          catalog={catalog}
          token={modalToken}
          onClose={closeCatalog}
          onReload={() => void load(selectedId)}
          onSaved={async (c, token) => {
            if (!mounted.current || token !== modalTokenRef.current) return;
            setCatalog(c);
            await load(selectedId);
          }}
        />
      )}
    </section>
  );
}

function detailOrNull(mode: string, detail: Meeting | null) {
  return mode === 'create' || !!detail;
}

function distinct(values: Array<string | null>) {
  return [...new Set(values.filter((x): x is string => !!x))].sort().map((x) => (
    <option key={x} value={x}>
      {x}
    </option>
  ));
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meeting-meta">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
