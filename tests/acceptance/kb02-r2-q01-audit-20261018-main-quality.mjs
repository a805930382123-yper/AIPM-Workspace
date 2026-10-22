import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const p='docs/reports/KB02-R2-Q01-AUDIT-20261018-main-';
const read=async n=>JSON.parse(await fs.readFile(p+n,'utf8'));
const lab=await read('lab.json'), initial=await read('real-http-LONG.json'), a=initial.artifacts;
const get=async url=>{const r=await fetch(lab.api+url);assert.equal(r.status,200);return r.json();};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const old=await read('long-checkpoint-before-resume.json');
let job;for(let i=0;i<240;i++){job=await get('/api/extraction-jobs/'+old.jobId);if(job.status!=='running')break;await new Promise(r=>setTimeout(r,250));}
const cp=JSON.parse(await fs.readFile(path.join(lab.root,'state/extraction-checkpoints',old.jobId+'.json'),'utf8'));
const traces=(await fs.readFile(p+'provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const attempts=(await fs.readFile(p+'provider-attempts.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const out={at:new Date().toISOString(),job,checkpoint:cp,checks:[],scope:'Actual read-only quality assertions; no provider calls'};
const check=(id,fn)=>{try{out.checks.push({id,result:'PASS',details:fn()});}catch(e){out.checks.push({id,result:'FAIL',error:e.message});}};
check('ledger',()=>{assert.equal(attempts.length,traces.length);assert(attempts.length<=25);assert.deepEqual(attempts.map(x=>x.sequence),Array.from({length:attempts.length},(_,i)=>50+i));return {used:attempts.length,total:49+attempts.length,limit:74};});
check('same-job-reused-five-chunks',()=>{assert.equal(job.jobId,old.jobId);assert.deepEqual(cp.completedChunks.slice(0,5),old.completedChunks);return {before:old.attempts,after:cp.attempts,reused:5};});
const raw=await get('/api/raw/'+a.longRaw.id);
check('raw-exact',()=>{assert.equal(raw.body.length,106400);assert.equal(sha(raw.body),a.longRaw.sha256);return {chars:raw.body.length,sha256:sha(raw.body)};});
check('all-chunks-plan-complete',()=>{assert.equal(job.status,'completed',JSON.stringify(job.error));assert.equal(cp.completedChunks.length,14);assert(cp.plan);return {chunks:14,calls:job.callCount};});
if(job.draftId){
 const draft=await get('/api/drafts/'+job.draftId);out.draft=draft;
 check('exact-evidence-and-raw-binding',()=>{for(const page of draft.pages){for(const e of page.source_evidence){assert.equal(e.rawId,raw.id);assert.equal(raw.body.slice(e.start,e.end),e.quote);}for(const f of page.source_facts)assert(f.evidenceIds.every(id=>page.source_evidence.some(e=>e.id===id)));}return true;});
 check('all-fourteen-regions',()=>{const all=draft.pages.flatMap(p=>p.source_facts);return Array.from({length:14},(_,i)=>{const name='虚构区域'+String(i+1).padStart(2,'0'),ratio=(i+11)+'%';const hits=all.filter(x=>x.text.includes(name)&&x.text.includes(ratio));assert(hits.length,'Missing '+name);return {name,ratio,hits:hits.length};});});
 check('planning-exact-cover',()=>{for(const [field,parts] of [['factIds','facts'],['questionIds','questions']]){const expected=cp.completedChunks.flatMap(c=>c[parts].map(x=>x.id)).sort();const actual=cp.plan.pages.flatMap(x=>x[field]).sort();assert.deepEqual(actual,expected);}return true;});
 check('declarations-not-business',()=>{const facts=cp.completedChunks.flatMap(x=>x.facts);assert(!facts.some(x=>/排版说明|长文验收附录/.test(x.text)));assert(!draft.document.summary.includes('排版说明'));return {facts:facts.length,questions:cp.completedChunks.flatMap(x=>x.questions).length,sourceNotes:cp.completedChunks.flatMap(x=>x.sourceNotes??[]).length};});
 check('unknown-future-boundaries',()=>{const text=JSON.stringify(draft.pages.map(p=>({facts:p.source_facts,questions:p.open_questions})));assert(text.includes('异常审批负责人未知'));assert(text.includes('AI仅未来分析建议'));return true;});
 out.business=draft.pages.map(p=>({id:p.pageId,title:p.title,type:p.type,facts:p.source_facts.map(x=>x.text),questions:p.open_questions}));
}
const updated=await get('/api/wiki/'+a.shortMetricWiki.id);out.updatedWiki=updated;
check('update-preserves-both-sources-human',()=>{for(const v of ['20%','30%','KB02_HUMAN'])assert(updated.body.includes(v));assert(updated.sources.includes(a.shortRaw.id));assert(updated.sources.includes(a.updateRaw.id));assert.equal(updated.revision,3);return true;});
out.summary={pass:out.checks.filter(x=>x.result==='PASS').length,fail:out.checks.filter(x=>x.result==='FAIL').length};
await fs.writeFile(p+'quality.json',JSON.stringify(out,null,2));
await fs.writeFile(p+'real-budget.json',JSON.stringify({at:new Date().toISOString(),previousUsed:49,previousCap:64,newlyAuthorized:10,cap:74,currentReviewUsed:attempts.length,cumulativeUsed:49+attempts.length,remaining:25-attempts.length,promptSeparate:{used:15,limit:24},ledgerRows:attempts.length,traceRows:traces.length},null,2));
console.log(JSON.stringify({summary:out.summary,job:job.status,error:job.error,calls:job.callCount,remaining:25-attempts.length}));
