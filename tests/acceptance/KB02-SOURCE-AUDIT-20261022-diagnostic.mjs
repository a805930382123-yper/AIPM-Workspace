import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadLlmConfig} from '../../services/llm/config.ts';
import {OpenAiCompatibleProvider} from '../../services/llm/provider.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
import {runKnowledgePipeline} from '../../services/llm/knowledge-extraction.ts';
const prefix='docs/reports/KB02-SOURCE-AUDIT-20261022-';
const permit=JSON.parse(await fs.readFile(prefix+'authorization.json','utf8'));
assert.equal(permit.realCallsApproved,true,'Real calls await main Agent release');
const source=JSON.parse(await fs.readFile('tests/acceptance/KB02-SOURCE-20261022-seq121-fixture.json','utf8'));
const bundle=await loadExtractionRules('rules'),config=await loadLlmConfig({filePath:path.resolve('.env.local')});
process.env.FMCG_LLM_API_KEY=config.apiKey;process.env.KB02_TRACE=path.resolve(prefix+'provider-trace.jsonl');process.env.KB02_TRACE_LEDGER=path.resolve(prefix+'provider-attempts.jsonl');
await import('./KB02-SOURCE-AUDIT-20261022-trace-hook.mjs');
const provider=new OpenAiCompatibleProvider(config);
let cp=structuredClone({...source.checkpoint,rulesVersion:bundle.rulesVersion,lastError:undefined,plan:undefined,draftId:undefined}),calls=0,request,response;
const report={at:new Date().toISOString(),originalSequence:121,scope:'current-rule in-memory original extracted records; no historical checkpoint writes',rawHash:createHash('sha256').update(source.raw.body).digest('hex'),rulesVersion:bundle.rulesVersion};
try{
 assert.equal(source.raw.body.length,106400);assert.equal(report.rawHash,source.checkpoint.rawSha256);
 const result=await runKnowledgePipeline({raw:source.raw,body:source.raw.body,bodySha256:report.rawHash,rulesDir:'rules',checkpoint:cp,provider:{name:provider.name,model:provider.model,secrets:provider.secrets,complete:async r=>{if(calls++)throw Error('One diagnostic call only');request=r;const out=await provider.complete(r);response=JSON.parse(out.text);return out;}},beforeCall:async stage=>(cp={...cp,stage,attempts:cp.attempts+1}),saveCheckpoint:async value=>(cp=value)});
 report.pages=result.outcome.pages;report.plan=cp.plan;
 report.assignments=cp.plan.pages.map(p=>({title:p.title,factIds:p.factIds,questionIds:p.questionIds,areas:[...new Set([...p.factIds,...p.questionIds].map(id=>source.expectedAreas[id]))]}));
 assert.equal(cp.plan.pages.length,14);assert.equal(cp.plan.pages.flatMap(p=>p.factIds).length,79);assert.equal(cp.plan.pages.flatMap(p=>p.questionIds).length,25);
 for(const p of report.assignments){assert.equal(p.areas.length,1);assert(p.title.includes('区域'+p.areas[0]));}
 report.result='PASS';
}catch(e){report.result='FAIL';report.error={code:e.code,message:e.message};}
Object.assign(report,{calls,request,response,diagnostic:cp.lastError?.diagnostic});
await fs.writeFile(prefix+'diagnostic-121.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({result:report.result,error:report.error,calls,assignments:report.assignments}));
if(report.result==='FAIL')process.exitCode=1;
