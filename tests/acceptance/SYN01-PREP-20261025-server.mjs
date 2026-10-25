import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {RawStore} from '../../services/raw/store.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {registerKnowledgeRoutes} from '../../server/knowledge-api.ts';
import {offlineOptions,isolatedRoot,readJson,writeJson,sha,fakeOutput,must,GateError,installOfflineGuard} from './SYN01-PREP-20261025-core.mjs';

export async function createLab(options={}){
  offlineOptions(options);
  const guard=installOfflineGuard();
  const root=options.root?isolatedRoot(options.root):await fs.mkdtemp(path.resolve('.scratch-SYN01-PREP-'));
  // Reject symbolic data roots rather than resolve into an unrelated data directory.
  must(!(await fs.lstat(root)).isSymbolicLink(),'SYMLINK_ROOT_DENIED');
  const rejectLinks=async dir=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){must(!item.isSymbolicLink(),'SYMLINK_DATA_DENIED');if(item.isDirectory())await rejectLinks(path.join(dir,item.name));}};await rejectLinks(root);
  const lease=path.join(root,'server.lock');let held=false,server;
  try{
    try{const prior=await readJson(lease);try{process.kill(prior.pid,0);throw new GateError('SERVER_ALREADY_RUNNING');}catch(error){if(error.code!=='ESRCH')throw error;}await fs.unlink(lease);}catch(error){if(error.code!=='ENOENT')throw error;}
    await writeJson(lease,{pid:process.pid,simulationOnly:true});held=true;
    const raws=new RawStore(root),drafts=new DraftStore(root),wiki=new WikiStore(root,raws);
    for(const store of [raws,drafts,wiki])await store.initialize();
    const fixture=await readJson('tests/acceptance/SYN01-PREP-20261025-fixtures.json');
    let session;try{session=await readJson(path.join(root,'session.json'));}catch(error){if(error.code!=='ENOENT')throw error;
      const samples=[];for(const item of fixture.raws){const raw=await raws.create({title:item.title,body:item.body,sourceType:'report',sourceName:'SYN01虚构隔离fixture',tags:['simulation-only']});samples.push({key:item.key,id:raw.id,title:raw.title,bodySha256:raw.bodySha256});}
      session={id:randomUUID(),mode:'fake',simulationOnly:true,samples,realCalls:0,knowledgeCalls:241,promptCalls:15};await writeJson(path.join(root,'session.json'),session);
    }
    must(session.mode==='fake'&&session.simulationOnly===true&&session.realCalls===0,'SESSION_MODE_DENIED');
    for(const item of fixture.raws){const saved=session.samples.find(x=>x.key===item.key),raw=saved&&await raws.get(saved.id);must(raw&&raw.title===item.title&&raw.body===item.body&&raw.bodySha256===saved.bodySha256&&sha(item.body)===saved.bodySha256&&!raw.origin,'FIXTURE_DRIFT');}
    const requests=[],state={failure:null};
    const provider=Object.freeze({name:'fake-offline-only',model:'SYN01-synthetic',complete:async request=>{
      must(request.purpose==='knowledge'&&request.system.startsWith('你是多来源知识综合助手。'),'NON_SYNTHESIS_PROVIDER_DENIED');
      const entries=JSON.parse(request.user);must(entries.length===2&&entries.every(entry=>session.samples.some(s=>s.id===entry.id)),'NON_FIXTURE_PROVIDER_DENIED');
      const number=requests.length+1;requests.push(structuredClone(request));await writeJson(path.join(root,`fake-request-${process.pid}-${number}.json`),{simulationOnly:true,request});
      let output=fakeOutput(entries);if(state.failure){const failure=state.failure;state.failure=null;if(failure==='schema')output.agreement='invalid';if(failure==='rawId')output.conflicts[0].rawId=randomUUID();if(failure==='quote')output.conflicts[0].quote='不存在的引文';if(failure==='index')output.conflicts[0].start++;}
      const text=JSON.stringify(output);await writeJson(path.join(root,`fake-response-${process.pid}-${number}.json`),{simulationOnly:true,text});return {text,finishReason:'stop',bytes:Buffer.byteLength(text)};
    }});
    const app=express(),trace=[];app.use(express.json({limit:'1mb'}));
    app.use((req,_res,next)=>{trace.push({method:req.method,path:req.path});const get=req.method==='GET'&&(/^\/api\/(?:health|raw|wiki)$/.test(req.path)||/^\/api\/raw\/[0-9a-f-]{36}(?:\/references)?$/.test(req.path)||/^\/api\/wiki\/[0-9a-f-]{36}(?:\/export|\/references)?$/.test(req.path)||req.path.startsWith('/api/knowledge/workflows')||/^\/api\/knowledge\/commits\/[0-9a-f-]{36}$/.test(req.path));
      const write=req.method==='POST'&&(req.path==='/api/knowledge/syntheses'||/^\/api\/knowledge\/workflows\/[0-9a-f-]{36}\/(?:confirm|review\/start|review\/move|review\/pages\/[0-9a-f-]{36})$/.test(req.path))||req.method==='PATCH'&&/^\/api\/knowledge\/workflows\/[0-9a-f-]{36}$/.test(req.path);
      if(!get&&!write)return next(new GateError('OUT_OF_SCOPE_ROUTE'));next();});
    app.get('/api/health',(_q,r)=>r.json({ok:true,mode:'fake',simulationOnly:true,realCalls:0}));
    app.get('/api/raw',async(_q,r,n)=>{try{r.json({items:await raws.list()});}catch(e){n(e);}});
    app.get('/api/raw/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.referencesToRaw(q.params.id)});}catch(e){n(e);}});
    app.get('/api/raw/:id',async(q,r,n)=>{try{const item=await raws.get(q.params.id);if(!item)return r.status(404).json({error:{code:'RAW_NOT_FOUND'}});r.json(item);}catch(e){n(e);}});
    app.get('/api/wiki',async(_q,r,n)=>{try{r.json({items:await wiki.list(),categoryCounts:await wiki.categoryCounts()});}catch(e){n(e);}});
    app.get('/api/wiki/:id/export',async(q,r,n)=>{try{const item=await wiki.exportMarkdown(q.params.id);if(!item)return r.sendStatus(404);r.type('text/markdown').send(item.markdown);}catch(e){n(e);}});
    app.get('/api/wiki/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.references(q.params.id)});}catch(e){n(e);}});
    app.get('/api/wiki/:id',async(q,r,n)=>{try{const item=await wiki.get(q.params.id);if(!item)return r.sendStatus(404);r.json({...item,links:await wiki.links(item.id)});}catch(e){n(e);}});
    registerKnowledgeRoutes(app,{root,raws,drafts,wiki,provider:()=>provider});
    app.use((error,_q,r,_n)=>r.status(error.status??500).json({error:{code:error.code??'LOCAL_ADAPTER_ERROR',message:error.message,details:error.details}}));
    server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    const base=`http://127.0.0.1:${server.address().port}`;guard.allowed.add(base);
    let closed=false;return {root,session,raws,drafts,wiki,base,requests,state,trace,async close(){if(closed)return;closed=true;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));guard.allowed.delete(base);await fs.unlink(lease);held=false;}};
  }catch(error){if(server?.listening)await new Promise(r=>server.close(r));if(held)await fs.unlink(lease);throw error;}
}
