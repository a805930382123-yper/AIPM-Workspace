import { semanticReviewReply } from './support/semantic-review.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chunkText } from '../services/llm/chunk.ts';
import { buildKnowledgeAtoms, coverageDiagnostic } from '../services/llm/knowledge-atoms.ts';
import { buildEvidenceLocatorCatalog } from '../services/llm/locators.ts';
import { buildKnowledgePlanningInput, buildKnowledgePlanningWire } from '../services/llm/knowledge-planning.ts';
import { runKnowledgePipeline } from '../services/llm/knowledge-extraction.ts';
import {
  ExtractionCheckpointStore,
  type ExtractionCheckpoint,
  type CheckpointChunk,
} from '../services/llm/checkpoints.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import type { LlmCompletionRequest, LlmProvider } from '../services/llm/provider.ts';
import { storageFixture } from './support/kb02-storage-fixture.ts';
import { storageHttp } from './support/kb02-storage-http.ts';

const fixturePath = 'tests/acceptance/KB02-PLAN-20261022-sol-failure-fixture.json';
const fixture = async () => JSON.parse(await readFile(fixturePath, 'utf8'));
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const chunks = (body: string) => chunkText(body, { maxChunkChars: 8000, overlap: 400, maxRawChars: 500000 });
const catalogs = (body: string) => new Map(chunks(body).map((c) => [c.index, buildEvidenceLocatorCatalog(body, c)]));
const data = (r: LlmCompletionRequest) => JSON.parse(r.user.split('\n').at(-1)!);
type PlanningWire = ReturnType<typeof buildKnowledgePlanningWire>;
const contextText = (p: PlanningWire, c: PlanningWire['sourceContexts'][number]) => {
  assert(!('text' in c));
  const passage = p.passages.find((p) => p.id === c.passageId)!;
  return passage.text.slice(c.contextStart - passage.start, c.contextEnd - passage.start);
};
const projectOldFailure = (response: any, p: ReturnType<typeof buildKnowledgePlanningInput>) => ({
  version: 3,
  document: { ...response.document, source_level: 'D' },
  pages: response.pages.map((page: any) => ({
    title: page.title,
    type: page.type,
    category: page.category,
    factUnitIds: p.factUnits.filter((u) => u.memberIds.every((id) => page.factIds.includes(id))).map((u) => u.id),
    questionUnitIds: p.questionUnits
      .filter((u) => u.memberIds.every((id) => page.questionIds.includes(id)))
      .map((u) => u.id),
  })),
});
const validPlan = (p: ReturnType<typeof buildKnowledgePlanningInput>) => ({
  version: 3,
  document: { source_level: 'D', title: '虚构主题', main_topic: '业务' },
  pages: [
    {
      title: '虚构主题',
      type: 'metric',
      category: 'metric',
      factUnitIds: p.factUnits.map((i) => i.id),
      questionUnitIds: p.questionUnits.map((i) => i.id),
    },
  ],
});
// Recreate only each old response's omissions on an otherwise schema-valid v3 plan.
// The original bad assignments remain tested verbatim as v2; tests never repair runtime output.
const projectOldOmissions = (source: any, p: ReturnType<typeof buildKnowledgePlanningInput>) => {
  const missing = source.checkpoint.lastError.diagnostic,
    plan = validPlan(p);
  plan.pages[0].factUnitIds = p.factUnits
    .filter((u) => !u.memberIds.some((id) => missing.facts.missing.includes(id)))
    .map((u) => u.id);
  plan.pages[0].questionUnitIds = p.questionUnits
    .filter((u) => !u.memberIds.some((id) => missing.questions.missing.includes(id)))
    .map((u) => u.id);
  return plan;
};

