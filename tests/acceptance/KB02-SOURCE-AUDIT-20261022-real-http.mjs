if(!['LONG','SHORT'].includes(process.argv[2]))throw Error('Explicit LONG or SHORT phase required; update must use real browser.');
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
await test('KB02-REAL-SHORT-v2-normalized-and-explicit-confirm',async()=>{
 const body='【虚构验收资料，不是真实业务】\n虚构饮料甲在2026年9月的甲桥区域有100家目标门店，其中20家在售。铺货率定义为在售门店数除以目标门店数，即20÷100=20%。这里的门店数不能解释为销量。\n异常审批负责人待访谈确认；AI异常提示只是未来建议，没有上线或收益事实。',raw=await ok('/api/raw','POST',rawInput('KB02虚构短文',body,['KB02虚构']),201),draft=await extract(raw);artifacts.shortRaw={id:raw.id,chars:body.length,sha256:sha(body)};artifacts.shortDraft=draft;
 const metric=draft.pages.find(p=>p.type==='metric');assert(metric,'Missing metric knowledge');assert(metric.source_facts.some(f=>f.text.includes('20%')));let current=draft;
 await ok(`/api/knowledge/drafts/${draft.id}/pages/${metric.pageId}/decision`,'PATCH',{baseRevision:current.revision,decision:'create'});current=await ok('/api/drafts/'+draft.id);
 const confirmed=await ok('/api/drafts/'+draft.id+'/confirm','POST',{baseRevision:current.revision,selectedPageIds:[metric.pageId],idempotencyKey:crypto.randomUUID()},201);assert.equal(confirmed.wikiIds.length,1);let wiki=await ok('/api/wiki/'+confirmed.wikiIds[0]);assert(wiki.sources.includes(raw.id));assert(wiki.body.includes('20%'));artifacts.shortConfirm=confirmed;
 const {id,created,updated,revision,domain,links,...input}=wiki;wiki=await ok('/api/wiki/'+id,'PUT',{...input,baseRevision:revision,body:input.body+'\n\n## 人工备注\nKB02_HUMAN 异常审批负责人需访谈确认，保留原口径。'});artifacts.shortMetricWiki=wiki;
 return {rawId:raw.id,draftId:draft.id,pages:draft.pages.length,selectedPages:1,callCount:draft.extraction.callCount,quoteRangesExact:true,noAutoFormalWrite:true};
});
await test('KB02-REAL-LONG-106400-all-chunks-and-regions',async()=>{
 let body='';for(let n=1;n<=14;n++){const region='虚构区域'+String(n).padStart(2,'0');let block=`【长文验收附录${n}，虚构】\n${region}2026年9月有100家目标门店，${n+10}家在售，门店数铺货率${n+10}%。此区域与其它附录区域独立，不能混用。异常审批负责人未知，AI仅未来分析建议。\n`;let line=0;while(block.length<7600)block+=`附录${n}排版说明${++line}：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客户身份、AI上线事实或收益。\n`;body+=block.slice(0,7600);}
 assert.equal(body.length,106400);const raw=await ok('/api/raw','POST',rawInput('KB02十四区域中文长文虚构验收',body,['KB02长文']),201);artifacts.longRaw={id:raw.id,chars:body.length,sha256:sha(body)};const draft=await extract(raw);artifacts.longDraft=draft;
 const traces=(await fs.readFile(prefix+'provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse),coverage=traces.flatMap(t=>{const user=t.request.messages.at(-1).content;if(!user.includes(raw.id))return [];const m=user.match(/全局区间 \[(\d+),\s*(\d+)\)/);return m?[{start:Number(m[1]),end:Number(m[2])}]:[];}).sort((a,b)=>a.start-b.start);
 artifacts.longCoverage=coverage;assert.equal(coverage.length,draft.extraction.chunkCount);assert.equal(coverage[0].start,0);assert.equal(coverage.at(-1).end,body.length);for(let i=1;i<coverage.length;i++)assert(coverage[i].start<=coverage[i-1].end);assert(draft.extraction.callCount>=14);
 const regional=[];for(let n=1;n<=14;n++){const region='虚构区域'+String(n).padStart(2,'0'),matches=draft.pages.flatMap(p=>p.source_facts.map(f=>({page:p.title,text:f.text,quotes:f.evidenceIds.map(id=>p.source_evidence.find(e=>e.id===id).quote)}))).filter(f=>f.text.includes(region)&&f.text.includes((n+10)+'%'));assert(matches.some(f=>f.quotes.some(q=>q.includes(region)&&q.includes((n+10)+'%'))),'Missing or mismatched regional fact '+region);regional.push({region,ratio:(n+10)+'%',matches});}artifacts.regional=regional;
 return {rawId:raw.id,draftId:draft.id,chars:body.length,chunkCount:draft.extraction.chunkCount,callCount:draft.extraction.callCount,pages:draft.pages.length,lastChunkEnd:coverage.at(-1).end,regionsSupported:regional.length,rawExact:true,noFormalWrite:true,qualityScope:'14 synthetic regional appendices with formatting filler; no general long-document quality claim'};
});
await test('KB02-REAL-SAFETY-cumulative-attempt-ledger',async()=>{const attempted=(await fs.readFile(prefix+'provider-attempts.jsonl','utf8')).trim().split('\n').map(JSON.parse),traces=(await fs.readFile(prefix+'provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse);assert.equal(attempted.length,traces.length);assert(126+attempted.length<=200);assert(traces.every(t=>t.request.reasoning_effort==='low'));return {historicalKB01:27,priorKB02:126,r1Attempts:attempted.length,kb02Attempts:126+attempted.length,allBatches:153+attempted.length,kb02Cap:200,allKnowledgeLow:true};});
await test('KB02-REAL-UPDATE-new-source-candidates-conflict-explicit-confirm',async()=>{
 const target=artifacts.shortMetricWiki;assert(target,'Short metric prerequisite');const body='【虚构补充验收，非真实客户资料】\n虚构饮料甲的甲桥区域2026年9月复核：目标门店100家，在售门店30家，按门店数计算铺货率30%。旧资料是20家及20%，两份来源的口径或采样时间差异待确认，不能静默覆盖任何一方。\n补充规则：财务每周核对回款一次。异常审批负责人仍需访谈确认。AI异常提示为未来建议，无上线或收益事实。';
 const raw=await ok('/api/raw','POST',rawInput('KB02虚构铺货率复核',body,['KB02虚构']),201),draft=await extract(raw);artifacts.updateRaw={id:raw.id,chars:body.length,sha256:sha(body)};artifacts.updateDraft=draft;const page=draft.pages.find(p=>p.type==='metric');assert(page);
 const candidates=await ok(`/api/knowledge/drafts/${draft.id}/pages/${page.pageId}/duplicates`);artifacts.updateCandidates=candidates;assert(candidates.candidates.some(c=>c.wiki.id===target.id),'Existing same metric must appear among advisory candidates');
 await ok(`/api/knowledge/drafts/${draft.id}/pages/${page.pageId}/decision`,'PATCH',{baseRevision:draft.revision,decision:'update',targetWikiId:target.id});const current=await ok('/api/drafts/'+draft.id),before=await snapshot('knowledge/wiki'),workflow=await ok('/api/knowledge/updates','POST',{draftId:current.id,pageId:page.pageId,targetWikiId:target.id,baseRevision:current.revision},201);artifacts.updateWorkflow=workflow;
 assert.deepEqual(await snapshot('knowledge/wiki'),before);assert(workflow.sections.conflicts.length>0);assert(workflow.sections.existing.includes('KB02_HUMAN'));
 const confirmed=await ok(`/api/knowledge/workflows/${workflow.id}/confirm`,'POST',{baseRevision:workflow.revision,idempotencyKey:crypto.randomUUID()},201),final=await ok('/api/wiki/'+target.id);artifacts.updateConfirm=confirmed;artifacts.updatedWiki=final;for(const value of ['20%','30%','KB02_HUMAN'])assert(final.body.includes(value));assert(final.sources.includes(artifacts.shortRaw.id)&&final.sources.includes(raw.id));assert.equal((await ok('/api/raw/'+raw.id)).body,body);
 return {rawId:raw.id,workflowId:workflow.id,targetWikiId:target.id,revision:final.revision,bothRatios:true,humanNotePreserved:true,bothSources:true,noAutoFormalWrite:true};
});
await test('KB02-REAL-FINAL-cumulative-call-ledger',async()=>{const attempts=(await fs.readFile(prefix+'provider-attempts.jsonl','utf8')).trim().split('\n').map(JSON.parse);assert(126+attempts.length<=200);return {historicalKB01:27,priorKB02:126,r1Attempts:attempts.length,kb02Attempts:126+attempts.length,allBatches:153+attempts.length,kb02Cap:200};});
await save();if(checks.some(c=>c.result==='FAIL'))process.exitCode=1;





