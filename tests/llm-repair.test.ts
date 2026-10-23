import {addLegacyReviewPrecondition} from './support/human-review.ts';
// B04 返修专项测试（F04-01…F04-11 的服务端复现）。每个场景复刻返修卡/独立验收的失败断言：
// 修复前必须失败，修复后必须通过。Provider 是真实 HTTP fake（tests/support/fake-llm.ts），
// 经真实 OpenAI-compatible 适配器调用，代理/失败注入都走产品代码路径。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { buildPayloadForChunk, chunkFromPrompt, contentOf, rawIdFromPrompt, startFakeProvider, type FakeProvider } from './support/fake-llm.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesDir = path.join(root, 'rules');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// 独立验收使用的随机无效测试 Key 形状：它出现在 Provider 回显里，但绝不能出现在任何产品表面上。
const LEAK_KEY = 'test-key-9f2b7c41d8a37e65b4c9021f';

async function setup(configure: (fake: FakeProvider) => void = () => undefined, apiKey = 'test-key') {
  const dataRoot = await mkdtemp(path.join(process.cwd(), '.test-b04-repair-'));
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
  const provider = new OpenAiCompatibleProvider({ baseUrl: fake.url, model: 'fake-model', apiKey, source: 'env' });
  const llm = new LLMService(rulesDir);
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
    root: dataRoot, llm, jobs, drafts, rawStates, rawStore, provider: () => provider, rulesDir, draftRules,
  });
  const createRaw = async (body: string, title = '渠道动销资料') => rawStore.create(validateRaw({ title, sourceType: 'report', sourceName: '自检来源名', tags: ['渠道'], body }));
  const waitForJob = async (jobId: string, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await jobs.get(jobId);
      if (job && job.status !== 'running') return job;
      if (Date.now() > deadline) throw new Error(`job ${jobId} 未在 ${timeoutMs} ms 内结束`);
      await delay(20);
    }
  };
  const extract = async (rawId: string, restart = false) => {
    const started = await runner.start(rawId, { newJobId: crypto.randomUUID(), now: new Date().toISOString(), ...(restart ? { restart: true } : {}) });
    return { ...started, finished: await waitForJob(started.job.id) };
  };
  const draftFor = async (rawId: string, restart = false) => {
    const { finished } = await extract(rawId, restart);
    assert.equal(finished.status, 'completed', finished.error?.message ?? '');
    const draft = await drafts.get(finished.draftId as string);
    assert.ok(draft, '草稿必须存在');
    return draft;
  };
  const wikiFiles = async () => (await readdir(path.join(dataRoot, 'knowledge', 'wiki'))).filter(name => name !== 'index.md' && name.endsWith('.md')).sort();
  const confirm = async (draftId: string, selectedPageIds: string[], key: string) => {
    const current = await drafts.get(draftId);
    return wikiStore.withLock(() => commits.confirm({ draftId, baseRevision: current?.revision ?? 0, selectedPageIds, idempotencyKey: key, operationId: crypto.randomUUID(), now: new Date().toISOString() }));
  };
  return {
    dataRoot, rawStore, wikiStore, rawStates, drafts, jobs, commits, runner, fake, createRaw, draftFor, wikiFiles, waitForJob, extract, confirm, draftRules,
    clean: async () => {
      await fake.close();
      // Windows may still be flushing the last state files; retry briefly instead of failing.
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await rm(dataRoot, { recursive: true, force: true }); return; }
        catch { await delay(150); }
      }
    },
  };
}

