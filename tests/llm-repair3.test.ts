import os from 'node:os';
import { reviewSelectedChanges } from './support/compat01-draft-review.ts'; // B04 第三次返修专项测试（B04-recheck2-fix-card 的 F04-11 残留）：
// 聚合不得与各分块快照共享可变状态；真实额外汇总请求必须对每条事实引用给出
// 可解析的 Raw 来源、原文 quote 与全局 UTF-16 start/end（有/无 Provider 位置 hint 两种输入）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RawStore } from '../services/raw/store.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';
import { WikiCommitService } from '../services/wiki/commits.ts';
import { LLMService } from '../services/llm/service.ts';
import { ExtractionJobStore, ExtractionRunner } from '../services/llm/jobs.ts';
import { OpenAiCompatibleProvider } from '../services/llm/provider.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { validateRaw } from '../server/validation.ts';
import {
  buildPayloadForChunk,
  chunkFromPrompt,
  contentOf,
  isPlanningPrompt,
  planningPayloadFromPrompt,
  rawIdFromPrompt,
  startFakeProvider,
  type FakeProvider,
} from './support/fake-llm.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = path.join(root, 'rules');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MARKERS = ['返修三-甲', '返修三-乙', '返修三-丙', '返修三-丁'];
const MERGE_EVIDENCE = path.join(os.tmpdir(), `KB02-R1-builder-merge-${process.pid}.json`);

/** Records the real merge payload the product sent (test data only — never a key). */
async function recordMergeEvidence(label: string, payload: unknown, summary: Record<string, unknown>) {
  await mkdir(path.dirname(MERGE_EVIDENCE), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(MERGE_EVIDENCE, 'utf8')) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  existing[label] = { recordedAt: new Date().toISOString(), summary, payload };
  await writeFile(MERGE_EVIDENCE, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

async function setup(configure: (fake: FakeProvider) => void = () => undefined) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), '.test-b04-repair3-'));
  const rawStore = new RawStore(dataRoot);
  await rawStore.initialize();
  const wikiStore = new WikiStore(dataRoot, rawStore, rulesDir);
  await wikiStore.initialize();
  const rawStates = new RawStateStore(dataRoot);
  const drafts = new DraftStore(dataRoot);
  const jobs = new ExtractionJobStore(dataRoot);
  const commits = new WikiCommitService({ root: dataRoot, wikiStore, drafts, rawStates, rawStore });
  await Promise.all([rawStates.initialize(), drafts.initialize(), jobs.initialize(), commits.initialize()]);
  const fake = await startFakeProvider((request) => {
    const chunk = chunkFromPrompt(request.user);
    return {
      kind: 'content',
      content: contentOf(
        buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: `主题${chunk.index + 1}` }]),
      ),
    };
  });
  configure(fake);
  const provider = new OpenAiCompatibleProvider({
    baseUrl: fake.url,
    model: 'fake-model',
    apiKey: 'test-key',
    source: 'env',
  });
  const draftRules = async () => {
    const bundle = await loadExtractionRules(rulesDir);
    return {
      types: (bundle.schema.properties?.suggested_pages?.items?.properties?.type?.enum ?? []) as string[],
      categories: (bundle.schema.properties?.suggested_pages?.items?.properties?.category?.enum ?? []) as string[],
      knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [],
      confidence: bundle.fmcg.enums?.confidence ?? [],
      source_level: bundle.fmcg.enums?.source_level ?? [],
      review_status: bundle.fmcg.enums?.review_status ?? [],
    };
  };
  const runner = new ExtractionRunner({
    root: dataRoot,
    llm: new LLMService(rulesDir),
    jobs,
    drafts,
    rawStates,
    rawStore,
    provider: () => provider,
    rulesDir,
    draftRules,
  });
  const createRaw = async (body: string, title = '渠道动销资料') =>
    rawStore.create(validateRaw({ title, sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body }));
  const waitForJob = async (jobId: string, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await jobs.get(jobId);
      if (job && job.status !== 'running') return job;
      if (Date.now() > deadline) throw new Error(`job ${jobId} 未在 ${timeoutMs} ms 内结束`);
      await delay(20);
    }
  };
  const extract = async (rawId: string) => {
    const started = await runner.start(rawId, { newJobId: randomUUID(), now: new Date().toISOString() });
    const finished = await waitForJob(started.job.id);
    const draft = finished.draftId ? await drafts.get(finished.draftId) : undefined;
    return { finished, draft };
  };
  return {
    dataRoot,
    rawStore,
    wikiStore,
    rawStates,
    drafts,
    jobs,
    commits,
    runner,
    fake,
    createRaw,
    extract,
    waitForJob,
    clean: async () => {
      await fake.close();
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rm(dataRoot, { recursive: true, force: true });
          return;
        } catch {
          await delay(150);
        }
      }
    },
  };
}

