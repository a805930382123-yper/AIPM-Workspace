import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// prettier-ignore
// @ts-expect-error Acceptance ESM support deliberately has no declaration file.
import { BUDGET_POLICY, REAL_LEDGER_ROOT, LEGACY_LEDGER_ROOT, R8_ROOT, HISTORY_USAGE, R10_SESSION_FILE, R10_STOP_FILE, COUNTER, durable, json, sha, treeHashes, startR10Session, stopR10Round, ledgerEntries, readLedger, reserve, checkBudget, fakeCase, assertOfflineTarget } from './support/kb03-quality-runner.mjs';
// @ts-expect-error Acceptance ESM entry deliberately has no declaration file.
import { TOOL, fake, captureMigration, verifyMigration, readyToRun } from './acceptance/KB03-R5-20261030-real.mjs';

const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'kb03-r7-test-'));
const LEGACY_TOOL='KB03-R5-20261030-v2';
const V3_TOOL='KB03-R5-20261030-v3';
async function seed(ledger:string,samples:string[]=['fixed','fixed','fixed','fixed']) {
  for(let i=0;i<samples.length;i++)await durable(path.join(ledger,`attempt-${String(i+1).padStart(2,'0')}.json`),{sequence:i+1,sample:samples[i],state:'pending',tool:'KB03-R5-20261030-v1',session:'old',freeze:'old',stage:i===0?'extracting':'planning'});
}
async function history(root:string,ledger:string) {
  const summary={...HISTORY_USAGE,tool:V3_TOOL,session:'v3-session',freeze:'v3-freeze',root,ledgerRoot:ledger};
  await durable(path.join(ledger,'history-summary.json'),summary);return summary;
}
async function r10Fixture(){
  const root=await temp(),ledger=path.join(root,'ledger'),oldRoot=path.join(root,'r8'),newRoot=path.join(root,'r10');
  await durable(path.join(oldRoot,'manifest.json'),{tool:V3_TOOL,syntheticPrior:true});await history(oldRoot,ledger);
  for(let sequence=5;sequence<=14;sequence++){
    const sample=sequence<10?'fixed':'counter',prefix=path.join(ledger,`attempt-${String(sequence).padStart(2,'0')}`);
    await durable(prefix+'.json',{sequence,sample,state:'pending',tool:V3_TOOL,session:'v3-session',freeze:'v3-freeze',root:path.join(oldRoot,'real',sample),rawId:'old-'+sample,jobId:'old-'+sample});
    await durable(prefix+'.request.json',{syntheticPrior:true});await durable(prefix+'.result.json',{state:'received',syntheticPrior:true});
  }
  const round=await startR10Session({root:newRoot,ledger,sourceRoot:oldRoot,session:'v4-session',freeze:'v4-freeze'});
  return {root,ledger,oldRoot,newRoot,round,options:{ledger,tool:TOOL,session:'v4-session',freeze:'v4-freeze',sample:'fixed',otherRemaining:5}};
}

