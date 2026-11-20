import os from 'node:os';
﻿// B04 public HTTP self-check: real server processes + a real (fake-backed) HTTP provider.
// Covers configuration, the extract → review → confirm loop over the public API, failure
// injections, cancel, restart recovery, the delete guard and the key-leak probe.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RawStore } from '../services/raw/store.ts';
import type { DraftRecord } from '../services/wiki/drafts.ts';
import { buildPayloadForChunk, chunkFromPrompt, contentOf, isPlanningPrompt, planningPayloadFromPrompt, rawIdFromPrompt, startFakeProvider, type FakeProvider } from './support/fake-llm.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const TEST_KEY = 'test-key-b04-should-never-leak';
const EVIDENCE_FILE = path.join(os.tmpdir(), `B04-http-evidence-${process.pid}.json`);
const evidence: { startedAt: string; node: string; scenarios: Record<string, unknown> } = { startedAt: new Date().toISOString(), node: process.version, scenarios: {} };
async function writeEvidence() {
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  await mkdir(path.dirname(EVIDENCE_FILE), { recursive: true });
  await writeFile(EVIDENCE_FILE, content, 'utf8');
}

async function freePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>(resolve => { socket.listen(0, '127.0.0.1', () => resolve()); });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}

type Service = { child: ChildProcess; base: string; dir: string; logs: string };
async function startServer(dir: string, env: Record<string, string>): Promise<Service> {
  const port = await freePort();
  const configFile = path.join(dir, 'empty-provider.env');
  await writeFile(configFile, '', 'utf8');
  const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FMCG_LLM_')));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...isolatedEnv, FMCG_DATA_DIR: dir, FMCG_PORT: String(port), ...env, FMCG_LLM_CONFIG_FILE: configFile },
  });
  const service: Service = { child, base: `http://127.0.0.1:${port}`, dir, logs: '' };
  child.stdout?.on('data', chunk => { service.logs += chunk; });
  child.stderr?.on('data', chunk => { service.logs += chunk; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${service.logs}`);
    try {
      const response = await fetch(`${service.base}/api/health`, { signal: AbortSignal.timeout(400) });
      if (response.ok && (await response.json() as { ok?: boolean }).ok) return service;
    } catch { /* not ready yet */ }
    await delay(100);
  }
  child.kill();
  throw new Error(`server did not become ready: ${service.logs}`);
}
async function stopServer(service: Service | undefined): Promise<void> {
  if (!service || service.child.exitCode !== null) return;
  const finished = once(service.child, 'exit');
  service.child.kill();
  await Promise.race([finished, delay(5000)]);
}

type Reply = { status: number; json: unknown; text: string };
type MaintenanceDraft = DraftRecord & { maintenance: NonNullable<DraftRecord['maintenance']>; changeDigests: Record<string, string> };
type ReviewAction = { decision?: 'accept' | 'defer'; title?: string; body?: string; confirmed?: boolean; digest?: string };
function makeClient(service: Service) {
  const request = async (url: string, method = 'GET', body?: unknown): Promise<Reply> => {
    const response = await fetch(`${service.base}${url}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: response.status, json, text };
  };
  const waitForJob = async (jobId: string, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const reply = await request(`/api/extraction-jobs/${jobId}`);
      const job = reply.json as { status?: string; error?: { code?: string } };
      if (job?.status && job.status !== 'running') return reply;
      if (Date.now() > deadline) throw new Error(`job ${jobId} 未结束：${reply.text.slice(0, 300)}`);
      await delay(50);
    }
  };
  const changeRequest = (draft: MaintenanceDraft, changeId: string, action: ReviewAction) => request(`/api/knowledge/drafts/${draft.id}/changes/review`, 'POST', {
    baseRevision: draft.revision, changeId, ...action,
  });
  const reviewChange = async (draft: MaintenanceDraft, changeId: string, action: ReviewAction) => {
    const result = await changeRequest(draft, changeId, action);
    assert.equal(result.status, 200, result.text);
    return result.json as MaintenanceDraft;
  };
  const acceptChanges = async (draftId: string, pageIds: string[]) => {
    const view = await request(`/api/drafts/${draftId}`);
    assert.equal(view.status, 200, view.text);
    let draft = view.json as MaintenanceDraft;
    const changes = draft.maintenance.changes.filter(change => pageIds.includes(draft.pages[change.pageIndex].pageId));
    assert.equal(changes.length, pageIds.length);
    for (const { changeId } of changes) {
      draft = await reviewChange(draft, changeId, { decision: 'accept' });
      draft = await reviewChange(draft, changeId, { confirmed: true, digest: draft.changeDigests[changeId] });
    }
    return draft;
  };
  return { request, waitForJob, changeRequest, reviewChange, acceptChanges };
}
type Client = ReturnType<typeof makeClient>;
type Shape = { [key: string]: any; error?: { code?: string; message?: string; details?: Record<string, unknown> } };
const shape = (reply: Reply): Shape => reply.json as Shape;

async function setupHarness(providerEnv: Record<string, string> | null, configure: (fake: FakeProvider) => void = () => undefined) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), '.test-b04-http-'));
  const fake = await startFakeProvider(request => {
    const chunk = chunkFromPrompt(request.user);
    return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [
      { title: `概念${chunk.index + 1}`, addInference: true },
      { title: `指标${chunk.index + 1}`, type: 'metric', category: 'metric' },
    ])) };
  });
  configure(fake);
  const service = await startServer(dataRoot, providerEnv === null ? {} : { FMCG_LLM_BASE_URL: fake.url, FMCG_LLM_MODEL: 'fake-model', FMCG_LLM_API_KEY: TEST_KEY, ...providerEnv });
  const client = makeClient(service);
  return {
    dataRoot, fake, service, client,
    restart: async () => { await stopServer(service); const next = await startServer(dataRoot, providerEnv === null ? {} : { FMCG_LLM_BASE_URL: fake.url, FMCG_LLM_MODEL: 'fake-model', FMCG_LLM_API_KEY: TEST_KEY, ...providerEnv }); return { service: next, client: makeClient(next) }; },
    clean: async () => { await stopServer(service); await fake.close(); await rm(dataRoot, { recursive: true, force: true }); },
  };
}

const RAW_BODY = '渠道动销分析：动销率衡量门店实际销售速度。\n\n经销商库存周转：周转天数反映资金占用。\n';
async function createRaw(client: Client, title: string, body = RAW_BODY): Promise<Record<string, never> & { id: string; bodySha256: string }> {
  const reply = await client.request('/api/raw', 'POST', { title, sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body });
  assert.equal(reply.status, 201, reply.text);
  return reply.json as never;
}

