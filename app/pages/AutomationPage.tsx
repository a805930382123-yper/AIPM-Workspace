import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AutomationList, AutomationRun, AutomationRunStatus, AutomationSchedule, AutomationStatus,
} from '../api';
import {
  ApiError, automationRun, automationRuns, automationSchedules, automationStatus, automationTime,
  cancelAutomationRun, changeAutomationPause, editAutomationSchedule, runAutomationTask,
} from '../api';
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

export function AutomationPage({ onOpenRaw, onOpenDraft }: {
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
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
  useEffect(() => { if (selectedRunId) detailHeading.current?.focus(); }, [selectedRunId]);

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
  const chooseRun = (id: string, run: AutomationRun | null = null) => {
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
  const taskName = (type: string) => tasks.find(task => task.type === type)?.name ?? type;
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
            <button className="primary-button" disabled={pending || !status || Boolean(task.lastRun && isActive(task.lastRun.status))} onClick={() => void write('run', async token => {
              const run = await runAutomationTask(task.type, token);
              chooseRun(run.id, run);
            })}>立即运行</button>
          </div>
        </div>
        <dl className="automation-facts">
          <div><dt>下次运行</dt><dd>{automationTime(task.nextRunAt)}</dd></div>
          <div><dt>补跑</dt><dd>{task.catchUp ? '已开启' : '已关闭'}</dd></div>
          <div><dt>最近结果</dt><dd>{task.lastRun ? <button className="text-button" onClick={() => chooseRun(task.lastRun!.id)}>{statusLabels[task.lastRun.status]} · {automationTime(task.lastRun.scheduledAt)}</button> : '暂无运行'}</dd></div>
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
          <button className="secondary-button" disabled={pending} aria-pressed={selectedRunId === run.id} onClick={() => chooseRun(run.id, run)}>查看详情</button>
        </li>)}
      </ul>
    </section>

    {selectedRunId && <section className="panel automation-panel" aria-labelledby="automation-run-detail">
      <div className="automation-heading">
        <div><h2 id="automation-run-detail" tabIndex={-1} ref={detailHeading}>运行详情</h2>{currentDetail && <p>{taskName(currentDetail.type)} · {statusLabels[currentDetail.status]}</p>}</div>
        <div className="automation-actions">
          {currentDetail && isActive(currentDetail.status) && <button className="secondary-button" disabled={pending || !status} onClick={() => void write('cancel', async token => {
            setDetail(await cancelAutomationRun(currentDetail.id, token));
          })}>取消运行</button>}
          <button className="text-button" disabled={pending} onClick={() => { setSelectedRunId(null); setDetail(null); }}>关闭详情</button>
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
          <div><dt>请求次数</dt><dd>{currentDetail.usage.requests}</dd></div>
          <div><dt>输入 Token</dt><dd>{currentDetail.usage.inputTokens}</dd></div>
          <div><dt>输出 Token</dt><dd>{currentDetail.usage.outputTokens}</dd></div>
          <div><dt>用量未知的请求</dt><dd>{currentDetail.usage.unknownUsageCount}</dd></div>
        </dl>
        <h3>产物</h3>
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
