import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { runKnowledgePipeline } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { renderInputTemplateFields, validInputTemplateFields } from '../services/wiki/template-fields.ts';
import { isWorkflow } from '../services/storage/record-validators.ts';
import { registerKnowledgeRoutes } from '../server/knowledge-api.ts';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
import { approveDraft, approveWorkflow } from './support/human-review.ts';

async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b09-template-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root),
    drafts = new DraftStore(root),
    checkpoints = new ExtractionCheckpointStore(root);
  await Promise.all([raws.initialize(), drafts.initialize(), checkpoints.initialize()]);
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  await workflows.initialize();
  const first = '补货概念是按门店需求补充库存。',
    second = '门店提交补货单后，库管仅编制补货安排单，尚未发货。';
  const body = first + '\n' + '排版说明仅用于隔离测试定位。'.repeat(20) + '\n' + second + '异常补货由谁审批？';
  const raw = await raws.create({
    title: '虚构模板更新资料',
    sourceType: 'note',
    sourceName: '隔离工程样本',
    body,
    tags: [],
  });
  const bundle = await loadExtractionRules('rules'),
    schema = await wiki.schema();
  const rules = {
    types: schema.types.map((x) => x.id),
    categories: schema.categories.map((x) => x.id),
    ...schema.enums,
  } as any;
  let cp = await checkpoints.save({
    version: 1,
    jobId: randomUUID(),
    rawId: raw.id,
    rawSha256: raw.bodySha256,
    pipelineVersion: 'kb02-2',
    rulesVersion: bundle.rulesVersion,
    providerIdentity: 'fixture',
    chunks: [{ index: 0, start: 0, end: body.length }],
    completedChunks: [],
    attempts: 0,
    stage: 'extracting',
    updatedAt: new Date().toISOString(),
  });
  const extractor: LlmProvider = {
    name: 'fixture',
    model: 'offline',
    complete: async (request) => {
      const input = JSON.parse(request.user.split('\n').at(-1)!);
      const value = request.user.startsWith('请对下列全部已验证事实规划知识页')
        ? {
            version: 3,
            document: { title: raw.title, main_topic: '补货', source_level: 'B' },
            pages: [
              {
                title: '补货概念',
                type: 'concept',
                category: 'supply_chain',
                factUnitIds: [input.factUnits[0].id],
                questionUnitIds: [],
                templateFields: {
                  definition: { text: first, factUnitIds: [input.factUnits[0].id] },
                  one_line_explanation: { text: '按需求补充库存。', factUnitIds: [input.factUnits[0].id] },
                },
              },
              {
                title: '补货流程',
                type: 'business_process',
                category: 'supply_chain',
                factUnitIds: [input.factUnits[1].id],
                questionUnitIds: input.questionUnits.map((x: any) => x.id),
                templateFields: {
                  steps: { text: second, factUnitIds: [input.factUnits[1].id] },
                  outputs: { text: '仅形成安排单，尚未发货。', factUnitIds: [input.factUnits[1].id] },
                },
              },
            ],
          }
        : {
            version: 2,
            facts: input
              .filter((x: any) => [first, second].includes(x.text))
              .map((x: any) => ({ atomId: x.id, kind: 'fact' })),
            questions: input.filter((x: any) => x.text.includes('由谁审批')).map((x: any) => ({ atomId: x.id })),
            sourceNotes: [],
          };
      return { text: JSON.stringify(value), bytes: 1, finishReason: 'stop' };
    },
  };
  const { outcome } = await runKnowledgePipeline({
    raw,
    body,
    bodySha256: raw.bodySha256,
    provider: extractor,
    rulesDir: 'rules',
    checkpoint: cp,
    beforeCall: async (stage) => (cp = await checkpoints.save({ ...cp, stage, attempts: cp.attempts + 1 })),
    saveCheckpoint: async (value) => (cp = await checkpoints.save(value)),
  });
  let draft = await drafts.create({ raw, body, outcome, jobId: cp.jobId, rules });
  draft = await drafts.patch(
    draft.id,
    {
      baseRevision: draft.revision,
      pages: draft.pages.map((page) => {
        const key = page.type === 'concept' ? 'definition' : 'steps';
        return {
          pageId: page.pageId,
          templateFields: {
            ...page.templateFields,
            [key]: {
              ...page.templateFields![key]!,
              evidenceIds: [page.source_evidence[0].id],
              humanText: '人工说明：异常负责人仍需核验，不补造答案。',
              aiContent: {
                ...page.templateFields![key]!.aiContent!,
                text: '人工校订：' + page.templateFields![key]!.aiContent!.text,
              },
            },
          },
        };
      }),
    },
    { body, rules },
  );
  const oldRaw = await raws.create({
    title: '既有人工资料',
    sourceType: 'note',
    sourceName: '隔离目标依据',
    body: '旧正文与栏目必须保留。',
    tags: [],
  });
  const targets = await Promise.all(
    ['concept', 'business_process'].map((type) =>
      wiki.create({
        title: '已有' + type,
        type: type as 'concept' | 'business_process',
        category: 'supply_chain',
        sources: [oldRaw.id],
        tags: [],
        aliases: [],
        body: '## 原栏目\n\n旧正文与栏目必须保留。',
        source_level: 'D',
        knowledge_status: 'source_supported',
        confidence: 'medium',
        review_status: 'unreviewed',
      }),
    ),
  );
  const requests: LlmCompletionRequest[] = [];
  const provider: LlmProvider = {
    name: 'fixture',
    model: 'update-offline',
    complete: async (request) => {
      requests.push(request);
      const input = JSON.parse(request.user);
      return {
        text: JSON.stringify({
          suggestedAdditions: [{ text: input.newSource.facts[0].text, evidenceId: input.newSource.evidence[0].id }],
          conflicts: [],
          agreement: [],
          inferences: [],
          openQuestions: ['异常负责人仍待确认。'],
        }),
        bytes: 1,
        finishReason: 'stop',
      };
    },
  };
  const create = async (type = 'concept') => {
    const current = (await drafts.get(draft.id))!,
      page = current.pages.find((page) => page.type === type)!,
      target = (await wiki.get(targets.find((page) => page.type === type)!.id))!;
    return workflows.createUpdate({
      draftId: current.id,
      pageId: page.pageId,
      baseRevision: current.revision,
      targetWikiId: target.id,
      draft: current,
      raw,
      target,
      provider,
    });
  };
  return { root, raw, body, raws, wiki, drafts, draft, workflows, targets, requests, rules, create };
}