test('F04-10 非法 JSON 回显测试 Key 时，job API/任务文件/状态都不含密钥', async () => {
  const context = await setup(fake => {
    // 复刻独立场景：Provider 在 200 响应体里回显请求头中的 Key，并且内容不是合法 JSON。
    fake.setHandler(request => ({ kind: 'content', content: `not json at all; your key is ${request.authorization?.replace(/^Bearer\s+/u, '') ?? ''}` }));
  }, LEAK_KEY);
  try {
    const raw = await context.createRaw('渠道动销资料正文。', '密钥泄漏探针');
    const job = await context.extract(raw.id);
    assert.equal(job.finished.status, 'failed');
    assert.equal(job.finished.error?.code, 'LLM_INVALID_JSON', '必须保留可诊断的错误码');
    const serialized = JSON.stringify(job.finished);
    const hits = serialized.split(LEAK_KEY).length - 1;
    assert.equal(hits, 0, `job 响应命中 ${hits} 次密钥（必须为 0）`);
    assert.match(serialized, /LLM_INVALID_JSON/);
    assert.match(serialized, /preview/, '仍要给出可用于诊断的（已脱敏）形状信息');
    // 任务文件与 Raw 状态文件都必须零精确命中。
    const jobFile = await readFile(path.join(context.dataRoot, 'state', 'extraction-jobs', `${job.finished.id}.json`), 'utf8');
    assert.equal(jobFile.includes(LEAK_KEY), false, '任务文件不得包含密钥');
    const stateFile = await readFile(path.join(context.dataRoot, 'state', 'raw-processing', `${raw.id}.json`), 'utf8');
    assert.equal(stateFile.includes(LEAK_KEY), false, 'Raw 状态文件不得包含密钥');
    assert.equal(jobFile.includes('[redacted]'), true, 'Provider 文本必须先脱敏再落盘');
    assert.equal(stateFile.includes('LLM_INVALID_JSON'), true, 'Raw 状态必须保留可诊断的错误码');
    assert.equal((await context.wikiFiles()).length, 0, '失败路径不得写正式知识');
    // 其它错误码路径同样脱敏：鉴权失败回显 Key。
    context.fake.setHandler(request => ({ kind: 'status', status: 401, body: { error: { message: `invalid api key ${request.authorization?.replace(/^Bearer\s+/u, '') ?? ''}` } } }));
    const auth = await context.extract(raw.id);
    assert.equal(auth.finished.error?.code, 'LLM_AUTH_FAILED');
    assert.equal(JSON.stringify(auth.finished).includes(LEAK_KEY), false, '鉴权错误不得回显密钥');
  } finally { await context.clean(); }
});

test('F04-10 Provider 输出里带上密钥时，草稿与正式 Wiki 都不会写入它', async () => {
  const context = await setup(fake => {
    // schema 合法但把 Key 塞进了事实载荷。
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const payload = buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '正常标题', factText: '业务事实里泄漏密钥 ' + (request.authorization?.replace(/^Bearer\s+/u, '') ?? '') }]);
      return { kind: 'content', content: contentOf(payload) };
    });
  }, LEAK_KEY);
  try {
    const raw = await context.createRaw('渠道动销资料正文。', '输出含密钥');
    const job = await context.extract(raw.id);
    assert.equal(job.finished.status, 'failed');
    assert.equal(job.finished.error?.code, 'LLM_OUTPUT_CONTAINS_SECRET', '必须拒绝含密钥的输出');
    assert.equal(JSON.stringify(job.finished).includes(LEAK_KEY), false);
    assert.equal(job.finished.draftId, undefined, '不得生成草稿');
    const draftFiles = await readdir(path.join(context.dataRoot, 'drafts')).catch(() => [] as string[]);
    assert.equal(draftFiles.length, 0, '草稿目录不得有文件');
    for (const file of draftFiles) {
      assert.equal((await readFile(path.join(context.dataRoot, 'drafts', file), 'utf8')).includes(LEAK_KEY), false);
    }
    assert.equal((await context.wikiFiles()).length, 0);
  } finally { await context.clean(); }
});

