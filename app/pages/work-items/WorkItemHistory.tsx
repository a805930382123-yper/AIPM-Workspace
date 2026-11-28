import type { WorkHistoryInput } from '../../api';
import { formatTime, historyLabels, timestamp } from './workItemShared';
import type { WorkItemDetailState } from './useWorkItemDetail';

export function WorkItemHistory({ state }: { state: WorkItemDetailState }) {
  const {
    saved,
    report,
    setReport,
    sent,
    setSent,
    kind,
    setKind,
    historyText,
    setHistoryText,
    outcome,
    setOutcome,
    busy,
    setNotice,
    update,
    renderNotice,
    product,
    historyDirty,
    reportDirty,
  } = state;
  return (
    <>
      {!product && (
        <section className="panel work-section" aria-labelledby="work-history">
          <div className="work-section-heading">
            <div className="work-section-title-group">
              <h2 id="work-history">处理记录</h2>
              {(historyDirty || reportDirty) && (
                <span className="work-dirty-badge" role="status">
                  有未保存修改
                </span>
              )}
            </div>
          </div>
          <ol className="work-history-list">
            <li>
              <div>
                <h3>原客户反馈</h3>
                <time dateTime={saved.createdAt}>{formatTime(saved.createdAt)}</time>
              </div>
              <p className="work-prose">{saved.feedback}</p>
            </li>
            {saved.history.map((entry, index) => (
              <li key={`${entry.at}:${index}`}>
                <div>
                  <h3>
                    {historyLabels[entry.kind]}
                    {entry.kind === 'retest' && (
                      <span className={`work-status ${entry.outcome === 'passed' ? 'work-passed' : 'action-warning'}`}>
                        {entry.outcome === 'passed' ? '通过' : '未通过'}
                      </span>
                    )}
                  </h3>
                  <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                </div>
                {entry.kind === 'sent' && (
                  <p className="work-note">
                    实际发送 <time dateTime={entry.sentAt}>{formatTime(entry.sentAt)}</time>
                  </p>
                )}
                <p className="work-prose">{entry.body}</p>
              </li>
            ))}
          </ol>
          <form
            className="work-subsection"
            onSubmit={(event) => {
              event.preventDefault();
              if (kind === 'retest' && !outcome) return;
              const history: WorkHistoryInput =
                kind === 'retest'
                  ? { kind, body: historyText, outcome: outcome as 'passed' | 'failed' }
                  : { kind, body: historyText };
              void update('history', { history }, '处理记录已添加。', () => {
                setHistoryText('');
                setOutcome('');
              });
            }}
          >
            <h3>添加处理记录</h3>
            {kind === 'customer_reply' && (
              <p className="work-note">记录已回复客户的内容，不会自动发送消息；确认问题处理完毕后，可标记为已解决。</p>
            )}
            <fieldset className="work-form" disabled={busy}>
              <div className="work-form-grid">
                <div className="field">
                  <label htmlFor="work-history-kind">记录类型</label>
                  <select
                    id="work-history-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as typeof kind)}
                  >
                    {(['feedback', 'reproduction', 'technical_reply', 'customer_reply', 'retest'] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {historyLabels[value]}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                {kind === 'retest' && (
                  <div className="field">
                    <label htmlFor="work-retest-outcome">复测结果</label>
                    <select
                      id="work-retest-outcome"
                      required
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value as typeof outcome)}
                    >
                      <option value="">选择结果</option>
                      <option value="passed">通过</option>
                      <option value="failed">未通过</option>
                    </select>
                  </div>
                )}
              </div>
              <label className="field">
                记录内容
                <textarea
                  rows={3}
                  required
                  maxLength={20_000}
                  value={historyText}
                  onChange={(event) => setHistoryText(event.target.value)}
                />
              </label>
              <div className="work-buttons">
                <button className="secondary-button" type="submit">
                  保存处理记录
                </button>
              </div>
            </fieldset>
          </form>
          {renderNotice('history')}
          <form
            className="work-subsection"
            onSubmit={(event) => {
              event.preventDefault();
              void update('report', { reportDraft: report }, '技术反馈正文已保存。', (next) =>
                setReport(next.reportDraft ?? ''),
              );
            }}
          >
            <h3>手工技术反馈</h3>
            <fieldset className="work-form" disabled={busy}>
              <label className="field">
                技术反馈正文
                <textarea
                  rows={4}
                  maxLength={20_000}
                  value={report}
                  onChange={(event) => setReport(event.target.value)}
                />
              </label>
              <div className="work-buttons">
                <button className="secondary-button" type="submit">
                  保存正文
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!report.trim()}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(report);
                      setNotice({ section: 'report', message: '正文已复制。' });
                    } catch {
                      setNotice({ section: 'report', message: '复制失败，请手动选择正文复制。', error: true });
                    }
                  }}
                >
                  复制正文
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!!sent}
                  onClick={() => setSent({ body: report, time: '' })}
                >
                  记录已发送
                </button>
              </div>
            </fieldset>
          </form>
          {sent && (
            <form
              className="work-subsection"
              onSubmit={(event) => {
                event.preventDefault();
                void update(
                  'report',
                  { history: { kind: 'sent', body: sent.body, sentAt: timestamp(sent.time) } },
                  '发送记录已添加。',
                  () => setSent(null),
                );
              }}
            >
              <h3>登记实际发送</h3>
              <fieldset className="work-form" disabled={busy}>
                <label className="field">
                  实际发送时间（上海时间）
                  <input
                    type="datetime-local"
                    step="1"
                    required
                    value={sent.time}
                    onChange={(event) => setSent({ ...sent, time: event.target.value })}
                  />
                </label>
                <label className="field">
                  已发送正文
                  <textarea
                    rows={4}
                    required
                    maxLength={20_000}
                    value={sent.body}
                    onChange={(event) => setSent({ ...sent, body: event.target.value })}
                  />
                </label>
                <div className="work-buttons">
                  <button className="primary-button" type="submit">
                    确认记录已发送
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setSent(null)}>
                    取消
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {renderNotice('report')}
        </section>
      )}
    </>
  );
}