for (const type of ['concept', 'business_process'])
  test(`U01/02 ${type} template fields reach request, read-only preview and exact committed appendix`, async (t) => {
    const f = await fixture(t),
      rawFile = path.join(f.root, 'knowledge/raw/notes', f.raw.id + '.md'),
      rawBefore = await readFile(rawFile);
    const draft = await approveDraft(f.drafts, f.draft.id, f.body),
      page = draft.pages.find((page) => page.type === type)!,
      original = structuredClone({
        facts: page.source_facts,
        evidence: page.source_evidence,
        questions: page.open_questions,
      });
    const workflow = await f.create(type),
      snapshot = workflow.inputTemplateFields!;
    assert.equal(validInputTemplateFields(snapshot), true);
    assert.deepEqual(snapshot.fields, page.templateFields);
    const input = JSON.parse(f.requests[0].user);
    assert.deepEqual(input.newSource.templateFields, snapshot);
    assert.deepEqual(input.newSource.facts, original.facts);
    assert.equal(input.newSource.templateFieldsPreview, renderInputTemplateFields(snapshot));
    assert.match(f.requests[0].system, /不得仅凭人工说明或AI整理生成事实建议/u);
    const text = renderInputTemplateFields(snapshot);
    for (const label of ['来源摘录（人工归位）', '人工说明', 'AI整理（人工修改）', '#### AI整理'])
      assert(text.includes(label));
    for (const field of Object.values(page.templateFields!)) {
      if (field.aiContent) assert(text.includes(field.aiContent.text));
      if (field.humanText) assert(text.includes(field.humanText));
    }
    assert(text.includes(f.raw.id));
    assert(text.includes(page.source_evidence[0].quote));
    assert.equal(workflow.humanReview!.approvals.length, 0);
    const target = f.targets.find((target) => target.type === type)!;
    assert.deepEqual(await f.wiki.get(target.id), target);
    const approved = await approveWorkflow(f.workflows, workflow.id),
      result = await f.workflows.confirm(workflow.id, approved.revision, 'one-confirm');
    const formal = (await f.wiki.get(target.id))!;
    assert(formal.body.startsWith(target.body));
    assert(formal.body.includes(text));
    assert.equal(formal.source_level, 'D');
    assert.equal(formal.revision, 2);
    assert.equal(formal.sources.length, 2);
    assert.equal(
      (await f.wiki.allRecords()).find((page) => page.type === 'source' && page.sources[0] === f.raw.id)!.source_level,
      'B',
    );
    assert.deepEqual(await readFile(rawFile), rawBefore);
    assert.deepEqual(
      { facts: page.source_facts, evidence: page.source_evidence, questions: page.open_questions },
      original,
    );
    const reboot = new KnowledgeWorkflowStore(f.root, f.wiki, f.raws);
    await reboot.initialize();
    assert.deepEqual((await reboot.get(workflow.id))!.inputTemplateFields, snapshot);
    const repeated = await reboot.confirm(workflow.id, result.workflow.revision, 'one-confirm');
    assert.equal(repeated.reused, true);
    assert.deepEqual(await f.wiki.get(target.id), formal);
    assert.equal(formal.body.split('## 本次来源整理').length, 2);
    const storedPage = (await f.drafts.get(draft.id))!.pages.find((item) => item.pageId === page.pageId)!;
    assert.deepEqual(
      { facts: storedPage.source_facts, evidence: storedPage.source_evidence, questions: storedPage.open_questions },
      original,
    );
    const log = (await readFile(path.join(f.root, 'knowledge/logs/wiki.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      log.filter(
        (entry) =>
          entry.operationId === result.workflow.commitOperationId &&
          entry.id === target.id &&
          entry.action === 'update' &&
          entry.revision === 2,
      ).length,
      1,
    );
  });

test('U03 both input and workflow require their own approval; edits invalidate approvals and bind snapshot digest', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.create(), { code: 'HUMAN_REVIEW_INCOMPLETE' });
  assert.equal(f.requests.length, 0);
  await approveDraft(f.drafts, f.draft.id, f.body);
  const workflow = await f.create();
  await assert.rejects(f.workflows.confirm(workflow.id, workflow.revision, 'unreviewed'), {
    code: 'HUMAN_REVIEW_INCOMPLETE',
  });
  let reviewed = await approveWorkflow(f.workflows, workflow.id),
    digest = f.workflows.contentDigest(reviewed);
  const changed = structuredClone(reviewed);
  changed.inputTemplateFields!.fields.definition!.humanText += ' 新说明';
  assert.notEqual(f.workflows.contentDigest(changed), digest);
  reviewed = await f.workflows.patch(reviewed.id, reviewed.revision, {
    ...reviewed.sections,
    inferences: ['人工补充，尚待核验。'],
  });
  assert.equal(reviewed.humanReview!.approvals.length, 0);
  await assert.rejects(f.workflows.confirm(reviewed.id, reviewed.revision, 'edited'), {
    code: 'HUMAN_REVIEW_INCOMPLETE',
  });
  assert.equal((await f.wiki.allRecords()).length, 2);
});

