import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHarness,port,expect,rawInput,wikiInput,fileSnapshot,delay} from './b07-harness.mjs';
const resume=process.argv.includes('--resume')?JSON.parse(await fs.readFile('docs/reports/B07-repair3-acceptance-browser-runtime.json','utf8')):null;
const h=await createHarness(()=>{throw Error('No provider calls allowed');},resume?.dataRoot);let s,ui,proxy;
const report={dataRoot:h.dataRoot,provider:'unconfigured',uiLogs:'',events:[]};
try{
 s=await h.start(h.dataRoot,false);
 const raw=resume?{id:resume.rawId}:await expect(s,'/api/raw','POST',rawInput('B07浏览器来源','测试材料正文保持不变。'),201);
 const wiki=resume?{id:resume.wikiId}:await expect(s,'/api/wiki','POST',wikiInput('B07浏览器关联知识',[raw.id],'浏览器知识内容，关联只读。'),201);
 const b=resume?{prompt:{id:resume.bId}}:await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),name:'B07模板乙',category:'office',scenario:'普通办公',body:'模板乙无变量原文。',inputRequirements:'乙输入',outputRequirements:'乙输出',relatedWikiIds:[],examples:'乙示例',tags:['乙标签'],favorite:false},201);
 if(!resume)await expect(s,'/api/prompts/'+b.prompt.id,'PUT',{baseVersion:1,name:'B07模板乙',category:'office',scenario:'普通办公',body:'模板乙第二版无变量原文。',inputRequirements:'乙输入',outputRequirements:'乙输出',relatedWikiIds:[],examples:'乙示例',tags:['乙标签'],favorite:false});
 proxy=http.createServer(async(req,res)=>{
  if(req.url==='/clipboard-target'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh"><head><title>B07 独立普通文本粘贴目标</title></head><body><h1>普通文本粘贴目标</h1><label>普通文本粘贴目标<textarea aria-label="普通文本粘贴目标" rows="15" cols="80"></textarea></label></body></html>');return;}
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   const result=await fetch(s.base+req.url,{method:req.method,headers:{'content-type':req.headers['content-type']??'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:body});const text=await result.text();
   const gateFile=path.join(h.dataRoot,'.b07-browser-gate.json');const gate=await fs.readFile(gateFile,'utf8').then(JSON.parse,()=>null);
   const matched=(gate?.gates??(gate?[gate]:[])).find(g=>g.method===req.method&&req.url.includes(g.match));
   if(matched){
    const event={id:matched.id??'single',phase:'held',url:req.url,method:req.method,status:result.status,body:text,requestBody:body.toString('utf8')};report.events.push(event);
    await fs.appendFile(path.join(h.dataRoot,'.b07-browser-events.jsonl'),JSON.stringify(event)+'\n');
    await fs.writeFile(path.join(h.dataRoot,'.b07-browser-gate-observed.json'),JSON.stringify(event));
    for(let n=0;n<600;n++){const next=await fs.readFile(gateFile,'utf8').then(JSON.parse,()=>null);if(!(next?.gates??(next?[next]:[])).some(g=>(g.id??'single')===(matched.id??'single')))break;await delay(30);}
    const released={...event,phase:'released'};report.events.push(released);await fs.appendFile(path.join(h.dataRoot,'.b07-browser-events.jsonl'),JSON.stringify(released)+'\n');
   }
   res.writeHead(result.status,{'content-type':result.headers.get('content-type')??'application/json',...(result.headers.get('content-disposition')?{'content-disposition':result.headers.get('content-disposition')}: {})});res.end(text);
  }catch(e){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(e)}}));}
 });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const proxyPort=proxy.address().port,uiPort=await port();
 ui=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(uiPort),'--strictPort'],{env:{...process.env,FMCG_PORT:String(proxyPort)},windowsHide:true,stdio:['ignore','pipe','pipe']});ui.stdout.on('data',x=>report.uiLogs+=x);ui.stderr.on('data',x=>report.uiLogs+=x);
 report.url=`http://127.0.0.1:${uiPort}/`;for(let n=0;n<100;n++){try{if((await fetch(report.url)).ok)break;}catch{}await delay(100);}
 Object.assign(report,{api:s.base,proxy:`http://127.0.0.1:${proxyPort}`,clipboardUrl:`http://127.0.0.1:${proxyPort}/clipboard-target`,wikiId:wiki.id,rawId:raw.id,bId:b.prompt.id,apiPid:s.child.pid,uiPid:ui.pid,beforeRaw:await fileSnapshot(path.join(h.dataRoot,'knowledge/raw')),beforeKnowledge:await fileSnapshot(path.join(h.dataRoot,'knowledge')),stopFile:path.join(h.dataRoot,'.stop-browser')});
 await fs.writeFile('docs/reports/B07-repair3-acceptance-browser-runtime.json',JSON.stringify(report,null,2));console.log(JSON.stringify({url:report.url,clipboard:report.clipboardUrl,dataRoot:h.dataRoot}));
 while(!await fs.access(report.stopFile).then(()=>true,()=>false)){
  const restart=path.join(h.dataRoot,'.restart-api');if(await fs.access(restart).then(()=>true,()=>false)){await fs.rm(restart);const oldPort=s.port;await h.stop(s);s=await h.start(h.dataRoot,false,oldPort);report.restartCount=(report.restartCount??0)+1;report.apiPid=s.child.pid;await fs.writeFile('docs/reports/B07-repair3-acceptance-browser-runtime.json',JSON.stringify(report,null,2));console.log('API restarted same data root');}await delay(200);
 }
 report.afterRaw=await fileSnapshot(path.join(h.dataRoot,'knowledge/raw'));report.afterKnowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge'));report.finalPrompts=await expect(s,'/api/prompts','GET');
}finally{
 await fs.rm(path.join(h.dataRoot,'.b07-browser-gate.json'),{force:true});
 if(ui&&ui.exitCode===null){const done=once(ui,'exit');ui.kill();await done;}
 if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 await h.close();report.closed={api:!s||s.child.exitCode!==null||s.child.signalCode!==null,ui:!ui||ui.exitCode!==null||ui.signalCode!==null,proxy:!proxy||!proxy.listening,fake:true};
 await fs.writeFile('docs/reports/B07-repair3-acceptance-browser-runtime.json',JSON.stringify(report,null,2));
}


