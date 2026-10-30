import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// @ts-expect-error Acceptance ESM support deliberately has no declaration file.
import { BUDGET_POLICY, REAL_LEDGER_ROOT, COUNTER, durable, ledgerEntries, reserve, checkBudget, fakeCase, assertOfflineTarget } from './support/kb03-quality-runner.mjs';
// @ts-expect-error Acceptance ESM entry deliberately has no declaration file.
import { TOOL, fake, captureMigration, verifyMigration, prepare } from './acceptance/KB03-R5-20261030-real.mjs';

const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'kb03-r7-test-'));
async function seed(ledger:string,samples:string[]=['fixed','fixed','fixed','fixed']) {
  for(let i=0;i<samples.length;i++)await durable(path.join(ledger,`attempt-${String(i+1).padStart(2,'0')}.json`),{sequence:i+1,sample:samples[i],state:'pending',tool:'KB03-R5-20261030-v1',session:'old',freeze:'old',stage:i===0?'extracting':'planning'});
}

test('R7 isolated v1 four receipts migrate to actual fake 5+5 = total14/fixed9/counter5, preserve history and restart at zero calls',async()=>{
  const root=await temp(),old=path.join(root,'old'),ledger=path.join(root,'fake','ledger');
  await durable(path.join(old,'manifest.json'),{tool:'v1'});await durable(path.join(old,'freeze.json'),{freeze:'v1'});await durable(path.join(old,'state/extraction-jobs/failed.json'),{status:'failed',callCount:4});
  await seed(ledger);await durable(path.join(ledger,'attempt-01.error.json'),{code:'LLM_NETWORK_ERROR'});await durable(path.join(ledger,'attempt-02.result.json'),{state:'received',text:'synthetic'});await durable(path.join(ledger,'attempt-03.error.json'),{code:'LLM_TIMEOUT'});
  const baseline=await captureMigration(old,ledger);await verifyMigration(baseline);
  const result=await fake(root);assert.deepEqual(result.counts,{total:14,fixed:9,counter:5});assert.deepEqual(result.rows.map((r:any)=>r.callCount),[5,5]);assert.equal(result.configReads,0);assert.equal(result.realRequests,0);await verifyMigration(baseline);
  const replay=await fake(root);assert.deepEqual(replay.rows.map((r:any)=>r.callCount),[0,0]);assert.deepEqual(replay.counts,result.counts);
  const moduleURL=pathToFileURL(path.resolve('tests/acceptance/KB03-R5-20261030-real.mjs')).href;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {fake} from ${JSON.stringify(moduleURL)};const r=await fake(${JSON.stringify(root)});console.log(JSON.stringify({calls:r.rows.map(x=>x.callCount),counts:r.counts}));`],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{calls:[0,0],counts:result.counts});await verifyMigration(baseline);
  const attempts=await ledgerEntries(ledger);assert.deepEqual(attempts.map((r:any)=>r.sequence),Array.from({length:14},(_,i)=>i+1));assert.equal(attempts[4].tool,TOOL);
});

test('R7 fixed13/counter8 reject; controlled global21 rejects without claiming twenty legal calls',async()=>{
  assert.deepEqual(BUDGET_POLICY,{total:20,sampleCaps:{fixed:12,counter:7},minimumCalls:5});
  for(const [sample,cap]of [['fixed',12],['counter',7]] as const){
    const root=await temp();await seed(root,sample==='fixed'?Array(12).fill('fixed'):[...Array(4).fill('fixed'),...Array(7).fill('counter')]);
    const before=await ledgerEntries(root);await assert.rejects(reserve(root,{sample},1,0),/cap/);assert.deepEqual(await ledgerEntries(root),before);assert.equal(before.filter((r:any)=>r.sample===sample).length,cap);
  }
  const global=await temp();await seed(global,[...Array(12).fill('fixed'),...Array(8).fill('counter')]);
  // Deliberately invalid per-sample distribution isolates the global20 check only.
  const controlled=await ledgerEntries(global);assert.equal(controlled.length,20);await assert.rejects(reserve(global,{sample:'fixed'},1,0),/20-call budget/);assert.equal((await ledgerEntries(global)).length,20);
});

test('R7 global and each sample must afford all remaining stages before any adapter call',async()=>{
  const root=await temp(),ledger=path.join(root,'ledger');await seed(ledger,Array(8).fill('fixed'));const before=await ledgerEntries(ledger);
  await assert.rejects(fakeCase(path.join(root,'case'),COUNTER,{ledger,sample:'fixed',otherRemaining:5}),/Current sample cap/);assert.deepEqual(await ledgerEntries(ledger),before);
  assert.throws(()=>checkBudget(Array(3).fill({sample:'counter'}),'fixed',5,5),/Other sample cap/);
  assert.throws(()=>checkBudget([...Array(7).fill({sample:'fixed'}),...Array(7).fill({sample:'counter'})],'fixed',5,5),/20-call budget/);
});

test('R7 actual child reserves pending05 then exits; restart retains charge and next explicit reservation is06',async()=>{
  const root=await temp();await seed(root);const moduleURL=pathToFileURL(path.resolve('tests/support/kb03-quality-runner.mjs')).href;
  const binding={sample:'fixed',tool:TOOL,session:'v2',freeze:'v2',rawId:'raw-v2',jobId:'job-v2'};
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {reserve}from ${JSON.stringify(moduleURL)};await reserve(${JSON.stringify(root)},${JSON.stringify(binding)},5,5);process.exit(17);`],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,17,child.stderr);const pending=await ledgerEntries(root);assert.equal(pending.length,5);assert.equal(pending[4].sequence,5);assert.equal(pending[4].state,'pending');
  const next=await reserve(root,binding,5,5);assert.equal(next.sequence,6);assert.equal((await ledgerEntries(root)).length,6);
});

