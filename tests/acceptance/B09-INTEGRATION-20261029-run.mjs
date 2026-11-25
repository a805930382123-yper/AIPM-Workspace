import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
// Isolated complete-App preparation; real calls require start AND per-stage releases.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import { RawStore } from '../../services/raw/store.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { KnowledgeWorkflowStore } from '../../services/wiki/knowledge-workflows.ts';
import { LLM_ENV } from '../../services/llm/config.ts';
import { exportWorkspace,restoreWorkspace } from '../../scripts/backup_workspace.ts';

const SOURCE='.scratch-R22-REAL-20261029-1tqItB',PREFIX='b09-integration-20261029-',CONTROL='integration';
const FILES=['tests/acceptance/B09-INTEGRATION-20261029-run.mjs','tests/acceptance/B09-INTEGRATION-20261029-trace.mjs','docs/handoffs/B09-INTEGRATION-20261029-task.md','package.json','package-lock.json'];
const ASSETS=['knowledge','drafts','state','prompts','meetings'];
const STAGES={update:{purpose:'knowledge',route:/^\/api\/knowledge\/updates$/u},audit:{purpose:'knowledge',route:/^\/api\/audits\/[0-9a-f-]{36}\/propose$/iu},brief:{purpose:'prompt',route:/^\/api\/prompt-ai\/brief$/u},generate:{purpose:'prompt',route:/^\/api\/prompt-ai\/generate$/u},check:{purpose:'prompt',route:/^\/api\/prompt-ai\/optimize\/check$/u},rewrite:{purpose:'prompt',route:/^\/api\/prompt-ai\/drafts\/[0-9a-f-]{36}\/rewrite$/iu}};
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const exists=file=>fs.access(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const must=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const save=(file,value,flag='wx')=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag,mode:0o600});
async function inventory(root,dirs=ASSETS){
  const files=[];
  async function walk(dir){if(!(await exists(path.join(root,dir))))return;for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())files.push({path:file.replaceAll('\\','/'),sha256:sha(await fs.readFile(path.join(root,file)))});}}
  for(const dir of dirs)await walk(dir);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function freeze(){const files=await inventory(process.cwd(),['services','server','app','rules','dist']);for(const file of FILES)files.push({path:file,sha256:sha(await fs.readFile(file))});files.sort((a,b)=>a.path.localeCompare(b.path));return {files,sha256:sha(files)};}
