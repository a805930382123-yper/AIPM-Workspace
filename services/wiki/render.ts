// B04: rendering of review data into the formal Markdown that will be written on confirm.
// Facts, organized notes, inferences, questions and evidence keep their own sections so the
// boundary between "原文支持" and "模型推断" survives into the正式文件.
import type { DraftPage, DraftRawMeta, DraftSource } from './drafts.ts';
import { hasTemplateFields, templateSections } from './template-fields.ts';

const quoted = (value: string, limit = 90) => value.length > limit ? `${value.slice(0, limit)}…` : value;
const orMissing = (value: string | undefined | null, label: string) => (value && String(value).trim()) ? String(value) : `未提供（${label}）`;
const sourceTypeLabels: Record<string, string> = {
  wechat: '微信公众号', article: '网页文章', report: '行业报告', company: '公司资料',
  customer: '客户资料', meeting: '会议纪要', note: '个人笔记', other: '其他',
};

export function renderPageBody(page: DraftPage, context: { sourceTitle: string; rawId: string; createdTitles: Set<string> }): string {
  const active = hasTemplateFields(page.templateFields);
  const lines: string[] = [page.type === 'concept' ? active ? '## 原草稿一句话说明（未归位）' : '## 一句话解释' : '## 一句话说明', '', page.one_line_definition, ''];
  const sections = templateSections(page.type).filter(field => page.type !== 'concept' || active || field.key !== 'one_line_explanation');
  if (sections.length) {
    lines.push(Object.values(page.templateFields ?? {}).some(field => field.aiContent)
      ? '> 字段中的AI草稿、AI归位来源与用户归位、人工说明分别标记，均需核对；无来源支持的内容保持空或待确认。'
      : '> 字段来源摘录由用户归位，人工说明独立标记；无来源支持的内容保持空或待确认。', '');
    for (const { key, label } of sections) {
      lines.push(`## ${label}`, '');
      const field = page.templateFields?.[key];
      if (!field?.evidenceIds.length && !field?.humanText?.trim() && !field?.aiContent) lines.push('待确认。');
      if (field?.aiContent) {
        const ai = field.aiContent;
        const label = ai.humanEdited ? 'AI草稿经人工修改（待核对）' : 'AI整理（待核对）';
        lines.push(`- ${key === 'ai_opportunities' ? `分析建议｜${label}` : label}：${ai.text}（原事实 ${ai.factIds.join('、')}）`);
        for (const id of ai.evidenceIds) {
          const evidence = page.source_evidence.find(item => item.id === id);
          if (evidence) lines.push(`- 来源摘录（AI归位，待核对）：${evidence.quote}（证据 ${id}）`);
        }
      }
      for (const id of field?.evidenceIds ?? []) {
        const evidence = page.source_evidence.find(item => item.id === id);
        if (evidence) lines.push(`- 来源摘录（用户归位）：${evidence.quote}（证据 ${id}）`);
      }
      if (field?.humanText?.trim()) lines.push(`- ${key === 'ai_opportunities' ? '分析建议' : '人工说明（待核对）'}：${field.humanText}`);
      lines.push('');
    }
  }
  lines.push('## 来源事实', '');
  for (const fact of page.source_facts) {
    lines.push(`- ${fact.text}（证据 ${fact.evidenceIds.join('、')}）`);
  }
  if (!page.source_facts.length) lines.push('- 待确认：本条尚未找到原文支持的陈述。');
  lines.push('', '## AI 整理', '');
  if (page.ai_organized.length) for (const item of page.ai_organized) lines.push(`- ${item}`);
  else lines.push('- 暂无');
  lines.push('', '## AI 推断', '');
  if (page.ai_inferences.length) for (const item of page.ai_inferences) lines.push(`- ${item}`);
  else lines.push('- 暂无');
  lines.push('', '## 待确认问题', '');
  if (page.open_questions.length) for (const item of page.open_questions) lines.push(`- ${item}`);
  else lines.push('- 暂无');
  lines.push('', '## 来源证据', '');
  for (const evidence of page.source_evidence) {
    lines.push(`- ${evidence.id}｜原文 [${evidence.start}, ${evidence.end})：${quoted(evidence.quote)}`);
  }
  lines.push('', '## 关联', '');
  if (page.related_pages.length) {
    for (const related of page.related_pages) {
      const key = related.trim();
      lines.push(context.createdTitles.has(key) ? `- [[${key}]]` : `- ${key}（本次未创建，待后续处理）`);
    }
  } else lines.push('- 暂无');
  lines.push('', '## 来源', '');
  lines.push(`- [[${context.sourceTitle}]]（Raw ${context.rawId}）`);
  return `${lines.join('\n')}\n`;
}