test('R10 original history4/ten receipts preserved; actual new fake6+6 = total26/fixed15/counter11, restart zero',async()=>{
  const root=await temp(),old=path.join(root,'old'),oldLedger=path.join(root,'old-ledger'),ledger=path.join(root,'fake','ledger');
  await durable(path.join(old,'manifest.json'),{tool:'v1'});await durable(path.join(old,'freeze.json'),{freeze:'v1'});await durable(path.join(old,'state/extraction-jobs/failed.json'),{status:'failed',callCount:4});
  await seed(oldLedger);await durable(path.join(oldLedger,'attempt-01.error.json'),{code:'LLM_NETWORK_ERROR'});await durable(path.join(oldLedger,'attempt-02.result.json'),{state:'received',text:'synthetic'});await durable(path.join(oldLedger,'attempt-03.error.json'),{code:'LLM_TIMEOUT'});
  const baseline=await captureMigration(old,oldLedger);await verifyMigration(baseline);
  const result=await fake(root);assert.deepEqual(result.counts,{total:26,fixed:15,counter:11});assert.deepEqual(result.rows.map((r:any)=>r.callCount),[6,6]);assert.equal(result.configReads,0);assert.equal(result.realRequests,0);await verifyMigration(baseline);
  const replay=await fake(root);assert.deepEqual(replay.rows.map((r:any)=>r.callCount),[0,0]);assert.deepEqual(replay.counts,result.counts);
  const moduleURL=pathToFileURL(path.resolve('tests/acceptance/KB03-R5-20261030-real.mjs')).href;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {fake} from ${JSON.stringify(moduleURL)};const r=await fake(${JSON.stringify(root)});console.log(JSON.stringify({calls:r.rows.map(x=>x.callCount),counts:r.counts}));`],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{calls:[0,0],counts:result.counts});await verifyMigration(baseline);
  const attempts=await ledgerEntries(ledger);assert.deepEqual(attempts.map((r:any)=>r.sequence),Array.from({length:22},(_,i)=>i+5));assert.equal(attempts[0].tool,V3_TOOL);assert.equal(attempts[10].tool,TOOL);
  const state=await readLedger(ledger);assert.equal(state.history.receiptsAvailable,false);assert.equal(state.history.proof,'summary-only; not per-request evidence');assert.equal(state.history.total,4);assert.equal(state.rows.length,22);assert.equal(Object.keys(state.round.ledgerFiles).length,31);assert.deepEqual(state.round.priorCounts,{total:14,fixed:9,counter:5});
  for(const [file,digest]of Object.entries(state.round.ledgerFiles))assert.equal(sha(await fs.readFile(path.join(ledger,file))),digest);assert.deepEqual(await treeHashes(state.round.sourceRoot),state.round.sourceFiles);
  for(let n=1;n<=4;n++)await assert.rejects(fs.stat(path.join(ledger,`attempt-0${n}.json`)),{code:'ENOENT'});
});

test('R10 fixed21/counter16/global31 reject with pending consumption retained',async()=>{
  assert.deepEqual(BUDGET_POLICY,{total:30,sampleCaps:{fixed:20,counter:15},minimumCalls:5});
  for(const [sample,cap]of [['fixed',20],['counter',15]] as const){
    const root=await temp();await seed(root,sample==='fixed'?Array(20).fill('fixed'):[...Array(4).fill('fixed'),...Array(15).fill('counter')]);
    const before=await ledgerEntries(root);await assert.rejects(reserve(root,{sample},1,0),/cap/);assert.deepEqual(await ledgerEntries(root),before);assert.equal(before.filter((r:any)=>r.sample===sample).length,cap);
  }
  const global=await temp();await seed(global,[...Array(20).fill('fixed'),...Array(10).fill('counter')]);
  const controlled=await ledgerEntries(global);assert.equal(controlled.length,30);await assert.rejects(reserve(global,{sample:'counter'},1,0),/30-call budget/);assert.equal((await ledgerEntries(global)).length,30);
});

test('R7 global and each sample must afford all remaining stages before any adapter call',async()=>{
  const root=await temp(),ledger=path.join(root,'ledger');await seed(ledger,Array(16).fill('fixed'));const before=await ledgerEntries(ledger);
  await assert.rejects(fakeCase(path.join(root,'case'),COUNTER,{ledger,sample:'fixed',otherRemaining:5}),/Current sample cap/);assert.deepEqual(await ledgerEntries(ledger),before);
  assert.throws(()=>checkBudget({total:11,fixed:0,counter:11},'fixed',5,5),/Other sample cap/);
  assert.throws(()=>checkBudget({total:24,fixed:14,counter:10},'fixed',5,5),/30-call budget/);
});

test('R7 actual child reserves pending05 then exits; restart retains charge and next explicit reservation is06',async()=>{
  const root=await temp();await seed(root);const moduleURL=pathToFileURL(path.resolve('tests/support/kb03-quality-runner.mjs')).href;
  const binding={sample:'fixed',tool:LEGACY_TOOL,session:'v2',freeze:'v2',rawId:'raw-v2',jobId:'job-v2'};
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {reserve}from ${JSON.stringify(moduleURL)};await reserve(${JSON.stringify(root)},${JSON.stringify(binding)},5,5);process.exit(17);`],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,17,child.stderr);const pending=await ledgerEntries(root);assert.equal(pending.length,5);assert.equal(pending[4].sequence,5);assert.equal(pending[4].state,'pending');
  const next=await reserve(root,binding,5,5);assert.equal(next.sequence,6);assert.equal((await ledgerEntries(root)).length,6);
});

