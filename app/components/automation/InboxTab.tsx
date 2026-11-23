import { useEffect, useRef, useState } from 'react';
import type { CandidateList, CandidateView, ConfirmCandidates, PipelineSettings, ReminderView } from '../../api';
import {
  acknowledgeReminder,
  changeCandidateDisposition,
  confirmCandidates,
  retryCandidate,
  supplementCandidate,
  snoozeReminder,
} from '../../api';
import { newsMaterialLabels } from '../../../services/news/types';
import { CandidateConfirmationDialog } from './AutomationDialogs';
import {
  canConfirmCandidate,
  candidateScore,
  candidateStages,
  candidateViews,
  describeError,
  evidenceLabel,
  isFailedCandidate,
  isOrganizingCandidate,
  issueLabels,
  reminderDeliveryLabels,
  reminderKindTone,
  reminderKinds,
  reminderStatuses,
  type InboxCandidateFilter,
  type InboxSection,
  type ReminderFilterKind,
} from './automationMeta';

const funnelStages: Array<{
  key: InboxCandidateFilter;
  label: string;
  countKey: keyof CandidateList['counts'];
}> = [
  { key: 'fetched', label: '已抓取', countKey: 'fetched' },
  { key: 'pending', label: '待确认', countKey: 'pending' },
  { key: 'organizing', label: '整理中', countKey: 'organizing' },
  { key: 'drafts', label: '待审草稿', countKey: 'drafts' },
  { key: 'failed', label: '失败', countKey: 'failed' },
];

type WorkRemindersPanelProps = {
  token?: string;
  view: ReminderView | null;
  readError: string;
  focusTick: number;
  onViewChange: (next: ReminderView) => void;
  onChanged: () => void;
  onOpenSettings: () => void;
  onOpenWorkItem: (id: string, focusMaterials?: boolean) => void;
};

