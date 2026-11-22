import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError,
  api,
  automationRun,
  automationStatus,
  automationTime,
  getWeeklyReview,
  regenerateWeeklyReview,
  saveWeeklyReview,
  updateWeeklyReviewSettings,
  weeklyReviewExportUrl,
  weeklyReviewMarkdown,
  weeklyReviews,
} from '../api';
import type {
  AutomationRun,
  ReviewSection,
  WeeklyReview,
  WeeklyReviewList,
  WeeklyReviewSummary,
  WeeklyReviewTarget,
} from '../api';
import type { HomeAction } from '../../services/home/actions';
import type { periodReview } from '../../services/home/review';
type Review = Awaited<ReturnType<typeof periodReview>>;
function week() {
  const now = new Date(Date.now() + 8 * 3600_000);
  const day = now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)));
  const end = new Date(monday.getTime() + 7 * 86400_000);
  return [monday.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}
const outcomes: Record<string, string> = {
  helpful: '有帮助',
  needs_revision: '需较多修改',
  not_applicable: '不适用',
  unverified: '尚未验证',
};
type ReviewNavigation = { onOpenWiki: (id: string) => void; onOpenAction: (item: HomeAction) => void };
export function PeriodReview({
  onClose,
  onOpenWiki,
  onOpenAction,
  initialWeekKey,
  onOpenReference,
}: ReviewNavigation & {
  onClose: () => void;
  initialWeekKey?: string;
  onOpenReference?: (target: WeeklyReviewTarget) => void;
}) {
  const [tab, setTab] = useState<'realtime' | 'weekly'>(initialWeekKey ? 'weekly' : 'realtime');
  const [openedRealtime, setOpenedRealtime] = useState(!initialWeekKey);
  const [openedWeekly, setOpenedWeekly] = useState(Boolean(initialWeekKey));
  const weeklyTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (initialWeekKey) weeklyTab.current?.focus();
  }, [initialWeekKey]);
  const selectTab = (value: typeof tab) => {
    setTab(value);
    if (value === 'weekly') setOpenedWeekly(true);
    else setOpenedRealtime(true);
  };
  return (
    <section className="panel period-review" aria-label="周期回顾">
      <div className="panel-heading">
        <div>
          <h2>周期回顾</h2>
          <p hidden={tab !== 'realtime'}>Asia/Shanghai · 开始日期包含，结束日期不包含。</p>
        </div>
        <button className="text-button" onClick={onClose}>
          关闭回顾
        </button>
      </div>
      <div
        className="home-a-tabs period-review-tabs"
        role="tablist"
        aria-label="回顾视图"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 'realtime'
              : event.key === 'End'
                ? 'weekly'
                : tab === 'realtime'
                  ? 'weekly'
                  : 'realtime';
          selectTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#period-review-tab-${next}`)?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id="period-review-tab-realtime"
          aria-controls="period-review-realtime"
          aria-selected={tab === 'realtime'}
          tabIndex={tab === 'realtime' ? 0 : -1}
          onClick={() => selectTab('realtime')}
        >
          实时周期查询
        </button>
        <button
          type="button"
          role="tab"
          id="period-review-tab-weekly"
          aria-controls="period-review-weekly"
          aria-selected={tab === 'weekly'}
          tabIndex={tab === 'weekly' ? 0 : -1}
          ref={weeklyTab}
          onClick={() => selectTab('weekly')}
        >
          自动周报草稿
        </button>
      </div>
      <div
        role="tabpanel"
        id="period-review-realtime"
        aria-labelledby="period-review-tab-realtime"
        hidden={tab !== 'realtime'}
      >
        {openedRealtime && <RealtimeReview onOpenWiki={onOpenWiki} onOpenAction={onOpenAction} />}
      </div>
      <div
        role="tabpanel"
        id="period-review-weekly"
        aria-labelledby="period-review-tab-weekly"
        hidden={tab !== 'weekly'}
      >
        {openedWeekly && <WeeklyReviewArchive initialWeekKey={initialWeekKey} onOpenReference={onOpenReference} />}
      </div>
    </section>
  );
}

