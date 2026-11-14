import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, writeFile} from 'node:fs/promises';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import express from 'express';
import {build} from 'vite';
import {pdfFixture} from '../support/pdf01-fixture.ts';

const root=await mkdtemp(path.join(os.tmpdir(),'pdf02-ui-'));
const envDir=await mkdtemp(path.join(os.tmpdir(),'pdf02-empty-env-'));
const outDir=await mkdtemp(path.join(os.tmpdir(),'pdf02-ui-dist-'));
await build({configFile:false,root:process.cwd(),envDir,plugins:[react()],build:{outDir,emptyOutDir:true}});
const mixed=path.join(root,'合成研报.pdf');
await writeFile(mixed,pdfFixture(['text','scan','vector','text'],number=>number===1?'Research sample: 320 stores. March 2026.':'Outside selected scope.'));

async function listen(server:http.Server){
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return (server.address() as AddressInfo).port;
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const pageOutputs=[
  {content:'方法：2026 年 3 月调研 320 家样本门店。',visuals:'主办方宣传 Logo，无研究数据。\n| 地区 | 样本（家） |'},
  {content:'华南样本门店 120 家，单位为门店。\n| 华南 | 120 |',visuals:'扫描页脚为品牌宣传。'},
  {content:'华东样本门店 200 家，单位为门店。\n| 华东 | 200 |',visuals:'三根柱形表示渠道分布。\n表注：仅统计有效样本。'},
];
const counters:Array<{stage:string;page?:number;units?:number;topics?:number;imageSha?:string}>=[];
let failIndex=true;
const fake=http.createServer(async(req,res)=>{
  try {
    assert.equal(req.url,'/v1/chat/completions');
    const chunks:Buffer[]=[];
    for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const {messages}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const user=messages.at(-1).content;
    const input=JSON.parse(Array.isArray(user)?user[0].text:user);
    let result:unknown;
    if(input.stage==='pdf_page_understanding'){
      const uri:string=user[1].image_url.url;
      assert.match(uri,/^data:image\/png;base64,/);
      const image=Buffer.from(uri.split(',')[1],'base64');
      counters.push({stage:input.stage,page:input.page,imageSha:createHash('sha256').update(image).digest('hex')});
      if(input.page===4)throw Error('Controlled page 4 remains unread');
      result={blank:false,...pageOutputs[input.page-1],inference:'',questions:[]};
    } else if(input.stage==='pdf_cleanup'){
      const units=input.units as Array<{id:string;text:string}>;
      counters.push({stage:input.stage,units:units.length});
      result={decisions:units.map(unit=>{
        if(/宣传|Logo/u.test(unit.text))return {id:unit.id,decision:'skip',reason:'装饰与主办方宣传，无研究依据'};
        const role=unit.text.startsWith('| 地区')?'header':unit.text.startsWith('|')?'row':unit.text.startsWith('表注：')?'note':undefined;
        const topic=role||/华南|华东|柱形/u.test(unit.text)?'区域样本':'研究方法';
        return {id:unit.id,decision:'keep',reason:'保留样本、地区、单位或脚注',topic,...(role?{table:{title:'样本门店分布',role}}:{})};
      })};
    } else if(input.stage==='pdf_topic_index'){
      const topics=input.topics as string[];
      counters.push({stage:input.stage,topics:topics.length});
      if(failIndex){failIndex=false;throw Error('Controlled indexing failure');}
      result={assignments:topics.map(topic=>({topic,title:topic}))};
    } else throw Error(`Unexpected stage ${input.stage}`);
    await delay(250);
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]}));
  } catch(error) {
    res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{message:error instanceof Error?error.message:'Controlled failure'}}));
  }
});
const fakePort=await listen(fake);
const config=path.join(root,'fake-provider.env');
await writeFile(config,`FMCG_LLM_BASE_URL=http://127.0.0.1:${fakePort}/v1\nFMCG_LLM_MODEL=fixture-pdf02\nFMCG_LLM_API_KEY=synthetic-test-only-pdf02\n`);
const reservation=http.createServer();
const apiPort=await listen(reservation);
await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(FMCG_|OPENAI_|ANTHROPIC_|GEMINI_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(key)));
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{
  cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...env,FMCG_DATA_DIR:root,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config},
});
child.stdout?.pipe(process.stdout);
child.stderr?.pipe(process.stderr);
const api=`http://127.0.0.1:${apiPort}`;
let ready=false;
for(let attempt=0;attempt<150;attempt++){
  if(child.exitCode!==null)break;
  const response=await fetch(`${api}/api/health`).catch(()=>null);
  if(response?.ok){ready=true;break;}
  await delay(100);
}
if(!ready){child.kill();fake.close();throw Error('Isolated PDF product API did not start');}

const app=express();
app.get('/__control/counters',(_req,res)=>res.json({calls:counters,realProviderCalls:0}));
// The home page auto-ensures news; keep its unrelated upstream fetch out of the isolated run.
app.use('/api/news',(_req,res)=>res.sendStatus(503));
app.use('/api',(req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:apiPort,path:req.originalUrl,method:req.method,headers:{...req.headers,host:`127.0.0.1:${apiPort}`}},response=>{
    res.writeHead(response.statusCode??502,response.headers);
    response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.sendStatus(502);else res.destroy();});
  req.pipe(upstream);
});
app.use(express.static(outDir));
const frontend=http.createServer(app);
const port=await listen(frontend);
const session={pid:process.pid,apiPid:child.pid,root,envDir,outDir,url:`http://127.0.0.1:${port}`,api,fixtures:{mixed},provider:'fake-only'};
await writeFile(path.join(root,'isolated-session.json'),JSON.stringify(session,null,2));
console.log(JSON.stringify(session,null,2));
function close(){child.kill();frontend.close();fake.close();}
process.on('SIGINT',close);
process.on('SIGTERM',close);
