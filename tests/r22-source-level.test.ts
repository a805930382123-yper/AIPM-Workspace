import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
import { approveDraft, approveWorkflow } from './support/human-review.ts';
import { isExtractionDraft, isWorkflow, isWikiRecord } from '../services/storage/record-validators.ts';

async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r22-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raws = new RawStore(root),
    drafts = new DraftStore(root),
    states = new RawStateStore(root),
    checkpoints = new ExtractionCheckpointStore(root);
  await Promise.all([raws.initialize(), drafts.initialize(), states.initialize(), checkpoints.initialize()]);
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  await workflows.initialize();
  const commits = new WikiCommitService({ root, wikiStore: wiki, drafts, rawStates: states, rawStore: raws });
  await commits.initialize();
  const bundle = await loadExtractionRules('rules'),
    schema = await wiki.schema();
  const rules = {
    types: schema.types.map((x) => x.id),
    categories: schema.categories.map((x) => x.id),
    ...schema.enums,
  } as any;
  const requests: LlmCompletionRequest[] = [];
  const raw = await raws.create({
    title: '虚构正式资料',
    sourceType: 'report',
    sourceName: '虚构甲公司正式经营报告',
    author: '虚构甲公司',
    url: 'https://example.invalid/report',
    tags: [],
    body: '虚构渠道本月覆盖20家门店。',
  });
  async function extract(level?: string) {
    let cp = await checkpoints.save({
      version: 1,
      jobId: randomUUID(),
      rawId: raw.id,
      rawSha256: raw.bodySha256,
      pipelineVersion: 'kb02-2',
      rulesVersion: bundle.rulesVersion,
      providerIdentity: 'fake',
      chunks: [{ index: 0, start: 0, end: raw.body.length }],
      completedChunks: [],
      attempts: 0,
      stage: 'extracting',
      updatedAt: new Date().toISOString(),
    });
    const provider: LlmProvider = {
      name: 'fake',
      model: 'r22',
      complete: async (request) => {
        requests.push(request);
        const input = JSON.parse(request.user.split('\n').at(-1)!);
        const value = request.user.startsWith('请对下列全部已验证事实规划知识页')
          ? {
              version: 3,
              document: {
                title: raw.title,
                main_topic: '门店',
                ...(level === undefined ? {} : { source_level: level }),
              },
              pages: [
                {
                  title: '虚构渠道覆盖',
                  type: 'metric',
                  category: 'metric',
                  factUnitIds: input.factUnits.map((x: any) => x.id),
                  questionUnitIds: [],
                },
              ],
            }
          : {
              version: 2,
              facts: input.map((x: any) => ({ atomId: x.id, kind: 'fact' })),
              questions: [],
              sourceNotes: [],
            };
        return { text: JSON.stringify(value), bytes: 1, finishReason: 'stop' };
      },
    };
    const args = { raw, body: raw.body, bodySha256: raw.bodySha256, provider, rulesDir: 'rules' };
    const result = await runKnowledgePipeline({
      ...args,
      checkpoint: cp,
      beforeCall: async (stage) => (cp = await checkpoints.save({ ...cp, attempts: cp.attempts + 1, stage })),
      saveCheckpoint: async (value) => (cp = await checkpoints.save(value)),
    });
    const draft = await drafts.create({ raw, body: raw.body, outcome: result.outcome, jobId: cp.jobId, rules });
    return { draft, cp, args };
  }
  return { root, raws, raw, drafts, wiki, workflows, commits, bundle, rules, requests, extract };
}

for (const level of ['A', 'B', 'C', 'D'] as const)
  test(`R22 planning ${level} reaches single Source and page, request carries identity and policy`, async (t) => {
    const f = await fixture(t),
      { draft, cp } = await f.extract(level);
    assert.equal(draft.source.source_level, level);
    assert.equal(draft.pages[0].source_level, level);
    assert.equal(cp.plan!.document.source_level, level);
    const input = JSON.parse(f.requests[1].user.split('\n').at(-1)!);
    assert.equal(input.source.id, f.raw.id);
    assert.equal(input.source.sourceName, f.raw.sourceName);
    assert.equal(input.source.author, f.raw.author);
    assert.equal(input.source.url, f.raw.url);
    assert.deepEqual(
      input.sourcePolicy.levels.map((x: any) => x.id),
      ['A', 'B', 'C', 'D'],
    );
    assert.match(f.requests[1].system, /来源未知.*D/u);
    assert.deepEqual(f.requests[1].structuredOutput!.schema.properties!.document!.properties!.source_level!.enum, [
      'A',
      'B',
      'C',
      'D',
    ]);
  });