/** 四块、标题相同、每块证据 id 都是 e1、quote 各为全篇唯一原文；四块摘要不同以触发汇总。 */
function longBody(segmentChars = 7600) {
  const filler = '渠道库存周转与动销分析：门店补货节奏、经销商库存水位、SKU 宽度与陈列面。\r\n';
  return MARKERS.map((marker) => {
    let text = `${marker}：本段独有内容，全篇只出现一次。`;
    while (text.length < segmentChars) text += filler;
    return text;
  }).join('');
}

const sameTitleSpec = (omitOffsets: boolean) => (chunk: { index: number }) => [
  {
    title: '同标题指标',
    type: 'metric' as const,
    category: 'metric',
    one_line_definition: `第 ${chunk.index + 1} 段的定义`,
    quoteText: MARKERS[chunk.index] ?? MARKERS[0],
    factText: `第 ${chunk.index + 1} 段的独有事实`,
    omitOffsets,
  },
];

function assertPlanningPayloadComplete(
  payload: { facts: Array<{ id: string; text: string }>; questions: Array<{ id: string; text: string }> },
  draft: {
    pages: Array<{
      source_facts: Array<{ text: string; evidenceIds: string[] }>;
      source_evidence: Array<{ id: string; rawId: string; quote: string; start: number; end: number }>;
      provenance: Array<{ end: number }>;
    }>;
  },
  body: string,
  rawId: string,
) {
  assert.equal(new Set(payload.facts.map((fact) => fact.id)).size, payload.facts.length, '规划事实ID唯一');
  assert.equal(
    new Set(payload.questions.map((question) => question.id)).size,
    payload.questions.length,
    '规划问题ID唯一',
  );
  assert.doesNotMatch(JSON.stringify(payload), /locatorId|source_evidence|quote/, '规划载荷只含事实/问题ID与文本');
  assert.deepEqual(
    draft.pages.flatMap((page) => page.source_facts.map((fact) => fact.text)).sort(),
    payload.facts.map((fact) => fact.text).sort(),
    '最终页面必须将规划的全部事实恰好组装一次',
  );
  for (const page of draft.pages)
    for (const fact of page.source_facts) {
      assert.ok(fact.evidenceIds.length > 0);
      for (const id of fact.evidenceIds) {
        const evidence = page.source_evidence.find((item) => item.id === id);
        assert.ok(evidence, '事实locator必须能解析到最终证据');
        assert.equal(evidence?.rawId, rawId);
        assert.equal(body.slice(evidence!.start, evidence!.end), evidence!.quote);
      }
    }
  const lastCoverage = draft.pages.flatMap((page) => page.provenance).reduce((max, item) => Math.max(max, item.end), 0);
  assert.ok(lastCoverage >= body.length - 1, '全篇分块覆盖不得丢尾');
}
for (const omitOffsets of [false, true]) {
  const label = omitOffsets ? '无位置hint' : '有位置hint';
  test(`F04-11 残留（${label}）：同标题/同证据ID跨块聚合后，额外汇总输入全块引用零 unresolved`, async () => {
    const body = longBody();
    const context = await setup((fake) => {
      fake.setHandler((request) => {
        const chunk = chunkFromPrompt(request.user);
        return {
          kind: 'content',
          content: contentOf(
            buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), sameTitleSpec(omitOffsets)(chunk)),
          ),
        };
      });
    });
    try {
      const raw = await context.createRaw(body, `同标题四块-${label}`);
      const { finished, draft } = await context.extract(raw.id);
      assert.equal(finished.status, 'completed', finished.error?.message ?? '');
      assert.ok(draft, '必须生成草稿');
      assert.equal(draft?.extraction.chunkCount, 4, '长文必须切成四块');
      assert.equal(finished.callCount, 6, '四块各一次调用 + 一次规划和一次维护，人审不外发');
      // 真实汇总请求必须存在且输入完整。
      const mergeRequests = context.fake.requests.filter((request) => isPlanningPrompt(request.user));
      assert.equal(mergeRequests.length, 1, '四块事实完成后必须进行一次整篇规划');
      const payload = planningPayloadFromPrompt(mergeRequests[0].user);
      assert.equal(payload.facts.length, 4, '规划输入必须覆盖全部四块事实');
      assert.equal(
        payload.facts.length,
        draft.pages.reduce((sum, page) => sum + page.source_facts.length, 0),
      );
      assertPlanningPayloadComplete(payload, draft!, body, raw.id);
      await recordMergeEvidence(label, payload, {
        chunkCount: draft?.extraction.chunkCount,
        callCount: finished.callCount,
        pageCount: draft?.pages.length,
        factCount: payload.facts.length,
        questionCount: payload.questions.length,
        plannerContainsEvidence: false,
        maxConcurrent: context.fake.maxConcurrent,
        rawSha256: raw.bodySha256,
        rawBodySha256Matches: (await context.rawStore.get(raw.id))?.body === body,
      });
      // 聚合后的最终草稿：证据 ID 唯一、事实引用有效、尾部覆盖。
      assert.equal(draft?.pages.length, 1, '同标题四块聚合为一条建议');
      const page = draft?.pages[0];
      assert.ok(page);
      const ids = page?.source_evidence.map((evidence) => evidence.id) ?? [];
      assert.equal(new Set(ids).size, ids.length, '证据 ID 必须唯一');
      assert.ok(ids.length >= 4, `四块证据都应保留，实际 ${JSON.stringify(ids)}`);
      for (let index = 1; index <= 4; index++)
        assert.ok(
          ids.some((id) => id.startsWith(`c${index}-l`)),
          `第 ${index} 块 locator 必须保留且可解析，实际 ${JSON.stringify(ids)}`,
        );
      for (const fact of page?.source_facts ?? []) {
        assert.ok(fact.evidenceIds.length >= 1);
        for (const id of fact.evidenceIds) {
          const evidence = page?.source_evidence.find((item) => item.id === id);
          assert.ok(evidence, `事实引用 ${id} 必须可解析`);
          assert.equal(body.slice(evidence?.start, evidence?.end), evidence?.quote);
        }
      }
      assert.equal(page?.source_facts.length, 4, '四块各一条事实都必须保留');
      const lastCoverage = (page?.provenance ?? []).reduce((max, entry) => Math.max(max, entry.end), 0);
      assert.ok(lastCoverage >= body.length - 1, '分块必须覆盖到原文末尾');
      // 并发 ≤2、Raw 不变。
      assert.equal(context.fake.maxConcurrent <= 2, true, `并发调用不得超过 2，实际 ${context.fake.maxConcurrent}`);
      const stored = await context.rawStore.get(raw.id);
      assert.equal(stored?.body, body, 'Raw 原文不得被改写');
    } finally {
      await context.clean();
    }
  });
}