async function runFixture(
  source: { raw: any; checkpoint: ExtractionCheckpoint },
  response?: (r: LlmCompletionRequest) => unknown,
  secrets: string[] = [],
) {
  const bundle = await loadExtractionRules('rules');
  let cp = structuredClone({ ...source.checkpoint, rulesVersion: bundle.rulesVersion }),
    writes = 0;
  const requests: LlmCompletionRequest[] = [];
  const provider: LlmProvider = {
    name: 'offline',
    model: 'planning-context',
    secrets,
    complete: async (r) => {
      requests.push(r);
      {
        const review = semanticReviewReply(r);
        if (review) return review;
      }
      const output = response ? response(r) : validPlan(data(r));
      return { text: JSON.stringify(output), bytes: 1, finishReason: 'stop' };
    },
  };
  const args = {
    raw: source.raw,
    body: source.raw.body,
    bodySha256: sha(source.raw.body),
    rulesDir: 'rules',
    provider,
    beforeCall: async (stage: 'extracting' | 'planning') => {
      writes++;
      return (cp = { ...cp, stage, attempts: cp.attempts + 1 });
    },
    saveCheckpoint: async (value: Omit<ExtractionCheckpoint, 'integrity'>) => {
      writes++;
      return (cp = value as ExtractionCheckpoint);
    },
  };
  return {
    args,
    requests,
    get cp() {
      return cp;
    },
    get writes() {
      return writes;
    },
    run: (planningRetry = false) => runKnowledgePipeline({ ...args, checkpoint: cp, planningRetry }),
  };
}

async function synthetic(body: string, pick: (text: string) => boolean = () => true) {
  const raw = {
    id: randomUUID(),
    title: '虚构规划测试',
    sourceType: 'report',
    sourceName: '隔离',
    tags: [],
    body,
    bodySha256: sha(body),
  };
  const completedChunks: CheckpointChunk[] = chunks(body).map((c) => {
    const catalog = buildEvidenceLocatorCatalog(body, c),
      chosen = buildKnowledgeAtoms(body, catalog).filter((a) => a.text.trim() && pick(a.text));
    assert(chosen.length <= 32);
    const facts = chosen.map((a, i) => ({
      id: `f-c${c.index + 1}-${i + 1}`,
      text: a.text,
      atomId: a.id,
      chunkIndex: c.index,
      locatorIds: a.locatorIds,
      kind: a.fragment ? ('ambiguous' as const) : ('fact' as const),
    }));
    return {
      index: c.index,
      start: c.start,
      end: c.end,
      facts,
      questions: [],
      sourceNotes: [],
      evidence: catalog
        .filter((l) => facts.some((f) => f.locatorIds.includes(l.id)))
        .map((l) => ({ id: l.id, rawId: raw.id, chunkIndex: c.index, start: l.start, end: l.end, quote: l.text })),
    };
  });
  const checkpoint: ExtractionCheckpoint = {
    version: 1,
    jobId: randomUUID(),
    rawId: raw.id,
    rawSha256: sha(body),
    pipelineVersion: 'kb02-2',
    rulesVersion: (await loadExtractionRules('rules')).rulesVersion,
    providerIdentity: 'offline',
    chunks: chunks(body).map(({ index, start, end }) => ({ index, start, end })),
    completedChunks,
    attempts: completedChunks.length,
    stage: 'extracting',
    updatedAt: new Date().toISOString(),
    integrity: 'test-memory',
  };
  return { raw, checkpoint };
}

