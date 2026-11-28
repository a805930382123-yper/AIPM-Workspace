import type { WorkItemUpdate, WorkStatus } from '../../api';
import { analysisStatusLabels, customerStatusLabels, timestamp, workStatusLabel } from './workItemShared';
import { analysisOf, contextOf, type WorkItemDetailState } from './useWorkItemDetail';

export function WorkItemCurrent({ state }: { state: WorkItemDetailState }) {
  const {
    saved,
    context,
    setContext,
    analysis,
    setAnalysis,
    closureReason,
    setClosureReason,
    busy,
    suggestionPreview,
    setSuggestionPreview,
    suggestionStale,
    update,
    renderNotice,
    changeContext,
    product,
    closureInput,
    setFocusClosure,
    closing,
    suggestion,
    savedContext,
    currentDirty,
    suggestionFields,
  } = state;
  return (
    <section className="panel work-section" aria-labelledby="work-current">
      <div className="work-section-heading">
        <div className="work-section-title-group">
          <h2 id="work-current">当前情况</h2>
          {currentDirty && (
            <span className="work-dirty-badge" role="status">
              有未保存修改
            </span>
          )}
        </div>
        {!product && saved.status !== 'closed' && (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => {
              changeContext('status', 'closed');
              setFocusClosure(true);
            }}
          >
            标记为已解决
          </button>
        )}
        {saved.status === 'closed' && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void update('current', { reopen: true }, '事项已重开。', (next) => changeContext('status', next.status))
            }
          >
            重开事项
          </button>
        )}
      </div>
      {suggestion && (
        <section className="work-analysis-preview" aria-label="事项推进建议">
          <h3>建议：{suggestion.title}</h3>
          <p className="work-note">{suggestion.reason} 状态不会自动更改。</p>
          {suggestionPreview?.revision === saved.revision ? (
            <>
              <p>目标状态：{workStatusLabel(saved.kind, suggestion.status)}</p>
              {suggestionFields.map((field) => {
                const dirty = context[field] !== savedContext[field];
                const labels = { waitingFor: '等待对象', nextStep: '下一步', followUpOn: '跟进日期' };
                return (
                  <label className="field" key={field}>
                    {labels[field]}
                    <input
                      type={field === 'followUpOn' ? 'date' : 'text'}
                      maxLength={field === 'waitingFor' ? 300 : field === 'nextStep' ? 1000 : undefined}
                      disabled={dirty || busy}
                      value={suggestionPreview[field]}
                      onChange={(event) => setSuggestionPreview({ ...suggestionPreview, [field]: event.target.value })}
                    />
                    {dirty && <small>当前情况中有未保存修改，保留在原表单，本次不提交。</small>}
                  </label>
                );
              })}
              <div className="work-buttons">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || context.status !== saved.status || suggestionStale}
                  onClick={() => {
                    const patch: Omit<WorkItemUpdate, 'baseRevision'> = { status: suggestion.status };
                    for (const field of suggestionFields) {
                      if (context[field] === savedContext[field] && suggestionPreview[field] !== savedContext[field])
                        patch[field] = suggestionPreview[field];
                    }
                    void update('suggestion', patch, '建议已应用。', (next) => {
                      const nextContext = contextOf(next);
                      setContext((current) => ({
                        ...current,
                        status: nextContext.status,
                        ...Object.fromEntries(
                          suggestionFields
                            .filter((field) => field in patch)
                            .map((field) => [field, nextContext[field]]),
                        ),
                      }));
                      setSuggestionPreview(null);
                    });
                  }}
                >
                  应用建议
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setSuggestionPreview(null)}
                >
                  取消
                </button>
              </div>
              {context.status !== saved.status && <p className="work-note">请先保存或撤销当前情况中的状态修改。</p>}
              {suggestionStale && <p className="work-note">版本已变化，请先重新读取最新版本。</p>}
            </>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                setSuggestionPreview({
                  revision: saved.revision,
                  waitingFor: savedContext.waitingFor || suggestion.waitingFor,
                  nextStep: savedContext.nextStep || suggestion.nextStep,
                  followUpOn: savedContext.followUpOn,
                })
              }
            >
              预览建议
            </button>
          )}
        </section>
      )}
      {renderNotice('suggestion')}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const { status, waitingFor, nextStep, followUpOn, customer, project, occurredAt } = context;
          void update(
            'current',
            {
              status,
              waitingFor,
              nextStep,
              followUpOn,
              ...(product ? { analysis } : { customer, project, occurredAt: timestamp(occurredAt) }),
              ...(closing ? { closureReason } : {}),
            },
            closing ? (product ? '事项已完成。' : '问题已解决。') : '当前情况已保存。',
            (next) => {
              setContext(contextOf(next));
              setAnalysis(analysisOf(next.analysis));
              setClosureReason('');
            },
          );
        }}
      >
        <fieldset className="work-form" disabled={busy}>
          <div className="work-form-grid">
            <div className="field">
              <label htmlFor="work-status">状态</label>
              <select
                id="work-status"
                value={context.status}
                disabled={saved.status === 'closed'}
                onChange={(event) => changeContext('status', event.target.value as WorkStatus)}
              >
                {Object.entries(product ? analysisStatusLabels : customerStatusLabels)
                  .filter(([value]) => product || value !== 'closed' || context.status === 'closed')
                  .map(([value, label]) => (
                    <option key={value} value={value} disabled={!product && value === 'closed'}>
                      {label}
                    </option>
                  ))}
              </select>
            </div>
            <label className="field">
              跟进日期（选填）
              <input
                type="date"
                aria-describedby={context.status === 'waiting' ? 'work-follow-up-hint' : undefined}
                value={context.followUpOn}
                onChange={(event) => changeContext('followUpOn', event.target.value)}
              />
            </label>
            {context.status === 'waiting' && (
              <p className="work-note work-span" id="work-follow-up-hint">
                可以设置跟进日期，到期会显示在首页。也可以暂时留空。
              </p>
            )}
            <label className="field">
              等谁／等什么（选填）
              <input
                maxLength={300}
                value={context.waitingFor}
                onChange={(event) => changeContext('waitingFor', event.target.value)}
              />
            </label>
            <label className="field">
              下一步（选填）
              <input
                maxLength={1000}
                value={context.nextStep}
                onChange={(event) => changeContext('nextStep', event.target.value)}
              />
            </label>
            {product ? (
              <>
                <div className="field work-span">
                  <label htmlFor="work-goal">分析目标</label>
                  <textarea
                    id="work-goal"
                    required
                    maxLength={20_000}
                    rows={2}
                    value={analysis.goal}
                    onChange={(event) => setAnalysis({ ...analysis, goal: event.target.value })}
                  />
                </div>
                <div className="field work-span">
                  <label htmlFor="work-data-scope">数据范围与口径</label>
                  <textarea
                    id="work-data-scope"
                    maxLength={20_000}
                    rows={2}
                    value={analysis.dataScope}
                    onChange={(event) => setAnalysis({ ...analysis, dataScope: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="work-conclusions">已确认结论</label>
                  <textarea
                    id="work-conclusions"
                    maxLength={20_000}
                    rows={3}
                    value={analysis.confirmedConclusions}
                    onChange={(event) => setAnalysis({ ...analysis, confirmedConclusions: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="work-questions">未解问题</label>
                  <textarea
                    id="work-questions"
                    maxLength={20_000}
                    rows={3}
                    value={analysis.openQuestions}
                    onChange={(event) => setAnalysis({ ...analysis, openQuestions: event.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  客户（选填）
                  <input
                    maxLength={200}
                    value={context.customer}
                    onChange={(event) => changeContext('customer', event.target.value)}
                  />
                </label>
                <label className="field">
                  项目（选填）
                  <input
                    maxLength={200}
                    value={context.project}
                    onChange={(event) => changeContext('project', event.target.value)}
                  />
                </label>
                <label className="field">
                  发生时间（选填，上海时间）
                  <input
                    type="datetime-local"
                    step="1"
                    value={context.occurredAt}
                    onChange={(event) => changeContext('occurredAt', event.target.value)}
                  />
                </label>
              </>
            )}
            {closing && (
              <label className="field work-span">
                {product ? '完成说明' : '解决说明'}
                <textarea
                  ref={closureInput}
                  required
                  maxLength={20_000}
                  rows={2}
                  value={closureReason}
                  onChange={(event) => setClosureReason(event.target.value)}
                />
              </label>
            )}
          </div>
          <div className="work-buttons">
            <button className="primary-button" type="submit">
              {closing ? (product ? '完成事项' : '确认问题已解决') : '保存当前情况'}
            </button>
          </div>
        </fieldset>
      </form>
      {renderNotice('current')}
    </section>
  );
}
