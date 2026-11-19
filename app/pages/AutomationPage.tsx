import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AutomationList, AutomationRun, AutomationRunStatus, AutomationSchedule, AutomationStatus,
  CandidateFilter, CandidateList, CandidateView, ConfirmCandidates, PipelineSettings,
} from '../api';
import {
  ApiError, automationRun, automationRuns, automationSchedules, automationStatus, automationTime,
  cancelAutomationRun, changeAutomationPause, editAutomationSchedule, runAutomationTask,
  automationCandidates, changeCandidateDisposition, confirmCandidates, readPipelineSettings, retryCandidate, savePipelineSettings,
} from '../api';
import { useDialogFocus } from '../components/useDialogFocus';
import '../automation.css';

const statusLabels: Record<AutomationRunStatus, string> = {
  queued: '排队中', running: '运行中', succeeded: '成功', failed: '失败',
  cancelled: '已取消', interrupted: '已中断', skipped: '已跳过',
};
const triggerLabels = { schedule: '计划', manual: '手动', 'catch-up': '启动后补跑' };
const issueLabels = { read: '无法读取', parse: '格式损坏', directory: '无法读取目录', shape: '记录字段无效' };
const runError = (error: string) => error === 'paused' ? '全局已暂停' : error === 'overlap' ? '同类任务正在运行' : error;
const isActive = (status: AutomationRunStatus) => status === 'queued' || status === 'running';
const describeError = (error: unknown) => error instanceof Error ? error.message : '请求失败，请稍后重试。';

function poll(load: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const read = async () => {
    await load(controller.signal);
    if (!controller.signal.aborted) timer = setTimeout(() => void read(), 3000);
  };
  void read();
  return () => { controller.abort(); clearTimeout(timer); };
}

function createEditor(schedule: AutomationSchedule) {
  return {
    type: schedule.type, revision: schedule.revision, enabled: schedule.enabled, catchUp: schedule.catchUp,
    kind: schedule.plan.kind,
    minutes: schedule.plan.kind === 'interval' ? String(schedule.plan.minutes) : '60',
    time: schedule.plan.kind === 'daily' ? schedule.plan.time : '09:00',
  };
}

