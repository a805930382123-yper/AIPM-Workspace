import type { FormEvent, ReactNode } from 'react';
import type {
  AutomationPlan,
  AutomationSchedule,
  CandidateView,
  ConfirmCandidates,
  PipelineSettings,
  ReminderView,
} from '../../api';
import { useDialogFocus } from '../useDialogFocus';
import {
  evidenceLabel,
  weekdays,
  type PipelineSettingsEdit,
  type ReminderEditor,
  type ScheduleEditorState,
} from './automationMeta';

const focusDialogControl = (button: HTMLElement) => {
  const dialog = button.closest('[role="dialog"]');
  (dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? (dialog as HTMLElement | null))?.focus();
};

export type AutomationModalProps = {
  titleId: string;
  title: string;
  subtitle?: string;
  pending: boolean;
  onClose: () => void;
  modalClassName?: string;
  dialogClassName?: string;
  children: ReactNode;
};

/** Shared accessible modal shell for automation editors and confirmations. */
export function AutomationModal({
  titleId,
  title,
  subtitle,
  pending,
  onClose,
  modalClassName,
  dialogClassName,
  children,
}: AutomationModalProps) {
  const dialog = useDialogFocus<HTMLElement>();
  return (
    <div
      className={['modal-scrim', 'automation-modal', modalClassName].filter(Boolean).join(' ')}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={['panel', 'automation-dialog', dialogClassName].filter(Boolean).join(' ')}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !pending) onClose();
        }}
      >
        <header className="automation-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="automation-modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={pending} onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

