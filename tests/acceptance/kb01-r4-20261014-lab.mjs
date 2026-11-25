import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import{spawn}from'node:child_process';import{once}from'node:events';
import{loadLlmConfig,llmConfigSummary}from'../../services/llm/config.ts';import{port,delay}from'./b07-harness.mjs';
const prefix='docs/reports/KB01-R4-20261014-',config=await loadLlmConfig({filePath:path.resolve('.env.local')}),summary=llmConfigSummary(config,'.env.local');
if(!summary.configured)throw Error('Actual read-only Provider config unavailable');
const historic=(await fs.readFile('docs/reports/KB01-20261014-provider-trace.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const diagnostics=JSON.parse(await fs.readFile('docs/reports/KB01-20261014-provider-diagnostic.json','utf8')).results.length;
const updateDiagnostic=JSON.parse(await fs.readFile('docs/reports/KB01-20261014-update-diagnostic.json','utf8'));
const extraFiles=['KB01-20261014-update-diagnostic.json'];
const extra=updateDiagnostic.scope?.startsWith('one repeat')&&Number.isFinite(updateDiagnostic.elapsedMs)?1:0;
const previous=historic.length+diagnostics+extra;
// Historical records established 12 knowledge + 4 diagnostics. Stop if audit disagrees.
if(historic.length!==12||diagnostics+extra!==4||previous!==16)throw Error('Historical request audit differs: '+JSON.stringify({knowledge:historic.length,diagnostics,extra,extraFiles}));
const newAttempts=(await fs.readFile(prefix+'provider-attempts.jsonl','utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).trim().split('\n').filter(Boolean).length;
if(process.argv[2]==='audit'){console.log(JSON.stringify({configured:true,host:summary.baseUrlHost,model:summary.model,node:process.version,historicalKnowledge:historic.length,historicalDiagnostics:diagnostics+extra,previous,newAttempts,cumulative:previous+newAttempts,remaining:40-previous-newAttempts}));process.exit(0);}
const reuse=process.env.KB01_R4_REUSE_ROOT;
if(reuse&&!path.resolve(reuse).startsWith(path.join(os.tmpdir(),'fmcg-kb01-r4-real-')))throw Error('Owned root reuse boundary mismatch');
const root=reuse?await fs.realpath(reuse):await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-kb01-r4-real-')),apiPort=await port(),uiPort=await port(),url=`http://127.0.0.1:${uiPort}`,controlFile=path.join(root,'control.json');await fs.writeFile(controlFile,'{}');
const env={...process.env,FMCG_DATA_DIR:root,FMCG_PORT:String(apiPort),FMCG_UI_ORIGIN:url,FMCG_LLM_CONFIG_FILE:path.join(root,'absent-private-config.env'),FMCG_LLM_BASE_URL:config.baseUrl,FMCG_LLM_MODEL:config.model,FMCG_LLM_API_KEY:config.apiKey,KB01_TRACE:path.resolve(prefix+'provider-trace.jsonl'),KB01_TRACE_LEDGER:path.resolve(prefix+'provider-attempts.jsonl'),KB01_PREVIOUS_CALLS:String(previous)};
const services=[];let logs='';async function stop(s){if(s.exitCode===null&&s.signalCode===null){const done=once(s,'exit');s.kill();await done;}}
const api=spawn(process.execPath,['--import','tsx','--import','./tests/acceptance/kb01-r4-20261014-trace-hook.mjs','server/index.ts'],{env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:['ignore','pipe','pipe']});services.push(api);api.stdout.on('data',b=>logs+=b);api.stderr.on('data',b=>logs+=b);
try{
 let ready=false;for(let i=0;i<160;i++){if(api.exitCode!==null)throw Error('Owned API startup failed');try{if((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok){ready=true;break;}}catch{}await delay(100);}if(!ready)throw Error('Owned API readiness timeout');
 const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{env:{...process.env,FMCG_PORT:String(apiPort)},windowsHide:true,stdio:['ignore','pipe','pipe']});services.push(ui);ui.stdout.on('data',b=>logs+=b);ui.stderr.on('data',b=>logs+=b);
 ready=false;for(let i=0;i<160;i++){if(ui.exitCode!==null)throw Error('Owned UI startup failed');try{if((await fetch(url)).ok){ready=true;break;}}catch{}await delay(100);}if(!ready)throw Error('Owned UI readiness timeout');
 const meta={at:new Date().toISOString(),root,api:`http://127.0.0.1:${apiPort}`,url,apiPort,uiPort,controlFile,providerHost:summary.baseUrlHost,model:summary.model,actualConfigReadOnly:true,previousCalls:previous,newCallsAtStartup:newAttempts,remainingCallsAtStartup:40-previous-newAttempts,ownedRootReused:!!reuse,callCap:40,pid:process.pid};await fs.writeFile(prefix+'lab.json',JSON.stringify(meta,null,2));console.log(JSON.stringify(meta));
 while(true){if(JSON.parse(await fs.readFile(controlFile,'utf8')).shutdown)break;await delay(300);}
}finally{for(const s of services)await stop(s);await fs.writeFile(prefix+'lab-final.json',JSON.stringify({at:new Date().toISOString(),root,servicesClosed:services.every(s=>s.exitCode!==null||s.signalCode!==null),logsNoSecret:!logs.includes(config.apiKey)},null,2));console.log('Owned R4 services closed');}
