import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
export {fileSnapshot,digest,rawInput,wikiInput} from './b07-harness.mjs';
import {port,delay} from './b07-harness.mjs';
export {port,delay};
export async function request(s,url,method='GET',body){
 const response=await fetch(s.base+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
 const text=await response.text();let json;try{json=JSON.parse(text);}catch{}
 return {status:response.status,json,text};
}
export async function expect(s,url,method,body,status=200){const r=await request(s,url,method,body);assert.equal(r.status,status,r.text);return r.json;}
export async function createHarness(reply,dataDir,fakeCredential){
 const dataRoot=dataDir??await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-b08-independent-'));
 const requests=[],services=[],fakeKey=fakeCredential??'b08-local-independent-fixture-credential';let responder=reply;
 const fake=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  try{
   const input=JSON.parse(Buffer.concat(chunks));requests.push({at:new Date().toISOString(),input,authCorrect:req.headers.authorization===`Bearer ${fakeKey}`});
   const output=await responder(input);
   if(res.destroyed)return;
   if(output?.disconnect){res.destroy();return;}
   if(output?.rawResponse){res.writeHead(200,{'content-type':'application/json'});res.end(output.rawResponse);return;}
   const status=output?.httpStatus??200;res.writeHead(status,{'content-type':'application/json'});
   res.end(JSON.stringify(status!==200?{error:{message:output.message??'Explicit independent fake error'}}:{choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output?.content??output)},finish_reason:output?.finishReason??'stop'}]}));
  }catch(e){if(!res.destroyed){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Independent fixture responder error'}}));}}
 });
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));const fakeUrl=`http://127.0.0.1:${fake.address().port}/v1`;
 async function start(dir=dataRoot,configured=true,fixedPort){
  const apiPort=fixedPort??await port();
  const child=spawn(process.execPath,['--import','./tests/acceptance/b08-fault-hook.mjs','--import','tsx','server/index.ts'],{cwd:process.cwd(),env:withoutInheritedEmbeddings({...process.env,FMCG_DATA_DIR:dir,FMCG_LLM_CONFIG_FILE:path.join(dataRoot,'isolated-provider.env'),FMCG_PORT:String(apiPort),FMCG_LLM_BASE_URL:configured?fakeUrl:'',FMCG_LLM_MODEL:configured?'independent-b08-fake':'',FMCG_LLM_API_KEY:configured?fakeKey:''}),windowsHide:true,stdio:['ignore','pipe','pipe']});
  const s={child,dir,port:apiPort,base:`http://127.0.0.1:${apiPort}`,logs:''};services.push(s);
  child.stdout.on('data',b=>s.logs+=b);child.stderr.on('data',b=>s.logs+=b);
  for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error(s.logs);try{if((await fetch(s.base+'/api/health',{signal:AbortSignal.timeout(250)})).ok)return s;}catch{}await delay(100);}
  await stop(s);throw Error('Independent product startup timeout '+s.logs);
 }
 async function stop(s){if(s.child.exitCode===null&&s.child.signalCode===null){const done=once(s.child,'exit');s.child.kill();await done;}}
 async function close(){for(const s of services)await stop(s);fake.closeAllConnections();await new Promise(r=>fake.close(r));}
 return {dataRoot,fakeUrl,fakeKey,requests,services,start,stop,close,setReply:fn=>responder=fn};
}

