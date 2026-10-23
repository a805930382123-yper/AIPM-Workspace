// Independent finite offline checks only. Never reads real Provider configuration.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ROOT,PREFIX,EXPERIMENT,HISTORY,ARTIFACT_SHA,validateFrozen,runMatrix,assess,sha} from './KB02-PROTOCOL-20261023-runner.mjs';
const runner='tests/acceptance/KB02-PROTOCOL-20261023-runner.mjs';
const runnerSha=sha(fs.readFileSync(runner));
const a=validateFrozen(),checks=[];
await assert.rejects(()=>runMatrix(),e=>e.code==='EXECUTION_NOT_AUTHORIZED');
assert(!fs.existsSync(path.join(ROOT,'docs/reports',PREFIX+'started.json')));
checks.push('real entry closed: no started record and no config/provider reached');
const traces=fs.readFileSync('docs/reports/KB02-SEMANTIC-AUDIT-20261023-provider-trace.jsonl','utf8').trim().split(/\r?\n/).map(JSON.parse);
const original=n=>traces.find(t=>t.sequence===n).response.content;
assert.equal(assess(original(206),a.requests[0],a).structure,true);
assert.equal(assess(original(206),a.requests[0],a).semantic.matches,false);
assert.equal(assess(original(209),a.requests[3],a).structure,false);
checks.push('actual seq206 remains structure-valid semantic mismatch; actual seq209 remains structure-invalid');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'KB02-PROTOCOL-AUDIT-'));
for(const rel of [EXPERIMENT,HISTORY,'docs/reports/KB02-REPLAN-20261023-experiment.json','services/llm/provider.ts','services/llm/knowledge-semantic-review.ts','rules/kb02-semantic-review.schema.json']){
 const dest=path.join(temp,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(ROOT,rel),dest);
}
const dir=path.join(temp,'docs/reports'),file=s=>path.join(dir,PREFIX+s);
fs.writeFileSync(file('authorization.json'),JSON.stringify({artifactSha256:ARTIFACT_SHA,engineeringApproved:true,astraIndependentReviewApproved:true,mainAgentExecutionApproved:true,realCallsApproved:true,start:209,maximumNew:10,maximumCumulative:219,totalLimit:500}));
let calls=0;
const opts={root:temp,reportDir:dir,test:true,endpoint:'http://127.0.0.1:1/v4/chat/completions',readConfig:async()=>({baseUrl:'http://127.0.0.1:1/v4',model:'GLM-5.3-Flash',apiKey:'offlineOnlyProtocolProbeCredential',knownSecrets:[]}),fetchImpl:async(url,init)=>{
 const r=a.requests[calls++],c=a.cases.find(c=>c.id===r.sampleId);
 assert.equal(init.body,JSON.stringify(r.request));
 assert.equal(init.redirect,'error');
 const ledger=fs.readFileSync(file('attempts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(ledger.length,calls);assert.equal(ledger.at(-1).sequence,209+calls);
 let content;
 if(calls===1)content=original(209); // ordinary malformed first output must not stop or retry
 else if(r.condition==='B')content=JSON.stringify({decisions:c.oracle});
 else content=JSON.stringify({version:1,pages:c.plan.pages.map((p,i)=>({pageIndex:i,decision:c.oracle[i],code:c.oracle[i]==='pass'?'OK':'UNSUPPORTED_TOPIC',unitIds:[p.factUnitIds[0]],reason:'明确的离线控制；不作为真实语义证据'}))});
 return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
}};
const result=await runMatrix(opts);
assert.equal(calls,10);assert.equal(result.attempted,10);assert.equal(result.results[0].outcome.structure,false);
assert(result.results.slice(1).every(r=>r.outcome.structure&&r.outcome.semantic.matches));
await assert.rejects(()=>runMatrix(opts),e=>e.code==='EVIDENCE_STORAGE_OR_EXISTING_RUN_SAFETY_STOP');assert.equal(calls,10);
checks.push('ten exact wire bodies; no oracle fields; ledger persisted before each fake send; malformed first output counted once; remaining fixed cells completed; rerun refused');
assert.equal(sha(fs.readFileSync(runner)),runnerSha);
fs.writeFileSync('docs/reports/KB02-PROTOCOL-AUDIT-20261023-probe.json',JSON.stringify({pass:true,realCalls:0,fakeCalls:10,runnerSha256:runnerSha,artifactSha256:ARTIFACT_SHA,checks,temporaryEvidence:temp,command:'node --import tsx tests/acceptance/KB02-PROTOCOL-AUDIT-20261023-probe.mjs',limits:'Finite independent probe; other edge controls were code-reviewed and builder tested, not all independently rerun.'},null,2)+'\n');
console.log(JSON.stringify({pass:true,realCalls:0,fakeCalls:10,runnerSha256:runnerSha}));
