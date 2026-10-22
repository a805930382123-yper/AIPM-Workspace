import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {port,delay,fileSnapshot} from './b07-harness.mjs';
import {reply as promptReply} from './b08-fixtures.mjs';
import {fakeReply} from './kb01-r4-20261014-legacy-fixture.mjs';
export {port,delay,fileSnapshot};
export const keys=['cfg01-fake-long-credential-K8!','n7V!?'];
export const cleanWire=wire=>{
 const user=wire.messages.find(x=>x.role==='user')?.content??'';
 if(user.includes('<<<\n'))return fakeReply(wire);
 try{const parsed=JSON.parse(user);if('task' in parsed||'brief' in parsed||'body' in parsed)return promptReply(wire);}catch{}
 return 'OK';
};
export function redact(text){return keys.reduce((text,key)=>text.replaceAll(key,'[fixture redacted]'),String(text));}
export async function createHarness({uiOrigin}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-cfg01-')),configFile=path.join(root,'provider.env'),requests=[],services=[];
 let responder=cleanWire;
 const fake=http.createServer(async(req,res)=>{
  const body=Buffer.concat(await Array.fromAsync(req));let wire;
  try{wire=JSON.parse(body);}catch{res.writeHead(500);res.end();return;}
  const auth=req.headers.authorization,matched=keys.findIndex(k=>auth===`Bearer ${k}`);
  requests.push({at:new Date().toISOString(),path:req.url,model:wire.model,credentialIndex:matched,authenticated:matched>=0,input:wire});
  try{
   const output=await responder(wire,matched);
   if(output?.delayMs)await delay(output.delayMs);
   if(res.destroyed)return;
   if(output?.disconnect){res.destroy();return;}
   res.writeHead(output?.httpStatus??200,{'content-type':'application/json'});
   if(output?.rawResponse!==undefined){res.end(output.rawResponse);return;}
   if(output?.httpStatus&&output.httpStatus!==200){res.end(JSON.stringify({error:{message:output.message??'Explicit isolated upstream error'}}));return;}
   const actual=output?.content??output;const content=typeof actual==='string'?actual:JSON.stringify(actual);
   res.end(JSON.stringify({choices:[{message:{content},finish_reason:output?.finishReason??'stop'}]}));
  }catch{if(!res.destroyed){res.writeHead(500);res.end(JSON.stringify({error:{message:'Isolated responder failed'}}));}}
 });
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));const baseUrl=`http://127.0.0.1:${fake.address().port}/v1`;
 async function start(envOverrides={}){
  const apiPort=await port();const child=spawn(process.execPath,['--import','./tests/acceptance/cfg01-20261013-fault-hook.mjs','--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,FMCG_DATA_DIR:root,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:configFile,FMCG_LLM_BASE_URL:'',FMCG_LLM_MODEL:'',FMCG_LLM_API_KEY:'',...(uiOrigin?{FMCG_UI_ORIGIN:uiOrigin}:{}),...envOverrides},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const s={child,base:`http://127.0.0.1:${apiPort}`,port:apiPort,logs:''};services.push(s);child.stdout.on('data',b=>s.logs+=b);child.stderr.on('data',b=>s.logs+=b);
  for(let i=0;i<160;i++){if(child.exitCode!==null)throw Error('Product startup failed '+redact(s.logs));try{if((await fetch(s.base+'/api/health',{signal:AbortSignal.timeout(250)})).ok)return s;}catch{}await delay(80);}
  await stop(s);throw Error('Product startup timed out');
 }
 async function stop(s){if(s.child.exitCode===null&&s.child.signalCode===null){const done=once(s.child,'exit');s.child.kill();await done;}}
 async function close(){for(const s of services)await stop(s);fake.closeAllConnections();await new Promise(r=>fake.close(r));}
 return {root,configFile,baseUrl,requests,services,start,stop,close,setReply:fn=>responder=fn};
}
export async function req(s,p,{method='GET',body,token,headers={}}={}){
 const data=body===undefined?undefined:JSON.stringify(body);
 return await new Promise((resolve,reject)=>{
  const request=http.request(s.base+p,{method,headers:{...(data===undefined?{}:{'content-type':'application/json','content-length':Buffer.byteLength(data)}),...(token?{'X-FMCG-Config-Token':token}:{}),...headers}},response=>{
   const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let json;try{json=JSON.parse(text);}catch{}resolve({status:response.statusCode,text,json});});response.on('error',reject);
  });request.setTimeout(25000,()=>request.destroy(new Error('Isolated request timeout')));request.on('error',reject);request.end(data);
 });
}
export async function expect(s,p,options={},status=200){const r=await req(s,p,options);assert.equal(r.status,status,redact(r.text));return r.json;}
export async function summary(s){return expect(s,'/api/llm/config');}
export async function save(s,values,previous){const c=previous??await summary(s);return expect(s,'/api/llm/config',{method:'PUT',body:{revision:c.revision,...values},token:c.writeToken});}
export async function businessSnapshot(h){const out={};for(const p of ['knowledge','prompts','drafts','state','meetings'])out[p]=await fileSnapshot(path.join(h.root,p));return out;}



