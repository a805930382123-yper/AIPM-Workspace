import type { ExtractOutcome } from '../../services/llm/service.ts';

export function maintenanceReply(user: string) {
  const input = JSON.parse(user) as {
    stage: string;
    source: { id: string };
    document: ExtractOutcome['document'];
    pages: ExtractOutcome['pages'];
  };
  if (input.stage !== 'maintenance') throw new Error(`Unexpected fake maintenance stage: ${input.stage}`);
  return {
    version: 1,
    changes: input.pages.map((page, pageIndex) => ({
      pageIndexes: [pageIndex],
      action: 'create',
      targetWikiId: null,
      baseRevision: null,
      title: page.title,
      body: [
        '## 来源事实',
        ...page.source_facts.map((fact) => `- ${fact.text}（证据 ${fact.evidenceIds.join('、')}）`),
        '## 来源证据',
        ...page.source_evidence.map(
          (evidence) => `- ${evidence.id}｜原文 [${evidence.start}, ${evidence.end})：${evidence.quote}`,
        ),
        '## AI 整理',
        ...page.ai_organized.map((text) => `- ${text}`),
        '## AI 推断',
        ...page.ai_inferences.map((text) => `- ${text}`),
        '## 待确认问题',
        ...page.open_questions.map((text) => `- ${text}`),
        '## 来源',
        `- [[${input.document.title}]]（Raw ${input.source.id}）`,
      ].join('\n'),
      aliases: [],
      tags: [],
      reason: '隔离测试按提取事实生成维护候选。',
      summary: ['根据本份来源新建主题'],
      questions: page.open_questions,
      dependsOn: [],
    })),
  };
}
