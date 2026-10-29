// Fixed PRD fields shared by source assignment, AI draft fields and rendering.
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
export type AiFieldContent = { text: string; factIds: string[]; evidenceIds: string[]; humanEdited?: true };
export type TemplateFieldContent = { evidenceIds: string[]; humanText?: string; aiContent?: AiFieldContent };
export type TemplateFields = Partial<Record<TemplateFieldKey, TemplateFieldContent>>;
export type InputTemplateFields = {
  version: 1; pageId: string; pageType: string; rawId: string; fields: TemplateFields;
  facts: Array<{ id: string; text: string; evidenceIds: string[] }>;
  evidence: Array<{ id: string; rawId: string; quote: string; start: number; end: number; chunkIndex: number }>;
};
export function templateSections(type: string): ReadonlyArray<{ key: TemplateFieldKey; label: string }> {
  return type === 'concept' ? TEMPLATE_SECTIONS.concept : type === 'business_process' ? TEMPLATE_SECTIONS.business_process : [];
}
export function hasTemplateFields(fields?: TemplateFields): boolean {
  return !!fields && Object.values(fields).some(field => field && (field.evidenceIds.length > 0 || !!field.humanText?.trim() || !!field.aiContent));
}
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(id => typeof id === 'string' && !!id && id.length <= 64) && new Set(value).size === value.length;
export function validAiFieldContent(value: unknown): value is AiFieldContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const field = value as AiFieldContent;
  return Object.keys(field).every(key => ['text', 'factIds', 'evidenceIds', 'humanEdited'].includes(key))
    && typeof field.text === 'string' && !!field.text.trim() && field.text.length <= 4000
    && ids(field.factIds) && field.factIds.length <= 256 && ids(field.evidenceIds) && (field.humanEdited === undefined || field.humanEdited === true);
}
export function validTemplateFields(value: unknown, type: string): value is TemplateFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = templateSections(type).map(field => field.key as string);
  return Object.entries(value).every(([key, field]) => keys.includes(key) && !!field && typeof field === 'object' && !Array.isArray(field)
    && Object.keys(field).every(k => k === 'evidenceIds' || k === 'humanText' || k === 'aiContent')
    && Array.isArray(field.evidenceIds) && field.evidenceIds.every((id: unknown) => typeof id === 'string' && !!id)
    && new Set(field.evidenceIds).size === field.evidenceIds.length
    && (field.humanText === undefined || typeof field.humanText === 'string')
    && (field.aiContent === undefined || validAiFieldContent(field.aiContent)));
}

/** Closed update snapshot; references must stay inside the selected page's directories. */
export function validInputTemplateFields(value: unknown): value is InputTemplateFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as InputTemplateFields;
  if (Object.keys(snapshot).sort().join(',') !== 'evidence,facts,fields,pageId,pageType,rawId,version' || snapshot.version !== 1 || typeof snapshot.pageId !== 'string' || !snapshot.pageId || typeof snapshot.rawId !== 'string' || !snapshot.rawId || !['concept','business_process'].includes(snapshot.pageType) || !validTemplateFields(snapshot.fields, snapshot.pageType) || !Array.isArray(snapshot.facts) || !snapshot.facts.length || !Array.isArray(snapshot.evidence) || !snapshot.evidence.length) return false;
  if (snapshot.evidence.some(item => !item || Object.keys(item).sort().join(',') !== 'chunkIndex,end,id,quote,rawId,start' || typeof item.id !== 'string' || !item.id || item.rawId !== snapshot.rawId || typeof item.quote !== 'string' || !item.quote || !Number.isSafeInteger(item.start) || item.start < 0 || !Number.isSafeInteger(item.end) || item.end - item.start !== item.quote.length || !Number.isInteger(item.chunkIndex)) || new Set(snapshot.evidence.map(item => item.id)).size !== snapshot.evidence.length) return false;
  const evidenceIds = new Set(snapshot.evidence.map(item => item.id));
  if (snapshot.facts.some(item => !item || Object.keys(item).sort().join(',') !== 'evidenceIds,id,text' || typeof item.id !== 'string' || !item.id || typeof item.text !== 'string' || !item.text || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length || new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => !evidenceIds.has(id))) || new Set(snapshot.facts.map(item => item.id)).size !== snapshot.facts.length) return false;
  for (const field of Object.values(snapshot.fields)) {
    if (field.evidenceIds.some(id => !evidenceIds.has(id))) return false;
    if (!field.aiContent) continue;
    const facts = field.aiContent.factIds.map(id => snapshot.facts.find(fact => fact.id === id));
    if (facts.some(fact => !fact)) return false;
    const expected = new Set(facts.flatMap(fact => fact!.evidenceIds));
    if (expected.size !== field.aiContent.evidenceIds.length || field.aiContent.evidenceIds.some(id => !expected.has(id))) return false;
  }
  return true;
}

/** Read-only preview and committed appendix use this exact text. */
export function renderInputTemplateFields(snapshot: InputTemplateFields): string {
  const lines = ['## 本次来源整理', '以下为已审输入草稿的字段快照；整理及人工说明不等于原始来源事实，不自动覆盖原栏目。', `Raw ${snapshot.rawId} · 输入页 ${snapshot.pageId} · 类型 ${snapshot.pageType}`];
  const evidence = (references: string[]) => references.flatMap(id => {
    const item = snapshot.evidence.find(entry => entry.id === id)!;
    return [`- 证据 ${id} · Raw ${item.rawId} [${item.start}, ${item.end})`, item.quote];
  });
  for (const [key, field] of Object.entries(snapshot.fields)) {
    lines.push(`### ${templateSections(snapshot.pageType).find(section => section.key === key)!.label}`);
    if (field.evidenceIds.length) lines.push('#### 来源摘录（人工归位）', ...evidence(field.evidenceIds));
    if (field.humanText !== undefined) lines.push('#### 人工说明', field.humanText);
    if (field.aiContent) {
      lines.push(field.aiContent.humanEdited ? '#### AI整理（人工修改）' : '#### AI整理', field.aiContent.text);
      for (const id of field.aiContent.factIds) {
        const fact = snapshot.facts.find(item => item.id === id)!;
        lines.push(`- 支持事实 ${id}：${fact.text}`);
      }
      lines.push(...evidence(field.aiContent.evidenceIds));
    }
  }
  return lines.join('\n\n');
}