/** F04-06: the Source keeps the real Raw metadata instead of only a title and an id. */
export function renderSourceBody(source: DraftSource, raw: DraftRawMeta, selectedPages: DraftPage[], skippedPages: DraftPage[] = []): string {
  const byType = (type: string) => selectedPages.filter(page => page.type === type).map(page => `- [[${page.title}]]`);
  const lines: string[] = [];
  lines.push('## 来源信息', '');
  lines.push(`- 来源类型：${sourceTypeLabels[raw.sourceType] ?? raw.sourceType}（${raw.sourceType}）`);
  lines.push(`- 来源名称：${orMissing(raw.sourceName, '来源名称')}`);
  lines.push(`- 作者：${orMissing(raw.author, '作者')}`);
  lines.push(`- 原发布日期：${orMissing(raw.publishedAt, '原发布日期')}`);
  lines.push(`- 原始链接：${orMissing(raw.url, '原始链接')}`);
  lines.push(`- Raw：${raw.title}（${raw.rawId}）`);
  if (raw.importedAt) lines.push(`- 导入时间：${raw.importedAt}`);
  lines.push(`- 来源等级：${source.source_level}`);
  lines.push('');
  lines.push('## 摘要', '', source.summary || '待补充：本条来源的摘要。', '');
  lines.push('## Key Takeaways', '');
  if (source.key_takeaways.length) for (const item of source.key_takeaways) lines.push(`- ${item}`);
  else lines.push('- 暂无');
  lines.push('', '## 涉及概念', '');
  lines.push(...(byType('concept').length ? byType('concept') : ['- 暂无']));
  lines.push('', '## 涉及实体', '');
  lines.push(...(byType('entity').length ? byType('entity') : ['- 暂无']));
  lines.push('', '## 涉及业务流程', '');
  lines.push(...(byType('business_process').length ? byType('business_process') : ['- 暂无']));
  lines.push('', '## 涉及指标', '');
  lines.push(...(byType('metric').length ? byType('metric') : ['- 暂无']));
  lines.push('', '## 重要观点', '');
  const points = selectedPages.flatMap(page => page.source_facts.map(fact => fact.text)).slice(0, 12);
  if (points.length) for (const item of points) lines.push(`- ${item}`);
  else lines.push('- 暂无');
  lines.push('', '## 待验证内容', '');
  const questions = selectedPages.flatMap(page => page.open_questions).slice(0, 12);
  if (questions.length) for (const item of questions) lines.push(`- ${item}`);
  else lines.push('- 暂无');
  // F04-05: suggestions the user did not select are listed as plain text, never as Wikilinks.
  if (skippedPages.length) {
    lines.push('', '## 本次未创建的建议（未选中，待处理）', '');
    for (const page of skippedPages.slice(0, 20)) lines.push(`- ${page.title}（${page.type}，未创建；需要时可在该 Raw 的草稿里重新选择）`);
  }
  lines.push('', '## Raw 来源', '');
  lines.push(`- ${raw.title}（Raw ${raw.rawId}）`);
  lines.push('', '> 本页是来源摘要，原文以对应 Raw 为准；只有本次确认为正式页面的知识条目才会建立 Wikilink。');
  return `${lines.join('\n')}\n`;
}