test('E04-02/03/04/05/10 HTTP 闭环：配置、提取、审核、确认、幂等、统计与 Raw 不变', async () => {
  const harness = await setupHarness({});
  try {
    const { client } = harness;
    const config = await client.request('/api/llm/config');
    assert.equal(config.status, 200);
    const summary = shape(config);
    assert.equal((summary as { configured?: boolean }).configured, true);
    assert.equal((summary as { keyConfigured?: boolean }).keyConfigured, true);
    assert.equal(config.text.includes(TEST_KEY), false, '配置接口绝不能返回 Key');
    assert.match(String((summary as { keyMask?: string }).keyMask), /^[•]+$/u);
    assert.equal((summary as { baseUrlHost?: string }).baseUrlHost, new URL(harness.fake.url).host);
    assert.equal((summary as { model?: string }).model, 'fake-model');

    const raw = await createRaw(client, '渠道动销与库存周转');
    const rawFile = path.join(harness.dataRoot, 'knowledge', 'raw', 'articles', `${raw.id}.md`);
    const rawHash = sha(await readFile(rawFile));
    const extract = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    assert.equal(extract.status, 202, extract.text);
    const jobId = String((shape(extract) as { jobId?: string }).jobId);
    const finished = await client.waitForJob(jobId);
    assert.equal((shape(finished) as { status?: string }).status, 'completed', finished.text);
    assert.equal(harness.fake.requests.length, 3);
    assert.equal(JSON.parse(harness.fake.requests[2].user).stage, 'maintenance');
    const draftId = String((shape(finished) as { draftId?: string }).draftId);

    const processing = await client.request('/api/raw-processing');
    assert.equal((shape(processing) as { items: Array<{ rawId: string; status: string }> }).items.find(item => item.rawId === raw.id)?.status, 'pending_confirmation');
    const statsBefore = await client.request('/api/stats');
    assert.equal((shape(statsBefore) as { pendingConfirmationCount?: number }).pendingConfirmationCount, 1);
    assert.equal((shape(statsBefore) as { wikiCount?: number }).wikiCount, 0);
    const wikiBefore = await client.request('/api/wiki');
    assert.deepEqual((shape(wikiBefore) as { items: unknown[] }).items, [], '确认前不得有正式 Wiki');
    assert.equal(sha(await readFile(rawFile)), rawHash, 'Raw 文件不得被 AI 改写');

    const draftReply = await client.request(`/api/drafts/${draftId}`);
    assert.equal(draftReply.status, 200, draftReply.text);
    const draft = shape(draftReply) as unknown as {
      revision: number; rawSha256: string; pages: Array<{ pageId: string; title: string; type: string; renderedBody: string; selected: boolean; source_evidence: Array<{ start: number; end: number; quote: string }>; source_facts: Array<{ evidenceIds: string[] }> }>;
      preview: { sourceReuse: unknown; titleConflicts: unknown[] }; source: { title: string; body: string };
    };
    assert.equal(draft.pages.length >= 2, true);
    assert.equal(draft.rawSha256, raw.bodySha256);
    assert.equal(draftReply.text.includes(TEST_KEY), false, '草稿不得包含 Key');
    for (const page of draft.pages) {
      assert.match(page.renderedBody, /## 来源事实/);
      for (const evidence of page.source_evidence) {
        assert.equal(RAW_BODY.slice(evidence.start, evidence.end), evidence.quote, '证据必须能按全局索引核验');
      }
    }
    assert.equal(draft.preview.sourceReuse, null);
    assert.deepEqual(draft.preview.titleConflicts, []);
    // F04-03 over HTTP: a brand new draft selects nothing.
    assert.equal(draft.pages.every(page => page.selected === false), true, '新草稿所有建议默认未选');
    const emptyConfirm = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', { baseRevision: draft.revision, selectedPageIds: [], idempotencyKey: 'http-empty' });
    assert.equal(emptyConfirm.status, 400);
    assert.equal(shape(emptyConfirm).error?.code, 'NO_SELECTION');

    // Review edits: keep page 1 unselected, select page 2, edit the Source, bump the revision.
    const first = draft.pages[0];
    const second = draft.pages[1];
    const patch = await client.request(`/api/drafts/${draftId}`, 'PATCH', {
      baseRevision: draft.revision,
      pages: [
        { pageId: first.pageId, title: '人工改名的概念', selected: false, category: 'channel', source_level: 'B' },
        { pageId: second.pageId, selected: true },
      ],
      source: { title: '人工改名的来源摘要' },
    });
    assert.equal(patch.status, 200, patch.text);
    assert.equal((shape(patch) as unknown as { revision: number }).revision, draft.revision + 1);
    // F04-01 over HTTP: the PATCH response still carries the Source edit and the Raw metadata.
    const patchShape = shape(patch) as unknown as { source: { title: string }; raw: { id: string; title: string; bodySha256: string } | null };
    assert.equal(patchShape.source.title, '人工改名的来源摘要', 'Source 编辑必须持久化并返回');
    assert.equal(patchShape.raw?.id, raw.id, 'PATCH 返回的 view 必须仍带 Raw 元数据');
    const stale = await client.request(`/api/drafts/${draftId}`, 'PATCH', { baseRevision: draft.revision, pages: [{ pageId: first.pageId, title: '过期改名' }] });
    assert.equal(stale.status, 409);
    assert.equal(shape(stale).error?.code, 'DRAFT_REVISION_CONFLICT');

    const updated = shape(await client.request(`/api/drafts/${draftId}`)) as unknown as { revision: number; pages: Array<{ pageId: string; title: string; selected: boolean }>; raw: { id: string } | null };
    const selected = updated.pages.filter(page => page.selected);
    assert.deepEqual(selected.map(page => page.pageId), [second.pageId], '只有勾选的建议会被提交');
    assert.equal(updated.pages.find(page => page.pageId === first.pageId)?.title, '人工改名的概念');
    assert.equal(updated.raw?.id, raw.id);
    const commit = (revision: number, selectedPageIds: string[], idempotencyKey: string) => client.request(`/api/drafts/${draftId}/confirm`, 'POST', { baseRevision: revision, selectedPageIds, idempotencyKey });
    const missingApproval = await commit(updated.revision, [second.pageId], 'http-unreviewed');
    assert.equal(missingApproval.status, 409, missingApproval.text);
    assert.equal(shape(missingApproval).error?.code, 'NO_SELECTION');
    const accepted = await client.acceptChanges(draftId, [second.pageId]);
    const chosen = accepted.maintenance.changes.find(change => accepted.pages[change.pageIndex].pageId === second.pageId)!;
    const editedBody = chosen.candidate.body + '\n\n## 人工说明\n复核后保留原文口径。';
    const edited = await client.reviewChange(accepted, chosen.changeId, { body: editedBody });
    assert.equal(edited.maintenance.changes.find(change => change.changeId === chosen.changeId)?.approval, undefined);
    const staleDigest = await client.changeRequest(edited, chosen.changeId, { confirmed: true, digest: accepted.changeDigests[chosen.changeId] });
    assert.equal(staleDigest.status, 409, staleDigest.text);
    assert.equal(shape(staleDigest).error?.code, 'REVIEW_CONTENT_CHANGED');
    const needsReview = await commit(edited.revision, [second.pageId], 'http-edited');
    assert.equal(needsReview.status, 409, needsReview.text);
    assert.equal(shape(needsReview).error?.code, 'CHANGE_REVIEW_REQUIRED');
    assert.deepEqual(shape(await client.request('/api/wiki')).items, []);
    const approved = await client.reviewChange(edited, chosen.changeId, { confirmed: true, digest: edited.changeDigests[chosen.changeId] });
    const confirm = await commit(approved.revision, [second.pageId], 'http-key-1');
    assert.equal(confirm.status, 201, confirm.text);
    const committed = shape(confirm) as unknown as { operationId: string; sourceId: string; wikiIds: string[]; sourceReused: boolean; writtenWikiIds: string[] };
    assert.equal(committed.writtenWikiIds.length, selected.length + 1);
    assert.equal(committed.sourceReused, false);
    assert.equal(confirm.text.includes(TEST_KEY), false);

    const commitState = await client.request(`/api/wiki-commits/${committed.operationId}`);
    assert.equal(commitState.status, 200, commitState.text);
    const manifest = shape(commitState) as unknown as { status: string; phases: Array<{ name: string; status: string }> };
    assert.equal(manifest.status, 'completed');
    assert.equal(manifest.phases.every(phase => phase.status === 'done'), true);

    const wikiAfter = shape(await client.request('/api/wiki')) as unknown as { items: Array<{ id: string; title: string; sources: string[]; body: string }> };
    assert.equal(wikiAfter.items.length, selected.length + 1, '只应新增 Source + 选中页');
    const source = wikiAfter.items.find(item => item.id === committed.sourceId);
    assert.ok(source, 'Source 必须已创建');
    assert.deepEqual(source?.sources, [raw.id]);
    assert.match(source?.body ?? '', /## 摘要/);
    assert.match(wikiAfter.items.find(item => item.id === committed.wikiIds[0])?.body ?? '', /复核后保留原文口径。/);
    const unselected = updated.pages.find(page => !page.selected);
    if (unselected) assert.equal(wikiAfter.items.some(item => item.title === unselected.title), false, '未选中的建议不得落盘');
    const search = shape(await client.request(`/api/wiki?q=${encodeURIComponent('人工改名的来源摘要')}`)) as unknown as { items: Array<{ id: string }> };
    assert.equal(search.items.some(item => item.id === committed.sourceId), true, '确认后的 Source 必须可搜索');
    const exportReply = await client.request(`/api/wiki/${committed.sourceId}/export`);
    assert.match(exportReply.text, new RegExp(raw.id), '导出必须保留 Raw 来源');
    assert.equal(shape(await client.request('/api/stats')).pendingConfirmationCount, 1, '暂缓项仍待审核');
    assert.equal(shape(await client.request('/api/raw-processing')).items.find((item: { rawId: string }) => item.rawId === raw.id)?.status, 'pending_confirmation');
    assert.equal(sha(await readFile(rawFile)), rawHash, '确认后 Raw 文件仍必须逐字节不变');
    evidence.scenarios.happyPath = {
      rawId: raw.id, rawSha256: raw.bodySha256, rawFileSha256: rawHash, draftId, draftRevision: approved.revision,
      selectedPageIds: selected.map(page => page.pageId), sourceId: committed.sourceId, wikiIds: committed.wikiIds,
      writtenWikiIds: committed.writtenWikiIds, operationId: committed.operationId,
      wikiCount: wikiAfter.items.length, unselectedTitle: updated.pages.find(page => !page.selected)?.title ?? null,
      keyLeakInResponses: false,
    };

    // F04-04 over HTTP: the same payload reuses the operation under any key; a different
    // payload is rejected instead of silently reusing the first one.
    const retry = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', {
      baseRevision: updated.revision, selectedPageIds: selected.map(page => page.pageId), idempotencyKey: 'http-key-1',
    });
    const retryShape = shape(retry) as unknown as { operationId: string; wikiIds: string[]; reused: boolean };
    assert.equal(retryShape.operationId, committed.operationId, 'retry must reuse the operation');
    assert.equal(retryShape.reused, true);
    assert.deepEqual(retryShape.wikiIds, committed.wikiIds);
    assert.equal((shape(await client.request('/api/wiki')) as { items: unknown[] }).items.length, selected.length + 1, 'retry must not add pages');
    const otherKeySamePayload = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', {
      baseRevision: updated.revision, selectedPageIds: selected.map(page => page.pageId), idempotencyKey: 'http-key-2',
    });
    assert.equal(otherKeySamePayload.status, 201, otherKeySamePayload.text);
    assert.equal((shape(otherKeySamePayload) as unknown as { operationId: string }).operationId, committed.operationId, '不同 key 的相同 payload 必须复用原操作');
    assert.equal((shape(await client.request('/api/wiki')) as { items: unknown[] }).items.length, selected.length + 1);
    const changedPayload = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', {
      baseRevision: updated.revision, selectedPageIds: [first.pageId], idempotencyKey: 'http-key-1',
    });
    assert.equal(changedPayload.status, 409, changedPayload.text);
    assert.equal(shape(changedPayload).error?.code, 'IDEMPOTENCY_KEY_MISMATCH', '同 key 不同 payload 必须 409');
    const partial = shape(await client.request(`/api/drafts/${draftId}`)) as MaintenanceDraft;
    const deferred = partial.maintenance.changes.find(change => partial.pages[change.pageIndex].pageId === first.pageId)!;
    assert.equal(deferred.decision, 'defer');
    assert.equal(deferred.committedOperationId, undefined);
    const changedPayloadOtherKey = await commit(partial.revision, [first.pageId], 'http-key-9');
    assert.equal(changedPayloadOtherKey.status, 409, changedPayloadOtherKey.text);
    assert.equal(shape(changedPayloadOtherKey).error?.code, 'NO_SELECTION', '新 key 不能绕过暂缓项的人工审核');
    assert.deepEqual(shape(await client.request('/api/wiki')).items, wikiAfter.items, '被拒绝的确认不得写入任何页面');
    await client.reviewChange(partial, deferred.changeId, { title: '人工改名的概念' });
    const continued = await client.acceptChanges(draftId, [first.pageId]);
    const secondCommit = await commit(continued.revision, [first.pageId], 'http-continue');
    assert.equal(secondCommit.status, 201, secondCommit.text);
    assert.notEqual(shape(secondCommit).operationId, committed.operationId);
    assert.equal(shape(secondCommit).sourceId, committed.sourceId);
    assert.equal(shape(await client.request(`/api/wiki/${shape(secondCommit).wikiIds[0]}`)).title, '人工改名的概念');
    assert.equal(shape(await client.request('/api/stats')).pendingConfirmationCount, 0);
    assert.equal(shape(await client.request('/api/raw-processing')).items.find((item: { rawId: string }) => item.rawId === raw.id)?.status, 'generated');
    assert.equal(sha(await readFile(rawFile)), rawHash);
    const beforeMismatch = shape(await client.request('/api/wiki')).items;
    const completedMismatch = await commit(continued.revision, [first.pageId, second.pageId], 'http-new-payload');
    assert.equal(completedMismatch.status, 409, completedMismatch.text);
    assert.equal(shape(completedMismatch).error?.code, 'CONFIRM_PAYLOAD_CHANGED');
    assert.deepEqual(shape(await client.request('/api/wiki')).items, beforeMismatch);
    assert.equal(harness.fake.requests.length, 3, '人工审核、确认、重试及续批不发模型请求');

    // Browse endpoints must never leak the key.
    for (const url of ['/api/raw', '/api/raw-processing', '/api/drafts', `/api/drafts/${draftId}`, '/api/wiki', '/api/stats', `/api/wiki-commits/${committed.operationId}`, '/api/llm/config']) {
      const reply = await client.request(url);
      assert.equal(reply.text.includes(TEST_KEY), false, `${url} 响应不得包含 Key`);
      assert.equal(reply.text.includes('authorization'), false, `${url} 响应不得包含鉴权头`);
    }
    assert.equal(harness.service.logs.includes(TEST_KEY), false, '服务日志不得包含 Key');
  } finally { await harness.clean(); }
});

