import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { ExtractionJobStore, ExtractionRunner } from '../../services/llm/jobs.ts';
import { type LlmCompletionRequest, type LlmProvider } from '../../services/llm/provider.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { LLMService } from '../../services/llm/service.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { RawStore } from '../../services/raw/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';

export async function storageFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb02-budget-'));
  const rulesDir = path.resolve('rules');
  const rawStore = new RawStore(root), rawStates = new RawStateStore(root);
  const jobs = new ExtractionJobStore(root), drafts = new DraftStore(root);
  await Promise.all([rawStore.initialize(), rawStates.initialize(), jobs.initialize(), drafts.initialize()]);
  const raw = await rawStore.create({ title: '虚构预算资料', sourceType: 'report', sourceName: '隔离测试', tags: [], body: '目标100家，在售20家。铺货率20%，负责人未知。' });
  const requests: LlmCompletionRequest[] = [];
  let validPlan = false;
  let hook: ((request: LlmCompletionRequest) => Promise<void>) | undefined;
  let configured = true;
  const provider: LlmProvider = { name: 'fake', model: 'budget-model', complete: async request => {
    requests.push(request);
    await hook?.(request);
    const data = JSON.parse(request.user.slice(request.user.lastIndexOf('\n') + 1));
    const result = request.user.includes('请对下列全部已验证事实规划知识页')
      ? { version:3,document: { title: '虚构指标', main_topic: '指标' }, pages: [{ title: '虚构指标', type: 'metric', category: 'metric', factUnitIds:data.factUnits.map((x: { id: string }) => x.id).slice(0, validPlan ? undefined : -1), questionUnitIds:data.questionUnits.map((x: { id: string }) => x.id) }] }
      : { version: 2, facts: data.map((x: { id: string }) => ({ atomId: x.id, kind: 'fact' })), questions: [], sourceNotes: [] };
    return { text: JSON.stringify(result), bytes: 1, finishReason: 'stop' };
  } };
  const deps = { root, jobs, drafts, rawStates, rawStore, rulesDir, provider: () => configured ? provider : undefined, llm: new LLMService(rulesDir), draftRules: async () => {
    const bundle = await loadExtractionRules(rulesDir);
    return { types: ['metric'], categories: ['metric'], knowledge_status: bundle.fmcg.enums?.knowledge_status ?? [], confidence: bundle.fmcg.enums?.confidence ?? [], source_level: bundle.fmcg.enums?.source_level ?? [], review_status: bundle.fmcg.enums?.review_status ?? [] };
  } };
  const runner = new ExtractionRunner(deps);
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
  return { root, raw, jobs, requests, runner, rawStates, rawStore, drafts, provider, newRunner: () => new ExtractionRunner(deps), setConfigured: (value: boolean) => { configured = value; }, setHook: (value?: (request: LlmCompletionRequest) => Promise<void>) => { hook = value; }, start, wait, hashes, checkpoint: (id: string) => new ExtractionCheckpointStore(root).get(id), succeed: () => { validPlan = true; }, clean: async () => { for (const id of ids) { if ((await runner.readJob(id)).execution === 'running') await runner.cancel(id); await runner.waitForSettlement(id); } await rm(root, { recursive: true, force: true }); } };
}

