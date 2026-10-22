// Independent adapter safety probes intercept every fetch: zero network/real Provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {OpenAiCompatibleProvider,assertNoKnownSecret} from '../../services/llm/provider.ts';
import {FROZEN_BUDGETS} from '../../services/llm/rules.ts';
const checks=[],started=Date.now(),calls=[],originalFetch=globalThis.fetch;
let responder=()=>new Response(JSON.stringify({choices:[{message:{content:'{"safe":"OK"}'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,init)=>{calls.push({url:String(url),wire:JSON.parse(init.body),signal:init.signal});return responder(url,init);};
const fixtureKey='standards-adapter-local-fixture-credential!9';
const adapter=(baseUrl='https://open.bigmodel.cn/api/paas/v4',model='glm-5.3-flash')=>new OpenAiCompatibleProvider({baseUrl,model,apiKey:fixtureKey});
const request=(extra={})=>({system:'固定独立系统',user:'固定虚构资料',timeoutMs:50,maxOutputBytes:4096,...extra});
async function denied(p,code){try{await p;throw Error('Expected '+code+' rejection');}catch(e){assert.equal(e.code,code);assert(!e.message.includes(fixtureKey));return {code:e.code,message:e.message};}}
async function test(id,fn){try{checks.push({id,result:'PASS',evidence:await fn()});}catch(e){checks.push({id,result:'FAIL',error:e.stack});}console.log(id+': '+checks.at(-1).result);}
try{
 await test('P01-budget-frozen-contract',async()=>{assert.equal(FROZEN_BUDGETS.callTimeoutMs,60000);assert.equal(FROZEN_BUDGETS.totalDeadlineMs,600000);assert.equal(FROZEN_BUDGETS.maxOutputBytesPerCall,2097152);assert.equal(FROZEN_BUDGETS.maxConcurrentChunks,2);assert.equal(FROZEN_BUDGETS.maxRawChars,500000);return FROZEN_BUDGETS;});
 await test('P02-declared-output-byte-budget',async()=>{responder=()=>new Response('x'.repeat(5000),{headers:{'content-length':'5000'}});return denied(adapter().complete(request()),'LLM_RESPONSE_TOO_LARGE');});
 await test('P03-stream-output-byte-budget',async()=>{responder=()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(2500)));c.enqueue(new TextEncoder().encode('x'.repeat(2500)));c.close();}}));return denied(adapter().complete(request()),'LLM_RESPONSE_TOO_LARGE');});
 await test('P04-auth-error-redaction',async()=>{responder=()=>new Response(JSON.stringify({error:{message:'synthetic echo '+fixtureKey}}),{status:401});return denied(adapter().complete(request()),'LLM_AUTH_FAILED');});
 await test('P05-auth-error-output-budget',async()=>{responder=()=>new Response(JSON.stringify({error:{message:'x'.repeat(5000)}}),{status:401});return denied(adapter().complete(request()),'LLM_RESPONSE_TOO_LARGE');});
 await test('P06-timeout-is-visible',async()=>{responder=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('synthetic aborted','AbortError')),{once:true}));return denied(adapter().complete(request({timeoutMs:30})),'LLM_TIMEOUT');});
 await test('P07-explicit-cancel-is-visible',async()=>{const ctrl=new AbortController();responder=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('synthetic aborted','AbortError')),{once:true}));const pending=adapter().complete(request({timeoutMs:1000,signal:ctrl.signal}));setTimeout(()=>ctrl.abort(),10);return denied(pending,'LLM_CANCELLED');});
 await test('P08-truncation-rejected',async()=>{responder=()=>new Response(JSON.stringify({choices:[{message:{content:'{"safe":"partial"}'},finish_reason:'length'}]}));return denied(adapter().complete(request()),'LLM_OUTPUT_TRUNCATED');});
 await test('P09-invalid-wire-json-rejected',async()=>{responder=()=>new Response('not JSON');return denied(adapter().complete(request()),'LLM_PROVIDER_ERROR');});
 await test('P10-known-key-nested-json-value-rejected',async()=>{for(const value of [{['echo_'+fixtureKey]:'ordinary'},{safe:[{nested:fixtureKey}]}])assert.throws(()=>assertNoKnownSecret(value,[fixtureKey]),e=>e.code==='LLM_OUTPUT_CONTAINS_SECRET');return {keyAndNestedValueRejected:true};});
}finally{globalThis.fetch=originalFetch;const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};await fs.writeFile('docs/reports/KB01-R4-20261014-standards-adapter-budget.json',JSON.stringify({at:new Date().toISOString(),kind:'Adapter budgets/error mechanics, all fetch intercepted, no network',durationMs:Date.now()-started,checks,summary,interceptedFetchCalls:calls.length},null,2));console.log(summary);if(summary.fail)process.exitCode=1;}