test('R7 new root/session cannot reset a v2 sample or its failed same-job cumulative calls',async()=>{
  const root=await temp(),ledger=path.join(root,'ledger');await seed(ledger);
  const failed=await fakeCase(path.join(root,'fixed'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:LEGACY_TOOL,fault:(stage:string,value:any)=>stage==='planning'?'{invalid':JSON.stringify(value)});
  assert.equal(failed.job.status,'failed');assert.equal(failed.totalCalls,6);const before=await ledgerEntries(ledger);
  await assert.rejects(fakeCase(path.join(root,'replacement'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'replacement',freeze:'v2-freeze',tool:LEGACY_TOOL}),/another preparation|cap/);assert.deepEqual(await ledgerEntries(ledger),before);
  await assert.rejects(fakeCase(path.join(root,'same-session-new-root'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:LEGACY_TOOL}),/job identity/);assert.deepEqual(await ledgerEntries(ledger),before);
  await assert.rejects(fakeCase(path.join(root,'fixed'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:LEGACY_TOOL}),/requires --continue/);
  const done=await fakeCase(path.join(root,'fixed'),COUNTER,{ledger,sample:'fixed',otherRemaining:5,session:'v2-session',freeze:'v2-freeze',tool:LEGACY_TOOL,continueExplicit:true});assert.equal(done.job.id,failed.job.id);assert.equal(done.job.callCount,7);assert.equal(done.totalCalls,11);assert.equal(done.ownCalls,5);
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

test('R8 fake refuses fixed local and original real ledgers before writes',async()=>{
  assert.equal(REAL_LEDGER_ROOT,path.resolve('C:/Users/80593/AppData/Local/AIPM-Workspace/acceptance/KB03-R8-20261030/ledger'));
  const root=await temp();await assert.rejects(fakeCase(path.join(root,'case'),COUNTER,{ledger:REAL_LEDGER_ROOT}),/never write the real ledger/);await assert.rejects(fs.stat(path.join(root,'case')),{code:'ENOENT'});
  const empty=path.join(root,'absent');assert.deepEqual(await ledgerEntries(empty),[]);await assert.rejects(fs.stat(empty),{code:'ENOENT'});
  await assert.rejects(assertOfflineTarget(REAL_LEDGER_ROOT),/never write the real ledger/);
  await assert.rejects(assertOfflineTarget(path.join(REAL_LEDGER_ROOT,'fake','ledger')),/never write the real ledger/);
  await assert.rejects(assertOfflineTarget(LEGACY_LEDGER_ROOT),/never write the real ledger/);
  await assert.rejects(assertOfflineTarget(R8_ROOT),/R8 source root/);await assert.rejects(assertOfflineTarget(path.join(R8_ROOT,'new')),/R8 source root/);
  // The CLI's TEMP boundary runs first when the historical R8 root belongs to another Windows profile.
  const relativeR8=path.relative(os.tmpdir(),R8_ROOT);
  const cliRejection=!relativeR8||relativeR8.startsWith('..')||path.isAbsolute(relativeR8)
    ? /^Only a child of system TEMP is allowed$/
    : /^Offline preparation\/fake must never write the real ledger or R8 source root$/;
  await assert.rejects(fake(R8_ROOT),{message:cliRejection});
  const isolatedLedger=path.join(root,'isolated-ledger');
  await assert.rejects(fakeCase(path.join(R8_ROOT,'new'),COUNTER,{ledger:isolatedLedger}),/R8 source root/);
  await assert.rejects(fs.stat(isolatedLedger),{code:'ENOENT'});
});

test('R10 old31/root/session mutations and replacement preparation fail before any adapter call',async()=>{
  const f=await r10Fixture(),sessionFile=path.join(f.ledger,R10_SESSION_FILE),saved=await fs.readFile(sessionFile);let calls=0;
  const options={...f.options,fault:(_stage:string,value:any)=>{calls++;return JSON.stringify(value);}};
  for(const patch of [{session:'changed'},{freeze:'changed'},{root:path.join(f.root,'replacement')},{policy:{...BUDGET_POLICY,total:31}},{priorCounts:{total:0,fixed:0,counter:0}}]){
    await fs.writeFile(sessionFile,JSON.stringify({...f.round,...patch}));await assert.rejects(fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,options),/R10.*binding/i);assert.equal(calls,0);
  }
  await fs.writeFile(sessionFile,saved);
  await fs.unlink(sessionFile);await assert.rejects(fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,options),/R10 session\/root binding/);assert.equal(calls,0);await fs.writeFile(sessionFile,saved);
  const receipt=path.join(f.ledger,'attempt-05.result.json'),receiptBytes=await fs.readFile(receipt);await fs.writeFile(receipt,'changed');await assert.rejects(fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,options),/original receipt changed/);assert.equal(calls,0);await fs.writeFile(receipt,receiptBytes);
  const oldManifest=path.join(f.oldRoot,'manifest.json'),manifestBytes=await fs.readFile(oldManifest);await fs.writeFile(oldManifest,'changed');await assert.rejects(fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,options),/original preparation tree changed/);assert.equal(calls,0);await fs.writeFile(oldManifest,manifestBytes);
  await assert.rejects(startR10Session({root:path.join(f.root,'replacement'),ledger:f.ledger,sourceRoot:f.oldRoot,session:'replacement',freeze:'replacement'}),/already exists/);
  await assert.rejects(readyToRun(f.newRoot,'fixed','unused','unused',true),/forbids --continue/);assert.equal(calls,0);assert.deepEqual((await readLedger(f.ledger)).counts,{total:14,fixed:9,counter:5});
});

