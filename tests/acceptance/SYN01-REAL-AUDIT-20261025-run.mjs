import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {smoke} from './SYN01-REAL-20261025-smoke.mjs';
import {Engine,sessionAt,durable} from './SYN01-REAL-20261025-core.mjs';

const result = await smoke({reportPrefix:'SYN01-REAL-AUDIT-20261025-'});
assert.equal(result.pass, true, result.error?.message);
// R01 has three persisted outcomes. Completed was exercised by the App smoke;
// the remaining two use the same single reservation, with no new provider call.
const file = path.join(result.root,'result-242.json');
const saved = await fs.readFile(file);
const checks=[];
try {
  await fs.unlink(file);
  for(const state of ['pending','failed']) {
    if(state==='failed') await durable(file,{sequence:242,status:'failed',code:'AUDIT_SYNTHETIC_FAILURE_STATE'});
    const engine = new Engine(await sessionAt(result.root));
    await assert.rejects(engine.provider(), /ATTEMPT_LIMIT/);
    assert.equal(engine.configReads,0); assert.equal(engine.sent,0);
    checks.push({state,rejected:true,configReads:0,sent:0});
  }
} finally {await fs.writeFile(file,saved);}
const evidence={pass:true,at:new Date().toISOString(),root:result.root,checks,realCalls:0,newFakeCalls:0,restoredCompletedResult:true};
const output='docs/reports/SYN01-REAL-AUDIT-20261025-reservation-'+Date.now()+'.json';
await durable(output,evidence);
console.log(JSON.stringify({pass:true,extraReservationStates:checks.length,realCalls:0,evidence:output}));