test('E04-06 HTTP 失败注入：鉴权/限流/非法JSON 都不写正式知识且状态可重试', async () => {
  const harness = await setupHarness({});
  try {
    const { client } = harness;
    const cases: Array<{ name: string; code: string; handler: () => void }> = [
      { name: '401', code: 'LLM_AUTH_FAILED', handler: () => harness.fake.setHandler(() => ({ kind: 'status', status: 401, body: { error: { message: `invalid key ${TEST_KEY}` } } })) },
      { name: '429', code: 'LLM_RATE_LIMITED', handler: () => harness.fake.setHandler(() => ({ kind: 'status', status: 429 })) },
      { name: '非法JSON', code: 'LLM_INVALID_JSON', handler: () => harness.fake.setHandler(() => ({ kind: 'content', content: 'not json at all' })) },
      // 超时（含 60 s 单次调用上限）在 tests/llm.test.ts 用同一适配器以短超时验证，避免整套测试等待 60 s。
    ];
    for (const item of cases) {
      item.handler();
      const raw = await createRaw(client, `失败样本 ${item.name}`);
      const extract = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
      assert.equal(extract.status, 202, extract.text);
      const jobId = String((shape(extract) as { jobId?: string }).jobId);
      const finished = await client.waitForJob(jobId);
      const job = shape(finished) as unknown as { status: string; error?: { code?: string; message?: string; retryable?: boolean } };
      assert.equal(job.status, 'failed', `${item.name} 必须失败`);
      assert.equal(job.error?.code, item.code, `${item.name} 期望 ${item.code}，实际 ${job.error?.code}`);
      assert.equal(JSON.stringify(job).includes(TEST_KEY), false, `${item.name} 错误不得泄漏 Key`);
      assert.equal((shape(await client.request('/api/raw-processing')) as { items: Array<{ rawId: string; status: string }> }).items.find(state => state.rawId === raw.id)?.status, 'failed');
      assert.equal((shape(await client.request('/api/wiki')) as { items: unknown[] }).items.length, 0, `${item.name} 不得写正式知识`);
      assert.deepEqual((shape(await client.request(`/api/drafts?rawId=${raw.id}`)) as { items: unknown[] }).items, []);
    }
  } finally { await harness.clean(); }
});

