import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const p='docs/reports/KB02-FINAL-AUDIT-20261022-main-';
const read=async x=>JSON.parse(await fs.readFile(x,'utf8'));
const lab=await read(p+'lab.json'), a=(await read(p+'real-http.json')).artifacts;
const rows=async x=>(await fs.readFile(p+x,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const get=async x=>{const r=await fetch(lab.api+x);assert.equal(r.status,200);return r.json();};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const job=await get('/api/extraction-jobs/'+a['job-'+a.longRaw.id].jobId);
const checkpoint=await read(path.join(lab.root,'state/extraction-checkpoints',job.jobId+'.json'));
const raw=await get('/api/raw/'+a.longRaw.id), traces=await rows('provider-trace.jsonl'),attempts=await rows('provider-attempts.jsonl');
const out={at:new Date().toISOString(),job,checkpoint,checks:[],traces:traces.map(t=>({sequence:t.sequence,status:t.status,elapsedMs:t.elapsedMs,networkError:t.networkError})),scope:'Read-only observation of real run; no repair or retry'};
function check(id,fn){try{out.checks.push({id,result:'PASS',details:fn()});}catch(e){out.checks.push({id,result:'FAIL',message:e.message});}}
check('raw-original-hash',()=>{assert.equal(raw.body.length,106400);assert.equal(sha(raw.body),'a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7');return sha(raw.body);});
check('fourteen-chunks-persisted-exact-evidence',()=>{assert.equal(checkpoint.completedChunks.length,14);for(const c of checkpoint.completedChunks)for(const e of c.evidence){assert.equal(e.rawId,raw.id);assert.equal(raw.body.slice(e.start,e.end),e.quote);}return 14;});
const facts=checkpoint.completedChunks.flatMap(c=>c.facts);
check('fourteen-regional-metrics-extracted',()=>{for(let n=1;n<=14;n++){const name='虚构区域'+String(n).padStart(2,'0');assert(facts.some(f=>f.text.includes(name)&&f.text.includes('2026年9月')&&f.text.includes((n+10)+'%')));}return 14;});
out.nonbusinessFacts=facts.filter(f=>/排版说明|长文验收附录/.test(f.text));
check('nonbusiness-excluded',()=>{assert.equal(out.nonbusinessFacts.length,0);return true;});
check('long-draft-completed',()=>{assert.equal(job.status,'completed');assert(job.draftId);return true;});
check('failure-safe-and-budget-consistent',()=>{assert.equal(job.status,'failed');assert.equal(job.draftId,null);assert.equal(job.callCount,15);assert.equal(checkpoint.attempts,15);assert.equal(job.error.code,'LLM_PLAN_COVERAGE_INVALID');return {calls:15,noLongDraft:true};});
check('ledger',()=>{assert.equal(attempts.length,traces.length);assert.deepEqual(attempts.map(x=>x.sequence),Array.from({length:attempts.length},(_,i)=>63+i));assert(62+attempts.length<=200);return {new:attempts.length,total:62+attempts.length};});
out.shortDraft=a.shortDraft;out.supplementDraft=a.updateDraft;
if(a.shortMetricWiki){out.updatedWiki=await get('/api/wiki/'+a.shortMetricWiki.id);check('update-double-ratios-sources-human',()=>{for(const v of ['20%','30%','KB02_HUMAN'])assert(out.updatedWiki.body.includes(v));for(const id of [a.shortRaw.id,a.updateRaw.id])assert(out.updatedWiki.sources.includes(id));assert.equal(out.updatedWiki.revision,3);return true;});}
for(const key of ['shortRaw','updateRaw'])if(a[key]){const r=await get('/api/raw/'+a[key].id);check(key+'-unchanged',()=>{assert.equal(sha(r.body),a[key].sha256);return true;});}
out.extractionFinding=traces.filter(t=>t.sequence<=76).map(t=>{const r=JSON.parse(t.response.content);return {sequence:t.sequence,selected:r.facts?.filter(f=>f.atomId==='c13-a0272'),response:r};}).filter(t=>t.selected?.length);
const suffix=process.argv[2]??'quality';await fs.writeFile(p+suffix+'.json',JSON.stringify(out,null,2));
await fs.writeFile(p+'real-budget.json',JSON.stringify({at:out.at,previousUsed:62,previousCap:74,newlyAuthorized:126,cap:200,currentReviewUsed:attempts.length,cumulativeUsed:62+attempts.length,remaining:138-attempts.length,promptSeparate:{used:15,limit:24},ledgerRows:attempts.length,traceRows:traces.length},null,2));
console.log(JSON.stringify({checks:out.checks,nonbusinessFacts:out.nonbusinessFacts,cumulative:62+attempts.length}));
