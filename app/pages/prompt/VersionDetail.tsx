import type { PromptVersion, PromptWikiLink } from '../../api';
import { dateText, promptChangeSourceLabels, promptSourceLabels } from '../../api';
import { PromptFeedback } from '../../components/PromptFeedback';
import { Meta } from './Meta';

export function VersionDetail({
  version,
  categoryLabel,
  wikiTitle,
  linkById,
  onBack,
  onOpenWiki,
}: {
  version: PromptVersion;
  categoryLabel: string;
  wikiTitle: (id: string) => string | null;
  linkById: Map<string, PromptWikiLink>;
  onBack: () => void;
  onOpenWiki: (id: string) => void;
}) {
  const snapshot = version.snapshot;
  return (
    <article className="prompt-detail prompt-history">
      <div className="history-banner" role="status">
        <div>
          <b>正在查看第 {version.version} 版（历史快照，只读）</b>
          <span>
            保存于 {dateText(version.savedAt)} · {promptChangeSourceLabels[version.changeSource]}
            。历史版本不能填写变量或复制，也不会被本次查看修改。
          </span>
        </div>
        <button className="secondary-button" onClick={onBack}>
          返回当前版本
        </button>
      </div>
      <h2>{snapshot.name}</h2>
      <div className="prompt-badges">
        <span className="tag">{categoryLabel}</span>
        <span className="tag">{promptSourceLabels[snapshot.source]}</span>
        {snapshot.favorite && <span className="tag">已收藏</span>}
      </div>
      <div className="prompt-meta-grid">
        <Meta label="版本" value={`第 ${snapshot.version} 版`} />
        <Meta label="修改来源" value={promptChangeSourceLabels[version.changeSource]} />
        <Meta label="保存时间" value={dateText(version.savedAt)} />
        <Meta
          label="变量"
          value={snapshot.variables.length ? snapshot.variables.map((name) => `{{${name}}}`).join('、') : '无'}
        />
      </div>
      {snapshot.scenario && (
        <section className="prompt-section">
          <h3>场景</h3>
          <p>{snapshot.scenario}</p>
        </section>
      )}
      {snapshot.inputRequirements && (
        <section className="prompt-section">
          <h3>输入要求</h3>
          <p>{snapshot.inputRequirements}</p>
        </section>
      )}
      {snapshot.outputRequirements && (
        <section className="prompt-section">
          <h3>输出要求</h3>
          <p>{snapshot.outputRequirements}</p>
        </section>
      )}
      {snapshot.tags.length > 0 && (
        <div className="tag-row">
          {snapshot.tags.map((value) => (
            <span key={value} className="tag">
              {value}
            </span>
          ))}
        </div>
      )}
      {snapshot.relatedWikiIds.length > 0 && (
        <section className="prompt-section">
          <h3>相关 Wiki</h3>
          <div className="link-status-list">
            {snapshot.relatedWikiIds.map((id) => (
              <div className="wiki-link-row" key={id}>
                <code>{id}</code>
                {linkById.get(id)?.status === 'missing' || !wikiTitle(id) ? (
                  <span className="link-missing">关联已失效（当前版本也不存在这个 Wiki）</span>
                ) : (
                  <button className="text-button" onClick={() => onOpenWiki(id)}>
                    {wikiTitle(id)} ›
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {snapshot.examples && (
        <section className="prompt-section">
          <h3>示例</h3>
          <pre className="prompt-body-view">{snapshot.examples}</pre>
        </section>
      )}
      <section className="prompt-section">
        <h3>正文（第 {snapshot.version} 版原样）</h3>
        <pre className="prompt-body-view">{snapshot.body}</pre>
      </section>
      <PromptFeedback
        key={`${snapshot.id}-${snapshot.version}`}
        promptId={snapshot.id}
        promptName={snapshot.name}
        promptVersion={snapshot.version}
      />
    </article>
  );
}
