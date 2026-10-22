// Independent repair2 closure: native HTTP, synthetic credentials, real adapter, isolated filesystem.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHarness,summary,save,req,keys,businessSnapshot} from './cfg01-20261014-harness.mjs';
const checks=[],owned=[],start=Date.now();
async function test(id,fn){const h=await createHarness();try{checks.push({id,result:'PASS',details:await fn(h)});}catch(e){checks.push({id,result:'FAIL',reason:String(e.message).slice(0,2000)});}finally{await h.close();owned.push({servicesClosed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)});}console.log(id+': '+checks.at(-1).result);}
await test('R2-01-new-key-model-roundtrip',async h=>{
 const s=await h.start();let c=await summary(s),accepted=0,rejected=0;
 const inputs=[{apiKey:'a\tb',model:'normal'},{apiKey:'fixture-\ud800',model:'normal'},{apiKey:'fixture-roundtrip-valid!',model:'model-\ud800'},{apiKey:'fixture-roundtrip-A!9',model:'"model-fixture"'},{apiKey:'"double-quoted-fixture"',model:'roundtrip-a'},{apiKey:"'single-quoted-fixture'",model:'roundtrip-b'},{apiKey:'middle"quote\\\\backslash-fixture',model:'roundtrip-c'}];
 for(const input of inputs){const before=await fs.readFile(h.configFile,'utf8').catch(()=>''),r=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl:h.baseUrl,...input}});
  if(r.status===200){keys.push(input.apiKey);c=r.json;assert.equal(c.model,input.model,'Accepted model changed');const p=await req(s,'/api/llm/config/test',{method:'POST',token:c.writeToken,body:{revision:c.revision,confirm:true}});assert.equal(p.status,200);assert.equal(h.requests.at(-1).credentialIndex,keys.length-1,'Accepted key changed in actual Authorization');c=await save(s,{baseUrl:h.baseUrl,model:input.model+'-retained'});await req(s,'/api/llm/config/test',{method:'POST',token:c.writeToken,body:{revision:c.revision,confirm:true}});assert.equal(h.requests.at(-1).credentialIndex,keys.length-1,'Retain-key update changed Authorization');accepted++;}
  else {assert.ok(r.status>=400);assert.equal(await fs.readFile(h.configFile,'utf8').catch(()=>''),before);rejected++;}
 }
 return {acceptedUnchanged:accepted,rejectedWithoutWrite:rejected};
});
await test('R2-01-legacy-quoted-backslashes-preserved',async h=>{
 const key='legacy\\\\backslash-fixture-A!',model='legacy-model';keys.push(key);
 await fs.writeFile(h.configFile,`# legacy untouched\r\nCUSTOM="keep bytes"\r\nFMCG_LLM_BASE_URL=${h.baseUrl}\r\nFMCG_LLM_MODEL="${model}"\r\nFMCG_LLM_API_KEY="${key}"\r\n`);
 let s=await h.start(),c=await summary(s);assert.equal(c.model,model);assert.equal(c.configured,true);
 const connection=()=>req(s,'/api/llm/config/test',{method:'POST',token:c.writeToken,body:{revision:c.revision,confirm:true}});
 assert.equal((await connection()).status,200);assert.equal(h.requests.at(-1).credentialIndex,keys.length-1);
 c=await save(s,{baseUrl:h.baseUrl,model:'legacy-retain'});assert.equal((await connection()).status,200);assert.equal(h.requests.at(-1).credentialIndex,keys.length-1);
 assert.ok((await fs.readFile(h.configFile,'utf8')).startsWith('# legacy untouched\r\nCUSTOM="keep bytes"\r\n'));
 await h.stop(s);s=await h.start();c=await summary(s);assert.equal((await connection()).status,200);assert.equal(h.requests.at(-1).credentialIndex,keys.length-1);
 return {legacyAuthUnchanged:true,retainedKeyUnchanged:true,sameRootRestartUnchanged:true,nonLlmBytesPreserved:true};
});
await test('R2-03-invalid-percent-and-secret-encoding-rejected',async h=>{
 const s=await h.start();let c=await summary(s),refused=0;const key='a/b';keys.push(key);
 for(const baseUrl of ['https://example.test/a%2fb/%zz','https://example.test/a%2Fb/%zz','https://example.test/a%2fb','https://example.test/a%2Fb','https://example.test/%61%2f%62','https://example.test/%2561%252f%2562','https://example.test/a%2fb/%','https://example.test/%zz','https://example.test/%61%2f%62%ff','https://example.test/'+Array.from({length:10}).reduce(value=>encodeURIComponent(value),'a%2fb')]){
  const bytes=await fs.readFile(h.configFile,'utf8').catch(()=>''),r=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl,model:'safe-model',apiKey:key}});assert.ok(r.status>=400,'Encoded/invalid URL accepted');assert.equal(await fs.readFile(h.configFile,'utf8').catch(()=>''),bytes);assert.ok(!r.text.includes(key));assert.ok(!r.text.toLowerCase().includes('a%2fb'));refused++;
 }
 c=await save(s,{baseUrl:h.baseUrl,model:'safe-model',apiKey:key});const bytes=await fs.readFile(h.configFile,'utf8');
 const rejected=await req(s,'/api/llm/config',{method:'PUT',token:c.writeToken,body:{revision:c.revision,baseUrl:'https://example.test/a%2fb/%zz',model:'safe-model',apiKey:keys[0]}});assert.ok(rejected.status>=400);assert.equal(await fs.readFile(h.configFile,'utf8'),bytes);
 await h.stop(s);
 await fs.writeFile(h.configFile,`FMCG_LLM_BASE_URL=${h.baseUrl}/a%2fb/%zz\nFMCG_LLM_MODEL=safe-model\nFMCG_LLM_API_KEY=${key}\n`);
 const envService=await h.start({FMCG_LLM_API_KEY:keys[0]});const envC=await summary(envService);assert.equal(envC.configured,false);assert.ok(!JSON.stringify(envC).includes(key));assert.ok(!JSON.stringify(envC).toLowerCase().includes('a%2fb'));
 const before=await businessSnapshot(h),ai=await req(envService,'/api/prompt-ai/brief',{method:'POST',body:{task:'Synthetic no business fixture',template:'business_process'}});assert.ok(ai.status>=400);assert.deepEqual(await businessSnapshot(h),before);assert.equal(h.requests.length,0);
 return {refused,oldKeyReplacementBlocked:true,environmentAndLocalKeysChecked:true,noProviderCalls:true};
});
const summaryResult={pass:checks.filter(c=>c.result==='PASS').length,fail:checks.filter(c=>c.result==='FAIL').length};
await fs.writeFile('docs/reports/CFG01-20261014-repair2-probes.json',JSON.stringify({date:'2026-10-14',environment:process.version,scope:'independent product HTTP/native transport; fictional credentials only',durationMs:Date.now()-start,checks,summary:summaryResult,servicesClosed:owned.every(x=>x.servicesClosed)},null,2));console.log(JSON.stringify(summaryResult));if(summaryResult.fail)process.exitCode=1;

