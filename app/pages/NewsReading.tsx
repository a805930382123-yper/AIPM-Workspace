import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newsEvidenceLabel } from '../../services/news/evidence';
import { normalizedTitle, normalizedUrl } from '../../services/news/normalize';
import { evaluateResearchValue } from '../../services/news/research-value';
import { needsNewsTranslation, type NewsItem, type NewsSection, type NewsTranslationResult, type SourceHealth } from '../../services/news/types';
import { hasSourceFailure, time } from './NewsSources';
import { SourceLogo } from './SourceLogo';

const shanghaiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const shanghaiMinute = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const shanghaiSecond = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function publicationDate(value: string | null) {
  if (!value) return '';
  if (/^\d{4}-\d\d(-\d\d)?$/.test(value)) return value;
  return Number.isFinite(Date.parse(value)) ? shanghaiDate.format(new Date(value)) : '';
}

export function groupAiItems(section?: NewsSection) {
  const groups = new Map<string, NewsItem[]>();
  const ids = new Set<string>(), urls = new Set<string>(), titles = new Set<string>();
  for (const item of [...(section?.items ?? []), ...(section?.sourceItems ?? [])]) {
    const url = normalizedUrl(item.url), title = normalizedTitle(item.title);
    if (ids.has(item.id) || urls.has(url) || titles.has(title)) continue;
    ids.add(item.id);
    urls.add(url);
    titles.add(title);
    const items = groups.get(item.sourceId);
    if (items) items.push(item);
    else groups.set(item.sourceId, [item]);
  }
  const itemTime = (item: NewsItem) => {
    const published = Date.parse(item.publishedAt ?? '');
    return Number.isFinite(published) ? published : Date.parse(item.fetchedAt) || 0;
  };
  return Array.from(groups, ([id, items]) => ({ id, items: items.sort((a, b) => itemTime(b) - itemTime(a)).slice(0, 5) }));
}

export type NewsTranslationState = NewsTranslationResult['items'][number] | 'pending' | 'failed';

