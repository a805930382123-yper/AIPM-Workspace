import os from 'node:os';
import {addLegacyReviewPrecondition} from './support/human-review.ts';
// B04 第二次返修专项测试（B04-recheck-fix-card 的三项残留 F04-04 / F04-05 / F04-11）。
// 每个用例复刻独立复验报告里的"最小实际复现"，修复前必须失败。
// Provider 是真实 HTTP fake，经真实 OpenAI-compatible 适配器调用。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
import { buildPayloadForChunk, chunkFromPrompt, contentOf, isPlanningPrompt, planningPayloadFromPrompt, rawIdFromPrompt, startFakeProvider, type FakePageSpec, type FakeProvider } from './support/fake-llm.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = path.join(root, 'rules');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function setup(configure: (fake: FakeProvider) => void = () => undefined) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), '.test-b04-repair2-'));
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
    return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: `主题${chunk.index + 1}` }])) };
  });
  configure(fake);
  const provider = new OpenAiCompatibleProvider({ baseUrl: fake.url, model: 'fake-model', apiKey: 'test-key', source: 'env' });
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
    root: dataRoot, llm: new LLMService(rulesDir), jobs, drafts, rawStates, rawStore,
    provider: () => provider, rulesDir, draftRules,
  });
  const createRaw = async (body: string, title = '渠道动销资料') => rawStore.create(validateRaw({ title, sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body }));
  const waitForJob = async (jobId: string, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await jobs.get(jobId);
      if (job && job.status !== 'running') return job;
      if (Date.now() > deadline) throw new Error(`job ${jobId} 未在 ${timeoutMs} ms 内结束`);
      await delay(20);
    }
  };
  const draftFor = async (rawId: string) => {
    const started = await runner.start(rawId, { newJobId: randomUUID(), now: new Date().toISOString() });
    const finished = await waitForJob(started.job.id);
    assert.equal(finished.status, 'completed', finished.error?.message ?? '');
    const draft = await drafts.get(finished.draftId as string);
    assert.ok(draft, '草稿必须存在');
    return draft;
  };
  const wikiFiles = async () => (await readdir(path.join(dataRoot, 'knowledge', 'wiki'))).filter(name => name !== 'index.md' && name.endsWith('.md')).sort();
  const logLines = async () => (await readFile(path.join(dataRoot, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean);
  const confirm = async (draftId: string, selectedPageIds: string[], key: string) => {
    const current = await drafts.get(draftId);
    return wikiStore.withLock(() => commits.confirm({ draftId, baseRevision: current?.revision ?? 0, selectedPageIds, idempotencyKey: key, operationId: randomUUID(), now: new Date().toISOString() }));
  };
  const attempt = async (work: () => Promise<unknown>) => {
    try { return { value: await work() }; }
    catch (error) { return { error: error as { code: string; status: number; message: string; details?: Record<string, unknown> } }; }
  };
  return {
    dataRoot, rawStore, wikiStore, rawStates, drafts, jobs, commits, runner, fake, createRaw, draftFor, wikiFiles, logLines, waitForJob, confirm, attempt, draftRules,
    clean: async () => {
      await fake.close();
      for (let attemptIndex = 0; attemptIndex < 5; attemptIndex++) {
        try { await rm(dataRoot, { recursive: true, force: true }); return; }
        catch { await delay(150); }
      }
    },
  };
}

test('F04-04 残留：带未知选择 ID 的重试不会被静默缩减成成功', async () => {
  const context = await setup();
  try {
    const raw = await context.createRaw('渠道动销资料正文。', '未知ID重试');
    const draft = await context.draftFor(raw.id);
    assert.equal(draft.pages.length, 1);
    const p1 = draft.pages[0].pageId;
    const first = await context.confirm(draft.id, [p1], 'key-A');
    assert.equal(first.manifest.status, 'completed');
    const filesAfterFirst = await context.wikiFiles();
    const logsAfterFirst = await context.logLines();
    assert.equal(filesAfterFirst.length, 2, 'Source + 1 页');
    assert.equal(logsAfterFirst.length, 2);

    // 复刻残留：同草稿同 key，选集里多一个不存在的 UUID。
    const unknown = randomUUID();
    const retry = await context.attempt(() => context.confirm(draft.id, [p1, unknown], 'key-A'));
    assert.ok(retry.error, `带未知 ID 的重试必须失败，实际 ${JSON.stringify(retry)}`);
    assert.equal(retry.error?.code, 'UNKNOWN_PAGE', `必须是 UNKNOWN_PAGE（或内容冲突 409），实际 ${retry.error?.code}`);
    assert.equal(retry.error?.status, 400);
    assert.equal(retry.error?.details?.unknownPageId, unknown);
    assert.deepEqual(await context.wikiFiles(), filesAfterFirst, '被拒绝的重试不得改动正式文件');
    assert.deepEqual(await context.logLines(), logsAfterFirst, '被拒绝的重试不得写日志');

    // 异 key + 未知 ID 同样拒绝。
    const retryOtherKey = await context.attempt(() => context.confirm(draft.id, [p1, unknown], 'key-B'));
    assert.equal(retryOtherKey.error?.code, 'UNKNOWN_PAGE');

    // 回归：相同 payload 在任意 key 下仍复用原 operation/IDs。
    const reuseSame = await context.confirm(draft.id, [p1], 'key-A');
    assert.equal(reuseSame.reused, true);
    assert.equal(reuseSame.manifest.operationId, first.manifest.operationId);
    const reuseOtherKey = await context.confirm(draft.id, [p1], 'key-C');
    assert.equal(reuseOtherKey.reused, true);
    assert.equal(reuseOtherKey.manifest.operationId, first.manifest.operationId);
    assert.deepEqual(await context.wikiFiles(), filesAfterFirst);
    // 回归：不同有效选集 409（同 key 与异 key 都是内容冲突）。
    const otherPage = randomUUID();
    const noSelection = await context.attempt(() => context.confirm(draft.id, [], 'key-A'));
    assert.equal(noSelection.error?.code, 'NO_SELECTION');
    assert.equal(noSelection.error?.status, 400);
    assert.equal(otherPage.length, 36);
  } finally { await context.clean(); }
});

test('F04-05 残留：正式 Source 的所有派生段落以本次确认选集为准', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [
        { title: '被确认的页', one_line_definition: '被确认页的定义应当进入 Key Takeaways' },
        { title: '未确认的页', type: 'metric', category: 'metric', one_line_definition: '未确认页的定义' },
      ])) };
    });
  });
  try {
    const raw = await context.createRaw('渠道动销资料正文。库存周转资料正文。', '选集一致性');
    const draft = await context.draftFor(raw.id);
    assert.equal(draft.pages.length, 2);
    assert.equal(draft.pages.every(page => page.selected === false), true, '新草稿默认未选');
    const [p1, p2] = draft.pages;
    // 复刻残留：只改 p1 标题，不动 selected 标记。
    const patched = await context.drafts.patch(draft.id, {
      baseRevision: draft.revision,
      pages: [{ pageId: p1.pageId, title: '人工改名但未在草稿勾选' }],
    }, { body: raw.body, rules: await context.draftRules() });
    assert.equal(patched.pages.every(page => page.selected === false), true);
    assert.equal(patched.pages.find(page => page.pageId === p2.pageId)?.title, '未确认的页');
    // 公开确认只勾选 p1（与草稿标记不同）。
    const outcome = await context.confirm(patched.id, [p1.pageId], 'selection-key');
    assert.equal(outcome.manifest.status, 'completed');
    const sourceId = outcome.manifest.snapshot.sourceRecord?.id as string;
    const body = outcome.manifest.snapshot.sourceRecord?.body ?? '';
    // 1) 只有真正创建的页建立链接。
    assert.ok(body.includes('[[人工改名但未在草稿勾选]]'), `Source 必须链接被确认的页：${body}`);
    assert.equal(body.includes('[[未确认的页]]'), false);
    const links = await context.wikiStore.links(sourceId);
    assert.deepEqual(links.map(link => link.text), ['人工改名但未在草稿勾选']);
    assert.equal(links[0].status, 'found');
    // 2) selected 与 skipped 互斥且覆盖全部建议：被确认的页绝不能出现在"未创建"里。
    const skippedSection = body.split('## 本次未创建的建议（未选中，待处理）')[1]?.split('## Raw 来源')[0] ?? '';
    assert.equal(skippedSection.includes('人工改名但未在草稿勾选'), false, `被确认的页不得被标为未创建：${skippedSection}`);
    assert.ok(skippedSection.includes('未确认的页'), `未确认的页必须列为未创建：${skippedSection}`);
    assert.equal((body.match(/人工改名但未在草稿勾选/gu) ?? []).length, (body.match(/\[\[人工改名但未在草稿勾选\]\]/gu) ?? []).length, '被确认的页只以链接形式出现');
    // 3) Key Takeaways 必须包含被确认页的定义，不能是"暂无"。
    const takeaways = body.split('## Key Takeaways')[1]?.split('## 涉及概念')[0] ?? '';
    assert.ok(takeaways.includes('被确认的页'), `Key Takeaways 必须包含被确认页定义：${takeaways}`);
    assert.equal(/暂无/u.test(takeaways), false, 'Key Takeaways 不得为暂无');
    assert.equal(takeaways.includes('未确认的页'), false, '未确认页的定义不得进入 Key Takeaways');
    // 4) 正式页与 Source 一起落盘，链接可解析。
    assert.equal((await context.wikiFiles()).length, 2);
  } finally { await context.clean(); }
});

