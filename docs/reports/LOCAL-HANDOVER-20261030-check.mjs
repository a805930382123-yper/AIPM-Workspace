import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHarness, expectJson, promptInput, uuid, fileSnapshot, delay } from '../../tests/b07-harness.mjs';
const temp = await mkdtemp(path.join(os.tmpdir(), 'fmcg-handover-'));
process.env.FMCG_LLM_CONFIG_FILE = path.join(temp, 'absent.env');
const h = await createHarness({dataRoot:path.join(temp,'source')});
let ui;
try {
 let s = await h.start();
 ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5199','--strictPort'], {cwd:process.cwd(),env:{...process.env,FMCG_PORT:String(s.port)},stdio:'ignore',windowsHide:true});
 let ready=false; for(let i=0;i<100;i++){try { if((await fetch('http://127.0.0.1:5199/')).ok){ready=true;break;} } catch {} await delay(100);}
 assert.ok(ready,'UI HTTP startup');
 const raw=await expectJson(s,'/api/raw','POST',{title:'试用样本',sourceType:'report',sourceName:'虚构',author:'试用',publishedAt:'2026-10-30',url:'https://example.com/test',tags:[],body:'手工原文测试。'},201);
 const wiki=await expectJson(s,'/api/wiki','POST',{title:'试用知识',type:'metric',category:'metric',sources:[raw.id],tags:[],aliases:[],body:'手工知识内容。',knowledge_status:'needs_verification',confidence:'low',source_level:'D',review_status:'reviewed'},201);
 const prompt=(await expectJson(s,'/api/prompts','POST',{requestId:uuid(),...promptInput({name:'试用模板',relatedWikiIds:[wiki.id]})},201)).prompt;
 async function verify(service){assert.equal((await expectJson(service,`/api/raw/${raw.id}`,'GET')).body,'手工原文测试。'); const w=await expectJson(service,`/api/wiki/${wiki.id}`,'GET'); assert.equal(w.title,'试用知识'); assert.ok(w.sources.includes(raw.id)); const p=await expectJson(service,`/api/prompts/${prompt.id}`,'GET'); assert.equal(p.prompt.name,'试用模板'); assert.ok(p.wikiLinks.some(link => link.id === wiki.id && link.status === 'resolved'));}
 await verify(s); await h.stop(s); s=await h.start(); await verify(s); await h.stop(s);
 const archive=path.join(temp,'backup.json'), dest=path.join(temp,'restored');
 for(const args of [['export','--data-root',h.root,'--output',archive],['restore','--input',archive,'--data-root',dest]]) { const r=spawnSync(process.execPath,['--import','tsx','scripts/backup_workspace.ts',...args],{cwd:process.cwd(),encoding:'utf8'}); assert.equal(r.status,0,r.stderr); }
 const a=await fileSnapshot(h.root), b=await fileSnapshot(dest); assert.deepEqual(a,b);
 s=await h.start(dest); await verify(s); await h.stop(s);
 console.log(JSON.stringify({node:process.version,uiHttp:5199,apiPort:s.port,createRead:'PASS',restartRead:'PASS',backupRestore:'PASS',restoredRead:'PASS',fileCount:Object.keys(a).length,uiInteraction:'NOT_RUN',realApiCalls:0},null,2));
} finally { if(ui) ui.kill(); await h.close(); await rm(temp,{recursive:true,force:true}); }