async function sessionAt(root){root=path.resolve(root);must(path.dirname(root).toLowerCase()===path.resolve(os.tmpdir()).toLowerCase()&&path.basename(root).startsWith(PREFIX),'ISOLATED_ROOT_REQUIRED');const s=await read(path.join(root,CONTROL,'session.json')),continuation=s.profile==='prompt-context-continuation';must(s.root===root&&s.knowledgeBefore===(continuation?263:261)&&s.promptBefore===(continuation?17:15)&&s.knowledgeCap===(continuation?0:2)&&s.promptCap===(continuation?3:4),'SESSION_INVALID');return s;}
function template(s,kind,stage,route){return {kind,sessionId:s.id,freezeSha256:s.freezeSha256,issuedBy:'main',issuedAt:null,released:false,budgetApproved:false,knowledgeBefore:s.knowledgeBefore,promptBefore:s.promptBefore,knowledgeCap:s.knowledgeCap,promptCap:s.promptCap,...(s.profile==='prompt-context-continuation'?{additionalPromptCallApproved:false}:{}),...(stage?{stage,purpose:STAGES[stage].purpose,route,maxCalls:1}:{})};}
export async function prepare(kind='integration'){
  must(['integration','manual'].includes(kind),'KIND_INVALID');
  if(kind==='integration'){
    must(await exists(path.resolve(SOURCE)),'R22_SOURCE_MISSING');
    const extract=await read(path.join(SOURCE,'extract-candidate.json')),synthesis=await read(path.join(SOURCE,'synthesis-candidate.json'));
    must(extract.raw?.id==='c394e1a3-8b0d-4cbd-b943-1c60afa15a3d'&&extract.draft?.id==='72bf8cbb-c209-49ba-9726-4eca9fc77c71'&&synthesis.workflow?.id==='0c43e564-eb0e-43fa-b8c9-b177094415a0','R22_SOURCE_ID_MISMATCH');
    must(JSON.stringify(extract.draft)===JSON.stringify(await read(path.join(SOURCE,'drafts',extract.draft.id+'.json')))&&JSON.stringify(synthesis.workflow)===JSON.stringify(await read(path.join(SOURCE,'drafts','knowledge-workflows',synthesis.workflow.id+'.json'))),'R22_CANDIDATE_DISK_MISMATCH');
    const sourceRaws=new RawStore(path.resolve(SOURCE));
    for(const original of synthesis.raws){const raw=await sourceRaws.get(original.id);must(raw?.bodySha256===original.bodySha256&&raw?.body===original.body,'R22_RAW_MISMATCH');}
    for(const sequence of [259,260,261])for(const prefix of ['request','response','wire-request','wire-response'])must(await exists(path.join(SOURCE,`${prefix}-${sequence}.json`)),'R22_RESPONSE_MISSING');
  }
  const root=await fs.mkdtemp(path.join(os.tmpdir(),PREFIX));await fs.mkdir(path.join(root,CONTROL,'calls'),{recursive:true});await fs.writeFile(path.join(root,CONTROL,'empty.env'),'');
  const copied=[];
  if(kind==='integration'){
    for(const file of await inventory(path.resolve(SOURCE))){const target=path.join(root,file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(SOURCE,file.path),target);must(sha(await fs.readFile(target))===file.sha256,'COPY_SHA_DRIFT');copied.push(file);}
    const evidence=path.join(root,CONTROL,'r22-original');await fs.mkdir(evidence);
    for(const name of await fs.readdir(SOURCE))if(/^(?:request-\d+|response-\d+|wire-request-\d+|wire-response-\d+|extract-candidate|synthesis-candidate|extract-result|synthesis-result|session|freeze)\.json$/u.test(name))await fs.copyFile(path.join(SOURCE,name),path.join(evidence,name));
  }
  const f=await freeze(),s={id:randomUUID(),kind,root,source:kind==='integration'?path.resolve(SOURCE):null,copied,freezeSha256:f.sha256,knowledgeBefore:261,promptBefore:15,knowledgeCap:2,promptCap:4,rawId:kind==='integration'?'c394e1a3-8b0d-4cbd-b943-1c60afa15a3d':null,draftId:kind==='integration'?'72bf8cbb-c209-49ba-9726-4eca9fc77c71':null,workflowId:kind==='integration'?'0c43e564-eb0e-43fa-b8c9-b177094415a0':null,realCalls:0,realConfigReads:0};
  await save(path.join(root,CONTROL,'freeze.json'),f);await save(path.join(root,CONTROL,'session.json'),s);
  return {session:s,startReleaseTemplate:template(s,'start'),stageReleaseExample:template(s,'stage','update','/api/knowledge/updates')};
}
export async function prepareContinuation(kind='integration'){
  must(['integration','manual'].includes(kind),'KIND_INVALID');
  const sourceRoot=path.join(os.tmpdir(),PREFIX+'7SOfcf'),source=await sessionAt(sourceRoot);
  must(source.id==='add48a69-7222-408b-9a05-de83fe2688ef','CONTINUATION_ANCESTOR_INVALID');
  const priorCalls=await Promise.all((await fs.readdir(path.join(sourceRoot,CONTROL,'calls'))).filter(name=>name.endsWith('.json')).map(name=>read(path.join(sourceRoot,CONTROL,'calls',name))));
  must(priorCalls.length===4&&priorCalls.every(call=>call.status==='provider-returned'&&call.httpSent===1)&&JSON.stringify(priorCalls.map(call=>call.sequence).sort((a,b)=>a-b))===JSON.stringify([16,17,262,263]),'CONTINUATION_LEDGER_INVALID');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),PREFIX)),copied=await inventory(sourceRoot),history=await inventory(sourceRoot,[CONTROL]);
  for(const file of [...copied,...history]){const target=path.join(root,...(file.path.startsWith(CONTROL+'/')?[CONTROL,'ancestor',file.path.slice(CONTROL.length+1)]:[file.path]));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(sourceRoot,file.path),target);must(sha(await fs.readFile(target))===file.sha256,'COPY_SHA_DRIFT');}
  await fs.mkdir(path.join(root,CONTROL,'calls'),{recursive:true});await fs.writeFile(path.join(root,CONTROL,'empty.env'),'');
  const f=await freeze(),s={...source,id:randomUUID(),kind,root,profile:'prompt-context-continuation',source:sourceRoot,ancestorSessionId:source.id,copied,ancestorFiles:history,freezeSha256:f.sha256,knowledgeBefore:263,promptBefore:17,knowledgeCap:0,promptCap:3,realCalls:0,realConfigReads:0};
  await save(path.join(root,CONTROL,'freeze.json'),f);await save(path.join(root,CONTROL,'session.json'),s);
  return {session:s,startReleaseTemplate:template(s,'start'),stageReleaseExample:template(s,'stage','generate','/api/prompt-ai/generate'),status:'prepared-not-authorized-no-real-start-or-arm'};
}
async function approved(s,file,hash,kind){must(file&&hash,'RELEASE_REQUIRED');const bytes=await fs.readFile(file);must(sha(bytes)===hash,'RELEASE_SHA_DRIFT');const r=JSON.parse(bytes);must(r.kind===kind&&r.sessionId===s.id&&r.freezeSha256===s.freezeSha256&&r.issuedBy==='main'&&r.released===true&&r.budgetApproved===true&&Number.isFinite(Date.parse(r.issuedAt)),'RELEASE_NOT_APPROVED');for(const key of ['knowledgeBefore','promptBefore','knowledgeCap','promptCap'])must(r[key]===s[key],'RELEASE_BUDGET_DRIFT');if(s.profile==='prompt-context-continuation')must(r.additionalPromptCallApproved===true,'ADDITIONAL_PROMPT_APPROVAL_REQUIRED');must((await freeze()).sha256===s.freezeSha256,'SOURCE_FREEZE_DRIFT');return r;}
export async function arm(root,file,hash){const s=await sessionAt(root),r=await approved(s,file,hash,'stage');must(STAGES[r.stage]?.purpose===r.purpose&&STAGES[r.stage].route.test(r.route)&&r.maxCalls===1,'STAGE_INVALID');if(s.profile==='prompt-context-continuation')must(['generate','check','rewrite'].includes(r.stage),'STAGE_PROFILE_DENIED');must(!(await exists(path.join(s.root,CONTROL,'halt.json'))),'FIRST_FAILURE_STOP');must(!(await exists(path.join(s.root,CONTROL,'calls',r.stage+'.json'))),'STAGE_ALREADY_USED');await save(path.join(s.root,CONTROL,'active-grant.json'),r,'w');return {armed:r.stage,route:r.route,purpose:r.purpose,maxCalls:1};}
export async function snapshot(root){const s=await sessionAt(root),raws=new RawStore(s.root),wiki=new WikiStore(s.root,raws),drafts=new DraftStore(s.root),workflows=new KnowledgeWorkflowStore(s.root,wiki,raws);const files=await inventory(s.root),calls=(await fs.readdir(path.join(s.root,CONTROL,'calls'))).filter(f=>f.endsWith('.json'));return {session:s,files,raws:await raws.list(),wiki:await wiki.allRecords(),drafts:await drafts.list(),workflows:await workflows.list(),calls:await Promise.all(calls.map(file=>read(path.join(s.root,CONTROL,'calls',file)))),countsMeaning:'session counters describe preparation only; live per-purpose calls/httpSent are in calls; real configuration reads after authorized start are not instrumented',uiTest:'NOT_RUN_UNLESS_SEPARATE_MAIN_EVIDENCE'};}
export async function serve(root,mode='manual',uiPort=5179,apiPort=63992,startFile,startSha,smoke=false){
  const s=await sessionAt(root);must(['manual','real'].includes(mode),'MODE_INVALID');must((await freeze()).sha256===s.freezeSha256,'SOURCE_FREEZE_DRIFT');if(mode==='real'){must(s.kind==='integration','MANUAL_INSTANCE_REAL_DENIED');await approved(s,startFile,startSha,'start');}
  const env={...process.env,FMCG_DATA_DIR:s.root,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:mode==='real'?path.resolve('.env.local'):path.join(s.root,CONTROL,'empty.env'),B09_INTEGRATION_ROOT:s.root,B09_TRACE_MODE:mode};
  if(mode==='manual')for(const key of Object.values(LLM_ENV))delete env[key];
  const child=spawn(process.execPath,['--import','tsx','--import','./tests/acceptance/B09-INTEGRATION-20261029-trace.mjs','server/index.ts'],{cwd:process.cwd(),env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=await fs.open(path.join(s.root,CONTROL,'backend.log'),'a');child.stdout.on('data',bytes=>{void log.write(bytes);});child.stderr.on('data',bytes=>{void log.write(bytes);});
  const api=`http://127.0.0.1:${apiPort}`,app=express();let inFlight=false;
  app.use('/api',async(req,res)=>{
    const route='/api'+req.url.split('?')[0],ai=req.method==='POST'&&(Object.values(STAGES).some(stage=>stage.route.test(route))||/^\/api\/raw\/[^/]+\/extract$/u.test(route)||route==='/api/prompt-ai/optimize'||route==='/api/knowledge/syntheses'||route==='/api/llm/config/test');
    let grant;
    if(ai){
      if(mode==='manual'){res.status(503).json({error:{code:'LLM_NOT_CONFIGURED',message:'此隔离实例已明确禁用Provider；手工知识和Prompt仍可使用。'}});return;}
      const file=path.join(s.root,CONTROL,'active-grant.json');grant=await exists(file)?await read(file):null;
      if(inFlight||!grant||grant.route!==route||!STAGES[grant.stage]?.route.test(route)||(s.profile==='prompt-context-continuation'&&!['generate','check','rewrite'].includes(grant.stage))||await exists(path.join(s.root,CONTROL,'calls',grant.stage+'.json'))||await exists(path.join(s.root,CONTROL,'halt.json'))){res.status(409).json({error:{code:'INTEGRATION_RELEASE_REQUIRED',message:'本阶段尚未放行、已使用或已停止；未调用模型。'}});return;}inFlight=true;
    }
    const outgoing=http.request(api+'/api'+req.url,{method:req.method,headers:req.headers},response=>{
      const chunks=[];response.on('data',chunk=>{if(ai)chunks.push(chunk);});res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
      response.on('end',()=>{
        void fs.appendFile(path.join(s.root,CONTROL,'ui-http.jsonl'),JSON.stringify({at:new Date().toISOString(),method:req.method,route,status:response.statusCode})+'\n');
        if(ai){inFlight=false;const body=Buffer.concat(chunks).toString('utf8');let ids={};try{const v=JSON.parse(body);ids={draftId:v.draftId??v.draft?.id,auditId:v.audit?.id,promptId:v.prompt?.id,wikiId:v.wikiId,operationId:v.operationId};}catch{}
          void save(path.join(s.root,CONTROL,`http-${grant.stage}.json`),{route,status:response.statusCode,responseSha256:sha(body),ids});
          if((response.statusCode??500)>=400)void save(path.join(s.root,CONTROL,'halt.json'),{stage:grant.stage,code:'PRODUCT_STAGE_FAILED'}).catch(()=>undefined);
        }
      });
    });outgoing.on('error',()=>{inFlight=false;if(!res.headersSent)res.status(502).end();});req.pipe(outgoing);
  });
  app.get('/integration/export',async(_req,res,next)=>{try{res.json(await snapshot(s.root));}catch(error){next(error);}});app.use(express.static(path.resolve('dist')));
  const ui=app.listen(Number(uiPort),'127.0.0.1');await new Promise(resolve=>ui.once('listening',resolve));
  let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;const exited=new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});child.kill();await exited;await new Promise(resolve=>ui.close(resolve));await log.close();};process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
  for(let n=0;n<100;n++){const response=await fetch(api+'/api/health').catch(()=>null);if(response?.ok)break;must(child.exitCode===null&&n<99,'BACKEND_NOT_READY');await new Promise(resolve=>setTimeout(resolve,100));}
  const result={root:s.root,url:`http://127.0.0.1:${uiPort}`,api,mode,exportUrl:`http://127.0.0.1:${uiPort}/integration/export`,backend:'complete server/index.ts',ui:'complete built App',uiTest:'NOT_RUN'};await save(path.join(s.root,CONTROL,'active-app.json'),result,'w');
  if(smoke){try{const assert=(await import('node:assert/strict')).default;for(const route of ['/','/api/health','/api/stats','/api/raw','/api/raw-processing','/api/wiki/schema','/api/knowledge/workflows','/api/prompts','/integration/export']){const response=await fetch(result.url+route);assert.equal(response.status,200,route);await response.text();}const denied=await fetch(result.url+'/api/prompt-ai/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task:'offline smoke',template:'general'})});assert.equal(denied.status,503);const deniedConnection=await fetch(result.url+'/api/llm/config/test',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(deniedConnection.status,503);assert.equal((await fs.readdir(path.join(s.root,CONTROL,'calls'))).length,0);return {...result,pass:true,httpChecks:11,realCalls:0,realConfigReads:0};}finally{await stop();}}
  return result;
}
export async function backup(root,output){const s=await sessionAt(root);return exportWorkspace(s.root,output);}
export async function restore(sourceRoot,archive){const source=await sessionAt(sourceRoot),root=await fs.mkdtemp(path.join(os.tmpdir(),PREFIX));await restoreWorkspace(archive,root);await fs.mkdir(path.join(root,CONTROL,'calls'),{recursive:true});await fs.writeFile(path.join(root,CONTROL,'empty.env'),'');const frozen=await freeze(),s={...source,id:randomUUID(),kind:'manual',root,source:source.root,restoredFrom:archive,freezeSha256:frozen.sha256};await save(path.join(root,CONTROL,'session.json'),s);await save(path.join(root,CONTROL,'freeze.json'),frozen);return {root,files:await inventory(root),realCalls:0,mode:'manual-readback'};}
export async function probe(root,failure='false'){
  const s=await sessionAt(root);must(s.kind==='manual','PROBE_REQUIRES_MANUAL_INSTANCE');const assert=(await import('node:assert/strict')).default;
  process.env.B09_INTEGRATION_ROOT=s.root;process.env.B09_TRACE_MODE='smoke';
  globalThis.fetch=async()=>{if(failure==='true')throw Error('offline injected failure');return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}));};
  await import('./B09-INTEGRATION-20261029-trace.mjs');const {OpenAiCompatibleProvider}=await import('../../services/llm/provider.ts');
  const provider=new OpenAiCompatibleProvider({baseUrl:'https://fixture.invalid/v1',model:'offline',apiKey:'local-smoke-key',source:'env'}),request={system:'offline trace probe',user:'{}',timeoutMs:1000,maxOutputBytes:4096};
  const continuation=s.profile==='prompt-context-continuation';
  if(continuation)for(const stage of ['update','audit','brief']){await save(path.join(s.root,CONTROL,'active-grant.json'),{stage,purpose:STAGES[stage].purpose},'w');await assert.rejects(provider.complete({...request,purpose:STAGES[stage].purpose}),{code:'INTEGRATION_STAGE_NOT_ALLOWED'});}
  for(const stage of failure==='true'?[continuation?'generate':'update']:continuation?['generate','check','rewrite']:Object.keys(STAGES)){
    await save(path.join(s.root,CONTROL,'active-grant.json'),{stage,purpose:STAGES[stage].purpose},'w');
    const input={...request,...(stage==='audit'?{}:{purpose:STAGES[stage].purpose})};
    if(failure==='true'){await assert.rejects(provider.complete(input),{code:'LLM_NETWORK_ERROR'});await assert.rejects(provider.complete(input),{code:'INTEGRATION_FIRST_FAILURE_STOP'});}
    else await provider.complete(input);
  }
  const calls=await Promise.all((await fs.readdir(path.join(s.root,CONTROL,'calls'))).map(name=>read(path.join(s.root,CONTROL,'calls',name))));
  if(failure!=='true'){assert.deepEqual(calls.filter(c=>c.purpose==='knowledge').map(c=>c.sequence).sort(),continuation?[]:[262,263]);assert.deepEqual(calls.filter(c=>c.purpose==='prompt').map(c=>c.sequence).sort(),continuation?[18,19,20]:[16,17,18,19]);if(!continuation)assert.equal(calls.find(c=>c.stage==='audit').purpose,'knowledge');await assert.rejects(provider.complete({...request,purpose:'prompt'}),{code:'INTEGRATION_PURPOSE_LIMIT'});}
  return {pass:true,profile:s.profile??'integration',fakeCompleteCalls:calls.length,sequences:calls.map(call=>call.sequence).sort((a,b)=>a-b),externalCalls:0,configReads:0,failureStop:failure==='true'};
}
async function childProbe(root,failure){const child=spawn(process.execPath,['--import','tsx',FILES[0],'probe',root,String(failure)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});const code=await new Promise(resolve=>child.once('exit',resolve));must(code===0,'OFFLINE_TRACE_PROBE_FAILED');return JSON.parse(output);}
export async function smoke(){const prepared=await prepare(),result=await serve(prepared.session.root,'manual',5179,63992,undefined,undefined,true);const archive=path.join(os.tmpdir(),path.basename(prepared.session.root)+'-backup.json');await backup(prepared.session.root,archive);const restored=await restore(prepared.session.root,archive),assert=(await import('node:assert/strict')).default;assert.deepEqual(await inventory(prepared.session.root),restored.files);const success=await prepare('manual'),failed=await prepare('manual');const probes=[await childProbe(success.session.root,false),await childProbe(failed.session.root,true)];return {...result,backupRestorePass:true,archive,restoredRoot:restored.root,traceProbes:probes};}
export async function continuationSmoke(){const success=await prepareContinuation('manual'),failed=await prepareContinuation('manual'),regular=await prepare('manual');return {continuation:[await childProbe(success.session.root,false),await childProbe(failed.session.root,true)],regular:await childProbe(regular.session.root,false),realCalls:0,configReads:0};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,...args]=process.argv.slice(2);try{let result;if(command==='prepare')result=await prepare(...args);else if(command==='prepare-continuation')result=await prepareContinuation(...args);else if(command==='continuation-smoke')result=await continuationSmoke();else if(command==='serve')result=await serve(...args);else if(command==='arm')result=await arm(...args);else if(command==='snapshot')result=await snapshot(...args);else if(command==='backup')result=await backup(...args);else if(command==='restore')result=await restore(...args);else if(command==='smoke')result=await smoke();else if(command==='probe')result=await probe(...args);else throw Error('COMMAND_INVALID');console.log(JSON.stringify(result,null,2));}catch(error){console.error(JSON.stringify({code:error.code??error.message,noAutomaticRetry:true}));process.exitCode=1;}
}
