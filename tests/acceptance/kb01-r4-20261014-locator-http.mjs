// Independent public API exercise of v2. Local fake only; no external quality claim.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {createHarness,expect,rawInput,fileSnapshot,delay} from './cfg01-20261014-security-harness.mjs';
const checks=[],key='r4-independent-locator-secret!',h=await createHarness(()=>({}),undefined,key);let s;
function reply(wire,mutation){const user=wire.messages.at(-1).content;const match=user.match(/当前分块证据 locator 目录[^\n]*\n(\[.*\])\n/);assert(match,'Actual wire lacks bounded locator catalog');const catalog=JSON.parse(match[1]);const locator=catalog.findLast(x=>x.text.includes('铺货率20%'));assert(locator);const value={evidence_format_version:2,document:{title:'独立虚构资料',main_topic:'铺货率',summary:'虚构门店数铺货率20%。'},suggested_pages:[{title:'独立铺货率',type:'metric',category:'metric',one_line_definition:'目标门店覆盖比例。',source_facts:[{text:'虚构门店数铺货率20%。',evidenceIds:['e1']}],ai_organized:[],ai_inferences:[],related_pages:[],open_questions:[],source_evidence:[{id:'e1',locatorId:locator.id}]}]};mutation?.(value,catalog);return value;}
async function run(name,mutation,code,includeKey=false){
 const body=('重复说明：虚构门店数铺货率20%。'+(includeKey?key:'')+'\r\n'+'😀'.repeat(260)+'\r\n').repeat(3),raw=await expect(s,'/api/raw','POST',rawInput(name,body),201),snap=await fileSnapshot(path.join(h.dataRoot,'knowledge'));
 h.setReply(wire=>reply(wire,mutation));const started=await expect(s,'/api/raw/'+raw.id+'/extract','POST',{},202);let job;
 for(let i=0;i<240;i++){job=await expect(s,'/api/extraction-jobs/'+started.jobId);if(job.status!=='running')break;await delay(25);}assert.equal((await expect(s,'/api/raw/'+raw.id)).body,body);
 if(code){assert.equal(job.status,'failed',JSON.stringify(job));assert.equal(job.error.code,code);assert.equal(job.draftId,null);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),snap);return {error:code,rawExact:true,noDraftOrFormalWrite:true};}
 assert.equal(job.status,'completed',JSON.stringify(job));const draft=await expect(s,'/api/drafts/'+job.draftId),e=draft.pages[0].source_evidence[0];assert.equal(e.rawId,raw.id);assert.equal(body.slice(e.start,e.end),e.quote);assert(e.start>500,'Repeated later occurrence must bind to chosen locator, not first match');assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),snap);return {start:e.start,end:e.end,quoteLength:e.quote.length,rawExact:true,noFormalWrite:true};
}
async function test(id,fn){try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',message:e.message.replaceAll(key,'[redacted]')});}console.log(id+': '+checks.at(-1).result);}
try{s=await h.start();
 await test('V01-valid-later-repeated-CRLF-emoji',()=>run('R4正确重复证据'));
 await test('V02-unknown-locator',()=>run('R4未知定位',v=>v.suggested_pages[0].source_evidence[0].locatorId='unknown','LLM_EVIDENCE_UNKNOWN_LOCATOR'));
 await test('V03-cross-chunk-locator',()=>run('R4跨块定位',v=>v.suggested_pages[0].source_evidence[0].locatorId='c2-l001','LLM_EVIDENCE_UNKNOWN_LOCATOR'));
 await test('V04-mixed-v2-quote',()=>run('R4混用定位',v=>v.suggested_pages[0].source_evidence[0].quote='虚构门店数铺货率20%。','LLM_SCHEMA_INVALID'));
 await test('V05-page-reference-missing',()=>run('R4缺失引用',v=>v.suggested_pages[0].source_facts[0].evidenceIds=['missing'],'LLM_EVIDENCE_UNKNOWN_ID'));
 await test('V06-known-secret-in-locator',()=>run('R4凭证定位',v=>v.suggested_pages[0].source_evidence[0].locatorId=key,'LLM_OUTPUT_CONTAINS_SECRET'));
 await test('V07-version-missing-not-coerced',()=>run('R4缺失版本',v=>delete v.evidence_format_version,'LLM_SCHEMA_INVALID'));
 await test('V09-derived-Raw-secret-rejected',()=>run('R4原文派生凭证',undefined,'LLM_OUTPUT_CONTAINS_SECRET',true));
 await test('V08-unknown-top-field',()=>run('R4额外字段',v=>v.extra='bad','LLM_SCHEMA_INVALID'));
}finally{await h.close();const summary={pass:checks.filter(c=>c.result==='PASS').length,fail:checks.filter(c=>c.result==='FAIL').length};await fs.writeFile('docs/reports/KB01-R4-20261014-locator-http.json',JSON.stringify({at:new Date().toISOString(),scope:'actual isolated HTTP, localhost fake, no real Provider quality',checks,summary,fakeCalls:h.requests.length,servicesClosed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null)},null,2));console.log(summary);if(summary.fail)process.exitCode=1;}
