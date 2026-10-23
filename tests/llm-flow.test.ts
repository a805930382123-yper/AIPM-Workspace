import {addLegacyReviewPrecondition} from './support/human-review.ts';
// B04 service-level closed loop: extraction → draft → review edits → confirmed commit, plus
// failure, cancel, idempotency and recovery behaviour. The provider is a real HTTP server
// (tests/support/fake-llm.ts) reached through the real OpenAI-compatible adapter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
import { getStats } from '../services/stats/index.ts';
import { validateRaw } from '../server/validation.ts';
import { buildPayloadForChunk, chunkFromPrompt, contentOf, planningPayloadFromPrompt, rawIdFromPrompt, startFakeProvider, type FakeProvider } from './support/fake-llm.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = path.join(root, 'rules');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TOPICS = [
  '渠道动销：动销率衡量门店实际销售速度，需要与库存水位一起看。',
  '经销商库存周转：库存周转天数反映资金占用，补货节奏影响周转。',
  '门店补货：安全库存与补货周期共同决定缺货风险。',
];

async function setup(configure: (fake: FakeProvider) => void = () => undefined) {
  const dataRoot = await mkdtemp(path.join(process.cwd(), '.test-b04-flow-'));
  const rawStore = new RawStore(dataRoot);
  await rawStore.initialize();
  const wikiStore = new WikiStore(dataRoot, rawStore, rulesDir);
  await wikiStore.initialize();
  const rawStates = new RawStateStore(dataRoot);
  const drafts = new DraftStore(dataRoot);
  const jobs = new ExtractionJobStore(dataRoot);
  const commits = new WikiCommitService({ root: dataRoot, wikiStore, drafts, rawStates, rawStore });
  await Promise.all([rawStates.initialize(), drafts.initialize(), jobs.initialize(), commits.initialize()]);
  addLegacyReviewPrecondition(commits,drafts,rawStore);
  const fake = await startFakeProvider(request => {
    const chunk = chunkFromPrompt(request.user);
    const rawId = rawIdFromPrompt(request.user);
    return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawId, [
      { title: `主题${chunk.index + 1}A`, addInference: chunk.index % 2 === 0 },
      { title: `主题${chunk.index + 1}B`, type: 'metric', category: 'metric' },
    ])) };
  });
  configure(fake);
  const provider = new OpenAiCompatibleProvider({ baseUrl: fake.url, model: 'fake-model', apiKey: 'test-key', source: 'env' });
  const llm = new LLMService(rulesDir);
  const runner = new ExtractionRunner({
    root: dataRoot, llm, jobs, drafts, rawStates, rawStore, provider: () => provider, rulesDir,
    draftRules: async () => {
      const bundle = await loadExtractionRules(rulesDir);
      return {
        types: (bundle.schema.properties?.suggested_pages?.items?.properties?.type?.enum ?? []) as string[],
        categories: (bundle.schema.properties?.suggested_pages?.items?.properties?.category?.enum ?? []) as string[],
        knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [],
        confidence: bundle.fmcg.enums?.confidence ?? [],
        source_level: bundle.fmcg.enums?.source_level ?? [],
        review_status: bundle.fmcg.enums?.review_status ?? [],
      };
    },
  });
  const createRaw = async (body: string, title = '渠道动销资料') => rawStore.create(validateRaw({ title, sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body }));
  /** Writes a Raw directly, bypassing the API body limit: simulates a legacy/hand-placed file. */
  const createRawUnchecked = async (body: string, title: string) => rawStore.create({ title, sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body });
  const wikiFiles = async () => (await readdir(path.join(dataRoot, 'knowledge', 'wiki'))).filter(name => name !== 'index.md' && name.endsWith('.md')).sort();
  const logLines = async () => (await readFile(path.join(dataRoot, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { operationId?: string; id: string; action: string });
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
    const started = await runner.start(rawId, { newJobId: crypto.randomUUID(), now: new Date().toISOString() });
    return { ...started, finished: await waitForJob(started.job.id) };
  };
  return {
    dataRoot, rawStore, wikiStore, rawStates, drafts, jobs, commits, runner, fake, createRaw, createRawUnchecked, wikiFiles, logLines, waitForJob, extract,
    clean: async () => { await fake.close(); await rm(dataRoot, { recursive: true, force: true }); },
  };
}

