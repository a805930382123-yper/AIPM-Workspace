import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { newsMaterialLabels } from '../../services/news/types';
import type { NewsSaveOptions } from '../../services/news/raw-save';
import type {
  NewsCheckMode,
  NewsEdition,
  NewsItem,
  NewsSavedRaw,
  NewsSaveResult,
  NewsSection,
  NewsSectionName,
  NewsTranslationResult,
} from '../../services/news/types';
import {
  AiFrontierAccordion,
  BriefingItemCard,
  FmcgBriefingSection,
  groupAiItems,
  type NewsTranslationState,
} from './NewsReading';
import { hasSourceFailure, SourceDiagnosticsSidebar } from './NewsSources';
import '../news.css';
type View = {
  date: string;
  aiEnabled: boolean;
  edition: NewsEdition | null;
  recentFmcg?: Array<{ date: string; item: NewsItem }>;
  fallbacks: Partial<Record<NewsSectionName, { date: string; section: NewsSection }>>;
};
const labels = { fmcg: '快消研报与洞察', ai: 'AI 前沿' };
const sections = ['fmcg', 'ai'] as const;
const status = {
  running: '正在准备',
  ready: '分析已生成',
  source_only: '来源摘录可阅读',
  empty: '近期内容不足',
  failed: '读取失败',
  interrupted: '上次准备中断',
};
const statusLabel = (n: NewsSectionName, s: NewsSection['status']) =>
  n === 'ai' && s === 'empty' ? '暂无可核验内容' : status[s];

function sectionStatus(section: NewsSection | undefined, missing: string, n: NewsSectionName = 'fmcg') {
  if (!section) return missing;
  const hasContent = section.items.length || section.sourceItems?.length;
  if (section.status === 'running') return hasContent ? '正在检查更新，已收录内容可继续阅读' : '正在检查更新';
  if (section.status === 'interrupted' && hasContent) return '上次检查中断，保留已收录内容';
  return statusLabel(n, section.status);
}

function sectionFromHash(): NewsSectionName {
  return ['#ai', '#news-section-ai'].includes(window.location.hash) ? 'ai' : 'fmcg';
}

function DailyBriefingToolbar({
  active,
  onTabChange,
  counts,
  view,
  selected,
  history,
  onDateChange,
}: {
  active: NewsSectionName;
  onTabChange: (section: NewsSectionName) => void;
  counts: Record<NewsSectionName, number>;
  view: View | null;
  selected: string | null;
  history: { date: string }[];
  onDateChange: (date: string | null) => void;
}) {
  return (
    <div className="news-toolbar">
      <div className="news-segments news-tabs" role="tablist" aria-label="每日资讯栏目">
        {sections.map((name) => (
          <button
            key={name}
            id={`news-tab-${name}`}
            type="button"
            role="tab"
            aria-selected={active === name}
            aria-controls={`news-section-${name}`}
            tabIndex={active === name ? 0 : -1}
            onClick={() => onTabChange(name)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'fmcg' : event.key === 'End' ? 'ai' : name === 'fmcg' ? 'ai' : 'fmcg';
              onTabChange(next);
              document.getElementById(`news-tab-${next}`)?.focus();
            }}
          >
            {labels[name]} <span>({counts[name]})</span>
          </button>
        ))}
      </div>
      <div className="news-reading-controls">
        <label>
          阅读日期{' '}
          <select value={selected || ''} onChange={(event) => onDateChange(event.target.value || null)}>
            <option value="">今天 {view?.date || ''}</option>
            {history
              .filter((row) => row.date !== view?.date)
              .map((row) => (
                <option key={row.date}>{row.date}</option>
              ))}
          </select>
        </label>
        {view && (
          <span className={`news-ai-state${view.aiEnabled ? ' news-success' : ''}`}>
            <span className="news-dot" />
            AI 分析{view.aiEnabled ? '已启用' : '未启用'}
          </span>
        )}
      </div>
    </div>
  );
}

