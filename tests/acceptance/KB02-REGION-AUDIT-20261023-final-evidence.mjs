import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const prefix='docs/reports/KB02-REGION-AUDIT-20261023-',read=async n=>JSON.parse(await fs.readFile(prefix+n+'.json','utf8'));
const attempts=(await fs.readFile(prefix+'provider-attempts.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const traces=(await fs.readFile(prefix+'provider-trace.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
assert.equal(attempts.length,traces.length);assert(attempts.length<=24);assert(attempts.every((r,i)=>r.sequence===184+i));assert.equal(new Set(traces.map(t=>t.sequence)).size,traces.length);
const budget={at:new Date().toISOString(),previousUsed:183,cap:500,currentReviewUsed:attempts.length,cumulativeUsed:183+attempts.length,remaining:317-attempts.length,phaseCap:24,phaseRemaining:24-attempts.length,promptSeparate:{used:15,limit:24},ledgerRows:attempts.length,traceRows:traces.length};await fs.writeFile(prefix+'budget.json',JSON.stringify(budget,null,2));
const q=await read('quality'),cp=await read('long-checkpoint');
// Diagnostic precedes long run: select planning trace after this Raw extraction, never the diagnostic.
const extraction=traces.filter(t=>t.request.messages.some(m=>m.role==='user'&&m.content.includes(cp.rawId)));assert(extraction.length>0);
const first=extraction[0].sequence,last=extraction.at(-1).sequence;
const candidates=traces.filter(t=>t.sequence>last&&t.request.messages.some(m=>m.role==='user'&&m.content.includes('factUnits'))).slice(0,1);
assert.equal(candidates.length,1);const trace=candidates[0],input=JSON.parse(trace.request.messages.find(m=>m.role==='user').content.split('\n').at(-1));
const split=[],coverage=[];
for(const [units,key] of [[input.factUnits,'factIds'],[input.questionUnits,'questionIds']])for(const unit of units){
 const members=unit.memberIds.map(id=>({id,owners:cp.plan.pages.flatMap((p,i)=>p[key].filter(x=>x===id).map(()=>i))}));
 const owners=[...new Set(members.flatMap(m=>m.owners))];const row={unitId:unit.id,sourceId:unit.sourceId,kind:unit.kind,column:key,members,pages:owners.map(i=>cp.plan.pages[i].title)};coverage.push(row);
 if(owners.length!==1||members.some(m=>m.owners.length!==1))split.push(row);
}
for(const [records,key]of[[input.facts,'factIds'],[input.questions,'questionIds']]){const expected=records.map(r=>r.id).sort(),actual=cp.plan.pages.flatMap(p=>p[key]).sort();assert.deepEqual(actual,expected);}
await fs.writeFile(prefix+'same-source-split.json',JSON.stringify({sequence:trace.sequence,scope:'exact fixed units, separate kinds and columns',split,coverage},null,2));

assert.equal(split.length,0);const semantic=await read('long-semantic-review');assert.equal(semantic.approved,true,'Independent semantic review is mandatory; heuristics alone cannot pass or fail');assert.equal(semantic.qualitySha256,(await import('node:crypto')).createHash('sha256').update(await fs.readFile(prefix+'quality.json')).digest('hex'));assert.equal(semantic.regions.length,14);assert.equal(new Set(semantic.regions.map(r=>r.region)).size,14);assert(semantic.regions.every(r=>r.pass===true&&r.reason&&r.evidence));assert.equal(semantic.issueDecisions.length,q.issues.length);assert(semantic.issueDecisions.every((r,i)=>r.issueIndex===i&&r.accepted===true&&r.reason));console.log(JSON.stringify({budget,units:coverage.length,originalIds:coverage.reduce((n,u)=>n+u.members.length,0),splitCount:split.length,heuristicIssues:q.issues.length,semanticReviewApproved:true}));


const updateTraces=traces.filter(t=>{try{return Boolean(JSON.parse(t.request.messages.find(m=>m.role==='user').content).existing);}catch{return false;}});assert.equal(updateTraces.length,1);const updateTrace=updateTraces[0],updateInput=JSON.parse(updateTrace.request.messages.find(m=>m.role==='user').content),updateOutput=JSON.parse(updateTrace.response.content);await fs.writeFile(prefix+'update-meaning-evidence.json',JSON.stringify({sequence:updateTrace.sequence,input:updateInput,output:updateOutput},null,2));