test('E04-02/03/04 成功链路：草稿零正式写入，确认只写选中项并生成 Source+Index+Log', async () => {
  const context = await setup();
  try {
    const raw = await context.createRaw(`${TOPICS[0]}\n\n${TOPICS[1]}\n\n${TOPICS[2]}`);
    const rawFile = path.join(context.dataRoot, 'knowledge', 'raw', 'articles', `${raw.id}.md`);
    const rawHashBefore = sha(await readFile(rawFile));
    const started = await context.extract(raw.id);
    assert.equal(started.finished.status, 'completed');
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft, '必须生成草稿');
    assert.equal(draft.status, 'pending_confirmation');
    assert.equal(draft.rawId, raw.id);
    assert.equal(draft.revision, 1);
    assert.ok(draft.pages.length >= 2);
    for (const page of draft.pages) {
      assert.ok(page.source_evidence.length >= 1);
      for (const evidence of page.source_evidence) {
        assert.equal(raw.body.slice(evidence.start, evidence.end), evidence.quote, '证据必须与原文一致');
      }
    }
    assert.equal((await context.rawStates.get(raw.id)).status, 'pending_confirmation');
    const plannerRequest = context.fake.requests.find(request => request.user.includes('请对下列全部已验证事实规划知识页'));
    assert.ok(plannerRequest, '整篇规划必须实际调用Provider');
    assert.match(plannerRequest.system, /factIds/);
    assert.match(plannerRequest.system, /不得遗漏、重复、添加未知ID/);
    assert.match(plannerRequest.system, /industry_basics/);
    assert.equal(context.fake.requests.every(request => request.authorization === 'Bearer test-key'), true);

    // Nothing formal may exist before the user confirms.
    assert.deepEqual(await context.wikiFiles(), []);
    assert.deepEqual(await context.logLines(), []);
    assert.equal((await getStats(context.dataRoot, context.rawStore)).pendingConfirmationCount, 1);

    const selected = draft.pages.slice(0, 2);
    const result = await context.wikiStore.withLock(() => context.commits.confirm({
      draftId: draft.id, baseRevision: draft.revision, selectedPageIds: selected.map(page => page.pageId),
      idempotencyKey: 'flow-key-1', operationId: crypto.randomUUID(), now: new Date().toISOString(),
    }));
    assert.equal(result.manifest.status, 'completed');
    assert.equal(result.reused, false);
    const written = await context.wikiFiles();
    assert.equal(written.length, 3, `应写入 1 个 Source + 2 个选中页，实际 ${written.length}`);
    assert.equal(written.includes(`${result.manifest.snapshot.pageRecords[0].id}.md`), true);
    // The unselected suggestion must not exist on disk under any id.
    const unselectedTitle = draft.pages[2]?.title;
    if (unselectedTitle) {
      for (const file of written) {
        const content = await readFile(path.join(context.dataRoot, 'knowledge', 'wiki', file), 'utf8');
        assert.equal(content.includes(unselectedTitle), false, '未选中的建议不得落盘');
      }
    }
    const log = await context.logLines();
    assert.equal(log.length, 3);
    assert.deepEqual([...new Set(log.map(line => line.operationId))], [result.manifest.operationId], '同一操作共用一个 operationId');
    const sourceFile = await context.wikiStore.get(result.manifest.snapshot.sourceRecord?.id as string);
    assert.ok(sourceFile);
    assert.deepEqual(sourceFile.sources, [raw.id]);
    assert.match(sourceFile.body, /## 摘要/);
    const pageFile = await context.wikiStore.get(result.manifest.snapshot.pageRecords[0].id);
    assert.match(pageFile?.body ?? '', /## 来源事实/);
    assert.match(pageFile?.body ?? '', /## AI 推断|## AI 整理/);
    assert.match(pageFile?.body ?? '', new RegExp(`\\[\\[${sourceFile.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`), '页面必须链回 Source');
    const afterDraft = await context.drafts.get(draft.id);
    assert.equal(afterDraft?.status, 'confirmed');
    const afterState = await context.rawStates.get(raw.id);
    assert.equal(afterState.status, 'generated');
    assert.deepEqual(afterState.generatedWikiIds?.length, 3);
    assert.equal(sha(await readFile(rawFile)), rawHashBefore, 'Raw 文件必须逐字节不变');
    assert.equal((await getStats(context.dataRoot, context.rawStore)).pendingConfirmationCount, 0);
  } finally { await context.clean(); }
});

test('E04-04 复用既有 Source：只新增选中页，既有 Source 文件不变', async () => {
  const context = await setup();
  try {
    const raw = await context.createRaw(`${TOPICS[0]}\n\n${TOPICS[1]}`);
    const existing = await context.wikiStore.create({
      title: '既有来源摘要', type: 'source', category: 'other', sources: [raw.id], tags: [], aliases: [],
      knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'reviewed', body: '## 摘要\n\n人工建好的来源摘要。\n',
    });
    const existingFile = path.join(context.dataRoot, 'knowledge', 'wiki', `${existing.id}.md`);
    const existingHash = sha(await readFile(existingFile));
    const started = await context.extract(raw.id);
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft, started.finished.error?.message ?? '新知识草稿必须存在');
    const result = await context.wikiStore.withLock(() => context.commits.confirm({
      draftId: draft.id, baseRevision: draft.revision, selectedPageIds: draft.pages.map(page => page.pageId),
      idempotencyKey: 'reuse-key', operationId: crypto.randomUUID(), now: new Date().toISOString(),
    }));
    assert.equal(result.sourceReused, true);
    assert.equal(result.manifest.snapshot.reuseSourceId, existing.id);
    assert.equal(result.manifest.snapshot.sourceRecord, undefined, '复用时不写 Source');
    assert.equal(sha(await readFile(existingFile)), existingHash, '既有 Source 必须逐字节不变');
    assert.equal((await context.wikiFiles()).length, 1 + draft.pages.length);
  } finally { await context.clean(); }
});

test('E04-05 幂等：同 payload 任意 key 复用同一操作，payload 变化 409，并发确认只产生一份', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const rawId = rawIdFromPrompt(request.user);
      // Titles must be unique per Raw, otherwise a second draft would (correctly) hit the
      // existing-title conflict instead of exercising the idempotency path.
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawId, [{ title: `概念-${rawId.slice(0, 8)}` }, { title: `指标-${rawId.slice(0, 8)}` }])) };
    });
  });
  try {
    const raw = await context.createRaw(`${TOPICS[0]}\n\n${TOPICS[1]}`);
    const started = await context.extract(raw.id);
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft);
    const ids = draft.pages.map(page => page.pageId);
    const first = await context.wikiStore.withLock(() => context.commits.confirm({
      draftId: draft.id, baseRevision: draft.revision, selectedPageIds: ids, idempotencyKey: 'same-key',
      operationId: crypto.randomUUID(), now: new Date().toISOString(),
    }));
    const filesAfterFirst = await context.wikiFiles();
    const retry = await context.wikiStore.withLock(() => context.commits.confirm({
      draftId: draft.id, baseRevision: draft.revision, selectedPageIds: ids, idempotencyKey: 'same-key',
      operationId: crypto.randomUUID(), now: new Date().toISOString(),
    }));
    assert.equal(retry.manifest.operationId, first.manifest.operationId, '重试必须复用同一 operationId');
    assert.equal(retry.reused, true);
    assert.deepEqual(await context.wikiFiles(), filesAfterFirst, '重试不得新增页面');
    assert.equal((await context.logLines()).length, filesAfterFirst.length, '重试不得重复写日志');

    // F04-04: the frozen payload decides the retry semantics — the same payload reuses the
    // operation even under a different key.
    const otherKey = await context.wikiStore.withLock(() => context.commits.confirm({
      draftId: draft.id, baseRevision: draft.revision, selectedPageIds: ids, idempotencyKey: 'other-key',
      operationId: crypto.randomUUID(), now: new Date().toISOString(),
    }));
    assert.equal(otherKey.reused, true, '不同 key 但相同 payload 必须复用原操作');
    assert.equal(otherKey.manifest.operationId, first.manifest.operationId);
    assert.deepEqual(await context.wikiFiles(), filesAfterFirst, '不同 key 的相同 payload 不得新增页面');

    // Same key with a different payload (subset selection) must be rejected, not silently reused.
    const changedPayload = await (async () => {
      try {
        await context.wikiStore.withLock(() => context.commits.confirm({
          draftId: draft.id, baseRevision: draft.revision, selectedPageIds: ids.slice(0, 1), idempotencyKey: 'same-key',
          operationId: crypto.randomUUID(), now: new Date().toISOString(),
        }));
      } catch (error) { return error as { code: string; status: number }; }
      return undefined;
    })();
    assert.equal(changedPayload?.code, 'IDEMPOTENCY_KEY_MISMATCH', '同 key 不同 payload 必须 409');
    assert.equal(changedPayload?.status, 409);
    const changedPayloadOtherKey = await (async () => {
      try {
        await context.wikiStore.withLock(() => context.commits.confirm({
          draftId: draft.id, baseRevision: draft.revision, selectedPageIds: ids.slice(0, 1), idempotencyKey: 'third-key',
          operationId: crypto.randomUUID(), now: new Date().toISOString(),
        }));
      } catch (error) { return error as { code: string; status: number }; }
      return undefined;
    })();
    assert.equal(changedPayloadOtherKey?.code, 'CONFIRM_PAYLOAD_CHANGED', '不同 key 且不同 payload 也必须 409');
    assert.deepEqual(await context.wikiFiles(), filesAfterFirst, '被拒绝的确认不得改动正式文件');

    // Concurrent double click on a fresh draft: exactly one operation, one set of pages.
    const raw2 = await context.createRaw(`${TOPICS[2]}\n\n${TOPICS[0]}`, '并发确认资料');
    const second = await context.extract(raw2.id);
    const draft2 = await context.drafts.get(second.finished.draftId as string);
    assert.ok(draft2);
    const key = 'concurrent-key';
    const run = () => context.wikiStore.withLock(() => context.commits.confirm({
      draftId: draft2.id, baseRevision: draft2.revision, selectedPageIds: draft2.pages.map(page => page.pageId),
      idempotencyKey: key, operationId: crypto.randomUUID(), now: new Date().toISOString(),
    })).then(value => ({ value }), error => ({ error: error as { code: string } }));
    const [a, b] = await Promise.all([run(), run()]);
    const successes = [a, b].filter(entry => 'value' in entry);
    assert.equal(successes.length >= 1, true, JSON.stringify([a, b].map(entry => 'error' in entry ? { code: entry.error.code, message: (entry.error as { message?: string }).message } : 'ok')));
    const operationIds = new Set(successes.map(entry => ('value' in entry ? entry.value.manifest.operationId : '')));
    assert.equal(operationIds.size, 1, '并发确认只能有一个 operationId');
    const pagesTotal = (await context.wikiFiles()).length;
    assert.equal(pagesTotal, filesAfterFirst.length + 1 + draft2.pages.length, '并发确认不得重复创建页面');
    const logAfterConcurrent = await context.logLines();
    assert.equal(logAfterConcurrent.filter(line => line.operationId === [...operationIds][0]).length, draft2.pages.length + 1);
  } finally { await context.clean(); }
});

