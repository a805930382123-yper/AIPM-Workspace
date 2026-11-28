import { useRef, useState } from 'react';
import type { AnswerCitation } from '../../../services/wiki/question-input';
import type { RawSummary, Wiki, WikiSchema } from '../../api';
import { dateText, sourceLabels } from '../../api';
import { FormalNoteReader } from '../../components/FormalNoteReader';
import { WikiFreshnessBadge, WikiReviewActions, WikiReviewReasons } from '../../components/WikiReview';
import { AuditPanel } from './AuditPanel';
import { statusLabels, typeLabel } from './wikiShared';

export function WikiDetail({
  citation,
  item,
  schema,
  raws,
  busy,
  onEdit,
  onDelete,
  onOpenRaw,
  onOpenWiki,
  onChanged,
  onReviewed,
  onReviewOutdated,
  initialAudit,
}: {
  citation?: AnswerCitation | null;
  initialAudit?: { wikiId: string; auditId: string; revision: number; wikiRevision: number } | null;
  item: Wiki;
  schema: WikiSchema | null;
  raws: RawSummary[];
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenRaw: (id: string) => void;
  onOpenWiki: (id: string) => void;
  onChanged: () => void;
  onReviewed: (wiki: Wiki) => void;
  onReviewOutdated: () => Promise<void>;
}) {
  const [reading, setReading] = useState(true);
  const links = item.links ?? [];
  const backlinks = item.backlinks ?? [];
  const bodyRef = useRef<HTMLPreElement>(null);
  const [anchor, setAnchor] = useState<{ before: string; text: string; after: string } | null>(null);
  const captureSelection = () => {
    const selection = window.getSelection();
    const node = bodyRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      !node ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !node.contains(selection.anchorNode) ||
      !node.contains(selection.focusNode)
    )
      return;
    const range = selection.getRangeAt(0);
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(node);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const selected = range.toString();
    const start = beforeRange.toString().length;
    if (!selected) return;
    setAnchor({
      before: item.body.slice(Math.max(0, start - 80), start),
      text: selected,
      after: item.body.slice(start + selected.length, start + selected.length + 80),
    });
  };
  return (
    <article className="wiki-detail">
      <div className="wiki-detail-actions">
        <div className="wiki-badges">
          <span className="detail-type">{typeLabel(schema, item.type)}</span>
          <span className="tag">
            {schema?.categories.find((value) => value.id === item.category)?.label ?? item.category}
          </span>
          <span className="status wiki-status">{statusLabels[item.knowledge_status] ?? item.knowledge_status}</span>
          {item.freshness && <WikiFreshnessBadge freshness={item.freshness} />}
        </div>
        <div className="action-group">
          <a
            className="secondary-button"
            href={`/api/wiki/${encodeURIComponent(item.id)}/export`}
            download={`wiki-${item.id}.md`}
          >
            导出 Markdown
          </a>
          <button className="secondary-button" onClick={onEdit}>
            编辑
          </button>
          <button className="danger-quiet" onClick={onDelete} disabled={busy}>
            删除
          </button>
        </div>
      </div>
      <h2>
        {item.title}
        {item.isDemo && <span className="demo-badge">演示数据</span>}
      </h2>
      {item.isDemo && <p className="demo-notice">【演示数据】该知识页尚未核验，来源与内容仅用于教学示例。</p>}
      <div className="wiki-submeta">
        {item.aliases.length > 0 && <span>别名：{item.aliases.join('、')}</span>}
        <span>
          第 {item.revision} 版 · 更新于 {dateText(item.updated)}
        </span>
      </div>
      {item.freshness && (
        <section className="wiki-review-detail" aria-label="时效复核">
          {item.freshness.lastVerifiedAt && <p>人工核验日期 {item.freshness.lastVerifiedAt}</p>}
          {!item.freshness.remindersAvailable && <p role="status">复核提醒暂时不可读取。</p>}
          <WikiReviewReasons freshness={item.freshness} />
          <WikiReviewActions
            id={item.id}
            revision={item.revision}
            cycleDays={item.freshness.cycleDays}
            options
            onUpdated={onReviewed}
            onOutdated={onReviewOutdated}
          />
        </section>
      )}
      <div className="wiki-meta-grid">
        <Meta label="知识状态" value={statusLabels[item.knowledge_status] ?? item.knowledge_status} />
        <Meta label="人工审核" value={statusLabels[item.review_status] ?? item.review_status} />
        <Meta label="可信度" value={item.confidence} />
        <Meta label="来源等级" value={item.source_level} />
      </div>
      {item.tags.length > 0 && (
        <div className="tag-row">
          {item.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      <section className="wiki-section">
        <div className="section-header">
          <h3>知识内容</h3>
          <div className="reading-tabs" role="group" aria-label="知识内容视图">
            <button
              className={reading ? 'selected' : ''}
              aria-pressed={reading}
              onClick={() => {
                setReading(true);
                setAnchor(null);
              }}
            >
              阅读视图
            </button>
            <button
              className={!reading ? 'selected' : ''}
              aria-pressed={!reading}
              onClick={() => {
                setReading(false);
                setAnchor(null);
              }}
            >
              Markdown原文
            </button>
          </div>
          <span>{reading ? '切换Markdown原文后选段纠错' : '选中段落后可提交纠错'}</span>
        </div>
        {citation && citation.recordId === item.id && citation.revision === item.revision ? (
          <pre className="wiki-body-view inspection-evidence-position" tabIndex={0}>
            {item.body.slice(0, citation.start)}
            <mark data-inspection-evidence={citation.id}>{item.body.slice(citation.start, citation.end)}</mark>
            {item.body.slice(citation.end)}
          </pre>
        ) : reading ? (
          <FormalNoteReader body={item.body} />
        ) : (
          <pre ref={bodyRef} onMouseUp={captureSelection} className="wiki-body-view">
            {item.body}
          </pre>
        )}
        {anchor && !reading && (
          <div className="audit-selection">
            <span>
              已选：{anchor.text.slice(0, 100)}
              {anchor.text.length > 100 ? '…' : ''}
            </span>
            <button
              className="secondary-button"
              onClick={() => window.dispatchEvent(new CustomEvent('audit:create-paragraph', { detail: anchor }))}
            >
              对选中段落提交 Audit
            </button>
            <button className="text-button" onClick={() => setAnchor(null)}>
              清除
            </button>
          </div>
        )}
      </section>
      <section className="wiki-section">
        <h3>来源 Raw · {item.sources.length}</h3>
        {item.sources.length ? (
          <div className="source-cards">
            {item.sources.map((id) => {
              const raw = raws.find((value) => value.id === id);
              return (
                <button className="source-card" key={id} onClick={() => onOpenRaw(id)}>
                  <span className="source-card-icon">原</span>
                  <span>
                    <b>
                      {raw?.title ?? '找不到 Raw 来源'}
                      {raw?.isDemo && <span className="demo-badge">演示数据</span>}
                    </b>
                    <small>
                      {raw
                        ? `${sourceLabels[raw.sourceType]} · ${raw.sourceName}${raw.author ? ` · ${raw.author}` : ''}`
                        : `ID ${id}`}
                    </small>
                    <small>
                      {raw
                        ? `发布于 ${raw.publishedAt?.slice(0, 10) || '日期未提供'} · 导入于 ${dateText(raw.importedAt)}${raw.url ? ` · ${raw.url}` : ''}`
                        : '此来源可能已移除'}
                    </small>
                  </span>
                  <strong>打开来源Raw ›</strong>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="muted-copy">未关联 Raw 来源。</p>
        )}
      </section>
      {links.length > 0 && (
        <section className="wiki-section">
          <h3>Wiki 关联 · {links.length}</h3>
          <div className="link-status-list">
            {links.map((link) => (
              <div className="wiki-link-row" key={link.target}>
                <code>[[{link.target}]]</code>
                {link.status === 'resolved' && link.candidates[0] ? (
                  <button className="text-button" onClick={() => onOpenWiki(link.candidates[0].id)}>
                    {link.candidates[0].title} ›
                  </button>
                ) : link.status === 'ambiguous' ? (
                  <span className="link-ambiguous">
                    存在歧义：
                    {link.candidates.map((candidate) => (
                      <button className="text-button" key={candidate.id} onClick={() => onOpenWiki(candidate.id)}>
                        {candidate.title}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="link-missing">未找到匹配页面</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {backlinks.length > 0 && (
        <section className="wiki-section">
          <h3>反向链接 · {backlinks.length}</h3>
          <div className="link-status-list">
            {backlinks.map(({ id, title }) => (
              <div className="wiki-link-row" key={id}>
                <button className="text-button" onClick={() => onOpenWiki(id)}>
                  {title} ›
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <AuditPanel
        initialAudit={initialAudit}
        item={item}
        onChanged={onChanged}
        selectedAnchor={anchor}
        onClearAnchor={() => setAnchor(null)}
      />
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