export function AiFrontierAccordion({ groups, date, editionDate, sources, cachedSources, fallback, empty, requestTranslations, renderItem }: {
  groups: ReturnType<typeof groupAiItems>;
  date: string;
  editionDate: string;
  sources: SourceHealth[];
  cachedSources: SourceHealth[];
  fallback: boolean;
  empty: string;
  requestTranslations: (date: string, itemIds: string[]) => Promise<void>;
  renderItem: (item: NewsItem) => ReactNode;
}) {
  const [todayOnly, setTodayOnly] = useState(false);
  const [opened, setOpened] = useState<Set<string> | null>(null);
  const { visible, openIds } = useMemo(() => {
    const visible = todayOnly
      ? groups.map(({ id, items }) => ({ id, items: items.filter(item => publicationDate(item.publishedAt) === date) })).filter(group => group.items.length)
      : groups;
    return { visible, openIds: opened ?? new Set(visible.slice(0, 1).map(group => group.id)) };
  }, [date, groups, opened, todayOnly]);
  useEffect(() => {
    const itemIds = visible.flatMap(({ id, items }) => openIds.has(id)
      ? items.filter(needsNewsTranslation).map(item => item.id)
      : []);
    if (itemIds.length) void requestTranslations(editionDate, itemIds);
  }, [editionDate, openIds, requestTranslations, visible]);
  const allOpen = visible.length > 0 && visible.every(group => openIds.has(group.id));
  return <>
    <div className="news-reading-tools">
      <span>共 {visible.length} 个来源 · {visible.reduce((total, group) => total + group.items.length, 0)} 条资讯</span>
      <div className="news-inline-actions">
        <button className="text-button" type="button" disabled={!visible.length} onClick={() => setOpened(new Set(allOpen ? [] : visible.map(group => group.id)))}>{allOpen ? '全部收起' : '全部展开'}</button>
        <div className="news-segments" role="group" aria-label="资讯筛选">
          <button type="button" aria-pressed={!todayOnly} onClick={() => { setTodayOnly(false); setOpened(null); }}>全部</button>
          <button type="button" aria-pressed={todayOnly} onClick={() => { setTodayOnly(true); setOpened(null); }}>仅今日更新</button>
        </div>
      </div>
    </div>
    {!visible.length && <div className="panel news-empty">
      <p>{todayOnly ? `${date} 暂无当日更新。` : empty}</p>
      {todayOnly && <button className="text-button" type="button" onClick={() => { setTodayOnly(false); setOpened(null); }}>查看全部资讯</button>}
    </div>}
    <div className="news-source-items">
      {visible.map(({ id, items }) => {
        const isOpen = openIds.has(id);
        const sourceName = items[0].sourceName;
        const source = sources.find(row => row.sourceId ? row.sourceId === id : row.name === sourceName);
        const homepage = source?.homepage ?? cachedSources.find(row => row.sourceId ? row.sourceId === id : row.name === sourceName)?.homepage;
        const cached = fallback || (source && hasSourceFailure(source) && (source.status === 'failed'
          || items.some(item => Date.parse(item.fetchedAt) < Date.parse(source.diagnosis?.startedAt ?? source.checkedAt))));
        const latest = publicationDate(items[0].publishedAt);
        return <section className="panel news-drawer" key={id}>
          <header className="news-drawer-head">
            <h3><button type="button" aria-expanded={isOpen} aria-controls={`news-drawer-${id}`} onClick={() => {
              const next = new Set(openIds);
              if (isOpen) next.delete(id);
              else next.add(id);
              setOpened(next);
            }}>
              <span className="news-drawer-identity">
                <span className="news-chevron" aria-hidden="true">›</span>
                <SourceLogo sourceId={id} sourceName={sourceName} officialUrl={homepage} size="md" />
                <span className="news-drawer-title">{sourceName}</span>
              </span>
              <span className="news-chip">{items.length} 条</span>
              <span className="news-meta">{latest ? `最新 ${latest}` : '发布日期未知'}</span>
              {cached && <span className="news-chip news-chip-warn">缓存 · 本次抓取失败</span>}
            </button></h3>
            {homepage && <a href={homepage} target="_blank" rel="noopener noreferrer" aria-label={`${sourceName} 官方入口`}>官方入口 ↗</a>}
          </header>
          <div id={`news-drawer-${id}`} hidden={!isOpen}>
            {isOpen && <ul className="news-drawer-items">{items.map(item => <li key={item.id}>{renderItem(item)}</li>)}</ul>}
          </div>
        </section>;
      })}
    </div>
  </>;
}

export function FmcgBriefingSection({ items, recent, historical, oldEdition, legacy, empty, renderItem }: {
  items: NewsItem[];
  recent: { date: string; item: NewsItem }[];
  historical: boolean;
  oldEdition: boolean;
  legacy?: NewsSection;
  empty: string;
  renderItem: (item: NewsItem, options?: { recentDate?: string; key?: string }) => ReactNode;
}) {
  return <div className="news-fmcg-list">
    <section className="news-reading-group">
      <h3>{oldEdition ? '旧版快消新闻' : historical ? '本期收录' : '今日收录'} ({items.length})</h3>
      {!historical && items.length > 0 && <span className="news-meta">本期首次收录，发布日期见原文</span>}
      {items.map((item, index) => renderItem(item, { key: `${item.id}:${index}` }))}
      {!items.length && <p className="panel news-empty">{empty}</p>}
    </section>
    {!historical && <section className="news-reading-group">
      <h3>近期精选 ({recent.length})</h3>
      {recent.map(({ date, item }) => renderItem(item, { recentDate: date, key: `${date}:${item.id}` }))}
      {!recent.length && <p className="panel news-empty">暂无近期精选</p>}
    </section>}
    {legacy && <details className="panel news-legacy">
      <summary>升级前快消资讯（历史）</summary>
      {legacy.items.map(item => renderItem(item))}
    </details>}
  </div>;
}