test('E04-01 HTTP 无配置：缺 Key 不阻止启动，AI 明确报错，手动链路仍可用', async () => {
  const harness = await setupHarness(null);
  try {
    const { client } = harness;
    const config = shape(await client.request('/api/llm/config')) as unknown as { configured: boolean; keyConfigured: boolean; missing: string[] };
    assert.equal(config.configured, false);
    assert.equal(config.keyConfigured, false);
    assert.deepEqual(config.missing.sort(), ['FMCG_LLM_API_KEY', 'FMCG_LLM_BASE_URL', 'FMCG_LLM_MODEL'].sort());
    const raw = await createRaw(client, '无配置手动资料');
    const extract = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    assert.equal(extract.status, 400);
    assert.equal(shape(extract).error?.code, 'LLM_NOT_CONFIGURED');
    assert.equal((shape(await client.request('/api/raw-processing')) as { items: unknown[] }).items.length, 0, '缺配置不得留下处理状态');
    const manual = await client.request('/api/wiki', 'POST', {
      title: '手动概念页', type: 'concept', category: 'channel', sources: [raw.id], tags: [], aliases: [],
      knowledge_status: 'source_supported', confidence: 'medium', source_level: 'C', review_status: 'reviewed', body: '## 定义\n\n手动内容。\n',
    });
    assert.equal(manual.status, 201, manual.text);
    assert.equal((shape(await client.request('/api/wiki?q=' + encodeURIComponent('手动概念')))) as unknown as { items: unknown[] } && (shape(await client.request('/api/wiki?q=' + encodeURIComponent('手动概念'))) as { items: unknown[] }).items.length, 1);
    assert.equal((await client.request(`/api/wiki/${(shape(manual) as unknown as { id: string }).id}/export`)).status, 200);
    assert.equal((shape(await client.request('/api/stats')) as { rawCount?: number }).rawCount, 1);
  } finally { await harness.clean(); }
});

test('E04-08 HTTP 取消与删除门禁：晚到结果不落草稿，有待审核草稿时禁止删除 Raw', async () => {
  const harness = await setupHarness({}, fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'delay', ms: 800, content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '晚到主题' }])) };
    });
  });
  try {
    const { client } = harness;
    const raw = await createRaw(client, '取消样本');
    const started = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    const jobId = String((shape(started) as { jobId?: string }).jobId);
    const cancelled = await client.request(`/api/extraction-jobs/${jobId}/cancel`, 'POST', {});
    assert.equal(cancelled.status, 200, cancelled.text);
    await delay(1500);
    const job = shape(await client.request(`/api/extraction-jobs/${jobId}`)) as unknown as { status: string };
    assert.equal(job.status, 'cancelled');
    assert.deepEqual((shape(await client.request(`/api/drafts?rawId=${raw.id}`)) as { items: unknown[] }).items, [], '取消后不得生成草稿');
    assert.equal((shape(await client.request('/api/raw-processing')) as { items: Array<{ rawId: string; status: string }> }).items.find(state => state.rawId === raw.id)?.status, 'unprocessed');

    // A pending draft blocks deleting the Raw until the user resolves it.
    harness.fake.setHandler(request => ({ kind: 'content', content: contentOf(buildPayloadForChunk(chunkFromPrompt(request.user), rawIdFromPrompt(request.user), [{ title: '待审核主题' }])) }));
    const second = await client.request(`/api/raw/${raw.id}/extract`, 'POST', { restart: true });
    await client.waitForJob(String((shape(second) as { jobId?: string }).jobId));
    const blocked = await client.request(`/api/raw/${raw.id}`, 'DELETE', {});
    assert.equal(blocked.status, 409, blocked.text);
    assert.equal(shape(blocked).error?.code, 'RAW_ACTIVE_WORK');
    const draftId = String((shape(await client.request(`/api/drafts?rawId=${raw.id}`)) as { items: Array<{ id: string }> }).items[0]?.id);
    const discarded = await client.request(`/api/drafts/${draftId}/discard`, 'POST', {});
    assert.equal(discarded.status, 200, discarded.text);
    assert.equal((shape(await client.request('/api/stats')) as { pendingConfirmationCount?: number }).pendingConfirmationCount, 0);
    const removed = await client.request(`/api/raw/${raw.id}`, 'DELETE', {});
    assert.equal(removed.status, 200, removed.text);
  } finally { await harness.clean(); }
});