for (const level of [undefined, 'E', ''])
  test(`R22 missing or invalid planning level ${String(level)} fails without draft`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.extract(level), { code: 'LLM_SCHEMA_INVALID' });
    assert.equal((await f.drafts.list()).length, 0);
    assert.equal(f.requests.length, 2);
  });

test('R22 single source manual grade persists through reload and explicit confirmation without changing Raw or review status', async (t) => {
  const f = await fixture(t),
    { draft, cp, args } = await f.extract('A');
  const rawFile = path.join(f.root, 'knowledge/raw/reports', f.raw.id + '.md'),
    before = await readFile(rawFile);
  let next = await f.drafts.patch(
    draft.id,
    {
      baseRevision: draft.revision,
      source: { source_level: 'B' },
      pages: [{ pageId: draft.pages[0].pageId, source_level: 'D', selected: true }],
    },
    { rules: f.rules, body: f.raw.body },
  );
  assert.equal((await new DraftStore(f.root).get(draft.id))!.source.source_level, 'B');
  next = await approveDraft(f.drafts, draft.id, f.raw.body);
  const result = await f.commits.confirm({
    draftId: draft.id,
    baseRevision: next.revision,
    selectedPageIds: [next.pages[0].pageId],
    idempotencyKey: randomUUID(),
    operationId: randomUUID(),
    now: new Date().toISOString(),
  });
  assert.equal(result.manifest.status, 'completed');
  const pages = await f.wiki.allRecords();
  assert.equal(pages.find((p) => p.type === 'source')!.source_level, 'B');
  assert.equal(pages.find((p) => p.type === 'metric')!.source_level, 'D');
  assert(pages.every((page) => page.review_status === 'unreviewed' && page.knowledge_status !== 'verified'));
  assert.deepEqual(await readFile(rawFile), before);
  const legacy = {
    ...cp,
    plan: structuredClone(cp.plan),
    rulesVersion: cp.rulesVersion.replace(/planning-\d+-/u, 'planning-16-'),
  };
  delete legacy.plan!.document.source_level;
  await assert.rejects(validateKnowledgeCheckpoint({ ...args, checkpoint: legacy }), {
    code: 'LLM_CHECKPOINT_INCOMPATIBLE',
  });
  await validateKnowledgeCheckpoint(
    { ...args, checkpoint: { ...legacy, rulesVersion: f.bundle.rulesVersion } },
    { rulesVersion: legacy.rulesVersion, callCount: legacy.attempts },
  );
});

async function synthesis(
  f: Awaited<ReturnType<typeof fixture>>,
  levels: string[] = ['A', 'D'],
  mutate?: (value: any) => void,
) {
  const second = await f.raws.create({
    title: '虚构来源未知资料',
    sourceType: 'note',
    sourceName: '来源未知',
    body: '虚构渠道门店仍有待补充统计。',
    tags: [],
  });
  const provider: LlmProvider = {
    name: 'fake',
    model: 'r22',
    complete: async (request) => {
      f.requests.push(request);
      const input = JSON.parse(request.user);
      assert.deepEqual(
        input.raws.map((raw: any) => raw.id),
        [f.raw.id, second.id],
      );
      assert.equal(input.raws[1].sourceName, '来源未知');
      assert.equal(input.sourcePolicy.levels.length, 4);
      const value = {
        synthesis_format_version: 1,
        title: '虚构渠道综合',
        category: 'metric',
        sourceLevels: input.raws.map((raw: any, index: number) => ({ rawId: raw.id, source_level: levels[index] })),
        suggestedAdditions: input.raws.map((raw: any) => ({
          text: raw.body,
          rawId: raw.id,
          locatorId: raw.locators[0].id,
        })),
        agreement: [],
        conflicts: [],
        inferences: [],
        openQuestions: [],
      };
      mutate?.(value);
      return { text: JSON.stringify(value), bytes: 1, finishReason: 'stop' };
    },
  };
  return { second, workflow: await f.workflows.createSynthesis({ rawIds: [f.raw.id, second.id], provider }) };
}

