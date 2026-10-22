import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExtractionCheckpointStore } from '../services/llm/checkpoints.ts';
import { ExtractionJobStore, ExtractionRunner, JobError } from '../services/llm/jobs.ts';
import { type LlmCompletionRequest, type LlmProvider } from '../services/llm/provider.ts';
import { loadExtractionRules } from '../services/llm/rules.ts';
import { LLMService } from '../services/llm/service.ts';
import { RawStateStore } from '../services/raw/state.ts';
import { RawStore } from '../services/raw/store.ts';
import { DraftStore } from '../services/wiki/drafts.ts';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-budget-'));
  const rulesDir = path.resolve('rules');
  const rawStore = new RawStore(root), rawStates = new RawStateStore(root);
  const jobs = new ExtractionJobStore(root), drafts = new DraftStore(root);
  await Promise.all([rawStore.initialize(), rawStates.initialize(), jobs.initialize(), drafts.initialize()]);
  const raw = await rawStore.create({ title: '虚构预算资料', sourceType: 'report', sourceName: '隔离测试', tags: [], body: '目标100家，在售20家。铺货率20%，负责人未知。' });
  const requests: LlmCompletionRequest[] = [];
  let validPlan = false;
  const provider: LlmProvider = { name: 'fake', model: 'budget-model', complete: async request => {
    requests.push(request);
    const data = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
    const result = request.user.includes('请对下列全部已验证事实规划知识页')
      ? { version: 2, document: { title: '虚构指标', main_topic: '指标' }, pages: [{ title: '虚构指标', type: 'metric', category: 'metric', factIds: data.facts.map((x: { id: string }) => x.id).slice(0, validPlan ? undefined : -1), questionIds: data.questions.map((x: { id: string }) => x.id) }] }
      : { version: 2, facts: data.map((x: { id: string }) => ({ atomId: x.id, kind: 'fact' })), questions: [], sourceNotes: [] };
    return { text: JSON.stringify(result), bytes: 1, finishReason: 'stop' };
  } };
  const runner = new ExtractionRunner({ root, jobs, drafts, rawStates, rawStore, rulesDir, provider: () => provider, llm: new LLMService(rulesDir), draftRules: async () => {
    const bundle = await loadExtractionRules(rulesDir);
    return { types: ['metric'], categories: ['metric'], knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [], confidence: bundle.fmcg.enums?.confidence ?? [], source_level: bundle.fmcg.enums?.source_level ?? [], review_status: bundle.fmcg.enums?.review_status ?? [] };
  } });
  const ids = new Set<string>();
  const start = async (options: { planningRetry?: boolean; restart?: boolean } = {}) => { const result = await runner.start(raw.id, { newJobId: randomUUID(), now: new Date().toISOString(), ...options }); ids.add(result.job.id); return result; };
  const safeSnapshot = async (id: string) => {
    const job = await jobs.get(id).catch(() => undefined);
    const cp = await new ExtractionCheckpointStore(root).get(id).catch(() => undefined);
    const state = await rawStates.get(raw.id).catch(() => undefined);
    const runtime = await runner.readJob(id).catch(() => undefined);
    return { node: process.version, job: job ? { status: job.status, stage: job.stage, callCount: job.callCount, errorCode: job.error?.code } : null, checkpoint: cp ? { stage: cp.stage, attempts: cp.attempts, validatedChunks: cp.completedChunks.length, diagnosticPresent: !!cp.lastError?.diagnostic, errorCode: cp.lastError?.code } : null, rawStatus: state?.status, requests: requests.length, execution: runtime?.execution, recovery: runtime?.recovery ? { code: runtime.recovery.code, phase: runtime.recovery.phase, persisted: runtime.recovery.persisted } : null };
  };
  const wait = async (id: string) => {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const view = await runner.readJob(id);
      if (view.execution === 'settled') {
        if (view.recovery || !view.job || view.job.status === 'running') throw new Error('Budget fixture settlement failed: ' + JSON.stringify(await safeSnapshot(id)));
        return view.job;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Budget fixture deadline: ' + JSON.stringify(await safeSnapshot(id)));
  };
  const hashes = async (jobId: string) => Promise.all([
    ['extraction-checkpoints', jobId], ['extraction-jobs', jobId], ['raw-processing', raw.id],
  ].map(async ([dir, id]) => createHash('sha256').update(await readFile(path.join(root, 'state', dir, id + '.json'))).digest('hex')));
  return { root, raw, jobs, requests, safeSnapshots: () => Promise.all([...ids].map(safeSnapshot)), start, wait, hashes, checkpoint: (id: string) => new ExtractionCheckpointStore(root).get(id), succeed: () => { validPlan = true; }, clean: async () => { for (const id of ids) { if ((await runner.readJob(id)).execution === 'running') await runner.cancel(id); await runner.waitForSettlement(id); } await rm(root, { recursive: true, force: true }); } };
}