function WorkRemindersPanel({
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

type NewsInboxProps = {
  candidates?: CandidateList;
  readError: string;
  date?: string;
  onDateChange: (nextDate?: string) => void;
  filter: InboxCandidateFilter;
  onFilterChange: (nextFilter: InboxCandidateFilter) => void;
  focusTick: number;
  token?: string;
  paused?: boolean;
  pipelineSettings?: PipelineSettings;
  pipelineSettingsError: string;
  onOpenPipelineSettings: () => void;
  onChanged: () => void;
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
};

function NewsInbox({
  candidates,
  readError,
  date,
  onDateChange,
  filter,
  onFilterChange,
  focusTick,
  token,
  paused,
  pipelineSettings,
  pipelineSettingsError,
  onOpenPipelineSettings,
  onChanged,
  onOpenRaw,
  onOpenDraft,
  onOpenRun,
}: NewsInboxProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{ request: ConfirmCandidates; items: CandidateView[] }>();
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [expandedLow, setExpandedLow] = useState(false);
  const inboxHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusTick) return;
    inboxHeading.current?.focus();
    inboxHeading.current?.scrollIntoView?.();
  }, [focusTick]);

  const write = async (operation: (writeToken: string) => Promise<void>) => {
    if (!token || pending) return;
    setPending(true);
    setWriteError('');
    setAccepted(false);
    try {
      await operation(token);
    } catch (error) {
      setWriteError(describeError(error));
    } finally {
      setPending(false);
      onChanged();
    }
  };

  const begin = (items: CandidateView[]) => {
    setWriteError('');
    setAccepted(false);
    setConfirmation({
      items,
      request: {
        requestId: crypto.randomUUID(),
        candidateIds: items.map((row) => row.id),
        organize: true,
        mode: 'standard',
      },
    });
  };

  const selectFilter = (nextFilter: InboxCandidateFilter) => {
    onFilterChange(nextFilter);
    setSelected([]);
    setExpandedLow(false);
  };

  const items = (candidates?.items ?? [])
    .filter((row) => {
      if (filter === 'fetched') return true;
      if (filter === 'ignored') return row.disposition === 'ignored';
      if (filter === 'pending') return canConfirmCandidate(row);
      if (filter === 'organizing') return isOrganizingCandidate(row);
      if (filter === 'drafts') return Boolean(row.draftPending);
      if (filter === 'failed') return isFailedCandidate(row);
      return row.disposition !== 'ignored';
    })
    .sort((a, b) => (candidateScore(b)?.relevance ?? -1) - (candidateScore(a)?.relevance ?? -1));
  const low = items.filter((row) => candidateScore(row)?.relevance === 0);
  const visible = items.filter((row) => candidateScore(row)?.relevance !== 0);
  const confirmableVisible = [...visible, ...(expandedLow ? low : [])].filter(canConfirmCandidate);
  const allConfirmableSelected =
    confirmableVisible.length > 0 && confirmableVisible.every((row) => selected.includes(row.id));
  const batch = items.filter(
    (row) =>
      selected.includes(row.id) && canConfirmCandidate(row) && (expandedLow || candidateScore(row)?.relevance !== 0),
  );

  const renderCandidate = (row: CandidateView) => {
    const score = candidateScore(row);
    const phase = row.execution?.phase;
    const available = canConfirmCandidate(row);
    const screenError = row.screening && 'error' in row.screening ? row.screening.error : undefined;
    const scoreTone = score
      ? score.relevance >= 3
        ? 'accent'
        : score.relevance === 2
          ? 'safe'
          : 'muted'
      : screenError
        ? 'warning'
        : 'muted';
    const phaseTone = row.draftPending
      ? 'accent'
      : isFailedCandidate(row)
        ? 'danger'
        : isOrganizingCandidate(row)
          ? 'warning'
          : 'ok';

    return (
      <article className="news-candidate" key={row.id} aria-label={row.item.title}>
        <div className="automation-heading">
          <div>
            <h3>{row.item.title}</h3>
            <p>
              {row.section === 'fmcg' ? '快消研报' : 'AI 前沿'} · {row.item.sourceName} ·{' '}
              {row.item.publishedAt ? row.item.publishedAt.slice(0, 10) : '未提供发布日期'} · {evidenceLabel(row)}
            </p>
          </div>
          {available && (
            <label className="candidate-check">
              <input
                type="checkbox"
                aria-label={`选择 ${row.item.title}`}
                checked={selected.includes(row.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                  )
                }
              />
              选择
            </label>
          )}
        </div>
        <div className="automation-candidate-pills">
          <span className="automation-pill" data-tone={scoreTone}>
            {score
              ? `AI 预筛（仅供参考） · 相关性 ${score.relevance}/3`
              : `未预筛${screenError ? ` · ${screenError}` : ''}`}
          </span>
          {score && (
            <span className="automation-pill" data-tone={score.suggestedMode === 'deep' ? 'accent' : 'neutral'}>
              建议{score.suggestedMode === 'deep' ? '深度整理' : '标准整理'}
            </span>
          )}
          {score && score.categories.length > 0 && (
            <span className="automation-pill" data-tone="neutral">
              {score.categories.join('、')}
            </span>
          )}
          {(row.disposition === 'later' || row.disposition === 'ignored') && (
            <span className="automation-pill" data-tone="muted">
              {row.disposition === 'later' ? '稍后处理' : '已忽略'}
            </span>
          )}
          {((phase && phase !== 'saved') || row.draftPending) && (
            <span className="automation-pill" data-tone={phaseTone}>
              {row.draftPending ? '草稿待审核' : candidateStages[phase!]}
            </span>
          )}
        </div>
        {score?.reason && <p className="automation-candidate-reason">{score.reason}</p>}
        <details>
          <summary>展开摘录</summary>
          <p className="candidate-excerpt">{row.item.excerpt}</p>
        </details>
        {row.confirmation && !row.savedRawId && (phase === 'saved' || phase === 'draft_ready') && (
          <p>原入库资料已缺失。</p>
        )}
        {row.saveIssue && <p className="form-error">入库收据读取失败。</p>}
        {row.material?.issue && <p className="extract-note">{row.material.issue}</p>}
        {!row.draftPending && row.execution?.error && <p className="form-error">{row.execution.error}</p>}
        <div className="automation-actions">
          {available && (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={pending || !token}
                onClick={() => begin([row])}
              >
                确认入库
              </button>
              {row.disposition !== 'later' && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending || !token}
                  onClick={() =>
                    void write((value) => changeCandidateDisposition(row.id, 'later', value).then(() => undefined))
                  }
                >
                  稍后
                </button>
              )}
              <button
                type="button"
                className="text-button"
                disabled={pending || !token}
                onClick={() =>
                  void write((value) => changeCandidateDisposition(row.id, 'ignore', value).then(() => undefined))
                }
              >
                忽略
              </button>
            </>
          )}
          {!row.confirmation && !row.savedRawId && row.disposition !== 'inbox' && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !token}
              onClick={() =>
                void write((value) => changeCandidateDisposition(row.id, 'restore', value).then(() => undefined))
              }
            >
              恢复到收件箱
            </button>
          )}
          {row.savedRawId && (
            <button type="button" className="text-button" onClick={() => onOpenRaw(row.savedRawId!)}>
              已入库{row.material ? ` · ${newsMaterialLabels[row.material.kind]}` : ''} · 打开 Raw
            </button>
          )}
          {row.material?.canSupplement && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !token}
              onClick={() => void write((token) => supplementCandidate(row.id, token).then(() => undefined))}
            >
              补采来源正文
            </button>
          )}
          {row.draftPending && row.execution?.draftId && (
            <button type="button" className="secondary-button" onClick={() => onOpenDraft(row.execution!.draftId!)}>
              审核草稿
            </button>
          )}
          {phase === 'raw_failed' && row.execution?.canKeepPartial && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !token}
              onClick={() => void write((token) => retryCandidate(row.id, 'save', token, true).then(() => undefined))}
            >
              仅保留可用材料
            </button>
          )}
          {!row.draftPending && (phase === 'raw_failed' || phase === 'organize_failed' || phase === 'interrupted') && (
            <button
              type="button"
              className="secondary-button"
              disabled={pending || !token}
              onClick={() =>
                void write((value) =>
                  retryCandidate(row.id, phase === 'raw_failed' ? 'save' : 'organize', value).then(() => undefined),
                )
              }
            >
              {phase === 'raw_failed' ? '重试保存 Raw' : phase === 'interrupted' ? '继续整理' : '重试整理'}
            </button>
          )}
          {row.execution && phase !== 'queued_raw' && phase !== 'queued_organize' && (
            <button
              type="button"
              className="text-button"
              onClick={(event) => onOpenRun(row.execution!.runId, event.currentTarget)}
            >
              查看运行
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section id="news-candidates" className="panel automation-panel" aria-labelledby="news-candidate-title">
      <div className="automation-heading">
        <div>
          <h2 id="news-candidate-title" ref={inboxHeading} tabIndex={-1}>
            资讯候选收件箱
          </h2>
          <p>{paused ? '全局暂停。已确认条目将在恢复后继续排队执行。' : '确认后才保存 Raw。AI 草稿需要人工审核。'}</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={pending || !pipelineSettings}
          onClick={onOpenPipelineSettings}
        >
          流水线设置
        </button>
      </div>
      {pipelineSettingsError && (
        <p className="form-error" role="alert">
          {pipelineSettingsError}
        </p>
      )}
      <div className="automation-funnel" role="group" aria-label="资讯处理漏斗">
        <div className="automation-funnel-stages">
          {funnelStages.map((stage) => {
            const count = candidates?.counts[stage.countKey];
            const tone = !count
              ? 'muted'
              : stage.key === 'failed'
                ? 'danger'
                : stage.key === 'pending' || stage.key === 'drafts'
                  ? 'review'
                  : 'neutral';
            const active = filter === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                className="automation-funnel-stage"
                data-tone={tone}
                aria-pressed={active}
                onClick={() => selectFilter(active ? 'all' : stage.key)}
              >
                <span>{stage.label}</span>
                <strong>{count ?? '—'}</strong>
              </button>
            );
          })}
        </div>
        <div className="automation-funnel-quick">
          <button
            type="button"
            className="automation-filter-chip"
            aria-pressed={filter === 'all'}
            onClick={() => selectFilter('all')}
          >
            收件箱（全部未忽略）
          </button>
          <button
            type="button"
            className="automation-filter-chip"
            aria-pressed={filter === 'ignored'}
            onClick={() => selectFilter(filter === 'ignored' ? 'all' : 'ignored')}
          >
            已忽略
          </button>
        </div>
      </div>
      <div className="automation-filters">
        <label>
          资讯日期
          <select
            value={date ?? ''}
            onChange={(event) => {
              onDateChange(event.target.value || undefined);
              setSelected([]);
              setExpandedLow(false);
            }}
          >
            <option value="">今日</option>
            {candidates?.dates.map((day) => (
              <option key={day}>{day}</option>
            ))}
            {date && !candidates?.dates.includes(date) && <option>{date}</option>}
          </select>
        </label>
        <label>
          候选状态
          <select value={filter} onChange={(event) => selectFilter(event.target.value as InboxCandidateFilter)}>
            {candidateViews.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {confirmableVisible.length > 0 && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending || !token}
            onClick={() =>
              setSelected((current) =>
                allConfirmableSelected
                  ? current.filter((id) => !confirmableVisible.some((row) => row.id === id))
                  : [...new Set([...current, ...confirmableVisible.map((row) => row.id)])],
              )
            }
          >
            {allConfirmableSelected ? '取消全选' : `全选可确认项（${confirmableVisible.length} 条）`}
          </button>
        )}
        {batch.length > 0 && (
          <button type="button" className="primary-button" disabled={pending || !token} onClick={() => begin(batch)}>
            批量确认入库（{batch.length} 条）
          </button>
        )}
      </div>
      {readError && (
        <p className="form-error" role="alert">
          收件箱读取失败 · {readError}
        </p>
      )}
      {!candidates && !readError && <p role="status">正在读取资讯候选…</p>}
      {writeError && !confirmation && (
        <p className="form-error" role="alert">
          {writeError}
        </p>
      )}
      {accepted && <p role="status">入库已排队。可在收件箱查看每条进度。</p>}
      {candidates && (
        <p>
          {candidates.date} · {items.length} 条
        </p>
      )}
      {candidates && !items.length && <p>此日期暂无符合条件的资讯候选。</p>}
      {visible.map(renderCandidate)}
      {low.length > 0 && (
        <details
          className="candidate-low"
          open={expandedLow}
          onToggle={(event) => setExpandedLow(event.currentTarget.open)}
        >
          <summary>低相关性（{low.length} 条）</summary>
          {low.map(renderCandidate)}
        </details>
      )}
      {confirmation && (
        <CandidateConfirmationDialog
          value={confirmation}
          pending={pending}
          error={writeError}
          onChange={(request) => setConfirmation({ ...confirmation, request })}
          onClose={() => {
            setConfirmation(undefined);
            setWriteError('');
          }}
          onConfirm={() =>
            void write(async (writeToken) => {
              await confirmCandidates(confirmation.request, writeToken);
              setConfirmation(undefined);
              setSelected([]);
              setAccepted(true);
            })
          }
        />
      )}
    </section>
  );
}