test('U03 editing the original field invalidates old update input; target conflict writes no partial Source', async (t) => {
  const f = await fixture(t);
  let draft = await approveDraft(f.drafts, f.draft.id, f.body);
  const first = await f.create(),
    approved = await approveWorkflow(f.workflows, first.id);
  const page = draft.pages[0];
  draft = await f.drafts.patch(
    draft.id,
    {
      baseRevision: draft.revision,
      pages: [
        {
          pageId: page.pageId,
          templateFields: {
            ...page.templateFields,
            definition: { ...page.templateFields!.definition!, humanText: '新的人工说明。' },
          },
        },
      ],
    },
    { body: f.body, rules: f.rules },
  );
  await assert.rejects(f.workflows.confirm(first.id, approved.revision, 'stale-input'), {
    code: 'INPUT_REVIEW_CHANGED',
  });
  assert.equal((await f.wiki.allRecords()).length, 2);
  await approveDraft(f.drafts, draft.id, f.body);
  const second = await f.create(),
    secondReviewed = await approveWorkflow(f.workflows, second.id),
    target = f.targets[0];
  await f.wiki.update(target.id, target.revision, { ...target, body: target.body + '\n人工后续编辑。' });
  const before = await f.wiki.allRecords();
  await assert.rejects(f.workflows.confirm(second.id, secondReviewed.revision, 'stale-target'), {
    code: 'REVISION_CONFLICT',
  });
  assert.deepEqual(await f.wiki.allRecords(), before);
});

