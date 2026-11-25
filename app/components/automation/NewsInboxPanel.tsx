import { useEffect, useRef, useState } from 'react';
import type { CandidateList, CandidateView, ConfirmCandidates, PipelineSettings } from '../../api';
import { changeCandidateDisposition, confirmCandidates, retryCandidate, supplementCandidate } from '../../api';
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
  type InboxCandidateFilter,
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

export type NewsInboxPanelProps = {
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
  onOpenWiki?: (id: string) => void;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
};

export function NewsInboxPanel({
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
  onOpenWiki,
  onOpenRun,
}: NewsInboxPanelProps) {
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
    const draftId = row.draftId ?? row.execution?.draftId;
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
          {((phase && !['saved', 'draft_ready'].includes(phase)) || row.draftPending) && (
            <span className="automation-pill" data-tone={phaseTone}>
              {row.draftPending ? '草稿待确认' : candidateStages[phase!]}
            </span>
          )}
        </div>
        {score?.reason && <p className="automation-candidate-reason">{score.reason}</p>}
        <details>
          <summary>展开摘录</summary>
          <p className="candidate-excerpt">{row.item.excerpt}</p>
        </details>
        {row.missingRaw && <p>原 Raw 已删除</p>}
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
                {row.missingRaw ? '重新导入 Raw' : '确认入库'}
              </button>
              {!row.confirmation && row.disposition !== 'later' && (
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
              {!row.confirmation && (
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
              )}
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
              已保存 Raw{row.material ? ` · ${newsMaterialLabels[row.material.kind]}` : ''} · 打开 Raw
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
          {row.draftPending && draftId && (
            <button type="button" className="secondary-button" onClick={() => onOpenDraft(draftId)}>
              审核草稿
            </button>
          )}
          {row.wikiId && (
            <button type="button" className="text-button" onClick={() => onOpenWiki?.(row.wikiId!)}>
              已导入知识库 · 查看条目
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
              {phase === 'raw_failed'
                ? row.missingRaw
                  ? '重新导入 Raw'
                  : '重试保存 Raw'
                : phase === 'interrupted'
                  ? '继续整理'
                  : '重试整理'}
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
