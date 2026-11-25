import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
// R13 offline fixture + complete App. Preparation/startup never load a real Provider configuration.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { r13Fixture } from '../support/r13-merge-fixture.ts';
import { RawStore } from '../../services/raw/store.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { LLM_ENV } from '../../services/llm/config.ts';
import { OpenAiCompatibleProvider, LlmError } from '../../services/llm/provider.ts';

const entry=fileURLToPath(import.meta.url),prefix='r13-merge-20261029-',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.env.R13_NO_PROVIDER==='1')OpenAiCompatibleProvider.prototype.complete=async()=>{throw new LlmError('LLM_NOT_CONFIGURED','R13离线验收实例已禁用Provider。',503);};
async function inventory(root,dirs){const files=[];async function walk(relative){for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const file=path.join(relative,item.name);if(item.isDirectory())await walk(file);else if(item.isFile())files.push({path:file.replaceAll('\\','/'),sha256:sha(await fs.readFile(path.join(root,file)))});}}for(const dir of dirs)await walk(dir);return files.sort((a,b)=>a.path.localeCompare(b.path));}
async function frozen(){const files=await inventory(process.cwd(),['app','services','server','rules','dist']);for(const file of ['tests/support/r13-merge-fixture.ts','tests/acceptance/R13-MERGE-20261029-run.mjs','docs/handoffs/R13-MERGE-20261029-task.md','package.json','package-lock.json'])files.push({path:file,sha256:sha(await fs.readFile(file))});return {files,sha256:sha(JSON.stringify(files))};}
async function session(root){root=path.resolve(root);if(path.dirname(root).toLowerCase()!==path.resolve(os.tmpdir()).toLowerCase()||!path.basename(root).startsWith(prefix))throw Error('R13_ISOLATED_TEMP_REQUIRED');const s=JSON.parse(await fs.readFile(path.join(root,'r13-session.json'),'utf8'));if(s.root!==root)throw Error('R13_SESSION_MISMATCH');return s;}
export async function prepare(){
  const f=await r13Fixture(),freeze=await frozen(),data={root:f.root,kind:'explicit-offline-fixture',rawId:f.raw.id,draftId:f.draft.id,pages:f.draft.pages.map(p=>({pageId:p.pageId,title:p.title,type:p.type,fields:p.templateFields})),rawBodySha256:f.raw.bodySha256,unitsSha256:sha(JSON.stringify(f.draft.humanReview.units)),freezeSha256:freeze.sha256,realCalls:0,configReads:0};
  await fs.writeFile(path.join(f.root,'empty.env'),'');await fs.writeFile(path.join(f.root,'r13-session.json'),JSON.stringify(data,null,2));await fs.writeFile(path.join(f.root,'r13-freeze.json'),JSON.stringify(freeze,null,2));return data;
}
export async function snapshot(root){const s=await session(root),raws=new RawStore(root),wiki=new WikiStore(root,raws),drafts=new DraftStore(root);return {session:s,raw:await raws.get(s.rawId),draft:await drafts.get(s.draftId),wiki:await wiki.allRecords(),files:await inventory(root,['knowledge','drafts','state']),realCalls:0,mode:'provider-disabled',uiTest:'requires-separate-main-CUA-evidence'};}
export async function serve(root,uiPort=5182,apiPort=63995,smoke=false){
  const s=await session(root);if((await frozen()).sha256!==s.freezeSha256)throw Error('R13_FREEZE_DRIFT');
  const env={...process.env,FMCG_DATA_DIR:s.root,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:path.join(s.root,'empty.env'),R13_NO_PROVIDER:'1'};for(const key of Object.values(LLM_ENV))delete env[key];
  const child=spawn(process.execPath,['--import','tsx','--import',import.meta.url,'server/index.ts'],{cwd:process.cwd(),env: withoutInheritedEmbeddings(env),windowsHide:true,stdio:['ignore','pipe','pipe']});const log=await fs.open(path.join(root,'backend.log'),'a');child.stdout.on('data',bytes=>{void log.write(bytes);});child.stderr.on('data',bytes=>{void log.write(bytes);});
  const app=express();app.use('/api',(req,res)=>{const outgoing=http.request(`http://127.0.0.1:${apiPort}/api${req.url}`,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});outgoing.on('error',()=>{if(!res.headersSent)res.status(502).end();});req.pipe(outgoing);});app.get('/r13/export',async(_req,res)=>res.json(await snapshot(s.root)));app.use(express.static(path.resolve('dist')));
  const ui=app.listen(Number(uiPort),'127.0.0.1');await new Promise((resolve,reject)=>{ui.once('listening',resolve);ui.once('error',reject);});let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;const ended=new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));child.kill();await ended;await new Promise(resolve=>ui.close(resolve));await log.close();};process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
  for(let i=0;i<100;i++){if((await fetch(`http://127.0.0.1:${apiPort}/api/health`).catch(()=>null))?.ok)break;if(child.exitCode!==null||i===99){await stop();throw Error('R13_BACKEND_NOT_READY');}await new Promise(resolve=>setTimeout(resolve,100));}
  const result={root:s.root,url:`http://127.0.0.1:${uiPort}`,apiPort,provider:'disabled',backend:'complete server/index.ts',ui:'complete built App',realCalls:0};
  if(smoke){try{for(const route of ['/','/api/health','/api/raw','/api/wiki/schema','/r13/export']){const r=await fetch(result.url+route);if(!r.ok)throw Error('R13_HTTP_SMOKE_FAILED');await r.text();}const summary=await snapshot(root);if(summary.draft.pages.length!==3||summary.wiki.length!==0)throw Error('R13_FIXTURE_DRIFT');return {...result,pass:true,httpChecks:5,uiTest:'NOT_RUN'};}finally{await stop();}}
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===entry){const [command,...args]=process.argv.slice(2);try{const result=command==='prepare'?await prepare():command==='serve'?await serve(...args):command==='snapshot'?await snapshot(...args):command==='smoke'?await serve((await prepare()).root,5182,63995,true):(()=>{throw Error('COMMAND_INVALID');})();console.log(JSON.stringify(result,null,2));}catch(error){console.error(JSON.stringify({code:error.code??error.message,realCalls:0}));process.exitCode=1;}}
