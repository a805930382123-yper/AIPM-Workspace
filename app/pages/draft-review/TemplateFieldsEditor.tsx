import type { DraftPage } from '../../api';
import {
  templateSections,
  type TemplateFieldKey,
  type TemplateFieldContent,
  type TemplateFields,
} from '../../../services/wiki/template-fields';

export function TemplateFieldsEditor({
  type,
  fields,
  evidence,
  disabled,
  onChange,
}: {
  type: string;
  fields?: TemplateFields;
  evidence: DraftPage['source_evidence'];
  disabled: boolean;
  onChange: (key: TemplateFieldKey, patch: Partial<TemplateFieldContent>) => void;
}) {
  return (
    <>
      {templateSections(type).map(({ key, label }) => {
        const value = fields?.[key] ?? { evidenceIds: [] };
        return (
          <fieldset key={key} data-template-field={key} disabled={disabled}>
            <legend>{label}</legend>
            {value.aiContent && (
              <>
                <label className="field">
                  {key === 'ai_opportunities' ? '分析建议｜' : ''}
                  {value.aiContent.humanEdited ? 'AI草稿经人工修改（待核对）' : 'AI整理（待核对）'}
                  <textarea
                    disabled={disabled}
                    value={value.aiContent.text}
                    rows={3}
                    maxLength={4000}
                    onChange={(event) =>
                      onChange(key, { aiContent: { ...value.aiContent!, text: event.target.value } })
                    }
                  />
                </label>
                <p className="extract-note">
                  AI归位来源（待核对）：原事实 {value.aiContent.factIds.join('、')}；证据{' '}
                  {value.aiContent.evidenceIds.join('、')}
                </p>
                <button
                  disabled={disabled}
                  className="text-button danger"
                  type="button"
                  onClick={() => onChange(key, { aiContent: undefined })}
                >
                  删除本字段AI项
                </button>
              </>
            )}
            <div>来源摘录（用户归位）</div>
            {evidence.map((item) => (
              <label key={item.id} className="draft-line">
                <input
                  disabled={disabled}
                  type="checkbox"
                  checked={value.evidenceIds.includes(item.id)}
                  onChange={(event) =>
                    onChange(key, {
                      evidenceIds: event.target.checked
                        ? [...value.evidenceIds, item.id]
                        : value.evidenceIds.filter((id) => id !== item.id),
                    })
                  }
                />
                <span>
                  {item.id}：{item.quote}
                </span>
              </label>
            ))}
            <label className="field">
              {key === 'ai_opportunities' ? '分析建议' : '人工说明（待核对）'}
              <textarea
                disabled={disabled}
                value={value.humanText ?? ''}
                rows={2}
                onChange={(event) => onChange(key, { humanText: event.target.value })}
              />
            </label>
          </fieldset>
        );
      })}
    </>
  );
}
