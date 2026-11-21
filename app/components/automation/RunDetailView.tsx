import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { AutomationRun, KnowledgeInspection, WikiLintSnapshot } from '../../api';
import { automationLintSnapshot, automationTime, getInspection } from '../../api';
import {
  describeError,
  isActive,
  runError,
  runStatusTone,
  statusLabels,
  triggerLabels,
} from './automationMeta';

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';

function LintRunDetails({ id, onOpenLint }: { id: string; onOpenLint?: () => void }) {
  const [snapshot, setSnapshot] = useState<WikiLintSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void automationLintSnapshot(id, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(describeError(reason));
      });
    return () => controller.abort();
  }, [id]);
  return (
    <div className="automation-artifact">
      <div className="automation-heading">
        <h4>结构检查快照</h4>
        {onOpenLint && (
          <button type="button" className="text-button" onClick={onOpenLint}>
            查看结构检查
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          快照读取失败。{error}
        </p>
      )}
      {!snapshot && !error && <p role="status">正在读取结构检查快照…</p>}
      {snapshot && (
        <>
          <p>
            总问题 {snapshot.total} 项 ·{' '}
            {snapshot.diff.isBaseline
              ? '首次检查基线'
              : `新增 ${snapshot.diff.addedCount} 项 · 消除 ${snapshot.diff.resolvedCount} 项 · 未变化 ${snapshot.diff.unchangedCount} 项`}
          </p>
          {!snapshot.diff.isBaseline &&
            ([
              ['新增问题', snapshot.diff.added],
              ['已消除问题', snapshot.diff.resolved],
            ] as const).map(([label, findings]) => (
              <details key={label}>
                <summary>
                  {label}（{findings.length} 项）
                </summary>
                {findings.length === 0 ? (
                  <p>无{label}。</p>
                ) : (
                  <ul className="automation-list">
                    {findings.map(finding => (
                      <li key={finding.fingerprint}>
                        <div>
                          <strong>
                            {finding.pageTitle ?? finding.file}
                            {finding.location.scope === 'line' && ` · 第 ${finding.location.line} 行`}
                          </strong>
                          <p>{finding.message}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            ))}
        </>
      )}
    </div>
  );
}

function InspectionRunDetails({ id, onOpenInspection }: { id: string; onOpenInspection?: (id: string) => void }) {
  const [record, setRecord] = useState<KnowledgeInspection | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void getInspection(id, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setRecord(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(describeError(reason));
      });
    return () => controller.abort();
  }, [id]);
  const pendingCount = record?.findings.filter(finding => finding.status === 'pending').length ?? 0;
  return (
    <div className="automation-artifact">
      <div className="automation-heading">
        <h4>主动检查发现</h4>
        {onOpenInspection && record && (
          <button type="button" className="text-button" onClick={() => onOpenInspection(id)}>
            查看本次检查记录
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          检查记录读取失败。{error}
        </p>
      )}
      {!record && !error && <p role="status">正在读取主动检查记录…</p>}
      {record && (
        <>
          <p>
            实读 {record.scope.read.length} 页 · 共发现 {record.findings.length} 项 · 待核 {pendingCount} 项
          </p>
          {record.findings.length > 0 && (
            <details>
              <summary>查看发现摘要</summary>
              <ul className="automation-list">
                {record.findings.map(finding => (
                  <li key={finding.id}>
                    <div>{finding.summary}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export type RunDetailContentProps = {
  detail: AutomationRun | null;
  readError: string;
  cancelError: string;
  pending: boolean;
  hasStatus: boolean;
  detailHeading: RefObject<HTMLHeadingElement | null>;
  taskName: (type: string) => string;
  onCancel: (id: string) => void;
  onClose: () => void;
  onViewInRuns?: () => void;
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenLint?: () => void;
  onOpenInspection?: (id?: string) => void;
  onOpenWeeklyReview?: (weekKey: string) => void;
};

/** Detailed view of a single automation run: metadata, vertical timeline stepper, usage grid, and artifacts. */
export function RunDetailContent({
  detail,
  readError,
  cancelError,
  pending,
  hasStatus,
  detailHeading,
  taskName,
  onCancel,
  onClose,
  onViewInRuns,
  onOpenRaw,
  onOpenDraft,
  onOpenLint,
  onOpenInspection,
  onOpenWeeklyReview,
}: RunDetailContentProps) {
  const weeklyReviewWeekKey = detail?.artifacts.weeklyReviewWeekKey;
  return (
    <>
      <div className="automation-heading">
        <div>
          <h2 id="automation-run-detail" tabIndex={-1} ref={detailHeading}>
            运行详情
          </h2>
          {detail && (
            <p className="automation-run-detail-subtitle">
              {taskName(detail.type)} · {statusLabels[detail.status]}
            </p>
          )}
        </div>
        <div className="automation-actions">
          {onViewInRuns && (
            <button type="button" className="secondary-button" disabled={pending} onClick={onViewInRuns}>
              在运行记录中查看
            </button>
          )}
          {detail && !detail.candidateId && isActive(detail.status) && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !hasStatus}
              onClick={() => onCancel(detail.id)}
            >
              取消运行
            </button>
          )}
          <button type="button" className="text-button" disabled={pending} onClick={onClose}>
            关闭详情
          </button>
        </div>
      </div>
      {readError && (
        <p className="form-error" role="alert">
          运行详情读取失败：{readError}
        </p>
      )}
      {!detail && !readError && <p role="status">正在读取运行详情…</p>}
      {cancelError && (
        <p className="form-error" role="alert">
          {cancelError}
        </p>
      )}
      {detail && (
        <>
          {detail.error && <p className="form-error">{runError(detail.error)}</p>}
          <dl className="automation-facts">
            <div>
              <dt>触发</dt>
              <dd>
                {triggerLabels[detail.trigger]} · {automationTime(detail.scheduledAt)}
              </dd>
            </div>
            <div>
              <dt>开始</dt>
              <dd>{automationTime(detail.startedAt)}</dd>
            </div>
            <div>
              <dt>结束</dt>
              <dd>{automationTime(detail.endedAt)}</dd>
            </div>
          </dl>
          <h3>步骤</h3>
          {!detail.steps.length && <p>暂无步骤记录。</p>}
          {detail.steps.length > 0 && (
            <ol className="automation-stepper">
              {detail.steps.map((step, index) => {
                const tone = runStatusTone(step.status);
                return (
                  <li key={index} className="automation-stepper-item" data-tone={tone}>
                    <span className="automation-stepper-node" aria-hidden="true" />
                    <div className="automation-stepper-body">
                      <div className="automation-stepper-head">
                        <strong>{step.name}</strong>
                        <span className="automation-pill" data-tone={tone}>
                          {statusLabels[step.status]}
                        </span>
                        {step.durationMs !== null && (
                          <span className="automation-stepper-duration">{step.durationMs} 毫秒</span>
                        )}
                      </div>
                      {step.summary && <p className="automation-stepper-summary">{step.summary}</p>}
                      {step.error && <p className="form-error">{step.error}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <h3>用量</h3>
          <dl className="automation-usage-grid">
            {detail.sourceRequests !== undefined && (
              <div>
                <dt>来源 HTTP 请求</dt>
                <dd>{detail.sourceRequests}</dd>
              </div>
            )}
            <div>
              <dt>模型请求次数</dt>
              <dd>{detail.usage.requests}</dd>
            </div>
            <div>
              <dt>输入 Token</dt>
              <dd>{detail.usage.inputTokens}</dd>
            </div>
            <div>
              <dt>输出 Token</dt>
              <dd>{detail.usage.outputTokens}</dd>
            </div>
            <div>
              <dt>用量未知的请求</dt>
              <dd>{detail.usage.unknownUsageCount}</dd>
            </div>
          </dl>
          <h3>产物</h3>
          {detail.candidateId && <p className="automation-candidate-ref">候选 {detail.candidateId}</p>}
          <div className="automation-artifact-chips">
            {detail.artifacts.rawIds.map(id => (
              <button type="button" key={id} className="automation-artifact-chip" onClick={() => onOpenRaw(id)}>
                Raw {id}
              </button>
            ))}
            {detail.artifacts.draftIds.map(id => (
              <button type="button" key={id} className="automation-artifact-chip" onClick={() => onOpenDraft(id)}>
                草稿 {id}
              </button>
            ))}
            {detail.artifacts.jobIds.map(id => (
              <a
                key={id}
                className="automation-artifact-chip"
                href={`/api/extraction-jobs/${encodeURIComponent(id)}`}
                target="_blank"
                rel="noreferrer"
              >
                任务 {id}
              </a>
            ))}
            {weeklyReviewWeekKey &&
              (onOpenWeeklyReview ? (
                <button
                  type="button"
                  className="automation-artifact-chip"
                  onClick={() => onOpenWeeklyReview(weeklyReviewWeekKey)}
                >
                  打开周报 {weeklyReviewWeekKey}
                </button>
              ) : (
                <span className="automation-artifact-chip">周报 {weeklyReviewWeekKey}</span>
              ))}
            {!weeklyReviewWeekKey &&
              !detail.artifacts.lintSnapshotId &&
              !Object.values(detail.artifacts).some(value => Array.isArray(value) && value.length) && (
                <p>无产物。</p>
              )}
          </div>
          {detail.artifacts.lintSnapshotId && (
            <LintRunDetails
              key={detail.artifacts.lintSnapshotId}
              id={detail.artifacts.lintSnapshotId}
              onOpenLint={onOpenLint}
            />
          )}
          {detail.artifacts.inspectionIds?.map(id => (
            <InspectionRunDetails key={id} id={id} onOpenInspection={onOpenInspection} />
          ))}
        </>
      )}
    </>
  );
}

/**
 * Right-side slide-out drawer for viewing run details without leaving the Workflows or Inbox tabs.
 * Focus entry and close restoration are coordinated explicitly by AutomationPage so unmounting
 * during "在运行记录中查看" never pulls focus back to an unmounted trigger.
 */
export function RunDetailDrawer({
  pending,
  onClose,
  children,
}: {
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !pending) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const raw = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    const laidOut = raw.filter(node => node.getClientRects().length > 0);
    const items = laidOut.length > 0 ? laidOut : raw.filter(node => !node.closest('[hidden]'));
    if (!items.length) {
      event.preventDefault();
      drawer.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = drawer.ownerDocument.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !active || !items.includes(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !active || !items.includes(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="automation-drawer-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className="panel automation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-run-detail"
        onKeyDown={onKeyDown}
      >
        {children}
      </aside>
    </div>
  );
}
