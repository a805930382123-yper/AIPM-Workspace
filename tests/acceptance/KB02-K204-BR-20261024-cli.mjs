import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {P,ROOT,ORIGINAL,inspect,verifySources,readJson,save,must,createLab} from './KB02-K204-BR-20261024-server.mjs';

export async function runCli(args=process.argv.slice(2)){
  const [command,...rest]=args;must(!args.includes('--real')&&!args.includes('--root'),'NO_EXECUTION_OVERRIDE');must(!Object.entries(process.env).some(([k,v])=>/^(?:K204|KB02).*REAL/i.test(k)&&v),'ENV_EXECUTION_OVERRIDE_DENIED');
  if(command==='selftest'){must(!rest.length,'NO_OVERRIDES');await(await import('./KB02-K204-BR-20261024-selftest.mjs')).selftest();return;}
  if(command==='inspect'){must(!rest.length,'NO_OVERRIDES');await verifySources();let control;try{const m=await readJson(P+'control.json');control=await readJson(path.join(m.sidecar,'control.json'));}catch(e){if(e.code!=='ENOENT')throw e;}console.log(JSON.stringify(await inspect(ORIGINAL,{control}),null,2));return;}
  if(command==='_ui'){
    must(rest.length===1&&/^http:\/\/127\.0\.0\.1:\d+$/.test(rest[0]),'UI_LOCAL_ONLY');
    const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
    const port=await new Promise((resolve,reject)=>{const socket=net.createServer();socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(e=>e?reject(e):resolve(value));});});
    const vite=await createServer({configFile:false,envFile:false,plugins:[react()],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':rest[0]}}});try{await vite.listen();}catch(e){await vite.close();throw e;}console.log(JSON.stringify({ui:vite.resolvedUrls.local.find(u=>u.includes('127.0.0.1'))?.replace(/\/$/,'')}));
    process.once('SIGINT',()=>void vite.close());process.once('SIGTERM',()=>void vite.close());return;
  }
  if(command==='serve'){
    must(!rest.length,'NO_OVERRIDES');await verifySources();let meta;try{meta=await readJson(P+'control.json');must(meta.root===ORIGINAL,'ROOT_BINDING_DENIED');}catch(e){if(e.code!=='ENOENT')throw e;meta={root:ORIGINAL,sidecar:await fs.mkdtemp(path.join(ROOT,'.scratch-KB02-K204-BR-20261024-control-'))};await save(P+'control.json',meta,true);}
    const lab=await createLab(meta),uiEnv={...process.env};for(const k of Object.keys(uiEnv))if(k.startsWith('FMCG_LLM_'))delete uiEnv[k];
    const ui=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'_ui',lab.base],{env:uiEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let url;ui.stdout.on('data',b=>{try{url=JSON.parse(b.toString().trim()).ui;}catch{}});ui.stderr.on('data',()=>{});
    try{const until=Date.now()+15000;while(!url&&Date.now()<until&&ui.exitCode===null)await new Promise(r=>setTimeout(r,40));must(url,'UI_START_FAILED');await save(P+'lab.json',{...meta,api:lab.base,url,pid:process.pid,uiPid:ui.pid,modelDisabled:true,modelCalls:0,configReads:0});console.log(JSON.stringify({api:lab.base,url,root:lab.root,sidecar:lab.sidecar,modelCalls:0,configReads:0,autoActions:false,uiEnvFiles:false}));let ending=false;
      const close=async()=>{if(ending)return;ending=true;ui.kill();await lab.close();};process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());while(!ending){await new Promise(r=>setTimeout(r,250));try{await fs.stat(path.join(lab.sidecar,'server.lock'));}catch{await close();}}await save(P+'closed-'+Date.now()+'.json',{at:new Date().toISOString(),closed:true,modelCalls:0,configReads:0});
    }catch(e){ui.kill();await lab.close();throw e;}return;
  }
  if(['status','export','stop'].includes(command)){must(!rest.length,'NO_OVERRIDES');const meta=await readJson(P+'lab.json'),res=await fetch(meta.api+(command==='status'?'/__repair/status':command==='export'?'/__repair/export':'/__repair/shutdown'),command==='stop'?{method:'POST',headers:{'content-type':'application/json'},body:'{}'}:undefined),json=await res.json();must(res.ok,json.error?.code??'LOCAL_CONTROL_FAILED');console.log(JSON.stringify(json,null,2));return;}
  throw Error('Commands: selftest | inspect | serve | status | export | stop');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await runCli();}catch(e){console.error(JSON.stringify({code:e.code??'LOCAL_TOOL_FAILED',message:'本地恢复工具失败；停止操作。',modelCalls:0,configReads:0}));process.exitCode=1;}}
