import type { FormEvent } from 'react';
import type { RawSummary, WikiSchema, WikiType } from '../../api';
import { sourceLabels } from '../../api';
import { statusLabels, templateBody, type WikiForm } from './wikiShared';

const csv = (value: string) =>
  value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
export function WikiEditor({
  schema,
  raws,
  form,
  busy,
  baseRevision,
  template,
  onField,
  onCancel,
  onSave,
  onOpenRaw,
}: {
  schema: WikiSchema | null;
  raws: RawSummary[];
  form: WikiForm;
  busy: boolean;
  baseRevision: number | null;
  template?: WikiSchema['pageTemplates'][WikiType];
  onField: <K extends keyof WikiForm>(key: K, value: WikiForm[K]) => void;
  onCancel: () => void;
  onSave: (event: FormEvent) => void;
  onOpenRaw: (id: string) => void;
}) {
  const updateType = (nextType: WikiType) => {
    const currentTemplate = templateBody(schema, form.type);
    onField('type', nextType);
    if (!form.body.trim() || form.body === currentTemplate) onField('body', templateBody(schema, nextType));
  };
  return (
    <form className="wiki-editor" onSubmit={onSave}>
      <div className="editor-top">
        <div>
          <p className="eyebrow">{baseRevision === null ? '创建知识页' : `编辑 · 第 ${baseRevision} 版`}</p>
          <h2>{baseRevision === null ? '新建 Wiki' : form.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="取消编辑" onClick={onCancel}>
          ×
        </button>
      </div>
      <div className="wiki-form-grid">
        <label className="field span-two">
          标题 <em>*</em>
          <input
            value={form.title}
            onChange={(event) => onField('title', event.target.value)}
            required
            maxLength={300}
            placeholder="例如：门店动销"
            autoFocus
          />
        </label>
        <label className="field">
          页面类型
          <select value={form.type} onChange={(event) => updateType(event.target.value as WikiType)}>
            {schema?.types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          学习分类
          <select value={form.category} onChange={(event) => onField('category', event.target.value)}>
            {schema?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-two">
          Raw 来源{form.type === 'source' && <em>（必选一条）</em>}
          {form.type === 'synthesis' && <em>（至少两条）</em>}
          <select
            className="raw-source-select"
            multiple
            size={Math.min(Math.max(raws.length, 3), 6)}
            value={form.sources}
            onChange={(event) =>
              onField(
                'sources',
                [...event.currentTarget.selectedOptions].map((option) => option.value),
              )
            }
          >
            {raws.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}｜{sourceLabels[item.sourceType]}｜{item.sourceName}
              </option>
            ))}
          </select>
          <span className="field-hint">按住 Ctrl 可多选；来源摘要只保存摘要并跳回 Raw 原文。</span>
        </label>
        {form.sources.length > 0 && (
          <div className="selected-raws span-two">
            {form.sources.map((id) => {
              const raw = raws.find((item) => item.id === id);
              return raw ? (
                <button type="button" key={id} className="selected-raw" onClick={() => onOpenRaw(id)}>
                  <span>{raw.title}</span>
                  <small>{raw.sourceName}</small>查看 Raw ›
                </button>
              ) : null;
            })}
          </div>
        )}
        <label className="field span-two">
          别名
          <input
            value={form.aliases.join('，')}
            onChange={(event) => onField('aliases', csv(event.target.value))}
            placeholder="用逗号分隔，例如：动销率、Sell-out"
          />
        </label>
        <label className="field span-two">
          标签
          <input
            value={form.tags.join('，')}
            onChange={(event) => onField('tags', csv(event.target.value))}
            placeholder="用逗号分隔，支持中文搜索"
          />
        </label>
        <label className="field">
          知识状态
          <select value={form.knowledge_status} onChange={(event) => onField('knowledge_status', event.target.value)}>
            {schema?.enums.knowledge_status.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          人工审核
          <select value={form.review_status} onChange={(event) => onField('review_status', event.target.value)}>
            <option value="reviewed">已人工审核</option>
            <option value="unreviewed">未审核</option>
          </select>
        </label>
        <label className="field">
          可信度
          <select value={form.confidence} onChange={(event) => onField('confidence', event.target.value)}>
            {schema?.enums.confidence.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          来源等级
          <select value={form.source_level} onChange={(event) => onField('source_level', event.target.value)}>
            {schema?.sourcePolicy.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <div className="source-guidance span-two">{schema?.sourcePolicy.guidance}</div>
        <label className="field span-two wiki-body-field">
          知识内容 <em>*</em>
          <span className="template-hint">{template?.sections.map((section) => section.label).join('　· ')}</span>
          <textarea
            value={form.body}
            onChange={(event) => onField('body', event.target.value)}
            required
            spellCheck
            placeholder="按页面模板补充信息。使用 [[标题或别名]] 关联其他 Wiki。"
          />
          <span className="field-hint">使用 Markdown；业务流程中的 AI 机会请明确标注“分析建议”。</span>
        </label>
      </div>
      <div className="editor-footer">
        <span>保存后形成正式 Wiki Markdown 文件</span>
        <div>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在保存…' : '保存 Wiki'}
          </button>
        </div>
      </div>
    </form>
  );
}
