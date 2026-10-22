import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const p='docs/reports/KB02-R2-S01-REVIEW-20261018-main-';
const read=async name=>JSON.parse(await fs.readFile(p+name,'utf8'));
const lab=await read('lab.json');
const get=async url=>{const r=await fetch(lab.api+url);assert.equal(r.status,200);return r.json();};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const attempts=(await fs.readFile(p+'provider-attempts.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const traces=(await fs.readFile(p+'provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse);
assert.equal(attempts.length,traces.length);assert(attempts.length<=24);
assert.deepEqual(attempts.map(x=>x.sequence),Array.from({length:attempts.length},(_,i)=>41+i));
const short=(await read('real-http-SHORT.json')).artifacts;
const long=(await read('real-http-LONG.json')).artifacts;
const raws=[];for(const id of [short.shortRaw.id,'93cba395-78bf-4f9b-9082-e501e3eebf5d',long.longRaw.id]){const raw=await get('/api/raw/'+id);raws.push({id,chars:raw.body.length,sha256:sha(raw.body)});}
assert.equal(raws[0].sha256,short.shortRaw.sha256);assert.equal(raws[1].sha256,'c95c8135f8904824fba6fb4a864932de36561f80d621b530e2543786564e3197');assert.equal(raws[2].sha256,long.longRaw.sha256);assert.equal(raws[2].chars,106400);
const workflow=await get('/api/knowledge/workflows/98184e70-774a-448d-8b58-5b7462c1dfc1');
const wiki=await get('/api/wiki/'+short.shortMetricWiki.id);
assert.equal(workflow.status,'confirmed');assert.equal(wiki.revision,3);
for(const v of ['20%','30%','KB02_HUMAN'])assert(wiki.body.includes(v));
for(const id of [raws[0].id,raws[1].id])assert(wiki.sources.includes(id));
const newRaw=await get('/api/raw/'+raws[1].id);for(const e of workflow.evidence){assert.equal(e.rawId,newRaw.id);assert.equal(newRaw.body.slice(e.start,e.end),e.quote);}
const jobs=[];for(const v of Object.values(long)){if(v?.jobId&&v?.rawId&&v?.status)jobs.push(await get('/api/extraction-jobs/'+v.jobId));}
const longJob=jobs.find(x=>x.rawId===long.longRaw.id);assert.equal(longJob.status,'failed');assert.equal(longJob.progress.chunksDone,0);assert.equal(longJob.callCount,2);assert.equal(longJob.draftId,null);
const stages=traces.map(t=>({sequence:t.sequence,status:t.status,elapsedMs:t.elapsedMs,stage:t.request.messages.some(m=>m.content.includes('请对下列全部已验证事实规划知识页'))?'planning':t.request.messages.some(m=>m.content.includes('原文全局区间'))?'extracting':'update',finishReason:t.response?.finishReason}));
await fs.writeFile(p+'final-audit.json',JSON.stringify({at:new Date().toISOString(),scope:'Read-only actual isolated API after browser confirm; no model calls',pass:true,raws,workflow,wiki,jobs,stages},null,2));
await fs.writeFile(p+'real-budget.json',JSON.stringify({at:new Date().toISOString(),historicalUsed:40,additionalAuthorized:24,additionalUsed:attempts.length,remaining:24-attempts.length,cumulativeUsed:40+attempts.length,cumulativeLimit:64,engineeringGate:'PASS before sequence41',promptSeparate:{used:15,limit:24},failuresCounted:true,ledgerRows:attempts.length,traceRows:traces.length},null,2));
console.log(JSON.stringify({pass:true,rawsUnchanged:true,updateConfirmed:workflow.status,wikiRevision:wiki.revision,longJob:longJob.status,longChunks:longJob.progress.chunksDone,additionalUsed:attempts.length,remaining:24-attempts.length}));
