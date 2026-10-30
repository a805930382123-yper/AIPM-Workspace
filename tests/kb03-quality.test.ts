import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
// The acceptance CLI deliberately remains directly runnable ESM; its fake path loads no config.
// @ts-expect-error acceptance ESM support has no declaration file
import { COUNTER, sha, durable, json, fakeCase, ledgerEntries, reserve } from './support/kb03-quality-runner.mjs';
// @ts-expect-error acceptance ESM entry has no declaration file
import { freeze, validateRelease, TOOL, FIXED_SHA } from './acceptance/KB03-R5-20261030-real.mjs';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'kb03-quality-'));
test('R5 actual adapter strict wire and optional-null decoding completes N+4; completed replay sends zero', async () => {
  const root = await temp();
  const first = await fakeCase(root, COUNTER);
  assert.equal(first.job.status, 'completed'); assert.equal(first.ownCalls, 5); assert.equal(first.totalCalls, 5);
  assert.deepEqual(first.wires.map((w: any) => w.stage), ['extracting', 'planning', 'outline', 'writing', 'quality']);
  assert.deepEqual(first.wires.map((w: any) => w.strict), [true, true, false, false, false]);
  assert.equal(first.wires[1].nullableFields, true); assert.equal(first.configReads, 0); assert.equal(first.realRequests, 0);
  assert(first.draft.structuredNote); assert.equal(first.draft.extractionMode, 'deep');
  const again = await fakeCase(root, COUNTER);
  assert.equal(again.ownCalls, 0); assert.equal(again.totalCalls, 5); assert.equal(again.draft.id, first.draft.id);
});

for (const stage of ['extracting', 'planning', 'outline', 'writing', 'quality']) test(`R5 ${stage} invalid JSON charged once; no automatic retry; explicit continue keeps ledger and job`, async () => {
  const root = await temp();
  const failed = await fakeCase(root, COUNTER, { fault: (current: string, value: unknown) => current === stage ? '{invalid' : JSON.stringify(value) });
  const expected = ['extracting', 'planning', 'outline', 'writing', 'quality'].indexOf(stage) + 1;
  assert.equal(failed.job.status, 'failed'); assert.equal(failed.ownCalls, expected); assert.equal(failed.draft, undefined);
  const before = await ledgerEntries(path.join(root, 'ledger'));
  await assert.rejects(fakeCase(root, COUNTER), /requires --continue/);
  assert.deepEqual(await ledgerEntries(path.join(root, 'ledger')), before);
  const resumed = await fakeCase(root, COUNTER, { continueExplicit: true });
  assert.equal(resumed.job.status, 'completed'); assert.equal(resumed.job.id, failed.job.id); assert.equal(resumed.totalCalls, 6);
  assert.equal(resumed.ownCalls, 6 - expected); assert.equal(resumed.job.callCount, 6);
});

test('R5 escaped credential candidate is rejected and no credential reaches durable trace', async () => {
  const root = await temp();
  const secret = 'synthetic-quality-secret';
  const result = await fakeCase(root, COUNTER, { fault: (stage: string, value: any) => {
    if (stage !== 'writing') return JSON.stringify(value);
    value.orientation = secret; return JSON.stringify(value).replaceAll('synthetic', '\\u0073ynthetic');
  } });
  assert.equal(result.job.status, 'failed'); assert.equal(result.job.error.code, 'LLM_OUTPUT_CONTAINS_SECRET'); assert.equal(result.totalCalls, 4);
  const files = await fs.readdir(path.join(root, 'ledger'));
  for (const file of files) assert(!(await fs.readFile(path.join(root, 'ledger', file), 'utf8')).includes(secret));
  const receipt = await json(path.join(root, 'ledger', 'attempt-04.result.json'));
  assert.equal(receipt.text, '[redacted: credential-bearing candidate omitted]');
});