test('E04-07 Index/Log 写入失败：如实报告部分提交，重启补齐同一操作且不重复页面', async () => {
  const context = await setup();
  try {
    const raw = await context.createRaw(`${TOPICS[0]}\n\n${TOPICS[1]}`, 'Index 故障资料');
    const started = await context.extract(raw.id);
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft);
    const indexFile = path.join(context.dataRoot, 'knowledge', 'wiki', 'index.md');
    await rm(indexFile, { force: true });
    await mkdir(indexFile);
    const failure = await (async () => {
      try {
        await context.wikiStore.withLock(() => context.commits.confirm({
          draftId: draft.id, baseRevision: draft.revision, selectedPageIds: draft.pages.map(page => page.pageId),
          idempotencyKey: 'index-failure', operationId: crypto.randomUUID(), now: new Date().toISOString(),
        }));
      } catch (error) { return error as { code: string; status: number; details?: { committed?: boolean; operationId?: string; writtenWikiIds?: string[] } }; }
      return undefined;
    })();
    assert.ok(failure, '部分提交必须抛出明确失败');
    assert.equal((failure.details as { committed?: boolean })?.committed, true);
    const operationId = (failure.details as { operationId?: string })?.operationId as string;
    const manifest = await context.commits.get(operationId);
    assert.equal(manifest?.status, 'failed');
    assert.equal(manifest?.phases.find(phase => phase.name === 'pages')?.status, 'done');
    assert.equal(manifest?.phases.find(phase => phase.name === 'index')?.status, 'failed');
    const pagesWritten = manifest?.snapshot.pageRecords.length ?? 0;
    assert.equal((await context.wikiFiles()).length, pagesWritten + 1, '页面已写入（部分提交）');
    assert.equal((await context.rawStates.get(raw.id)).status, 'pending_confirmation', '阶段未完成前 Raw 不能标记已生成');
    assert.equal((await context.drafts.get(draft.id))?.status, 'committing', '提交中不允许编辑/放弃');

    // Repair the directory (remove the blocking directory so index.md can be a file again)
    // and restart the same data directory.
    await rm(indexFile, { recursive: true, force: true });
    const reconciled = await context.commits.reconcile();
    assert.equal(reconciled.resumed.length, 1);
    assert.equal(reconciled.resumed[0].operationId, operationId, '恢复必须复用同一 operationId');
    assert.equal(reconciled.resumed[0].status, 'completed');
    assert.equal((await context.wikiFiles()).length, pagesWritten + 1, '恢复不得复制页面');
    assert.equal((await context.rawStates.get(raw.id)).status, 'generated');
    assert.equal((await context.drafts.get(draft.id))?.status, 'confirmed');
    const log = await context.logLines();
    assert.equal(log.filter(line => line.id).length, pagesWritten + 1);
    assert.equal(new Set(log.map(line => line.id)).size, log.length, '恢复不得重复写日志');
    const second = await context.commits.reconcile();
    assert.equal(second.resumed.length, 0, '再次恢复必须幂等');
    assert.equal((await context.wikiFiles()).length, pagesWritten + 1);
  } finally { await context.clean(); }
});