test('U02 illegal and cross-page references fail before Provider, with original fields retained', async (t) => {
  const f = await fixture(t),
    draft = await approveDraft(f.drafts, f.draft.id, f.body),
    file = path.join(f.root, 'drafts', draft.id + '.json');
  for (const kind of ['manual', 'ai'] as const) {
    const changed = structuredClone(draft);
    if (kind === 'manual') changed.pages[0].templateFields!.definition!.evidenceIds = ['not-in-page'];
    else
      changed.pages[0].templateFields!.definition!.aiContent!.factIds =
        draft.pages[1].templateFields!.steps!.aiContent!.factIds;
    await writeFile(file, JSON.stringify(changed));
    await assert.rejects(f.create(), (error: any) =>
      ['TEMPLATE_EVIDENCE_UNKNOWN', 'TEMPLATE_AI_FACT_UNKNOWN'].includes(error.code),
    );
    assert.equal(f.requests.length, 0);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).pages[0].templateFields, changed.pages[0].templateFields);
  }
});

test('U03/04 HTTP patch cannot inject/delete snapshot; corrupt storage fails while old workflow remains readable', async (t) => {
  const f = await fixture(t);
  await approveDraft(f.drafts, f.draft.id, f.body);
  const workflow = await f.create();
  const app = express();
  app.use(express.json());
  registerKnowledgeRoutes(app, {
    root: f.root,
    raws: f.raws,
    drafts: f.drafts,
    wiki: f.wiki,
    provider: () => undefined,
  });
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.status ?? 500).json({ error: { code: error.code } }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/knowledge/workflows/${workflow.id}`;
  for (const value of [null, {}]) {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: workflow.revision,
        sections: workflow.sections,
        inputTemplateFields: value,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_PATCH');
  }
  assert.deepEqual((await f.workflows.get(workflow.id))!.inputTemplateFields, workflow.inputTemplateFields);
  const legacy = structuredClone(workflow);
  delete legacy.inputTemplateFields;
  assert.equal(isWorkflow(legacy), true);
  const damaged = structuredClone(workflow);
  damaged.inputTemplateFields!.fields.definition!.aiContent!.factIds = ['foreign-fact'];
  assert.equal(isWorkflow(damaged), false);
  const file = path.join(f.root, 'drafts/knowledge-workflows', workflow.id + '.json');
  await writeFile(file, JSON.stringify(damaged));
  const before = await readFile(file);
  await assert.rejects(f.workflows.get(workflow.id), { code: 'STORAGE_CORRUPT' });
  assert.deepEqual(await readFile(file), before);
});