test('F04-08 HTTP 竞态：并发提取只有一个任务；删除与提取串行且不留孤儿草稿', async () => {
  const harness = await setupHarness({}, fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'delay', ms: 500, content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{ title: '竞态主题' }])) };
    });
  });
  try {
    const { client } = harness;
    const raw = await createRaw(client, '并发提取样本');
    const [a, b] = await Promise.all([
      client.request(`/api/raw/${raw.id}/extract`, 'POST', {}),
      client.request(`/api/raw/${raw.id}/extract`, 'POST', {}),
    ]);
    const jobIds = new Set([String((shape(a) as { jobId?: string }).jobId), String((shape(b) as { jobId?: string }).jobId)]);
    assert.equal(jobIds.size, 1, `同 Raw 的并发提取必须复用同一任务，实际 ${JSON.stringify([...jobIds])}`);
    assert.equal([a.status, b.status].some(status => status === 202), true);
    await client.waitForJob(String((shape(a) as { jobId?: string }).jobId));
    const drafts = shape(await client.request(`/api/drafts?rawId=${raw.id}`)) as unknown as { items: Array<{ id: string }> };
    assert.equal(drafts.items.length, 1, '并发提取只能产生一份草稿');

    // extract 与 DELETE 同时发起：要么删除先成功（提取 404）、要么提取先占位（删除 409），
    // 两者都不可能留下"Raw 已删但草稿还在"的孤儿。
    const second = await createRaw(client, '删除竞态样本');
    const [extractReply, deleteReply] = await Promise.all([
      client.request(`/api/raw/${second.id}/extract`, 'POST', {}),
      client.request(`/api/raw/${second.id}`, 'DELETE', {}),
    ]);
    const deleteWon = deleteReply.status === 200;
    assert.equal(deleteWon || deleteReply.status === 409, true, `删除必须是 200 或 409，实际 ${deleteReply.status}：${deleteReply.text}`);
    if (deleteWon) {
      assert.equal(extractReply.status, 404, '删除先成功时提取必须明确 404');
    } else {
      assert.equal(shape(deleteReply).error?.code, 'RAW_ACTIVE_WORK');
      assert.equal(extractReply.status, 202);
      await client.waitForJob(String((shape(extractReply) as { jobId?: string }).jobId));
    }
    const rawStillThere = (shape(await client.request('/api/raw')) as unknown as { items: Array<{ id: string }> }).items.some(item => item.id === second.id);
    const orphanDrafts = (shape(await client.request(`/api/drafts?rawId=${second.id}`)) as unknown as { items: Array<{ status: string }> }).items;
    if (!rawStillThere) {
      assert.equal(orphanDrafts.length, 0, `Raw 已删除时不得存在草稿，实际 ${JSON.stringify(orphanDrafts)}`);
    }
    await delay(900);
    if (!rawStillThere) {
      assert.equal((shape(await client.request(`/api/drafts?rawId=${second.id}`)) as unknown as { items: unknown[] }).items.length, 0, '晚到的提取应答也不得创建孤儿草稿');
    }
  } finally { await harness.clean(); }
});

test('F04-08 HTTP 删除完成后提取返回 404，现存会议来源仍受限', async () => {
  const harness = await setupHarness({});
  try {
    const { client, fake, dataRoot } = harness;
    const jobsDir = path.join(dataRoot, 'state', 'extraction-jobs');
    const draftsDir = path.join(dataRoot, 'drafts');
    const beforeJobs = (await readdir(jobsDir)).sort();
    const beforeDrafts = (await readdir(draftsDir, { recursive: true })).sort();
    const raw = await createRaw(client, '先删除的提取样本');
    const deleted = await client.request(`/api/raw/${raw.id}`, 'DELETE', {});
    assert.equal(deleted.status, 200, deleted.text);
    for (const options of [{}, { mode: 'deep' }]) {
      const missing = await client.request(`/api/raw/${raw.id}/extract`, 'POST', options);
      assert.equal(missing.status, 404, missing.text);
      assert.equal(shape(missing).error?.code, 'NOT_FOUND');
    }

    const { record: meetingRaw } = await new RawStore(dataRoot).createMeetingRegistration({
      id: randomUUID(), title: '本机会议来源', sourceName: '合成样本', body: '仅供本机保存。',
      tags: [], importedAt: new Date().toISOString(),
      origin: { kind: 'meeting', meeting_id: randomUUID(), import_id: randomUUID(), original_sha256: '1'.repeat(64),
        registered_confidentiality: 'Internal', processing_policy: 'meeting_local_only' },
    });
    const blocked = await client.request(`/api/raw/${meetingRaw.id}/extract`, 'POST', {});
    assert.equal(blocked.status, 403, blocked.text);
    assert.equal(shape(blocked).error?.code, 'MEETING_SOURCE_RESTRICTED');
    assert.equal(fake.requests.length, 0);
    assert.deepEqual((await readdir(jobsDir)).sort(), beforeJobs);
    assert.deepEqual((await readdir(draftsDir, { recursive: true })).sort(), beforeDrafts);
  } finally { await harness.clean(); }
});

