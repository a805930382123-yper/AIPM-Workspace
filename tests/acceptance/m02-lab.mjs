// Independent actual-product browser lab. All data and faults are isolated.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHarness,port,fileSnapshot} from './b08-harness.mjs';
const root=process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-m02-browser-'));
const h=await createHarness(()=>({httpStatus:500,message:'M02 must not call Provider'}),root);
const s=await h.start();
const originalRoots=Object.fromEntries(await Promise.all(['knowledge','prompts','drafts','state'].map(async p=>[p,await fileSnapshot(path.join(root,p))])));
const trace=[],controlFile=path.join(root,'.m02-control.json');
await fs.writeFile(controlFile,'{}');
const control=async()=>JSON.parse(await fs.readFile(controlFile,'utf8').catch(()=>'{}'));
const proxy=http.createServer(async(req,res)=>{
 try {
  const body=Buffer.concat(await Array.fromAsync(req)),c=await control();
  const pathname=new URL(req.url,'http://localhost').pathname;
  const fault=c.once&&c.once.method===(req.method||'GET')&&c.once.path===pathname?c.once:null;
  if(fault)await fs.writeFile(controlFile,JSON.stringify({...c,once:null}));
  const entry={method:req.method,path:pathname,at:new Date().toISOString()};trace.push(entry);
  if(fault?.status){entry.status=fault.status;res.writeHead(fault.status,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:fault.code||'INDEPENDENT_REFUSAL',message:'独立验收受控拒绝，未保存。'}}));return;}
  const upstream=await fetch(s.base+req.url,{method:req.method,headers:{...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})},...(body.length?{body}:{})});
  const bytes=Buffer.from(await upstream.arrayBuffer());entry.status=upstream.status;
  if(fault?.dropAfterCommit){entry.droppedAfterCommit=true;res.destroy();return;}
  const d=fault?.delayMs??(c.delay?.method===req.method&&c.delay.path===pathname?c.delay.ms:0);
  if(d)await new Promise(r=>setTimeout(r,d));
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});res.end(bytes);
 }catch{if(!res.destroyed){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'LOCAL_FIXTURE_TRANSPORT',message:'本地测试连接失败，请重试。'}}));}}
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
const proxyPort=proxy.address().port,uiPort=await port();
const ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{cwd:process.cwd(),env:{...process.env,FMCG_PORT:String(proxyPort)},windowsHide:true,stdio:['ignore','pipe','pipe']});
let uiLogs='';ui.stdout.on('data',b=>uiLogs+=b);ui.stderr.on('data',b=>uiLogs+=b);
const meta={root,api:s.base,proxy:`http://127.0.0.1:${proxyPort}`,url:`http://127.0.0.1:${uiPort}`,controlFile,pid:process.pid};
for(let i=0;i<120;i++){if(ui.exitCode!==null)throw Error(uiLogs);try{if((await fetch(meta.url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
await fs.writeFile('docs/reports/M02-browser-lab.json',JSON.stringify({...meta,originalRoots},null,2));
console.log(JSON.stringify(meta));
await new Promise(resolve=>{const timer=setInterval(async()=>{try{await fs.writeFile('docs/reports/M02-browser-trace.json',JSON.stringify(trace,null,2));if((await control()).shutdown){clearInterval(timer);resolve();}}catch{}},200);});
if(ui.exitCode===null&&ui.signalCode===null){const done=once(ui,'exit');ui.kill();await done;}
proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await h.close();
const currentRoots=Object.fromEntries(await Promise.all(['knowledge','prompts','drafts','state'].map(async p=>[p,await fileSnapshot(path.join(root,p))])));
await fs.writeFile('docs/reports/M02-browser-lab-final.json',JSON.stringify({...meta,originalRoots,currentRoots,oldRootsUnchanged:JSON.stringify(originalRoots)===JSON.stringify(currentRoots),providerCalls:h.requests.length,trace,servicesClosed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null)&&(ui.exitCode!==null||ui.signalCode!==null),uiLogs},null,2));
console.log('M02 browser lab closed');
