import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {RawStore} from '../../services/raw/store.ts';
import {RawStateStore} from '../../services/raw/state.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {WikiCommitService} from '../../services/wiki/commits.ts';
import {ExtractionRunner,ExtractionJobStore} from '../../services/llm/jobs.ts';
import {LLMService} from '../../services/llm/service.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
import {registerB04Routes} from '../../server/llm-api.ts';
import {registerRecoveryRoutes} from '../../server/recovery-api.ts';
import {RecoveryRegistry} from '../../services/storage/recovery.ts';
import {getStats} from '../../services/stats/index.ts';
import {Engine,P,must,sha,readJson,durable,GateError,sessionFrom,scan} from './KB02-K204-B-20261024-core.mjs';

// Narrow B-only adaptation of the frozen A lab. No update/synthesis provider route.
export async function createLab(options){
  const engine=new Engine(options),session=await sessionFrom(options.manifestFile),root=session.root,lease=path.join(root,'server.lock');let leaseHeld=false,server;
  try{
    try{const prior=await readJson(lease);try{process.kill(prior.pid,0);throw new GateError('SERVER_ALREADY_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(lease);}catch(e){if(e.code!=='ENOENT')throw e;}
    await durable(lease,{pid:process.pid,sessionId:session.id},{exclusive:true});leaseHeld=true;await engine.initialize();
    const raws=new RawStore(root),rawStates=new RawStateStore(root),drafts=new DraftStore(root),wiki=new WikiStore(root,raws),jobs=new ExtractionJobStore(root),llm=new LLMService('rules');
    for(const store of [raws,rawStates,drafts,wiki,jobs])await store.initialize();
    const commits=new WikiCommitService({root,wikiStore:wiki,drafts,rawStates,rawStore:raws});await commits.initialize();
    const rules=await loadExtractionRules('rules'),draftRules=async()=>({types:rules.fmcg.types.map(t=>t.id),categories:rules.fmcg.categories.map(t=>t.id),...rules.fmcg.enums});let provider;
    const runner=new ExtractionRunner({root,jobs,drafts,rawStates,rawStore:raws,rulesDir:'rules',llm,provider:()=>provider,draftRules});await runner.reconcile();await commits.reconcile();
    engine.bindingReader=async stage=>{must(stage==='B','STAGE_B_ONLY');const s=await engine.load(),raw=await raws.get(s.samples.B.rawId);must(raw&&sha(raw.body)===s.samples.B.bodySha256,'RAW_BINDING_DRIFT');return {rawId:raw.id,rawSha256:s.samples.B.bodySha256};};
    engine.snapshotReader=async()=>{const s=await engine.load(),jobId=s.stages.B.jobId;return {raw:await raws.get(s.samples.B.rawId),job:jobId?await jobs.get(jobId):null,checkpoint:jobId?await readJson(path.join(root,'state','extraction-checkpoints',jobId+'.json')):null};};
    const originalStart=runner.start.bind(runner);runner.start=async(rawId,opts)=>{const s=await engine.load();must(s.activeStage==='B'&&rawId===s.samples.B.rawId,'WRONG_EXTRACTION_INPUT');await engine.update(x=>{must(!x.stages.B.jobId,'DUPLICATE_JOB');x.stages.B.jobId=opts.newJobId;});const started=await originalStart(rawId,opts);
      void(async()=>{try{await runner.waitForSettlement(started.job.id);const job=await jobs.get(started.job.id);if(job.status!=='completed'){await engine.stop(job.error?.code??'PRODUCT_EXTRACTION_FAILED','B');return;}const d=await drafts.get(job.draftId);await durable(path.join(root,'candidate-B.json'),d,{exclusive:true});await engine.finish('B',{jobId:job.id,draftId:d.id,candidateSha256:sha(d)});}catch(error){await engine.stop(error.code??'SETTLEMENT_CAPTURE_FAILED','B');}})();return started;};
    const app=express();app.use(express.json({limit:'3mb'}));app.use(async(req,res,next)=>{try{
      const extract=req.method==='POST'&&/^\/api\/raw\/[^/]+\/extract$/.test(req.path);
      if(extract){const s=await engine.load();must(req.path===`/api/raw/${s.samples.B.rawId}/extract`&&s.activeStage==='B','UNRELEASED_AI_ROUTE');must(req.body&&Object.keys(req.body).length===0,'NO_RESTART_OR_RETRY');await engine.begin('B');req.ownedStage='B';provider=await engine.provider();}
      const allowedWrite=req.method==='POST'&&(/^\/api\/drafts\/[^/]+\/review\//.test(req.path)||/^\/api\/drafts\/[^/]+\/confirm$/.test(req.path)||/^\/api\/extraction-jobs\/[^/]+\/cancel$/.test(req.path));
      if(!['GET','HEAD'].includes(req.method)&&req.path.startsWith('/api/')&&!extract&&!allowedWrite&&!(req.method==='PATCH'&&/^\/api\/drafts\/[^/]+$/.test(req.path)))throw new GateError('OUT_OF_SCOPE_ROUTE');next();
    }catch(error){if(req.ownedStage)await engine.stop(error.code??'AI_ROUTE_FAILED','B');next(error);}});
    app.get('/api/health',(_q,r)=>r.json({ok:true,isolated:true}));registerRecoveryRoutes(app,new RecoveryRegistry(root));
    app.get('/api/stats',async(_q,r,n)=>{try{r.json(await getStats(root,raws,new Date()));}catch(e){n(e);}});
    app.get('/api/raw',async(_q,r,n)=>{try{r.json({items:await raws.list()});}catch(e){n(e);}});
    app.get('/api/raw/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.referencesToRaw(q.params.id)});}catch(e){n(e);}});
    app.get('/api/raw/:id',async(q,r,n)=>{try{const raw=await raws.get(q.params.id);must(raw,'RAW_NOT_FOUND');r.json(raw);}catch(e){n(e);}});
    app.get('/api/wiki/schema',async(_q,r,n)=>{try{r.json(await wiki.schema());}catch(e){n(e);}});
    app.get('/api/wiki',async(q,r,n)=>{try{r.json({items:await wiki.list({q:q.query.q,category:q.query.category}),categoryCounts:await wiki.categoryCounts()});}catch(e){n(e);}});
    app.get('/api/wiki/:id/export',async(q,r,n)=>{try{const w=await wiki.exportMarkdown(q.params.id);must(w,'WIKI_NOT_FOUND');r.type('text/markdown').send(w.markdown);}catch(e){n(e);}});
    app.get('/api/wiki/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.references(q.params.id)});}catch(e){n(e);}});
    app.get('/api/wiki/:id',async(q,r,n)=>{try{const w=await wiki.get(q.params.id);must(w,'WIKI_NOT_FOUND');const links=(await wiki.links(w.id)).map(x=>({target:x.text,status:x.status==='found'?'resolved':x.status,candidates:x.candidates}));r.json({...w,links});}catch(e){n(e);}});
    app.get('/api/audits',(_q,r)=>r.json({items:[]}));app.get('/api/knowledge/workflows',(_q,r)=>r.json({items:[]}));
    registerB04Routes(app,{root,provider:()=>provider,rulesDir:'rules',llm,runner,jobs,drafts,commits,rawStates,rawStore:raws,wikiStore:wiki});
    app.get('/__stage/status',async(_q,r,n)=>{try{const s=await engine.load();r.json({sessionId:s.id,mode:s.mode,root:s.root,activeStage:s.activeStage,stopped:s.stopped,stopCode:s.stopCode,stages:s.stages,samples:{B:{rawId:s.samples.B.rawId,bodySha256:s.samples.B.bodySha256}},attempts:await engine.attempts(),configReads:engine.configReads,sentThisProcess:engine.sent,safeProvider:s.safeProvider});}catch(e){n(e);}});
    app.get('/__stage/bindings',async(q,r,n)=>{try{r.json(await engine.bindings(String(q.query.stage)));}catch(e){n(e);}});
    app.post('/__stage/arm',async(q,r,n)=>{try{r.json(await engine.arm(q.body.stage,q.body.releaseFile,q.body.exactSha256));}catch(e){n(e);}});
    app.get('/__stage/export',async(_q,r,n)=>{try{const s=await engine.load();must(engine.mode==='fake'||engine.lastSecrets,'EXPORT_REQUIRES_CURRENT_SECRET_SCAN_CONTEXT');const evidence={sessionId:s.id,mode:s.mode,stages:s.stages,attempts:await engine.attempts(),raws:await raws.list(),drafts:await drafts.list(),wiki:await wiki.allRecords(),safeProvider:s.safeProvider,artifacts:[]};for(const name of await fs.readdir(root))if(/^(?:request-|result-|candidate-).+\.json$/.test(name))evidence.artifacts.push({name,value:await readJson(path.join(root,name))});scan(evidence,engine.lastSecrets??[]);const file=P+'export-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';await durable(file,evidence,{exclusive:true});r.json({path:file,sha256:sha(await fs.readFile(file)),privateResponsesExcluded:true});}catch(e){n(e);}});
    app.post('/__stage/shutdown',(_q,r)=>{r.json({closing:true});setImmediate(()=>lab.close());});
    app.use(async(error,req,res,_next)=>{if(req.ownedStage)await engine.stop(error.code??'AI_ROUTE_FAILED','B').catch(()=>{});res.status(error.status??500).json({error:{code:error.code??'LOCAL_ADAPTER_ERROR',message:error.code??'本地接线失败；审查私有状态。'}});});
    engine.installNetwork();server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});const base=`http://127.0.0.1:${server.address().port}`;engine.localOrigins.add(base);
    let closed=false;const lab={engine,root,base,raws,rawStates,drafts,wiki,commits,runner,jobs,async close(){if(closed)return;closed=true;const current=await engine.load();if(current.stages.B.status==='running'){await engine.stop('SERVER_SHUTDOWN_IN_FLIGHT','B');if(current.stages.B.jobId)await runner.cancel(current.stages.B.jobId);}if((await engine.load()).stages.B.jobId)await runner.waitForSettlement((await engine.load()).stages.B.jobId);await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));engine.restoreNetwork();await fs.unlink(lease);leaseHeld=false;}};return lab;
  }catch(error){if(server?.listening)await new Promise(r=>server.close(r));engine.restoreNetwork?.();if(leaseHeld)await fs.unlink(lease);throw error;}
}