test('R5 durable pre-reservation retains pending across actual child exit and spends 1..12 globally', async () => {
  const root = await temp(), modulePath = path.resolve('tests/support/kb03-quality-runner.mjs');
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {reserve} from ${JSON.stringify(new URL('file:///' + modulePath.replaceAll('\\', '/')).href)};await reserve(${JSON.stringify(root)},{sample:'fixed',sampleSha:'frozen',session:'A',freeze:'v1',stage:'extracting'},5,5);process.exit(17);`], { windowsHide: true, encoding: 'utf8' });
  assert.equal(child.status, 17, child.stderr);
  const pending = await ledgerEntries(root); assert.equal(pending.length, 1); assert.equal(pending[0].state, 'pending');
  // A changed process/session/version cannot erase the occupied slot.
  await reserve(root, { sample: 'fixed', sampleSha: 'frozen', session: 'B', freeze: 'v2', stage: 'extracting' }, 5, 5);
  await assert.rejects(reserve(root, { sample: 'fixed' }, 5, 6), /budget/);
  for (let i = 2; i < 12; i++) await reserve(root, { sample: i < 6 ? 'fixed' : 'counter' }, 1, 0);
  assert.equal((await ledgerEntries(root)).length, 12);
  await assert.rejects(reserve(root, { sample: 'counter' }, 1, 0), /budget/);
  assert.equal((await ledgerEntries(root))[0].session, 'A');
});

test('R5 failed ledger write refuses before adapter/network and immutable records refuse overwrite', async () => {
  const root = await temp(); await fs.writeFile(path.join(root, 'blocked'), 'file');
  await assert.rejects(fakeCase(path.join(root, 'case'), COUNTER, { ledger: path.join(root, 'blocked') }));
  const record = path.join(root, 'immutable.json'); await durable(record, { count: 1 });
  await assert.rejects(durable(record, { count: 0 }), { code: 'EEXIST' }); assert.deepEqual(await json(record), { count: 1 });
  assert.equal(sha(COUNTER).length, 64);
});

test('R5 release SHA, explicit approval, freeze drift, 5+5+2 and exact TEMP root fail offline before config', async () => {
  const root = await temp(), version = await freeze();
  const ledgerRoot = path.join(os.tmpdir(), `KB03-R5-20261030-${sha(path.resolve('.').toLowerCase()).slice(0, 12)}-real-ledger`);
  const manifest = { tool: TOOL, session: 'offline-test', root, ledgerRoot, freeze: version.digest, samples: { fixed: { dataRoot: path.join(root, 'real', 'fixed'), sha: FIXED_SHA }, counter: { dataRoot: path.join(root, 'real', 'counter'), sha: sha(COUNTER) } } };
  await durable(path.join(root, 'manifest.json'), manifest);
  const release = { approved: true, tool: TOOL, session: manifest.session, freeze: version.digest, ledgerRoot, manifestSha: sha(await fs.readFile(path.join(root, 'manifest.json'))), authorization: 'offline fixture only; never actual run', expectedModel: 'fake', expectedEndpointSha: sha('fake'), configFile: path.join(root, 'MUST-NOT-BE-READ.env'), budget: { total: 12, fixed: 5, counter: 5, diagnostic: 2 } };
  for (const [index, mutation, expected] of [
    [0, { approved: false }, /binding/], [1, { freeze: 'changed' }, /binding/], [2, { budget: { total: 13 } }, /5\+5\+2/],
  ] as const) {
    const file = path.join(root, `release-${index}.json`); await durable(file, { ...release, ...mutation });
    await assert.rejects(validateRelease(root, file, 'wrong'), /SHA/);
    await assert.rejects(validateRelease(root, file, sha(await fs.readFile(file))), expected);
  }
  const moved = { ...manifest, samples: { ...manifest.samples, fixed: { ...manifest.samples.fixed, dataRoot: path.resolve('workspace') } } };
  const manifestFile = path.join(root, 'manifest.json'); await fs.writeFile(manifestFile, JSON.stringify(moved));
  const file = path.join(root, 'outside-root-release.json'); await durable(file, { ...release, manifestSha: sha(await fs.readFile(manifestFile)) });
  await assert.rejects(validateRelease(root, file, sha(await fs.readFile(file))), /exact isolated/);
  await assert.rejects(fs.stat(release.configFile), { code: 'ENOENT' });
});
