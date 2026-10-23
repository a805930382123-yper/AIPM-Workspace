// Independent offline review: injected historical responses; no provider configuration.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { chunkText } from '../../services/llm/chunk.ts';
const sha = x => createHash('sha256').update(x).digest('hex');
let networkAttempts=0;
const deny=()=>{networkAttempts++;throw Error('offline only');};
globalThis.fetch=deny; for(const m of [http,https]){m.request=deny;m.get=deny;} net.connect=deny;net.createConnection=deny;tls.connect=deny;
const diag='docs/reports/KB02-SUPPLEMENT-DIAG-20261023-';
const hist='docs/reports/KB02-REGION-AUDIT-20261023-';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const protectedPaths=Object.keys((await read(diag+'baseline.json')).protected);
for(const dir of ['docs/reports','tests/acceptance']) for(const name of await fs.readdir(dir)) if(name.startsWith('KB02-SUPPLEMENT-DIAG-20261023-'))protectedPaths.push(dir+'/'+name);
async function snapshot(){return Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,sha(await fs.readFile(p))])));}
const before=await snapshot();
const traces=(await fs.readFile(hist+'provider-trace.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const trace=n=>traces.find(t=>t.sequence===n);
const input=n=>JSON.parse(trace(n).request.messages.find(m=>m.role==='user').content.split('\n').at(-1));
const actual=input(202),plan=JSON.parse(trace(202).response.content),body=actual.sourceContexts[0].text;
assert.equal(body.length,160);assert(actual.sourceContexts.every(s=>s.text===body&&s.contextStart===0&&s.contextEnd===160));
const bundle=await loadExtractionRules('rules');
const chunks=chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end}));
const empty={version:1,jobId:'independent-offline',rawId:'11509acd-efd2-4f2c-b9a6-42044be7bec6',rawSha256:sha(body),pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'offline',chunks,completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString(),integrity:'memory'};
async function run(candidate,initial=empty){
 let cp=structuredClone(initial),calls=0,writes=0;const requests=[];
 const responses=cp.completedChunks.length?[JSON.stringify(candidate)]:[trace(201).response.content,JSON.stringify(candidate)];
 const provider={name:'offline',model:'historical',secrets:[],complete:async r=>{requests.push(r);const text=responses[calls++];assert(text);return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};}};
 let result,error;
 try{result=await runKnowledgePipeline({raw:{id:empty.rawId,title:'offline fictional',sourceType:'report',sourceName:'offline',tags:[]},body,bodySha256:sha(body),rulesDir:'rules',provider,checkpoint:cp,beforeCall:async stage=>cp={...cp,stage,attempts:cp.attempts+1},saveCheckpoint:async value=>{writes++;return cp=value;}});}catch(e){error=e.code??e.message;}
 return {cp,calls,writes,result,error,requests};
}
const original=await run(plan);assert(!original.error);assert.equal(original.calls,2);
assert.equal(original.requests[1].system,trace(202).request.messages.find(m=>m.role==='system').content);
assert.deepEqual(JSON.parse(original.requests[1].user.split('\n').at(-1)),actual);
const ai=original.result.outcome.pages.find(p=>p.title==='AI异常提示机制（未上线，未来建议）');assert(ai);
assert.deepEqual(ai.source_facts.map(f=>f.text),['AI异常提示为未来建议，无上线或收益事实。']);assert.equal(ai.one_line_definition,ai.title);
const initial=structuredClone(original.cp);delete initial.plan;initial.attempts=1;initial.stage='planning';
const corrected=structuredClone(plan);corrected.pages[1].factUnitIds.push(corrected.pages[2].factUnitIds[0]);corrected.pages.pop();
const positive=await run(corrected,initial);assert(!positive.error);assert.deepEqual(positive.cp.plan.pages.flatMap(p=>p.factIds).sort(),original.cp.plan.pages.flatMap(p=>p.factIds).sort());
const unknown=structuredClone(plan);unknown.pages[2].factUnitIds=['fu-unknown'];
const negative=await run(unknown,initial);assert.equal(negative.error,'LLM_PLAN_COVERAGE_INVALID');assert(!negative.cp.plan);assert(!negative.result);
const old=structuredClone(initial);old.rulesVersion='old-revision';
const incompatible=await run(plan,old);assert.equal(incompatible.error,'LLM_CHECKPOINT_INCOMPATIBLE');assert.equal(incompatible.calls,0);assert.equal(incompatible.writes,0);
const sizes=[185,200,202].map(n=>({sequence:n,planningBytes:Buffer.byteLength(JSON.stringify(input(n))),reviewCandidateBytes:Buffer.byteLength(JSON.stringify({input:input(n),plan:JSON.parse(trace(n).response.content)}))}));
assert(sizes.every(x=>x.reviewCandidateBytes<192*1024));
assert.deepEqual(await snapshot(),before);assert.equal(networkAttempts,0);
const result={at:new Date().toISOString(),command:'node --import tsx tests/acceptance/KB02-SUPPLEMENT-AUDIT-20261023-review.mjs',node:process.version,head:'4ee5dd13f2abce6c6124e3f2ce4d33fd846e65ac',productCommit:'17121be7ec20f73b367750d281a4e1dd2c742a76',sourceHashes:before,protectedPaths:protectedPaths.length,changed:[],original:{exactInput:true,exactSystem:true,fullContexts:5,pages:original.result.outcome.pages.length,aiTitle:ai.title,aiFacts:ai.source_facts,oneLineCopiesTitle:true,mechanicallyAccepted:true,semanticPass:false},controls:{fixtureTwoPagesAccepted:true,allFactIdsRetained:true,unknownUnitRejected:negative.error,oldRevisionZeroCallsZeroWrites:incompatible.error},sizes,realCalls:0,networkAttempts,kb02Cumulative:203,scope:'independent current pipeline only; proposed semantic reviewer not implemented or tested'};
await fs.writeFile('docs/reports/KB02-SUPPLEMENT-AUDIT-20261023-review.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,sourceHashes:undefined}));