test('PLAN-03/04 all original 106 IDs gain exact context; controlled 14-area plan crosses chunks without moving source facts', async () => {
  const old = (await fixture()).cases[0],
    before = structuredClone(old.checkpoint.completedChunks);
  const f = await runFixture(old, (r) => {
    const p = data(r) as PlanningWire;
    assert.equal(p.facts.length, 81);
    assert.equal(p.questions.length, 25);
    assert.equal(p.sourceContexts.length, 42);
    assert(r.system.includes('不得按chunk分组建页'));
    assert(r.system.includes('不可二选一'));
    for (const s of p.sourceContexts) {
      assert.equal(contextText(p, s), old.raw.body.slice(s.contextStart, s.contextEnd));
      assert.equal(s.id, `s-${s.start}-${s.end}`);
      assert.equal(
        old.raw.body.slice(s.start, s.end),
        p.facts.find((i) => i.sourceId === s.id)?.text ?? p.questions.find((i) => i.sourceId === s.id)?.text,
      );
    }
    // Explicit fixture expectations are test labels, not runtime entity classification.
    return {
      version: 3,
      document: { source_level: 'D', title: '虚构区域统计', main_topic: '各区口径' },
      pages: Array.from({ length: 14 }, (_, n) => {
        const area = String(n + 1).padStart(2, '0');
        return {
          title: '虚构区域' + area,
          type: 'metric',
          category: 'metric',
          factUnitIds: p.factUnits.filter((i) => old.expectedAreas[i.memberIds[0]] === area).map((i) => i.id),
          questionUnitIds: p.questionUnits.filter((i) => old.expectedAreas[i.memberIds[0]] === area).map((i) => i.id),
        };
      }),
    };
  });
  const done = await f.run(),
    payload = data(f.requests[0]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.cp.attempts, 16);
  assert.deepEqual(f.cp.completedChunks, before);
  assert.equal(done.outcome.pages.length, 14);
  assert.equal(
    done.outcome.pages.reduce((n, p) => n + p.source_facts.length, 0),
    81,
  );
  assert.equal(
    done.outcome.pages.reduce((n, p) => n + p.open_questions.length, 0),
    25,
  );
  for (const p of f.cp.plan!.pages) {
    const area = p.title.slice(-2);
    for (const id of [...p.factIds, ...p.questionIds]) assert.equal(old.expectedAreas[id], area);
  }
  assert.equal(
    payload.facts.find((i: any) => i.id === 'f-c1-4').sourceId,
    payload.facts.find((i: any) => i.id === 'f-c2-1').sourceId,
  );
  const qs = payload.questions;
  assert.equal(new Set(qs.map((i: any) => i.text)).size, 1);
  assert.equal(new Set(qs.map((i: any) => i.sourceId)).size, 14);
  for (const p of done.outcome.pages) for (const fact of p.source_facts) assert(!fact.text.includes('排版说明'));
  assert.equal(sha(old.raw.body), old.raw.bodySha256);
});

for (const sequence of [100, 104])
  for (const contract of ['original-v2', 'missing-v3'])
    test(`PLAN-03 seq${sequence} ${contract} remains strict rejection with every original record retained`, async () => {
      const old = (await fixture()).cases.find((c: any) => c.sequence === sequence),
        f = await runFixture(old, (r) =>
          contract === 'original-v2' ? old.response : projectOldOmissions(old, data(r)),
        ),
        before = structuredClone(f.cp.completedChunks);
      await assert.rejects(f.run(), {
        code: contract === 'original-v2' ? 'LLM_SCHEMA_INVALID' : 'LLM_PLAN_COVERAGE_INVALID',
      });
      assert.equal(f.requests.length, 1);
      assert(!f.cp.plan);
      assert.deepEqual(f.cp.completedChunks, before);
      assert.deepEqual(
        coverageDiagnostic(
          old.checkpoint.completedChunks.flatMap((c: any) => c.facts.map((i: any) => i.id)),
          old.checkpoint.completedChunks.flatMap((c: any) => c.questions.map((i: any) => i.id)),
          old.response.pages,
        ),
        old.checkpoint.lastError.diagnostic,
      );
      if (contract === 'missing-v3') {
        const p = data(f.requests[0]),
          bad = projectOldOmissions(old, p);
        assert.deepEqual(
          f.cp.lastError!.diagnostic,
          coverageDiagnostic(
            p.factUnits.map((u: any) => u.id),
            p.questionUnits.map((u: any) => u.id),
            bad.pages.map((page: any) => ({
              title: page.title,
              factIds: page.factUnitIds,
              questionIds: page.questionUnitIds,
            })),
          ),
        );
      }
    });

