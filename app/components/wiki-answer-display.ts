import type { AnswerSection } from '../../services/wiki/question-input';
import { answerText } from '../../services/wiki/question-display';

type Advice = { index: string; title: string; lead: string; colon: string; meaning: string; action: string };
type Paragraph = { sectionId: string; before: string; text: string; advice?: Advice; citationIds: string[] };
type Group = { kind: AnswerSection['kind']; layout: 'fact' | 'advice-copy' | 'advice-card' | 'prose'; paragraphs: Paragraph[]; publicCitationIds?: string[] };

export function parseWikiAnswer(sections: AnswerSection[]): Group[] {
  const groups: Group[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const labeled = answerText([section]);
    const prefix = labeled.slice(0, labeled.length - section.text.length);
    const parts = section.text.split(/(\r?\n(?:[^\S\r\n]*\r?\n)+|\r?\n(?=[^\S\r\n]*(?:【(?:来源事实|建议)】|\d+\.[ \t]*[^：:\r\n]+[：:])))/u);
    const { kind } = section;
    for (let offset = 0; offset < parts.length; offset += 2) {
      const part = parts[offset];
      const leading = part.match(/^\s*(?:(?:【来源事实】|【建议】)\s*)+/u)?.[0] ?? '';
      const before = (offset === 0 ? (sectionIndex ? '\n\n' : '') + prefix : parts[offset - 1]) + leading;
      const text = part.slice(leading.length);
      const numbered = kind === 'advice' ? text.match(/^(\s*(\d+)\.\s*)([^：:\r\n]+)([：:])([\s\S]*)$/u) : null;
      let advice: Advice | undefined;
      if (numbered && numbered[3].trim() && numbered[5].trim()) {
        const body = numbered[5];
        const firstSentence = body.match(/^[\s\S]*?(?:[。！？!?]+|\.(?=\s|$))[”’」』]*/u)?.[0] ?? body;
        advice = { index: numbered[2], title: numbered[3], lead: numbered[1], colon: numbered[4], meaning: firstSentence, action: body.slice(firstSentence.length) };
      }
      const layout = advice ? 'advice-card' : kind === 'advice' ? 'advice-copy' : kind === 'fact' ? 'fact' : 'prose';
      const paragraph = { sectionId: section.id, before, text, advice, citationIds: section.citationIds };
      const last = groups.at(-1);
      if (last?.kind === kind && last.layout === layout) last.paragraphs.push(paragraph);
      else groups.push({ kind, layout, paragraphs: [paragraph] });
    }
  }
  const firstAdvice = groups.find(group => group.kind === 'advice');
  const cards = groups.filter(group => group.layout === 'advice-card').flatMap(group => group.paragraphs);
  if (firstAdvice && cards.length > 1) {
    const common = new Set(cards[0].citationIds.filter(id => cards.every(card => card.citationIds.includes(id))));
    if (common.size) {
      firstAdvice.publicCitationIds = [...common];
      for (const card of cards) card.citationIds = card.citationIds.filter(id => !common.has(id));
    }
  }
  return groups;
}