test('F04-05/06 HTTP 复用 Source 的链接与元数据：新页链接既有标题，正式 Source 保留 Raw 元数据', async () => {
  let round = 0;
  const harness = await setupHarness({}, fake => {
    fake.setHandler(request => {
      round += 1;
      const chunk = chunkFromPrompt(request.user);
      const specs = [{ title: `复用-HTTP-主题-${round}` }];
      if (round === 2) specs.push({ title: '复用-HTTP-暂缓主题' });
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), specs)) };
    });
  });
  try {
    const { client } = harness;
    const rawReply = await client.request('/api/raw', 'POST', {
      title: '带元数据的报告', sourceType: 'report', sourceName: '某咨询公司报告', tags: ['渠道'],
      author: '张三', publishedAt: '2026-09-01', url: 'https://example.com/report', body: '渠道动销资料正文。库存周转资料正文。',
    });
    assert.equal(rawReply.status, 201, rawReply.text);
    const raw = shape(rawReply) as unknown as { id: string };
    const rawFile = path.join(harness.dataRoot, 'knowledge', 'raw', 'reports', `${raw.id}.md`);
    const rawHash = sha(await readFile(rawFile));
    // 第一次：确认 Source + 1 页，然后人工改 Source 标题。
    const first = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    const firstJob = await client.waitForJob(String((shape(first) as { jobId?: string }).jobId));
    const firstDraftId = String((shape(firstJob) as { draftId?: string }).draftId);
    const firstDraft = shape(await client.request(`/api/drafts/${firstDraftId}`)) as unknown as { revision: number; pages: Array<{ pageId: string; selected: boolean }> };
    // F04-03: 默认未选 → 先勾选再确认。
    assert.equal(firstDraft.pages.every(page => page.selected === false), true);
    const selectFirst = await client.acceptChanges(firstDraftId, [firstDraft.pages[0].pageId]);
    const firstConfirm = await client.request(`/api/drafts/${firstDraftId}/confirm`, 'POST', {
      baseRevision: selectFirst.revision,
      selectedPageIds: [firstDraft.pages[0].pageId], idempotencyKey: 'http-reuse-1',
    });
    assert.equal(firstConfirm.status, 201, firstConfirm.text);
    const firstResult = shape(firstConfirm) as unknown as { sourceId: string; wikiIds: string[] };
    const sourceRead = shape(await client.request(`/api/wiki/${firstResult.sourceId}`)) as unknown as { body: string; revision: number; title: string };
    // F04-06: 正式 Source 保留真实来源元数据。
    for (const fragment of ['来源类型：行业报告（report）', '来源名称：某咨询公司报告', '作者：张三', '登记日期：2026-09-01', '登记链接：https://example.com/report']) {
      assert.ok(sourceRead.body.includes(fragment), `正式 Source 必须包含「${fragment}」`);
    }
    const sourceRecord = shape(await client.request(`/api/wiki/${firstResult.sourceId}`)) as unknown as Record<string, unknown>;
    const renamed = await client.request(`/api/wiki/${firstResult.sourceId}`, 'PUT', {
      baseRevision: sourceRead.revision, ...sourceRecord, title: '既有来源页标题',
    });
    assert.ok([200, 201].includes(renamed.status), renamed.text);
    // 第二次提取：只选一页确认 → 复用既有 Source，新页必须链接既有真实标题。
    const second = await client.request(`/api/raw/${raw.id}/extract`, 'POST', { restart: true });
    const secondJob = await client.waitForJob(String((shape(second) as { jobId?: string }).jobId));
    const secondDraftId = String((shape(secondJob) as { draftId?: string }).draftId);
    const secondDraft = shape(await client.request(`/api/drafts/${secondDraftId}`)) as unknown as { revision: number; pages: Array<{ pageId: string; renderedBody: string }>; preview: { sourceReuse: { id: string; title: string } | null } };
    assert.equal(secondDraft.preview.sourceReuse?.id, firstResult.sourceId, '预览必须显示复用既有 Source');
    assert.equal(secondDraft.preview.sourceReuse?.title, '既有来源页标题');
    assert.ok(secondDraft.pages[0].renderedBody.includes('[[既有来源页标题]]'), '预览里新页必须链接既有 Source 的真实标题');
    const sourceBefore = shape(await client.request(`/api/wiki/${firstResult.sourceId}`));
    const secondView = shape(await client.request(`/api/drafts/${secondDraftId}`)) as MaintenanceDraft;
    assert.equal(secondView.maintenance.changes.length, 2);
    const secondChange = secondView.maintenance.changes[0];
    await client.reviewChange(secondView, secondChange.changeId, { body: secondDraft.pages[0].renderedBody });
    const selectSecond = await client.acceptChanges(secondDraftId, [secondDraft.pages[0].pageId]);
    assert.equal(selectSecond.maintenance.changes.find(change => change.candidate.title === '复用-HTTP-暂缓主题')?.decision, 'defer');
    const secondConfirm = await client.request(`/api/drafts/${secondDraftId}/confirm`, 'POST', {
      baseRevision: selectSecond.revision,
      selectedPageIds: [secondDraft.pages[0].pageId], idempotencyKey: 'http-reuse-2',
    });
    assert.equal(secondConfirm.status, 201, secondConfirm.text);
    const secondResult = shape(secondConfirm) as unknown as { sourceId: string; wikiIds: string[]; sourceReused: boolean; warnings: string[] };
    assert.equal(secondResult.sourceReused, true);
    assert.equal(secondResult.sourceId, firstResult.sourceId);
    const newPage = shape(await client.request(`/api/wiki/${secondResult.wikiIds[0]}`)) as unknown as { body: string };
    assert.ok(newPage.body.includes('[[既有来源页标题]]'), `新页必须链接既有 Source 的真实标题，实际 ${newPage.body}`);
    assert.equal(newPage.body.includes('[[复用-HTTP-主题-2]]') && !newPage.body.includes('[[既有来源页标题]]'), false);
    const sourceAfter = shape(await client.request(`/api/wiki/${firstResult.sourceId}`));
    assert.equal(sourceAfter.body, sourceBefore.body.trimEnd() + '\n\n## 本次关联知识\n- [[复用-HTTP-主题-2]]\n');
    assert.equal(sourceAfter.revision, sourceBefore.revision + 1);
    assert.equal(sourceAfter.title, sourceBefore.title);
    assert.deepEqual(sourceAfter.sources, sourceBefore.sources);
    const reused = await client.request(`/api/drafts/${secondDraftId}/confirm`, 'POST', { baseRevision: selectSecond.revision, selectedPageIds: [secondDraft.pages[0].pageId], idempotencyKey: 'http-reuse-replay' });
    assert.equal(reused.status, 201, reused.text);
    assert.equal(shape(reused).operationId, shape(secondConfirm).operationId);
    assert.deepEqual(shape(await client.request(`/api/wiki/${firstResult.sourceId}`)), sourceAfter);
    assert(!shape(await client.request('/api/wiki')).items.some((page: { title: string }) => page.title === '复用-HTTP-暂缓主题'));
    assert.equal(sha(await readFile(rawFile)), rawHash);
  } finally { await harness.clean(); }
});

