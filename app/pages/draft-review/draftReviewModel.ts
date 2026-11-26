import type { DraftPage, DraftView } from '../../api';
import type { RawCitationTarget } from '../../components/WikiQuestionPanel';
import type { TemplateFieldKey, TemplateFieldContent, TemplateFields } from '../../../services/wiki/template-fields';

export type PageDraft = DraftPage & { renderedBody?: string };
export const duplicateInput = (page: PageDraft) => ({
  title: page.title,
  category: page.category,
  content: [page.one_line_definition, ...page.source_facts.map((item) => item.text), ...page.ai_organized].join('\n'),
});
export const reviewFingerprint = (value: DraftView, items: PageDraft[] = value.pages) =>
  JSON.stringify({
    document: value.document,
    ...(value.input ? { input: value.input } : { source: value.source }),
    pages: items.map(({ renderedBody, ...p }) => {
      void renderedBody;
      return p;
    }),
  });

export const conflictText = (view: DraftView) => {
  const preview = view.preview;
  if (!preview) return [];
  const lines: string[] = [];
  if (!preview.rawExists) lines.push('对应的原始资料已不存在，不能确认写入。');
  if (preview.rawExists && !preview.rawSha256Matches) lines.push('原始正文校验值已变化，已停止写入以避免产生坏来源。');
  if (preview.sourceAmbiguous)
    lines.push(
      `这条 Raw 已有 ${preview.sourceAmbiguous.length} 个 Source 页面，归属不明；本批不自动合并或更新旧 Source，请人工处理。`,
    );
  if (preview.sourceReuse)
    lines.push(`将复用既有 Source「${preview.sourceReuse.title}」（${preview.sourceReuse.id}）：本次不修改它。`);
  for (const conflict of preview.titleConflicts) {
    lines.push(
      `${conflict.kind === 'alias' ? '别名' : '标题'}冲突：「${conflict.title}」已被「${conflict.existingTitle}」（${conflict.existingId}）占用；请改名，或对该建议选择“更新已有页”“仍创建新页”或“暂不处理”。显式新建会生成独立页面，关联链接可能产生歧义。`,
    );
  }
  if (preview.batchDuplicateTitles.length)
    lines.push(`本次选择里有重复标题：${preview.batchDuplicateTitles.join('、')}；请改名或合并。`);
  return lines;
};
export const duplicateDimension: Record<string, string> = {
  title: '标题',
  aliases: '别名',
  category: '分类',
  tags: '标签',
  content: '内容相似',
};

export function editedTemplateFields(
  fields: TemplateFields | undefined,
  key: TemplateFieldKey,
  patch: Partial<TemplateFieldContent>,
): TemplateFields {
  const next = { ...fields, [key]: { evidenceIds: [], ...fields?.[key], ...patch } };
  for (const name of Object.keys(next) as TemplateFieldKey[]) {
    const value = next[name]!;
    if (!value.evidenceIds.length && !value.humanText?.trim() && !value.aiContent) delete next[name];
  }
  return next;
}
export type DraftReviewPageProps = {
  draftId: string;
  onBack: () => void;
  onCommitted: () => Promise<void>;
  onOpenRaw: (id: string, target?: RawCitationTarget) => void;
  onOpenWiki?: (id: string) => void;
  onOpenWorkflow?: (id: string) => void;
  backLabel?: string;
};
