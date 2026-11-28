import { PdfPages } from '../../PdfPages';
import { RawWebContent } from '../../components/RawWebContent';
import { api, bytesText, dateText, formatLabels, pdfOriginalPageUrl, rawStatusLabels, sourceLabels } from '../../api';
import { useRawDetail } from './useRawDetail';
import type { RawDetailProps } from './useRawDetail';
import { RawBodyEditor, RawBodyHistory } from './RawBodyEditor';
export function RawDetail({
  initialOriginal = false,
  initialCitation,
  initialTranslation,
  item,
  state,
  job,
  busy,
  error,
  onStartAi,
  onReimport,
  onDelete,
  onOpenDraft,
  onStorageReconciled,
  onBodySaved,
}: RawDetailProps) {
  const {
    modelDisabled,
    editing,
    setEditing,
    historyOpen,
    setHistoryOpen,
    savedBodyNotice,
    setSavedBodyNotice,
    citationMark,
    citation,
    citationMatches,
    translation,
    translationError,
    translationActionError,
    translationAction,
    setTranslationRead,
    setReadingOriginal,
    canReadTranslation,
    readingOriginal,
    updateTranslation,
    status,
    topicSummary,
    topicError,
    mode,
    setMode,
    savingState,
    savingError,
    meetingOnly,
    acquiredRevision,
    editedPdf,
    pdf,
    scannedPdf,
    activeJob,
    storageBlocked,
    retryStorage,
    stage,
    recoveryStatus,
    draftStatus,
    draftId,
    legacyPdfTask,
    pdfPrimary,
  } = useRawDetail({
    initialOriginal,
    initialCitation,
    initialTranslation,
    item,
    state,
    job,
    busy,
    error,
    onStartAi,
    onReimport,
    onDelete,
    onOpenDraft,
    onStorageReconciled,
    onBodySaved,
  });
  const translationCurrent = translation?.rawSha256 === item.bodySha256;
  const translatedBody = translationCurrent && translation.status === 'completed' ? translation.body : undefined;
  const showTranslation = !!translatedBody && !readingOriginal && !citation;
  const translating = translationCurrent && (translation.status === 'queued' || translation.status === 'running');
  return (
    <article className="raw-detail">
      <h2>{item.title}</h2>
      <div className="detail-actions">
        <span className={`status ai-status ${storageBlocked ? 'failed' : status}`}>
          <i />
          {recoveryStatus ??
            draftStatus ??
            (pdfPrimary && status === 'unprocessed' ? 'PDF 原件已保存' : rawStatusLabels[status])}
        </span>
        <span className="detail-type">{sourceLabels[item.sourceType]}</span>
        {meetingOnly && <span className="detail-type meeting-local-badge">本机专用</span>}
        <div className="action-group">
          {!meetingOnly && (
            <>
              <button
                className="text-button"
                onClick={() => {
                  setSavedBodyNotice('');
                  setEditing(true);
                }}
              >
                编辑原文
              </button>
              <button className="text-button" onClick={onReimport}>
                重新导入
              </button>
            </>
          )}
          <button className="text-button danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
      {savedBodyNotice && <p role="status">{savedBodyNotice}</p>}
      {!!item.bodyRevision && (
        <p className="extract-note">
          {(item.bodyRevision ?? 0) === acquiredRevision && item.newsMaterial ? '已补采来源正文。' : '原文已人工修改。'}
          旧版正文仍可在修改历史中查看，依赖旧版正文的整理成果需要重新核对。
        </p>
      )}
      <section className="raw-status-summary" aria-label="整理状态">
        <p>
          <b>当前阶段：</b>
          {recoveryStatus ??
            draftStatus ??
            (pdfPrimary && status === 'unprocessed' ? '请查看下方 PDF 处理进度' : stage)}
          {!storageBlocked &&
          !draftStatus &&
          status === 'pending_confirmation' &&
          (activeJob?.stage === 'done' || activeJob?.checkpoint?.deepStage === 'ready')
            ? '（草稿阶段结束，正式写入仍需确认）'
            : ''}
        </p>
        <div>
          <b>已保留结果：</b>
          {topicSummary?.sourceChanged ? (
            '草稿基于旧原文，无法用来确认新入库。'
          ) : topicSummary?.deferred ? (
            '已保存草稿及剩余成果。'
          ) : status === 'pending_confirmation' && draftId ? (
            '草稿已保存，待你审核。'
          ) : status === 'generated' && (state?.generatedWikiIds?.length ?? 0) > 0 ? (
            <>
              已确认写入：<code className="mono">{state?.generatedWikiIds?.join('、')}</code>
            </>
          ) : pdfPrimary ? (
            '原 PDF 已保存。'
          ) : (
            '暂无可确认的已保存结果。'
          )}
          {activeJob?.checkpoint && (
            <p className="extract-note">
              已验证 {activeJob.checkpoint.validatedChunks}/{activeJob.checkpoint.totalChunks} 提取段，累计{' '}
              {activeJob.checkpoint.attempts} 次调用，复用 {activeJob.checkpoint.reusedChunks} 段；这不是整项完成比例。
            </p>
          )}
        </div>
        {topicError && (
          <p className="form-error" role="alert">
            受影响主题读取失败：{topicError}
          </p>
        )}
        {topicSummary && (
          <div aria-label="受影响知识主题">
            {topicSummary.draft.length > 0 && (
              <p>
                <b>草稿拟影响主题：</b>
                {topicSummary.draft.join('；')}
              </p>
            )}
            {topicSummary.written.length > 0 && (
              <p>
                <b>已写入主题：</b>
                {topicSummary.written.join('、')}
              </p>
            )}
          </div>
        )}
        {storageBlocked && (
          <section className="notice-warn" role="alert">
            <b>{activeJob?.execution === 'running' ? '任务正在停止，状态保存失败' : '任务已停止，状态保存失败'}</b>
            <p>
              {activeJob?.recovery?.message}（{activeJob?.recovery?.phase}）
            </p>
            {savingError && <p className="form-error">{savingError}</p>}
          </section>
        )}
        {status === 'failed' && state?.lastError && (
          <p className="notice-warn">
            <b>问题：</b>
            {state.lastError.code === 'LLM_ATTEMPT_LIMIT' ? (
              '旧任务曾因调用次数停止。可以显式继续，检查点和累计次数会保留。'
            ) : (
              <>
                {state.lastError.message}（{state.lastError.code}）
                {state.lastError.retryable ? '（可以重试）' : '（需要先处理配置或资料问题）'}
              </>
            )}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {pdf && (
          <div className="raw-next-actions">
            <b>PDF 处理</b>
            <p>
              {scannedPdf
                ? '这份 PDF 没有文字层，可以用页图进行 AI 页理解。'
                : '可以查看原页图和文字层，再按需开始 AI 页理解。'}
              按页整理后，在成果草稿中审核并选择要入库的主题。
            </p>
            <a href="#pdf-pages" className="text-button">
              前往 PDF 逐页阅读
            </a>
            {draftId && !storageBlocked && (
              <button className="text-button" onClick={() => onOpenDraft(draftId)}>
                {topicSummary?.commitRecovery
                  ? '查看上次确认'
                  : topicSummary?.history
                    ? '查看整理结果'
                    : '打开已保存草稿'}
              </button>
            )}
          </div>
        )}
        {meetingOnly ? (
          <p className="notice-warn">
            Meeting来源仅限本机保存：禁止外部 AI、Wiki沉淀与Prompt背景使用。请在会议档案编辑纪要工作副本。
          </p>
        ) : (
          (!pdf || legacyPdfTask) && (
            <div className="raw-next-actions">
              <b>{legacyPdfTask ? '已有正文整理任务' : '下一步'}</b>
              {(status === 'unprocessed' || status === 'failed' || status === 'generated') && (
                <>
                  <label className="field raw-extraction-mode">
                    整理模式
                    <select
                      aria-label="整理模式"
                      value={mode}
                      disabled={busy}
                      onChange={(e) => setMode(e.target.value as 'standard' | 'deep')}
                    >
                      <option value="deep" disabled={item.body.length > 30000}>
                        深度整理
                      </option>
                      <option value="standard">标准整理</option>
                    </select>
                    <small>
                      {item.body.length > 30000
                        ? '正文超过30000字符，深度整理不可选；标准整理保留全文。'
                        : '深度整理生成结构化阅读笔记，可显式选择标准整理。'}
                    </small>
                  </label>
                  <div>
                    <button
                      className="text-button ai-action"
                      disabled={busy || storageBlocked || !!modelDisabled}
                      title={modelDisabled}
                      onClick={() =>
                        onStartAi(
                          false,
                          false,
                          status === 'failed' && activeJob ? (activeJob.mode ?? 'standard') : mode,
                        )
                      }
                    >
                      {busy
                        ? '正在启动…'
                        : status === 'failed' && activeJob?.pipelineVersion
                          ? '显式继续提取'
                          : status === 'failed'
                            ? '重试 AI 整理'
                            : '整理到知识库'}
                    </button>
                    <p className="extract-note">
                      {modelDisabled ||
                        (status === 'failed' && activeJob?.pipelineVersion
                          ? `从现有检查点尝试继续，沿用原任务${activeJob.mode === 'deep' ? '深度' : '标准'}模式并保留累计调用；可恢复性由服务端判定。`
                          : '自动准备知识页成果，待你选择并确认。')}
                    </p>
                  </div>
                </>
              )}
              {status === 'processing' && activeJob && activeJob.execution !== 'settled' && !storageBlocked && (
                <button
                  className="text-button"
                  onClick={async () => {
                    await api(`/api/extraction-jobs/${encodeURIComponent(activeJob.jobId)}/cancel`, {
                      method: 'POST',
                      body: JSON.stringify({}),
                    });
                  }}
                >
                  取消整理
                </button>
              )}
              {(status === 'pending_confirmation' || topicSummary?.commitRecovery) &&
                draftId &&
                !storageBlocked &&
                !topicSummary?.history && (
                  <div>
                    <button className="text-button ai-action" onClick={() => onOpenDraft(draftId)}>
                      {topicSummary?.commitRecovery
                        ? '查看上次确认'
                        : topicSummary?.sourceChanged
                          ? '查看旧草稿'
                          : topicSummary?.deferred
                            ? '查看暂缓成果'
                            : '继续审核'}
                    </button>
                    <p className="extract-note">
                      {topicSummary?.commitRecovery
                        ? '打开原成果，继续完成上次确认。'
                        : topicSummary?.sourceChanged
                          ? '可以在旧草稿中结束本次选择，再按当前原文整理。'
                          : topicSummary?.deferred
                            ? '打开原草稿后，选择继续处理。'
                            : '先查看整理成果，选出值得入库的主题后统一确认。'}
                    </p>
                  </div>
                )}
              {topicSummary?.history && draftId && (
                <button className="text-button" onClick={() => onOpenDraft(draftId)}>
                  查看整理结果
                </button>
              )}
              {status === 'failed' &&
                activeJob?.mode !== 'deep' &&
                activeJob?.error?.code === 'LLM_PLAN_COVERAGE_INVALID' && (
                  <div>
                    <button
                      className="text-button"
                      disabled={busy || storageBlocked || !!modelDisabled}
                      title={modelDisabled}
                      onClick={() => onStartAi(false, true, 'standard')}
                    >
                      仅重新规划（带覆盖诊断）
                    </button>
                    <p className="extract-note">使用既有提取结果重新规划，模型调用继续累计。</p>
                  </div>
                )}
              {status === 'failed' && activeJob?.pipelineVersion && (
                <div>
                  <button
                    className="text-button"
                    disabled={busy || storageBlocked || !!modelDisabled}
                    title={modelDisabled}
                    onClick={() => onStartAi(true, false, mode)}
                  >
                    明确重新生成
                  </button>
                  <p className="extract-note">按当前选择模式重新生成，仍会显示实际累计调用。</p>
                </div>
              )}
              {storageBlocked && (
                <div>
                  <button
                    className="secondary-button"
                    disabled={savingState || activeJob?.execution !== 'settled'}
                    onClick={() => void retryStorage()}
                  >
                    {savingState ? '正在保存状态…' : '重试保存状态'}
                  </button>
                  <p className="extract-note">
                    {activeJob?.execution === 'running' ? '等待任务停止后再试。' : '仅对账本机状态，不会重新调用模型。'}
                  </p>
                </div>
              )}
            </div>
          )
        )}
      </section>
      {item.isDemo && <p className="demo-notice">【演示数据】虚构教学示例，不代表真实公司或业务事实。</p>}
      <div className="detail-source">
        {item.sourceName}
        {item.author ? ` · ${item.author}` : ''}
      </div>
      <div className="metadata-grid">
        <Meta label="导入时间" value={dateText(item.importedAt)} />
        <Meta label="原发布日期" value={item.publishedAt || '未填写'} />
        <Meta label="来源链接" value={item.url || '未填写'} link={!!item.url} />
      </div>
      {item.urlImport && (
        <section className="detail-asset" aria-label="网页导入来源">
          <div className="detail-asset-head">
            <span>网页导入来源</span>
          </div>
          <div className="metadata-grid">
            <Meta label="实际读取地址" value={item.urlImport.finalUrl} link />
            <Meta label="网页读取时间" value={dateText(item.urlImport.fetchedAt)} />
            <Meta label="解析方式" value={item.extractionParser === 'url_plain_text' ? '网页纯文本' : '静态网页正文'} />
          </div>
          {item.extractionNote && <p className="extract-note">{item.extractionNote}</p>}
        </section>
      )}

      {item.tags.length > 0 && (
        <div className="tag-row">
          {item.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      {item.assetId && (
        <section className="detail-asset">
          <div className="detail-asset-head">
            <span>原始文件</span>
            <span className="retained-badge">原件已保留</span>
          </div>
          <div className="metadata-grid">
            <Meta label="原文件名" value={item.assetFileName || '未记录'} />
            <Meta
              label="实际格式"
              value={formatLabels[item.assetFormat ?? 'unknown'] ?? item.assetFormat ?? '未记录'}
            />
            <Meta label="原文件字节数" value={bytesText(item.assetByteSize)} />
            <Meta label="asset ID" value={item.assetId} mono />
            <Meta label="原文件 SHA-256" value={item.assetSha256 || '未记录'} mono />
          </div>
          {item.extractionNote && <p className="extract-note">提取说明：{item.extractionNote}</p>}
        </section>
      )}
      {editedPdf && (
        <section className="detail-asset" aria-label="PDF 原件">
          <p className="notice-warn">
            PDF 提取文字已人工修改，PDF 原件未改。原页文字位置、页理解与按页整理成果不适用于当前正文。
          </p>
          <a href={pdfOriginalPageUrl(item.id, 1)} target="_blank" rel="noreferrer" className="text-button">
            打开 PDF 原件
          </a>
        </section>
      )}
      {pdf && <PdfPages rawId={item.id} onOpenDraft={onOpenDraft} />}
      {canReadTranslation && (
        <>
          {translating && (
            <section className="raw-translation-status" aria-label="翻译进度">
              <span role="status">
                {translation.status === 'queued'
                  ? '等待翻译成中文'
                  : `正在翻译成中文（${translation.completedChunks}/${translation.totalChunks} 段）`}
              </span>
              <button
                className="text-button"
                disabled={!!translationAction}
                onClick={() => void updateTranslation('cancel')}
              >
                取消翻译
              </button>
            </section>
          )}
          {translationCurrent && translation.status === 'failed' && (
            <div className="notice-warn raw-translation-status" role="alert">
              <div>
                <b>原始资料已保存，中文翻译未完成。</b>
                {translation.error && <p>{translation.error.message}</p>}
              </div>
              <button
                className="secondary-button"
                disabled={!!translationAction || !!modelDisabled}
                title={modelDisabled}
                onClick={() => void updateTranslation('retry')}
              >
                {translationAction === 'retry' ? '正在重试…' : '重试翻译'}
              </button>
            </div>
          )}
          {translationCurrent && translation.status === 'cancelled' && (
            <div className="raw-translation-status">
              <span>翻译已取消，仍可阅读原文。</span>
              <button
                className="secondary-button"
                disabled={!!translationAction || !!modelDisabled}
                title={modelDisabled}
                onClick={() => void updateTranslation('retry')}
              >
                继续翻译
              </button>
            </div>
          )}
          {translationCurrent && translation.status === 'skipped' && translation.reason && (
            <p className="extract-note">{translation.reason}</p>
          )}
          {translationError && (
            <div className="form-error raw-translation-status" role="alert">
              <span>翻译状态暂不可用。{translationError}</span>
              <button
                className="text-button"
                disabled={!!translationAction}
                onClick={() => setTranslationRead((value) => value + 1)}
              >
                重读状态
              </button>
            </div>
          )}
          {translationActionError && (
            <p className="form-error" role="alert">
              {translationActionError}
            </p>
          )}
        </>
      )}
      <div className="body-divider">
        <span>{showTranslation ? 'AI 中文译文' : editedPdf ? '人工修订后的提取文字' : '原始正文'}</span>
        {translatedBody ? (
          <div className="raw-reader-tabs" role="group" aria-label="正文语言">
            <button
              className="text-button"
              aria-pressed={showTranslation}
              disabled={!!citation}
              onClick={() => setReadingOriginal(false)}
            >
              中文译文
            </button>
            <button className="text-button" aria-pressed={!showTranslation} onClick={() => setReadingOriginal(true)}>
              原文
            </button>
          </div>
        ) : (
          <span>SHA-256 已保存</span>
        )}
      </div>
      {citation && (
        <p className={citationMatches ? 'extract-note' : 'form-error'}>
          {citationMatches
            ? `本次引用原句：[${citation.start}, ${citation.end})`
            : '引用位置或原文版本已变化，未标记旧位置。'}
        </p>
      )}
      {scannedPdf ? (
        <p className="extract-note">未提取到文字层。请在上方查看原 PDF 页图。</p>
      ) : !showTranslation && !citation && item.webImages?.length ? (
        <RawWebContent key={`${item.id}:${item.bodySha256}`} raw={item} />
      ) : (
        <pre className="raw-body" lang={showTranslation ? 'zh-CN' : undefined}>
          {showTranslation ? (
            translatedBody
          ) : citation && citationMatches ? (
            <>
              {item.body.slice(0, citation.start)}
              <mark ref={citationMark} data-citation-start={citation.start} data-citation-end={citation.end}>
                {item.body.slice(citation.start, citation.end)}
              </mark>
              {item.body.slice(citation.end)}
            </>
          ) : (
            item.body
          )}
        </pre>
      )}
      {!!item.bodyRevision && (
        <button className="text-button" onClick={() => setHistoryOpen(true)}>
          查看原文修改历史
        </button>
      )}
      <details className="raw-identifiers">
        <summary>资料标识与校验值</summary>
        <div className="metadata-grid">
          <Meta label="资料 ID" value={item.id} mono />
          {item.origin && (
            <>
              <Meta label="Meeting ID" value={item.origin.meeting_id} mono />
              <Meta label="来源版本" value={item.origin.import_id} mono />
              <Meta label="原件 SHA-256" value={item.origin.original_sha256} mono />
              <Meta label="处理策略" value={item.origin.processing_policy} mono />
            </>
          )}
        </div>
        <div className="hash-line">
          正文校验值 <code>{item.bodySha256}</code>
        </div>
      </details>
      {editing && (
        <RawBodyEditor
          item={item}
          onClose={() => setEditing(false)}
          onSaved={(raw) => {
            onBodySaved(raw);
            if (raw.body.length > 30000) setMode('standard');
            setReadingOriginal(true);
            setSavedBodyNotice(
              raw.bodyRevision === item.bodyRevision ? '原文没有变化。' : '原文已保存，修改前的版本已保留。',
            );
            setEditing(false);
          }}
        />
      )}
      {historyOpen && <RawBodyHistory item={item} onClose={() => setHistoryOpen(false)} />}
    </article>
  );
}
function Meta({ label, value, link, mono }: { label: string; value: string; link?: boolean; mono?: boolean }) {
  return (
    <div className="meta">
      <span>{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <b className={mono ? 'mono' : ''}>{value}</b>
      )}
    </div>
  );
}
