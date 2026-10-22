// Independent actual product management API and provider transport, isolated config/data only.
import assert from 'node:assert/strict';
import {loadLlmConfig} from '../../services/llm/config.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createHarness,expect,req,summary,save,keys,redact,businessSnapshot,cleanWire,delay} from './cfg01-20261014-harness.mjs';
import {rawInput,fileSnapshot} from './b07-harness.mjs';
import {exportWorkspace} from '../../scripts/backup_workspace.ts';
const h=await createHarness(),checks=[],started=Date.now();let s,c;
const only=process.env.CFG01_ONLY?.split(',');
async function test(id,fn){if(only&&!only.includes(id))return;try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',reason:redact(e.message)});}console.log(`${id}: ${checks.at(-1).result}`);}
const configBytes=()=>fs.readFile(h.configFile,'utf8');
const noLeaks=async text=>{assert.ok(!keys.some(k=>String(text).includes(k)));assert.ok(!keys.some(k=>s.logs.includes(k)));};
const testConnection=async(previous=c)=>req(s,'/api/llm/config/test',{method:'POST',body:{revision:previous.revision,confirm:true},token:previous.writeToken});
const clear=async(previous=c)=>req(s,'/api/llm/config',{method:'DELETE',body:{revision:previous.revision,confirm:true},token:previous.writeToken});
const configured=async(key=keys[0],model='cfg01-model-a',baseUrl=h.baseUrl)=>{c=await save(s,{baseUrl,model,apiKey:key});return c;};
try{
 await fs.writeFile(h.configFile,'# unrelated preserved\r\nCUSTOM_OPTION="keep this exact line"\r\n\r\n');s=await h.start();
 await test('C01-empty-summary',async()=>{c=await summary(s);assert.equal(c.configured,false);assert.equal(c.keyConfigured,false);assert.equal(typeof c.writeToken,'string');assert.ok(c.writeToken.length>12);assert.equal(typeof c.revision,'string');await noLeaks(JSON.stringify(c));assert.equal(h.requests.length,0);return {configured:false,noProviderCalls:true};});
 await test('C02-first-save-requires-key',async()=>{const bytes=await configBytes();const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,baseUrl:h.baseUrl,model:'first-without-key'},token:c.writeToken});assert.ok(r.status>=400);assert.equal(await configBytes(),bytes);assert.equal(h.requests.length,0);return {requiredKey:true,noWrites:true};});
 await test('C01-new-fields-after-unrelated-no-newline',async()=>{
  const other=await createHarness();let os;try{await fs.writeFile(other.configFile,'LAST_LINE=untouched');os=await other.start();const result=await save(os,{baseUrl:other.baseUrl,model:'no-newline-model',apiKey:keys[0]});const bytes=await fs.readFile(other.configFile,'utf8');assert.equal(result.configured,true);assert.ok(bytes.startsWith('LAST_LINE=untouched\n')||bytes.startsWith('LAST_LINE=untouched\r\n'));assert.equal(other.requests.length,0);return {unrelatedContentPreserved:true,appendSeparated:true};}finally{await other.close();}
 });
 await test('C01-first-save-no-provider',async()=>{
  const before=await businessSnapshot(h),count=h.requests.length;c=await configured();assert.equal(c.configured,true);assert.equal(c.keyConfigured,true);assert.equal(c.baseUrl,h.baseUrl);assert.equal(c.model,'cfg01-model-a');assert.ok(!JSON.stringify(c).includes(keys[0]));assert.notEqual(c.revision,createHash('sha256').update(await configBytes()).digest('hex'));assert.ok((await configBytes()).includes('CUSTOM_OPTION="keep this exact line"\r\n'));assert.equal(h.requests.length,count);assert.deepEqual(await businessSnapshot(h),before);return {configured:true,noProviderCalls:true,noBusinessWrites:true,unrelatedLinePreserved:true};
 });
 await test('C01-keep-key-and-normalize-url',async()=>{const count=h.requests.length;c=await save(s,{baseUrl:h.baseUrl+'///',model:'cfg01-model-b'});assert.equal(c.model,'cfg01-model-b');assert.equal(c.keyConfigured,true);assert.equal((await loadLlmConfig({env:{},filePath:h.configFile})).apiKey,keys[0]);assert.equal(h.requests.length,count);await noLeaks(JSON.stringify(c));return {keptKey:true,noProviderCalls:true};});
 await test('C03-test-saved-fixed-message',async()=>{
  const before=await businessSnapshot(h),count=h.requests.length;h.setReply(cleanWire);const r=await testConnection();assert.equal(r.status,200);assert.equal(r.json.ok,true);assert.equal(h.requests.length,count+1);const wire=h.requests.at(-1);assert.equal(wire.credentialIndex,0);assert.equal(wire.model,'cfg01-model-b');assert.equal(wire.path,'/v1/chat/completions');assert.ok(wire.input.messages.every(m=>!String(m.content).includes('BUSINESS_ONLY_CFG01')));assert.deepEqual(await businessSnapshot(h),before);await noLeaks(r.text);return {fixedRequest:wire.input,authenticated:true,noBusinessWrites:true};
 });
 await test('C01-replace-key',async()=>{c=await configured(keys[1],'cfg01-model-short');assert.equal((await loadLlmConfig({env:{},filePath:h.configFile})).apiKey,keys[1]);assert.notEqual((await loadLlmConfig({env:{},filePath:h.configFile})).apiKey,keys[0]);await noLeaks(JSON.stringify(c));return {replacementStored:true,noKeyInSummary:true};});
 await test('C01-config-excluded-from-real-backup',async()=>{
  const output=path.join(path.dirname(h.root),path.basename(h.root)+'-backup.json');const before=await businessSnapshot(h);await exportWorkspace(h.root,output);const archive=JSON.parse(await fs.readFile(output,'utf8'));assert.ok(archive.files.every(f=>!f.path.includes('provider.env')));assert.ok(archive.files.every(f=>!keys.some(k=>Buffer.from(f.base64,'base64').toString('utf8').includes(k))));assert.deepEqual(await businessSnapshot(h),before);return {archiveFiles:archive.files.length,configAndKeyExcluded:true};
 });
 await test('C02-stale-revision',async()=>{const old=c;c=await save(s,{baseUrl:h.baseUrl,model:'cfg01-stale-new'});const bytes=await configBytes();const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:old.revision,baseUrl:h.baseUrl,model:'stale-should-not-save'},token:old.writeToken});assert.equal(r.status,409);assert.equal(await configBytes(),bytes);await noLeaks(r.text);return {status:409,oldFilePreserved:true};});
 await test('C02-external-edit-conflict',async()=>{const old=c;await fs.appendFile(h.configFile,'# external edit\r\n');const bytes=await configBytes();const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:old.revision,baseUrl:h.baseUrl,model:'stale-after-external'},token:old.writeToken});assert.equal(r.status,409);assert.equal(await configBytes(),bytes);c=await summary(s);return {status:409,externalLinePreserved:true};});
 await test('C02-concurrent-same-revision',async()=>{
  const old=c;const out=await Promise.all(['one','two'].map(v=>req(s,'/api/llm/config',{method:'PUT',body:{revision:old.revision,baseUrl:h.baseUrl,model:'race-'+v},token:old.writeToken})));assert.deepEqual(out.map(x=>x.status).sort(),[200,409]);c=await summary(s);assert.ok(['race-one','race-two'].includes(c.model));return {oneCommitOneConflict:true};
 });
 await test('C04-direct-validation-and-origin-guards',async()=>{
  if(!c?.configured)c=await configured(keys[1],'validation-only');
  const bytes=await configBytes(),before=await businessSnapshot(h),count=h.requests.length;let refused=0;
  for(const baseUrl of ['javascript:alert(1)','http://remote.example/v1','https://user:password@safe.example/v1','https://safe.example/v1?key=anything','https://safe.example/v1#fragment','https://safe.example/v1/chat/completions','https://safe.example/v1\nINJECT=1']){
   const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,baseUrl,model:'valid'},token:c.writeToken});assert.ok(r.status>=400,`URL case ${refused} unexpectedly accepted status ${r.status}`);await noLeaks(r.text);refused++;
  }
  for(const fields of [{model:'x\nINJECT=1'},{model:''},{apiKey:''},{apiKey:4},{apiKey:'bad\nINJECT=1'},{apiKey:'x'.repeat(10001)},{unknown:'field'},{baseUrl:h.baseUrl+'/echo/'+keys[1]},{model:'echo-'+keys[1]}]){
   const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,baseUrl:h.baseUrl,model:'valid',...fields},token:c.writeToken});assert.ok(r.status>=400,`Field case ${refused} unexpectedly accepted status ${r.status}`);await noLeaks(r.text);refused++;
  }
  for(const headers of [{'Origin':'https://attacker.example'},{'Origin':'null'},{'Host':'attacker.example'},{'Sec-Fetch-Site':'cross-site'},{'X-FMCG-Config-Token':'wrong'},{'content-type':'text/plain'}]){
   const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,baseUrl:h.baseUrl,model:'valid'},token:c.writeToken,headers});assert.ok(r.status>=400,`Header case ${refused} unexpectedly accepted status ${r.status}`);refused++;
  }
  for(const headers of [{Origin:'https://attacker.example'},{Origin:'null'},{Host:'attacker.example'},{'Sec-Fetch-Site':'cross-site'}]){
   for(const [route,options] of [['/api/llm/config',{headers}],['/api/llm/config/test',{method:'POST',body:{revision:c.revision,confirm:true},token:c.writeToken,headers}],['/api/llm/config',{method:'DELETE',body:{revision:c.revision,confirm:true},token:c.writeToken,headers}]]){
    const denied=await req(s,route,options);assert.equal(denied.status,403,'Cross-site/local-host read/test/delete guard');await noLeaks(denied.text);refused++;
   }
  }
  const missing=await req(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,baseUrl:h.baseUrl,model:'valid'}});assert.equal(missing.status,403);refused++;
  const crossTest=await req(s,'/api/llm/config/test',{method:'POST',body:{revision:c.revision,confirm:true},token:c.writeToken,headers:{Origin:'https://attacker.example'}});assert.equal(crossTest.status,403);refused++;
  const clearFalse=await req(s,'/api/llm/config',{method:'DELETE',body:{revision:c.revision,confirm:false},token:c.writeToken});assert.ok(clearFalse.status>=400);refused++;
  assert.equal(await configBytes(),bytes);assert.deepEqual(await businessSnapshot(h),before);assert.equal(h.requests.length,count);return {refused,noProviderCalls:true,oldFileAndBusinessUnchanged:true};
 });
 for(const method of ['writeFile','rename','readFile'])await test('C02-isolated-'+method+'-failure',async()=>{
  c=await summary(s);const bytes=await configBytes(),before=await businessSnapshot(h);await fs.writeFile(path.join(h.root,'.cfg01-fault.json'),JSON.stringify({method}));
  try{
   const r=method==='readFile'?await req(s,'/api/llm/config'):await req(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,baseUrl:h.baseUrl,model:'fault-must-not-save'},token:c.writeToken});
   assert.ok(r.status>=400,'Storage failure must be explicit');assert.equal((JSON.parse(await fs.readFile(path.join(h.root,'.cfg01-fault-observed.json'),'utf8'))).observed,true);await noLeaks(r.text);assert.equal(await configBytes(),bytes);assert.deepEqual(await businessSnapshot(h),before);
   assert.ok(!(await fs.readdir(h.root)).some(n=>n.includes('provider.env')&&n!==path.basename(h.configFile)),'No temp credential file remains');return {faultActuallyObserved:true,oldFilePreserved:true,noBusinessWrites:true};
  }finally{await fs.rm(path.join(h.root,'.cfg01-fault.json'),{force:true});}
 });
 c=await summary(s);
 for(const [id,reply,expected]of [
  ['auth',{httpStatus:401,message:'echo '+keys[1]},'LLM_AUTH_FAILED'],['rate',{httpStatus:429,message:'echo '+keys[1]},'LLM_RATE_LIMITED'],['invalid-wire',{rawResponse:'not json'},'LLM_PROVIDER_ERROR'],['empty',{content:''},'LLM_EMPTY_RESULT'],['secret-echo','echo '+keys[1],'LLM_OUTPUT_CONTAINS_SECRET'],['secret-escaped',JSON.stringify({safe:keys[1]}).replaceAll(keys[1],keys[1].split('').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')),'LLM_OUTPUT_CONTAINS_SECRET'],['timeout',{content:'OK',delayMs:17000},'LLM_TIMEOUT'],
 ])await test('C03-'+id,async()=>{const before=await businessSnapshot(h),bytes=await configBytes();h.setReply(()=>reply);const r=await testConnection();assert.ok(r.status>=400);assert.equal(r.json.error.code,expected);await noLeaks(r.text);assert.deepEqual(await businessSnapshot(h),before);assert.equal(await configBytes(),bytes);return {errorCode:expected,noBusinessWrites:true,noKeyInResponse:true};});
 await test('C03-network-failure',async()=>{c=await save(s,{baseUrl:'http://127.0.0.1:9/v1',model:'cfg01-network'});const before=await businessSnapshot(h);const r=await testConnection();assert.ok(r.status>=400);assert.equal(r.json.error.code,'LLM_NETWORK_ERROR');await noLeaks(r.text);assert.deepEqual(await businessSnapshot(h),before);c=await configured(keys[0]);return {safeNetworkFailure:true,noBusinessWrites:true};});
 await test('C06-hot-change-and-old-job-snapshot',async()=>{
  let release;const wait=new Promise(r=>release=r);let oldCall=false;
  h.setReply(async(wire,index)=>{const user=wire.messages.find(m=>m.role==='user')?.content??'';if(user.includes('<<<\n')){oldCall=true;await wait;return cleanWire(wire);}return cleanWire(wire);});
  c=await configured(keys[0],'cfg01-old-job');const raw=await expect(s,'/api/raw',{method:'POST',body:rawInput('业务隔离','BUSINESS_ONLY_CFG01 原文不得被连接测试发送。')},201);
  const begun=await expect(s,`/api/raw/${raw.id}/extract`,{method:'POST',body:{}},202);
  for(let i=0;i<150&&!oldCall;i++)await delay(20);assert.ok(oldCall);
  try{c=await configured(keys[1],'cfg01-new-job');const n=h.requests.length;await expect(s,'/api/prompt-ai/brief',{method:'POST',body:{task:'新的业务任务',template:'business_process'}},201);assert.equal(h.requests[n].model,'cfg01-new-job');assert.equal(h.requests[n].credentialIndex,1);}finally{release();}
  let job;for(let i=0;i<160;i++){job=await expect(s,`/api/extraction-jobs/${begun.jobId}`);if(job.status!=='running')break;await delay(25);}assert.equal(job.status,'completed');assert.equal(job.provider.model,'cfg01-old-job');const detail=await expect(s,`/api/drafts/${job.draftId}`);assert.equal(detail.provider.model,'cfg01-old-job');assert.equal((await expect(s,`/api/raw/${raw.id}`)).body,raw.body);
  return {newRequestUsesNewConfig:true,oldJobKeepsOriginalConfig:true,rawUnchanged:true};
 });
 await test('C01-same-root-restart-and-old-token',async()=>{const old=c,bytes=await configBytes(),before=await businessSnapshot(h);await h.stop(s);s=await h.start();c=await summary(s);assert.equal(c.configured,true);assert.equal(c.model,'cfg01-new-job');assert.equal(await configBytes(),bytes);assert.deepEqual(await businessSnapshot(h),before);const r=await req(s,'/api/llm/config',{method:'PUT',body:{revision:old.revision,baseUrl:h.baseUrl,model:'obsolete'},token:c.writeToken});assert.equal(r.status,409);return {persisted:true,oldRevisionRejected:true,businessUnchanged:true};});
 await test('C02-environment-override-lock',async()=>{
  const bytes=await configBytes();await h.stop(s);s=await h.start({FMCG_LLM_MODEL:'cfg01-environment-model'});c=await summary(s);assert.equal(c.environmentLocked,true);assert.equal(c.source,'env');assert.equal(c.model,'cfg01-environment-model');
  for(const method of ['PUT','DELETE']){const r=await req(s,'/api/llm/config',{method,body:method==='PUT'?{revision:c.revision,baseUrl:h.baseUrl,model:'cannot-save'}:{revision:c.revision,confirm:true},token:c.writeToken});assert.equal(r.status,409);await noLeaks(r.text);}assert.equal(await configBytes(),bytes);
  h.setReply(cleanWire);const connection=await testConnection();assert.equal(connection.status,200);assert.equal(h.requests.at(-1).model,'cfg01-environment-model');assert.equal(await configBytes(),bytes);
  await h.stop(s);s=await h.start();c=await summary(s);assert.equal(c.environmentLocked,false);return {partialEnvironmentLocksEntireEditor:true,noLocalFileMutation:true};
 });
 await test('C01-explicit-clear-and-manual-availability',async()=>{const before=await businessSnapshot(h),count=h.requests.length;const r=await clear();assert.equal(r.status,200);c=r.json;assert.equal(c.keyConfigured,false);assert.equal(c.configured,false);const text=await configBytes();assert.ok(!keys.some(k=>text.includes(k)));assert.ok(text.includes('CUSTOM_OPTION="keep this exact line"\r\n'));assert.equal(h.requests.length,count);assert.deepEqual(await businessSnapshot(h),before);const fail=await req(s,'/api/prompt-ai/brief',{method:'POST',body:{task:'任务',template:'business_process'}});assert.equal(fail.json.error.code,'LLM_NOT_CONFIGURED');assert.equal(h.requests.length,count);await expect(s,'/api/stats');await expect(s,'/api/prompts');return {cleared:true,manualAvailable:true,noProviderCalls:true};});
}catch(e){checks.push({id:'setup-or-sequence',result:'FAIL',reason:redact(e.message)});}
finally{await h.close();}
const count={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};
const report={date:'2026-10-14',batchStarted:'2026-10-13',scope:'real product HTTP/config/adapter -> local fake; no real credentials/provider',root:h.root,configFile:h.configFile,durationMs:Date.now()-started,checks,summary:count,servicesClosed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null),logsNoCredentials:h.services.every(s=>!keys.some(k=>s.logs.includes(k))),fakeClosed:true,providerRequests:h.requests.map(r=>({path:r.path,model:r.model,authenticated:r.authenticated,credentialIndex:r.credentialIndex}))};
await fs.writeFile('docs/reports/CFG01-20261014-http.json',JSON.stringify(report,null,2));console.log(JSON.stringify(count));if(count.fail)process.exitCode=1;



