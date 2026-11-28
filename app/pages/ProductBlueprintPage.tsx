import { useEffect, useState } from 'react';
import { api, ApiError, dateText } from '../api/client';
import {
  createBlueprint,
  deleteBlueprint,
  exportBlueprint,
  getBlueprint,
  listBlueprints,
  saveBlueprint,
} from '../api/product-blueprints';
import type { Blueprint, BlueprintDetail } from '../../services/product-blueprints/types';
import { Background, Users, Values, Features, Concept } from './product-blueprint/Sections';
import { Field } from './product-blueprint/Fields';
import '../product-blueprint.css';

type Section = 'background' | 'users' | 'values' | 'features' | 'concept';
const tabs: [Section, string][] = [
  ['background', '背景'],
  ['users', '使用者'],
  ['values', '价值'],
  ['features', '功能'],
  ['concept', '构想'],
];
const statusLabels: Record<Blueprint['status'], string> = {
  exploring: '探索中',
  defining: '定义中',
  planning: '规划中',
  executing: '执行中',
  paused: '暂停',
  archived: '已归档',
};
function sectionData(b: Blueprint, section: Section) {
  if (section === 'background')
    return { meta: { title: b.title, oneLiner: b.oneLiner, status: b.status }, context: b.context, links: b.links };
  if (section === 'users')
    return { personas: b.personas, scenarios: b.scenarios, pains: b.pains, alternatives: b.alternatives };
  if (section === 'concept') return { vision: b.vision, milestones: b.milestones };
  return b[section];
}
function mergeSection(draft: Blueprint, saved: Blueprint, section: Section): Blueprint {
  const redactedRawIds = new Set(
    saved.pains.filter((pain) => pain.evidenceRedacted && pain.evidence).map((pain) => pain.evidence!.rawId),
  );
  draft = {
    ...draft,
    pains: draft.pains.map((pain) =>
      pain.evidence && redactedRawIds.has(pain.evidence.rawId)
        ? { ...pain, evidence: { rawId: pain.evidence.rawId }, evidenceRedacted: true }
        : pain,
    ),
  };
  if (section === 'background')
    return {
      ...draft,
      title: saved.title,
      oneLiner: saved.oneLiner,
      status: saved.status,
      context: saved.context,
      links: saved.links,
      revision: saved.revision,
    };
  if (section === 'users')
    return {
      ...draft,
      personas: saved.personas,
      scenarios: saved.scenarios,
      pains: saved.pains,
      alternatives: saved.alternatives,
      revision: saved.revision,
    };
  if (section === 'concept')
    return { ...draft, vision: saved.vision, milestones: saved.milestones, revision: saved.revision };
  return { ...draft, [section]: saved[section], revision: saved.revision };
}
function setSelectedId(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id) params.set('blueprint', id);
  else params.delete('blueprint');
  const query = params.toString();
  window.history.replaceState(
    { ...window.history.state, appPage: 'blueprint' },
    '',
    window.location.pathname + (query ? '?' + query : '') + window.location.hash,
  );
}
export function ProductBlueprintPage({
  onOpenRaw,
  onDirtyChange,
  onBusyChange,
}: {
  onOpenRaw: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<Blueprint[]>([]);
  const [listErrors, setListErrors] = useState<{ id: string; message: string }[]>([]);
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [draft, setDraft] = useState<Blueprint | null>(null);
  const [tab, setTab] = useState<Section>('background');
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<{
    raw: [string, string][];
    wiki: [string, string][];
    workItems: [string, string][];
  }>({ raw: [], wiki: [], workItems: [] });
  const dirty = (section: Section) =>
    !!draft &&
    !!detail &&
    JSON.stringify(sectionData(draft, section)) !== JSON.stringify(sectionData(detail.blueprint, section));
  const anyDirty = tabs.some(([s]) => dirty(s));
  useEffect(() => {
    onDirtyChange(anyDirty);
  }, [anyDirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (anyDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);
  const refresh = async () => {
    const result = await listBlueprints();
    setItems(result.items);
    setListErrors(result.errors || []);
  };
  const fail = (e: unknown) => {
    const references =
      e instanceof ApiError
        ? (e.details as { references?: { collection: string; id: string; field: string }[] } | undefined)?.references
        : undefined;
    setError(
      (e instanceof Error ? e.message : '操作失败') +
        (references?.length
          ? '。引用方：' + references.map((r) => r.collection + ' / ' + r.id + ' / ' + r.field).join('；')
          : ''),
    );
  };
  const open = async (id: string) => {
    if (anyDirty && !window.confirm('存在未保存的修改，确定离开当前构想吗？')) return;
    setError('');
    setBusy(true);
    try {
      const next = await getBlueprint(id);
      setDetail(next);
      setDraft(next.blueprint);
      setTab('background');
      setSelectedId(id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh().catch(fail);
    void api<{
      raw: { id: string; title: string }[];
      wiki: { id: string; title: string }[];
      workItems: { id: string; title: string }[];
    }>('/api/product-blueprints/sources')
      .then(({ raw, wiki, workItems }) =>
        setChoices({
          raw: raw.map((i) => [i.id, i.title]),
          wiki: wiki.map((i) => [i.id, i.title]),
          workItems: workItems.map((i) => [i.id, i.title]),
        }),
      )
      .catch(fail);
    const id = new URLSearchParams(window.location.search).get('blueprint');
    if (id)
      void getBlueprint(id)
        .then((next) => {
          setDetail(next);
          setDraft(next.blueprint);
        })
        .catch(fail);
  }, []);
  const save = async () => {
    if (!draft || !detail) return;
    setBusy(true);
    setError('');
    try {
      const next = await saveBlueprint(draft.id, detail.blueprint.revision, tab, sectionData(draft, tab));
      setDetail(next);
      setDraft((current) => (current ? mergeSection(current, next.blueprint, tab) : current));
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await createBlueprint(title, oneLiner);
      setDetail(next);
      setDraft(next.blueprint);
      setSelectedId(next.blueprint.id);
      setTab('background');
      setTitle('');
      setOneLiner('');
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const back = () => {
    if (anyDirty && !window.confirm('存在未保存的修改，确定返回列表吗？')) return;
    setDetail(null);
    setDraft(null);
    setSelectedId(null);
    setError('');
  };
  const remove = async () => {
    if (!detail || !window.confirm('确定删除此构想并移入回收目录吗？')) return;
    setBusy(true);
    setError('');
    try {
      await deleteBlueprint(detail.blueprint.id, detail.blueprint.revision);
      setDetail(null);
      setDraft(null);
      setSelectedId(null);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    if (!detail) return;
    try {
      const content = await exportBlueprint(detail.blueprint.id);
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = detail.blueprint.title + '.md';
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      fail(e);
    }
  };
  const locate = (collection: string, id: string) => {
    const next: Section = ['personas', 'scenarios', 'pains', 'alternatives'].includes(collection)
      ? 'users'
      : collection === 'values'
        ? 'values'
        : collection === 'features'
          ? 'features'
          : 'concept';
    setTab(next);
    window.setTimeout(() => {
      const node = document.getElementById('pb-' + id);
      node?.scrollIntoView({ block: 'center' });
      node?.focus();
    }, 0);
  };
  return (
    <div className="pb-page">
      <header className="pb-heading">
        <div>
          <h1>产品构想</h1>
          <p>从背景和使用者出发，逐步梳理价值、功能与整体构想。</p>
        </div>
        {detail && (
          <button type="button" disabled={busy} onClick={back}>
            返回列表
          </button>
        )}
      </header>
      {error && (
        <div className="global-error" role="alert">
          {error}
        </div>
      )}
      {!detail || !draft ? (
        <>
          <section className="pb-panel">
            <h2>新建构想</h2>
            <Field label="名称" value={title} onChange={setTitle} />
            <Field label="一句话定义（可选）" value={oneLiner} onChange={setOneLiner} />
            <button type="button" className="primary-button" disabled={busy} onClick={() => void create()}>
              新建构想
            </button>
          </section>
          <section className="pb-panel">
            <div className="pb-card-head">
              <h2>构想列表</h2>
              <label>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{' '}
                显示已归档
              </label>
            </div>
            {listErrors.map((e) => (
              <p role="alert" key={e.id}>
                记录 {e.id} 无法读取：{e.message}
              </p>
            ))}
            {items.filter((i) => showArchived || i.status !== 'archived').length === 0 && (
              <p>还没有构想，可以从上方新建。</p>
            )}
            {items
              .filter((i) => showArchived || i.status !== 'archived')
              .map((item) => (
                <button type="button" className="pb-list-item" key={item.id} onClick={() => void open(item.id)}>
                  <strong>{item.title}</strong>
                  <span>{item.oneLiner || '尚未填写一句话定义'}</span>
                  <span>
                    {statusLabels[item.status]} · 更新于 {dateText(item.updatedAt)}
                  </span>
                </button>
              ))}
          </section>
        </>
      ) : (
        <>
          <div className="pb-toolbar">
            <div>
              <h2>{detail.blueprint.title}</h2>
              <span>
                {statusLabels[detail.blueprint.status]} · 修订 {detail.blueprint.revision}
              </span>
            </div>
            <div>
              <button type="button" onClick={() => void download()}>
                下载 Markdown
              </button>{' '}
              <button type="button" disabled={busy} onClick={() => void remove()}>
                删除构想
              </button>
            </div>
          </div>
          <div className="pb-layout">
            <div>
              <nav className="pb-tabs" aria-label="构想分区">
                {tabs.map(([s, label]) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={s}
                    className={tab === s ? 'active' : ''}
                    onClick={() => setTab(s)}
                  >
                    {label}
                    {dirty(s) ? ' •' : ''}
                  </button>
                ))}
              </nav>
              <section className="pb-panel">
                <div className="pb-card-head">
                  <h2>{tabs.find(([s]) => s === tab)?.[1]}</h2>
                  <span>{dirty(tab) ? '未保存' : '已保存'}</span>
                </div>
                <fieldset className="pb-form" disabled={busy}>
                  {tab === 'background' && (
                    <Background
                      draft={draft}
                      saved={detail.blueprint}
                      detail={detail}
                      choices={choices}
                      change={setDraft}
                      onOpenRaw={onOpenRaw}
                    />
                  )}
                  {tab === 'users' && (
                    <Users
                      draft={draft}
                      saved={detail.blueprint}
                      detail={detail}
                      choices={choices}
                      change={setDraft}
                      onOpenRaw={onOpenRaw}
                    />
                  )}
                  {tab === 'values' && (
                    <Values
                      draft={draft}
                      saved={detail.blueprint}
                      detail={detail}
                      change={setDraft}
                      onOpenRaw={onOpenRaw}
                    />
                  )}
                  {tab === 'features' && (
                    <Features
                      draft={draft}
                      saved={detail.blueprint}
                      detail={detail}
                      change={setDraft}
                      onOpenRaw={onOpenRaw}
                    />
                  )}
                  {tab === 'concept' && (
                    <Concept
                      draft={draft}
                      saved={detail.blueprint}
                      detail={detail}
                      change={setDraft}
                      onOpenRaw={onOpenRaw}
                    />
                  )}
                </fieldset>
                <div className="pb-save">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !dirty(tab)}
                    onClick={() => void save()}
                  >
                    保存{tabs.find(([s]) => s === tab)?.[1]}
                  </button>
                </div>
              </section>
            </div>
            <aside className="pb-panel pb-checks">
              <h2>追溯检查</h2>
              <p>基于已保存内容，仅作提示。</p>
              {detail.checks.length === 0 ? (
                <p>当前没有提示。</p>
              ) : (
                detail.checks.map((c, i) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={c.code + c.id + i}
                    onClick={() => locate(c.collection, c.id)}
                  >
                    <strong>{c.code}</strong> {c.message}
                  </button>
                ))
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
