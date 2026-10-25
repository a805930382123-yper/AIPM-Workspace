import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {P,prepare,readJson,durable,must} from './SYN01-REAL-20261025-core.mjs';
import {createLab,startUi} from './SYN01-REAL-20261025-server.mjs';
export async function run(args=process.argv.slice(2)){
  const [command,...rest]=args;
  if(command==='prepare'){must(rest.length===0,'NO_OVERRIDES');const s=await prepare();const file=P+'session-'+s.id+'.json';await durable(file,s);console.log(JSON.stringify({manifest:file,sessionId:s.id,root:s.root,mode:s.mode,realCalls:0}));return;}
  if(command==='smoke'){must(rest.length===0,'NO_OVERRIDES');await(await import('./SYN01-REAL-20261025-smoke.mjs')).smoke();return;}
  if(command==='serve'){
    must(rest.length===1,'SESSION_MANIFEST_REQUIRED');const session=await readJson(rest[0]),lab=await createLab(session.root);let ui;
    try{ui=await startUi(lab);const controlFile=P+'lab-'+session.id+'.json',temp=controlFile+'.tmp';await durable(temp,{sessionId:session.id,root:lab.root,api:lab.base,url:ui.url,mode:session.mode});await fs.rename(temp,controlFile);console.log(JSON.stringify({controlFile,api:lab.base,url:ui.url,mode:session.mode,armed:(await lab.engine.status()).armed,automaticCalls:0}));
      let stopping=false;const stop=()=>{stopping=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);while(!stopping&&!lab.closed)await new Promise(r=>setTimeout(r,150));process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    }finally{await ui?.close();await lab.close();}return;
  }
  if(['status','bindings','arm','export','stop'].includes(command)){
    must(rest.length===(command==='arm'?3:1),'CONTROL_FILE_REQUIRED');const meta=await readJson(rest[0]),init=command==='arm'?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({releaseFile:path.resolve(rest[1]),exactSha256:rest[2]})}:command==='stop'?{method:'POST',headers:{'content-type':'application/json'},body:'{}'}:undefined;
    const response=await fetch(meta.api+'/__syn01/'+command,init),output=await response.json();must(response.ok,output.error?.code??'CONTROL_FAILED');
    if(command==='export'){const file=P+'export-'+Date.now()+'.json';await durable(file,output);console.log(JSON.stringify({file}));}else console.log(JSON.stringify(output,null,2));return;
  }
  throw Error('prepare | serve <manifest> | smoke | status/bindings/export/stop <control> | arm <control> <release> <sha256>');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))try{await run();}catch(error){console.error(error.code??error.message);process.exitCode=1;}
