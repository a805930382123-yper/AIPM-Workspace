import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHarness, expect, request, rawInput, wikiInput, fileSnapshot, delay} from './b08-harness.mjs';
import {fakeReply} from './b05-fake-reply.mjs';
const prefix='docs/reports/FULL2-20261010-spec-repair-http', started=Date.now(), checks=[];
let h, s, raw, wiki, audit;
const clean=()=>({replacement:'采用验收原文口径。',rationale:'逐字证据支持',evidence:[{rawId:raw.id,quote:'验收原文'}]});
const safeError=e=>String(e).replaceAll(h?.fakeKey??'not-a-secret','[REDACTED]');
async function test(id,fn){try{const details=await fn();checks.push({id,result:'PASS',details});}catch(e){checks.push({id,result:'FAIL',message:safeError(e)});}}
try{
 h=await createHarness(clean);s=await h.start();
 // Dummy credential in an explicit isolated Raw enables a structurally valid evidence echo test.
 raw=await expect(s,'/api/raw','POST',rawInput('密钥拒绝边界',`验收原文：口径待核实。隔离虚构引用 ${h.fakeKey}。`),201);
 wiki=await expect(s,'/api/wiki','POST',wikiInput('返修验收 Wiki',[raw.id],'人工原始正文。'),201);
 audit=await expect(s,'/api/audits','POST',{wikiId:wiki.id,scope:'page',severity:'warning',comment:'返修验收'},201);
 const badCases=[
  ['S01-replacement',()=>({...clean(),replacement:'回显 '+h.fakeKey})],
  ['S01-rationale',()=>({...clean(),rationale:'理由 '+h.fakeKey})],
  ['S01-valid-evidence',()=>({...clean(),evidence:[{rawId:raw.id,quote:h.fakeKey}]})],
  ['S01-escaped-json',()=>JSON.stringify({...clean(),replacement:h.fakeKey}).replaceAll(h.fakeKey,[...h.fakeKey].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''))],
  ['S01-extra-key',()=>({...clean(),[h.fakeKey]:'不应公开'})],
  ['S01-malformed-json',()=>'{"replacement":"'+h.fakeKey+'"'],
  ['S01-provider-error',()=>({httpStatus:401,message:'Provider error '+h.fakeKey})],
 ];
 for(const [id,reply] of badCases)await test(id,async()=>{
  h.setReply(reply);const before=await fileSnapshot(h.dataRoot), calls=h.requests.length;
  const r=await request(s,`/api/audits/${audit.id}/propose`,'POST',{});
  assert.equal(r.status,502,'Unsafe output must return safe upstream failure');
  assert.ok(r.json?.error?.code,'Expected explicit error code');
  assert.ok(!r.text.includes(h.fakeKey),'Response must not echo credential');
  assert.deepEqual(await fileSnapshot(h.dataRoot),before,'Failure must not mutate assets or state');
  assert.ok(h.requests.length>calls,'Actual HTTP provider adapter must be exercised');
  assert.ok(!s.logs.includes(h.fakeKey),'Ordinary service logs must not echo credential');
  return {status:r.status,code:r.json.error.code,noWrites:true,noSecretInResponseOrLogs:true,providerCalls:h.requests.length-calls};
 });
 let good;
 await test('S01-clean-retry',async()=>{h.setReply(clean);good=await expect(s,`/api/audits/${audit.id}/propose`,'POST',{},201);assert.equal(good.draft.status,'pending');assert.equal(good.draft.replacement,clean().replacement);return {draftCreated:true,onlyDraft:true};});
 await test('S01-preserve-existing-pending',async()=>{
  assert.ok(good);h.setReply(()=>({...clean(),rationale:h.fakeKey}));const before=await fileSnapshot(h.dataRoot);
  const r=await request(s,`/api/audits/${audit.id}/propose`,'POST',{});assert.equal(r.status,502);assert.ok(!r.text.includes(h.fakeKey));assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  return {status:r.status,pendingPreserved:true};
 });
 await test('S01-restart-and-retry',async()=>{
  assert.ok(good);const before=await fileSnapshot(h.dataRoot);await h.stop(s);s=await h.start();assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  h.setReply(clean);const next=await expect(s,`/api/audits/${audit.id}/propose`,'POST',{},201);assert.notEqual(next.draft.id,good.draft.id);
  const old=JSON.parse(await fs.readFile(path.join(h.dataRoot,'drafts/audit',good.draft.id+'.json'),'utf8'));assert.equal(old.status,'discarded');
  assert.equal((await expect(s,`/api/wiki/${wiki.id}`,'GET')).body,wiki.body);assert.equal((await expect(s,`/api/raw/${raw.id}`,'GET')).body,raw.body);
  return {restartStable:true,cleanReplacementWorks:true,rawAndWikiUnchanged:true};
 });
 // Raw fixture is separate from the dummy-credential evidence source above.
 let valid, original, rawFile;
 await test('S02-valid-byte-preservation',async()=>{
  valid=await expect(s,'/api/raw','POST',rawInput('精确正文','  首行\r\n中文与 emoji 🧪\n---\n尾行  \n'),201);
  rawFile=path.join(h.dataRoot,'knowledge/raw/reports',valid.id+'.md');original=await fs.readFile(rawFile);
  assert.equal((await expect(s,`/api/raw/${valid.id}`,'GET')).body,valid.body);
  assert.equal((await expect(s,'/api/raw','GET')).items.find(x=>x.id===valid.id).body,valid.body);
  return {mixedNewlinesAndWhitespaceExact:true};
 });
 async function corruptAndReject(id,mutate){await test(id,async()=>{
  assert.ok(original);await fs.writeFile(rawFile,mutate(original.toString('utf8')));
  const before=await fileSnapshot(h.dataRoot), calls=h.requests.length, statuses=[];
  for(const [url,method] of [[`/api/raw/${valid.id}`,'GET'],['/api/raw','GET'],['/api/raw?summary=true','GET'],[`/api/raw/${valid.id}/extract`,'POST']]){
   const r=await request(s,url,method,method==='POST'?{}:undefined);assert.equal(r.status,409,'Corrupt Raw must be rejected before consumption');
   assert.equal(r.json?.error?.code,'RAW_INTEGRITY_ERROR','Expected stable integrity error');statuses.push(r.status);
   assert.ok(!r.text.includes('外部非法正文'),'Error must not return corrupt content');
  }
  await delay(150);assert.equal(h.requests.length,calls,'Must not contact Provider');assert.deepEqual(await fileSnapshot(h.dataRoot),before,'Must not create jobs/drafts/processing or silently fix Raw');
  await fs.writeFile(rawFile,original);assert.equal((await expect(s,`/api/raw/${valid.id}`,'GET')).body,valid.body);
  return {statuses,providerCalls:0,noWrites:true,restorationWorks:true};
 });if(original)await fs.writeFile(rawFile,original);}
 await corruptAndReject('S02-body-tamper',text=>text.replace('中文与 emoji 🧪','外部非法正文'));
 await corruptAndReject('S02-missing-digest',text=>text.replace(/^bodySha256:.*\n/m,''));
 await corruptAndReject('S02-invalid-digest',text=>text.replace(/^bodySha256:.*$/m,'bodySha256: invalid'));
 await test('S02-restart-corrupt-and-recover',async()=>{
  const tampered=Buffer.from(original.toString('utf8').replace('首行','外部非法正文'));await fs.writeFile(rawFile,tampered);await h.stop(s);s=await h.start();
  const calls=h.requests.length;const r=await request(s,`/api/raw/${valid.id}/extract`,'POST',{});assert.equal(r.status,409);assert.equal(r.json?.error?.code,'RAW_INTEGRITY_ERROR');assert.equal(h.requests.length,calls);
  assert.deepEqual(await fs.readFile(rawFile),tampered);await fs.writeFile(rawFile,original);
  const listed=await expect(s,'/api/raw','GET');assert.ok(listed.items.some(x=>x.id===valid.id));
  return {startupAvailable:true,stillRejected:true,noProviderCall:true,restoredReadWorks:true};
 });
 await test('S02-restored-first-extraction',async()=>{
  h.setReply(fakeReply);const beforeRaw=await fileSnapshot(path.join(h.dataRoot,'knowledge/raw')), calls=h.requests.length;
  const begun=await expect(s,`/api/raw/${valid.id}/extract`,'POST',{},202);let job;
  for(let i=0;i<200;i++){job=await expect(s,`/api/extraction-jobs/${begun.jobId}`,'GET');if(job.status!=='running')break;await delay(60);}
  assert.equal(job.status,'completed','Restored Raw must successfully extract');assert.ok(h.requests.length>calls);
  const draft=await expect(s,`/api/drafts/${job.draftId}`,'GET');assert.equal(draft.rawSha256,valid.bodySha256);
  assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge/raw')),beforeRaw);
  return {status:job.status,providerActuallyCalled:true,draftDigestCorrect:true,rawBytesUnchanged:true};
 });
}catch(e){checks.push({id:'setup',result:'FAIL',message:safeError(e)});}finally{
 if(h)await h.close();
 const report={startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,provider:'local HTTP fake only; real quality BLOCKED',checks,summary:{pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length},servicesClosed:h?.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null),dataRoot:h?.dataRoot};
 await fs.writeFile(prefix+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({summary:report.summary,servicesClosed:report.servicesClosed,durationMs:report.durationMs}));if(report.summary.fail)process.exitCode=1;
}
