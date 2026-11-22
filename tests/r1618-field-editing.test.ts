import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadExtractionRules } from '../services/llm/rules.ts';
import type { ExtractedPage } from '../services/llm/service.ts';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { DraftStore, type DraftPatch } from '../services/wiki/drafts.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { templateSections, type TemplateFields } from '../services/wiki/template-fields.ts';
import { approveDraft } from './support/human-review.ts';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r1618-fields-test-'));
  const raws = new RawStore(root),
    rawStates = new RawStateStore(root),
    drafts = new DraftStore(root);
  await Promise.all([raws.initialize(), rawStates.initialize(), drafts.initialize()]);
  const quotes = [
    '虚构补货是按门店需求补充库存。',
    '虚构补货有助于避免断货。',
    '虚构门店低于安全库存时，由店长触发补货。',
    '虚构店长提交补货单，库管审核；AI尚未上线，仅为未来建议，收益未知。',
  ];
  const body = quotes.join('\n');
  const raw = await raws.create({
    title: '虚构字段资料',
    sourceType: 'note',
    sourceName: '人工离线夹具',
    body,
    tags: [],
  });
  const page = (type: 'concept' | 'business_process', offset: number): ExtractedPage => {
    const ids = [type === 'concept' ? 'concept-e1' : 'process-e1', 'shared'];
    const evidence = quotes.slice(offset, offset + 2).map((quote, index) => ({
      id: ids[index],
      rawId: raw.id,
      quote,
      start: body.indexOf(quote),
      end: body.indexOf(quote) + quote.length,
      chunkIndex: 0,
      occurrences: 1,
    }));
    return {
      title: type === 'concept' ? '虚构补货概念' : '虚构门店流程',
      type,
      category: 'supply_chain',
      one_line_definition: '原规划标题，不代表已归位解释',
      source_facts: evidence.map((e) => ({ text: e.quote, evidenceIds: [e.id] })),
      source_evidence: evidence,
      ai_organized: [],
      ai_inferences: [],
      open_questions: ['异常负责人待确认。'],
      related_pages: [],
      provenance: [],
    };
  };
  const bundle = await loadExtractionRules('rules');
  const rules = {
    types: bundle.fmcg.types.map((t) => t.id),
    categories: bundle.fmcg.categories.map((c) => c.id),
    knowledge_status: bundle.fmcg.enums.knowledge_status,
    confidence: bundle.fmcg.enums.confidence,
    source_level: bundle.fmcg.enums.source_level,
    review_status: bundle.fmcg.enums.review_status,
  };
  const draft = await drafts.create({
    raw,
    body,
    rules,
    jobId: randomUUID(),
    outcome: {
      pages: [page('concept', 0), page('business_process', 2)],
      document: { source_level: 'D', title: '来源：虚构字段资料', main_topic: '补货', summary: quotes.join('') },
      provider: { name: 'fixture', model: 'no-provider' },
      rulesVersion: 'offline-fields',
      callCount: 0,
      chunkCount: 1,
      chunkCoverage: [{ index: 0, start: 0, end: body.length }],
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
    },
  });
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const commits = new WikiCommitService({ root, rawStore: raws, rawStates, drafts, wikiStore: wiki });
  await commits.initialize();
  const file = path.join(root, 'drafts', `${draft.id}.json`);
  const patch = async (pages: DraftPatch['pages']) => {
    const current = (await drafts.get(draft.id))!;
    return drafts.patch(draft.id, { baseRevision: current.revision, pages }, { body, rules });
  };
  const commitInput = (revision: number) => ({
    draftId: draft.id,
    baseRevision: revision,
    selectedPageIds: draft.pages.map((p) => p.pageId),
    idempotencyKey: randomUUID(),
    operationId: randomUUID(),
    now: new Date().toISOString(),
  });
  return {
    root,
    raws,
    rawStates,
    drafts,
    raw,
    body,
    rules,
    draft,
    wiki,
    commits,
    file,
    patch,
    commitInput,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('FIELDS F01: 两类全部字段可引用/编辑，同证据多字段允许；未知、外页、重复ID和非法键拒绝', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.draft.pages.map((p) => ({ facts: p.source_facts, evidence: p.source_evidence })));
    for (const page of f.draft.pages) {
      const fields: TemplateFields = {};
      for (const { key } of templateSections(page.type))
        fields[key] = {
          evidenceIds: [page.source_evidence[0].id],
          humanText: key === 'ai_opportunities' ? '人工建议试点，尚未实施。' : `人工核对${key}。`,
        };
      const next = await f.patch([{ pageId: page.pageId, templateFields: fields }]);
      const markdown = f.drafts.view(next).pages[page.type === 'concept' ? 0 : 1].renderedBody;
      for (const { key, label } of templateSections(page.type)) {
        const section = markdown.split(`## ${label}\n`)[1]?.split('\n## ')[0];
        assert(section?.includes(`来源摘录（用户归位）：${page.source_evidence[0].quote}`));
        assert(
          section?.includes(
            key === 'ai_opportunities' ? '分析建议：人工建议试点，尚未实施。' : `人工说明（待核对）：人工核对${key}。`,
          ),
        );
      }
    }
    const original = await readFile(f.file, 'utf8');
    for (const id of ['missing', 'process-e1'])
      await assert.rejects(
        f.patch([{ pageId: f.draft.pages[0].pageId, templateFields: { definition: { evidenceIds: [id] } } }]),
        { code: 'TEMPLATE_EVIDENCE_UNKNOWN' },
      );
    await assert.rejects(
      f.patch([
        {
          pageId: f.draft.pages[0].pageId,
          templateFields: { definition: { evidenceIds: ['concept-e1', 'concept-e1'] } },
        },
      ]),
      { code: 'INVALID_TEMPLATE_FIELDS' },
    );
    await assert.rejects(
      f.patch([{ pageId: f.draft.pages[0].pageId, templateFields: { roles: { evidenceIds: [] } } }]),
      { code: 'INVALID_TEMPLATE_FIELDS' },
    );
    assert.equal(await readFile(f.file, 'utf8'), original);
    const next = (await f.drafts.get(f.draft.id))!;
    assert.deepEqual(
      next.pages.map((p) => ({ facts: p.source_facts, evidence: p.source_evidence })),
      before,
    );
  } finally {
    await f.close();
  }
});