test('F04-11 残留（对照）：无重复标题时汇总输入同样完整，单块不触发汇总', async () => {
  const body = longBody();
  const context = await setup((fake) => {
    fake.setHandler((request) => {
      const chunk = chunkFromPrompt(request.user);
      const marker = MARKERS[chunk.index] ?? MARKERS[0];
      // 长文用全篇唯一的标记做引文；短文没有标记，回落到段首引文。
      const spec = chunk.text.includes(marker)
        ? { title: `独有主题-${chunk.index + 1}`, quoteText: marker, omitOffsets: true }
        : { title: `独有主题-${chunk.index + 1}` };
      return {
        kind: 'content',
        content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [spec])),
      };
    });
  });
  try {
    const raw = await context.createRaw(body, '无重复标题四块');
    const { draft } = await context.extract(raw.id);
    assert.equal(draft?.extraction.chunkCount, 4);
    assert.equal(draft?.pages.length, 4, '四个不同标题必须保留四条建议');
    const mergeRequests = context.fake.requests.filter((request) => isPlanningPrompt(request.user));
    assert.equal(mergeRequests.length, 1);
    assertPlanningPayloadComplete(planningPayloadFromPrompt(mergeRequests[0].user), draft!, body, raw.id);
    // 单块（≤8000 字符）不触发额外汇总，草稿正常。
    const short = await context.createRaw('单块短文：渠道动销与库存周转。', '单块短文');
    const single = await context.extract(short.id);
    assert.equal(single.finished.status, 'completed');
    assert.equal(single.finished.chunksTotal, 1, '短文只有一块');
    const shortMerge = context.fake.requests.filter((request) => isPlanningPrompt(request.user));
    assert.equal(shortMerge.length, 2, '单块也必须有一次提取与一次全篇规划');
    assert.equal(single.draft?.pages.length, 1);
    assert.equal(single.draft?.pages[0].source_evidence[0].quote, '单块短文：渠道动销与库存周转。'.slice(0, 16));
  } finally {
    await context.clean();
  }
});

test('F04-11 残留（回归）：聚合后的清单可直接确认，页面正文含全部块的事实与证据', async () => {
  const body = longBody();
  const context = await setup((fake) => {
    fake.setHandler((request) => {
      const chunk = chunkFromPrompt(request.user);
      return {
        kind: 'content',
        content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), sameTitleSpec(false)(chunk))),
      };
    });
  });
  try {
    const raw = await context.createRaw(body, '聚合后确认');
    const { draft } = await context.extract(raw.id);
    assert.ok(draft);
    const page = draft.pages[0];
    const reviewed = await reviewSelectedChanges(context.drafts, draft, [page.pageId]);
    const outcome = await context.wikiStore.withLock(() =>
      context.commits.confirm({
        draftId: draft.id,
        baseRevision: reviewed.revision,
        selectedPageIds: [page.pageId],
        idempotencyKey: 'repair3-key',
        operationId: randomUUID(),
        now: new Date().toISOString(),
      }),
    );
    assert.equal(outcome.manifest.status, 'completed');
    const written = await context.wikiStore.get(outcome.manifest.snapshot.pageRecords[0].id);
    assert.ok(written);
    for (const marker of MARKERS) {
      assert.ok(written?.body.includes(marker), `正式页必须包含 ${marker} 的证据引文`);
    }
    assert.equal(
      (await readFile(path.join(context.dataRoot, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean).length,
      2,
    );
  } finally {
    await context.clean();
  }
});
