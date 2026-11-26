import type { RawDraftView } from '../../api';
import { mediaEvidenceHref } from '../../../services/raw/media-artifact';
import { templateSections, hasTemplateFields } from '../../../services/wiki/template-fields';
import type { DraftReviewPageProps } from './draftReviewModel';
import type { DraftReviewState } from './useDraftReviewState';
import { TemplateFieldsEditor } from './TemplateFieldsEditor';
import { DuplicateCheckSection } from './DuplicateCheckSection';

export function DraftPageEditors({
  state,
  view,
  onOpenRaw,
}: {
  state: DraftReviewState;
  view: RawDraftView;
  onOpenRaw: DraftReviewPageProps['onOpenRaw'];
}) {
  const {
    pages,
    selectedIds,
    readOnly,
    busy,
    setPages,
    mergePick,
    setMergePick,
    mergePages,
    dirty,
    confirmPage,
    updatePage,
    removePage,
    typeOptions,
    schema,
    updateTemplateField,
    updateMergedField,
  } = state;
  const outcomeMode = !!view.outcomeDigest;
  return (
    <section className="panel draft-pages-panel">
      <div className="panel-heading">
        <div>
          <h2>{outcomeMode ? '主题字段与合并' : `知识建议（${pages.length} 条，已选 ${selectedIds.length} 条）`}</h2>
          <p>
            {outcomeMode
              ? '修改已保存的字段或合并相关草稿主题。'
              : view.structuredNote
                ? '仅创建勾选的知识卡片；未选卡片仅以纯文本列为本次未创建建议。'
                : '默认全部未选中的建议不会被写入；只有勾选的条目会创建为正式 Wiki。'}
          </p>
        </div>
        <div className="action-group">
          {!outcomeMode && (
            <button
              className="secondary-button"
              disabled={readOnly || busy !== ''}
              onClick={() => setPages((current) => current.map((page) => ({ ...page, selected: true })))}
            >
              全选
            </button>
          )}
          {!outcomeMode && (
            <button
              className="secondary-button"
              disabled={readOnly || busy !== ''}
              onClick={() => setPages((current) => current.map((page) => ({ ...page, selected: false })))}
            >
              全不选
            </button>
          )}
          <button
            className="secondary-button"
            disabled={readOnly || mergePick.length < 2 || busy !== ''}
            onClick={() => void mergePages()}
          >
            {busy === 'merge' ? '正在合并…' : `合并所选（${mergePick.length}）`}
          </button>
        </div>
      </div>
      {pages.map((page, index) => (
        <article
          className={`draft-card ${page.selected ? 'selected' : ''}`}
          key={page.pageId}
          data-page-id={page.pageId}
        >
          {!outcomeMode && view.humanReview && (
            <div className="draft-card-body">
              <p>
                {!dirty &&
                view.humanReview.approvals.some(
                  (a) => a.pageId === page.pageId && a.digest === view.reviewContentDigest,
                )
                  ? '本页主题与完整归属已确认'
                  : '本页主题与完整归属尚未确认'}
              </p>
              <button
                className="secondary-button"
                disabled={readOnly || busy !== '' || dirty}
                onClick={() => void confirmPage(page.pageId, true)}
              >
                确认本页主题与归属
              </button>
              <button
                className="text-button"
                disabled={readOnly || busy !== '' || dirty}
                onClick={() => void confirmPage(page.pageId, false)}
              >
                撤销本页确认
              </button>
            </div>
          )}
          <div className="draft-card-head">
            {!outcomeMode && (
              <label className="draft-select">
                <input
                  type="checkbox"
                  checked={page.selected}
                  disabled={readOnly || busy !== ''}
                  onChange={(event) => updatePage(page.pageId, { selected: event.target.checked })}
                />
                <span>写入</span>
              </label>
            )}
            <label className="draft-select">
              <input
                type="checkbox"
                checked={mergePick.includes(page.pageId)}
                disabled={readOnly || busy !== ''}
                onChange={(event) =>
                  setMergePick((current) =>
                    event.target.checked ? [...current, page.pageId] : current.filter((id) => id !== page.pageId),
                  )
                }
              />
              <span>合并</span>
            </label>
            <span className="draft-index">#{index + 1}</span>
            <input
              className="draft-title"
              value={page.title}
              disabled={readOnly || busy !== ''}
              onChange={(event) => updatePage(page.pageId, { title: event.target.value })}
              maxLength={300}
              aria-label="建议标题"
            />
            <button
              className="text-button danger"
              disabled={readOnly || busy !== '' || pages.length <= 1}
              onClick={() => void removePage(page.pageId)}
            >
              删除
            </button>
          </div>
          <div className="draft-enum-row">
            <label className="field">
              类型
              <select
                value={page.type}
                disabled={readOnly || busy !== ''}
                onChange={(event) => updatePage(page.pageId, { type: event.target.value })}
              >
                {typeOptions.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              分类
              <select
                value={page.category}
                disabled={readOnly || busy !== ''}
                onChange={(event) => updatePage(page.pageId, { category: event.target.value })}
              >
                {(schema?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              来源等级
              <select
                value={page.source_level}
                disabled={readOnly || busy !== ''}
                onChange={(event) => updatePage(page.pageId, { source_level: event.target.value })}
              >
                {(schema?.sourcePolicy.levels ?? []).map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              知识状态
              <select
                value={page.knowledge_status}
                disabled={readOnly || busy !== ''}
                onChange={(event) => updatePage(page.pageId, { knowledge_status: event.target.value })}
              >
                {(schema?.enums.knowledge_status ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              可信度
              <select
                value={page.confidence}
                disabled={readOnly || busy !== ''}
                onChange={(event) => updatePage(page.pageId, { confidence: event.target.value })}
              >
                {(schema?.enums.confidence ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!outcomeMode && <DuplicateCheckSection state={state} view={view} page={page} />}
          <label className="field">
            一句话说明
            <input
              value={page.one_line_definition}
              disabled={readOnly || busy !== ''}
              onChange={(event) => updatePage(page.pageId, { one_line_definition: event.target.value })}
              maxLength={300}
            />
          </label>
          {templateSections(page.type).length > 0 && (
            <section className="draft-block" aria-label={`${page.title}字段归位`}>
              <h4>字段归位</h4>
              <p className="extract-note">
                AI草稿与人工说明分别保存。合并会保留各原页的字段组和原类型栏目；旧 Wiki
                更新保留已审字段快照。带字段内容的类型切换仍不支持。
              </p>
              <button
                className="text-button danger"
                disabled={readOnly || busy !== '' || !hasTemplateFields(page.templateFields)}
                onClick={() => updatePage(page.pageId, { templateFields: {} })}
              >
                清空字段归位（删除当前内容）
              </button>
              <p className="extract-note">清空是删除。未保存可刷新撤回；保存后不提供恢复。</p>
              <TemplateFieldsEditor
                type={page.type}
                fields={page.templateFields}
                evidence={page.source_evidence}
                disabled={readOnly || busy !== ''}
                onChange={(key, patch) => updateTemplateField(page, key, patch)}
              />
            </section>
          )}
          {page.mergedTemplateFields?.map((group, index) => (
            <section className="draft-block" key={group.pageId} data-merged-group={group.pageId}>
              <h4>
                合并前字段组：{group.title}（{group.pageType}）
              </h4>
              <p className="extract-note">
                原页 {group.pageId} · Raw {group.rawId}
                ；下列引用ID仅属于本原页字段组。原身份和目录只读，内容可明确编辑或删除。
              </p>
              <TemplateFieldsEditor
                type={group.pageType}
                fields={group.fields}
                evidence={group.evidence}
                disabled={readOnly || busy !== ''}
                onChange={(key, patch) => updateMergedField(page, index, key, patch)}
              />
            </section>
          ))}
          {page.renderedBody && (
            <details className="draft-block">
              <summary>完整正文预览（已保存内容）</summary>
              {dirty && <p className="notice-warn">存在未保存编辑；此处仍为上次保存后的正文。</p>}
              <pre className="draft-raw-preview">{page.renderedBody}</pre>
            </details>
          )}
          <div className="draft-split">
            <div className="draft-block">
              <h4>来源事实（原文支持，逐条带证据）</h4>
              {page.source_facts.map((fact, factIndex) => (
                <div className="draft-line" key={`${page.pageId}-fact-${factIndex}`}>
                  <textarea
                    value={fact.text}
                    readOnly
                    rows={2}
                    onChange={(event) => {
                      const source_facts = page.source_facts.map((item, itemIndex) =>
                        itemIndex === factIndex ? { ...item, text: event.target.value } : item,
                      );
                      updatePage(page.pageId, { source_facts });
                    }}
                  />
                  <span className="draft-evidence-ref">证据 {fact.evidenceIds.join('、')}</span>
                </div>
              ))}
              {!page.source_facts.length && <p className="extract-note">没有原文支持的事实。</p>}
            </div>
            <div className="draft-block">
              <h4>AI 整理 / 人工说明</h4>
              <button
                className="text-button"
                disabled={readOnly || busy !== ''}
                onClick={() => updatePage(page.pageId, { ai_organized: [...page.ai_organized, ''] })}
              >
                添加人工整理说明
              </button>
              {page.ai_organized.map((item, itemIndex) => (
                <div className="draft-line" key={`${page.pageId}-org-${itemIndex}`}>
                  <textarea
                    value={item}
                    disabled={readOnly || busy !== ''}
                    rows={2}
                    onChange={(event) => {
                      const ai_organized = page.ai_organized.map((value, valueIndex) =>
                        valueIndex === itemIndex ? event.target.value : value,
                      );
                      updatePage(page.pageId, { ai_organized });
                    }}
                  />
                </div>
              ))}
              {!page.ai_organized.length && <p className="extract-note">暂无</p>}
            </div>
            <div className="draft-block">
              <h4>AI 推断</h4>
              {page.ai_inferences.map((item, itemIndex) => (
                <div className="draft-line" key={`${page.pageId}-inf-${itemIndex}`}>
                  <textarea
                    value={item}
                    disabled={readOnly || busy !== ''}
                    rows={2}
                    onChange={(event) => {
                      const ai_inferences = page.ai_inferences.map((value, valueIndex) =>
                        valueIndex === itemIndex ? event.target.value : value,
                      );
                      updatePage(page.pageId, { ai_inferences });
                    }}
                  />
                </div>
              ))}
              {!page.ai_inferences.length && <p className="extract-note">暂无</p>}
            </div>
            <div className="draft-block">
              <h4>待确认问题</h4>
              {page.open_questions.map((item, itemIndex) => (
                <div className="draft-line" key={`${page.pageId}-q-${itemIndex}`}>
                  <textarea
                    value={item}
                    readOnly
                    rows={2}
                    onChange={(event) => {
                      const open_questions = page.open_questions.map((value, valueIndex) =>
                        valueIndex === itemIndex ? event.target.value : value,
                      );
                      updatePage(page.pageId, { open_questions });
                    }}
                  />
                </div>
              ))}
              {page.open_questions.length === 0 && <p className="extract-note">暂无</p>}
            </div>
          </div>
          <div className="draft-evidence">
            <h4>
              {page.source_evidence.some((evidence) => evidence.media)
                ? '来源证据'
                : '来源证据（全局位置已按完整 Raw 校验）'}
            </h4>
            {page.source_evidence.map((evidence) => (
              <div className="draft-evidence-row" key={evidence.id}>
                <code className="mono">{evidence.id}</code>
                <span className="draft-evidence-quote">{evidence.quote}</span>
                <span className="draft-evidence-pos">
                  [{evidence.start}, {evidence.end}) ·{' '}
                  {evidence.media ? `图片 ${evidence.media.imageIndex}` : `第 ${evidence.chunkIndex + 1} 段`}
                </span>
                {evidence.media ? (
                  <a
                    className="text-button"
                    href={mediaEvidenceHref(evidence.rawId, evidence.media)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看图片解析
                  </a>
                ) : (
                  <button
                    className="text-button"
                    onClick={() =>
                      onOpenRaw(
                        view.rawId,
                        view.rawSha256
                          ? {
                              rawId: view.rawId,
                              start: evidence.start,
                              end: evidence.end,
                              quote: evidence.quote,
                              bodySha256: view.rawSha256,
                            }
                          : undefined,
                      )
                    }
                  >
                    查看原文
                  </button>
                )}
              </div>
            ))}
          </div>
          {page.notes && page.notes.length > 0 && (
            <p className="notice-warn">
              {page.notes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </p>
          )}
          {(page.mergedFrom?.length ?? 0) > 0 && (
            <p className="extract-note">由合并生成：{page.mergedFrom?.join('、')}</p>
          )}
        </article>
      ))}
    </section>
  );
}
