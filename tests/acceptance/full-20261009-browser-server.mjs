import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHarness,expect,fileSnapshot,port,delay} from './b08-harness.mjs';
import {reply} from './b09-fixtures.mjs';
const prefix='docs/reports/FULL-20261009-browser'+(process.argv[2]?'-'+process.argv[2]:'')+(process.argv[3]?'-'+process.argv[3]:'');
const h=await createHarness(async wire=>{
 const mode=await fs.readFile(path.join(h.dataRoot,'.b09-provider-mode.json'),'utf8').then(JSON.parse,()=>null);
 if(mode?.kind==='invalid-json')return 'not JSON';if(mode?.kind==='http-error')return {httpStatus:mode.status??429};return reply(wire);
});
const report={provider:'independent fake, not real AI quality',dataRoot:h.dataRoot,httpRequests:[],uiLogs:''};let s,ui,proxy;
try{
 s=await h.start(h.dataRoot,process.argv[2]!=='manual');
 proxy=http.createServer(async(req,res)=>{
  if(req.url==='/clipboard-target'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh"><title>B09普通粘贴目标</title><label>普通粘贴目标<textarea aria-label="普通粘贴目标" rows="18" cols="90"></textarea></label></html>');return;}
  try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const response=await fetch(s.base+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:body});const content=await response.text();const r={at:new Date().toISOString(),method:req.method,url:req.url,status:response.status,requestBody:body.toString(),body:content};report.httpRequests.push(r);await fs.appendFile(path.join(h.dataRoot,'.b09-http.jsonl'),JSON.stringify(r)+'\n');res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json',...(response.headers.get('content-disposition')?{'content-disposition':response.headers.get('content-disposition')}:{})});res.end(content);}catch{res.writeHead(502);res.end('Independent proxy failed');}
 });
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const proxyPort=proxy.address().port,uiPort=await port();
 ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{env:{...process.env,FMCG_PORT:String(proxyPort)},windowsHide:true,stdio:['ignore','pipe','pipe']});ui.stdout.on('data',b=>report.uiLogs+=b);ui.stderr.on('data',b=>report.uiLogs+=b);
 Object.assign(report,{url:`http://127.0.0.1:${uiPort}/`,api:s.base,clipboardUrl:`http://127.0.0.1:${proxyPort}/clipboard-target`,apiPid:s.child.pid,uiPid:ui.pid,stopFile:path.join(h.dataRoot,'.stop-b09-browser')});
 for(let n=0;n<100;n++){try{if((await fetch(report.url)).ok)break;}catch{}await delay(100);}
 await fs.writeFile(prefix+'-runtime.json',JSON.stringify(report,null,2));console.log(JSON.stringify({url:report.url,dataRoot:h.dataRoot}));
 while(!await fs.access(report.stopFile).then(()=>true,()=>false)){const marker=path.join(h.dataRoot,'.restart-api');if(await fs.access(marker).then(()=>true,()=>false)){await fs.rm(marker);const p=s.port;await h.stop(s);s=await h.start(h.dataRoot,process.argv[2]!=='manual',p);report.restartCount=(report.restartCount??0)+1;report.apiPid=s.child.pid;await fs.writeFile(prefix+'-runtime.json',JSON.stringify(report,null,2));}await delay(200);}
 report.afterKnowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge'));report.afterPrompts=await fileSnapshot(path.join(h.dataRoot,'prompts'));report.finalStats=await expect(s,'/api/stats');
}finally{
 if(ui&&ui.exitCode===null){const done=once(ui,'exit');ui.kill();await done;}if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}await h.close();report.providerRequests=h.requests;report.closed={api:!s||s.child.exitCode!==null||s.child.signalCode!==null,ui:!ui||ui.exitCode!==null||ui.signalCode!==null,proxy:!proxy||!proxy.listening,fake:true};await fs.writeFile(prefix+'-runtime.json',JSON.stringify(report,null,2));
}

