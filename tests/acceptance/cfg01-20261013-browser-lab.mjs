// Owned actual-product/Vite browser lab. Controls contain fixture faults, never key values.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHarness,port,delay,businessSnapshot,cleanWire,keys} from './cfg01-20261013-harness.mjs';
const prefix='docs/reports/CFG01-20261013-browser',uiPort=await port(),url=`http://127.0.0.1:${uiPort}`;
const h=await createHarness({uiOrigin:url});let api=await h.start();
const controlFile=path.join(h.root,'.cfg01-browser-control.json'),trace=[];
await fs.writeFile(controlFile,'{}');const control=async()=>JSON.parse(await fs.readFile(controlFile,'utf8').catch(()=>'{}'));
h.setReply(async wire=>{const c=await control();if(c.providerError)return {httpStatus:401,message:'explicit independent fake refusal'};if(c.providerDelayMs)await delay(c.providerDelayMs);return cleanWire(wire);});
const originalBusiness=await businessSnapshot(h);
const proxy=http.createServer(async(req,res)=>{
 try{
  const c=await control(),pathname=new URL(req.url,'http://localhost').pathname,body=Buffer.concat(await Array.fromAsync(req));
  const entry={at:new Date().toISOString(),method:req.method,path:pathname};trace.push(entry);
  const headers={};for(const name of ['content-type','origin','sec-fetch-site','x-fmcg-config-token'])if(req.headers[name])headers[name]=req.headers[name];
  headers.host=req.headers.host;
  if(c.refuseSave&&req.method==='PUT'&&pathname==='/api/llm/config'){entry.status=500;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'ISOLATED_SAVE_FAILURE',message:'独立测试：保存失败，旧配置保持。'}}));return;}
  const upstream=await fetch(api.base+req.url,{method:req.method,headers,...(body.length?{body}:{})});const bytes=Buffer.from(await upstream.arrayBuffer());entry.status=upstream.status;
  if(c.delayGetMs&&pathname==='/api/llm/config'&&req.method==='GET')await delay(c.delayGetMs);
  if(res.destroyed)return;res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});res.end(bytes);
 }catch{if(!res.destroyed){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'ISOLATED_BROWSER_TRANSPORT',message:'独立本机测试传输失败。'}}));}}
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const proxyPort=proxy.address().port;
const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{cwd:process.cwd(),env:{...process.env,FMCG_PORT:String(proxyPort)},windowsHide:true,stdio:['ignore','pipe','pipe']});let uiLogs='';ui.stdout.on('data',b=>uiLogs+=b);ui.stderr.on('data',b=>uiLogs+=b);
for(let i=0;i<160;i++){if(ui.exitCode!==null)throw Error('Vite startup failed');try{if((await fetch(url)).ok)break;}catch{}await delay(100);}
const meta={root:h.root,configFile:h.configFile,url,api:api.base,controlFile,pid:process.pid,uiPort,apiPort:api.port};
await fs.writeFile(prefix+'-lab.json',JSON.stringify(meta,null,2));console.log(JSON.stringify(meta));
let mode='file',restartSeq=0;
while(true){let shutdown=false;try{
 const c=await control();await fs.writeFile(prefix+'-trace.json',JSON.stringify({trace,providerCalls:h.requests.length},null,2));
 if(c.restartSeq&&c.restartSeq!==restartSeq){restartSeq=c.restartSeq;await h.stop(api);mode=c.environmentLocked?'env':'file';api=await h.start(c.environmentLocked?{FMCG_LLM_MODEL:'browser-environment-model'}:{});meta.api=api.base;meta.apiPort=api.port;await fs.writeFile(prefix+'-lab.json',JSON.stringify({...meta,mode,restartSeq},null,2));}
 shutdown=Boolean(c.shutdown);
 }catch{}if(shutdown)break;await delay(200);}
if(ui.exitCode===null&&ui.signalCode===null){const done=once(ui,'exit');ui.kill();await done;}
proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await h.close();
const finalBusiness=await businessSnapshot(h);await fs.writeFile(prefix+'-lab-final.json',JSON.stringify({...meta,originalBusiness,finalBusiness,businessUnchanged:JSON.stringify(originalBusiness)===JSON.stringify(finalBusiness),servicesClosed:h.services.every(s=>s.child.exitCode!==null||s.child.signalCode!==null)&&ui.exitCode!==null,providerCalls:h.requests.length,providerMessages:h.requests.map(r=>({model:r.model,input:r.input,authenticated:r.authenticated})),trace,logsNoCredentials:!keys.some(k=>uiLogs.includes(k)||h.services.some(s=>s.logs.includes(k)))},null,2));console.log('Owned browser lab closed');
