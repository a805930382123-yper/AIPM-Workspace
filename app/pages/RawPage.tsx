import { useEffect, useRef, useState } from 'react';
import type { ExtractionJob, Raw, RawImportResult, RawProcessingState, RawReference, SourceType, Wiki, KnowledgeWorkflowSummary } from '../api';
import { ApiError, api, apiForm, bytesText, dateText, deleteRaw, formatLabels, jobStageLabels, knowledgeWorkflows, rawReferences, rawStatusLabels, sourceLabels, extractionJob, startExtract, reconcileExtractionStorage, startSynthesisWorkflow } from '../api';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../../services/raw/limits.ts';

const ACCEPTED_FILES = '.md,.markdown,.txt,.docx,.pdf';
const MAX_UPLOAD_MIB = MAX_UPLOAD_BYTES / 1024 / 1024;
// F03-03: a single separator rule for the tag field, shared by the prefill text, the input
// hint and the parser, so an untouched tag list can never silently merge into one tag.
const TAG_SEPARATOR = /[，,、;；]+/u;
const parseTags = (value: string) => value.split(TAG_SEPARATOR).map(item => item.trim()).filter(Boolean);
const tagsText = (tags: string[]) => tags.join('、');
type ImportFailure = {
  code: string; message: string; retained?: boolean; committed?: boolean; recoverable?: boolean;
  assetId?: string; rawId?: string; raw?: Raw; byteSize?: number; sha256?: string; fileName?: string; format?: string;
};
type Mode = 'paste' | 'file';

