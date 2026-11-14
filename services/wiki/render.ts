// B04: rendering of review data into the formal Markdown that will be written on confirm.
// Facts, organized notes, inferences, questions and evidence keep their own sections so the
// boundary between "原文支持" and "模型推断" survives into the正式文件.
import type { DraftPage, DraftRawMeta, DraftSource, DraftRecord } from './drafts.ts';
import {renderStructuredNote,escapeNoteText} from './structured-note.ts';
import {inspectEditedNote} from '../llm/knowledge-deep.ts';
import { hasTemplateFields, templateSections, renderMergedTemplateFields } from './template-fields.ts';

export type PdfTopicItem = {
  id: string; page: number; text: string; origin: 'text' | 'image'; kind: 'content' | 'visuals' | 'inference' | 'question';
  decision: 'keep' | 'merge' | 'skip'; mergedInto?: string;
  table?: { title: string; role: 'header' | 'row' | 'note' };
};
export type PdfPresentationGroup = { representativeId: string; memberIds: string[]; reason: string };
export type PdfWrittenBlock = { text: string; sourceIds: string[] };

export function pdfOriginalPageLink(rawId: string, page: number) {
  return '[第 ' + page + ' 页](/api/raw/' + rawId + '/pdf/original#page=' + page + ')';
}

/** Render only explicit columns; ambiguous rows remain separate, with their original wording. */
export function renderPdfTopic(rawId: string, items: PdfTopicItem[], groups: PdfPresentationGroup[] = [], written?: PdfWrittenBlock[], topicEvidence = false): string {
  const representatives = new Set(groups.map(group => group.representativeId));
  const representedBy = new Map(groups.flatMap(group => group.memberIds.map(id => [id, group.representativeId] as const)));
  const links = new Map<string, Set<number>>();
  for (const item of items) {
    const keptId = item.mergedInto ?? item.id;
    const id = representedBy.get(keptId) ?? keptId;
    const pages = links.get(id) ?? new Set<number>();
    pages.add(item.page);
    links.set(id, pages);
  }
  const cite = (item: PdfTopicItem) => '（' + [...links.get(item.id)!].sort((a, b) => a - b).map(page => pdfOriginalPageLink(rawId, page)).join('、') + '）';
  const kept = items.filter(item => item.decision === 'keep' && !representedBy.has(item.id));
  const lines: string[] = [];
  const tables = new Map<string, PdfTopicItem[]>();
  for (const item of kept) {
    if (!item.table) continue;
    const key = JSON.stringify([item.origin, item.table.title]);
    const table = tables.get(key) ?? [];
    table.push(item);
    tables.set(key, table);
  }
  for (const table of tables.values()) {
    const first = table[0];
    lines.push('### ' + escapeNoteText(first.table!.title) + '（' + (first.origin === 'image' ? 'PDF 页图 AI 解读' : '原文字层') + '）', '');
    const split = (item: PdfTopicItem) => item.text.replace(/^\s*(?:[-•]\s+)?\|?\s*/u, '').replace(/\s*\|\s*$/u, '')
      .split('|').map(cell => cell.trim());
    type Grid = { headings: string[]; rows: Array<{ cells: Map<string, string>; source: string }>; headers: string[] };
    const grids: Grid[] = [];
    const notes: string[] = [];
    let grid: Grid | undefined;
    for (const item of table) {
      const role = item.table!.role;
      if (role === 'note') {
        notes.push('- 表注：' + escapeNoteText(item.text.replace(/^表注\s*[:：]\s*/u, '')) + cite(item));
        continue;
      }
      const cells = split(item);
      if (role === 'header' && cells.length >= 2 && cells.length <= 16 && cells.every(Boolean) && new Set(cells).size === cells.length) {
        const headings = grid?.headings ?? [];
        const extendsHeader = headings.every((heading, index) => cells.indexOf(heading) >= 0
          && (!index || cells.indexOf(heading) > cells.indexOf(headings[index - 1])));
        if (!grid || !extendsHeader) {
          grid = { headings: cells, rows: [], headers: [] };
          grids.push(grid);
        } else grid.headings = cells;
        grid.headers.push(cite(item));
        continue;
      }
      if (role === 'row' && grid && cells.length === grid.headings.length) {
        grid.rows.push({ cells: new Map(grid.headings.map((heading, i) => [heading, cells[i]])), source: cite(item) });
        continue;
      }
      notes.push('- 列关系待核：' + escapeNoteText(item.text) + cite(item));
      if (role === 'header') grid = undefined;
    }
    const markdownRow = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
    for (const [index, { headings, rows, headers }] of grids.entries()) {
      if (index) lines.push('不同列口径，单独列示。', '');
      lines.push('- 表头依据：' + headers.join('、'), '');
      if (!rows.length) {
        lines.push('- 表列：' + headings.map(escapeNoteText).join('、'), '');
        continue;
      }
      lines.push(markdownRow([...headings.map(escapeNoteText), '原页依据']), markdownRow([...headings, '页'].map(() => '---')));
      for (const row of rows) lines.push(markdownRow([...headings.map(heading => {
        const value = row.cells.get(heading);
        return value === undefined ? '该页未列' : value ? escapeNoteText(value) : '原行为空';
      }), row.source]));
      lines.push('');
    }
    if (notes.length) lines.push(...notes, '');
  }
  if (written?.length) {
    const sources = new Map(items.map(item => [item.id, item]));
    lines.push('### AI 整理', '');
    for (const block of written) {
      if (topicEvidence) {
        lines.push('- ' + escapeNoteText(block.text));
        continue;
      }
      const evidence = block.sourceIds.map(id => sources.get(id)!);
      const pages = [...new Set(evidence.map(item => item.page))].sort((a, b) => a - b);
      const origin = evidence.some(item => item.origin === 'image') ? '含 PDF 页图 AI 解读' : '依据原文字层';
      lines.push('- ' + escapeNoteText(block.text) + '（' + origin + '，' + pages.map(page => pdfOriginalPageLink(rawId, page)).join('、') + '）');
    }
    lines.push('');
  }
  if (topicEvidence) {
    const pages = [...new Set(items.map(item => item.page))].sort((a, b) => a - b);
    const origins = [items.some(item => item.origin === 'text') ? '原文字层' : '',
      items.some(item => item.origin === 'image') ? 'PDF 页图 AI 解读' : ''].filter(Boolean);
    lines.push('### 本主题依据', '', origins.join('、') + '（' + pages.map(page => pdfOriginalPageLink(rawId, page)).join('、') + '）', '');
  }
  const sections = [
    ['原文字层', (item: PdfTopicItem) => item.origin === 'text'],
    ['PDF 页图 AI 解读', (item: PdfTopicItem) => item.origin === 'image' && ['content', 'visuals'].includes(item.kind)],
    ['AI 推断', (item: PdfTopicItem) => item.kind === 'inference'],
    ['待核问题', (item: PdfTopicItem) => item.kind === 'question'],
  ] as const;
  for (const [heading, includes] of sections) {
    const section = kept.filter(item => !item.table && includes(item) && (!written || ['inference', 'question'].includes(item.kind)));
    if (!section.length) continue;
    lines.push('### ' + heading, '', ...section.map(item => '- ' + (representatives.has(item.id) ? '【归并展示】' : '')
      + escapeNoteText(item.text) + cite(item)), '');
  }
  return lines.join('\n');
}

