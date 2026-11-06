import { useEffect, useRef, useState, type ReactNode } from 'react';
import { startWorkAnalysis, workAnalysisRuns, type Raw, type WorkAnalysisRun, type WorkItem } from '../api';

const runLabels: Record<WorkAnalysisRun['status'], string> = { running: '分析中', completed: '待确认草稿', failed: '分析失败', interrupted: '已中断' };
const runTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' });
const resultLimit = 20_000;

export function WorkAnalysisPanel({ item, rawById, busy, saveStage, stageNotice }: {
  item: Extract<WorkItem, { kind: 'product_analysis' }>;
  rawById: ReadonlyMap<string, Raw>;
  busy: boolean;
  saveStage: (body: string, analysisRunId: string | undefined, onSaved: () => void) => void;
  stageNotice: ReactNode;
}) {
  const [runs, setRuns] = useState<WorkAnalysisRun[] | null>(null);
  const [readError, setReadError] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string>();
  const [stageBody, setStageBody] = useState('');
  const [stageRunId, setStageRunId] = useState<string>();
  const stageEditor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const list = await workAnalysisRuns(item.id);
        if (!active) return;
        setRuns(list);
        setReadError('');
        if (list.some(run => run.status === 'running')) timer = setTimeout(() => void read(), 1200);
      } catch (error) {
        if (active) setReadError(error instanceof Error ? error.message : '无法读取分析记录。');
      }
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [item.id, reload]);

  const rawIds = chosen.filter(id => item.rawIds.includes(id) && rawById.has(id) && !rawById.get(id)?.origin);
  const running = starting || Boolean(runs?.some(run => run.status === 'running'));
  const canStart = !busy && !running && !readError && runs !== null && item.status !== 'closed' && rawIds.length > 0;

  const launch = async () => {
    setLaunchError('');
    setStarting(true);
    try {
      const run = await startWorkAnalysis(item.id, { baseRevision: item.revision, rawIds });
      setOpenId(run.id);
      setChosen([]);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : '未能启动本轮分析。');
    } finally {
      setStarting(false);
      setReload(value => value + 1);
    }
  };

  return <>
    <section className="panel work-section" aria-labelledby="work-analysis">
      <div className="work-section-heading"><h2 id="work-analysis">AI 分析</h2></div>
      <form className="work-form" onSubmit={event => { event.preventDefault(); if (canStart) void launch(); }}>
        <p className="work-note">本轮会把选中的 Raw 原文和已保存的分析内容发送给设置中的模型。修改过分析目标或口径时，请先保存当前情况。</p>
        {item.rawIds.length === 0 ? <p className="work-note">在「资料与成果」中关联 Raw，再选择本轮材料。</p>
          : <fieldset className="work-source-picker" disabled={running || item.status === 'closed'}>
            <legend>本轮资料</legend>
            <p className="work-note">请选择 1 至 8 条 Raw，原文合计最多 128 KiB。</p>
            {item.rawIds.map(id => {
              const raw = rawById.get(id);
              const checked = rawIds.includes(id);
              return <label className="work-source-option" key={id}>
                <input type="checkbox" checked={checked} disabled={!raw || !!raw.origin || (!checked && rawIds.length >= 8)}
                  onChange={event => setChosen(event.target.checked ? [...rawIds, id] : rawIds.filter(value => value !== id))} />
                <span>{raw?.title ?? 'Raw 来源不可用'}{raw?.origin && <small>仅可在本机查看</small>}</span>
              </label>;
            })}
          </fieldset>}
        <div className="work-buttons"><button className="primary-button" disabled={!canStart}>{running ? '分析中…' : '发起分析'}</button></div>
        {running && <p className="work-note" role="status">可以离开此页，回来后在原事项查看这轮结果。</p>}
        {item.status === 'closed' && <p className="work-note">重开事项后可发起新一轮分析。</p>}
        {launchError && <p className="form-error" role="alert">{launchError}</p>}
      </form>
      <div className="work-subsection">
        <div className="work-section-heading"><h3>分析记录</h3>
          <button className="text-button" onClick={() => setReload(value => value + 1)}>刷新分析记录</button>
        </div>
        {readError && <p className="form-error" role="alert">{readError}</p>}
        {!readError && runs === null && <p className="work-note" role="status">正在读取分析记录…</p>}
        {runs?.length === 0 && <p className="work-note">暂无分析记录。每轮结果都会保存在这条事项中。</p>}
        {runs?.map((run, index) => {
          const expanded = openId === run.id;
          const output = run.output;
          return <article className="work-run" key={run.id}>
            <button className="work-list-row work-run-button" aria-expanded={expanded} aria-controls={`analysis-${run.id}`}
              onClick={() => setOpenId(expanded ? undefined : run.id)}>
              <span className="work-list-title">第 {runs.length - index} 轮 · {runTime.format(new Date(run.startedAt))}</span>
              <span className={`work-status ${run.error ? 'action-warning' : 'action-review'}`}>{runLabels[run.status]}</span>
            </button>
            <div className="work-run-detail" id={`analysis-${run.id}`} hidden={!expanded}>
              {expanded && <>
                <details className="work-run-input">
                  <summary>输入快照 · {run.input.sources.length} 条 Raw</summary>
                  <dl className="work-run-context">
                    <dt>分析目标</dt><dd>{run.input.goal}</dd>
                    <dt>数据范围与口径</dt><dd>{run.input.dataScope || '未填写'}</dd>
                    <dt>已确认结论</dt><dd>{run.input.confirmedConclusions || '未填写'}</dd>
                    <dt>未解问题</dt><dd>{run.input.openQuestions || '未填写'}</dd>
                  </dl>
                  {run.input.sources.map(source => <details className="work-run-source" key={source.rawId}>
                    <summary>{source.title} · 本轮原文</summary>
                    <p className="work-prose">{source.body}</p>
                  </details>)}
                </details>
                {run.error && <p className="form-error">{run.error.message}</p>}
                {output && <>
                  <h4>观察与原文依据</h4>
                  {output.observations.length === 0 ? <p className="work-note">本轮没有形成可核对的观察。</p>
                    : <ul className="work-run-results">{output.observations.map(({ observation, quote, rawId }, index) => <li key={index}>
                      <p className="work-prose">{observation}</p>
                      <p className="work-note">{run.input.sources.find(source => source.rawId === rawId)?.title} · 原文</p>
                      <blockquote className="work-prose">{quote}</blockquote>
                    </li>)}</ul>}
                  <h4>建议</h4>
                  {output.suggestions.length ? <ul className="work-run-results">{output.suggestions.map((text, index) => <li key={index} className="work-prose">{text}</li>)}</ul>
                    : <p className="work-note">本轮没有给出建议。</p>}
                  <h4>待核问题</h4>
                  {output.openQuestions.length ? <ul className="work-run-results">{output.openQuestions.map((text, index) => <li key={index} className="work-prose">{text}</li>)}</ul>
                    : <p className="work-note">本轮没有新增待核问题。</p>}
                  <div className="work-buttons work-stage-actions">
                    <button className="secondary-button" disabled={busy || Boolean(stageBody.trim())} onClick={() => {
                      const observations = output.observations.map(({ observation, quote, rawId }) => {
                        const title = run.input.sources.find(source => source.rawId === rawId)?.title;
                        return `- ${observation}\n  ${title}：${quote}`;
                      });
                      const sections = [
                        observations.length && ['观察与原文依据', ...observations].join('\n'),
                        output.suggestions.length && ['建议', ...output.suggestions.map(text => `- ${text}`)].join('\n'),
                        output.openQuestions.length && ['待核问题', ...output.openQuestions.map(text => `- ${text}`)].join('\n'),
                      ];
                      setStageBody(sections.filter(Boolean).join('\n\n'));
                      setStageRunId(run.id);
                      stageEditor.current?.focus();
                    }}>带入阶段成果</button>
                    {stageBody.trim() && <p className="work-note">保存或清空正在编辑的阶段成果后，可带入另一轮草稿。</p>}
                  </div>
                </>}
              </>}
            </div>
          </article>;
        })}
      </div>
    </section>
    <section className="panel work-section" aria-labelledby="work-stage">
      <div className="work-section-heading"><h2 id="work-stage">阶段成果</h2></div>
      <ul className="work-history-list">{item.history.map((entry, index) => <li key={`${entry.at}:${index}`}>
        <div><h3>{entry.kind === 'stage_result' ? '阶段成果' : entry.kind === 'closed' ? '完成事项' : '重开事项'}</h3>
          <time dateTime={entry.at}>{runTime.format(new Date(entry.at))}</time></div>
        {entry.kind === 'stage_result' && entry.analysisRunId && <p className="work-note">
          取自 AI 分析
          <button className="text-button" onClick={() => {
            setOpenId(entry.analysisRunId);
            document.getElementById('work-analysis')?.scrollIntoView();
          }}>查看该轮分析</button>
        </p>}
        <p className="work-prose">{entry.body}</p>
      </li>)}</ul>
      <form onSubmit={event => {
        event.preventDefault();
        if (stageBody.trim() && stageBody.length <= resultLimit) saveStage(stageBody, stageRunId, () => {
          setStageBody('');
          setStageRunId(undefined);
        });
      }}>
        <fieldset className="work-form" disabled={busy}>
          <p className="work-note">可手工填写，也可带入分析草稿后编辑。已确认结论请在「当前情况」单独保存。</p>
          <div className="field"><label htmlFor="work-stage-body">阶段成果正文</label><textarea id="work-stage-body" ref={stageEditor} required maxLength={resultLimit} rows={5} value={stageBody} onChange={event => {
            setStageBody(event.target.value);
            if (!event.target.value.trim()) setStageRunId(undefined);
          }} /></div>
          {stageRunId && <p className="work-note">保存时将保留本轮分析引用。</p>}
          {stageBody.length > resultLimit && <p className="form-error" role="alert">请将阶段成果缩短至 20000 字以内。</p>}
          <div className="work-buttons"><button className="secondary-button" disabled={!stageBody.trim() || stageBody.length > resultLimit}>保存阶段成果</button></div>
        </fieldset>
      </form>
      {stageNotice}
    </section>
  </>;
}