test('E04-08 取消与放弃：晚到结果不落草稿，状态回到稳定值', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const rawId = rawIdFromPrompt(request.user);
      return { kind: 'delay', ms: 400, content: contentOf(buildPayloadForChunk(chunk, rawId, [{ title: `晚到主题${chunk.index + 1}` }])) };
    });
  });
  try {
    const raw = await context.createRaw(TOPICS[0], '取消资料');
    const started = await context.runner.start(raw.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() });
    assert.equal(started.job.status, 'running');
    assert.equal((await context.rawStates.get(raw.id)).status, 'processing');
    const cancelled = await context.runner.cancel(started.job.id);
    assert.ok(cancelled);
    await delay(900);
    const job = await context.jobs.get(started.job.id);
    assert.equal(job?.status, 'cancelled');
    assert.equal((await context.rawStates.get(raw.id)).status, 'unprocessed');
    assert.deepEqual(await context.drafts.list(), [], '取消后不得生成草稿');
    assert.deepEqual(await context.wikiFiles(), []);

    // A new extraction after the cancel works, and discarding returns to the stable state.
    context.fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '放弃主题' }])) };
    });
    const second = await context.extract(raw.id);
    const draft = await context.drafts.get(second.finished.draftId as string);
    assert.ok(draft, second.finished.error?.message ?? '取消后重试必须生成草稿');
    const discarded = await context.drafts.discard(draft.id, draft.revision);
    assert.equal(discarded.status, 'discarded');
    await context.rawStates.set(raw.id, { status: 'unprocessed', reason: '用户放弃了待审核草稿', draftId: draft.id });
    assert.equal((await context.rawStates.get(raw.id)).status, 'unprocessed');
    assert.equal((await getStats(context.dataRoot, context.rawStore)).pendingConfirmationCount, 0, '放弃后待确认必须归零');
    const again = await context.drafts.discard(draft.id, draft.revision);
    assert.equal(again.status, 'discarded', '放弃必须幂等');
  } finally { await context.clean(); }
});

