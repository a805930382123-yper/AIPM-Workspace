// Fixture-specific collection. Never auto-retries extraction. Readback resumes only GET.
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {rawInput} from './b05-harness.mjs';
const p='docs/reports/KB02-SEMANTIC-AUDIT-20261023-',id=process.argv[2],readback=process.argv[3]==='readback';
const permit=JSON.parse(await fs.readFile(p+'authorization.json','utf8')),fixtures=JSON.parse(await fs.readFile(p+'fixtures.json','utf8'));
const f=fixtures.fixtures.find(f=>f.id===id);assert(f,'Explicit frozen fixture ID required');
const stage={'supplement-original':1,'independent-ai-positive':1,'mixed-short-original':2,'long-original':2,'explicit-metric-target':3}[id];
assert.equal(createHash('sha256').update(await fs.readFile(p+'fixtures.json')).digest('hex'),'5cc5a6bdcb10738687e226bfca86e52a9a037ddad57d5eac492365c16745fbc5');
assert(permit.engineeringApproved&&permit.realCallsApproved&&permit.activeStage===stage&&permit.approvedStages.includes(stage));
const meta=JSON.parse(await fs.readFile(p+'main-lab.json','utf8')),recordPath=p+id+'-http.json';
async function req(url,method='GET',body,status=200){const r=await fetch(meta.api+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(130000)});const j=await r.json();assert.equal(r.status,status,JSON.stringify(j.error));return j;}
let record;
const save=()=>fs.writeFile(recordPath,JSON.stringify(record,null,2)+'\n');
if(readback){record=JSON.parse(await fs.readFile(recordPath,'utf8'));assert(record.jobId,'No existing job to read back');}
else{
 await fs.writeFile(p+id+'-started.json',JSON.stringify({at:new Date().toISOString(),stage,fixtureSha256:f.sha256}),{flag:'wx'});
 record={at:new Date().toISOString(),fixture:id,stage,fixtureSha256:f.sha256,semanticDecision:'PENDING independent source/page review',collectionStatus:'started'};await save();
 const raw=await req('/api/raw','POST',rawInput('KB02 '+id,f.body,['KB02虚构']),201);record.rawId=raw.id;await save();
 const start=await req('/api/raw/'+raw.id+'/extract','POST',{},202);record.jobId=start.jobId;await save();
}
try{
 for(let n=0;n<2450;n++){record.job=await req('/api/extraction-jobs/'+record.jobId);await save();if(['completed','failed','cancelled'].includes(record.job.status))break;await new Promise(r=>setTimeout(r,250));}
 record.collectionStatus='terminal-read';assert.equal(record.job.status,'completed',JSON.stringify(record.job.error));record.draft=await req('/api/drafts/'+record.job.draftId);await save();
 const raw=await req('/api/raw/'+record.rawId);assert.equal(raw.body,f.body);
 for(const page of record.draft.pages){for(const e of page.source_evidence){assert.equal(e.rawId,record.rawId);assert.equal(f.body.slice(e.start,e.end),e.quote);}for(const fact of page.source_facts)assert(fact.evidenceIds.every(x=>page.source_evidence.some(e=>e.id===x)));}
 record.sourceRangesPass=true;record.metricPageIds=record.draft.pages.filter(x=>x.type==='metric').map(x=>x.pageId);
 if(id==='explicit-metric-target')assert(record.metricPageIds.length,'Fixed explicit metric target prerequisite unmet');
 // Mixed short has no metric assertion. No fixed counts, page counts or model IDs.
 await save();console.log(JSON.stringify({fixture:id,jobStatus:record.job.status,pages:record.draft.pages.length,semanticDecision:record.semanticDecision}));
}catch(e){record.collectionError={at:new Date().toISOString(),message:e.message};await save();throw e;}