test('FIELDS F02: 保存刷新、无操作保留审批、编辑失效、重新显审后新建正式页与Raw保真', async () => {
  const f = await fixture();
  try {
    const rawPath = path.join(f.root, 'knowledge/raw/notes', `${f.raw.id}.md`),
      originalRaw = await readFile(rawPath, 'utf8');
    const originalPages = f.draft.pages.map((p) => ({ facts: p.source_facts, evidence: p.source_evidence }));
    let draft = await f.patch([
      {
        pageId: f.draft.pages[0].pageId,
        selected: true,
        templateFields: { definition: { evidenceIds: ['concept-e1'], humanText: '人工定义说明。' } },
      },
      {
        pageId: f.draft.pages[1].pageId,
        selected: true,
        templateFields: {
          trigger: { evidenceIds: ['process-e1'] },
          ai_opportunities: { evidenceIds: ['shared'], humanText: '建议在未上线前先评估数据与人工复核。' },
        },
      },
    ]);
    assert.deepEqual(
      (await new DraftStore(f.root).get(draft.id))!.pages.map((p) => p.templateFields),
      draft.pages.map((p) => p.templateFields),
    );
    draft = await approveDraft(f.drafts, draft.id, f.body);
    const noOp = await f.patch(draft.pages.map((p) => ({ pageId: p.pageId, templateFields: p.templateFields })));
    assert.equal(noOp.revision, draft.revision);
    assert.deepEqual(noOp.humanReview, draft.humanReview);
    draft = await f.patch([
      {
        pageId: draft.pages[0].pageId,
        templateFields: { definition: { evidenceIds: ['concept-e1'], humanText: '人工定义说明修订。' } },
      },
    ]);
    assert.equal(draft.humanReview!.approvals.length, 0);
    await assert.rejects(
      f.wiki.withLock(() => f.commits.confirm(f.commitInput(draft.revision))),
      { code: 'HUMAN_REVIEW_INCOMPLETE' },
    );
    assert.equal((await f.wiki.allRecords()).length, 0);
    draft = await approveDraft(f.drafts, draft.id, f.body);
    const preview = f.drafts.view(draft);
    const result = await f.wiki.withLock(() => f.commits.confirm(f.commitInput(draft.revision)));
    assert.equal(result.manifest.status, 'completed');
    const formal = await new WikiStore(f.root, new RawStore(f.root)).allRecords();
    assert.equal(formal.length, 3);
    for (const p of preview.pages) {
      const saved = formal.find((w) => w.title === p.title)!;
      assert.equal(saved.body, p.renderedBody);
      assert.deepEqual(saved.sources, [f.raw.id]);
    }
    assert(formal.find((w) => w.type === 'business_process')!.body.includes('AI尚未上线，仅为未来建议，收益未知。'));
    assert.deepEqual(
      (await f.drafts.get(draft.id))!.pages.map((p) => ({ facts: p.source_facts, evidence: p.source_evidence })),
      originalPages,
    );
    assert.equal(await readFile(rawPath, 'utf8'), originalRaw);
  } finally {
    await f.close();
  }
});

