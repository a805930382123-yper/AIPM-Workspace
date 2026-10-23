// A simulator, deliberately incapable of real sends. Simulation approval is not authorization.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {offlineArgs,frozen,save,sha,assertFakeDispatch} from './KB02-K204-PREP-20261023-support.mjs';

export async function gates(root,label='gates') {
  const {spec}=await frozen(),rows=[],ledgers=[];let serial=0;
  const record=(name,details)=>rows.push({name,pass:true,...details});
  class FakeLedger {
    constructor(options={}) {this.file=path.join(root,`simulated-ledger-${++serial}.jsonl`);this.used=0;this.stopped=false;this.approved=false;this.closed=false;this.sent=0;Object.assign(this,options);ledgers.push(this);}
    async send(stage,operation) {
      assert(!this.closed,'RESTART_REQUIRES_EXPLICIT_RELEASE');assert(!this.stopped,'FIRST_FAILURE_STOP');assert(this.approved,'STAGE_NOT_APPROVED');assert(this.used<spec.stages.find(s=>s.id===stage).calls,'STAGE_LIMIT');
      const row={sequence:220+this.used++,stage,purpose:'fake-simulation',requestHash:sha('simulated '+this.used),startedAt:new Date().toISOString(),result:'pending'};
      // Persistence precedes the only fake callback. Uncertain attempts conservatively consume budget.
      await fs.appendFile(this.file,JSON.stringify(row)+'\n');this.sent++;
      try{const result=await operation();await fs.appendFile(this.file,JSON.stringify({...row,result:'success'})+'\n');return result;}
      catch(error){this.stopped=true;await fs.appendFile(this.file,JSON.stringify({...row,result:error.message})+'\n');throw error;}
    }
  }
  offlineArgs([]);assert.throws(()=>offlineArgs(['--real']),/OFFLINE_ONLY/);assert.throws(()=>offlineArgs(['--approved=true']),/OFFLINE_ONLY/);
  const copied=structuredClone(spec);copied.stages.forEach(s=>s.approved=true);copied.budget.authorizedNow=22;
  // No sender is constructed from this object; even altered approval cannot select another transport.
  assert.equal(typeof copied.send,'undefined');record('CLI and mutated plan cannot construct real transport',{realAuthorization:0});
  assert.throws(()=>assertFakeDispatch({user:'请审核候选'},'fake',0,2),/B1\/extra/);assert.throws(()=>assertFakeDispatch({user:'unexpected extra'},'fake',2,2),/EXTRA_FAKE_CALL_FORBIDDEN/);assert.throws(()=>assertFakeDispatch({user:'请对下列全部已验证事实规划知识页'},'fake',0,2),/Unexpected extraction\/planning order/);record('Production fake boundary rejects B1, extra and early planning before returning response');
  const old=process.env.KB02_REAL;process.env.KB02_REAL='true';try{offlineArgs([]);assert.equal(spec.budget.authorizedNow,0);}finally{if(old===undefined)delete process.env.KB02_REAL;else process.env.KB02_REAL=old;}record('Environment has no real mode');
  const denied=new FakeLedger();await assert.rejects(denied.send('A1',async()=>0),/STAGE_NOT_APPROVED/);assert.equal(denied.sent,0);record('Unapproved stage cannot dispatch');
  const once=new FakeLedger({approved:true});await once.send('A3',async()=>{const lines=(await fs.readFile(once.file,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(lines.at(-1).result,'pending');return 1;});await assert.rejects(once.send('A3',async()=>0),/STAGE_LIMIT/);assert.equal(once.sent,1);record('Pre-send durable ledger and exact stage ceiling',{sent:once.sent});
  const bad=new FakeLedger({approved:true,file:path.join(root,'missing-parent','ledger.jsonl')});await assert.rejects(bad.send('A1',async()=>0));assert.equal(bad.sent,0);assert.equal(bad.used,1);record('Ledger failure prevents callback, uncertain reservation retained');
  for(const reason of ['timeout','cancelled','invalid-json']){const ledger=new FakeLedger({approved:true});await assert.rejects(ledger.send('A1',async()=>{throw Error(reason);}),new RegExp(reason));await assert.rejects(ledger.send('A1',async()=>0),/FIRST_FAILURE_STOP/);assert.equal(ledger.used,1);assert.equal(ledger.sent,1);record(reason+' counts and stops',{used:ledger.used});}
  const pair=new FakeLedger({approved:true});let fail,late;const failed=new Promise((_,reject)=>fail=reject),pending=new Promise(resolve=>late=resolve);
  const inFlight=[pair.send('C',()=>failed),pair.send('C',()=>pending)];
  // Await actual pending ledger records before resolving either fake response.
  while(pair.sent!==2)await new Promise(r=>setTimeout(r,2));fail(Error('first-failure'));await assert.rejects(inFlight[0],/first-failure/);await assert.rejects(pair.send('C',async()=>0),/FIRST_FAILURE_STOP/);late('late-success');await inFlight[1];assert.equal(pair.used,2);assert.equal(pair.sent,2);record('Two in-flight attempts counted; no third or planning after failure',{used:pair.used});
  const reboot=new FakeLedger({approved:true,file:once.file,used:1,closed:true});await assert.rejects(reboot.send('A1',async()=>0),/RESTART_REQUIRES_EXPLICIT_RELEASE/);assert.equal(reboot.sent,0);record('Restart does not resume dispatch');
  const stages=spec.stages.map(s=>({id:s.id,calls:s.calls,approved:false,cumulativeCeiling:s.cumulativeCeiling}));assert.equal(stages.reduce((n,s)=>n+s.calls,0),22);assert.equal(stages.at(-1).cumulativeCeiling,241);record('Five-stage approval proposal totals22, current authority0',{stages});
  const simulatedFakeCallbacks=ledgers.reduce((n,l)=>n+l.sent,0);assert.equal(simulatedFakeCallbacks,6);
  const report={node:process.version,pass:true,realCalls:0,simulationOnly:true,simulatedFakeCallbacks,normalChainFakeCallsExcluded:true,rows};await save(label,report);return report;
}
