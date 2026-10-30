// Builder may invoke prepare/fake only. Independent acceptance owns actual run/release.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { RawStore } from '../../services/raw/store.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { FROZEN_BUDGETS } from '../../services/llm/rules.ts';
import { sha, COUNTER, durable, json, exists, temporary, stores, caseState, executeCase, ledgerEntries, fakeCase } from '../support/kb03-quality-runner.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TOOL = 'KB03-R5-20261030-v1';
export const FIXED_SHA = 'fe78a0c389fb6937950596086ee3ca3974b3a156acf9da345013a87f3593bc41';
const task = 'docs/handoffs/KB03-R5-20261030-task.md';
const ledgerRoot = path.join(os.tmpdir(), `KB03-R5-20261030-${sha(repo.toLowerCase()).slice(0, 12)}-real-ledger`);
export async function freeze() {
  const entries = [];
  async function walk(dir) {
    for (const item of (await fs.readdir(path.join(repo, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.posix.join(dir, item.name);
      if (item.isDirectory()) await walk(relative);
      else if (item.isFile()) entries.push([relative, sha(await fs.readFile(path.join(repo, relative)))]);
    }
  }
  for (const dir of ['services', 'server', 'app', 'rules', 'tests/support']) await walk(dir);
  for (const file of [task, 'package.json', 'package-lock.json', 'tests/acceptance/KB03-R5-20261030-real.mjs']) entries.push([file, sha(await fs.readFile(path.join(repo, file)))]);
  return { tool: TOOL, files: entries, digest: sha(JSON.stringify(entries)) };
}
export async function prepare(root, source) {
  root = root ? temporary(root) : await fs.mkdtemp(path.join(os.tmpdir(), 'kb03-r5-real-'));
  if (await exists(path.join(root, 'manifest.json'))) throw Error('Existing preparation is immutable; use its manifest, not reseed');
  // Exactly the explicitly authorized Raw; no workspace scan, no reference/oracle loading.
  const fixed = source ?? await new RawStore(path.join(repo, 'workspace')).get('daf6fde4-98e0-478d-8abe-f3abce1031ad');
  if (!fixed || fixed.body.length !== 2434 || sha(fixed.body) !== FIXED_SHA) throw Error('Frozen original Raw does not match authorized SHA/2434 chars');
  const version = await freeze(), session = randomUUID(), samples = {};
  for (const [name, input] of [['fixed', fixed], ['counter', { title: '虚构口径反例', body: COUNTER, sourceType: 'article', sourceName: '完全虚构R5测试', tags: [] }]]) {
    const chunks = chunkText(input.body, { maxChunkChars: FROZEN_BUDGETS.maxChunkChars, overlap: FROZEN_BUDGETS.chunkOverlap, maxRawChars: FROZEN_BUDGETS.maxRawChars });
    if (chunks.length !== 1) throw Error('Frozen 5+5+2 budget requires each exact input N=1');
    const dataRoot = path.join(root, 'real', name), state = await stores(dataRoot);
    const raw = await state.rawStore.create({ title: input.title, sourceType: input.sourceType, sourceName: input.sourceName, tags: input.tags ?? [], author: input.author, publishedAt: input.publishedAt, url: input.url, body: input.body });
    samples[name] = { sha: sha(input.body), chars: input.body.length, utf8Bytes: Buffer.byteLength(input.body), chunks: 1, minimumCalls: 5, rawId: raw.id, dataRoot };
    await durable(path.join(root, 'inputs', name + '.json'), { ...raw, body: input.body });
  }
  const manifest = { tool: TOOL, session, root, ledgerRoot, freeze: version.digest, samples, budget: { total: 12, fixed: 5, counter: 5, diagnostic: 2 }, configReads: 0, realRequests: 0 };
  await durable(path.join(root, 'freeze.json'), version); await durable(path.join(root, 'manifest.json'), manifest);
  await durable(path.join(root, 'release-template.json'), { approved: false, authority: 'Independent acceptance must record existing user authorization; this template is not release', tool: TOOL, session, freeze: version.digest, manifestSha: sha(await fs.readFile(path.join(root, 'manifest.json'))), ledgerRoot, sampleShas: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, v.sha])), budget: manifest.budget, configFile: path.join(repo, '.env.local'), expectedModel: '', expectedEndpointSha: '', authorization: '' });
  return manifest;
}
export async function validateRelease(root, releaseFile, releaseSha) {
  root = temporary(root); const manifest = await json(path.join(root, 'manifest.json'));
  const bytes = await fs.readFile(releaseFile); if (!releaseSha || sha(bytes) !== releaseSha) throw Error('Release SHA required/mismatch');
  const release = JSON.parse(bytes), current = await freeze();
  if (release.approved !== true || release.tool !== TOOL || manifest.tool !== TOOL || manifest.root !== root || release.manifestSha !== sha(await fs.readFile(path.join(root, 'manifest.json'))) || release.session !== manifest.session || release.freeze !== current.digest || manifest.freeze !== current.digest || release.ledgerRoot !== ledgerRoot || manifest.ledgerRoot !== ledgerRoot || typeof release.authorization !== 'string' || release.authorization.trim().length < 10 || typeof release.expectedModel !== 'string' || !release.expectedModel || !/^[a-f0-9]{64}$/.test(release.expectedEndpointSha) || typeof release.configFile !== 'string' || !path.isAbsolute(release.configFile)) throw Error('Release/version/identity/authorization binding is incomplete');
  if (JSON.stringify(release.budget) !== JSON.stringify({ total: 12, fixed: 5, counter: 5, diagnostic: 2 })) throw Error('Budget must remain 5+5+2=12');
  for (const name of ['fixed', 'counter']) {
    const sample = manifest.samples[name];
    if (sample.dataRoot !== path.join(root, 'real', name)) throw Error('Input data root must be the exact isolated case root');
    const raw = await new RawStore(sample.dataRoot).get(sample.rawId), input = await json(path.join(root, 'inputs', name + '.json'));
    const expected = name === 'fixed' ? FIXED_SHA : sha(COUNTER);
    if (release.sampleShas?.[name] !== expected || sample.sha !== expected || sha(input.body) !== expected || !raw || sha(raw.body) !== expected || !path.resolve(sample.dataRoot).startsWith(root + path.sep)) throw Error('Input/data root SHA mismatch');
  }
  return { manifest, release };
}
export async function run(root, name, releaseFile, releaseSha, continueExplicit) {
  if (!['fixed', 'counter'].includes(name)) throw Error('Sample must be fixed or counter');
  const { manifest, release } = await validateRelease(root, releaseFile, releaseSha);
  const sample = manifest.samples[name], other = manifest.samples[name === 'fixed' ? 'counter' : 'fixed'];
  const current = await caseState(sample.dataRoot), otherState = await caseState(other.dataRoot), rows = await ledgerEntries(ledgerRoot);
  if (name === 'counter' && !rows.some(r => r.sample === 'fixed')) throw Error('Fixed sample must be attempted first');
  if (current.job && current.job.status !== 'completed' && !continueExplicit) throw Error('Explicit --continue required; unknown/pending request remains charged');
  if (12 - rows.length < current.remaining + otherState.remaining) throw Error('Insufficient budget to finish both samples');
  // Only this mode, after every offline release/input/budget gate, loads actual config once.
  const { loadLlmConfig } = await import('../../services/llm/config.ts');
  const { OpenAiCompatibleProvider } = await import('../../services/llm/provider.ts');
  const config = await loadLlmConfig({ filePath: release.configFile });
  if (config.model !== release.expectedModel || sha(config.baseUrl) !== release.expectedEndpointSha) throw Error('Configured product Provider identity does not match independent release');
  const provider = new OpenAiCompatibleProvider(config);
  const result = await executeCase({ root: sample.dataRoot, rawId: sample.rawId, provider, ledger: ledgerRoot, binding: { sample: name, sampleSha: sample.sha, freeze: manifest.freeze, session: manifest.session, tool: TOOL }, otherRemaining: otherState.remaining, continueExplicit });
  await durable(path.join(root, `run-${name}-${Date.now()}-${randomUUID()}.json`), { configReads: 1, model: config.model, endpointSha: sha(config.baseUrl), ...result });
  return { configReads: 1, model: config.model, endpointSha: sha(config.baseUrl), ...result };
}
export async function fake(root) {
  root = root ? temporary(root) : await fs.mkdtemp(path.join(os.tmpdir(), 'kb03-r5-fake-'));
  const prepared = await exists(path.join(root, 'manifest.json'));
  const rows = [];
  for (const name of ['fixed', 'counter']) {
    const body = prepared ? (await json(path.join(root, 'inputs', name + '.json'))).body : name === 'fixed' ? '虚构工程样例：门店目标100家，在售20家。负责人未知。' : COUNTER;
    const result = await fakeCase(path.join(root, 'fake', name), body);
    rows.push({ sample: name, status: result.job?.status, callCount: result.ownCalls, wires: result.wires });
    if (result.job?.status !== 'completed' || result.ownCalls !== 5) throw Error('Fake N+4 failed: ' + JSON.stringify(rows.at(-1)));
  }
  await durable(path.join(root, `fake-summary-${Date.now()}.json`), { root, preparedInputs: prepared, configReads: 0, realRequests: 0, rows, qualityVerdict: 'NOT_SCORED: fake engineering only; atom selection is a protocol fixture, not quality evidence' });
  return { root, configReads: 0, realRequests: 0, rows };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, sample, releaseFile, releaseSha, flag] = process.argv.slice(2);
  const result = mode === 'prepare' ? await prepare(root) : mode === 'fake' ? await fake(root) : mode === 'run' ? await run(root, sample, releaseFile, releaseSha, flag === '--continue') : (() => { throw Error('Use prepare [TEMP-root] | fake [TEMP-root] | run TEMP-root fixed|counter release.json releaseSHA [--continue]'); })();
  console.log(JSON.stringify(result, null, 2));
  if (mode === 'run' && result.job?.status !== 'completed') process.exitCode = 1;
}