function RealtimeReview({ onOpenWiki, onOpenAction }: ReviewNavigation) {
  const [initial] = useState(week);
  const [start, setStart] = useState(initial[0]);
  const [end, setEnd] = useState(initial[1]);
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const invalidRange = Boolean(start && end && start >= end);
  const load = async (a = start, b = end) => {
    if (a && b && a >= b) {
      generation.current++;
      setLoading(false);
      setData(null);
      setError('');
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await api<Review>(`/api/home/review?start=${encodeURIComponent(a)}&end=${encodeURIComponent(b)}`);
      if (current === generation.current) setData(result);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : '回顾读取失败。');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(initial[0], initial[1]);
    return () => {
      generation.current++;
    };
  }, []);
  const change = (fn: () => void) => {
    generation.current++;
    setLoading(false);
    setData(null);
    setError('');
    fn();
  };
  const wikiOpen = async (id: string, revision: number) => {
    const current = ++generation.current;
    try {
      const page = await api<{ id: string; revision: number }>(`/api/wiki/${encodeURIComponent(id)}`);
      if (current !== generation.current) return;
      if (page.id !== id || page.revision !== revision) throw Error('Wiki 已变化，请刷新回顾。');
      onOpenWiki(id);
    } catch {
      if (current === generation.current) setError('Wiki 已删除或变化，请刷新回顾。');
    }
  };
  const actionOpen = async (item: HomeAction) => {
    const current = ++generation.current;
    try {
      const fresh = await api<HomeAction>(
        `/api/home/actions/${item.kind}/${encodeURIComponent(item.id)}?versionToken=${encodeURIComponent(item.versionToken)}`,
      );
      if (current === generation.current) onOpenAction(fresh);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : '事项不可用，请刷新回顾。');
    }
  };
  return (
    <>
      <div className="review-dates">
        <label className="field">
          开始日期（含）
          <input type="date" value={start} onChange={(e) => change(() => setStart(e.target.value))} />
        </label>
        <label className="field">
          结束日期（不含）
          <input type="date" value={end} onChange={(e) => change(() => setEnd(e.target.value))} />
        </label>
        <button className="secondary-button" disabled={invalidRange} onClick={() => void load()}>
          刷新回顾
        </button>
      </div>
      {invalidRange && (
        <p className="form-error" role="alert">
          开始日期需早于结束日期。
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!invalidRange && !error && !data && (
        <p className="review-status-hint" role="status">
          {loading ? '正在读取周期回顾…' : `日期范围已调整为 ${start} 至 ${end}，请点击「刷新回顾」加载该周期数据。`}
        </p>
      )}
      {data && (
        <>
          <p>
            覆盖 {data.period.start}（含）至 {data.period.end}
            （不含），Asia/Shanghai；删除后的当前存量无法反推过去总量。
          </p>
          <section>
            <h3>期间新增、当前仍保留的 Wiki</h3>
            {data.knowledge.status === 'error' ? (
              <p role="alert">{data.knowledge.message}</p>
            ) : (
              <>
                <p>正式记录 · {data.knowledge.count} 条</p>
                {data.knowledge.items.length === 0 && <p>本周期无记录。</p>}
                {data.knowledge.items.map((item) => (
                  <div className="review-row" key={item.id}>
                    <span>
                      {item.title} · {item.id} · {item.created} · 第 {item.revision} 版
                    </span>
                    <button className="text-button" onClick={() => void wikiOpen(item.id, item.revision)}>
                      查看 Wiki
                    </button>
                  </div>
                ))}
                <details>
                  <summary>时间缺失或无效，无法归入周期 · {data.knowledge.undated.length} 条</summary>
                  {data.knowledge.undated.map((item) => (
                    <div className="review-row" key={item.id}>
                      <span>
                        {item.title} · {item.id} · {item.created ?? '未记录'} · 第 {item.revision} 版
                      </span>
                      <button className="text-button" onClick={() => void wikiOpen(item.id, item.revision)}>
                        查看 Wiki
                      </button>
                    </div>
                  ))}
                </details>
              </>
            )}
          </section>
          <section>
            <h3>当前待处理（不按周期筛选）</h3>
            <p>
              截至本次读取 {data.snapshotAt} · 已读取事项 {data.pending.items.length}
            </p>
            {Object.entries(data.pending.sources).map(
              ([name, state]) =>
                state.status === 'error' && (
                  <p role="alert" key={name}>
                    {name}：{state.message}
                  </p>
                ),
            )}
            {data.pending.items.length === 0 && Object.values(data.pending.sources).every((s) => s.status === 'ok') && (
              <p>当前没有需要处理的事项。</p>
            )}
            {data.pending.items.map((item) => (
              <div className="review-row" key={`${item.kind}:${item.id}`}>
                <span>
                  {item.title} · {item.problem}
                </span>
                <button className="text-button" onClick={() => void actionOpen(item)}>
                  {item.action}
                </button>
              </div>
            ))}
          </section>
          <section>
            <h3>周期内使用反馈</h3>
            <p>用户记录的使用体验 · 截至本次读取</p>
            {data.feedback.status === 'error' ? (
              <p role="alert">{data.feedback.message}</p>
            ) : (
              <>
                {data.feedback.items.length === 0 ? (
                  <p>本周期没有使用反馈。</p>
                ) : (
                  <p>
                    {Object.entries(data.feedback.counts)
                      .map(([key, value]) => `${outcomes[key]} ${value}`)
                      .join(' · ')}
                  </p>
                )}
                {data.feedback.items.map((item) => (
                  <details key={`${item.promptId}:${item.id}`}>
                    <summary>
                      {item.promptName} · {item.usedOn} · {outcomes[item.outcome]}
                    </summary>
                    <p>
                      Prompt ID：{item.promptId} · 使用版本：{item.promptVersion}
                    </p>
                    <p>
                      反馈 ID：{item.id} · 反馈版本：{item.revision}
                    </p>
                    <p>使用场景：{item.scenario}</p>
                    <p className="review-feedback-text">观察：{item.observation || '未填写'}</p>
                    <p className="review-feedback-text">改进建议：{item.nextImprovement || '未填写'}</p>
                  </details>
                ))}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

function isoReviewWeek(offset: number) {
  const thursday = new Date(`${week()[0]}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + offset * 7 + 3);
  const year = thursday.getUTCFullYear();
  const weekNumber = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 604_800_000) + 1;
  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

const weeklyIssues = { read: '读取失败', parse: 'JSON 损坏', directory: '目录无法读取', shape: '记录字段无效' };
const weekStatus = { draft: '草稿', reviewed: '已审阅归档' };
const aiStatus = { ready: 'AI 草稿就绪', facts_only: '仅事实快照', ai_failed: 'AI 起草失败' };
const generationEnd = {
  failed: '本次生成失败。',
  cancelled: '本次生成已取消。',
  interrupted: '本次生成已中断。',
  skipped: '本次生成已跳过。',
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请稍后重试。');
const runActive = (run: AutomationRun) => run.status === 'queued' || run.status === 'running';
type WeeklyAction = 'manual' | 'copy' | 'generation';

function ReviewBadges({ value }: { value: WeeklyReviewSummary }) {
  return (
    <span className="weekly-review-badges">
      <span className="tag">{weekStatus[value.status]}</span>
      <span className={`tag${value.aiStatus === 'ai_failed' ? ' weekly-review-failure' : ''}`}>
        {aiStatus[value.aiStatus]}
      </span>
    </span>
  );
}

function WeeklyReviewArchive({
  initialWeekKey,
  onOpenReference,
}: {
  initialWeekKey?: string;
  onOpenReference?: (target: WeeklyReviewTarget) => void;
}) {
  const [archive, setArchive] = useState<WeeklyReviewList | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(initialWeekKey ?? '');
  const [weekInput, setWeekInput] = useState(initialWeekKey ?? isoReviewWeek(-1));
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [writeToken, setWriteToken] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [conflict, setConflict] = useState<WeeklyAction | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [feedback, setFeedback] = useState<{ area: WeeklyAction; text: string; error?: boolean } | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [archiveVersion, setArchiveVersion] = useState(0);
  const [detailVersion, setDetailVersion] = useState(0);
  const [run, setRun] = useState<AutomationRun | null>(null);
  const knownWeek = archive?.items.some((item) => item.weekKey === selectedWeek) ?? false;
  const runningId = run && runActive(run) ? run.id : undefined;
  const dirty = Boolean(review && markdown !== review.userMarkdown);
  const protectedReview = Boolean(review && (review.userMarkdown.length > 0 || review.status === 'reviewed'));
  const locked = busy || Boolean(runningId);
  const canWrite = Boolean(writeToken && !locked && !reading && !conflict);

  useEffect(() => {
    const controller = new AbortController();
    void weeklyReviews(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setArchive(value);
        setArchiveError('');
        setSelectedWeek((current) => current || value.items[0]?.weekKey || isoReviewWeek(-1));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setArchiveError(errorMessage(error));
      });
    return () => controller.abort();
  }, [archiveVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void automationStatus(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWriteToken(value.writeToken);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setTokenError(errorMessage(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!knownWeek) return;
    const controller = new AbortController();
    setReading(true);
    setDetailError('');
    void getWeeklyReview(selectedWeek, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setReview(value);
        setMarkdown(value.userMarkdown);
        setConflict(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setReading(false);
      });
    return () => controller.abort();
  }, [knownWeek, selectedWeek, detailVersion]);

  const finishRun = useCallback((value: AutomationRun) => {
    setRun(value);
    setArchiveVersion((current) => current + 1);
    setDetailVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!runningId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await automationRun(runningId, controller.signal);
        if (controller.signal.aborted) return;
        if (runActive(value)) timer = setTimeout(() => void read(), 1000);
        else finishRun(value);
      } catch (error) {
        if (controller.signal.aborted) return;
        setRun(null);
        setFeedback({ area: 'generation', text: `运行详情读取失败。${errorMessage(error)}`, error: true });
        setArchiveVersion((current) => current + 1);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runningId, finishRun]);

  const choose = (key: string) => {
    if (key === selectedWeek || locked || (dirty && !window.confirm('切换周报会丢弃当前未保存的编辑。继续切换吗？')))
      return;
    setReview(null);
    setMarkdown('');
    setReading(false);
    setConflict(null);
    setConfirmRegenerate(false);
    setFeedback(null);
    setDetailError('');
    setRun(null);
    setSelectedWeek(key);
  };
  const action = async (area: WeeklyAction, operation: () => Promise<void>) => {
    if (locked) return;
    setBusy(true);
    setFeedback(null);
    try {
      await operation();
    } catch (error) {
      const versionConflict = error instanceof ApiError && error.code === 'WEEKLY_REVIEW_REVISION_CONFLICT';
      if (versionConflict) setConflict(area);
      setFeedback({
        area,
        text: versionConflict
          ? '周报已被其他操作更新。可从编辑框复制未保存的备注，再读取最新版本。'
          : errorMessage(error),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const save = (status?: WeeklyReview['status']) => {
    if (!review || !canWrite) return;
    void action('manual', async () => {
      const next = await saveWeeklyReview(
        review.weekKey,
        { baseRevision: review.revision, userMarkdown: markdown, status },
        writeToken,
      );
      setReview(next);
      setMarkdown(next.userMarkdown);
      setArchiveVersion((current) => current + 1);
      setFeedback({
        area: 'manual',
        text: status === 'reviewed' ? '已审阅归档。' : status === 'draft' ? '已恢复为草稿。' : '人工备注已保存。',
      });
    });
  };
  const regenerate = (overwriteEdited: boolean) => {
    if (!canWrite) return;
    setConfirmRegenerate(false);
    setRun(null);
    void action('generation', async () => {
      const next = await regenerateWeeklyReview(
        selectedWeek,
        { baseRevision: review?.revision ?? 0, overwriteEdited },
        writeToken,
      );
      if (runActive(next)) setRun(next);
      else finishRun(next);
    });
  };
  const changeAi = async (enabled: boolean) => {
    if (!archive || !writeToken || locked) return;
    setBusy(true);
    setSettingsError('');
    try {
      const settings = await updateWeeklyReviewSettings(
        { revision: archive.settings.revision, aiSummaryEnabled: enabled },
        writeToken,
      );
      setArchive((current) => (current ? { ...current, settings } : current));
    } catch (error) {
      setSettingsError(errorMessage(error));
      setArchiveVersion((current) => current + 1);
    } finally {
      setBusy(false);
    }
  };
  const reloadDetail = () => {
    setFeedback(null);
    setArchiveVersion((current) => current + 1);
    setDetailVersion((current) => current + 1);
  };
  const copyMarkdown = () => {
    if (!review) return;
    void action('copy', async () => {
      await navigator.clipboard.writeText(await weeklyReviewMarkdown(review.weekKey));
      setFeedback({ area: 'copy', text: '已复制保存的 Markdown。' });
    });
  };
  const navigate =
    onOpenReference &&
    ((target: WeeklyReviewTarget) => {
      if (!dirty || window.confirm('打开来源会离开本页并丢弃未保存的编辑。继续打开吗？')) onOpenReference(target);
    });
  const showFeedback = (area: WeeklyAction) =>
    feedback?.area === area && (
      <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'form-error' : 'weekly-review-notice'}>
        {feedback.text}
      </p>
    );
  const reloadButton = (
    <button type="button" className="secondary-button" disabled={locked || reading} onClick={reloadDetail}>
      读取最新版本
    </button>
  );

  return (
    <div className="weekly-review-layout">
      <aside className="weekly-review-sidebar" aria-label="周报列表与设置">
        <h3>周报档案</h3>
        {archiveError && (
          <p className="form-error" role="alert">
            档案读取失败。{archiveError}
          </p>
        )}
        {!archive && !archiveError && <p role="status">正在读取周报档案…</p>}
        {archive && archive.items.length === 0 && <p>还没有保存的周报。</p>}
        {archive && archive.items.length > 0 && (
          <ul className="weekly-review-list">
            {archive.items.map((item) => (
              <li key={item.weekKey}>
                <button
                  type="button"
                  disabled={locked}
                  aria-current={selectedWeek === item.weekKey ? 'true' : undefined}
                  onClick={() => choose(item.weekKey)}
                >
                  <strong>{item.weekKey}</strong>
                  <ReviewBadges value={item} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {archive?.issues.map((issue) => (
          <p key={issue.file} className="form-error" role="alert">
            {weeklyIssues[issue.reason]} · {issue.file}
          </p>
        ))}
        <form
          className="weekly-review-week-picker"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            choose(weekInput);
          }}
        >
          <label className="field">
            指定自然周
            <input
              type="week"
              required
              max={isoReviewWeek(0)}
              value={weekInput}
              disabled={locked}
              onChange={(event) => setWeekInput(event.target.value)}
            />
          </label>
          <button type="submit" className="secondary-button" disabled={locked}>
            查看该周
          </button>
        </form>
        {archive && (
          <div className="weekly-review-setting">
            <label>
              <input
                type="checkbox"
                checked={archive.settings.aiSummaryEnabled}
                disabled={!writeToken || locked}
                onChange={(event) => void changeAi(event.target.checked)}
              />
              启用 AI 周报总结
            </label>
            {settingsError && (
              <p className="form-error" role="alert">
                设置更新失败。{settingsError}
              </p>
            )}
          </div>
        )}
        {tokenError && (
          <p className="form-error" role="alert">
            周报操作暂不可用。{tokenError}
          </p>
        )}
      </aside>
      <div className="weekly-review-main">
        {selectedWeek && (
          <div className="weekly-review-heading">
            <div>
              <h3>{selectedWeek} 周报</h3>
              {review && <ReviewBadges value={review} />}
            </div>
            {review && (
              <div className="weekly-review-actions">
                <a
                  className="secondary-button"
                  href={weeklyReviewExportUrl(review.weekKey)}
                  download={`${review.weekKey}.md`}
                >
                  导出 Markdown
                </a>
                <button type="button" className="secondary-button" disabled={locked} onClick={copyMarkdown}>
                  复制 Markdown
                </button>
              </div>
            )}
          </div>
        )}
        {review && (
          <p className="weekly-review-context">
            {review.period.start}（含）至 {review.period.end}（不含） · 上海时间
            {review.period.partialWeek && ` · 部分周，截至 ${automationTime(review.period.until)}`}
            {` · 最后保存于 ${automationTime(review.updatedAt)}`}
          </p>
        )}
        {reading && <p role="status">正在读取周报…</p>}
        {detailError && (
          <p className="form-error" role="alert">
            周报读取失败。{detailError}
          </p>
        )}
        {archive && selectedWeek && !knownWeek && <p>所选周尚无周报。生成后会保存该周的事实快照。</p>}
        {showFeedback('copy')}
        {(detailError || archiveError) && reloadButton}

        {review && <WeeklyReviewContent review={review} onOpenReference={navigate} />}

        {review && (
          <section className="weekly-review-section" aria-labelledby="weekly-review-manual">
            <h3 id="weekly-review-manual">人工审阅与编辑</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label className="field">
                人工审阅备注（Markdown）
                <textarea
                  rows={6}
                  maxLength={100_000}
                  value={markdown}
                  disabled={locked || reading}
                  onChange={(event) => setMarkdown(event.target.value)}
                />
              </label>
              {dirty && <p className="weekly-review-context">有未保存的编辑。导出和复制使用已保存的版本。</p>}
              <div className="weekly-review-actions">
                <button type="submit" className="primary-button" disabled={!canWrite || !dirty}>
                  保存人工备注
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canWrite}
                  onClick={() => save(review.status === 'reviewed' ? 'draft' : 'reviewed')}
                >
                  {review.status === 'reviewed' ? '恢复为草稿' : '标记已审阅归档'}
                </button>
              </div>
              {showFeedback('manual')}
              {conflict === 'manual' && !detailError && reloadButton}
            </form>
          </section>
        )}
        {archive && selectedWeek && (review || !knownWeek) && (
          <div className="weekly-review-generate">
            {runningId && <p role="status">正在生成所选周报…</p>}
            {run && run.status in generationEnd && (
              <p className="form-error" role="alert">
                {generationEnd[run.status as keyof typeof generationEnd]}
                {run.error === 'paused' ? '全局自动化已暂停。' : run.error}
              </p>
            )}
            {showFeedback('generation')}
            {conflict === 'generation' && !detailError && reloadButton}
            {confirmRegenerate ? (
              <div role="group" aria-label="确认重新生成草稿">
                <p>
                  重新生成会替换本周已保存的草稿，清除{protectedReview ? '人工备注和归档状态' : '未保存的编辑'}。
                  {protectedReview && dirty ? '当前未保存的编辑也会丢弃。' : ''}
                </p>
                <div className="weekly-review-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!canWrite}
                    onClick={() => regenerate(protectedReview)}
                  >
                    确认重新生成
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setConfirmRegenerate(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="secondary-button"
                disabled={!canWrite}
                onClick={() => {
                  if (protectedReview || dirty) setConfirmRegenerate(true);
                  else regenerate(false);
                }}
              >
                {review ? '重新生成草稿' : '生成该周周报'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type FactLink = { label: string; elementId: string; target?: WeeklyReviewTarget };
const factId = (section: number, kind: 'metric' | 'entry', index: number) =>
  `weekly-review-fact-${section}-${kind}-${index}`;

function ReviewSource({
  fact,
  onOpenReference,
}: {
  fact: FactLink;
  onOpenReference?: (target: WeeklyReviewTarget) => void;
}) {
  if (fact.target?.kind === 'prompt')
    return (
      <a
        className="text-button"
        href={`/api/prompts/${encodeURIComponent(fact.target.id)}`}
        target="_blank"
        rel="noreferrer"
      >
        {fact.label}
      </a>
    );
  const target = fact.target;
  return (
    <button
      type="button"
      className="text-button"
      onClick={() => {
        if (target && onOpenReference) {
          onOpenReference(target);
          return;
        }
        const element = document.getElementById(fact.elementId);
        const disclosure = element?.closest('details');
        if (disclosure) disclosure.open = true;
        element?.focus();
      }}
    >
      {fact.label}
    </button>
  );
}

function WeeklyReviewContent({
  review,
  onOpenReference,
}: {
  review: WeeklyReview;
  onOpenReference?: (target: WeeklyReviewTarget) => void;
}) {
  const facts = new Map<string, FactLink>();
  review.snapshot.sections.forEach((section, index) => {
    if (section.status !== 'ok') return;
    section.metrics.forEach((metric, i) =>
      facts.set(metric.ref, { label: metric.label, elementId: factId(index, 'metric', i) }),
    );
    section.entries.forEach((entry, i) =>
      facts.set(entry.ref, { label: entry.title, elementId: factId(index, 'entry', i), target: entry.target }),
    );
  });
  const draft = review.draft;
  const citedGroup = (title: string, items: NonNullable<WeeklyReview['draft']>['highlights']) =>
    items.length > 0 && (
      <div className="weekly-review-draft-group">
        <h4>{title}</h4>
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              <p>{item.text}</p>
              <div className="weekly-review-sources" role="group" aria-label="事实依据">
                {[...new Set(item.refs)].map((ref) => {
                  const fact = facts.get(ref);
                  return fact && <ReviewSource key={ref} fact={fact} onOpenReference={onOpenReference} />;
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <>
      <section className="weekly-review-section" aria-labelledby="weekly-review-facts">
        <h3 id="weekly-review-facts">确定性事实快照</h3>
        {review.snapshot.sections.map((section, index) => (
          <FactSection key={section.key} section={section} index={index} onOpenReference={onOpenReference} />
        ))}
      </section>
      <section className="weekly-review-section" aria-labelledby="weekly-review-ai">
        <h3 id="weekly-review-ai">AI 周报草稿</h3>
        {review.aiStatus === 'ai_failed' && (
          <p className="form-error" role="alert">
            AI 起草失败。事实快照已保存。{review.aiError}
          </p>
        )}
        {review.aiStatus === 'facts_only' && <p>本期保存了事实快照。</p>}
        {draft && (
          <>
            <div className="weekly-review-draft-group">
              <h4>总体概述 · AI 整理</h4>
              <p>{draft.executiveSummary}</p>
            </div>
            {citedGroup('本周亮点', draft.highlights)}
            {citedGroup('风险与阻塞', draft.risksAndBlockers)}
            {draft.nextWeekFocus.length > 0 && (
              <div className="weekly-review-draft-group">
                <h4>下周关注 · AI 建议，待确认</h4>
                <ul>
                  {draft.nextWeekFocus.map((item, index) => (
                    <li key={index}>
                      <p>{item.text}</p>
                      <p className="weekly-review-context">{item.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {draft.openQuestions.length > 0 && (
              <div className="weekly-review-draft-group">
                <h4>待确认问题</h4>
                <ul>
                  {draft.openQuestions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function FactSection({
  section,
  index,
  onOpenReference,
}: {
  section: ReviewSection;
  index: number;
  onOpenReference?: (target: WeeklyReviewTarget) => void;
}) {
  return (
    <div className="weekly-review-fact-section">
      <div className="weekly-review-fact-heading">
        <h4>{section.title}</h4>
        <small>{section.scope === 'period' ? '本周期' : '生成时点'}</small>
      </div>
      {section.status === 'error' ? (
        <p className="form-error" role="alert">
          {section.message ?? '此来源暂不可用。'}
        </p>
      ) : (
        <>
          {section.metrics.length > 0 && (
            <dl className="weekly-review-metrics">
              {section.metrics.map((metric, i) => (
                <div key={metric.ref} id={factId(index, 'metric', i)} tabIndex={-1}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.count}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.entries.length > 0 && (
            <details>
              <summary>查看明细（{section.entries.length} 项）</summary>
              <ul className="weekly-review-fact-list">
                {section.entries.map((entry, i) => (
                  <li key={entry.ref} id={factId(index, 'entry', i)} tabIndex={-1}>
                    <div>
                      <strong>{entry.title}</strong>
                      {(entry.date || entry.status) && (
                        <p className="weekly-review-context">
                          {[entry.date, entry.status].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {entry.target && (
                      <ReviewSource
                        fact={{ label: '查看来源', elementId: factId(index, 'entry', i), target: entry.target }}
                        onOpenReference={onOpenReference}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {section.metrics.length === 0 && section.entries.length === 0 && (
            <p className="weekly-review-context">暂无记录。</p>
          )}
        </>
      )}
    </div>
  );
}
