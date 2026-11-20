import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const run=await realpath(process.argv[2]);
assert.equal(path.dirname(run).toLowerCase(),(await realpath(os.tmpdir())).toLowerCase());
const data=path.join(run,'data');
const schedules=JSON.parse(await readFile(path.join(data,'state/automation/schedules.json'),'utf8'));
assert(schedules.schedules.every(s=>s.enabled===false));
const guard=path.join(run,'offline.mjs');
await writeFile(guard,"globalThis.fetch = async () => { throw Error('Diagnostic process blocks all service fetch calls'); };");
const reservation=net.createServer().listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));assert(port!==4317);
const env={...process.env,FMCG_PORT:String(port),FMCG_DATA_DIR:data,FMCG_LLM_CONFIG_FILE:path.resolve('.env.local'),FMCG_NEWS_AI_ENABLED:'false'};
const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,'--import','tsx','server/index.ts'],{env,stdio:'ignore',windowsHide:true});const exit=once(child,'close');
const base='http://127.0.0.1:'+port;
try{
  for(let n=0;!await fetch(base+'/api/health').then(r=>r.ok,()=>false);n++){assert(n<150&&child.exitCode===null);await delay(100);}
  const response=await fetch(base+'/api/llm/config');assert(response.ok);
  const summary=await response.json(),url=new URL(summary.baseUrl);
  assert.equal(url.host,summary.baseUrlHost);
  const result={providerHost:summary.baseUrlHost,configured:summary.configured,additionalModelRequests:0};
  const records=await lookup(url.hostname,{all:true}).catch(e=>{result.dns=e.code;return [];});
  if(records.length){result.dns='resolved';result.addressCount=records.length;}
  const dest={host:url.hostname,port:Number(url.port)||(url.protocol==='https:'?443:80)};
  for(const protocol of ['tcp',...(url.protocol==='https:'?['tls']:[])]){
    const sock=protocol==='tls'?tls.connect({...dest,servername:url.hostname}):net.connect(dest);
    result[protocol]=await new Promise(resolve=>{
      sock.setTimeout(12000);
      sock.once(protocol==='tls'?'secureConnect':'connect',()=>resolve('connected'));
      sock.once('timeout',()=>resolve('timeout'));sock.once('error',error=>resolve(error.code??'error'));
    });
    sock.destroy();
  }
  await writeFile(path.join(run,'network-diagnosis.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{child.kill();await exit;}