test('FIELDS F03: 引用移走或同ID换引文均原子拒绝，未引用unit仍能移归', async () => {
  const f = await fixture();
  try {
    let draft = await f.patch([
      { pageId: f.draft.pages[0].pageId, templateFields: { definition: { evidenceIds: ['concept-e1'] } } },
      { pageId: f.draft.pages[1].pageId, templateFields: { steps: { evidenceIds: ['shared'] } } },
    ]);
    draft = await f.drafts.reviewOperation(
      draft.id,
      { action: 'start', baseRevision: draft.revision },
      { body: f.body, rulesDir: 'rules' },
    );
    const first = draft.humanReview!.units.find((u) => u.text === draft.pages[0].source_facts[0].text)!;
    const second = draft.humanReview!.units.find((u) => u.text === draft.pages[0].source_facts[1].text)!;
    const before = await readFile(f.file, 'utf8');
    await assert.rejects(
      f.drafts.reviewOperation(
        draft.id,
        { action: 'move', baseRevision: draft.revision, unitIds: [first.id], pageId: draft.pages[1].pageId },
        { body: f.body, rulesDir: 'rules' },
      ),
      { code: 'TEMPLATE_EVIDENCE_UNKNOWN' },
    );
    await assert.rejects(
      f.drafts.reviewOperation(
        draft.id,
        { action: 'move', baseRevision: draft.revision, unitIds: [second.id], pageId: draft.pages[1].pageId },
        { body: f.body, rulesDir: 'rules' },
      ),
      { code: 'TEMPLATE_EVIDENCE_CHANGED' },
    );
    assert.equal(await readFile(f.file, 'utf8'), before);
    draft = await f.patch([{ pageId: draft.pages[1].pageId, templateFields: {} }]);
    draft = await f.drafts.reviewOperation(
      draft.id,
      { action: 'move', baseRevision: draft.revision, unitIds: [second.id], pageId: draft.pages[1].pageId },
      { body: f.body, rulesDir: 'rules' },
    );
    assert.equal(draft.humanReview!.assignments[second.id], draft.pages[1].pageId);
    assert.equal(draft.pages[0].templateFields!.definition!.evidenceIds[0], 'concept-e1');
  } finally {
    await f.close();
  }
});

test('FIELDS F03: 带字段切型仍原子拒绝，更新保全字段后Provider失败仍保留原稿', async () => {
  const f = await fixture();
  try {
    let draft = await f.patch([
      {
        pageId: f.draft.pages[0].pageId,
        templateFields: { definition: { evidenceIds: ['concept-e1'], humanText: '应保留的人工说明。' } },
      },
    ]);
    draft = await approveDraft(f.drafts, draft.id, f.body);
    const before = await readFile(f.file, 'utf8');
    await assert.rejects(f.patch([{ pageId: draft.pages[0].pageId, type: 'metric', templateFields: {} }]), {
      code: 'TEMPLATE_TYPE_CHANGE_UNSUPPORTED',
    });
    const workflows = new KnowledgeWorkflowStore(f.root, f.wiki, f.raws);
    const target = await f.wiki.create({
      title: '旧页',
      type: 'concept',
      category: 'other',
      body: '旧内容。',
      sources: [f.raw.id],
      tags: [],
      aliases: [],
      confidence: 'low',
      knowledge_status: 'source_supported',
      source_level: 'D',
      review_status: 'unreviewed',
    });
    let calls = 0;
    await assert.rejects(
      workflows.createUpdate({
        draftId: draft.id,
        pageId: draft.pages[0].pageId,
        baseRevision: draft.revision,
        targetWikiId: target.id,
        draft,
        raw: f.raw,
        target,
        provider: {
          name: 'disabled',
          model: 'no-provider',
          complete: async (request) => {
            calls++;
            assert(JSON.parse(request.user).newSource.templateFields);
            throw new Error('Provider disabled');
          },
        },
      }),
      { code: 'LLM_PROVIDER_ERROR' },
    );
    assert.equal(calls, 1);
    assert.equal(await readFile(f.file, 'utf8'), before);
  } finally {
    await f.close();
  }
});