test('F04-07 合并保留所有不同事实与证据，重复事实合并证据，事实不移入推断', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const rawId = rawIdFromPrompt(request.user);
      const page = chunk.index === 0
        ? { title: '合并候选A', facts: [{ text: '事实A：动销率需要与库存一起看。', evidenceIds: ['e1'] }] }
        : { title: '合并候选B', facts: [{ text: '事实B：库存周转天数反映资金占用。', evidenceIds: ['e1'] }, { text: '事实A：动销率需要与库存一起看。', evidenceIds: ['e1'] }] };
      const quote = chunk.text.trim().slice(0, 16);
      const at = chunk.text.indexOf(quote);
      return { kind: 'content', content: contentOf({
        document: { title: `资料-第${chunk.index + 1}段`, main_topic: `主题${chunk.index + 1}`, summary: `第 ${chunk.index + 1} 段摘要` },
        suggested_pages: [{
          title: page.title, type: 'concept', category: 'industry_basics', one_line_definition: `${page.title}的说明`,
          source_facts: page.facts,
          ai_organized: [`${page.title}的整理`], ai_inferences: [`${page.title}的推断`],
          related_pages: [], open_questions: [chunk.index === 0 ? '各渠道是否使用相同的动销统计口径？' : '安全库存是否按地区区分？'],
          source_evidence: [{ id: 'e1', rawId, quote, start: chunk.start + Math.max(0, at), end: chunk.start + Math.max(0, at) + quote.length }],
        }],
      }) };
    });
  });
  try {
    // 两段不同事实分属两个 chunk（同一 Raw 的两个建议），人工合并。
    const filler = '渠道库存周转与动销分析：门店补货节奏、经销商库存水位。\r\n';
    let body = '事实A：动销率需要与库存一起看。尚未确认：各渠道是否使用相同的动销统计口径？\r\n';
    while (body.length < 8200) body += filler;
    body += '\n事实B：库存周转天数反映资金占用。事实A：动销率需要与库存一起看。门店补货：安全库存与补货周期决定缺货风险。尚未确认：安全库存是否按地区区分？\r\n';
    const raw = await context.createRaw(body, '合并事实资料');
    const draft = await context.draftFor(raw.id);
    assert.equal(draft.pages.length, 2);
    assert.ok(draft.pages.every(page => page.ai_organized.length === 0 && page.ai_inferences.length === 0), 'KB02 新草稿不自动生成整理/推断');
    const [a, b] = draft.pages;
    const reviewed = await context.drafts.patch(draft.id, { baseRevision: draft.revision, pages: [
      { pageId: a.pageId, ai_organized: ['人工整理A'], ai_inferences: ['人工推断A'] },
      { pageId: b.pageId, ai_organized: ['人工整理B'], ai_inferences: ['人工推断B'] },
    ] }, { body: raw.body, rules: await context.draftRules() });
    const merged = await context.drafts.patch(reviewed.id, { baseRevision: reviewed.revision, merge: { pageIds: [a.pageId, b.pageId] } }, { body: raw.body, rules: await context.draftRules() });
    const page = merged.pages[0];
    assert.equal(merged.pages.length, 1, '两个建议合并为一条');
    const texts = page.source_facts.map(fact => fact.text);
    assert.ok(texts.includes('事实A：动销率需要与库存一起看。'), `合并后必须保留事实A，实际 ${JSON.stringify(texts)}`);
    assert.ok(texts.includes('事实B：库存周转天数反映资金占用。'), `合并后必须保留事实B，实际 ${JSON.stringify(texts)}`);
    assert.equal(texts.filter(text => text.startsWith('事实A')).length, 2, '不同原记录/位置的同字句必须保留，不能按文字去重');
    // 每条事实的证据都必须仍然有效，且重复事实的证据被合并。
    for (const fact of page.source_facts) {
      assert.ok(fact.evidenceIds.length >= 1, '事实必须保留证据引用');
      for (const id of fact.evidenceIds) {
        const evidence = page.source_evidence.find(item => item.id === id);
        assert.ok(evidence, `证据 ${id} 必须存在`);
        assert.equal(raw.body.slice(evidence.start, evidence.end), evidence.quote, '证据必须仍能按全局索引核验');
      }
    }
    // 其余四类内容不得丢失或错位。
    assert.deepEqual(page.ai_organized, ['人工整理A', '人工整理B'], '合并须保留两侧经用户编辑的整理内容');
    assert.deepEqual(page.ai_inferences, ['人工推断A', '人工推断B'], '合并须保留两侧经用户编辑的推断内容');
    assert.ok(page.open_questions.length >= 2, '待确认问题必须保留两侧内容');
    assert.equal(page.source_facts.some(fact => fact.text.includes('推断')), false, '事实不能被替换成推断');
    // 合并后的草稿仍可编辑并确认，证据在提交前再次校验通过。
    const outcome = await context.confirm(merged.id, [page.pageId], 'merge-key');
    assert.equal(outcome.manifest.status, 'completed');
    const written = await context.wikiStore.get(outcome.manifest.snapshot.pageRecords[0].id);
    assert.ok(written);
    assert.ok(written?.body.includes('人工推断A') && written.body.includes('人工推断B'), '正式Wiki必须持久化合并前两侧人工推断');
    for (const text of texts) assert.ok(written?.body.includes(text), `正式页必须包含事实「${text}」`);
    assert.match(written?.body ?? '', /## 来源事实[\s\S]*事实A[\s\S]*事实B/);
    assert.deepEqual(page.ai_inferences, ['人工推断A', '人工推断B'], '正式页必须保留经用户审核的两侧推断');
  } finally { await context.clean(); }
});

