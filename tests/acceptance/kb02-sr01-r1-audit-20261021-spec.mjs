import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {storageFixture} from '../support/kb02-storage-fixture.ts';
import {atomicFault} from '../support/kb02-storage-fault.ts';
import {storageHttp} from '../support/kb02-storage-http.ts';
const report={at:new Date().toISOString(),runtime:process.version,controlled:true,externalCalls:0,checks:[]};
async function check(id,fn){if(process.env.SR01_PROBE && process.env.SR01_PROBE!==id)return;try{report.checks.push({id,result:'PASS',details:await fn()});}catch(e){report.checks.push({id,result:'FAIL',error:e.stack});}console.log(id,report.checks.at(-1).result);}
const opts=()=>({newJobId:randomUUID(),now:new Date().toISOString()});
for(const legacy of [false,true]) await check(legacy?'missing-start-proof-refuses':'old-bound-restart-independent-http-recovery',async()=>{
 const f=await storageFixture();let fault,h;
 try{
  const old=(await f.start()).job;await f.wait(old.id);const before=await f.hashes(old.id),calls=f.requests.length;
  fault=atomicFault(f.root,'start-state');let id;
  await assert.rejects(f.start({restart:true}),e=>{id=e.details?.jobId;return e.code==='STORAGE_WRITE_FAILED'&&!!id;});
  assert.equal(fault.events.length,6);fault.release();
  if(legacy)await f.jobs.update(id,{startStateHash:undefined});
  const saved=await f.hashes(id),runner=f.newRunner();h=await storageHttp(f,runner);
  if(legacy){assert.equal((await h.request(`/api/extraction-jobs/${id}/reconcile-storage`,{})).status,409);assert.deepEqual(await f.hashes(id),saved);}
  else{
   const blocked=await h.request(`/api/raw/${f.raw.id}/extract`,{restart:true});assert.equal(blocked.status,409);
   await runner.reconcile();const recovered=await runner.readJob(id);assert.equal(recovered.job.status,'failed');assert.equal(recovered.recovery,undefined);
   assert.equal((await f.rawStates.get(f.raw.id)).jobId,id);assert.equal((await f.checkpoint(id)).attempts,0);
   const after=await f.hashes(id);assert.equal((await h.request(`/api/extraction-jobs/${id}/reconcile-storage`,{})).status,200);assert.deepEqual(await f.hashes(id),after);
   assert.deepEqual((await f.hashes(old.id)).slice(0,2),before.slice(0,2));
  }
  assert.equal(f.requests.length,calls);assert.equal((await f.drafts.list()).length,0);
  return {oldJob:old.id,newJob:id,refusals:fault.events.length,providerDelta:0,legacyProofMissing:legacy};
 }finally{fault?.restore();await h?.close();await f.clean();}
});
await check('missing-modern-cp-restoration-keeps-ledger',async()=>{
 const f=await storageFixture();let held,h;
 try{
  const job=(await f.start()).job;await f.wait(job.id);const before=await f.hashes(job.id),calls=f.requests.length;
  const file=path.join(f.root,'state/extraction-checkpoints',job.id+'.json');held=file;await fs.rename(file,file+'.held');
  const runner=f.newRunner();h=await storageHttp(f,runner);await runner.reconcile();
  assert.equal((await h.request(`/api/raw/${f.raw.id}/extract`,{})).json.error.code,'LLM_CHECKPOINT_MISSING');
  assert.equal((await h.request(`/api/extraction-jobs/${job.id}/reconcile-storage`,{})).status,409);
  assert.equal((await f.jobs.list()).length,1);assert.equal(f.requests.length,calls);
  await fs.rename(file+'.held',file);held=undefined;assert.deepEqual(await f.hashes(job.id),before);
  f.succeed();const next=await runner.start(f.raw.id,{...opts(),planningRetry:true});assert.equal(next.job.id,job.id);
  const done=await runner.waitForSettlement(job.id);assert.equal(done.job.status,'completed');assert.equal(done.recovery,undefined);assert.equal((await f.checkpoint(job.id)).attempts,3);assert.equal(f.requests.length,calls+1);
  return {sameJob:true,attemptsBefore:2,attemptsAfter:3,whileMissingProviderDelta:0};
 }finally{if(held)await fs.rename(held+'.held',held);await h?.close();await f.clean();}
});
report.pass=report.checks.every(c=>c.result==='PASS');report.closed=true;
await fs.writeFile('docs/reports/KB02-SR01-R1-AUDIT-20261021-spec'+(process.env.SR01_PROBE?'-proof-diagnostic':'')+'.json',JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
