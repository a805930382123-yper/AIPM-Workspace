// Independent multi-credential behavior through all six services, plus Audit regression.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RawStore} from '../../services/raw/store.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
import {PromptStore} from '../../services/prompt/store.ts';
import {PromptAiService} from '../../services/prompt-ai/service.ts';
import {LLMService} from '../../services/llm/service.ts';
import {AuditService} from '../../services/audit/service.ts';
import {sanitizeDeep,sanitizeProviderText,describeUnparsable,LlmError} from '../../services/llm/provider.ts';
import {fileSnapshot,rawInput,wikiInput} from './b07-harness.mjs';
import {fakeReply,bodyA,bodyB} from './b05-fake-reply.mjs';
import {reply as promptReply,brief} from './b08-fixtures.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-sec-service-')),checks=[],started=Date.now();
const secrets=['service-long-fixture-Z7!', 'v3P!?', 'q"\\!', '密🔑', '$'];
const sanitize=s=>secrets.reduce((s,k)=>s.replaceAll(k,'[fixture redacted]'),String(s));
async function test(id,fn){try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',reason:sanitize(e.message)});}console.log(`${id}: ${checks.at(-1).result}`);}
let responder,activeSecrets=secrets.concat('');
const provider={name:'isolated-multiple-secret-fixture',model:'no-real-model',get secrets(){return activeSecrets;},async complete(req){const text=await responder({messages:[{role:'system',content:req.system},{role:'user',content:req.user}]});return {text:typeof text==='string'?text:JSON.stringify(text),bytes:Buffer.byteLength(typeof text==='string'?text:JSON.stringify(text)),finishReason:'stop'};}};
const raws=new RawStore(root);await raws.initialize();const wiki=new WikiStore(root,raws);await wiki.initialize();const workflows=new KnowledgeWorkflowStore(root,wiki,raws);await workflows.initialize();const prompts=new PromptStore(root,wiki);await prompts.initialize();const promptAi=new PromptAiService(root,wiki,prompts,()=>provider);await promptAi.initialize();const llm=new LLMService(path.resolve('rules'));
const a=await raws.create(rawInput('多凭证A',bodyA)),b=await raws.create(rawInput('多凭证B',bodyB));const page=await wiki.create(wikiInput('手动基线',[a.id],'人工正文'));
responder=fakeReply;const outcome=await llm.wikiExtract({raw:b,body:b.body,provider});const draft={revision:1,rawSha256:b.bodySha256,pages:[{...outcome.pages[0],pageId:randomUUID()}]};
const actions={
 synthesis:()=>workflows.createSynthesis({rawIds:[a.id,b.id],provider}),
 update:()=>workflows.createUpdate({draftId:randomUUID(),pageId:draft.pages[0].pageId,baseRevision:1,targetWikiId:page.id,draft,raw:b,target:page,provider}),
 brief:()=>promptAi.brief('业务需求','business_process'),
 generate:()=>promptAi.generate(brief,[page.id]),
 optimize:()=>promptAi.optimize('分析目标', '补充要求',undefined,undefined),
 extract:()=>llm.wikiExtract({raw:b,body:b.body,provider}),
};
for(const kind of Object.keys(actions)){
 for(const [index,key]of secrets.entries())for(const variant of ['value','key','escaped'])await test(`${kind}-multi${index+1}-${variant}`,async()=>{
  responder=wire=>{const o=['brief','generate','optimize'].includes(kind)?promptReply(wire):fakeReply(wire);
   if(variant==='key')o.extra={['echo_'+key]:'safe'};
   else if(kind==='extract')o.document.summary+=' echo '+key;
   else if(kind==='brief')o.context+=' echo '+key;
   else if(kind==='generate'||kind==='optimize')o.preview.body+=' echo '+key;
   else o.inferences.push('echo '+key);
   let text=JSON.stringify(o);if(variant==='escaped')text=JSON.stringify(o).replaceAll(JSON.stringify(key).slice(1,-1),key.split('').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));return text;
  };
  const before=await fileSnapshot(root);let caught;try{await actions[kind]();}catch(e){caught=e;}
  assert.ok(caught,'Known secret must reject');assert.equal(caught.code,'LLM_OUTPUT_CONTAINS_SECRET');assert.equal(caught.status,502);
  const exposed=JSON.stringify({code:caught.code,message:caught.message,details:caught.details});assert.ok(!secrets.some(s=>exposed.includes(s)),'Error must not echo any secret');assert.deepEqual(await fileSnapshot(root),before);
  return {allKnownSecretsChecked:true,noWrites:true,safeError:true};
 });
 for(const empty of [false,true])await test(`${kind}-${empty?'empty-secret':'known-secrets'}-normal`,async()=>{activeSecrets=empty?['']:secrets.concat('');responder=wire=>['brief','generate','optimize'].includes(kind)?promptReply(wire):fakeReply(wire);try{assert.ok(await actions[kind]());return {normalOutputPassed:true};}finally{activeSecrets=secrets.concat('');}});
}
for(const kind of ['synthesis','update','brief','generate','optimize'])await test(`${kind}-provider-error-details`,async()=>{
 const before=await fileSnapshot(root);responder=()=>{throw new LlmError('FIXTURE_UPSTREAM_FAILURE','error '+secrets.join(' '),502,{['echo_'+secrets[1]]:{text:secrets[2]},nested:[secrets[0],secrets[3],secrets[4]]});};
 let caught;try{await actions[kind]();}catch(e){caught=e;}assert.ok(caught);assert.equal(caught.status,502);
 assert.ok(!secrets.some(k=>JSON.stringify({code:caught.code,message:caught.message,details:caught.details}).includes(k)));assert.deepEqual(await fileSnapshot(root),before);return {safeDetailsAndKeys:true,noWrites:true};
});
await test('decoded-error-keys-values-and-prefix',async()=>{
 const obj={};for(const s of secrets)obj['echo_'+s]={value:'message '+s,items:['array '+s]};
 const safe=JSON.stringify(sanitizeDeep(obj,secrets));assert.ok(!secrets.some(s=>safe.includes(s)));
 for(const s of secrets){assert.ok(!sanitizeProviderText('error '+s,secrets).includes(s));assert.ok(!JSON.stringify(describeUnparsable(s+' invalid',secrets)).includes(s));}
 return {allSecretsRemoved:true};
});
const audits=new AuditService(root,wiki,raws);await audits.initialize();const audit=await audits.create({wikiId:page.id,scope:'page',severity:'warning',comment:'核查'});
for(const [index,key]of secrets.entries())await test(`audit-regression-multi${index+1}`,async()=>{
 responder=()=>({replacement:'echo '+key,rationale:'safe',evidence:[]});const before=await fileSnapshot(root);let caught;try{await audits.propose(audit.id,provider);}catch(e){caught=e;}
 assert.equal(caught?.code,'LLM_OUTPUT_CONTAINS_SECRET');assert.deepEqual(await fileSnapshot(root),before);return {noWrites:true};
});
const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};
await fs.writeFile('docs/reports/SEC-20261013-services.json',JSON.stringify({scope:'direct product services, multiple fictional secrets, no external provider',dataRoot:root,durationMs:Date.now()-started,checks,summary},null,2));console.log(JSON.stringify(summary));if(summary.fail)process.exitCode=1;