test('R7 new root/session cannot reset a v2 sample or its failed same-job cumulative calls',async()=>{
  const root=await temp(),ledger=path.join(root,'ledger');await seed(ledger);
  const failed=await fakeCase(path.join(root,'fixed'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:TOOL,fault:(stage:string,value:any)=>stage==='planning'?'{invalid':JSON.stringify(value)});
  assert.equal(failed.job.status,'failed');assert.equal(failed.totalCalls,6);const before=await ledgerEntries(ledger);
  await assert.rejects(fakeCase(path.join(root,'replacement'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'replacement',freeze:'v2-freeze',tool:TOOL}),/another v2 preparation|cap/);assert.deepEqual(await ledgerEntries(ledger),before);
  await assert.rejects(fakeCase(path.join(root,'same-session-new-root'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:TOOL}),/job identity/);assert.deepEqual(await ledgerEntries(ledger),before);
  await assert.rejects(fakeCase(path.join(root,'fixed'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:TOOL}),/requires --continue/);
  const done=await fakeCase(path.join(root,'fixed'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:TOOL,continueExplicit:true});assert.equal(done.job.id,failed.job.id);assert.equal(done.job.callCount,6);assert.equal(done.totalCalls,10);assert.equal(done.ownCalls,4);
});

test('R7 old trace/job/manifest changes fail baseline validation and pending reservation remains append-only under concurrency',async()=>{
  const root=await temp(),old=path.join(root,'old'),ledger=path.join(root,'ledger');await durable(path.join(old,'manifest.json'),{tool:'v1'});await durable(path.join(old,'freeze.json'),{freeze:'old'});await seed(ledger);
  const receipt=path.join(ledger,'attempt-01.error.json');await durable(receipt,{code:'old-failure'});
  const ledgerMetadata=path.join(ledger,'historical/metadata.json');await durable(ledgerMetadata,{calls:4});
  const baseline=await captureMigration(old,ledger),saved=await fs.readFile(receipt);await fs.writeFile(receipt,'changed');await assert.rejects(verifyMigration(baseline),/receipt changed/);await fs.writeFile(receipt,saved);await verifyMigration(baseline);
  assert(Object.hasOwn(baseline.ledgerFiles,'historical/metadata.json'));const savedMetadata=await fs.readFile(ledgerMetadata);await fs.writeFile(ledgerMetadata,'changed');await assert.rejects(verifyMigration(baseline),/receipt changed/);await fs.writeFile(ledgerMetadata,savedMetadata);
  const manifest=path.join(old,'manifest.json'),savedManifest=await fs.readFile(manifest);await fs.writeFile(manifest,'changed');await assert.rejects(verifyMigration(baseline),/Historical source/);await fs.writeFile(manifest,savedManifest);
  const outcomes=await Promise.allSettled([reserve(ledger,{sample:'fixed'},1,5),reserve(ledger,{sample:'fixed'},1,5)]);const successes=outcomes.filter(o=>o.status==='fulfilled').length;assert(successes>=1);for(const o of outcomes)if(o.status==='rejected')assert.equal(o.reason.code,'EEXIST');const rows=await ledgerEntries(ledger);assert.equal(rows.length,4+successes);assert.deepEqual(rows.map((r:any)=>r.sequence),Array.from({length:rows.length},(_,i)=>i+1));await verifyMigration(baseline);
});

test('R7 prepare requires explicit existing TEMP input; fake refuses actual ledger before writes',async()=>{
  assert.equal(REAL_LEDGER_ROOT,path.resolve('C:/Users/DAVID~1.CHE/AppData/Local/Temp/KB03-R5-20261030-f66b274a66d2-real-ledger'));
  await assert.rejects(prepare(undefined,undefined),/from-existing/);
  const root=await temp();await assert.rejects(fakeCase(path.join(root,'case'),COUNTER,{ledger:REAL_LEDGER_ROOT}),/never write the real ledger/);await assert.rejects(fs.stat(path.join(root,'case')),{code:'ENOENT'});
  const empty=path.join(root,'absent');assert.deepEqual(await ledgerEntries(empty),[]);await assert.rejects(fs.stat(empty),{code:'ENOENT'});
  await assert.rejects(assertOfflineTarget(REAL_LEDGER_ROOT),/never write the real ledger/);
  await assert.rejects(assertOfflineTarget(path.join(REAL_LEDGER_ROOT,'fake','ledger')),/never write the real ledger/);
});