/** Modal dialog for editing an automation task schedule with optimistic concurrency protection. */
export function ScheduleEditorDialog({
  task,
  editor,
  pending,
  canWrite,
  errorMessage,
  onChange,
  onReloadLatest,
  onSubmit,
  onClose,
}: {
  task: AutomationSchedule;
  editor: ScheduleEditorState;
  pending: boolean;
  canWrite: boolean;
  errorMessage: string;
  onChange: (next: ScheduleEditorState) => void;
  onReloadLatest: () => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <AutomationModal
      titleId="automation-editor-title"
      title={`编辑计划 · ${task.name}`}
      pending={pending}
      onClose={onClose}
      modalClassName="schedule-modal"
      dialogClassName="schedule-dialog"
    >
      <form className="automation-editor" aria-label="编辑计划" onSubmit={onSubmit}>
        <div className="automation-actions">
          <label className="automation-check">
            <input
              type="checkbox"
              checked={editor.enabled}
              disabled={pending}
              onChange={(event) => onChange({ ...editor, enabled: event.target.checked })}
            />
            启用计划
          </label>
          <label className="automation-check">
            <input
              type="checkbox"
              checked={editor.catchUp}
              disabled={pending || !task.allowsCatchUp}
              onChange={(event) => onChange({ ...editor, catchUp: event.target.checked })}
            />
            启动时补跑一次
          </label>
        </div>
        <label>
          调度方式
          <select
            data-autofocus
            value={editor.kind}
            disabled={pending}
            onChange={(event) => onChange({ ...editor, kind: event.target.value as AutomationPlan['kind'] })}
          >
            <option value="interval">固定间隔</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
        {editor.kind === 'weekly' && (
          <label>
            周几
            <select
              value={editor.weekday}
              disabled={pending}
              onChange={(event) =>
                onChange({ ...editor, weekday: Number(event.target.value) as ScheduleEditorState['weekday'] })
              }
            >
              {weekdays.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}
        {editor.kind === 'interval' ? (
          <label>
            间隔分钟
            <input
              type="number"
              min="1"
              max="525600"
              step="1"
              required
              value={editor.minutes}
              disabled={pending}
              onChange={(event) => onChange({ ...editor, minutes: event.target.value })}
            />
          </label>
        ) : (
          <label>
            {editor.kind === 'weekly' ? '每周运行时间（上海时间）' : '每天运行时间（上海时间）'}
            <input
              type="time"
              required
              value={editor.time}
              disabled={pending}
              onChange={(event) => onChange({ ...editor, time: event.target.value })}
            />
          </label>
        )}
        {errorMessage && (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        )}
        {editor.revision !== task.revision && (
          <div className="automation-conflict">
            <p>当前计划已更新。重新读取会替换表单中的输入。</p>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={(event) => {
                focusDialogControl(event.currentTarget);
                onReloadLatest();
              }}
            >
              读取最新版本
            </button>
          </div>
        )}
        <div className="automation-actions">
          <button
            type="submit"
            className="primary-button"
            disabled={pending || !canWrite || editor.revision !== task.revision}
          >
            {pending ? '正在保存…' : '保存计划'}
          </button>
          <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>
            取消编辑
          </button>
        </div>
      </form>
    </AutomationModal>
  );
}

/** Modal dialog for news pipeline AI pre-screening, concurrency, and topic settings. */
export function PipelineSettingsDialog({
  latest,
  edit,
  pending,
  canWrite,
  readError,
  writeError,
  onChange,
  onReload,
  onSubmit,
  onClose,
}: {
  latest?: PipelineSettings;
  edit: PipelineSettingsEdit;
  pending: boolean;
  canWrite: boolean;
  readError: string;
  writeError: string;
  onChange: (next: PipelineSettingsEdit) => void;
  onReload: () => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const conflict = Boolean(latest && edit.revision !== latest.revision);
  return (
    <AutomationModal
      titleId="automation-pipeline-settings-title"
      title="流水线设置"
      subtitle="配置每日资讯 AI 预筛、整理并发数与关注主题。"
      pending={pending}
      onClose={onClose}
      modalClassName="pipeline-settings-modal"
      dialogClassName="pipeline-settings-dialog"
    >
      <form className="automation-editor" aria-label="流水线设置" onSubmit={onSubmit}>
        <label className="automation-check">
          <input
            type="checkbox"
            data-autofocus
            checked={edit.preScreenEnabled}
            disabled={pending}
            onChange={(event) => onChange({ ...edit, preScreenEnabled: event.target.checked })}
          />
          启用 AI 预筛
        </label>
        <label>
          整理并发数
          <select
            value={edit.concurrency}
            disabled={pending}
            onChange={(event) => onChange({ ...edit, concurrency: Number(event.target.value) })}
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="candidate-topics">
          关注主题（每行一条，最多 20 条，每条最多 80 字）
          <textarea
            rows={4}
            value={edit.topics}
            disabled={pending}
            onChange={(event) => onChange({ ...edit, topics: event.target.value })}
          />
        </label>
        {readError && (
          <p className="form-error" role="alert">
            {readError}
          </p>
        )}
        {writeError && (
          <p className="form-error" role="alert">
            {writeError}
          </p>
        )}
        {conflict && (
          <div className="automation-conflict">
            <p>已有更新的设置。当前输入保留。</p>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={(event) => {
                focusDialogControl(event.currentTarget);
                onReload();
              }}
            >
              加载最新设置
            </button>
          </div>
        )}
        <div className="automation-actions">
          <button type="submit" className="primary-button" disabled={pending || !canWrite || !latest || conflict}>
            {pending ? '正在保存…' : '保存流水线设置'}
          </button>
          <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </AutomationModal>
  );
}

/** Modal dialog for work-item reminder delivery, quiet hours, and stale thresholds. */
export function ReminderSettingsDialog({
  latest,
  editor,
  pending,
  canWrite,
  feedback,
  onChange,
  onReload,
  onSubmit,
  onSendTest,
  onClose,
}: {
  latest: ReminderView | null;
  editor: ReminderEditor;
  pending: boolean;
  canWrite: boolean;
  feedback: { area: 'settings' | 'test'; text: string; error?: boolean } | null;
  onChange: (patch: Partial<ReminderEditor>) => void;
  onReload: () => void;
  onSubmit: (event: FormEvent) => void;
  onSendTest: () => void;
  onClose: () => void;
}) {
  const conflict = Boolean(latest && editor.revision !== latest.revision);
  return (
    <AutomationModal
      titleId="automation-reminder-settings-title"
      title="提醒与通知设置"
      subtitle="配置桌面通知、免打扰时段与久未推进扫描阈值。"
      pending={pending}
      onClose={onClose}
      modalClassName="reminder-settings-modal"
      dialogClassName="reminder-settings-dialog"
    >
      <form className="automation-editor" aria-label="提醒与通知设置" onSubmit={onSubmit}>
        <div className="automation-actions">
          <label className="automation-check">
            <input
              type="checkbox"
              data-autofocus
              checked={editor.desktopNotificationsEnabled}
              disabled={pending}
              onChange={(event) => onChange({ desktopNotificationsEnabled: event.target.checked })}
            />
            启用桌面通知
          </label>
        </div>
        <label>
          免打扰开始（上海时间）
          <input
            type="time"
            required
            value={editor.quietHoursStart}
            disabled={pending}
            onChange={(event) => onChange({ quietHoursStart: event.target.value })}
          />
        </label>
        <label>
          免打扰结束（上海时间）
          <input
            type="time"
            required
            value={editor.quietHoursEnd}
            disabled={pending}
            onChange={(event) => onChange({ quietHoursEnd: event.target.value })}
          />
        </label>
        <label>
          久未推进天数
          <input
            type="number"
            min="0"
            max="90"
            step="1"
            required
            value={editor.staleDays}
            disabled={pending}
            onChange={(event) => onChange({ staleDays: event.target.value })}
          />
        </label>
        <label>
          单次通知上限
          <input
            type="number"
            min="1"
            max="10"
            step="1"
            required
            value={editor.maxToastsPerRun}
            disabled={pending}
            onChange={(event) => onChange({ maxToastsPerRun: event.target.value })}
          />
        </label>
        {conflict && (
          <div className="automation-conflict">
            <p>读取最新设置会替换当前输入。</p>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={(event) => {
                focusDialogControl(event.currentTarget);
                onReload();
              }}
            >
              读取最新设置
            </button>
          </div>
        )}
        <div className="automation-actions">
          <button className="primary-button" type="submit" disabled={!canWrite || conflict}>
            {pending ? '正在保存…' : '保存提醒设置'}
          </button>
          <button className="secondary-button" type="button" disabled={!canWrite} onClick={onSendTest}>
            发送测试通知
          </button>
          <button className="secondary-button" type="button" disabled={pending} onClick={onClose}>
            取消
          </button>
        </div>
        {feedback && (
          <p className={feedback.error ? 'form-error' : undefined} role={feedback.error ? 'alert' : 'status'}>
            {feedback.text}
          </p>
        )}
      </form>
      <p className="automation-modal-note">免打扰起止时间相同时关闭免打扰。久未推进天数设为 0 时停用该提醒。</p>
    </AutomationModal>
  );
}

/** Confirmation modal before saving news candidates to Raw and optionally starting organization. */
export function CandidateConfirmationDialog({
  value,
  pending,
  error,
  onChange,
  onClose,
  onConfirm,
}: {
  value: { request: ConfirmCandidates; items: CandidateView[] };
  pending: boolean;
  error: string;
  onChange: (request: ConfirmCandidates) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { request, items } = value;
  return (
    <AutomationModal
      titleId="candidate-confirm-title"
      title={`确认入库（${items.length} 条）`}
      pending={pending}
      onClose={onClose}
      modalClassName="candidate-modal"
      dialogClassName="candidate-dialog"
    >
      <ul>
        {items.map((row) => (
          <li key={row.id}>
            <strong>{row.item.title}</strong>
            <br />
            {evidenceLabel(row)}
          </li>
        ))}
      </ul>
      <label className="candidate-check">
        <input
          type="checkbox"
          disabled={pending}
          checked={request.organize}
          onChange={(event) => onChange({ ...request, organize: event.target.checked })}
        />
        确认后自动整理
      </label>
      {request.organize && (
        <label className="candidate-mode">
          整理模式
          <select
            value={request.mode}
            disabled={pending}
            onChange={(event) => onChange({ ...request, mode: event.target.value as ConfirmCandidates['mode'] })}
          >
            <option value="standard">标准整理</option>
            <option value="deep">深度整理</option>
          </select>
        </label>
      )}
      <p>
        {request.organize
          ? '确认后获取来源材料。获取完整时自动整理，草稿等待人工审核。遇到缺失时等待你决定。'
          : '确认后获取来源材料并保存到 Raw。遇到缺失时等待你决定。'}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="automation-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={onConfirm}>
          {pending ? '正在提交…' : '确认并入库'}
        </button>
        <button type="button" className="secondary-button" data-autofocus disabled={pending} onClick={onClose}>
          取消
        </button>
      </div>
    </AutomationModal>
  );
}