export type InboxTabProps = {
  showReminders: boolean;
  hasPipeline: boolean;
  section: InboxSection;
  onSectionChange: (next: InboxSection) => void;
  focusTarget: InboxSection | null;
  focusTick: number;
  token?: string;
  paused?: boolean;
  candidates?: CandidateList;
  candidatesReadError: string;
  candidateDate?: string;
  onCandidateDateChange: (nextDate?: string) => void;
  candidateFilter: InboxCandidateFilter;
  onCandidateFilterChange: (nextFilter: InboxCandidateFilter) => void;
  pipelineSettings?: PipelineSettings;
  pipelineSettingsError: string;
  onOpenPipelineSettings: () => void;
  onPipelineChanged: () => void;
  remindersView: ReminderView | null;
  remindersReadError: string;
  onRemindersViewChange: (next: ReminderView) => void;
  onRemindersChanged: () => void;
  onOpenReminderSettings: () => void;
  onOpenWorkItem?: (id: string, focusMaterials?: boolean) => void;
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
};

/** Combined inbox tab holding the 5-stage news candidate funnel and categorized work reminders. */
export function InboxTab({
  showReminders,
  hasPipeline,
  section,
  onSectionChange,
  focusTarget,
  focusTick,
  token,
  paused,
  candidates,
  candidatesReadError,
  candidateDate,
  onCandidateDateChange,
  candidateFilter,
  onCandidateFilterChange,
  pipelineSettings,
  pipelineSettingsError,
  onOpenPipelineSettings,
  onPipelineChanged,
  remindersView,
  remindersReadError,
  onRemindersViewChange,
  onRemindersChanged,
  onOpenReminderSettings,
  onOpenWorkItem,
  onOpenRaw,
  onOpenDraft,
  onOpenRun,
}: InboxTabProps) {
  if (!showReminders && !hasPipeline) {
    return (
      <section className="panel automation-panel">
        <p>当前未启用收件箱或事项提醒来源。</p>
      </section>
    );
  }

  const showSubtabs = showReminders && hasPipeline;
  const activeSection: InboxSection = showSubtabs ? section : hasPipeline ? 'candidates' : 'reminders';
  const pendingCandidates = candidates?.counts.pending ?? 0;
  const unreadReminders = remindersView?.unreadCount ?? 0;

  const renderCandidates = () => (
    <NewsInbox
      candidates={candidates}
      readError={candidatesReadError}
      date={candidateDate}
      onDateChange={onCandidateDateChange}
      filter={candidateFilter}
      onFilterChange={onCandidateFilterChange}
      focusTick={focusTarget === 'candidates' ? focusTick : 0}
      token={token}
      paused={paused}
      pipelineSettings={pipelineSettings}
      pipelineSettingsError={pipelineSettingsError}
      onOpenPipelineSettings={onOpenPipelineSettings}
      onChanged={onPipelineChanged}
      onOpenRaw={onOpenRaw}
      onOpenDraft={onOpenDraft}
      onOpenRun={onOpenRun}
    />
  );

  const renderReminders = () =>
    onOpenWorkItem ? (
      <WorkRemindersPanel
        token={token}
        view={remindersView}
        readError={remindersReadError}
        focusTick={focusTarget === 'reminders' ? focusTick : 0}
        onViewChange={onRemindersViewChange}
        onChanged={onRemindersChanged}
        onOpenSettings={onOpenReminderSettings}
        onOpenWorkItem={onOpenWorkItem}
      />
    ) : null;

  if (!showSubtabs) {
    return activeSection === 'candidates' ? renderCandidates() : renderReminders();
  }

  return (
    <>
      <div
        className="automation-subtabs"
        role="tablist"
        aria-label="收件箱分类"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next: InboxSection =
            event.key === 'Home'
              ? 'candidates'
              : event.key === 'End'
                ? 'reminders'
                : activeSection === 'candidates'
                  ? 'reminders'
                  : 'candidates';
          onSectionChange(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#automation-subtab-${next}`)?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id="automation-subtab-candidates"
          aria-controls="automation-subpanel-candidates"
          aria-selected={activeSection === 'candidates'}
          tabIndex={activeSection === 'candidates' ? 0 : -1}
          onClick={() => onSectionChange('candidates')}
        >
          资讯候选
          <span className="automation-subtab-badge">待确认 {pendingCandidates}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="automation-subtab-reminders"
          aria-controls="automation-subpanel-reminders"
          aria-selected={activeSection === 'reminders'}
          tabIndex={activeSection === 'reminders' ? 0 : -1}
          onClick={() => onSectionChange('reminders')}
        >
          事项提醒
          <span className="automation-subtab-badge">未读 {unreadReminders}</span>
        </button>
      </div>
      <div
        role="tabpanel"
        id="automation-subpanel-candidates"
        aria-labelledby="automation-subtab-candidates"
        hidden={activeSection !== 'candidates'}
      >
        {activeSection === 'candidates' && renderCandidates()}
      </div>
      <div
        role="tabpanel"
        id="automation-subpanel-reminders"
        aria-labelledby="automation-subtab-reminders"
        hidden={activeSection !== 'reminders'}
      >
        {activeSection === 'reminders' && renderReminders()}
      </div>
    </>
  );
}