function useToday(ensure: boolean) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState('');
  const current = useRef<View | null>(null),
    refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    current.current = view;
  }, [view]);
  useEffect(() => {
    let active = true,
      inFlight = false;
    const load = async (first = false, checkDate = false) => {
      if (inFlight) return;
      inFlight = true;
      try {
        let value = await api<View>(
          first && ensure ? '/api/news/today/ensure' : '/api/news/today',
          first && ensure ? { method: 'POST', body: '{}' } : undefined,
        );
        if (ensure && checkDate && current.current && value.date !== current.current.date)
          value = await api<View>('/api/news/today/ensure', { method: 'POST', body: '{}' });
        if (active) {
          current.current = value;
          setView(value);
          setError('');
        }
      } catch {
        if (active) setError('资讯状态读取失败，请重新读取。');
      } finally {
        inFlight = false;
      }
    };
    refreshRef.current = () => {
      void load(false, false);
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') void load(false, true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load(false, true);
    };
    if (ensure) {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }
    void load(true);
    return () => {
      active = false;
      refreshRef.current = () => {};
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ensure]);
  useEffect(() => {
    if (error || !view || !Object.values(view.edition?.sections || {}).some((x) => x.status === 'running')) return;
    const timer = setTimeout(() => refreshRef.current(), 2000);
    return () => clearTimeout(timer);
  }, [view, error]);
  return { view, error, setView, setError, refresh: () => refreshRef.current() };
}
export function NewsHome({ onOpen }: { onOpen: () => void }) {
  const { view, error, refresh } = useToday(true);
  return (
    <section className="panel news-home">
      <div>
        <h2>每日资讯</h2>
        <p>{view ? `${view.date} · AI 分析${view.aiEnabled ? '已启用' : '未启用'}` : '正在读取资讯状态'}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            <button className="text-button" onClick={refresh}>
              重新读取状态
            </button>
          </p>
        )}
        <div className="news-home-status">
          {(['fmcg', 'ai'] as const).map((n) => (
            <span key={n}>
              {labels[n]}：{view?.edition?.sections[n] ? statusLabel(n, view.edition.sections[n]!.status) : '等待准备'}
            </span>
          ))}
        </div>
      </div>
      <button className="secondary-button" onClick={onOpen}>
        阅读资讯
      </button>
    </section>
  );
}
export function NewsPage({
  onRawChanged = () => {},
  onOpenRaw = () => {},
  onBack,
}: {
  onRawChanged?: () => void | Promise<void>;
  onOpenRaw?: (id: string) => void;
  onBack?: () => void;
}) {
  const { view, error, setView, setError, refresh } = useToday(false);
  const [history, setHistory] = useState<{ items: Array<{ date: string }>; errors: string[] } | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [edition, setEdition] = useState<NewsEdition | null>(null),
    [readError, setReadError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ items: Array<{ date: string }>; errors: string[] }>('/api/news/history')
      .then((x) => {
        if (active) setHistory(x);
      })
      .catch(() => {
        if (active) setReadError('历史记录读取失败。');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setEdition(null);
    setReadError('');
    if (selected)
      void api<NewsEdition>(`/api/news/editions/${selected}`)
        .then((x) => {
          if (active) setEdition(x);
        })
        .catch(() => {
          if (active) setReadError('这期记录读取失败。');
        });
    return () => {
      active = false;
    };
  }, [selected]);
  const [saved, setSaved] = useState<Record<string, NewsSavedRaw[]>>({}),
    [busy, setBusy] = useState<Record<string, boolean>>({}),
    [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const projectionVersion = useRef<Record<string, number>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const translationCache = useRef<Record<string, Record<string, NewsTranslationState>>>({});
  const [translations, setTranslations] = useState(translationCache.current);
  const requestTranslations = useCallback(async (date: string, itemIds: string[], retry = false) => {
    const wanted = itemIds.filter((id) => translationCache.current[date]?.[id] === (retry ? 'failed' : undefined));
    if (!date || !wanted.length) return;
    const update = (entries: Record<string, NewsTranslationState>) => {
      translationCache.current = {
        ...translationCache.current,
        [date]: { ...translationCache.current[date], ...entries },
      };
      if (alive.current) setTranslations(translationCache.current);
    };
    update(Object.fromEntries(wanted.map((id) => [id, 'pending' as const])));
    const results: Record<string, NewsTranslationState> = Object.fromEntries(
      wanted.map((id) => [id, 'failed' as const]),
    );
    try {
      const response = await api<NewsTranslationResult>(`/api/news/editions/${date}/translations`, {
        method: 'POST',
        body: JSON.stringify({ itemIds: wanted }),
      });
      for (const item of response.items) results[item.itemId] = item;
    } catch {
      // The affected cards keep showing the source text and offer a retry.
    }
    update(results);
  }, []);
  const [projectionReload, setProjectionReload] = useState(0);
  const [projectionReading, setProjectionReading] = useState(false);
  const shown = selected ? (edition?.date === selected ? edition : null) : view?.edition;
  const dates = selected
    ? (shown?.date ?? '')
    : [
        ...new Set(
          [shown?.date, view?.fallbacks.ai?.date, ...(view?.recentFmcg ?? []).map((row) => row.date)].filter(Boolean),
        ),
      ].join(',');
  useEffect(() => {
    let active = true;
    const reads = dates
      .split(',')
      .filter(Boolean)
      .map((date) => {
        const version = projectionVersion.current[date] || 0;
        return api<{ items: NewsSavedRaw[] }>(`/api/news/editions/${date}/saved-raws`)
          .then((x) => {
            if (active && version === (projectionVersion.current[date] || 0)) {
              setSaved((prev) => ({ ...prev, [date]: x.items }));
              setSaveErrors((prev) => ({ ...prev, [date]: '' }));
            }
          })
          .catch(() => {
            if (active && version === (projectionVersion.current[date] || 0))
              setSaveErrors((prev) => ({ ...prev, [date]: '保存状态读取失败，请重新读取。' }));
          });
      });
    void Promise.all(reads).then(() => {
      if (active) setProjectionReading(false);
    });
    return () => {
      active = false;
    };
  }, [dates, view?.edition?.updatedAt, edition?.updatedAt, projectionReload]);
  const [partial, setPartial] = useState<Record<string, boolean>>({});
  const save = async (date: string, section: NewsSectionName, itemId: string, options: NewsSaveOptions = {}) => {
    const key = `${date}:${section}:${itemId}`;
    setBusy((prev) => ({ ...prev, [key]: true }));
    setSaveErrors((prev) => ({ ...prev, [key]: '' }));
    setPartial((prev) => ({ ...prev, [key]: false }));
    try {
      const result = await api<NewsSaveResult>(`/api/news/editions/${date}/items/save-raw`, {
        method: 'POST',
        body: JSON.stringify({ section, itemId, ...options }),
      });
      if (alive.current) {
        projectionVersion.current[date] = (projectionVersion.current[date] || 0) + 1;
        setSaved((prev) => ({
          ...prev,
          [date]: [
            ...(prev[date] || []).filter((x) => x.section !== section || x.itemId !== itemId),
            { section, itemId, rawId: result.rawId, status: 'saved', material: result.material },
          ],
        }));
      }
      void onRawChanged();
    } catch (e) {
      if (alive.current) {
        setSaveErrors((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : '保存失败，请重试。' }));
        setPartial((prev) => ({
          ...prev,
          [key]: !options.supplement && e instanceof ApiError && e.code === 'NEWS_MATERIAL_INCOMPLETE',
        }));
      }
    } finally {
      if (alive.current) setBusy((prev) => ({ ...prev, [key]: false }));
    }
  };
  const [checking, setChecking] = useState<Partial<Record<NewsSectionName, NewsCheckMode>>>({});
  const [checkNotices, setCheckNotices] = useState<Partial<Record<NewsSectionName, string>>>({});
  const check = async (section: NewsSectionName, mode: NewsCheckMode, attempt: number) => {
    setChecking((previous) => ({ ...previous, [section]: mode }));
    setCheckNotices((previous) => ({ ...previous, [section]: undefined }));
    try {
      const result = await api<View & { checkNotice?: { section: NewsSectionName; message: string } }>(
        '/api/news/today/check',
        {
          method: 'POST',
          body: JSON.stringify({ section, mode, attempt }),
        },
      );
      if (!alive.current) return;
      setView((previous) =>
        previous?.edition &&
        result.edition &&
        Date.parse(previous.edition.updatedAt) > Date.parse(result.edition.updatedAt)
          ? previous
          : result,
      );
      setError('');
      if (result.checkNotice) setCheckNotices((previous) => ({ ...previous, [section]: result.checkNotice!.message }));
    } catch (cause) {
      if (alive.current) {
        setCheckNotices((previous) => ({
          ...previous,
          [section]: cause instanceof Error ? cause.message : '检查更新失败，请刷新。',
        }));
        refresh();
      }
    } finally {
      if (alive.current) setChecking((previous) => ({ ...previous, [section]: undefined }));
    }
  };
  const [active, setActive] = useState(sectionFromHash);
  useEffect(() => {
    const sync = () => setActive(sectionFromHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const selectTab = (name: NewsSectionName) => {
    setActive(name);
    window.history.replaceState(window.history.state, '', `#news-section-${name}`);
  };

  const readingDate = selected ?? view?.date ?? '';
  const fmcg = shown?.sections.fmcg;
  const ai = shown?.sections.ai;
  const fmcgItems = selected
    ? (fmcg?.items ?? [])
    : fmcg?.contentVersion === 'research-v1'
      ? fmcg.items.slice(0, 5)
      : [];
  const recent = selected ? [] : (view?.recentFmcg ?? []);
  const fallback =
    !selected && ai && !ai.items.length && !ai.sourceItems?.length && ['failed', 'interrupted'].includes(ai.status)
      ? view?.fallbacks.ai
      : undefined;
  const displayedAi = fallback?.section ?? ai;
  const aiEditionDate = fallback?.date ?? readingDate;
  const aiGroups = useMemo(() => groupAiItems(displayedAi), [displayedAi]);
  const counts = {
    fmcg: fmcgItems.length + recent.length,
    ai: aiGroups.reduce((total, group) => total + group.items.length, 0),
  };
  const current = shown?.sections[active];
  const relevantDates =
    active === 'ai' ? [fallback?.date ?? shown?.date] : [shown?.date, ...recent.map((row) => row.date)];
  const projectionError = relevantDates.some((date) => date && saveErrors[date]);
  const failures = current?.sources.filter(hasSourceFailure).length ?? 0;
  const activeMode = checking[active];
  const checkDisabled = !view || Boolean(activeMode) || current?.status === 'running';
  const analysisStatus = view?.aiEnabled
    ? displayedAi?.status === 'running'
      ? 'AI 分析生成中…'
      : displayedAi && ['failed', 'interrupted'].includes(displayedAi.status)
        ? 'AI 分析暂不可用'
        : undefined
    : undefined;
  const itemCard = (
    item: NewsItem,
    name: NewsSectionName,
    date: string,
    options?: { recentDate?: string; key?: string; showPlatform?: boolean },
  ) => {
    const key = `${date}:${name}:${item.id}`;
    const entry = saved[date]?.find((row) => row.section === name && row.itemId === item.id);
    const officialUrl =
      name === 'fmcg'
        ? (date === readingDate ? fmcg?.sources : view?.edition?.sections.fmcg?.sources)?.find((source) =>
            source.sourceId ? source.sourceId === item.sourceId : source.name === item.sourceName,
          )?.homepage
        : undefined;
    return (
      <BriefingItemCard
        key={options?.key ?? key}
        item={item}
        ai={name === 'ai'}
        recentDate={options?.recentDate}
        analysisStatus={name === 'ai' ? analysisStatus : undefined}
        officialUrl={officialUrl}
        showPlatform={options?.showPlatform}
        translation={name === 'ai' ? translations[date]?.[item.id] : undefined}
        onRetryTranslation={() => void requestTranslations(date, [item.id], true)}
        actions={
          <>
            {entry?.status === 'saved' ? (
              <>
                <span>已保存{entry.material ? ` · ${newsMaterialLabels[entry.material.kind]}` : ''}</span>
                <button type="button" className="text-button" onClick={() => onOpenRaw(entry.rawId)}>
                  查看 Raw
                </button>
                {entry.material?.canSupplement && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy[key]}
                    onClick={() => void save(date, name, item.id, { supplement: true })}
                  >
                    {busy[key] ? '正在补采…' : '补采来源正文'}
                  </button>
                )}
                {entry.material?.issue && <p className="extract-note">{entry.material.issue}</p>}
              </>
            ) : entry?.status === 'missing' ? (
              <span>原 Raw 已删除</span>
            ) : entry?.status === 'error' ? (
              <p className="form-error" role="alert">
                {entry.message}
              </p>
            ) : (
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(busy[key])}
                onClick={() => void save(date, name, item.id)}
              >
                {busy[key]
                  ? '正在获取来源材料…'
                  : entry?.status === 'pending'
                    ? '核对保存状态'
                    : saveErrors[key]
                      ? '重试保存到 Raw'
                      : '保存到 Raw'}
              </button>
            )}
            {partial[key] && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy[key]}
                onClick={() => void save(date, name, item.id, { keepPartial: true })}
              >
                仅保留可用材料
              </button>
            )}
            {saveErrors[key] && (
              <p className="form-error" role="alert">
                {saveErrors[key]}
              </p>
            )}
          </>
        }
      />
    );
  };
  const empty =
    selected && !shown
      ? readError || '正在读取历史…'
      : current?.status === 'running'
        ? '正在检查更新，资讯准备好后会显示在这里。'
        : current?.status === 'failed'
          ? '读取失败，暂无可阅读内容。'
          : active === 'fmcg'
            ? shown?.legacyFmcg && !current
              ? '等待更新快消研报。'
              : '暂无新的可核验研报。'
            : '暂无可阅读的 AI 资讯。';

  return (
    <div className="page news-page">
      <div className="page-heading">
        <div>
          <h1>每日资讯</h1>
          <p className="subheading">来源摘录与分析分开保存，日期以来源为准。</p>
        </div>
        {onBack && (
          <button type="button" className="secondary-button" onClick={onBack}>
            返回工作台
          </button>
        )}
      </div>
      <DailyBriefingToolbar
        active={active}
        onTabChange={selectTab}
        counts={counts}
        view={view}
        selected={selected}
        history={history?.items ?? []}
        onDateChange={setSelected}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={refresh}>
            重新读取状态
          </button>
        </p>
      )}
      {readError && (
        <p className="form-error" role="alert">
          {readError}
        </p>
      )}
      {history?.errors.map((message) => (
        <p className="form-error" key={message}>
          {message}
        </p>
      ))}
      <section
        className="news-section"
        id={`news-section-${active}`}
        role="tabpanel"
        aria-labelledby={`news-tab-${active}`}
      >
        {projectionError && (
          <div className="news-save-warning">
            <span role="alert">保存状态读取失败，请重新读取。</span>
            <button
              className="secondary-button"
              type="button"
              disabled={projectionReading}
              onClick={() => {
                setProjectionReading(true);
                setProjectionReload((value) => value + 1);
              }}
            >
              {projectionReading ? '正在读取保存状态…' : '重新读取保存状态'}
            </button>
          </div>
        )}
        <div className="news-workspace">
          <SourceDiagnosticsSidebar
            key={`${readingDate}:${active}`}
            name={active}
            section={current}
            readingCount={counts[active]}
            status={sectionStatus(current, active === 'fmcg' && !selected ? '今日尚未准备' : '暂无记录', active)}
            notice={selected ? undefined : checkNotices[active]}
            summary={
              active === 'fmcg'
                ? selected
                  ? `本期收录 ${fmcgItems.length} 条`
                  : `今日收录 ${fmcgItems.length} · 近期精选 ${recent.length} · 合计 ${counts.fmcg}/5`
                : `已抓取来源 ${(ai?.sources ?? []).filter((source) => source.status !== 'failed' && source.diagnosis?.outcome !== 'failed').length} / ${ai?.sources.length ?? 0} · 共 ${counts.ai} 条`
            }
            actions={
              !selected && (
                <div className="news-check-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={checkDisabled}
                    onClick={() => void check(active, 'all', current?.attempt ?? 0)}
                  >
                    {activeMode === 'all' ? '正在检查更新…' : '检查更新'}
                  </button>
                  {active === 'fmcg' && (failures > 0 || activeMode === 'failed') && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={checkDisabled}
                      onClick={() => void check(active, 'failed', current?.attempt ?? 0)}
                    >
                      {activeMode === 'failed' ? '正在补抓失败来源…' : `仅补抓失败来源 (${failures})`}
                    </button>
                  )}
                </div>
              )
            }
          />
          <div className="news-reading">
            {active === 'fmcg' ? (
              <FmcgBriefingSection
                key={readingDate}
                items={fmcgItems}
                recent={recent}
                historical={Boolean(selected)}
                oldEdition={Boolean(selected && fmcg && !fmcg.contentVersion)}
                legacy={shown?.legacyFmcg}
                empty={empty}
                renderItem={(item, options) => itemCard(item, 'fmcg', options?.recentDate ?? readingDate, options)}
              />
            ) : (
              <>
                {fallback && (
                  <p className="news-warning news-fallback">本次读取失败，显示 {fallback.date} 的历史内容。</p>
                )}
                <AiFrontierAccordion
                  key={readingDate}
                  groups={aiGroups}
                  date={readingDate}
                  editionDate={aiEditionDate}
                  sources={ai?.sources ?? []}
                  cachedSources={fallback?.section.sources ?? []}
                  fallback={Boolean(fallback)}
                  empty={empty}
                  requestTranslations={requestTranslations}
                  renderItem={(item, showPlatform) => itemCard(item, 'ai', aiEditionDate, { showPlatform })}
                />
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