test('E04-06 fake 注入：鉴权/限流/网络/非法JSON/空结果/schema/证据越界/截断/超限都不写正式知识', async () => {
  const context = await setup();
  try {
    const modes: Array<{ name: string; code: string; expect: (fake: FakeProvider) => void; retryable: boolean }> = [
      { name: '401', code: 'LLM_AUTH_FAILED', retryable: false, expect: fake => fake.setHandler(() => ({ kind: 'status', status: 401, body: { error: { message: 'invalid api key sk-test-should-not-leak-000' } } })) },
      { name: '429', code: 'LLM_RATE_LIMITED', retryable: true, expect: fake => fake.setHandler(() => ({ kind: 'status', status: 429 })) },
      { name: '5xx', code: 'LLM_PROVIDER_ERROR', retryable: true, expect: fake => fake.setHandler(() => ({ kind: 'status', status: 503 })) },
      { name: '非法JSON', code: 'LLM_INVALID_JSON', retryable: true, expect: fake => fake.setHandler(() => ({ kind: 'content', content: '{"document": {' })) },
      { name: '空结果', code: 'LLM_EMPTY_RESULT', retryable: true, expect: fake => fake.setHandler(() => ({ kind: 'content', content: '   ' })) },
      { name: '截断', code: 'LLM_OUTPUT_TRUNCATED', retryable: true, expect: fake => fake.setHandler(request => ({ kind: 'content', content: contentOf(buildPayloadForChunk(chunkFromPrompt(request.user), rawIdFromPrompt(request.user), [{ title: 'x' }])), finishReason: 'length' })) },
      { name: 'schema错误', code: 'LLM_SCHEMA_INVALID', retryable: true, expect: fake => fake.setHandler(request => ({ kind: 'content', content: contentOf({ ...(buildPayloadForChunk(chunkFromPrompt(request.user), rawIdFromPrompt(request.user), [{ title: 'x' }]) as object), extra: 1 }) })) },
      { name: '证据越界', code: 'LLM_EVIDENCE_UNKNOWN_LOCATOR', retryable: true, expect: fake => fake.setHandler(request => {
        const chunk = chunkFromPrompt(request.user);
        return { kind: 'content', content: contentOf({ document: { title: 't', main_topic: 'm', summary: 's' }, suggested_pages: [{ title: '证据越界页', type: 'concept', category: 'industry_basics', one_line_definition: 'd', source_facts: [{ text: 'f', evidenceIds: ['e1'] }], ai_organized: [], ai_inferences: [], related_pages: [], open_questions: [], source_evidence: [{ id: 'e1', rawId: rawIdFromPrompt(request.user), quote: `不存在的片段${chunk.index}` }] }] }) };
      }) },
      { name: '响应超限', code: 'LLM_RESPONSE_TOO_LARGE', retryable: true, expect: fake => fake.setHandler(() => ({ kind: 'raw', body: JSON.stringify({ choices: [{ message: { content: 'x'.repeat(2 * 1024 * 1024 + 1024) }, finish_reason: 'stop' }] }) })) },
    ];
    for (const mode of modes) {
      mode.expect(context.fake);
      const raw = await context.createRaw(TOPICS[0], `失败样本 ${mode.name}`);
      const finished = await context.extract(raw.id);
      assert.equal(finished.finished.status, 'failed', `${mode.name} 必须失败`);
      assert.equal(finished.finished.error?.code, mode.code, `${mode.name} 错误码应为 ${mode.code}，实际 ${finished.finished.error?.code}：${finished.finished.error?.message}`);
      assert.equal(finished.finished.error?.retryable, mode.retryable, `${mode.name} 可重试判断`);
      assert.equal(JSON.stringify(finished.finished.error ?? {}).includes('sk-test-should-not-leak'), false, '错误信息不得泄漏测试 Key');
      const state = await context.rawStates.get(raw.id);
      assert.equal(state.status, 'failed', `${mode.name}: 不得滞留在 processing`);
      assert.equal(state.lastError?.code, mode.code);
      assert.deepEqual((await context.drafts.list()).filter(draft => draft.rawId === raw.id), [], `${mode.name}: 不得生成草稿`);
    }
    // A closed port is a network failure, not a crash.
    const offline = new ExtractionRunner({
      root: context.dataRoot, llm: new LLMService(rulesDir), jobs: context.jobs, drafts: context.drafts,
      rawStates: context.rawStates, rawStore: context.rawStore, rulesDir,
      provider: () => new OpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'k', source: 'env' }),
      draftRules: async () => ({ types: ['concept'], categories: ['other'], knowledge_status: ['source_supported'], confidence: ['low'], source_level: ['C'], review_status: ['reviewed'] }),
    });
    const raw = await context.createRaw(TOPICS[0], '离线样本');
    const started = await offline.start(raw.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() });
    const finished = await context.waitForJob(started.job.id);
    assert.equal(finished.status, 'failed');
    assert.equal(finished.error?.code, 'LLM_NETWORK_ERROR');
    assert.deepEqual(await context.wikiFiles(), [], '任何失败路径都不得写正式知识');
    assert.deepEqual(await context.logLines(), []);
  } finally { await context.clean(); }
});

test('locator v2 映射后再次扫凭证：Raw锚点包含已知Key时失败且不生成草稿或正式Wiki', async () => {
  const body = '【虚构安全测试】证据原文中出现测试凭证 test-key，不能进入任何AI输出或草稿。';
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      assert.ok(chunk.text.includes('test-key'), '秘密 fixture 必须落在当前提取分块');
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '凭证引用测试', quoteText: 'test-key', factText: '原文明确记载测试凭证文字' }])) };
    });
  });
  try {
    const raw = await context.createRaw(body, '虚构凭证扫描');
    const finished = await context.extract(raw.id);
    assert.equal(finished.finished.status, 'failed');
    assert.equal(finished.finished.error?.code, 'LLM_OUTPUT_CONTAINS_SECRET');
    assert.equal((await context.rawStates.get(raw.id)).status, 'failed');
    assert.deepEqual((await context.drafts.list()).filter(draft => draft.rawId === raw.id), [], '规范化证据包含Key时不得持久化草稿');
    assert.deepEqual(await context.wikiFiles(), [], '不得写入正式Wiki');
    assert.deepEqual(await context.logLines(), [], '不得写入正式知识日志');
  } finally { await context.clean(); }
});

