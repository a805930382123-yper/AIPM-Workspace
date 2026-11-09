import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const report=path.resolve('docs/reports/WORK-CLOSED-20261109');
const materials=JSON.parse(await readFile(path.join(report,'materials.json'),'utf8'));
assert.equal(materials.synthetic,true);assert.equal(materials.events.length,6);
const cache=path.resolve('node_modules/.cache/work-closed');await mkdir(cache,{recursive:true});
const root=await mkdtemp(path.join(cache,'run-')),data=path.join(root,'data'),config=path.join(root,'isolated.env');
const evidence={head:execFileSync('git',['-c','safe.directory='+process.cwd(),'rev-parse','HEAD'],{encoding:'utf8'}).trim(),root,data,checks:[],calls:[],raws:[],runs:[],realModelCalls:0,ui:'NOT_RUN'};
const sha=x=>createHash('sha256').update(x).digest('hex');
const stageBodies=['【合成演练人工阶段成果】事实：120店请求超时；20店请求成功；80/100店日结，比较时点不完整。口径：含税出库与净签收不同。推断：规模可能影响导出，仅为假设。待确认：全店日结、在途差额、动销率定义和文件可下载性。下一步收集同条件复跑与口径说明。','【合成演练人工阶段成果】事实：同120店请求复现超时，20店对照成功；同一业务日2026-11-01日结已100/100；模拟对账说明称含税出库22万与净签收20万差2万为在途，未附凭证；动销率明确为16/20=80%。推断：规模相关性能问题仍需技术定位，不能认定根因。待确认：实际报表附件可下载性、对账凭证及跨期口径稳定性。下一步：提供复跑参数给技术，并验证附件；先维持人工补料，不据模拟频次决定自动化。'];
const listen=async s=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port};
const fake=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const p=JSON.parse(body),input=JSON.parse(p.messages.find(m=>m.role==='user').content);evidence.calls.push({input,route:req.url,model:p.model});const output={observations:input.sources.map(s=>({rawId:s.rawId,quote:s.body,observation:'合成夹具：该条反馈已记录，结论仅限原文。'})),suggestions:['核对补充证据并人工保存阶段成果。'],openQuestions:['报表附件仍待核验。'],roundSummary:'合成固定输出用于验证续轮链路，不代表模型质量。',themes:[{title:'补料证据核对',conclusion:{kind:'evidence_supported',text:'当前原文记录了本轮反馈。'},evidence:[0],counterEvidence:[],openQuestions:['附件是否可用？'],nextSteps:['补交附件'],confirmedConflict:null}]};res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));});
let api,closed;const logs=[];
try{
const fp=await listen(fake),reserve=createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));
await writeFile(config,`FMCG_LLM_BASE_URL=http://127.0.0.1:${fp}/v1\nFMCG_LLM_MODEL=closed-loop-fake\nFMCG_LLM_API_KEY=local-synthetic-key\n`);
const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^FMCG_|proxy|^NODE_OPTIONS$/i.test(k)));
api=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...clean,FMCG_DATA_DIR:data,FMCG_PORT:String(port),FMCG_LLM_CONFIG_FILE:config},windowsHide:true});closed=once(api,'close');api.stdout.on('data',x=>logs.push(String(x)));api.stderr.on('data',x=>logs.push(String(x)));
const base='http://127.0.0.1:'+port;
for(let i=0;i<150;i++){if(await fetch(base+'/api/health').then(r=>r.ok,()=>false))break;await new Promise(r=>setTimeout(r,80));}
assert.ok(logs.join('').includes('(data: '+data+')'));
const call=async(url,method='GET',body,status=200)=>{const res=await fetch(base+url,{method,signal:AbortSignal.timeout(15000),...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const value=await res.json();assert.equal(res.status,status,JSON.stringify(value));return value};
const books=async()=>({wiki:await call('/api/wiki'),prompts:await call('/api/prompts')});const before=await books();
let item=await call('/api/work-items','POST',{kind:'product_analysis',title:'【合成】智能参谋能力缺口闭环',goal:'核对反馈、承接阶段成果并用补料修正判断。'},201);const url='/api/work-items/'+item.id;evidence.itemId=item.id;
let firstHash;
for(let round=1;round<=2;round++){
const ids=[];for(const event of materials.events.filter(e=>e.round===round)){const raw=await call('/api/raw','POST',{title:event.title,body:event.body,sourceType:'note',sourceName:'合成问答反馈',tags:['合成']},201);assert.equal((await call('/api/raw/'+raw.id)).body,event.body);ids.push(raw.id);evidence.raws.push({eventId:event.eventId,id:raw.id,sha256:sha(event.body)});}
item=await call(url,'PUT',{baseRevision:item.revision,rawIds:evidence.raws.map(r=>r.id)});
const run=await call(url+'/analysis-runs','POST',{baseRevision:item.revision,rawIds:ids,outputVersion:2,roundQuestion:round===1?'哪些问题需要补证？':'补料是否改变上轮判断？',...(round===2?{stageHistoryIndex:0}:{})},201);assert.equal(run.status,'completed',JSON.stringify(run));
assert.deepEqual(run.input.sources.map(s=>s.rawId),ids);if(round===2){assert.equal(run.input.stageContext.body,stageBodies[0]);assert.equal(evidence.calls[1].input.stageContext.body,stageBodies[0]);}
item=await call(url,'PUT',{baseRevision:item.revision,history:{kind:'stage_result',body:stageBodies[round-1],analysisRunId:run.id}});
evidence.runs.push(run);const file=path.join(data,'work-items','analysis-runs',item.id,run.id+'.json');if(round===1)firstHash=sha(await readFile(file));
assert.equal((await call(url)).history.at(-1).body,stageBodies[round-1]);evidence.checks.push('round '+round+': 3 Raw exact, associated, completed analysis, explicit stage save and readback');}
assert.equal(sha(await readFile(path.join(data,'work-items','analysis-runs',item.id,evidence.runs[0].id+'.json'))),firstHash);
for(const raw of evidence.raws)assert.equal(sha((await call('/api/raw/'+raw.id)).body),raw.sha256);
assert.deepEqual(await books(),before);assert.equal(evidence.calls.length,2);assert.equal(item.history.length,2);assert.equal((await call(url+'/analysis-runs')).items.length,2);
evidence.item=await call(url);evidence.stageBodies=stageBodies;evidence.checks.push('first run immutable; all Raw immutable; 2 histories; Wiki/Prompt unchanged; fake calls=2');evidence.result='PASS';
}finally{if(api){api.kill();await closed;}await new Promise(r=>fake.close(r));await writeFile(path.join(root,'server.log'),logs.join(''));evidence.processesClosed=true;await writeFile(path.join(root,'summary.json'),JSON.stringify(evidence,null,2));await writeFile(path.join(report,'summary.json'),JSON.stringify(evidence,null,2));}
console.log(JSON.stringify({result:evidence.result,root,checks:evidence.checks}));
