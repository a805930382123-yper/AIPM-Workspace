// Independent repair closure checks, real product HTTP and actual isolated config faults.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHarness,summary,save,req,expect,keys,redact,businessSnapshot} from './cfg01-20261013-harness.mjs';
const checks=[],owned=[],started=Date.now();
async function test(id,fn){const h=await createHarness();let s;try{const details=await fn(h,async env=>(s=await h.start(env)));checks.push({id,result:'PASS',details});}catch(e){checks.push({id,result:'FAIL',reason:redact(e.message)});}finally{await h.close();owned.push({root:h.root,closed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)});}console.log(`${id}: ${checks.at(-1).result}`);}
await test('FCFG01-cold-read-failure-manual-available',async(h,start)=>{
 await fs.mkdir(h.configFile);const s=await start();await expect(s,'/api/health');await expect(s,'/api/stats');await expect(s,'/api/prompts');await expect(s,'/api/raw');const bad=await req(s,'/api/llm/config');assert.ok(bad.status>=400);assert.equal(h.requests.length,0);
 return {healthAndManualAvailable:true,configExplicitlyFailed:true,noProviderCalls:true};
});
await test('FCFG01-live-read-failure-and-recovery',async(h,start)=>{
 const s=await start();await save(s,{baseUrl:h.baseUrl,model:'repair-model',apiKey:keys[0]});const before=await businessSnapshot(h);
 const backup=h.configFile+'.backup';await fs.rename(h.configFile,backup);await fs.mkdir(h.configFile);
 try{await expect(s,'/api/health');await expect(s,'/api/stats');await expect(s,'/api/prompts');const config=await req(s,'/api/llm/config');assert.ok(config.status>=400);const ai=await req(s,'/api/prompt-ai/brief',{method:'POST',body:{task:'任务',template:'business_process'}});assert.ok(ai.status>=400);assert.equal(h.requests.length,0);assert.deepEqual(await businessSnapshot(h),before);}finally{await fs.rmdir(h.configFile);await fs.rename(backup,h.configFile);}
 await expect(s,'/api/prompt-ai/brief',{method:'POST',body:{task:'任务',template:'business_process'}},201);return {manualAvailable:true,failedAiNoWrites:true,restoredConfigHotWorks:true};
});
await test('FCFG01-complete-env-ignores-unreadable-file',async(h,start)=>{
 await fs.mkdir(h.configFile);const s=await start({FMCG_LLM_BASE_URL:h.baseUrl,FMCG_LLM_MODEL:'fully-environment',FMCG_LLM_API_KEY:keys[0]});await expect(s,'/api/health');await expect(s,'/api/prompt-ai/brief',{method:'POST',body:{task:'任务',template:'business_process'}},201);assert.equal(h.requests.at(-1).model,'fully-environment');assert.equal(h.requests.at(-1).credentialIndex,0);return {completeEnvOperational:true};
});
await test('FCFG02-inactive-local-key-summary-and-ai',async(h,start)=>{
 await fs.writeFile(h.configFile,`FMCG_LLM_BASE_URL=${h.baseUrl}/echo/${encodeURIComponent(keys[1])}\nFMCG_LLM_MODEL=leak-${keys[1]}\nFMCG_LLM_API_KEY=${keys[1]}\n`);
 const s=await start({FMCG_LLM_API_KEY:keys[0]}),c=await summary(s);assert.equal(c.environmentLocked,true);assert.equal(c.configured,false);assert.ok(!keys.some(k=>JSON.stringify(c).includes(k)));assert.ok(!JSON.stringify(c).includes(encodeURIComponent(keys[1])));
 const ai=await req(s,'/api/prompt-ai/brief',{method:'POST',body:{task:'任务',template:'business_process'}});assert.ok(ai.status>=400);assert.equal(h.requests.length,0);return {knownLocalAndEnvironmentKeysSafe:true,invalidConfigNotUsed:true};
});
await test('FCFG02-replacement-cannot-expose-old-key',async(h,start)=>{
 const s=await start();let c=await save(s,{baseUrl:h.baseUrl,model:'initial',apiKey:keys[1]});const bytes=await fs.readFile(h.configFile,'utf8');
 for(const fields of [{model:'old-'+keys[1]},{baseUrl:h.baseUrl+'/echo/'+encodeURIComponent(keys[1])}]){const r=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl:h.baseUrl,model:'safe-new',apiKey:keys[0],...fields}});assert.ok(r.status>=400);assert.equal(await fs.readFile(h.configFile,'utf8'),bytes);assert.ok(!keys.some(k=>r.text.includes(k)));}
 return {oldAndNewCredentialsCheckedBeforeWrite:true};
});
await test('FCFG03-quoted-and-backslash-key-roundtrip',async(h,start)=>{
 const s=await start();let c=await summary(s),accepted=0,rejected=0;
 for(const value of ['"double-quoted-fixture"',"'single-quoted-fixture'",'middle"quote\\backslash-fixture']){
  const before=await fs.readFile(h.configFile,'utf8').catch(()=>''),r=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl:h.baseUrl,model:'key-roundtrip',apiKey:value}});
  if(r.status===200){keys.push(value);c=r.json;const test=await req(s,'/api/llm/config/test',{method:'POST',token:c.writeToken,body:{revision:c.revision,confirm:true}});assert.equal(test.status,200);assert.equal(h.requests.at(-1).credentialIndex,keys.length-1);accepted++;}
  else {assert.ok(r.status>=400);assert.equal(await fs.readFile(h.configFile,'utf8').catch(()=>''),before);rejected++;}
 }
 return {acceptedUnchanged:accepted,rejectedExplicitly:rejected,noSilentKeyChange:true};
});
await test('FCFG04-external-edit-during-temp-write',async(h,start)=>{
 const s=await start(),c=await save(s,{baseUrl:h.baseUrl,model:'before-external',apiKey:keys[0]}),before=await businessSnapshot(h);
 await fs.writeFile(path.join(h.root,'.cfg01-fault.json'),JSON.stringify({method:'writeFile',action:'external'}));
 try{const r=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl:h.baseUrl,model:'must-conflict'}});assert.equal(r.status,409);const bytes=await fs.readFile(h.configFile,'utf8');assert.ok(bytes.includes('EXTERNAL-EDIT-PRESERVED'));assert.ok(bytes.includes('before-external'));assert.ok(!bytes.includes('must-conflict'));assert.deepEqual(await businessSnapshot(h),before);assert.ok(!(await fs.readdir(h.root)).some(n=>n.includes('provider.env')&&n!==path.basename(h.configFile)));return {externalEditPreserved:true,httpStatus:409,tempCleaned:true};}finally{await fs.rm(path.join(h.root,'.cfg01-fault.json'),{force:true});}
});
await test('FCFG06-non2xx-response-budget',async(h,start)=>{
 const s=await start(),c=await save(s,{baseUrl:h.baseUrl,model:'error-budget',apiKey:keys[0]}),before=await businessSnapshot(h);
 h.setReply(()=>({httpStatus:401,message:'x'.repeat(65536)}));const r=await req(s,'/api/llm/config/test',{method:'POST',token:c.writeToken,body:{revision:c.revision,confirm:true}});assert.ok(r.status>=400);assert.equal(r.json.error.code,'LLM_RESPONSE_TOO_LARGE');assert.ok(r.text.length<5000);assert.deepEqual(await businessSnapshot(h),before);return {errorBodyCapped:true,errorCode:r.json.error.code,noBusinessWrites:true};
});
await test('FCFG07-raw-delimiters-and-encoded-known-key',async(h,start)=>{
 const s=await start(),c=await save(s,{baseUrl:h.baseUrl,model:'url-guard',apiKey:keys[1]}),bytes=await fs.readFile(h.configFile,'utf8');
 for(const baseUrl of [h.baseUrl+'?',h.baseUrl+'#',h.baseUrl+'/echo/'+keys[1],h.baseUrl+'/echo/'+encodeURIComponent(keys[1])]){const r=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl,model:'url-guard'}});assert.ok(r.status>=400);assert.equal(await fs.readFile(h.configFile,'utf8'),bytes);assert.ok(!keys.some(k=>r.text.includes(k)));}
 return {emptyQueryHashAndKnownKeyRejected:true};
});
const summaryResult={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};
await fs.writeFile('docs/reports/CFG01-20261013-edges.json',JSON.stringify({scope:'independent real product HTTP + isolated filesystem; fictional credentials',durationMs:Date.now()-started,checks,summary:summaryResult,ownedServices:owned,servicesClosed:owned.every(x=>x.closed)},null,2));console.log(JSON.stringify(summaryResult));if(summaryResult.fail)process.exitCode=1;