test('R22 synthesis uses per-Raw grade, conservative initial value, manual Source/synthesis edits invalidate approvals then persist', async (t) => {
  const f = await fixture(t),
    { workflow } = await synthesis(f);
  assert.deepEqual(
    workflow.sections.sourceList.map((source) => source.source_level),
    ['A', 'D'],
  );
  assert.equal(workflow.source_level, 'D');
  assert.equal((await f.wiki.allRecords()).length, 0);
  let reviewed = await approveWorkflow(f.workflows, workflow.id),
    oldDigest = f.workflows.contentDigest(reviewed);
  const sections = structuredClone(reviewed.sections);
  sections.sourceList[0].source_level = 'B';
  sections.sourceList[1].source_level = 'C';
  reviewed = await f.workflows.patch(workflow.id, reviewed.revision, sections, undefined, 'B');
  assert.equal(reviewed.humanReview!.approvals.length, 0);
  assert.notEqual(f.workflows.contentDigest(reviewed), oldDigest);
  await assert.rejects(f.workflows.confirm(workflow.id, reviewed.revision, randomUUID()), {
    code: 'HUMAN_REVIEW_INCOMPLETE',
  });
  const reloaded = (await new KnowledgeWorkflowStore(f.root, f.wiki, f.raws).get(workflow.id))!;
  assert.equal(reloaded.source_level, 'B');
  assert.deepEqual(
    reloaded.sections.sourceList.map((source) => source.source_level),
    ['B', 'C'],
  );
  reviewed = await approveWorkflow(f.workflows, workflow.id);
  await f.workflows.confirm(workflow.id, reviewed.revision, randomUUID());
  const pages = await f.wiki.allRecords();
  assert.equal(pages.find((page) => page.type === 'synthesis')!.source_level, 'B');
  assert.deepEqual(
    pages
      .filter((page) => page.type === 'source')
      .map((page) => page.source_level)
      .sort(),
    ['B', 'C'],
  );
  assert(pages.every((page) => page.review_status === 'unreviewed' && page.knowledge_status !== 'verified'));
});

test('R22 synthesis preserves existing Source and reviewed draft grades instead of new AI guesses', async (t) => {
  const f = await fixture(t),
    { draft } = await f.extract('A');
  await f.drafts.patch(
    draft.id,
    { baseRevision: draft.revision, source: { source_level: 'B' } },
    { body: f.raw.body, rules: f.rules },
  );
  await approveDraft(f.drafts, draft.id, f.raw.body);
  const { workflow } = await synthesis(f, ['D', 'D']);
  assert.equal(workflow.sections.sourceList[0].source_level, 'B');
  const existing = await f.wiki.create({
    title: f.raw.title,
    type: 'source',
    category: 'metric',
    sources: [f.raw.id],
    source_level: 'A',
    knowledge_status: 'source_supported',
    confidence: 'medium',
    review_status: 'unreviewed',
    body: f.raw.body,
    tags: [],
    aliases: [],
  });
  const { workflow: other } = await synthesis(f, ['D', 'D']);
  assert.equal(other.sections.sourceList[0].source_level, 'A');
  assert.equal(other.sections.sourceList[0].existingSourceId, existing.id);
  const changed = structuredClone(other.sections);
  changed.sourceList[0].source_level = 'C';
  await assert.rejects(f.workflows.patch(other.id, other.revision, changed), { code: 'WORKFLOW_SOURCE_IMMUTABLE' });
  const approved = await approveWorkflow(f.workflows, other.id);
  await f.workflows.confirm(other.id, approved.revision, randomUUID());
  assert.deepEqual(await f.wiki.get(existing.id), existing);
});

for (const name of ['missing', 'invalid', 'array', 'duplicate', 'unknown'] as const)
  test(`R22 synthesis ${name} grade map fails before persistence`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      synthesis(f, ['A', 'D'], (value) => {
        if (name === 'missing') delete value.sourceLevels;
        if (name === 'invalid') value.sourceLevels[0].source_level = 'E';
        if (name === 'array') value.sourceLevels[0].source_level = ['A'];
        if (name === 'duplicate') value.sourceLevels[1].rawId = value.sourceLevels[0].rawId;
        if (name === 'unknown') value.sourceLevels[0].rawId = randomUUID();
      }),
      { code: 'LLM_SCHEMA_INVALID' },
    );
    assert.equal((await f.workflows.list()).length, 0);
    assert.equal((await f.wiki.allRecords()).length, 0);
  });

