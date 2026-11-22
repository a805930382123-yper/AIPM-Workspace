import type { AnswerSection } from './question-input.ts';
const labels = {
  fact: '来源事实',
  inference: '综合推断',
  advice: '建议',
  insufficient: '依据不足',
  conflict: '分歧待核',
};
export const answerText = (sections: AnswerSection[]) =>
  sections.map((s) => `【${labels[s.kind]}】${s.text}`).join('\n\n');
/** Simple answer selection; repeated text conservatively retains every matching source/category. */
export function answerSelection(sections: AnswerSection[], selectedText: string) {
  const whole = answerText(sections),
    starts: number[] = [];
  if (selectedText)
    for (let at = whole.indexOf(selectedText); at >= 0; at = whole.indexOf(selectedText, at + 1)) starts.push(at);
  let position = 0;
  const selected: AnswerSection[] = [];
  for (const section of sections) {
    const prefix = `【${labels[section.kind]}】`,
      start = position + prefix.length,
      end = start + section.text.length;
    position = end + 2;
    const pieces = starts
      .filter((at) => at < end && at + selectedText.length > start)
      .map((at) =>
        section.text.slice(Math.max(0, at - start), Math.min(section.text.length, at + selectedText.length - start)),
      );
    if (pieces.length) selected.push({ ...section, text: [...new Set(pieces)].join('\n') });
  }
  return {
    sections: selected,
    sectionIds: selected.map((s) => s.id),
    citationIds: [...new Set(selected.flatMap((s) => s.citationIds))],
  };
}