test('E04-01 无配置：未配置 Provider 时明确失败且零正式变化（手动链路仍可用）', async () => {
  const context = await setup();
  try {
    const runner = new ExtractionRunner({
      root: context.dataRoot, llm: new LLMService(rulesDir), jobs: context.jobs, drafts: context.drafts,
      rawStates: context.rawStates, rawStore: context.rawStore, rulesDir, provider: () => undefined,
      draftRules: async () => ({ types: ['concept'], categories: ['other'], knowledge_status: ['source_supported'], confidence: ['low'], source_level: ['C'], review_status: ['reviewed'] }),
    });
    const raw = await context.createRaw(TOPICS[0], '无配置样本');
    const error = await (async () => {
      try { await runner.start(raw.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() }); } catch (thrown) { return thrown as { code: string; status: number }; }
      return undefined;
    })();
    assert.equal(error?.code, 'LLM_NOT_CONFIGURED');
    assert.equal(error?.status, 400);
    assert.equal((await context.rawStates.get(raw.id)).status, 'unprocessed', '缺配置不得进入 processing');
    assert.deepEqual(await context.drafts.list(), []);
    assert.deepEqual(await context.wikiFiles(), []);
    // Manual paths keep working without any provider.
    const manual = await context.wikiStore.create({
      title: '手动概念', type: 'concept', category: 'industry_basics', sources: [raw.id], tags: [], aliases: [],
      knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'reviewed', body: '## 定义\n\n手动内容。\n',
    });
    assert.equal((await context.wikiStore.list({ q: '手动概念' })).length, 1);
    assert.match((await context.wikiStore.exportMarkdown(manual.id))?.markdown ?? '', /手动内容/);
  } finally { await context.clean(); }
});

test('E04-09 十万字长文：分块全覆盖、末尾证据、汇总不丢块、超预算明确失败', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const rawId = rawIdFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawId, [
        { title: `主题${chunk.index + 1}`, quoteMode: 'tail' },
      ])) };
    });
  });
  try {
    const filler = '渠道库存周转与动销分析：门店补货节奏、经销商库存水位、SKU 宽度。\r\n';
    let body = '';
    while (body.length < 100_000) body += filler;
    body += '  \r\n😀 末尾证据：动销率 62% 是末段结论\r\n';
    const raw = await context.createRaw(body, '十万字长文');
    const started = await context.extract(raw.id, );
    assert.equal(started.finished.status, 'completed', started.finished.error?.message ?? '');
    assert.ok((started.finished.chunksTotal ?? 0) > 10, '十万字必须切成多块');
    assert.equal(started.finished.callCount, started.finished.chunksTotal + 1, 'revision13每块一次调用 + 一次规划，人审不外发');
    // KB02 planning sees all extracted fact/question IDs and text, without evidence or raw chunk payloads.
    const planningRequests = context.fake.requests.filter(request => request.user.includes('请对下列全部已验证事实规划知识页'));
    assert.equal(planningRequests.length, 1, '全部分块完成后必须恰好进行一次整篇规划');
    assert.match(planningRequests[0].system, /factIds/);
    assert.match(planningRequests[0].system, /全部事实和问题必须分别且恰好归属一个页面/);
    assert.doesNotMatch(planningRequests[0].user, /source_evidence|locatorId|quote/);
    const planningInput = planningPayloadFromPrompt(planningRequests[0].user);
    assert.equal(planningInput.facts.length, started.finished.chunksTotal, '整篇规划输入必须覆盖每块的业务事实');
    assert.equal(planningInput.questions.length, 0);
    assert.equal(new Set(planningInput.facts.map(item => item.id)).size, planningInput.facts.length, '事实 ID 必须唯一');
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft);
    assert.ok(draft.document.summary.trim().length > 0, '整篇规划必须返回非空文档主题概述');
    const plannedFactTexts = planningInput.facts.map(item => item.text).sort();
    const assembledFactTexts = draft.pages.flatMap(page => page.source_facts.map(fact => fact.text)).sort();
    assert.deepEqual(assembledFactTexts, plannedFactTexts, '规划必须将全部事实恰好一次组装到草稿主题页');
    for (const page of draft.pages) for (const fact of page.source_facts) for (const id of fact.evidenceIds) assert.ok(page.source_evidence.some(item => item.id === id), '每条组装事实必须保留其 locator 证据');
    const tailMarker = '动销率 62% 是末段结论';
    const expectedAt = body.indexOf(tailMarker);
    const tailEvidence = draft.pages.flatMap(page => page.source_evidence).find(evidence => evidence.quote.includes('动销率 62%'));
    assert.ok(tailEvidence, '末尾证据必须被定位');
    assert.equal(body.slice(tailEvidence.start, tailEvidence.end), tailEvidence.quote);
    assert.ok(Math.abs(tailEvidence.start - expectedAt) < 80, `末尾证据位置应接近 ${expectedAt}，实际 ${tailEvidence.start}`);
    assert.ok(draft.pages.every(page => page.provenance.length >= 1));
    // Evidence at the very end of the material must still be inside the last chunk's coverage.
    const lastCoverage = draft.pages.flatMap(page => page.provenance).reduce((max, entry) => Math.max(max, entry.end), 0);
    assert.ok(lastCoverage >= body.length - 1, '分块必须覆盖到原文末尾');

    // Over-budget material fails explicitly instead of being truncated.
    const tooLarge = '快'.repeat(500_001);
    const largeRaw = await context.createRawUnchecked(tooLarge, '超预算长文');
    await assert.rejects(context.extract(largeRaw.id), (error: { code?: string }) => error.code === 'LLM_RAW_TOO_LARGE');
    assert.equal((await context.rawStore.get(largeRaw.id))?.body.length, 500_001, '原文必须完整保留');
  } finally { await context.clean(); }
});

