import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { loadExtractionRules } from '../services/llm/rules.ts';
import type { ExtractedPage } from '../services/llm/service.ts';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { DraftStore, type DraftPage } from '../services/wiki/drafts.ts';
import { renderPageBody } from '../services/wiki/render.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { approveDraft } from './support/human-review.ts';

const titles = {
  concept: [
    '一句话解释',
    '定义',
    '为什么重要',
    '在业务中的位置',
    '关键特征',
    '常见分类',
    '与其他概念关系',
    '常见业务场景',
    '待确认问题',
    '来源',
  ],
  business_process: [
    '业务目标',
    '涉及角色',
    '触发条件',
    '输入',
    '完整流程',
    '输出',
    '使用系统',
    '关键规则',
    '人工判断点',
    '异常情况',
    '痛点',
    '可能的 AI 机会（分析建议）',
    '相关指标',
    '相关知识',
    '来源',
  ],
};
type TemplateType = keyof typeof titles;
const body = '虚构门店按确认后的补货单补货。';
const suggestion = '建议探索AI辅助核对，尚未实施。';
function extracted(type: TemplateType, rawId: string): ExtractedPage {
  return {
    title: type === 'concept' ? '虚构补货概念' : '虚构补货流程',
    type,
    category: 'supply_chain',
    one_line_definition: '虚构补货主题说明',
    source_facts: [{ text: body, evidenceIds: ['e1'] }],
    source_evidence: [{ id: 'e1', rawId, quote: body, start: 0, end: body.length, chunkIndex: 0, occurrences: 1 }],
    ai_organized: [],
    ai_inferences: [suggestion],
    related_pages: [],
    open_questions: ['异常负责人待确认。'],
    provenance: [],
  };
}
function section(markdown: string, title: string) {
  return markdown.split(`## ${title}\n`)[1]?.split('\n## ')[0]?.trim();
}
function assertFields(markdown: string, type: TemplateType) {
  for (const title of titles[type]) assert.equal(markdown.split(`## ${title}\n`).length - 1, 1, title);
  assert.equal(section(markdown, type === 'concept' ? '定义' : '业务目标'), '待确认。');
  assert.equal(section(markdown, '来源事实'), `- ${body}（证据 e1）`);
  assert.equal(section(markdown, 'AI 推断'), `- ${suggestion}`);
  assert.equal(section(markdown, '待确认问题'), '- 异常负责人待确认。');
  if (type === 'business_process') {
    assert.equal(section(markdown, '可能的 AI 机会（分析建议）'), '待确认。');
    assert.equal(section(markdown, '涉及角色'), '待确认。');
    assert.equal(section(markdown, '完整流程'), '待确认。');
    assert(!section(markdown, '可能的 AI 机会（分析建议）')!.includes(suggestion));
  }
}

test('R16/R18: 分型标题对应现行手动模板，事实和推断不自动分配到字段', async () => {
  const rules = yaml.load(await readFile('rules/page-templates.yaml', 'utf8')) as {
    templates: Record<TemplateType, { sections: Array<{ key: string; label: string }> }>;
  };
  for (const type of ['concept', 'business_process'] as const) {
    assert.deepEqual(
      [
        ...rules.templates[type].sections.map((s) =>
          s.key === 'ai_opportunities' ? `${s.label}（分析建议）` : s.label,
        ),
        '来源',
      ],
      titles[type],
    );
    const page: DraftPage = {
      ...extracted(type, 'raw'),
      pageId: 'page',
      selected: false,
      knowledge_status: 'ai_organized',
      confidence: 'low',
      source_level: 'D',
    };
    const original = structuredClone(page);
    assertFields(renderPageBody(page, { sourceTitle: '虚构来源', rawId: 'raw', createdTitles: new Set() }), type);
    assert.deepEqual(page, original);
  }
});

