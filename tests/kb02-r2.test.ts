import { persistedUpdateInput, approveWorkflow } from './support/human-review.ts';
import { semanticReviewReply } from './support/semantic-review.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildKnowledgeAtoms, coverageDiagnostic } from '../services/llm/knowledge-atoms.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { chunkText } from '../services/llm/chunk.ts';
import {
  ExtractionCheckpointStore,
  KB02_PIPELINE_VERSION,
  type ExtractionCheckpoint,
} from '../services/llm/checkpoints.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint } from '../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { type LlmProvider, type LlmCompletionRequest } from '../services/llm/provider.ts';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';

const rulesDir = path.resolve('rules'),
  sha = (value: string) => createHash('sha256').update(value).digest('hex');
const raw = {
  id: randomUUID(),
  title: '虚构渠道资料',
  sourceType: 'report',
  sourceName: '隔离测试',
  tags: [] as string[],
};
const body =
  '目标100家，在售20家，铺货率20%。旧资料是20家及20%。在售已增至30家，铺货率30%。异常审批负责人未知。AI尚未上线，仅用于未来分析建议。虚构验收免责声明。';
const atomsFrom = (request: LlmCompletionRequest) =>
  JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1)) as Array<{
    id: string;
    text: string;
    fragment: boolean;
  }>;
