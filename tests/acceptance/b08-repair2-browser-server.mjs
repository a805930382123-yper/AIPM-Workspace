import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import crypto from 'node:crypto';
import {createHarness,expect,fileSnapshot,rawInput,wikiInput,port,delay} from './b08-harness.mjs';
import {reply,input} from './b08-fixtures.mjs';
const prefix='docs/reports/B08-repair2-acceptance-browser';
const h=await createHarness(async wire=>{
 let mode;try{mode=JSON.parse(await fs.readFile(path.join(h.dataRoot,'.b08-provider-mode.json'),'utf8'));}catch{}
 if(mode?.kind==='invalid-json')return 'not JSON';
 if(mode?.kind==='http-error')return {httpStatus:mode.status??429};
 return reply(wire);
});
const report={provider:'independent fake, not real AI quality',dataRoot:h.dataRoot,events:[],httpRequests:[],uiLogs:''};let s,ui,proxy;
try{
 s=await h.start();
 const raw=await expect(s,'/api/raw','POST',rawInput('B08浏览器来源','浏览器测试原文不得改写。'),201);
 const w1=await expect(s,'/api/wiki','POST',wikiInput('经销商订货访谈',[raw.id],'经销商订货访谈必要背景B08_BROWSER_SELECTED；需核对客户角色与审批节点。'),201);
 const w2=await expect(s,'/api/wiki','POST',wikiInput('库存周转未选页',[raw.id],'未选内容B08_BROWSER_UNSELECTED不得进入调用。'),201);
 const a=await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),...input('B08原始手动甲',' 帮我分析订货流程，说明哪里适合 AI。\n原文首尾保留 ')},201);
 await expect(s,`/api/prompts/${a.prompt.id}`,'PUT',{baseVersion:1,...input(a.prompt.name,a.prompt.body,{scenario:'甲第二版场景'})});
 const b=await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),...input('B08切换手动乙','乙无变量原文')},201);
 await expect(s,`/api/prompts/${b.prompt.id}`,'PUT',{baseVersion:1,...input(b.prompt.name,'乙第二版无变量原文')});
 proxy=http.createServer(async(req,res)=>{
  if(req.url==='/clipboard-target'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh"><title>B08普通粘贴目标</title><label>普通粘贴目标<textarea aria-label="普通粘贴目标" rows="18" cols="90"></textarea></label></html>');return;}
  try{
   const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
   const response=await fetch(s.base+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:body});const content=await response.text();
   const record={at:new Date().toISOString(),method:req.method,url:req.url,status:response.status,requestBody:body.toString('utf8'),body:content};report.httpRequests.push(record);
   await fs.appendFile(path.join(h.dataRoot,'.b08-http.jsonl'),JSON.stringify(record)+'\n');
   const gateFile=path.join(h.dataRoot,'.b08-gate.json');const gate=await fs.readFile(gateFile,'utf8').then(JSON.parse,()=>null);
   const match=(gate?.gates??(gate?[gate]:[])).find(g=>g.method===req.method&&req.url.includes(g.match));
   if(match){
    const event={...record,id:match.id,phase:'held'};report.events.push(event);await fs.appendFile(path.join(h.dataRoot,'.b08-events.jsonl'),JSON.stringify(event)+'\n');
    for(let n=0;n<600;n++){const next=await fs.readFile(gateFile,'utf8').then(JSON.parse,()=>null);if(!(next?.gates??(next?[next]:[])).some(g=>g.id===match.id))break;await delay(30);}
    const released={...event,at:new Date().toISOString(),phase:'released'};report.events.push(released);await fs.appendFile(path.join(h.dataRoot,'.b08-events.jsonl'),JSON.stringify(released)+'\n');
   }
   res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json',...(response.headers.get('content-disposition')?{'content-disposition':response.headers.get('content-disposition')}:{})});res.end(content);
  }catch(e){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Independent proxy failure'}}));}
 });
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const proxyPort=proxy.address().port,uiPort=await port();
 ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{env:{...process.env,FMCG_PORT:String(proxyPort)},windowsHide:true,stdio:['ignore','pipe','pipe']});ui.stdout.on('data',b=>report.uiLogs+=b);ui.stderr.on('data',b=>report.uiLogs+=b);
 report.url=`http://127.0.0.1:${uiPort}/`;for(let n=0;n<100;n++){try{if((await fetch(report.url)).ok)break;}catch{}await delay(100);}
 Object.assign(report,{api:s.base,proxy:`http://127.0.0.1:${proxyPort}`,clipboardUrl:`http://127.0.0.1:${proxyPort}/clipboard-target`,aId:a.prompt.id,bId:b.prompt.id,rawId:raw.id,wikiIds:[w1.id,w2.id],apiPid:s.child.pid,uiPid:ui.pid,beforeKnowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),beforePrompts:await fileSnapshot(path.join(h.dataRoot,'prompts')),stopFile:path.join(h.dataRoot,'.stop-b08-browser')});
 await fs.writeFile(prefix+'-runtime.json',JSON.stringify(report,null,2));console.log(JSON.stringify({url:report.url,dataRoot:h.dataRoot}));
 while(!await fs.access(report.stopFile).then(()=>true,()=>false)){
  const marker=path.join(h.dataRoot,'.restart-api');if(await fs.access(marker).then(()=>true,()=>false)){await fs.rm(marker);const apiPort=s.port;await h.stop(s);s=await h.start(h.dataRoot,true,apiPort);report.restartCount=(report.restartCount??0)+1;report.apiPid=s.child.pid;await fs.writeFile(prefix+'-runtime.json',JSON.stringify(report,null,2));console.log('API restarted same directory');}await delay(200);
 }
 report.afterKnowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge'));report.afterPrompts=await fileSnapshot(path.join(h.dataRoot,'prompts'));report.finalPrompts=await expect(s,'/api/prompts');
}finally{
 await fs.rm(path.join(h.dataRoot,'.b08-gate.json'),{force:true});
 if(ui&&ui.exitCode===null){const done=once(ui,'exit');ui.kill();await done;}
 if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 await h.close();report.providerRequests=h.requests;report.closed={api:!s||s.child.exitCode!==null||s.child.signalCode!==null,ui:!ui||ui.exitCode!==null||ui.signalCode!==null,proxy:!proxy||!proxy.listening,fake:true};
 await fs.writeFile(prefix+'-runtime.json',JSON.stringify(report,null,2));
}