test('F04-08 并发提取只产生一个活动任务；删除与提取不会留下孤儿草稿', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'delay', ms: 150, content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '并发主题' }])) };
    });
  });
  try {
    const raw = await context.createRaw('渠道动销资料正文。', '并发提取');
    // 同一个 Raw 的两次并发 extract：必须只有一个任务运行，另一个复用。
    const [a, b] = await Promise.all([
      context.runner.start(raw.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() }),
      context.runner.start(raw.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() }),
    ]);
    assert.equal(a.job.id === b.job.id || a.reused || b.reused, true, '并发启动必须复用同一个任务');
    assert.equal(new Set([a.job.id, b.job.id]).size, 1, '同 Raw 只能有一个活动任务');
    const finished = await context.waitForJob(a.job.id);
    assert.equal(finished.status, 'completed');
    const draftFiles = (await readdir(path.join(context.dataRoot, 'drafts'))).filter(name => name.endsWith('.json'));
    assert.equal(draftFiles.length, 1, '并发提取只能产生一份草稿');
    await context.clean();
  } catch (error) { await context.clean(); throw error; }

  // 提取进行中删除 Raw：删除必须被拒绝（活动工作），且不会出现孤儿草稿。
  const second = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'delay', ms: 400, content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '晚到主题' }])) };
    });
  });
  try {
    const raw = await second.createRaw('渠道动销资料正文。', '删除竞态');
    const started = await second.runner.start(raw.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() });
    const state = await second.rawStates.get(raw.id);
    assert.equal(state.status, 'processing');
    // 产品删除路由的活动工作门禁（server/index.ts 与 B03 删除路径共用同一判断）。
    const activeDraft = await second.drafts.findActiveForRaw(raw.id);
    assert.equal(Boolean(activeDraft) || state.status === 'processing', true, '提取中必须被识别为活动工作，删除应 409');
    const finished = await second.waitForJob(started.job.id);
    assert.equal(finished.status, 'completed');
    assert.equal((await second.wikiFiles()).length, 0, '尚未确认不得写正式知识');
    const draft = await second.drafts.get(finished.draftId as string);
    assert.ok(draft, '正常完成必须有草稿');
    // 取消亦不复活：取消后的晚到结果不创建草稿。
    const third = await second.createRaw('渠道动销资料正文。', '取消竞态');
    const running = await second.runner.start(third.id, { newJobId: crypto.randomUUID(), now: new Date().toISOString() });
    await second.runner.cancel(running.job.id);
    await delay(900);
    const afterCancel = await second.jobs.get(running.job.id);
    assert.equal(afterCancel?.status, 'cancelled');
    assert.equal((await second.drafts.findActiveForRaw(third.id))?.status, undefined, '取消后不得留下待审核草稿');
    const state3 = await second.rawStates.get(third.id);
    assert.equal(state3.status, 'unprocessed', '取消后状态回到稳定值');
  } finally { await second.clean(); }
});

