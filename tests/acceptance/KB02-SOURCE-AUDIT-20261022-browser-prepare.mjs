// Actual configured Provider, synthetic data in owned temporary lab only.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileSnapshot,delay} from './b07-harness.mjs';import {rawInput} from './b05-harness.mjs';
const prefix='docs/reports/KB02-SOURCE-AUDIT-20261022-',meta=JSON.parse(await fs.readFile(prefix+'main-lab.json','utf8')),checks=[],artifacts=JSON.parse(await fs.readFile(prefix+'real-http.json','utf8').catch(()=>'{"artifacts":{}}')).artifacts;
async function req(url,method='GET',body){const response=await fetch(meta.api+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(130000)});return {status:response.status,json:await response.json()};}
async function ok(url,method,body,status=200){const result=await req(url,method,body);if(result.status!==status)throw Object.assign(Error('HTTP '+result.status+' '+JSON.stringify(result.json.error)),{actual:result.json});return result.json;}
const snapshot=dir=>fileSnapshot(path.join(meta.root,dir)),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function save(){await fs.writeFile(prefix+'real-http-'+(process.argv[2]??'all')+'.json',JSON.stringify({checks,artifacts},null,2));await fs.writeFile(prefix+'real-http.json',JSON.stringify({at:new Date().toISOString(),scope:'actual HTTP+configured external Provider; fictional owned isolated Raw only',checks,artifacts},null,2));}
async function test(id,fn){if(process.argv[2]&&!id.includes(process.argv[2])&&!id.includes('cumulative'))return;const start=Date.now();try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',message:e.message,...(e.actual?{actual:e.actual}:{})});}checks.at(-1).elapsedMs=Date.now()-start;await save();console.log(id+': '+checks.at(-1).result+' '+checks.at(-1).elapsedMs+'ms');}
async function extract(raw){
 const before={raw:await snapshot('knowledge/raw'),wiki:await snapshot('knowledge/wiki')},start=await ok('/api/raw/'+raw.id+'/extract','POST',{},202);let job;
 for(let i=0;i<2450;i++){job=await ok('/api/extraction-jobs/'+start.jobId);if(['completed','failed','cancelled'].includes(job.status))break;await delay(250);}
 artifacts['job-'+raw.id]=job;assert.deepEqual(await snapshot('knowledge/raw'),before.raw);assert.deepEqual(await snapshot('knowledge/wiki'),before.wiki);assert.equal(job.status,'completed',JSON.stringify(job.error));
 const draft=await ok('/api/drafts/'+job.draftId);
 for(const page of draft.pages){assert(page.source_facts.length);for(const e of page.source_evidence){assert.equal(e.rawId,raw.id);assert.equal(raw.body.slice(e.start,e.end),e.quote);}for(const f of page.source_facts)assert(f.evidenceIds.every(id=>page.source_evidence.some(e=>e.id===id)));}
 assert.equal((await ok('/api/raw/'+raw.id)).body,raw.body);return draft;
}
await test('KB02-REAL-UPDATE-supplement-extraction-only',async()=>{
 const target=artifacts.shortMetricWiki;const body='【虚构补充验收，非真实客户资料】\n虚构饮料甲的甲桥区域2026年9月复核：目标门店100家，在售门店30家，按门店数计算铺货率30%。旧资料是20家及20%，两份来源的口径或采样时间差异待确认，不能静默覆盖任何一方。\n补充规则：财务每周核对回款一次。异常审批负责人仍需访谈确认。AI异常提示为未来建议，无上线或收益事实。';
 const raw=await ok('/api/raw','POST',rawInput('KB02虚构铺货率复核',body,['KB02虚构']),201),draft=await extract(raw);artifacts.updateRaw={id:raw.id,chars:body.length,sha256:sha(body)};artifacts.updateDraft=draft;const page=draft.pages.find(p=>p.type==='metric');assert(page);
 return {prepared:true,rawId:raw.id,draftId:draft.id,pageId:page.pageId,targetWikiId:target?.id,updateWorkflowNotRun:!target};
});
await save();if(checks.some(c=>c.result==='FAIL'))process.exitCode=1;

