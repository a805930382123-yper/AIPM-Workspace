/** Full App + real API/stores/runner; only the Provider is fake. No config loader. */
import express from 'express';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {appendFile,mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {storageFixture} from '../tests/support/kb02-storage-fixture.ts';
import {deepReply} from '../tests/support/kb03-deep-fixture.ts';
import {approveDraft} from '../tests/support/human-review.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {WikiCommitService} from '../services/wiki/commits.ts';
import {registerB04Routes} from '../server/llm-api.ts';
import {registerKnowledgeRoutes} from '../server/knowledge-api.ts';
import {LLMService} from '../services/llm/service.ts';
import {getStats} from '../services/stats/index.ts';
import {validateRaw} from '../server/validation.ts';

const f=await storageFixture();f.succeed();const original=f.provider.complete;let seeding=true;const failures=new Set<string>();
f.provider.complete=async request=>{
  const deep=request.system.startsWith('KB03 '),stage=deep?JSON.parse(request.user).stage:request.user.includes('请对下列全部已验证事实规划知识页')?'planning':'extracting';
  await appendFile(path.join(f.root,'fake-requests.jsonl'),JSON.stringify({at:new Date().toISOString(),stage})+'\n');
  await new Promise(r=>setTimeout(r,seeding?10:550));
  if(deep&&stage==='outline'&&request.user.includes('故障演示')&&!failures.has(request.user)){failures.add(request.user);throw Error('隔离fake一次故障；显式继续将成功。');}
  if(!deep)return original(request);
  const value=deepReply(request) as any;if(stage==='quality')value.findings=[{severity:'warning',category:'semantic',sectionId:'core',blockIndex:0,reason:'生成报告保留示例：请核对同文不同位置的来源。'}];
  return {text:JSON.stringify(value),bytes:1,finishReason:'stop'};
};
const create=(title:string,body:string)=>f.rawStore.create({title,body,sourceType:'report',sourceName:'KB03隔离虚构资料',tags:[]});
const short=await create('01 深度生成：虚构青禾渠道','甲区域目标100家，在售20家。\n负责人未知。\n乙区域目标100家，在售20家。');
const long=await create('02 超限：30001字符原文','长'.repeat(30001));
const standard=await create('03 既有标准草稿','标准样例目标100家，在售20家。');
const deep=await create('04 需重新审查的深度草稿','甲区域目标100家，在售20家。\n负责人未知。\n乙区域目标100家，在售20家。');
const repeatQuote=('重复口径目标100家，在售20家。'+'资料'.repeat(256)).slice(0,509)+'。\n\n';
const repeated=await create('06 重复引文两个位置',repeatQuote.repeat(2));
const failure=await create('05 显式恢复：一次失败','故障演示目标100家，在售20家。');
for(const [raw,mode]of [[standard,'standard'],[deep,'deep'],[failure,'deep'],[repeated,'deep']] as const){const result=await f.runner.start(raw.id,{newJobId:randomUUID(),now:new Date().toISOString(),mode});await f.runner.waitForSettlement(result.job.id);const saved=(await f.jobs.get(result.job.id))!;if(raw.id===deep.id&&saved.draftId)await approveDraft(f.drafts,saved.draftId,raw.body);}
const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();
const app=express();app.use(express.json({limit:'3mb'}));
app.get('/api/health',(_req,res)=>res.json({ok:true,isolated:true}));
app.get('/api/raw',async(_req,res,next)=>{try{res.json({items:await f.rawStore.list()});}catch(e){next(e);}});
app.get('/api/raw/:id',async(req,res,next)=>{try{const raw=await f.rawStore.get(req.params.id);if(!raw)return res.status(404).json({error:{message:'Raw不存在'}});res.json(raw);}catch(e){next(e);}});
app.post('/api/raw',async(req,res,next)=>{try{res.status(201).json(await f.rawStore.create(validateRaw(req.body)));}catch(e){next(e);}});
app.get('/api/stats',async(_req,res,next)=>{try{res.json(await getStats(f.root,f.rawStore));}catch(e){next(e);}});
app.get('/api/wiki/schema',async(_req,res,next)=>{try{res.json(await wiki.schema());}catch(e){next(e);}});
app.get('/api/wiki',async(_req,res,next)=>{try{res.json({items:await wiki.allRecords()});}catch(e){next(e);}});
app.get('/api/recovery-issues',(_req,res)=>res.json({items:[],overflow:false}));
registerB04Routes(app,{...f,rulesDir:'rules',provider:()=>f.provider,llm:new LLMService('rules'),commits,wikiStore:wiki});
registerKnowledgeRoutes(app,{root:f.root,raws:f.rawStore,drafts:f.drafts,wiki,provider:()=>f.provider});
app.use(((e,_req,res,_next)=>res.status(e.status??500).json({error:{code:e.code??'ISOLATED_ERROR',message:e.message}})) as express.ErrorRequestHandler);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const apiPort=(server.address() as AddressInfo).port;
const emptyEnv=await mkdtemp(path.join(os.tmpdir(),'kb03-r3-vite-env-'));
const vite=await createServer({configFile:false,root:process.cwd(),envDir:emptyEnv,plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${apiPort}`}}});await vite.listen();const uiPort=(vite.httpServer!.address() as AddressInfo).port;seeding=false;
const info={pid:process.pid,url:`http://127.0.0.1:${uiPort}`,api:`http://127.0.0.1:${apiPort}`,root:f.root,fixtures:[short,long,standard,deep,failure,repeated].map(r=>({title:r.title,id:r.id})),requests:path.join(f.root,'fake-requests.jsonl'),stop:`Stop-Process -Id ${process.pid}`,steps:['首页→Raw→01，默认深度，点击AI整理知识走真实生成并观察进度','进入深度笔记编辑章节/单元格/引用、删除补充，保存后刷新，展开知识卡片核审批清空','覆盖区点真实offset定位；删除章节→未覆盖，明确排除填理由；人工问题单独保存','03继续审核标准草稿；02深度禁用提示；05显式继续提取复用失败阶段','任意新Raw正文含“故障演示”会在大纲阶段失败一次，再次显式继续成功']};
await writeFile(path.join(f.root,'isolated-session.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info,null,2));
const close=async()=>{await vite.close();await new Promise<void>(r=>server.close(()=>r()));for(const job of await f.jobs.list())if((await f.runner.readJob(job.id)).execution==='running'){await f.runner.cancel(job.id);await f.runner.waitForSettlement(job.id);}process.exit(0);};process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
