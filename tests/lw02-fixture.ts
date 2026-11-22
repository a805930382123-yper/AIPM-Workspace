import { randomUUID } from 'node:crypto';
import { lwFixture } from './lw01-fixture.ts';
import { KnowledgeAnswerService, answerText, type KnowledgeAnswer } from '../services/llm/knowledge-answers.ts';
import { maintenanceDigest } from '../services/wiki/maintenance.ts';
import type { QuestionPreview } from '../services/wiki/question-input.ts';
import type { QuestionDraftRecord } from '../services/wiki/drafts.ts';
export async function lw02Fixture(existingRoot?: string) {
  const f = await lwFixture(existingRoot),
    requests: any[] = [];
  let mode: 'normal' | 'raw' | 'inference' | 'partial' | 'invalid' | 'no_change' = 'normal',
    failures = 0;
  f.provider.complete = async (request) => {
    requests.push(request);
    const p = JSON.parse(request.user);
    if (failures > 0) {
      failures--;
      throw Error('LW02 controlled provider failure');
    }
    let output: any;
    if (p.stage === 'knowledge_answer') {
      if (mode === 'raw' && !p.rawFragments.length)
        output = {
          version: 1,
          sections: [],
          citations: [],
          needsRaw: p.availableRawIds
            .slice(0, 2)
            .map((rawId: string) => ({ rawId, reason: '核对冲突双方的原始统计口径', query: '渠道' })),
        };
      else {
        const citations = p.wiki.map((w: any, i: number) => {
          const quote = w.body.split('\n').find((line: string) => line.trim() && !line.startsWith('#')) ?? w.body;
          return {
            id: 'wiki-' + i,
            kind: 'wiki',
            recordId: w.id,
            quote,
            start: w.body.indexOf(quote),
            end: w.body.indexOf(quote) + quote.length,
          };
        });
        for (const [i, raw] of p.rawFragments.entries()) {
          const quote = raw.quote.split('\n')[0];
          citations.push({
            id: 'raw-' + i,
            kind: 'raw',
            recordId: raw.rawId,
            quote,
            start: raw.start,
            end: raw.start + quote.length,
          });
        }
        if (mode === 'invalid' && citations[0]) citations[0].recordId = randomUUID();
        output = {
          version: 1,
          needsRaw: [],
          citations,
          sections: [
            {
              kind: 'fact',
              text: p.wiki.map((w: any) => w.body).join('\n'),
              citationIds: citations.map((c: any) => c.id),
            },
          ],
        };
        if (mode === 'inference')
          output.sections.push({
            kind: 'inference',
            text: '综合推断：不同统计口径应分别追踪，仍需业务核验。',
            citationIds: citations.map((c: any) => c.id),
          });
        if (mode === 'partial')
          output.sections.push({
            kind: 'insufficient',
            text: '尚无利润口径资料，无法给出该部分结论。',
            citationIds: [],
          });
      }
    } else if (p.stage === 'answer_maintenance') {
      const old = p.preview.targetWikiId
        ? p.context.find((w: any) => w.id === p.preview.targetWikiId)
        : p.context.find((w: any) => w.title === p.preview.title);
      output = {
        action: mode === 'no_change' ? 'no_change' : old ? 'update' : 'create',
        targetWikiId: old?.id ?? null,
        baseRevision: old?.revision ?? null,
        title: old?.title ?? p.preview.title,
        type: 'synthesis',
        category: 'channel',
        body:
          (old ? old.body + '\n\n' : '') +
          '## 问答整理（人工审核前）\n' +
          p.preview.conclusion +
          (p.preview.inferences ? '\n\n## 推断与建议（待核）\n' + p.preview.inferences : ''),
        tags: p.preview.tags,
        reason:
          mode === 'no_change'
            ? '当前Wiki已经完整覆盖所选内容。'
            : old
              ? '在已有主题保留人工内容并补充。'
              : '选中内容形成独立新专题。',
        summary: ['保留依据和原有人工内容', '新增用户已选整理，推断保持待核'],
        questions: ['语义支持程度仍待人工核验。'],
      };
    } else throw Error('Unknown LW02 fake stage ' + p.stage);
    const text = JSON.stringify(output);
    return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
  };
  const answers = new KnowledgeAnswerService({
    root: f.root,
    wiki: f.wiki,
    raws: f.rawStore,
    drafts: f.drafts,
    provider: () => f.provider,
  });
  await answers.initialize();
  const seed = async (title: string, body: string, sources: string[] = []) =>
    f.wiki.create({
      title,
      type: 'concept',
      category: 'channel',
      body,
      sources,
      tags: ['渠道口径'],
      aliases: ['有效门店统计'],
      knowledge_status: 'ai_organized',
      confidence: 'low',
      source_level: 'D',
      review_status: 'unreviewed',
    });
  const ask = async (question = '有效门店统计的口径是什么？', id: string = randomUUID(), retry = false) =>
    answers.ask({ requestId: id, question, retry });
  const preview = (r: KnowledgeAnswer, patch: Partial<QuestionPreview> = {}): QuestionPreview => ({
    title: '渠道统计专题整理',
    conclusion: r.sections
      .filter((s) => s.kind === 'fact' || s.kind === 'conflict')
      .map((s) => s.text)
      .join('\n'),
    inferences: r.sections
      .filter((s) => s.kind === 'inference' || s.kind === 'advice')
      .map((s) => s.text)
      .join('\n'),
    tags: ['渠道口径'],
    selectedSectionIds: r.sections.map((s) => s.id),
    selectedText: answerText(r.sections),
    citationIds: r.citations.map((c) => c.id),
    ...patch,
  });
  const approve = async (id: string) => {
    let d = (await f.drafts.getKnowledge(id)) as QuestionDraftRecord;
    for (const c of d.maintenance.changes)
      d = (await f.drafts.reviewKnowledgeChange(id, {
        baseRevision: d.revision,
        changeId: c.changeId,
        decision: 'accept',
      })) as QuestionDraftRecord;
    for (const c of d.maintenance.changes)
      d = (await f.drafts.reviewKnowledgeChange(id, {
        baseRevision: d.revision,
        changeId: c.changeId,
        confirmed: true,
        digest: maintenanceDigest(d, c.changeId),
      })) as QuestionDraftRecord;
    return d;
  };
  const commit = async (d: QuestionDraftRecord, key: string = randomUUID()) =>
    f.wiki.withLock(() =>
      f.commits.confirm({
        draftId: d.id,
        baseRevision: d.revision,
        selectedPageIds: d.pages.map((p) => p.pageId),
        idempotencyKey: key,
        operationId: randomUUID(),
        now: new Date().toISOString(),
      }),
    );
  return {
    ...f,
    answers,
    requests,
    seed,
    ask,
    preview,
    approve,
    commit,
    mode: (value: typeof mode) => {
      mode = value;
    },
    fail: (count = 1) => {
      failures = count;
    },
    newAnswers: () =>
      new KnowledgeAnswerService({
        root: f.root,
        wiki: f.wiki,
        raws: f.rawStore,
        drafts: f.drafts,
        provider: () => f.provider,
      }),
  };
}