test('R10 actual adapter failure keeps pending15/16 and immutable stop rejects retry, counter, reserve and process restart',async()=>{
  const f=await r10Fixture();const failed=await fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,{...f.options,fault:(stage:string,value:any)=>stage==='planning'?'{invalid':JSON.stringify(value)});
  assert.equal(failed.job.status,'failed');assert.equal(failed.ownCalls,2);assert.deepEqual(failed.counts,{total:16,fixed:11,counter:5});assert.equal((await readLedger(f.ledger)).rows.at(-1).sequence,16);
  const stopped=await json(path.join(f.ledger,R10_STOP_FILE));assert.equal(stopped.session,'v4-session');assert.equal(stopped.code,'LLM_INVALID_JSON');
  await assert.rejects(fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,f.options),/cannot reenter/);await assert.rejects(fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,{...f.options,continueExplicit:true}),/forbids --continue/);
  await assert.rejects(fakeCase(path.join(f.newRoot,'real','counter'),COUNTER,{...f.options,sample:'counter',otherRemaining:4}),/round stopped/);
  await assert.rejects(reserve(f.ledger,{tool:TOOL,sample:'counter',session:'v4-session',freeze:'v4-freeze',root:path.join(f.newRoot,'real','counter')},1,0),/round stopped/);
  await assert.rejects(durable(path.join(f.ledger,R10_STOP_FILE),{session:'reset'}),{code:'EEXIST'});
  const moduleURL=pathToFileURL(path.resolve('tests/support/kb03-quality-runner.mjs')).href,child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readLedger,reserve} from ${JSON.stringify(moduleURL)};const s=await readLedger(${JSON.stringify(f.ledger)});let blocked=false;try{await reserve(${JSON.stringify(f.ledger)},{tool:${JSON.stringify(TOOL)},sample:'counter',session:'v4-session',freeze:'v4-freeze',root:${JSON.stringify(path.join(f.newRoot,'real','counter'))}},1,0);}catch(e){blocked=e.message.includes('round stopped');}console.log(JSON.stringify({counts:s.counts,blocked}));`],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{counts:failed.counts,blocked:true});assert.deepEqual((await readLedger(f.ledger)).counts,failed.counts);
});

test('R10 independent quality stop prevents counter even after a completed six-call fixed job',async()=>{
  const f=await r10Fixture(),fixed=await fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,f.options);assert.equal(fixed.job.status,'completed');assert.equal(fixed.ownCalls,6);assert.deepEqual(fixed.counts,{total:20,fixed:15,counter:5});
  const stopped=await stopR10Round(f.ledger,{code:'R10_QUALITY_FAILED',reason:'Independent synthetic quality finding; stop whole round.'});assert.equal(stopped.code,'R10_QUALITY_FAILED');
  await assert.rejects(fakeCase(path.join(f.newRoot,'real','counter'),COUNTER,{...f.options,sample:'counter',otherRemaining:0}),/round stopped/);assert.deepEqual((await readLedger(f.ledger)).counts,fixed.counts);await assert.rejects(fs.stat(path.join(f.ledger,'attempt-21.json')),{code:'ENOENT'});
});

test('R10 pending15 durable-write failure sends zero and stops the round without charging an unsaved reservation',async()=>{
  const f=await r10Fixture(),open=fs.open;let adapterCalls=0;
  fs.open=(async(file:any,...args:any[])=>{if(String(file)===path.join(f.ledger,'attempt-15.json'))throw Object.assign(Error('synthetic pending write denied'),{code:'EACCES'});return (open as any)(file,...args);}) as typeof fs.open;
  try{const failed=await fakeCase(path.join(f.newRoot,'real','fixed'),COUNTER,{...f.options,fault:(_stage:string,value:any)=>{adapterCalls++;return JSON.stringify(value);}});assert.notEqual(failed.job.status,'completed');assert(failed.recovery);assert.equal(adapterCalls,0);assert.equal(failed.ownCalls,0);assert.deepEqual(failed.counts,{total:14,fixed:9,counter:5});assert((await readLedger(f.ledger)).stopped);await assert.rejects(fs.stat(path.join(f.ledger,'attempt-15.json')),{code:'ENOENT'});}finally{fs.open=open;}
});

test('R8 v3 pending05 survives actual process exit; history is counted once and restart appends06',async()=>{
  const root=await temp(),ledger=path.join(root,'ledger');await history(root,ledger);
  const moduleURL=pathToFileURL(path.resolve('tests/support/kb03-quality-runner.mjs')).href;
  const binding={sample:'fixed',tool:V3_TOOL,session:'v3-session',freeze:'v3-freeze',root:path.join(root,'real','fixed'),rawId:'raw-v3',jobId:'job-v3'};
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {reserve} from ${JSON.stringify(moduleURL)};await reserve(${JSON.stringify(ledger)},${JSON.stringify(binding)},5,5);process.exit(17);`],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,17,child.stderr);const before=await readLedger(ledger);assert.deepEqual(before.counts,{total:5,fixed:5,counter:0});assert.equal(before.rows.length,1);assert.equal(before.rows[0].sequence,5);
  const next=await reserve(ledger,binding,5,5);assert.equal(next.sequence,6);assert.deepEqual((await readLedger(ledger)).counts,{total:6,fixed:6,counter:0});
  await assert.rejects(durable(path.join(ledger,'history-summary.json'),HISTORY_USAGE),{code:'EEXIST'});
});

