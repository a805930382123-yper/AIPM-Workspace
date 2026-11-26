import type { FormEvent } from 'react';
import type { PromptInput, PromptSchema, Wiki } from '../../api';
import { PROMPT_LIMITS } from '../../../services/prompt/limits.ts';
import { extractVariables } from '../../../services/prompt/variables.ts';
import { csv } from './promptState';

export function PromptEditor({
  form,
  schema,
  wikis,
  busy,
  baseVersion,
  onField,
  onCancel,
  onSave,
}: {
  form: PromptInput;
  schema: PromptSchema | null;
  wikis: Wiki[];
  busy: boolean;
  baseVersion: number | null;
  onField: <K extends keyof PromptInput>(key: K, value: PromptInput[K]) => void;
  onCancel: () => void;
  onSave: (event: FormEvent) => void;
}) {
  const detected = extractVariables(form.body);
  const missingOption = form.relatedWikiIds.filter((id) => !wikis.some((item) => item.id === id));
  return (
    <form className="prompt-editor" onSubmit={onSave}>
      <div className="editor-top">
        <div>
          <p className="eyebrow">{baseVersion === null ? '创建 Prompt' : `编辑 · 第 ${baseVersion} 版`}</p>
          <h2>{baseVersion === null ? '新建 Prompt' : form.name || '未命名'}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="取消编辑" onClick={onCancel}>
          ×
        </button>
      </div>
      <div className="prompt-form-grid">
        <label className="field span-two">
          名称 <em>*</em>
          <input
            value={form.name}
            onChange={(event) => onField('name', event.target.value)}
            required
            maxLength={PROMPT_LIMITS.name}
            placeholder="例如：经销商访谈提纲"
            autoFocus
          />
        </label>
        <label className="field">
          分类
          <select value={form.category} onChange={(event) => onField('category', event.target.value)}>
            {schema?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          收藏
          <select
            value={form.favorite ? 'yes' : 'no'}
            onChange={(event) => onField('favorite', event.target.value === 'yes')}
          >
            <option value="no">不收藏</option>
            <option value="yes">加入收藏</option>
          </select>
        </label>
        <label className="field span-two">
          场景
          <textarea
            value={form.scenario}
            onChange={(event) => onField('scenario', event.target.value)}
            maxLength={PROMPT_LIMITS.scenario}
            placeholder="什么时候用这条 Prompt，例如：走访经销商前准备访谈问题"
          />
        </label>
        <label className="field span-two prompt-body-field">
          正文 <em>*</em>
          <textarea
            value={form.body}
            onChange={(event) => onField('body', event.target.value)}
            required
            spellCheck
            placeholder={
              '用 {{变量名}} 标出每次需要替换的部分，例如：\n请把下面的行业术语解释给刚入职的同事：{{行业术语}}'
            }
          />
          <span className="field-hint">
            正文原样保存（含前后空白与换行）；识别到的变量：
            {detected.length ? detected.map((name) => `{{${name}}}`).join('　') : '暂无'}。上限{' '}
            {PROMPT_LIMITS.body.toLocaleString('en-US')} 字符。
          </span>
        </label>
        <label className="field">
          输入要求
          <textarea
            value={form.inputRequirements}
            onChange={(event) => onField('inputRequirements', event.target.value)}
            maxLength={PROMPT_LIMITS.inputRequirements}
            placeholder="需要用户提供什么"
          />
        </label>
        <label className="field">
          输出要求
          <textarea
            value={form.outputRequirements}
            onChange={(event) => onField('outputRequirements', event.target.value)}
            maxLength={PROMPT_LIMITS.outputRequirements}
            placeholder="希望得到什么结果、格式与边界"
          />
        </label>
        <label className="field span-two">
          相关 Wiki
          <select
            className="raw-source-select"
            multiple
            size={Math.min(Math.max(wikis.length, 3), 6)}
            value={form.relatedWikiIds}
            onChange={(event) =>
              onField(
                'relatedWikiIds',
                [...event.currentTarget.selectedOptions].map((option) => option.value),
              )
            }
          >
            {missingOption.map((id) => (
              <option key={id} value={id}>
                （关联已失效，可取消选择）{id}
              </option>
            ))}
            {wikis.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}｜{item.type}
              </option>
            ))}
          </select>
          <span className="field-hint">
            按住 Ctrl 可多选；只允许选择当前存在的 Wiki。关联不会把 Wiki 正文写入 Prompt。
          </span>
        </label>
        <label className="field span-two">
          示例
          <textarea
            value={form.examples}
            onChange={(event) => onField('examples', event.target.value)}
            maxLength={PROMPT_LIMITS.examples}
            placeholder="填写好的示例，方便以后照着改"
          />
        </label>
        <label className="field span-two">
          标签
          <input
            value={form.tags.join('，')}
            onChange={(event) => onField('tags', csv(event.target.value))}
            placeholder="用逗号分隔，例如：访谈，经销商"
          />
        </label>
      </div>
      <div className="editor-footer">
        <span>保存后形成正式 Prompt 记录与一个新版本</span>
        <div>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在保存…' : '保存 Prompt'}
          </button>
        </div>
      </div>
    </form>
  );
}