test('E04-09 超过 50 条建议：明确预算失败，不静默丢弃', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const rawId = rawIdFromPrompt(request.user);
      const specs = Array.from({ length: 26 }, (_, index) => ({ title: `第${chunk.index + 1}块主题${index + 1}` }));
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawId, specs)) };
    });
  });
  try {
    const body = `${'渠道动销资料。'.repeat(900)}\n${'经销商库存资料。'.repeat(900)}`;
    assert.ok(body.length > 8000, '需要至少两块');
    const raw = await context.createRaw(body, '建议过多资料');
    const failed = await context.extract(raw.id);
    assert.equal(failed.finished.status, 'failed');
    assert.equal(failed.finished.error?.code, 'LLM_SCHEMA_INVALID', '规划超过50页的schema上限必须明确失败');
    assert.deepEqual(await context.drafts.list(), []);
    assert.deepEqual(await context.wikiFiles(), []);
  } finally { await context.clean(); }
});

test('E04-08 重启对账：processing 中断转为可重试失败，完成态恢复为待审核', async () => {
  const context = await setup();
  try {
    const raw = await context.createRaw(TOPICS.slice(0,2).join('\n'), '中断样本');
    const jobId = crypto.randomUUID();
    await context.jobs.insert({
      id: jobId, rawId: raw.id, status: 'running', stage: 'extracting', chunksTotal: 3, chunksDone: 1, pagesFound: 1,
      provider: { name: 'openai-compatible', model: 'fake-model' }, cancelRequested: false, callCount: 1,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await context.rawStates.set(raw.id, { status: 'processing', reason: '模拟中断', jobId });
    const repair = await context.runner.reconcile();
    assert.deepEqual(repair.interrupted, [jobId]);
    const repairedJob = await context.jobs.get(jobId);
    assert.equal(repairedJob?.status, 'failed');
    assert.equal(repairedJob?.error?.code, 'LLM_INTERRUPTED');
    assert.equal(repairedJob?.error?.retryable, true);
    const state = await context.rawStates.get(raw.id);
    assert.equal(state.status, 'failed');
    assert.equal(state.lastError?.code, 'LLM_INTERRUPTED');
    assert.notEqual(state.status, 'processing', '不得留下永久处理中');

    // A completed job with a draft is restored to pending_confirmation instead.
    const second = await context.extract(raw.id);
    const draft = await context.drafts.get(second.finished.draftId as string);
    assert.ok(draft);
    await context.rawStates.set(raw.id, { status: 'processing', reason: '模拟重启时仍在处理', jobId: draft.jobId });
    const repair2 = await context.runner.reconcile();
    assert.equal(repair2.statesFixed.includes(`${raw.id}:pending_confirmation`), true);
    assert.equal((await context.rawStates.get(raw.id)).status, 'pending_confirmation');
  } finally { await context.clean(); }
});

test('E04-04 审核编辑：部分选择、删除、合并、改名与证据重定位全部落草稿且可版本冲突', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const rawId = rawIdFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawId, [
        { title: `动销概念${chunk.index + 1}` }, { title: `库存周转${chunk.index + 1}`, type: 'metric', category: 'supply_chain' },
      ])) };
    });
  });
  try {
    const raw = await context.createRaw(`${TOPICS[0]}\n\n${TOPICS[1]}`);
    const started = await context.extract(raw.id);
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft);
    const rules = {
      types: ['concept', 'entity', 'business_process', 'metric'], categories: ['industry_basics', 'metric', 'supply_chain', 'other'],
      knowledge_status: ['source_supported', 'ai_organized', 'inferred', 'needs_verification', 'verified'], confidence: ['high', 'medium', 'low'],
      source_level: ['A', 'B', 'C', 'D'], review_status: ['reviewed', 'unreviewed'],
    };
    const [first, second] = draft.pages;
    const patched = await context.drafts.patch(draft.id, {
      baseRevision: draft.revision,
      source: { title: '自定义来源摘要', summary: '人工改过的摘要' },
      pages: [
        { pageId: first.pageId, title: '改名后的概念', category: 'industry_basics', source_level: 'B', selected: false, ai_inferences: ['人工补充的推断'] },
        { pageId: second.pageId, selected: true, source_level: 'A' },
      ],
    }, { body: raw.body, rules });
    assert.equal(patched.revision, 2);
    assert.equal(patched.source.title, '自定义来源摘要');
    assert.equal(patched.pages[0].title, '改名后的概念');
    assert.equal(patched.pages[0].selected, false);
    assert.equal(patched.pages[0].source_level, 'B');
    assert.deepEqual(patched.pages[0].ai_inferences, ['人工补充的推断']);
    assert.equal(patched.pages[0].source_facts.length >= 1, true, '合并/编辑后事实与推断边界必须保留');

    const stale = await (async () => {
      try { await context.drafts.patch(draft.id, { baseRevision: 1, pages: [{ pageId: first.pageId, title: '过期写入' }] }, { body: raw.body, rules }); }
      catch (error) { return error as { code: string; status: number; details?: { currentRevision?: number } }; }
      return undefined;
    })();
    assert.equal(stale?.code, 'DRAFT_REVISION_CONFLICT');
    assert.equal(stale?.details?.currentRevision, 2);

    const merged = await context.drafts.patch(draft.id, { baseRevision: 2, merge: { pageIds: [patched.pages[0].pageId, patched.pages[1].pageId], title: '合并后的知识页' } }, { body: raw.body, rules });
    assert.equal(merged.pages.length, 1);
    assert.equal(merged.pages[0].title, '合并后的知识页');
    assert.ok(merged.pages[0].mergedFrom && merged.pages[0].mergedFrom.length >= 2, '合并必须保留来源');
    assert.equal(new Set(merged.pages[0].source_evidence.map(item => item.id)).size, merged.pages[0].source_evidence.length, '合并后证据 id 不得重复');
    for (const fact of merged.pages[0].source_facts) {
      for (const id of fact.evidenceIds) assert.ok(merged.pages[0].source_evidence.some(item => item.id === id));
    }
    // Evidence edited by hand is re-validated against the Raw.
    const quote = raw.body.slice(2, 12);
    await assert.rejects(context.drafts.patch(draft.id, {
      baseRevision: merged.revision,
      pages: [{ pageId: merged.pages[0].pageId, source_evidence: [{ id: 'e1', rawId: raw.id, quote }], source_facts: [{ text: '人工确认的事实', evidenceIds: ['e1'] }] }],
    }, { body: raw.body, rules }),{code:'SOURCE_RECORD_IMMUTABLE'});
    const edited=merged;
    assert.deepEqual((await context.drafts.get(draft.id))!.pages[0].source_evidence,merged.pages[0].source_evidence);
    for(const evidence of edited.pages[0].source_evidence)assert.equal(raw.body.slice(evidence.start,evidence.end),evidence.quote);
    const badEvidence = await (async () => {
      try {
        await context.drafts.patch(draft.id, { baseRevision: edited.revision, pages: [{ pageId: edited.pages[0].pageId, source_evidence: [{ id: 'e1', rawId: raw.id, quote: '原文里没有的句子' }] }] }, { body: raw.body, rules });
      } catch (error) { return error as { code: string; status: number }; }
      return undefined;
    })();
    assert.equal(badEvidence?.code, 'SOURCE_RECORD_IMMUTABLE');
    assert.equal(badEvidence?.status, 409);
    const committing = await context.drafts.markCommitting(draft.id, crypto.randomUUID());
    assert.equal(committing.status, 'committing');
    const blocked = await (async () => {
      try { await context.drafts.patch(draft.id, { baseRevision: committing.revision, pages: [{ pageId: edited.pages[0].pageId, title: '提交中编辑' }] }, { body: raw.body, rules }); }
      catch (error) { return error as { code: string; status: number }; }
      return undefined;
    })();
    assert.equal(blocked?.code, 'DRAFT_COMMITTING');
    const discardBlocked = await (async () => {
      try { await context.drafts.discard(draft.id, undefined); } catch (error) { return error as { code: string }; }
      return undefined;
    })();
    assert.equal(discardBlocked?.code, 'DRAFT_COMMITTING');
  } finally { await context.clean(); }
});