export function AutomationPage({ onOpenRaw, onOpenDraft, candidateFilter }: {
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  candidateFilter?: CandidateFilter;
}) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [schedules, setSchedules] = useState<AutomationList<AutomationSchedule> | null>(null);
  const [history, setHistory] = useState<AutomationList<AutomationRun> | null>(null);
  const [readErrors, setReadErrors] = useState({ status: '', schedules: '', history: '', detail: '' });
  const [refresh, setRefresh] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationRunStatus | ''>('');
  const [limit, setLimit] = useState(50);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AutomationRun | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const runTriggerRef = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<ReturnType<typeof createEditor> | null>(null);
  const [pauseConfirmation, setPauseConfirmation] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<{ area: string; message: string } | null>(null);

  useEffect(() => poll(async signal => {
    const [service, tasks] = await Promise.allSettled([automationStatus(signal), automationSchedules(signal)]);
    if (signal.aborted) return;
    if (service.status === 'fulfilled') setStatus(service.value);
    if (tasks.status === 'fulfilled') setSchedules(tasks.value);
    setReadErrors(current => ({
      ...current,
      status: service.status === 'rejected' ? describeError(service.reason) : '',
      schedules: tasks.status === 'rejected' ? describeError(tasks.reason) : '',
    }));
  }), [refresh]);
  useEffect(() => poll(async signal => {
    try {
      const runs = await automationRuns({ type: typeFilter, status: statusFilter, limit }, signal);
      if (!signal.aborted) {
        setHistory(runs);
        setReadErrors(current => ({ ...current, history: '' }));
      }
    } catch (error) {
      if (!signal.aborted) setReadErrors(current => ({ ...current, history: describeError(error) }));
    }
  }), [typeFilter, statusFilter, limit, refresh]);
  useEffect(() => {
    if (!selectedRunId) return;
    return poll(async signal => {
      try {
        const run = await automationRun(selectedRunId, signal);
        if (!signal.aborted) {
          setDetail(run);
          setReadErrors(current => ({ ...current, detail: '' }));
        }
      } catch (error) {
        if (!signal.aborted) setReadErrors(current => ({ ...current, detail: describeError(error) }));
      }
    });
  }, [selectedRunId, refresh]);
  useEffect(() => {
    if (!selectedRunId) return;
    detailHeading.current?.scrollIntoView?.({ block: 'nearest' });
    detailHeading.current?.focus();
  }, [selectedRunId]);

  const write = async (area: string, operation: (token: string) => Promise<void>) => {
    if (!status || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await operation(status.writeToken);
    } catch (error) {
      const conflict = area === 'editor' && error instanceof ApiError && error.status === 409;
      setActionError({ area, message: conflict ? '计划已被其他操作修改。你的输入已保留，可先核对最新计划。' : describeError(error) });
    } finally {
      setRefresh(value => value + 1);
      setPending(false);
    }
  };
  const chooseRun = (id: string, run: AutomationRun | null = null, trigger?: HTMLElement | null) => {
    const active = document.activeElement;
    runTriggerRef.current = trigger ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    if (id !== selectedRunId) setDetail(run);
    setSelectedRunId(id);
    setReadErrors(current => ({ ...current, detail: '' }));
  };
  const submitSchedule = (event: FormEvent, schedule: AutomationSchedule) => {
    event.preventDefault();
    if (!editor) return;
    void write('editor', async token => {
      await editAutomationSchedule(schedule.type, {
        revision: editor.revision,
        enabled: editor.enabled,
        catchUp: editor.catchUp,
        plan: editor.kind === 'interval'
          ? { kind: 'interval', minutes: Number(editor.minutes) }
          : { kind: 'daily', time: editor.time, timezone: 'Asia/Shanghai' },
      }, token);
      setEditor(null);
    });
  };
  const tasks = schedules?.items ?? [];
  const taskName = (type: string) => type === 'pipeline.organize' ? '资讯入库与整理' : tasks.find(task => task.type === type)?.name ?? type;
  const hasPipeline = tasks.some(task => task.type === 'news.daily');
  const showError = (area: string) => actionError?.area === area && <p className="form-error" role="alert">{actionError.message}</p>;
  const currentDetail = detail?.id === selectedRunId ? detail : null;

  return <div className="page automation-page">
    <div className="page-heading">
      <div><h1>自动化</h1><p className="subheading">仅在工作台进程运行时执行。关机或休眠期间错过的任务，启动后按计划设置最多补跑一次。</p></div>
      <button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>刷新</button>
    </div>

    <section className="panel automation-panel" aria-labelledby="automation-status">
      <div className="automation-heading">
        <div><h2 id="automation-status">调度状态</h2>
          {status && <p>{status.paused ? '全局暂停' : '任务可触发'} · {status.scheduler.healthy ? '调度器正常' : '调度器异常'}</p>}
        </div>
        {status && pauseConfirmation === null && <button className="secondary-button" disabled={pending} onClick={() => setPauseConfirmation(!status.paused)}>
          {status.paused ? '恢复全部自动化' : '暂停全部自动化'}
        </button>}
      </div>
      {readErrors.status && <p className="form-error" role="alert">调度状态读取失败：{readErrors.status}</p>}
      {!status && !readErrors.status && <p role="status">正在读取调度状态…</p>}
      {status && <>
        <dl className="automation-facts">
          <div><dt>下次运行（上海时间）</dt><dd>{automationTime(status.nextRunAt)}</dd></div>
          <div><dt>最近 24 小时失败</dt><dd>{status.failuresLast24Hours} 次</dd></div>
          <div><dt>工作台进程</dt><dd>{status.instance.mode === 'production' ? '生产' : '开发'} · PID {status.instance.pid} · 端口 {status.instance.port}</dd></div>
        </dl>
        {status.scheduler.error && <p className="form-error" role="alert">{status.scheduler.error}</p>}
      </>}
      {pauseConfirmation !== null && <div className="automation-confirm" role="group" aria-label="确认更改全局暂停设置">
        <p>{pauseConfirmation ? '暂停后，新触发会记录为跳过。正在运行的任务会继续。' : '恢复后按当前计划触发，暂停期间跳过的记录会保留。'}</p>
        <div className="automation-actions">
          <button className="primary-button" disabled={pending} onClick={() => void write('pause', async token => {
            setStatus(await changeAutomationPause(pauseConfirmation, token));
            setPauseConfirmation(null);
          })}>{pauseConfirmation ? '确认暂停' : '确认恢复'}</button>
          <button className="secondary-button" disabled={pending} onClick={() => { setPauseConfirmation(null); setActionError(null); }}>取消</button>
        </div>
      </div>}
      {showError('pause')}
    </section>

    {hasPipeline && <NewsInbox initialFilter={candidateFilter} token={status?.writeToken} paused={status?.paused}
      refresh={refresh} onOpenRaw={onOpenRaw} onOpenDraft={onOpenDraft} onOpenRun={(id, trigger) => chooseRun(id, null, trigger)} />}

    <section className="panel automation-panel" aria-labelledby="automation-tasks">
      <div className="automation-heading"><div><h2 id="automation-tasks">任务计划</h2><p>计划时间采用 Asia/Shanghai。</p></div></div>
      {readErrors.schedules && <p className="form-error" role="alert">任务计划读取失败：{readErrors.schedules}</p>}
      {!schedules && !readErrors.schedules && <p role="status">正在读取任务计划…</p>}
      {schedules?.issues?.map(issue => <p key={issue.file} className="form-error" role="alert">{issueLabels[issue.reason]}：{issue.file}</p>)}
      {schedules && !tasks.length && <p>暂无可调度任务。</p>}
      {showError('run')}
      {tasks.map(task => <article className="automation-task" key={task.type} aria-label={task.name}>
        <div className="automation-heading">
          <div><h3>{task.name}</h3><p>{task.enabled ? '已启用' : '已停用'} · {task.plan.kind === 'interval' ? `每 ${task.plan.minutes} 分钟` : `每天 ${task.plan.time}`} · {task.mayCallModel ? '可能调用模型' : '无需模型调用'}</p></div>
          <div className="automation-actions">
            <button className="secondary-button" disabled={pending} onClick={() => { setEditor(createEditor(task)); setActionError(null); }}>编辑计划</button>
            <button className="primary-button" disabled={pending || !status || Boolean(task.lastRun && isActive(task.lastRun.status))} onClick={event => {
              const trigger = event.currentTarget;
              void write('run', async token => {
                const run = await runAutomationTask(task.type, token);
                chooseRun(run.id, run, trigger);
              });
            }}>立即运行</button>
          </div>
        </div>
        <dl className="automation-facts">
          <div><dt>下次运行</dt><dd>{automationTime(task.nextRunAt)}</dd></div>
          <div><dt>补跑</dt><dd>{task.catchUp ? '已开启' : '已关闭'}</dd></div>
          <div><dt>最近结果</dt><dd>{task.lastRun ? <button className="text-button" onClick={event => chooseRun(task.lastRun!.id, null, event.currentTarget)}>{statusLabels[task.lastRun.status]} · {automationTime(task.lastRun.scheduledAt)}</button> : '暂无运行'}</dd></div>
        </dl>
        {editor?.type === task.type && <form className="automation-editor" aria-label="编辑计划" onSubmit={event => submitSchedule(event, task)}>
          <label className="automation-check"><input type="checkbox" checked={editor.enabled} disabled={pending} onChange={event => setEditor({ ...editor, enabled: event.target.checked })} />启用计划</label>
          <label className="automation-check"><input type="checkbox" checked={editor.catchUp} disabled={pending || !task.allowsCatchUp} onChange={event => setEditor({ ...editor, catchUp: event.target.checked })} />启动时补跑一次</label>
          <label>调度方式<select value={editor.kind} disabled={pending} onChange={event => setEditor({ ...editor, kind: event.target.value === 'daily' ? 'daily' : 'interval' })}><option value="interval">固定间隔</option><option value="daily">每天</option></select></label>
          {editor.kind === 'interval' ?
            <label>间隔分钟<input type="number" min="1" max="525600" step="1" required value={editor.minutes} disabled={pending} onChange={event => setEditor({ ...editor, minutes: event.target.value })} /></label> :
            <label>每天运行时间（上海时间）<input type="time" required value={editor.time} disabled={pending} onChange={event => setEditor({ ...editor, time: event.target.value })} /></label>}
          {showError('editor')}
          {editor.revision !== task.revision && <div className="automation-conflict">
            <p>当前计划已更新。重新读取会替换表单中的输入。</p>
            <button type="button" className="text-button" disabled={pending} onClick={() => { setEditor(createEditor(task)); setActionError(null); }}>读取最新版本</button>
          </div>}
          <div className="automation-actions">
            <button type="submit" className="primary-button" disabled={pending || !status || editor.revision !== task.revision}>保存计划</button>
            <button type="button" className="secondary-button" disabled={pending} onClick={() => { setEditor(null); setActionError(null); }}>取消编辑</button>
          </div>
        </form>}
      </article>)}
    </section>

    <section className="panel automation-panel" aria-labelledby="automation-history">
      <div className="automation-heading"><h2 id="automation-history">运行历史</h2></div>
      <div className="automation-filters">
        <label>任务<select value={typeFilter} onChange={event => { setHistory(null); setTypeFilter(event.target.value); }}>
          <option value="">全部任务</option>{tasks.map(task => <option key={task.type} value={task.type}>{task.name}</option>)}
          {hasPipeline && <option value="pipeline.organize">资讯入库与整理</option>}
        </select></label>
        <label>运行状态<select value={statusFilter} onChange={event => { setHistory(null); setStatusFilter(event.target.value as AutomationRunStatus | ''); }}>
          <option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>显示条数<select value={limit} onChange={event => { setHistory(null); setLimit(Number(event.target.value)); }}>
          {[20, 50, 100].map(count => <option key={count} value={count}>{count}</option>)}
        </select></label>
      </div>
      {readErrors.history && <p className="form-error" role="alert">运行历史读取失败：{readErrors.history}</p>}
      {!history && !readErrors.history && <p role="status">正在读取运行历史…</p>}
      {history?.issues?.map(issue => <p key={issue.file} className="form-error" role="alert">{issueLabels[issue.reason]}：{issue.file}</p>)}
      {history && !history.items.length && !history.issues?.length && <p>暂无符合筛选条件的运行记录。</p>}
      <ul className="automation-list">
        {history?.items.map(run => <li key={run.id}>
          <div><strong>{taskName(run.type)}</strong><p>{automationTime(run.scheduledAt)} · {triggerLabels[run.trigger]} · {statusLabels[run.status]}</p></div>
          <button className="secondary-button" disabled={pending} aria-pressed={selectedRunId === run.id} onClick={event => chooseRun(run.id, run, event.currentTarget)}>查看详情</button>
        </li>)}
      </ul>
    </section>

    {selectedRunId && <section className="panel automation-panel" aria-labelledby="automation-run-detail">
      <div className="automation-heading">
        <div><h2 id="automation-run-detail" tabIndex={-1} ref={detailHeading}>运行详情</h2>{currentDetail && <p>{taskName(currentDetail.type)} · {statusLabels[currentDetail.status]}</p>}</div>
        <div className="automation-actions">
          {currentDetail && !currentDetail.candidateId && isActive(currentDetail.status) && <button className="secondary-button" disabled={pending || !status} onClick={() => void write('cancel', async token => {
            setDetail(await cancelAutomationRun(currentDetail.id, token));
          })}>取消运行</button>}
          <button className="text-button" disabled={pending} onClick={() => {
            const trigger = runTriggerRef.current;
            runTriggerRef.current = null;
            setSelectedRunId(null);
            setDetail(null);
            if (trigger?.isConnected) trigger.focus();
          }}>关闭详情</button>
        </div>
      </div>
      {readErrors.detail && <p className="form-error" role="alert">运行详情读取失败：{readErrors.detail}</p>}
      {!currentDetail && !readErrors.detail && <p role="status">正在读取运行详情…</p>}
      {showError('cancel')}
      {currentDetail && <>
        {currentDetail.error && <p className="form-error">{runError(currentDetail.error)}</p>}
        <dl className="automation-facts">
          <div><dt>触发</dt><dd>{triggerLabels[currentDetail.trigger]} · {automationTime(currentDetail.scheduledAt)}</dd></div>
          <div><dt>开始</dt><dd>{automationTime(currentDetail.startedAt)}</dd></div>
          <div><dt>结束</dt><dd>{automationTime(currentDetail.endedAt)}</dd></div>
        </dl>
        <h3>步骤</h3>
        {!currentDetail.steps.length && <p>暂无步骤记录。</p>}
        <ol className="automation-list automation-steps">{currentDetail.steps.map((step, index) => <li key={index}>
          <div><strong>{step.name}</strong><p>{statusLabels[step.status]}{step.durationMs === null ? '' : ` · ${step.durationMs} 毫秒`}</p>
            {step.summary && <p>{step.summary}</p>}{step.error && <p className="form-error">{step.error}</p>}</div>
        </li>)}</ol>
        <h3>用量</h3>
        <dl className="automation-facts">
          {currentDetail.sourceRequests !== undefined && <div><dt>来源 HTTP 请求</dt><dd>{currentDetail.sourceRequests}</dd></div>}
          <div><dt>模型请求次数</dt><dd>{currentDetail.usage.requests}</dd></div>
          <div><dt>输入 Token</dt><dd>{currentDetail.usage.inputTokens}</dd></div>
          <div><dt>输出 Token</dt><dd>{currentDetail.usage.outputTokens}</dd></div>
          <div><dt>用量未知的请求</dt><dd>{currentDetail.usage.unknownUsageCount}</dd></div>
        </dl>
        <h3>产物</h3>
        {currentDetail.candidateId && <p>候选 {currentDetail.candidateId}</p>}
        <div className="automation-actions">
          {currentDetail.artifacts.rawIds.map(id => <button key={id} className="text-button" onClick={() => onOpenRaw(id)}>Raw {id}</button>)}
          {currentDetail.artifacts.draftIds.map(id => <button key={id} className="text-button" onClick={() => onOpenDraft(id)}>草稿 {id}</button>)}
          {currentDetail.artifacts.jobIds.map(id => <a key={id} href={`/api/extraction-jobs/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">任务 {id}</a>)}
          {!Object.values(currentDetail.artifacts).some(ids => ids.length > 0) && <p>无产物。</p>}
        </div>
      </>}
    </section>}
  </div>;
}

const candidateStages = {
  queued_raw: '等待保存 Raw', saving_raw: '正在保存 Raw', raw_failed: 'Raw 保存失败', queued_organize: '等待整理',
  organizing: '整理中', organize_failed: '整理失败', interrupted: '整理已中断', saved: '已入库', draft_ready: '草稿已生成',
};
const candidateViews: Array<[CandidateFilter, string]> = [
  ['all', '收件箱'], ['fetched', '已抓取'], ['pending', '待确认'], ['organizing', '整理中'], ['failed', '失败'], ['ignored', '已忽略'],
];
const evidenceLabel = (row: CandidateView) => row.item.evidenceKind === 'source_summary' ? '来源摘要（未核验原文）' : '来源正文摘录（非全文）';
const candidateScore = (row: CandidateView) => row.screening && 'score' in row.screening ? row.screening.score : undefined;
const canConfirm = (row: CandidateView) => !row.confirmation && !row.savedRawId && row.disposition !== 'ignored';
const isOrganizing = (row: CandidateView) => ['queued_raw', 'saving_raw', 'queued_organize', 'organizing'].some(phase => phase === row.execution?.phase);
const isFailed = (row: CandidateView) => row.saveIssue || (!row.draftPending && ['raw_failed', 'organize_failed', 'interrupted'].some(phase => phase === row.execution?.phase));

function NewsInbox({ initialFilter, token, paused, refresh, onOpenRaw, onOpenDraft, onOpenRun }: {
  initialFilter?: CandidateFilter; token?: string; paused?: boolean; refresh: number;
  onOpenRaw: (id: string) => void; onOpenDraft: (id: string) => void; onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
}) {
  const [date, setDate] = useState<string>();
  const [filter, setFilter] = useState<CandidateFilter>(initialFilter ?? 'all');
  const [candidates, setCandidates] = useState<CandidateList>();
  const [settings, setSettings] = useState<PipelineSettings>();
  const [settingsEdit, setSettingsEdit] = useState<(Omit<PipelineSettings, 'topics'> & { topics: string })>();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{ request: ConfirmCandidates; items: CandidateView[] }>();
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [readError, setReadError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [expandedLow, setExpandedLow] = useState(false);
  const inboxHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!initialFilter) return;
    setFilter(initialFilter);
    inboxHeading.current?.focus();
    inboxHeading.current?.scrollIntoView?.();
  }, [initialFilter]);
  useEffect(() => poll(async signal => {
    try {
      const result = await automationCandidates(date, signal);
      if (!signal.aborted) { setCandidates(result); setReadError(''); }
    } catch (error) {
      if (!signal.aborted) setReadError(describeError(error));
    }
  }), [date, refresh, revision]);
  useEffect(() => {
    const controller = new AbortController();
    void readPipelineSettings(controller.signal).then(value => {
      if (!controller.signal.aborted) { setSettings(value); setSettingsError(''); }
    }).catch(error => { if (!controller.signal.aborted) setSettingsError(describeError(error)); });
    return () => controller.abort();
  }, [refresh, revision]);

  const write = async (operation: (writeToken: string) => Promise<void>) => {
    if (!token || pending) return;
    setPending(true);
    setWriteError('');
    setAccepted(false);
    try { await operation(token); }
    catch (error) { setWriteError(describeError(error)); }
    finally { setPending(false); setRevision(value => value + 1); }
  };
  const begin = (items: CandidateView[]) => {
    setWriteError('');
    setAccepted(false);
    setConfirmation({ items, request: { requestId: crypto.randomUUID(), candidateIds: items.map(row => row.id), organize: true, mode: 'standard' } });
  };
  const changeEditor = (value: PipelineSettings) => {
    setWriteError('');
    setSettingsEdit({ ...value, topics: value.topics.join('\n') });
  };
  const applySettings = (event: FormEvent) => {
    event.preventDefault();
    if (!settingsEdit) return;
    void write(async writeToken => {
      const saved = await savePipelineSettings({ ...settingsEdit, topics: settingsEdit.topics.split(/\r?\n/u).map(topic => topic.trim()).filter(Boolean) }, writeToken);
      setSettings(saved);
      setSettingsEdit(undefined);
    });
  };
  const items = (candidates?.items ?? []).filter(row => {
    if (filter === 'fetched') return true;
    if (filter === 'ignored') return row.disposition === 'ignored';
    if (filter === 'pending') return canConfirm(row);
    if (filter === 'organizing') return isOrganizing(row);
    if (filter === 'failed') return isFailed(row);
    return row.disposition !== 'ignored';
  }).sort((a, b) => (candidateScore(b)?.relevance ?? -1) - (candidateScore(a)?.relevance ?? -1));
  const low = items.filter(row => candidateScore(row)?.relevance === 0);
  const visible = items.filter(row => candidateScore(row)?.relevance !== 0);
  const confirmableVisible = [...visible, ...(expandedLow ? low : [])].filter(canConfirm);
  const allConfirmableSelected = confirmableVisible.length > 0 && confirmableVisible.every(row => selected.includes(row.id));
  const batch = items.filter(row => selected.includes(row.id) && canConfirm(row) && (expandedLow || candidateScore(row)?.relevance !== 0));
  const renderCandidate = (row: CandidateView) => {
    const score = candidateScore(row);
    const phase = row.execution?.phase;
    const available = canConfirm(row);
    const screenError = row.screening && 'error' in row.screening ? row.screening.error : undefined;
    return <article className="news-candidate" key={row.id} aria-label={row.item.title}>
      <div className="automation-heading">
        <div>
          <h3>{row.item.title}</h3>
          <p>{row.section === 'fmcg' ? '快消研报' : 'AI 前沿'} · {row.item.sourceName} · {row.item.publishedAt ? row.item.publishedAt.slice(0, 10) : '未提供发布日期'} · {evidenceLabel(row)}</p>
        </div>
        {available && <label className="candidate-check"><input type="checkbox" aria-label={`选择 ${row.item.title}`} checked={selected.includes(row.id)}
          onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} />选择</label>}
      </div>
      <details><summary>展开摘录</summary><p className="candidate-excerpt">{row.item.excerpt}</p></details>
      {score ? <p><strong>AI 预筛，仅供参考 · 相关性 {score.relevance}/3</strong><br />
        {score.categories.join('、')} · 建议{score.suggestedMode === 'deep' ? '深度整理' : '标准整理'}<br />{score.reason}</p>
        : <p>未预筛{screenError && ` · ${screenError}`}</p>}
      {(row.disposition === 'later' || row.disposition === 'ignored') && <p>{row.disposition === 'later' ? '稍后处理' : '已忽略'}</p>}
      {phase && phase !== 'saved' && <p>{row.draftPending ? '草稿待审核' : candidateStages[phase]}</p>}
      {row.confirmation && !row.savedRawId && (phase === 'saved' || phase === 'draft_ready') && <p>原入库资料已缺失。</p>}
      {row.saveIssue && <p className="form-error">入库收据读取失败。</p>}
      {!row.draftPending && row.execution?.error && <p className="form-error">{row.execution.error}</p>}
      <div className="automation-actions">
        {available && <>
          <button className="primary-button" disabled={pending || !token} onClick={() => begin([row])}>确认入库</button>
          {row.disposition !== 'later' && <button className="secondary-button" disabled={pending || !token}
            onClick={() => void write(value => changeCandidateDisposition(row.id, 'later', value).then(() => undefined))}>稍后</button>}
          <button className="text-button" disabled={pending || !token}
            onClick={() => void write(value => changeCandidateDisposition(row.id, 'ignore', value).then(() => undefined))}>忽略</button>
        </>}
        {!row.confirmation && !row.savedRawId && row.disposition !== 'inbox' && <button className="secondary-button" disabled={pending || !token}
          onClick={() => void write(value => changeCandidateDisposition(row.id, 'restore', value).then(() => undefined))}>恢复到收件箱</button>}
        {row.savedRawId && <button className="text-button" onClick={() => onOpenRaw(row.savedRawId!)}>已入库 · 打开 Raw</button>}
        {row.draftPending && row.execution?.draftId && <button className="secondary-button" onClick={() => onOpenDraft(row.execution!.draftId!)}>审核草稿</button>}
        {!row.draftPending && (phase === 'raw_failed' || phase === 'organize_failed' || phase === 'interrupted') &&
          <button className="secondary-button" disabled={pending || !token}
            onClick={() => void write(value => retryCandidate(row.id, phase === 'raw_failed' ? 'save' : 'organize', value).then(() => undefined))}>
            {phase === 'raw_failed' ? '重试保存 Raw' : phase === 'interrupted' ? '继续整理' : '重试整理'}
          </button>}
        {row.execution && phase !== 'queued_raw' && phase !== 'queued_organize' && <button className="text-button" onClick={event => onOpenRun(row.execution!.runId, event.currentTarget)}>查看运行</button>}
      </div>
    </article>;
  };

  return <section id="news-candidates" className="panel automation-panel" aria-labelledby="news-candidate-title">
    <div className="automation-heading">
      <div><h2 id="news-candidate-title" ref={inboxHeading} tabIndex={-1}>资讯候选收件箱</h2>
        <p>{paused ? '全局暂停。已确认条目将在恢复后继续排队执行。' : '确认后才保存 Raw。AI 草稿需要人工审核。'}</p>
      </div>
      {settings && !settingsEdit && <button className="secondary-button" onClick={() => changeEditor(settings)}>流水线设置</button>}
    </div>
    {settingsError && <p className="form-error" role="alert">{settingsError}</p>}
    {settingsEdit && <form className="automation-editor" aria-label="流水线设置" onSubmit={applySettings}>
      <label className="automation-check"><input type="checkbox" checked={settingsEdit.preScreenEnabled} disabled={pending}
        onChange={event => setSettingsEdit({ ...settingsEdit, preScreenEnabled: event.target.checked })} />启用 AI 预筛</label>
      <label>整理并发数<select value={settingsEdit.concurrency} disabled={pending}
        onChange={event => setSettingsEdit({ ...settingsEdit, concurrency: Number(event.target.value) })}>
        {[1, 2, 3, 4].map(count => <option key={count}>{count}</option>)}
      </select></label>
      <label className="candidate-topics">关注主题（每行一条，最多 20 条，每条最多 80 字）
        <textarea rows={4} value={settingsEdit.topics} disabled={pending} onChange={event => setSettingsEdit({ ...settingsEdit, topics: event.target.value })} />
      </label>
      {settings && settingsEdit.revision !== settings.revision && <div className="automation-conflict">
        <p>已有更新的设置。当前输入保留。</p><button type="button" className="text-button" onClick={() => changeEditor(settings)}>加载最新设置</button>
      </div>}
      <div className="automation-actions"><button className="primary-button" disabled={pending || !token || settings?.revision !== settingsEdit.revision}>保存流水线设置</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => { setSettingsEdit(undefined); setWriteError(''); }}>取消</button></div>
    </form>}
    <div className="automation-filters">
      <label>资讯日期<select value={date ?? ''} onChange={event => {
        setDate(event.target.value || undefined); setCandidates(undefined); setSelected([]); setExpandedLow(false);
      }}><option value="">今日</option>{candidates?.dates.map(day => <option key={day}>{day}</option>)}
      {date && !candidates?.dates.includes(date) && <option>{date}</option>}</select></label>
      <label>候选状态<select value={filter} onChange={event => { setFilter(event.target.value as CandidateFilter); setSelected([]); setExpandedLow(false); }}>
        {candidateViews.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {confirmableVisible.length > 0 && <button type="button" className="secondary-button" disabled={pending || !token}
        onClick={() => setSelected(current => allConfirmableSelected
          ? current.filter(id => !confirmableVisible.some(row => row.id === id))
          : [...new Set([...current, ...confirmableVisible.map(row => row.id)])]
        )}>{allConfirmableSelected ? '取消全选' : `全选可确认项（${confirmableVisible.length} 条）`}</button>}
      {batch.length > 0 && <button className="primary-button" disabled={pending || !token} onClick={() => begin(batch)}>批量确认入库（{batch.length} 条）</button>}
    </div>
    {readError && <p className="form-error" role="alert">收件箱读取失败 · {readError}</p>}
    {!candidates && !readError && <p role="status">正在读取资讯候选…</p>}
    {writeError && !confirmation && <p className="form-error" role="alert">{writeError}</p>}
    {accepted && <p role="status">入库已排队。可在收件箱查看每条进度。</p>}
    {candidates && <p>{candidates.date} · {items.length} 条</p>}
    {candidates && !items.length && <p>此日期暂无符合条件的资讯候选。</p>}
    {visible.map(renderCandidate)}
    {low.length > 0 && <details className="candidate-low" open={expandedLow} onToggle={event => setExpandedLow(event.currentTarget.open)}>
      <summary>低相关性（{low.length} 条）</summary>{low.map(renderCandidate)}
    </details>}
    {confirmation && <CandidateConfirmation value={confirmation} pending={pending} error={writeError}
      onChange={request => setConfirmation({ ...confirmation, request })}
      onClose={() => { setConfirmation(undefined); setWriteError(''); }}
      onConfirm={() => void write(async writeToken => {
        await confirmCandidates(confirmation.request, writeToken);
        setConfirmation(undefined);
        setSelected([]);
        setAccepted(true);
      })} />}
  </section>;
}

function CandidateConfirmation({ value, pending, error, onChange, onClose, onConfirm }: {
  value: { request: ConfirmCandidates; items: CandidateView[] }; pending: boolean; error: string;
  onChange: (request: ConfirmCandidates) => void; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useDialogFocus<HTMLDivElement>();
  const { request, items } = value;
  return <div className="candidate-modal">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="candidate-confirm-title" className="panel candidate-dialog"
      onKeyDown={event => { if (event.key === 'Escape' && !pending) onClose(); }}>
      <h2 id="candidate-confirm-title">确认入库（{items.length} 条）</h2>
      <ul>{items.map(row => <li key={row.id}><strong>{row.item.title}</strong><br />{evidenceLabel(row)}</li>)}</ul>
      <label className="candidate-check"><input type="checkbox" disabled={pending} checked={request.organize}
        onChange={event => onChange({ ...request, organize: event.target.checked })} />确认后自动整理</label>
      {request.organize && <label className="candidate-mode">整理模式<select value={request.mode} disabled={pending}
        onChange={event => onChange({ ...request, mode: event.target.value as ConfirmCandidates['mode'] })}>
        <option value="standard">标准整理</option><option value="deep">深度整理</option>
      </select></label>}
      <p>{request.organize ? '确认即授权保存所列来源材料并发起一次 AI 整理，产生的草稿等待人工审核。' : '确认后仅保存所列来源材料到 Raw。'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="automation-actions">
        <button className="primary-button" disabled={pending} onClick={onConfirm}>{pending ? '正在提交…' : '确认并入库'}</button>
        <button className="secondary-button" data-autofocus disabled={pending} onClick={onClose}>取消</button>
      </div>
    </div>
  </div>;
}
