import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Audit, AuditConflict, AuditDraft, RawSummary, Wiki, WikiInput, WikiLintResult, WikiSchema, WikiType } from '../api';
import { api, dateText, sourceLabels } from '../api';
import '../wiki.css';

const statusLabels: Record<string, string> = { verified: '已核实', source_supported: '有来源支持', ai_organized: 'AI整理', inferred: '推断', needs_verification: '待验证', reviewed: '已人工审核', unreviewed: '未审核' };
const typeLabel = (schema: WikiSchema | null, type: WikiType) => schema?.types.find(item => item.id === type)?.label ?? type;
type WikiForm = WikiInput;
const csv = (value: string) => value.split(/[，,]/).map(item => item.trim()).filter(Boolean);
function templateBody(schema: WikiSchema | null, type: WikiType) {
  return (schema?.pageTemplates[type]?.sections ?? []).map(section => {
    const label = type === 'business_process' && section.key === 'ai_opportunities' ? '可能的 AI 机会（分析建议）' : section.label;
    return `## ${label}\n\n`;
  }).join('\n');
}
function hasSectionContent(body: string) {
  return body.split(/\r?\n/).some(line => line.trim() && !/^#{1,6}\s/.test(line.trim()) && !/^<!--.*-->$/.test(line.trim()));
}

export function WikiPage({ onOpenRaw, onChanged, initialOpenId, onInitialOpenHandled }: { onOpenRaw: (id: string) => void; onChanged: () => void; initialOpenId?: string | null; onInitialOpenHandled?: () => void }) {
  const [schema, setSchema] = useState<WikiSchema | null>(null);
  const [raws, setRaws] = useState<RawSummary[]>([]);
  const [items, setItems] = useState<Wiki[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Wiki | null>(null);
  const [form, setForm] = useState<WikiForm | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Wiki | null>(null);
  const [deleteReferences, setDeleteReferences] = useState<Array<{id: string; title: string}>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [lintResult, setLintResult] = useState<WikiLintResult | null>(null);
  const [lintBusy, setLintBusy] = useState(false);
  const pendingCreate = useRef(false);
  const selectionVersion = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const explicitOpenIdRef = useRef<string | null>(null);
  const selectId = (id: string | null) => { selectionVersion.current += 1; selectedIdRef.current = id; setSelectedId(id); };
  const updateQuery = (value: string) => { explicitOpenIdRef.current = null; setQuery(value); };
  const updateCategory = (value: string) => { explicitOpenIdRef.current = null; setCategory(value); };

  const refreshList = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (category) params.set('category', category);
    const data = await api<{items: Wiki[]; categoryCounts: Record<string, number>}>(`/api/wiki?${params.toString()}`);
    setItems(data.items); setCategoryCounts(data.categoryCounts);
    return data.items;
  }, [query, category]);

  useEffect(() => {
    Promise.all([api<WikiSchema>('/api/wiki/schema'), api<{items: RawSummary[]}>('/api/raw?summary=true')])
      .then(([wikiSchema, rawData]) => { setSchema(wikiSchema); setRaws(rawData.items); })
      .catch(e => setError(e instanceof Error ? e.message : '无法读取 Wiki 规则。'));
  }, []);

  useEffect(() => {
    if (schema && pendingCreate.current) {
      pendingCreate.current = false;
      setForm(createBase());
    }
  }, [schema]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await refreshList();
        if (!active) return;
        const requestedId = selectedIdRef.current;
        if (requestedId && next.some(item => item.id === requestedId)) return;
        if (requestedId && explicitOpenIdRef.current === requestedId) return;
        const first = next[0]; selectId(first?.id ?? null);
        if (!first) setSelected(null);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '无法读取 Wiki 列表。'); }
      finally { if (active) setLoading(false); }
    }, 80);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let active = true;
    setSelected(null);
    api<Wiki>(`/api/wiki/${selectedId}`).then(value => { if (active) setSelected(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : '无法读取 Wiki 页面。'); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => { let active = true; const refreshSelected = () => { if (selectedId) { const version = selectionVersion.current; void api<Wiki>(`/api/wiki/${selectedId}`).then(value => { if (active && version === selectionVersion.current) setSelected(value); }).catch(() => undefined); } }; window.addEventListener('wiki:refresh', refreshSelected); return () => { active = false; window.removeEventListener('wiki:refresh', refreshSelected); }; }, [selectedId]);

  useEffect(() => {
    const begin = () => startCreate();
    window.addEventListener('wiki:new', begin);
    return () => window.removeEventListener('wiki:new', begin);
  }, [schema]);

  useEffect(() => {
    const lint = () => { setLintBusy(true); setError(''); api<WikiLintResult>('/api/wiki-lint').then(setLintResult).catch(e => setError(e instanceof Error ? e.message : 'Lint 运行失败。')).finally(() => setLintBusy(false)); };
    window.addEventListener('wiki:lint', lint);
    return () => { window.removeEventListener('wiki:lint', lint); };
  }, []);
  useEffect(() => {
    if (!initialOpenId) return;
    setForm(null); setLintResult(null); setError(''); setNotice('');
    const id = initialOpenId;
    explicitOpenIdRef.current = id;
    selectId(id);
    let active = true;
    api<Wiki>(`/api/wiki/${encodeURIComponent(id)}`).then(value => { if (active && selectedIdRef.current === id) setSelected(value); })
      .catch(() => { if (active && selectedIdRef.current === id) setError('这条最近知识记录对应的 Wiki 已不存在或无法读取，请从知识库列表选择有效页面。'); })
      .finally(() => { if (active) onInitialOpenHandled?.(); });
    return () => { active = false; };
  }, [initialOpenId, onInitialOpenHandled]);

  const activeTemplate = useMemo(() => form ? schema?.pageTemplates[form.type] : undefined, [form, schema]);
  const createBase = (type: WikiType = 'concept'): WikiForm => ({
    title: '', type, category: 'industry_basics', sources: [], tags: [], aliases: [],
    knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'reviewed', body: templateBody(schema, type),
  });
  function startCreate() {
    explicitOpenIdRef.current = null;
    selectionVersion.current += 1;
    setError(''); setNotice(''); setBaseRevision(null);
    if (!schema) { pendingCreate.current = true; setForm(null); return; }
    pendingCreate.current = false; setForm(createBase());
  }
  function startEdit(item: Wiki) {
    setError(''); setNotice(''); setBaseRevision(item.revision);
    const { id: _id, created: _created, updated: _updated, revision: _revision, domain: _domain, links: _links, ...fields } = item;
    setForm(fields);
  }
  const chooseItem = (id: string) => { explicitOpenIdRef.current = null; setForm(null); setSelected(null); setError(''); setNotice(''); setLintResult(null); selectId(id); };
  const setField = <K extends keyof WikiForm>(key: K, value: WikiForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!form) return;
    setError(''); setNotice('');
    if (!hasSectionContent(form.body)) { setError('请在页面模板至少填写一段内容后保存。'); return; }
    if (form.type === 'source' && form.sources.length !== 1) { setError('来源摘要需要选择且只选择一条 Raw。'); return; }
    if (form.type === 'synthesis' && form.sources.length < 2) { setError('综合整理至少需要选择两条 Raw 来源。'); return; }
    if ((form.knowledge_status === 'verified' || form.knowledge_status === 'source_supported') && form.sources.length === 0) { setError('此状态需要关联有效的 Raw 来源。'); return; }
    if (form.knowledge_status === 'verified' && form.review_status !== 'reviewed') { setError('已核实知识必须标记为已人工审核。'); return; }
    const targetId = baseRevision === null ? null : selectedId;
    const selectionAtSave = selectionVersion.current;
    setBusy(true);
    try {
      const saved = baseRevision === null
        ? await api<Wiki>('/api/wiki', { method: 'POST', body: JSON.stringify(form) })
        : await api<Wiki>(`/api/wiki/${targetId}`, { method: 'PUT', body: JSON.stringify({ ...form, baseRevision }) });
      const fullDetail = await api<Wiki>(`/api/wiki/${saved.id}`);
      if (selectionVersion.current === selectionAtSave) {
        explicitOpenIdRef.current = null; setForm(null); selectId(saved.id); setSelected(fullDetail);
      }
      setNotice('Wiki 已保存。'); await refreshList(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败。'); }
    finally { setBusy(false); }
  };

  const requestDelete = async (item: Wiki) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      const result = await api<{items: Array<{id: string; title: string}>}>(`/api/wiki/${item.id}/references`);
      setDeleteReferences(result.items); setDeleteTarget(item);
    } catch (e) { setError(e instanceof Error ? e.message : '读取关联页面失败。'); }
    finally { setBusy(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError(''); setBusy(true);
    try {
      await api(`/api/wiki/${deleteTarget.id}`, { method: 'DELETE', body: JSON.stringify({ baseRevision: deleteTarget.revision }) });
      explicitOpenIdRef.current = null; setDeleteTarget(null); selectId(null); setSelected(null); setNotice('Wiki 已移到回收区。');
      const next = await refreshList(); if (next[0]) selectId(next[0].id); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '删除失败。'); }
    finally { setBusy(false); }
  };
  return <div className="page wiki-page">
    <div className="page-heading wiki-heading"><div><p className="eyebrow">个人业务知识 · Markdown</p><h1>知识库</h1><p className="subheading">按类型整理知识，保留来源、关联和可独立读取的 Markdown 文件。</p></div><div className="heading-actions"><button className="secondary-button" disabled={lintBusy} onClick={async () => { setLintBusy(true); try { setLintResult(await api<WikiLintResult>('/api/wiki-lint')); } catch (e) { setError(e instanceof Error ? e.message : 'Lint 运行失败。'); } finally { setLintBusy(false); } }}>{lintBusy ? '正在检查…' : '检查知识库'}</button><button className="primary-button" onClick={startCreate} disabled={!schema}><span>＋</span> 新建 Wiki</button></div></div>
    {lintResult && <section className="wiki-message lint-panel" role="status"><div><b>Lint 检查完成 · {lintResult.findings.length} 个问题</b><div className="lint-findings">{lintResult.findings.length ? lintResult.findings.map((finding, index) => <button className="text-button" key={`${finding.code}-${finding.file}-${index}`} onClick={() => { if (finding.objectId) chooseItem(finding.objectId); }}>{finding.code} · {finding.file}:{finding.location.line} · {finding.message}</button>) : <span>没有发现问题。</span>}</div></div><button onClick={() => setLintResult(null)}>关闭</button></section>}
    {error && <div className="wiki-message error-message" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}{notice && <div className="wiki-message success-message" role="status">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
    <div className="wiki-map panel"><div className="map-title"><div><h2>学习地图</h2><span>按业务主题浏览</span></div><span className="map-total">{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)} 页</span></div><div className="category-grid"><button className={`category-chip ${category === '' ? 'chosen' : ''}`} onClick={() => updateCategory('')}>全部<span>{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span></button>{schema?.categories.map(item => <button className={`category-chip ${category === item.id ? 'chosen' : ''}`} key={item.id} onClick={() => updateCategory(category === item.id ? '' : item.id)}>{item.label}<span>{categoryCounts[item.id] ?? 0}</span></button>)}</div></div>
    <div className="wiki-workspace">
      <section className="panel wiki-list-panel"><div className="wiki-search"><label className="search-box"><span>⌕</span><input aria-label="搜索 Wiki" value={query} onChange={event => updateQuery(event.target.value)} placeholder="搜索标题、别名、标签、正文或分类" />{query && <button aria-label="清空搜索" onClick={() => updateQuery('')}>×</button>}</label><span className="wiki-count">{items.length} 页</span></div>
        <div className="wiki-list-content">{loading ? <div className="list-empty">正在读取知识库…</div> : items.length ? items.map(item => <button key={item.id} className={`wiki-list-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => chooseItem(item.id)}><span className="wiki-type-mark">{typeLabel(schema, item.type).slice(0, 1)}</span><span className="wiki-list-copy"><b>{item.title}{item.isDemo && <span className="demo-badge">演示数据</span>}</b><small>{typeLabel(schema, item.type)} · {schema?.categories.find(value => value.id === item.category)?.label ?? item.category}</small><small>{item.aliases.length ? `别名：${item.aliases.join('、')}` : statusLabels[item.knowledge_status] ?? item.knowledge_status}</small></span></button>) : <div className="list-empty"><span className="empty-symbol">▤</span><b>没有匹配的知识页</b><span>换个关键词，或为当前主题创建一页。</span><button className="secondary-button" onClick={startCreate}>新建 Wiki</button></div>}</div>
      </section>
      <section className="panel wiki-detail-panel">{form ? <WikiEditor schema={schema} raws={raws} form={form} busy={busy} baseRevision={baseRevision} template={activeTemplate} onField={setField} onCancel={() => { setForm(null); setError(''); }} onSave={save} onOpenRaw={onOpenRaw} /> : selected ? <WikiDetail key={selected.id} item={selected} schema={schema} raws={raws} busy={busy} onEdit={() => startEdit(selected)} onDelete={() => void requestDelete(selected)} onOpenRaw={onOpenRaw} onOpenWiki={chooseItem} onChanged={onChanged} /> : <div className="detail-empty"><span className="empty-symbol">▤</span><b>从学习地图开始整理知识</b><span>创建六类 Wiki 页面，并关联保存过的 Raw 来源。</span><button className="secondary-button" onClick={startCreate}>创建第一条 Wiki</button></div>}</section>
    </div>
    {deleteTarget && <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}><section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="dialog-header"><div><p className="eyebrow">移到回收区</p><h2 id="delete-title">删除“{deleteTarget.title}”</h2><p>被关联的页面会保留原文；删除后这些链接可能变为未找到。</p></div><button className="icon-button" aria-label="关闭" onClick={() => setDeleteTarget(null)}>×</button></div><div className="delete-reference-list"><b>入链影响 · {deleteReferences.length} 页</b>{deleteReferences.length ? deleteReferences.map(reference => <div className="delete-reference" key={reference.id}><span>[[{deleteTarget.title}]]</span><button className="text-button" onClick={() => { setDeleteTarget(null); chooseItem(reference.id); }}>{reference.title}</button></div>) : <p>没有其他 Wiki 页面链接到此页。</p>}</div><div className="dialog-footer"><span>Raw 与其他知识资产不会删除</span><div><button className="secondary-button" onClick={() => setDeleteTarget(null)} disabled={busy}>取消</button><button className="danger-button" onClick={() => void confirmDelete()} disabled={busy}>{busy ? '正在删除…' : '确认删除'}</button></div></div></section></div>}
  </div>;
}

function WikiEditor({ schema, raws, form, busy, baseRevision, template, onField, onCancel, onSave, onOpenRaw }: { schema: WikiSchema | null; raws: RawSummary[]; form: WikiForm; busy: boolean; baseRevision: number | null; template?: WikiSchema['pageTemplates'][WikiType]; onField: <K extends keyof WikiForm>(key: K, value: WikiForm[K]) => void; onCancel: () => void; onSave: (event: FormEvent) => void; onOpenRaw: (id: string) => void }) {
  const updateType = (nextType: WikiType) => {
    const currentTemplate = templateBody(schema, form.type);
    onField('type', nextType);
    if (!form.body.trim() || form.body === currentTemplate) onField('body', templateBody(schema, nextType));
  };
  return <form className="wiki-editor" onSubmit={onSave}>
    <div className="editor-top"><div><p className="eyebrow">{baseRevision === null ? '创建知识页' : `编辑 · 第 ${baseRevision} 版`}</p><h2>{baseRevision === null ? '新建 Wiki' : form.title}</h2></div><button type="button" className="icon-button" aria-label="取消编辑" onClick={onCancel}>×</button></div>
    <div className="wiki-form-grid"><label className="field span-two">标题 <em>*</em><input value={form.title} onChange={event => onField('title', event.target.value)} required maxLength={300} placeholder="例如：门店动销" autoFocus /></label><label className="field">页面类型<select value={form.type} onChange={event => updateType(event.target.value as WikiType)}>{schema?.types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="field">学习分类<select value={form.category} onChange={event => onField('category', event.target.value)}>{schema?.categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="field span-two">Raw 来源{form.type === 'source' && <em>（必选一条）</em>}{form.type === 'synthesis' && <em>（至少两条）</em>}<select className="raw-source-select" multiple size={Math.min(Math.max(raws.length, 3), 6)} value={form.sources} onChange={event => onField('sources', [...event.currentTarget.selectedOptions].map(option => option.value))}>{raws.map(item => <option key={item.id} value={item.id}>{item.title}｜{sourceLabels[item.sourceType]}｜{item.sourceName}</option>)}</select><span className="field-hint">按住 Ctrl 可多选；来源摘要只保存摘要并跳回 Raw 原文。</span></label>
      {form.sources.length > 0 && <div className="selected-raws span-two">{form.sources.map(id => { const raw = raws.find(item => item.id === id); return raw ? <button type="button" key={id} className="selected-raw" onClick={() => onOpenRaw(id)}><span>{raw.title}</span><small>{raw.sourceName}</small>查看 Raw ›</button> : null; })}</div>}
      <label className="field span-two">别名<input value={form.aliases.join('，')} onChange={event => onField('aliases', csv(event.target.value))} placeholder="用逗号分隔，例如：动销率、Sell-out" /></label><label className="field span-two">标签<input value={form.tags.join('，')} onChange={event => onField('tags', csv(event.target.value))} placeholder="用逗号分隔，支持中文搜索" /></label>
      <label className="field">知识状态<select value={form.knowledge_status} onChange={event => onField('knowledge_status', event.target.value)}>{schema?.enums.knowledge_status.map(value => <option key={value} value={value}>{statusLabels[value] ?? value}</option>)}</select></label><label className="field">人工审核<select value={form.review_status} onChange={event => onField('review_status', event.target.value)}><option value="reviewed">已人工审核</option><option value="unreviewed">未审核</option></select></label><label className="field">可信度<select value={form.confidence} onChange={event => onField('confidence', event.target.value)}>{schema?.enums.confidence.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="field">来源等级<select value={form.source_level} onChange={event => onField('source_level', event.target.value)}>{schema?.sourcePolicy.levels.map(level => <option key={level.id} value={level.id}>{level.label}</option>)}</select></label>
      <div className="source-guidance span-two">{schema?.sourcePolicy.guidance}</div>
      <label className="field span-two wiki-body-field">知识内容 <em>*</em><span className="template-hint">{template?.sections.map(section => section.label).join('　· ')}</span><textarea value={form.body} onChange={event => onField('body', event.target.value)} required spellCheck placeholder="按页面模板补充信息。使用 [[标题或别名]] 关联其他 Wiki。" /><span className="field-hint">使用 Markdown；业务流程中的 AI 机会请明确标注“分析建议”。</span></label>
    </div>
    <div className="editor-footer"><span>保存后形成正式 Wiki Markdown 文件</span><div><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存 Wiki'}</button></div></div>
  </form>;
}

function WikiDetail({ item, schema, raws, busy, onEdit, onDelete, onOpenRaw, onOpenWiki, onChanged }: { item: Wiki; schema: WikiSchema | null; raws: RawSummary[]; busy: boolean; onEdit: () => void; onDelete: () => void; onOpenRaw: (id: string) => void; onOpenWiki: (id: string) => void; onChanged: () => void }) {
  const links = item.links ?? [];
  const bodyRef = useRef<HTMLPreElement>(null);
  const [anchor, setAnchor] = useState<{before:string;text:string;after:string}|null>(null);
  const captureSelection = () => {
    const selection = window.getSelection(); const node = bodyRef.current;
    if (!selection || selection.isCollapsed || !node || !selection.anchorNode || !selection.focusNode || !node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0); const beforeRange = document.createRange(); beforeRange.selectNodeContents(node); beforeRange.setEnd(range.startContainer, range.startOffset);
    const selected = range.toString(); const start = beforeRange.toString().length; if (!selected) return;
    setAnchor({ before: item.body.slice(Math.max(0, start - 80), start), text: selected, after: item.body.slice(start + selected.length, start + selected.length + 80) });
  };
  return <article className="wiki-detail"><div className="wiki-detail-actions"><div className="wiki-badges"><span className="detail-type">{typeLabel(schema, item.type)}</span><span className="tag">{schema?.categories.find(value => value.id === item.category)?.label ?? item.category}</span><span className="status wiki-status">{statusLabels[item.knowledge_status] ?? item.knowledge_status}</span></div><div className="action-group"><a className="secondary-button" href={`/api/wiki/${encodeURIComponent(item.id)}/export`} download={`wiki-${item.id}.md`}>导出 Markdown</a><button className="secondary-button" onClick={onEdit}>编辑</button><button className="danger-quiet" onClick={onDelete} disabled={busy}>删除</button></div></div>
    <h2>{item.title}{item.isDemo && <span className="demo-badge">演示数据</span>}</h2>{item.isDemo && <p className="demo-notice">【演示数据】该知识页尚未核验，来源与内容仅用于教学示例。</p>}<div className="wiki-submeta">{item.aliases.length > 0 && <span>别名：{item.aliases.join('、')}</span>}<span>第 {item.revision} 版 · 更新于 {dateText(item.updated)}</span></div>
    <div className="wiki-meta-grid"><Meta label="知识状态" value={statusLabels[item.knowledge_status] ?? item.knowledge_status} /><Meta label="人工审核" value={statusLabels[item.review_status] ?? item.review_status} /><Meta label="可信度" value={item.confidence} /><Meta label="来源等级" value={item.source_level} /></div>
    {item.tags.length > 0 && <div className="tag-row">{item.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>}
    <section className="wiki-section"><h3>来源 Raw · {item.sources.length}</h3>{item.sources.length ? <div className="source-cards">{item.sources.map(id => { const raw = raws.find(value => value.id === id); return <button className="source-card" key={id} onClick={() => onOpenRaw(id)}><span className="source-card-icon">原</span><span><b>{raw?.title ?? '找不到 Raw 来源'}{raw?.isDemo && <span className="demo-badge">演示数据</span>}</b><small>{raw ? `${sourceLabels[raw.sourceType]} · ${raw.sourceName}${raw.author ? ` · ${raw.author}` : ''}` : `ID ${id}`}</small><small>{raw ? `发布于 ${raw.publishedAt?.slice(0, 10) || '日期未提供'} · 导入于 ${dateText(raw.importedAt)}${raw.url ? ` · ${raw.url}` : ''}` : '此来源可能已移除'}</small></span><strong>打开 Raw ›</strong></button>; })}</div> : <p className="muted-copy">未关联 Raw 来源。</p>}</section>
    <section className="wiki-section"><div className="section-header"><h3>知识内容</h3><span>选中段落后可提交纠错</span></div><pre ref={bodyRef} onMouseUp={captureSelection} className="wiki-body-view">{item.body}</pre>{anchor && <div className="audit-selection"><span>已选：{anchor.text.slice(0, 100)}{anchor.text.length > 100 ? '…' : ''}</span><button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('audit:create-paragraph', {detail: anchor}))}>对选中段落提交 Audit</button><button className="text-button" onClick={() => setAnchor(null)}>清除</button></div>}</section>
    {links.length > 0 && <section className="wiki-section"><h3>Wiki 关联 · {links.length}</h3><div className="link-status-list">{links.map(link => <div className="wiki-link-row" key={link.target}><code>[[{link.target}]]</code>{link.status === 'resolved' && link.candidates[0] ? <button className="text-button" onClick={() => onOpenWiki(link.candidates[0].id)}>{link.candidates[0].title} ›</button> : link.status === 'ambiguous' ? <span className="link-ambiguous">存在歧义：{link.candidates.map(candidate => <button className="text-button" key={candidate.id} onClick={() => onOpenWiki(candidate.id)}>{candidate.title}</button>)}</span> : <span className="link-missing">未找到匹配页面</span>}</div>)}</div></section>}
    <AuditPanel item={item} onChanged={onChanged} selectedAnchor={anchor} />
    </article>;
}

function AuditPanel({ item, onChanged, selectedAnchor }: { item: Wiki; onChanged: () => void; selectedAnchor: {before:string;text:string;after:string}|null }) {
  const [audits, setAudits] = useState<Audit[]>([]); const [selected, setSelected] = useState<Audit | null>(null); const [draft, setDraft] = useState<AuditDraft | null>(null);
  const [conflicts, setConflicts] = useState<AuditConflict[]>([]); const [severity, setSeverity] = useState<Audit['severity']>('suggestion'); const [comment, setComment] = useState(''); const [reason, setReason] = useState(''); const [replacement, setReplacement] = useState(''); const [error, setError] = useState(''); const [draftNotice, setDraftNotice] = useState(''); const [busy, setBusy] = useState(false);
  const selectionEpoch = useRef(0); const activeAuditId = useRef<string|null>(null);
  const isCurrent = (auditId: string, epoch: number) => selectionEpoch.current === epoch && activeAuditId.current === auditId && item.id.length > 0;
  const load = async () => { const pageId=item.id; try { const result=await api<{items:Audit[]}>(`/api/audits?wikiId=${encodeURIComponent(pageId)}`); if(pageId===item.id) setAudits(result.items); } catch(e) { if(pageId===item.id) setError(e instanceof Error?e.message:'无法读取 Audit。'); } };
  useEffect(() => { void load(); return () => { selectionEpoch.current++; activeAuditId.current=null; }; }, [item.id]);
  const refreshDetail = async (audit: Audit, epoch=selectionEpoch.current) => { if(activeAuditId.current!==audit.id||audit.wikiId!==item.id) return; try { const result=await api<{audit:Audit;draft:AuditDraft|null;conflicts:AuditConflict[]}>(`/api/audits/${audit.id}`); if(selectionEpoch.current!==epoch||activeAuditId.current!==audit.id||audit.wikiId!==item.id) return; setSelected(result.audit); setDraft(result.draft); setConflicts(result.conflicts); setReplacement(result.draft?.replacement??''); setDraftNotice(''); } catch(e) { if(selectionEpoch.current===epoch&&activeAuditId.current===audit.id) setError(e instanceof Error?e.message:'无法读取 Audit 详情。'); } };
  const selectAudit = (audit: Audit) => { const epoch=++selectionEpoch.current; activeAuditId.current=audit.id; setSelected(null); setDraft(null); setConflicts([]); setReplacement(''); setReason(''); setError(''); setDraftNotice(''); setBusy(false); void refreshDetail(audit,epoch); };
  const create = async (scope: 'page'|'paragraph', target?: {before:string;text:string;after:string}) => { if(!comment.trim()) { setError('请先填写纠错反馈。'); return; } const pageId=item.id; const epoch=selectionEpoch.current; setBusy(true); setError(''); try { const audit=await api<Audit>('/api/audits',{method:'POST',body:JSON.stringify({wikiId:pageId,scope,severity,comment,anchor:target})}); onChanged(); if(selectionEpoch.current!==epoch||pageId!==item.id) return; setComment(''); await load(); if(selectionEpoch.current!==epoch||pageId!==item.id) return; selectAudit(audit); } catch(e) { if(selectionEpoch.current===epoch&&pageId===item.id) setError(e instanceof Error?e.message:'提交 Audit 失败。'); } finally { if(selectionEpoch.current===epoch&&pageId===item.id) setBusy(false); } };
  useEffect(() => { const createParagraph = (event: Event) => { const anchor=(event as CustomEvent<{before:string;text:string;after:string}>).detail; if(anchor) void create('paragraph',anchor); }; window.addEventListener('audit:create-paragraph',createParagraph); return () => window.removeEventListener('audit:create-paragraph',createParagraph); }, [item.id,severity,comment]);
  const saveDraft = async () => { if(!draft||!selected) return; const auditId=selected.id; const epoch=selectionEpoch.current; const draftId=draft.id; const edited=replacement; setBusy(true); setError(''); setDraftNotice(''); try { const saved=await api<{draft:AuditDraft}>(`/api/audit-drafts/${draftId}`,{method:'PATCH',body:JSON.stringify({baseRevision:draft.revision,replacement:edited})}); const readBack=await api<{draft:AuditDraft}>(`/api/audit-drafts/${draftId}`); if(readBack.draft.id!==saved.draft.id||readBack.draft.revision!==saved.draft.revision||readBack.draft.replacement!==edited) throw new Error('草稿保存后读回校验不一致，请刷新查看当前版本。'); if(!isCurrent(auditId,epoch)) return; setDraft(readBack.draft); setReplacement(readBack.draft.replacement); setDraftNotice(`草稿已保存并读回 · ${readBack.draft.id} · rev ${readBack.draft.revision}`); } catch(e) { if(isCurrent(auditId,epoch)) setError(e instanceof Error?e.message:'保存草稿失败。'); } finally { if(isCurrent(auditId,epoch)) setBusy(false); } };
  const propose = async () => { if(!selected) return; const audit=selected; const epoch=selectionEpoch.current; setBusy(true); setError(''); try { await api(`/api/audits/${audit.id}/propose`,{method:'POST',body:'{}'}); if(isCurrent(audit.id,epoch)) await refreshDetail(audit,epoch); } catch(e) { if(isCurrent(audit.id,epoch)) setError(e instanceof Error?e.message:'生成建议失败。'); } finally { if(isCurrent(audit.id,epoch)) setBusy(false); } };
  const decide = async (decision: 'accepted'|'partial'|'rejected'|'deferred') => { if(!selected) return; const audit=selected; const currentDraft=draft; const currentReplacement=replacement; const currentReason=reason; const epoch=selectionEpoch.current; setBusy(true); setError(''); try { const result=await api<{audit:Audit}>('/api/audits/'+audit.id+'/resolve',{method:'POST',body:JSON.stringify({baseAuditRevision:audit.revision,decision,confirm:decision==='accepted'||decision==='partial',draftId:currentDraft?.id,baseDraftRevision:currentDraft?.revision,replacement:decision==='accepted'||decision==='partial'?currentReplacement:undefined,reason:(decision==='rejected'||decision==='deferred')?currentReason:undefined})}); onChanged(); if(!isCurrent(audit.id,epoch)) return; setSelected(result.audit); setDraft(null); setReason(''); await load(); await refreshDetail(result.audit,epoch); window.dispatchEvent(new CustomEvent('wiki:refresh')); } catch(e) { if(isCurrent(audit.id,epoch)) setError(e instanceof Error?e.message:'处理 Audit 失败。'); } finally { if(isCurrent(audit.id,epoch)) setBusy(false); } };
  const relocate = async () => { if(!selected||!selectedAnchor) return; const audit=selected; const target=selectedAnchor; const epoch=selectionEpoch.current; setBusy(true); setError(''); try { await api(`/api/audits/${audit.id}/relocate`,{method:'POST',body:JSON.stringify({baseAuditRevision:audit.revision,anchor:target})}); if(isCurrent(audit.id,epoch)) await refreshDetail(audit,epoch); } catch(e) { if(isCurrent(audit.id,epoch)) setError(e instanceof Error?e.message:'重新定位失败。'); } finally { if(isCurrent(audit.id,epoch)) setBusy(false); } };
  const discardDraft = async () => { if(!selected||!draft) return; const audit=selected; const draftId=draft.id; const epoch=selectionEpoch.current; setBusy(true); setError(''); try { await api(`/api/audit-drafts/${draftId}`,{method:'DELETE'}); if(isCurrent(audit.id,epoch)) await refreshDetail(audit,epoch); } catch(e) { if(isCurrent(audit.id,epoch)) setError(e instanceof Error?e.message:'放弃草稿失败。'); } finally { if(isCurrent(audit.id,epoch)) setBusy(false); } };
  return <section className="wiki-section audit-panel"><div className="section-header"><h3>Audit 纠错 · {audits.filter(a=>a.status==='open').length} 条待处理</h3><button className="secondary-button" onClick={()=>void create('page')} disabled={busy}>提交整页纠错</button></div>
    <div className="audit-create"><label className="field">严重度<select value={severity} onChange={e=>setSeverity(e.target.value as Audit['severity'])}><option value="error">错误</option><option value="warning">警告</option><option value="suggestion">建议</option><option value="supplement">补充</option></select></label><label className="field">反馈<textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="说明哪处需要修正以及原因" /></label><button className="primary-button" onClick={()=>void create('page')} disabled={busy||!comment.trim()}>提交整页 Audit</button></div>
    {error && <p className="audit-error" role="alert">{error}</p>}
    <div className="audit-list">{audits.map(audit=><button key={audit.id} className={`audit-row ${selected?.id===audit.id?'active':''}`} onClick={()=>selectAudit(audit)}><b>{audit.severity}</b><span>{audit.comment}</span><small>{audit.status} · rev {audit.revision}</small></button>)}</div>
    {selected && <div className="audit-detail"><div><b>{selected.comment}</b><small>状态：{selected.status} · 定位：{selected.location?.status ?? 'unknown'}（{selected.location?.method ?? ''}）{selected.location?.status==='uncertain'?' · 请重新定位后再生成建议':''}</small></div>
      {conflicts.map(conflict=><p className="audit-error" role="status" key={conflict.operationId}>恢复操作 {conflict.operationId} 冲突，仍待人工处理：{conflict.conflictReason}（Wiki revision {conflict.observedWikiRevision ?? '缺失'}，目标 {conflict.expectedWikiRevision}；Raw 变化：{conflict.changedRawIds.join('、')||'无'}）</p>)}
      {selected.status==='open' && <><div className="audit-actions"><button className="secondary-button" onClick={()=>void propose()} disabled={busy||selected.location?.status!=='found'&&selected.location?.status!=='located'}>生成 AI 修订建议</button><button className="text-button" disabled={!selectedAnchor||busy} onClick={()=>void relocate()}>用选中段落重新定位</button></div>
      {draft?.status==='pending' && <div className="audit-draft"><b>AI 建议 · {draft.provider.name} / {draft.provider.model}</b><p>{draft.rationale}</p><label className="field">确认前的替换预览<textarea value={replacement} onChange={e=>{setReplacement(e.target.value);setDraftNotice('');}} /></label>{draft.evidence.map((e,i)=><small key={i}>Raw {e.rawId} · 引文：{e.quote}</small>)}{draftNotice && <small role="status">{draftNotice}</small>}<div className="audit-actions"><button className="secondary-button" onClick={()=>void saveDraft()} disabled={busy||replacement===draft.replacement}>保存草稿</button><button className="primary-button" onClick={()=>void decide('accepted')} disabled={busy}>接受并写入</button><button className="secondary-button" onClick={()=>void decide('partial')} disabled={busy}>按当前预览部分接受</button><button className="text-button" onClick={()=>void discardDraft()} disabled={busy}>放弃草稿</button></div></div>}
      <label className="field">拒绝/延期理由<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="处理理由" /></label><div className="audit-actions"><button className="secondary-button" onClick={()=>void decide('rejected')} disabled={busy||!reason.trim()}>拒绝并解决</button><button className="secondary-button" onClick={()=>void decide('deferred')} disabled={busy||!reason.trim()}>延期并保持待处理</button></div></>}
      {selected.decisionHistory?.map((decision,index)=><small key={index}>决议：{decision.decision}{decision.reason?` · ${decision.reason}`:''} · {dateText(decision.at)}</small>)}
    </div>}
  </section>;
}
function Meta({ label, value }: {label: string; value: string}) { return <div className="meta"><span>{label}</span><b>{value}</b></div>; }