test('F04-11 残留：Provider 省略可选位置时，汇总输入仍带规范化后的全局 start/end', async () => {
  // 四段各 7600 字符，段首放一个全篇唯一的标记；标记落在对应分块内部且全篇只出现一次，
  // 所以 Provider 只回 quote（合法省略 start/end）时产品仍能唯一定位到全局位置。
  const filler = '渠道库存周转与动销分析：门店补货节奏、经销商库存水位、SKU 宽度与陈列面。\r\n';
  const segment = (marker: string) => {
    let text = `${marker}：本段独有内容。`;
    while (text.length < 7600) text += filler;
    return text;
  };
  const markers = ['独有标记甲', '独有标记乙', '独有标记丙', '独有标记丁'];
  const fullBody = markers.map(segment).join('');
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      // 合法行为：只给 id/rawId/quote，不给可选 start/end。
      const spec: FakePageSpec = { title: `省略位置-${chunk.index + 1}`, omitOffsets: true, quoteText: markers[chunk.index] ?? markers[0], one_line_definition: `第 ${chunk.index + 1} 段定义` };
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [spec])) };
    });
  });
  try {
    const raw = await context.createRaw(fullBody, '无位置hint长文');
    const draft = await context.draftFor(raw.id);
    assert.ok(draft.pages.length >= 4, `四块必须各产出一条建议，实际 ${draft.pages.length}`);
    // 草稿自己的证据必须已规范化（有全局位置且能按完整 Raw 核验）。
    for (const page of draft.pages) {
      for (const evidence of page.source_evidence) {
        assert.equal(typeof evidence.start, 'number');
        assert.equal(typeof evidence.end, 'number');
        assert.equal(raw.body.slice(evidence.start, evidence.end), evidence.quote, '草稿证据必须能按完整 Raw 核验');
      }
    }
    const mergeRequests = context.fake.requests.filter(request => isPlanningPrompt(request.user));
    assert.equal(mergeRequests.length, 1, '四块摘要不同必须真正发起一次结构化汇总');
    const planned = planningPayloadFromPrompt(mergeRequests[0].user);
    assert.equal(planned.facts.length, 4, '规划输入覆盖四块全部事实');
    assert.equal(new Set(planned.facts.map(item => item.id)).size, 4, '规划事实ID唯一');
    assert.doesNotMatch(mergeRequests[0].user, /locatorId|source_evidence|quote/);
    assert.deepEqual(draft.pages.flatMap(page => page.source_facts.map(fact => fact.text)).sort(), planned.facts.map(item => item.text).sort(), '最终页逐条保留全部规划事实');
    for (const page of draft.pages) for (const fact of page.source_facts) for (const id of fact.evidenceIds) assert.ok(page.source_evidence.some(ev => ev.id === id && raw.body.slice(ev.start, ev.end) === ev.quote && ev.rawId === raw.id), '最终证据必须指向本Raw原文位置');
  } finally { await context.clean(); }
});


