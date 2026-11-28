import type { WikiInput, WikiSchema, WikiType } from '../../api';

export const statusLabels: Record<string, string> = {
  verified: '已核实',
  source_supported: '有来源支持',
  ai_organized: 'AI整理',
  inferred: '推断',
  needs_verification: '待验证',
  reviewed: '已人工审核',
  unreviewed: '未审核',
};
export const typeLabel = (schema: WikiSchema | null, type: WikiType) =>
  schema?.types.find((item) => item.id === type)?.label ?? type;
export type WikiForm = WikiInput;
export const wikiViews = [
  { key: 'overview', label: '知识总览' },
  { key: 'ask', label: '向知识库提问' },
  { key: 'active-check', label: '主动知识检查' },
  { key: 'raw-to-wiki', label: '从 Raw 生成 Wiki 草稿' },
  { key: 'lint', label: '结构检查（Lint）' },
] as const;
export type WikiSubView = (typeof wikiViews)[number]['key'];
export type WikiCheckEntry = { view: 'lint' } | { view: 'active-check'; inspectionId?: string };
export function templateBody(schema: WikiSchema | null, type: WikiType) {
  return (schema?.pageTemplates[type]?.sections ?? [])
    .map((section) => {
      const label =
        type === 'business_process' && section.key === 'ai_opportunities'
          ? '可能的 AI 机会（分析建议）'
          : section.label;
      return `## ${label}\n\n`;
    })
    .join('\n');
}
