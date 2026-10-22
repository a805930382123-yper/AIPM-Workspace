import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createHarness,expect,request,terminal,eventually,rawInput,delay} from './kb02-20261015-standards-harness.mjs';
const parse=w=>{const user=w.messages.find(x=>x.role==='user').content;return {planning:user.includes('请对下列全部已验证事实规划知识页'),data:JSON.parse(user.slice(user.lastIndexOf('\n')+1))};};
const good=w=>{const p=parse(w);return p.planning?{version:2,document:{title:'虚构指标',main_topic:'指标'},pages:[{title:'虚构指标',type:'metric',category:'metric',factIds:p.data.facts.map(x=>x.id),questionIds:p.data.questions.map(x=>x.id)}]}:{version:2,facts:p.data.filter(x=>x.text.trim()).map(x=>({atomId:x.id,kind:'fact'})),questions:[],sourceNotes:[]};};
const bad=w=>{const p=good(w);if(parse(w).planning)p.pages[0].factIds.pop();return p;};
const h=await createHarness(bad),rows=[];let s;
const cpPath=id=>path.join(h.dataRoot,'state/extraction-checkpoints',id+'.json');
const cp=id=>fs.readFile(cpPath(id),'utf8').then(JSON.parse);
const bytes=async (r,j)=>{const files=[cpPath(j),path.join(h.dataRoot,'state/extraction-jobs',j+'.json'),path.join(h.dataRoot,'state/raw-processing',r+'.json')];return Promise.all(files.map(async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex')));};
const create=title=>expect(s,'/api/raw','POST',rawInput(title,'目标100家，在售20家。铺货率20%，负责人未知。'),201);
const begin=(r,b={})=>request(s,'/api/raw/'+r.id+'/extract','POST',b);
async function check(id,fn){try{rows.push({id,...await fn()});}catch(e){rows.push({id,result:'ERROR',error:e.stack});}console.log(id,rows.at(-1).result);}
try{s=await h.start();
await check('S01-budget-exhausted-planningRetry',async()=>{
 h.setReply(bad);const r=await create('虚构预算'),b=await begin(r);assert.equal(b.status,202,b.text);
 let j=await terminal(s,b.json.jobId);assert.equal(j.callCount,2);
 for(let i=3;i<=6;i++){const retry=await begin(r,{planningRetry:true});assert.equal(retry.status,202,retry.text);assert.equal(retry.json.jobId,j.jobId);j=await terminal(s,j.jobId);assert.equal(j.callCount,i);assert.equal(j.error.code,'LLM_PLAN_COVERAGE_INVALID');}
 const saved=await cp(j.jobId),before=await bytes(r.id,j.jobId),calls=h.requests.length;
 assert.equal(saved.attempts,6);assert.equal(saved.completedChunks.length,1);assert.equal(saved.jobId,j.jobId);
 assert.deepEqual(saved.lastError.diagnostic.facts.missing,['f-c1-2']);assert.deepEqual(j.error.details,saved.lastError.diagnostic);
 const denials=[];
 for(let replay=0;replay<3;replay++){
  const denied=await begin(r,{planningRetry:true});assert.equal(denied.status,409,denied.text);assert.equal(denied.json.error.code,'LLM_ATTEMPT_LIMIT');assert.match(denied.json.error.message,/累计 6 次调用上限.*显式重新生成/u);
  const final=await terminal(s,j.jobId),after=await bytes(r.id,j.jobId);
  assert.deepEqual(after,before);assert.deepEqual(await cp(j.jobId),saved);assert.deepEqual(final,j);assert.equal(h.requests.length,calls);
  denials.push({httpStatus:denied.status,error:denied.json.error,sha256:after,additionalProviderCalls:h.requests.length-calls});
 }
 return {result:'PASS',expected:'409 before side effects; preserve checkpoint/job/state bytes on every replay',actual:{jobId:j.jobId,attempts:saved.attempts,validatedChunks:saved.completedChunks.length,beforeSha256:before,denials,beforeDiagnostic:saved.lastError.diagnostic,afterLastError:(await cp(j.jobId)).lastError}};
});
await check('S02-cancel-explicit-planner-late-response',async()=>{h.setReply(bad);const r=await create('虚构取消'),b=await begin(r);let j=await terminal(s,b.json.jobId);assert.equal(j.error.code,'LLM_PLAN_COVERAGE_INVALID');let release,seen=false;const hold=new Promise(r=>release=r);h.setReply(async w=>{assert(parse(w).planning);assert(parse(w).data.coverageFeedback);seen=true;await hold;return good(w);});const calls=h.requests.length;await begin(r,{planningRetry:true});await eventually(()=>seen,'planner reached');await expect(s,'/api/extraction-jobs/'+j.jobId+'/cancel','POST',{});j=await terminal(s,j.jobId);release();await delay(150);const saved=await cp(j.jobId),drafts=await expect(s,'/api/drafts?rawId='+r.id),state=(await expect(s,'/api/raw-processing')).items.find(x=>x.rawId===r.id);assert.equal(j.status,'cancelled');assert(!saved.plan);assert.equal(drafts.items.length,0);assert.equal(h.requests.length-calls,1);return {result:'PASS',actual:{status:j.status,stage:saved.stage,attempts:saved.attempts,planSaved:!!saved.plan,drafts:drafts.items.length,rawStatus:state.status,providerCalls:1}};});
}finally{await h.close();await fs.writeFile('docs/reports/KB02-R2-Q02-20261018-builder-standards-probes.json',JSON.stringify({at:new Date().toISOString(),scope:'actual localhost HTTP; synthetic fixture; zero external calls',rows,closed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)},null,2));console.log(JSON.stringify(rows,null,2));}
if(rows.some(row=>row.result!=='PASS'))process.exitCode=1;
