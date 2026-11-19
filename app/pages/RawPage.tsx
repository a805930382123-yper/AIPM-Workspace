import type {RawCitationTarget} from '../components/WikiQuestionPanel';
import { useEffect, useRef, useState } from 'react';
import { PdfPages } from '../PdfPages';
import { useDialogFocus } from '../components/useDialogFocus';
import type { ExtractionJob, Raw, RawImportResult, RawUrlImportResult, RawTranslation, RawProcessingState, RawReference, SourceType, Wiki, KnowledgeWorkflowSummary } from '../api';
import { ApiError, api, apiForm, bytesText, changeRawTranslation, dateText, deleteRaw, formatLabels, getRaw, getRawBodyHistory, jobStageLabels, knowledgeWorkflows, pdfOriginalPageUrl, rawReferences, rawStatusLabels, rawTranslation, saveRawBody, sourceLabels, extractionJob, draftView, startExtract, reconcileExtractionStorage, startSynthesisWorkflow } from '../api';
import { MAX_BODY_CHARS, MAX_UPLOAD_BYTES } from '../../services/raw/limits.ts';

const ACCEPTED_FILES = '.md,.markdown,.txt,.docx,.pdf';
const MAX_UPLOAD_MIB = MAX_UPLOAD_BYTES / 1024 / 1024;
// F03-03: a single separator rule for the tag field, shared by the prefill text, the input
// hint and the parser, so an untouched tag list can never silently merge into one tag.
const TAG_SEPARATOR = /[，,、;；]+/u;
const parseTags = (value: string) => value.split(TAG_SEPARATOR).map(item => item.trim()).filter(Boolean);
const tagsText = (tags: string[]) => tags.join('、');
const isPdfRaw = (raw: Raw) => raw.assetFormat === 'pdf' && !!raw.assetId;
const isScannedPdf = (raw: Raw) => isPdfRaw(raw) && !raw.body.trim();
type ImportFailure = {
  code: string; message: string; retained?: boolean; committed?: boolean; recoverable?: boolean;
  assetId?: string; rawId?: string; raw?: Raw; byteSize?: number; sha256?: string; fileName?: string; format?: string;
};
type Mode = 'paste' | 'file';

