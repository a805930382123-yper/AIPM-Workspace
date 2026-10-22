// Independent purpose/host/model wire boundaries. Every fetch intercepted; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {OpenAiCompatibleProvider} from '../../services/llm/provider.ts';
const originalFetch=globalThis.fetch,calls=[],checks=[],started=Date.now();
globalThis.fetch=async(url,init)=>{const call={url:String(url),body:JSON.parse(init.body)};calls.push(call);return new Response(JSON.stringify({choices:[{message:{content:'{"safe":"OK"}'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});};
const cases=[
 ['official-cn-knowledge','https://open.bigmodel.cn/api/paas/v4','glm-5.3-flash','knowledge',true],
 ['official-za-knowledge','https://api.z.ai/api/paas/v4','glm-5.3-flash','knowledge',true],
 ['official-cn-no-purpose','https://open.bigmodel.cn/api/paas/v4','glm-5.3-flash',undefined,false],
 ['official-cn-other-purpose','https://open.bigmodel.cn/api/paas/v4','glm-5.3-flash','prompt',false],
 ['official-cn-unknown-case-purpose','https://open.bigmodel.cn/api/paas/v4','glm-5.3-flash','Knowledge',false],
 ['same-model-other-host','https://provider.example.test/v1','glm-5.3-flash','knowledge',false],
 ['same-model-loopback','http://127.0.0.1:45678/v1','glm-5.3-flash','knowledge',false],
 ['official-cn-other-model','https://open.bigmodel.cn/api/paas/v4','glm-5.1-flash','knowledge',false],
 ['official-cn-extended-model','https://open.bigmodel.cn/api/paas/v4','glm-5.3-flash-preview','knowledge',false],
 ['host-suffix-spoof','https://open.bigmodel.cn.example.test/api/paas/v4','glm-5.3-flash','knowledge',false],
 ['host-prefix-spoof','https://fake-open.bigmodel.cn/api/paas/v4','glm-5.3-flash','knowledge',false],
 ['cn-case-normalized','https://OPEN.BIGMODEL.CN/api/paas/v4','GLM-5.3-FLASH','knowledge',true],
];
try{for(const [id,baseUrl,model,purpose,expected]of cases){try{const p=new OpenAiCompatibleProvider({baseUrl,model,apiKey:'kb01-independent-wire-local-fixture!'}),r=await p.complete({system:'独立系统原样',user:'虚构用户资料原样',timeoutMs:1000,maxOutputBytes:2048,...(purpose===undefined?{}:{purpose})}),c=calls.at(-1);assert.equal(r.text,'{"safe":"OK"}');const standard={model,stream:false,temperature:0,messages:[{role:'system',content:'独立系统原样'},{role:'user',content:'虚构用户资料原样'}],...(expected?{reasoning_effort:'low',response_format:{type:'json_object'}}:{})};assert.deepEqual(c.body,standard,'Only exact approved knowledge wire adds reasoning_effort');assert.equal(c.url,baseUrl.replace('OPEN.BIGMODEL.CN','open.bigmodel.cn')+'/chat/completions');checks.push({id,result:'PASS',wire:c.body,lowReasoning:expected});}catch(e){checks.push({id,result:'FAIL',error:e.stack});}console.log(id+': '+checks.at(-1).result);}}finally{globalThis.fetch=originalFetch;const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};await fs.writeFile('docs/reports/KB01-R4-20261014-standards-adapter-wire.json',JSON.stringify({at:new Date().toISOString(),kind:'All fetch intercepted; exact wire boundary mechanics; no external or real Provider',durationMs:Date.now()-started,checks,summary,networkCalls:0},null,2));console.log(summary);if(summary.fail)process.exitCode=1;}