test('F04-04/05 HTTP 残留：未知 ID 的重试 400；Source 派生段落按本次确认选集', async () => {
  const harness = await setupHarness({}, fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [
        { title: 'HTTP 被确认的页', one_line_definition: 'HTTP 被确认的页' },
        { title: 'HTTP 未确认的页', type: 'metric', category: 'metric', one_line_definition: 'HTTP 未确认页的定义' },
      ])) };
    });
  });
  try {
    const { client } = harness;
    const rawReply = await client.request('/api/raw', 'POST', { title: 'HTTP 残留样本', sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body: '渠道动销资料正文。库存周转资料正文。' });
    assert.equal(rawReply.status, 201, rawReply.text);
    const raw = shape(rawReply) as unknown as { id: string };
    const started = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    const job = await client.waitForJob(String((shape(started) as { jobId?: string }).jobId));
    const draftId = String((shape(job) as { draftId?: string }).draftId);
    const draft = shape(await client.request(`/api/drafts/${draftId}`)) as unknown as { revision: number; pages: Array<{ pageId: string; title: string; selected: boolean; one_line_definition: string }> };
    assert.equal(draft.pages.every(page => page.selected === false), true, '默认未选');
    const [p1, p2] = draft.pages;
    const maintenanceDraft = draft as unknown as MaintenanceDraft;
    const change = maintenanceDraft.maintenance.changes.find(item => maintenanceDraft.pages[item.pageIndex].pageId === p1.pageId)!;
    const patched = await client.reviewChange(maintenanceDraft, change.changeId, { title: 'HTTP 人工改名但未勾选' });
    assert(patched.pages.every(page => !page.selected), '维护变更接受独立于旧选择标记');
    const revision = (await client.acceptChanges(draftId, [p1.pageId])).revision;
    const confirm = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', { baseRevision: revision, selectedPageIds: [p1.pageId], idempotencyKey: 'http-residual-1' });
    assert.equal(confirm.status, 201, confirm.text);
    const committed = shape(confirm) as unknown as { operationId: string; sourceId: string; wikiIds: string[] };
    // F04-05 残留：正式 Source 的派生段落全部以确认选集为准。
    const source = shape(await client.request(`/api/wiki/${committed.sourceId}`)) as unknown as { body: string };
    assert.ok(source.body.includes('[[HTTP 人工改名但未勾选]]'), source.body);
    assert.equal(source.body.includes('[[HTTP 未确认的页]]'), false);
    const skippedSection = source.body.split('## 本次未创建的建议（未选中，待处理）')[1]?.split('## Raw 来源')[0] ?? '';
    assert.equal(skippedSection.includes('HTTP 人工改名但未勾选'), false, '被确认的页不得出现在未创建列表');
    assert.ok(skippedSection.includes('HTTP 未确认的页'));
    const takeaways = source.body.split('## Key Takeaways')[1]?.split('## 涉及概念')[0] ?? '';
    assert.ok(takeaways.includes('HTTP 被确认的页'), takeaways);
    assert.equal(/暂无/u.test(takeaways), false, 'Key Takeaways 不得为暂无');
    assert.equal(p2.title, 'HTTP 未确认的页');
    // F04-04 残留：同 key 重试里带一个不存在的 UUID 必须明确 400，而不是 201 reused。
    const before = (shape(await client.request('/api/wiki')) as unknown as { items: unknown[] }).items.length;
    const retry = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', { baseRevision: revision, selectedPageIds: [p1.pageId, crypto.randomUUID()], idempotencyKey: 'http-residual-1' });
    assert.equal(retry.status, 400, retry.text);
    assert.equal(shape(retry).error?.code, 'UNKNOWN_PAGE');
    assert.equal((shape(await client.request('/api/wiki')) as unknown as { items: unknown[] }).items.length, before, '被拒绝的重试不得新增页面');
    // 同 payload 仍可复用；不同有效选集 409。
    const reuse = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', { baseRevision: revision, selectedPageIds: [p1.pageId], idempotencyKey: 'http-residual-2' });
    assert.equal(reuse.status, 201, reuse.text);
    assert.equal((shape(reuse) as unknown as { operationId: string }).operationId, committed.operationId);
    const changed = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', { baseRevision: revision, selectedPageIds: [p2.pageId], idempotencyKey: 'http-residual-1' });
    assert.equal(changed.status, 409, changed.text);
    assert.equal(shape(changed).error?.code, 'IDEMPOTENCY_KEY_MISMATCH');
    assert.equal((shape(await client.request('/api/wiki')) as unknown as { items: unknown[] }).items.length, before);
  } finally { await harness.clean(); }
});

test('F04-11 残留 HTTP：同标题同证据ID四块长文，真实汇总请求全块引用完整且可核验', async () => {
  const markers = ['HTTP返修三-甲', 'HTTP返修三-乙', 'HTTP返修三-丙', 'HTTP返修三-丁'];
  const filler = '渠道库存周转与动销分析：门店补货节奏、经销商库存水位、SKU 宽度。\r\n';
  const body = markers.map(marker => {
    let text = `${marker}：本段独有内容，全篇只出现一次。`;
    while (text.length < 7600) text += filler;
    return text;
  }).join('');
  const harness = await setupHarness({}, fake => {
    fake.setHandler(request => {
      const chunk = chunkFromPrompt(request.user);
      const marker = markers[chunk.index] ?? markers[0];
      // 合法省略可选 start/end，仍用全篇唯一引文；标题四块相同、证据 id 都是 e1。
      return {
        kind: 'content',
        content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), [{
          title: 'HTTP 同标题指标', type: 'metric', category: 'metric',
          one_line_definition: `第 ${chunk.index + 1} 段定义`, quoteText: marker, omitOffsets: true,
          factText: `第 ${chunk.index + 1} 段独有事实`,
        }])),
      };
    });
  });
  try {
    const { client } = harness;
    const rawReply = await client.request('/api/raw', 'POST', { title: '无位置hint同标题长文', sourceType: 'article', sourceName: '自检来源', tags: ['渠道'], body });
    assert.equal(rawReply.status, 201, rawReply.text);
    const raw = shape(rawReply) as unknown as { id: string; bodySha256: string };
    const rawFile = path.join(harness.dataRoot, 'knowledge', 'raw', 'articles', `${raw.id}.md`);
    const rawHash = sha(await readFile(rawFile));
    const started = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    const job = await client.waitForJob(String((shape(started) as { jobId?: string })?.jobId), 60000);
    assert.equal((shape(job) as { status?: string }).status, 'completed', job.text);
    assert.equal((shape(job) as { callCount?: number }).callCount, 6, '四块 + 一次规划和一次维护，人审不外发');
    const draftId = String((shape(job) as { draftId?: string }).draftId);
    const draft = shape(await client.request(`/api/drafts/${draftId}`)) as unknown as { pages: Array<{ pageId: string; source_evidence: Array<{ id: string; quote: string; start: number; end: number; rawId: string }>; source_facts: Array<{ text: string; evidenceIds: string[] }> }>; extraction: { chunkCount: number } };
    assert.equal(draft.extraction.chunkCount, 4);
    assert.equal(draft.pages.length, 1, '同标题四块聚合为一条建议');
    const page = draft.pages[0];
    assert.equal(page.source_facts.length, 4, '四块的独有事实都必须保留');
    assert.equal(new Set(page.source_evidence.map(evidence => evidence.id)).size, page.source_evidence.length, '证据 ID 必须唯一');
    for (const fact of page.source_facts) {
      for (const id of fact.evidenceIds) {
        const evidence = page.source_evidence.find(item => item.id === id);
        assert.ok(evidence, `事实引用 ${id} 必须可解析`);
        assert.equal(body.slice(evidence?.start, evidence?.end), evidence?.quote);
        assert.equal(evidence?.rawId, raw.id);
      }
    }
    // 真实汇总请求（产品通过真实适配器发给 fake）必须零 unresolved 且带全局位置。
    const mergeRequests = harness.fake.requests.filter(request => isPlanningPrompt(request.user));
    assert.equal(mergeRequests.length, 1, '四块摘要不同必须真正发起一次汇总');
    const plannerInput = planningPayloadFromPrompt(mergeRequests[0].user);
    assert.equal(plannerInput.facts.length, 4, '全篇规划输入必须覆盖四块提取出的全部事实');
    assert.equal(new Set(plannerInput.facts.map(item => item.id)).size, 4, '规划事实 ID 必须唯一');
    assert.equal(plannerInput.questions.length, 0);
    assert.doesNotMatch(mergeRequests[0].user, /source_evidence|locatorId|quote/);
    const plannedTexts = plannerInput.facts.map(item => item.text).sort();
    const assembledTexts = draft.pages.flatMap(page => page.source_facts.map(fact => fact.text)).sort();
    assert.deepEqual(assembledTexts, plannedTexts, '最终主题页必须保留全部规划事实恰一次');
    for (const page of draft.pages) for (const fact of page.source_facts) for (const id of fact.evidenceIds) assert.ok(page.source_evidence.some(evidence => evidence.id === id), '每条最终事实必须可追溯到其Raw locator');    assert.equal(harness.fake.maxConcurrent <= 2, true, `并发不得超过 2，实际 ${harness.fake.maxConcurrent}`);
    assert.equal(sha(await readFile(rawFile)), rawHash, 'Raw 文件必须逐字节不变');
    assert.equal((shape(job) as { draftId?: string }).draftId, draftId);
  } finally { await harness.clean(); }
});

