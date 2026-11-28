import type { ReactNode } from 'react';
import type { AutomationStatus } from '../../api';
import { automationTime } from '../../api';

export function AutomationSummaryBar({
  status,
  statusError,
  pendingTotal,
  pending,
  pauseConfirmation,
  onRequestPause,
  onConfirmPause,
  onCancelPause,
  pauseError,
}: {
  status: AutomationStatus | null;
  statusError: string;
  pendingTotal: number;
  pending: boolean;
  pauseConfirmation: boolean | null;
  onRequestPause: (value: boolean) => void;
  onConfirmPause: () => void;
  onCancelPause: () => void;
  pauseError: ReactNode;
}) {
  const bannerTone = !status
    ? 'muted'
    : !status.scheduler.healthy || status.failuresLast24Hours > 0
      ? 'danger'
      : status.paused
        ? 'warning'
        : 'ok';
  return (
    <section className="panel automation-banner" aria-labelledby="automation-status" data-tone={bannerTone}>
      <div className="automation-banner-main">
        <div className="automation-banner-summary">
          <div className="automation-banner-title">
            <span className="automation-dot" aria-hidden="true" />
            <h2 id="automation-status">调度状态</h2>
            {status && (
              <span className="automation-banner-state">
                {status.paused ? '全局暂停' : '任务可触发'} · {status.scheduler.healthy ? '调度器正常' : '调度器异常'}
              </span>
            )}
          </div>
          {statusError && (
            <p className="form-error" role="alert">
              调度状态读取失败：{statusError}
            </p>
          )}
          {!status && !statusError && <p role="status">正在读取调度状态…</p>}
          {status && (
            <>
              <dl className="automation-facts">
                <div>
                  <dt>下次运行（上海时间）</dt>
                  <dd>{automationTime(status.nextRunAt)}</dd>
                </div>
                <div>
                  <dt>最近 24 小时失败</dt>
                  <dd>{status.failuresLast24Hours} 次</dd>
                </div>
                <div>
                  <dt>当前待处理</dt>
                  <dd>{pendingTotal} 项</dd>
                </div>
              </dl>
              {status.scheduler.error && (
                <p className="form-error" role="alert">
                  {status.scheduler.error}
                </p>
              )}
            </>
          )}
        </div>
        {status && pauseConfirmation === null && (
          <div className="automation-banner-controls">
            <button
              type="button"
              className="secondary-button"
              disabled={pending}
              onClick={() => onRequestPause(!status.paused)}
            >
              {status.paused ? '恢复全部自动化' : '暂停全部自动化'}
            </button>
          </div>
        )}
      </div>
      {pauseConfirmation !== null && (
        <div className="automation-confirm" role="group" aria-label="确认更改全局暂停设置">
          <p>
            {pauseConfirmation
              ? '暂停后，新触发会记录为跳过。正在运行的任务会继续。'
              : '恢复后按当前计划触发，暂停期间跳过的记录会保留。'}
          </p>
          <div className="automation-actions">
            <button type="button" className="primary-button" disabled={pending} onClick={onConfirmPause}>
              {pauseConfirmation ? '确认暂停' : '确认恢复'}
            </button>
            <button type="button" className="secondary-button" disabled={pending} onClick={onCancelPause}>
              取消
            </button>
          </div>
        </div>
      )}
      {pauseError}
      {status && (
        <details className="automation-process-info">
          <summary>进程信息</summary>
          <p>
            {status.instance.mode === 'production' ? '生产' : '开发'} · PID {status.instance.pid} · 端口{' '}
            {status.instance.port}
          </p>
        </details>
      )}
    </section>
  );
}
