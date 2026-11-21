import type { RefObject } from 'react';
import type {
  AutomationList,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
} from '../../api';
import { automationTime } from '../../api';
import {
  issueLabels,
  runStatusTone,
  statusLabels,
  triggerLabels,
} from './automationMeta';
import { RunDetailContent } from './RunDetailView';

export type RunsTabProps = {
  tasks: AutomationSchedule[];
  hasPipeline: boolean;
  typeFilter: string;
  statusFilter: AutomationRunStatus | '';
  limit: number;
  history: AutomationList<AutomationRun> | null;
  historyError: string;
  selectedRunId: string | null;
  detail: AutomationRun | null;
  detailError: string;
  cancelError: string;
  pending: boolean;
  hasStatus: boolean;
  detailHeading: RefObject<HTMLHeadingElement | null>;
  taskName: (type: string) => string;
  onTypeFilterChange: (next: string) => void;
  onStatusFilterChange: (next: AutomationRunStatus | '') => void;
  onLimitChange: (next: number) => void;
  onSelectRun: (id: string, run: AutomationRun, trigger: HTMLElement | null) => void;
  onCancelRun: (id: string) => void;
  onCloseDetail: () => void;
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenLint?: () => void;
  onOpenInspection?: (id?: string) => void;
  onOpenWeeklyReview?: (weekKey: string) => void;
};

/** Runs history master-detail tab with scrollable list on the left and persistent detail pane on the right. */
export function RunsTab({
  tasks,
  hasPipeline,
  typeFilter,
  statusFilter,
  limit,
  history,
  historyError,
  selectedRunId,
  detail,
  detailError,
  cancelError,
  pending,
  hasStatus,
  detailHeading,
  taskName,
  onTypeFilterChange,
  onStatusFilterChange,
  onLimitChange,
  onSelectRun,
  onCancelRun,
  onCloseDetail,
  onOpenRaw,
  onOpenDraft,
  onOpenLint,
  onOpenInspection,
  onOpenWeeklyReview,
}: RunsTabProps) {
  return (
    <div className="automation-runs-layout">
      <section className="panel automation-panel automation-runs-list-panel" aria-labelledby="automation-history">
        <div className="automation-heading">
          <h2 id="automation-history">运行历史</h2>
        </div>
        <div className="automation-filters">
          <label>
            任务
            <select value={typeFilter} onChange={event => onTypeFilterChange(event.target.value)}>
              <option value="">全部任务</option>
              {tasks.map(task => (
                <option key={task.type} value={task.type}>
                  {task.name}
                </option>
              ))}
              {hasPipeline && <option value="pipeline.organize">资讯入库与整理</option>}
            </select>
          </label>
          <label>
            运行状态
            <select
              value={statusFilter}
              onChange={event => onStatusFilterChange(event.target.value as AutomationRunStatus | '')}
            >
              <option value="">全部状态</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            显示条数
            <select value={limit} onChange={event => onLimitChange(Number(event.target.value))}>
              {[20, 50, 100].map(count => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        </div>
        {historyError && (
          <p className="form-error" role="alert">
            运行历史读取失败：{historyError}
          </p>
        )}
        {!history && !historyError && <p role="status">正在读取运行历史…</p>}
        {history?.issues?.map(issue => (
          <p key={issue.file} className="form-error" role="alert">
            {issueLabels[issue.reason]}：{issue.file}
          </p>
        ))}
        {history && !history.items.length && !history.issues?.length && <p>暂无符合筛选条件的运行记录。</p>}
        <div className="automation-runs-scroll">
          <ul className="automation-list automation-runs-list">
            {history?.items.map(run => {
              const selected = selectedRunId === run.id;
              const tone = runStatusTone(run.status);
              return (
                <li key={run.id} className={selected ? 'is-selected' : undefined}>
                  <div className="automation-run-row-main">
                    <div className="automation-run-row-title">
                      <span className="automation-run-dot" data-tone={tone} aria-hidden="true" />
                      <strong>{taskName(run.type)}</strong>
                      <span className="automation-pill" data-tone={tone}>
                        {statusLabels[run.status]}
                      </span>
                    </div>
                    <p className="automation-run-row-meta">
                      {automationTime(run.scheduledAt)} · {triggerLabels[run.trigger]}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pending}
                    aria-pressed={selected}
                    onClick={event => onSelectRun(run.id, run, event.currentTarget)}
                  >
                    查看详情
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {selectedRunId ? (
        <section className="panel automation-panel automation-run-detail-panel" aria-labelledby="automation-run-detail">
          <RunDetailContent
            detail={detail}
            readError={detailError}
            cancelError={cancelError}
            pending={pending}
            hasStatus={hasStatus}
            detailHeading={detailHeading}
            taskName={taskName}
            onCancel={onCancelRun}
            onClose={onCloseDetail}
            onOpenRaw={onOpenRaw}
            onOpenDraft={onOpenDraft}
            onOpenLint={onOpenLint}
            onOpenInspection={onOpenInspection}
            onOpenWeeklyReview={onOpenWeeklyReview}
          />
        </section>
      ) : (
        <section className="panel automation-panel automation-run-placeholder" aria-label="运行详情占位">
          <div className="automation-run-placeholder-inner">
            <h3>选择一条运行记录</h3>
            <p>在左侧列表点击「查看详情」，即可在此查看步骤时间线、模型用量与产物。</p>
          </div>
        </section>
      )}
    </div>
  );
}
