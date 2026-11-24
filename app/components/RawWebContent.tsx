import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { parseNoteGrid } from '../../services/wiki/structured-note';
import {
  parseRawMedia,
  parseRawMediaBatch,
  rawMedia,
  type Raw,
  type RawMediaArtifact,
  type RawMediaReadingSource,
} from '../api';

const statusLabels = {
  skipped: '已跳过',
  ocr_ready: '文字已识别',
  needs_vlm: '待精读',
  vlm_done: '已精读',
  failed: '失败',
};
const confidenceLabels = { high: '高', medium: '中', low: '低' };
const failureStages = {
  download: '原图下载',
  original: '本地原图读取或校验',
  image: '图像转换',
  provider: 'Provider 请求',
  response: '结果解析',
};
const batchErrors: Record<string, string> = {
  LLM_NOT_CONFIGURED: '尚未配置产品 LLM Provider，请先在设置中配置后重试。',
  RAW_MEDIA_NOT_FOUND: '图片位置已变化，请刷新资料后重试。',
  RAW_MEDIA_SOURCE_CHANGED: '原文或图片位置已变化，请刷新资料后重试。',
};

function ImageMarkdown({ body }: { body: string }) {
  const lines = body.split('\n');
  const tableLines = lines.map((line) => {
    if (!line.includes('|')) return line;
    const cells = line
      .trim()
      .replace(/^\||\|$/gu, '')
      .split(/(?<!\\)\|/u)
      .map((cell) => cell.trim());
    return `| ${cells.map((cell) => (/^:?-{3,}:?$/u.test(cell) ? '---' : cell)).join(' | ')} |`;
  });
  const parts: ReactNode[] = [];
  let prose: string[] = [];
  let fence = '';
  const flush = () => {
    if (!prose.length) return;
    parts.push(
      <Markdown key={`p${parts.length}`} skipHtml>
        {prose.join('\n')}
      </Markdown>,
    );
    prose = [];
  };
  for (let index = 0; index < lines.length;) {
    const marker = lines[index].match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence ? '' : marker;
    const grid = !fence && !marker ? parseNoteGrid(tableLines, index) : undefined;
    if (!grid) {
      prose.push(lines[index++]);
      continue;
    }
    flush();
    parts.push(
      <div className="note-table-scroll" key={`t${index}`}>
        <table>
          <thead>
            <tr>
              {grid.headings.map((cell, cellIndex) => (
                <th key={cellIndex}>
                  <Markdown skipHtml>{cell.replace(/<br\s*\/?>/giu, '\n\n')}</Markdown>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <Markdown skipHtml>{cell.replace(/<br\s*\/?>/giu, '\n\n')}</Markdown>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    index = grid.end;
  }
  flush();
  return <div className="formal-note-reader raw-image-markdown">{parts}</div>;
}

/** Reading only fetches existing derivatives; model calls require an explicit button action. */
export function RawWebContent({ raw, inlineBody = true }: { raw: Raw; inlineBody?: boolean }) {
  const [artifacts, setArtifacts] = useState<RawMediaArtifact[]>([]);
  const [source, setSource] = useState<RawMediaReadingSource>();
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [readVersion, setReadVersion] = useState(0);
  const active = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setSource(undefined);
    setReadError('');
    setShowOriginal(false);
    rawMedia(raw.id)
      .then((result) => {
        if (!current) return;
        if (result.readingSource.bodySha256 !== raw.bodySha256) throw new Error('原文版本已变化，请刷新资料后重试。');
        setArtifacts(result.items);
        setSource(result.readingSource);
        setReadError('');
      })
      .catch((error) => {
        if (current) setReadError(error instanceof Error ? error.message : '无法读取图片解析，请重试。');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [raw.id, raw.bodySha256, readVersion]);
  const parse = async (ids: string[], batch = false, force = false) => {
    if (busy.current || loading || !ids.length) return;
    busy.current = true;
    setPending(ids);
    setErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.includes(id))));
    try {
      const results: Array<{ mediaId: string; artifact?: RawMediaArtifact; error?: string }> = batch
        ? (await parseRawMediaBatch(raw.id, ids)).items
        : [{ mediaId: ids[0], artifact: await parseRawMedia(raw.id, ids[0], force) }];
      if (!active.current) return;
      setArtifacts((previous) =>
        previous.map((item) => results.find((result) => result.mediaId === item.mediaId)?.artifact ?? item),
      );
      setErrors((previous) => ({
        ...previous,
        ...Object.fromEntries(
          results
            .filter((result) => result.error)
            .map((result) => [
              result.mediaId,
              batchErrors[result.error!] ?? `图片精读未完成（${result.error}），请重试。`,
            ]),
        ),
      }));
    } catch (error) {
      if (active.current)
        setErrors((previous) => ({
          ...previous,
          ...Object.fromEntries(
            ids.map((id) => [id, error instanceof Error ? error.message : '图片精读未完成，请重试。']),
          ),
        }));
    } finally {
      busy.current = false;
      if (active.current) setPending([]);
    }
  };
  const waiting = artifacts.filter((item) => item.routeStatus === 'needs_vlm');
  const disabled = loading || pending.length > 0;
  const bodySlice = (start: number, end: number) => {
    let cursor = start;
    let text = '';
    for (const span of source?.removed ?? []) {
      if (span.start >= end || span.end <= cursor) continue;
      text += raw.body.slice(cursor, Math.max(cursor, span.start));
      cursor = Math.min(end, span.end);
    }
    return text + raw.body.slice(cursor, end);
  };
  return (
    <div className={`raw-web-content${inlineBody ? ' raw-body' : ''}`}>
      <div className="raw-image-toolbar">
        <span>{loading ? '正在读取图片状态…' : '图片解析与原始正文分别保存。精读会调用已配置的模型。'}</span>
        {waiting.length > 0 && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() =>
              void parse(
                waiting.map((item) => item.mediaId),
                true,
              )
            }
          >
            批量精读待解析图片（{waiting.length}）
          </button>
        )}
      </div>
      {readError && (
        <div className="form-error" role="alert">
          {readError}{' '}
          <button className="text-button" disabled={disabled} onClick={() => setReadVersion((value) => value + 1)}>
            重读图片状态
          </button>
          <button className="text-button" onClick={() => setShowOriginal((value) => !value)}>
            {showOriginal ? '收起原始正文' : '查看原始正文（含历史转录）'}
          </button>
          {showOriginal && (
            <div>
              <pre>{raw.body}</pre>
              {raw.webImages?.map(
                (image, index) =>
                  image.sha256 && (
                    <p key={index}>
                      <a
                        href={`/api/raw/${encodeURIComponent(raw.id)}/web-images/${image.sha256}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看采集原图 {index + 1}
                      </a>
                    </p>
                  ),
              )}
            </div>
          )}
        </div>
      )}
      {source?.markers.map((marker, index) => {
        const image = raw.webImages![marker.imageIndex - 1];
        const artifact = artifacts.find((item) => item.imageIndex === marker.imageIndex);
        const failure = artifact?.mediaFailure;
        const original =
          image.sha256 &&
          failure?.stage !== 'original' &&
          `/api/raw/${encodeURIComponent(raw.id)}/web-images/${image.sha256}`;
        const running = !!artifact && pending.includes(artifact.mediaId);
        const error = artifact && errors[artifact.mediaId];
        const localOcrPending =
          artifact?.routeStatus === 'failed' &&
          !!artifact.ocrError &&
          !failure &&
          !artifact.routeReasons.includes('local_ocr_image_decode_failed');
        return (
          <Fragment key={`${marker.imageIndex}:${marker.start}`}>
            {inlineBody && bodySlice(index ? source.markers[index - 1].end : 0, marker.start)}
            <figure className="raw-image-card" data-image-index={marker.imageIndex}>
              {original ? (
                <a href={original} target="_blank" rel="noreferrer">
                  <img src={original} alt={image.label || `来源图片 ${marker.imageIndex}`} loading="lazy" />
                </a>
              ) : (
                <p className="extract-note">本地原图不可用，可通过网页原地址查看。</p>
              )}
              <figcaption>
                <div className="raw-image-caption">
                  <b>来源图片 {marker.imageIndex}</b>
                  <span data-media-status={artifact?.routeStatus}>
                    {running
                      ? '正在精读…'
                      : artifact
                        ? localOcrPending
                          ? 'OCR 待处理'
                          : statusLabels[artifact.routeStatus]
                        : loading
                          ? '读取状态中'
                          : '暂无解析记录'}
                  </span>
                </div>
                <div className="raw-image-actions">
                  {original && (
                    <a href={original} target="_blank" rel="noreferrer">
                      打开原图（本地）
                    </a>
                  )}
                  <a href={image.sourceUrl} target="_blank" rel="noreferrer">
                    网页原地址
                  </a>
                  {artifact && ['needs_vlm', 'failed'].includes(artifact.routeStatus) && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={disabled}
                      onClick={() => void parse([artifact.mediaId])}
                    >
                      {running
                        ? '正在精读…'
                        : (artifact.routeStatus === 'failed' && !localOcrPending) || error
                          ? '重试精读'
                          : '精读此图'}
                    </button>
                  )}
                  {artifact?.routeStatus === 'vlm_done' && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={disabled}
                      onClick={() => void parse([artifact.mediaId], false, true)}
                    >
                      {running ? '正在精读…' : '重新精读（重新调用模型）'}
                    </button>
                  )}
                </div>
              </figcaption>
              {artifact?.routeStatus === 'ocr_ready' && artifact.ocrCleanText && (
                <details className="raw-image-text">
                  <summary>查看识别文字（{artifact.ocrCleanText.length} 字）</summary>
                  <pre>{artifact.ocrCleanText}</pre>
                </details>
              )}
              {artifact?.routeStatus === 'vlm_done' && (
                <div className="raw-image-result">
                  {artifact.vlmSummary && <p>{artifact.vlmSummary}</p>}
                  {artifact.vlmMarkdown && (
                    <details className="raw-image-text">
                      <summary>查看精读正文</summary>
                      <ImageMarkdown body={artifact.vlmMarkdown} />
                    </details>
                  )}
                  <details className="raw-image-text">
                    <summary>置信度与警告</summary>
                    <p>置信度：{artifact.vlmConfidence ? confidenceLabels[artifact.vlmConfidence] : '未提供'}</p>
                    {artifact.vlmWarnings?.length ? (
                      <ul>
                        {artifact.vlmWarnings.map((warning, warningIndex) => (
                          <li key={warningIndex}>{warning}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>无额外警告。</p>
                    )}
                  </details>
                </div>
              )}
              {artifact?.ocrError && artifact.routeStatus !== 'vlm_done' && (
                <p className="extract-note">本机 OCR 未完成。{artifact.ocrError}</p>
              )}
              {artifact?.routeStatus === 'failed' && (failure || !artifact.ocrError) && (
                <p className="form-error" role="alert">
                  {failure &&
                    `${failureStages[failure.stage]}失败（${[
                      failure.code,
                      failure.httpStatus && `HTTP ${failure.httpStatus}`,
                      failure.networkCause,
                    ]
                      .filter(Boolean)
                      .join(' · ')}）。`}
                  {artifact.vlmError || '图片解析未完成，请重试精读。'}
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </figure>
          </Fragment>
        );
      })}
      {inlineBody && source && bodySlice(source.markers.at(-1)?.end ?? 0, raw.body.length)}
    </div>
  );
}