export function RawPage({ initialOriginal, initialCitation,items, selectedId, onSelected, onOpenImport, onCommitted, onBodySaved, openImport, onCloseImport, onDeleted, processing, job, onJobStarted, navigationGeneration = 0, selectionGeneration = 0, onOpenDraft, onOpenWorkflow, onRefresh }: {
  initialOriginal?:boolean;initialCitation?:RawCitationTarget|null;items: Raw[]; selectedId: string | null; onSelected: (id: string) => void; onOpenImport: () => void;
  onCommitted: (raw: Raw) => Promise<void>; openImport: boolean; onCloseImport: () => void; onDeleted: (id: string) => Promise<void>;
  onBodySaved?: (raw: Raw) => void;
  processing: Record<string, RawProcessingState>; job: ExtractionJob | null;
  onJobStarted: (job: ExtractionJob, pageGeneration?: number, selectionGeneration?: number) => void; navigationGeneration?: number; selectionGeneration?: number; onOpenDraft: (draftId: string) => void; onOpenWorkflow?: (id: string) => void; onRefresh: () => Promise<void>;
}) {
  const selected = items.find(item => item.id === selectedId) ?? (selectedId ? null : items[0] ?? null);
  const [reimport, setReimport] = useState<Raw | null>(null);
  const [deletingItem, setDeletingItem] = useState<Raw | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [importTranslation, setImportTranslation] = useState<RawTranslation | null>(null);
  const startGeneration=useRef(0);
  useEffect(()=>{startGeneration.current++;setAiBusy(false);setAiError('');},[selected?.id]);
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [sourcePages, setSourcePages] = useState<Wiki[]>([]);
  const [pendingWorkflows, setPendingWorkflows] = useState<KnowledgeWorkflowSummary[]>([]);
  const synthesisOpening = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    knowledgeWorkflows().then(items => { if (active) setPendingWorkflows(items.filter(item => item.status === 'pending_confirmation' || item.status === 'conflict')); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const dialogOpen = openImport || !!reimport;
  const closeDialogs = () => { setReimport(null); onCloseImport(); };
  // F03-04: navigation only. Committing data to the parent happens in ImportDialog as soon as
  // the server confirms it, so every exit path (关闭 / 右上角关闭 / 继续导入) stays in sync.
  const openCommitted = (raw: Raw, translation?: RawTranslation) => { setImportTranslation(translation ?? null); onSelected(raw.id); closeDialogs(); };
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
    <div className="page-heading raw-heading"><div><h1>Raw 原始资料</h1><p className="subheading">保存文章、报告与业务记录的原文。保存后不会被 AI 改写。</p></div><div className="action-group"><button className="secondary-button" disabled={items.length < 2} onClick={async () => {
      if (synthesisOpening.current) return;
      synthesisOpening.current = true;
      try {
        const result = await api<{items:Wiki[]}>('/api/wiki');
        if (mountedRef.current) setSourcePages(result.items.filter(item => item.type === 'source'));
      } catch {
        if (mountedRef.current) setSourcePages([]);
      } finally {
        synthesisOpening.current = false;
      }
      if (mountedRef.current) setSynthesisOpen(true);
    }}>多来源综合</button><button className="primary-button" onClick={onOpenImport}><span>＋</span> 导入资料</button></div></div>
    {pendingWorkflows.length > 0 && <section className="panel pending-knowledge-workflows"><div className="panel-heading"><div><h2>待审核知识草稿</h2><p>保存后可以刷新或重启，再从这里继续审核。</p></div></div><div className="raw-list">{pendingWorkflows.map(item => <button className="raw-list-item" key={item.id} onClick={() => onOpenWorkflow?.(item.id)}><span className="file-icon">{item.kind === 'update' ? '更' : '综'}</span><span className="recent-copy"><b>{item.title}</b><small>{item.kind === 'update' ? '旧 Wiki 更新' : '多来源综合'} · v{item.revision} · {item.status === 'conflict' ? '提交冲突' : '待确认'}</small>{item.lastCommitError && <small className="form-error">{item.lastCommitError}</small>}</span></button>)}</div></section>}
    <div className="raw-workspace">
      <section className="panel raw-list-panel"><div className="list-title"><div><h2>所有资料</h2><span>{items.length} 条</span></div></div>{items.length ? <div className="raw-list">{items.map(item => {
        const state = processing[item.id];
        return <button key={item.id} className={`raw-list-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => onSelected(item.id)}><span className="file-icon">文</span><span className="recent-copy"><b>{item.title}{item.isDemo && <span className="demo-badge">演示数据</span>}</b><small>{sourceLabels[item.sourceType]} · {item.sourceName}{item.origin ? ' · 本机专用' : ''}</small><small>{dateText(item.importedAt)}{state && state.status !== 'unprocessed' ? ` · ${state.status === 'processing' ? '上次保存状态：' : ''}${rawStatusLabels[state.status]}` : ''}</small></span></button>;
      })}</div> : <div className="list-empty"><div className="empty-symbol">▧</div><b>还没有原始资料</b><span>导入第一份文章或业务记录。</span><button className="secondary-button" onClick={onOpenImport}>导入资料</button></div>}</section>
      <section className="panel raw-detail-panel">{selected ? <RawDetail initialOriginal={initialOriginal} initialCitation={initialCitation} initialTranslation={importTranslation?.rawId === selected.id ? importTranslation : null} key={selected.id} item={selected} state={selectedState} job={job} onStorageReconciled={value => { onJobStarted(value, navigationGeneration, selectionGeneration); void onRefresh(); }} busy={aiBusy} error={aiError} onStartAi={(restart, planningRetry,mode) => void startAi(selected.id, restart, planningRetry,mode)} onReimport={() => setReimport(selected)} onDelete={() => setDeletingItem(selected)} onOpenDraft={onOpenDraft} onBodySaved={onBodySaved ?? (() => { void onRefresh(); })} /> : selectedId ? <div className="detail-empty" role="status"><span className="empty-symbol">▤</span><b>所选 Raw 不存在或已删除</b><span>服务端未返回 ID {selectedId} 对应的资料。请选择列表中的其他 Raw。</span></div> : <div className="detail-empty"><span className="empty-symbol">▤</span><b>选择一条资料开始阅读</b><span>导入后，正文和来源信息会显示在这里。</span></div>}</section>
    </div>
    {dialogOpen && <ImportDialog prefill={reimport} onClose={closeDialogs} onCommitted={onCommitted} onOpen={openCommitted} onGenerate={generateImported} />}
    {deletingItem && <DeleteDialog item={deletingItem} onClose={() => setDeletingItem(null)} onDeleted={handleDeleted} />}
    {synthesisOpen && <SynthesisDialog items={items} sourcePages={sourcePages} onClose={() => setSynthesisOpen(false)} onCreated={workflowId => { setSynthesisOpen(false); onOpenWorkflow?.(workflowId); }} />}
  </div>;
}

function SynthesisDialog({ items, sourcePages, onClose, onCreated }: {
  items: Raw[]; sourcePages: Wiki[]; onClose: () => void; onCreated: (workflowId: string) => void;
}) {
  const dialog = useDialogFocus<HTMLElement>();
  const [synthesisIds, setSynthesisIds] = useState<string[]>([]);
  const [synthesisSourceIds, setSynthesisSourceIds] = useState<string[]>([]);
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const [synthesisError, setSynthesisError] = useState('');
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const selectedCount = new Set([
    ...synthesisIds,
    ...synthesisSourceIds.map(id => sourcePages.find(source => source.id === id)?.sources[0]).filter((id): id is string => Boolean(id)),
  ]).size;
  const submit = async () => {
    if (busyRef.current || selectedCount < 2) return;
    busyRef.current = true;
    setSynthesisBusy(true);
    setSynthesisError('');
    try {
      const workflow = await startSynthesisWorkflow({ rawIds: synthesisIds, sourceIds: synthesisSourceIds });
      onCreated(workflow.id);
    } catch (error) {
      if (mountedRef.current) setSynthesisError(error instanceof Error ? error.message : '综合草稿生成失败。');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSynthesisBusy(false);
    }
  };
  return <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !synthesisBusy) onClose(); }}>
    <section ref={dialog} tabIndex={-1} className="panel import-dialog synthesis-dialog" role="dialog" aria-modal="true" aria-labelledby="synthesis-dialog-title" aria-busy={synthesisBusy} onKeyDown={event => { if (event.key === 'Escape' && !synthesisBusy) onClose(); }}>
      <div className="dialog-header">
        <div>
          <h2 id="synthesis-dialog-title">选择综合来源</h2>
          <p>Raw 与 Source 可混合选择，最终按其真实 Raw ID 去重，至少两条。</p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭" disabled={synthesisBusy} onClick={onClose}>×</button>
      </div>
      {synthesisError && <p className="form-error" role="alert">{synthesisError}</p>}
      <div className="raw-list">
        {items.map(item => <label className="raw-list-item" key={item.id}><input type="checkbox" disabled={synthesisBusy} checked={synthesisIds.includes(item.id)} onChange={event => setSynthesisIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className="recent-copy"><b>Raw · {item.title}</b><small>{item.sourceName} · {item.id}</small></span></label>)}
        {sourcePages.map(item => <label className="raw-list-item" key={item.id}><input type="checkbox" disabled={synthesisBusy} checked={synthesisSourceIds.includes(item.id)} onChange={event => setSynthesisSourceIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className="recent-copy"><b>Source · {item.title}</b><small>{item.sources[0]} · {item.id}</small></span></label>)}
      </div>
      <div className="dialog-footer">
        <span className="footer-note">已选 {selectedCount} 条不同来源（至少 2 条）</span>
        <div>
          <button type="button" className="secondary-button" disabled={synthesisBusy} onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={synthesisBusy || selectedCount < 2} onClick={() => void submit()}>{synthesisBusy ? '正在生成…' : '生成 Synthesis 草稿'}</button>
        </div>
      </div>
    </section>
  </div>;
}

function RawDetail({ initialOriginal = false, initialCitation,initialTranslation,item, state, job, busy, error, onStartAi, onReimport, onDelete, onOpenDraft, onStorageReconciled, onBodySaved }: {
  initialOriginal?:boolean;initialCitation?:RawCitationTarget|null;initialTranslation:RawTranslation|null;item: Raw; state?: RawProcessingState; job: ExtractionJob | null; busy: boolean; error: string; onStorageReconciled: (job: ExtractionJob) => void;
  onStartAi: (restart?: boolean, planningRetry?: boolean,mode?:'standard'|'deep') => void; onReimport: () => void; onDelete: () => void; onOpenDraft: (draftId: string) => void;
  onBodySaved: (raw: Raw) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedBodyNotice, setSavedBodyNotice] = useState('');
  const citationMark=useRef<HTMLElement>(null),citation=initialCitation?.rawId===item.id?initialCitation:null;
  const citationMatches=!!citation&&item.bodySha256===citation.bodySha256&&item.body.slice(citation.start,citation.end)===citation.quote;
  useEffect(()=>{if(citationMatches)citationMark.current?.scrollIntoView({block:'center'});},[citationMatches,citation?.start,citation?.end,item.id]);
  const [translation, setTranslation] = useState<RawTranslation | null>(initialTranslation);
  const [translationError, setTranslationError] = useState('');
  const [translationActionError, setTranslationActionError] = useState('');
  const [translationAction, setTranslationAction] = useState<'retry' | 'cancel' | null>(null);
  const [translationRead, setTranslationRead] = useState(0);
  const [readingOriginal, setReadingOriginal] = useState(initialOriginal);
  useEffect(() => { setReadingOriginal(initialOriginal); }, [initialOriginal]);
  const canReadTranslation = !!item.urlImport && !item.origin;
  const translationCurrent = translation?.rawSha256 === item.bodySha256;
  const translatedBody = translationCurrent && translation.status === 'completed' ? translation.body : undefined;
  const showTranslation = !!translatedBody && !readingOriginal && !citation;
  const translating = translationCurrent && (translation.status === 'queued' || translation.status === 'running');
  useEffect(() => {
    if (!canReadTranslation || translationAction) return;
    let active = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const result = await rawTranslation(item.id);
        if (!active) return;
        setTranslation(result.translation ?? (initialTranslation?.status === 'failed' ? initialTranslation : null));
        setTranslationError('');
        if (result.translation?.status === 'queued' || result.translation?.status === 'running') timer = window.setTimeout(() => void read(), 500);
      } catch (problem) {
        if (active) setTranslationError(problem instanceof Error ? problem.message : '无法读取翻译状态。');
      }
    };
    void read();
    return () => { active = false; window.clearTimeout(timer); };
  }, [canReadTranslation, item.id, item.bodySha256, initialTranslation, translationRead, translationAction]);
  const updateTranslation = async (action: 'retry' | 'cancel') => {
    setTranslationAction(action);
    setTranslationActionError('');
    try {
      const result = await changeRawTranslation(item.id, action);
      setTranslation(result.translation);
    } catch (problem) {
      setTranslationActionError(problem instanceof Error ? problem.message : '无法更新翻译任务。');
    } finally { setTranslationAction(null); }
  };
  const status = state?.status ?? 'unprocessed';
  const [topicSummary,setTopicSummary]=useState<{draft:string[];written:string[];draftId?:string;history?:string;deferred?:boolean;commitRecovery?:boolean;sourceChanged?:boolean}|null>(null),[topicError,setTopicError]=useState('');
  useEffect(()=>{let active=true;setTopicSummary(null);setTopicError('');
    const load=async()=>{
      const response=state?.draftId?await draftView(state.draftId):null;
      if (response && (response.input || response.id !== state?.draftId || response.rawId !== item.id
        || (status === 'pending_confirmation' && state?.jobId && response.jobId !== state.jobId))) {
        throw new Error('整理草稿与当前资料或任务不匹配，请刷新后核对。');
      }
      const proposed = response && !response.input ? response : null;
      const formal=await Promise.all((state?.generatedWikiIds??[]).map(id=>api<Wiki>('/api/wiki/'+encodeURIComponent(id)))).catch(error => {
        if (active) setTopicError(error instanceof Error ? error.message : '无法读取正式主题。');
        return [];
      });
      const commitRecovery = proposed?.status === 'committing' || !!proposed?.pendingCommitOperationId;
      const history=!commitRecovery&&status!=='processing'&&status!=='failed'&&proposed?.maintenance&&(proposed.status==='confirmed'||proposed.status==='discarded')
        ? proposed.discardedAt?(proposed.status==='discarded'?'全部不采纳':'选择已结束'):proposed.maintenance.changes.every(c=>c.action==='noop'&&c.committedOperationId)?'已检查，无需变更':'已确认入库'
        : undefined;
      const sourceChanged = proposed?.preview?.rawSha256Matches === false;
      if(active)setTopicSummary({draft:history||sourceChanged?[]:proposed?.maintenance?proposed.maintenance.changes.filter(c=>!c.committedOperationId).map(c=>({create:'新建',update:'更新',link:'补来源',noop:'无变化'}[c.action])+'：'+c.candidate.title):proposed?.pages.filter(p=>p.selected).map(p=>p.title)??[],written:formal.filter(p=>p.type!=='source').map(p=>p.title),draftId:proposed?.id,history,deferred:proposed?.status==='pending_confirmation'&&!!proposed.deferredAt,commitRecovery,sourceChanged});
    };if(state?.draftId||state?.generatedWikiIds?.length)void load().catch(e=>{if(active)setTopicError(e instanceof Error?e.message:'无法读取受影响主题，请刷新重试。');});
    return()=>{active=false;};
  },[item.id,item.bodySha256,item.bodyRevision,status,state?.draftId,state?.jobId,state?.updatedAt,state?.generatedWikiIds?.join(',')]);
  const [mode,setMode]=useState<'standard'|'deep'>(()=>item.body.length<=30000?'deep':'standard');
  const [savingState, setSavingState] = useState(false);
  const [savingError, setSavingError] = useState('');
  const recoveryGeneration = useRef(0);
  useEffect(() => { recoveryGeneration.current++; setSavingState(false); setSavingError(''); return () => { recoveryGeneration.current++; }; }, [item.id]);
  const [storedJob, setStoredJob] = useState<ExtractionJob | null>(null);
  const storedJobId = state?.recoveryJobId ?? state?.jobId;
  useEffect(() => { if (!storedJobId) { setStoredJob(null); return; } let active = true; extractionJob(storedJobId).then(value => { if (active) setStoredJob(value); }).catch(() => undefined); return () => { active = false; }; }, [storedJobId]);
  const meetingOnly = item.origin !== undefined;
  const editedPdf = isPdfRaw(item) && !!item.bodyRevision;
  const pdf = !meetingOnly && isPdfRaw(item) && !editedPdf;
  const scannedPdf = isScannedPdf(item);
  const activeJob = job && job.rawId === item.id && (!storedJobId || job.jobId === storedJobId) ? job : storedJob && storedJob.rawId === item.id && storedJob.jobId === storedJobId ? storedJob : null;
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
  const stage = activeJob ? (activeJob.mode === 'deep' ? ({extracting:'提取',planning:'知识页规划',outline:'大纲',writing:'写作',quality:'质量检查',ready:'草稿阶段完成'} as Record<string,string>)[activeJob.checkpoint?.deepStage ?? activeJob.stage] ?? jobStageLabels[activeJob.stage] : jobStageLabels[activeJob.stage]) : rawStatusLabels[status];
  const recoveryStatus = storageBlocked ? (activeJob?.execution === 'running' ? '正在停止，状态保存失败' : '已停止，状态保存失败') : null;
  const draftStatus = topicSummary?.commitRecovery ? '上次确认待完成' : topicSummary?.sourceChanged ? '旧整理成果' : topicSummary?.deferred ? '稍后处理' : topicSummary?.history;
  const draftId = topicSummary?.draftId === state?.draftId ? topicSummary?.draftId : undefined;
  const legacyPdfTask = pdf && !scannedPdf && (storageBlocked || ((status === 'processing' || status === 'failed') && (!!storedJobId || !!activeJob || !!state?.lastError)));
  const pdfPrimary = pdf && !legacyPdfTask;
  return <article className="raw-detail">
    <h2>{item.title}</h2>
    <div className="detail-actions"><span className={`status ai-status ${storageBlocked ? 'failed' : status}`}><i />{recoveryStatus ?? draftStatus ?? (pdfPrimary && status === 'unprocessed' ? 'PDF 原件已保存' : rawStatusLabels[status])}</span><span className="detail-type">{sourceLabels[item.sourceType]}</span>{meetingOnly && <span className="detail-type meeting-local-badge">本机专用</span>}<div className="action-group">{!meetingOnly && <><button className="text-button" onClick={() => { setSavedBodyNotice(''); setEditing(true); }}>编辑原文</button><button className="text-button" onClick={onReimport}>重新导入</button></>}<button className="text-button danger" onClick={onDelete}>删除</button></div></div>
    {savedBodyNotice && <p role="status">{savedBodyNotice}</p>}
    {!!item.bodyRevision && <p className="extract-note">原文已人工修改。旧版正文仍可在修改历史中查看，依赖旧版正文的整理成果需要重新核对。</p>}
    <section className="raw-status-summary" aria-label="整理状态">
      <p><b>当前阶段：</b>{recoveryStatus ?? draftStatus ?? (pdfPrimary && status === 'unprocessed' ? '请查看下方 PDF 处理进度' : stage)}{!storageBlocked && !draftStatus && status === 'pending_confirmation' && (activeJob?.stage === 'done' || activeJob?.checkpoint?.deepStage === 'ready') ? '（草稿阶段结束，正式写入仍需确认）' : ''}</p>
      <div><b>已保留结果：</b>{topicSummary?.sourceChanged ? '草稿基于旧原文，无法用来确认新入库。' : topicSummary?.deferred ? '已保存草稿及剩余成果。' : status === 'pending_confirmation' && draftId ? '草稿已保存，待你审核。' : status === 'generated' && (state?.generatedWikiIds?.length ?? 0) > 0 ? <>已确认写入：<code className="mono">{state?.generatedWikiIds?.join('、')}</code></> : pdfPrimary ? '原 PDF 已保存。' : '暂无可确认的已保存结果。'}{activeJob?.checkpoint && <p className="extract-note">已验证 {activeJob.checkpoint.validatedChunks}/{activeJob.checkpoint.totalChunks} 提取段，累计 {activeJob.checkpoint.attempts} 次调用，复用 {activeJob.checkpoint.reusedChunks} 段；这不是整项完成比例。</p>}</div>
      {topicError&&<p className="form-error" role="alert">受影响主题读取失败：{topicError}</p>}{topicSummary&&<div aria-label="受影响知识主题">{topicSummary.draft.length>0&&<p><b>草稿拟影响主题：</b>{topicSummary.draft.join('；')}</p>}{topicSummary.written.length>0&&<p><b>已写入主题：</b>{topicSummary.written.join('、')}</p>}</div>}
      {storageBlocked && <section className="notice-warn" role="alert"><b>{activeJob?.execution === 'running' ? '任务正在停止，状态保存失败' : '任务已停止，状态保存失败'}</b><p>{activeJob?.recovery?.message}（{activeJob?.recovery?.phase}）</p>{savingError && <p className="form-error">{savingError}</p>}</section>}
      {status === 'failed' && state?.lastError && <p className="notice-warn"><b>问题：</b>{state.lastError.code === 'LLM_ATTEMPT_LIMIT' ? '旧任务曾因调用次数停止。可以显式继续，检查点和累计次数会保留。' : <>{state.lastError.message}（{state.lastError.code}）{state.lastError.retryable ? '（可以重试）' : '（需要先处理配置或资料问题）'}</>}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {pdf && <div className="raw-next-actions">
        <b>PDF 处理</b>
        <p>{scannedPdf ? '这份 PDF 没有文字层，可以用页图进行 AI 页理解。' : '可以查看原页图和文字层，再按需开始 AI 页理解。'}按页整理后，在成果草稿中审核并选择要入库的主题。</p>
        <a href="#pdf-pages" className="text-button">前往 PDF 逐页阅读</a>
        {draftId && !storageBlocked && <button className="text-button" onClick={() => onOpenDraft(draftId)}>{topicSummary?.commitRecovery ? '查看上次确认' : topicSummary?.history ? '查看整理结果' : '打开已保存草稿'}</button>}
      </div>}
      {meetingOnly ? <p className="notice-warn">Meeting来源仅限本机保存：禁止外部 AI、Wiki沉淀与Prompt背景使用。请在会议档案编辑纪要工作副本。</p> : (!pdf || legacyPdfTask) && <div className="raw-next-actions"><b>{legacyPdfTask ? '已有正文整理任务' : '下一步'}</b>
        {(status === 'unprocessed' || status === 'failed' || status === 'generated') && <><label className="field raw-extraction-mode">整理模式<select aria-label="整理模式" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'standard'|'deep')}><option value="deep" disabled={item.body.length>30000}>深度整理</option><option value="standard">标准整理</option></select><small>{item.body.length>30000?'正文超过30000字符，深度整理不可选；标准整理保留全文。':'深度整理生成结构化阅读笔记，可显式选择标准整理。'}</small></label><div><button className="text-button ai-action" disabled={busy || storageBlocked} onClick={() => onStartAi(false,false,status==='failed'&&activeJob?(activeJob.mode??'standard'):mode)}>{busy ? '正在启动…' : status === 'failed' && activeJob?.pipelineVersion ? '显式继续提取' : status === 'failed' ? '重试 AI 整理' : '整理到知识库'}</button><p className="extract-note">{status === 'failed' && activeJob?.pipelineVersion ? `从现有检查点尝试继续，沿用原任务${activeJob.mode==='deep'?'深度':'标准'}模式并保留累计调用；可恢复性由服务端判定。` : '自动准备知识页成果，待你选择并确认。'}</p></div></>}
        {status === 'processing' && activeJob && activeJob.execution !== 'settled' && !storageBlocked && <button className="text-button" onClick={async () => { await api(`/api/extraction-jobs/${encodeURIComponent(activeJob.jobId)}/cancel`, { method: 'POST', body: JSON.stringify({}) }); }}>取消整理</button>}
        {(status === 'pending_confirmation' || topicSummary?.commitRecovery) && draftId && !storageBlocked && !topicSummary?.history && <div>
          <button className="text-button ai-action" onClick={() => onOpenDraft(draftId)}>{topicSummary?.commitRecovery ? '查看上次确认' : topicSummary?.sourceChanged ? '查看旧草稿' : topicSummary?.deferred ? '查看暂缓成果' : '继续审核'}</button>
          <p className="extract-note">{topicSummary?.commitRecovery ? '打开原成果，继续完成上次确认。' : topicSummary?.sourceChanged ? '可以在旧草稿中结束本次选择，再按当前原文整理。' : topicSummary?.deferred ? '打开原草稿后，选择继续处理。' : '先查看整理成果，选出值得入库的主题后统一确认。'}</p>
        </div>}
        {topicSummary?.history&&draftId&&<button className="text-button" onClick={()=>onOpenDraft(draftId)}>查看整理结果</button>}
        {status === 'failed' && activeJob?.mode!=='deep' && activeJob?.error?.code === 'LLM_PLAN_COVERAGE_INVALID' && <div><button className="text-button" disabled={busy || storageBlocked} onClick={() => onStartAi(false, true,'standard')}>仅重新规划（带覆盖诊断）</button><p className="extract-note">使用既有提取结果重新规划，模型调用继续累计。</p></div>}
        {status === 'failed' && activeJob?.pipelineVersion && <div><button className="text-button" disabled={busy || storageBlocked} onClick={() => onStartAi(true,false,mode)}>明确重新生成</button><p className="extract-note">按当前选择模式重新生成，仍会显示实际累计调用。</p></div>}
        {storageBlocked && <div><button className="secondary-button" disabled={savingState || activeJob?.execution !== 'settled'} onClick={() => void retryStorage()}>{savingState ? '正在保存状态…' : '重试保存状态'}</button><p className="extract-note">{activeJob?.execution === 'running' ? '等待任务停止后再试。' : '仅对账本机状态，不会重新调用模型。'}</p></div>}
      </div>}
    </section>
    {item.isDemo && <p className="demo-notice">【演示数据】虚构教学示例，不代表真实公司或业务事实。</p>}
    <div className="detail-source">{item.sourceName}{item.author ? ` · ${item.author}` : ''}</div>
    <div className="metadata-grid"><Meta label="导入时间" value={dateText(item.importedAt)} /><Meta label="原发布日期" value={item.publishedAt || '未填写'} /><Meta label="来源链接" value={item.url || '未填写'} link={!!item.url} /></div>
    {item.urlImport && <section className="detail-asset" aria-label="网页导入来源">
      <div className="detail-asset-head"><span>网页导入来源</span></div>
      <div className="metadata-grid"><Meta label="实际读取地址" value={item.urlImport.finalUrl} link /><Meta label="网页读取时间" value={dateText(item.urlImport.fetchedAt)} /><Meta label="解析方式" value={item.extractionParser === 'url_plain_text' ? '网页纯文本' : '静态网页正文'} /></div>
      {item.extractionNote && <p className="extract-note">{item.extractionNote}</p>}
    </section>}

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
    {editedPdf && <section className="detail-asset" aria-label="PDF 原件">
      <p className="notice-warn">PDF 提取文字已人工修改，PDF 原件未改。原页文字位置、页理解与按页整理成果不适用于当前正文。</p>
      <a href={pdfOriginalPageUrl(item.id, 1)} target="_blank" rel="noreferrer" className="text-button">打开 PDF 原件</a>
    </section>}
    {pdf && <PdfPages rawId={item.id} onOpenDraft={onOpenDraft} />}
    {canReadTranslation && <>
      {translating && <section className="raw-translation-status" aria-label="翻译进度"><span role="status">{translation.status === 'queued' ? '等待翻译成中文' : `正在翻译成中文（${translation.completedChunks}/${translation.totalChunks} 段）`}</span><button className="text-button" disabled={!!translationAction} onClick={() => void updateTranslation('cancel')}>取消翻译</button></section>}
      {translationCurrent && translation.status === 'failed' && <div className="notice-warn raw-translation-status" role="alert"><div><b>原始资料已保存，中文翻译未完成。</b>{translation.error && <p>{translation.error.message}</p>}</div><button className="secondary-button" disabled={!!translationAction} onClick={() => void updateTranslation('retry')}>{translationAction === 'retry' ? '正在重试…' : '重试翻译'}</button></div>}
      {translationCurrent && translation.status === 'cancelled' && <div className="raw-translation-status"><span>翻译已取消，仍可阅读原文。</span><button className="secondary-button" disabled={!!translationAction} onClick={() => void updateTranslation('retry')}>继续翻译</button></div>}
      {translationCurrent && translation.status === 'skipped' && translation.reason && <p className="extract-note">{translation.reason}</p>}
      {translationError && <div className="form-error raw-translation-status" role="alert"><span>翻译状态暂不可用。{translationError}</span><button className="text-button" disabled={!!translationAction} onClick={() => setTranslationRead(value => value + 1)}>重读状态</button></div>}
      {translationActionError && <p className="form-error" role="alert">{translationActionError}</p>}
    </>}
    <div className="body-divider"><span>{showTranslation ? 'AI 中文译文' : editedPdf ? '人工修订后的提取文字' : '原始正文'}</span>
      {translatedBody ? <div className="raw-reader-tabs" role="group" aria-label="正文语言">
        <button className="text-button" aria-pressed={showTranslation} disabled={!!citation} onClick={() => setReadingOriginal(false)}>中文译文</button>
        <button className="text-button" aria-pressed={!showTranslation} onClick={() => setReadingOriginal(true)}>原文</button>
      </div> : <span>SHA-256 已保存</span>}
    </div>
    {citation&&<p className={citationMatches?'extract-note':'form-error'}>{citationMatches?`本次引用原句：[${citation.start}, ${citation.end})`:'引用位置或原文版本已变化，未标记旧位置。'}</p>}
    {scannedPdf ? <p className="extract-note">未提取到文字层。请在上方查看原 PDF 页图。</p> : <pre className="raw-body" lang={showTranslation ? 'zh-CN' : undefined}>{showTranslation ? translatedBody : citation&&citationMatches?<>{item.body.slice(0,citation.start)}<mark ref={citationMark} data-citation-start={citation.start} data-citation-end={citation.end}>{item.body.slice(citation.start,citation.end)}</mark>{item.body.slice(citation.end)}</>:item.body}</pre>}
    {!!item.bodyRevision && <button className="text-button" onClick={() => setHistoryOpen(true)}>查看原文修改历史</button>}
    <details className="raw-identifiers"><summary>资料标识与校验值</summary><div className="metadata-grid"><Meta label="资料 ID" value={item.id} mono />{item.origin && <><Meta label="Meeting ID" value={item.origin.meeting_id} mono /><Meta label="来源版本" value={item.origin.import_id} mono /><Meta label="原件 SHA-256" value={item.origin.original_sha256} mono /><Meta label="处理策略" value={item.origin.processing_policy} mono /></>}</div><div className="hash-line">正文校验值 <code>{item.bodySha256}</code></div></details>
    {editing && <RawBodyEditor item={item} onClose={() => setEditing(false)} onSaved={raw => {
      onBodySaved(raw);
      if (raw.body.length > 30000) setMode('standard');
      setReadingOriginal(true);
      setSavedBodyNotice(raw.bodyRevision === item.bodyRevision ? '原文没有变化。' : '原文已保存，修改前的版本已保留。');
      setEditing(false);
    }} />}
    {historyOpen && <RawBodyHistory item={item} onClose={() => setHistoryOpen(false)} />}
  </article>;
}
function Meta({ label, value, link, mono }: {label: string; value: string; link?: boolean; mono?: boolean}) { return <div className="meta"><span>{label}</span>{link ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <b className={mono ? 'mono' : ''}>{value}</b>}</div>; }

function RawBodyEditor({ item, onClose, onSaved }: { item: Raw; onClose: () => void; onSaved: (raw: Raw) => void }) {
  const dialog = useDialogFocus<HTMLElement>();
  const [base, setBase] = useState(item);
  const [body, setBody] = useState(item.body);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Raw | null>(null);
  const save = async () => {
    setWorking(true); setError('');
    try { onSaved(await saveRawBody(base, body)); }
    catch (problem) {
      setConflict(problem instanceof ApiError && problem.code === 'RAW_BODY_CONFLICT');
      setLatest(null);
      setError(problem instanceof Error ? problem.message : '保存原文失败。');
    } finally { setWorking(false); }
  };
  const readLatest = async () => {
    setWorking(true); setError('');
    try { setLatest(await getRaw(base.id)); }
    catch (problem) { setError(problem instanceof Error ? problem.message : '无法读取最新原文。'); }
    finally { setWorking(false); }
  };
  const canSave = !working && !conflict && !!body.trim() && body.length <= MAX_BODY_CHARS;
  return <div className="modal-scrim"><section ref={dialog} tabIndex={-1} className="panel import-dialog" role="dialog" aria-modal="true" aria-labelledby="raw-body-edit-title" onKeyDown={event => { if (event.key === 'Escape' && !working) onClose(); }}>
    <div className="dialog-header"><div><h2 id="raw-body-edit-title">编辑原文</h2><p>{item.title}</p></div><button type="button" className="icon-button" aria-label="关闭原文编辑" disabled={working} onClick={onClose}>×</button></div>
    <form onSubmit={event => { event.preventDefault(); if (canSave) void save(); }}>
      <p className="extract-note">{isPdfRaw(item) ? '编辑的是提取文字，PDF 原件未改。保存后，旧页码定位与按页整理成果不适用于新正文。' : '保存会保留修改前的原文。旧整理成果需要按当前原文重新核对。'}</p>
      <label className="field">原文正文<textarea data-autofocus rows={14} value={body} onChange={event => setBody(event.target.value)} readOnly={working} /></label>
      <p className="field-hint">{body.length.toLocaleString()} / {MAX_BODY_CHARS.toLocaleString()} 字符</p>
      {body.length > MAX_BODY_CHARS && <p className="form-error" role="alert">正文超过字符上限，请缩短后保存。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && !latest && <button type="button" className="secondary-button" disabled={working} onClick={() => void readLatest()}>读取最新原文</button>}
      {conflict && latest && <section aria-label="最新原文">
        <p className="extract-note">请核对最新原文（第 {latest.bodyRevision ?? 0} 版）。上方保留了你的编辑。</p>
        <label className="field">最新原文正文<textarea rows={8} value={latest.body} readOnly /></label>
        <button type="button" className="secondary-button" onClick={() => { setBase(latest); setLatest(null); setConflict(false); }}>已核对，保留我的编辑</button>
      </section>}
      <div className="dialog-footer"><span>{!conflict && base !== item ? '将基于已核对的第 ' + (base.bodyRevision ?? 0) + ' 版保存' : ''}</span><div><button type="button" className="secondary-button" disabled={working} onClick={onClose}>取消</button><button className="primary-button" disabled={!canSave}>{working ? '处理中…' : '保存原文'}</button></div></div>
    </form>
  </section></div>;
}

function RawBodyHistory({ item, onClose }: { item: Raw; onClose: () => void }) {
  const dialog = useDialogFocus<HTMLElement>();
  const [revision, setRevision] = useState((item.bodyRevision ?? 1) - 1);
  const [snapshot, setSnapshot] = useState<Raw | null>(null);
  const [error, setError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setSnapshot(null); setError('');
    getRawBodyHistory(item.id, revision).then(raw => { if (active) setSnapshot(raw); }).catch(problem => {
      if (active) setError(problem instanceof Error ? problem.message : '无法读取旧版原文。');
    });
    return () => { active = false; };
  }, [item.id, revision, readAttempt]);
  const visible = snapshot && (snapshot.bodyRevision ?? 0) === revision ? snapshot : null;
  return <div className="modal-scrim"><section ref={dialog} tabIndex={-1} className="panel import-dialog" role="dialog" aria-modal="true" aria-labelledby="raw-body-history-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div className="dialog-header"><div><h2 id="raw-body-history-title">原文修改历史</h2><p>{item.title}</p></div><button type="button" className="icon-button" aria-label="关闭修改历史" onClick={onClose}>×</button></div>
    <div className="raw-detail">
      <div className="action-group"><button className="secondary-button" disabled={revision === 0} onClick={() => setRevision(revision - 1)}>更早一版</button><button className="secondary-button" disabled={revision >= (item.bodyRevision ?? 1) - 1} onClick={() => setRevision(revision + 1)}>更新一版</button></div>
      <h3>{revision === 0 ? '导入时的原文' : '人工修改第 ' + revision + ' 版'}</h3>
      {error ? <p className="form-error" role="alert">{error} <button className="text-button" onClick={() => setReadAttempt(attempt => attempt + 1)}>重读此版本</button></p> : visible ? <>
        <pre className="raw-body">{visible.body || '此版本没有提取文字。'}</pre>
        <div className="hash-line">正文校验值 <code>{visible.bodySha256}</code></div>
      </> : <p role="status">正在读取历史版本…</p>}
    </div>
  </section></div>;
}

export function ImportDialog({ onClose, onCommitted, onOpen, onGenerate, prefill }: {
  onClose: () => void; onCommitted: (raw: Raw) => Promise<void>; onOpen: (raw: Raw, translation?: RawTranslation) => void; onGenerate: (raw: Raw) => Promise<void>; prefill?: Raw | null;
}) {
  // The original tag array is kept verbatim; the text field is only a view of it until edited.
  const dialogRef = useDialogFocus<HTMLElement>();
  const initialTags = prefill?.tags ?? [];
  const [mode, setMode] = useState<Mode>(prefill?.assetId ? 'file' : 'paste');
  const [form, setForm] = useState({
    title: prefill?.title ?? '', sourceType: (prefill?.sourceType ?? 'article') as SourceType, sourceName: prefill?.sourceName ?? '',
    author: prefill?.author ?? '', publishedAt: prefill?.publishedAt ?? '', url: prefill?.url ?? '',
    tags: tagsText(initialTags), body: '',
  });
  const [tagsTouched, setTagsTouched] = useState(false);
  const [translateToChinese, setTranslateToChinese] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [result, setResult] = useState<RawImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [generationFailure, setGenerationFailure] = useState('');
  const [generationRaw, setGenerationRaw] = useState<Raw | null>(null);
  const material = file ? 'file' : form.body.trim() ? 'paste' : form.url.trim() ? 'url' : null;
  const urlOnly = material === 'url';
  const pdfFile = !!file && /\.pdf$/iu.test(file.name);
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
    setResult(null); setFailure(null); setFile(null); setTagsTouched(false); setTranslateToChinese(true);
    setForm(previous => ({ ...previous, title: prefill ? previous.title : '', sourceName: prefill ? previous.sourceName : '', url: '', tags: tagsText(initialTags), body: '' }));
  };
  const chooseFile = (next: File | null) => {
    setFile(next); setFailure(null); setResult(null);
    if (!next) return;
    if (next.size > MAX_UPLOAD_BYTES) setFailure({ code: 'FILE_TOO_LARGE', retained: false, fileName: next.name, byteSize: next.size, message: `文件为 ${bytesText(next.size)}，超过 ${MAX_UPLOAD_MIB} MiB 上限；工作台不会上传它，服务端也会在接收阶段拒绝。请改用粘贴文本。` });
  };
  const removeFile = () => { if (fileInput.current) fileInput.current.value = ''; chooseFile(null); };
  const switchToPaste = () => { setMode('paste'); removeFile(); };
  const submit = async (generateAfterSave = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setFailure(null); setGenerationFailure(''); setSaving(true);
    try {
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES) { setFailure({ code: 'FILE_TOO_LARGE', retained: false, fileName: file.name, byteSize: file.size, message: `文件为 ${bytesText(file.size)}，超过 ${MAX_UPLOAD_MIB} MiB 上限，未上传。` }); return; }
        const payload = new FormData();
        payload.append('metadata', JSON.stringify(metadata()));
        payload.append('file', file, file.name);
        const outcome = await apiForm<RawImportResult>('/api/raw/import', payload);
        setResult(outcome);
        // F03-04: sync the committed Raw with the parent right away, so closing the result
        // panel (or continuing with another one) cannot leave the list and counters stale.
        await onCommitted(outcome.raw);
        if (generateAfterSave && !isPdfRaw(outcome.raw)) { setGenerationRaw(outcome.raw); try { await onGenerate(outcome.raw); setGenerationRaw(null); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可用同一 Raw 重试。'); } }
      } else if (material === 'paste') {
        const raw = await api<Raw>('/api/raw', { method: 'POST', body: JSON.stringify({ ...metadata(), body: form.body }) });
        await onCommitted(raw);
        if (generateAfterSave) { setGenerationRaw(raw); try { await onGenerate(raw); setGenerationRaw(null); onOpen(raw); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可用同一 Raw 重试。'); } } else onOpen(raw);
      } else if (urlOnly) {
        const {raw, translation} = await api<RawUrlImportResult>('/api/raw/import', {method: 'POST', body: JSON.stringify({metadata: metadata(), translateToChinese})});
        await onCommitted(raw);
        onOpen(raw, translation);
      } else {
        setFailure({code:'IMPORT_MATERIAL_REQUIRED', message:'请上传文件、粘贴正文或填写一个可读取的公开网页链接。'});
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
  return <div className="modal-scrim" role="presentation" onMouseDown={event => { if (!saving && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-busy={saving}>
      <div className="dialog-header">
        <div>
          <p className="eyebrow">{prefill ? '重新导入 Raw' : '新建 Raw'}</p>
          <h2 id="import-title">{prefill ? `重新导入「${prefill.title}」` : '导入原始资料'}</h2>
          <p>原文保存到本机；上传文件时原件按原始字节保留，正文由解析器提取后入库。</p>
        </div>
        <button className="icon-button" aria-label="关闭" disabled={saving} onClick={onClose}>×</button>
      </div>
      {prefill && <p className="reimport-hint">重新导入会创建新的 Raw ID，旧记录及其原件保持不变；工作台不会自动复制上一条的原文件或转移 Wiki 来源。{prefill.assetId ? ' 如需按文件导入，请重新选择原文件。' : ''}</p>}
      {result && generationFailure && generationRaw && <div className="form-error" role="alert"><b>Raw 已保存，Wiki 草稿未生成</b><p>{generationFailure}</p><button type="button" className="secondary-button" disabled={saving} onClick={async () => { setSaving(true); setGenerationFailure(''); try { await onGenerate(generationRaw); setGenerationRaw(null); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可重试。'); } finally { setSaving(false); } }}>用同一 Raw 重试</button><small>Raw ID：<code>{generationRaw.id}</code></small></div>}      {result
        ? <ResultPanel result={result} prefill={!!prefill} onClose={onClose} onOpen={() => onOpen(result.raw)} onAgain={resetForNext} />
        : failure?.committed && failure.raw
          ? <PartialPanel failure={failure} raw={failure.raw} onClose={onClose} onOpen={() => onOpen(failure.raw as Raw)} onAgain={resetForNext} />
          : <>
        <div className="dialog-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'paste'} disabled={saving} className={`dialog-tab ${mode === 'paste' ? 'active' : ''}`} onClick={() => setMode('paste')}>粘贴文本<small>从文章或笔记复制全文</small></button>
          <button type="button" role="tab" aria-selected={mode === 'file'} disabled={saving} className={`dialog-tab ${mode === 'file' ? 'active' : ''}`} onClick={() => setMode('file')}>上传文件<small>Markdown / TXT / DOCX / PDF</small></button>
        </div>
        <form onSubmit={event => { event.preventDefault(); void submit(false); }}>
          {failure && !failure.committed && <div className="form-error" role="alert">
            <b className="error-code">{failure.code}</b>
            <p>{failure.message}</p>
            {urlOnly && !failure.message.includes('上传文件或粘贴正文') && <p>可以上传文件或粘贴可读取的原文。</p>}
            {failure.retained && <p className="retained-note">原件已保留：{failure.fileName || '上传的文件'} · {bytesText(failure.byteSize)} · SHA-256 <code>{failure.sha256}</code> · assetId <code>{failure.assetId}</code></p>}
            {failure.retained && <div className="error-actions"><button type="button" className="secondary-button" onClick={switchToPaste}>改用粘贴文本补救</button></div>}
          </div>}
          <fieldset className="form-grid import-fields" disabled={saving}>
            <label className="field span-two"><span>标题 {material === 'paste' && <em>*</em>}</span><input value={form.title} onChange={event => update('title', event.target.value)} required={material === 'paste'} maxLength={300} placeholder="例如：经销商订货流程访谈纪要" data-autofocus /></label>
            <label className="field"><span>来源类型 <em>*</em></span><select value={form.sourceType} onChange={event => update('sourceType', event.target.value as SourceType)}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span>来源名称 {material === 'paste' && <em>*</em>}</span><input value={form.sourceName} onChange={event => update('sourceName', event.target.value)} required={material === 'paste'} maxLength={300} placeholder="例如：客户访谈 / 公众号名称" /></label>
            <label className="field">作者<input value={form.author} onChange={event => update('author', event.target.value)} maxLength={200} placeholder="可选" /></label>
            <label className="field">原发布日期<input type="date" value={form.publishedAt} onChange={event => update('publishedAt', event.target.value)} /></label>
            <label className="field span-two">原始链接<input type="url" value={form.url} onChange={event => update('url', event.target.value)} placeholder="https://…（可选）" /><span className="field-hint">没有文件或粘贴正文时，可从公开网页读取原文。标题和来源可从网页取得。</span></label>
            {urlOnly && <label className="raw-translate-choice span-two"><input type="checkbox" checked={translateToChinese} onChange={event => setTranslateToChinese(event.target.checked)} />翻译成中文（会调用已配置模型）</label>}
            <label className="field span-two">标签<input value={form.tags} onChange={event => update('tags', event.target.value)} placeholder="用逗号或顿号分隔，例如：渠道、库存" /><span className="field-hint">分隔符：中文/英文逗号、顿号、分号 · 当前 {commitTags().length} 项{tagsTouched ? '' : '（未修改，按原标签保存）'}</span></label>
            {mode === 'paste'
              ? <label className="field span-two body-field">原始正文<textarea value={form.body} onChange={event => update('body', event.target.value)} maxLength={MAX_BODY_CHARS} placeholder="粘贴文章、会议纪要或业务资料原文。前后空白和换行会原样保留。" /><span className="field-hint">最多 {MAX_BODY_CHARS.toLocaleString()} 字符 · {form.body.length.toLocaleString()} 字符</span></label>
              : <div className="field span-two file-picker">
                <span>原文件（可选）</span>
                <input ref={fileInput} type="file" accept={ACCEPTED_FILES} onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
                <span className="field-hint">支持 Markdown（.md/.markdown）、TXT（.txt，严格 UTF-8）、DOCX、PDF；单个文件上限 {MAX_UPLOAD_MIB} MiB，提取正文上限 {MAX_BODY_CHARS.toLocaleString()} 字符。扫描版 PDF 可以逐页阅读，加密 PDF 暂不支持。</span>
              </div>}
            {file && <div className="file-picked span-two">本次使用文件 <b>{file.name}</b><span>{bytesText(file.size)}</span><button type="button" className="text-button" onClick={removeFile}>移除文件</button></div>}
            {!file && material === 'paste' && <p className="field-hint span-two">本次使用已粘贴的正文。链接只记作来源。</p>}
          </fieldset>
          {generationFailure && generationRaw && <div className="form-error" role="alert"><b>Raw 已保存，Wiki 草稿未生成</b><p>{generationFailure}</p><button type="button" className="secondary-button" disabled={saving} onClick={async () => { setSaving(true); setGenerationFailure(''); try { await onGenerate(generationRaw); setGenerationRaw(null); onOpen(generationRaw); } catch (problem) { setGenerationFailure(problem instanceof Error ? problem.message : 'Wiki 草稿未生成，可重试。'); } finally { setSaving(false); } }}>用同一 Raw 重试</button><small>Raw ID：<code>{generationRaw.id}</code></small></div>}
          <div className="dialog-footer">
            <span>{urlOnly ? '先从网页保存 Raw，之后可单独发起整理' : pdfFile ? '保存后可逐页阅读，并按需发起 AI 页理解' : file ? '原件、正文与来源关联都写入后才显示导入成功' : '正文写入后不可由 AI 改写'}</span>
            <div>
              <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>取消</button>
              {urlOnly ? <button type="submit" className="primary-button" disabled={saving}>{saving ? '正在读取网页…' : '从网页导入 Raw'}</button> : <>
                <button type="button" className={pdfFile ? 'primary-button' : 'secondary-button'} disabled={saving} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void submit(false); }}>{saving ? '正在保存…' : '仅保存 Raw'}</button>
                {!pdfFile && <button type="button" className="primary-button" disabled={saving} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void submit(true); }}>{saving ? '正在处理…' : '保存并生成 Wiki 草稿'}</button>}
              </>}
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
  const scanned = isScannedPdf(result.raw);
  return <section className="result-panel">
    <div className="result-head"><span className="result-dot" />{scanned ? '导入成功：扫描 PDF 原件已保存' : '导入成功：正文已入库，原件已保留'}</div>
    <ul className="result-list">
      <li><span>Raw ID</span><code>{result.raw.id}</code></li>
      <li><span>资料标题</span><span>{result.raw.title}</span></li>
      <li><span>正文</span><span>{scanned ? '无文字层，可逐页查看图像' : <>{result.extraction.bodyChars.toLocaleString()} 字符 · SHA-256 <code>{result.raw.bodySha256.slice(0, 16)}…</code></>}</span></li>
      <li><span>提取方式</span><span>{result.extraction.parser}</span></li>
      <li><span>原件</span><span>{result.asset.fileName} · {formatLabels[result.asset.format] ?? result.asset.format} · {bytesText(result.asset.byteSize)}</span></li>
      <li><span>原件位置</span><code>knowledge/raw/assets/{result.asset.storedFile}</code></li>
      <li><span>原件 SHA-256</span><code>{result.asset.sha256}</code></li>
    </ul>
    <p className="extract-note">{result.extraction.note}</p>
    <div className="dialog-footer">
      <span className="footer-note">{scanned ? '在资料详情查看页图，并按需发起 AI 页理解。' : prefill ? '旧记录保持不变' : '正文与原件关联都已保存；列表与统计已同步'}</span>
      <div>
        <button type="button" className="secondary-button" onClick={onAgain}>继续导入下一条</button>
        <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        <button type="button" className="primary-button" onClick={onOpen}>{scanned ? '查看 PDF 页面' : '查看这条资料'}</button>
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
  const dialog = useDialogFocus<HTMLElement>();
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
  return <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) onClose(); }}>
    <section ref={dialog} tabIndex={-1} className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" onKeyDown={event => { if (event.key === 'Escape' && !deleting) onClose(); }}>
      <div className="dialog-header">
        <div>
          <p className="eyebrow">删除 Raw</p>
          <h2 id="delete-title">删除「{item.title}」</h2>
          <p>删除前会重新检查这条资料是否被正式 Wiki 引用。</p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭" disabled={deleting} onClick={onClose}>×</button>
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
