import type { RefObject } from 'react';
import type { Prompt, PromptCategory, PromptVersion, PromptWikiLink } from '../../api';
import { dateText, promptChangeSourceLabels, promptExportUrl, promptSourceLabels } from '../../api';
import { PromptFeedback } from '../../components/PromptFeedback';
import type { CopyState } from './promptState';
import { Meta } from './Meta';

export function PromptDetail({
  prompt,
  activeCategory,
  links,
  wikiTitle,
  versions,
  busy,
  variables,
  values,
  finalBody,
  missingLive,
  shownMissing,
  copy,
  copyRef,
  onValues,
  onRender,
  onCopy,
  onFavorite,
  onEdit,
  onDelete,
  onOpenVersion,
  onOpenWiki,
}: {
  prompt: Prompt;
  activeCategory?: PromptCategory;
  links: PromptWikiLink[];
  wikiTitle: (id: string) => string | null;
  versions: PromptVersion[];
  busy: boolean;
  variables: string[];
  values: Record<string, string>;
  /** The render result only when it still matches this version and these values; otherwise undefined. */
  finalBody: string | undefined;
  missingLive: string[];
  shownMissing: string[];
  copy: CopyState;
  copyRef: RefObject<HTMLTextAreaElement | null>;
  onValues: (next: Record<string, string>) => void;
  onRender: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenVersion: (version: number) => void;
  onOpenWiki: (id: string) => void;
}) {
  return (
    <article className="prompt-detail">
      <div className="prompt-detail-actions">
        <div className="prompt-badges">
          <span className="tag">{activeCategory?.label ?? prompt.category}</span>
          <span className="tag">{promptSourceLabels[prompt.source]}</span>
          {prompt.isDemo && <span className="demo-badge">演示数据</span>}
          {prompt.favorite && <span className="tag">已收藏</span>}
        </div>
        <div className="action-group">
          <a className="secondary-button" href={promptExportUrl(prompt.id)} download={`prompt-${prompt.id}.md`}>
            导出 Markdown
          </a>
          <button className="secondary-button" onClick={onFavorite} disabled={busy}>
            {prompt.favorite ? '取消收藏' : '收藏'}
          </button>
          <button className="secondary-button" onClick={onEdit} disabled={busy}>
            编辑
          </button>
          <button className="danger-quiet" onClick={onDelete} disabled={busy}>
            删除
          </button>
        </div>
      </div>
      <h2>{prompt.name}</h2>
      {prompt.isDemo && <p className="demo-notice">【演示数据】虚构教学模板，请按真实业务修改。</p>}
      <div className="prompt-meta-grid">
        <Meta label="分类" value={activeCategory?.label ?? prompt.category} />
        <Meta label="版本" value={`第 ${prompt.version} 版`} />
        <Meta label="创建时间" value={dateText(prompt.createdAt)} />
        <Meta label="最近修改" value={dateText(prompt.updatedAt)} />
      </div>
      {prompt.tags.length > 0 && (
        <div className="tag-row">
          {prompt.tags.map((value) => (
            <span key={value} className="tag">
              {value}
            </span>
          ))}
        </div>
      )}
      <section className="prompt-section">
        <div className="section-header">
          <h3>正文模板</h3>
          <span>原样保存 · 不会因为填写变量而改变</span>
        </div>
        <pre className="prompt-body-view">{prompt.body}</pre>
      </section>
      <section className="prompt-section prompt-fill">
        <div className="section-header">
          <h3>填写变量并复制</h3>
          <span>{variables.length ? `${variables.length} 个变量` : '正文没有变量，可直接复制'}</span>
        </div>
        {variables.length > 0 && (
          <div className="prompt-fields">
            {variables.map((name) => (
              <label className="field" key={name}>
                <span>{name}</span>
                <input
                  value={values[name] ?? ''}
                  onChange={(event) => onValues({ ...values, [name]: event.target.value })}
                  placeholder={`填写 ${name}`}
                />
                {!(values[name] ?? '').trim() && <em className="prompt-missing">未填写</em>}
              </label>
            ))}
          </div>
        )}
        {missingLive.length > 0 && (
          <p className="prompt-missing-note" role="status">
            还缺少：{missingLive.join('、')}（只填空格也算未填写）。
          </p>
        )}
        {shownMissing.length > 0 && (
          <p className="prompt-missing-note" role="alert">
            服务端校验未通过，缺少：{shownMissing.join('、')}。未生成的模板不会被复制。
          </p>
        )}
        <div className="prompt-actions">
          {variables.length > 0 && (
            <button className="secondary-button" onClick={onRender} disabled={busy}>
              {busy ? '正在生成…' : '生成最终正文'}
            </button>
          )}
          <button className="primary-button" onClick={onCopy} disabled={busy || finalBody === undefined}>
            复制最终正文
          </button>
        </div>
        {finalBody !== undefined && (
          <>
            <div className="section-header">
              <h3>本次最终正文</h3>
              <span>
                {variables.length === 0
                  ? '无变量，复制的是模板原文'
                  : `基于第 ${prompt.version} 版的这一次结果，不会保存`}
              </span>
            </div>
            <pre className="prompt-body-view prompt-final" data-testid="prompt-final">
              {finalBody}
            </pre>
          </>
        )}
        {copy.status === 'done' && (
          <p className="prompt-copy-ok" role="status">
            {copy.message}
          </p>
        )}
        {copy.status === 'failed' && (
          <div className="prompt-copy-failed" role="alert">
            <p>{copy.message}</p>
            <textarea ref={copyRef} readOnly value={copy.text} aria-label="可手动选取的最终正文" />
          </div>
        )}
      </section>
      <details className="prompt-secondary">
        <summary>
          场景、要求与相关 Wiki{links.some((link) => link.status === 'missing') ? ' · 存在失效关联' : ''}
        </summary>
        {prompt.scenario && (
          <section className="prompt-section">
            <h3>场景</h3>
            <p>{prompt.scenario}</p>
          </section>
        )}
        {prompt.inputRequirements && (
          <section className="prompt-section">
            <h3>输入要求</h3>
            <p>{prompt.inputRequirements}</p>
          </section>
        )}
        {prompt.outputRequirements && (
          <section className="prompt-section">
            <h3>输出要求</h3>
            <p>{prompt.outputRequirements}</p>
          </section>
        )}
        <section className="prompt-section">
          <h3>相关 Wiki · {prompt.relatedWikiIds.length}</h3>
          {(links.length
            ? links
            : prompt.relatedWikiIds.map((id) => ({ id, title: wikiTitle(id), status: 'missing' as const }))
          ).length ? (
            <div className="link-status-list">
              {(links.length
                ? links
                : prompt.relatedWikiIds.map((id) => ({ id, title: wikiTitle(id), status: 'missing' as const }))
              ).map((link) => (
                <div className="wiki-link-row" key={link.id}>
                  {link.status === 'resolved' && link.title ? (
                    <>
                      <code>{link.title}</code>
                      <button className="text-button" onClick={() => onOpenWiki(link.id)}>
                        打开 Wiki ›
                      </button>
                    </>
                  ) : (
                    <>
                      <code>{link.title ?? link.id}</code>
                      <span className="link-missing">
                        关联已失效：这个 Wiki 已经不存在，Prompt 正文和其他功能不受影响
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy">未关联 Wiki。</p>
          )}
        </section>
        {prompt.examples && (
          <section className="prompt-section">
            <h3>示例</h3>
            <pre className="prompt-body-view">{prompt.examples}</pre>
          </section>
        )}
      </details>
      <PromptFeedback
        key={`${prompt.id}-${prompt.version}`}
        promptId={prompt.id}
        promptName={prompt.name}
        promptVersion={prompt.version}
      />
      <details className="prompt-secondary prompt-section">
        <summary>
          <h3>版本历史 · {versions.length}</h3>
        </summary>
        <p>每次有效保存都会追加完整快照。</p>
        <div className="prompt-version-list">
          {versions.length ? (
            [...versions].reverse().map((item) => (
              <button key={item.version} className="prompt-version-row" onClick={() => onOpenVersion(item.version)}>
                <b>第 {item.version} 版</b>
                <span>{dateText(item.savedAt)}</span>
                <small>
                  {promptChangeSourceLabels[item.changeSource]} · {item.snapshot.body.length} 字符
                </small>
              </button>
            ))
          ) : (
            <span className="muted-copy">正在读取版本…</span>
          )}
        </div>
      </details>
    </article>
  );
}
