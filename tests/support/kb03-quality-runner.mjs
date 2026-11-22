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
import { maintenanceReply } from './compat01-maintenance-reply.ts';

export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const BUDGET_POLICY = Object.freeze({
  total: 30,
  sampleCaps: Object.freeze({ fixed: 20, counter: 15 }),
  minimumCalls: 5,
});
export const R10_TOOL = 'KB03-R5-20261030-v4';
export const R10_SESSION_FILE = 'r10-session.json',
  R10_STOP_FILE = 'r10-stop.json';
export const R8_ROOT = path.resolve('C:/Users/80593/AppData/Local/Temp/kb03-r8-real-gxZA0S');
export const LEGACY_LEDGER_ROOT = path.resolve(
  'C:/Users/DAVID~1.CHE/AppData/Local/Temp/KB03-R5-20261030-f66b274a66d2-real-ledger',
);
// The authorized local ledger is independent of TEMP, repo and session.
export const REAL_LEDGER_ROOT = path.resolve(
  'C:/Users/80593/AppData/Local/AIPM-Workspace/acceptance/KB03-R8-20261030/ledger',
);
export const HISTORY_USAGE = Object.freeze({
  total: 4,
  sampleCounts: Object.freeze({ fixed: 4, counter: 0 }),
  evidence: 'docs/reports/KB03-R5-20261030-review.md',
  receiptsAvailable: false,
  proof: 'summary-only; not per-request evidence',
  authorization: 'KB03-R8-20261030-user-approved-local-retest',
});
export async function assertOfflineTarget(root) {
  const inside = (base, target) => {
    const relative = path.relative(base, target);
    return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  const physical = async (p) =>
    fs.realpath(p).catch((e) => {
      if (e.code === 'ENOENT') return path.resolve(p);
      throw e;
    });
  for (const protectedRoot of [REAL_LEDGER_ROOT, LEGACY_LEDGER_ROOT, R8_ROOT])
    if (inside(protectedRoot, path.resolve(root)) || inside(await physical(protectedRoot), await physical(root)))
      throw Error('Offline preparation/fake must never write the real ledger or R8 source root');
}
export const COUNTER =
  '以下均为虚构测试数据，不代表真实企业。甲区域2025年目标门店100家，其中在售20家，门店铺货率20%；仅统计直营渠道，不含线上。乙区域2024年目标门店120家，其中在售36家，门店铺货率30%；仅统计经销渠道。金额预算为100万元，不是门店数量。异常审批负责人未知。AI分析只是后续建议，尚未上线，也没有收益验证。原文提到示意图，但未提供图片。';
export async function durable(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function exists(file) {
  return fs.stat(file).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );
}
export async function treeHashes(root) {
  const files = {};
  async function walk(relative) {
    for (const item of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.posix.join(relative, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files[file] = sha(await fs.readFile(path.join(root, file)));
    }
  }
  await walk('');
  return files;
}
// Only independent prepare executes this against the real ledger; fake uses isolated copies.
export async function startR10Session({ root, ledger, sourceRoot, freeze, session }) {
  if (await exists(path.join(ledger, R10_SESSION_FILE)))
    throw Error('R10 session already exists; no new root/session or reseed');
  const before = await readLedger(ledger);
  if (
    JSON.stringify(before.counts) !== JSON.stringify({ total: 14, fixed: 9, counter: 5 }) ||
    !before.history ||
    before.rows.length !== 10
  )
    throw Error('R10 requires the unchanged R8 history4 plus ten original receipts');
  const ledgerFiles = await treeHashes(ledger);
  if (Object.keys(ledgerFiles).length !== 31)
    throw Error('Expected all original 31 history/pending/request/result files');
  const round = {
    tool: R10_TOOL,
    session,
    root,
    freeze,
    ledgerRoot: ledger,
    policy: BUDGET_POLICY,
    priorCounts: before.counts,
    firstSequence: 15,
    historySha: ledgerFiles['history-summary.json'],
    sourceRoot,
    sourceFiles: await treeHashes(sourceRoot),
    ledgerFiles,
  };
  await durable(path.join(ledger, R10_SESSION_FILE), round);
  return round;
}
export async function stopR10Round(ledger, { code, reason }) {
  const round = await json(path.join(ledger, R10_SESSION_FILE)),
    file = path.join(ledger, R10_STOP_FILE);
  if (await exists(file)) return json(file);
  const stopped = {
    tool: R10_TOOL,
    session: round.session,
    root: round.root,
    code,
    reason,
    at: new Date().toISOString(),
  };
  await durable(file, stopped);
  return stopped;
}
export function temporary(root) {
  const relative = path.relative(os.tmpdir(), path.resolve(root));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Only a child of system TEMP is allowed');
  return path.resolve(root);
}
export async function readLedger(root) {
  const historyFile = path.join(root, 'history-summary.json');
  const history = (await exists(historyFile)) ? await json(historyFile) : undefined;
  if (path.resolve(root) === REAL_LEDGER_ROOT && !history)
    throw Error('Local history-summary is missing; run cannot initialize/reset it');
  if (
    history &&
    Object.entries(HISTORY_USAGE).some(([key, value]) => JSON.stringify(history[key]) !== JSON.stringify(value))
  )
    throw Error('Historical consumption summary must remain 4/fixed4/counter0 with missing original receipts');
  if (
    history &&
    (history.tool !== 'KB03-R5-20261030-v3' ||
      typeof history.session !== 'string' ||
      !history.session ||
      typeof history.freeze !== 'string' ||
      !history.freeze ||
      typeof history.root !== 'string' ||
      !path.isAbsolute(history.root) ||
      history.ledgerRoot !== path.resolve(root))
  )
    throw Error('Historical summary ledger/session/root binding mismatch');
  const names = (
    await fs.readdir(root).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    })
  )
    .filter((n) => /^attempt-\d{2}\.json$/.test(n))
    .sort();
  const rows = await Promise.all(names.map((n) => json(path.join(root, n))));
  const offset = history ? history.total : 0;
  if (
    rows.length + offset > BUDGET_POLICY.total ||
    rows.some(
      (r, i) =>
        names[i] !== `attempt-${String(i + 1 + offset).padStart(2, '0')}.json` ||
        r.sequence !== i + 1 + offset ||
        !['fixed', 'counter'].includes(r.sample) ||
        r.state !== 'pending',
    )
  )
    throw Error('Ledger is inconsistent; retain it for manual reconciliation');
  const sessionFile = path.join(root, R10_SESSION_FILE),
    round = (await exists(sessionFile)) ? await json(sessionFile) : undefined;
  if (round) {
    if (
      !history ||
      round.tool !== R10_TOOL ||
      typeof round.session !== 'string' ||
      !round.session ||
      typeof round.freeze !== 'string' ||
      !round.freeze ||
      typeof round.root !== 'string' ||
      !path.isAbsolute(round.root) ||
      round.ledgerRoot !== path.resolve(root) ||
      (path.resolve(root) === REAL_LEDGER_ROOT && round.sourceRoot !== R8_ROOT) ||
      round.firstSequence !== 15 ||
      JSON.stringify(round.policy) !== JSON.stringify(BUDGET_POLICY) ||
      JSON.stringify(round.priorCounts) !== JSON.stringify({ total: 14, fixed: 9, counter: 5 })
    )
      throw Error('R10 session/policy/root binding mismatch');
    const expected = [
      'history-summary.json',
      ...Array.from({ length: 10 }, (_, i) => String(i + 5).padStart(2, '0')).flatMap((n) => [
        `attempt-${n}.json`,
        `attempt-${n}.request.json`,
        `attempt-${n}.result.json`,
      ]),
    ].sort();
    const oldNames = (await fs.readdir(root))
      .filter((n) => n === 'history-summary.json' || /^attempt-(?:0[5-9]|1[0-4])(?:\.|$)/.test(n))
      .sort();
    if (
      JSON.stringify(Object.keys(round.ledgerFiles).sort()) !== JSON.stringify(expected) ||
      JSON.stringify(oldNames) !== JSON.stringify(expected) ||
      round.historySha !== sha(await fs.readFile(historyFile))
    )
      throw Error('R10 original 31-file/history baseline mismatch');
    for (const [file, digest] of Object.entries(round.ledgerFiles))
      if (sha(await fs.readFile(path.join(root, file))) !== digest) throw Error('R10 original receipt changed');
    if (JSON.stringify(await treeHashes(round.sourceRoot)) !== JSON.stringify(round.sourceFiles))
      throw Error('R8 original preparation tree changed');
  }
  if (
    history &&
    rows.some((r) => {
      const owner = r.sequence < 15 ? history : round;
      return (
        !owner ||
        r.tool !== owner.tool ||
        r.session !== owner.session ||
        r.freeze !== owner.freeze ||
        r.root !== path.join(owner.root, 'real', r.sample)
      );
    })
  )
    throw Error('New receipts disagree with historical summary/session/root binding');
  if (
    round &&
    (rows.filter((r) => r.sequence < 15).length !== 10 ||
      rows.slice(0, 10).filter((r) => r.sample === 'fixed').length !== 5)
  )
    throw Error('R10 original cumulative14/fixed9/counter5 changed');
  const stopFile = path.join(root, R10_STOP_FILE),
    stopped = (await exists(stopFile)) ? await json(stopFile) : undefined;
  if (
    stopped &&
    (!round || stopped.tool !== R10_TOOL || stopped.session !== round.session || stopped.root !== round.root)
  )
    throw Error('R10 stop/session binding mismatch');
  const counts = {
    total: rows.length + offset,
    fixed: rows.filter((r) => r.sample === 'fixed').length + (history?.sampleCounts.fixed ?? 0),
    counter: rows.filter((r) => r.sample === 'counter').length + (history?.sampleCounts.counter ?? 0),
  };
  return { rows, counts, history, round, stopped };
}
export async function ledgerEntries(root) {
  return (await readLedger(root)).rows;
}
export function checkBudget(counts, sample, remaining, otherRemaining) {
  if (!Object.hasOwn(BUDGET_POLICY.sampleCaps, sample)) throw Error('Unknown sample');
  if (BUDGET_POLICY.total - counts.total < remaining + otherRemaining)
    throw Error('30-call budget cannot complete both frozen samples');
  const other = sample === 'fixed' ? 'counter' : 'fixed';
  if (BUDGET_POLICY.sampleCaps[sample] - counts[sample] < remaining)
    throw Error('Current sample cap cannot complete its remaining stages');
  if (BUDGET_POLICY.sampleCaps[other] - counts[other] < otherRemaining)
    throw Error('Other sample cap cannot complete its remaining stages');
}
export function checkLedgerBinding({ rows, history, round, stopped }, binding) {
  if (!binding.tool) return;
  if (
    binding.tool === 'KB03-R5-20261030-v3' &&
    (!history ||
      history.tool !== binding.tool ||
      history.session !== binding.session ||
      history.freeze !== binding.freeze ||
      path.join(history.root, 'real', binding.sample) !== binding.root)
  )
    throw Error('Historical summary/session/root binding mismatch; no fresh-root reset');
  if (binding.tool === R10_TOOL) {
    if (
      !round ||
      round.session !== binding.session ||
      round.freeze !== binding.freeze ||
      path.join(round.root, 'real', binding.sample) !== binding.root
    )
      throw Error('R10 session/root binding mismatch; no fresh-root reset');
    if (stopped) throw Error('R10 round stopped after failure; no retry, continue or counter');
  }
  const owned = rows.filter((r) => r.tool === binding.tool);
  if (owned.some((r) => r.session !== binding.session || r.freeze !== binding.freeze))
    throw Error('Sample already belongs to another preparation; no fresh-root reset');
  if (owned.some((r) => r.sample === binding.sample && (r.rawId !== binding.rawId || r.jobId !== binding.jobId)))
    throw Error('Sample job identity changed; no fresh job or root reset');
}
export async function reserve(root, binding, remaining, otherRemaining) {
  // The lock covers only the durable reservation, never the network wait.
  if (path.resolve(root) !== REAL_LEDGER_ROOT) await fs.mkdir(root, { recursive: true });
  const lock = await fs.open(path.join(root, 'reservation.lock'), 'wx');
  try {
    const state = await readLedger(root);
    checkBudget(state.counts, binding.sample, remaining, otherRemaining);
    checkLedgerBinding(state, binding);
    const row = { ...binding, sequence: state.counts.total + 1, state: 'pending', at: new Date().toISOString() };
    await durable(path.join(root, `attempt-${String(row.sequence).padStart(2, '0')}.json`), row);
    return row;
  } finally {
    await lock.close();
    await fs.unlink(path.join(root, 'reservation.lock'));
  }
}
export async function stores(root) {
  const rawStore = new RawStore(root),
    rawStates = new RawStateStore(root),
    jobs = new ExtractionJobStore(root),
    drafts = new DraftStore(root);
  await Promise.all([rawStore.initialize(), rawStates.initialize(), jobs.initialize(), drafts.initialize()]);
  return { rawStore, rawStates, jobs, drafts };
}
export function runnerFor(root, state, provider, rulesDir = path.resolve('rules')) {
  return new ExtractionRunner({
    root,
    ...state,
    provider: () => provider,
    rulesDir,
    llm: new LLMService(rulesDir),
    draftRules: async () => {
      const b = await loadExtractionRules(rulesDir);
      return {
        types: b.fmcg.types.map((t) => t.id).filter((t) => !['source', 'synthesis'].includes(t)),
        categories: b.fmcg.categories.map((c) => c.id),
        ...b.fmcg.enums,
      };
    },
  });
}
export function stageOf(request, offlineMaintenance = false) {
  if (offlineMaintenance && request.system.startsWith('知识维护提议')) return 'maintenance';
  return request.system.startsWith('KB03 ')
    ? JSON.parse(request.user).stage
    : request.user.includes('请对下列全部已验证事实规划知识页')
      ? 'planning'
      : 'extracting';
}
export async function caseState(root, offlineMaintenance = false) {
  const state = await stores(root),
    jobs = await state.jobs.list(),
    checkpoints = await new ExtractionCheckpointStore(root).list();
  if (jobs.length > 1 || checkpoints.length > 1) throw Error('Unexpected extra job/checkpoint; no automatic reset');
  const cp = checkpoints[0],
    job = jobs[0];
  const maintenanceRemaining = offlineMaintenance && job?.status !== 'completed' && !cp?.maintenance?.proposal ? 1 : 0;
  return { state, cp, job, remaining: (cp ? deepRemaining(cp) : 5) + maintenanceRemaining };
}
export async function executeCase({
  root,
  rawId,
  provider,
  ledger,
  binding,
  otherRemaining,
  continueExplicit = false,
  offlineMaintenance = false,
}) {
  if (binding.tool === R10_TOOL && continueExplicit) throw Error('R10 forbids --continue or retry of this round');
  const before = await caseState(root, offlineMaintenance);
  if (before.job && before.job.status !== 'completed' && !continueExplicit)
    throw Error(
      binding.tool === R10_TOOL
        ? 'R10 failed/interrupted job cannot reenter or retry'
        : 'Existing failed/interrupted case requires --continue; pending calls may already have reached Provider',
    );
  const ledgerState = await readLedger(ledger);
  checkBudget(ledgerState.counts, binding.sample, before.remaining, otherRemaining);
  checkLedgerBinding(ledgerState, { ...binding, root, rawId, jobId: before.job?.id });
  const raw = await before.state.rawStore.get(rawId);
  if (!raw || sha(raw.body) !== binding.sampleSha) throw Error('Raw SHA mismatch');
  const original = provider.complete.bind(provider);
  let ownCalls = 0;
  const wrapped = {
    name: provider.name,
    model: provider.model,
    cacheIdentity: provider.cacheIdentity,
    secrets: provider.secrets,
    complete: async (request) => {
      const current = await caseState(root, offlineMaintenance);
      const attempt = await reserve(
        ledger,
        { ...binding, root, rawId, stage: stageOf(request, offlineMaintenance), jobId: current.cp?.jobId },
        current.remaining,
        otherRemaining,
      );
      ownCalls++;
      const prefix = path.join(ledger, `attempt-${String(attempt.sequence).padStart(2, '0')}`);
      // Inputs are exactly the product request: no reference notes or independent oracle.
      assertNoKnownSecret(request.system, provider.secrets);
      assertNoKnownSecret(request.user, provider.secrets);
      await durable(prefix + '.request.json', {
        system: request.system,
        user: request.user,
        structuredOutput: request.structuredOutput,
      });
      try {
        const result = await original(request);
        let safe = result.text;
        try {
          if (containsKnownSecret(result.text, provider.secrets)) throw Error('credential');
          assertNoKnownSecret(result.text, provider.secrets);
          try {
            assertNoKnownSecret(JSON.parse(result.text), provider.secrets);
          } catch (e) {
            if (e.code === 'LLM_OUTPUT_CONTAINS_SECRET') throw e;
          }
        } catch {
          safe = '[redacted: credential-bearing candidate omitted]';
        }
        await durable(prefix + '.result.json', { state: 'received', ...result, text: safe, textSha: sha(result.text) });
        return result;
      } catch (error) {
        await durable(prefix + '.error.json', {
          state: 'failed-or-unknown',
          code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
          message: sanitizeProviderText(error.message, provider.secrets),
        });
        throw error;
      }
    },
  };
  const runner = runnerFor(root, before.state, wrapped);
  if (continueExplicit) await runner.reconcile(); // disk-only recovery; no automatic Provider calls
  const started = await runner.start(rawId, { newJobId: randomUUID(), now: new Date().toISOString(), mode: 'deep' });
  await runner.waitForSettlement(started.job.id);
  const view = await runner.readJob(started.job.id),
    afterRaw = await before.state.rawStore.get(rawId);
  if (afterRaw.bodySha256 !== binding.sampleSha || sha(afterRaw.body) !== binding.sampleSha) throw Error('Raw changed');
  const draft = view.job?.draftId ? await before.state.drafts.get(view.job.draftId) : undefined;
  if (binding.tool === R10_TOOL && view.job?.status !== 'completed')
    await stopR10Round(ledger, {
      code: view.job?.error?.code ?? 'R10_EXECUTION_FAILED',
      reason: sanitizeProviderText(view.job?.error?.message ?? 'R10 execution did not complete', provider.secrets),
    });
  const after = await readLedger(ledger);
  return {
    job: view.job,
    execution: view.execution,
    recovery: view.recovery,
    draft,
    ownCalls,
    totalCalls: after.counts.total,
    counts: after.counts,
    historicalCalls: after.history?.total ?? 0,
  };
}
function fillWire(value, schema) {
  if (value === null) return value;
  if (schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [
        key,
        value[key] === undefined ? null : fillWire(value[key], child),
      ]),
    );
  if (schema.items) return value.map((v) => fillWire(v, schema.items));
  return value;
}
export function fakeWireReply(wire) {
  const request = { system: wire.messages[0].content, user: wire.messages[1].content },
    stage = stageOf(request, true);
  let value;
  if (stage === 'maintenance') value = maintenanceReply(request.user);
  else if (['outline', 'writing', 'quality'].includes(stage)) value = deepReply(request);
  else {
    const p = JSON.parse(request.user.split('\n').at(-1));
    value =
      stage === 'extracting'
        ? {
            version: 2,
            facts: p
              .filter((a) => a.text.trim())
              .slice(0, 32)
              .map((a) => ({ atomId: a.id, kind: a.fragment ? 'ambiguous' : 'fact' })),
            questions: [],
            sourceNotes: [],
          }
        : {
            version: 3,
            document: { title: '虚构工程样例', main_topic: '工程协议', source_level: 'D' },
            pages: [
              {
                title: '虚构工程样例',
                type: 'concept',
                category: 'industry_basics',
                factUnitIds: p.factUnits.map((f) => f.id),
                questionUnitIds: p.questionUnits.map((q) => q.id),
              },
            ],
          };
  }
  if (wire.response_format?.type === 'json_schema') value = fillWire(value, wire.response_format.json_schema.schema);
  return { stage, value };
}
export async function fakeCase(
  root,
  body,
  {
    fault,
    continueExplicit = false,
    ledger = path.join(root, 'ledger'),
    sample = 'fixed',
    otherRemaining = 0,
    session = 'fake',
    freeze = 'fake',
    tool,
  } = {},
) {
  await assertOfflineTarget(root);
  await assertOfflineTarget(ledger);
  temporary(root);
  const state = await stores(root);
  let raw = (await state.rawStore.list())[0];
  if (!raw)
    raw = await state.rawStore.create({
      title: '虚构工程样例',
      sourceType: 'article',
      sourceName: '仅fake',
      tags: [],
      body,
    });
  const wires = [],
    prior = globalThis.fetch;
  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6.1-terra',
    apiKey: 'synthetic-quality-secret',
    source: 'env',
  });
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.openai.com/v1/chat/completions')
      throw Error('Fake refuses any unexpected destination');
    const wire = JSON.parse(options.body),
      reply = fakeWireReply(wire);
    wires.push({
      stage: reply.stage,
      strict: !!wire.response_format?.json_schema?.strict,
      nullableFields: wire.response_format?.json_schema ? JSON.stringify(reply.value).includes(':null') : false,
    });
    const text = fault ? fault(reply.stage, reply.value, wires.length) : JSON.stringify(reply.value);
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    return {
      ...(await executeCase({
        root,
        rawId: raw.id,
        provider,
        ledger,
        binding: { sample, sampleSha: sha(body), freeze, session, ...(tool ? { tool } : {}) },
        otherRemaining,
        continueExplicit,
        offlineMaintenance: true,
      })),
      wires,
      configReads: 0,
      realRequests: 0,
    };
  } finally {
    globalThis.fetch = prior;
  }
}