const quoted = (value: string, limit = 90) => value.length > limit ? `${value.slice(0, limit)}…` : value;
const orMissing = (value: string | undefined | null, label: string) => (value && String(value).trim()) ? String(value) : `未提供（${label}）`;
const sourceTypeLabels: Record<string, string> = {
  wechat: '微信公众号', article: '网页文章', report: '行业报告', company: '公司资料',
  customer: '客户资料', meeting: '会议纪要', note: '个人笔记', other: '其他',
};
export function renderConfirmedNote(draft:DraftRecord,outcomeReviewed=false):string{
  const reviewLabel = outcomeReviewed ? '已进行成果审核' : '已人工核对';
  const lines=['## 深度整理笔记','','> '+(draft.noteReview?'人工修改，':'深度笔记，')+reviewLabel,'',renderStructuredNote(draft.structuredNote!,true)];
  const reportLabel = draft.noteReview ? '历史模型报告，编辑后未复核' : '生成时模型报告仅供参考';
  lines.push('',outcomeReviewed ? `> ${reportLabel}。` : `> ${reportLabel}；本次人工已明确查看报告状态与确定性警告。`);
  for(const warning of inspectEditedNote(draft.structuredNote!,new Map(draft.humanReview!.units.filter(u=>u.kind==='fact').flatMap(u=>u.records.map(r=>[r.id,r.text] as const)))))lines.push(`- 确定性警告${outcomeReviewed ? '' : '（人工已知悉）'}：${escapeNoteText(warning)}`);
  for(const finding of draft.qualityReport?.findings??[])lines.push(`- 模型历史发现（${finding.severity}）：${escapeNoteText(finding.reason)}`);
  if(draft.noteReview?.exclusions.length){lines.push('','### 明确排除与理由','');for(const e of draft.noteReview.exclusions)lines.push(`- ${e.kind==='fact'?'事实':'原文问题'} ${escapeNoteText(e.id)}：${escapeNoteText(e.reason)}`);}
  lines.push('','### 待确认问题','');
  for(const id of draft.noteReview?.questionIds??[]){const r=draft.humanReview!.units.filter(u=>u.kind==='question').flatMap(u=>u.records).find(r=>r.id===id)!;lines.push(`- 原文明示问题 ${escapeNoteText(id)}：${escapeNoteText(r.text)}`);}
  for(const q of draft.noteReview?.humanQuestions??[])lines.push(`- 人工补充待确认：${escapeNoteText(q)}`);
  return lines.join('\n')+'\n';
}

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
  for(const group of page.mergedTemplateFields??[])lines.push(renderMergedTemplateFields(group),'');
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
  lines.push(`- 登记日期：${orMissing(raw.publishedAt, '登记日期')}`);
  lines.push(`- 登记链接：${orMissing(raw.url, '登记链接')}`);
  lines.push('- 以上作者、日期和链接为登记线索，未经外部核验，不代表已核实单一作者全文。');
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
  for(const page of selectedPages)for(const group of page.mergedTemplateFields??[])lines.push('',renderMergedTemplateFields(group),'');
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
