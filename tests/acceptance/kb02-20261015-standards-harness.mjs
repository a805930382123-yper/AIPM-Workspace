import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
// Independent KB02 infrastructure: synthetic credentials and isolated temporary data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
export {fileSnapshot,digest,rawInput,wikiInput} from './b07-harness.mjs';
import {port,delay} from './b07-harness.mjs';
export {delay};
export async function request(s,url,method='GET',body){
 const r=await fetch(s.base+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 const text=await r.text();let json;try{json=JSON.parse(text);}catch{}return {status:r.status,json,text};
}
export async function expect(s,url,method,body,status=200){const r=await request(s,url,method,body);assert.equal(r.status,status,r.text);return r.json;}
export async function terminal(s,id){for(let n=0;n<600;n++){const j=await expect(s,'/api/extraction-jobs/'+id);if(j.status!=='running')return j;await delay(25);}throw Error('Independent job timeout');}
export async function eventually(fn,label){for(let n=0;n<400;n++){const v=await fn();if(v)return v;await delay(20);}throw Error('Independent timeout: '+label);}
export async function createHarness(reply,fakeCredential){
 const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-standards-'));
 const requests=[],services=[],fakeKey=fakeCredential??'kb02-independent-synthetic-credential';let responder=reply;
 const fake=http.createServer(async(req,res)=>{
  const chunks=[];for await(const b of req)chunks.push(b);
  try{
   const input=JSON.parse(Buffer.concat(chunks));const record={index:requests.length,at:new Date().toISOString(),input,authCorrect:req.headers.authorization===`Bearer ${fakeKey}`};requests.push(record);
   const output=await responder(input,record.index);
   if(res.destroyed)return;
   if(output?.disconnect){res.destroy();return;}
   res.writeHead(output?.httpStatus??200,{'content-type':'application/json'});
   res.end(output?.rawResponse??JSON.stringify(output?.httpStatus?{error:{message:output.message??'Independent localhost failure'}}:{choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output?.content??output)},finish_reason:output?.finishReason??'stop'}]}));
  }catch(e){if(!res.destroyed){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Independent fixture failed: '+e.message}}));}}
 });
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));const fakeUrl=`http://127.0.0.1:${fake.address().port}/v1`;
 async function start(options={}){
  const apiPort=await port();
  const child=spawn(process.execPath,['--import','./tests/acceptance/kb02-20261015-standards-fault-hook.mjs','--import','tsx','server/index.ts'],{cwd:process.cwd(),env:withoutInheritedEmbeddings({...process.env,FMCG_DATA_DIR:dataRoot,FMCG_LLM_CONFIG_FILE:path.join(dataRoot,'isolated-provider.env'),FMCG_PORT:String(apiPort),FMCG_LLM_BASE_URL:fakeUrl,FMCG_LLM_MODEL:'kb02-independent-model',FMCG_LLM_API_KEY:fakeKey,...options.env}),windowsHide:true,stdio:['ignore','pipe','pipe']});
  const s={child,dir:dataRoot,port:apiPort,base:`http://127.0.0.1:${apiPort}`,logs:''};services.push(s);child.stdout.on('data',b=>s.logs+=b);child.stderr.on('data',b=>s.logs+=b);
  for(let n=0;n<150;n++){if(child.exitCode!==null)throw Error(s.logs);try{if((await fetch(s.base+'/api/health',{signal:AbortSignal.timeout(300)})).ok)return s;}catch{}await delay(100);}await stop(s);throw Error('Independent startup timeout '+s.logs);
 }
 async function stop(s){if(s.child.exitCode===null&&s.child.signalCode===null){const done=once(s.child,'exit');s.child.kill();await done;}}
 async function close(){for(const s of services)await stop(s);fake.closeAllConnections();await new Promise(r=>fake.close(r));}
 return {dataRoot,fakeUrl,fakeKey,requests,services,start,stop,close,setReply:fn=>responder=fn};
}