test('E04-07 HTTP 部分提交与重启恢复：同 operationId、同名页面、无重复日志', async () => {
  const harness = await setupHarness({});
  let service = harness.service;
  let client = harness.client;
  try {
    const raw = await createRaw(client, '提交故障样本');
    const started = await client.request(`/api/raw/${raw.id}/extract`, 'POST', {});
    const finished = await client.waitForJob(String((shape(started) as { jobId?: string }).jobId));
    const draftId = String((shape(finished) as { draftId?: string }).draftId);
    const draft = shape(await client.request(`/api/drafts/${draftId}`)) as unknown as { revision: number; pages: Array<{ pageId: string }> };
    const reviewed = await client.acceptChanges(draftId, draft.pages.map(page => page.pageId));
    // Block the index write made by the commit's index phase.
    const indexFile = path.join(harness.dataRoot, 'knowledge', 'wiki', 'index.md');
    await rm(indexFile, { force: true });
    await mkdir(indexFile);
    const confirm = await client.request(`/api/drafts/${draftId}/confirm`, 'POST', {
      baseRevision: reviewed.revision, selectedPageIds: draft.pages.map(page => page.pageId), idempotencyKey: 'http-partial',
    });
    assert.equal(confirm.status, 500, confirm.text);
    const error = shape(confirm).error;
    assert.equal(error?.code?.startsWith('COMMIT_') || error?.code === 'EISDIR' || error?.code === 'EPERM' || error?.code === 'ENOTDIR' || error?.code === 'ENOENT', true, `意外的错误码 ${error?.code}`);
    assert.equal(error?.details?.committed, true, '必须报告已部分提交');
    const operationId = String(error?.details?.operationId);
    assert.match(operationId, /^[0-9a-f-]{36}$/i);
    const statusReply = shape(await client.request(`/api/wiki-commits/${operationId}`)) as unknown as { status: string; writtenWikiIds: string[]; wikiIds: string[]; recoveryHint: string; phases: Array<{ name: string; status: string }> };
    assert.equal(statusReply.status, 'failed');
    assert.equal(statusReply.writtenWikiIds.length, draft.pages.length + 1, '页面已写入，如实记录');
    assert.match(statusReply.recoveryHint, /重启/);

    // Repair and restart the same data directory: startup recovery finishes the same operation.
    await rm(indexFile, { recursive: true, force: true });
    const restarted = await harness.restart();
    service = restarted.service; client = restarted.client;
    const after = shape(await client.request(`/api/wiki-commits/${operationId}`)) as unknown as { status: string; writtenWikiIds: string[]; wikiIds: string[] };
    assert.equal(after.status, 'completed', '重启后必须补齐同一操作');
    assert.deepEqual(after.wikiIds, statusReply.wikiIds);
    assert.equal(after.writtenWikiIds.length, draft.pages.length + 1);
    const wiki = shape(await client.request('/api/wiki')) as unknown as { items: unknown[] };
    assert.equal(wiki.items.length, draft.pages.length + 1, '恢复不得复制页面');
    const draftAfter = shape(await client.request(`/api/drafts/${draftId}`)) as unknown as { status: string };
    assert.equal(draftAfter.status, 'confirmed');
    const log = await readFile(path.join(harness.dataRoot, 'knowledge', 'logs', 'wiki.jsonl'), 'utf8');
    const lines = log.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { operationId?: string; id: string });
    assert.equal(lines.length, draft.pages.length + 1, '恢复不得重复写日志');
    assert.equal(new Set(lines.map(line => line.id)).size, lines.length);
    assert.deepEqual([...new Set(lines.map(line => line.operationId))], [operationId]);
    const rawFiles = await readdir(path.join(harness.dataRoot, 'knowledge', 'raw', 'articles'));
    assert.equal(rawFiles.length, 1);
    evidence.scenarios.partialCommitAndRecovery = {
      rawId: raw.id, draftId, operationId, selectedPageIds: draft.pages.map(page => page.pageId),
      wikiIds: statusReply.wikiIds, writtenAfterFailure: statusReply.writtenWikiIds.length,
      phasesAfterFailure: statusReply.phases.map(item => `${item.name}:${item.status}`),
      writtenAfterRecovery: after.writtenWikiIds.length, statusAfterRecovery: after.status,
      wikiCountAfterRecovery: wiki.items.length, logLines: lines.length, uniqueLogTargets: new Set(lines.map(line => line.id)).size,
      noRawDuplication: rawFiles.length,
    };
    await writeEvidence();
  } finally { await stopServer(service); await harness.fake.close(); await rm(harness.dataRoot, { recursive: true, force: true }); }
});