export function RawPage({ items, selectedId, onSelected, onOpenImport, onCommitted, openImport, onCloseImport, onDeleted, processing, job, onJobStarted, navigationGeneration = 0, selectionGeneration = 0, onOpenDraft, onOpenWorkflow, onRefresh }: {
  items: Raw[]; selectedId: string | null; onSelected: (id: string) => void; onOpenImport: () => void;
  onCommitted: (raw: Raw) => Promise<void>; openImport: boolean; onCloseImport: () => void; onDeleted: (id: string) => Promise<void>;
  processing: Record<string, RawProcessingState>; job: ExtractionJob | null;
  onJobStarted: (job: ExtractionJob, pageGeneration?: number, selectionGeneration?: number) => void; navigationGeneration?: number; selectionGeneration?: number; onOpenDraft: (draftId: string) => void; onOpenWorkflow?: (id: string) => void; onRefresh: () => Promise<void>;
}) {
  const selected = items.find(item => item.id === selectedId) ?? (selectedId ? null : items[0] ?? null);
  const [reimport, setReimport] = useState<Raw | null>(null);
  const [deletingItem, setDeletingItem] = useState<Raw | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const startGeneration=useRef(0);
  useEffect(()=>{startGeneration.current++;setAiBusy(false);setAiError('');},[selected?.id]);
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [synthesisIds, setSynthesisIds] = useState<string[]>([]);
  const [synthesisSourceIds, setSynthesisSourceIds] = useState<string[]>([]);
  const [sourcePages, setSourcePages] = useState<Wiki[]>([]);
  const [pendingWorkflows, setPendingWorkflows] = useState<KnowledgeWorkflowSummary[]>([]);
  const [synthesisError, setSynthesisError] = useState('');
  useEffect(() => {
    let active = true;
    knowledgeWorkflows().then(items => { if (active) setPendingWorkflows(items.filter(item => item.status === 'pending_confirmation' || item.status === 'conflict')); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const dialogOpen = openImport || !!reimport;
  const closeDialogs = () => { setReimport(null); onCloseImport(); };
  // F03-04: navigation only. Committing data to the parent happens in ImportDialog as soon as
  // the server confirms it, so every exit path (关闭 / 右上角关闭 / 继续导入) stays in sync.
  const openCommitted = (raw: Raw) => { onSelected(raw.id); closeDialogs(); };
  const handleDeleted = async (id: string) => { setDeletingItem(null); await onDeleted(id); };
  const startAi = async (rawId: string, restart = false, planningRetry = false, mode: 'standard'|'deep' = 'standard') => {
    const generation=startGeneration.current;
    const requestedPageGeneration = navigationGeneration; const requestedSelectionGeneration = selectionGeneration;
    setAiError(''); setAiBusy(true);
    try {
      const started = await startExtract(rawId, restart ? { restart: true,mode } : planningRetry ? { planningRetry: true,mode } : {mode});
      onJobStarted(started, requestedPageGeneration, requestedSelectionGeneration);
      await onRefresh();
    } catch (error) {
      if(generation===startGeneration.current)setAiError(error instanceof Error ? error.message : '无法启动 AI 整理。');
      const jobId = error instanceof ApiError ? (error.details as { jobId?: string } | undefined)?.jobId : undefined;
      if (jobId) {
        try { onJobStarted(await extractionJob(jobId), requestedPageGeneration, requestedSelectionGeneration); await onRefresh(); } catch { /* The original safe error remains visible. */ }
      }
    }
    finally { if(generation===startGeneration.current)setAiBusy(false); }
  };
  const selectedState = selected ? processing[selected.id] : undefined;
  const generateImported = async (raw: Raw) => {
    const requestedPageGeneration = navigationGeneration; const requestedSelectionGeneration = selectionGeneration;
    const started = await startExtract(raw.id,{mode:raw.body.length<=30000?'deep':'standard'});
    onJobStarted(started, requestedPageGeneration, requestedSelectionGeneration);
    await onRefresh();
  };
  return <div className="page raw-page">
    <div className="page-heading raw-heading"><div><p className="eyebrow">原始资料 · 事实来源</p><h1>Raw 原始资料</h1><p className="subheading">保存文章、报告与业务记录的原文。保存后不会被 AI 改写。</p></div><div className="action-group"><button className="secondary-button" disabled={items.length < 2} onClick={async () => { setSynthesisIds([]); setSynthesisSourceIds([]); setSynthesisError(''); const result = await api<{items:Wiki[]}>('/api/wiki'); setSourcePages(result.items.filter(item => item.type === 'source')); setSynthesisOpen(true); }}>多来源综合</button><button className="primary-button" onClick={onOpenImport}><span>＋</span> 导入资料</button></div></div>
    {pendingWorkflows.length > 0 && <section className="panel pending-knowledge-workflows"><div className="panel-heading"><div><h2>待审核知识草稿</h2><p>保存后可以刷新或重启，再从这里继续审核。</p></div></div><div className="raw-list">{pendingWorkflows.map(item => <button className="raw-list-item" key={item.id} onClick={() => onOpenWorkflow?.(item.id)}><span className="file-icon">{item.kind === 'update' ? '更' : '综'}</span><span className="recent-copy"><b>{item.title}</b><small>{item.kind === 'update' ? '旧 Wiki 更新' : '多来源综合'} · v{item.revision} · {item.status === 'conflict' ? '提交冲突' : '待确认'}</small>{item.lastCommitError && <small className="form-error">{item.lastCommitError}</small>}</span></button>)}</div></section>}
    <div className="raw-workspace">
      <section className="panel raw-list-panel"><div className="list-title"><div><h2>所有资料</h2><span>{items.length} 条</span></div></div>{items.length ? <div className="raw-list">{items.map(item => {
        const state = processing[item.id];
        return <button key={item.id} className={`raw-list-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => onSelected(item.id)}><span className="file-icon">文</span><span className="recent-copy"><b>{item.title}{item.isDemo && <span className="demo-badge">演示数据</span>}</b><small>{sourceLabels[item.sourceType]} · {item.sourceName}{item.origin ? ' · 本机专用' : ''}</small><small>{dateText(item.importedAt)}{state && state.status !== 'unprocessed' ? ` · ${rawStatusLabels[state.status]}` : ''}</small></span></button>;
      })}</div> : <div className="list-empty"><div className="empty-symbol">▧</div><b>还没有原始资料</b><span>导入第一份文章或业务记录。</span><button className="secondary-button" onClick={onOpenImport}>导入资料</button></div>}</section>
      <section className="panel raw-detail-panel">{selected ? <RawDetail key={selected.id} item={selected} state={selectedState} job={job} onStorageReconciled={value => { onJobStarted(value, navigationGeneration, selectionGeneration); void onRefresh(); }} busy={aiBusy} error={aiError} onStartAi={(restart, planningRetry,mode) => void startAi(selected.id, restart, planningRetry,mode)} onReimport={() => setReimport(selected)} onDelete={() => setDeletingItem(selected)} onOpenDraft={onOpenDraft} /> : selectedId ? <div className="detail-empty" role="status"><span className="empty-symbol">▤</span><b>所选 Raw 不存在或已删除</b><span>服务端未返回 ID {selectedId} 对应的资料。请选择列表中的其他 Raw。</span></div> : <div className="detail-empty"><span className="empty-symbol">▤</span><b>选择一条资料开始阅读</b><span>导入后，正文和来源信息会显示在这里。</span></div>}</section>
    </div>
    {dialogOpen && <ImportDialog prefill={reimport} onClose={closeDialogs} onCommitted={onCommitted} onOpen={openCommitted} onGenerate={generateImported} />}
    {deletingItem && <DeleteDialog item={deletingItem} onClose={() => setDeletingItem(null)} onDeleted={handleDeleted} />}
    {synthesisOpen && <div className="modal-backdrop"><section className="panel confirm-dialog"><div className="panel-heading"><div><h2>选择综合来源</h2><p>Raw 与 Source 可混合选择，最终按其真实 Raw ID 去重，至少两条。</p></div><button className="icon-button" onClick={() => setSynthesisOpen(false)}>×</button></div>{synthesisError && <p className="form-error" role="alert">{synthesisError}</p>}<div className="raw-list">{items.map(item => <label className="raw-list-item" key={item.id}><input type="checkbox" checked={synthesisIds.includes(item.id)} onChange={event => setSynthesisIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className="recent-copy"><b>Raw · {item.title}</b><small>{item.sourceName} · {item.id}</small></span></label>)}{sourcePages.map(item => <label className="raw-list-item" key={item.id}><input type="checkbox" checked={synthesisSourceIds.includes(item.id)} onChange={event => setSynthesisSourceIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className="recent-copy"><b>Source · {item.title}</b><small>{item.sources[0]} · {item.id}</small></span></label>)}</div><div className="dialog-actions"><button className="secondary-button" onClick={() => setSynthesisOpen(false)}>取消</button><button className="primary-button" disabled={new Set([...synthesisIds, ...synthesisSourceIds.map(id => sourcePages.find(source => source.id === id)?.sources[0]).filter(Boolean)]).size < 2} onClick={async () => { try { const workflow = await startSynthesisWorkflow({ rawIds: synthesisIds, sourceIds: synthesisSourceIds }); setSynthesisOpen(false); onOpenWorkflow?.(workflow.id); } catch (error) { setSynthesisError(error instanceof Error ? error.message : '综合草稿生成失败。'); } }}>生成 Synthesis 草稿</button></div></section></div>}
  </div>;
}

function RawDetail({ item, state, job, busy, error, onStartAi, onReimport, onDelete, onOpenDraft, onStorageReconciled }: {
  item: Raw; state?: RawProcessingState; job: ExtractionJob | null; busy: boolean; error: string; onStorageReconciled: (job: ExtractionJob) => void;
  onStartAi: (restart?: boolean, planningRetry?: boolean,mode?:'standard'|'deep') => void; onReimport: () => void; onDelete: () => void; onOpenDraft: (draftId: string) => void;
}) {
  const status = state?.status ?? 'unprocessed';
  const [mode,setMode]=useState<'standard'|'deep'>(()=>item.body.length<=30000?'deep':'standard');
  const [savingState, setSavingState] = useState(false);
  const [savingError, setSavingError] = useState('');
  const recoveryGeneration = useRef(0);
  useEffect(() => { recoveryGeneration.current++; setSavingState(false); setSavingError(''); return () => { recoveryGeneration.current++; }; }, [item.id]);
  const [storedJob, setStoredJob] = useState<ExtractionJob | null>(null);
  const storedJobId = state?.recoveryJobId ?? state?.jobId;
  useEffect(() => { if (!storedJobId) { setStoredJob(null); return; } let active = true; extractionJob(storedJobId).then(value => { if (active) setStoredJob(value); }).catch(() => undefined); return () => { active = false; }; }, [storedJobId]);
  const meetingOnly = item.origin !== undefined;
  const activeJob = job && job.rawId === item.id ? job : storedJob && storedJob.rawId === item.id ? storedJob : null;
  const storageBlocked = !!activeJob?.recovery;
  const retryStorage = async () => {
    if (!activeJob) return;
    const generation = recoveryGeneration.current;
    setSavingState(true); setSavingError('');
    try {
      const saved = await reconcileExtractionStorage(activeJob.jobId);
      if (generation !== recoveryGeneration.current) return;
      setStoredJob(saved); onStorageReconciled(saved);
    } catch (error) { if (generation === recoveryGeneration.current) setSavingError(error instanceof Error ? error.message : '保存状态失败。'); }
    finally { if (generation === recoveryGeneration.current) setSavingState(false); }
  };
  const progressText = status === 'processing' && activeJob
    ? `${activeJob.mode==='deep'?({extracting:'提取',planning:'知识页规划',outline:'大纲',writing:'写作',quality:'质量检查',ready:'完成'} as Record<string,string>)[activeJob.checkpoint?.deepStage??activeJob.stage]??jobStageLabels[activeJob.stage]:jobStageLabels[activeJob.stage]} · 已验证 ${activeJob.checkpoint?.validatedChunks ?? activeJob.progress.chunksDone}/${activeJob.checkpoint?.totalChunks ?? (activeJob.progress.chunksTotal || '?')} 段 · ${activeJob.checkpoint ? `累计 ${activeJob.checkpoint.attempts} 次调用，复用 ${activeJob.checkpoint.reusedChunks} 段` : `已有 ${activeJob.progress.pagesFound} 条建议`}`
    : '';
  return <article className="raw-detail">
    <div className="detail-actions">
      <span className={`status ai-status ${status}`}><i />{rawStatusLabels[status]}</span>
      <span className="detail-type">{sourceLabels[item.sourceType]}</span>{meetingOnly && <span className="detail-type meeting-local-badge">本机专用</span>}
      <div className="action-group">
        {!meetingOnly && (status === 'unprocessed' || status === 'failed' || status === 'generated') && <button className="text-button ai-action" disabled={busy || storageBlocked} onClick={() => onStartAi(false,false,status==='failed'&&activeJob?(activeJob.mode??'standard'):mode)}>{busy ? '正在启动…' : status === 'failed' && activeJob?.pipelineVersion ? '显式继续提取' : status === 'failed' ? '重试 AI 整理' : 'AI 整理知识'}</button>}
        {!meetingOnly && status === 'processing' && activeJob && activeJob.execution !== 'settled' && !storageBlocked && <button className="text-button" onClick={async () => { await api(`/api/extraction-jobs/${encodeURIComponent(activeJob.jobId)}/cancel`, { method: 'POST', body: JSON.stringify({}) }); }}>取消整理</button>}
        {!meetingOnly && status === 'pending_confirmation' && state?.draftId && !storageBlocked && <button className="text-button ai-action" onClick={() => onOpenDraft(state.draftId as string)}>继续审核</button>}
        {!meetingOnly && <button className="text-button" onClick={onReimport}>重新导入</button>}
        <button className="text-button danger" onClick={onDelete}>删除</button>
      </div>
    </div>
    {!meetingOnly&&<label className="field raw-extraction-mode">整理模式<select aria-label="整理模式" value={mode} disabled={busy||status==='processing'} onChange={e=>setMode(e.target.value as 'standard'|'deep')}><option value="deep" disabled={item.body.length>30000}>深度整理</option><option value="standard">标准整理</option></select><small>{item.body.length>30000?'正文超过30000字符，深度整理不可选；标准整理保留全文。':'深度整理生成结构化阅读笔记，可显式选择标准整理。'}{status==='failed'&&activeJob?` 显式继续将沿用原任务${activeJob.mode==='deep'?'深度':'标准'}模式；明确重新生成使用当前选择。`:''}</small></label>}
    {storageBlocked && <section className="notice-warn" role="alert"><b>{activeJob?.execution === 'running' ? '任务正在停止，状态保存失败' : '任务已停止，状态保存失败'}</b><p>{activeJob?.recovery?.message}（{activeJob?.recovery?.phase}）</p><p>重试保存只对账本机状态，不会重新调用模型。</p><button className="secondary-button" disabled={savingState || activeJob?.execution !== 'settled'} onClick={() => void retryStorage()}>{savingState ? '正在保存状态…' : '重试保存状态'}</button>{savingError && <p className="form-error">{savingError}</p>}</section>}
    {progressText && <p className="ai-progress">{progressText}</p>}
    {meetingOnly && <p className="notice-warn">Meeting来源仅限本机保存：禁止外部 AI、Wiki沉淀与Prompt背景使用。</p>}
    {status === 'failed' && state?.lastError && <p className="notice-warn">{state.lastError.code}：{state.lastError.message}{state.lastError.retryable ? '（可以重试）' : '（需要先处理配置或资料问题）'}</p>}
    {status === 'failed' && activeJob?.mode!=='deep' && activeJob?.error?.code === 'LLM_PLAN_COVERAGE_INVALID' && <button className="text-button" disabled={busy || storageBlocked} onClick={() => onStartAi(false, true,'standard')}>仅重新规划（带覆盖诊断）</button>}
    {status === 'failed' && activeJob?.checkpoint && <p className="extract-note">检查点已验证 {activeJob.checkpoint.validatedChunks}/{activeJob.checkpoint.totalChunks} 段，累计 {activeJob.checkpoint.attempts} 次调用。</p>}
    {status === 'failed' && activeJob?.pipelineVersion && <button className="text-button" disabled={busy || storageBlocked} onClick={() => onStartAi(true,false,mode)}>明确重新生成</button>}
    {status === 'generated' && (state?.generatedWikiIds?.length ?? 0) > 0 && <p className="extract-note">已生成知识页：<code className="mono">{state?.generatedWikiIds?.join('、')}</code></p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <h2>{item.title}</h2>
    {item.isDemo && <p className="demo-notice">【演示数据】虚构教学示例，不代表真实公司或业务事实。</p>}
    <div className="detail-source">{item.sourceName}{item.author ? ` · ${item.author}` : ''}</div>
    <div className="metadata-grid"><Meta label="导入时间" value={dateText(item.importedAt)} /><Meta label="原发布日期" value={item.publishedAt || '未填写'} /><Meta label="来源链接" value={item.url || '未填写'} link={!!item.url} /><Meta label="资料 ID" value={item.id} mono /></div>
    {item.origin && <div className="metadata-grid"><Meta label="Meeting ID" value={item.origin.meeting_id} mono /><Meta label="来源版本" value={item.origin.import_id} mono /><Meta label="原件 SHA-256" value={item.origin.original_sha256} mono /><Meta label="处理策略" value={item.origin.processing_policy} mono /></div>}
    {item.tags.length > 0 && <div className="tag-row">{item.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>}
    {item.assetId && <section className="detail-asset">
      <div className="detail-asset-head"><span>原始文件</span><span className="retained-badge">原件已保留</span></div>
      <div className="metadata-grid">
        <Meta label="原文件名" value={item.assetFileName || '未记录'} />
        <Meta label="实际格式" value={formatLabels[item.assetFormat ?? 'unknown'] ?? item.assetFormat ?? '未记录'} />
        <Meta label="原文件字节数" value={bytesText(item.assetByteSize)} />
        <Meta label="asset ID" value={item.assetId} mono />
        <Meta label="原文件 SHA-256" value={item.assetSha256 || '未记录'} mono />
      </div>
      {item.extractionNote && <p className="extract-note">提取说明：{item.extractionNote}</p>}
    </section>}
    <div className="body-divider"><span>原始正文</span><span>SHA-256 已保存</span></div>
    <pre className="raw-body">{item.body}</pre>
    <div className="hash-line">正文校验值 <code>{item.bodySha256}</code></div>
  </article>;
}
function Meta({ label, value, link, mono }: {label: string; value: string; link?: boolean; mono?: boolean}) { return <div className="meta"><span>{label}</span>{link ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <b className={mono ? 'mono' : ''}>{value}</b>}</div>; }

export function ImportDialog({ onClose, onCommitted, onOpen, onGenerate, prefill }: {
  onClose: () => void; onCommitted: (raw: Raw) => Promise<void>; onOpen: (raw: Raw) => void; onGenerate: (raw: Raw) => Promise<void>; prefill?: Raw | null;
}) {
  // The original tag array is kept verbatim; the text field is only a view of it until edited.
  const initialTags = prefill?.tags ?? [];
  const [mode, setMode] = useState<Mode>(prefill?.assetId ? 'file' : 'paste');
  const [form, setForm] = useState({
    title: prefill?.title ?? '', sourceType: (prefill?.sourceType ?? 'article') as SourceType, sourceName: prefill?.sourceName ?? '',
    author: prefill?.author ?? '', publishedAt: prefill?.publishedAt ?? '', url: prefill?.url ?? '',
    tags: tagsText(initialTags), body: '',
  });
  const [tagsTouched, setTagsTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [result, setResult] = useState<RawImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [generationFailure, setGenerationFailure] = useState('');
  const [generationRaw, setGenerationRaw] = useState<Raw | null>(null);
  const update = (key: keyof typeof form, value: string) => {
    if (key === 'tags') setTagsTouched(true);
    setForm(previous => ({ ...previous, [key]: value }));
  };
  const commitTags = () => (tagsTouched ? parseTags(form.tags) : initialTags);
  const metadata = () => ({
    title: form.title, sourceType: form.sourceType, sourceName: form.sourceName,
    author: form.author || undefined, publishedAt: form.publishedAt || undefined, url: form.url || undefined,
    tags: commitTags(),
  });
  const resetForNext = () => {
    setResult(null); setFailure(null); setFile(null); setTagsTouched(false);
    setForm(previous => ({ ...previous, title: prefill ? previous.title : '', sourceName: prefill ? previous.sourceName : '', tags: tagsText(initialTags), body: '' }));
  };
  const chooseFile = (next: File | null) => {
    setFile(next); setFailure(null); setResult(null);
    if (!next) return;
    const stem = next.name.replace(/\.[^.]+$/u, '').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 300);
    setForm(previous => ({ ...previous, title: previous.title || stem, sourceName: previous.sourceName || stem }));
    if (next.size > MAX_UPLOAD_BYTES) setFailure({ code: 'FILE_TOO_LARGE', retained: false, fileName: next.name, byteSize: next.size, message: `文件为 ${bytesText(next.size)}，超过 ${MAX_UPLOAD_MIB} MiB 上限；工作台不会上传它，服务端也会在接收阶段拒绝。请改用粘贴文本。` });
  };
  const switchToPaste = () => { setMode('paste'); setFile(null); setFailure(null); };
  const submit = async (generateAfterSave = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setFailure(null); setGenerationFailure(''); setSaving(true);
    try {
      if (mode === 'file') {
        if (!file) { setFailure({ code: 'MISSING_FILE', retained: false, message: '请先选择要导入的文件。' }); return; }
        if (file.size > MAX_UPLOAD_BYTES) { setFailure({ code: 'FILE_TOO_LARGE', retained: false, fileName: file.name, byteSize: file.size, message: `文件为 ${bytesText(file.size)}，超过 ${MAX_UPLOAD_MIB} MiB 上限，未上传。` }); return; }
        const payload = new FormData();
        payload.append('metadata', JSON.stringify(metadata()));
        payload.append('file', file, file.name);
        const outcome = await apiForm<RawImportResult>('/api/raw/import', payload);
        setResult(outcome);
        // F03-04: sync the committed Raw with the parent right away, so closing the result
        // panel (or continuing with another one) cannot leave the list and counters stale.
        await onCommitted(outcome.raw);
        if (generateAfterSave) { setGenerationRaw(outcome.raw); try { await onGenerate(outcome.raw); setGenerationRaw(null); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可用同一 Raw 重试。'); } }
      } else {
        const raw = await api<Raw>('/api/raw', { method: 'POST', body: JSON.stringify({ ...metadata(), body: form.body }) });
        await onCommitted(raw);
        if (generateAfterSave) { setGenerationRaw(raw); try { await onGenerate(raw); setGenerationRaw(null); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可用同一 Raw 重试。'); } } else onOpen(raw);
      }
    } catch (error) {
      const problem = toFailure(error);
      setFailure(problem);
      // F03-01: a partial commit did create a Raw — surface it in the list immediately instead
      // of waiting for the user to reopen or reload the page.
      if (problem.committed && problem.raw) { try { await onCommitted(problem.raw); } catch { /* 待恢复信息优先显示 */ } }
    }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="dialog-header">
        <div>
          <p className="eyebrow">{prefill ? '重新导入 Raw' : '新建 Raw'}</p>
          <h2 id="import-title">{prefill ? `重新导入「${prefill.title}」` : '导入原始资料'}</h2>
          <p>原文保存到本机；上传文件时原件按原始字节保留，正文由解析器提取后入库。</p>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      {prefill && <p className="reimport-hint">重新导入会创建新的 Raw ID，旧记录及其原件保持不变；工作台不会自动复制上一条的原文件或转移 Wiki 来源。{prefill.assetId ? ' 这条资料来自文件导入，请重新选择原文件。' : ''}</p>}
      {result && generationFailure && generationRaw && <div className="form-error" role="alert"><b>Raw 已保存，Wiki 草稿未生成</b><p>{generationFailure}</p><button type="button" className="secondary-button" disabled={saving} onClick={async () => { setSaving(true); setGenerationFailure(''); try { await onGenerate(generationRaw); setGenerationRaw(null); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可重试。'); } finally { setSaving(false); } }}>用同一 Raw 重试</button><small>Raw ID：<code>{generationRaw.id}</code></small></div>}      {result
        ? <ResultPanel result={result} prefill={!!prefill} onClose={onClose} onOpen={() => onOpen(result.raw)} onAgain={resetForNext} />
        : failure?.committed && failure.raw
          ? <PartialPanel failure={failure} raw={failure.raw} onClose={onClose} onOpen={() => onOpen(failure.raw as Raw)} onAgain={resetForNext} />
          : <>
        {!prefill && <div className="dialog-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'paste'} className={`dialog-tab ${mode === 'paste' ? 'active' : ''}`} onClick={() => setMode('paste')}>粘贴文本<small>从文章或笔记复制全文</small></button>
          <button type="button" role="tab" aria-selected={mode === 'file'} className={`dialog-tab ${mode === 'file' ? 'active' : ''}`} onClick={() => setMode('file')}>上传文件<small>Markdown / TXT / DOCX / PDF</small></button>
        </div>}
        <form onSubmit={event => { event.preventDefault(); void submit(false); }}>
          <div className="form-grid">
            <label className="field span-two">标题 <em>*</em><input value={form.title} onChange={event => update('title', event.target.value)} required maxLength={300} placeholder="例如：经销商订货流程访谈纪要" autoFocus /></label>
            <label className="field">来源类型 <em>*</em><select value={form.sourceType} onChange={event => update('sourceType', event.target.value as SourceType)}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field">来源名称 <em>*</em><input value={form.sourceName} onChange={event => update('sourceName', event.target.value)} required maxLength={300} placeholder="例如：客户访谈 / 公众号名称" /></label>
            <label className="field">作者<input value={form.author} onChange={event => update('author', event.target.value)} maxLength={200} placeholder="可选" /></label>
            <label className="field">原发布日期<input type="date" value={form.publishedAt} onChange={event => update('publishedAt', event.target.value)} /></label>
            <label className="field span-two">原始链接<input type="url" value={form.url} onChange={event => update('url', event.target.value)} placeholder="https://…（可选）" /></label>
            <label className="field span-two">标签<input value={form.tags} onChange={event => update('tags', event.target.value)} placeholder="用逗号或顿号分隔，例如：渠道、库存" /><span className="field-hint">分隔符：中文/英文逗号、顿号、分号 · 当前 {commitTags().length} 项{tagsTouched ? '' : '（未修改，按原标签保存）'}</span></label>
            {mode === 'paste'
              ? <label className="field span-two body-field">原始正文 <em>*</em><textarea value={form.body} onChange={event => update('body', event.target.value)} required maxLength={MAX_BODY_CHARS} placeholder="粘贴文章、会议纪要或业务资料原文。前后空白和换行会原样保留。" /><span className="field-hint">最多 {MAX_BODY_CHARS.toLocaleString()} 字符 · {form.body.length.toLocaleString()} 字符</span></label>
              : <div className="field span-two file-picker">
                <span>原文件 <em>*</em></span>
                <input type="file" accept={ACCEPTED_FILES} onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
                <span className="field-hint">支持 Markdown（.md/.markdown）、TXT（.txt，严格 UTF-8）、DOCX、PDF；单个文件上限 {MAX_UPLOAD_MIB} MiB，提取正文上限 {MAX_BODY_CHARS.toLocaleString()} 字符。扫描版 PDF 与加密 PDF 本批不支持。</span>
                {file && <div className="file-picked">已选择：<b>{file.name}</b><span>{bytesText(file.size)}</span></div>}
              </div>}
          </div>
          {generationFailure && generationRaw && <div className="form-error" role="alert"><b>Raw 已保存，Wiki 草稿未生成</b><p>{generationFailure}</p><button type="button" className="secondary-button" disabled={saving} onClick={async () => { setSaving(true); setGenerationFailure(''); try { await onGenerate(generationRaw); setGenerationRaw(null); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可重试。'); } finally { setSaving(false); } }}>用同一 Raw 重试</button><small>Raw ID：<code>{generationRaw.id}</code></small></div>}
          {failure && !failure.committed && <div className="form-error" role="alert">
            <b className="error-code">{failure.code}</b>
            <p>{failure.message}</p>
            {failure.retained && <p className="retained-note">原件已保留：{failure.fileName || '上传的文件'} · {bytesText(failure.byteSize)} · SHA-256 <code>{failure.sha256}</code> · assetId <code>{failure.assetId}</code></p>}
            {failure.retained && <div className="error-actions"><button type="button" className="secondary-button" onClick={switchToPaste}>改用粘贴文本补救</button></div>}
          </div>}
          <div className="dialog-footer">
            <span>{mode === 'file' ? '原件、正文与来源关联都写入后才显示导入成功' : '正文写入后不可由 AI 改写'}</span>
            <div>
              <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>取消</button>
              <button type="button" className="secondary-button" disabled={saving} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void submit(false); }}>{saving ? '正在保存…' : '仅保存 Raw'}</button><button type="button" className="primary-button" disabled={saving} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void submit(true); }}>{saving ? '正在处理…' : '保存并生成 Wiki 草稿'}</button>
            </div>
          </div>
        </form>
      </>}
    </section>
  </div>;
}

function ResultPanel({ result, prefill, onClose, onOpen, onAgain }: {
  result: RawImportResult; prefill: boolean; onClose: () => void; onOpen: () => void; onAgain: () => void;
}) {
  return <section className="result-panel">
    <div className="result-head"><span className="result-dot" />导入成功：正文已入库，原件已保留</div>
    <ul className="result-list">
      <li><span>Raw ID</span><code>{result.raw.id}</code></li>
      <li><span>资料标题</span><span>{result.raw.title}</span></li>
      <li><span>正文</span><span>{result.extraction.bodyChars.toLocaleString()} 字符 · SHA-256 <code>{result.raw.bodySha256.slice(0, 16)}…</code></span></li>
      <li><span>提取方式</span><span>{result.extraction.parser}</span></li>
      <li><span>原件</span><span>{result.asset.fileName} · {formatLabels[result.asset.format] ?? result.asset.format} · {bytesText(result.asset.byteSize)}</span></li>
      <li><span>原件位置</span><code>knowledge/raw/assets/{result.asset.storedFile}</code></li>
      <li><span>原件 SHA-256</span><code>{result.asset.sha256}</code></li>
    </ul>
    <p className="extract-note">{result.extraction.note}</p>
    <div className="dialog-footer">
      <span className="footer-note">{prefill ? '旧记录保持不变' : '正文与原件关联都已保存；列表与统计已同步'}</span>
      <div>
        <button type="button" className="secondary-button" onClick={onAgain}>继续导入下一条</button>
        <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        <button type="button" className="primary-button" onClick={onOpen}>查看这条资料</button>
      </div>
    </div>
  </section>;
}

/** F03-01: the Raw and the original exist, only the linkage record is missing. */
function PartialPanel({ failure, raw, onClose, onOpen, onAgain }: {
  failure: ImportFailure; raw: Raw; onClose: () => void; onOpen: () => void; onAgain: () => void;
}) {
  return <section className="result-panel partial">
    <div className="result-head warn"><span className="result-dot warn" />部分提交：正文已入库，原件关联待恢复</div>
    <ul className="result-list">
      <li><span>Raw ID</span><code>{raw.id}</code></li>
      <li><span>资料标题</span><span>{raw.title}</span></li>
      <li><span>原件</span><span>{failure.fileName || raw.assetFileName || '上传的文件'} · {bytesText(failure.byteSize ?? raw.assetByteSize)}</span></li>
      <li><span>asset ID</span><code>{failure.assetId || raw.assetId}</code></li>
      <li><span>原件 SHA-256</span><code>{failure.sha256 || raw.assetSha256}</code></li>
      <li><span>未完成</span><span>{failure.code} · {failure.message}</span></li>
    </ul>
    <p className="notice-warn">正文与原件字节都已保存在本机，只有「原件 ↔ Raw」的关联记录没有写完。请不要重复导入同一文件；解除磁盘故障后，在本目录下次启动工作台会自动补齐该关联（若 Raw 实际未提交，则只把原件记为待处理并保留原件）。</p>
    <p className="extract-note">这条 Raw 已经出现在资料列表与首页统计中；原件保存在 knowledge/raw/assets/，请勿手工移动或改名。</p>
    <div className="dialog-footer">
      <span className="footer-note">待恢复 · 重启工作台自动对账</span>
      <div>
        <button type="button" className="secondary-button" onClick={onAgain}>继续导入下一条</button>
        <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        <button type="button" className="primary-button" onClick={onOpen}>查看已创建的 Raw</button>
      </div>
    </div>
  </section>;
}

export function DeleteDialog({ item, onClose, onDeleted }: { item: Raw; onClose: () => void; onDeleted: (id: string) => Promise<void> }) {
  const [references, setReferences] = useState<RawReference[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true;
    rawReferences(item.id)
      .then(items => { if (active) setReferences(items); })
      .catch(problem => { if (active) setLoadError(problem instanceof Error ? problem.message : '无法确认引用关系。'); });
    return () => { active = false; };
  }, [item.id]);
  const confirm = async () => {
    setDeleting(true); setError('');
    try {
      await deleteRaw(item.id);
      await onDeleted(item.id);
    } catch (problem) {
      setDeleting(false);
      if (problem instanceof ApiError && problem.code === 'RAW_REFERENCED') {
        const details = problem.details as { references?: RawReference[] } | undefined;
        setReferences(details?.references ?? references ?? []);
      }
      setError(problem instanceof Error ? problem.message : '删除失败，请重试。');
    }
  };
  const blocked = references !== null && references.length > 0;
  return <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="dialog-header">
        <div>
          <p className="eyebrow">删除 Raw</p>
          <h2 id="delete-title">删除「{item.title}」</h2>
          <p>删除前会重新检查这条资料是否被正式 Wiki 引用。</p>
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      {references === null && !loadError && <div className="delete-copy">正在检查引用关系…</div>}
      {loadError && <div className="form-error" role="alert"><p>{loadError}</p></div>}
      {blocked && <>
        <div className="delete-panel">
          <b>这条资料已被 {references.length} 条正式 Wiki 引用，本批禁止删除。</b>
          <div>请先在知识库中解除这些页面的来源引用，再回到这里删除。工作台不会自动改写 Wiki、清除来源或留下坏来源。</div>
        </div>
        <ul className="reference-list">{references.map(reference => <li key={reference.id}><span>{reference.title}</span><code>{reference.id}</code></li>)}</ul>
      </>}
      {references !== null && references.length === 0 && <div className="delete-copy">
        <strong>删除后正文不可恢复。</strong>这条资料会从列表与统计中移除，AI 也不会再引用它。
        {item.assetId ? ' 导入时的原件仍保留在 knowledge/raw/assets/（本批不提供原件清理）。' : ' 这条资料来自粘贴导入，没有保留原件。'}
      </div>}
      {error && <div className="form-error" role="alert"><p>{error}</p></div>}
      <div className="dialog-footer delete-footer">
        <span className="footer-note">{blocked ? '解除引用后才能删除' : '删除只由你的显式确认触发'}</span>
        <div>
          <button type="button" className="secondary-button" onClick={onClose} disabled={deleting}>取消</button>
          <button type="button" className="primary-button danger-button" onClick={confirm} disabled={deleting || references === null || blocked}>{deleting ? '正在删除…' : '确认删除'}</button>
        </div>
      </div>
    </section>
  </div>;
}

function toFailure(error: unknown): ImportFailure {
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as {
      retained?: boolean; committed?: boolean; recoverable?: boolean; assetId?: string; rawId?: string;
      raw?: Raw; byteSize?: number; sha256?: string; fileName?: string; format?: string;
    };
    return {
      code: error.code, message: error.message, retained: details.retained, committed: details.committed,
      recoverable: details.recoverable, assetId: details.assetId, rawId: details.rawId, raw: details.raw,
      byteSize: details.byteSize, sha256: details.sha256, fileName: details.fileName, format: details.format,
    };
  }
  return { code: 'REQUEST_FAILED', message: error instanceof Error ? error.message : '导入失败，请重试。' };
}