test('PLAN-03 supplement keeps fact and question at the same source, including ambiguous business boundary', async () => {
  const old = (await fixture()).cases[1],
    f = await runFixture(old),
    done = await f.run(),
    p = data(f.requests[0]);
  const fact = p.facts.find((i: any) => i.id === 'f-c1-2'),
    question = p.questions.find((i: any) => i.id === 'q-c1-1');
  assert.equal(fact.sourceId, question.sourceId);
  assert.equal(fact.kind, 'ambiguous');
  const context = p.sourceContexts.find((s: any) => s.id === fact.sourceId);
  assert(context.factIds.includes(fact.id));
  assert(context.questionIds.includes(question.id));
  assert(done.outcome.pages[0].source_facts.some((i) => i.text === fact.text));
  assert(done.outcome.pages[0].open_questions.includes(question.text));
  assert.equal(done.outcome.pages[0].source_facts.length, 4);
});

test('PLAN-04 fresh extraction through planning uses context only for attribution, without promoting unselected nearby source notes', async () => {
  const source = await synthetic(
    '【资料说明】\n甲桥区域在售门店30家。未选择的来源说明。',
    (t) => t === '甲桥区域在售门店30家。',
  );
  source.checkpoint.completedChunks = [];
  source.checkpoint.attempts = 0;
  const f = await runFixture(source, (r) =>
    r.user.includes('请对下列全部已验证事实规划知识页')
      ? validPlan(data(r))
      : {
          version: 2,
          facts: data(r)
            .filter((a: any) => a.text === '甲桥区域在售门店30家。')
            .map((a: any) => ({ atomId: a.id, kind: 'fact' })),
          questions: [],
          sourceNotes: [],
        },
  );
  const done = await f.run();
  assert.equal(f.requests.length, 2);
  assert.equal(f.cp.attempts, 2);
  const planning = data(f.requests[1]);
  assert(contextText(planning, planning.sourceContexts[0]).includes('未选择的来源说明'));
  assert.deepEqual(
    done.outcome.pages[0].source_facts.map((i) => i.text),
    ['甲桥区域在售门店30家。'],
  );
  assert(!done.outcome.document.summary.includes('未选择'));
  assert.deepEqual(done.outcome.pages[0].ai_organized, []);
  assert.deepEqual(done.outcome.pages[0].ai_inferences, []);
});

test('PLAN-04 exact context windows remain UTF16-safe on both boundaries', async () => {
  const prefix = '😀' + '字'.repeat(254) + '。',
    suffix = '字'.repeat(127) + '😀' + '。',
    body = prefix + '选中事实。' + suffix,
    source = await synthetic(body, (t) => t === '选中事实。'),
    f = await runFixture(source);
  await f.run();
  const planning = data(f.requests[0]),
    s = planning.sourceContexts[0],
    text = contextText(planning, s);
  assert.equal(s.start, 257);
  assert.equal(s.contextStart, 0);
  assert.equal(s.contextEnd, s.end + 129);
  assert.equal(text, body.slice(s.contextStart, s.contextEnd));
  assert(!/^[\uDC00-\uDFFF]/u.test(text));
  assert(!/[\uD800-\uDBFF]$/u.test(text));
});

test('PLAN-04 selected record with unresolved atom position fails before planning callbacks', async () => {
  const source = await synthetic('事实一。');
  source.checkpoint.completedChunks[0].facts[0].atomId = 'c1-a9999';
  const f = await runFixture(source);
  await assert.rejects(f.run(), { code: 'LLM_CHECKPOINT_CORRUPT' });
  assert.equal(f.requests.length, 0);
  assert.equal(f.writes, 0);
});

