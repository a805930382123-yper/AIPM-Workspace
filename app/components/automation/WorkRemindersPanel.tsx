import { useEffect, useRef, useState } from 'react';
import type { ReminderView } from '../../api';
import { acknowledgeReminder, snoozeReminder } from '../../api';
import {
  describeError,
  issueLabels,
  reminderDeliveryLabels,
  reminderKinds,
  reminderKindTone,
  reminderStatuses,
  type ReminderFilterKind,
} from './automationMeta';

export type WorkRemindersPanelProps = {
  token?: string;
  view: ReminderView | null;
  readError: string;
  focusTick: number;
  onViewChange: (next: ReminderView) => void;
  onChanged: () => void;
  onOpenSettings: () => void;
  onOpenWorkItem: (id: string, focusMaterials?: boolean) => void;
};

export function WorkRemindersPanel({
  token,
  view,
  readError,
  focusTick,
  onViewChange,
  onChanged,
  onOpenSettings,
  onOpenWorkItem,
}: WorkRemindersPanelProps) {
  const [kindFilter, setKindFilter] = useState<ReminderFilterKind>('all');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ area: string; text: string; error?: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusTick) return;
    heading.current?.scrollIntoView?.({ block: 'nearest' });
    heading.current?.focus();
  }, [focusTick]);

  const write = async (area: string, operation: (writeToken: string) => Promise<{ text: string; error?: boolean }>) => {
    if (!token || pending) return;
    setPending(true);
    setFeedback(null);
    try {
      setFeedback({ area, ...(await operation(token)) });
    } catch (error) {
      setFeedback({ area, error: true, text: describeError(error) });
    } finally {
      onChanged();
      setPending(false);
    }
  };

  const showFeedback = (area: string) =>
    feedback?.area === area && (
      <p className={feedback.error ? 'form-error' : undefined} role={feedback.error ? 'alert' : 'status'}>
        {feedback.text}
      </p>
    );

  const canWrite = Boolean(token && !pending);
  const items = view?.items ?? [];
  const filteredItems = kindFilter === 'all' ? items : items.filter((item) => item.kind === kindFilter);
  const dueCount = items.filter((item) => item.kind === 'due_follow_up').length;
  const staleCount = items.filter((item) => item.kind === 'stale_item').length;
  const rawReadyCount = items.filter((item) => item.kind === 'new_raw_ready').length;

  return (
    <section className="panel automation-panel" aria-labelledby="automation-reminders">
      <div className="automation-heading">
        <div>
          <h2 id="automation-reminders" ref={heading} tabIndex={-1}>
            事项提醒
          </h2>
          {view && (
            <p>
              {view.unreadCount} 条未读 · 共 {view.items.length} 条活动提醒
            </p>
          )}
        </div>
        <button type="button" className="secondary-button" disabled={pending || !view} onClick={onOpenSettings}>
          提醒与通知设置
        </button>
      </div>
      {readError && (
        <p className="form-error" role="alert">
          事项提醒读取失败。{readError}
        </p>
      )}
      {!view && !readError && <p role="status">正在读取事项提醒…</p>}
      {view?.issues.map((issue) => (
        <p key={issue.file} className="form-error" role="alert">
          {issueLabels[issue.reason]} · {issue.file}
        </p>
      ))}
      {view && (
        <div className="automation-filter-chips" role="group" aria-label="提醒类型筛选">
          {(
            [
              ['all', '全部', items.length],
              ['due_follow_up', '到期跟进', dueCount],
              ['stale_item', '久未推进', staleCount],
              ['new_raw_ready', '新资料待分析', rawReadyCount],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className="automation-filter-chip"
              aria-pressed={kindFilter === key}
              onClick={() => setKindFilter(key)}
            >
              <span>{label}</span>
              <span className="automation-chip-count">{count}</span>
            </button>
          ))}
        </div>
      )}
      {view && items.length === 0 && <p>暂无活动提醒。</p>}
      {view && items.length > 0 && filteredItems.length === 0 && (
        <div className="automation-empty-inline">
          <p>当前分类暂无提醒。</p>
          <button type="button" className="text-button" onClick={() => setKindFilter('all')}>
            显示全部提醒
          </button>
        </div>
      )}
      {filteredItems.length > 0 && (
        <ul className="automation-list automation-reminder-list">
          {filteredItems.map((item) => {
            const newMaterials = item.kind === 'new_raw_ready';
            const tone = item.status === 'unread' ? reminderKindTone(item.kind) : 'muted';
            return (
              <li key={item.id} aria-label={item.itemTitle} data-status={item.status} data-tone={tone}>
                <div>
                  <div className="automation-badges">
                    <span className="automation-pill" data-tone={tone}>
                      {reminderKinds[item.kind]}
                    </span>
                    <span className="automation-pill" data-tone={item.status === 'unread' ? 'accent' : 'muted'}>
                      {reminderStatuses[item.status]}
                    </span>
                  </div>
                  <h3>{item.itemTitle}</h3>
                  <p>{item.summary}</p>
                  <p className="automation-reminder-meta">
                    {reminderStatuses[item.status]}
                    {item.snoozedUntil && (
                      <>
                        至 <time dateTime={item.snoozedUntil}>{item.snoozedUntil}</time>
                      </>
                    )}
                    {' · 桌面通知 '}
                    {reminderDeliveryLabels[item.deliveryStatus]}
                  </p>
                  {item.deliveryStatus === 'failed' && item.deliveryError && (
                    <p className="form-error">{item.deliveryError}</p>
                  )}
                  {showFeedback(item.id)}
                </div>
                <div className="automation-actions">
                  {item.status === 'unread' && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canWrite}
                      onClick={() =>
                        void write(item.id, async (writeToken) => {
                          onViewChange(await acknowledgeReminder(item.id, writeToken));
                          return { text: '提醒已标为已读。' };
                        })
                      }
                    >
                      已读
                    </button>
                  )}
                  {(item.status === 'unread' || item.status === 'acknowledged') && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canWrite}
                      onClick={() =>
                        void write(item.id, async (writeToken) => {
                          onViewChange(await snoozeReminder(item.id, writeToken));
                          return { text: '提醒已延后一天。' };
                        })
                      }
                    >
                      延后一天
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onOpenWorkItem(item.itemId, newMaterials)}
                  >
                    {newMaterials ? '前往分析' : '打开事项'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
