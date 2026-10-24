import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {P,CARD_SHA,CAPS,sha,must,createSession,readJson,durable} from './KB02-K204-C-20261024-core.mjs';
import {createLab} from './KB02-K204-C-20261024-server.mjs';

export async function runCli(args=process.argv.slice(2)){
  const [command,...rest]=args;must(!args.includes('--real'),'NO_SINGLE_REAL_FLAG');must(!Object.entries(process.env).some(([k,v])=>/^(?:K204|KB02).*REAL/i.test(k)&&v),'ENV_REAL_OVERRIDE_DENIED');
  if(command==='_ui'){
    must(rest.length===1&&/^http:\/\/127\.0\.0\.1:\d+$/.test(rest[0]),'UI_LOCAL_ONLY');
    const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
    const port=await new Promise((resolve,reject)=>{const socket=net.createServer();socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(e=>e?reject(e):resolve(value));});});
    const vite=await createServer({configFile:false,envFile:false,plugins:[react()],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':rest[0]}}});try{await vite.listen();}catch(e){await vite.close();throw e;}console.log(JSON.stringify({ui:vite.resolvedUrls.local.find(u=>u.includes('127.0.0.1'))?.replace(/\/$/,'')}));
    process.once('SIGINT',()=>void vite.close());process.once('SIGTERM',()=>void vite.close());return;
  }
  if(command==='prepare'){must(!rest.length,'NO_OVERRIDES');const prepared=await createSession();const s=prepared.session;for(const stage of Object.keys(CAPS))await durable(P+`release-${stage}-template.json`,{sessionId:s.id,stage,released:false,issuedAt:null,allowedSequences:CAPS[stage],maxCalls:CAPS[stage].length,cardSha256:CARD_SHA,adapterFreezeSha256:null,previousEvidence:{path:null,sha256:null},bindings:null},{exclusive:true});console.log(JSON.stringify({prepared:true,manifestFile:prepared.manifestFile,sessionId:s.id,root:s.root,realCalls:0}));return;}
  if(command==='selftest'){must(!rest.length,'NO_OVERRIDES');await(await import('./KB02-K204-C-20261024-selftest.mjs')).selftest();return;}
  if(command==='serve'||command==='fake-serve'){
    must(!rest.length,'NO_OVERRIDES');let lab,fake;
    if(command==='fake-serve'){fake=await(await import('./KB02-K204-C-20261024-selftest.mjs')).startFake({persistent:true});lab=fake.lab;await fake.arm('C');}else lab=await createLab({manifestFile:P+'session.json',mode:'real'});
    const uiEnv={...process.env};for(const key of Object.keys(uiEnv))if(key.startsWith('FMCG_LLM_'))delete uiEnv[key];
    const vite=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'_ui',lab.base],{env:uiEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let uiUrl;vite.stdout.on('data',b=>{try{uiUrl=JSON.parse(b.toString().trim()).ui;}catch{}});vite.stderr.on('data',()=>{});
    const until=Date.now()+15000;while(!uiUrl&&Date.now()<until&&vite.exitCode===null)await new Promise(r=>setTimeout(r,50));if(!uiUrl){vite.kill();await lab.close();if(fake)await fake.closeProvider();throw Error('UI_START_FAILED');}
    const controlPath=command==='fake-serve'?P+'fake-lab.json':P+'lab.json';try{await fs.rename(controlPath,controlPath.replace('.json','-history-'+Date.now()+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;}await durable(controlPath,{sessionId:(await lab.engine.load()).id,api:lab.base,url:uiUrl,root:lab.root,pid:process.pid,vitePid:vite.pid,mode:command==='fake-serve'?'fake':'real'});console.log(JSON.stringify({controlPath,api:lab.base,url:uiUrl,mode:command==='fake-serve'?'fake':'real',realCalls:0,autoExtraction:false}));
    let ending=false;const close=async()=>{if(ending)return;ending=true;vite.kill();await lab.close();if(fake)await fake.closeProvider();};process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
    while(!ending){await new Promise(r=>setTimeout(r,250));try{if(!(await fs.stat(path.join(lab.root,'server.lock'))).isFile())await close();}catch{await close();}}await durable(P+(command==='fake-serve'?'fake-':'')+'lab-closed-'+Date.now()+'.json',{at:new Date().toISOString(),closed:true,realCalls:lab.engine.mode==='real'?lab.engine.sent:0,fakeCalls:lab.engine.mode==='fake'?lab.engine.sent:0,mode:lab.engine.mode});return;
  }
  if(['status','bindings','arm','stop','export'].includes(command)){
    const fake=rest[0]==='fake';if(fake)rest.shift();const meta=await readJson(P+(fake?'fake-':'')+'lab.json');const endpoint=command==='status'?'/__stage/status':command==='export'?'/__stage/export':command==='bindings'?`/__stage/bindings?stage=${encodeURIComponent(rest[0])}&targetId=${encodeURIComponent(rest[1]??'')}&pageId=${encodeURIComponent(rest[2]??'')}`:command==='arm'?'/__stage/arm':'/__stage/shutdown';
    let init;if(command==='arm'){must(rest.length===3,'ARM_STAGE_FILE_EXACT_SHA_REQUIRED');init={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stage:rest[0],releaseFile:path.resolve(rest[1]),exactSha256:rest[2]})};}else if(command==='stop')init={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
    const response=await fetch(meta.api+endpoint,init),json=await response.json();must(response.ok,json.error?.code??'LOCAL_CONTROL_FAILED');console.log(JSON.stringify(json,null,2));return;
  }
  throw Error('Commands: prepare | serve | fake-serve | selftest | status [fake] | bindings [fake] C | arm [fake] stage releaseFile exactSha256 | stop [fake]');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await runCli();}catch(error){console.error(JSON.stringify({code:error.code??'LOCAL_TOOL_FAILED',message:error.code??'本地工具失败；不输出配置/异常原因。',noAutomaticRetry:true}));process.exitCode=1;}}