test('PLAN-04 unselected Raw context known secret rejects before any planning call, ledger or checkpoint write', async () => {
  const secret = 'isolated-context-secret-value',
    prefix =
      '字'.repeat(380) + secret + '。' + '字'.repeat(511 - 380 - secret.length - 1) + '\n' + '字'.repeat(87) + '\n',
    body = prefix + '选中事实。';
  assert.equal(prefix.length, 600);
  const source = await synthetic(body, (t) => t === '选中事实。');
  assert(!JSON.stringify(source.checkpoint).includes(secret));
  const f = await runFixture(source, undefined, [secret]),
    before = structuredClone(f.cp);
  await assert.rejects(f.run(), { code: 'LLM_OUTPUT_CONTAINS_SECRET' });
  assert.equal(f.requests.length, 0);
  assert.equal(f.writes, 0);
  assert.deepEqual(f.cp, before);
});

test('PLAN-04 complete context payload exceeding 192KiB stops before Provider and preserves extracted chunks', async () => {
  const body = Array.from({ length: 90 }, (_, i) => `记录${i}：${'量'.repeat(300)}。`).join(''),
    source = await synthetic(body),
    f = await runFixture(source),
    before = structuredClone(f.cp);
  assert(
    Buffer.byteLength(JSON.stringify(buildKnowledgePlanningInput(body, f.cp.completedChunks, catalogs(body)))) >
      192 * 1024,
  );
  await assert.rejects(f.run(), { code: 'LLM_PLANNING_TOO_LARGE' });
  assert.equal(f.requests.length, 0);
  assert.equal(f.writes, 0);
  assert.deepEqual(f.cp, before);
});

test('PLAN-04 explicit coverage feedback counts toward the complete 192KiB limit', async () => {
  const source = await synthetic('选中事实。'),
    diagnostic = coverageDiagnostic(
      ['f-c1-1'],
      [],
      [
        {
          title: '坏响应',
          factIds: Array.from({ length: 4096 }, (_, i) => 'f-' + String(i).padStart(60, '0')),
          questionIds: [],
        },
      ],
    );
  source.checkpoint.lastError = {
    code: 'LLM_PLAN_COVERAGE_INVALID',
    message: '离线合法覆盖诊断',
    at: new Date().toISOString(),
    diagnostic,
  };
  const f = await runFixture(source),
    before = structuredClone(f.cp);
  assert(
    Buffer.byteLength(
      JSON.stringify(buildKnowledgePlanningInput(source.raw.body, f.cp.completedChunks, catalogs(source.raw.body))),
    ) <
      192 * 1024,
  );
  await assert.rejects(f.run(true), { code: 'LLM_PLANNING_TOO_LARGE' });
  assert.equal(f.requests.length, 0);
  assert.equal(f.writes, 0);
  assert.deepEqual(f.cp, before);
});

test('PLAN-03 explicit planning retry retains all source context, diagnostics and cumulative attempts', async () => {
  const old = (await fixture()).cases[1];
  let bad = true;
  const f = await runFixture(old, (r) => (bad ? projectOldFailure(old.response, data(r)) : validPlan(data(r))));
  await assert.rejects(f.run(), { code: 'LLM_PLAN_COVERAGE_INVALID' });
  const before = structuredClone(f.cp.completedChunks),
    attempts = f.cp.attempts;
  bad = false;
  const done = await f.run(true);
  assert.equal(f.cp.attempts, attempts + 1);
  assert.equal(done.outcome.callCount, attempts + 1);
  assert.deepEqual(f.cp.completedChunks, before);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(data(f.requests[1]).sourceContexts, data(f.requests[0]).sourceContexts);
  assert.deepEqual(data(f.requests[1]).coverageFeedback.facts.missing, [
    data(f.requests[1]).factUnits.find((u: any) => u.memberIds.includes('f-c1-2')).id,
  ]);
});