test('E04-04 标题冲突：既有页面占用标题时整体 409，零正式变化且草稿仍可编辑', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '已被占用的标题' }])) };
    });
  });
  try {
    const raw = await context.createRaw(TOPICS[0], '冲突资料');
    await context.wikiStore.create({
      title: '已被占用的标题', type: 'concept', category: 'industry_basics', sources: [], tags: [], aliases: ['别名也占位'],
      knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'unreviewed', body: '## 定义\n\n已有页面。\n',
    });
    const before = await context.wikiFiles();
    const started = await context.extract(raw.id);
    const draft = await context.drafts.get(started.finished.draftId as string);
    assert.ok(draft);
    const conflict = await (async () => {
      try {
        await context.wikiStore.withLock(() => context.commits.confirm({
          draftId: draft.id, baseRevision: draft.revision, selectedPageIds: draft.pages.map(page => page.pageId),
          idempotencyKey: 'conflict-key', operationId: crypto.randomUUID(), now: new Date().toISOString(),
        }));
      } catch (error) { return error as { code: string; status: number; details?: { existingId?: string } }; }
      return undefined;
    })();
    assert.equal(conflict?.code, 'WIKI_TITLE_CONFLICT');
    assert.equal(conflict?.status, 409);
    assert.ok(conflict?.details?.existingId);
    assert.deepEqual(await context.wikiFiles(), before, '冲突时不得写入任何新页面');
    assert.equal((await context.drafts.get(draft.id))?.status, 'pending_confirmation', '冲突后可改名重试');
    assert.equal(await context.commits.findByDraft(draft.id), undefined, '冲突不得留下提交清单');
  } finally { await context.clean(); }
});



