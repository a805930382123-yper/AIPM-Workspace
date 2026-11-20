import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, startWorkAnalysis, startWorkBasisReview, workAnalysisRuns, type Raw, type WorkAnalysisOutputV2, type WorkAnalysisRun, type WorkAnalysisRunWithReview, type WorkItem } from '../api';

const runLabels: Record<WorkAnalysisRun['status'], string> = { running: '分析中', completed: '待确认草稿', failed: '分析失败', interrupted: '已中断' };
const runTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' });
const resultLimit = 20_000;
const questionLimit = 2000;
const stageSource = (assisted: boolean) => assisted ? '带入 AI 草稿后保存' : '人工填写';

function AnalysisContext({ input, showQuestion }: { input: Omit<WorkAnalysisRun['input'], 'sources' | 'stageContext'>; showQuestion?: boolean }) {
  return <dl className="work-run-context">
    <dt>分析目标</dt><dd>{input.goal}</dd>
    <dt>数据范围与口径</dt><dd>{input.dataScope || '未填写'}</dd>
    <dt>已确认结论</dt><dd>{input.confirmedConclusions || '未填写'}</dd>
    <dt>未解问题</dt><dd>{input.openQuestions || '未填写'}</dd>
    {showQuestion && <><dt>本轮问题</dt><dd>{input.roundQuestion || '未填写'}</dd></>}
  </dl>;
}

function AnalysisThemes({ output, runId }: { output: WorkAnalysisOutputV2; runId: string }) {
  const links = (indexes: number[]) => <span className="work-evidence-links">
    {indexes.map(index => <a key={index} href={`#observation-${runId}-${index}`}>观察 {index + 1}</a>)}
  </span>;
  return <>
    <h4 id={`work-round-summary-${runId}`}>本轮摘要</h4>
    <p className="work-prose">{output.roundSummary}</p>
    <h4>主题分析</h4>
    {output.themes.map(({ title, conclusion, evidence, counterEvidence, openQuestions, nextSteps, confirmedConflict }, index) =>
      <section className="work-analysis-theme" key={index} aria-labelledby={`work-theme-${runId}-${index}`}>
        <h5 id={`work-theme-${runId}-${index}`}>{title}</h5>
        <p className="work-prose" id={`work-conclusion-${runId}-${index}`}><strong>{conclusion?.kind === 'evidence_supported' ? 'AI 标注：有支持材料（待核对）' : conclusion ? '待验证假设' : '待验证'}</strong>
          {conclusion ? `：${conclusion.text}` : '：现有资料不足以形成结论。'}</p>
        {conclusion?.kind === 'evidence_supported' && <p className="work-note">支持材料不代表同主题每个案例均已证实；证据不足的判断仍待核实。</p>}
        <dl className="work-theme-evidence">
          <dt>支持证据</dt><dd>{evidence.length ? links(evidence) : '本轮未找到支持证据'}</dd>
          <dt>反例</dt><dd>{counterEvidence.length ? links(counterEvidence) : '本轮未发现反例'}</dd>
        </dl>
        {openQuestions.length > 0 && <><h6>待核问题</h6><ul className="work-run-results">
          {openQuestions.map((question, i) => <li className="work-prose" key={i}>{question}</li>)}
        </ul></>}
        {nextSteps.length > 0 && <><h6>建议下一步</h6><ul className="work-run-results">
          {nextSteps.map((step, i) => <li className="work-prose" key={i}>{step}</li>)}
        </ul></>}
        {confirmedConflict && <div className="work-theme-conflict">
          <h6>与已确认结论冲突</h6>
          <blockquote className="work-prose">{confirmedConflict.confirmedQuote}</blockquote>
          {links(confirmedConflict.observationIndexes)}
          <p className="work-prose">建议修订：{confirmedConflict.suggestedRevision}</p>
          <p className="work-note">如需修改已确认结论，请在「当前情况」核对并保存。</p>
        </div>}
      </section>
    )}
  </>;
}

function showSource(runId: string, rawId: string) {
  const source = document.getElementById(`work-source-${runId}-${rawId}`) as HTMLDetailsElement | null;
  if (!source) return;
  (source.parentElement as HTMLDetailsElement).open = true;
  source.open = true;
  source.querySelector('summary')?.focus();
}

