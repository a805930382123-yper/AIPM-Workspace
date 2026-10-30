/** Full App + real API/stores/runner; only the Provider is fake. No config loader. */
import express from 'express';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {appendFile,mkdtemp,writeFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {RawStore} from '../services/raw/store.ts';
import {RawStateStore} from '../services/raw/state.ts';
import {DraftStore} from '../services/wiki/drafts.ts';
import {ExtractionRunner,ExtractionJobStore} from '../services/llm/jobs.ts';
import {loadExtractionRules} from '../services/llm/rules.ts';
import type {LlmProvider} from '../services/llm/provider.ts';
import {deepReply} from '../tests/support/kb03-deep-fixture.ts';
import {approveDraft} from '../tests/support/human-review.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {WikiCommitService} from '../services/wiki/commits.ts';
import {registerB04Routes} from '../server/llm-api.ts';
import {registerKnowledgeRoutes} from '../server/knowledge-api.ts';
import {LLMService} from '../services/llm/service.ts';
import {getStats} from '../services/stats/index.ts';
import {validateRaw} from '../server/validation.ts';

const reuse=process.argv.includes('--root'),arg=process.argv[process.argv.indexOf('--root')+1];
const root=reuse?path.resolve(arg):await mkdtemp(path.join(os.tmpdir(),'kb03-r4-'));
const relative=path.relative(await realpath(os.tmpdir()),await realpath(root));if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('隔离入口只允许系统TEMP内的数据根。');
const rawStore=new RawStore(root),rawStates=new RawStateStore(root),drafts=new DraftStore(root),jobs=new ExtractionJobStore(root);
await Promise.all([rawStore.initialize(),rawStates.initialize(),drafts.initialize(),jobs.initialize()]);
const rules=async()=>{const b=await loadExtractionRules('rules');return {types:['metric'],categories:['metric'],...b.fmcg.enums} as any;};
const provider:LlmProvider={name:'fake',model:'budget-model',complete:async request=>{
 const p=JSON.parse(request.user.slice(request.user.lastIndexOf('\n')+1));let output;
 if(request.user.includes('请对下列全部已验证事实规划知识页')){const label=p.factUnits[0].text.slice(0,10).replace(/\s/g,'');const split=p.factUnits.length>1;output={version:3,document:{source_level:'D',title:'来源笔记：'+label,main_topic:'虚构指标'},pages:[{title:'指标甲：'+label,type:'metric',category:'metric',factUnitIds:p.factUnits.slice(0,split?1:undefined).map((x:any)=>x.id),questionUnitIds:p.questionUnits.map((x:any)=>x.id)},...(split?[{title:'指标乙：'+label,type:'metric',category:'metric',factUnitIds:p.factUnits.slice(1).map((x:any)=>x.id),questionUnitIds:[]}]:[])]};}
 else output={version:2,facts:p.map((x:any)=>({atomId:x.id,kind:'fact'})),questions:[],sourceNotes:[]};
 return {text:JSON.stringify(output),bytes:1,finishReason:'stop'};
}};
const runner=new ExtractionRunner({root,rawStore,rawStates,drafts,jobs,llm:new LLMService('rules'),rulesDir:'rules',provider:()=>provider,draftRules:rules});
const f={root,rawStore,rawStates,drafts,jobs,runner,provider};
const original=f.provider.complete;let seeding=true;const failures=new Set<string>();
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
if(!reuse){
 for(const [title,kind]of [['01 未审笔记与页面','deep'],['02 编辑过期可确认','edited'],['03 未覆盖待处理','uncovered'],['04 Source-only完整待审','deep'],['05 标准草稿','standard'],['06 新Raw现场生成','raw'],['07 故障演示显式继续','failure']] as const){
  const raw=await create(title,title+'目标100家，在售20家。另一业务指标铺货率20%，负责人未知。');if(kind==='raw')continue;
  const result=await f.runner.start(raw.id,{newJobId:randomUUID(),now:new Date().toISOString(),mode:kind==='standard'?'standard':'deep'});await f.runner.waitForSettlement(result.job.id);const saved=(await f.jobs.get(result.job.id))!;
  if((kind==='edited'||kind==='uncovered')&&saved.draftId){let draft=await approveDraft(f.drafts,saved.draftId,raw.body);const note=structuredClone(draft.structuredNote!);
   if(kind==='edited'){const table=note.sections[0].blocks.find(b=>b.type==='table')!;if(table.type==='table')table.rows[0].cells[1]='人工说明：已核对本业务范围。';}
   else {const last=draft.humanReview!.units.filter(u=>u.kind==='fact').flatMap(u=>u.records).at(-1)!.id;note.sections[0].blocks=note.sections[0].blocks.filter(b=>!(b.type==='paragraph'&&b.factIds.includes(last)));}
   await f.drafts.editStructuredNote(draft.id,{baseRevision:draft.revision,structuredNote:note},raw.body);
  }
 }
}
await runner.reconcile();
const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const commits=new WikiCommitService({root:f.root,wikiStore:wiki,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore});await commits.initialize();await commits.reconcile();
const app=express();app.use(express.json({limit:'3mb'}));
app.get('/api/health',(_req,res)=>res.json({ok:true,isolated:true}));
app.get('/api/raw',async(_req,res,next)=>{try{res.json({items:await f.rawStore.list()});}catch(e){next(e);}});
app.get('/api/raw/:id',async(req,res,next)=>{try{const raw=await f.rawStore.get(req.params.id);if(!raw)return res.status(404).json({error:{message:'Raw不存在'}});res.json(raw);}catch(e){next(e);}});
app.post('/api/raw',async(req,res,next)=>{try{res.status(201).json(await f.rawStore.create(validateRaw(req.body)));}catch(e){next(e);}});
app.get('/api/stats',async(_req,res,next)=>{try{res.json(await getStats(f.root,f.rawStore));}catch(e){next(e);}});
app.get('/api/wiki/schema',async(_req,res,next)=>{try{res.json(await wiki.schema());}catch(e){next(e);}});
app.get('/api/wiki',async(_req,res,next)=>{try{res.json({items:await wiki.list({q:typeof _req.query.q==='string'?_req.query.q:undefined,category:typeof _req.query.category==='string'?_req.query.category:undefined}),categoryCounts:await wiki.categoryCounts()});}catch(e){next(e);}});
app.get('/api/wiki/:id/export',async(req,res,next)=>{try{const result=await wiki.exportMarkdown(req.params.id);if(!result)return res.status(404).end();res.type('text/markdown').send(result.markdown);}catch(e){next(e);}});
app.get('/api/wiki/:id',async(req,res,next)=>{try{const item=await wiki.get(req.params.id);if(!item)return res.status(404).json({error:{message:'Wiki不存在'}});res.json(item);}catch(e){next(e);}});
app.get('/api/audits',(_req,res)=>res.json({items:[]}));
app.get('/api/recovery-issues',(_req,res)=>res.json({items:[],overflow:false}));
registerB04Routes(app,{...f,rulesDir:'rules',provider:()=>f.provider,llm:new LLMService('rules'),commits,wikiStore:wiki});
registerKnowledgeRoutes(app,{root:f.root,raws:f.rawStore,drafts:f.drafts,wiki,provider:()=>f.provider});
app.use(((e,_req,res,_next)=>res.status(e.status??500).json({error:{code:e.code??'ISOLATED_ERROR',message:e.message}})) as express.ErrorRequestHandler);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const apiPort=(server.address() as AddressInfo).port;
const emptyEnv=await mkdtemp(path.join(os.tmpdir(),'kb03-r3-vite-env-'));
const vite=await createServer({configFile:false,root:process.cwd(),envDir:emptyEnv,plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${apiPort}`}}});await vite.listen();const uiPort=(vite.httpServer!.address() as AddressInfo).port;seeding=false;
const fixtures=await Promise.all((await f.rawStore.list()).map(async raw=>{const state=await f.rawStates.get(raw.id),draft=state.draftId?await f.drafts.get(state.draftId):undefined;return {title:raw.title,rawId:raw.id,draftId:draft?.id??null,jobId:state.jobId,expectedCards:draft?.pages.map(p=>({id:p.pageId,title:p.title}))??[]};}));
const info={pid:process.pid,url:'http://127.0.0.1:'+uiPort,api:'http://127.0.0.1:'+apiPort,root:f.root,reused:reuse,fixtures,requests:path.join(f.root,'fake-requests.jsonl'),stop:'Stop-Process -Id '+process.pid,restart:'npx tsx scripts/kb03-review-isolated.ts --root "'+root+'"',steps:['01/02/03处理未覆盖并保存→展开知识卡片逐页确认→阅读警告及历史报告并勾选两项明确笔记核对→选部分卡或不选卡→显式正式确认','知识库打开Source默认阅读表格，可切Markdown原文、导出；再打开创建卡片','04默认Source-only但仍需全部页面和笔记审核','用输出restart同根重启（不重新seed），恢复到新TEMP根也用--root启动','06可现场真实生成；07显式继续失败阶段']};
await writeFile(path.join(f.root,'isolated-session.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info,null,2));
const close=async()=>{await vite.close();await new Promise<void>(r=>server.close(()=>r()));for(const job of await f.jobs.list())if((await f.runner.readJob(job.id)).execution==='running'){await f.runner.cancel(job.id);await f.runner.waitForSettlement(job.id);}process.exit(0);};process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
