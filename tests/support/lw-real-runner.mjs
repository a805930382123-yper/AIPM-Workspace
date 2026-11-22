import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lwFixture } from '../lw01-fixture.ts';
import { lw02Fixture } from '../lw02-fixture.ts';
import { OpenAiCompatibleProvider, assertNoKnownSecret, sanitizeProviderText } from '../../services/llm/provider.ts';
import { containsKnownSecret } from '../../services/llm/config.ts';
export const sha = (v) => createHash('sha256').update(v).digest('hex');
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TOOL = 'LW-REAL-20261105-v1';
export const LEDGER = path.join(os.tmpdir(), 'LW-REAL-20261105-' + sha(REPO.toLowerCase()).slice(0, 12) + '-ledger');
export const INPUTS = {
  A: '以下均为虚构验收资料。星桥区域2025年直营网点目标100家，已开业80家。不含经销和线上渠道。异常审批负责人未指定。',
  B: '以下均为虚构验收资料。星桥区域2026年直营网点目标120家，已开业90家。不含经销和线上渠道。异常审批负责人仍未指定。AI分析仅为建议，尚未上线，没有收益验证。',
  C: '以下均为虚构验收资料。海岚区域2026年经销网点目标300家，已开业210家。',
};
export const QUESTIONS = {
  qa: '星桥区域2025和2026年的直营网点目标与已开业情况有什么不同？能否直接相加？负责人和AI收益是否已经确定？请区分事实、推断和不足。',
  requery: '星桥区域的年度口径能直接合并吗？哪些结论来自原始资料，哪些属于分析？',
  no_evidence: '海岚区域2027年净利润是多少？',
};
export async function durable(file, v) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const h = await fs.open(file, 'wx', 0o600);
  try {
    await h.writeFile(JSON.stringify(v, null, 2) + '\n');
    await h.sync();
  } finally {
    await h.close();
  }
}
export const json = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
export function temp(root) {
  const r = path.resolve(root),
    rel = path.relative(os.tmpdir(), r);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Requires isolated TEMP child');
  return r;
}
export async function entries(ledger) {
  const names = (
    await fs.readdir(ledger).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    })
  )
    .filter((n) => /^attempt-\d{2}\.json$/.test(n))
    .sort();
  const rows = await Promise.all(names.map((n) => json(path.join(ledger, n))));
  if (rows.length > 12 || rows.some((r, i) => r.sequence !== i + 1 || r.state !== 'pending'))
    throw Error('Invalid LW ledger');
  return rows;
}
export async function reserve(ledger, binding, reserveAfter = 0) {
  await fs.mkdir(ledger, { recursive: true });
  const lock = await fs.open(path.join(ledger, 'reservation.lock'), 'wx');
  try {
    const rows = await entries(ledger);
    if (rows.length + 1 + reserveAfter > 12) throw Error('LW 12-request budget insufficient');
    if (rows.some((r) => r.session !== binding.session || r.freeze !== binding.freeze))
      throw Error('Ledger belongs to another preparation; cannot reset');
    const row = { ...binding, state: 'pending', sequence: rows.length + 1, at: new Date().toISOString() };
    await durable(path.join(ledger, `attempt-${String(row.sequence).padStart(2, '0')}.json`), row);
    return row;
  } finally {
    await lock.close();
    await fs.unlink(path.join(ledger, 'reservation.lock'));
  }
}
export async function freeze() {
  const files = [];
  async function walk(dir) {
    for (const d of (await fs.readdir(path.join(REPO, dir), { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const f = path.posix.join(dir, d.name);
      if (d.isDirectory()) await walk(f);
      else if (d.isFile()) files.push([f, sha(await fs.readFile(path.join(REPO, f)))]);
    }
  }
  for (const dir of ['app', 'server', 'services', 'rules', 'tests/support']) await walk(dir);
  for (const f of [
    'tests/acceptance/LW-REAL-20261105.mjs',
    'tests/lw01-fixture.ts',
    'tests/lw02-fixture.ts',
    'docs/handoffs/LW-REAL-20261105-task.md',
    'package.json',
    'package-lock.json',
  ])
    files.push([f, sha(await fs.readFile(path.join(REPO, f)))]);
  return { tool: TOOL, files, digest: sha(JSON.stringify(files)) };
}
export async function open(root) {
  root = temp(root);
  const f = await lwFixture(path.join(root, 'data')),
    q = await lw02Fixture(path.join(root, 'data'));
  f.setTopics(['星桥区域直营网点']);
  q.mode('raw');
  return { f, q };
}
export async function prepare(root) {
  root = root ? temp(root) : await fs.mkdtemp(path.join(os.tmpdir(), 'lw-real-'));
  if (root === LEDGER || root.startsWith(LEDGER + path.sep)) throw Error('Offline root cannot be the real LW ledger');
  if (
    await fs.stat(path.join(root, 'manifest.json')).then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      },
    )
  )
    throw Error('Preparation already exists; no reseed');
  const v = await freeze(),
    { f } = await open(root),
    raws = {};
  for (const name of ['A', 'B', 'C'])
    raws[name] = await f.rawStore.create({
      title: name === 'C' ? '海岚区域经销网点' : '星桥区域直营网点' + (name === 'A' ? '2025' : '2026'),
      sourceType: 'report',
      sourceName: '完全虚构验收',
      tags: [name === 'C' ? '海岚' : '星桥', '直营网点'],
      body: INPUTS[name],
    });
  const create = (title, body, sources) =>
    f.wiki.create({
      title,
      body,
      sources,
      type: 'metric',
      category: 'channel',
      tags: [title, '年度口径'],
      aliases: [],
      knowledge_status: 'source_supported',
      confidence: 'low',
      source_level: 'D',
      review_status: 'reviewed',
    });
  const target = await create('星桥区域直营网点', INPUTS.A + '\n人工约定：年度数据必须分别展示，不跨年直接相加。', [
    raws.A.id,
  ]);
  const distractor = await create('海岚区域经销网点', INPUTS.C, [raws.C.id]);
  const m = {
    tool: TOOL,
    root,
    dataRoot: path.join(root, 'data'),
    ledger: LEDGER,
    session: randomUUID(),
    freeze: v.digest,
    inputShas: Object.fromEntries(Object.entries(INPUTS).map(([k, x]) => [k, sha(x)])),
    rawIds: Object.fromEntries(Object.entries(raws).map(([k, x]) => [k, x.id])),
    targetWikiId: target.id,
    distractorWikiId: distractor.id,
    ids: {
      extract: randomUUID(),
      qa: randomUUID(),
      requery: randomUUID(),
      no_evidence: randomUUID(),
      saveKey: randomUUID(),
    },
    limit: 12,
  };
  await durable(path.join(root, 'manifest.json'), m);
  await durable(path.join(root, 'freeze.json'), v);
  await durable(path.join(root, 'release-template.json'), {
    approved: false,
    tool: TOOL,
    root,
    session: m.session,
    freeze: m.freeze,
    manifestSha: sha(await fs.readFile(path.join(root, 'manifest.json'))),
    ledger: LEDGER,
    limit: 12,
    inputShas: m.inputShas,
    expectedModel: 'gpt-6.1-terra',
    expectedEndpointSha: sha('https://api.openai.com/v1'),
    configFile: path.join(REPO, '.env.local'),
    authorization: '',
  });
  return m;
}
export async function validate(root, file, releaseSha) {
  root = temp(root);
  const m = await json(path.join(root, 'manifest.json')),
    bytes = await fs.readFile(file),
    r = JSON.parse(bytes);
  if (
    sha(bytes) !== releaseSha ||
    r.approved !== true ||
    r.tool !== TOOL ||
    m.tool !== TOOL ||
    m.root !== root ||
    m.dataRoot !== path.join(root, 'data') ||
    r.root !== root ||
    r.session !== m.session ||
    r.freeze !== m.freeze ||
    (await freeze()).digest !== m.freeze ||
    r.manifestSha !== sha(await fs.readFile(path.join(root, 'manifest.json'))) ||
    r.ledger !== LEDGER ||
    m.ledger !== LEDGER ||
    r.limit !== 12 ||
    m.limit !== 12 ||
    typeof r.authorization !== 'string' ||
    r.authorization.length < 10 ||
    !r.expectedModel ||
    !/^[a-f0-9]{64}$/.test(r.expectedEndpointSha) ||
    !path.isAbsolute(r.configFile)
  )
    throw Error('Release/freeze/root/limit binding invalid');
  if (
    JSON.stringify(r.inputShas) !== JSON.stringify(m.inputShas) ||
    JSON.stringify(m.inputShas) !==
      JSON.stringify(Object.fromEntries(Object.entries(INPUTS).map(([k, v]) => [k, sha(v)])))
  )
    throw Error('Frozen sample SHA changed');
  const { f } = await open(root);
  for (const k of ['A', 'B', 'C']) {
    const raw = await f.rawStore.get(m.rawIds[k]);
    if (!raw || sha(raw.body) !== m.inputShas[k]) throw Error('Sample SHA mismatch');
  }
  return m;
}
const FUTURE = { extract: 4, qa: 3, save: 2, requery: 1, no_evidence: 0 };
export function metered(provider, ledger, binding) {
  return {
    name: provider.name,
    model: provider.model,
    cacheIdentity: provider.cacheIdentity,
    secrets: provider.secrets,
    complete: async (request) => {
      const attempt = await reserve(
        ledger,
        { ...binding, stage: request.system.startsWith('KB03') ? 'deep' : binding.phase },
        FUTURE[binding.phase],
      );
      const prefix = path.join(ledger, `attempt-${String(attempt.sequence).padStart(2, '0')}`),
        started = Date.now();
      assertNoKnownSecret(request.system, provider.secrets);
      assertNoKnownSecret(request.user, provider.secrets);
      await durable(prefix + '.request.json', {
        system: request.system,
        user: request.user,
        structuredOutput: request.structuredOutput,
        timeoutMs: request.timeoutMs,
      });
      try {
        const result = await provider.complete(request);
        let text = result.text;
        try {
          if (containsKnownSecret(text, provider.secrets)) throw Error('secret');
          assertNoKnownSecret(JSON.parse(text), provider.secrets);
        } catch (e) {
          if (e.code === 'LLM_OUTPUT_CONTAINS_SECRET' || containsKnownSecret(text, provider.secrets))
            text = '[redacted credential candidate]';
        }
        await durable(prefix + '.result.json', {
          ...result,
          text,
          textSha: sha(result.text),
          elapsedMs: Date.now() - started,
        });
        return result;
      } catch (e) {
        await durable(prefix + '.error.json', {
          code: String(e.code ?? 'UNKNOWN'),
          message: sanitizeProviderText(e.message, provider.secrets),
          elapsedMs: Date.now() - started,
        });
        throw e;
      }
    },
  };
}
export async function preflightPhase(root, name, { continueExplicit = false, ledger } = {}) {
  const m = await json(path.join(root, 'manifest.json'));
  if (!Object.hasOwn(FUTURE, name)) throw Error('Unknown phase');
  const { f, q } = await open(root),
    rows = await entries(ledger ?? m.ledger);
  if (rows.some((r) => r.session !== m.session || r.freeze !== m.freeze))
    throw Error('Ledger identity mismatch; cannot reset with new root');
  if (rows.length + (name === 'extract' ? 3 : name === 'save' ? 1 : 2) + FUTURE[name] > 12)
    throw Error('Insufficient budget for phase and core stages');
  if (rows.some((r) => r.phase === name) && !continueExplicit)
    throw Error('Existing phase requires explicit --continue or local read; no automatic resend');
  if (name !== 'extract') {
    const jobs = await f.jobs.list(),
      d = jobs[0]?.draftId && (await f.drafts.get(jobs[0].draftId));
    if (!d || d.status !== 'confirmed') throw Error('Inspect LW01 draft and explicitly HUMAN confirm before QA');
  }
  if (['requery', 'no_evidence'].includes(name)) {
    const a = await q.answers.get(m.ids.qa),
      d = a?.draftId && (await f.drafts.getKnowledge(a.draftId));
    if (!d || d.status !== 'confirmed')
      throw Error('Inspect save draft and explicitly HUMAN confirm before continuing');
  }
  return { m, f, q };
}
export async function phase(root, name, provider, { selection, continueExplicit = false, ledger } = {}) {
  const { m, f, q } = await preflightPhase(root, name, { continueExplicit, ledger });
  if (name === 'save' && !selection) throw Error('Provide explicit reviewed selection');
  const p = metered(provider, ledger ?? m.ledger, { session: m.session, freeze: m.freeze, phase: name });
  Object.assign(f.provider, { name: p.name, model: p.model, secrets: p.secrets, cacheIdentity: p.cacheIdentity });
  f.provider.complete = p.complete;
  Object.assign(q.provider, { name: p.name, model: p.model, secrets: p.secrets, cacheIdentity: p.cacheIdentity });
  q.provider.complete = p.complete;
  let result;
  if (name === 'extract') {
    if (continueExplicit) await f.runner.reconcile();
    const s = await f.runner.start(m.rawIds.B, {
      mode: 'standard',
      newJobId: m.ids.extract,
      now: new Date().toISOString(),
    });
    await f.runner.waitForSettlement(s.job.id);
    result = await f.runner.readJob(s.job.id);
  } else if (name === 'save') {
    if (!selection) throw Error('Provide an explicit reviewed QuestionPreview JSON; no automatic selection');
    const a = await q.answers.get(m.ids.qa);
    result = await q.answers.save(a.id, { key: m.ids.saveKey, resultRevision: a.revision, preview: selection });
  } else result = await q.answers.ask({ requestId: m.ids[name], question: QUESTIONS[name], retry: continueExplicit });
  await durable(path.join(root, `out-${name}-${Date.now()}-${randomUUID()}.json`), result);
  return result;
}
function fill(value, schema) {
  if (value === null) return value;
  if (schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, value[k] === undefined ? null : fill(value[k], v)]),
    );
  if (schema.items) return value.map((v) => fill(v, schema.items));
  return value;
}
export async function fake(root) {
  const m = await prepare(root),
    ctx = await open(m.root),
    lw = ctx.f.provider.complete.bind(ctx.f.provider),
    qa = ctx.q.provider.complete.bind(ctx.q.provider),
    ledger = path.join(m.root, 'fake-ledger'),
    prior = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.openai.com/v1/chat/completions') throw Error('Fake destination denied');
    const wire = JSON.parse(options.body),
      request = { system: wire.messages[0].content, user: wire.messages[1].content },
      data = JSON.parse(request.user.split('\n').at(-1));
    let out = JSON.parse(
      (await (['knowledge_answer', 'answer_maintenance'].includes(data.stage) ? qa : lw)(request)).text,
    );
    if (data.stage === 'knowledge_answer' && data.question.includes('净利润'))
      out = {
        version: 1,
        sections: [{ kind: 'insufficient', text: '没有2027年净利润依据，门店数不能作为利润。', citationIds: [] }],
        citations: [],
        needsRaw: [],
      };
    else if (data.stage === 'knowledge_answer' && out.sections.length)
      out.sections.push({
        kind: 'inference',
        text: '推断：应分别核对年度口径，不能据此推定收益。',
        citationIds: out.sections[0].citationIds,
      });
    if (wire.response_format?.json_schema) out = fill(out, wire.response_format.json_schema.schema);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6.1-terra',
    apiKey: 'synthetic-lw-secret',
    source: 'env',
  });
  try {
    const extraction = await phase(m.root, 'extract', provider, { ledger });
    if (extraction.job.status !== 'completed') throw Error(JSON.stringify(extraction));
    let f = (await open(m.root)).f;
    await f.confirm(await f.accept(await f.drafts.get(extraction.job.draftId)));
    const answer = await phase(m.root, 'qa', provider, { ledger }),
      q = (await open(m.root)).q;
    const saved = await phase(m.root, 'save', provider, {
      ledger,
      selection: q.preview(answer, { title: '星桥区域直营网点年度口径对照' }),
    });
    await q.commit(await q.approve(saved.draftId));
    await phase(m.root, 'requery', provider, { ledger });
    await phase(m.root, 'no_evidence', provider, { ledger });
    return {
      root: m.root,
      calls: (await entries(ledger)).length,
      configReads: 0,
      realRequests: 0,
      fakeOnlyHumanSimulation: true,
    };
  } finally {
    globalThis.fetch = prior;
  }
}