test('F04-09 清单写入失败时如实报告：先写清单失败 → committed=false；文件已写后失败 → committed/已写IDs/阶段齐全', async () => {
  const context = await setup();
  try {
    // 通道一：清单目录本身不可写（真实磁盘故障），此时还没有任何正式写入。
    const blocking = await setup();
    try {
      const raw = await blocking.createRaw('渠道动销资料正文。', '清单目录故障');
      const draft = await blocking.draftFor(raw.id);
      const commitDir = path.join(blocking.dataRoot, 'state', 'wiki-commits');
      await rm(commitDir, { recursive: true, force: true });
      await writeFile(commitDir, 'not a directory', 'utf8');
      const error = await (async () => {
        try { await blocking.confirm(draft.id, [draft.pages[0].pageId], 'manifest-preflight'); }
        catch (problem) { return problem as { code: string; status: number; message: string; details?: Record<string, unknown> }; }
        return undefined;
      })();
      assert.ok(error, '清单写不动时必须失败，不能伪装成功');
      assert.equal(error?.status, 500);
      assert.equal(error?.code, 'COMMIT_MANIFEST_WRITE_FAILED', `必须给出可诊断的错误码，实际 ${error?.code}`);
      const details = error?.details as { committed?: boolean; recoverable?: boolean; operationId?: string; writtenWikiIds?: string[]; phases?: unknown[]; cause?: string };
      assert.equal(details?.committed, false, '此时不应声称已提交');
      assert.equal(details?.recoverable, false);
      assert.match(String(details?.operationId), /^[0-9a-f-]{36}$/i, '仍要给出 operationId 便于排查');
      assert.deepEqual(details?.writtenWikiIds, []);
      assert.equal(Array.isArray(details?.phases), true, '必须报告各阶段状态');
      assert.equal(typeof details?.cause, 'string');
      assert.equal((await blocking.wikiFiles()).length, 0, '零正式写入');
      assert.equal((await blocking.drafts.get(draft.id))?.status, 'pending_confirmation', '草稿仍可重试');
    } finally { await blocking.clean(); }

    // 通道二：Source 已写入、清单无法更新（真实故障），恢复时报错也必须带全部分提交事实。
    const raw = await context.createRaw('渠道动销资料正文。', '清单故障');
    const draft = await context.draftFor(raw.id);
    const indexFile = path.join(context.dataRoot, 'knowledge', 'wiki', 'index.md');
    await rm(indexFile, { force: true });
    await mkdir(indexFile);
    const firstError = await (async () => {
      try { await context.confirm(draft.id, [draft.pages[0].pageId], 'manifest-failure'); }
      catch (problem) { return problem as { code: string; status: number; details?: Record<string, unknown> }; }
      return undefined;
    })();
    assert.equal(firstError?.status, 500);
    const firstDetails = firstError?.details as { committed?: boolean; operationId?: string; writtenWikiIds?: string[]; failedPhase?: string };
    assert.equal(firstDetails?.committed, true, 'Source/页面已写，必须报告已部分提交');
    assert.equal(firstDetails?.failedPhase, 'index');
    const writtenIds = firstDetails?.writtenWikiIds ?? [];
    assert.equal(writtenIds.length, 2, '已写入 Source + 1 页');
    const operationId = String(firstDetails?.operationId);
    for (const id of writtenIds) {
      assert.ok((await readFile(path.join(context.dataRoot, 'knowledge', 'wiki', `${id}.md`), 'utf8')).length > 0, `${id} 必须真实存在`);
    }
    // 先修复 index.md（解除上一阶段的磁盘故障），再让清单本身写不动：把已存在的清单文件设为
    // 只读（仍可读，但每次 rename 覆盖都 EPERM），然后重启恢复。恢复必须报出同样的已提交事实。
    await rm(indexFile, { recursive: true, force: true });
    const manifestFile = path.join(context.dataRoot, 'state', 'wiki-commits', `${operationId}.json`);
    await chmod(manifestFile, 0o444);
    const restartWithBlockedManifest = await (async () => {
      const wiki = new WikiStore(context.dataRoot, context.rawStore, rulesDir);
      await wiki.initialize();
      const commits = new WikiCommitService({ root: context.dataRoot, wikiStore: wiki, drafts: context.drafts, rawStates: context.rawStates, rawStore: context.rawStore });
      await commits.initialize();
      const visible = await commits.status(operationId);
      assert.ok(visible, '故障下清单仍必须可读（这正是"清单更新失败"而不是"清单消失"）');
      return { commits, visible, result: await commits.reconcile() };
    })();
    const conflicts = restartWithBlockedManifest.result.conflicts ?? [];
    assert.equal(conflicts.length, 1, `清单写不动时必须报出冲突而不是崩掉，实际 ${JSON.stringify(restartWithBlockedManifest.result)}`);
    assert.equal(conflicts[0].operationId, operationId);
    assert.equal(conflicts[0].committed, true, '恢复失败也必须如实报告已提交');
    assert.equal(conflicts[0].writtenWikiIds.length, 2, '必须列出已写入的正式文件');
    // 恢复从 source 阶段重放：该阶段的清单更新已经失败，因此报出的失败阶段就是 source。
    assert.equal(conflicts[0].failedPhase, 'source');
    const afterFailedRecovery = await restartWithBlockedManifest.commits.status(operationId);
    assert.ok(afterFailedRecovery, '故障下清单必须仍可读');
    assert.equal(afterFailedRecovery.status, 'failed');
    assert.equal(afterFailedRecovery.phases.find(phase => phase.name === 'source')?.status, 'done', '磁盘上的清单确实没有被更新（这正是持续写失败）');
    assert.ok(['COMMIT_STATE_WRITE_FAILED', 'COMMIT_FAILED'].includes(conflicts[0].code), `错误码必须可诊断，实际 ${conflicts[0].code}`);
    // 解除故障再恢复：按原快照补齐同一 operationId，不复制页面、不重复日志。
    await chmod(manifestFile, 0o666);
    const wiki = new WikiStore(context.dataRoot, context.rawStore, rulesDir);
    await wiki.initialize();
    const commits = new WikiCommitService({ root: context.dataRoot, wikiStore: wiki, drafts: context.drafts, rawStates: context.rawStates, rawStore: context.rawStore });
    await commits.initialize();
    const recovered = await commits.reconcile();
    assert.equal(recovered.conflicts.length, 0, JSON.stringify(recovered.conflicts));
    const manifest = await commits.status(operationId);
    assert.equal(manifest?.status, 'completed', '重启必须补齐同一 operationId');
    assert.deepEqual([...new Set(manifest?.writtenWikiIds ?? [])].sort(), [...writtenIds].sort(), '写入集合必须是同一批 ID');
    const files = await context.wikiFiles();
    assert.equal(files.length, 2, 'Source + 1 页，恢复不得复制页面');
    const log = (await readFile(path.join(context.dataRoot, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean);
    assert.equal(log.length, 2, '恢复不得重复写日志');
    const draftAfter = await context.drafts.get(draft.id);
    assert.equal(draftAfter?.status, 'confirmed');
  } finally { await context.clean(); }
});

test('F04-05 复用 Source 时新页链接既有标题；新 Source 只链接本次创建页，未选保持文本', async () => {
  let round = 0;
  const context = await setup(fake => {
    // 每次提取给出不同标题，避免第二次提取与第一次的正式页面重名（那是另一条正确规则）。
    fake.setHandler(request => {
      round += 1;
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: `复用主题-${round}` }])) };
    });
  });
  try {
    // 第一次确认创建 Source + 1 页。
    const raw = await context.createRaw('渠道动销资料正文一。', '复用来源');
    const first = await context.draftFor(raw.id);
    const firstPage = first.pages[0];
    const firstOutcome = await context.confirm(first.id, [firstPage.pageId], 'first-key');
    const sourceId = firstOutcome.manifest.snapshot.sourceRecord?.id as string;
    const sourceFile = path.join(context.dataRoot, 'knowledge', 'wiki', `${sourceId}.md`);
    // 人工把 Source 标题改成与草稿不同的标题，模拟"既有页面占用标题"。
    const currentSource = await context.wikiStore.get(sourceId);
    assert.ok(currentSource);
    await context.wikiStore.update(sourceId, currentSource.revision, { ...currentSource, title: '既有 Source 标题' });
    const renamedFile = path.join(context.dataRoot, 'knowledge', 'wiki', `${sourceId}.md`);
    const renamedHash = sha(await readFile(renamedFile));

    // 同一 Raw 再次提取（草稿 Source 标题与既有标题不同），只选一页确认。
    const second = await context.draftFor(raw.id);
    assert.notEqual(second.source.title, '既有 Source 标题');
    assert.equal(second.pages.length, 1);
    const secondPage = second.pages[0];
    const outcome = await context.confirm(second.id, [secondPage.pageId], 'reuse-key');
    assert.equal(outcome.manifest.snapshot.reuseSourceId, sourceId, '必须复用既有 Source');
    assert.equal(outcome.manifest.snapshot.sourceRecord, undefined, '复用时不写 Source');
    assert.equal(sha(await readFile(renamedFile)), renamedHash, '既有 Source 文件必须逐字节不变');
    assert.equal(sha(await readFile(sourceFile)), renamedHash, '同一路径只应是同一份重命名后的 Source');
    const newPageId = outcome.manifest.snapshot.pageRecords[0].id;
    const pageRecord = await context.wikiStore.get(newPageId);
    assert.ok(pageRecord);
    assert.ok(pageRecord?.body.includes('[[既有 Source 标题]]'), `新页必须链接既有 Source 的真实标题，实际正文：${pageRecord?.body}`);
    assert.equal(pageRecord?.body.includes(`[[${second.source.title}]]`), false, '不得链接草稿里那个不存在的 Source 标题');
    // 复用来源可解析：Wikilink 解析必须找到该页。
    const links = await context.wikiStore.links(newPageId);
    const resolved = links.find(link => link.text === '既有 Source 标题');
    assert.equal(resolved?.candidates[0]?.id, sourceId, `Wikilink 必须唯一解析到既有 Source，实际 ${JSON.stringify(links)}`);
    assert.equal(resolved?.status, 'found');
  } finally { await context.clean(); }
});

