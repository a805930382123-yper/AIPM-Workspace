import { useEffect, useState } from 'react';
import { changePdfCleanup, changeRawPdfJob, getPdfCleanup, getRawPdf, getRawPdfPage } from './api';
import type { PdfCleanupRange, PdfCleanupView, PdfPage, RawPdf } from './api';

const activeJob = (job: RawPdf['job']) => job?.status === 'queued' || job?.status === 'running';
const jobLabels = {
  queued: '等待理解',
  running: '正在理解',
  completed: '整份 PDF 已完成页理解',
  failed: '页理解未完成',
  cancelled: '页理解已取消',
};

export function PdfPages({ rawId, onOpenDraft }: { rawId: string; onOpenDraft?: (id: string) => void }) {
  const [pdf, setPdf] = useState<RawPdf | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<PdfPage | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const [pageVersion, setPageVersion] = useState(0);
  const [action, setAction] = useState<'understand' | 'cancel' | null>(null);
  const [evidenceReturn, setEvidenceReturn] = useState<HTMLButtonElement | null>(null);
  const current = pdf?.pages.find((item) => item.page === pageNumber);
  const currentPage = page?.page === pageNumber ? page : null;
  const understanding = currentPage?.understanding;
  const job = pdf?.job;
  const running = activeJob(job ?? null);

  useEffect(() => {
    if (action) return;
    let active = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const result = await getRawPdf(rawId);
        if (!active) return;
        setPdf(result);
        setLoadError('');
        if (activeJob(result.job)) timer = window.setTimeout(() => void read(), 650);
      } catch (problem) {
        if (active) setLoadError(problem instanceof Error ? problem.message : '无法读取 PDF 页目录。');
      }
    };
    void read();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [rawId, readVersion, action]);

  useEffect(() => {
    if (!current) return;
    let active = true;
    setPageError('');
    getRawPdfPage(rawId, pageNumber)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((problem) => {
        if (active) setPageError(problem instanceof Error ? problem.message : '无法读取这页 PDF。');
      });
    return () => {
      active = false;
    };
  }, [rawId, pageNumber, current?.status, pageVersion]);

  const selectPage = (number: number) => {
    setPageNumber(number);
    setImageError(false);
  };
  const updateJob = async (command: 'understand' | 'cancel') => {
    setAction(command);
    setActionError('');
    try {
      setPdf(await changeRawPdfJob(rawId, command));
    } catch (problem) {
      setActionError(problem instanceof Error ? problem.message : '无法更新 PDF 页理解任务。');
    } finally {
      setAction(null);
    }
  };
  const retryPage = () => {
    setImageError(false);
    setPageVersion((value) => value + 1);
  };

  return (
    <section className="panel pdf-pages" id="pdf-pages" aria-label="PDF 逐页阅读">
      <header className="pdf-pages-heading">
        <div>
          <h3>PDF 逐页阅读</h3>
          {pdf && (
            <p>
              共 {pdf.pageCount} 页 · {pdf.hasTextLayer ? '有文字层' : '无文字层'}
            </p>
          )}
        </div>
        {pdf && (
          <a className="secondary-button" href={pdf.originalUrl} target="_blank" rel="noreferrer">
            打开原 PDF
          </a>
        )}
      </header>
      {loadError && (
        <div className="form-error" role="alert">
          {loadError}{' '}
          <button className="text-button" onClick={() => setReadVersion((value) => value + 1)}>
            重读页目录
          </button>
        </div>
      )}
      {!pdf && !loadError && <p role="status">正在读取 PDF 页目录…</p>}
      {pdf && (
        <>
          <div className="pdf-job-status">
            <div>
              <p role="status">
                {job
                  ? `${jobLabels[job.status]} · ${job.completedPages}/${job.totalPages} 页 · 累计 ${job.attempts} 次模型请求`
                  : '尚未开始 AI 页理解'}
              </p>
              {job?.error && (
                <p className="notice-warn" role="alert">
                  {job.failedPage ? `第 ${job.failedPage} 页：` : ''}
                  {job.error.message}
                </p>
              )}
              {job?.status !== 'completed' && (
                <p className="extract-note">
                  页理解按整份 PDF 进行。开始或继续后，会把未完成页的图像和已有文字发送给已配置的模型。
                </p>
              )}
            </div>
            {running ? (
              <button className="secondary-button" disabled={!!action} onClick={() => void updateJob('cancel')}>
                取消页理解
              </button>
            ) : (
              job?.status !== 'completed' && (
                <button className="primary-button" disabled={!!action} onClick={() => void updateJob('understand')}>
                  {job ? '继续 AI 页理解' : '开始 AI 页理解'}
                </button>
              )
            )}
          </div>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <nav className="pdf-page-nav" id="pdf-page-navigation" aria-label="PDF 页码" tabIndex={-1}>
            <button className="secondary-button" disabled={pageNumber <= 1} onClick={() => selectPage(pageNumber - 1)}>
              上一页
            </button>
            <label>
              页码{' '}
              <select
                aria-label="PDF 页码"
                value={pageNumber}
                onChange={(event) => selectPage(Number(event.target.value))}
              >
                {pdf.pages.map((item) => (
                  <option key={item.page} value={item.page}>
                    第 {item.page} 页{item.status === 'completed' ? ' · 已理解' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={pageNumber >= pdf.pageCount}
              onClick={() => selectPage(pageNumber + 1)}
            >
              下一页
            </button>
            <a className="text-button" href={`${pdf.originalUrl}#page=${pageNumber}`} target="_blank" rel="noreferrer">
              在原 PDF 中打开第 {pageNumber} 页
            </a>
            {onOpenDraft && (
              <a className="text-button" href="#pdf-cleanup">
                内容清理与知识草稿
              </a>
            )}
            {evidenceReturn && (
              <button
                className="text-button"
                onClick={() => {
                  setEvidenceReturn(null);
                  if (evidenceReturn.isConnected) {
                    evidenceReturn.scrollIntoView?.({ block: 'center' });
                    evidenceReturn.focus({ preventScroll: true });
                  }
                }}
              >
                返回这条清理依据
              </button>
            )}
          </nav>
          <div className="pdf-page-grid">
            <figure>
              <figcaption>第 {pageNumber} 页图像</figcaption>
              {imageError ? (
                <p className="form-error" role="alert">
                  这页图像无法读取。{' '}
                  <button className="text-button" onClick={retryPage}>
                    重读本页
                  </button>
                </p>
              ) : (
                current && (
                  <img
                    key={`${pageNumber}:${pageVersion}`}
                    src={current.imageUrl}
                    alt={`PDF 第 ${pageNumber} 页`}
                    onError={() => setImageError(true)}
                  />
                )
              )}
            </figure>
            <div className="pdf-page-copy">
              {pageError ? (
                <p className="form-error" role="alert">
                  {pageError}{' '}
                  <button className="text-button" onClick={retryPage}>
                    重读本页
                  </button>
                </p>
              ) : !currentPage ? (
                <p role="status">正在读取本页文字…</p>
              ) : (
                <>
                  <section aria-label="本页文字层">
                    <h4>原页文字层</h4>
                    {currentPage.text ? (
                      <pre>{currentPage.text}</pre>
                    ) : (
                      <p className="extract-note">本页没有可提取的文字层。</p>
                    )}
                  </section>
                  <section className="pdf-understanding" aria-label="本页 AI 理解">
                    <h4>AI 页理解 · 第 {pageNumber} 页</h4>
                    {understanding ? (
                      <>
                        {understanding.blank && <p>AI 将本页标记为空白。</p>}
                        {understanding.content && (
                          <>
                            <h5>页面内容</h5>
                            <p>{understanding.content}</p>
                          </>
                        )}
                        {understanding.visuals && (
                          <>
                            <h5>图表与图像</h5>
                            <p>{understanding.visuals}</p>
                          </>
                        )}
                        {understanding.inference && (
                          <>
                            <h5>推断</h5>
                            <p>{understanding.inference}</p>
                          </>
                        )}
                        {!!understanding.questions.length && (
                          <>
                            <h5>待确认问题</h5>
                            <ul>
                              {understanding.questions.map((question, index) => (
                                <li key={index}>{question}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="extract-note">本页暂无已保存的 AI 理解。</p>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
          {onOpenDraft && (
            <PdfCleanup
              rawId={rawId}
              pageCount={pdf.pageCount}
              understood={pdf.job?.completedPages ?? 0}
              onOpenDraft={onOpenDraft}
              onEvidence={(number, trigger) => {
                selectPage(number);
                const navigation = document.getElementById('pdf-page-navigation');
                navigation?.scrollIntoView?.({ block: 'start' });
                navigation?.focus({ preventScroll: true });
                setEvidenceReturn(trigger);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

const cleanupStage = {
  cleaning: '清理页面内容',
  indexing: '归并主题',
  assembling: '准备主题成果',
  done: '清理与归并完成',
};
const cleanupStatus = {
  queued: '等待开始',
  running: '正在处理',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
};
const decisionLabels = { keep: '保留', merge: '归并', skip: '略过' };
const evidenceKinds = { content: '页面内容', visuals: '图表与图像', inference: '推断', question: '待确认问题' };
const cleanupActive = (job: PdfCleanupView['job']) => job?.status === 'queued' || job?.status === 'running';

function PdfCleanup({
  rawId,
  pageCount,
  understood,
  onOpenDraft,
  onEvidence,
}: {
  rawId: string;
  pageCount: number;
  understood: number;
  onOpenDraft: (id: string) => void;
  onEvidence: (page: number, trigger: HTMLButtonElement) => void;
}) {
  const [view, setView] = useState<PdfCleanupView | null>(null);
  const [rangeMode, setRangeMode] = useState<'all' | 'range'>('all');
  const [choosingRange, setChoosingRange] = useState(false);
  const [first, setFirst] = useState('1');
  const [last, setLast] = useState(String(pageCount));
  const [action, setAction] = useState<'start' | 'cancel' | 'draft' | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [readVersion, setReadVersion] = useState(0);

  useEffect(() => {
    if (action) return;
    let active = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const result = await getPdfCleanup(rawId);
        if (!active) return;
        setView(result);
        setLoadError('');
        if (cleanupActive(result.job)) timer = window.setTimeout(() => void read(), 650);
      } catch (problem) {
        if (active) setLoadError(problem instanceof Error ? problem.message : '无法读取 PDF 清理状态。');
      }
    };
    void read();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [rawId, understood, action, readVersion]);

  const job = view?.job;
  const showRange = !!view && (!job || choosingRange);
  const range: PdfCleanupRange =
    job && !choosingRange
      ? { startPage: job.startPage, endPage: job.endPage }
      : rangeMode === 'all'
        ? { startPage: 1, endPage: pageCount }
        : { startPage: Number(first), endPage: Number(last) };
  const { startPage, endPage } = range;
  const valid =
    Number.isInteger(startPage) &&
    Number.isInteger(endPage) &&
    startPage >= 1 &&
    endPage <= pageCount &&
    startPage <= endPage;
  const understoodPages = new Set(view?.completedPages);
  const missing =
    valid && view
      ? Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index).filter(
          (number) => !understoodPages.has(number),
        )
      : [];
  const ready = !!view && valid && !missing.length && !action && !loadError;
  const running = cleanupActive(job ?? null);
  const canChangeRange =
    job && !running && (!job.draftId || job.draftStatus === 'confirmed' || job.draftStatus === 'discarded');
  const update = async (command: 'start' | 'cancel' | 'draft') => {
    setAction(command);
    setActionError('');
    try {
      setView(await changePdfCleanup(rawId, command, command === 'cancel' ? undefined : range));
      if (command === 'start') setChoosingRange(false);
    } catch (problem) {
      setActionError(problem instanceof Error ? problem.message : '无法更新 PDF 清理任务。');
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="pdf-cleanup" id="pdf-cleanup" aria-label="PDF 内容清理与知识草稿">
      <h3>内容清理与知识草稿</h3>
      <p className="extract-note">
        清理和主题写作只处理所选页范围。所选页须已完成 AI 页理解。开始或继续时会调用已配置的模型。
      </p>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}{' '}
          <button className="text-button" onClick={() => setReadVersion((value) => value + 1)}>
            重读清理状态
          </button>
        </p>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {!view && !loadError && <p role="status">正在读取清理状态…</p>}
      {showRange && (
        <div className="pdf-cleanup-range">
          <label>
            清理范围{' '}
            <select
              value={rangeMode}
              onChange={(event) => setRangeMode(event.target.value === 'range' ? 'range' : 'all')}
            >
              <option value="all">整份 PDF（{pageCount} 页）</option>
              <option value="range">指定页范围</option>
            </select>
          </label>
          {rangeMode === 'range' && (
            <>
              <label>
                起始页{' '}
                <input
                  type="number"
                  min="1"
                  max={pageCount}
                  step="1"
                  value={first}
                  onChange={(event) => setFirst(event.target.value)}
                />
              </label>
              <label>
                结束页{' '}
                <input
                  type="number"
                  min="1"
                  max={pageCount}
                  step="1"
                  value={last}
                  onChange={(event) => setLast(event.target.value)}
                />
              </label>
            </>
          )}
          {choosingRange && (
            <button className="text-button" disabled={!!action} onClick={() => setChoosingRange(false)}>
              取消更改范围
            </button>
          )}
        </div>
      )}
      {view && !valid && <p className="notice-warn">请输入 1 至 {pageCount} 之间的有效页码，起始页不能大于结束页。</p>}
      {valid && !!missing.length && (
        <p className="notice-warn">
          所选范围仍有 {missing.length} 页未完成 AI 页理解：第 {missing.join('、')} 页。请先完成这些页的理解。
        </p>
      )}
      {job && (
        <div className="pdf-job-status">
          <div>
            <p>
              <b>
                {job.startPage === 1 && job.endPage === pageCount
                  ? '整份 PDF'
                  : job.startPage === job.endPage
                    ? `第 ${job.startPage} 页`
                    : `第 ${job.startPage}–${job.endPage} 页`}
              </b>{' '}
              · 共 {pageCount} 页
            </p>
            <p role="status">
              {cleanupStatus[job.status]} · {cleanupStage[job.stage]} · 清理批次 {job.completedBatches}/
              {job.totalBatches} · 累计 {job.attempts} 次模型请求
            </p>
            {job.error && (
              <p className="notice-warn" role="alert">
                {job.error.message}
              </p>
            )}
            {(job.status === 'failed' || job.status === 'cancelled') && (
              <p className="extract-note">继续会沿用已保存结果和这个页范围。</p>
            )}
          </div>
          {running && (
            <button className="secondary-button" disabled={!!action} onClick={() => void update('cancel')}>
              取消内容清理
            </button>
          )}
        </div>
      )}
      <div className="heading-actions">
        {view && !running && (choosingRange || job?.status !== 'completed') && (
          <button className="primary-button" disabled={!ready} onClick={() => void update('start')}>
            {job && !choosingRange ? '继续内容清理' : '开始内容清理'}
          </button>
        )}
        {canChangeRange && !choosingRange && (
          <button className="text-button" disabled={!!action} onClick={() => setChoosingRange(true)}>
            另选清理范围
          </button>
        )}
      </div>
      {job && (job.status === 'completed' || job.decisions.length > 0) && (
        <>
          <p>
            <b>内容归属</b> · 保留 {job.counts.kept} · 归并 {job.counts.merged} · 略过 {job.counts.skipped}
          </p>
          {!!job.topics.length && (
            <p>
              <b>主题</b> · {job.topics.map((topic) => `${topic.title}（${topic.unitCount}）`).join('、')}
            </p>
          )}
          {!!job.decisions.length && (
            <details className="pdf-cleanup-decisions">
              <summary>查看保留、归并与略过理由（{job.decisions.length} 项）</summary>
              <ul>
                {job.decisions.map((item) => (
                  <li key={item.id}>
                    <b>
                      {decisionLabels[item.decision]} · 第 {item.page} 页 ·{' '}
                      {item.origin === 'image' ? '页图 AI 解读' : '原文字层'} · {evidenceKinds[item.kind]}
                    </b>
                    <p>{item.text}</p>
                    <p>
                      {item.reason}
                      {item.topic && ` · ${item.topic}`}
                    </p>
                    <button className="text-button" onClick={(event) => onEvidence(item.page, event.currentTarget)}>
                      查看第 {item.page} 页证据
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {job?.status === 'completed' && !choosingRange && (
        <div className="heading-actions">
          {job.draftId && (
            <button className="primary-button" disabled={!!action} onClick={() => onOpenDraft(job.draftId!)}>
              {job.canRegenerate ? '查看上一份知识草稿' : '打开知识草稿'}
            </button>
          )}
          {(!job.draftId || job.canRegenerate) && (
            <button className="primary-button" disabled={!ready} onClick={() => void update('draft')}>
              {action === 'draft' ? '正在准备草稿…' : job.canRegenerate ? '重新生成知识草稿' : '生成知识草稿'}
            </button>
          )}
          <small>
            {job.draftStatus === 'pending_confirmation' ? '草稿已保存，待审核。' : ''}
            在草稿中编辑、选择并确认要入库的主题。
          </small>
        </div>
      )}
    </section>
  );
}
