import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RawStore } from '../../services/raw/store.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { ExtractionJobStore, ExtractionRunner } from '../../services/llm/jobs.ts';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { LLMService } from '../../services/llm/service.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { deepRemaining } from '../../services/llm/knowledge-deep.ts';
import { OpenAiCompatibleProvider, assertNoKnownSecret, sanitizeProviderText } from '../../services/llm/provider.ts';
import { containsKnownSecret } from '../../services/llm/config.ts';
import { deepReply } from './kb03-deep-fixture.ts';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const BUDGET_POLICY = Object.freeze({ total:20, sampleCaps:Object.freeze({fixed:12,counter:7}), minimumCalls:5 });
// The historical ledger belongs to the original machine; changing TEMP/repo must never reset it.
export const REAL_LEDGER_ROOT=path.resolve('C:/Users/DAVID~1.CHE/AppData/Local/Temp/KB03-R5-20261030-f66b274a66d2-real-ledger');
export async function assertOfflineTarget(root) {
  const inside=(base,target)=>{const relative=path.relative(base,target);return !relative||(!relative.startsWith('..')&&!path.isAbsolute(relative));};
  const physical=async p=>fs.realpath(p).catch(e=>{if(e.code==='ENOENT')return path.resolve(p);throw e;});
  if(inside(path.resolve(REAL_LEDGER_ROOT),path.resolve(root))||inside(await physical(REAL_LEDGER_ROOT),await physical(root)))throw Error('Offline preparation/fake must never write the real ledger');
}
export const COUNTER = '以下均为虚构测试数据，不代表真实企业。甲区域2025年目标门店100家，其中在售20家，门店铺货率20%；仅统计直营渠道，不含线上。乙区域2024年目标门店120家，其中在售36家，门店铺货率30%；仅统计经销渠道。金额预算为100万元，不是门店数量。异常审批负责人未知。AI分析只是后续建议，尚未上线，也没有收益验证。原文提到示意图，但未提供图片。';
export async function durable(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
export async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function exists(file) { return fs.stat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }); }
export function temporary(root) {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Only a child of system TEMP is allowed');
  return path.resolve(root);
}
export async function ledgerEntries(root) {
  const names = (await fs.readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n => /^attempt-\d{2}\.json$/.test(n)).sort();
  const rows = await Promise.all(names.map(n => json(path.join(root, n))));
  if (rows.length > BUDGET_POLICY.total || rows.some((r, i) => r.sequence !== i + 1 || !['fixed', 'counter'].includes(r.sample) || r.state !== 'pending')) throw Error('Ledger is inconsistent; retain it for manual reconciliation');
  return rows;
}
export function checkBudget(rows,sample,remaining,otherRemaining) {
  if(!Object.hasOwn(BUDGET_POLICY.sampleCaps,sample))throw Error('Unknown sample');
  if(BUDGET_POLICY.total-rows.length<remaining+otherRemaining)throw Error('20-call budget cannot complete both frozen samples');
  const other=sample==='fixed'?'counter':'fixed';
  if(BUDGET_POLICY.sampleCaps[sample]-rows.filter(r=>r.sample===sample).length<remaining)throw Error('Current sample cap cannot complete its remaining stages');
  if(BUDGET_POLICY.sampleCaps[other]-rows.filter(r=>r.sample===other).length<otherRemaining)throw Error('Other sample cap cannot complete its remaining stages');
}
export function checkLedgerBinding(rows,binding) {
  if(!binding.tool)return;
  const owned=rows.filter(r=>r.tool===binding.tool);
  if(owned.some(r=>r.session!==binding.session||r.freeze!==binding.freeze))throw Error('Sample already belongs to another v2 preparation; no fresh-root reset');
  if(owned.some(r=>r.sample===binding.sample&&(r.rawId!==binding.rawId||r.jobId!==binding.jobId)))throw Error('Sample job identity changed; no fresh job or root reset');
}
export async function reserve(root, binding, remaining, otherRemaining) {
  // The lock covers only the durable reservation, never the network wait.
  await fs.mkdir(root, { recursive: true });
  const lock = await fs.open(path.join(root, 'reservation.lock'), 'wx');
  try {
    const rows = await ledgerEntries(root);
    checkBudget(rows,binding.sample,remaining,otherRemaining);
    checkLedgerBinding(rows,binding);
    const row = { ...binding, sequence: rows.length + 1, state: 'pending', at: new Date().toISOString() };
    await durable(path.join(root, `attempt-${String(row.sequence).padStart(2, '0')}.json`), row);
    return row;
  } finally { await lock.close(); await fs.unlink(path.join(root, 'reservation.lock')); }
}
export async function stores(root) {
  const rawStore = new RawStore(root), rawStates = new RawStateStore(root), jobs = new ExtractionJobStore(root), drafts = new DraftStore(root);
  await Promise.all([rawStore.initialize(), rawStates.initialize(), jobs.initialize(), drafts.initialize()]);
  return { rawStore, rawStates, jobs, drafts };
}
export function runnerFor(root, state, provider, rulesDir = path.resolve('rules')) {
  return new ExtractionRunner({ root, ...state, provider: () => provider, rulesDir, llm: new LLMService(rulesDir), draftRules: async () => {
    const b = await loadExtractionRules(rulesDir);
    return { types: b.fmcg.types.map(t => t.id).filter(t => !['source', 'synthesis'].includes(t)), categories: b.fmcg.categories.map(c => c.id), ...b.fmcg.enums };
  } });
}
export function stageOf(request) { return request.system.startsWith('KB03 ') ? JSON.parse(request.user).stage : request.user.includes('请对下列全部已验证事实规划知识页') ? 'planning' : 'extracting'; }
export async function caseState(root) {
  const state = await stores(root), jobs = await state.jobs.list(), checkpoints = await new ExtractionCheckpointStore(root).list();
  if (jobs.length > 1 || checkpoints.length > 1) throw Error('Unexpected extra job/checkpoint; no automatic reset');
  const cp = checkpoints[0], job = jobs[0];
  return { state, cp, job, remaining: cp ? deepRemaining(cp) : 5 };
}
export async function executeCase({ root, rawId, provider, ledger, binding, otherRemaining, continueExplicit = false }) {
  const before = await caseState(root);
  if (before.job && before.job.status !== 'completed' && !continueExplicit) throw Error('Existing failed/interrupted case requires --continue; pending calls may already have reached Provider');
  const rows = await ledgerEntries(ledger);
  checkBudget(rows,binding.sample,before.remaining,otherRemaining);
  checkLedgerBinding(rows,{...binding,rawId,jobId:before.job?.id});
  const raw = await before.state.rawStore.get(rawId);
  if (!raw || sha(raw.body) !== binding.sampleSha) throw Error('Raw SHA mismatch');
  const original = provider.complete.bind(provider);
  let ownCalls = 0;
  const wrapped = { name: provider.name, model: provider.model, cacheIdentity: provider.cacheIdentity, secrets: provider.secrets, complete: async request => {
    const current = await caseState(root);
    const attempt = await reserve(ledger, { ...binding, rawId, stage: stageOf(request), jobId: current.cp?.jobId }, current.remaining, otherRemaining);
    ownCalls++;
    const prefix = path.join(ledger, `attempt-${String(attempt.sequence).padStart(2, '0')}`);
    // Inputs are exactly the product request: no reference notes or independent oracle.
    assertNoKnownSecret(request.system, provider.secrets); assertNoKnownSecret(request.user, provider.secrets);
    await durable(prefix + '.request.json', { system: request.system, user: request.user, structuredOutput: request.structuredOutput });
    try {
      const result = await original(request);
      let safe = result.text;
      try { if (containsKnownSecret(result.text, provider.secrets)) throw Error('credential'); assertNoKnownSecret(result.text, provider.secrets); try { assertNoKnownSecret(JSON.parse(result.text), provider.secrets); } catch (e) { if (e.code === 'LLM_OUTPUT_CONTAINS_SECRET') throw e; } }
      catch { safe = '[redacted: credential-bearing candidate omitted]'; }
      await durable(prefix + '.result.json', { state: 'received', ...result, text: safe, textSha: sha(result.text) });
      return result;
    } catch (error) {
      await durable(prefix + '.error.json', { state: 'failed-or-unknown', code: typeof error.code === 'string' ? error.code : 'UNKNOWN', message: sanitizeProviderText(error.message, provider.secrets) });
      throw error;
    }
  } };
  const runner = runnerFor(root, before.state, wrapped);
  if (continueExplicit) await runner.reconcile(); // disk-only recovery; no automatic Provider calls
  const started = await runner.start(rawId, { newJobId: randomUUID(), now: new Date().toISOString(), mode: 'deep' });
  await runner.waitForSettlement(started.job.id);
  const view = await runner.readJob(started.job.id), afterRaw = await before.state.rawStore.get(rawId);
  if (afterRaw.bodySha256 !== binding.sampleSha || sha(afterRaw.body) !== binding.sampleSha) throw Error('Raw changed');
  const draft = view.job?.draftId ? await before.state.drafts.get(view.job.draftId) : undefined;
  return { job: view.job, execution: view.execution, recovery: view.recovery, draft, ownCalls, totalCalls: (await ledgerEntries(ledger)).length };
}
function fillWire(value, schema) {
  if (value === null) return value;
  if (schema.properties) return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, value[key] === undefined ? null : fillWire(value[key], child)]));
  if (schema.items) return value.map(v => fillWire(v, schema.items));
  return value;
}
export function fakeWireReply(wire) {
  const request = { system: wire.messages[0].content, user: wire.messages[1].content }, stage = stageOf(request);
  let value;
  if (['outline', 'writing', 'quality'].includes(stage)) value = deepReply(request);
  else {
    const p = JSON.parse(request.user.split('\n').at(-1));
    value = stage === 'extracting' ? { version: 2, facts: p.filter(a => a.text.trim()).slice(0, 32).map(a => ({ atomId: a.id, kind: a.fragment ? 'ambiguous' : 'fact' })), questions: [], sourceNotes: [] } : { version: 3, document: { title: '虚构工程样例', main_topic: '工程协议', source_level: 'D' }, pages: [{ title: '虚构工程样例', type: 'concept', category: 'industry_basics', factUnitIds: p.factUnits.map(f => f.id), questionUnitIds: p.questionUnits.map(q => q.id) }] };
  }
  if (wire.response_format?.type === 'json_schema') value = fillWire(value, wire.response_format.json_schema.schema);
  return { stage, value };
}
export async function fakeCase(root, body, { fault, continueExplicit = false, ledger = path.join(root, 'ledger'), sample='fixed', otherRemaining=0, session='fake', freeze='fake', tool } = {}) {
  await assertOfflineTarget(ledger);
  temporary(root); const state = await stores(root);
  let raw = (await state.rawStore.list())[0];
  if (!raw) raw = await state.rawStore.create({ title: '虚构工程样例', sourceType: 'article', sourceName: '仅fake', tags: [], body });
  const wires = [], prior = globalThis.fetch;
  const provider = new OpenAiCompatibleProvider({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-terra', apiKey: 'synthetic-quality-secret', source: 'env' });
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.openai.com/v1/chat/completions') throw Error('Fake refuses any unexpected destination');
    const wire = JSON.parse(options.body), reply = fakeWireReply(wire); wires.push({ stage: reply.stage, strict: !!wire.response_format?.json_schema?.strict, nullableFields: wire.response_format?.json_schema ? JSON.stringify(reply.value).includes(':null') : false });
    const text = fault ? fault(reply.stage, reply.value, wires.length) : JSON.stringify(reply.value);
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { return { ...(await executeCase({ root, rawId: raw.id, provider, ledger, binding: { sample, sampleSha: sha(body), freeze, session, ...(tool?{tool}:{}) }, otherRemaining, continueExplicit })), wires, configReads: 0, realRequests: 0 }; }
  finally { globalThis.fetch = prior; }
}