for (const type of ['concept', 'business_process'] as const) {
  test(`R16/R18: ${type}草稿编辑、显审、正式保存及新Store回读保持字段与来源`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'r1618-template-'));
    try {
      const raws = new RawStore(root),
        rawStates = new RawStateStore(root),
        drafts = new DraftStore(root);
      await Promise.all([raws.initialize(), rawStates.initialize(), drafts.initialize()]);
      const raw = await raws.create({
        title: '虚构模板来源',
        sourceType: 'note',
        sourceName: '离线人工夹具',
        tags: [],
        body,
      });
      const rawPath = path.join(root, 'knowledge', 'raw', 'notes', `${raw.id}.md`);
      const rawBefore = await readFile(rawPath, 'utf8');
      const bundle = await loadExtractionRules('rules');
      const rules = {
        types: bundle.fmcg.types.map((t) => t.id),
        categories: bundle.fmcg.categories.map((c) => c.id),
        knowledge_status: bundle.fmcg.enums.knowledge_status,
        confidence: bundle.fmcg.enums.confidence,
        source_level: bundle.fmcg.enums.source_level,
        review_status: bundle.fmcg.enums.review_status,
      };
      let draft = await drafts.create({
        raw,
        body,
        rules,
        jobId: randomUUID(),
        outcome: {
          document: { title: '来源：虚构模板', main_topic: '补货', summary: body },
          pages: [extracted(type, raw.id)],
          provider: { name: 'fixture', model: 'no-model-call' },
          rulesVersion: 'r1618-offline-fixture',
          callCount: 0,
          chunkCount: 1,
          chunkCoverage: [{ index: 0, start: 0, end: body.length }],
          usage: { promptTokens: 0, completionTokens: 0 },
          warnings: [],
        },
      });
      draft = await drafts.patch(
        draft.id,
        {
          baseRevision: draft.revision,
          pages: [{ pageId: draft.pages[0].pageId, one_line_definition: '人工核对后的虚构补货说明', selected: true }],
        },
        { body, rules },
      );
      const preview = drafts.view(draft).pages[0].renderedBody;
      assertFields(preview, type);
      assert(preview.includes('人工核对后的虚构补货说明'));
      const wiki = new WikiStore(root, raws);
      await wiki.initialize();
      const commits = new WikiCommitService({ root, wikiStore: wiki, rawStore: raws, rawStates, drafts });
      await commits.initialize();
      const input = {
        draftId: draft.id,
        baseRevision: draft.revision,
        selectedPageIds: [draft.pages[0].pageId],
        idempotencyKey: randomUUID(),
        operationId: randomUUID(),
        now: new Date().toISOString(),
      };
      await assert.rejects(
        wiki.withLock(() => commits.confirm(input)),
        { code: 'HUMAN_REVIEW_REQUIRED' },
      );
      assert.equal((await wiki.allRecords()).length, 0);
      draft = await approveDraft(drafts, draft.id, body);
      const result = await wiki.withLock(() => commits.confirm({ ...input, baseRevision: draft.revision }));
      assert.equal(result.manifest.status, 'completed');
      const reloaded = new WikiStore(root, new RawStore(root));
      const pages = await reloaded.allRecords();
      assert.equal(pages.length, 2);
      const page = pages.find((p) => p.type === type)!;
      assert.deepEqual(page.sources, [raw.id]);
      assert.equal(page.body, preview);
      assertFields(page.body, type);
      assert(page.body.includes(`e1｜原文 [0, ${body.length})：${body}`));
      assert(page.body.includes(`[[来源：虚构模板]]（Raw ${raw.id}）`));
      assert.equal(await readFile(rawPath, 'utf8'), rawBefore);
      const savedDraft = await new DraftStore(root).get(draft.id);
      assert.equal(savedDraft!.status, 'confirmed');
      assert.deepEqual(savedDraft!.pages[0].source_facts, draft.pages[0].source_facts);
      assert.deepEqual(savedDraft!.pages[0].source_evidence, draft.pages[0].source_evidence);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