function WorkBasisReviewPanel({ run, round, onReviewChanged }: {
  run: WorkAnalysisRunWithReview;
  round: number;
  onReviewChanged: (review?: Awaited<ReturnType<typeof startWorkBasisReview>>) => void;
}) {
  const [preview, setPreview] = useState<string | null>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const review = run.basisReview;
  const retry = review?.status === 'failed' || review?.status === 'interrupted' ? review.reviewId : undefined;
  const mayStart = !review || retry !== undefined;
  const showPreview = mayStart && preview === (retry ?? null);
  const inProgress = pending || review?.status === 'running';
  const output = run.output!;
  const decisionLabels = { supported: '有依据', unsupported: '依据不支持', uncertain: '证据不足' };

  useEffect(() => { if (showPreview) previewHeading.current?.focus(); }, [showPreview]);

  const launch = async () => {
    setPending(true);
    setError('');
    let updated: Awaited<ReturnType<typeof startWorkBasisReview>> | undefined;
    try {
      updated = await startWorkBasisReview(run.itemId, run.id, retry);
      setPreview(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setPreview(undefined);
      setError(error instanceof Error ? error.message : '未能启动检查。');
    } finally {
      onReviewChanged(updated);
      setPending(false);
    }
  };

  return <section className="work-basis-review" aria-labelledby={`work-review-${run.id}`}>
    <h4 id={`work-review-${run.id}`}>模型复核</h4>
    <p className="work-note">核对草稿的依据和证据强度，复核意见由你确认。</p>
    {inProgress && <p className="work-note" role="status">正在检查分析依据…</p>}
    {review && 'provider' in review && <p className="work-note work-prose">第 {review.attempt} 次检查 · {review.provider.model}</p>}
    {review?.status === 'failed' && <p className="form-error" role="alert">检查失败。{review.error.message}</p>}
    {review?.status === 'interrupted' && <p className="form-error" role="alert">{review.error.message}</p>}
    {review?.status === 'unavailable' && <p className="form-error" role="alert">{review.error.message}</p>}
    {review?.status === 'completed' && <>
      <p className="work-review-summary">{review.result.checks.every(check => check.decision === 'supported')
        ? '模型未发现依据问题' : '模型发现依据问题或仍需核对的判断'}</p>
      <ul className="work-review-checks">
        {review.result.checks.map(({ target, decision, reason, evidence }) => {
          const index = Number(target.split('.')[1]);
          const title = target === 'scope' ? '反例、口径与事实范围' : target === 'roundSummary' ? '本轮摘要'
            : target.startsWith('observations.') ? `观察 ${index + 1}`
            : `主题结论 · ${'themes' in output ? output.themes[index].title : ''}`;
          const anchor = target === 'scope' ? undefined : target === 'roundSummary' ? `work-round-summary-${run.id}`
            : target.startsWith('observations.') ? `observation-${run.id}-${index}` : `work-conclusion-${run.id}-${index}`;
          return <li key={target}>
            <div className="work-review-check-heading">
              {anchor ? <a href={`#${anchor}`}>{title}</a> : <strong>{title}</strong>}
              <span className={`work-status ${decision === 'supported' ? 'action-review' : 'action-warning'}`}>{decisionLabels[decision]}</span>
            </div>
            <p className="work-prose">{reason}</p>
            {evidence.map(({ rawId, quote }, index) => <blockquote className="work-prose" key={index}>
              <p>{quote}</p>
              <button className="text-button" type="button" onClick={() => showSource(run.id, rawId)}>
                {run.input.sources.find(source => source.rawId === rawId)?.title} · 查看本轮原文
              </button>
            </blockquote>)}
          </li>;
        })}
      </ul>
    </>}
    {showPreview && <section className="work-analysis-preview" aria-labelledby={`work-review-preview-${run.id}`}>
      <h5 id={`work-review-preview-${run.id}`} tabIndex={-1} ref={previewHeading}>依据检查发送预览 · 第 {round} 轮</h5>
      <p className="work-note">会把这轮当时实际发送的文本及其<a href={`#work-original-output-${run.id}`}>原分析草稿</a>发给当前设置中的模型，可能与原模型相同。</p>
      <AnalysisContext input={run.input} showQuestion={run.outputVersion === 2} />
      {run.input.stageContext && <details className="work-run-source">
        <summary>原承接阶段成果 · {stageSource(run.input.stageContext.source === 'ai_assisted')}</summary>
        <p className="work-prose">{run.input.stageContext.body}</p>
      </details>}
      <h5>原输入资料 · {run.input.sources.length} 条 Raw</h5>
      {run.input.sources.map(source => <details className="work-run-source" key={source.rawId}>
        <summary>{source.title} · 原输入全文</summary><p className="work-prose">{source.body}</p>
      </details>)}
      <div className="work-buttons">
        <button className="primary-button" type="button" disabled={inProgress} onClick={() => void launch()}>开始检查</button>
        <button className="text-button" type="button" disabled={inProgress} onClick={() => { setPreview(undefined); setError(''); }}>取消</button>
      </div>
    </section>}
    {mayStart && !showPreview && !inProgress && <div className="work-buttons">
      <button className="secondary-button" type="button" onClick={() => { setError(''); setPreview(retry ?? null); }}>
        {retry ? '重新检查' : '检查分析依据'}
      </button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function stageDraft(run: WorkAnalysisRun, output: NonNullable<WorkAnalysisRun['output']>) {
  const list = (title: string, values: string[]) => values.length ? [title, ...values.map(value => `- ${value}`)].join('\n') : '';
  if ('roundSummary' in output) {
    const questions = [...new Set([...output.themes.flatMap(theme => theme.openQuestions), ...output.openQuestions])];
    const conflicts = output.themes.flatMap(theme => theme.confirmedConflict ? [theme.confirmedConflict] : []);
    const shorten = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;
    return [
      `AI 草稿，待确认\n\n本轮摘要（待确认）\n${output.roundSummary}`,
      list('待核问题', questions.slice(0, 2).map(question => shorten(question, 120))),
      questions.length > 2 ? `其余 ${questions.length - 2} 条待核问题见原分析。` : '',
      conflicts.length ? `与已确认结论存在 ${conflicts.length} 处冲突。首条建议修订：${shorten(conflicts[0].suggestedRevision, 160)}\n请在原分析逐项核对，不改变已确认结论。` : '',
      '完整证据、反例与其他建议见原分析。',
    ].filter(Boolean).join('\n\n');
  }
  const observations = output.observations.map(({ observation, quote, rawId }, index) => {
    const title = run.input.sources.find(source => source.rawId === rawId)?.title;
    return `观察 ${index + 1}：${observation}\n  ${title}：${quote}`;
  });
  return [list('观察与原文依据', observations), list('建议', output.suggestions), list('待核问题', output.openQuestions)]
    .filter(Boolean).join('\n\n');
}

export function WorkAnalysisPanel({ item, focusMaterials, rawById, busy, analysisDirty, reloadItem, analysisNotice, saveStage, stageNotice }: {
  item: Extract<WorkItem, { kind: 'product_analysis' }>;
  focusMaterials?: boolean;
  rawById: ReadonlyMap<string, Raw>;
  busy: boolean;
  analysisDirty: boolean;
  reloadItem: () => Promise<void>;
  analysisNotice: ReactNode;
  saveStage: (body: string, analysisRunId: string | undefined, onSaved: () => void) => void;
  stageNotice: ReactNode;
}) {
  const [runs, setRuns] = useState<WorkAnalysisRunWithReview[] | null>(null);
  const [readError, setReadError] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [stageIndex, setStageIndex] = useState<number>();
  const [previewRevision, setPreviewRevision] = useState<number>();
  const [staleRevision, setStaleRevision] = useState<number>();
  const [openId, setOpenId] = useState<string>();
  const [stageBody, setStageBody] = useState('');
  const [stageRunId, setStageRunId] = useState<string>();
  const stageEditor = useRef<HTMLTextAreaElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const materialsHeading = useRef<HTMLLegendElement>(null);

  useEffect(() => {
    if (focusMaterials) materialsHeading.current?.focus();
  }, [focusMaterials]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const list = await workAnalysisRuns(item.id);
        if (!active) return;
        setRuns(list);
        setReadError('');
        if (list.some(run => run.status === 'running' || run.basisReview?.status === 'running')) timer = setTimeout(() => void read(), 1200);
      } catch (error) {
        if (active) setReadError(error instanceof Error ? error.message : '无法读取分析记录。');
      }
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [item.id, reload]);

  const rawIds = chosen.filter(id => item.rawIds.includes(id) && rawById.has(id) && !rawById.get(id)?.origin);
  const stages = item.history.flatMap((entry, index) => entry.kind === 'stage_result' ? [{ entry, index }] : []);
  const selectedStage = stageIndex === undefined ? undefined : stages.find(({ index }) => index === stageIndex)?.entry;
  const needsReload = staleRevision === item.revision;
  const showPreview = previewRevision === item.revision;
  const running = starting || Boolean(runs?.some(run => run.status === 'running'));
  const completed = runs?.filter(run => run.status === 'completed') ?? [];
  const usedRawIds = new Set(completed.flatMap(run => run.input.sources.map(source => source.rawId)));
  const newRaws = item.rawIds.filter(id => rawById.has(id) && !rawById.get(id)?.origin && !usedRawIds.has(id));
  const showSuggestion = !readError && runs !== null && completed.length > 0 && newRaws.length > 0 && !running && item.status !== 'closed';
  const canStart = !busy && !running && !readError && runs !== null && item.status !== 'closed' && rawIds.length > 0 && !needsReload;
  useEffect(() => { if (showPreview) previewHeading.current?.focus(); }, [showPreview]);

  const openRun = (id: string) => {
    setOpenId(id);
    document.getElementById(`work-run-button-${id}`)?.focus();
  };

  const launch = async () => {
    setLaunchError('');
    setStarting(true);
    try {
      const run = await startWorkAnalysis(item.id, {
        baseRevision: item.revision, rawIds, outputVersion: 2, roundQuestion: question.trim() || undefined,
        stageHistoryIndex: selectedStage ? stageIndex : undefined,
      });
      setOpenId(run.id);
      setChosen([]);
      setQuestion('');
      setStageIndex(undefined);
      setPreviewRevision(undefined);
      setStaleRevision(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REVISION_CONFLICT') {
        setStaleRevision(item.revision);
        setChosen([]);
        setStageIndex(undefined);
        setPreviewRevision(undefined);
        await reloadItem();
      } else {
        setLaunchError(error instanceof Error ? error.message : '未能启动本轮分析。');
      }
    } finally {
      setStarting(false);
      setReload(value => value + 1);
    }
  };

  return <>
    <section className="panel work-section" aria-labelledby="work-analysis">
      <div className="work-section-heading"><h2 id="work-analysis">AI 分析</h2></div>
      {showSuggestion && <div className="work-analysis-preview" aria-label="事项推进建议">
        <p>有 {newRaws.length} 条关联资料尚未用于已完成的分析。</p>
        <button type="button" className="secondary-button" onClick={() => materialsHeading.current?.focus()}>带新资料继续分析</button>
      </div>}
      <form className="work-form" onSubmit={event => { event.preventDefault(); if (canStart && showPreview) void launch(); }}>
        <p className="work-note">选好本轮资料后，可预览将发送给设置中模型的内容。</p>
        <div className="field">
          <label htmlFor="work-round-question">本轮问题（选填）</label>
          <textarea id="work-round-question" rows={2} maxLength={questionLimit} disabled={running || item.status === 'closed'}
            value={question} onChange={event => { setQuestion(event.target.value); setPreviewRevision(undefined); }} />
        </div>
        {item.rawIds.length === 0 ? <p className="work-note">在「资料与成果」中关联 Raw，再选择本轮材料。</p>
          : <fieldset className="work-source-picker" disabled={running || item.status === 'closed'}>
            <legend tabIndex={-1} ref={materialsHeading}>本轮资料</legend>
            <p className="work-note">请选择 1 至 8 条 Raw，原文合计最多 128 KiB。</p>
            {item.rawIds.map(id => {
              const raw = rawById.get(id);
              const checked = rawIds.includes(id);
              return <label className="work-source-option" key={id}>
                <input type="checkbox" checked={checked} disabled={!raw || !!raw.origin || (!checked && rawIds.length >= 8)}
                  onChange={event => {
                    setChosen(event.target.checked ? [...rawIds, id] : rawIds.filter(value => value !== id));
                    setPreviewRevision(undefined);
                  }} />
                <span>{raw?.title ?? 'Raw 来源不可用'}{raw?.origin && <small>仅可在本机查看</small>}</span>
              </label>;
            })}
          </fieldset>}
        <div className="field">
          <label htmlFor="work-stage-context">承接阶段成果（选填）</label>
          <select id="work-stage-context" value={selectedStage ? stageIndex : ''} disabled={running || item.status === 'closed' || !stages.length}
            onChange={event => { setStageIndex(event.target.value === '' ? undefined : Number(event.target.value)); setPreviewRevision(undefined); }}>
            <option value="">不承接阶段成果</option>
            {stages.map(({ entry, index }) => <option key={index} value={index}>
              {stageSource(!!entry.analysisRunId)} · {runTime.format(new Date(entry.at))} · {entry.body.trim().slice(0, 28)}
            </option>)}
          </select>
        </div>
        {!stages.length && <p className="work-note">保存阶段成果后，可在下一轮选择承接。</p>}
        {(analysisDirty || stageBody.trim()) && <p className="work-note">
          {analysisDirty && '「当前情况」有未保存的编辑。'}
          {stageBody.trim() && '「阶段成果」有未保存的编辑。'}
          可使用下方预览中的已保存版本；要发送修改后的内容，请先保存。
        </p>}
        {selectedStage && !showPreview && <details className="work-run-input">
          <summary>查看所选成果 · {stageSource(!!selectedStage.analysisRunId)} · {runTime.format(new Date(selectedStage.at))}</summary>
          <p className="work-prose">{selectedStage.body}</p>
          {selectedStage.analysisRunId && <button type="button" className="text-button" onClick={() => openRun(selectedStage.analysisRunId!)}>查看该轮分析</button>}
        </details>}
        {showPreview ? <section className="work-analysis-preview" aria-labelledby="work-send-preview">
          <h3 id="work-send-preview" tabIndex={-1} ref={previewHeading}>发送预览</h3>
          <AnalysisContext input={{ ...item.analysis, roundQuestion: question.trim() }} showQuestion />
          <h4>承接阶段成果</h4>
          {selectedStage ? <details className="work-run-source">
            <summary>{stageSource(!!selectedStage.analysisRunId)} · {runTime.format(new Date(selectedStage.at))}</summary>
            <p className="work-prose">{selectedStage.body}</p>
            {selectedStage.analysisRunId && <button type="button" className="text-button" onClick={() => openRun(selectedStage.analysisRunId!)}>查看该轮分析</button>}
          </details> : <p className="work-note">本轮不承接阶段成果。</p>}
          <h4>本轮 Raw · {rawIds.length} 条</h4>
          {rawIds.map(id => {
            const raw = rawById.get(id)!;
            return <details className="work-run-source" key={id}>
              <summary>{raw.title} · 全部原文</summary><p className="work-prose">{raw.body}</p>
            </details>;
          })}
          <div className="work-buttons"><button className="primary-button" disabled={!canStart}>{running ? '分析中…' : '发起分析'}</button></div>
        </section> : <div className="work-buttons">
          <button type="button" className="secondary-button" disabled={!canStart} onClick={() => setPreviewRevision(item.revision)}>预览发送内容</button>
        </div>}
        {running && <p className="work-note" role="status">可以离开此页，回来后在原事项查看这轮结果。</p>}
        {item.status === 'closed' && <p className="work-note">重开事项后可发起新一轮分析。</p>}
        {launchError && <p className="form-error" role="alert">{launchError}</p>}
        {staleRevision !== undefined && (needsReload || !rawIds.length) && analysisNotice}
        {needsReload && <div className="work-buttons"><button type="button" className="secondary-button" disabled={busy || starting} onClick={() => void reloadItem()}>重新读取最新版本</button></div>}
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
            <button className="work-list-row work-run-button" id={`work-run-button-${run.id}`} aria-expanded={expanded} aria-controls={`analysis-${run.id}`}
              onClick={() => setOpenId(expanded ? undefined : run.id)}>
              <span className="work-list-title">第 {runs.length - index} 轮 · {runTime.format(new Date(run.startedAt))}</span>
              <span className={`work-status ${run.error ? 'action-warning' : 'action-review'}`}>{runLabels[run.status]}</span>
            </button>
            <div className="work-run-detail" id={`analysis-${run.id}`} hidden={!expanded}>
              {expanded && <>
                {run.error && <p className="form-error">{run.error.message}</p>}
                {output && <>
                  <WorkBasisReviewPanel run={run} round={runs.length - index} onReviewChanged={review => {
                    if (review) setRuns(current => current?.map(value => value.id === run.id ? { ...value, basisReview: review } : value) ?? null);
                    setReload(value => value + 1);
                  }} />
                  <h4 id={`work-original-output-${run.id}`}>原分析草稿</h4>
                  {'roundSummary' in output && <AnalysisThemes output={output} runId={run.id} />}
                  <h4>观察与原文依据</h4>
                  {run.outputVersion === 2 && <p className="work-note">以下观察用于核对依据，条数不代表事件总数或真实频次。</p>}
                  {output.observations.length === 0 ? <p className="work-note">本轮没有形成可核对的观察。</p>
                    : <ol className="work-run-results work-observations">{output.observations.map(({ observation, quote, rawId }, index) => <li key={index} id={`observation-${run.id}-${index}`} tabIndex={-1}>
                      <span className="work-note">观察 {index + 1}</span>
                      <p className="work-prose">{observation}</p>
                      <p className="work-note">{run.input.sources.find(source => source.rawId === rawId)?.title} · 原文</p>
                      <blockquote className="work-prose">{quote}</blockquote>
                      <button className="text-button" onClick={() => showSource(run.id, rawId)}>查看本轮原文</button>
                    </li>)}</ol>}
                  <h4>建议</h4>
                  {output.suggestions.length ? <ul className="work-run-results">{output.suggestions.map((text, index) => <li key={index} className="work-prose">{text}</li>)}</ul>
                    : <p className="work-note">本轮没有给出建议。</p>}
                  <h4>待核问题</h4>
                  {output.openQuestions.length ? <ul className="work-run-results">{output.openQuestions.map((text, index) => <li key={index} className="work-prose">{text}</li>)}</ul>
                    : <p className="work-note">本轮没有新增待核问题。</p>}
                  <div className="work-buttons work-stage-actions">
                    <button className="secondary-button" disabled={busy || Boolean(stageBody.trim())} onClick={() => {
                      setStageBody(stageDraft(run, output));
                      setStageRunId(run.id);
                      stageEditor.current?.focus();
                    }}>带入阶段成果</button>
                    {stageBody.trim() && <p className="work-note">保存或清空正在编辑的阶段成果后，可带入另一轮草稿。</p>}
                  </div>
                </>}
                <details className="work-run-input">
                  <summary>输入快照 · {run.input.sources.length} 条 Raw</summary>
                  <AnalysisContext input={run.input} showQuestion={run.outputVersion === 2} />
                  {run.input.stageContext && <details className="work-run-source">
                    <summary>承接阶段成果 · {stageSource(run.input.stageContext.source === 'ai_assisted')} · {runTime.format(new Date(run.input.stageContext.at))}</summary>
                    <p className="work-prose">{run.input.stageContext.body}</p>
                    {run.input.stageContext.analysisRunId && <button className="text-button" onClick={() => openRun(run.input.stageContext!.analysisRunId!)}>查看承接来源轮次</button>}
                  </details>}
                  {run.input.sources.map(source => <details className="work-run-source" id={`work-source-${run.id}-${source.rawId}`} key={source.rawId}>
                    <summary>{source.title} · 本轮原文</summary>
                    <p className="work-prose">{source.body}</p>
                  </details>)}
                </details>
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
          <button className="text-button" onClick={() => openRun(entry.analysisRunId!)}>查看该轮分析</button>
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