const planFrom = (request: LlmCompletionRequest) => {
  const p = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
  return {
    version: 3,
    document: { source_level: 'D', title: '虚构渠道指标', main_topic: '渠道指标' },
    pages: [
      {
        title: '渠道指标',
        type: 'metric',
        category: 'metric',
        factUnitIds: p.factUnits.map((x: any) => x.id),
        questionUnitIds: p.questionUnits.map((x: any) => x.id),
      },
    ],
  };
};
async function fixture(text = body) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-r2-native-')),
    store = new ExtractionCheckpointStore(root);
  await store.initialize();
  const rules = await loadExtractionRules(rulesDir),
    chunks = chunkText(text, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 });
  let checkpoint = await store.save({
    version: 1,
    jobId: randomUUID(),
    rawId: raw.id,
    rawSha256: sha(text),
    pipelineVersion: KB02_PIPELINE_VERSION,
    rulesVersion: rules.rulesVersion,
    providerIdentity: 'local|native',
    chunks: chunks.map(({ index, start, end }) => ({ index, start, end })),
    completedChunks: [],
    attempts: 0,
    stage: 'extracting',
    updatedAt: new Date().toISOString(),
  });
  const requestLog: LlmCompletionRequest[] = [];
  const provider = {
    name: 'local',
    model: 'native',
    secrets: ['native-synthetic-secret'],
    complete: async (request: LlmCompletionRequest) => {
      requestLog.push(request);
      {
        const review = semanticReviewReply(request);
        if (review) return review;
      }
      if (request.user.includes('请对下列全部已验证事实规划知识页'))
        return { text: JSON.stringify(planFrom(request)), bytes: 1, finishReason: 'stop' };
      const atoms = atomsFrom(request);
      return {
        text: JSON.stringify({
          version: 2,
          facts: atoms.slice(0, 5).map((x, i) => ({ atomId: x.id, kind: i === 1 ? 'ambiguous' : 'fact' })),
          questions: [{ atomId: atoms[3].id }],
          sourceNotes: atoms.slice(5).map((x) => ({ atomId: x.id })),
        }),
        bytes: 1,
        finishReason: 'stop',
      };
    },
  };
  const args = {
    raw,
    body: text,
    bodySha256: sha(text),
    provider,
    rulesDir,
    beforeCall: async (stage: 'extracting' | 'planning') =>
      (checkpoint = await store.save({ ...checkpoint, stage, attempts: checkpoint.attempts + 1 })),
    saveCheckpoint: async (value: Omit<ExtractionCheckpoint, 'integrity'>) => (checkpoint = await store.save(value)),
  };
  return {
    root,
    store,
    provider,
    args,
    requestLog,
    get checkpoint() {
      return checkpoint;
    },
    run: (planningRetry = false) => runKnowledgePipeline({ ...args, checkpoint, planningRetry }),
    clean: () => rm(root, { recursive: true, force: true }),
  };
}
test('KB02 R2 exact atoms preserve dimensions, negatives, ambiguity and source declarations separately', async () => {
  const f = await fixture();
  try {
    const original = body,
      result = await f.run(),
      page = result.outcome.pages[0],
      texts = page.source_facts.map((x) => x.text);
    assert.equal(body, original);
    assert(texts.includes('旧资料是20家及20%。'));
    assert(!JSON.stringify(result.outcome).includes('目标门店20家'));
    assert(texts.includes('AI尚未上线，仅用于未来分析建议。'));
    assert(!texts.some((x) => x.includes('免责声明')));
    assert.equal(f.checkpoint.completedChunks[0].sourceNotes?.[0].text, '虚构验收免责声明。');
    assert(page.open_questions.includes('原文口径或边界待确认：旧资料是20家及20%。'));
    assert(result.outcome.document.summary.includes('目标100家，在售20家，铺货率20%。'));
    assert(result.outcome.document.summary.includes('在售已增至30家，铺货率30%。'));
    assert.deepEqual(page.ai_organized, []);
    assert.deepEqual(page.ai_inferences, []);
    for (const e of page.source_evidence) assert.equal(body.slice(e.start, e.end), e.quote);
  } finally {
    await f.clean();
  }
});
test('KB02 R2 native wire rejects rewritten text and unknown/cross-chunk atoms before checkpoint success', async () => {
  for (const change of [(x: any) => ({ ...x, text: '目标20家' }), (x: any) => ({ ...x, atomId: 'c99-a0001' })]) {
    const f = await fixture();
    try {
      f.provider.complete = async (request) => ({
        text: JSON.stringify({
          version: 2,
          facts: [change({ atomId: atomsFrom(request)[0].id, kind: 'fact' })],
          questions: [],
          sourceNotes: [],
        }),
        bytes: 1,
        finishReason: 'stop',
      });
      await assert.rejects(f.run(), (e: any) =>
        ['LLM_SCHEMA_INVALID', 'LLM_EVIDENCE_UNKNOWN_LOCATOR'].includes(e.code),
      );
      assert.equal(f.checkpoint.completedChunks.length, 0);
    } finally {
      await f.clean();
    }
  }
});
test('KB02 R2 coverage diagnostics persist IDs only and explicit retry reuses validated chunks', async () => {
  const f = await fixture();
  try {
    const original = f.provider.complete;
    f.provider.complete = async (request) => {
      if (!request.user.includes('请对下列全部已验证事实规划知识页')) return original(request);
      f.requestLog.push(request);
      {
        const review = semanticReviewReply(request);
        if (review) return review;
      }
      const p = planFrom(request);
      p.pages[0].factUnitIds.shift();
      p.pages[0].factUnitIds.push(p.pages[0].factUnitIds[0], 'f-unknown');
      p.pages[0].questionUnitIds = [];
      return { text: JSON.stringify(p), bytes: 1, finishReason: 'stop' };
    };
    await assert.rejects(f.run(), (e: any) => e.code === 'LLM_PLAN_COVERAGE_INVALID');
    const diagnostic = f.checkpoint.lastError!.diagnostic!;
    assert.deepEqual(diagnostic.facts.missing, ['fu-0-20-fact']);
    assert.equal(diagnostic.facts.duplicate.length, 1);
    assert.deepEqual(diagnostic.facts.unknown, ['f-unknown']);
    assert.deepEqual(diagnostic.questions.missing, ['qu-48-58']);
    assert(!f.checkpoint.plan);
    const saved = await f.store.get(f.checkpoint.jobId);
    assert.deepEqual(saved!.lastError!.diagnostic, diagnostic);
    f.provider.complete = async (request) => {
      f.requestLog.push(request);
      {
        const review = semanticReviewReply(request);
        if (review) return review;
      }
      assert(request.user.includes('coverageFeedback'));
      return { text: JSON.stringify(planFrom(request)), bytes: 1, finishReason: 'stop' };
    };
    const done = await f.run(true);
    assert.equal(done.outcome.callCount, 3);
    assert.equal(f.checkpoint.completedChunks.length, 1);
    assert.equal(
      f.requestLog.filter(
        (x) => !x.user.includes('请对下列全部已验证事实规划知识页') && !x.user.startsWith('请审核下列完整候选知识规划'),
      ).length,
      1,
    );
  } finally {
    await f.clean();
  }
});
test('KB02 R2 summary, atom classification and current-secret tampering fail closed on restore', async () => {
  const f = await fixture();
  try {
    await f.run();
    const checkpoint = structuredClone(f.checkpoint);
    for (const change of [
      (x: ExtractionCheckpoint) => {
        x.plan!.document.summary = '目标20家';
      },
      (x: ExtractionCheckpoint) => {
        x.lastError = {
          code: 'LLM_PLAN_COVERAGE_INVALID',
          message: 'x',
          at: new Date().toISOString(),
          diagnostic: {
            facts: { missing: [], duplicate: [], unknown: ['native-synthetic-secret'] },
            questions: { missing: [], duplicate: [], unknown: [] },
            duplicateTitles: [],
          },
        };
      },
      (x: ExtractionCheckpoint) => {
        x.completedChunks[0].facts[0].text = '目标20家';
      },
    ]) {
      const changed = structuredClone(checkpoint);
      change(changed);
      await assert.rejects(
        validateKnowledgeCheckpoint({ ...f.args, checkpoint: changed }),
        (e: any) => e.code === 'LLM_CHECKPOINT_CORRUPT',
      );
    }
  } finally {
    await f.clean();
  }
});
test('KB02 R2 500000 characters retain exact full atom coverage and fragment ambiguity', () => {
  const text = '原'.repeat(500000),
    chunks = chunkText(text, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 });
  assert.equal(chunks.length, 66);
  for (const chunk of chunks) {
    const atoms = buildKnowledgeAtoms(text, buildEvidenceLocatorCatalog(text, chunk));
    assert.equal(atoms.map((x) => x.text).join(''), chunk.text);
    assert(atoms.every((x) => x.fragment));
    assert(atoms.every((x) => text.slice(x.start, x.end) === x.text));
  }
  const text2 = '甲'.repeat(8100) + 'AI尚未上线，仅用于未来建议。';
  const second = chunkText(text2, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 })[1];
  assert(second);
  assert(buildKnowledgeAtoms(text2, buildEvidenceLocatorCatalog(text2, second))[0].fragment);
});
test('KB02 R2 diagnostics distinguish missing duplicate unknown and duplicate normalized titles', () => {
  const d = coverageDiagnostic(
    ['f-c1-1', 'f-c1-2'],
    ['q-c1-1'],
    [
      { title: '主题', factIds: ['f-c1-1', 'f-c1-1', 'f-unknown'], questionIds: [] },
      { title: '  主题  ', factIds: ['f-c1-1'], questionIds: ['q-unknown'] },
    ],
  );
  assert.deepEqual(d.facts, { missing: ['f-c1-2'], duplicate: ['f-c1-1'], unknown: ['f-unknown'] });
  assert.deepEqual(d.questions, { missing: ['q-c1-1'], duplicate: [], unknown: ['q-unknown'] });
  assert.deepEqual(d.duplicateTitles, ['page-2']);
});
test('KB02 R2 empty checkpoint permits a short key without matching program-owned cache metadata', async () => {
  const f = await fixture();
  try {
    (f.provider as { secrets: string[] }).secrets = ['k'];
    await validateKnowledgeCheckpoint({ ...f.args, checkpoint: f.checkpoint });
    assert.equal(f.checkpoint.attempts, 0);
  } finally {
    await f.clean();
  }
});
test('KB02 R2 update derives exact repeated-position evidence IDs and preserves old storage/confirmation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-r2-update-'));
  try {
    const raws = new RawStore(root);
    await raws.initialize();
    const wiki = new WikiStore(root, raws);
    await wiki.initialize();
    const store = new KnowledgeWorkflowStore(root, wiki, raws);
    await store.initialize();
    const r = await raws.create({
        title: '虚构补充',
        sourceType: 'report',
        sourceName: '虚构',
        tags: [],
        body: '在售20家。\n在售20家。',
      }),
      other = await raws.create({
        title: '相同正文另一Raw',
        sourceType: 'report',
        sourceName: '虚构',
        tags: [],
        body: r.body,
      });
    const target = await wiki.create({
      title: '虚构指标',
      type: 'metric',
      category: 'metric',
      sources: [other.id],
      tags: [],
      knowledge_status: 'source_supported',
      confidence: 'medium',
      source_level: 'C',
      review_status: 'unreviewed',
      aliases: [],
      body: '原资料20%，KB02_HUMAN人工备注。',
    });
    const draftId = randomUUID(),
      pageId = randomUUID(),
      draftInput = {
        id: draftId,
        rawId: r.id,
        revision: 1,
        rawSha256: r.bodySha256,
        pages: [
          {
            pageId,
            source_facts: [{ text: '在售20家。', evidenceIds: ['second-position'] }],
            source_evidence: [{ id: 'second-position', rawId: r.id, quote: '在售20家。', start: 7, end: 13 }],
            ai_organized: [],
            ai_inferences: [],
            open_questions: [],
          },
        ],
      };
    const draft = await persistedUpdateInput(root, r, draftInput);
    let calls = 0;
    const provider: LlmProvider = {
      name: 'local',
      model: 'fake',
      secrets: ['synthetic-update-secret'],
      complete: async (request) => {
        calls++;
        assert(request.system.includes('evidenceId'));
        return {
          text: JSON.stringify({
            suggestedAdditions: [{ text: '新来源在售20家，需核对时点。', evidenceId: 'second-position' }],
            conflicts: [],
            agreement: [],
            inferences: [],
            openQuestions: ['双方时点是否一致？'],
          }),
          bytes: 1,
          finishReason: 'stop',
        };
      },
    };
    const args = {
      draftId: draft.id,
      pageId: draft.pages[0].pageId,
      baseRevision: draft.revision,
      targetWikiId: target.id,
      draft,
      raw: r,
      target,
      provider,
    };
    for (const alter of [
      (x: any) => {
        x.raw = other;
      },
      (x: any) => {
        x.draft.pages[0].source_evidence[0].end = 999;
      },
      (x: any) => {
        x.draft.pages[0].source_evidence[0].rawId = other.id;
      },
      (x: any) => {
        x.draft.pages[0].source_facts[0].evidenceIds = ['missing'];
      },
      (x: any) => {
        x.draft.pages[0].source_evidence.push({ ...x.draft.pages[0].source_evidence[0] });
      },
    ]) {
      const x = { ...args, draft: structuredClone(draft) };
      alter(x);
      await assert.rejects(store.createUpdate(x), (e: any) => e.code === 'EVIDENCE_INVALID');
    }
    assert.equal(calls, 0);
    const flow = await store.createUpdate(args);
    assert.equal(flow.evidence![0].start, 7);
    assert.equal(flow.evidence![0].end, 13);
    assert(!('evidenceId' in flow.evidence![0]));
    assert.equal((await wiki.get(target.id))!.body, target.body);
    await store.confirm(flow.id, (await approveWorkflow(store, flow.id)).revision, 'kb02-r2-confirm');
    assert((await wiki.get(target.id))!.body.includes('KB02_HUMAN'));
    assert((await wiki.get(target.id))!.body.includes('[7, 13)'));
    // Confirmation advanced the target revision; use that current version to exercise unknown new-side evidence rejection.
    args.target = (await wiki.get(target.id))!;
    provider.complete = async () => ({
      text: JSON.stringify({
        suggestedAdditions: [{ text: '错误引用', evidenceId: 'cross-raw' }],
        conflicts: [],
        agreement: [],
        inferences: [],
        openQuestions: [],
      }),
      bytes: 1,
      finishReason: 'stop',
    });
    await assert.rejects(store.createUpdate(args), (e: any) => e.code === 'EVIDENCE_INVALID');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
