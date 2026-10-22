import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadLlmConfig} from '../../services/llm/config.ts';
import {OpenAiCompatibleProvider} from '../../services/llm/provider.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
import {runKnowledgePipeline} from '../../services/llm/knowledge-extraction.ts';
const prefix='docs/reports/KB02-PLAN-AUDIT-20261022-',sequence=Number(process.argv[2]);
if(![100,104].includes(sequence))throw Error('Choose one original sequence');
const fixture=JSON.parse(await fs.readFile('tests/acceptance/KB02-PLAN-20261022-sol-failure-fixture.json','utf8'));
const source=fixture.cases.find(c=>c.sequence===sequence),bundle=await loadExtractionRules('rules');
const config=await loadLlmConfig({filePath:path.resolve('.env.local')});
process.env.FMCG_LLM_API_KEY=config.apiKey;process.env.KB02_TRACE=path.resolve(prefix+'provider-trace.jsonl');process.env.KB02_TRACE_LEDGER=path.resolve(prefix+'provider-attempts.jsonl');
await import('./KB02-PLAN-AUDIT-20261022-trace-hook.mjs');
const provider=new OpenAiCompatibleProvider(config);
// Isolated in-memory diagnostic of original extracted records. Never migrate an on-disk checkpoint.
let cp=structuredClone({...source.checkpoint,rulesVersion:bundle.rulesVersion,lastError:undefined,plan:undefined}),calls=0,request,response;
const report={at:new Date().toISOString(),originalSequence:sequence,scope:'isolated in-memory original records under current rules; not production checkpoint migration',rawHash:createHash('sha256').update(source.raw.body).digest('hex'),rulesVersion:bundle.rulesVersion};
try{
 const result=await runKnowledgePipeline({raw:source.raw,body:source.raw.body,bodySha256:report.rawHash,rulesDir:'rules',checkpoint:cp,provider:{name:provider.name,model:provider.model,secrets:provider.secrets,complete:async r=>{if(calls++)throw Error('One diagnostic call only');request=r;const result=await provider.complete(r);response=JSON.parse(result.text);return result;}},beforeCall:async stage=>(cp={...cp,stage,attempts:cp.attempts+1}),saveCheckpoint:async value=>(cp=value)});
 report.result='PASS';report.pages=result.outcome.pages;report.plan=cp.plan;
}catch(e){report.result='FAIL';report.error={code:e.code,message:e.message};}
report.calls=calls;report.request=request;report.response=response;report.diagnostic=cp.lastError?.diagnostic;
if(response?.pages){report.assignments=response.pages.map(p=>({title:p.title,factIds:p.factIds,questionIds:p.questionIds,areas:[...new Set([...p.factIds,...p.questionIds].map(id=>source.expectedAreas?.[id]).filter(Boolean))]}));}
await fs.writeFile(prefix+`diagnostic-${sequence}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({result:report.result,error:report.error,calls,assignments:report.assignments,diagnostic:report.diagnostic}));
if(report.result==='FAIL')process.exitCode=1;
