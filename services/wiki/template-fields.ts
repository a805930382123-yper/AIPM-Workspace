// Fixed PRD fields for manual source assignment; no model output contract.
export const TEMPLATE_SECTIONS = {
  concept: [
    { key: 'one_line_explanation', label: '一句话解释' }, { key: 'definition', label: '定义' },
    { key: 'why_important', label: '为什么重要' }, { key: 'business_context', label: '在业务中的位置' },
    { key: 'characteristics', label: '关键特征' }, { key: 'common_categories', label: '常见分类' },
    { key: 'relationships', label: '与其他概念关系' }, { key: 'scenarios', label: '常见业务场景' },
  ],
  business_process: [
    { key: 'business_goal', label: '业务目标' }, { key: 'roles', label: '涉及角色' }, { key: 'trigger', label: '触发条件' },
    { key: 'inputs', label: '输入' }, { key: 'steps', label: '完整流程' }, { key: 'outputs', label: '输出' },
    { key: 'systems', label: '使用系统' }, { key: 'rules', label: '关键规则' }, { key: 'human_judgement', label: '人工判断点' },
    { key: 'exceptions', label: '异常情况' }, { key: 'pain_points', label: '痛点' },
    { key: 'ai_opportunities', label: '可能的 AI 机会（分析建议）' }, { key: 'metrics', label: '相关指标' },
    { key: 'related_knowledge', label: '相关知识' },
  ],
} as const;
export type TemplateFieldKey = (typeof TEMPLATE_SECTIONS)[keyof typeof TEMPLATE_SECTIONS][number]['key'];
export type TemplateFieldContent = { evidenceIds: string[]; humanText?: string };
export type TemplateFields = Partial<Record<TemplateFieldKey, TemplateFieldContent>>;
export function templateSections(type: string): ReadonlyArray<{ key: TemplateFieldKey; label: string }> {
  return type === 'concept' ? TEMPLATE_SECTIONS.concept : type === 'business_process' ? TEMPLATE_SECTIONS.business_process : [];
}
export function hasTemplateFields(fields?: TemplateFields): boolean {
  return !!fields && Object.values(fields).some(field => field && (field.evidenceIds.length > 0 || !!field.humanText?.trim()));
}
export function validTemplateFields(value: unknown, type: string): value is TemplateFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = templateSections(type).map(field => field.key as string);
  return Object.entries(value).every(([key, field]) => keys.includes(key) && !!field && typeof field === 'object' && !Array.isArray(field)
    && Object.keys(field).every(k => k === 'evidenceIds' || k === 'humanText')
    && Array.isArray(field.evidenceIds) && field.evidenceIds.every((id: unknown) => typeof id === 'string' && !!id)
    && new Set(field.evidenceIds).size === field.evidenceIds.length
    && (field.humanText === undefined || typeof field.humanText === 'string'));
}