test('FIELDS F03: Concept启用/空一句话/全部清空回退，旧草稿读取与无操作不写盘', async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.file, 'utf8');
    await new DraftStore(f.root).get(f.draft.id);
    assert.equal(await readFile(f.file, 'utf8'), before);
    let draft = await f.patch([
      { pageId: f.draft.pages[0].pageId, templateFields: { definition: { evidenceIds: [], humanText: '人工说明。' } } },
    ]);
    let markdown = f.drafts.view(draft).pages[0].renderedBody;
    assert(markdown.includes('## 原草稿一句话说明（未归位）\n\n原规划标题，不代表已归位解释'));
    assert(markdown.includes('## 一句话解释\n\n待确认。'));
    draft = await approveDraft(f.drafts, draft.id, f.body);
    draft = await f.patch([
      { pageId: draft.pages[0].pageId, templateFields: { definition: { evidenceIds: [], humanText: '  ' } } },
    ]);
    assert.equal(draft.pages[0].templateFields, undefined);
    assert.equal(draft.humanReview!.approvals.length, 0);
    markdown = f.drafts.view(draft).pages[0].renderedBody;
    assert(markdown.includes('## 一句话解释\n\n原规划标题，不代表已归位解释'));
    assert(!markdown.includes('## 原草稿一句话说明（未归位）'));
    draft = await approveDraft(f.drafts, draft.id, f.body);
    const noOp = await f.patch([{ pageId: draft.pages[0].pageId, templateFields: {} }]);
    assert.equal(noOp.revision, draft.revision);
    assert.deepEqual(noOp.humanReview, draft.humanReview);
    draft = await f.patch([{ pageId: draft.pages[0].pageId, type: 'business_process' }]);
    draft = await f.drafts.patch(
      draft.id,
      { baseRevision: draft.revision, merge: { pageIds: draft.pages.map((p) => p.pageId) } },
      { body: f.body, rules: f.rules },
    );
    assert.equal(draft.pages.length, 1);
  } finally {
    await f.close();
  }
});

test('FIELDS F03: 直接落盘无效字段结构或外页引用不得绕过读取/显审/正式提交', async () => {
  const f = await fixture();
  try {
    let draft = await approveDraft(f.drafts, f.draft.id, f.body);
    draft.pages[0].templateFields = { definition: { evidenceIds: ['process-e1'] } };
    await writeFile(f.file, JSON.stringify(draft));
    await assert.rejects(
      f.wiki.withLock(() => f.commits.confirm(f.commitInput(draft.revision))),
      { code: 'TEMPLATE_EVIDENCE_UNKNOWN' },
    );
    assert.equal((await f.wiki.allRecords()).length, 0);
    await writeFile(
      f.file,
      JSON.stringify({
        ...draft,
        pages: [{ ...draft.pages[0], templateFields: { unexpected: { evidenceIds: [] } } }, draft.pages[1]],
      }),
    );
    await assert.rejects(f.drafts.get(draft.id));
  } finally {
    await f.close();
  }
});

test('FIELDS F03: 无字段旧草稿可显审保存，完成事务重试复用原冻结正文', async () => {
  const f = await fixture();
  try {
    const draft = await approveDraft(f.drafts, f.draft.id, f.body),
      input = f.commitInput(draft.revision);
    const first = await f.wiki.withLock(() => f.commits.confirm(input));
    const before = await f.wiki.allRecords();
    const replay = await f.wiki.withLock(() => f.commits.confirm({ ...input, operationId: randomUUID() }));
    assert(replay.reused);
    assert.equal(replay.manifest.operationId, first.manifest.operationId);
    assert.deepEqual(await f.wiki.allRecords(), before);
    assert(!Object.hasOwn((await f.drafts.get(draft.id))!.pages[0], 'templateFields'));
  } finally {
    await f.close();
  }
});