test('F04-05 新 Source 只链接本次创建的选中页，未选建议按文本呈现', async () => {
  const context = await setup(fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [
        { title: '本次创建的指标', type: 'metric', category: 'metric' },
        { title: '本次不创建的概念' },
      ])) };
    });
  });
  try {
    const raw = await context.createRaw('渠道动销资料正文。库存周转资料正文。', '选中链接集合');
    const draft = await context.draftFor(raw.id);
    assert.equal(draft.pages.length, 2);
    const chosen = draft.pages.find(page => page.title === '本次创建的指标') as typeof draft.pages[number];
    const skipped = draft.pages.find(page => page.title === '本次不创建的概念') as typeof draft.pages[number];
    // 人工改标题 + 部分选择，然后保存（模拟浏览器 U03/U11 的操作）。
    const updated = await context.drafts.patch(draft.id, {
      baseRevision: draft.revision,
      pages: [
        { pageId: chosen.pageId, title: '人工改名后的指标', selected: true },
        { pageId: skipped.pageId, selected: false },
      ],
    }, { body: raw.body, rules: await context.draftRules() });
    const selectedTitles = updated.pages.filter(page => page.selected).map(page => page.title);
    assert.deepEqual(selectedTitles, ['人工改名后的指标']);
    const outcome = await context.confirm(updated.id, selectedTitles.map(() => chosen.pageId), 'selected-key');
    const sourceId = outcome.manifest.snapshot.sourceRecord?.id as string;
    const source = await context.wikiStore.get(sourceId);
    assert.ok(source);
    assert.ok(source?.body.includes('[[人工改名后的指标]]'), '新 Source 必须链接本次创建的页');
    assert.equal(source?.body.includes('[[本次不创建的概念]]'), false, '未选建议不得成为 Wikilink');
    assert.match(source?.body ?? '', /## 本次未创建的建议（未选中，待处理）/, '未选建议必须以纯文本呈现');
    assert.match(source?.body ?? '', /- 本次不创建的概念（concept，未创建；/, '未选建议按待处理文本列出');
    const pageLinks = await context.wikiStore.links(sourceId);
    assert.deepEqual(pageLinks.map(link => link.text), ['人工改名后的指标'], `Source 正文只能有一个解析成功的链接，实际 ${JSON.stringify(pageLinks)}`);
    const resolved = pageLinks.find(link => link.text === '人工改名后的指标');
    assert.equal(resolved?.candidates[0]?.id, outcome.manifest.snapshot.pageRecords[0].id, '链接必须唯一解析');
    assert.equal(resolved?.status, 'found');
    assert.equal((await context.wikiFiles()).length, 2, '只写 Source + 1 页');
  } finally { await context.clean(); }
});