test('R22 storage rejects array grades in document, workflow, source list and formal Wiki boundaries', async (t) => {
  const f = await fixture(t),
    { draft } = await f.extract('A'),
    { workflow } = await synthesis(f);
  assert.equal(isExtractionDraft(draft), true);
  assert.equal(isWorkflow(workflow), true);
  const badDocument = structuredClone(draft) as any;
  badDocument.document.source_level = ['A'];
  assert.equal(isExtractionDraft(badDocument), false);
  const badWorkflow = structuredClone(workflow) as any;
  badWorkflow.source_level = ['A'];
  assert.equal(isWorkflow(badWorkflow), false);
  const badSource = structuredClone(workflow) as any;
  badSource.sections.sourceList[0].source_level = ['A'];
  assert.equal(isWorkflow(badSource), false);
  const wiki = await f.wiki.create({
    title: '虚构来源等级存储',
    type: 'source',
    category: 'metric',
    sources: [f.raw.id],
    source_level: 'A',
    knowledge_status: 'source_supported',
    confidence: 'medium',
    review_status: 'unreviewed',
    body: f.raw.body,
    tags: [],
    aliases: [],
  });
  assert.equal(isWikiRecord(wiki), true);
  assert.equal(isWikiRecord({ ...wiki, source_level: ['A'] }), false);
});

test('R22 update inherits reviewed input Source grade and preserves the existing target grade', async (t) => {
  const f = await fixture(t),
    { draft } = await f.extract('A');
  await f.drafts.patch(
    draft.id,
    { baseRevision: draft.revision, source: { source_level: 'B' } },
    { body: f.raw.body, rules: f.rules },
  );
  const reviewed = await approveDraft(f.drafts, draft.id, f.raw.body);
  const target = await f.wiki.create({
    title: '虚构已有渠道指标',
    type: 'metric',
    category: 'metric',
    sources: [f.raw.id],
    source_level: 'D',
    knowledge_status: 'source_supported',
    confidence: 'medium',
    review_status: 'unreviewed',
    body: '虚构已有经营记录。',
    tags: [],
    aliases: [],
  });
  const workflow = await f.workflows.createUpdate({
    draftId: reviewed.id,
    pageId: reviewed.pages[0].pageId,
    baseRevision: reviewed.revision,
    targetWikiId: target.id,
    draft: reviewed,
    raw: f.raw,
    target,
    provider: {
      name: 'fake',
      model: 'r22-update',
      complete: async () => ({
        text: JSON.stringify({
          suggestedAdditions: [],
          conflicts: [],
          agreement: [],
          inferences: [],
          openQuestions: [],
        }),
        bytes: 1,
        finishReason: 'stop',
      }),
    },
  });
  assert.equal(workflow.sections.sourceList[0].source_level, 'B');
  const approved = await approveWorkflow(f.workflows, workflow.id);
  await f.workflows.confirm(workflow.id, approved.revision, randomUUID());
  assert.equal((await f.wiki.get(target.id))!.source_level, 'D');
  assert.equal((await f.wiki.allRecords()).find((page) => page.type === 'source')!.source_level, 'B');
});

test('R22 records created without any AI source grade default to D and retain explicit edits', async (t) => {
  const f = await fixture(t),
    { draft } = await f.extract('A');
  const document = { title: '纯手工来源', main_topic: '门店', summary: '纯手工摘要' };
  const manual = await f.drafts.create({
    raw: f.raw,
    body: f.raw.body,
    rules: f.rules,
    jobId: randomUUID(),
    outcome: {
      document,
      pages: draft.pages.map((page) => ({
        ...page,
        source_evidence: page.source_evidence.map((e) => ({ ...e, occurrences: 1 })),
      })),
      provider: { name: 'none', model: 'none' },
      rulesVersion: 'manual',
      callCount: 0,
      chunkCount: 1,
      chunkCoverage: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
    },
  });
  assert.equal(manual.source.source_level, 'D');
  assert.equal(manual.pages[0].source_level, 'D');
  const patched = await f.drafts.patch(
    manual.id,
    { baseRevision: manual.revision, source: { source_level: 'C' } },
    { body: f.raw.body, rules: f.rules },
  );
  assert.equal((await f.drafts.get(patched.id))!.source.source_level, 'C');
});