test('KB02 exhausted explicit replanning rejects before writes, retains diagnostic on replay and allows explicit restart', async () => {
  const f = await fixture();
  let primaryFailure = false;
  try {
    const initial = await f.start();
    let job = await f.wait(initial.job.id);
    assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
    assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);
    assert.equal(job.callCount, 2);
    for (let calls = 3; calls <= 6; calls++) {
      assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
      assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);
      assert.equal((await f.start({ planningRetry: true })).job.id, job.id);
      job = await f.wait(job.id);
      assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
      assert.equal(job.callCount, calls);
    }
    const saved = await f.checkpoint(job.id), before = await f.hashes(job.id);
    assert.equal(saved?.attempts, 6);
    assert.equal(saved?.completedChunks.length, 1);
    assert.deepEqual(saved?.lastError?.diagnostic?.facts.missing, ['f-c1-2']);
    assert.deepEqual(job.error?.details, saved?.lastError?.diagnostic);
    for (let replay = 0; replay < 3; replay++) {
      await assert.rejects(f.start({ planningRetry: true }), (error: unknown) => error instanceof JobError && error.code === 'LLM_ATTEMPT_LIMIT' && error.status === 409 && /累计 6 次调用上限.*显式重新生成/u.test(error.message));
      assert.deepEqual(await f.hashes(job.id), before);
      assert.equal(f.requests.length, 6);
    }
    f.succeed();
    const restarted = await f.start({ restart: true });
    assert.notEqual(restarted.job.id, job.id);
    const completed = await f.wait(restarted.job.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.callCount, 2);
    assert.deepEqual(await f.checkpoint(job.id), saved);
  } catch (error) { primaryFailure = true; console.error('Budget assertion snapshot:', JSON.stringify(await f.safeSnapshots())); throw error; } finally { await f.clean().catch(error => { console.error('Budget cleanup failed:', (error as {code?: string}).code ?? 'UNKNOWN'); if (!primaryFailure) throw error; }); }
});

test('KB02 last available planning call stays in the same job with successful chunks and cumulative attempts', async () => {
  const f = await fixture();
  let primaryFailure = false;
  try {
    let job = await f.wait((await f.start()).job.id);
    for (let calls = 3; calls <= 5; calls++) {
      assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
      assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);
      await f.start({ planningRetry: true });
      job = await f.wait(job.id);
      assert.equal(job.callCount, calls);
    }
    const chunk = (await f.checkpoint(job.id))!.completedChunks;
    assert.equal(job.error?.code, 'LLM_PLAN_COVERAGE_INVALID');
    assert.ok((await f.checkpoint(job.id))?.lastError?.diagnostic);
    f.succeed();
    assert.equal((await f.start({ planningRetry: true })).job.id, job.id);
    job = await f.wait(job.id);
    assert.equal(job.status, 'completed');
    assert.equal(job.callCount, 6);
    assert.deepEqual((await f.checkpoint(job.id))!.completedChunks, chunk);
    assert.equal(f.requests.length, 6);
    assert.equal(f.requests.filter(r => !r.user.includes('请对下列全部已验证事实规划知识页')).length, 1);
    assert.deepEqual(JSON.parse(f.requests.at(-1)!.user.split('\n').at(-1)!).coverageFeedback.facts.missing, ['f-c1-2']);
  } catch (error) { primaryFailure = true; console.error('Budget assertion snapshot:', JSON.stringify(await f.safeSnapshots())); throw error; } finally { await f.clean().catch(error => { console.error('Budget cleanup failed:', (error as {code?: string}).code ?? 'UNKNOWN'); if (!primaryFailure) throw error; }); }
});
