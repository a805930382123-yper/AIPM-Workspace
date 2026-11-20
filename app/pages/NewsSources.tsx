import { useState, type ReactNode } from 'react';
import type { NewsSection, NewsSectionName, SourceHealth } from '../../services/news/types';
import { SourceLogo } from './SourceLogo';

const fullTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' });
const clockTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' });
export const time = (value?: string) => value && Number.isFinite(Date.parse(value)) ? fullTime.format(new Date(value)) : '未记录';
export const hasSourceFailure = (source: SourceHealth) => source.diagnosis
  ? ['partial', 'failed'].includes(source.diagnosis.outcome)
  : source.status === 'failed' || Boolean(source.error);

const errorLabel = { timeout: '超时', network: '网络错误', tls: 'TLS 错误', http: 'HTTP 错误', parse: '解析错误', unknown: '未知错误' };
const stageLabel = { list: '来源列表', detail: '详情', pdf: 'PDF', parse: '内容解析' };

function SourceDiagnostics({ section, name }: { section?: NewsSection; name: NewsSectionName }) {
  const [showAll, setShowAll] = useState(false);
  const reasons = name === 'fmcg' ? section?.shortageReasons ?? [] : [];
  const rows = (section?.sources ?? []).map(source => {
    const diagnosis = source.diagnosis;
    const failed = hasSourceFailure(source);
    const outcome = diagnosis?.outcome ?? (failed && source.status === 'ok' ? 'partial' : source.status);
    const successful = outcome === 'ok';
    const error = diagnosis?.error;
    const sourceReasons = reasons.filter(reason => reason.startsWith(`${source.name}：`));
    const counts = diagnosis?.counts;
    const tags = [
      counts?.duplicates ? `重复 ${counts.duplicates}` : sourceReasons.some(reason => reason.includes('重复')) ? '历史重复' : '',
      counts?.rejected ? `正文不合格 ${counts.rejected}` : sourceReasons.some(reason => reason.includes('正文要求')) ? '正文不合格' : '',
      sourceReasons.some(reason => reason.includes('详情读取预算')) ? '达详情预算' : '',
      sourceReasons.some(reason => reason.includes('PDF 读取预算')) ? '达 PDF 预算' : '',
      sourceReasons.some(reason => reason.includes('合格候选不足')) ? '合格候选不足' : '',
    ].filter(Boolean);
    const outcomeText = failed ? outcome === 'partial' ? '部分读取失败' : '读取失败' : successful ? '读取成功' : '没有合格条目';
    const result = failed
      ? error?.httpStatus ? `HTTP ${error.httpStatus}` : error ? `${error.stage === 'list' ? '' : stageLabel[error.stage] + ' '}${errorLabel[error.type]}` : outcomeText
      : successful ? counts?.qualified ? `${counts.qualified} 条` : outcomeText : '无新增';
    return { source, failed, successful, outcomeText, result, tags };
  }).sort((a, b) => Number(b.failed) - Number(a.failed) || Number(b.successful) - Number(a.successful));
  const failedCount = rows.filter(row => row.failed).length;
  const successCount = rows.filter(row => row.successful).length;
  const defaultCount = failedCount + 3;
  const otherReasons = reasons.filter(reason => !section?.sources.some(source => reason.startsWith(`${source.name}：`)));

  return <section className="panel news-side-card news-diagnosis" aria-labelledby="news-diagnosis-title">
    <h3 id="news-diagnosis-title">来源诊断</h3>
    {!rows.length ? <p className="news-meta">暂无来源诊断记录。</p> : <>
      <p className="news-diagnosis-summary">
        <span>{rows.length} 个来源</span>
        <span className="news-success">{successCount} 读取成功</span>
        <span>{rows.length - successCount - failedCount} 无新增</span>
        <span className={failedCount ? 'news-failure' : undefined}>{failedCount} 失败</span>
      </p>
      <ul className="news-diagnosis-list">
        {(showAll ? rows : rows.slice(0, defaultCount)).map(({ source, failed, successful, outcomeText, result, tags }) => {
          const diagnosis = source.diagnosis;
          return <li key={source.sourceId || source.name}>
            <div className="news-source-row">
              <details>
                <summary>
                  <SourceLogo sourceId={source.sourceId} sourceName={source.name} officialUrl={source.homepage} size="sm" />
                  <span className="news-source-name">{source.name}</span>
                  <span className={`news-dot${failed ? ' news-failure' : successful ? ' news-success' : ''}`} title={outcomeText} />
                  <span className={`news-chip${failed ? ' news-chip-error' : ''}`} title={outcomeText}>{result}</span>
                  <span className="news-chevron" aria-hidden="true">›</span>
                </summary>
                <div className="news-source-detail">
                  <p>{outcomeText}</p>
                  {diagnosis ? <>
                    <p>开始 {time(diagnosis.startedAt)}<br />完成 {time(diagnosis.finishedAt)} · 耗时 {diagnosis.elapsedMs} ms</p>
                    <p>候选 {diagnosis.counts.candidates} · 合格 {diagnosis.counts.qualified} · 重复 {diagnosis.counts.duplicates} · 正文不合格 {diagnosis.counts.rejected} · 读取失败 {diagnosis.counts.failed}</p>
                    <p>最近读取成功 {time(diagnosis.lastSuccessAt)}</p>
                    {diagnosis.error && <p>{stageLabel[diagnosis.error.stage]} · {errorLabel[diagnosis.error.type]} · {diagnosis.error.message}</p>}
                  </> : <p>读取于 {time(source.checkedAt)} · 详细诊断未记录 · 最近读取成功未记录</p>}
                  {source.error && source.error !== diagnosis?.error?.message && <p>{source.error}</p>}
                </div>
              </details>
              {source.homepage && <a className="news-source-link" href={source.homepage} target="_blank" rel="noopener noreferrer" title="官方入口" aria-label={`${source.name} 官方入口`}>↗</a>}
            </div>
            {!!tags.length && <div className="news-source-tags">{tags.map(tag => <span className="news-chip" key={tag}>{tag}</span>)}</div>}
          </li>;
        })}
      </ul>
      {rows.length > defaultCount && <button className="text-button news-more-sources" type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? '收起其余来源' : `展开其余 ${rows.length - defaultCount} 个来源`}</button>}
    </>}
    {!!otherReasons.length && <ul className="news-other-reasons" aria-label="本期收录限制">{otherReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
  </section>;
}

export function SourceDiagnosticsSidebar({ name, section, status, notice, summary, readingCount, actions }: {
  name: NewsSectionName;
  section?: NewsSection;
  status: string;
  notice?: string;
  summary: string;
  readingCount: number;
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const failedCount = section?.sources.filter(hasSourceFailure).length ?? 0;
  const checkMessage = section?.checkMessage;
  const showMessage = checkMessage && (name !== 'ai' || !/已满5条|按来源浏览新增/u.test(checkMessage));
  const completed = section?.finishedAt && Number.isFinite(Date.parse(section.finishedAt)) ? clockTime.format(new Date(section.finishedAt)) : '';
  return <aside className="news-sidebar" aria-label="抓取状态与来源诊断">
    <button className="panel news-sidebar-toggle" type="button" aria-expanded={expanded} aria-controls="news-sidebar-content" onClick={() => setExpanded(value => !value)}>
      <strong>抓取状态与来源诊断</strong>
      <span>{failedCount ? `${failedCount} 个来源失败` : `${readingCount} 条资讯`}</span>
      <span className="news-chevron" aria-hidden="true">›</span>
    </button>
    <div id="news-sidebar-content" className={`news-sidebar-content${expanded ? ' is-expanded' : ''}`}>
      <section className="panel news-side-card">
        <div className="news-overview-heading">
          <h3>抓取概览</h3>
          {completed && <time className="news-meta" tabIndex={0} dateTime={section?.finishedAt} title={`开始 ${time(section?.startedAt)} · 完成 ${time(section?.finishedAt)}`}>{completed} 完成</time>}
        </div>
        <p className="news-overview-stat">{summary}</p>
        <p className="news-meta">{status}</p>
        {section?.error && <p className="form-error" role="status">{section.error}</p>}
        {showMessage && <p className="news-meta" role="status">{checkMessage}</p>}
        {!checkMessage && name === 'fmcg' && section?.status !== 'running' && section?.attempt === 1 && completed && !section.error && <p className="news-meta">本次新增 {section.items.length} 条</p>}
        {notice && notice !== checkMessage && <p role="status">{notice}</p>}
        {!!failedCount && <p className="news-warning">部分来源不可用（{failedCount} 个失败）</p>}
        {actions}
      </section>
      <SourceDiagnostics section={section} name={name} />
      <section className="panel news-side-card news-rules">
        <h3>收录与保存</h3>
        <p>{name === 'fmcg'
          ? '优先收录与中国即时零售、经销渠道、货盘、促销和门店经营有关的快消研究。近 365 日发布，最多展示 5 条。'
          : '按来源展示近期资讯，去重后每个来源最多展示 5 条。'}</p>
        <p>仅保存已取得的摘录或来源摘要；后续 AI 整理需在 Raw 中另行操作。</p>
      </section>
    </div>
  </aside>;
}