export function BriefingItemCard({ item, ai, officialUrl, recentDate, analysisStatus, translation, onRetryTranslation, actions }: {
  item: NewsItem;
  ai: boolean;
  officialUrl?: string;
  recentDate?: string;
  analysisStatus?: string;
  translation?: NewsTranslationState;
  onRetryTranslation?: () => void;
  actions: ReactNode;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const translated = typeof translation === 'object' ? translation : undefined;
  const displayed = showOriginal ? item : translated ?? item;
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(displayed.excerpt.length > 280);
  const excerpt = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const node = excerpt.current;
    if (!node || expanded) return;
    const measure = () => {
      setOverflows(node.clientHeight ? node.scrollHeight > node.clientHeight : displayed.excerpt.length > 280);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, displayed.excerpt]);

  const value = ai ? undefined : evaluateResearchValue(item);
  const research = item.research;
  const kind = research?.kind ?? (ai && item.sourceId === 'karpathy-youtube' && item.evidenceKind === 'source_summary'
    ? '视频简介' : item.evidenceKind === 'source_summary' ? '来源摘要' : '来源正文摘录');
  const limitation = research
    ? `${research.kind}。数据时期：${research.dataPeriod || '请以原文为准'}`
    : newsEvidenceLabel(item) !== kind ? newsEvidenceLabel(item) : undefined;
  const published = publicationDate(item.publishedAt);
  const timestamp = ai && item.publishedAt && /[T ]\d{2}:\d{2}/u.test(item.publishedAt) && published
    ? (/[T ]\d{2}:\d{2}:\d{2}/u.test(item.publishedAt) ? shanghaiSecond : shanghaiMinute).format(new Date(item.publishedAt))
    : '';
  return <article className={`news-article${ai ? '' : ' panel'}`}>
    <div className="news-article-heading">
      <h4><a href={item.url} target="_blank" rel="noopener noreferrer">{displayed.title} <span aria-hidden="true">↗</span></a></h4>
      {recentDate && <span tabIndex={0} className="news-chip news-chip-accent" title={`原收录：${recentDate} · 原抓取：${time(item.fetchedAt)}`}>近期精选</span>}
    </div>
    <div className="news-item-meta">
      <span className={`news-chip${ai ? '' : ' news-source-chip'}`}>
        {!ai && <SourceLogo sourceId={item.sourceId} sourceName={item.sourceName} officialUrl={officialUrl} size="xs" />}
        {item.sourceName}
      </span>
      {item.author && <span>{item.author}</span>}
      {published ? <time dateTime={item.publishedAt ?? undefined} title={timestamp ? '上海时间' : published.length === 7 ? '仅知月份' : undefined}>
        {published}{timestamp && ` ${timestamp}`}
      </time> : <span>发布日期未知</span>}
      {item.url.startsWith('http:') && <span>HTTP 链接</span>}
      {research?.pdfUrl
        ? <a className="news-chip" href={research.pdfUrl} target="_blank" rel="noopener noreferrer">报告 PDF{research.pageRange && ` · ${research.pageRange}`} ↗</a>
        : <span className="news-chip">{kind.split(/[，,；;]/u)[0]}</span>}
      {translated && !showOriginal && <span className="news-chip news-chip-accent">AI 翻译</span>}
      {limitation && <span className="news-info" tabIndex={0} title={limitation} aria-label={limitation}>ⓘ</span>}
    </div>
    {value?.eligible && <div className="news-analysis">
      <p><b>推荐理由</b> {value.reason}</p>
      {value.application && <p><b>应用建议</b> {value.application}</p>}
    </div>}
    <p ref={excerpt} className={`news-excerpt${expanded ? ' is-expanded' : ''}`}>{displayed.excerpt}</p>
    {item.analysis ? <div className="news-analysis">
      <p><b>事实</b> {item.analysis.fact}</p>
      <p><b>为何值得关注</b> {item.analysis.whyItMatters}</p>
      <p><b>可能影响（推断）</b> {item.analysis.possibleImpact}</p>
    </div> : analysisStatus && <p className="news-meta">{analysisStatus}</p>}
    <div className="news-item-actions">
      {(expanded || overflows) && <button className="text-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起摘录' : '展开完整摘录'}</button>}
      {translated && <button className="text-button" type="button" onClick={() => setShowOriginal(value => !value)}>{showOriginal ? '查看中文' : '查看原文'}</button>}
      {translation === 'pending' && <span className="news-meta" role="status">正在翻译，暂时显示原文。</span>}
      {translation === 'failed' && <>
        <span className="news-meta" role="status">翻译暂不可用，当前显示原文。</span>
        <button className="text-button" type="button" onClick={onRetryTranslation}>重试翻译</button>
      </>}
      <div className="news-save">{actions}</div>
    </div>
  </article>;
}