test('PLAN revision6 original checkpoint HTTP409 preserves job/cp/raw state; explicit restart does not reuse old chunks', async () => {
  const old = (await fixture()).cases[0],
    f = await storageFixture(),
    h = await storageHttp(f);
  let restart = '';
  let release = () => {};
  try {
    const raw = await f.rawStore.create({
        title: '虚构旧规划',
        sourceType: 'report',
        sourceName: '隔离',
        tags: [],
        body: old.raw.body,
      }),
      store = new ExtractionCheckpointStore(f.root),
      cp = {
        ...structuredClone(old.checkpoint),
        rawId: raw.id,
        jobId: randomUUID(),
        providerIdentity: 'fake|budget-model',
      };
    for (const c of cp.completedChunks) for (const e of c.evidence) e.rawId = raw.id;
    await store.save(cp);
    const now = new Date().toISOString();
    await f.jobs.insert({
      id: cp.jobId,
      rawId: raw.id,
      status: 'failed',
      stage: 'planning',
      chunksTotal: 14,
      chunksDone: 14,
      pagesFound: 0,
      provider: { name: f.provider.name, model: f.provider.model },
      error: { ...cp.lastError, retryable: true },
      cancelRequested: false,
      callCount: 15,
      pipelineVersion: 'kb02-2',
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
    });
    await f.rawStates.set(raw.id, { status: 'failed', jobId: cp.jobId, reason: '隔离旧规划' });
    const files = [
        path.join(f.root, 'state/extraction-checkpoints', cp.jobId + '.json'),
        path.join(f.root, 'state/extraction-jobs', cp.jobId + '.json'),
        path.join(f.root, 'state/raw-processing', raw.id + '.json'),
      ],
      before = await Promise.all(files.map((p) => readFile(p)));
    for (const options of [{}, { planningRetry: true }, {}]) {
      const r = await h.request(`/api/raw/${raw.id}/extract`, options);
      assert.equal(r.status, 409);
      assert.equal(r.json.error.code, 'LLM_CHECKPOINT_INCOMPATIBLE');
      assert.deepEqual(await Promise.all(files.map((p) => readFile(p))), before);
      assert.equal(f.requests.length, 0);
    }
    let seen = false;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.setHook(async () => {
      seen = true;
      await hold;
    });
    const r = await h.request(`/api/raw/${raw.id}/extract`, { restart: true });
    assert.equal(r.status, 202);
    restart = r.json.jobId;
    assert.notEqual(restart, cp.jobId);
    for (let n = 0; n < 200 && !seen; n++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert(seen);
    const fresh = await store.get(restart);
    assert.equal(fresh!.completedChunks.length, 0);
    assert.equal(fresh!.attempts, 1);
    assert.equal(fresh!.rulesVersion, (await loadExtractionRules('rules')).rulesVersion);
    await f.runner.cancel(restart);
    release();
    await f.runner.waitForSettlement(restart);
    assert.deepEqual(await readFile(files[0]), before[0]);
    assert.equal(f.requests.length, 1);
  } finally {
    release();
    if (restart) await f.runner.waitForSettlement(restart);
    await h.close();
    await f.clean();
  }
});

test('PLAN completed revision6 draft remains HTTP-readable and reused with zero Provider increment', async () => {
  const old = (await fixture()).cases[0],
    f = await storageFixture(),
    h = await storageHttp(f);
  try {
    f.succeed();
    const job = await f.wait((await f.start()).job.id);
    assert.equal(job.status, 'completed');
    const p = path.join(f.root, 'drafts', job.draftId + '.json'),
      draft = JSON.parse(await readFile(p, 'utf8'));
    draft.rulesVersion = old.checkpoint.rulesVersion + '-kb02-2';
    await writeFile(p, JSON.stringify(draft));
    const before = await readFile(p),
      calls = f.requests.length;
    const read = await h.request('/api/drafts/' + draft.id);
    assert.equal(read.status, 200);
    assert.equal(read.json.rulesVersion, draft.rulesVersion);
    const start = await h.request(`/api/raw/${f.raw.id}/extract`, {});
    assert.equal(start.status, 200);
    assert.equal(start.json.jobId, job.id);
    assert.equal(f.requests.length, calls);
    assert.deepEqual(await readFile(p), before);
  } finally {
    await h.close();
    await f.clean();
  }
});