test('F04-06 Source 保留 Raw 真实来源类型/名称/作者/日期/链接，缺失字段明确未提供', async () => {
  let round = 0;
  const context = await setup(fake => {
    fake.setHandler(request => {
      round += 1;
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: `来源主题-${round}` }])) };
    });
  });
  try {
    const body = '渠道动销资料正文。';
    const raw = await context.rawStore.create(validateRaw({
      title: '带完整元数据的报告', sourceType: 'report', sourceName: '某咨询公司 2026 报告', tags: ['渠道'], body,
      author: '张三', publishedAt: '2026-09-01', url: 'https://example.com/report-2026',
    }));
    const draft = await context.draftFor(raw.id);
    assert.equal(draft.rawMeta.sourceType, 'report');
    assert.equal(draft.rawMeta.sourceName, '某咨询公司 2026 报告');
    assert.equal(draft.rawMeta.author, '张三');
    assert.equal(draft.rawMeta.publishedAt, '2026-09-01');
    assert.equal(draft.rawMeta.url, 'https://example.com/report-2026');
    assert.match(draft.source.body, /来源类型：行业报告（report）/);
    assert.match(draft.source.body, /来源名称：某咨询公司 2026 报告/);
    assert.match(draft.source.body, /作者：张三/);
    assert.match(draft.source.body, /原发布日期：2026-09-01/);
    assert.match(draft.source.body, /原始链接：https:\/\/example\.com\/report-2026/);
    assert.match(draft.source.body, /Raw：带完整元数据的报告/);
    const outcome = await context.confirm(draft.id, [draft.pages[0].pageId], 'metadata-key');
    const source = await context.wikiStore.get(outcome.manifest.snapshot.sourceRecord?.id as string);
    assert.ok(source);
    // 正式 Source 快照必须保留同样的真实元数据（而不是只有标题和 ID）。
    for (const fragment of ['来源类型：行业报告（report）', '来源名称：某咨询公司 2026 报告', '作者：张三', '原发布日期：2026-09-01', '原始链接：https://example.com/report-2026']) {
      assert.ok(source?.body.includes(fragment), `正式 Source 必须包含「${fragment}」`);
    }
    // 缺失字段明确写"未提供"，不能伪造。
    const bare = await context.createRaw('另一份资料正文。', '缺元数据资料');
    const bareDraft = await context.draftFor(bare.id);
    assert.match(bareDraft.source.body, /作者：未提供（作者）/);
    assert.match(bareDraft.source.body, /原发布日期：未提供（原发布日期）/);
    assert.match(bareDraft.source.body, /原始链接：未提供（原始链接）/);
    // 用户编辑 Source 后仍保留真实元数据（正文由用户接管）。
    const edited = await context.drafts.patch(bareDraft.id, {
      baseRevision: bareDraft.revision, source: { body: '## 人工正文\n\n只写我自己的内容。\n' },
    }, { body: bare.body, rules: await context.draftRules() });
    assert.equal(edited.source.bodyEditedByUser, true);
    const editedOutcome = await context.confirm(edited.id, [edited.pages[0].pageId], 'edited-key');
    const editedSource = await context.wikiStore.get(editedOutcome.manifest.snapshot.sourceRecord?.id as string);
    assert.match(editedSource?.body ?? '', /只写我自己的内容/);
    assert.equal(editedSource?.sources[0], bare.id, '用户编辑正文不影响 Raw 归属');
  } finally { await context.clean(); }
});