test('R8 v3 summary tamper/loss, another ledger/session/root and a fresh job reject without adapter calls; explicit same-job continue works',async()=>{
  const root=await temp(),ledger=path.join(root,'ledger'),summary=await history(root,ledger),caseRoot=path.join(root,'real','fixed');
  const options={ledger,sample:'fixed',otherRemaining:5,session:'v3-session',freeze:'v3-freeze',tool:V3_TOOL};
  const failed=await fakeCase(caseRoot,COUNTER,{...options,fault:(stage:string,value:any)=>stage==='planning'?'{invalid':JSON.stringify(value)});
  assert.equal(failed.job.status,'failed');assert.equal(failed.ownCalls,2);assert.equal(failed.totalCalls,6);assert.equal(failed.historicalCalls,4);
  const file=path.join(ledger,'history-summary.json'),saved=await fs.readFile(file);let attempted=0;
  const counted={...options,fault:(_stage:string,value:any)=>{attempted++;return JSON.stringify(value);}};
  for(const changed of [{...summary,total:0},{...summary,sampleCounts:{fixed:0,counter:0}},{...summary,session:'changed'},{...summary,ledgerRoot:path.join(root,'replacement-ledger')}]){
    await fs.writeFile(file,JSON.stringify(changed));await assert.rejects(fakeCase(caseRoot,COUNTER,{...counted,continueExplicit:true}),/summary|receipts/i);assert.equal(attempted,0);
  }
  await fs.unlink(file);await assert.rejects(fakeCase(caseRoot,COUNTER,{...counted,continueExplicit:true}),/inconsistent/);assert.equal(attempted,0);await fs.writeFile(file,saved);
  await assert.rejects(fakeCase(caseRoot,COUNTER,{...counted,session:'replacement',continueExplicit:true}),/summary.*binding/i);assert.equal(attempted,0);
  await assert.rejects(fakeCase(path.join(root,'replacement','real','fixed'),COUNTER,counted),/summary.*binding/i);assert.equal(attempted,0);
  await assert.rejects(fakeCase(path.join(root,'new-ledger-case'),COUNTER,{...counted,ledger:path.join(root,'empty-ledger')}),/summary.*binding/i);assert.equal(attempted,0);
  const failedJob=path.join(caseRoot,'state','extraction-jobs',failed.job.id+'.json');
  // Removing the persisted job cannot authorize a replacement job over charged receipts.
  const jobBytes=await fs.readFile(failedJob);await fs.unlink(failedJob);await assert.rejects(fakeCase(caseRoot,COUNTER,{...counted,continueExplicit:true}),/job identity/);assert.equal(attempted,0);await fs.writeFile(failedJob,jobBytes);
  await assert.rejects(fakeCase(caseRoot,COUNTER,options),/requires --continue/);
  const done=await fakeCase(caseRoot,COUNTER,{...options,continueExplicit:true});assert.equal(done.job.status,'completed');assert.equal(done.job.id,failed.job.id);assert.equal(done.job.callCount,7);assert.equal(done.ownCalls,5);assert.deepEqual(done.counts,{total:11,fixed:11,counter:0});
});
